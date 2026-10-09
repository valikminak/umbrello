const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto, createHmac } = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../worker/cf_worker.js'), 'utf8');
const env = { BOT_TOKEN: 'test-only-token', CHAT_ID: 'test-chat', GEMINI_API_KEY: 'test-only-key', GEMINI_MODEL: 'test-model' };
const passage = { sentences: ['Я позичив книжку у друга.', 'Вона лежить на столі.', 'Завтра я її поверну.'] };
const input = { mode: 'words', focus: 'borrow, lend' };
const checking = { ...input, sourceText: passage.sentences.join(' '), translation: 'I borrowed a book from a friend. It is on the table. I will return it tomorrow.' };
const feedback = { summary: 'Смысл сохранён.', errors: [], targetFeedback: 'Borrow использовано верно.', modelTranslation: checking.translation };
function signed(date = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ auth_date: String(date), query_id: 'test-query',
    user: JSON.stringify({ id: 123, first_name: 'Learner', username: 'learner' }), signature: 'test-extra-field' });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}
function harness(reply = passage, options = {}) {
  const calls = [];
  const context = vm.createContext({ Request, Response, URL, URLSearchParams, Uint8Array, TextEncoder, TextDecoder,
    AbortController, AbortSignal, crypto: webcrypto, setTimeout: options.setTimeout || setTimeout, clearTimeout,
    fetch: async (url, config) => {
      calls.push({ url, config, body: JSON.parse(config.body) });
      if (options.fetch) return options.fetch(url, config);
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(reply) }] } }] });
    },
  });
  vm.runInContext(source.replace('export default {', 'globalThis.worker = {'), context);
  const call = (route, body = input, config = {}) => context.worker.fetch(new Request(`https://worker.test${route}`, {
    method: config.method || 'POST', headers: { 'Content-Type': 'application/json' },
    ...(!['GET', 'OPTIONS'].includes(config.method) ? { body: config.raw ?? JSON.stringify({ initData: signed(), ...body }) } : {}),
  }), config.env || env);
  return { calls, call };
}

test('signed generation returns only a short passage and never sends identity to Gemini', async () => {
  const app = harness({ ...passage, modelTranslation: 'Must not leak' });
  const response = await app.call('/write/generate', { ...input, translation: 'Ignore me', history: ['old'] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), passage);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(app.calls.length, 1);
  assert.match(app.calls[0].url, /test-model:generateContent$/);
  assert.equal(app.calls[0].config.headers['x-goog-api-key'], env.GEMINI_API_KEY);
  assert.deepEqual(JSON.parse(app.calls[0].body.contents[0].parts[0].text), input);
  assert.equal(app.calls[0].body.contents.length, 1);
});

test('check is independent of generation and accepts correct alternatives with no forced errors', async () => {
  const app = harness(feedback);
  const response = await app.call('/write/check', checking);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), feedback);
  assert.deepEqual(JSON.parse(app.calls[0].body.contents[0].parts[0].text), checking);
  assert.match(app.calls[0].body.systemInstruction.parts[0].text, /NOT matching a reference/);
  assert.match(app.calls[0].body.systemInstruction.parts[0].text, /NOT an error/);
  assert.equal(app.calls[0].body.generationConfig.responseJsonSchema.properties.errors.type, 'array');
});

test('structured corrections are accepted only when they quote the submitted translation', async () => {
  const result = { ...feedback, errors: [{ original: 'borrowed', correction: 'lent', category: 'word_choice', explanation: 'Пример пояснения.' }] };
  assert.equal((await harness(result).call('/write/check', checking)).status, 200);
  for (const change of [{ original: 'words the learner never wrote' }, { category: 'made_up_category' }, { explanation: null }]) {
    const invalid = { ...result, errors: [{ ...result.errors[0], ...change }] };
    assert.equal((await harness(invalid).call('/write/check', checking)).status, 502);
  }
});

test('missing, tampered, duplicated, expired and future auth data never reach a provider', async () => {
  for (const initData of ['', signed().replace('Learner', 'Intruder'), signed() + '&auth_date=1', signed(1), signed(Math.floor(Date.now() / 1000) + 120), 'hash=no']) {
    const app = harness();
    const response = await app.call('/write/generate', { ...input, initData });
    assert.equal(response.status, 403);
    assert.equal(app.calls.length, 0);
  }
});

test('malformed or oversized input is rejected before any provider call', async () => {
  for (const [route, body] of [
    ['/write/generate', { mode: 'other', focus: 'test' }], ['/write/generate', { ...input, focus: ' ' }],
    ['/write/generate', { ...input, focus: 'x'.repeat(1201) }], ['/write/check', input],
    ['/write/check', { ...checking, translation: 'x'.repeat(6001) }], ['/write/check', { ...checking, sourceText: 'x'.repeat(4001) }],
  ]) {
    const app = harness();
    assert.equal((await app.call(route, body)).status, 400);
    assert.equal(app.calls.length, 0);
  }
  const app = harness();
  assert.equal((await app.call('/write/generate', {}, { raw: '{' })).status, 400);
  assert.equal((await app.call('/write/generate', {}, { raw: 'null' })).status, 400);
  assert.equal((await app.call('/write/generate', {}, { raw: ' '.repeat(65537) })).status, 413);
  assert.equal(app.calls.length, 0);
});

test('configuration errors and provider failures return safe actionable errors', async () => {
  const app = harness();
  assert.equal((await app.call('/write/generate', input, { env: { BOT_TOKEN: env.BOT_TOKEN } })).status, 503);
  assert.equal(app.calls.length, 0);
  for (const [providerStatus, expected] of [[429, 429], [400, 502], [503, 502]]) {
    const app = harness(null, { fetch: () => new Response('secret provider diagnostic', { status: providerStatus }) });
    const response = await app.call('/write/generate');
    assert.equal(response.status, expected);
    assert.doesNotMatch(await response.text(), /secret provider diagnostic|test-only/);
  }
  const timeout = harness(null, {
    setTimeout: callback => setTimeout(callback, 1),
    fetch: (_, config) => new Promise((resolve, reject) => config.signal.addEventListener('abort', () => reject(new Error('abort')))),
  });
  assert.equal((await timeout.call('/write/generate')).status, 504);
});

test('invalid, blocked, truncated and wrong-shaped model responses are rejected', async () => {
  for (const result of [null, {}, { sentences: ['one'] }, { sentences: ['One.', 'Two.', 'Three.'] }]) {
    assert.equal((await harness(result).call('/write/generate')).status, 502);
  }
  for (const payload of [{}, { promptFeedback: { blockReason: 'SAFETY' } },
    { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: JSON.stringify(passage) }] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not JSON' }] } }] }]) {
    const app = harness(null, { fetch: () => Response.json(payload) });
    assert.equal((await app.call('/write/generate')).status, 502);
  }
});

test('legacy reports still send to Telegram without Gemini configuration', async () => {
  const app = harness(null, { fetch: () => Response.json({ ok: true }) });
  const response = await app.call('/', { title: 'Reading', text: 'Учень: Sophia\nResult' }, { env: { BOT_TOKEN: env.BOT_TOKEN, CHAT_ID: env.CHAT_ID } });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'sent');
  assert.equal(app.calls.length, 1);
  assert.match(app.calls[0].url, /api.telegram.org/);
  assert.equal(app.calls[0].body.text, 'Reading — Learner (@learner)\n\nУчень: Sophia\nResult');
  const failed = harness(null, { fetch: () => Response.json({ ok: false }) });
  assert.equal((await failed.call('/', { text: 'Result' })).status, 502);
});

test('routes and preflight never accidentally send a report', async () => {
  const app = harness();
  assert.equal((await app.call('/write/generate', {}, { method: 'OPTIONS' })).status, 204);
  assert.equal((await app.call('/write/generate', {}, { method: 'GET' })).status, 405);
  assert.equal((await app.call('/write/typo')).status, 404);
  assert.equal((await app.call('/', {}, { method: 'GET' })).status, 200);
  assert.equal(app.calls.length, 0);
});
