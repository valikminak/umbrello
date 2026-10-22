const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHmac } = require('node:crypto');
const { validateUnit } = require('../assets/js/grammar-core.js');
const source = fs.readFileSync(path.join(__dirname, '../worker/cf_worker.js'), 'utf8');
const env = {
  BOT_TOKEN: 'test-bot-token', ALLOWED_USER_IDS: '123, 456', SUPABASE_BUCKET: 'Umbrello',
  SUPABASE_URL: 'https://testproject.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test-key',
  OPENAI_API_KEY: 'test-openai-key', OPENAI_MODEL: 'test-model',
};
const unit = () => ({
  schemaVersion: 1, id: 'unit-001', number: 1, title: 'Present forms', focus: 'States and activities',
  objectives: ['Choose a form that expresses the meaning.'],
  theory: [{ title: 'States', paragraphs: ['Use a simple form for many states.'], examples: [{ text: 'I know.', note: '' }] }],
  practice: [{ id: 'exercise-1', title: 'Complete', instruction: 'Fill in the gap.', wordBank: ['use'],
    examples: [{ text: 'I am working.', audio: 'unit-001/audio/11e1.mp3' }],
    questions: [{ id: 'u1-e1-q1', type: 'gap', prompt: 'We ____ a new room this week.', answers: ['are using'],
      modelAnswer: 'We are using a new room this week.', explanation: 'This describes an activity.', audio: 'unit-001/audio/111.mp3' }] }],
  listening: { instruction: 'Listen and complete the sentence.', questionIds: ['u1-e1-q1'] },
  writing: { prompt: 'Describe a temporary change in your routine.', checklist: ['Use both present forms.'], minWords: 60, maxWords: 120 },
  review: [{ id: 'u1-review-1', type: 'choice', prompt: 'Choose the correct form.', modelAnswer: 'I know.', explanation: 'Know describes a state.',
    options: [{ id: 'a', text: 'I know.', correct: true }, { id: 'b', text: 'I am knowing.', correct: false }] }],
});
const learnerText = 'I prefer quiet rooms. This week I am working in the library.';
const feedback = { summary: 'Your writing is clear.', errors: [], targetFeedback: 'Both present forms express your meaning.', improvedVersion: learnerText };
function signed(user = { id: 123 }, date = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ auth_date: String(date), query_id: 'test-query' });
  if (user !== undefined) params.set('user', typeof user === 'string' ? user : JSON.stringify(user));
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}
const ai = result => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] });
function harness(options = {}) {
  const calls = [];
  const context = vm.createContext({ Request, Response, URL, URLSearchParams, Uint8Array, TextEncoder, TextDecoder,
    AbortController, AbortSignal, crypto: webcrypto, setTimeout: options.setTimeout || setTimeout, clearTimeout,
    fetch: async (url, config) => {
      calls.push({ url, config, body: config.body ? JSON.parse(config.body) : undefined });
      if (options.fetch) return options.fetch(url, config);
      if (url.endsWith('.json')) return Response.json(options.unit || unit());
      if (url.endsWith('.mp3')) return new Response(new Uint8Array([73, 68, 51, 4]), { headers: { 'Content-Type': 'audio/mpeg' } });
      return ai(options.feedback || feedback);
    },
  });
  vm.runInContext(source.replace('export default {', 'globalThis.worker = {'), context);
  const call = (route, body = { unitId: 'unit-001' }, config = {}) => context.worker.fetch(new Request(`https://worker.test${route}`, {
    method: config.method || 'POST', headers: { 'Content-Type': 'application/json' },
    ...(!['GET', 'OPTIONS'].includes(config.method) ? { body: JSON.stringify({ initData: signed(), ...body }) } : {}),
  }), { ...env, ...config.env });
  return { calls, call };
}
const routes = ['/grammar/unit', '/grammar/audio', '/grammar/check'];

test('all Grammar routes require an untampered, current Telegram signature before storage or AI', async () => {
  for (const route of routes) {
    for (const initData of ['', 'hash=bad', signed().replace('123', '456'), signed({}, 1), signed({}, Math.floor(Date.now() / 1000) + 120), signed() + '&user={}']) {
      const app = harness();
      const response = await app.call(route, { initData, unitId: 'unit-001', path: 'unit-001/audio/111.mp3', text: learnerText });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error, 'unauthorized');
      assert.equal(app.calls.length, 0);
    }
  }
});

test('Grammar allowlist fails closed when absent or malformed and never grants access through query parameters', async () => {
  for (const route of routes) {
    for (const value of [undefined, '', ' ', '123,', '123,me', '*', '0123', '9999999999999999']) {
      const app = harness();
      const response = await app.call(route + '?user=me', {}, { env: { ALLOWED_USER_IDS: value } });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, 'grammar_not_configured');
      assert.equal(app.calls.length, 0);
    }
    for (const user of [{ id: 789 }, {}, null, '{invalid', { id: '123' }, { id: 123.1 }]) {
      const app = harness();
      const response = await app.call(route + '?user=me', { initData: signed(user) });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error, 'grammar_forbidden');
      assert.equal(app.calls.length, 0);
    }
  }
});

test('allowed users receive a validated unit through private Storage without credentials or AI output', async () => {
  for (const userId of [123, 456]) {
    const raw = unit(); raw.secretExtra = 'not returned';
    const app = harness({ unit: raw });
    const response = await app.call('/grammar/unit', { unitId: 'unit-001', initData: signed({ id: userId }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result, unit());
    assert.deepEqual(validateUnit(result), result, 'server output must match the browser contract');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(app.calls.length, 1);
    const call = app.calls[0];
    assert.equal(call.url, 'https://testproject.supabase.co/storage/v1/object/authenticated/Umbrello/unit-001.json');
    assert.equal(call.config.method, 'GET');
    assert.equal(call.config.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal('Authorization' in call.config.headers, false, 'opaque keys must not be used as JWTs');
    assert.equal(call.config.redirect, 'manual', 'Workers reject redirect: "error" before sending the request');
    assert.equal(call.config.cache, 'no-store');
    assert.equal(call.body, undefined);
    assert.doesNotMatch(call.url, /initData|hash|secret|token|\?/);
  }
});

test('existing mixed-case bucket names are preserved in private Storage URLs', async () => {
  const app = harness();
  assert.equal((await app.call('/grammar/unit', undefined, { env: { SUPABASE_BUCKET: 'Umbrello' } })).status, 200);
  assert.equal(app.calls[0].url, 'https://testproject.supabase.co/storage/v1/object/authenticated/Umbrello/unit-001.json');
});

test('legacy service-role JWTs use apikey and Bearer headers, never browser credentials', async () => {
  const app = harness();
  const response = await app.call('/grammar/unit', undefined, { env: { SUPABASE_SERVICE_ROLE_KEY: 'eyJheader.eyJpayload.signature', SUPABASE_BUCKET: 'personal-grammar' } });
  assert.equal(response.status, 200);
  assert.equal(app.calls[0].config.headers.Authorization, 'Bearer eyJheader.eyJpayload.signature');
  assert.equal(app.calls[0].config.headers.apikey, 'eyJheader.eyJpayload.signature');
  assert.match(app.calls[0].url, /\/personal-grammar\/unit-001\.json$/);
});

test('invalid Storage configuration cannot make outbound requests to arbitrary hosts', async () => {
  for (const change of [
    { SUPABASE_URL: 'http://testproject.supabase.co' }, { SUPABASE_URL: 'https://evil.test' },
    { SUPABASE_URL: 'https://testproject.supabase.co.evil.test' }, { SUPABASE_URL: 'https://user:pass@testproject.supabase.co' },
    { SUPABASE_URL: 'https://testproject.supabase.co/path' }, { SUPABASE_URL: 'https://testproject.supabase.co?key=x' },
    { SUPABASE_SERVICE_ROLE_KEY: '' }, { SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_test' }, { SUPABASE_BUCKET: '../other' },
    { SUPABASE_BUCKET: undefined }, { SUPABASE_BUCKET: '' },
  ]) {
    const app = harness();
    assert.equal((await app.call('/grammar/unit', undefined, { env: change })).status, 503);
    assert.equal(app.calls.length, 0);
  }
});

test('unit ids, audio traversal, arbitrary URLs and malformed writing are rejected before storage', async () => {
  for (const body of [{}, { unitId: '../unit-001' }, { unitId: 'unit-002' }, { unitId: 'unit-001.json' }]) {
    const app = harness(); assert.equal((await app.call('/grammar/unit', body)).status, 400); assert.equal(app.calls.length, 0);
  }
  for (const path of ['', '../unit-001.json', 'unit-001/audio/../111.mp3', 'unit-001/audio/%2e%2e.mp3', 'unit-002/audio/111.mp3',
    '/unit-001/audio/111.mp3', 'https://evil.test/111.mp3', 'unit-001/audio/111.mp3?token=x', 'unit-001/audio/111.mp3#x',
    'unit-001/audio/sub/111.mp3', 'unit-001/audio/111\\x.mp3', 'unit-001/audio/.hidden.mp3', 'unit-001/audio/111.wav']) {
    const app = harness(); assert.equal((await app.call('/grammar/audio', { path })).status, 400); assert.equal(app.calls.length, 0);
  }
  for (const text of [undefined, '', ' ', 'x'.repeat(6001)]) {
    const app = harness(); assert.equal((await app.call('/grammar/check', { unitId: 'unit-001', text })).status, 400); assert.equal(app.calls.length, 0);
  }
});

test('audio is limited to references in the trusted unit and served without public or signed URLs', async () => {
  for (const path of ['unit-001/audio/111.mp3', 'unit-001/audio/11e1.mp3']) {
    const app = harness(); const response = await app.call('/grammar/audio', { path });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/mpeg');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [73, 68, 51, 4]);
    assert.equal(app.calls.length, 2);
    assert.equal(app.calls[1].url, `https://testproject.supabase.co/storage/v1/object/authenticated/Umbrello/${path}`);
  }
  const app = harness(); const response = await app.call('/grammar/audio', { path: 'unit-001/audio/999.mp3' });
  assert.equal(response.status, 404);
  assert.equal(app.calls.length, 1, 'unknown audio must never be fetched');
});

test('Grammar check uses the trusted task, original writing instructions and no learner identity or history', async () => {
  const app = harness();
  const response = await app.call('/grammar/check', { unitId: 'unit-001', text: learnerText,
    task: 'untrusted task', focus: 'untrusted focus', history: ['old writing'], model: 'different-model' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), feedback);
  assert.equal(app.calls.length, 2);
  const call = app.calls[1];
  assert.equal(call.url, 'https://api.openai.com/v1/responses');
  assert.deepEqual(JSON.parse(call.body.input[0].content), { focus: unit().focus, task: unit().writing.prompt, text: learnerText });
  assert.match(call.body.instructions, /original English writing/);
  assert.match(call.body.instructions, /NOT errors/);
  assert.match(call.body.instructions, /errors: \[\]/);
  assert.doesNotMatch(call.body.instructions, /Ukrainian|translation/);
  assert.equal(call.body.store, false);
  assert.equal(call.body.model, env.OPENAI_MODEL);
  assert.equal(call.body.text.format.name, 'grammar_writing_review');
  assert.equal(call.body.text.format.strict, true);
  assert.deepEqual(call.body.text.format.schema.required, ['summary', 'errors', 'targetFeedback', 'improvedVersion']);
});

test('Grammar feedback rejects invented quotes or translation results and does not retry paid calls', async () => {
  for (const badFeedback of [
    { ...feedback, errors: [{ original: 'never written', correction: 'fixed', category: 'tense', explanation: 'Fix it.' }] },
    { ...feedback, errors: [{ original: '', correction: 'added', category: 'other', explanation: 'Add it.' }] },
    { ...feedback, errors: [{ original: 'prefer', correction: 'like', category: 'style', explanation: 'Preference.' }] },
    { ...feedback, improvedVersion: undefined, modelTranslation: learnerText },
  ]) {
    const app = harness({ feedback: badFeedback });
    assert.equal((await app.call('/grammar/check', { unitId: 'unit-001', text: learnerText })).status, 502);
    assert.equal(app.calls.length, 2);
  }
  const valid = { ...feedback, errors: [{ original: 'prefer', correction: 'preferred', category: 'tense', explanation: 'Synthetic test correction.' }] };
  assert.equal((await harness({ feedback: valid }).call('/grammar/check', { unitId: 'unit-001', text: learnerText })).status, 200);
});

test('malformed trusted units stop both audio and AI requests', async () => {
  for (const mutate of [
    u => { u.id = 'unit-002'; }, u => { u.writing = null; }, u => { u.writing.prompt = ''; },
    u => { u.practice[0].questions[0].audio = 'https://evil.test/111.mp3'; },
    u => { u.review[0].id = 'u1-e1-q1'; }, u => { u.listening.questionIds = ['missing']; },
    u => { u.practice[0].questions[0].answers = []; }, u => { u.review[0].options.forEach(o => { o.correct = false; }); },
  ]) {
    const invalid = unit(); mutate(invalid);
    const app = harness({ unit: invalid });
    const response = await app.call('/grammar/check', { unitId: 'unit-001', text: learnerText });
    assert.equal(response.status, 502); assert.equal((await response.json()).error, 'grammar_content_invalid');
    assert.equal(app.calls.length, 1);
  }
});

test('private Storage failures and redirects return safe errors without upstream diagnostics', async () => {
  for (const [status, expected] of [[401, 502], [403, 502], [404, 404], [429, 502], [500, 502], [302, 502]]) {
    const app = harness({ fetch: () => new Response('private upstream text sb_secret_test-key', { status, headers: { Location: 'https://evil.test' } }) });
    const response = await app.call('/grammar/unit');
    assert.equal(response.status, expected);
    assert.doesNotMatch(await response.text(), /private upstream|sb_secret|evil\.test/);
    assert.equal(app.calls.length, 1);
  }
  const missing = harness({ fetch: () => Response.json({ statusCode: '404', message: 'private object detail' }, { status: 400 }) });
  assert.equal((await missing.call('/grammar/unit')).status, 404);
  const offline = harness({ fetch: () => { throw new Error('private network details'); } });
  assert.equal((await offline.call('/grammar/unit')).status, 502);
  const timeout = harness({ setTimeout: callback => setTimeout(callback, 1), fetch: (_, config) => new Promise((resolve, reject) => {
    config.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }) });
  const response = await timeout.call('/grammar/unit');
  assert.equal(response.status, 504); assert.equal((await response.json()).error, 'grammar_storage_timeout');
});

test('Storage JSON and audio are size bounded even without Content-Length', async () => {
  for (const announce of [false, true]) {
    const oversized = harness({ fetch: () => new Response('x'.repeat(256 * 1024 + 1), {
      headers: { 'Content-Type': 'application/json', ...(announce ? { 'Content-Length': String(256 * 1024 + 1) } : {}) },
    }) });
    assert.equal((await oversized.call('/grammar/unit')).status, 502);
    const audio = harness({ fetch: url => url.endsWith('.json') ? Response.json(unit()) : new Response(new Uint8Array(2 * 1024 * 1024 + 1), {
      headers: { 'Content-Type': 'audio/mpeg', ...(announce ? { 'Content-Length': String(2 * 1024 * 1024 + 1) } : {}) },
    }) });
    assert.equal((await audio.call('/grammar/audio', { path: 'unit-001/audio/111.mp3' })).status, 502);
  }
  const html = harness({ fetch: () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }) });
  assert.equal((await html.call('/grammar/unit')).status, 502);
  const broken = harness({ fetch: () => new Response('{', { headers: { 'Content-Type': 'application/json' } }) });
  assert.equal((await (await broken.call('/grammar/unit')).json()).error, 'grammar_content_invalid');
});

test('Grammar routes are POST-only and preflight never accesses providers', async () => {
  const app = harness();
  for (const route of routes) {
    assert.equal((await app.call(route, {}, { method: 'GET' })).status, 405);
    assert.equal((await app.call(route, {}, { method: 'OPTIONS' })).status, 204);
  }
  assert.equal(app.calls.length, 0);
});

test('unit content is validated independently of its upload MIME metadata', async () => {
  for (const mime of ['text/plain; charset=utf-8', 'application/octet-stream', 'application/json', 'text/json']) {
    const app = harness({ fetch: () => new Response(JSON.stringify(unit()), { headers: { 'Content-Type': mime } }) });
    const response = await app.call('/grammar/unit');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), unit());
  }
  for (const content of ['<html>login</html>', '{}', 'not JSON']) {
    const app = harness({ fetch: () => new Response(content, { headers: { 'Content-Type': 'text/plain' } }) });
    assert.equal((await (await app.call('/grammar/unit')).json()).error, 'grammar_content_invalid');
  }
});

test('storage failures distinguish runtime, network, HTTP, size and audio metadata without raw details', async () => {
  for (const [message, code] of [
    ["The 'cache' field on 'RequestInitializerDict' is not implemented.", 'grammar_runtime_cache'],
    ['Unsupported cache mode: no-store', 'grammar_runtime_cache'],
    ['private DNS detail with sb_secret_test-key', 'grammar_storage_network'],
  ]) {
    const app = harness({ fetch: () => { throw new TypeError(message); } });
    const response = await app.call('/grammar/unit');
    const body = await response.json();
    assert.equal(body.error, code);
    assert.doesNotMatch(JSON.stringify(body), /private DNS|sb_secret_test/);
    assert.equal(app.calls.length, 1);
  }
  for (const [diagnostic, code] of [
    [{ code: 'InvalidJWT' }, 'grammar_storage_auth'],
    [{ error: 'unauthorized' }, 'grammar_storage_auth'],
    [{ statusCode: '403' }, 'grammar_storage_auth'],
    [{ code: 'NoSuchBucket' }, 'grammar_not_found'],
    [{ code: 'NoSuchKey' }, 'grammar_not_found'],
    [{ message: 'private provider diagnostic' }, 'grammar_storage_error'],
  ]) {
    const app = harness({ fetch: () => Response.json(diagnostic, { status: 400 }) });
    const body = await (await app.call('/grammar/unit')).json();
    assert.equal(body.error, code);
    if (code !== 'grammar_not_found') assert.equal(body.providerStatus, 400);
    assert.doesNotMatch(JSON.stringify(body), /private provider/);
  }
  const redirected = harness({ fetch: () => new Response(null, { status: 302, headers: { Location: 'https://elsewhere.example/unit-001.json' } }) });
  const redirectBody = await (await redirected.call('/grammar/unit')).json();
  assert.equal(redirectBody.error, 'grammar_storage_error');
  assert.equal(redirectBody.providerStatus, 302);
  assert.equal(redirected.calls.length, 1, 'redirects are never followed');
  const oversized = harness({ fetch: () => new Response('x'.repeat(256 * 1024 + 1)) });
  assert.equal((await (await oversized.call('/grammar/unit')).json()).error, 'grammar_storage_size');
  const audio = harness({ fetch: url => url.endsWith('.json') ? Response.json(unit()) : new Response('bad recording', { headers: { 'Content-Type': 'text/html' } }) });
  assert.equal((await (await audio.call('/grammar/audio', { path: 'unit-001/audio/111.mp3' })).json()).error, 'grammar_audio_type');
});
