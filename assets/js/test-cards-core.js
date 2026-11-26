/* Card tests (users/<id>/tests/<number>/test.json): file checks, the pass through the cards, the words that go wrong,
   the mixes (choose or write the English word), the repeat of mistakes, report text. Shared by test.html and Node tests.
   The rating is worked out as in Grammar lessons (tenses-core.js) and is only shown: it opens and closes nothing. */
(function (root) {
  "use strict";
  const rules = typeof module !== "undefined" && module.exports ? require("./tenses-core.js") : root.TensesCore;
  const { RIGHT, WRONG, fmt } = rules;
  const MIX_SIZE = 20;
  const filled = value => typeof value === "string" && value.trim() !== "";
  const isObject = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const isUkrainian = text => /[А-Яа-яІіЇїЄєҐґ]/.test(text);

  function shuffled(list, rand) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // 1 слово, 2 слова, 5 слів, 11 слів, 21 слово.
  function words(n) {
    const tens = n % 100, ones = n % 10;
    return `${n} ${tens > 10 && tens < 20 ? "слів" : ones === 1 ? "слово" : ones >= 2 && ones <= 4 ? "слова" : "слів"}`;
  }

  // "The king lives in a [castle]." The marked word must be the question or the answer itself. On the card
  // that asks for it, it is left out (gap), so the sentence helps without giving the answer.
  function parseHint(text, q, right) {
    const parts = /^([^[\]]*)\[([^[\]]+)\]([^[\]]*)$/.exec(text.trim());
    if (!parts) return null;
    const [, before, word, after] = parts, same = other => word.toLowerCase() === other.toLowerCase();
    return same(q) || same(right) ? { before, word, after, gap: same(right) } : null;
  }

  // users/<id>/tests/index.json: the numbers of the folders.
  function validateIndex(data) {
    const fail = problem => { throw new Error(`Check tests/index.json: ${problem}`); };
    if (!isObject(data) || !Array.isArray(data.tests)) fail("add a list of tests.");
    if (data.tests.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(data.tests).size !== data.tests.length) {
      fail("tests must be different folder numbers: 1, 2, 3.");
    }
    return { tests: data.tests.slice() };
  }

  function validate(data, where) {
    const fail = problem => { throw new Error(`Check ${where}: ${problem}`); };
    if (!isObject(data) || !Array.isArray(data.items) || !data.items.length) fail("add a list of questions (items).");
    const keys = new Set();
    const items = data.items.map((item, i) => {
      const at = `question ${i + 1}`;
      for (const name of ["q", "right"]) if (!filled(item?.[name])) fail(`${at} needs ${name}.`);
      if (!Array.isArray(item.wrong) || item.wrong.length < 3 || !item.wrong.every(filled)) fail(`${at} needs at least 3 wrong answers.`);
      const answers = [item.right, ...item.wrong].map(s => s.trim());
      if (new Set(answers.map(s => s.toLowerCase())).size !== answers.length) fail(`${at} repeats an answer.`);
      const hint = item.hint === undefined ? null : filled(item.hint) && parseHint(item.hint, item.q.trim(), answers[0]);
      if (item.hint !== undefined && !hint) fail(`${at}: hint must be a sentence with the question or the answer once in [ ].`);
      // Progress is kept by the question itself, so adding or moving questions does not lose it.
      const key = `${item.q.trim()} → ${answers[0]}`;
      if (keys.has(key)) fail(`${at} repeats "${key}".`);
      keys.add(key);
      return { key, q: item.q.trim(), right: answers[0], wrong: answers.slice(1), hint };
    });
    return { items };
  }

  // A word asked both ways is one word: castle → замок and замок → castle.
  const wordKey = it => [it.q, it.right].map(s => s.toLowerCase()).sort().join("\n");

  // The words of a test for its list (the ⓘ button): each once, in the order of the file, the English side first.
  function wordList(data) {
    const seen = new Map();
    for (const it of data.items) {
      const back = isUkrainian(it.q) && !isUkrainian(it.right);
      if (!seen.has(wordKey(it))) seen.set(wordKey(it), back ? { word: it.right, translation: it.q } : { word: it.q, translation: it.right });
    }
    return [...seen.values()];
  }

  // The right answer and three of the wrong ones, in random order.
  const choices = (item, rand = Math.random) => shuffled([item.right, ...shuffled(item.wrong, rand).slice(0, 3)], rand);

  // Progress of a test: the marks of the pass in hand, what went wrong in it (for the report), and the rating
  // of the last pass, which is only shown in the list. A pass goes through the cards in the order of the file
  // and the next card is the first one without a mark, so a test closed half way goes on from there.
  function reconcile(saved, data) {
    const s = isObject(saved) ? saved : {};
    const at = new Map(data.items.map((it, i) => [it.key, i]));
    // The first versions went round and round until all was right and kept the marks of earlier rounds:
    // only the cards before their place belong to the pass in hand (none, if the cards were shuffled).
    const old = s.pos !== undefined || s.round !== undefined;
    const upTo = !old ? Infinity : s.order === undefined && Number.isSafeInteger(s.pos) ? s.pos : 0;
    const marks = {};
    if (isObject(s.marks)) {
      for (const [key, mark] of Object.entries(s.marks)) {
        if (!(at.get(key) < upTo)) continue;
        // "h", right after the hint, was a mark of its own in the first version.
        if (mark === RIGHT || mark === "h") marks[key] = RIGHT;
        else if (mark === WRONG) marks[key] = WRONG;
      }
    }
    const log = Array.isArray(s.log) ? s.log.filter(m => isObject(m) && typeof m.key === "string" && has(marks, m.key)) : [];
    const last = typeof s.last === "number" && s.last >= 0 && s.last <= 5 ? s.last : old && s.passed === true ? 5 : null;
    return { marks, log, last };
  }

  // The card asked next, or -1 when every card has its answer.
  const next = (p, data) => data.items.findIndex(it => !has(p.marks, it.key));
  const over = (p, data) => next(p, data) < 0;

  // hint: the card was turned over before the answer. It changes nothing but the teacher's report.
  function answer(p, item, ok, hint, chosen) {
    p.marks[item.key] = ok ? RIGHT : WRONG;
    if (!ok) p.log.push({ key: item.key, chosen });
    else if (hint) p.log.push({ key: item.key, hint: true });
  }

  const score = (p, data) => rules.score(data.items.length, p.marks);

  // The end of a pass: its rating stays for the list, and the test starts from the first card next time.
  function finish(p, data) {
    p.last = score(p, data).rating;
    p.marks = {};
    p.log = [];
  }

  /* ---------- the words that go wrong ---------- */
  // weak: { word: right answers in a row since the last mistake }. A mistake anywhere (a test, a mix, a repeat) makes
  // a word weak; two right answers in a row make it right again, as one right answer out of four can be a guess.
  const RIGHTS_TO_LEARN = 2;
  function track(weak, item, ok) {
    const key = wordKey(item);
    if (!ok) weak[key] = 0;
    else if (has(weak, key) && ++weak[key] >= RIGHTS_TO_LEARN) delete weak[key];
  }
  // Saved weak words checked against the tests as they are now. The first time, the mistakes of the passes in hand count.
  function cleanWeak(saved, tests, progress) {
    const known = new Set(tests.flatMap(test => test.items.map(wordKey))), weak = {};
    if (isObject(saved)) {
      for (const [key, n] of Object.entries(saved)) if (known.has(key) && Number.isSafeInteger(n) && n >= 0 && n < RIGHTS_TO_LEARN) weak[key] = n;
      return weak;
    }
    for (const test of tests) for (const it of test.items) if (progress[test.id]?.marks[it.key] === WRONG) weak[wordKey(it)] = 0;
    return weak;
  }

  /* ---------- the mixes ---------- */
  // To write a word, the card shows its Ukrainian side and the English one is typed. Words with no English side
  // (a question about a word, answered in Ukrainian) cannot be written.
  function writeCard(it) {
    const en = !isUkrainian(it.right) ? it.right : !isUkrainian(it.q) ? it.q : null;
    const uk = en === it.right ? it.q : it.right;
    if (!en || !isUkrainian(uk)) return null;
    const hint = it.hint && { ...it.hint, gap: it.hint.word.toLowerCase() === en.toLowerCase() };
    return { key: `${uk} → ${en}`, q: uk, right: en, wrong: [], hint };
  }

  // A mix: up to 20 different words from all the tests, weak words first, the rest at random, in random order.
  // Each word comes once, one way or the other, or written in English (write).
  function mix(tests, { rand = Math.random, size = MIX_SIZE, weak = {}, write = false } = {}) {
    const groups = new Map();
    for (const test of tests) {
      for (const it of test.items) {
        const card = write ? writeCard(it) : it;
        if (!card) continue;
        const key = wordKey(it);
        if (!groups.has(key)) groups.set(key, []);
        if (!groups.get(key).some(other => other.key === card.key)) groups.get(key).push(card);
      }
    }
    const words = shuffled([...groups.keys()], rand), first = words.filter(key => has(weak, key));
    const picked = [...first, ...words.filter(key => !has(weak, key))].slice(0, size);
    const items = shuffled(picked, rand).map(key => { const group = groups.get(key); return group[Math.floor(rand() * group.length)]; });
    return { items, write };
  }

  // The written word is right when it is the word itself: case, spaces and the kind of apostrophe do not matter.
  const plain = text => text.toLowerCase().replace(/[’‘ʼ`´]/g, "'").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  const written = (item, text) => plain(text) === plain(item.right);
  // The first letter and a place for each of the others: "c _ _ _ _ _", "f _ _   _ _ _ _", "l _ _ ' _".
  const mask = word => [...word.trim()].map((ch, i) => (i === 0 ? ch : /\p{L}/u.test(ch) ? "_" : ch)).join(" ");

  // The cards that went wrong in a run, to go through them once more in the same way.
  function mistakes(p, data) {
    const wrong = new Set(p.log.filter(m => !m.hint).map(m => m.key));
    return { items: data.items.filter(it => wrong.has(it.key)), write: data.write === true };
  }

  function report(p, data) {
    const sc = score(p, data), item = key => data.items.find(it => it.key === key);
    const said = data.write ? "написано" : "обрано";
    const line = m => `• ${item(m.key).q} → ${item(m.key).right}${m.chosen ? ` (${said}: ${m.chosen})` : ""}`;
    const list = (title, marks) => (marks.length ? `\n\n${title}:\n${marks.map(line).join("\n")}` : "");
    return `Рейтинг ${fmt(sc.rating)} з 5\nПравильно: ${sc.right} з ${sc.total}`
      + list("Помилки", p.log.filter(m => !m.hint)) + list("З підказкою", p.log.filter(m => m.hint));
  }

  const api = { RIGHT, WRONG, MIX_SIZE, fmt, words, isUkrainian, validateIndex, validate, wordList, choices, reconcile,
    next, over, answer, score, finish, track, cleanWeak, writeCard, mix, written, mask, mistakes, report };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TestCardsCore = api;
})(typeof window !== "undefined" ? window : globalThis);
