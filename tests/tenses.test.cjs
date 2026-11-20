const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../assets/js/tenses-core.js');
const root = path.join(__dirname, '..');
const file = () => JSON.parse(fs.readFileSync(path.join(root, 'grammar/tenses.json'), 'utf8'));
const lexicon = () => core.makeLexicon(file().lexicon);
// A seeded generator, so random tile banks are the same on every run.
const seeded = seed => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('the tenses file is valid: lesson 1 is ready with 45 Ukrainian sentences, later lessons are locked placeholders', () => {
  const data = core.validate(file());
  assert.equal(data.passRating, 4.5);
  assert.equal(data.lessons.length, 13);
  assert.deepEqual(data.lessons.map(lesson => lesson.id), [...Array(13).keys()].map(i => i + 1));
  assert.equal(data.lessons[0].ready, true);
  assert.equal(data.lessons[0].items.length, 45);
  for (const lesson of data.lessons.slice(1)) assert.equal(lesson.ready, false, lesson.title);
  for (const it of data.lessons[0].items) {
    assert.match(it.uk, /[ІіЇїЄєҐґ'А-Яа-я]/u, it.uk);
    assert.doesNotMatch(it.uk, /[ЫыЭэЪъЁё]/u, `no Russian letters: ${it.uk}`);
  }
});

test('every sentence gets a tile bank with all of its words, near misses and no repeated tile', () => {
  const data = core.validate(file()), rand = seeded(7);
  for (const it of data.lessons[0].items) {
    for (let k = 0; k < 200; k++) {
      const tiles = core.bank(it, data.lex, rand), words = tiles.map(t => t.toLowerCase());
      for (const step of it.steps) assert.ok(words.includes(step.toLowerCase()), `${it.uk}: missing ${step}`);
      assert.equal(new Set(words).size, words.length, `${it.uk}: repeated tile in ${tiles}`);
      assert.ok(tiles.length > it.steps.length, `${it.uk}: no near misses`);
      assert.ok(tiles.length <= 12, `${it.uk}: too many tiles (${tiles.length})`);
    }
  }
});

test('near misses are the neighbours that teach: negative helpers, verb forms, other times, him and he', () => {
  const lex = lexicon(), rand = seeded(3);
  const it = core.parse({ uk: 'Учора я його не бачив.', en: 'I|didn\'t|see|him|yesterday.' }, lex);
  assert.deepEqual(core.options(it, 1, lex, rand).sort(), ["didn't", "doesn't", "don't", "won't"]);
  assert.deepEqual(core.options(it, 2, lex, rand).sort(), ['saw', 'see', 'sees'], 'after didn\'t only forms of see');
  assert.ok(core.options(it, 3, lex, rand).includes('he'), 'him brings he');
  const times = core.options(it, 4, lex, rand);
  assert.equal(times.length, 3);
  assert.ok(times.some(t => lex.timeOf[t.toLowerCase()] === 'present') && times.some(t => lex.timeOf[t.toLowerCase()] === 'future'));
  const statement = core.parse({ uk: 'Я працюю щодня.', en: 'I|work|every day.' }, lex);
  assert.deepEqual(core.options(statement, 1, lex, rand).sort(), ['will', 'work', 'worked', 'works'], 'present, past and future in one choice');
  const question = core.parse({ uk: 'Ти прийдеш завтра?', en: 'Will|you|come|tomorrow?' }, lex);
  assert.deepEqual(question.steps, ['will', 'you', 'come', 'tomorrow']);
  assert.deepEqual(core.options(question, 0, lex, rand).sort(), ['did', 'do', 'does', 'will']);
});

test('only a finished sentence is judged; a statement may start with its time phrase, a question may not', () => {
  const lex = lexicon();
  const it = core.parse({ uk: 'Учора вона не зателефонувала.', en: 'She|didn\'t|call|yesterday.' }, lex);
  assert.equal(core.isRight(it, lex, ['she', "didn't", 'call', 'yesterday']), true);
  assert.equal(core.isRight(it, lex, ['yesterday', 'she', "didn't", 'call']), true);
  assert.equal(core.isRight(it, lex, ['tomorrow', 'she', "didn't", 'call']), false);
  assert.equal(core.isRight(it, lex, ['she', "didn't", 'called', 'yesterday']), false);
  assert.equal(core.sentence(it), "She didn't call yesterday.");
  const q = core.parse({ uk: 'Він прийшов учора?', en: 'Did|he|come|yesterday?' }, lex);
  assert.deepEqual(core.accepted(q, lex), ['did he come yesterday']);
  assert.equal(core.sentence(q), 'Did he come yesterday?');
});

test('the rating counts every sentence of the lesson; 4.5 needs all answered and at most 4 of 45 wrong', () => {
  const marks = (right, wrong) => Object.fromEntries([...Array(right).fill('r'), ...Array(wrong).fill('w')].map((m, i) => [i, m]));
  const seven = core.score(45, marks(7, 0));
  assert.equal(core.fmt(seven.rating), '0.7', 'seven right answers are far from a pass');
  assert.equal(core.passes(seven, 4.5), false);
  assert.equal(core.passes(core.score(45, marks(41, 4)), 4.5), true);
  assert.equal(core.passes(core.score(45, marks(40, 5)), 4.5), false);
  assert.equal(core.passes(core.score(45, marks(41, 0)), 4.5), false, 'every sentence must be answered');
  assert.equal(core.fmt(5 * 42 / 45), '4.6', '4.67 is shown rounded down');
  assert.equal(core.fmt(4.5), '4.5');
  assert.equal(core.fmt(5), '5.0');
});

test('a new round never starts with the sentence that was just answered', () => {
  const rand = seeded(11);
  for (let last = 0; last < 45; last++) {
    const order = core.newOrder(45, last, rand);
    assert.deepEqual([...order].sort((a, b) => a - b), [...Array(45).keys()]);
    assert.notEqual(order[0], last);
  }
});

test('malformed tenses files are rejected with the lesson and sentence named', () => {
  const broken = change => { const data = file(); change(data); return data; };
  const item = (data, index, value) => { data.lessons[0].items[index] = { ...data.lessons[0].items[index], ...value }; };
  for (const [data, message] of [
    [broken(d => { d.passRating = 6; }), /passRating/],
    [broken(d => { delete d.lexicon.verbs; }), /lexicon/],
    [broken(d => { d.lexicon.verbs.go = ['goes']; }), /verb "go"/],
    [broken(d => { d.lessons[1].id = 1; }), /lesson 2 needs its own/],
    [broken(d => { d.lessons[1].ready = true; }), /lesson 2 is ready but has no sentences/],
    [broken(d => item(d, 2, { uk: 'We play tennis.' })), /lesson 1, sentence 3: uk/],
    [broken(d => item(d, 2, { en: 'We|play|tennis' })), /sentence 3: en must end/],
    [broken(d => item(d, 2, { en: 'We||play.' })), /sentence 3: en has an empty step/],
    [broken(d => item(d, 7, { en: 'You|work|on Saturdays.' })), /sentence 8: a question/],
    [broken(d => item(d, 3, { uk: d.lessons[0].items[0].uk })), /sentence 4 repeats/],
    [broken(d => item(d, 21, { en: 'I|will|phone|you|tomorrow.' })), /sentence 22: add the verb after "will"/],
  ]) assert.throws(() => core.validate(data), message);
});

test('Grammar has a Tenses tab that mounts the trainer without loading the level test', async () => {
  const tabs = { innerHTML: '' }, host = { innerHTML: '' }, requested = [], mounted = [];
  const context = vm.createContext({
    Profiles: { shared: async () => true, url: page => `${page}?v=10` },
    document: { getElementById: id => (id === 'grammarTabs' ? tabs : host) },
    location: { href: '', search: '?tab=tenses' }, URLSearchParams, console,
    TensesApp: { mount: target => mounted.push(target) },
    fetch: async url => { requested.push(url); return { ok: true, json: async () => [] }; },
  });
  context.window = context;
  for (const name of ['app.js', 'grammar-core.js', 'grammar.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'assets/js', name), 'utf8'), context);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.match(tabs.innerHTML, /<a href="grammar\.html\?v=10&tab=tenses" aria-current="page">Tenses<\/a>/);
  assert.match(tabs.innerHTML, /<a href="grammar\.html\?v=10">Test<\/a>/);
  assert.deepEqual(mounted, [host]);
  assert.deepEqual(requested, []);
});

test('grammar.html loads the tenses rules before the page script', () => {
  const html = fs.readFileSync(path.join(root, 'grammar.html'), 'utf8');
  const at = name => html.indexOf(`assets/js/${name}`);
  assert.ok(at('tenses-core.js') > 0 && at('tenses-core.js') < at('tenses.js') && at('tenses.js') < at('grammar.js'));
  assert.match(html, /assets\/css\/tenses\.css/);
});
