/* Tenses trainer rules: lesson file checks, answer tiles, scoring. Shared by the page and Node tests.
   No dependencies or build step. Random choices take an optional rand() so tests can fix them. */
(function (root) {
  "use strict";
  const RIGHT = "r", WRONG = "w";
  const filled = value => typeof value === "string" && value.trim() !== "";
  const low = s => s.toLowerCase();

  // Verb forms in the lexicon: base → [-s, past, past participle, -ing].
  const S = 0, PAST = 1, PART = 2, ING = 3;
  // Groups of tenses a lesson works with. A lesson's near misses come only from its own groups:
  // in "simple" lessons there is no "is" or "working" to choose from.
  // perfect: have / has / had + past participle; perfect-continuous: have been + -ing.
  // passive: be + past participle in any tense (was built, has been sent); a lesson that lists it may have both voices.
  const FORMS = ["simple", "continuous", "perfect", "perfect-continuous", "passive"];
  const WOULD = ["would", "wouldn't"];
  // Time words that only make sense once perfect tenses are taught (already, for two hours).
  const PERFECT_FAMILIES = ["perfect", "duration"];
  // Time phrases that may also open the sentence: "Yesterday she didn't call". Not "Yet I haven't".
  const MOVABLE = ["present", "past", "future"];

  // Lookup tables built once from the lexicon in grammar/tenses.json.
  function makeLexicon(lex) {
    const form = {}, time = {};
    for (const [base, rest] of Object.entries(lex.verbs)) {
      form[base] = base;
      for (const f of rest) if (!(f in form)) form[f] = base;
    }
    for (const [family, phrases] of Object.entries(lex.time)) for (const t of phrases) time[low(t)] = family;
    const list = name => (lex[name] || []).map(low);
    return { ...lex, haveAux: list("haveAux"), haveNegative: list("haveNegative"), wh: list("wh"), conj: list("conj"),
      timeTwins: lex.timeTwins || {}, formOf: form, timeOf: time };
  }

  // "She|didn't|call|yesterday." → steps the learner puts in order; "?" at the end makes it a question.
  // " / " splits a sentence into two clauses: "The train|had|left / when|we|arrived."
  // lesson carries the groups of tenses (forms), decoys and what else the lesson uses; tests may leave it out.
  function parse(item, lex, lesson = {}) {
    const q = /\?\s*$/.test(item.en);
    const steps = [], clauses = [];
    for (const part of item.en.trim().replace(/[.?!]\s*$/, "").split(/\s+\/\s+/)) {
      const start = steps.length;
      steps.push(...part.split("|").map(s => s.trim()));
      clauses.push([start, steps.length]);
    }
    // The capital at the start of a sentence is not part of the word: "She" is "she", "My mum" is "my mum",
    // so the tiles do not show which word comes first. Names keep theirs: "Tom", "I".
    const first = low(steps[0]), firstWord = first.split(" ")[0];
    if (steps[0] !== "I" && ([...lex.subjects, ...lex.questionAux, ...lex.beAux, ...lex.haveAux, ...lex.wh, ...lex.conj].map(low).includes(first) ||
      LOWER_STARTS.includes(firstWord))) steps[0] = first;
    // A question may open with a question word: "How long|have|you|been|waiting?"
    const head = q && lex.wh.includes(steps[0]) ? 1 : 0;
    // Where each clause has its subject: after when / if, and after the helper in a question.
    const subj = clauses.map(([start], c) => start + (lex.conj.includes(low(steps[start])) ? 1 : 0) + (q && c === 0 ? head + 1 : 0));
    return { uk: item.uk.trim(), steps, q, head, clauses, subj, comma: clauses.length > 1 && lex.conj.includes(steps[0]),
      forms: lesson.forms || ["simple"], decoys: Boolean(lesson.decoys), going: Boolean(lesson.going),
      perfectTimes: lesson.perfectTimes || ["present", "past", "future"] };
  }
  const LOWER_STARTS = ["the", "a", "an", "my", "your", "his", "her", "our", "their", "this", "that", "these", "those",
    "somebody", "someone", "everybody", "everyone", "nobody", "all", "summer", "lunch", "dinner", "coffee", "tea"];
  const clauseOf = (it, i) => it.clauses.findIndex(([a, b]) => i >= a && i < b);

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

  const isIng = (word, lex) => {
    const base = word && lex.formOf[low(word)];
    return Boolean(base) && lex.verbs[base][ING] === low(word);
  };

  const isPart = (word, lex) => {
    const base = word && lex.formOf[low(word)];
    return Boolean(base) && lex.verbs[base][PART] === low(word) && lex.verbs[base][PAST] !== low(word);
  };
  // The third form itself, also where it is the same as the past: built, cleaned, written.
  const isPartForm = (word, lex) => {
    const base = word && lex.formOf[low(word)];
    return Boolean(base) && lex.verbs[base][PART] === low(word);
  };
  const isHave = (w, lex) => lex.haveAux.includes(w) || lex.haveNegative.includes(w);
  const isBe = (w, lex) => lex.beAux.includes(w) || lex.beNegative.includes(w) || w === "be" || w === "been";

  // What grammar job step i does in the sentence; decides which near misses go with it.
  function kind(it, i, lex) {
    const ls = low(it.steps[i]), c = clauseOf(it, i), start = it.clauses[c][0];
    if (it.q && i < it.head) return "wh";
    if (it.q && c === 0 && i === it.head) return "aux";
    if (i === start && lex.conj.includes(ls)) return "conj";
    if (i === it.subj[c] && lex.subjects.map(low).includes(ls)) return "subject";
    if (lex.negativeAux.includes(ls) || lex.beNegative.includes(ls) || lex.haveNegative.includes(ls)) return "aux";
    if (ls === "will") return "will";
    if (WOULD.includes(ls)) return "would";
    if (lex.beAux.includes(ls)) return "be";
    // be / been / being as helpers: will be working, has been sent, is being repaired.
    if (["be", "been", "being"].includes(ls) && (isIng(it.steps[i + 1], lex) || isPartForm(it.steps[i + 1], lex))) return "be";
    if (lex.haveAux.includes(ls)) return "have";
    if (ls === "going to") return "going";
    // A clause has one main verb; a word after it that looks like a verb is something else:
    // "I finished work" — work is what was finished.
    if (lex.formOf[ls]) return it.steps.slice(start, i).some((_, k) => kind(it, start + k, lex) === "verb") ? "other" : "verb";
    if (lex.timeOf[ls]) return "time";
    if (Object.prototype.hasOwnProperty.call(lex.objects, ls)) return "object";
    return "other";
  }

  // The tense of each clause, read from its English answer: { time, aspect, passive }.
  // aspect is one of the four aspects in FORMS; "going to" counts as simple; time is present, past,
  // future, or unreal for a clause with would.
  function tenses(it, lex) {
    return it.clauses.map(([a, b]) => {
      const words = it.steps.slice(a, b).map(low), has = list => words.some(w => list.includes(w));
      const perfect = words.some(w => isHave(w, lex));
      const continuous = words.some(w => isIng(w, lex)) && words.some(w => isBe(w, lex));
      const passive = words.some((w, k) => k > 0 && isPartForm(w, lex) && (isBe(words[k - 1], lex) || words[k - 1] === "being"));
      let time = "present";
      if (has(WOULD)) time = "unreal";
      else if (has(["will", "won't"])) time = "future";
      else if (has(["had", "hadn't"])) time = "past";
      else if (!perfect && (has(["did", "didn't", "was", "were", "wasn't", "weren't"]) ||
        // the third form after a be-word is passive, not past: "is repaired".
        words.some((w, k) => { const v = lex.formOf[w]; return v && v !== w && lex.verbs[v][PAST] === w && lex.verbs[v][S] !== w &&
          !(k > 0 && (isBe(words[k - 1], lex) || words[k - 1] === "being")); }))) time = "past";
      const aspect = perfect ? (continuous ? "perfect-continuous" : "perfect") : continuous ? "continuous" : "simple";
      return { time, aspect, passive };
    });
  }
  // The tense of a one-clause sentence (the first clause of a longer one).
  const tense = (it, lex) => tenses(it, lex)[0];

  // The place a step takes in the sentence, named for the slot labels of the word-order lesson.
  const PLACE = ["here", "there", "home", "abroad", "outside"];
  const MANNER = ["well", "badly", "fast", "hard", "late", "early", "slowly", "quickly", "loudly", "straight away"];
  function role(it, i, lex) {
    const k = kind(it, i, lex), ls = low(it.steps[i]);
    if (i === it.subj[clauseOf(it, i)]) return "хто";
    if (["aux", "will", "would", "be", "have", "going"].includes(k)) return "допоміжне";
    if (k === "wh" || k === "conj") return "коли";
    if (k === "verb") return "дія";
    if (k === "time") return "коли";
    if (k === "object") return "кого / що";
    if (/^to\s/.test(ls)) return "куди";
    if (/^(at|in|on|near|under|behind|from)\s/.test(ls) || PLACE.includes(ls)) return "де";
    if (MANNER.includes(ls)) return "як";
    return "кого / що";
  }

  // be forms a learner mixes up: the same time with another person, and the same person at another time.
  const BE_TWINS = { am: ["is", "was"], is: ["are", "was"], are: ["is", "were"], was: ["were", "is"], were: ["was", "are"],
    be: ["is", "being"], been: ["being", "be"], being: ["been", "be"] };
  const HAVE_TWINS = { have: ["has", "had"], has: ["have", "had"], had: ["has", "have"] };
  const CONJ_TWINS = { when: ["if"], if: ["when"], "as soon as": ["when"], until: ["when"], before: ["after"], after: ["before"] };
  // Clauses after these words speak of the future in the present tense: "If it rains, we will stay".
  const FUTURE_CONJ = ["when", "if", "as soon as", "until", "before", "after", "by the time"];

  const has = (it, name) => it.forms.includes(name);
  const perfectLesson = it => has(it, "perfect") || has(it, "perfect-continuous");
  const continuousLesson = it => has(it, "continuous") || has(it, "perfect-continuous");
  // had and hadn't only where the lesson has the past perfect.
  const haves = (it, list) => list.filter(w => !/^had/.test(w) || it.perfectTimes.includes("past"));

  // "If it rains": a present verb (or am / is / are) in a when / if clause, where "will rain" is the slip.
  // "If I knew … would": the past in an if clause beside would, where "would know" is the slip
  // ("would have" for had, "would be" for was / were).
  function futureSlip(it, i, lex) {
    const c = clauseOf(it, i), ls = low(it.steps[i]), prev = i ? low(it.steps[i - 1]) : null;
    const opener = low(it.steps[it.clauses[c][0]]), t = tenses(it, lex)[c];
    if (opener === "if" && it.steps.some(w => WOULD.includes(low(w)))) {
      if (ls === "had") return "would have";
      if (["was", "were"].includes(ls)) return "would be";
      const base = lex.formOf[ls];
      if (!base || t.aspect !== "simple" || t.time !== "past" || i !== it.subj[c] + 1 || helper(prev, lex) || lex.verbs[base][PAST] !== ls) return null;
      return `would ${base}`;
    }
    if (!FUTURE_CONJ.includes(opener) || t.time !== "present") return null;
    if (["am", "is", "are"].includes(ls)) return "will be";
    const base = lex.formOf[ls];
    if (!base || i !== it.subj[c] + 1 || (ls !== base && ls !== lex.verbs[base][S]) || helper(prev, lex)) return null;
    return `will ${base}`;
  }
  const helper = (w, lex) => Boolean(w) && ([...lex.questionAux, ...lex.negativeAux, ...lex.beAux, ...lex.beNegative,
    ...lex.haveAux, ...lex.haveNegative, ...WOULD, "be", "been", "being", "will", "going to"].includes(w));

  // The words a learner could mistake for step i: its neighbours of the same kind,
  // taken only from the tense groups of the lesson.
  function options(it, i, lex, rand = Math.random) {
    const s = it.steps[i], ls = low(s), prev = i ? low(it.steps[i - 1]) : null, c = clauseOf(it, i);
    const simple = has(it, "simple"), continuous = continuousLesson(it), perfect = perfectLesson(it) || has(it, "passive"),
      beToo = continuous || it.going;
    const forms = base => {
      const [es, past, part, ing] = lex.verbs[base];
      return [base, es, past, ...(perfect ? [part] : []), ...(continuous ? [ing] : [])];
    };
    let opts;
    switch (kind(it, i, lex)) {
      case "aux":
        opts = it.q && i === it.head
          ? [s, ...(simple ? lex.questionAux : ["will"]), ...(beToo ? lex.beAux : []), ...(perfect ? haves(it, lex.haveAux) : [])]
          : [s, ...(simple ? lex.negativeAux : ["won't"]), ...(beToo ? lex.beNegative : []), ...(perfect ? haves(it, lex.haveNegative) : [])];
        break;
      case "subject":
        opts = [s, ...pick(lex.subjects, 3, [s], rand)];
        break;
      case "will": {
        // will sits beside the verb's own -s and past forms: "will call" or "calls" or "called";
        // "will have finished" beside "had".
        const next = it.steps.slice(i + 1, it.clauses[c][1]).map(low).find(w => lex.formOf[w] || lex.haveAux.includes(w)) || "be";
        const [es, past] = lex.haveAux.includes(next) ? ["had", "has"] : lex.verbs[lex.formOf[next]];
        opts = ["will", es, past, ...(it.going ? ["going to"] : [])];
        break;
      }
      case "would":
        // would beside will: "If I knew, I will tell you" is the slip.
        opts = ls === "would" ? ["would", "will"] : ["wouldn't", "won't"];
        break;
      case "be":
        opts = [s, ...(futureSlip(it, i, lex) ? [futureSlip(it, i, lex)] : []), ...(BE_TWINS[ls] || [])];
        break;
      case "have":
        opts = [s, ...(futureSlip(it, i, lex) ? [futureSlip(it, i, lex)] : []), ...haves(it, HAVE_TWINS[ls] || [])];
        break;
      case "going":
        opts = [s, "will"];
        break;
      case "wh":
        opts = [s, ...pick(lex.wh, 1, [s], rand)];
        break;
      case "conj":
        opts = [s, ...(CONJ_TWINS[ls] || [])];
        break;
      case "verb": {
        const slip = futureSlip(it, i, lex);
        opts = forms(lex.formOf[ls]);
        if (slip) opts = [slip, ...opts];
        else if (!helper(prev, lex) && !it.q && i === it.subj[c] + 1) opts = ["will", ...opts];
        opts = [s, ...opts];
        break;
      }
      case "time": {
        // for two hours sits beside "since two hours", since Monday beside "from Monday".
        opts = [s, ...(lex.timeTwins[ls] || [])];
        for (const family of Object.keys(lex.time)) {
          if (family !== lex.timeOf[ls] && (perfect || !PERFECT_FAMILIES.includes(family))) opts.push(...pick(lex.time[family], 1, [], rand));
        }
        break;
      }
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

  // In a lesson that mixes simple and continuous, every helper and verb group must offer the
  // other aspect too, or the group itself would tell the answer: do comes with is, works with working.
  const mixed = it => it.forms.length > 1;
  function family(word, lex) {
    const w = low(word);
    if (["do", "does", "did", "don't", "doesn't", "didn't"].includes(w)) return "do";
    if (isBe(w, lex)) return "be";
    if (isHave(w, lex)) return "have";
    if (w === "will" || w === "won't" || w === "going to" || w.startsWith("will ") || WOULD.includes(w) || w.startsWith("would ")) return "will";
    return isIng(w, lex) ? "ing" : isPart(w, lex) ? "part" : "plain";
  }
  // One near miss from each other family first (did beside is and has; saw beside seen and seeing),
  // then any others.
  function crossPick(it, i, wrong, n, lex, rand) {
    const own = family(it.steps[i], lex), out = [];
    const families = [...new Set(wrong.map(w => family(w, lex)))].filter(f => f !== own && f !== "will");
    for (const f of shuffled(families, rand)) if (out.length < n) out.push(...pick(wrong.filter(w => family(w, lex) === f), 1, [], rand));
    return [...out, ...pick(wrong, n - out.length, out, rand)];
  }

  // be-words that fit the subject: "is, was" for she.
  function subjectBe(who) {
    if (who === "i") return ["am", "was"];
    if (["he", "she", "it"].includes(who)) return ["is", "was"];
    if (["you", "we", "they"].includes(who) || /s$|children|people/.test(who)) return ["are", "were"];
    return ["is", "was"];
  }

  // In a lesson that mixes tenses, a sentence must not be told by the helpers it lacks: a simple
  // statement among continuous ones gets be-words, a past simple one among perfect ones gets have.
  // So after its own groups a sentence gets decoy groups for every helper family the lesson uses
  // and its tiles do not show yet: "is, was" for she, "be" with will, "been" with have.
  function decoys(it, lex, tiles) {
    if (!it.decoys) return [];
    const words = it.steps.map(low), who = words[it.subj[0]];
    const will = words.some(w => ["will", "won't", ...WOULD].includes(w));
    const out = [];
    // With have the be-word that matters is "been" (have been waiting); where the lesson has no plain
    // continuous, "been" is the only be-word it teaches.
    const haveWord = words.some(w => isHave(w, lex));
    if (haveWord && has(it, "perfect-continuous")) {
      if (!tiles.includes("been")) out.push(["been"]);
    } else if ((continuousLesson(it) || it.going) && !tiles.some(w => isBe(w, lex))) {
      if (will) out.push(["be", ...(it.going && !it.q ? subjectBe(who).slice(0, 1) : [])]);
      else if (!it.q) out.push(!haveWord && (has(it, "continuous") || it.going) ? subjectBe(who) : ["been"]);
    }
    if (perfectLesson(it) && !tiles.some(w => isHave(w, lex))) {
      const present = it.perfectTimes.includes("present"), past = it.perfectTimes.includes("past");
      if (will) out.push(["have", ...(past ? ["had"] : [])]);
      else if (!present && !past) { if (!it.q) out.push(["have"]); }
      else if (!it.q) out.push([["he", "she", "it"].includes(who) ? "has" : "have", past ? "had" : ["he", "she", "it"].includes(who) ? "have" : "has"]);
    }
    return out;
  }

  // Words the lesson prefers as the near miss of step i: him → he, for two hours → since two hours,
  // rains → will rain in an if clause.
  function preferred(it, i, k, lex) {
    const ls = low(it.steps[i]);
    if (k === "object") return [lex.objects[ls]];
    if (k === "time") return lex.timeTwins[ls] || [];
    if (k === "verb" || k === "be" || k === "have") { const slip = futureSlip(it, i, lex); return slip ? [slip] : []; }
    return [];
  }

  // Tiles for one sentence in groups: each word of the answer with its near misses beside it
  // (didn't with don't and won't). The groups come in random order, so the order of the
  // sentence is not given away. With nearMisses false there are only the answer's own words.
  // A sentence of two clauses gets no near misses for its subjects and time words, or it would
  // have too many tiles.
  const NEAR_MISSES = { subject: 1, aux: 2, be: 2, have: 1, verb: 2, will: 1, would: 1, going: 1, time: 1, object: 1, wh: 1, conj: 1, other: 0 };
  function bankGroups(it, lex, rand = Math.random, nearMisses = true) {
    const taken = it.steps.map(low), two = it.clauses.length > 1;
    const groups = it.steps.map((s, i) => {
      const k = kind(it, i, lex), group = [s];
      // In a long sentence of two clauses the verb keeps one near miss; beside would, if needs no twin.
      const n = !nearMisses || (two && ["subject", "time", "object"].includes(k)) || (k === "conj" && it.steps.some(w => WOULD.includes(low(w)))) ? 0
        : two && ["aux", "be"].includes(k) ? Math.min(1, NEAR_MISSES[k])
        : two && k === "verb" && it.steps.length >= 10 ? 1 : NEAR_MISSES[k];
      if (!n) return group;
      const wrong = options(it, i, lex, rand).filter(o => !taken.includes(low(o)));
      const first = preferred(it, i, k, lex).filter(o => o && wrong.includes(o)).slice(0, 1);
      const rest = wrong.filter(o => !first.includes(o));
      const chosen = [...first, ...(n - first.length <= 0 ? []
        : k === "be" ? rest.slice(0, n - first.length)
        : mixed(it) && (k === "aux" || k === "verb") ? crossPick(it, i, rest, n - first.length, lex, rand)
        : pick(rest, n - first.length, [], rand))];
      // An object pronoun brings only its subject form: him with he.
      if (k === "object" && first.length) chosen.splice(1);
      for (const o of chosen) { group.push(o); taken.push(low(o)); }
      return shuffled(group, rand);
    });
    if (nearMisses) {
      for (const extra of decoys(it, lex, taken)) {
        const group = extra.filter(w => !taken.includes(w));
        taken.push(...group);
        if (group.length) groups.push(shuffled(group, rand));
      }
    }
    return shuffled(groups.filter(g => g.length), rand);
  }
  const bank = (it, lex, rand, nearMisses) => bankGroups(it, lex, rand, nearMisses).flat();

  // Right answers: the sentence as written and, for a statement that ends with a time phrase,
  // the same sentence with that phrase moved to the front ("Yesterday she didn't call").
  // A sentence of two clauses joined by when / if / because may also come in the other order:
  // "We will stay at home if it rains" as well as "If it rains, we will stay at home".
  function accepted(it, lex) {
    const words = it.steps.map(low), out = [words.join(" ")];
    if (it.clauses.length > 1) {
      const parts = it.clauses.map(([a, b]) => words.slice(a, b).join(" "));
      if (!it.q && it.clauses.some(([a]) => lex.conj.includes(words[a]))) out.push([...parts.slice(1), parts[0]].join(" "));
      return out;
    }
    const last = words[words.length - 1];
    if (!it.q && MOVABLE.includes(lex.timeOf[last])) out.push([last, ...words.slice(0, -1)].join(" "));
    return out;
  }
  const isRight = (it, lex, chosen) => accepted(it, lex).includes(chosen.map(low).join(" "));

  function sentence(it) {
    const text = it.clauses.map(([a, b]) => it.steps.slice(a, b).join(" ")).join(it.comma ? ", " : " ");
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

  // labels: empty places with their names (хто, дія, коли); slots: empty places only;
  // count: only how many tiles the answer has; none: no hint at all (lessons that mix tenses,
  // where the length of the answer would tell the tense).
  const HINTS = ["labels", "slots", "count", "none"];
  const INFO = ["word-order", "simple-tenses", "continuous", "mix-simple-continuous", "present-perfect",
    "perfect-continuous", "mix-present-past", "past-perfect", "future", "when-if", "mix-all", "passive", "conditionals", "final"];
  // auto: the answer is checked when its last tile is placed; button: the learner presses
  // Перевірити, so a shorter or longer sentence can be given and its length tells nothing.
  const CHECK = ["auto", "button"];

  // "4 плитки": Ukrainian plural for the number of tiles in the answer.
  function tilesWord(n) {
    const d = n % 10, h = n % 100;
    return `${n} ${d === 1 && h !== 11 ? "плитка" : d >= 2 && d <= 4 && (h < 12 || h > 14) ? "плитки" : "плиток"}`;
  }

  // Checks grammar/tenses.json and returns it with parsed sentences, or throws a message naming the problem.
  function validate(data) {
    const fail = problem => { throw new Error(`Check grammar/tenses.json: ${problem}`); };
    if (!data || typeof data !== "object") fail("the file must be an object.");
    if (!filled(data.title)) fail("add a title.");
    if (typeof data.passRating !== "number" || data.passRating <= 0 || data.passRating > 5) fail("passRating must be a number from 0 to 5.");
    const lx = data.lexicon;
    const lists = ["subjects", "questionAux", "negativeAux", "beAux", "beNegative", "haveAux", "haveNegative", "wh", "conj"];
    if (!lx || lists.some(name => !Array.isArray(lx[name])) || !lx.objects || !lx.verbs || !lx.time) {
      fail(`the lexicon needs ${lists.join(", ")}, objects, verbs and time.`);
    }
    for (const [base, rest] of Object.entries(lx.verbs)) {
      if (!Array.isArray(rest) || rest.length !== 4 || !rest.every(filled)) fail(`verb "${base}" needs four forms: -s, past, past participle, -ing.`);
    }
    if (lx.timeTwins !== undefined && (typeof lx.timeTwins !== "object" || Object.values(lx.timeTwins).some(v => !Array.isArray(v)))) {
      fail("timeTwins must map a time phrase to a list of look-alikes.");
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
      if (lesson.hints !== undefined && !HINTS.includes(lesson.hints)) fail(`${where}: hints must be one of ${HINTS.join(", ")}.`);
      if (lesson.nearMisses !== undefined && typeof lesson.nearMisses !== "boolean") fail(`${where}: nearMisses must be true or false.`);
      if (lesson.decoys !== undefined && typeof lesson.decoys !== "boolean") fail(`${where}: decoys must be true or false.`);
      if (lesson.info !== undefined && !INFO.includes(lesson.info)) fail(`${where}: info must be one of ${INFO.join(", ")}.`);
      if (lesson.check !== undefined && !CHECK.includes(lesson.check)) fail(`${where}: check must be one of ${CHECK.join(", ")}.`);
      if (lesson.forms !== undefined && (!Array.isArray(lesson.forms) || !lesson.forms.length || lesson.forms.some(f => !FORMS.includes(f)))) {
        fail(`${where}: forms must list some of ${FORMS.join(", ")}.`);
      }
      const forms = lesson.forms || ["simple"];
      const seen = new Set();
      const items = lesson.items.map((item, ii) => {
        const at = `${where}, sentence ${ii + 1}`;
        if (!filled(item?.uk) || !/[А-Яа-яІіЇїЄєҐґ]/u.test(item.uk)) fail(`${at}: uk must be the Ukrainian sentence.`);
        if (!filled(item.en) || !/[.?]$/.test(item.en.trim())) fail(`${at}: en must end with "." or "?".`);
        if (item.en.replace(/[.?]\s*$/, "").split(/[|/]/).some(part => !part.trim())) fail(`${at}: en has an empty step between "|".`);
        if (/\?\s*$/.test(item.uk) !== /\?\s*$/.test(item.en)) fail(`${at}: a question in uk must be a question in en.`);
        if (seen.has(item.uk.trim())) fail(`${at} repeats "${item.uk.trim()}".`);
        seen.add(item.uk.trim());
        const it = parse(item, lex, { forms, decoys: lesson.decoys });
        it.steps.forEach((s, i) => {
          const end = it.clauses[clauseOf(it, i)][1];
          if (["will", "would"].includes(kind(it, i, lex)) && !it.steps.slice(i + 1, end).some(w => lex.formOf[low(w)] || lex.haveAux.includes(low(w)))) {
            fail(`${at}: add the verb after "${low(s)}" to the lexicon.`);
          }
        });
        it.clauses.forEach(([a, b], c) => {
          const verb = it.steps.slice(a, b).some((_, k) => ["verb", "be"].includes(kind(it, a + k, lex)));
          if (!verb) fail(`${at}: add its verb to the lexicon${it.clauses.length > 1 ? ` (clause ${c + 1})` : ""}.`);
        });
        for (const t of tenses(it, lex)) {
          if (!forms.includes(t.aspect)) fail(`${at} is ${t.aspect}, which this lesson's forms do not include.`);
          if (t.passive && !forms.includes("passive")) fail(`${at} is passive, which this lesson's forms do not include.`);
        }
        return it;
      });
      // What the lesson uses beyond its forms decides some near misses: "had" only where the past
      // perfect is taught, "going to" only where it is.
      const perfectTimes = [...new Set(items.flatMap(it => tenses(it, lex).filter(t => t.aspect.startsWith("perfect")).map(t => t.time)))];
      const going = items.some(it => it.steps.map(low).includes("going to"));
      for (const it of items) Object.assign(it, { perfectTimes, going });
      return { id: lesson.id, title: lesson.title.trim(), desc: lesson.desc.trim(), ready: lesson.ready, items, forms, perfectTimes, going,
        hints: lesson.hints || "count", nearMisses: lesson.nearMisses !== false, decoys: Boolean(lesson.decoys),
        check: lesson.check || "auto", info: lesson.info || null };
    });
    return { title: data.title.trim(), subtitle: filled(data.subtitle) ? data.subtitle.trim() : "", passRating: data.passRating, lex, lessons };
  }

  const api = { RIGHT, WRONG, FORMS, HINTS, INFO, CHECK, makeLexicon, parse, kind, tense, tenses, role, options, decoys, family, bankGroups, bank,
    accepted, isRight, sentence, tilesWord, score, passes, fmt, newOrder, validate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TensesCore = api;
})(typeof window !== "undefined" ? window : globalThis);
