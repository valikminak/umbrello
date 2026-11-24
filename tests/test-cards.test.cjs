const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../assets/js/test-cards-core.js');
const root = path.join(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const seeded = start => { let seed = start * 7919 + 12345; return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; };
const deck = n => core.validate({ title: 'Тест', desc: 'Слова', items: Array.from({ length: n }, (_, i) => (
  { q: `word${i}`, right: `слово${i}`, wrong: ['а', 'б', 'в'], emoji: '🏰' })) }, 'file');

// Answers the whole round; what(key, i) says how each card goes: "r", "w" or "h" (right, but with the hint).
function playRound(p, what) {
  const keys = p.order.slice();
  keys.forEach((key, i) => core.answer(p, what(key, i) !== 'w', what(key, i) === 'h'));
  return keys;
}

test('every profile keeps its tests in numbered folders with valid files', () => {
  for (const { id } of read('users/index.json')) {
    const index = core.validateIndex(read(`users/${id}/tests/index.json`));
    assert.equal(index.passRating, 5, id);
    assert.ok(index.tests.length, id);
    for (const n of index.tests) core.validate(read(`users/${id}/tests/${n}/test.json`), `${id} ${n}`);
  }
  const me = core.validate(read('users/me/tests/1/test.json'), 'me 1');
  assert.equal(me.items.length, 24);
  assert.equal(me.items[0].right, 'переконливий');
});

// The translations of the exam book's vocabulary list; "building" is not in it.
const BOOK = { receive: 'отримувати', building: 'будівля', castle: 'замок, фортеця', cathedral: 'собор', ceiling: 'стеля',
  church: 'церква', roof: 'дах', customers: 'клієнти, покупці', 'go camping': 'ходити в походи',
  'go sightseeing': 'ходити на екскурсії, оглядати визначні місця', coach: 'автобус', ferry: 'паром', flight: 'політ, переліт',
  ticket: 'квиток', carpet: 'килим', 'chest of drawers': 'комод', cupboard: 'кухонна шафа', curtains: 'штори',
  cushion: 'диванна подушка', 'read magazines': 'читати журнали', 'write a diary': 'вести щоденник' };

test('Sophia’s test 1 asks each of the 21 words both ways, translated as in the exam book, with its own emoji hint', () => {
  const words = Object.keys(BOOK);
  const { items } = core.validate(read('users/sophia/tests/1/test.json'), 'test 1');
  assert.equal(items.length, words.length * 2);
  const emoji = new Set();
  for (const word of words) {
    const there = items.find(it => it.q === word), back = items.find(it => it.right === word);
    assert.ok(there && back, word);
    assert.equal(there.right, BOOK[word], word);
    assert.equal(back.q, BOOK[word], word);
    assert.ok(there.emoji, word);
    assert.equal(there.emoji, back.emoji, word);
    emoji.add(there.emoji);
  }
  assert.equal(emoji.size, words.length, 'no two words share a hint');
});

test('test 1 never offers a word that could be confused with the answer', () => {
  const alike = [['building', 'castle', 'cathedral', 'church'], ['ceiling', 'roof'], ['cupboard', 'chest of drawers'],
    ['carpet', 'curtains', 'cushion'], ['coach', 'ferry', 'flight'], ['flight', 'ticket'],
    ['go camping', 'go sightseeing'], ['read magazines', 'write a diary']];
  const { items } = core.validate(read('users/sophia/tests/1/test.json'), 'test 1');
  const uk = Object.fromEntries(items.map(it => [it.q, it.right]));
  for (const group of alike) for (const a of group) for (const b of group) {
    if (a === b) continue;
    assert.ok(!items.find(it => it.q === a).wrong.includes(uk[b]), `${a} → ${b}`);
    assert.ok(!items.find(it => it.right === a).wrong.includes(b), `${uk[a]} → ${b}`);
  }
});

test('a broken file says what to fix', () => {
  const item = extra => ({ title: 'T', desc: 'D', items: [{ q: 'a', right: 'б', wrong: ['в', 'г', 'ґ'], ...extra }] });
  for (const [data, message] of [
    [null, /add a title/], [{ title: 'T', desc: 'D', items: [] }, /list of questions/],
    [item({ q: ' ' }), /question 1 needs q/], [item({ right: '' }), /question 1 needs right/],
    [item({ wrong: ['в', 'г'] }), /question 1 needs at least 3 wrong/],
    [item({ wrong: ['в', 'г', 'б'] }), /question 1 repeats an answer/],
    [item({ wrong: ['в', 'в', 'г'] }), /question 1 repeats an answer/],
    [item({ emoji: 5 }), /question 1: emoji/],
    [{ title: 'T', desc: 'D', items: [...item().items, ...item().items] }, /question 2 repeats/],
  ]) assert.throws(() => core.validate(data, 'file'), message);
  for (const data of [null, {}, { passRating: 6, tests: [1] }, { passRating: 5, tests: [1, 1] }, { passRating: 5, tests: ['../me'] }, { passRating: 5, tests: [0] }]) {
    assert.throws(() => core.validateIndex(data), /tests\/index\.json/);
  }
  assert.deepEqual(core.validateIndex({ passRating: 5, tests: [] }).tests, []);
});

test('a card has four different options with the right one among them', () => {
  const it = core.validate({ title: 'T', desc: 'D', items: [{ q: 'a', right: 'б', wrong: ['в', 'г', 'ґ', 'д', 'е'] }] }, 'file').items[0];
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

test('the first round has every card, the next ones only the cards not yet right, until 5.0', () => {
  const data = deck(6), p = core.reconcile(null, data);
  core.newRound(p, data, seeded(3));
  assert.equal(p.round, 1);
  const first = playRound(p, (_, i) => (i === 1 ? 'w' : i === 4 ? 'h' : 'r'));
  assert.deepEqual([...first].sort(), data.items.map(it => it.key).sort());
  assert.ok(core.roundOver(p));
  let sc = core.score(p, data);
  assert.deepEqual([sc.right, sc.wrong, sc.hinted, sc.total], [4, 1, 1, 6]);
  assert.equal(core.passed(sc, 5), false);

  core.newRound(p, data, seeded(4));
  assert.equal(p.round, 2);
  assert.deepEqual([...p.order].sort(), [first[1], first[4]].sort());
  playRound(p, (_, i) => (i === 0 ? 'w' : 'r'));
  core.newRound(p, data, seeded(5));
  assert.equal(p.order.length, 1);
  playRound(p, () => 'r');
  sc = core.score(p, data);
  assert.equal(core.fmt(sc.rating), '5.0');
  assert.equal(core.passed(sc, 5), true);
});

test('one card short of all is 4.8, never 5.0, and an answer with the hint does not count', () => {
  const data = deck(42), p = core.reconcile(null, data);
  core.newRound(p, data, seeded(1));
  playRound(p, (_, i) => (i === 0 ? 'h' : 'r'));
  const sc = core.score(p, data);
  assert.equal(core.fmt(sc.rating), '4.8');
  assert.equal(core.passed(sc, 5), false);
});

test('the same card never opens the next round right after it closed the last one, unless it is the only one', () => {
  const data = deck(5);
  for (let seed = 1; seed < 60; seed++) {
    const p = core.reconcile(null, data);
    core.newRound(p, data, seeded(seed));
    const last = playRound(p, () => 'w').at(-1);
    core.newRound(p, data, seeded(seed + 100));
    assert.notEqual(p.order[0], last, `seed ${seed}`);
  }
});

test('progress survives an edited file: removed cards leave, new ones wait for the next round', () => {
  const data = deck(4), p = core.reconcile(null, data);
  core.newRound(p, data, seeded(2));
  core.answer(p, true, false);
  const saved = JSON.parse(JSON.stringify(p));
  const edited = deck(6);
  edited.items.splice(edited.items.findIndex(it => it.key === saved.order[2]), 1);
  const back = core.reconcile(saved, edited);
  assert.equal(back.pos, 1);
  assert.ok(back.order.every(key => edited.items.some(it => it.key === key)));
  assert.equal(core.score(back, edited).right, 1);
  while (!core.roundOver(back)) core.answer(back, true, false);
  assert.equal(core.passed(core.score(back, edited), 5), false, 'new cards are still to be answered');
  core.newRound(back, edited, seeded(2));
  assert.equal(back.order.length, 2);
  for (const junk of [null, 5, 'x', { marks: 1, order: 'no', pos: -2, log: 4 }]) {
    const clean = core.reconcile(junk, data);
    assert.deepEqual([clean.order, clean.pos, clean.round, clean.passed], [[], 0, 0, false]);
  }
});

test('the report names the rating, the mistakes with the chosen answer, and the hints', () => {
  const data = deck(3), p = core.reconcile(null, data);
  core.newRound(p, data, seeded(9));
  const [a, b] = p.order;
  core.answer(p, false, false, 'б');
  core.answer(p, true, true, 'слово');
  core.answer(p, true, false);
  const item = key => data.items.find(it => it.key === key);
  const text = core.report(p, data, 5);
  assert.match(text, /^Коло 1\. Рейтинг 1\.6 з 5\.0/);
  assert.match(text, /Правильно: 1 з 3/);
  assert.ok(text.includes(`Помилки:\n• ${item(a).q} → ${item(a).right} (обрано: б)`), text);
  assert.ok(text.includes(`З підказкою:\n• ${item(b).q} → ${item(b).right}`), text);
  core.newRound(p, data, seeded(9));
  assert.deepEqual(p.log, []);
  playRound(p, () => 'r');
  assert.match(core.report(p, data, 5), /^Тест складено! Рейтинг 5\.0\. Кіл: 2/);
});

/* ---------- the page ---------- */
async function open({ profile = { id: 'sophia', name: 'Sophia', reports: true }, storage = {}, files, reply = { ok: true }, random = () => 0.999 } = {}) {
  const small = files || {
    'users/sophia/tests/index.json': { passRating: 5, tests: [1, 2] },
    'users/sophia/tests/1/test.json': { title: 'Перший', desc: 'Один', items: [{ q: 'old', right: 'старий', wrong: ['а', 'б', 'в'] }] },
    'users/sophia/tests/2/test.json': { title: 'Другий', desc: 'Два', items: [
      { q: 'castle', right: 'замок', wrong: ['квиток', 'пором', 'дах'], emoji: '🏰' },
      { q: 'дах', right: 'roof', wrong: ['ferry', 'coach', 'ticket'], emoji: '🔺 🏠' }] },
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
        for (const attr of ['data-test', 'data-o']) {
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
    start(n) { host.querySelectorAll('[data-test]')[n].click(); const ok = body.child?.querySelector('#tcClose'); if (ok && !body.child.removed) ok.click(); },
    option(text) { return host.querySelectorAll('[data-o]')[host.querySelector('#tcOptions').innerHTML.split('data-o').slice(1).findIndex(s => s.includes(`>${text}<`))]; },
    async run() { const list = timers.splice(0); for (const fn of list) if (fn) fn(); await tick(); },
    q: () => host.querySelector('#tcWord').textContent };
}
const ANSWER = { castle: ['замок', 'пором'], дах: ['roof', 'ferry'], old: ['старий', 'а'] };

test('Sophia sees numbered tests, the newest first, all open', async () => {
  const app = await open();
  assert.deepEqual(app.requested, ['users/sophia/tests/index.json', 'users/sophia/tests/1/test.json', 'users/sophia/tests/2/test.json']);
  const html = app.host.innerHTML;
  assert.ok(html.indexOf('Другий') < html.indexOf('Перший'));
  assert.doesNotMatch(html, /locked|disabled/);
});

test('the card flips to its emoji by a tap; an answer after that is not counted and the card comes back', async () => {
  const app = await open();
  app.start(0);
  const asked = [app.q()];
  const card = app.host.querySelector('#tcCard');
  assert.equal(card.classList.contains('flipped'), false);
  card.click();
  assert.equal(card.classList.contains('flipped'), true);
  assert.match(app.host.querySelector('#tcEmoji').textContent, /🏰|🏠/);
  card.click();
  assert.equal(card.classList.contains('flipped'), false, 'a second tap turns it back');
  app.option(ANSWER[asked[0]][0]).click();
  assert.equal(app.host.querySelector('#tcRight').textContent, 0);
  await app.run();
  asked.push(app.q());
  app.option(ANSWER[asked[1]][0]).click();
  await app.run();
  assert.equal(app.reports.length, 1);
  assert.match(app.reports[0].title, /Тест 2/);
  assert.match(app.reports[0].text, /З підказкою/);
  assert.match(app.host.innerHTML, /2\.5/);
  await app.tap('#tcGo');
  assert.equal(app.q(), asked[0], 'only the hinted card is left');
});

test('the next card never shows its emoji before it is turned over', async () => {
  const app = await open();
  app.start(0);
  const emoji = () => app.host.querySelector('#tcEmoji').textContent;
  assert.equal(emoji(), '');
  app.host.querySelector('#tcCard').click();
  assert.notEqual(emoji(), '');
  app.option(ANSWER[app.q()][0]).click();
  await app.run();
  assert.equal(app.host.querySelector('#tcCard').classList.contains('flipped'), false);
  assert.equal(emoji(), '');
});

test('a flip is remembered over a reload, so the hint cannot be had for free', async () => {
  const storage = {}, first = await open({ storage });
  first.start(0);
  const q = first.q();
  first.host.querySelector('#tcCard').click();
  const again = await open({ storage });
  again.start(0);
  assert.equal(again.q(), q);
  again.option(ANSWER[q][0]).click();
  assert.equal(again.host.querySelector('#tcRight').textContent, 0);
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

test('5.0 passes the test: it is reported, starred in the list, and can be taken again', async () => {
  const storage = {}, app = await open({ storage });
  app.start(0);
  for (let i = 0; i < 2; i++) { app.option(ANSWER[app.q()][0]).click(); await app.run(); }
  assert.match(app.host.innerHTML, /складено/);
  assert.match(app.reports.at(-1).text, /Тест складено! Рейтинг 5\.0/);
  assert.match(app.reports.at(-1).text, /^Учень: Sophia/);
  await app.tap('#tcMenu');
  assert.match(app.host.innerHTML, /tn-row done/);
  assert.match(app.host.innerHTML, /5\.0/);
  app.start(0);
  assert.equal(app.host.querySelector('#tcRight').textContent, 0, 'a new run starts clean');
  const back = await open({ storage });
  assert.match(back.host.innerHTML, /tn-row done/, 'the star stays during a new run');
});

test('a round closed right after its last answer still reports when the test is opened again', async () => {
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
  assert.match(again.reports[0].text, /Помилки/);
  await again.tap('#tcGo');
  assert.match(again.host.innerHTML, /tcCard/);
});

test('progress is kept per account and profile, and a failed report can be sent again', async () => {
  const storage = {}, app = await open({ storage, reply: { ok: false, status: 500, json: async () => ({}) } });
  app.start(1);
  app.option('старий').click();
  await app.run();
  assert.deepEqual(Object.keys(storage), ['umbrello.tests.v1.77.sophia']);
  const retry = app.host.querySelector('#tcRetry');
  assert.equal(retry.style.display, 'block');
  retry.click();
  await app.tick();
  assert.equal(app.reports.length, 2);
});

test('reports: false sends nothing', async () => {
  const quiet = await open({ profile: { id: 'sophia', name: 'Sophia', reports: false } });
  quiet.start(1);
  quiet.option('старий').click();
  await quiet.run();
  assert.equal(quiet.reports.length, 0);
});

test('any profile opens its own folders; a card without an emoji does not turn and asks by its answers', async () => {
  const long = 'Що означає «compelling» у реченні «She put forward a compelling argument for reform»?';
  const storage = {}, me = await open({ storage, profile: { id: 'me', name: 'me', reports: false }, files: {
    'users/me/tests/index.json': { passRating: 5, tests: [1] },
    'users/me/tests/1/test.json': { title: 'Лексика', desc: 'C1', items: [{ q: long, right: 'переконливий', wrong: ['а', 'б', 'такий, що викликає суперечки'] }] } } });
  assert.deepEqual(me.requested, ['users/me/tests/index.json', 'users/me/tests/1/test.json']);
  me.start(0);
  assert.doesNotMatch(me.body.child.innerHTML, /підказк/i);
  const card = me.host.querySelector('#tcCard');
  assert.equal(card.disabled, true);
  card.onclick();
  assert.equal(card.classList.contains('flipped'), false);
  assert.ok(me.host.querySelector('#tcWord').classList.contains('long'));
  assert.ok(me.host.querySelector('#tcOptions').classList.contains('long'));
  assert.equal(me.host.querySelector('#tcAsk').textContent, 'Обери переклад');
  me.option('переконливий').click();
  await me.run();
  assert.match(me.host.innerHTML, /складено/);
  assert.equal(me.reports.length, 0);
  assert.deepEqual(Object.keys(storage), ['umbrello.tests.v1.77.me']);
  const short = await open();
  short.start(0);
  assert.equal(short.host.querySelector('#tcAsk').textContent, short.q() === 'дах' ? 'Як це англійською?' : 'Обери переклад');
  assert.equal(short.host.querySelector('#tcWord').classList.contains('long'), false);
});

test('an empty list and a missing folder are shown plainly', async () => {
  const none = await open({ files: { 'users/sophia/tests/index.json': { passRating: 5, tests: [] } } });
  assert.match(none.host.innerHTML, /поки немає/);
  const missing = await open({ files: { 'users/sophia/tests/index.json': { passRating: 5, tests: [1] } } });
  assert.match(missing.host.innerHTML, /Could not load/);
});

test('test.html loads the rating rules before the cards and the cards before the page', () => {
  const html = fs.readFileSync(path.join(root, 'test.html'), 'utf8');
  const at = ['tenses-core.js', 'test-cards-core.js', 'test-cards.js', 'test.js'].map(f => html.indexOf(`assets/js/${f}?`));
  assert.ok(at.every(i => i > 0));
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
  for (const css of ['tenses.css', 'test-cards.css']) assert.ok(html.includes(`assets/css/${css}?`), css);
});
