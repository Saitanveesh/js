import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { testables } from '../src/worker.js';

function assets() {
  return {
    fetch: async () => new Response('<!doctype html><title>SwapShelf</title><h1>SwapShelf</h1>', {
      headers: { 'content-type': 'text/html' }
    })
  };
}

function database(handlers = {}) {
  return {
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) { this.values = values; return this; },
        all: async () => handlers.all?.(sql, this.values) ?? { results: [] },
        first: async () => handlers.first?.(sql, this.values) ?? null,
        run: async () => handlers.run?.(sql, this.values) ?? { meta: { changes: 1 } }
      };
      return statement;
    }
  };
}

function env(overrides = {}) {
  return { ASSETS: assets(), DB: database(), ...overrides };
}

test('serves the static application shell', async () => {
  const response = await worker.fetch(new Request('https://example.com/'), env());
  assert.equal(response.status, 200);
  assert.match(await response.text(), /SwapShelf/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});

test('health endpoint reports configured bindings', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/health'), env({ MEDIA: {} }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'swapshelf', database: true, storage: true });
});

test('published listings are read from D1 without exposing owner email', async () => {
  const DB = database({
    all: () => ({ results: [{
      id: 'one', type: 'BOOK', isbn: '', title: 'Algorithms', author_subject: 'CLRS', description: 'Book',
      condition: 'Good', location: 'Bengaluru', owner_email: 'private@example.com', tags_json: '["CSE"]',
      image_keys_json: '["listings/one/a.jpg"]', status: 'PUBLISHED', featured: 0,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z'
    }] })
  });
  const response = await worker.fetch(new Request('https://example.com/api/resources'), env({ DB }));
  const body = await response.json();
  assert.equal(body.resources[0].title, 'Algorithms');
  assert.equal(body.resources[0].owner_email, undefined);
  assert.equal(body.resources[0].images[0], '/media/listings%2Fone%2Fa.jpg');
});

test('listing submission validates required fields', async () => {
  const form = new FormData();
  form.set('type', 'BOOK');
  const response = await worker.fetch(new Request('https://example.com/api/resources', {
    method: 'POST', headers: { origin: 'https://example.com' }, body: form
  }), env());
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /Missing:/);
});

test('invalid image signatures are rejected before database insertion', async () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    type: 'BOOK', title: 'Test', author_subject: 'Tester', description: 'Description', condition: 'Good',
    location: 'Bengaluru', owner_email: 'owner@example.com'
  })) form.set(key, value);
  form.append('images', new File([new Uint8Array([1, 2, 3, 4])], 'fake.jpg', { type: 'image/jpeg' }));
  const MEDIA = { put: async () => { throw new Error('should not upload'); }, delete: async () => {} };
  const response = await worker.fetch(new Request('https://example.com/api/resources', {
    method: 'POST', headers: { origin: 'https://example.com' }, body: form
  }), env({ MEDIA }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /not a valid/);
});

test('moderation endpoints require admin authentication', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/admin/resources/one/status', {
    method: 'PATCH', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: '{"status":"PUBLISHED"}'
  }), env({ SESSION_SECRET: 'secret' }));
  assert.equal(response.status, 401);
});

test('contact request fails safely when email is not configured', async () => {
  const DB = database({ first: () => ({ title: 'Algorithms', owner_email: 'owner@example.com' }) });
  const response = await worker.fetch(new Request('https://example.com/api/send-request-email', {
    method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' },
    body: JSON.stringify({ listing_id: 'one', requester_name: 'Student', requester_email: 'student@example.com', message: 'Interested' })
  }), env({ DB }));
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /not configured/);
});

test('signed admin sessions reject tampering', async () => {
  const token = await testables.createSessionToken('strong-secret');
  assert.equal(await testables.verifySessionToken(token, 'strong-secret'), true);
  assert.equal(await testables.verifySessionToken(`${token}x`, 'strong-secret'), false);
  assert.equal(testables.validEmail('student@example.com'), true);
  assert.equal(testables.validEmail('not-an-email'), false);
});
