(async function () {
  "use strict";
  const host = document.getElementById("app");
  if (!await Profiles.shared(host)) return;
  const menuUrl = Profiles.url("index.html");
  backTo(menuUrl);
  const core = GrammarCore;
  // Test and Learn are tabs of one page; the tab lives in the URL, like Listen's level filter.
  const tab = new URLSearchParams(location.search).get("tab") === "learn" ? "learn" : "test";
  const tabUrl = id => Profiles.url("grammar.html") + (id === "test" ? "" : `&tab=${id}`);
  document.getElementById("grammarTabs").innerHTML = [["test", "Test"], ["learn", "Learn"]].map(([id, title]) =>
    `<a href="${tabUrl(id)}"${id === tab ? ' aria-current="page"' : ""}>${title}</a>`).join("");
  let blocks = [], level = 0, order = [], index = 0, answers = [], started = 0, locked = false;

  // Grammar lessons are not written yet; they will live in grammar/ next to the level test.
  function learn() {
    host.innerHTML = `<div class="center"><h1>Learn</h1><p class="sub">Grammar lessons will appear here soon.</p></div>`;
  }

  async function load() {
    try {
      blocks = core.validateTest(await loadJSON("grammar/level-test.json"));
      intro();
    } catch (error) {
      showError(host, error, load);
    }
  }

  function intro() {
    host.innerHTML = `<h1>Grammar level test</h1>
      <p class="sub">Find out your grammar level, from A1 to C2.</p>
      <ul class="grammar-rules">
        <li>Up to ${blocks.flat().length} questions, about 15 minutes.</li>
        <li>Choose the answer that fits the gap.</li>
        <li>Not sure? Tap “I don't know” instead of guessing.</li>
        <li>The test stops when the questions get too hard.</li>
      </ul>
      <button class="btn" id="start">Start</button>`;
    host.querySelector("#start").onclick = start;
  }

  function start() {
    level = 0;
    answers = [];
    started = Date.now();
    begin();
  }

  // Each level is a block of eight questions in a fresh order.
  function begin() {
    order = shuffle(blocks[level]);
    index = 0;
    show();
  }

  function show() {
    const item = order[index];
    const options = shuffle([item.right, ...item.wrong]);
    locked = false;
    host.innerHTML = `
      <div class="grammar-levels">${core.LEVELS.map((name, i) =>
        `<span class="${i < level ? "done" : i === level ? "current" : ""}">${name}</span>`).join("")}</div>
      <div class="top">
        <span class="counter">${index + 1} / ${order.length}</span>
        <div class="bar"><i style="width:${index / order.length * 100}%"></i></div>
      </div>
      <div class="question">${esc(item.q).replace("___", () => '<span class="grammar-gap">___</span>')}</div>
      <div class="options">${options.map((option, i) => `<button class="opt" data-answer="${i}">${esc(option)}</button>`).join("")}</div>
      <button class="grammar-skip" data-answer="skip">I don't know</button>`;
    host.querySelectorAll("[data-answer]").forEach(button => {
      const choice = button.dataset.answer === "skip" ? null : options[button.dataset.answer];
      button.onclick = () => choose(button, item, choice);
    });
  }

  // A tap is only acknowledged; right and wrong are revealed in the review at the end.
  function choose(button, item, choice) {
    if (locked) return;
    locked = true;
    button.classList.add("chosen");
    answers.push({ ...item, choice, correct: choice === item.right });
    setTimeout(next, 250);
  }

  function next() {
    if (++index < order.length) { show(); return; }
    const score = answers.filter(answer => answer.level === core.LEVELS[level] && answer.correct).length;
    if (score >= core.PASS && ++level < blocks.length) begin();
    else finish();
  }

  function finish() {
    const result = core.summary(answers);
    const minutes = Math.round((Date.now() - started) / 60000);
    const mistakes = answers.filter(answer => !answer.correct);
    host.innerHTML = `<div class="grammar-result">
      <p class="sub">Your grammar level</p>
      <div class="big">${result.level || "Pre-A1"}</div>
      <p class="grammar-name">${result.name}${result.close ? ` · close to ${result.next}` : ""}</p>
      <div class="grammar-scores">${result.scores.map((score, i) =>
        `<span class="${score >= core.PASS ? "pass" : "miss"}">${core.LEVELS[i]} ${score}/${core.PER_LEVEL}</span>`).join("")}</div>
      <p class="status" id="status"></p>
      <button class="btn ghost" id="retry" style="display:none">Send again</button>
      ${mistakes.length ? `<h2>Mistakes</h2><div class="mistakes">${mistakes.map(answer => `<div>
        ${esc(answer.q).replace("___", () => `<b>${esc(answer.right)}</b>`)}
        <span>Your answer: ${answer.choice === null ? "I don't know" : esc(answer.choice)}</span>
        <span class="grammar-explain" lang="uk">${esc(answer.explain)}</span>
      </div>`).join("")}</div>` : ""}
      <button class="btn" id="again">Take the test again</button>
      <button class="btn ghost" id="menu">Finish</button>
    </div>`;
    const status = host.querySelector("#status"), retry = host.querySelector("#retry");
    host.querySelector("#again").onclick = start;
    host.querySelector("#menu").onclick = () => { location.href = menuUrl; };
    // Shared section: no profile, so every result goes to the bot with the sender's Telegram name.
    const send = () => sendReport("🧩 Граматика", core.reportText(result, minutes), status, retry);
    retry.onclick = send;
    send();
  }

  if (tab === "learn") learn();
  else load();
})();
