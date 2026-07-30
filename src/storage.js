export const GIB = 1024 ** 3;
export const PRODUCTION_QUOTA = 7 * GIB;
export const PREVIEW_QUOTA = 1 * GIB;

export function quotaFor(env) {
  const configured = Number(env.STORAGE_QUOTA_BYTES);
  if (Number.isSafeInteger(configured) && configured > 0) return configured;
  return env.ENVIRONMENT === 'preview' ? PREVIEW_QUOTA : PRODUCTION_QUOTA;
}

export async function reserveBytes(db, bytes, limit) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return false;
  const result = await db.prepare(`UPDATE storage_usage
    SET reserved_bytes = reserved_bytes + ?, updated_at = ?
    WHERE id = 1 AND stored_bytes + reserved_bytes + ? <= ?`)
    .bind(bytes, new Date().toISOString(), bytes, limit).run();
  return result.meta.changes === 1;
}

export async function commitUploadedBytes(db, bytes) {
  await db.prepare(`UPDATE storage_usage SET
    reserved_bytes = MAX(0, reserved_bytes - ?),
    stored_bytes = stored_bytes + ?, updated_at = ? WHERE id = 1`)
    .bind(bytes, bytes, new Date().toISOString()).run();
}

export async function releaseReservedBytes(db, bytes) {
  if (bytes <= 0) return;
  await db.prepare('UPDATE storage_usage SET reserved_bytes = MAX(0, reserved_bytes - ?), updated_at = ? WHERE id = 1')
    .bind(bytes, new Date().toISOString()).run();
}

export async function decrementStoredBytes(db, bytes) {
  if (bytes <= 0) return;
  await db.prepare('UPDATE storage_usage SET stored_bytes = MAX(0, stored_bytes - ?), updated_at = ? WHERE id = 1')
    .bind(bytes, new Date().toISOString()).run();
}

export async function uploadWithinQuota(db, bucket, objects, limit) {
  const total = objects.reduce((sum, object) => sum + object.size, 0);
  if (!(await reserveBytes(db, total, limit))) {
    const error = new Error('Upload storage is full. Delete files or try again later.');
    error.status = 507;
    throw error;
  }
  const uploaded = [];
  let reserved = total;
  try {
    for (const object of objects) {
      await bucket.put(object.key, object.body, object.options);
      await commitUploadedBytes(db, object.size);
      reserved -= object.size;
      uploaded.push(object);
    }
    return uploaded;
  } catch (error) {
    await Promise.all(uploaded.map(async (object) => {
      await bucket.delete(object.key);
      await decrementStoredBytes(db, object.size);
    }));
    await releaseReservedBytes(db, reserved);
    throw error;
  }
}
