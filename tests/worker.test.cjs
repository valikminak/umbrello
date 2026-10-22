const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto, createHmac } = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../worker/cf_worker.js'), 'utf8');
const env = { BOT_TOKEN: 'test-only-token', CHAT_ID: 'test-chat', ALLOWED_USER_IDS: '123', OPENAI_API_KEY: 'test-only-key', OPENAI_MODEL: 'test-model' };
const passage = { sentences: ['Я позичив книжку у друга.', 'Вона лежить на столі.', 'Завтра я її поверну.', 'Друг буде радий.'] };
const input = { mode: 'words', focus: 'borrow, lend' };
const checking = { ...input, sourceText: passage.sentences.join(' '), translation: 'I borrowed a book from a friend. It is on the table. I will return it tomorrow. My friend will be glad.' };
const feedback = { summary: 'The meaning is preserved.', errors: [], targetFeedback: 'Borrow is used correctly.', modelTranslation: checking.translation };
function signed(date = Math.floor(Date.now() / 1000), user = { id: 123, first_name: 'Learner', username: 'learner' }) {
  const params = new URLSearchParams({ auth_date: String(date), query_id: 'test-query',
    user: JSON.stringify(user), signature: 'test-extra-field' });
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
    Date: options.Date || Date,
    fetch: async (url, config) => {
      calls.push({ url, config, body: JSON.parse(config.body) });
      if (options.fetch) return options.fetch(url, config);
      return Response.json(answer(JSON.stringify(reply)));
    },
  });
  vm.runInContext(source.replace('export default {', 'globalThis.worker = {'), context);
  const call = (route, body = input, config = {}) => context.worker.fetch(new Request(`https://worker.test${route}`, {
    method: config.method || 'POST', headers: { 'Content-Type': 'application/json' },
    ...(!['GET', 'OPTIONS'].includes(config.method) ? { body: config.raw ?? JSON.stringify({ initData: signed(undefined, config.user), ...body }) } : {}),
  }), config.env || env);
  return { calls, call };
}
// A controllable Date for the Worker: isValid() still sees fresh launch data because the clock starts at real time.
function clock() {
  const state = { now: Date.now() };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [state.now])); }
    static now() { return state.now; }
  }
  return { state, Date: FakeDate, tick(ms) { state.now += ms; } };
}
const stranger = { env: { ...env, ALLOWED_USER_IDS: '999' } };
const telegramOk = () => Response.json({ ok: true, result: { message_id: 1 } });
const notice = async (app, config = stranger) => (await (await app.call('/access/check', {}, config)).json()).notificationSent;

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
    ['/write/generate', { ...input, level: 'Z9' }], ['/write/generate', { ...input, level: 'b1' }], ['/write/check', { ...checking, level: 7 }],
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
  assert.equal((await app.call('/write/generate', input, { env: { BOT_TOKEN: env.BOT_TOKEN, ALLOWED_USER_IDS: env.ALLOWED_USER_IDS } })).status, 503);
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
  const response = await app.call('/', { title: 'Reading', text: 'Учень: Sophia\nResult' }, { env: {
    BOT_TOKEN: env.BOT_TOKEN, CHAT_ID: env.CHAT_ID, ALLOWED_USER_IDS: env.ALLOWED_USER_IDS,
  } });
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

test('an account outside the allowlist is refused and the owner is told once who knocked', async () => {
  const app = harness(null, { fetch: telegramOk });
  const first = await app.call('/access/check', {}, stranger);
  assert.equal(first.status, 403);
  const body = await first.json();
  assert.equal(body.error, 'app_forbidden');
  assert.equal(body.userId, 123);
  assert.equal(body.notificationSent, true);
  assert.equal(app.calls.length, 1);
  assert.match(app.calls[0].url, /^https:\/\/api\.telegram\.org\/bot[^/]+\/sendMessage$/);
  assert.equal(app.calls[0].body.chat_id, env.CHAT_ID);
  assert.match(app.calls[0].body.text, /Имя: Learner\nUsername: @learner\nID: 123\n/);
  assert.equal(await notice(app), true, 'a repeat visit is reported as already notified');
  assert.equal(app.calls.length, 1, 'no second message within a day');
  assert.deepEqual(await (await app.call('/access/check')).json(), { allowed: true, userId: 123 });
  assert.equal(app.calls.length, 1, 'allowed accounts send nothing');
});

test('refused accounts never reach OpenAI or Supabase on any route', async () => {
  const app = harness(null, { fetch: telegramOk });
  const payload = { ...checking, title: 'Reading', text: 'Result', unit: 1, bookId: 'a'.repeat(64) };
  for (const [route, code] of [['/write/generate', 'app_forbidden'], ['/write/check', 'app_forbidden'], ['/', 'app_forbidden'],
    ['/grammar/unit', 'grammar_forbidden'], ['/grammar/check', 'grammar_forbidden'], ['/books/list', 'books_forbidden'], ['/books/book', 'books_forbidden']]) {
    const response = await app.call(route, payload, stranger);
    assert.equal(response.status, 403, route);
    assert.equal((await response.json()).error, code, route);
  }
  assert.equal(app.calls.length, 1);
  assert.match(app.calls[0].url, /api\.telegram\.org/);
});

test('after Telegram rejects a notice the Worker pauses all notices for five minutes', async () => {
  const time = clock();
  let telegram = () => Response.json({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }, { status: 400 });
  const app = harness(null, { Date: time.Date, fetch: (...args) => telegram(...args) });
  assert.equal(await notice(app), false);
  assert.equal(app.calls.length, 1);
  telegram = telegramOk;
  time.tick(60 * 1000);
  assert.equal(await notice(app), false, 'same account, one minute later');
  const other = { ...stranger, user: { id: 124, first_name: 'Other', username: 'other' } };
  assert.equal(await notice(app, other), false, 'another account during the pause');
  assert.equal(app.calls.length, 1, 'Telegram is left alone during the pause');
  time.tick(4 * 60 * 1000 + 1000);
  assert.equal(await notice(app, other), true, 'after the pause the next stranger is reported');
  assert.equal(app.calls.length, 2);
  assert.match(app.calls[1].body.text, /ID: 124\n/);
});

test('a Telegram rate limit extends the pause to its retry_after', async () => {
  const time = clock();
  let telegram = () => Response.json({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 900 } }, { status: 429 });
  const app = harness(null, { Date: time.Date, fetch: (...args) => telegram(...args) });
  assert.equal(await notice(app), false);
  telegram = telegramOk;
  time.tick(6 * 60 * 1000);
  assert.equal(await notice(app), false, 'still paused after the default five minutes');
  assert.equal(app.calls.length, 1);
  time.tick(10 * 60 * 1000);
  assert.equal(await notice(app), true);
  assert.equal(app.calls.length, 2);
});

test('a network failure while notifying also pauses, and the pause never grants access', async () => {
  const time = clock();
  let telegram = () => { throw new TypeError('fetch failed'); };
  const app = harness(null, { Date: time.Date, fetch: (...args) => telegram(...args) });
  const first = await app.call('/access/check', {}, stranger);
  assert.equal(first.status, 403);
  assert.equal((await first.json()).notificationSent, false);
  telegram = telegramOk;
  const second = await app.call('/write/generate', input, stranger);
  assert.equal(second.status, 403);
  assert.equal(app.calls.length, 1);
  time.tick(5 * 60 * 1000 + 1000);
  assert.equal(await notice(app), true);
  assert.equal(app.calls.length, 2);
});

test('a valid profile level reaches the model with both Write requests', async () => {
  const app = harness();
  assert.equal((await app.call('/write/generate', { ...input, level: 'A2' })).status, 200);
  assert.deepEqual(JSON.parse(app.calls[0].body.input[0].content), { ...input, level: 'A2' });
  const review = harness(feedback);
  assert.equal((await review.call('/write/check', { ...checking, level: 'C1' })).status, 200);
  assert.equal(JSON.parse(review.calls[0].body.input[0].content).level, 'C1');
  const none = harness();
  await none.call('/write/generate', { ...input, level: null });
  assert.equal('level' in JSON.parse(none.calls[0].body.input[0].content), false);
});
