const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../assets/js/vocabulary-core.js');
const root = path.join(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

// The smallest valid unit: two phrases, one part, enough practice questions.
function fixture() {
  const practice = Array.from({ length: core.MIN_PRACTICE }, (_, i) => ({
    q: `Practice ${i + 1} ___ here.`, right: i % 2 ? 'beta' : 'alpha', wrong: ['w1', 'w2', 'w3', 'w4', 'w5'], item: i % 2 ? 'b1' : 'a1',
  }));
  return {
    schemaVersion: 1, number: 7, title: 'Test unit', about: 'About the test unit.',
    parts: [{ id: 'A', title: 'Part A' }, { id: 'H', title: 'Help', note: 'Примітка.' }],
    items: [
      { id: 'a1', part: 'A', phrase: 'alpha', pattern: 'an alpha', meaning: 'the first', uk: 'альфа', example: 'This is **alpha**.' },
      { id: 'b1', part: 'A', phrase: 'beta', pattern: 'a beta', meaning: 'the second', uk: 'бета', example: 'This is **beta**.', more: ['More **beta**.'] },
    ],
    warmup: [{ uk: 'Альфа.', q: 'It is ___.', right: 'alpha', wrong: ['gamma', 'delta'], item: 'a1' }],
    checks: { A: [{ q: 'Check ___.', right: 'beta', wrong: ['x', 'y'], item: 'b1', explain: 'Пояснення.' }] },
    practice,
    mix: [{ q: 'Mix ___ one.', answers: ['alpha'], item: 'a1' }, { q: 'Mix ___ two.', answers: ['beta'], item: 'b1' }],
    story: { topics: ['a test day'] },
  };
}

test('the unit list and Unit 12 pass validation, and every listed unit has its file', () => {
  const index = core.validateIndex(read('vocabulary/index.json'));
  const units = index.groups.flatMap(group => group.units);
  assert.equal(units.length, 101);
  assert.deepEqual(units.map(unit => unit.number), Array.from({ length: 101 }, (_, i) => i + 1));
  const ready = units.filter(unit => unit.id);
  assert.ok(ready.some(unit => unit.id === 'unit-012'));
  for (const unit of ready) {
    const data = core.validateUnit(read(`vocabulary/${unit.id}.json`));
    assert.equal(data.number, unit.number, unit.id);
    assert.equal(data.title, unit.title, unit.id);
  }
});

test('Unit 12 trains every phrase in practice and in the final mix, with Ukrainian notes', () => {
  const unit = core.validateUnit(read('vocabulary/unit-012.json'));
  assert.equal(unit.items.length, 27);
  assert.ok(unit.practice.length >= 2 * unit.items.length - 1);
  for (const item of unit.items) {
    assert.ok(unit.practice.filter(q => q.item === item.id).length >= 2, `practice for ${item.id}`);
    assert.equal(unit.mix.filter(q => q.item === item.id).length, 1, `mix for ${item.id}`);
    assert.match(item.uk, /[А-Яа-яІіЇїЄєҐґ]/u, item.id);
  }
  for (const q of [...unit.warmup, ...Object.values(unit.checks).flat()]) assert.match(q.explain, /[А-Яа-яІіЇїЄєҐґ]/u, q.q);
  assert.equal(new Set(unit.practice.map(q => q.q)).size, unit.practice.length, 'no repeated practice sentence');
  assert.ok(core.storyIds(unit.story.example.en, new Set(unit.items.map(item => item.id))).length >= 8);
});

test('malformed units are rejected with the place to fix', () => {
  const broken = change => { const data = fixture(); change(data); return data; };
  assert.doesNotThrow(() => core.validateUnit(fixture()));
  for (const [data, message] of [
    [broken(d => { d.schemaVersion = 2; }), /schemaVersion/],
    [broken(d => { d.items[1].id = 'a1'; }), /items\[1\]: .*unique id/],
    [broken(d => { d.items[0].part = 'Z'; }), /items\[0\]: part/],
    [broken(d => { d.items[0].example = 'No mark.'; }), /items\[0\]: mark the phrase/],
    [broken(d => { d.warmup[0].uk = ''; }), /warmup\[0\]: .*Ukrainian/],
    [broken(d => { d.warmup[0].q = 'No gap.'; }), /warmup\[0\]: .*___/],
    [broken(d => { d.warmup[0].wrong = ['Alpha', 'x']; }), /warmup\[0\]: .*different wrong/],
    [broken(d => { delete d.checks.A; }), /checks\.A: add questions/],
    [broken(d => { d.practice[3].wrong = ['w1', 'w2', 'w3', 'w4']; }), /practice\[3\]: .*5 different wrong/],
    [broken(d => { d.practice[3].item = 'zz'; }), /practice\[3\]: item/],
    [broken(d => { d.practice = d.practice.slice(1); }), /practice: add at least 20/],
    [broken(d => { d.practice.forEach(q => { q.item = 'a1'; }); }), /practice: no question for b1/],
    [broken(d => { d.mix = d.mix.slice(0, 1); }), /mix: no question for b1/],
    [broken(d => { d.mix[0].answers = []; }), /mix\[0\]: add answers/],
    [broken(d => { d.parts[1] = { id: 'H', title: 'Help' }; }), /part H has no items, table or note/],
    [broken(d => { d.parts[1].table = { columns: ['A', 'B'], rows: [['one']] }; }), /parts\[1\]\.table/],
    [broken(d => { d.story.topics = []; }), /story: add topics/],
    [broken(d => { d.story.example = { title: 'T', uk: 'Текст.', en: 'Only [[alpha|a1]] here.' }; }), /story\.example/],
  ]) assert.throws(() => core.validateUnit(data), message);
});

test('the unit list rejects repeated numbers and malformed unit ids', () => {
  const list = units => ({ book: 'Book', groups: [{ title: 'G', units }] });
  assert.equal(core.validateIndex(list([{ number: 1, title: 'One', id: 'unit-001' }, { number: 2, title: 'Two' }])).groups[0].units[1].id, null);
  assert.throws(() => core.validateIndex(list([{ number: 1, title: 'One' }, { number: 1, title: 'Again' }])), /unique number/);
  assert.throws(() => core.validateIndex(list([{ number: 1, title: 'One', id: '../secret' }])), /id must look like unit-012/);
  assert.throws(() => core.validateIndex({ book: 'Book', groups: [] }), /add book and groups/);
});

test('the rating counts only the last 20 answers, and 18 right of 20 is the 4.5 needed to go on', () => {
  const answers = (right, wrong) => [...Array(right).fill(true), ...Array(wrong).fill(false)];
  assert.equal(core.rating([]), 0);
  assert.equal(core.rating(answers(17, 0)), 4.25, 'fewer than 18 answers can never pass');
  assert.equal(core.passed(answers(17, 0)), false);
  assert.equal(core.rating(answers(18, 0)), 4.5);
  assert.equal(core.passed(answers(18, 0)), true);
  assert.equal(core.passed([...answers(18, 0), false, false, false]), false, 'three misses in the window drop it below 4.5');
  assert.equal(core.rating([...answers(0, 30), ...answers(20, 0)]), 5, 'old mistakes leave the window');
});

test('a wrong practice question comes back after four to seven others; a new deck avoids repeating the last one', () => {
  for (const r of [0, 0.5, 0.999]) {
    const queue = core.requeue(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], 'x', () => r);
    const at = queue.indexOf('x');
    assert.ok(at >= 4 && at <= 7, `position ${at}`);
  }
  assert.deepEqual(core.requeue(['a', 'b'], 'x', () => 0.5), ['a', 'b', 'x'], 'a short queue puts it at the end');
  const deck = core.practiceDeck(['a', 'b', 'c'], () => 0.999, 'a');
  assert.notEqual(deck[0], 'a');
  assert.deepEqual([...deck].sort(), ['a', 'b', 'c']);
});

test('typed answers ignore case, curly apostrophes and end punctuation; one typo in a longer word is almost right', () => {
  assert.deepEqual(core.checkTyped(["wouldn't start"], ' Wouldn’t  START. '), { status: 'ok', matched: "wouldn't start" });
  assert.deepEqual(core.checkTyped(['bump', 'bang'], 'bang'), { status: 'ok', matched: 'bang' });
  assert.deepEqual(core.checkTyped(['mislaid'], 'mislayd'), { status: 'almost', matched: 'mislaid' });
  assert.deepEqual(core.checkTyped(['flat'], 'flet'), { status: 'bad' }, 'short words must be exact');
  assert.deepEqual(core.checkTyped(['leaking'], ''), { status: 'bad' });
  assert.deepEqual(core.checkTyped(['leaking'], 'cracked'), { status: 'bad' });
  assert.equal(core.firstLetters('power cut'), 'p… c…');
});

test('story marks become phrase links; unknown ids stay plain text', () => {
  const ids = new Set(['a4', 'c7']);
  const text = 'The batteries [[had run out|a4]] and I [[locked myself out|c7]] near the [[river|zz]].';
  assert.deepEqual(core.storyParts(text, ids), [
    { text: 'The batteries ' }, { text: 'had run out', item: 'a4' }, { text: ' and I ' },
    { text: 'locked myself out', item: 'c7' }, { text: ' near the ' }, { text: 'river' }, { text: '.' },
  ]);
  assert.deepEqual(core.storyIds(text, ids), ['a4', 'c7']);
  assert.equal(core.plainStory(text), 'The batteries had run out and I locked myself out near the river.');
});

test('the Vocabulary page loads the rules before the page script', () => {
  const html = fs.readFileSync(path.join(root, 'vocabulary.html'), 'utf8');
  const order = ['assets/js/app.js', 'assets/js/profiles.js', 'assets/js/vocabulary-core.js', 'assets/js/vocabulary.js'].map(file => html.indexOf(file));
  assert.ok(order.every(i => i > 0), 'all scripts included');
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(html, /assets\/css\/vocabulary\.css/);
});
