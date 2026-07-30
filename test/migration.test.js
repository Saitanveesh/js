import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('quota migration preserves the existing listings table', async () => {
  const sql = await readFile(new URL('../migrations/0002_add_storage_quota.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /(?:DROP|CREATE)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?listings\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS listing_objects/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS storage_usage/i);
  assert.match(sql, /ON CONFLICT\(id\) DO NOTHING/i);
});

test('Worker uses the established JSON column names', async () => {
  const source = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.match(source, /tags_json/);
  assert.match(source, /image_keys_json/);
  assert.doesNotMatch(source, /INSERT INTO listings[^\n]+\btags,images\b/);
});
