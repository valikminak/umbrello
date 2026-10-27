/* Vocabulary rules: unit format, practice rating, answer checks and story marks.
   Shared by the page and Node tests. No dependencies or build step. */
(function (root) {
  "use strict";
  // Practice opens the next step once the last WINDOW answers give a rating of PASS out of 5.
  const WINDOW = 20;
  const PASS = 4.5;
  const PRACTICE_OPTIONS = 6;
  const MIN_PRACTICE = 20;
  const STORY_MIN_PHRASES = 5;
  const UNIT_ID = /^unit-\d{3}$/;
  const MARK = /\[\[([^\]|]+)\|([a-z0-9]+)\]\]/g;

  const filled = value => typeof value === "string" && value.trim() !== "";
  const clean = value => value.trim();
  const oneGap = q => typeof q === "string" && q.split("___").length === 2;

  // Book contents for the unit list. A unit with an id has a file in vocabulary/ and opens.
  function validateIndex(data) {
    const fail = problem => { throw new Error(`Check vocabulary/index.json: ${problem}`); };
    if (!data || !filled(data.book) || !Array.isArray(data.groups) || !data.groups.length) fail("add book and groups.");
    const numbers = new Set(), ids = new Set();
    const groups = data.groups.map((group, g) => {
      if (!group || !filled(group.title) || !Array.isArray(group.units) || !group.units.length) fail(`group ${g + 1} needs a title and units.`);
      return { title: clean(group.title), units: group.units.map(unit => {
        if (!unit || !Number.isInteger(unit.number) || unit.number < 1 || numbers.has(unit.number) || !filled(unit.title)) {
          fail(`unit ${unit?.number ?? "?"} in group ${g + 1} needs a unique number and a title.`);
        }
        if (unit.id !== undefined && (typeof unit.id !== "string" || !UNIT_ID.test(unit.id) || ids.has(unit.id))) {
          fail(`unit ${unit.number}: id must look like unit-012 and be unique.`);
        }
        numbers.add(unit.number);
        if (unit.id) ids.add(unit.id);
        return { number: unit.number, title: clean(unit.title), id: unit.id || null };
      }) };
    });
    return { book: clean(data.book), groups };
  }

  // Checks a unit file and returns it trimmed. Every message names the place to fix.
  function validateUnit(data) {
    const fail = (where, problem) => { throw new Error(`Check ${where}: ${problem}`); };
    if (!data || data.schemaVersion !== 1) fail("the unit", "schemaVersion must be 1.");
    if (!Number.isInteger(data.number) || data.number < 1) fail("the unit", "number must be the unit number.");
    if (!filled(data.title) || !filled(data.about)) fail("the unit", "add title and about.");

    if (!Array.isArray(data.parts) || !data.parts.length) fail("parts", "add at least one part.");
    const partIds = new Set();
    const parts = data.parts.map((part, i) => {
      if (!part || !/^[A-Za-z0-9]{1,8}$/.test(part.id || "") || partIds.has(part.id) || !filled(part.title)) {
        fail(`parts[${i}]`, "needs a unique short id and a title.");
      }
      partIds.add(part.id);
      const out = { id: part.id, title: clean(part.title) };
      if (part.note !== undefined) { if (!filled(part.note)) fail(`parts[${i}]`, "note must be text."); out.note = clean(part.note); }
      if (part.table !== undefined) {
        const t = part.table;
        if (!t || !Array.isArray(t.columns) || t.columns.length < 2 || !t.columns.every(filled) || !Array.isArray(t.rows) || !t.rows.length ||
            !t.rows.every(row => Array.isArray(row) && row.length === t.columns.length && row.every(filled))) {
          fail(`parts[${i}].table`, "needs columns and rows of the same length.");
        }
        out.table = { columns: t.columns.map(clean), rows: t.rows.map(row => row.map(clean)) };
      }
      return out;
    });

    if (!Array.isArray(data.items) || !data.items.length) fail("items", "add the unit's phrases.");
    const itemIds = new Set();
    const items = data.items.map((item, i) => {
      const where = `items[${i}]`;
      if (!item || !/^[a-z0-9]{1,8}$/.test(item.id || "") || itemIds.has(item.id)) fail(where, "needs a unique id like a1.");
      if (!partIds.has(item.part)) fail(where, "part must be one of the parts.");
      for (const key of ["phrase", "pattern", "meaning", "uk", "example"]) if (!filled(item[key])) fail(where, `add ${key}.`);
      if (!/\*\*[^*]+\*\*/.test(item.example)) fail(where, "mark the phrase in the example with **…**.");
      if (item.more !== undefined && (!Array.isArray(item.more) || !item.more.every(filled))) fail(where, "more must be a list of sentences.");
      for (const key of ["watchOut", "ipa"]) if (item[key] !== undefined && !filled(item[key])) fail(where, `${key} must be text.`);
      itemIds.add(item.id);
      const out = { id: item.id, part: item.part };
      for (const key of ["phrase", "pattern", "meaning", "uk", "example"]) out[key] = clean(item[key]);
      out.more = (item.more || []).map(clean);
      if (item.watchOut) out.watchOut = clean(item.watchOut);
      if (item.ipa) out.ipa = clean(item.ipa);
      return out;
    });
    const itemRef = (where, id) => { if (!itemIds.has(id)) fail(where, "item must be one of the item ids."); return id; };

    // A choice question: one gap, the right answer and wrong ones, all different.
    const choice = (q, where, wrongCount) => {
      if (!q || !oneGap(q.q)) fail(where, "the sentence needs exactly one ___ gap.");
      const options = [q.right, ...(Array.isArray(q.wrong) ? q.wrong : [])];
      const countOk = wrongCount ? q.wrong?.length === wrongCount : q.wrong?.length >= 2 && q.wrong.length <= 4;
      if (!Array.isArray(q.wrong) || !countOk || !options.every(filled) ||
          new Set(options.map(o => o.trim().toLowerCase())).size !== options.length) {
        fail(where, wrongCount ? `give one right and ${wrongCount} different wrong answers.` : "give one right and 2–4 different wrong answers.");
      }
      const out = { q: clean(q.q), right: clean(q.right), wrong: q.wrong.map(clean), item: itemRef(where, q.item) };
      if (q.explain !== undefined) { if (!filled(q.explain)) fail(where, "explain must be text."); out.explain = clean(q.explain); }
      return out;
    };

    if (!Array.isArray(data.warmup) || !data.warmup.length) fail("warmup", "add questions.");
    const warmup = data.warmup.map((q, i) => {
      if (!filled(q?.uk)) fail(`warmup[${i}]`, "add the Ukrainian sentence in uk.");
      return { uk: clean(q.uk), ...choice(q, `warmup[${i}]`) };
    });

    const checks = {};
    for (const part of parts) {
      const hasItems = items.some(item => item.part === part.id);
      const list = data.checks?.[part.id];
      if (hasItems && (!Array.isArray(list) || !list.length)) fail(`checks.${part.id}`, "add questions for this part.");
      if (!hasItems && !part.table && !part.note) fail(`parts`, `part ${part.id} has no items, table or note.`);
      if (hasItems) checks[part.id] = list.map((q, i) => choice(q, `checks.${part.id}[${i}]`));
    }

    if (!Array.isArray(data.practice) || data.practice.length < MIN_PRACTICE) fail("practice", `add at least ${MIN_PRACTICE} questions.`);
    const practice = data.practice.map((q, i) => choice(q, `practice[${i}]`, PRACTICE_OPTIONS - 1));

    if (!Array.isArray(data.mix) || !data.mix.length) fail("mix", "add questions.");
    const mix = data.mix.map((q, i) => {
      const where = `mix[${i}]`;
      if (!q || !oneGap(q.q)) fail(where, "the sentence needs exactly one ___ gap.");
      if (!Array.isArray(q.answers) || !q.answers.length || !q.answers.every(filled)) fail(where, "add answers.");
      return { q: clean(q.q), answers: q.answers.map(clean), item: itemRef(where, q.item) };
    });

    for (const [name, list] of [["practice", practice], ["mix", mix]]) {
      const missing = items.filter(item => !list.some(q => q.item === item.id)).map(item => item.id);
      if (missing.length) fail(name, `no question for ${missing.join(", ")}.`);
    }

    const story = data.story;
    if (!story || !Array.isArray(story.topics) || !story.topics.length || !story.topics.every(filled)) fail("story", "add topics.");
    const out = { number: data.number, title: clean(data.title), about: clean(data.about), parts, items, warmup, checks, practice, mix,
      story: { topics: story.topics.map(clean) } };
    if (story.example !== undefined) {
      const e = story.example;
      if (!e || !filled(e.title) || !filled(e.uk) || !filled(e.en) || storyIds(e.en, itemIds).length < STORY_MIN_PHRASES) {
        fail("story.example", `needs title, uk and en with at least ${STORY_MIN_PHRASES} marked phrases.`);
      }
      out.story.example = { title: clean(e.title), uk: clean(e.uk), en: clean(e.en) };
    }
    return out;
  }

  // Rating out of 5 over the last WINDOW answers; unanswered slots count as not yet right.
  function rating(history) {
    const last = history.slice(-WINDOW);
    return 5 * last.filter(Boolean).length / WINDOW;
  }
  const passed = history => rating(history) >= PASS;

  // Practice order: a shuffled deck; a wrong answer comes back after 4–7 other questions.
  function practiceDeck(questions, random = Math.random, avoid = null) {
    const deck = shuffleWith(questions, random);
    if (avoid && deck.length > 1 && deck[0] === avoid) deck.push(deck.shift());
    return deck;
  }
  function requeue(queue, question, random = Math.random) {
    const at = Math.min(queue.length, 4 + Math.floor(random() * 4));
    queue.splice(at, 0, question);
    return queue;
  }
  function shuffleWith(list, random) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // Typed answers: case, curly apostrophes, spaces and end punctuation don't matter; one typo in a longer word is "almost".
  const normalize = value => String(value).toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ")
    .replace(/^[\s"'«“]+|[\s.!?,;:"'»”]+$/g, "").trim();
  function distance(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]; row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const keep = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = keep;
      }
    }
    return row[b.length];
  }
  function checkTyped(answers, given) {
    const g = normalize(given);
    if (!g) return { status: "bad" };
    const list = answers.map(normalize);
    const exact = list.indexOf(g);
    if (exact >= 0) return { status: "ok", matched: answers[exact] };
    const near = list.findIndex(a => a.length >= 5 && distance(a, g) <= 1);
    return near >= 0 ? { status: "almost", matched: answers[near] } : { status: "bad" };
  }
  const firstLetters = answer => answer.split(" ").map(word => word[0] + "…").join(" ");

  // Story marks: [[words used|item id]]. Unknown ids are kept as plain text.
  function storyParts(text, ids) {
    const out = [];
    let last = 0, match;
    MARK.lastIndex = 0;
    while ((match = MARK.exec(text))) {
      if (match.index > last) out.push({ text: text.slice(last, match.index) });
      if (!ids || ids.has(match[2])) out.push({ text: match[1], item: match[2] });
      else out.push({ text: match[1] });
      last = match.index + match[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }
  const storyIds = (text, ids) => [...new Set(storyParts(text, ids).filter(part => part.item).map(part => part.item))];
  const plainStory = text => text.replace(MARK, "$1");

  const api = { WINDOW, PASS, PRACTICE_OPTIONS, MIN_PRACTICE, STORY_MIN_PHRASES, UNIT_ID,
    validateIndex, validateUnit, rating, passed, practiceDeck, requeue, normalize, distance, checkTyped, firstLetters,
    storyParts, storyIds, plainStory };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VocabularyCore = api;
})(typeof window !== "undefined" ? window : globalThis);
