const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

async function page(script, search = '', failFile) {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      innerHTML: '', textContent: '', style: {},
      setAttribute() {}, insertAdjacentHTML() {},
      querySelector: key => node(key), querySelectorAll: () => [],
      classList: { add() {}, remove() {} }
    });
    return nodes.get(id);
  }
  const requested = [], errors = [], backs = [], quizzes = [];
  const context = vm.createContext({
    URLSearchParams, Date, console,
    location: { search, replace(url) { this.redirect = url; }, reload() {} },
    document: { getElementById: node, createElement: () => node('new'),
      body: { prepend() {} }, addEventListener() {}, querySelectorAll: () => [] },
    esc: s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    tg: null, backTo: url => backs.push(url),
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
  return { context, node, requested, errors, backs, quizzes };
}

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
    for (const section of ['test', 'read', 'listen']) {
      assert.ok(app.node('app').innerHTML.includes(`${section}.html?v=6&user=${id}`));
    }
    assert.match(app.node('profileNav').innerHTML, /Switch profile/);
    assert.equal(app.context.Profiles.current.id, id);
  }
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

test('me has both Listen lessons and empty Test and Read', async () => {
  for (const [section, message] of [['test', 'No tests yet'], ['read', 'No reading yet']]) {
    const app = await page(section, '?user=me');
    assert.deepEqual(app.errors, []);
    assert.match(app.node('app').innerHTML, new RegExp(message));
    assert.ok(app.node('app').innerHTML.includes('index.html?v=6&user=me'));
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
  for (const script of ['test', 'read', 'listen']) {
    for (const search of ['', '?user=unknown', '?user=../me', '?lesson=counting-stars']) {
      const app = await page(script, search);
      assert.equal(app.context.location.redirect, 'index.html?v=6');
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
