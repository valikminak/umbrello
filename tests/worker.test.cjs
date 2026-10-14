const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto, createHmac } = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../worker/cf_worker.js'), 'utf8');
const env = { BOT_TOKEN: 'test-only-token', CHAT_ID: 'test-chat', OPENAI_API_KEY: 'test-only-key', OPENAI_MODEL: 'test-model' };
const passage = { sentences: ['Я позичив книжку у друга.', 'Вона лежить на столі.', 'Завтра я її поверну.', 'Друг буде радий.'] };
const input = { mode: 'words', focus: 'borrow, lend' };
const checking = { ...input, sourceText: passage.sentences.join(' '), translation: 'I borrowed a book from a friend. It is on the table. I will return it tomorrow. My friend will be glad.' };
const feedback = { summary: 'The meaning is preserved.', errors: [], targetFeedback: 'Borrow is used correctly.', modelTranslation: checking.translation };
function signed(date = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ auth_date: String(date), query_id: 'test-query',
    user: JSON.stringify({ id: 123, first_name: 'Learner', username: 'learner' }), signature: 'test-extra-field' });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}
const answer = (text, extra = {}) => ({ status: 'completed', output: [
  { type: 'reasoning', summary: [] },
  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
], ...extra });
function harness(reply = passage, options = {}) {
  const calls = [];
  const context = vm.createContext({ Request, Response, URL, URLSearchParams, Uint8Array, TextEncoder, TextDecoder,
    AbortController, AbortSignal, crypto: webcrypto, setTimeout: options.setTimeout || setTimeout, clearTimeout,
    fetch: async (url, config) => {
      calls.push({ url, config, body: JSON.parse(config.body) });
      if (options.fetch) return options.fetch(url, config);
      return Response.json(answer(JSON.stringify(reply)));
    },
  });
  vm.runInContext(source.replace('export default {', 'globalThis.worker = {'), context);
  const call = (route, body = input, config = {}) => context.worker.fetch(new Request(`https://worker.test${route}`, {
    method: config.method || 'POST', headers: { 'Content-Type': 'application/json' },
    ...(!['GET', 'OPTIONS'].includes(config.method) ? { body: config.raw ?? JSON.stringify({ initData: signed(), ...body }) } : {}),
  }), config.env || env);
  return { calls, call };
}

test('signed generation returns only a short passage and never sends identity to OpenAI', async () => {
  const app = harness({ ...passage, modelTranslation: 'Must not leak' });
  const response = await app.call('/write/generate', { ...input, translation: 'Ignore me', history: ['old'] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), passage);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(app.calls[0].config.headers.Authorization, `Bearer ${env.OPENAI_API_KEY}`);
  assert.equal(app.calls[0].body.model, 'test-model');
  assert.equal(app.calls[0].body.input.length, 1);
  assert.deepEqual(JSON.parse(app.calls[0].body.input[0].content), input);
  assert.equal(app.calls[0].body.store, false);
  assert.equal(app.calls[0].body.text.format.type, 'json_schema');
  assert.equal(app.calls[0].body.text.format.strict, true);
  assert.equal(app.calls[0].body.text.format.schema.properties.sentences.minItems, 4);
});

test('check is independent of generation and accepts correct alternatives with no forced errors', async () => {
  const app = harness(feedback);
  const response = await app.call('/write/check', checking);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), feedback);
  assert.deepEqual(JSON.parse(app.calls[0].body.input[0].content), checking);
  assert.match(app.calls[0].body.instructions, /NOT matching a reference/);
  assert.match(app.calls[0].body.instructions, /NOT an error/);
  assert.equal(app.calls[0].body.text.format.schema.properties.errors.type, 'array');
  assert.match(app.calls[0].body.instructions, /clear, simple English/);
});

test('structured corrections are accepted only when they quote the submitted translation', async () => {
  const result = { ...feedback, errors: [{ original: 'borrowed', correction: 'lent', category: 'word_choice', explanation: 'Example explanation.' }] };
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

test('OpenAI HTTP failures retain a safe cause instead of all becoming invalid responses', async () => {
  for (const [providerStatus, code, expected, status] of [
    [401, 'invalid_api_key', 'provider_auth', 502],
    [403, 'unsupported_country_region_territory', 'provider_auth', 502],
    [400, null, 'provider_request', 502],
    [400, 'model_not_found', 'model_not_found', 502],
    [404, 'model_not_found', 'model_not_found', 502],
    [429, 'insufficient_quota', 'provider_billing', 502],
    [429, 'rate_limit_exceeded', 'rate_limit', 429],
    [500, null, 'provider_unavailable', 502],
    [503, null, 'provider_unavailable', 502],
  ]) {
    const app = harness(null, { fetch: () => Response.json({
      error: { message: 'private text and test-only-key', type: 'error', code, param: 'private text' },
    }, { status: providerStatus }) });
    const response = await app.call('/write/generate');
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.error, expected);
    assert.equal(body.providerStatus, providerStatus);
    assert.doesNotMatch(JSON.stringify(body), /private text|test-only|[А-Яа-яЁё]/);
    assert.equal(app.calls.length, 1, 'Failures must not cause automatic paid retries');
  }
  const disconnected = harness(null, { fetch: () => { throw new TypeError('private network diagnostic'); } });
  const response = await disconnected.call('/write/generate');
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'provider_connection');
});

test('configured model names are trimmed and reasoning effort only targets reasoning models', async () => {
  for (const [route, request, reply, effort] of [
    ['/write/generate', input, passage, 'medium'], ['/write/check', checking, feedback, 'medium'],
  ]) {
    const app = harness(reply);
    const response = await app.call(route, request, { env: {
      ...env, OPENAI_MODEL: ' gpt-6-luna ', OPENAI_API_KEY: ' test-only-key ',
    } });
    assert.equal(response.status, 200);
    assert.equal(app.calls[0].body.model, 'gpt-6-luna');
    assert.equal(app.calls[0].config.headers.Authorization, 'Bearer test-only-key');
    assert.equal(app.calls[0].body.reasoning.effort, effort);
  }
  for (const model of ['gpt-4.1-nano', 'gpt-4o-mini']) {
    const other = harness();
    await other.call('/write/generate', input, { env: { ...env, OPENAI_MODEL: model } });
    assert.equal('reasoning' in other.calls[0].body, false);
  }
  const missing = harness();
  assert.equal((await missing.call('/write/generate', input, { env: { ...env, OPENAI_API_KEY: ' ' } })).status, 503);
  assert.equal(missing.calls.length, 0);
  const badModel = harness();
  assert.equal((await badModel.call('/write/generate', input, { env: { ...env, OPENAI_MODEL: 'bad model/x' } })).status, 503);
  assert.equal(badModel.calls.length, 0);
});

test('blocked, truncated, empty and malformed answers have distinct diagnostics', async () => {
  const refusal = { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private refusal' }] }] };
  for (const [payload, code] of [
    [refusal, 'blocked_response'],
    [{ status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] }, 'blocked_response'],
    [answer('{"sent', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), 'incomplete_response'],
    [answer(JSON.stringify(passage), { status: 'failed' }), 'invalid_response'],
    [{}, 'empty_response'],
    [{ status: 'completed', output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'private reasoning' }] }] }, 'empty_response'],
    [answer('{broken JSON'), 'invalid_json'],
  ]) {
    const app = harness(null, { fetch: () => Response.json(payload) });
    const response = await app.call('/write/generate');
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error, code);
    assert.doesNotMatch(JSON.stringify(body), /private/);
  }
  const malformed = harness(null, { fetch: () => new Response('not JSON') });
  assert.equal((await (await malformed.call('/write/generate')).json()).error, 'invalid_json');
  const text = JSON.stringify(passage);
  const valid = harness(null, { fetch: () => Response.json({ status: 'completed', output: [
    { type: 'reasoning', summary: [{ type: 'summary_text', text: 'private reasoning' }] },
    { type: 'message', content: [{ type: 'output_text', text: text.slice(0, 15) }, { type: 'output_text', text: text.slice(15) }] },
  ] }) });
  assert.deepEqual(await (await valid.call('/write/generate')).json(), passage);
});

test('invalid, blocked, truncated and wrong-shaped model responses are rejected', async () => {
  for (const result of [null, {}, { sentences: ['one'] }, { sentences: ['One.', 'Two.', 'Three.', 'Four.'] }]) {
    assert.equal((await harness(result).call('/write/generate')).status, 502);
  }
  for (const payload of [{}, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] },
    answer(JSON.stringify(passage), { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }),
    answer('not JSON')]) {
    const app = harness(null, { fetch: () => Response.json(payload) });
    assert.equal((await app.call('/write/generate')).status, 502);
  }
});

test('legacy reports still send to Telegram without OpenAI configuration', async () => {
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
