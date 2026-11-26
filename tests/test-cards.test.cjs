const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../assets/js/test-cards-core.js');
const root = path.join(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const seeded = start => { let seed = start * 7919 + 12345; return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; };
const deck = n => core.validate({ items: Array.from({ length: n }, (_, i) => (
  { q: `word${i}`, right: `слово${i}`, wrong: ['а', 'б', 'в'], hint: `Here is [word${i}].` })) }, 'file');

// Answers the cards of a pass one after another; what(i) says how card i goes: "r", "w" or "h" (right, after
// turning the card over). Stops where the pass ends, after the last card.
function play(p, data, what = () => 'r', stopAt = Infinity) {
  const asked = [];
  while (!core.over(p, data) && asked.length < stopAt) {
    const i = core.next(p, data), it = data.items[i];
    asked.push(i);
    core.answer(p, it, what(i) !== 'w', what(i) === 'h', what(i) === 'w' ? 'а' : it.right);
  }
  return asked;
}
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const sophia = () => read('users/sophia/tests/index.json').tests.map(n => ({ n, ...core.validate(read(`users/sophia/tests/${n}/test.json`), `test ${n}`) }));

/* ---------- the files ---------- */
test('every profile keeps its tests in numbered folders with valid files; a test is called by its number only', () => {
  for (const { id } of read('users/index.json')) {
    const raw = read(`users/${id}/tests/index.json`), index = core.validateIndex(raw);
    assert.deepEqual(Object.keys(raw), ['tests'], `${id}: no pass rating, the rating opens nothing`);
    assert.ok(index.tests.length, id);
    for (const n of index.tests) {
      const file = read(`users/${id}/tests/${n}/test.json`);
      assert.deepEqual(Object.keys(file), ['items'], `${id} ${n}: no title`);
      core.validate(file, `${id} ${n}`);
    }
  }
  const me = core.validate(read('users/me/tests/1/test.json'), 'me 1');
  assert.equal(me.items.length, 24);
  assert.equal(me.items[0].right, 'переконливий');
});

test('Sophia’s tests have 20 words each; only the newest may have fewer until it is filled up', () => {
  const tests = sophia();
  assert.deepEqual(tests.map(t => t.n), [1, 2, 3, 4, 5]);
  const counts = tests.map(t => core.wordList(t).length);
  assert.deepEqual(counts.slice(0, -1), [20, 20, 20, 20]);
  assert.ok(counts.at(-1) <= 20);
  const seen = new Map();
  for (const t of tests) for (const { word } of core.wordList(t)) {
    assert.ok(!seen.has(word), `${word} is in test ${seen.get(word)} and test ${t.n}`);
    seen.set(word, t.n);
  }
});

// The translations of the exam book's vocabulary list; "building" is not in it and went to test 5.
const BOOK = { receive: 'отримувати', castle: 'замок, фортеця', cathedral: 'собор', ceiling: 'стеля',
  church: 'церква', roof: 'дах', customers: 'клієнти, покупці', 'go camping': 'ходити в походи',
  'go sightseeing': 'ходити на екскурсії, оглядати визначні місця', coach: 'автобус', ferry: 'паром', flight: 'політ, переліт',
  ticket: 'квиток', carpet: 'килим', 'chest of drawers': 'комод', cupboard: 'кухонна шафа', curtains: 'штори',
  cushion: 'диванна подушка', 'read magazines': 'читати журнали', 'write a diary': 'вести щоденник' };

// The words Sophia was given for tests 2–5, in her order; "only" and "far away" come twice and count once.
const GIVEN = `Important, advice, agree, try, solution, enjoy, Joke, perhaps, missing, useful
  climb, right, move, mouth, wrong, back, smoke, listen, close,
  List, below, bird, find, mistake, far away, take, let's, of course, clever, hear, noise
  Break, cut, send, feed, later, wait, bring, only, quiet, across, walk, language
  Hungry, scared, cheap, expensive, only, decide, sure, guess, laugh, grow, if, use, recipe, other
  Difficult, simple, far away, include, rich, poor, become, leave, journey, dangerous, arrive, return, way, valuable, just`;
const NEW = [...new Set(GIVEN.split(/[,\n]/).map(w => w.trim().toLowerCase()).filter(Boolean))];
const SOME = { climb: 'підніматися (вгору)', right: 'правильно, право', below: 'нижче, внизу', back: 'назад', close: 'закривати',
  just: 'просто, щойно', way: 'шлях, спосіб', leave: 'залишати, йти', building: 'будівля' };

test('the new words go to tests 2–5 twenty at a time in the order they were given; building ends test 5', () => {
  assert.equal(NEW.length, 70);
  const tests = sophia();
  assert.deepEqual(core.wordList(tests[0]).map(w => w.word), Object.keys(BOOK));
  for (const [i, n] of [2, 3, 4, 5].entries()) {
    const words = core.wordList(tests[n - 1]);
    assert.deepEqual(words.map(w => w.word), [...NEW.slice(i * 20, i * 20 + 20), ...(n === 5 ? ['building'] : [])], `test ${n}`);
    for (const { word, translation } of words) if (SOME[word]) assert.equal(translation, SOME[word], word);
  }
  for (const { word, translation } of core.wordList(tests[0])) assert.equal(translation, BOOK[word], word);
});

test('every word of Sophia’s tests is asked both ways with one sentence that fits only the right answer', () => {
  for (const t of sophia()) {
    const words = core.wordList(t).map(w => w.word), { items } = t;
    assert.equal(items.length, words.length * 2, `test ${t.n}`);
    assert.deepEqual(items.slice(0, words.length).map(it => it.q), words, `test ${t.n}: every word once before any comes again`);
    const hints = new Set();
    for (const word of words) {
      const there = items.find(it => it.q === word), back = items.find(it => it.right === word);
      assert.ok(there && back, word);
      assert.equal(back.q, there.right, word);
      // The same sentence: the word is in it on one card and left out on the other.
      assert.deepEqual([there.hint.word.toLowerCase(), there.hint.gap, back.hint.gap], [word, false, true]);
      const text = ({ before, word: w, after }) => before + w + after;
      assert.equal(text(there.hint), text(back.hint), word);
      hints.add(text(there.hint));
      const rest = ` ${there.hint.before} ${there.hint.after} `.toLowerCase();
      for (const other of [...back.wrong, word]) assert.doesNotMatch(rest, new RegExp(`\\b${other}\\b`), `${word}: ${other} is in the sentence`);
      assert.ok(there.wrong.length >= 3 && back.wrong.length >= 3, word);
    }
    assert.equal(hints.size, words.length, `test ${t.n}: no two words share a sentence`);
  }
  for (const n of [1, 2, 3, 4, 5]) assert.doesNotMatch(fs.readFileSync(path.join(root, `users/sophia/tests/${n}/test.json`), 'utf8'), /\p{Extended_Pictographic}/u);
});

test('no card offers a word that could be confused with the answer', () => {
  const alike = [['building', 'castle', 'cathedral', 'church'], ['ceiling', 'roof'], ['cupboard', 'chest of drawers'],
    ['carpet', 'curtains', 'cushion'], ['coach', 'ferry', 'flight'], ['flight', 'ticket'],
    ['go camping', 'go sightseeing'], ['read magazines', 'write a diary'],
    ['right', 'wrong'], ['important', 'useful'], ['advice', 'solution'], ['move', 'climb'], ['take', 'bring'], ['send', 'bring'],
    ['noise', 'quiet'], ['break', 'cut'], ['far away', 'below'], ['cheap', 'expensive'], ['rich', 'expensive'],
    ['difficult', 'simple'], ['decide', 'guess'], ['walk', 'across'], ['leave', 'return'], ['arrive', 'return'], ['arrive', 'leave'],
    ['journey', 'way']];
  const items = sophia().flatMap(t => t.items), uk = Object.fromEntries(items.map(it => [it.q, it.right]));
  for (const group of alike) for (const a of group) for (const b of group) {
    if (a === b) continue;
    assert.ok(!items.find(it => it.q === a).wrong.includes(uk[b]), `${a} → ${uk[b]}`);
    assert.ok(!items.find(it => it.right === a).wrong.includes(b), `${uk[a]} → ${b}`);
  }
});

/* ---------- the rules ---------- */
test('a broken file says what to fix', () => {
  const item = extra => ({ items: [{ q: 'a', right: 'б', wrong: ['в', 'г', 'ґ'], ...extra }] });
  for (const [data, message] of [
    [null, /list of questions/], [{ items: [] }, /list of questions/],
    [item({ q: ' ' }), /question 1 needs q/], [item({ right: '' }), /question 1 needs right/],
    [item({ wrong: ['в', 'г'] }), /question 1 needs at least 3 wrong/],
    [item({ wrong: ['в', 'г', 'б'] }), /question 1 repeats an answer/],
    [item({ wrong: ['в', 'в', 'г'] }), /question 1 repeats an answer/],
    [item({ hint: 5 }), /question 1: hint/], [item({ hint: 'No mark.' }), /question 1: hint/],
    [item({ hint: 'Two [a] marks [a].' }), /question 1: hint/], [item({ hint: 'Wrong [word].' }), /question 1: hint/],
    [{ items: [...item().items, ...item().items] }, /question 2 repeats/],
  ]) assert.throws(() => core.validate(data, 'file'), message);
  for (const data of [null, {}, { tests: [1, 1] }, { tests: ['../me'] }, { tests: [0] }]) {
    assert.throws(() => core.validateIndex(data), /tests\/index\.json/);
  }
  assert.deepEqual(core.validateIndex({ tests: [] }).tests, []);
  assert.deepEqual(core.validateIndex({ passRating: 5, tests: [2] }).tests, [2], 'an old index still works');
});

test('a card has four different options with the right one among them', () => {
  const it = core.validate({ items: [{ q: 'a', right: 'б', wrong: ['в', 'г', 'ґ', 'д', 'е'] }] }, 'file').items[0];
  const places = new Set(), seen = new Set();
  for (let seed = 1; seed < 80; seed++) {
    const options = core.choices(it, seeded(seed));
    assert.equal(new Set(options).size, 4);
    assert.ok(options.includes('б'));
    places.add(options.indexOf('б'));
    options.forEach(o => seen.add(o));
  }
  assert.equal(places.size, 4);
  assert.equal(seen.size, 6, 'all wrong answers get used');
});

test('a pass asks every card once in the order of the file, mistakes or not, and then it is over', () => {
  const data = deck(6), p = core.reconcile(null, data);
  assert.equal(core.next(p, data), 0);
  assert.deepEqual(play(p, data, i => (i === 2 || i === 5 ? 'w' : 'r')), range(0, 5));
  assert.equal(core.over(p, data), true);
  const sc = core.score(p, data);
  assert.deepEqual([sc.right, sc.wrong, core.fmt(sc.rating)], [4, 2, '3.3']);
  core.finish(p, data);
  assert.deepEqual(p, { marks: {}, log: [], last: 5 * 4 / 6 }, 'the rating stays for the list; the next pass starts clean');
  assert.equal(core.next(p, data), 0);
});

test('the rating is only a number: one mistake in 42 is 4.8 and the pass still ends', () => {
  const data = deck(42), p = core.reconcile(null, data);
  assert.equal(play(p, data, i => (i === 41 ? 'w' : 'r')).length, 42);
  assert.equal(core.fmt(core.score(p, data).rating), '4.8');
  assert.equal(core.over(p, data), true);
});

test('a test closed half way goes on from the next card, even after the file changed', () => {
  const data = deck(5), p = core.reconcile(null, data);
  play(p, data, i => (i === 1 ? 'w' : 'r'), 3);
  const back = core.reconcile(JSON.parse(JSON.stringify(p)), data);
  assert.equal(core.next(back, data), 3);
  assert.deepEqual(back.log, [{ key: data.items[1].key, chosen: 'а' }]);
  // A card put in before the place is asked first, then the pass goes on where it stopped.
  const edited = core.validate({ items: [data.items[0], { q: 'new', right: 'нове', wrong: ['а', 'б', 'в'] }, ...data.items.slice(1)]
    .map(({ q, right, wrong }) => ({ q, right, wrong })) }, 'file');
  const later = core.reconcile(JSON.parse(JSON.stringify(p)), edited);
  assert.deepEqual(play(later, edited), [1, 4, 5]);
});

test('a right answer after turning the card over is a right answer like any other', () => {
  const data = deck(3), p = core.reconcile(null, data);
  play(p, data, i => (i === 1 ? 'h' : 'r'));
  assert.deepEqual(Object.values(p.marks), ['r', 'r', 'r']);
  assert.equal(core.fmt(core.score(p, data).rating), '5.0');
  assert.deepEqual(p.log, [{ key: data.items[1].key, hint: true }]);
});

test('progress of the first versions keeps the answers of the round in hand only', () => {
  const data = deck(6), keys = data.items.map(it => it.key);
  // Half way through round 2: cards 1–2 are this round's; the marks of cards 4–5 are left from round 1.
  const middle = { marks: { [keys[0]]: 'r', [keys[1]]: 'h', [keys[3]]: 'w', [keys[4]]: 'r' }, pos: 2, round: 2,
    log: [{ key: keys[1], hint: true }, { key: keys[3], chosen: 'а' }], passed: false };
  assert.deepEqual(core.reconcile(middle, data), { marks: { [keys[0]]: 'r', [keys[1]]: 'r' }, log: [{ key: keys[1], hint: true }], last: null });
  // A round answered to the end but closed before its result: the result comes first.
  const ended = core.reconcile({ marks: Object.fromEntries(keys.map(k => [k, 'r'])), pos: 6, round: 1, log: [] }, data);
  assert.equal(core.over(ended, data), true);
  // Passed and started again: a clean test, and the passed rating shows in the list.
  assert.deepEqual(core.reconcile({ marks: {}, pos: 0, round: 0, log: [], passed: true }, data), { marks: {}, log: [], last: 5 });
  // The very first version shuffled the cards: its place means nothing.
  const shuffled = { marks: { [keys[4]]: 'r', [keys[2]]: 'w' }, order: [4, 2, 3, 0, 5, 1].map(i => keys[i]), pos: 3, round: 2,
    log: [{ key: keys[2], chosen: 'а' }], hinted: keys[0] };
  assert.deepEqual(core.reconcile(shuffled, data), { marks: {}, log: [], last: null });
  for (const junk of [null, 5, 'x', { marks: 1, log: 4, last: 9 }, { marks: { constructor: 'r' }, log: [{ key: 'constructor' }] }]) {
    assert.deepEqual(core.reconcile(junk, data), { marks: {}, log: [], last: null });
  }
});

test('the mix takes 20 different words from all the tests, each once and one way, new every time', () => {
  const tests = sophia(), all = new Set(tests.flatMap(t => core.wordList(t).map(w => w.word)));
  const sets = new Set();
  for (let seed = 1; seed <= 6; seed++) {
    const { items } = core.mix(tests, seeded(seed));
    assert.equal(items.length, 20);
    const words = items.map(it => (all.has(it.q) ? it.q : it.right));
    assert.equal(new Set(words).size, 20, 'no word twice, not even the other way round');
    assert.ok(words.every(w => all.has(w)));
    assert.ok(items.every(it => tests.some(t => t.items.includes(it))), 'cards as they are in the tests');
    sets.add(words.slice().sort().join());
  }
  assert.equal(sets.size, 6);
  const ways = core.mix(tests, seeded(9), Infinity).items;
  assert.equal(ways.length, all.size);
  assert.ok(ways.some(it => all.has(it.q)) && ways.some(it => all.has(it.right)), 'both ways come up');
  assert.equal(core.mix([{ items: deck(3).items }], seeded(1)).items.length, 3, 'fewer words than 20: all of them');
});

test('the word list of a test has each word once, the English side first', () => {
  const data = core.validate({ items: [
    { q: 'castle', right: 'замок', wrong: ['а', 'б', 'в'] }, { q: 'дах', right: 'roof', wrong: ['а', 'б', 'в'] },
    { q: 'замок', right: 'castle', wrong: ['а', 'б', 'в'] }, { q: 'roof', right: 'дах', wrong: ['а', 'б', 'в'] }] }, 'file');
  assert.deepEqual(core.wordList(data), [{ word: 'castle', translation: 'замок' }, { word: 'roof', translation: 'дах' }]);
  assert.deepEqual([1, 2, 4, 5, 11, 20, 21, 22, 24, 25].map(core.words),
    ['1 слово', '2 слова', '4 слова', '5 слів', '11 слів', '20 слів', '21 слово', '22 слова', '24 слова', '25 слів']);
});

test('the report names the rating, the mistakes with the chosen answer, and the hints', () => {
  const data = deck(3), p = core.reconcile(null, data), [a, b] = data.items;
  play(p, data, i => ['w', 'h', 'r'][i]);
  const text = core.report(p, data);
  assert.match(text, /^Рейтинг 3\.3 з 5\nПравильно: 2 з 3/);
  assert.ok(text.includes(`Помилки:\n• ${a.q} → ${a.right} (обрано: а)`), text);
  assert.ok(text.includes(`З підказкою:\n• ${b.q} → ${b.right}`), text);
  const clean = core.reconcile(null, data);
  play(clean, data);
  assert.equal(core.report(clean, data), 'Рейтинг 5.0 з 5\nПравильно: 3 з 3');
});

/* ---------- the page ---------- */
async function open({ profile = { id: 'sophia', name: 'Sophia', reports: true }, storage = {}, files, reply = { ok: true }, random = () => 0.999 } = {}) {
  const small = files || {
    'users/sophia/tests/index.json': { tests: [1, 2] },
    'users/sophia/tests/1/test.json': { items: [{ q: 'old', right: 'старий', wrong: ['а', 'б', 'в'] }] },
    'users/sophia/tests/2/test.json': { items: [
      { q: 'castle', right: 'замок', wrong: ['квиток', 'пором', 'дах'], hint: 'The king lives in a [castle].' },
      { q: 'дах', right: 'roof', wrong: ['ferry', 'coach', 'ticket'], hint: 'The cat is on the [roof].' }] },
  };
  const reports = [], timers = [], requested = [];
  const element = () => {
    const el = { style: {}, dataset: {}, attrs: {}, classes: new Set(), kids: new Map(), lists: new Map(), textContent: '', hidden: false, disabled: false,
      addEventListener() {}, focus() {}, remove() { el.removed = true; }, appendChild(child) { el.child = child; },
      setAttribute(k, v) { el.attrs[k] = String(v); }, getAttribute: k => el.attrs[k] ?? null, removeAttribute(k) { delete el.attrs[k]; },
      click() { if (!el.disabled && el.onclick) el.onclick({ target: el }); },
      get className() { return [...el.classes].join(' '); }, set className(v) { el.classes = new Set(v.split(' ').filter(Boolean)); },
      set innerHTML(html) {
        el.html = html; el.kids = new Map(); el.lists = new Map();
        for (const [tag, id] of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) { const kid = element(); kid.hidden = /\shidden/.test(tag); el.kids.set('#' + id, kid); }
        for (const attr of ['data-test', 'data-info', 'data-o']) {
          el.lists.set(`[${attr}]`, [...html.matchAll(new RegExp(`<[^>]*${attr}="([^"]+)"[^>]*>`, 'g'))].map(([, v]) => {
            const kid = element(); kid.dataset[attr.slice(5)] = v; return kid;
          }));
        }
      },
      get innerHTML() { return el.html || ''; },
      querySelector(sel) { for (const part of sel.split(',')) { const hit = find(el, part.trim()); if (hit) return hit; } return null; },
      querySelectorAll(sel) { return [...(el.lists.get(sel) || []), ...[...el.kids.values()].flatMap(k => k.querySelectorAll(sel))]; } };
    el.classList = { add: c => el.classes.add(c), remove: c => el.classes.delete(c), contains: c => el.classes.has(c),
      toggle: (c, on = !el.classes.has(c)) => { on ? el.classes.add(c) : el.classes.delete(c); return on; } };
    return el;
  };
  function find(el, sel) {
    if (el.kids.has(sel)) return el.kids.get(sel);
    for (const kid of el.kids.values()) { const hit = find(kid, sel); if (hit) return hit; }
    return null;
  }
  const host = element(), body = element();
  const context = vm.createContext({
    console, URLSearchParams, location: { search: '?user=sophia', href: '' },
    document: { getElementById: () => host, createElement: element, body, addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    localStorage: { getItem: k => storage[k] ?? null, setItem: (k, v) => { storage[k] = String(v); } },
    Math: Object.assign(Object.create(Math), { random }),
    setTimeout: fn => timers.push(fn), clearTimeout: id => { timers[id - 1] = null; },
    WORKER_URL: '/report',
    fetch: async (url, options) => {
      if (options?.method === 'POST') { reports.push(JSON.parse(options.body)); return reply; }
      const file = String(url).split('?')[0];
      requested.push(file);
      if (!(file in small)) return { ok: false, status: 404 };
      return { ok: true, json: async () => small[file] };
    },
  });
  context.window = context;
  context.Profiles = { current: profile, userId: 77, require: async () => profile, content: f => `users/${profile.id}/${f}`,
    url: f => f, refuse: () => false, empty: (h, title, message) => { h.innerHTML = `<p>${message}</p>`; } };
  for (const file of ['app.js', 'tenses-core.js', 'test-cards-core.js', 'test-cards.js', 'test.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'assets/js', file), 'utf8'), context);
  }
  const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
  await tick();
  return { host, body, reports, requested, storage, tick,
    async tap(sel) { host.querySelector(sel).click(); await tick(); },
    start(n) { host.querySelectorAll('[data-test]')[n].click(); },
    info(n) { host.querySelectorAll('[data-info]')[n].click(); },
    option(text) { return host.querySelectorAll('[data-o]')[host.querySelector('#tcOptions').innerHTML.split('data-o').slice(1).findIndex(s => s.includes(`>${text}<`))]; },
    async run() { const list = timers.splice(0); for (const fn of list) if (fn) fn(); await tick(); },
    q: () => host.querySelector('#tcWord').textContent };
}
const ANSWER = { castle: ['замок', 'пором'], дах: ['roof', 'ferry'], old: ['старий', 'а'] };
const KEY = 'umbrello.tests.v1.77.sophia';

test('the list: tests by number, the newest first, all open, each with ⓘ; the mix above them', async () => {
  const app = await open({ files: {
    'users/sophia/tests/index.json': { tests: [2, 10, 1] },
    ...Object.fromEntries([1, 2, 10].map(n => [`users/sophia/tests/${n}/test.json`, { items: [{ q: `w${n}`, right: `с${n}`, wrong: ['а', 'б', 'в'] }] }])),
  } });
  const html = app.host.innerHTML;
  assert.deepEqual(app.host.querySelectorAll('[data-test]').map(b => b.dataset.test), ['10', '2', '1']);
  assert.deepEqual(app.host.querySelectorAll('[data-info]').map(b => b.dataset.info), ['10', '2', '1']);
  assert.ok(html.indexOf('id="tcMix"') < html.indexOf('data-test='));
  assert.match(html, /<b>Тест 10<\/b><span>1 слово<\/span>/);
  assert.match(html, /<b>Мікс<\/b><span>3 слова з усіх тестів/);
  assert.doesNotMatch(html, /locked|disabled|складено|passRating/);
});

test('ⓘ shows the words of the test without opening it', async () => {
  const app = await open();
  app.info(0);
  const sheet = app.body.child;
  assert.ok(sheet, 'a sheet opens');
  assert.match(sheet.innerHTML, /<h2>Тест 2<\/h2><p class="sub">2 слова<\/p>/);
  assert.match(sheet.innerHTML, /<b lang="en">castle<\/b>\s*<span lang="uk">замок<\/span>/);
  assert.match(sheet.innerHTML, /<b lang="en">roof<\/b>\s*<span lang="uk">дах<\/span>/, 'the English side first');
  assert.match(app.host.innerHTML, /data-test=/, 'still the list');
  sheet.querySelector('#tcWordsClose').click();
  assert.equal(sheet.removed, true);
});

test('the card flips to a sentence by a tap; an answer after that counts and nothing marks it', async () => {
  const app = await open();
  app.start(0);
  const card = app.host.querySelector('#tcCard');
  assert.equal(card.classList.contains('flipped'), false);
  card.click();
  assert.equal(card.classList.contains('flipped'), true);
  assert.equal(app.host.querySelector('#tcHint').innerHTML, 'The king lives in a <b>castle</b>.');
  card.click();
  assert.equal(card.classList.contains('flipped'), false, 'a second tap turns it back');
  app.option('замок').click();
  assert.equal(app.host.querySelector('#tcRight').textContent, 1);
  assert.match(app.host.querySelector('#tcProgress').innerHTML, /^<i class="r"><\/i>/);
  await app.run();
  app.option('roof').click();
  await app.run();
  assert.match(app.host.innerHTML, /Тест 2: готово/);
  assert.match(app.reports[0].text, /З підказкою/, 'only the teacher sees it');
});

test('a pass goes to the end whatever the mistakes, reports once, and starts again from the first card', async () => {
  const storage = {}, app = await open({ storage });
  app.start(0);
  app.option('пором').click();
  app.host.querySelector('#tcNext').click();
  assert.equal(app.q(), 'дах');
  app.option('roof').click();
  await app.run();
  assert.equal(app.reports.length, 1);
  assert.equal(app.reports[0].title, '📝 Тест 2');
  assert.match(app.reports[0].text, /Рейтинг 2\.5 з 5\nПравильно: 1 з 2\n\nПомилки:\n• castle → замок \(обрано: пором\)/);
  assert.match(app.host.innerHTML, /<div class="big">2\.5<\/div>/);
  assert.match(app.host.innerHTML, /id="tcAgain"[^>]*>Пройти ще раз</);
  assert.doesNotMatch(app.host.innerHTML, /id="tcGo"/);
  await app.tap('#tcAgain');
  assert.equal(app.q(), 'castle');
  assert.equal(app.host.querySelector('#tcRight').textContent, 0, 'a new pass starts clean');
  assert.match(app.host.querySelector('#tcProgress').innerHTML, /^<i class=" cur"><\/i><i class=""><\/i>$/);
  await app.tap('#tcBack');
  assert.match(app.host.innerHTML, /data-test="2"[\s\S]*?tn-status"><span class="tn-ico"[\s\S]*?<\/span>2\.5<\/span>/, 'the last rating in the list');
  const again = await open({ storage });
  assert.match(again.host.innerHTML, /2\.5/, 'and after the app is opened again');
});

test('a test closed half way opens on the next card, and the list shows how far it got', async () => {
  const storage = {}, app = await open({ storage });
  app.start(0);
  app.option('пором').click();
  const back = await open({ storage });
  assert.match(back.host.innerHTML, /data-test="2"[\s\S]*?tn-status">1\/2</);
  back.start(0);
  assert.equal(back.q(), 'дах');
  assert.match(back.host.querySelector('#tcProgress').innerHTML, /^<i class="w"><\/i><i class=" cur"><\/i>$/);
  back.option('roof').click();
  await back.run();
  assert.match(back.reports[0].text, /Помилки:\n• castle → замок \(обрано: пором\)/, 'the mistake from before is in the report');
});

test('a pass closed right after its last answer still reports when the test is opened again', async () => {
  const storage = {}, app = await open({ storage });
  app.start(0);
  app.option(ANSWER[app.q()][0]).click();
  await app.run();
  app.option(ANSWER[app.q()][1]).click();
  assert.equal(app.reports.length, 0);
  const again = await open({ storage });
  again.start(0);
  await again.tick();
  assert.equal(again.reports.length, 1);
  assert.match(again.host.innerHTML, /Тест 2: готово/);
  await again.tap('#tcAgain');
  assert.equal(again.q(), 'castle');
});

test('progress saved by the old version goes on from its place', async () => {
  const key = 'castle → замок', storage = { [KEY]: JSON.stringify({ tests: { 2: { marks: { [key]: 'w' }, pos: 1, round: 3, log: [{ key, chosen: 'дах' }], passed: false } } }) };
  const app = await open({ storage });
  app.start(0);
  assert.equal(app.q(), 'дах');
});

test('the mix: one tap, no question, 20 words from every test, nothing saved, reported, and new each time', async () => {
  const storage = {}, app = await open({ storage });
  app.start(0);
  app.option('замок').click();
  const saved = storage[KEY];
  await app.tap('#tcBack');
  await app.tap('#tcMix');
  assert.equal(app.host.querySelector('#tcScreen') !== null, true);
  assert.match(app.host.innerHTML, /<h2>Мікс<\/h2>/);
  const asked = [];
  for (let i = 0; i < 3; i++) {
    asked.push(app.q());
    app.option(ANSWER[app.q()][0]).click();
    await app.run();
  }
  assert.deepEqual(asked.slice().sort(), ['old', 'roof', 'дах'].includes(asked[2]) ? asked.slice().sort() : null);
  assert.equal(new Set(asked.map(q => ({ castle: 'castle', дах: 'roof', old: 'old', roof: 'roof', замок: 'castle' })[q] || q)).size, 3, 'a word from each test');
  assert.match(app.host.innerHTML, /Мікс: готово/);
  assert.equal(storage[KEY], saved, 'the mix keeps nothing');
  assert.equal(app.reports.at(-1).title, '🎲 Мікс');
  assert.match(app.reports.at(-1).text, /^Учень: Sophia\n\nРейтинг 5\.0 з 5\nПравильно: 3 з 3$/);
  await app.tap('#tcAgain');
  assert.match(app.host.innerHTML, /<h2>Мікс<\/h2>/);
  assert.equal(app.host.querySelector('#tcRight').textContent, 0, 'a new mix');
  await app.tap('#tcBack');
  app.start(0);
  assert.equal(app.q(), 'дах', 'the test itself is where it was');
});

test('the sentence hides the word that is asked for until the answer, and the next card never shows its sentence early', async () => {
  const app = await open();
  app.start(0);
  const hint = () => app.host.querySelector('#tcHint').innerHTML;
  assert.equal(hint(), '');
  app.host.querySelector('#tcCard').click();
  assert.match(hint(), /castle/);
  app.option('замок').click();
  await app.run();
  assert.equal(app.q(), 'дах', 'in the order of the file');
  assert.equal(app.host.querySelector('#tcCard').classList.contains('flipped'), false);
  assert.equal(hint(), '');
  app.host.querySelector('#tcCard').click();
  assert.match(hint(), /on the <span class="tc-gap">_+<\/span>\./);
  assert.doesNotMatch(hint() + app.host.querySelector('#tcCard').getAttribute('aria-label'), /roof/);
  app.option('ferry').click();
  assert.match(hint(), /on the <b>roof<\/b>\./, 'filled in after the answer');
});

test('a right answer moves on by itself with no button; only a wrong one has «Далі»', async () => {
  const app = await open();
  app.start(0);
  app.option('замок').click();
  assert.doesNotMatch(app.host.querySelector('#tcGoBox').innerHTML, /button/);
  await app.run();
  assert.equal(app.q(), 'дах');
  app.option('ferry').click();
  assert.match(app.host.querySelector('#tcGoBox').innerHTML, /id="tcNext"[^>]*>Далі</);
});

test('nothing on the screens explains the hint: no sheet, no label, no note, only the turn icon on the card', async () => {
  const app = await open();
  app.start(0);
  const screens = [app.host.innerHTML];
  assert.equal(app.body.child, undefined, 'no sheet opens');
  assert.match(app.host.innerHTML, /id="tcTurn"[^>]*><span class="tn-ico"/);
  app.host.querySelector('#tcCard').click();
  screens.push(app.host.querySelector('#tcCard').getAttribute('aria-label'));
  app.option('замок').click();
  await app.run();
  app.option('ferry').click();
  app.host.querySelector('#tcNext').click();
  assert.match(app.host.innerHTML, /готово/);
  assert.doesNotMatch(app.host.innerHTML, /tc-turn/);
  screens.push(app.host.innerHTML);
  for (const html of screens) assert.doesNotMatch(html, /підказк|Як це працює|повернеться/i);
});

test('one try per card: a wrong answer shows the right one, waits, and cannot be changed', async () => {
  const app = await open();
  app.start(0);
  const q = app.q(), [right, wrong] = ANSWER[q];
  app.option(wrong).click();
  assert.ok(app.option(wrong).classList.contains('wrong'));
  assert.ok(app.option(right).classList.contains('right'));
  app.option(right).click();
  assert.equal(app.host.querySelector('#tcWrong').textContent, 1);
  await app.run();
  assert.equal(app.q(), q, 'waits for the button');
  app.host.querySelector('#tcNext').click();
  assert.notEqual(app.q(), q);
});

test('progress is kept per account and profile, and a failed report can be sent again', async () => {
  const storage = {}, app = await open({ storage, reply: { ok: false, status: 500, json: async () => ({}) } });
  app.start(1);
  app.option('старий').click();
  await app.run();
  assert.deepEqual(Object.keys(storage), [KEY]);
  const retry = app.host.querySelector('#tcRetry');
  assert.equal(retry.style.display, 'block');
  retry.click();
  await app.tick();
  assert.equal(app.reports.length, 2);
});

test('reports: false sends nothing, from a test or the mix', async () => {
  const quiet = await open({ profile: { id: 'sophia', name: 'Sophia', reports: false } });
  quiet.start(1);
  quiet.option('старий').click();
  await quiet.run();
  await quiet.tap('#tcMenu');
  await quiet.tap('#tcMix');
  for (let i = 0; i < 3; i++) { quiet.option(ANSWER[quiet.q()][0]).click(); await quiet.run(); }
  assert.match(quiet.host.innerHTML, /Мікс: готово/);
  assert.equal(quiet.reports.length, 0);
});

test('any profile opens its own folders; a card without a sentence does not turn and asks by its answers', async () => {
  const long = 'Що означає «compelling» у реченні «She put forward a compelling argument for reform»?';
  const storage = {}, me = await open({ storage, profile: { id: 'me', name: 'me', reports: false }, files: {
    'users/me/tests/index.json': { tests: [1] },
    'users/me/tests/1/test.json': { items: [{ q: long, right: 'переконливий', wrong: ['а', 'б', 'такий, що викликає суперечки'] }] } } });
  assert.deepEqual(me.requested, ['users/me/tests/index.json', 'users/me/tests/1/test.json']);
  me.start(0);
  const card = me.host.querySelector('#tcCard');
  assert.equal(card.disabled, true);
  card.onclick();
  assert.equal(card.classList.contains('flipped'), false);
  assert.ok(me.host.querySelector('#tcWord').classList.contains('long'));
  assert.ok(me.host.querySelector('#tcOptions').classList.contains('long'));
  assert.equal(me.host.querySelector('#tcAsk').textContent, 'Обери переклад');
  me.option('переконливий').click();
  await me.run();
  assert.match(me.host.innerHTML, /готово/);
  assert.equal(me.reports.length, 0);
  assert.deepEqual(Object.keys(storage), ['umbrello.tests.v1.77.me']);
  const short = await open();
  short.start(0);
  assert.equal(short.host.querySelector('#tcAsk').textContent, short.q() === 'дах' ? 'Як це англійською?' : 'Обери переклад');
  assert.equal(short.host.querySelector('#tcWord').classList.contains('long'), false);
});

test('an empty list and a missing folder are shown plainly', async () => {
  const none = await open({ files: { 'users/sophia/tests/index.json': { tests: [] } } });
  assert.match(none.host.innerHTML, /поки немає/);
  const missing = await open({ files: { 'users/sophia/tests/index.json': { tests: [1] } } });
  assert.match(missing.host.innerHTML, /Could not load/);
});

test('test.html loads the rating rules before the cards and the cards before the page', () => {
  const html = fs.readFileSync(path.join(root, 'test.html'), 'utf8');
  const at = ['tenses-core.js', 'test-cards-core.js', 'test-cards.js', 'test.js'].map(f => html.indexOf(`assets/js/${f}?`));
  assert.ok(at.every(i => i > 0));
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
  for (const css of ['tenses.css', 'test-cards.css']) assert.ok(html.includes(`assets/css/${css}?`), css);
});
