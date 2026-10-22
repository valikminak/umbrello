(async function () {
  "use strict";
  const host = document.getElementById("app");
  const profile = await Profiles.require(host);
  if (!profile) return;
  backTo(Profiles.url("index.html"));
  if (profile.id !== "me") {
    Profiles.empty(host, "Grammar", "Grammar is currently available in the me profile.");
    return;
  }

  const core = GrammarCore;
  const steps = [["learn", "Learn"], ["practice", "Practice"], ["listen", "Listen"], ["write", "Write"], ["review", "Review"]];
  const controllers = new Set(), audioCache = new Map(), audioLoads = new Map();
  const session = { learn: false, practice: {}, listen: {}, review: {}, indexes: { practice: 0, listen: 0, review: 0 },
    writing: "", feedback: null, writingStatus: "", checking: false };
  let unit = null, step = "learn", disposed = false, playbackRequest = 0;
  const TIMEOUT = "The request took too long. Please try again.";

  function stopAudio(invalidate = true) {
    if (invalidate) playbackRequest++;
    host.querySelectorAll("audio").forEach(audio => audio.pause());
  }
  function cleanup() {
    disposed = true;
    stopAudio();
    controllers.forEach(controller => controller.abort());
    audioCache.forEach(url => URL.revokeObjectURL(url));
    audioCache.clear();
  }
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });

  async function request(action, payload, audio = false) {
    if (!tg?.initData) throw new Error("Please open the app through Telegram to use Grammar.");
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), action === "check" ? 65000 : 30000);
    try {
      const response = await fetch(new URL(`/grammar/${action}`, WORKER_URL), {
        method: "POST", headers: { "Content-Type": "application/json" },
        cache: "no-store", signal: controller.signal,
        body: JSON.stringify({ initData: tg.initData, ...payload }),
      });
      if (!response.ok) {
        let details;
        try { details = await response.json(); } catch (_) {}
        const code = typeof details?.error === "string" ? details.error : "";
        if (Profiles.refuse(code)) throw new Error("Umbrello is closed for this account.");
        const reason = typeof details?.message === "string" && details.message.trim() ? details.message.trim() : "";
        const upstream = Number.isInteger(details?.providerStatus) ? `; HTTP ${details.providerStatus}` : "";
        if (code) throw new Error(`${reason || "The request failed. Please try again."} [${code}${upstream}]`);
        // No JSON error from the Worker: the response came from Cloudflare itself or a different Worker version.
        throw new Error(`The Worker did not return a readable answer. Check its deployment and logs in Cloudflare. [HTTP ${response.status}]`);
      }
      if (audio) {
        const blob = await response.blob();
        if (!blob.size || blob.size > 8 * 1024 * 1024 || !/^audio\//.test(blob.type)) throw new Error("The recording could not be played.");
        return blob;
      }
      try { return await response.json(); }
      catch (_) { throw new Error("The server returned an unreadable lesson or feedback."); }
    } catch (error) {
      if (controller.signal.aborted) throw new Error(TIMEOUT);
      if (error instanceof TypeError) throw new Error("Could not connect. Check your internet connection and try again.");
      throw error;
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }

  function audioHTML(path) {
    if (!path) return "";
    return `<div class="grammar-audio" data-audio="${esc(path)}">
      <button class="btn ghost" type="button" data-play>Play recording</button>
      <audio controls preload="none" hidden aria-label="Exercise recording"></audio>
      <label>Speed <select aria-label="Playback speed"><option value="1">Normal</option><option value="0.75">Slower · 0.75×</option></select></label>
      <p class="status" role="status" aria-live="polite"></p></div>`;
  }
  function bindAudio() {
    host.querySelectorAll("[data-audio]").forEach(card => {
      const button = card.querySelector("[data-play]"), audio = card.querySelector("audio");
      const status = card.querySelector(".status"), speed = card.querySelector("select");
      speed.onchange = () => { audio.playbackRate = Number(speed.value); };
      audio.onplay = () => {
        playbackRequest++;
        host.querySelectorAll("audio").forEach(other => { if (other !== audio) other.pause(); });
      };
      button.onclick = async () => {
        const ticket = ++playbackRequest;
        stopAudio(false);
        button.disabled = true; status.textContent = "Loading recording…";
        try {
          const path = card.dataset.audio;
          if (!audioCache.has(path)) {
            if (!audioLoads.has(path)) {
              audioLoads.set(path, request("audio", { path }, true).then(blob => {
                if (!disposed) audioCache.set(path, URL.createObjectURL(blob));
              }).finally(() => audioLoads.delete(path)));
            }
            await audioLoads.get(path);
          }
          if (disposed || !host.contains(card)) return;
          if (ticket !== playbackRequest) { status.textContent = "Recording ready. Press play to listen."; return; }
          stopAudio(false);
          audio.src = audioCache.get(path); audio.hidden = false;
          audio.playbackRate = Number(speed.value);
          status.textContent = "";
          button.textContent = "Play again";
          try { await audio.play(); } catch (_) { status.textContent = "Recording ready. Press play to listen."; }
        } catch (error) { if (host.contains(card)) status.textContent = error.message; }
        finally { button.disabled = false; }
      };
    });
  }

  function catalog(error = "") {
    stopAudio();
    let accountId = null;
    try {
      const id = JSON.parse(new URLSearchParams(tg?.initData || "").get("user") || "null")?.id;
      if (Number.isSafeInteger(id) && id > 0) accountId = id;
    } catch (_) {}
    host.innerHTML = `<div class="grammar-hero"><p class="grammar-eyebrow">Your grammar practice</p>
      <h1>Grammar</h1><p class="sub">Understand a pattern. Hear it. Make it your own.</p></div>
      <button class="grammar-card grammar-unit-link" id="openUnit" type="button">
        <span class="grammar-eyebrow">Unit 01</span><strong>Present continuous<br>and present simple</strong>
        <span>States, actions and the meaning behind the form.</span>
        <span class="grammar-meta"><span>20 practice questions</span><span>Audio + writing</span></span>
        <span class="grammar-unit-open">Open unit →</span></button>
      <p class="status bad" id="grammarStatus" role="status" aria-live="polite">${esc(error)}</p>
      ${error && accountId ? `<details class="grammar-note"><summary>Connection help</summary><p>Your Telegram account ID: <strong>${accountId}</strong></p><p>Use this ID when enabling your private Grammar access.</p></details>` : ""}
      <p class="grammar-note">Your answers stay in this session only. Refreshing or leaving clears your work.</p>`;
    host.querySelector("#openUnit").onclick = openUnit;
  }

  async function openUnit() {
    const button = host.querySelector("#openUnit"), status = host.querySelector("#grammarStatus");
    if (button) button.disabled = true;
    if (status) { status.className = "status"; status.textContent = "Loading your unit…"; }
    try {
      const loaded = core.validateUnit(await request("unit", { unitId: "unit-001" }));
      if (disposed) return;
      if (loaded.id !== "unit-001") throw new Error("The server returned a different unit.");
      unit = loaded;
      const url = new URL(location.href); url.searchParams.set("unit", unit.id);
      history.replaceState(null, "", url);
      render();
    } catch (error) { if (!disposed) catalog(error.message); }
  }

  function questions(kind) {
    if (kind === "review") return unit.review;
    const all = core.allQuestions(unit);
    return kind === "listen" ? unit.listening.questionIds.map(id => all.find(question => question.id === id)) : all;
  }
  function record(kind, question) {
    return session[kind][question.id] ||= { response: question.type === "choice" ? [] : "", attempts: 0, correct: false, revealed: false, message: "" };
  }
  function done(kind) {
    return questions(kind).filter(q => session[kind][q.id]?.correct || session[kind][q.id]?.revealed).length;
  }
  function stepDetail(kind) {
    if (kind === "learn") return session.learn ? "Read" : "Start here";
    if (kind === "write") return session.feedback ? "Reviewed" : "Your words";
    return `${done(kind)} / ${questions(kind).length}`;
  }
  function go(next) { step = next; render(); host.querySelector("#stepContent").focus(); }
  function render() {
    stopAudio();
    host.innerHTML = `<header class="grammar-hero"><p class="grammar-eyebrow">Grammar · Unit ${String(unit.number).padStart(2, "0")}</p>
      <h1>${esc(unit.title)}</h1></header>
      <nav class="grammar-tabs" aria-label="Unit steps">${steps.map(([key, name]) => `<button type="button" class="grammar-tab" data-step="${key}" ${step === key ? 'aria-current="step"' : ""}>${name}<small>${stepDetail(key)}</small></button>`).join("")}</nav>
      <section id="stepContent" tabindex="-1" aria-label="${steps.find(([key]) => key === step)[1]}"></section>
      <p class="grammar-note">Session only · Your answers are cleared when you refresh or leave.</p>`;
    host.querySelectorAll("[data-step]").forEach(button => { button.onclick = () => go(button.dataset.step); });
    if (step === "learn") renderLearn();
    else if (step === "write") renderWriting();
    else renderQuestions(step);
    bindAudio();
  }
  const content = () => host.querySelector("#stepContent");
  function renderLearn() {
    content().innerHTML = `<div class="grammar-card"><h2>What you will practise</h2><ul>${unit.objectives.map(item => `<li>${esc(item)}</li>`).join("")}</ul></div>
      ${unit.theory.map(section => `<article class="grammar-card"><h2>${esc(section.title)}</h2>${section.paragraphs.map(p => `<p>${esc(p)}</p>`).join("")}
        ${section.examples.map(example => `<div class="grammar-example"><p>${esc(example.text)}</p><p class="grammar-note">${esc(example.note)}</p></div>`).join("")}</article>`).join("")}
      <p class="grammar-note">These explanations and examples were written for Umbrello. They are not the textbook's theory pages. Practice uses the Unit 1 CD-ROM exercises.</p>
      <button class="btn" id="startPractice" type="button">Start practice →</button>`;
    host.querySelector("#startPractice").onclick = () => { session.learn = true; go("practice"); };
  }

  function renderQuestions(kind) {
    const list = questions(kind), index = session.indexes[kind];
    if (index >= list.length) { renderSummary(kind); return; }
    const question = list[index], state = record(kind, question), complete = state.correct || state.revealed;
    const exercise = kind === "practice" ? unit.practice.find(e => e.questions.some(q => q.id === question.id)) : null;
    const title = exercise?.title || (kind === "listen" ? "Listen for the form" : "Use it in a new context");
    const instruction = exercise?.instruction || (kind === "listen" ? unit.listening.instruction : "Choose the form that fits the meaning. These are new examples.");
    content().innerHTML = `<h2 class="grammar-step-heading">${esc(title)}</h2><p class="sub">${esc(instruction)}</p>
      <div class="grammar-progress"><span>Question ${index + 1} of ${list.length}</span><div class="bar"><i style="width:${done(kind) / list.length * 100}%"></i></div></div>
      ${exercise?.wordBank.length ? `<div class="grammar-bank" aria-label="Verb bank">${exercise.wordBank.map(word => `<span>${esc(word)}</span>`).join("")}</div>` : ""}
      ${exercise?.examples.length ? `<details class="grammar-example-toggle"><summary>See worked examples</summary>${exercise.examples.map(e => `<div class="grammar-example">${esc(e.text)}${audioHTML(e.audio)}</div>`).join("")}</details>` : ""}
      <div class="grammar-card"><p class="grammar-question" id="questionText">${esc(question.prompt)}</p>
      ${kind === "listen" ? audioHTML(question.audio) : ""}
      <form id="answerForm" autocomplete="off">
        ${question.type === "gap" ? `<label class="grammar-label" for="grammarAnswer">Missing verb form</label><input class="grammar-input" id="grammarAnswer" type="text" maxlength="1000" spellcheck="false" autocorrect="off" autocapitalize="off" aria-describedby="questionText answerMessage" value="${esc(state.response)}" ${complete ? "disabled" : ""}>`
          : `<fieldset class="grammar-choices" ${complete ? "disabled" : ""}><legend>Select every correct answer. Sometimes both are possible.</legend>${question.options.map(option => `<label class="grammar-option"><input type="checkbox" name="choice" value="${esc(option.id)}" ${state.response.includes(option.id) ? "checked" : ""}><span>${esc(option.text)}</span></label>`).join("")}</fieldset>`}
        ${!complete ? '<button class="btn" type="submit">Check answer</button>' : ""}
      </form><p class="grammar-feedback-line" id="answerMessage" role="status" aria-live="polite">${esc(state.message)}</p>
      ${complete ? `<div class="grammar-result ${state.correct ? "correct" : ""}"><strong>${state.correct ? "Correct" : "Answer revealed"}</strong>
        <p class="grammar-checked-answer">${esc(question.modelAnswer)}</p><p>${esc(question.explanation)}</p></div>
        ${kind !== "listen" ? audioHTML(question.audio) : '<p class="grammar-note">Listen again and repeat the sentence aloud. Notice which words carry the meaning.</p>'}` : ""}
      ${!complete && state.attempts > 0 ? '<button class="grammar-link" id="revealAnswer" type="button">Reveal answer and explanation</button>' : ""}
      </div><div class="grammar-actions"><button class="btn ghost" id="previousQuestion" type="button" ${index === 0 ? "disabled" : ""}>← Previous</button>
        <button class="btn" id="nextQuestion" type="button" ${!complete ? "disabled" : ""}>${index === list.length - 1 ? "Finish step" : "Next →"}</button></div>`;
    const readResponse = () => question.type === "gap" ? host.querySelector("#grammarAnswer").value
      : [...host.querySelectorAll('input[name="choice"]:checked')].map(input => input.value);
    const form = host.querySelector("#answerForm");
    form.oninput = () => { if (!complete) { state.response = readResponse(); state.message = ""; host.querySelector("#answerMessage").textContent = ""; } };
    form.onsubmit = event => {
      event.preventDefault();
      if (complete) return;
      state.response = readResponse();
      if (question.type === "gap" ? !state.response.trim() : !state.response.length) {
        state.message = question.type === "gap" ? "Enter a verb form first." : "Select at least one answer.";
        host.querySelector("#answerMessage").textContent = state.message; return;
      }
      state.attempts++;
      state.correct = core.evaluate(question, state.response).correct;
      state.message = state.correct ? "" : "Not quite. Try again, or reveal the answer to understand the pattern.";
      vibrate(state.correct ? "success" : "error");
      render();
      if (!state.correct && question.type === "gap") host.querySelector("#grammarAnswer").focus();
    };
    const reveal = host.querySelector("#revealAnswer");
    if (reveal) reveal.onclick = () => { state.revealed = true; state.message = ""; render(); };
    host.querySelector("#previousQuestion").onclick = () => { if (index > 0) { session.indexes[kind]--; render(); } };
    host.querySelector("#nextQuestion").onclick = () => { if (complete) { session.indexes[kind]++; render(); content().focus(); } };
  }

  function renderSummary(kind) {
    const list = questions(kind), states = list.map(q => record(kind, q));
    const firstTry = states.filter(state => state.correct && state.attempts === 1 && !state.revealed).length;
    const revisited = list.filter(q => { const state = record(kind, q); return state.revealed || state.attempts > 1; });
    const next = kind === "practice" ? "listen" : kind === "listen" ? "write" : null;
    const allComplete = session.learn && session.feedback && ["practice", "listen", "review"].every(key => done(key) === questions(key).length);
    content().innerHTML = `<h2>${kind === "review" && allComplete ? "Unit complete for today" : `${steps.find(([key]) => key === kind)[1]} complete`}</h2>
      <p class="sub">${kind === "review" ? "You have checked the same ideas in new sentences." : "Take the pattern into the next step."}</p>
      <div class="grammar-stat-list"><div><strong>${firstTry} / ${list.length}</strong>Correct on the first try</div><div><strong>${revisited.length}</strong>Worth another look</div></div>
      ${revisited.length ? `<details class="grammar-card"><summary>Review this session's tricky answers</summary>${revisited.map(q => `<div class="grammar-correction"><p class="grammar-checked-answer">${esc(q.modelAnswer)}</p><p>${esc(q.explanation)}</p></div>`).join("")}</details>` : ""}
      ${next ? `<button class="btn" id="continueStep" type="button">Continue to ${steps.find(([key]) => key === next)[1]} →</button>` : `<div class="grammar-card"><h3>This session</h3>${steps.map(([key, name]) => `<p class="grammar-session-summary">${name} · ${stepDetail(key)}</p>`).join("")}</div>
        ${!allComplete ? '<p class="grammar-note">You can return to the other steps using the tabs above.</p>' : '<p class="grammar-note">Try describing a different situation aloud, using the same distinctions. This session is not saved.</p>'}`}
      <button class="btn ghost" id="reviewStep" type="button">Look through answers</button>
      ${!next ? `<a class="btn ghost" href="${Profiles.url("index.html")}">Back to menu</a>` : ""}`;
    if (next) host.querySelector("#continueStep").onclick = () => go(next);
    host.querySelector("#reviewStep").onclick = () => { session.indexes[kind] = 0; render(); };
  }

  function feedbackHTML(result) {
    return `<section class="grammar-card" aria-labelledby="feedbackTitle"><h2 id="feedbackTitle">Your feedback</h2><p>${esc(result.summary)}</p>
      ${result.errors.length ? result.errors.map(error => `<div class="grammar-correction"><p>${error.original ? `<span class="original">${esc(error.original)}</span> → ` : ""}<span class="correction">${esc(error.correction)}</span></p><p>${esc(error.explanation)}</p></div>`).join("")
        : '<p class="status ok">No errors found.</p>'}
      <h3>Using this unit's grammar</h3><p>${esc(result.targetFeedback)}</p>
      <details class="grammar-model"><summary>See one possible revision</summary><p>${esc(result.improvedVersion)}</p></details></section>`;
  }
  function validateFeedback(result, submitted) {
    const validText = (value, max) => typeof value === "string" && value.trim() && value.length <= max;
    if (!result || !validText(result.summary, 1500) || !validText(result.targetFeedback, 1500) || !validText(result.improvedVersion, 6000) ||
        !Array.isArray(result.errors) || result.errors.length > 20 || result.errors.some(error => !error || typeof error.original !== "string" ||
          typeof error.correction !== "string" || error.original.length > 6000 || error.correction.length > 6000 ||
          !validText(error.explanation, 1000) || (error.original && !submitted.includes(error.original)))) {
      throw new Error("The model returned incomplete feedback. Please try again.");
    }
    return result;
  }
  function renderWriting() {
    content().innerHTML = `<h2 class="grammar-step-heading">Make it your own</h2><p class="sub">Use the grammar to say something about your life.</p>
      <div class="grammar-card"><h3>Your task</h3><p class="grammar-writing-task">${esc(unit.writing.prompt)}</p>
        <details><summary>Before you check</summary><ul>${unit.writing.checklist.map(item => `<li>${esc(item)}</li>`).join("")}</ul></details></div>
      <form id="writingForm" autocomplete="off"><label class="grammar-label" for="grammarWriting">Your text</label>
        <textarea id="grammarWriting" class="grammar-writing" rows="8" maxlength="6000" spellcheck="false" autocorrect="off" autocapitalize="sentences" lang="en" ${session.checking ? "disabled" : ""}>${esc(session.writing)}</textarea>
        <div class="grammar-count"><span id="wordCount">${core.wordCount(session.writing)} words</span><span>Aim for ${unit.writing.minWords}–${unit.writing.maxWords}</span></div>
        <button class="btn" id="checkWriting" type="submit" ${session.checking ? "disabled" : ""}>${session.checking ? "Checking…" : "Check my writing"}</button></form>
      <p class="status" id="writingStatus" role="status" aria-live="polite">${esc(session.writingStatus)}</p>
      <div id="writingFeedback">${session.feedback ? feedbackHTML(session.feedback) : ""}</div>
      <p class="grammar-note">Checking sends this text for AI feedback. The feedback may need your judgement; a valid alternative is not an error.</p>
      <button class="btn ghost" id="goReview" type="button">Continue to review →</button>`;
    const textarea = host.querySelector("#grammarWriting");
    textarea.oninput = () => {
      session.writing = textarea.value;
      session.feedback = null; session.writingStatus = "";
      host.querySelector("#wordCount").textContent = `${core.wordCount(session.writing)} words`;
      host.querySelector("#writingFeedback").innerHTML = "";
      host.querySelector("#writingStatus").textContent = "";
      host.querySelector('[data-step="write"] small').textContent = "Your words";
    };
    host.querySelector("#writingForm").onsubmit = async event => {
      event.preventDefault();
      if (session.checking) return;
      const submitted = textarea.value.trim();
      session.writing = textarea.value;
      if (!submitted) { host.querySelector("#writingStatus").textContent = "Write your text first."; textarea.focus(); return; }
      session.checking = true; session.feedback = null; session.writingStatus = "Checking your meaning and grammar…";
      render();
      try { session.feedback = validateFeedback(await request("check", { unitId: unit.id, text: submitted }), submitted); session.writingStatus = ""; }
      catch (error) { session.writingStatus = error.message; }
      finally {
        session.checking = false;
        if (!disposed) {
          if (step === "write") render();
          else {
            host.querySelector('[data-step="write"] small').textContent = stepDetail("write");
            if (step === "review" && session.indexes.review >= questions("review").length) renderSummary("review");
          }
        }
      }
    };
    host.querySelector("#goReview").onclick = () => go("review");
  }

  catalog();
  if (new URLSearchParams(location.search).get("unit") === "unit-001") await openUnit();
})();
