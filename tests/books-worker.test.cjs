const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHmac } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../worker/cf_worker.js'), 'utf8');
const env = {
  BOT_TOKEN: 'test-bot-token', ALLOWED_USER_IDS: '123, 456', SUPABASE_BUCKET: 'Umbrello',
  SUPABASE_URL: 'https://testproject.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test-key',
};
const ID_A = 'a'.repeat(64), ID_B = 'b'.repeat(64), MISSING = 'c'.repeat(64);
const catalog = () => ({ formatVersion: 1, books: [
  { bookId: ID_A, title: 'First Book', author: 'Ann Author', path: 'books/first-book/book.json' },
  { bookId: ID_B, title: 'Second Book', author: null, path: 'books/second.json' },
] });
const bookBytes = '{"formatVersion":1,"bookId":"' + ID_A + '","title":"First Book"}';
function signed(user = { id: 123 }, date = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ auth_date: String(date), query_id: 'test-query' });
  if (user !== undefined) params.set('user', typeof user === 'string' ? user : JSON.stringify(user));
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}
function harness(options = {}) {
  const calls = [];
  const context = vm.createContext({ Request, Response, URL, URLSearchParams, Uint8Array, TextEncoder, TextDecoder,
    AbortController, AbortSignal, crypto: webcrypto, setTimeout, clearTimeout, console: { warn() {} },
    fetch: async (url, config) => {
      calls.push({ url, config });
      if (options.fetch) return options.fetch(url, config);
      if (url.endsWith('/books/index.json')) return Response.json('catalog' in options ? options.catalog : catalog());
      return new Response(bookBytes, { headers: { 'Content-Type': 'application/json' } });
    },
  });
  vm.runInContext(source.replace('export default {', 'globalThis.worker = {'), context);
  const call = (route, body = {}, config = {}) => context.worker.fetch(new Request(`https://worker.test${route}`, {
    method: config.method || 'POST', headers: { 'Content-Type': 'application/json' },
    ...(config.method !== 'GET' ? { body: JSON.stringify({ initData: signed(), ...body }) } : {}),
  }), { ...env, ...config.env });
  return { calls, call };
}
const routes = [['/books/list', {}], ['/books/book', { bookId: ID_A }]];

test('Books routes require a current, untampered Telegram signature before any storage access', async () => {
  for (const [route, body] of routes) {
    for (const initData of ['', 'hash=bad', signed().replace('123', '456'), signed({ id: 123 }, 1), signed() + '&user={}']) {
      const app = harness();
      const response = await app.call(route, { ...body, initData });
      assert.equal(response.status, 403);
      const result = await response.json();
      assert.equal(result.error, 'unauthorized');
      assert.equal('userId' in result, false, 'unverified launch data never yields an ID');
      assert.equal(app.calls.length, 0);
    }
    const app = harness();
    assert.equal((await app.call(route, body, { method: 'GET' })).status, 405);
    assert.equal(app.calls.length, 0);
  }
});

test('Books allowlist fails closed and returns only the signed ID of the caller', async () => {
  for (const [route, body] of routes) {
    for (const value of [undefined, '', ' ', '123,', '123,me', '*', '0123', '9999999999999999']) {
      const app = harness();
      const response = await app.call(route + '?user=me', { ...body, initData: signed({ id: 321 }) }, { env: { ALLOWED_USER_IDS: value } });
      assert.equal(response.status, 503);
      assert.deepEqual({ ...(await response.json()), message: undefined },
        { error: 'books_not_configured', message: undefined, userId: 321 });
      assert.equal(app.calls.length, 0);
    }
    for (const [user, userId] of [[{ id: 789 }, 789], [{ id: 1 }, 1], [{}, undefined], [null, undefined], ['{invalid', undefined], [{ id: '123' }, undefined], [{ id: 123.5 }, undefined]]) {
      const app = harness();
      const response = await app.call(route + '?user=me', { ...body, initData: signed(user) });
      assert.equal(response.status, 403);
      const result = await response.json();
      assert.equal(result.error, 'books_forbidden');
      assert.equal(result.userId, userId);
      assert.equal(app.calls.length, 0);
    }
  }
});

test('one allowlist controls Books, Grammar, Write and reports before any provider request', async () => {
  for (const [route, body] of [
    ['/books/book', { bookId: 'invalid' }], ['/grammar/unit', { unitId: 'missing' }],
    ['/write/generate', {}], ['/', {}],
  ]) {
    for (const id of [123, 456, 789]) {
      const app = harness({ fetch: () => { throw new Error('no provider should be called'); } });
      const response = await app.call(route, { ...body, initData: signed({ id }) });
      // Allowed accounts reach input validation; unlisted accounts are denied first.
      assert.equal(response.status, id === 789 ? 403 : 400);
      assert.equal(app.calls.length, 0);
    }
  }
});

test('allowed users receive the catalog without storage paths, read through private Storage', async () => {
  for (const id of [123, 456]) {
    const app = harness();
    const response = await app.call('/books/list', { initData: signed({ id }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { books: [
      { bookId: ID_A, title: 'First Book', author: 'Ann Author' },
      { bookId: ID_B, title: 'Second Book', author: null },
    ] });
    assert.equal(app.calls.length, 1);
    const call = app.calls[0];
    assert.equal(call.url, 'https://testproject.supabase.co/storage/v1/object/authenticated/Umbrello/books/index.json');
    assert.equal(call.config.method, 'GET');
    assert.equal(call.config.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(call.config.redirect, 'manual');
    assert.equal(call.config.cache, 'no-store');
  }
});

test('Books use the shared configured bucket and preserve its case', async () => {
  for (const bucket of ['Umbrello', 'library']) {
    const app = harness();
    assert.equal((await app.call('/books/list', {}, { env: { SUPABASE_BUCKET: bucket } })).status, 200);
    assert.equal(app.calls[0].url, `https://testproject.supabase.co/storage/v1/object/authenticated/${bucket}/books/index.json`);
  }
});

test('a book is served only from the path listed for its bookId in the catalog', async () => {
  const app = harness();
  const response = await app.call('/books/book', { bookId: ID_A, path: 'books/second.json' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), bookBytes);
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(app.calls.map(call => call.url.split('/Umbrello/')[1]), ['books/index.json', 'books/first-book/book.json']);

  const unknown = harness();
  const missing = await unknown.call('/books/book', { bookId: MISSING });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'books_not_found');
  assert.equal(unknown.calls.length, 1, 'only the catalog is read for an unlisted book');

  for (const bookId of [undefined, '', 'books/index.json', '../secret', ID_A.toUpperCase(), ID_A + 'a', 42]) {
    const bad = harness();
    const result = await bad.call('/books/book', { bookId });
    assert.equal(result.status, 400);
    assert.equal((await result.json()).error, 'invalid_input');
    assert.equal(bad.calls.length, 0);
  }
});

test('invalid catalogs are rejected without serving any book', async () => {
  const entry = (extra) => ({ formatVersion: 1, books: [{ bookId: ID_A, title: 'First', author: 'A', path: 'books/first.json', ...extra }] });
  const invalid = [
    null, [], { books: [] }, { formatVersion: 2, books: [] }, { formatVersion: 1, books: {} },
    entry({ bookId: 'abc' }), entry({ title: '' }), entry({ title: 5 }), entry({ author: 7 }), entry({ author: undefined }),
    entry({ path: '../private/grammar.json' }), entry({ path: 'books/index.json' }), entry({ path: 'unit-001.json' }),
    entry({ path: 'books/a/b/c.json' }), entry({ path: 'books/First.json' }), entry({ path: 'https://example.com/books/a.json' }),
    { formatVersion: 1, books: [catalog().books[0], { ...catalog().books[1], bookId: ID_A }] },
    { formatVersion: 1, books: [catalog().books[0], { ...catalog().books[1], path: catalog().books[0].path }] },
  ];
  for (const value of invalid) {
    for (const [route, body] of routes) {
      const app = harness({ catalog: value });
      const response = await app.call(route, body);
      assert.equal(response.status, 502, JSON.stringify(value));
      assert.equal((await response.json()).error, 'books_catalog_invalid');
      assert.equal(app.calls.length, 1);
    }
  }
  const broken = harness({ fetch: () => new Response('{not json', { headers: { 'Content-Type': 'application/json' } }) });
  assert.equal((await (await broken.call('/books/list')).json()).error, 'books_catalog_invalid');
});

test('storage failures map to safe Books error codes and never leak secrets or storage bodies', async () => {
  const cases = [
    [() => new Response('missing', { status: 404 }), 404, 'books_not_found'],
    [() => Response.json({ statusCode: '404', error: 'not_found' }, { status: 400 }), 404, 'books_not_found'],
    [() => new Response('denied sb_secret_test-key', { status: 403 }), 502, 'books_storage_auth'],
    [() => new Response(null, { status: 302, headers: { Location: 'https://example.com' } }), 502, 'books_storage_error'],
    [() => new Response('oops', { status: 500 }), 502, 'books_storage_error'],
    [() => { throw new TypeError('network down'); }, 502, 'books_storage_network'],
  ];
  for (const [fetch, status, code] of cases) {
    for (const [route, body] of routes) {
      const app = harness({ fetch });
      const response = await app.call(route, body);
      assert.equal(response.status, status);
      const raw = await response.text();
      assert.equal(JSON.parse(raw).error, code);
      assert.doesNotMatch(raw, /sb_secret|test-bot-token|denied|oops|supabase\.co/);
    }
  }
  const big = harness({ fetch: url => url.endsWith('index.json') ? Response.json(catalog())
    : new Response('x', { headers: { 'Content-Length': String(9 * 1024 * 1024) } }) });
  assert.equal((await (await big.call('/books/book', { bookId: ID_A })).json()).error, 'books_storage_size');
  const unconfigured = harness();
  const response = await unconfigured.call('/books/list', {}, { env: { SUPABASE_SERVICE_ROLE_KEY: 'anon-key' } });
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.error, 'books_not_configured');
  assert.equal('userId' in result, false, 'storage configuration errors are not access errors');
  assert.equal(unconfigured.calls.length, 0);
});
