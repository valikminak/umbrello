/* Tenses trainer rules: lesson file checks, answer tiles, scoring. Shared by the page and Node tests.
   No dependencies or build step. Random choices take an optional rand() so tests can fix them. */
(function (root) {
  "use strict";
  const RIGHT = "r", WRONG = "w";
  const filled = value => typeof value === "string" && value.trim() !== "";
  const low = s => s.toLowerCase();

  // Lookup tables built once from the lexicon in grammar/tenses.json.
  function makeLexicon(lex) {
    const form = {}, time = {};
    for (const [base, rest] of Object.entries(lex.verbs)) {
      form[base] = base;
      for (const f of rest) form[f] = base;
    }
    for (const [family, phrases] of Object.entries(lex.time)) for (const t of phrases) time[low(t)] = family;
    return { ...lex, formOf: form, timeOf: time };
  }

  // "She|didn't|call|yesterday." → steps the learner puts in order; "?" at the end makes it a question.
  function parse(item, lex) {
    const q = /\?\s*$/.test(item.en);
    const steps = item.en.replace(/[.?!]\s*$/, "").split("|").map(s => s.trim());
    // The capital at the start of a sentence is not part of the word: "She" is "she".
    const first = low(steps[0]);
    if (steps[0] !== "I" && (lex.subjects.includes(first) || lex.questionAux.includes(first))) steps[0] = first;
    return { uk: item.uk.trim(), steps, q };
  }

  function pick(arr, n, not, rand) {
    const skip = (not || []).map(low);
    const pool = arr.filter(x => !skip.includes(low(x)));
    const out = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    return out;
  }

  function shuffled(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // What grammar job step i does in the sentence; decides which near misses go with it.
  function kind(it, i, lex) {
    const ls = low(it.steps[i]), subject = it.q ? 1 : 0;
    if (it.q && i === 0) return "aux";
    if (i === subject && lex.subjects.includes(ls)) return "subject";
    if (lex.negativeAux.includes(ls)) return "aux";
    if (ls === "will") return "will";
    if (lex.formOf[ls]) return "verb";
    if (lex.timeOf[ls]) return "time";
    if (Object.prototype.hasOwnProperty.call(lex.objects, ls)) return "object";
    return "other";
  }

  // The words a learner could mistake for step i: its neighbours of the same kind.
  function options(it, i, lex, rand = Math.random) {
    const s = it.steps[i], ls = low(s), prev = i ? low(it.steps[i - 1]) : null, subject = it.q ? 1 : 0;
    const forms = base => [base, ...lex.verbs[base]];
    let opts;
    switch (kind(it, i, lex)) {
      case "aux":
        opts = it.q && i === 0 ? lex.questionAux.slice() : lex.negativeAux.slice();
        break;
      case "subject":
        opts = [s, ...pick(lex.subjects, 3, [s], rand)];
        break;
      case "will":
        opts = ["will", ...forms(lex.formOf[low(it.steps[i + 1])] || "be")];
        break;
      case "verb": {
        const afterAux = prev && (lex.questionAux.includes(prev) || lex.negativeAux.includes(prev) || prev === "will");
        opts = forms(lex.formOf[ls]);
        if (!afterAux && !it.q && i === subject + 1) opts = ["will", ...opts];
        break;
      }
      case "time":
        opts = [s];
        for (const family of Object.keys(lex.time)) if (family !== lex.timeOf[ls]) opts.push(...pick(lex.time[family], 1, [], rand));
        break;
      case "object": {
        const twin = lex.objects[ls], all = Object.keys(lex.objects);
        opts = twin !== ls ? [s, twin, ...pick(all, 1, [s, twin], rand)] : [s, ...pick(all, 2, [s], rand)];
        break;
      }
      default:
        opts = [s];
    }
    const seen = new Set();
    return opts.filter(o => !seen.has(low(o)) && seen.add(low(o)));
  }

  // Tiles for one sentence: all of its words plus near misses for the words that carry grammar.
  const NEAR_MISSES = { subject: 1, aux: 2, verb: 2, will: 1, time: 1, object: 1, other: 0 };
  function bank(it, lex, rand = Math.random) {
    const tiles = it.steps.slice(), taken = tiles.map(low);
    it.steps.forEach((s, i) => {
      const k = kind(it, i, lex), n = NEAR_MISSES[k];
      if (!n) return;
      const wrong = options(it, i, lex, rand).filter(o => !taken.includes(low(o)));
      // him → he is the classic slip, so an object pronoun always brings its subject form.
      const twin = k === "object" ? lex.objects[low(s)] : null;
      const chosen = twin && !taken.includes(low(twin)) ? [twin] : pick(wrong, n, [], rand);
      for (const o of chosen) { tiles.push(o); taken.push(low(o)); }
    });
    return shuffled(tiles, rand);
  }

  // Right answers: the sentence as written and, for a statement that ends with a time phrase,
  // the same sentence with that phrase moved to the front ("Yesterday she didn't call").
  function accepted(it, lex) {
    const words = it.steps.map(low), out = [words.join(" ")];
    const last = words[words.length - 1];
    if (!it.q && lex.timeOf[last]) out.push([last, ...words.slice(0, -1)].join(" "));
    return out;
  }
  const isRight = (it, lex, chosen) => accepted(it, lex).includes(chosen.map(low).join(" "));

  function sentence(it) {
    const text = it.steps.join(" ");
    return text.charAt(0).toUpperCase() + text.slice(1) + (it.q ? "?" : ".");
  }

  // marks: { itemIndex: "r" | "w" }, the last answer to each sentence. A sentence not answered yet
  // counts as not right, so the rating grows from 0 to 5 over the first round.
  function score(total, marks) {
    let right = 0, wrong = 0;
    for (const m of Object.values(marks || {})) { if (m === RIGHT) right++; else if (m === WRONG) wrong++; }
    return { right, wrong, answered: right + wrong, total, rating: total ? 5 * right / total : 0 };
  }
  const passes = (sc, passRating) => sc.total > 0 && sc.answered === sc.total && sc.rating >= passRating - 1e-9;
  // Rounded down, so 4.67 shows as 4.6 and never looks like a pass that did not happen.
  const fmt = rating => (Math.floor(rating * 10 + 1e-9) / 10).toFixed(1);

  // A new round in random order that does not start with the sentence just answered.
  function newOrder(total, last, rand = Math.random) {
    const order = shuffled([...Array(total).keys()], rand);
    if (order.length > 1 && order[0] === last) order.push(order.shift());
    return order;
  }

  // Checks grammar/tenses.json and returns it with parsed sentences, or throws a message naming the problem.
  function validate(data) {
    const fail = problem => { throw new Error(`Check grammar/tenses.json: ${problem}`); };
    if (!data || typeof data !== "object") fail("the file must be an object.");
    if (!filled(data.title)) fail("add a title.");
    if (typeof data.passRating !== "number" || data.passRating <= 0 || data.passRating > 5) fail("passRating must be a number from 0 to 5.");
    const lx = data.lexicon;
    if (!lx || !Array.isArray(lx.subjects) || !Array.isArray(lx.questionAux) || !Array.isArray(lx.negativeAux) ||
        !lx.objects || !lx.verbs || !lx.time) fail("the lexicon needs subjects, objects, questionAux, negativeAux, verbs and time.");
    for (const [base, rest] of Object.entries(lx.verbs)) {
      if (!Array.isArray(rest) || rest.length !== 2 || !rest.every(filled)) fail(`verb "${base}" needs its -s and past forms.`);
    }
    const lex = makeLexicon(lx);
    if (!Array.isArray(data.lessons) || !data.lessons.length) fail("add at least one lesson.");
    const ids = new Set();
    const lessons = data.lessons.map((lesson, li) => {
      const where = `lesson ${li + 1}`;
      if (!Number.isInteger(lesson.id) || ids.has(lesson.id)) fail(`${where} needs its own whole-number id.`);
      ids.add(lesson.id);
      if (!filled(lesson.title) || !filled(lesson.desc)) fail(`${where} needs a title and desc.`);
      if (typeof lesson.ready !== "boolean") fail(`${where}: ready must be true or false.`);
      if (!Array.isArray(lesson.items)) fail(`${where}: items must be a list.`);
      if (lesson.ready && !lesson.items.length) fail(`${where} is ready but has no sentences.`);
      const seen = new Set();
      const items = lesson.items.map((item, ii) => {
        const at = `${where}, sentence ${ii + 1}`;
        if (!filled(item?.uk) || !/[А-Яа-яІіЇїЄєҐґ]/u.test(item.uk)) fail(`${at}: uk must be the Ukrainian sentence.`);
        if (!filled(item.en) || !/[.?]$/.test(item.en.trim())) fail(`${at}: en must end with "." or "?".`);
        if (item.en.split("|").some(part => !part.trim())) fail(`${at}: en has an empty step between "|".`);
        if (/\?\s*$/.test(item.uk) !== /\?\s*$/.test(item.en)) fail(`${at}: a question in uk must be a question in en.`);
        if (seen.has(item.uk.trim())) fail(`${at} repeats "${item.uk.trim()}".`);
        seen.add(item.uk.trim());
        const it = parse(item, lex);
        it.steps.forEach((s, i) => {
          if (kind(it, i, lex) === "will" && !lex.formOf[low(it.steps[i + 1] || "")]) fail(`${at}: add the verb after "will" to the lexicon.`);
        });
        return it;
      });
      return { id: lesson.id, title: lesson.title.trim(), desc: lesson.desc.trim(), ready: lesson.ready, items };
    });
    return { title: data.title.trim(), subtitle: filled(data.subtitle) ? data.subtitle.trim() : "", passRating: data.passRating, lex, lessons };
  }

  const api = { RIGHT, WRONG, makeLexicon, parse, kind, options, bank, accepted, isRight, sentence,
    score, passes, fmt, newOrder, validate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TensesCore = api;
})(typeof window !== "undefined" ? window : globalThis);
