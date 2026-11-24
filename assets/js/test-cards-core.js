/* Card tests (users/<id>/tests/<number>/test.json): file checks, rounds, scoring, report text.
   Shared by test.html and Node tests. The rating itself is the one Grammar lessons use (tenses-core.js). */
(function (root) {
  "use strict";
  const rules = typeof module !== "undefined" && module.exports ? require("./tenses-core.js") : root.TensesCore;
  const { RIGHT, WRONG, fmt } = rules;
  const filled = value => typeof value === "string" && value.trim() !== "";
  const isObject = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);

  function shuffled(list, rand) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // "The king lives in a [castle]." The marked word must be the question or the answer itself. On the card
  // that asks for it, it is left out (gap), so the sentence helps without giving the answer.
  function parseHint(text, q, right) {
    const parts = /^([^[\]]*)\[([^[\]]+)\]([^[\]]*)$/.exec(text.trim());
    if (!parts) return null;
    const [, before, word, after] = parts, same = other => word.toLowerCase() === other.toLowerCase();
    return same(q) || same(right) ? { before, word, after, gap: same(right) } : null;
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
      const hint = item.hint === undefined ? null : filled(item.hint) && parseHint(item.hint, item.q.trim(), answers[0]);
      if (item.hint !== undefined && !hint) fail(`${at}: hint must be a sentence with the question or the answer once in [ ].`);
      // Progress is kept by the question itself, so adding or moving questions does not lose it.
      const key = `${item.q.trim()} → ${answers[0]}`;
      if (keys.has(key)) fail(`${at} repeats "${key}".`);
      keys.add(key);
      return { key, q: item.q.trim(), right: answers[0], wrong: answers.slice(1), hint };
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
      for (const [key, mark] of Object.entries(s.marks)) {
        if (!known.has(key)) continue;
        // "h", right after the hint, was a mark of its own in the first version.
        if (mark === RIGHT || mark === "h") marks[key] = RIGHT;
        else if (mark === WRONG) marks[key] = WRONG;
      }
    }
    // The first version shuffled the cards and kept their order; its place in the round means nothing now.
    const shuffledOrder = s.order !== undefined;
    const whole = n => (Number.isSafeInteger(n) && n > 0 ? n : 0);
    return { marks, pos: shuffledOrder ? 0 : whole(s.pos), round: whole(s.round),
      log: shuffledOrder || !Array.isArray(s.log) ? [] : s.log.filter(m => isObject(m) && known.has(m.key)), passed: s.passed === true };
  }

  // Like Polyglot: every round goes through the cards from the first one, in the order of the file, and each
  // card keeps its last answer. A mistake is put right only by coming to that card again, and a new mistake
  // on the way spoils a right one.
  const newRound = p => Object.assign(p, { pos: 0, log: [], round: p.round + 1 });
  // Taking the test again from the start; a star already earned stays.
  const restart = p => Object.assign(p, { marks: {}, pos: 0, log: [], round: 0 });

  // hint: the card was turned over before the answer. It changes nothing but the teacher's report.
  function answer(p, data, ok, hint, chosen) {
    const { key } = data.items[p.pos];
    p.marks[key] = ok ? RIGHT : WRONG;
    if (!ok) p.log.push({ key, chosen });
    else if (hint) p.log.push({ key, hint: true });
    p.pos++;
  }

  const score = (p, data) => rules.score(data.items.length, p.marks);
  const passed = (sc, passRating) => rules.passes(sc, passRating);
  // A round ends after its last card, or at once when the test is passed.
  const roundOver = (p, data, passRating) => p.round > 0 && (p.pos >= data.items.length || passed(score(p, data), passRating));

  function report(p, data, passRating) {
    const sc = score(p, data), item = key => data.items.find(it => it.key === key);
    const line = m => `• ${item(m.key).q} → ${item(m.key).right}${m.chosen ? ` (обрано: ${m.chosen})` : ""}`;
    const list = (title, marks) => (marks.length ? `\n\n${title}:\n${marks.map(line).join("\n")}` : "");
    const head = passed(sc, passRating) ? `Тест складено! Рейтинг ${fmt(sc.rating)}. Кіл: ${p.round}`
      : `Коло ${p.round}. Рейтинг ${fmt(sc.rating)} з ${fmt(passRating)}\nПравильно: ${sc.right} з ${sc.total}`;
    return head + list("Помилки", p.log.filter(m => !m.hint)) + list("З підказкою", p.log.filter(m => m.hint));
  }

  const api = { RIGHT, WRONG, fmt, validateIndex, validate, choices, reconcile, newRound, restart, answer, roundOver, score, passed, report };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TestCardsCore = api;
})(typeof window !== "undefined" ? window : globalThis);
