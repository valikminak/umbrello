/* Card tests (users/<id>/tests/<number>/test.json): file checks, rounds, scoring, report text.
   Shared by test.html and Node tests. The rating itself is the one Grammar lessons use (tenses-core.js). */
(function (root) {
  "use strict";
  const rules = typeof module !== "undefined" && module.exports ? require("./tenses-core.js") : root.TensesCore;
  // Marks: right, wrong, and right after looking at the hint, which does not count towards the rating.
  const { RIGHT, WRONG, fmt } = rules, HINTED = "h";
  const filled = value => typeof value === "string" && value.trim() !== "";
  const isObject = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);

  function shuffled(list, rand) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // users/<id>/tests/index.json: the numbers of the folders, oldest first.
  function validateIndex(data) {
    const fail = problem => { throw new Error(`Check tests/index.json: ${problem}`); };
    if (!isObject(data) || !Array.isArray(data.tests)) fail("add a list of tests.");
    if (!(data.passRating > 0 && data.passRating <= 5)) fail("passRating must be a number up to 5.");
    if (data.tests.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(data.tests).size !== data.tests.length) {
      fail("tests must be different folder numbers: 1, 2, 3.");
    }
    return { passRating: data.passRating, tests: data.tests.slice() };
  }

  function validate(data, where) {
    const fail = problem => { throw new Error(`Check ${where}: ${problem}`); };
    if (!isObject(data) || !filled(data.title) || !filled(data.desc)) fail("add a title and desc.");
    if (!Array.isArray(data.items) || !data.items.length) fail("add a list of questions (items).");
    const keys = new Set();
    const items = data.items.map((item, i) => {
      const at = `question ${i + 1}`;
      for (const name of ["q", "right"]) if (!filled(item?.[name])) fail(`${at} needs ${name}.`);
      if (!Array.isArray(item.wrong) || item.wrong.length < 3 || !item.wrong.every(filled)) fail(`${at} needs at least 3 wrong answers.`);
      const answers = [item.right, ...item.wrong].map(s => s.trim());
      if (new Set(answers.map(s => s.toLowerCase())).size !== answers.length) fail(`${at} repeats an answer.`);
      if (item.emoji !== undefined && !filled(item.emoji)) fail(`${at}: emoji must be text.`);
      // Progress is kept by the question itself, so adding or moving questions does not lose it.
      const key = `${item.q.trim()} → ${answers[0]}`;
      if (keys.has(key)) fail(`${at} repeats "${key}".`);
      keys.add(key);
      return { key, q: item.q.trim(), right: answers[0], wrong: answers.slice(1), emoji: item.emoji ? item.emoji.trim() : "" };
    });
    return { title: data.title.trim(), desc: data.desc.trim(), items };
  }

  // The right answer and three of the wrong ones, in random order.
  const choices = (item, rand = Math.random) => shuffled([item.right, ...shuffled(item.wrong, rand).slice(0, 3)], rand);

  // Saved progress checked against the file as it is now. log: what went wrong in this round, for the report.
  function reconcile(saved, data) {
    const s = isObject(saved) ? saved : {};
    const known = new Set(data.items.map(it => it.key));
    const marks = {};
    if (isObject(s.marks)) {
      for (const [key, mark] of Object.entries(s.marks)) if (known.has(key) && [RIGHT, WRONG, HINTED].includes(mark)) marks[key] = mark;
    }
    const order = (Array.isArray(s.order) ? s.order : []).filter(key => known.has(key));
    const pos = Number.isSafeInteger(s.pos) && s.pos > 0 && Array.isArray(s.order)
      ? s.order.slice(0, s.pos).filter(key => known.has(key)).length : 0;
    const log = (Array.isArray(s.log) ? s.log : []).filter(m => isObject(m) && known.has(m.key));
    return { marks, order, pos, log, round: Number.isSafeInteger(s.round) && s.round > 0 && order.length ? s.round : 0,
      hinted: known.has(s.hinted) ? s.hinted : null, passed: s.passed === true, seenInfo: s.seenInfo === true };
  }

  // The first round has every card; after it only those that are not right yet.
  function newRound(p, data, rand = Math.random) {
    const last = p.order[p.order.length - 1];
    p.order = shuffled(data.items.map(it => it.key).filter(key => p.marks[key] !== RIGHT), rand);
    if (p.order.length > 1 && p.order[0] === last) p.order.push(p.order.shift());
    p.pos = 0;
    p.log = [];
    p.hinted = null;
    p.round++;
  }
  // Taking the test again from the start; a star already earned stays.
  const restart = p => Object.assign(p, { marks: {}, order: [], pos: 0, log: [], round: 0, hinted: null });

  function answer(p, ok, hint, chosen) {
    const key = p.order[p.pos];
    p.marks[key] = !ok ? WRONG : hint ? HINTED : RIGHT;
    if (!ok) p.log.push({ key, chosen });
    else if (hint) p.log.push({ key, hint: true });
    p.pos++;
    p.hinted = null;
  }
  const roundOver = p => p.order.length > 0 && p.pos >= p.order.length;

  const score = (p, data) => ({ ...rules.score(data.items.length, p.marks),
    hinted: Object.values(p.marks).filter(m => m === HINTED).length });
  const passed = (sc, passRating) => rules.passes(sc, passRating);

  function report(p, data, passRating) {
    const sc = score(p, data), item = key => data.items.find(it => it.key === key);
    const line = m => `• ${item(m.key).q} → ${item(m.key).right}${m.chosen ? ` (обрано: ${m.chosen})` : ""}`;
    const list = (title, marks) => (marks.length ? `\n\n${title}:\n${marks.map(line).join("\n")}` : "");
    const head = passed(sc, passRating) ? `Тест складено! Рейтинг ${fmt(sc.rating)}. Кіл: ${p.round}`
      : `Коло ${p.round}. Рейтинг ${fmt(sc.rating)} з ${fmt(passRating)}\nПравильно: ${sc.right} з ${sc.total}`;
    return head + list("Помилки", p.log.filter(m => !m.hint)) + list("З підказкою", p.log.filter(m => m.hint));
  }

  const api = { RIGHT, WRONG, HINTED, fmt, validateIndex, validate, choices, reconcile, newRound, restart, answer, roundOver, score, passed, report };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TestCardsCore = api;
})(typeof window !== "undefined" ? window : globalThis);
