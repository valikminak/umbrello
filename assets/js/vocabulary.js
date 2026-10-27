(async function () {
  "use strict";
  const host = document.getElementById("app");
  if (!await Profiles.shared(host)) return;
  const core = VocabularyCore;
  const listUrl = Profiles.url("vocabulary.html");
  const unitUrl = id => `${listUrl}&unit=${encodeURIComponent(id)}`;
  const unitId = new URLSearchParams(location.search).get("unit");

  // ---------- Unit list: the book's contents, prepared units open ----------
  async function showList() {
    backTo(Profiles.url("index.html"));
    try {
      const index = core.validateIndex(await loadJSON("vocabulary/index.json"));
      host.innerHTML = `<h1>Vocabulary</h1><p class="sub">${esc(index.book)}</p>
        ${index.groups.map(group => `<h2 class="voc-group">${esc(group.title)}</h2><div class="voc-units">${group.units.map(unit => unit.id
          ? `<a class="voc-unit ready" href="${unitUrl(unit.id)}"><span class="n">${unit.number}</span><span class="t">${esc(unit.title)}</span><span class="voc-chip ok">Open</span></a>`
          : `<div class="voc-unit"><span class="n">${unit.number}</span><span class="t">${esc(unit.title)}</span></div>`).join("")}</div>`).join("")}`;
    } catch (error) { showError(host, error, showList); }
  }

  if (!unitId) return showList();
  backTo(listUrl);
  if (!core.UNIT_ID.test(unitId)) {
    host.innerHTML = `<div class="center"><h1>Unit not found</h1><p class="sub">Choose a unit from the list.</p>
      <a class="btn" href="${listUrl}">All units</a></div>`;
    return;
  }

  let unit;
  async function loadUnit() {
    try {
      unit = core.validateUnit(await loadJSON(`vocabulary/${unitId}.json`));
      start();
    } catch (error) { showError(host, error, loadUnit); }
  }

  // ---------- One unit: five steps, one after another. Nothing is saved. ----------
  const STEPS = [
    { id: "warm", short: "Warm-up", title: "Warm-up", how: "Guess the English phrase before you learn it. Wrong guesses are fine." },
    { id: "learn", short: "Learn", title: "Learn", how: "Read each part, then answer three quick questions about it." },
    { id: "practice", short: "Practice", title: "Practice",
      how: `Choose the word that fits. The rating counts your last ${core.WINDOW} answers. Get ${core.PASS} to go on.` },
    { id: "story", short: "Story", title: "Story",
      how: "Translate a short Ukrainian story into English using the unit's phrases, then compare it with the English version." },
    { id: "mix", short: "Mix", title: "Final mix", how: "Type the missing phrase. The first letters are given." },
  ];
  const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  const say = t => `<button class="voc-say" type="button" data-act="say" data-t="${esc(t.replace(/\*\*/g, ""))}" aria-label="Listen">${ICON}</button>`;
  const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  const fillGap = (q, a, cls) => esc(q).replace("___", () => `<b${cls ? ` class="${cls}"` : ""}>${esc(a)}</b>`);
  const blank = q => esc(q).replace("___", '<span class="voc-gap">   </span>');
  const byId = id => unit.items.find(item => item.id === id);
  const isRight = status => status === "ok" || status === "almost";
  let S, pracTimer = null, storyCtl = null;

  function start() {
    S = { view: "intro", unlocked: 0, done: new Set(), learnPart: unit.parts[0].id, learnReached: 0,
      run: null, prac: null, story: { status: "idle", data: null, source: null, topic: "", phase: "write", text: "", err: "" }, scores: {} };
    show("intro");
  }
  function show(view) {
    clearTimeout(pracTimer);
    if (S.view === "story" && S.story.phase === "write") S.story.text = host.querySelector("#vocMine")?.value || S.story.text;
    try { speechSynthesis.cancel(); } catch (_) {}
    S.view = view;
    render();
    window.scrollTo(0, 0);
  }
  function complete(stepId) {
    S.done.add(stepId);
    S.unlocked = Math.max(S.unlocked, STEPS.findIndex(step => step.id === stepId) + 1);
  }
  function openStep(id) {
    if (STEPS.findIndex(step => step.id === id) > S.unlocked) return;
    if (id === "warm") return startRun({ step: "warm", cards: unit.warmup.map(q => ({ ...q, idk: true })), order: false,
      onEnd: () => { complete("warm"); show("warmResult"); } });
    if (id === "learn") return show("learn");
    if (id === "practice") { if (!S.prac) startPractice(); return show("practice"); }
    if (id === "story") { show("story"); if (S.story.status === "idle") getStory(); return; }
    if (id === "mix") return startRun({ step: "mix", cards: unit.mix.map(q => ({ ...q, typed: true })), requeue: true,
      onEnd: () => { complete("mix"); show("mixResult"); } });
  }

  const nav = () => `<div class="voc-nav"><button class="voc-back" type="button" data-act="intro">‹ Unit ${unit.number}</button>
    <span>${esc(unit.title)}</span></div>`;
  const stepbar = current => `<div class="voc-steps" aria-label="Unit steps">${STEPS.map(step =>
    `<span class="${step.id === current ? "on" : S.done.has(step.id) ? "ok" : ""}">${S.done.has(step.id) && step.id !== current ? "✓ " : ""}${step.short}</span>`).join("")}</div>`;
  const how = id => `<p class="voc-task">${esc(STEPS.find(step => step.id === id).how)}</p>`;

  function viewIntro() {
    const next = STEPS[Math.min(S.unlocked, STEPS.length - 1)];
    return `<div class="voc-nav"><a class="voc-back" href="${listUrl}">‹ All units</a></div>
      <h1>Unit ${unit.number} · ${esc(unit.title)}</h1>
      <p class="voc-lead">${esc(unit.about)}</p>
      <div class="voc-parts">${unit.parts.filter(part => unit.items.some(item => item.part === part.id))
        .map(part => `<div><b>${esc(part.id)}</b><span>${esc(part.title)}</span></div>`).join("")}</div>
      <p class="sub">${unit.items.length} phrases · about 45 minutes · five steps, one after another:</p>
      <div class="voc-plan">${STEPS.map((step, i) => `<button type="button" class="${S.done.has(step.id) ? "done" : ""}" data-act="open" data-id="${step.id}"${i > S.unlocked ? " disabled" : ""}>
        <span class="num">${S.done.has(step.id) ? "✓" : i + 1}</span><span class="body"><b>${step.title}</b><span>${esc(step.how)}</span></span></button>`).join("")}</div>
      ${S.done.has("mix") ? `<button class="btn" type="button" data-act="show" data-id="done">See unit results</button>`
        : `<button class="btn" type="button" data-act="open" data-id="${next.id}">${S.unlocked === 0 ? "Start" : "Continue: " + next.title}</button>`}
      <p class="sub voc-note">Nothing is saved. Closing the page starts the unit again.</p>`;
  }

  function itemCard(item) {
    return `<article class="voc-item">
      <div class="voc-item-head"><span class="w">${esc(item.phrase)}</span>${item.ipa ? `<span class="ipa">${esc(item.ipa)}</span>` : ""}${say(item.phrase.split(" / ")[0])}</div>
      <div class="voc-pattern">${esc(item.pattern)}</div>
      <div class="voc-meaning">${esc(item.meaning)}</div>
      <div class="voc-ex">${md(item.example)} ${say(item.example)}</div>
      <div class="voc-item-foot">
        <button class="voc-uk" type="button" data-act="uk" lang="uk"><i>UA</i><span>${esc(item.uk)}</span></button>
        ${item.more.length ? `<details class="voc-more"><summary>${item.more.length} more example${item.more.length > 1 ? "s" : ""}</summary>${item.more.map(m => `<div class="voc-ex">${md(m)} ${say(m)}</div>`).join("")}</details>` : ""}
      </div>
      ${item.watchOut ? `<div class="voc-trap" lang="uk"><b>Watch out</b>${esc(item.watchOut)}</div>` : ""}
    </article>`;
  }

  function viewLearn() {
    const k = unit.parts.findIndex(part => part.id === S.learnPart), part = unit.parts[k];
    S.learnReached = Math.max(S.learnReached, k);
    const items = unit.items.filter(item => item.part === part.id);
    const last = k === unit.parts.length - 1;
    const partnav = `<div class="voc-partnav">${unit.parts.map((p, j) => `<button type="button" data-act="part" data-id="${esc(p.id)}" aria-current="${j === k}"${j > S.learnReached ? " disabled" : ""}>${esc(p.id)}</button>`).join("")}</div>`;
    const table = part.table ? `<div class="voc-scroll"><table class="voc-table"><thead><tr>${part.table.columns.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${part.table.rows.map(row => `<tr>${row.map((cell, i) => i ? `<td>${esc(cell)}</td>` : `<td><b>${esc(cell)}</b></td>`).join("")}</tr>`).join("")}</tbody></table></div>` : "";
    const next = items.length
      ? `<button class="btn" type="button" data-act="check" data-id="${esc(part.id)}">Check yourself · ${unit.checks[part.id].length} questions</button>`
      : last ? `<button class="btn" type="button" data-act="learnDone">Next: Practice</button>`
        : `<button class="btn" type="button" data-act="part" data-id="${esc(unit.parts[k + 1].id)}">Next part</button>`;
    return `${nav()}${stepbar("learn")}${partnav}
      <div class="voc-part-head">Part ${k + 1} of ${unit.parts.length}</div>
      <h2 class="voc-part-title">${esc(part.title)}</h2>
      ${part.note ? `<p class="voc-lead" lang="uk">${esc(part.note)}</p>` : ""}${table}
      ${items.map(itemCard).join("")}
      ${items.length ? `<p class="sub voc-note">Tap UA to see the translation. Try to understand the English first.</p>` : ""}
      <div class="voc-actions">${next}</div>`;
  }

  // ---------- Question runner: warm-up, checks after each part, final mix ----------
  function startRun(options) {
    const cards = (options.order === false ? options.cards : shuffle(options.cards)).map(card =>
      card.typed ? card : { ...card, shown: shuffle([card.right, ...card.wrong]) });
    S.run = { requeue: false, ...options, cards, i: 0, res: [], phase: "ask", picked: null, out: null };
    show("run");
    focusAnswer();
  }
  function viewRun() {
    const r = S.run, c = r.cards[r.i], fb = r.phase === "fb", isLast = r.i + 1 >= r.cards.length;
    const nextLabel = isLast ? r.nextLabel || "Finish" : "Next";
    const item = byId(c.item);
    let body;
    if (!c.typed) {
      body = `${c.uk ? `<p class="voc-uk-prompt" lang="uk">${esc(c.uk)}</p>` : ""}
        <div class="question">${fb ? fillGap(c.q, c.right, "voc-right") : blank(c.q)}</div>
        <div class="options">${c.shown.map((option, k) => {
          const cls = fb ? (option === c.right ? " right" : option === r.picked ? " wrong" : "") : "";
          return `<button class="opt${cls}" type="button" data-act="choose" data-k="${k}"${fb ? " disabled" : ""}>${esc(option)}</button>`;
        }).join("")}</div>
        ${!fb && c.idk ? `<button class="voc-skip" type="button" data-act="choose" data-k="-1">I don't know</button>` : ""}
        ${fb ? `<div class="voc-fb ${isRight(r.out.status) ? "ok" : "bad"}">
            <b>${r.out.status === "ok" ? "Correct" : r.out.status === "idk" ? "Here's the answer" : "Not quite"}</b>
            <div class="voc-full"><span>${fillGap(c.q, c.right)}</span>${say(c.q.replace("___", c.right))}</div>
            ${c.explain ? `<div lang="uk">${esc(c.explain)}</div>` : ""}</div>
          <button class="btn" type="button" data-act="next">${nextLabel}</button>` : ""}`;
    } else {
      const shown = fb && isRight(r.out.status) ? r.out.matched : c.answers[0];
      body = `<div class="question">${fb ? fillGap(c.q, shown, isRight(r.out.status) ? "voc-right" : "")
          : esc(c.q).replace("___", () => `<span class="voc-gap">${esc(core.firstLetters(c.answers[0]))}</span>`)}</div>
        ${fb ? `<div class="voc-fb ${isRight(r.out.status) ? "ok" : "bad"}">
            <b>${r.out.status === "ok" ? "Correct" : r.out.status === "almost" ? "Almost. Check the spelling" : "Not quite"}</b>
            <div class="voc-full"><span>Listen to the sentence</span>${say(c.q.replace("___", shown))}</div>
            ${c.answers.length > 1 ? `<div>Also right: ${c.answers.filter(a => a !== shown).map(esc).join(", ")}</div>` : ""}
            ${isRight(r.out.status) ? "" : `<div>You wrote: ${r.out.given.trim() ? esc(r.out.given) : "nothing"}</div>`}
            <div lang="uk">${esc(item.phrase)} — ${esc(item.uk)}</div></div>
          <button class="btn" type="button" data-act="next">${nextLabel}</button>`
        : `<input class="voc-field" id="vocAnswer" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Type the missing words" lang="en">
          <button class="btn" type="button" data-act="checkTyped">Check</button>`}`;
    }
    return `${nav()}${stepbar(r.step)}${r.heading ? `<div class="voc-part-head">${esc(r.heading)}</div>` : ""}
      <div class="top"><span class="counter">${r.i + 1} / ${r.cards.length}</span><div class="bar"><i style="width:${r.i / r.cards.length * 100}%"></i></div></div>
      ${r.step === "learn" ? "" : how(r.step)}${body}`;
  }
  function finishCard(out) {
    const r = S.run, c = r.cards[r.i];
    r.out = out; r.phase = "fb";
    r.res.push({ card: c, out, retry: !!c.retry });
    vibrate(isRight(out.status) ? "success" : "error");
    if (r.requeue && !c.retry && !isRight(out.status)) r.cards.push({ ...c, retry: true });
    render();
    host.querySelector('[data-act="next"]')?.focus({ preventScroll: true });
  }
  function checkTyped() {
    const given = host.querySelector("#vocAnswer")?.value || "";
    finishCard({ ...core.checkTyped(S.run.cards[S.run.i].answers, given), given });
  }
  function focusAnswer() { host.querySelector("#vocAnswer")?.focus({ preventScroll: true }); }
  function nextCard() {
    const r = S.run;
    if (r.i + 1 >= r.cards.length) return r.onEnd();
    r.i++; r.phase = "ask"; r.out = null; r.picked = null;
    render();
    focusAnswer();
  }

  function viewWarmResult() {
    const right = S.run.res.filter(x => isRight(x.out.status)).length, total = S.run.res.length;
    S.scores.warm = `${right} / ${total}`;
    return `${nav()}${stepbar("warm")}
      <div class="voc-result"><p class="sub">You already knew</p><div class="big">${right} / ${total}</div>
      <p class="sub">All of these phrases are in this unit. Now learn them.</p></div>
      <button class="btn" type="button" data-act="open" data-id="learn">Next: Learn</button>`;
  }
  function viewMixResult() {
    const r = S.run, first = r.res.filter(x => !x.retry), right = first.filter(x => isRight(x.out.status)).length;
    const retried = r.res.filter(x => x.retry), fixed = retried.filter(x => isRight(x.out.status)).length;
    const missed = first.filter(x => !isRight(x.out.status));
    S.scores.mix = `${right} / ${first.length}`;
    return `${nav()}${stepbar("mix")}
      <div class="voc-result"><p class="sub">Right the first time</p><div class="big">${right} / ${first.length}</div>
      <p class="sub">${retried.length ? `${fixed} of ${retried.length} fixed on the second try.` : "No mistakes."}</p></div>
      ${missed.length ? `<h2>Missed the first time</h2><div class="mistakes">${missed.map(x =>
        `<div>${fillGap(x.card.q, x.card.answers[0])}<span>You wrote: ${x.out.given.trim() ? esc(x.out.given) : "nothing"}</span></div>`).join("")}</div>` : ""}
      <button class="btn" type="button" data-act="show" data-id="done">Finish the unit</button>`;
  }
  function viewDone() {
    return `${nav()}<h1>Unit ${unit.number} done</h1><p class="sub">${esc(unit.title)}</p>
      <div class="voc-summary">
        <div><span>Warm-up</span><b>${esc(S.scores.warm || "—")}</b></div>
        <div><span>Practice rating</span><b>${S.prac ? `${core.rating(S.prac.history).toFixed(1)} · ${S.prac.history.length} answers` : "—"}</b></div>
        <div><span>Story</span><b>${S.done.has("story") ? "translated" : "—"}</b></div>
        <div><span>Final mix</span><b>${esc(S.scores.mix || "—")}</b></div>
      </div>
      <a class="btn" href="${listUrl}">All units</a>
      <button class="btn ghost" type="button" data-act="restart">Do the unit again</button>`;
  }

  // ---------- Practice: like Polyglot, the next step opens at a rating of 4.5 ----------
  function startPractice() {
    S.prac = { queue: core.practiceDeck(unit.practice), current: null, options: [], history: [], right: 0, wrong: 0, phase: "ask", picked: null, passed: false };
    nextPractice();
  }
  function nextPractice() {
    const p = S.prac;
    if (!p.queue.length) p.queue = core.practiceDeck(unit.practice, Math.random, p.current);
    p.current = p.queue.shift();
    p.options = shuffle([p.current.right, ...p.current.wrong]);
    p.phase = "ask"; p.picked = null;
  }
  function answerPractice(k) {
    const p = S.prac;
    if (p.phase !== "ask") return;
    const choice = p.options[k], ok = choice === p.current.right;
    p.picked = choice; p.phase = ok ? "right" : "wrong";
    p.history.push(ok);
    if (ok) p.right++; else { p.wrong++; core.requeue(p.queue, p.current); }
    vibrate(ok ? "success" : "error");
    if (!p.passed && core.passed(p.history)) { p.passed = true; complete("practice"); }
    render();
    if (ok) pracTimer = setTimeout(() => { if (S.view === "practice" && S.prac.phase === "right") { nextPractice(); render(); } }, 700);
    else host.querySelector('[data-act="pnext"]')?.focus({ preventScroll: true });
  }
  function viewPractice() {
    const p = S.prac, c = p.current, rating = core.rating(p.history), last = p.history.slice(-core.WINDOW), answered = p.phase !== "ask";
    const item = byId(c.item);
    return `${nav()}${stepbar("practice")}
      <div class="voc-stats" aria-label="Rating ${rating.toFixed(1)}, ${p.right} right, ${p.wrong} wrong">
        <span class="star">★ ${rating.toFixed(1)}</span><span class="okc">✓ ${p.right}</span><span class="badc">✗ ${p.wrong}</span><span class="goal">Goal ${core.PASS}</span></div>
      ${p.passed ? `<div class="voc-banner"><b>Rating ${core.PASS} reached. The next step is open.</b>
          <button class="btn" type="button" data-act="open" data-id="story">Next: Story</button></div>` : how("practice")}
      <div class="question">${answered ? fillGap(c.q, c.right, "voc-right") : blank(c.q)}</div>
      <div class="voc-grid">${p.options.map((option, k) => {
        const cls = answered ? (option === c.right ? " right" : option === p.picked ? " wrong" : "") : "";
        return `<button class="opt${cls}" type="button" data-act="pick" data-k="${k}"${answered ? " disabled" : ""}>${esc(option)}</button>`;
      }).join("")}</div>
      ${p.phase === "wrong" ? `<div class="voc-fb bad"><b>Not quite</b>
          <div class="voc-full"><span>${fillGap(c.q, c.right)}</span>${say(c.q.replace("___", c.right))}</div>
          <div lang="uk">${esc(item.phrase)} — ${esc(item.uk)}</div></div>
        <button class="btn" type="button" data-act="pnext">Next</button>` : ""}
      <div class="voc-strip" aria-hidden="true">${Array.from({ length: core.WINDOW }, (_, k) =>
        `<i class="${k < last.length ? (last[k] ? "g" : "r") : ""}"></i>`).join("")}</div>
      <div class="voc-strip-note">Your last ${core.WINDOW} answers</div>`;
  }

  // ---------- Story: the Worker writes it once; no checking request ----------
  const storyErrors = {
    not_configured: "Stories are not configured yet. Check OPENAI_API_KEY and OPENAI_MODEL in the Worker.",
    unauthorized: "Please close the app and open it again through Telegram.",
    invalid_input: "The story request could not be read. Please try again.",
    not_found: "The Worker doesn't have the story route yet. Publish the new worker/cf_worker.js.",
    rate_limit: "The model's request limit has been reached. Please try again later.",
    timeout: "The model took too long to respond. Please try again.",
    blocked_response: "The model could not write this story. Try another one.",
    incomplete_response: "The model's response was cut short. Please try again.",
    invalid_response: "The model returned a story without the unit's phrases. Please try again.",
    invalid_json: "The model returned an unreadable response. Please try again.",
    empty_response: "The model returned an empty response. Please try again.",
    provider_auth: "The model provider rejected access. Check the API key.",
    model_not_found: "The configured model is unavailable. Check OPENAI_MODEL.",
    provider_billing: "The model account has no credit. Check the OpenAI balance.",
  };
  async function requestStory(topic) {
    if (!tg?.initData) throw new Error("Open the app through Telegram to get a story.");
    storyCtl = new AbortController();
    const timer = setTimeout(() => storyCtl.abort(), 55000);
    try {
      const response = await fetch(new URL("/vocabulary/story", WORKER_URL), {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: storyCtl.signal,
        body: JSON.stringify({ initData: tg.initData, unit: unit.title, topic,
          phrases: unit.items.map(({ id, phrase, pattern, meaning }) => ({ id, phrase, pattern, meaning })) }),
      });
      let data;
      try { data = await response.json(); } catch (_) {}
      if (!response.ok) {
        if (Profiles.refuse(data?.error)) throw new Error("Umbrello is closed for this account.");
        const code = typeof data?.error === "string" ? data.error : "";
        throw new Error(`${storyErrors[code] || "The story request failed. Please try again."} [${code || "HTTP " + response.status}]`);
      }
      const ids = new Set(unit.items.map(item => item.id));
      if (!data || typeof data.title !== "string" || typeof data.uk !== "string" || typeof data.en !== "string" ||
          core.storyIds(data.en, ids).length < core.STORY_MIN_PHRASES) throw new Error("The story came back without the unit's phrases. Please try again.");
      return { title: data.title, uk: data.uk, en: data.en };
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(storyCtl.stopped ? "Stopped." : "The response took too long. Please try again.");
      if (error instanceof TypeError) throw new Error("Could not connect. Please check your internet connection and try again.");
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function getStory() {
    const st = S.story;
    // A new topic each time, so "Another story" never repeats the last one.
    const pool = unit.story.topics.length > 1 ? unit.story.topics.filter(topic => topic !== st.topic) : unit.story.topics;
    st.topic = pool[Math.floor(Math.random() * pool.length)];
    st.status = "loading"; st.err = "";
    if (S.view === "story") render();
    try {
      st.data = await requestStory(st.topic);
      st.source = "ai"; st.status = "ready"; st.phase = "write"; st.text = "";
    } catch (error) {
      st.status = st.data ? "ready" : "error"; st.err = error.message;
    }
    if (S.view === "story") render();
  }
  function useExample() {
    const st = S.story;
    st.data = unit.story.example; st.source = "example"; st.status = "ready"; st.phase = "write"; st.text = ""; st.err = "";
    render();
  }
  const paragraphs = (text, marked) => text.split(/\n\s*\n/).map(p => `<p>${marked
    ? core.storyParts(p, new Set(unit.items.map(item => item.id))).map(part => part.item ? `<span class="voc-mark">${esc(part.text)}</span>` : esc(part.text)).join("")
    : esc(p)}</p>`).join("");
  function viewStory() {
    const st = S.story, head = `${nav()}${stepbar("story")}`;
    if (st.status === "loading") {
      return `${head}${how("story")}<div class="voc-story"><p>Writing a story about ${esc(st.topic)}… This can take up to a minute.</p></div>
        <button class="btn ghost" type="button" data-act="stopStory">Stop</button>`;
    }
    if (st.status !== "ready") {
      return `${head}${how("story")}<p class="status bad">${esc(st.err || "No story yet.")}</p>
        <button class="btn" type="button" data-act="newStory">Try again</button>
        ${unit.story.example ? `<button class="btn ghost" type="button" data-act="example">Use the example story</button>` : ""}`;
    }
    const ids = core.storyIds(st.data.en, new Set(unit.items.map(item => item.id)));
    const note = st.source === "ai" ? `A story about ${esc(st.topic)}.` : "Example story written in advance.";
    const common = `<p class="voc-task">${note}${st.err ? ` <span class="voc-err">${esc(st.err)}</span>` : ""}</p>
      <div class="voc-label">Translate into English</div>
      <div class="voc-story" lang="uk">${paragraphs(st.data.uk, false)}</div>
      <div class="voc-label">Use these phrases</div>
      <div class="voc-chips">${ids.map(id => `<span class="voc-chip">${esc(byId(id).phrase)}</span>`).join("")}</div>`;
    if (st.phase === "write") {
      return `${head}${common}
        <textarea class="voc-field voc-text" id="vocMine" rows="9" spellcheck="false" autocorrect="off" autocapitalize="sentences" lang="en" placeholder="Write your English version here">${esc(st.text)}</textarea>
        <button class="btn" type="button" data-act="storyDone">Done</button>`;
    }
    return `${head}${common}
      <div class="voc-label">Your version</div>
      <div class="voc-story voc-mine">${st.text.trim() ? esc(st.text) : '<span class="voc-muted">You left it empty.</span>'}</div>
      <div class="voc-label">English version</div>
      <div class="voc-story">${st.data.title ? `<h3>${esc(st.data.title)}</h3>` : ""}${paragraphs(st.data.en, true)}</div>
      <div class="voc-row"><button class="btn ghost" type="button" data-act="say" data-t="${esc(core.plainStory(st.data.en))}">Listen</button>
        <button class="btn ghost" type="button" data-act="newStory">Another story</button></div>
      <button class="btn" type="button" data-act="open" data-id="mix">Next: Final mix</button>`;
  }

  // ---------- Render and events ----------
  function render() {
    const views = { learn: viewLearn, run: viewRun, warmResult: viewWarmResult, mixResult: viewMixResult,
      practice: viewPractice, story: viewStory, done: viewDone };
    host.innerHTML = (views[S.view] || viewIntro)();
  }
  host.onclick = event => {
    const b = event.target.closest("[data-act]");
    if (!b || b.disabled || !S) return;
    const r = S.run;
    switch (b.dataset.act) {
      case "intro": return show("intro");
      case "show": return show(b.dataset.id);
      case "open": return openStep(b.dataset.id);
      case "say": return speak(b.dataset.t);
      case "uk": b.classList.toggle("open"); return;
      case "part": S.learnPart = b.dataset.id; return show("learn");
      case "check": {
        const ids = unit.parts.map(part => part.id), k = ids.indexOf(b.dataset.id), next = unit.parts[k + 1];
        return startRun({ step: "learn", heading: `Part ${k + 1} · check yourself`, cards: unit.checks[b.dataset.id],
          nextLabel: next ? `Next: Part ${k + 2}` : "Next: Practice",
          onEnd: () => { if (next) { S.learnPart = next.id; show("learn"); } else { complete("learn"); openStep("practice"); } } });
      }
      case "learnDone": complete("learn"); return openStep("practice");
      case "choose": {
        const c = r.cards[r.i], k = Number(b.dataset.k);
        if (k < 0) return finishCard({ status: "idk" });
        r.picked = c.shown[k];
        return finishCard({ status: r.picked === c.right ? "ok" : "bad" });
      }
      case "checkTyped": return checkTyped();
      case "next": return nextCard();
      case "pick": return answerPractice(Number(b.dataset.k));
      case "pnext": nextPractice(); return render();
      case "stopStory": if (storyCtl) { storyCtl.stopped = true; storyCtl.abort(); } return;
      case "newStory": return getStory();
      case "example": return useExample();
      case "storyDone":
        S.story.text = host.querySelector("#vocMine").value;
        S.story.phase = "compare";
        complete("story");
        render();
        window.scrollTo(0, 0);
        return;
      case "restart": return start();
    }
  };
  host.onkeydown = event => {
    if (event.key !== "Enter" || event.shiftKey || event.target.tagName === "TEXTAREA" || !S) return;
    if (event.target.id === "vocAnswer") { event.preventDefault(); return checkTyped(); }
    if (S.view === "run" && S.run.phase === "fb") { event.preventDefault(); return nextCard(); }
  };

  loadUnit();
})();
