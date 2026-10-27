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
      if (file === 'users/index.json' && options.profiles) return options.profiles;
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

test('entry page offers both names and the shared sections without choosing a default', async () => {
  const app = await page('home');
  const html = app.node('app').innerHTML;
  assert.match(html, /Sophia/);
  assert.match(html, /user=sophia/);
  assert.match(html, /user=me/);
  for (const section of ['listen', 'books', 'grammar', 'vocabulary']) assert.ok(html.includes(`href="${section}.html?v=10"`), section);
  assert.doesNotMatch(html, /test\.html|write\.html|read\.html/);
  assert.equal(app.context.Profiles.current, null);
  assert.deepEqual(app.requested, ['users/index.json']);
});

test('profile menus offer only Test and Write and keep the chosen profile', async () => {
  for (const id of ['sophia', 'me']) {
    const app = await page('home', `?user=${id}`);
    assert.deepEqual(app.errors, []);
    const html = app.node('app').innerHTML;
    for (const section of ['test', 'write']) assert.ok(html.includes(`${section}.html?v=10&user=${id}`), section);
    assert.doesNotMatch(html, /listen\.html|books\.html|grammar\.html|vocabulary\.html|read\.html/);
    assert.match(app.node('profileNav').innerHTML, /Switch profile/);
    assert.equal(app.context.Profiles.current.id, id);
  }
});

test('Listen is shared: opens without a profile, ignores ?user and filters the catalog by level', async () => {
  for (const search of ['', '?user=sophia', '?user=unknown']) {
    const app = await page('listen', search);
    assert.deepEqual(app.errors, [], search);
    assert.equal(app.context.location.redirect, undefined, search);
    assert.deepEqual(app.requested, ['listen/index.json'], search);
    const html = app.node('listenApp').innerHTML;
    for (const title of ['Count on Me', 'Counting Stars', 'Row Your Boat']) assert.match(html, new RegExp(title), search);
    assert.match(html, /href="listen\.html\?v=10&lesson=counting-stars"/, search);
    assert.doesNotMatch(html, /user=/, search);
    assert.match(html, /href="listen\.html\?v=10" aria-current="page">All</, search);
    for (const level of ['A2', 'B1', 'B2']) assert.match(html, new RegExp(`href="listen\\.html\\?v=10&level=${level}">${level}<`), search);
    assert.match(app.node('profileNav').innerHTML, /← Menu/);
    assert.doesNotMatch(app.node('profileNav').innerHTML, /Switch profile|user=/);
  }
  const filtered = await page('listen', '?level=B1');
  const html = filtered.node('listenApp').innerHTML;
  assert.match(html, /Counting Stars/);
  assert.doesNotMatch(html, /Count on Me|Row Your Boat/);
  assert.match(html, /href="listen\.html\?v=10&level=B1" aria-current="page">B1</);
  assert.match(html, /href="listen\.html\?v=10&level=B1&lesson=counting-stars"/);
  const bogus = await page('listen', '?level=Z9');
  assert.match(bogus.node('listenApp').innerHTML, /Count on Me[\s\S]*Counting Stars[\s\S]*Row Your Boat/);
});

test('Vocabulary is shared and empty for now: no profile, nothing requested, a way back to the menu', async () => {
  for (const search of ['', '?user=sophia']) {
    const app = await page('vocabulary', search);
    assert.deepEqual(app.errors, [], search);
    assert.equal(app.context.location.redirect, undefined, search);
    assert.deepEqual(app.requested, [], search);
    const html = app.node('app').innerHTML;
    assert.match(html, /<h1>Vocabulary<\/h1>/, search);
    assert.match(html, /href="index\.html\?v=10"/, search);
    assert.doesNotMatch(html, /user=/, search);
    assert.match(app.node('profileNav').innerHTML, /← Menu/);
  }
  const refused = await page('vocabulary', '', undefined, { holdTimers: true, fetch: async () => refusals[0][1] });
  assert.equal(refused.locked(), true);
  assert.equal(refused.node('app').innerHTML, '');
});

test('Sophia and me have their own tests and nothing else is requested from their folders', async () => {
  const sophia = await page('test', '?user=sophia');
  assert.deepEqual(sophia.errors, []);
  assert.ok(sophia.quizzes[0].length > 0);
  assert.deepEqual(sophia.requested, ['users/index.json', 'users/sophia/test.json']);
  const me = await page('test', '?user=me');
  assert.deepEqual(me.errors, []);
  assert.deepEqual(me.quizzes[0], JSON.parse(fs.readFileSync(path.join(root, 'users/me/test.json'), 'utf8')));
  assert.deepEqual(me.requested, ['users/index.json', 'users/me/test.json']);
});

test('missing or unknown profiles redirect before any lesson content is requested', async () => {
  for (const script of ['test', 'write']) {
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
  assert.equal(app.context.Profiles.content('test.json'), 'users/me/test.json');
});

test('Profiles.refuse locks an already open page behind the umbrella when the Worker refuses later', async () => {
  const codes = ['app_forbidden', 'app_not_configured', 'books_forbidden', 'books_not_configured', 'unauthorized'];
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
  for (const code of ['invalid_input', 'provider_auth', 'books_storage_error', 'books_storage_timeout', 'not_found', 'forbidden', '', undefined, null, 403]) {
    assert.equal(app.context.Profiles.refuse(code), false, String(code));
  }
  assert.equal(app.locked(), false);
  assert.doesNotMatch(app.node('accessScreen').innerHTML, /umbrella/);
});

test('profiles carry their level and reports setting, with safe defaults', async () => {
  const sophia = await page('home', '?user=sophia');
  assert.equal(sophia.context.Profiles.current.level, 'A2');
  assert.equal(sophia.context.Profiles.current.reports, true);
  const me = await page('home', '?user=me');
  assert.equal(me.context.Profiles.current.level, 'C1');
  assert.equal(me.context.Profiles.current.reports, false);
  const plain = await page('home', '?user=alex', undefined, { profiles: [{ id: 'alex', name: 'Alex' }] });
  assert.deepEqual({ ...plain.context.Profiles.current }, { id: 'alex', name: 'Alex', level: null, reports: true });
  for (const profile of [{ id: 'alex', name: 'Alex', level: 'Z9' }, { id: 'alex', name: 'Alex', level: 'b1' },
    { id: 'alex', name: 'Alex', reports: 'yes' }, { id: 'alex', name: 'Alex', level: 2 }]) {
    const app = await page('home', '?user=alex', undefined, { profiles: [profile] });
    assert.deepEqual(app.errors, ['Check the user list in users/index.json.'], JSON.stringify(profile));
  }
});
