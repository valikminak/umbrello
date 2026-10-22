const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function openTest(questions) {
  const reports = [], timers = [];
  const host = {
    set innerHTML(html) {
      this.html = html;
      this.nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) =>
        ['#' + id, { style: {} }]));
      this.options = [...html.matchAll(/data-i="(\d+)"/g)].map(([, i]) =>
        ({ dataset: { i }, disabled: false, classList: { add() {} } }));
    },
    querySelector(selector) { return this.nodes.get(selector); },
    querySelectorAll() { return this.options; }
  };
  const profiles = {
    current: { name: 'Student' },
    require: async () => ({}), content: file => file, url: file => file
  };
  const context = vm.createContext({
    window: { Profiles: profiles }, Profiles: profiles,
    document: { getElementById: () => host }, location: {},
    Math: Object.assign(Object.create(Math), { random: () => 0.999 }),
    setTimeout: callback => timers.push(callback), WORKER_URL: '/report',
    fetch: async (url, options) => {
      if (options?.method === 'POST') reports.push(JSON.parse(options.body));
      return { ok: true, json: async () => questions };
    }
  });
  for (const file of ['app.js', 'test.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js', file), 'utf8'), context);
  }
  await new Promise(resolve => setImmediate(resolve));
  return {
    host, reports,
    answer(wrong = false) {
      if (wrong) host.options[1].onclick();
      host.options[0].onclick();
      timers.shift()();
    }
  };
}

test('Test repeats only mistakes each round, reports every round and finishes after a clean round', async () => {
  // Identical prompts must still preserve the exact exercise and its options.
  const app = await openTest([
    { q: 'Same prompt', right: 'First answer', wrong: ['Wrong first'] },
    { q: 'Same prompt', right: 'Second answer', wrong: ['Wrong second'] },
    { q: 'Third prompt', right: 'Third answer', wrong: ['Wrong third'] }
  ]);
  app.answer();
  app.answer(true);
  app.answer(true);
  assert.equal(app.reports.length, 1);
  assert.match(app.reports[0].text, /Усього помилок: 2/);
  assert.match(app.host.html, /1 \/ 2/);
  assert.match(app.host.html, /Second answer/);
  assert.doesNotMatch(app.host.html, /First answer|id="menu"/);

  app.answer();
  app.answer(true);
  assert.equal(app.reports.length, 2);
  assert.match(app.reports[1].text, /Усього помилок: 1/);
  assert.match(app.host.html, /1 \/ 1/);
  assert.match(app.host.html, /Third answer/);

  for (let round = 0; round < 10; round++) {
    app.answer(true);
    assert.equal(app.reports.length, round + 3);
    assert.match(app.host.html, /Third answer/);
    assert.doesNotMatch(app.host.html, /id="menu"/);
  }
  app.answer();
  assert.equal(app.reports.length, 13);
  assert.match(app.reports.at(-1).text, /Тест завершено успішно!/);
  assert.match(app.reports.at(-1).text, /Усього помилок: 0/);
  assert.match(app.host.html, /id="menu"/);
  app.host.querySelector('#again').onclick();
  assert.match(app.host.html, /1 \/ 3/);
});

test('a clean first round immediately sends success and shows completion', async () => {
  const app = await openTest([{ q: 'Question', right: 'Yes', wrong: ['No'] }]);
  app.answer();
  assert.equal(app.reports.length, 1);
  assert.match(app.reports[0].text, /Тест завершено успішно!/);
  assert.match(app.host.html, /id="menu"/);
});

test('sending a result locks the page behind the umbrella when the Worker refuses the account', async () => {
  const refused = [];
  const profiles = { current: { name: 'Student' },
    refuse: code => /^(?:app|books|grammar)_(?:forbidden|not_configured)$|^unauthorized$/.test(code) && refused.push(code) > 0 };
  const context = vm.createContext({ window: { Profiles: profiles }, Profiles: profiles, WORKER_URL: '/report',
    fetch: async () => ({ ok: false, status: 403, json: async () => ({ error: 'app_forbidden', message: 'Refused', userId: 555123 }) }) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js/app.js'), 'utf8'), context);
  const status = { className: '', textContent: '' }, retry = { style: {} };
  assert.equal(await context.sendReport('Test', 'Result', status, retry), false);
  assert.deepEqual(refused, ['app_forbidden']);
  assert.doesNotMatch(status.textContent, /555123|Refused|Couldn't send/);
  assert.equal(retry.style.display, 'none');
  const plain = vm.createContext({ window: { Profiles: profiles }, Profiles: profiles, WORKER_URL: '/report',
    fetch: async () => ({ ok: false, status: 500, json: async () => { throw new Error('not json'); } }) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js/app.js'), 'utf8'), plain);
  assert.equal(await plain.sendReport('Test', 'Result', status, retry), false);
  assert.match(status.textContent, /Couldn't send/);
  assert.equal(retry.style.display, 'block');
  assert.deepEqual(refused, ['app_forbidden']);
});
