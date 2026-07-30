const COOKIE_PROD = '__Host-swapshelf_admin';
const COOKIE_DEV = 'swapshelf_admin';
const MAX_FILES = 5;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_LISTING_TYPES = new Set(['BOOK', 'NOTES']);
const ALLOWED_CONDITIONS = new Set(['Excellent', 'Good', 'Fair']);
const ALLOWED_STATUSES = new Set(['PENDING', 'PUBLISHED']);
const SESSION_TTL_SECONDS = 8 * 60 * 60;

const encoder = new TextEncoder();
const loginAttempts = new Map();

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof HttpError) return json({ success: false, message: error.message }, error.status);
      console.error('Unhandled request error:', error?.message || error);
      return json({ success: false, message: 'Server error.' }, 500);
    }
  }
};

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'GET' && (path === '/health' || path === '/api/health')) {
    return json({ ok: true, service: 'swapshelf', database: Boolean(env.DB), storage: Boolean(env.MEDIA) });
  }

  if (request.method === 'GET' && path === '/api/admin/status') {
    return json({ isAdmin: await isAdmin(request, env) });
  }

  if (request.method === 'POST' && path === '/admin/login') {
    if (!sameOrigin(request)) return json({ success: false, message: 'Invalid request origin.' }, 403);
    return login(request, env);
  }

  if (request.method === 'POST' && path === '/admin/logout') {
    if (!sameOrigin(request)) return json({ success: false, message: 'Invalid request origin.' }, 403);
    return logout(request);
  }

  if (request.method === 'GET' && path === '/api/resources') {
    return listResources(request, env);
  }

  if (request.method === 'POST' && path === '/api/resources') {
    if (!sameOrigin(request)) return json({ success: false, message: 'Invalid request origin.' }, 403);
    return createResource(request, env);
  }

  if (request.method === 'GET' && path.startsWith('/api/isbn/')) {
    return lookupIsbn(path.slice('/api/isbn/'.length));
  }

  if (request.method === 'POST' && path === '/api/send-request-email') {
    if (!sameOrigin(request)) return json({ success: false, message: 'Invalid request origin.' }, 403);
    return sendRequestEmail(request, env);
  }

  const adminMatch = path.match(/^\/api\/admin\/resources\/([^/]+)(?:\/status)?$/);
  if (adminMatch) {
    if (!sameOrigin(request)) return json({ success: false, message: 'Invalid request origin.' }, 403);
    if (!(await isAdmin(request, env))) return json({ success: false, message: 'Admin authentication required.' }, 401);
    const id = decodeURIComponent(adminMatch[1]);
    if (request.method === 'PATCH' && path.endsWith('/status')) return updateResourceStatus(request, env, id);
    if (request.method === 'DELETE' && !path.endsWith('/status')) return deleteResource(env, id);
  }

  if (request.method === 'GET' && path.startsWith('/media/')) {
    return serveMedia(request, env, decodeURIComponent(path.slice('/media/'.length)));
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    const response = await env.ASSETS.fetch(request);
    return withSecurityHeaders(response);
  }

  return json({ success: false, message: 'Not found.' }, 404);
}

async function listResources(request, env) {
  requireDatabase(env);
  const url = new URL(request.url);
  const wantsAll = url.searchParams.get('all') === '1';
  const admin = wantsAll && await isAdmin(request, env);
  const statement = admin
    ? 'SELECT * FROM listings ORDER BY created_at DESC'
    : "SELECT * FROM listings WHERE status = 'PUBLISHED' ORDER BY created_at DESC";
  const result = await env.DB.prepare(statement).all();
  return json({ success: true, resources: (result.results || []).map(publicListing) });
}

async function createResource(request, env) {
  requireDatabase(env);
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return json({ success: false, message: 'Use multipart form data.' }, 415);
  }

  const form = await request.formData();
  const data = {
    type: clean(form.get('type'), 20).toUpperCase(),
    isbn: clean(form.get('isbn'), 20).replace(/[^0-9Xx-]/g, ''),
    title: clean(form.get('title'), 160),
    author_subject: clean(form.get('author_subject'), 160),
    description: clean(form.get('description'), 2000),
    condition: clean(form.get('condition'), 40),
    location: clean(form.get('location'), 160),
    owner_email: clean(form.get('owner_email'), 254).toLowerCase(),
    tags: clean(form.get('tags'), 500).split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 12)
  };

  const missing = ['type', 'title', 'author_subject', 'description', 'condition', 'location', 'owner_email']
    .filter((field) => !data[field]);
  if (missing.length) return json({ success: false, message: `Missing: ${missing.join(', ')}` }, 400);
  if (!ALLOWED_LISTING_TYPES.has(data.type)) return json({ success: false, message: 'Invalid resource type.' }, 400);
  if (!ALLOWED_CONDITIONS.has(data.condition)) return json({ success: false, message: 'Invalid condition.' }, 400);
  if (!validEmail(data.owner_email)) return json({ success: false, message: 'Enter a valid owner email.' }, 400);

  const files = form.getAll('images').filter((value) => value && typeof value.arrayBuffer === 'function' && value.size > 0);
  if (files.length > MAX_FILES) return json({ success: false, message: `Upload no more than ${MAX_FILES} images.` }, 400);
  if (files.length && !env.MEDIA) return json({ success: false, message: 'Image storage is not configured yet.' }, 503);

  const id = crypto.randomUUID();
  const keys = [];
  try {
    for (const file of files) {
      validateFileMetadata(file);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!validImageSignature(bytes, file.type)) throw new HttpError(400, 'An uploaded file is not a valid JPG, PNG, or WebP image.');
      const extension = extensionFor(file.type);
      const key = `listings/${id}/${crypto.randomUUID()}.${extension}`;
      await env.MEDIA.put(key, bytes, {
        httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' },
        customMetadata: { listingId: id }
      });
      keys.push(key);
    }

    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO listings
      (id, type, isbn, title, author_subject, description, condition, location, owner_email, tags_json, image_keys_json, status, featured, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)`)
      .bind(id, data.type, data.isbn || null, data.title, data.author_subject, data.description, data.condition, data.location,
        data.owner_email, JSON.stringify(data.tags), JSON.stringify(keys), now, now)
      .run();

    return json({ success: true, resource: publicListing({ ...data, id, image_keys_json: JSON.stringify(keys), tags_json: JSON.stringify(data.tags), status: 'PENDING', featured: 0, created_at: now, updated_at: now }) }, 201);
  } catch (error) {
    if (env.MEDIA && keys.length) await Promise.allSettled(keys.map((key) => env.MEDIA.delete(key)));
    if (error instanceof HttpError) return json({ success: false, message: error.message }, error.status);
    throw error;
  }
}

async function updateResourceStatus(request, env, id) {
  requireDatabase(env);
  const body = await readJson(request);
  const status = clean(body.status, 20).toUpperCase();
  if (!ALLOWED_STATUSES.has(status)) return json({ success: false, message: 'Invalid status.' }, 400);
  const result = await env.DB.prepare('UPDATE listings SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, new Date().toISOString(), id).run();
  if (!result.meta?.changes) return json({ success: false, message: 'Listing not found.' }, 404);
  return json({ success: true, status });
}

async function deleteResource(env, id) {
  requireDatabase(env);
  const listing = await env.DB.prepare('SELECT image_keys_json FROM listings WHERE id = ?').bind(id).first();
  if (!listing) return json({ success: false, message: 'Listing not found.' }, 404);
  const keys = parseJsonArray(listing.image_keys_json);
  await env.DB.prepare('DELETE FROM listings WHERE id = ?').bind(id).run();
  if (env.MEDIA && keys.length) await Promise.allSettled(keys.map((key) => env.MEDIA.delete(key)));
  return json({ success: true });
}

async function serveMedia(request, env, key) {
  if (!env.MEDIA || !key || key.includes('..')) return new Response('Not found', { status: 404 });
  const object = await env.MEDIA.get(key);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-security-policy', "default-src 'none'; sandbox");
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

async function lookupIsbn(rawIsbn) {
  const isbn = clean(rawIsbn, 20).replace(/[^0-9Xx]/g, '');
  if (!isbn) return json({ success: false, message: 'ISBN required.' }, 400);
  try {
    const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return json({ success: false, message: 'ISBN service is unavailable.' }, 502);
    const data = await response.json();
    const book = data.items?.[0]?.volumeInfo;
    if (!book) return json({ success: false, message: 'No book found.' }, 404);
    return json({ success: true, book: {
      title: clean(book.title, 160),
      authors: Array.isArray(book.authors) ? book.authors.map((value) => clean(value, 100)).slice(0, 10) : [],
      description: clean(book.description, 2000),
      categories: Array.isArray(book.categories) ? book.categories.map((value) => clean(value, 80)).slice(0, 10) : []
    }});
  } catch (error) {
    console.error('ISBN lookup failed:', error?.message || error);
    return json({ success: false, message: 'ISBN lookup failed.' }, 502);
  }
}

async function sendRequestEmail(request, env) {
  requireDatabase(env);
  const body = await readJson(request);
  const listingId = clean(body.listing_id, 80);
  const requesterName = clean(body.requester_name, 100);
  const requesterEmail = clean(body.requester_email, 254).toLowerCase();
  const message = clean(body.message, 2000);
  if (!listingId || !requesterName || !requesterEmail || !message) {
    return json({ success: false, message: 'Missing required fields.' }, 400);
  }
  if (!validEmail(requesterEmail)) return json({ success: false, message: 'Enter a valid email.' }, 400);

  const listing = await env.DB.prepare("SELECT title, owner_email FROM listings WHERE id = ? AND status = 'PUBLISHED'").bind(listingId).first();
  if (!listing) return json({ success: false, message: 'Listing not found.' }, 404);
  if (!env.SENDGRID_API_KEY || !env.SENDGRID_FROM_EMAIL) {
    return json({ success: false, message: 'Email delivery is not configured yet.' }, 503);
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.SENDGRID_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: listing.owner_email }] }],
      from: { email: env.SENDGRID_FROM_EMAIL },
      reply_to: { email: requesterEmail },
      subject: `SwapShelf request for ${clean(listing.title, 120)}`,
      content: [{ type: 'text/plain', value: `${requesterName} is interested in your resource.\n\n${message}` }]
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    console.error('SendGrid returned:', response.status);
    return json({ success: false, message: 'Email delivery failed.' }, 502);
  }
  return json({ success: true });
}

async function login(request, env) {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return json({ success: false, message: 'Admin access is not configured.' }, 503);
  }
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (tooManyLoginAttempts(ip)) return json({ success: false, message: 'Too many login attempts. Try again later.' }, 429);

  const body = await readJson(request);
  const username = clean(body.username, 100);
  const password = clean(body.password, 200);
  if (!constantTimeEqual(username.toLowerCase(), clean(env.ADMIN_USERNAME, 100).toLowerCase()) || !constantTimeEqual(password, String(env.ADMIN_PASSWORD))) {
    recordFailedLogin(ip);
    return json({ success: false, message: 'Invalid credentials.' }, 401);
  }
  loginAttempts.delete(ip);

  const token = await createSessionToken(env.SESSION_SECRET);
  const secure = new URL(request.url).protocol === 'https:';
  const cookieName = secure ? COOKIE_PROD : COOKIE_DEV;
  const parts = [`${cookieName}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${SESSION_TTL_SECONDS}`];
  if (secure) parts.push('Secure');
  return json({ success: true }, 200, { 'set-cookie': parts.join('; ') });
}

function logout(request) {
  const secure = new URL(request.url).protocol === 'https:';
  const cookieName = secure ? COOKIE_PROD : COOKIE_DEV;
  const parts = [`${cookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return json({ success: true }, 200, { 'set-cookie': parts.join('; ') });
}

async function isAdmin(request, env) {
  if (!env.SESSION_SECRET) return false;
  const cookies = parseCookies(request.headers.get('cookie') || '');
  const token = cookies[COOKIE_PROD] || cookies[COOKIE_DEV];
  return token ? verifySessionToken(token, env.SESSION_SECRET) : false;
}

async function createSessionToken(secret) {
  const payload = base64UrlEncode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS, nonce: crypto.randomUUID() }));
  const signature = await hmac(payload, secret);
  return `${payload}.${signature}`;
}

async function verifySessionToken(token, secret) {
  const [payload, signature] = String(token).split('.');
  if (!payload || !signature) return false;
  const expected = await hmac(payload, secret);
  if (!constantTimeEqual(signature, expected)) return false;
  try {
    const data = JSON.parse(base64UrlDecode(payload));
    return Number.isFinite(data.exp) && data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return base64UrlFromBytes(new Uint8Array(signature));
}

function publicListing(row) {
  const imageKeys = parseJsonArray(row.image_keys_json);
  return {
    id: row.id,
    type: row.type,
    isbn: row.isbn || '',
    title: row.title,
    author_subject: row.author_subject,
    description: row.description,
    condition: row.condition,
    location: row.location,
    tags: parseJsonArray(row.tags_json),
    images: imageKeys.map((key) => `/media/${encodeURIComponent(key)}`),
    status: row.status,
    featured: Boolean(row.featured),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function validateFileMetadata(file) {
  if (!ALLOWED_TYPES.has(file.type)) throw new HttpError(400, 'Only JPG, PNG, and WebP images are allowed.');
  if (file.size > MAX_FILE_BYTES) throw new HttpError(400, 'Each image must be 5 MiB or smaller.');
}

function validImageSignature(bytes, type) {
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  if (type === 'image/webp') return bytes.length >= 12 && textBytes(bytes, 0, 4) === 'RIFF' && textBytes(bytes, 8, 12) === 'WEBP';
  return false;
}

function extensionFor(type) {
  return type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'webp';
}

function textBytes(bytes, start, end) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

function requireDatabase(env) {
  if (!env.DB) throw new HttpError(503, 'Database is not configured yet.');
}

async function readJson(request) {
  try { return await request.json(); } catch { throw new HttpError(400, 'Invalid JSON request.'); }
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function parseCookies(header) {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index === -1 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
  }));
}

function base64UrlEncode(value) {
  return base64UrlFromBytes(encoder.encode(value));
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(normalized);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function base64UrlFromBytes(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) mismatch |= (a[index] || 0) ^ (b[index] || 0);
  return mismatch === 0;
}

function tooManyLoginAttempts(ip) {
  const record = loginAttempts.get(ip);
  if (!record) return false;
  if (record.resetAt < Date.now()) {
    loginAttempts.delete(ip);
    return false;
  }
  return record.count >= 10;
}

function recordFailedLogin(ip) {
  const current = loginAttempts.get(ip);
  if (!current || current.resetAt < Date.now()) loginAttempts.set(ip, { count: 1, resetAt: Date.now() + 15 * 60 * 1000 });
  else current.count += 1;
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'");
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders });
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  return new Response(JSON.stringify(data), { status, headers });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const testables = {
  clean,
  validEmail,
  validImageSignature,
  publicListing,
  sameOrigin,
  createSessionToken,
  verifySessionToken,
  constantTimeEqual
};
