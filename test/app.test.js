const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../server');

function request(server, path) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.get({ host: '127.0.0.1', port: address.port, path }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
  });
}

test('health endpoint reports service status', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const response = await request(server, '/health');
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, service: 'swapshelf' });
});

test('home page renders the application shell', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const response = await request(server, '/');
  assert.equal(response.status, 200);
  assert.match(response.body, /SwapShelf/);
  assert.match(response.body, /listing-form/);
});
