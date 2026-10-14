const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/js/write.js'), 'utf8');
const passage = { sentences: ['Учора я позичив книжку.', 'Я вже прочитав її.', 'Завтра поверну її другу.', 'Він буде радий.'] };
const feedback = { summary: 'Good translation.', errors: [], targetFeedback: 'You used the requested construction.', modelTranslation: 'I borrowed a book yesterday. I have already read it. I will return it to my friend tomorrow.' };
async function page({ authenticated = true } = {}) {
  const nodes = new Map(), calls = [], responses = [];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', hidden: ['exercise', 'feedback', 'writeContent'].includes(id), disabled: false, innerHTML: '', textContent: '',
      reset() {}, focus() {}, setAttribute() {}, replaceChildren() { this.innerHTML = ''; },
      querySelector() { return node('mode'); },
    });
    return nodes.get(id);
  }
  node('mode').value = 'words';
  const forbiddenStorage = new Proxy({}, { get() { throw new Error('Write must not use storage'); } });
  const context = vm.createContext({
    document: { getElementById: node }, URL, AbortController, setTimeout, clearTimeout,
    Profiles: { require: async () => ({ id: 'me' }), url: page => `${page}?user=me` }, backTo() {},
    tg: authenticated ? { initData: 'test-init-data' } : null, WORKER_URL: 'https://worker.test/',
    localStorage: forbiddenStorage, sessionStorage: forbiddenStorage,
    esc: value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    fetch: async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(options.body) });
      if (!responses.length) throw new Error('Unexpected network call');
      const next = responses.shift();
      return typeof next === 'function' ? next() : next;
    },
  });
  await vm.runInContext(source, context);
  const submit = id => node(id).onsubmit({ preventDefault() {} });
  const generate = async () => {
    node('focus').value = 'borrow and lend'; responses.push(Response.json(passage)); await submit('generateForm');
  };
  return { node, calls, responses, submit, generate };
}

test('Write starts blank, uses no persistent storage, and requires Telegram before calling Worker', async () => {
  const app = await page({ authenticated: false });
  assert.equal(app.node('exercise').hidden, true);
  assert.equal(app.node('feedback').hidden, true);
  app.node('focus').value = 'articles';
  await app.submit('generateForm');
  assert.equal(app.calls.length, 0);
  assert.match(app.node('writeStatus').textContent, /Telegram/);
  assert.equal(app.node('generate').disabled, false);
});

test('generate then check sends the full original exercise, hides the sample, and escapes model text', async () => {
  const app = await page();
  await app.generate();
  assert.equal(app.node('sourceText').textContent, passage.sentences.join(' '));
  assert.equal(app.node('exercise').hidden, false);
  assert.equal(app.node('feedback').hidden, true);
  assert.equal(app.node('translation').value, '');
  app.node('focus').value = 'a new topic for the NEXT generation';
  app.node('mode').value = 'grammar';
  app.node('translation').value = 'My own answer';
  app.responses.push(Response.json({ ...feedback, summary: '<img src=x onerror=alert(1)>', errors: [
    { category: 'tense', original: '<script>', correction: 'fixed', explanation: '<b>plain text</b>' },
  ] }));
  await app.submit('checkForm');
  assert.deepEqual(app.calls[1].body, { initData: 'test-init-data', mode: 'words', focus: 'borrow and lend', sourceText: passage.sentences.join(' '), translation: 'My own answer' });
  assert.equal(app.node('feedback').hidden, false);
  assert.match(app.node('feedback').innerHTML, /&lt;img/);
  assert.doesNotMatch(app.node('feedback').innerHTML, /<img|<script|<details[^>]*\bopen\b/);
  assert.match(app.node('feedback').innerHTML, /Show one possible translation/);
  app.node('translation').oninput();
  assert.equal(app.node('feedback').hidden, true);
  assert.equal(app.node('feedback').innerHTML, '');
});

test('correct alternative translations display no errors and may be checked again independently', async () => {
  const app = await page(); await app.generate();
  for (const answer of ['I have already read it.', "I've already read it."]) {
    app.node('translation').value = answer;
    app.responses.push(Response.json(feedback));
    await app.submit('checkForm');
    assert.match(app.node('feedback').innerHTML, /No errors found/);
    assert.equal(app.node('translation').value, answer);
    assert.equal('history' in app.calls.at(-1).body, false);
  }
});

test('failed checking or regeneration preserves the passage and the learner answer', async () => {
  const app = await page(); await app.generate();
  app.node('translation').value = 'Keep this draft';
  for (const form of ['checkForm', 'generateForm']) {
    app.responses.push(new Response('', { status: 429 }));
    await app.submit(form);
    assert.match(app.node('writeStatus').textContent, /limit/);
    assert.equal(app.node('translation').value, 'Keep this draft');
    assert.equal(app.node('sourceText').textContent, passage.sentences.join(' '));
    assert.equal(app.node('check').disabled, false);
  }
  app.responses.push(new Response('sent'));
  await app.submit('checkForm');
  assert.match(app.node('writeStatus').textContent, /Worker/);
  assert.equal(app.node('translation').value, 'Keep this draft');
});

test('a 502 reports the known model failure and provider status instead of blaming the model response', async () => {
  const app = await page(); await app.generate();
  app.node('translation').value = 'Keep my translation';
  for (const [error, providerStatus, expected] of [
    ['provider_auth', 403, /provider rejected access/],
    ['model_not_found', 404, /configured model is unavailable/],
    ['incomplete_response', 200, /response was cut short/],
    ['provider_request', 400, /could not accept this request/],
  ]) {
    app.responses.push(Response.json({ error, providerStatus, message: 'Private provider details must stay hidden.' }, { status: 502 }));
    await app.submit('checkForm');
    const status = app.node('writeStatus').textContent;
    assert.match(status, expected);
    assert.ok(status.endsWith(`[${error}; HTTP ${providerStatus}]`));
    assert.doesNotMatch(status, /Private provider details|[\u0400-\u04ff]/);
    assert.equal(app.node('translation').value, 'Keep my translation');
    assert.equal(app.node('sourceText').textContent, passage.sentences.join(' '));
    assert.equal(app.node('check').disabled, false);
  }
  app.responses.push(Response.json(feedback));
  await app.submit('checkForm');
  assert.equal(app.node('writeStatus').textContent, '');
  assert.equal(app.node('feedback').hidden, false);
});

test('unknown or malformed error payloads use the safe HTTP fallback without exposing server text', async () => {
  const app = await page();
  app.node('focus').value = 'articles';
  for (const body of [
    { error: '<img src=x onerror=alert(1)>', message: 'Secret server details', providerStatus: 401 },
    { error: 'toString', message: 'Secret server details' },
    { error: ['provider_auth'], message: 'Secret server details' },
    { message: 'Secret server details' }, null, ['provider_auth'], 'Secret server details',
  ]) {
    app.responses.push(Response.json(body, { status: 502 }));
    await app.submit('generateForm');
    assert.equal(app.node('writeStatus').textContent, 'The model request failed. Please try again. [HTTP 502]');
    assert.equal(app.node('generate').disabled, false);
  }
});

test('legacy plain-text errors stay readable and malformed provider statuses are omitted', async () => {
  const app = await page();
  app.node('focus').value = 'articles';
  app.responses.push(new Response('<html>Private server error</html>', { status: 503 }));
  await app.submit('generateForm');
  assert.equal(app.node('writeStatus').textContent, 'Write is temporarily unavailable. Please try again later. [HTTP 503]');
  for (const providerStatus of ['403', '<script>', null, 99, 600, 403.5]) {
    app.responses.push(Response.json({ error: 'provider_auth', providerStatus }, { status: 502 }));
    await app.submit('generateForm');
    assert.ok(app.node('writeStatus').textContent.endsWith('[provider_auth]'));
    assert.doesNotMatch(app.node('writeStatus').textContent, /HTTP|<script>/);
  }
});

test('local validation and feedback labels are English while the source exercise stays Ukrainian', async () => {
  const app = await page();
  await app.submit('generateForm');
  assert.equal(app.node('writeStatus').textContent, 'Enter what you would like to practise.');
  await app.generate();
  await app.submit('checkForm');
  assert.equal(app.node('writeStatus').textContent, 'Write your translation first.');
  app.node('translation').value = 'My translation';
  const categories = ['article', 'tense', 'preposition', 'word_order', 'word_choice', 'agreement', 'spelling', 'meaning', 'other'];
  app.responses.push(Response.json({ ...feedback, errors: categories.map(category => ({
    category, original: '', correction: '', explanation: 'Check this part of your translation.',
  })) }));
  await app.submit('checkForm');
  assert.match(app.node('feedback').innerHTML, /Missing text/);
  assert.match(app.node('feedback').innerHTML, /Remove this text/);
  assert.match(app.node('feedback').innerHTML, /Word order/);
  assert.doesNotMatch(app.node('feedback').innerHTML, /[\u0400-\u04ff]/);
  assert.equal(app.node('sourceText').textContent, passage.sentences.join(' '));
  app.responses.push(Response.json({ sentences: ['Too short'] }));
  await app.submit('generateForm');
  assert.equal(app.node('writeStatus').textContent, 'Could not get an exercise. Please try again.');
  app.responses.push(Response.json({ summary: 'Missing fields' }));
  await app.submit('checkForm');
  assert.equal(app.node('writeStatus').textContent, 'Could not get feedback. Please try again.');
});

test('a pending request prevents double submission and locks fields until completion', async () => {
  const app = await page();
  app.node('focus').value = 'articles';
  let finish;
  app.responses.push(() => new Promise(resolve => { finish = resolve; }));
  const pending = app.submit('generateForm');
  await app.submit('generateForm');
  assert.equal(app.calls.length, 1);
  for (const id of ['modeFields', 'focus', 'generate', 'translation', 'check']) assert.equal(app.node(id).disabled, true);
  finish(Response.json(passage)); await pending;
  for (const id of ['modeFields', 'focus', 'generate', 'translation', 'check']) assert.equal(app.node(id).disabled, false);
});

test('a new exercise and a new page discard previous answers and feedback', async () => {
  const app = await page(); await app.generate();
  app.node('translation').value = 'Answer';
  app.responses.push(Response.json(feedback)); await app.submit('checkForm');
  await app.generate();
  assert.equal(app.node('translation').value, '');
  assert.equal(app.node('feedback').hidden, true);
  const fresh = await page();
  assert.equal(fresh.node('exercise').hidden, true);
  assert.equal(fresh.node('focus').value, '');
  assert.equal(fresh.node('translation').value, '');
  assert.equal(fresh.calls.length, 0);
});
