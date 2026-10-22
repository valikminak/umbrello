const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

// options.fetch replaces the Worker reply; options.holdTimers keeps every timer
// callback until fire() runs them, so a polling implementation would show up as extra fetches.
async function page(script, search = '', failFile, options = {}) {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      innerHTML: '', textContent: '', style: {}, attrs: {},
      setAttribute(key, value) { this.attrs[key] = value; }, insertAdjacentHTML() {}, before() {}, remove() {},
      querySelector: key => node(key), querySelectorAll: () => [],
      classList: { add() {}, remove() {} }
    });
    return nodes.get(id);
  }
  const requested = [], errors = [], backs = [], quizzes = [], fetches = [], timers = [], locks = new Set();
  const context = vm.createContext({
    URL, URLSearchParams, Date, console, AbortController,
    setTimeout: options.holdTimers ? (fn, ms) => timers.push({ fn, ms }) : setTimeout,
    clearTimeout: options.holdTimers ? id => { timers[id - 1] = null; } : clearTimeout,
    location: { search, replace(url) { this.redirect = url; }, reload() {} },
    document: { getElementById: node, createElement: () => node('new'),
      body: { prepend() {}, classList: { add: c => locks.add(c), remove: c => locks.delete(c) } }, addEventListener() {}, querySelectorAll: () => [] },
    esc: s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    tg: 'tg' in options ? options.tg : { initData: 'mock-telegram-launch' }, backTo: url => backs.push(url),
    WORKER_URL: 'https://worker.test',
    fetch: async (...args) => {
      fetches.push(args);
      return options.fetch ? options.fetch(...args) : { ok: true, json: async () => ({ allowed: true, userId: 123 }) };
    },
    loadJSON: async file => {
      requested.push(file);
      if (file === failFile) throw new Error('Unavailable');
      return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    },
    showError: (_, e) => errors.push(e.message),
    runQuiz: (_, questions) => quizzes.push(questions)
  });
  context.window = context;
  context.addEventListener = () => {};
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/js/profiles.js'), 'utf8'), context);
  await vm.runInContext(fs.readFileSync(path.join(root, `assets/js/${script}.js`), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const fire = async () => {
    for (const timer of timers.filter(Boolean)) timer.fn();
    await new Promise(resolve => setImmediate(resolve));
  };
  return { context, node, requested, errors, backs, quizzes, fetches, fire, locked: () => locks.has('access-locked') };
}

const refusals = [
  ['app_forbidden', { ok: false, status: 403, json: async () => ({ error: 'app_forbidden', message: 'Umbrello is available only to the accounts enabled by the owner.', userId: 555123, notificationSent: true }) }],
  ['app_not_configured', { ok: false, status: 503, json: async () => ({ error: 'app_not_configured', message: 'Set ALLOWED_USER_IDS.', userId: 555123, notificationSent: false }) }],
  ['unauthorized', { ok: false, status: 403, json: async () => ({ error: 'unauthorized', message: 'Reopen the app from Telegram and try again.' }) }],
  ['unreadable', { ok: false, status: 502, json: async () => { throw new SyntaxError('not JSON'); } }],
  ['offline', null],
];

test('a refused account sees only the umbrella animation: no words, ID or buttons', async () => {
  for (const [name, reply] of refusals) {
    const app = await page('home', '?user=me', undefined, { holdTimers: true,
      fetch: async () => { if (!reply) throw new TypeError('Failed to fetch'); return reply; } });
    const screen = app.node('accessScreen').innerHTML;
    assert.match(screen, /<svg class="umbrella"/, name);
    assert.equal(screen.replace(/<[^>]+>/g, '').trim(), '', `${name}: visible text`);
    assert.doesNotMatch(screen, /<button|<a |555123|denied|Telegram/i, name);
    assert.notEqual(app.node('accessScreen').attrs.role, 'alert', name);
    assert.deepEqual(app.requested, [], name);
    assert.deepEqual(app.errors, [], name);
    assert.equal(app.context.location.redirect, undefined, name);
    assert.equal(app.node('app').innerHTML, '', name);
  }
});

test('the umbrella never asks the Worker again, even after every pending timer fires', async () => {
  for (const [name, reply] of refusals) {
    const app = await page('test', '?user=sophia', undefined, { holdTimers: true,
      fetch: async () => { if (!reply) throw new TypeError('Failed to fetch'); return reply; } });
    assert.equal(app.fetches.length, 1, name);
    await app.fire();
    await app.fire();
    assert.equal(app.fetches.length, 1, name);
    assert.deepEqual(app.requested, [], name);
    assert.deepEqual(app.quizzes, [], name);
  }
});

test('outside Telegram the umbrella is shown without contacting the Worker', async () => {
  for (const tg of [undefined, null, {}, { initData: '' }]) {
    const app = await page('home', '', undefined, { tg, holdTimers: true });
    const screen = app.node('accessScreen').innerHTML;
    assert.match(screen, /<svg class="umbrella"/);
    assert.equal(screen.replace(/<[^>]+>/g, '').trim(), '');
    assert.equal(app.fetches.length, 0);
    assert.deepEqual(app.requested, []);
  }
});

test('an allowed account passes the access screen and loads its profile as before', async () => {
  const app = await page('home', '?user=me', undefined, { holdTimers: true });
  assert.equal(app.fetches.length, 1);
  assert.equal(new URL(app.fetches[0][0]).pathname, '/access/check');
  assert.equal(app.fetches[0][1].cache, 'no-store');
  assert.deepEqual(JSON.parse(app.fetches[0][1].body), { initData: 'mock-telegram-launch' });
  assert.deepEqual(app.requested, ['users/index.json']);
  assert.equal(app.context.Profiles.current.id, 'me');
  await app.fire();
  assert.equal(app.fetches.length, 1);
});

test('entry page always offers both names without choosing a default', async () => {
  const app = await page('home');
  assert.match(app.node('app').innerHTML, /Sophia/);
  assert.match(app.node('app').innerHTML, /user=sophia/);
  assert.match(app.node('app').innerHTML, /user=me/);
  assert.equal(app.context.Profiles.current, null);
  assert.deepEqual(app.requested, ['users/index.json']);
});

test('menus and return links keep the chosen profile', async () => {
  for (const id of ['sophia', 'me']) {
    const app = await page('home', `?user=${id}`);
    assert.deepEqual(app.errors, []);
    for (const section of ['test', 'read', 'listen', 'write']) {
      assert.ok(app.node('app').innerHTML.includes(`${section}.html?v=10&user=${id}`));
    }
    assert.match(app.node('profileNav').innerHTML, /Switch profile/);
    assert.equal(app.context.Profiles.current.id, id);
  }
});

test('Grammar is offered only in the me menu', async () => {
  const me = await page('home', '?user=me');
  const sophia = await page('home', '?user=sophia');
  assert.match(me.node('app').innerHTML, /grammar\.html\?v=10&user=me/);
  assert.doesNotMatch(sophia.node('app').innerHTML, /grammar\.html/);
});

test('Sophia has her existing tests and reading, with empty Listen even for a direct lesson link', async () => {
  const quiz = await page('test', '?user=sophia');
  assert.deepEqual(quiz.errors, []);
  assert.ok(quiz.quizzes[0].length > 0);
  assert.deepEqual(quiz.requested, ['users/index.json', 'users/sophia/test.json']);
  const read = await page('read', '?user=sophia');
  assert.deepEqual(read.errors, []);
  assert.match(read.node('app').innerHTML, /class="story"/);
  assert.deepEqual(read.requested, ['users/index.json', 'users/sophia/read.json']);
  const listen = await page('listen', '?user=sophia&lesson=counting-stars');
  assert.deepEqual(listen.errors, []);
  assert.match(listen.node('listenApp').innerHTML, /No listening lessons yet/);
  assert.deepEqual(listen.requested, ['users/index.json', 'users/sophia/listen.json']);
});

test('me has vocabulary tests, both Listen lessons and empty Read', async () => {
  const quiz = await page('test', '?user=me');
  assert.deepEqual(quiz.errors, []);
  assert.equal(quiz.quizzes[0].length, 10);
  assert.deepEqual(quiz.requested, ['users/index.json', 'users/me/test.json']);
  for (const [section, message] of [['read', 'No reading yet']]) {
    const app = await page(section, '?user=me');
    assert.deepEqual(app.errors, []);
    assert.match(app.node('app').innerHTML, new RegExp(message));
    assert.ok(app.node('app').innerHTML.includes('index.html?v=10&user=me'));
    assert.deepEqual(app.requested, ['users/index.json', `users/me/${section}.json`]);
    assert.equal(app.quizzes.length, 0);
  }
  const listen = await page('listen', '?user=me');
  assert.deepEqual(listen.errors, []);
  assert.match(listen.node('listenApp').innerHTML, /Counting Stars/);
  assert.match(listen.node('listenApp').innerHTML, /Row Your Boat/);
  assert.match(listen.node('listenApp').innerHTML, /user=me&lesson=counting-stars/);
  assert.deepEqual(listen.requested, ['users/index.json', 'users/me/listen.json']);
});

test('missing or unknown profiles redirect before any lesson content is requested', async () => {
  for (const script of ['test', 'read', 'listen', 'write', 'books']) {
    for (const search of ['', '?user=unknown', '?user=../me', '?lesson=counting-stars']) {
      const app = await page(script, search);
      assert.equal(app.context.location.redirect, 'index.html?v=10');
      assert.deepEqual(app.requested, ['users/index.json']);
    }
  }
});

test('loading errors never fall back to another profile and paths stay inside the user folder', async () => {
  const app = await page('test', '?user=me', 'users/me/test.json');
  assert.deepEqual(app.errors, ['Unavailable']);
  assert.deepEqual(app.requested, ['users/index.json', 'users/me/test.json']);
  for (const file of ['../sophia/test.json', '/users/sophia/test.json', 'https://example.com/test.json']) {
    assert.throws(() => app.context.Profiles.content(file));
  }
  assert.equal(app.context.Profiles.content('listen/new-song.json'), 'users/me/listen/new-song.json');
});

test('Profiles.refuse locks an already open page behind the umbrella when the Worker refuses later', async () => {
  const codes = ['app_forbidden', 'app_not_configured', 'books_forbidden', 'books_not_configured',
    'grammar_forbidden', 'grammar_not_configured', 'unauthorized'];
  for (const code of codes) {
    const app = await page('home', '?user=me', undefined, { holdTimers: true });
    assert.equal(app.locked(), false, code);
    assert.equal(app.context.Profiles.refuse(code), true, code);
    const screen = app.node('accessScreen').innerHTML;
    assert.match(screen, /<svg class="umbrella"/, code);
    assert.equal(screen.replace(/<[^>]+>/g, '').trim(), '', code);
    assert.equal(app.locked(), true, code);
    assert.equal(app.fetches.length, 1, code);
  }
  const app = await page('home', '?user=me', undefined, { holdTimers: true });
  for (const code of ['invalid_input', 'provider_auth', 'books_storage_error', 'grammar_storage_timeout', 'not_found', 'forbidden', '', undefined, null, 403]) {
    assert.equal(app.context.Profiles.refuse(code), false, String(code));
  }
  assert.equal(app.locked(), false);
  assert.doesNotMatch(app.node('accessScreen').innerHTML, /umbrella/);
});
