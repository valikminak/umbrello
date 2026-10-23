const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../assets/js/grammar-core.js');
const root = path.join(__dirname, '..');

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
// Eight questions per level; the right answer comes first because the test shuffle keeps order.
const fixture = () => LEVELS.flatMap(level => Array.from({ length: 8 }, (_, i) => ({
  level, topic: `${level} topic ${i + 1}`, q: `${level} sentence ${i + 1} ___ here.`,
  right: `${level} right ${i + 1}`, wrong: [`${level} wrong a${i + 1}`, `${level} wrong b${i + 1}`, `${level} wrong c${i + 1}`],
  explain: `Пояснення ${level} ${i + 1}.`,
})));

test('the level test file has eight well-formed questions for every level from A1 to C2', () => {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'grammar/level-test.json'), 'utf8'));
  const blocks = core.validateTest(data);
  assert.deepEqual(blocks.map(block => block.length), [8, 8, 8, 8, 8, 8]);
  assert.deepEqual(blocks.map(block => block[0].level), LEVELS);
  for (const item of blocks.flat()) assert.match(item.explain, /[А-Яа-яІіЇїЄєҐґ]/u, `Ukrainian explanation: ${item.q}`);
  assert.equal(new Set(blocks.flat().map(item => item.q)).size, 48, 'no repeated sentence');
});

test('malformed level tests are rejected with the question number or level', () => {
  const broken = (index, change) => { const data = fixture(); data[index] = { ...data[index], ...change }; return data; };
  for (const [data, message] of [
    [{ questions: [] }, /list of questions/],
    [broken(0, { level: 'D1' }), /question 1: .*level/],
    [broken(3, { q: 'No gap here.' }), /question 4: .*___/],
    [broken(3, { q: 'Two ___ gaps ___.' }), /question 4: .*___/],
    [broken(5, { wrong: ['x', 'y'] }), /question 6: .*three different wrong/],
    [broken(5, { wrong: ['x', 'y', 'z', 'z'] }), /question 6: .*three different wrong/],
    [broken(5, { wrong: ['x', 'y', 'X'] }), /question 6: .*three different wrong/],
    [broken(5, { wrong: ['x', 'y', fixture()[5].right] }), /question 6: .*three different wrong/],
    [broken(7, { right: ' ' }), /question 8: .*three different wrong/],
    [broken(9, { topic: '' }), /question 10: .*topic/],
    [broken(9, { explain: undefined }), /question 10: .*explanation/],
    [fixture().slice(1), /A1 needs exactly 8/],
    [[...fixture(), fixture()[47]], /C2 needs exactly 8/],
  ]) assert.throws(() => core.validateTest(data), message);
});

test('six of eight passes a level; the result is the last level passed before the first miss', () => {
  for (const [scores, expected] of [
    [[8, 8, 8, 8, 8, 8], { level: 'C2', name: 'Proficiency', next: null, close: false }],
    [[6, 6, 6, 6, 6, 6], { level: 'C2', name: 'Proficiency', next: null, close: false }],
    [[8, 7, 6, 5], { level: 'B1', name: 'Intermediate', next: 'B2', close: true }],
    [[8, 7, 6, 4], { level: 'B1', name: 'Intermediate', next: 'B2', close: false }],
    [[8, 8, 8, 8, 8, 5], { level: 'C1', name: 'Advanced', next: 'C2', close: true }],
    [[5], { level: null, name: 'Starter', next: 'A1', close: true }],
    [[2], { level: null, name: 'Starter', next: 'A1', close: false }],
  ]) assert.deepEqual(core.placement(scores), expected, scores.join(','));
});

test('the summary counts each level and lists the topics of wrong and skipped answers once', () => {
  const answers = [
    ...Array.from({ length: 8 }, (_, i) => ({ level: 'A1', topic: i === 2 ? 'Can' : 'To be', correct: i !== 2 })),
    ...Array.from({ length: 8 }, (_, i) => ({ level: 'A2', topic: i < 4 ? 'Past simple' : 'Should', correct: i % 2 === 0 })),
  ];
  assert.deepEqual(core.summary(answers), {
    scores: [7, 4], level: 'A1', name: 'Beginner', next: 'A2', close: false,
    answered: 16, topics: ['Can', 'Past simple', 'Should'],
  });
});

test('the report names the level, the scores, the time and what to work on', () => {
  const report = core.reportText({ scores: [8, 7, 6, 5], level: 'B1', name: 'Intermediate', next: 'B2', close: true,
    answered: 32, topics: ['Past perfect', 'Third conditional'] }, 11);
  assert.equal(report, 'Рівень граматики: B1 (Intermediate), близько до B2\n' +
    'A1 8/8 · A2 7/8 · B1 6/8 · B2 5/8\nВідповідей: 32 · час: 11 хв\nНад чим попрацювати: Past perfect; Third conditional');
  assert.equal(core.reportText({ scores: [8, 8, 8, 8, 8, 8], level: 'C2', name: 'Proficiency', next: null, close: false,
    answered: 48, topics: [] }, 0), 'Рівень граматики: C2 (Proficiency)\n' +
    'A1 8/8 · A2 8/8 · B1 8/8 · B2 8/8 · C1 8/8 · C2 8/8\nВідповідей: 48 · час: 1 хв\nПомилок немає');
  assert.match(core.reportText({ scores: [3], level: null, name: 'Starter', next: 'A1', close: false,
    answered: 8, topics: ['To be'] }, 2), /^Рівень граматики: Pre-A1 \(Starter\)\n/);
});

// The page runs with the real app.js helpers; fetch serves the questions and records reports.
async function openGrammar({ data = fixture(), access = true, search = '', report = { ok: true, json: async () => ({}) } } = {}) {
  const renders = [], reports = [], timers = [], requested = [];
  const tabs = { innerHTML: '' };
  let now = 0;
  const host = {
    set innerHTML(html) {
      this.html = html;
      renders.push(html);
      this.nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => ['#' + id, { id, style: {}, textContent: '', className: '' }]));
      this.answers = [...html.matchAll(/<button[^>]*data-answer="([^"]+)"[^>]*>([^<]*)<\/button>/g)].map(([, answer, text]) => {
        const classes = new Set();
        return { dataset: { answer }, text, classList: { add: name => classes.add(name), contains: name => classes.has(name) } };
      });
    },
    get innerHTML() { return this.html; },
    querySelector(selector) { return this.nodes?.get(selector); },
    querySelectorAll(selector) { return selector === '[data-answer]' ? this.answers : []; },
  };
  const profiles = { shared: async () => access, url: page => `${page}?v=10`, current: null, refuse: () => false };
  const context = vm.createContext({
    Profiles: profiles, document: { getElementById: id => (id === 'grammarTabs' ? tabs : host) }, location: { href: '', search },
    Math: Object.assign(Object.create(Math), { random: () => 0.999 }), Date: { now: () => now },
    setTimeout: callback => timers.push(callback), WORKER_URL: '/report', URLSearchParams, console,
    fetch: async (url, options) => {
      if (options?.method === 'POST') { reports.push(JSON.parse(options.body)); return typeof report === 'function' ? report() : report; }
      requested.push(url);
      if (data instanceof Error) throw data;
      return { ok: true, json: async () => data };
    },
  });
  context.window = context;
  for (const file of ['app.js', 'grammar-core.js', 'grammar.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'assets/js', file), 'utf8'), context);
  }
  await new Promise(resolve => setImmediate(resolve));
  const flush = () => { while (timers.length) timers.shift()(); };
  const click = id => { host.querySelector('#' + id).onclick(); flush(); };
  const tap = text => {
    const button = host.answers.find(item => item.text === text);
    assert.ok(button, `Missing answer: ${text}`);
    button.onclick();
  };
  const answer = text => { tap(text); flush(); };
  // Answers the current level's eight questions: the first `right` correctly, the rest with a wrong option.
  const level = (name, right) => {
    for (let i = 1; i <= 8; i++) answer(i <= right ? `${name} right ${i}` : `${name} wrong a${i}`);
  };
  const wait = minutes => { now += minutes * 60000; };
  return { host, tabs, renders, reports, requested, context, click, tap, answer, level, flush, wait };
}

test('Grammar opens on the Test tab, with links to Test and Learn and no profile', async () => {
  for (const search of ['', '?tab=test', '?tab=unknown', '?user=sophia']) {
    const app = await openGrammar({ search });
    assert.match(app.tabs.innerHTML, /<a href="grammar\.html\?v=10" aria-current="page">Test<\/a>/, search);
    assert.match(app.tabs.innerHTML, /<a href="grammar\.html\?v=10&tab=learn">Learn<\/a>/, search);
    assert.match(app.host.html, /id="start"/, search);
  }
});

test('the Learn tab is empty for now and never loads the test questions', async () => {
  const app = await openGrammar({ search: '?tab=learn' });
  assert.match(app.tabs.innerHTML, /<a href="grammar\.html\?v=10&tab=learn" aria-current="page">Learn<\/a>/);
  assert.doesNotMatch(app.tabs.innerHTML, /aria-current="page">Test/);
  assert.match(app.host.html, /<h1>Learn<\/h1>/);
  assert.doesNotMatch(app.host.html, /id="start"/);
  assert.deepEqual(app.requested, []);
});

test('the intro explains the test and Start shows the first A1 question with four options and I don\'t know', async () => {
  const app = await openGrammar();
  assert.match(app.requested[0], /^grammar\/level-test\.json\?t=/);
  assert.match(app.host.html, /id="start"/);
  assert.match(app.host.html, /48/);
  app.click('start');
  assert.match(app.host.html, /A1 sentence 1/);
  assert.match(app.host.html, /1 \/ 8/);
  assert.deepEqual(app.host.answers.map(button => button.text),
    ['A1 right 1', 'A1 wrong a1', 'A1 wrong b1', 'A1 wrong c1', "I don't know"]);
});

test('six right answers open the next level and the first level below six ends the test with a report', async () => {
  const app = await openGrammar();
  app.click('start');
  app.level('A1', 6);
  assert.match(app.host.html, /A2 sentence 1/, 'A1 passed with 6 of 8');
  app.wait(3);
  app.level('A2', 5);
  assert.doesNotMatch(app.host.html, /A3|B1 sentence/);
  assert.match(app.host.html, /class="big">A1</);
  assert.match(app.host.html, /Beginner/);
  assert.match(app.host.html, /close to A2/);
  assert.match(app.host.html, /A1 6\/8/);
  assert.match(app.host.html, /A2 5\/8/);
  assert.equal(app.reports.length, 1);
  assert.equal(app.reports[0].title, '🧩 Граматика');
  assert.equal(app.reports[0].text, 'Рівень граматики: A1 (Beginner), близько до A2\nA1 6/8 · A2 5/8\n' +
    'Відповідей: 16 · час: 3 хв\nНад чим попрацювати: A1 topic 7; A1 topic 8; A2 topic 6; A2 topic 7; A2 topic 8');
});

test('a tap is only acknowledged: nothing shows whether the answer was right', async () => {
  const app = await openGrammar();
  app.click('start');
  app.tap('A1 wrong a1');
  assert.equal(app.host.answers.find(button => button.text === 'A1 wrong a1').classList.contains('chosen'), true);
  for (const button of app.host.answers) {
    assert.equal(button.classList.contains('wrong') || button.classList.contains('right'), false, button.text);
  }
  app.flush();
  for (let i = 2; i <= 8; i++) app.answer(i <= 4 ? `A1 right ${i}` : `A1 wrong a${i}`);
  const during = app.renders.slice(1, -1);
  assert.equal(during.length, 8);
  for (const html of during) assert.doesNotMatch(html, /class="[^"]*\b(?:right|wrong)\b|Wrong|Correct|Try again/);
});

test('I don\'t know counts as a mistake and the review shows the right sentence and the explanation', async () => {
  const app = await openGrammar();
  app.click('start');
  for (let i = 1; i <= 8; i++) app.answer(i <= 5 ? `A1 right ${i}` : "I don't know");
  assert.match(app.host.html, /Pre-A1/);
  assert.match(app.host.html, /close to A1/);
  assert.match(app.host.html, /A1 sentence 6 <b>A1 right 6<\/b> here\./);
  assert.match(app.host.html, /I don&#39;t know|I don't know/);
  assert.match(app.host.html, /Пояснення A1 6\./);
  assert.match(app.reports[0].text, /Над чим попрацювати: A1 topic 6; A1 topic 7; A1 topic 8$/);
});

test('a second tap before the next question appears is ignored', async () => {
  const app = await openGrammar();
  app.click('start');
  app.tap('A1 wrong a1');
  app.tap('A1 right 1');
  app.flush();
  assert.match(app.host.html, /2 \/ 8/);
  for (let i = 2; i <= 8; i++) app.answer(`A1 right ${i}`);
  assert.match(app.host.html, /A2 sentence 1/, 'only the first tap counted: 7 of 8');
});

test('passing all six levels gives C2 with no mistakes to review', async () => {
  const app = await openGrammar();
  app.click('start');
  for (const name of LEVELS) app.level(name, 8);
  assert.match(app.host.html, /class="big">C2</);
  assert.match(app.host.html, /Proficiency/);
  assert.doesNotMatch(app.host.html, /close to/);
  assert.match(app.reports[0].text, /Відповідей: 48 · час: 1 хв\nПомилок немає$/);
});

test('Take the test again starts over at A1 with no earlier answers, and Finish returns to the menu', async () => {
  const app = await openGrammar();
  app.click('start');
  app.level('A1', 8);
  app.wait(5);
  app.level('A2', 2);
  app.click('again');
  assert.match(app.host.html, /A1 sentence 1/);
  assert.match(app.host.html, /1 \/ 8/);
  app.level('A1', 8);
  app.level('A2', 0);
  assert.equal(app.reports.length, 2);
  assert.match(app.reports[1].text, /\nA1 8\/8 · A2 0\/8\nВідповідей: 16 · час: 1 хв\n/);
  app.click('menu');
  assert.equal(app.context.location.href, 'index.html?v=10');
});

test('a failed report can be sent again from the result screen', async () => {
  let reply = { ok: false, status: 500, json: async () => ({}) };
  const app = await openGrammar({ report: () => reply });
  app.click('start');
  app.level('A1', 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.host.querySelector('#status').textContent, "Couldn't send the result.");
  assert.equal(app.host.querySelector('#retry').style.display, 'block');
  reply = { ok: true, json: async () => ({}) };
  app.host.querySelector('#retry').onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.reports.length, 2);
  assert.equal(app.reports[1].text, app.reports[0].text);
  assert.equal(app.host.querySelector('#status').textContent, 'Result sent to teacher ✓');
});

test('a broken question file shows a retry, and without access nothing loads', async () => {
  const broken = await openGrammar({ data: { questions: [] } });
  assert.match(broken.host.html, /Could not load/);
  assert.match(broken.host.html, /list of questions/);
  assert.equal(typeof broken.host.querySelector('#rt').onclick, 'function');
  const closed = await openGrammar({ access: false });
  assert.equal(closed.host.html, undefined);
  assert.equal(closed.tabs.innerHTML, '');
  assert.deepEqual(closed.requested, []);
});
