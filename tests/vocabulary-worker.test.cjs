const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHmac } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../worker/cf_worker.js'), 'utf8');
const env = { BOT_TOKEN: 'test-only-token', CHAT_ID: 'test-chat', ALLOWED_USER_IDS: '123', OPENAI_API_KEY: 'test-only-key', OPENAI_MODEL: 'test-model' };

const phrases = ['a4', 'b4', 'c2', 'c7', 'c8', 'c9', 'a7'].map(id => ({ id, phrase: `phrase ${id}`, pattern: `pattern ${id}`, meaning: `meaning ${id}` }));
const request = { unit: 'Everyday minor problems', topic: 'a Monday morning', phrases };
const story = {
  title: 'A Monday to forget',
  uk: 'Сіли батарейки.\n\nЯ спіткнувся об сумку і пролив каву. Машина не заводилася.',
  en: 'The batteries [[had run out|a4]].\n\nI [[tripped|b4]] over my bag and [[spilt|c2]] coffee. The car [[wouldn\'t start|c8]]: the battery was [[flat|c9]].',
};

function signed(user = { id: 123, first_name: 'Learner' }) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'test-query', user: JSON.stringify(user) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}
const answer = text => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });

function harness(reply = story) {
  const calls = [];
  const context = vm.createContext({ Request, Response, URL, URLSearchParams, Uint8Array, TextEncoder, TextDecoder,
    AbortController, AbortSignal, crypto: webcrypto, setTimeout, clearTimeout, Date, console: { warn() {} },
    fetch: async (url, config) => {
      calls.push({ url, body: JSON.parse(config.body) });
      if (String(url).startsWith('https://api.telegram.org/')) return Response.json({ ok: true, result: {} });
      return Response.json(answer(typeof reply === 'string' ? reply : JSON.stringify(reply)));
    },
  });
  vm.runInContext(source.replace('export default {', 'globalThis.worker = {'), context);
  const call = (body = request, config = {}) => context.worker.fetch(new Request('https://worker.test/vocabulary/story', {
    method: config.method || 'POST', headers: { 'Content-Type': 'application/json' },
    ...(config.method === 'GET' ? {} : { body: JSON.stringify({ initData: config.initData ?? signed(config.user), ...body }) }),
  }), config.env || env, { waitUntil() {} });
  return { calls, call };
}

test('a signed story request returns the Ukrainian text and the marked English story, and sends only exercise data to OpenAI', async () => {
  const app = harness();
  const response = await app.call();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), story);
  assert.equal(app.calls.length, 1);
  const sent = app.calls[0].body;
  assert.equal(app.calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(sent.store, false);
  assert.equal(sent.text.format.name, 'vocabulary_story');
  assert.equal(sent.text.format.strict, true);
  assert.deepEqual(sent.text.format.schema.required, ['title', 'uk', 'en']);
  assert.deepEqual(JSON.parse(sent.input[0].content), request);
  assert.doesNotMatch(sent.input[0].content, /initData|Learner|123/);
  assert.match(sent.instructions, /\[\[exact words used\|id\]\]/);
});

test('malformed story requests are refused before calling the model', async () => {
  for (const body of [
    { ...request, topic: '' },
    { ...request, unit: 'x'.repeat(121) },
    { ...request, phrases: phrases.slice(0, 4) },
    { ...request, phrases: [...phrases, phrases[0]] },
    { ...request, phrases: phrases.map((p, i) => (i ? p : { ...p, id: 'A-1' })) },
    { ...request, phrases: phrases.map((p, i) => (i ? p : { ...p, meaning: '' })) },
    { unit: request.unit, topic: request.topic },
  ]) {
    const app = harness();
    const response = await app.call(body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal((await response.json()).error, 'invalid_input');
    assert.equal(app.calls.length, 0);
  }
});

test('marks with unknown ids become plain words; too few phrases, English in uk or broken marks are invalid', async () => {
  const extra = { ...story, en: story.en.replace('coffee', '[[coffee|zz9]]') };
  const ok = await (await harness(extra).call()).json();
  assert.equal(ok.en, story.en, 'the unknown mark is dropped, the word stays');
  for (const reply of [
    { ...story, en: 'The batteries [[had run out|a4]]. I [[tripped|b4]] over my bag. Nothing else.' },
    { ...story, en: story.en.replace('[[flat|c9]]', '[[flat|zz]]').replace('[[spilt|c2]]', 'spilt') },
    { ...story, uk: 'The batteries ran out.' },
    { ...story, uk: story.uk + ' [[сіли|a4]]' },
    { ...story, en: story.en + ' Then [[it broke.' },
    { ...story, title: '' },
    'not json',
  ]) {
    const response = await harness(reply).call();
    assert.equal(response.status, 502, JSON.stringify(reply).slice(0, 80));
    assert.match((await response.json()).error, /^(invalid_response|invalid_json)$/);
  }
});

test('the story route needs a signed launch from an allowed account and only accepts POST', async () => {
  const app = harness();
  assert.equal((await app.call(request, { initData: 'user=%7B%7D&hash=00' })).status, 403);
  const stranger = await app.call(request, { env: { ...env, ALLOWED_USER_IDS: '999' } });
  assert.equal(stranger.status, 403);
  assert.equal((await stranger.json()).error, 'app_forbidden');
  assert.equal((await app.call(request, { method: 'GET' })).status, 405);
  assert.equal(app.calls.filter(call => call.url === 'https://api.openai.com/v1/responses').length, 0);
});

test('without the OpenAI settings the story route explains what to configure', async () => {
  const response = await harness().call(request, { env: { ...env, OPENAI_MODEL: '' } });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, 'not_configured');
  assert.match(body.message, /Vocabulary is not configured/);
});
