/* Card tests: a list of numbered tests and two mixes; a card has four answers, or a field to write the English word in,
   and turns over to a sentence with the word. Mounted by test.js for the profile's users/<id>/tests/. Rules live in test-cards-core.js; the look is
   shared with Grammar lessons (tenses.css). */
(function () {
  "use strict";
  const core = window.TestCardsCore;
  const ICON = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
    ok: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>',
    bad: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
    turn: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.6-3.5M4 4v4h4M4 13a8 8 0 0 0 14.6 3.5M20 20v-4h-4"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/></svg>',
    write: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/></svg>',
    mix: '<svg viewBox="0 0 24 24"><path d="M4 7h3.5c4.5 0 4.5 10 9 10H20M17 14l3 3-3 3M4 17h3.5c1.6 0 2.6-1.3 3.4-3M20 7h-3.5c-1.6 0-2.6 1.3-3.4 3M17 4l3 3-3 3"/></svg>',
  };
  const icon = name => `<span class="tn-ico" aria-hidden="true">${ICON[name]}</span>`;
  const isUkrainian = core.isUkrainian;
  const langOf = text => (isUkrainian(text) ? "uk" : "en");

  async function mount(host, profile, menuUrl) {
    // Progress is kept on this device per Telegram account and profile, like Cards.
    const storeKey = Profiles.userId ? `umbrello.tests.v1.${Profiles.userId}.${profile.id}` : null;
    let store = null;
    try { if (storeKey) store = JSON.parse(localStorage.getItem(storeKey)); } catch (_) {}
    if (!store || typeof store.tests !== "object" || !store.tests) store = { tests: {} };
    const save = () => { try { if (storeKey) localStorage.setItem(storeKey, JSON.stringify(store)); } catch (_) {} };

    let tests;
    try {
      const index = core.validateIndex(await loadJSON(Profiles.content("tests/index.json")));
      tests = await Promise.all(index.tests.map(async id => {
        const file = Profiles.content(`tests/${id}/test.json`);
        return { id, ...core.validate(await loadJSON(file), file) };
      }));
    } catch (error) {
      showError(host, error, () => mount(host, profile, menuUrl));
      return;
    }
    if (!tests.length) { Profiles.empty(host, "Test", "Тестів поки немає."); return; }
    for (const test of tests) store.tests[test.id] = core.reconcile(store.tests[test.id], test);
    // The words that went wrong, wherever: the mixes take them first.
    store.weak = core.cleanWeak(store.weak, tests, store.tests);

    let T = null, timer = null;
    const stop = () => { clearTimeout(timer); timer = null; };

    function render(html, dir) {
      host.innerHTML = html;
      const screen = host.querySelector("#tcScreen");
      if (dir) screen.classList.add(dir === "back" ? "tn-in-back" : "tn-in");
    }

    /* ---------- list of tests ---------- */
    function list(dir) {
      stop();
      T = null;
      // The newest test is this week's homework, so the numbers go down; every test is open whatever its rating.
      render(`<div class="tn" id="tcScreen">
        <h1>Тести</h1>
        <div class="tc-mixes">
          <button class="tn-row" id="tcMix" type="button">
            <span class="tn-num">${icon("mix")}</span><span><b>Мікс</b><span>Обираєш відповідь</span></span></button>
          ${core.mix(tests, { write: true }).items.length ? `<button class="tn-row" id="tcWriteMix" type="button">
            <span class="tn-num">${icon("write")}</span><span><b>Мікс: пишу</b><span>Пишеш англійською</span></span></button>` : ""}
        </div>
        <ul class="tn-lessons">${tests.slice().sort((a, b) => b.id - a.id).map(test => {
          const p = store.tests[test.id], answered = test.items.filter(it => p.marks[it.key]).length;
          const status = answered ? `${answered}/${test.items.length}` : p.last === null ? "" : icon("star") + core.fmt(p.last);
          return `<li class="tc-item"><button class="tn-row" type="button" data-test="${test.id}">
            <span class="tn-num">${test.id}</span>
            <span><b>Тест ${test.id}</b><span>${core.words(core.wordList(test).length)}</span></span>
            <span class="tn-status">${status}</span></button>
            <button class="tc-info" type="button" data-info="${test.id}" aria-label="Слова тесту ${test.id}">${icon("info")}</button></li>`;
        }).join("")}</ul></div>`, dir);
      const byId = id => tests.find(test => test.id === +id);
      host.querySelector("#tcMix").onclick = () => openMix(false);
      const writeMix = host.querySelector("#tcWriteMix");
      if (writeMix) writeMix.onclick = () => openMix(true);
      host.querySelectorAll("[data-test]").forEach(button => { button.onclick = () => open(byId(button.dataset.test)); });
      host.querySelectorAll("[data-info]").forEach(button => { button.onclick = () => info(byId(button.dataset.info)); });
    }

    // The words of a test, without opening it.
    function info(test) {
      const words = core.wordList(test);
      sheet(`<h2>Тест ${test.id}</h2><p class="sub">${core.words(words.length)}</p>
        <ul class="tc-words">${words.map(w => `<li><b lang="${langOf(w.word)}">${esc(w.word)}</b>
          <span lang="${langOf(w.translation)}">${esc(w.translation)}</span></li>`).join("")}</ul>
        <button class="btn" id="tcWordsClose" type="button">Закрити</button>`,
      (veil, close) => { veil.querySelector("#tcWordsClose").onclick = close; });
    }
    function sheet(html, ready) {
      const veil = document.createElement("div");
      veil.className = "tn-veil";
      veil.innerHTML = `<div class="tn-sheet" role="dialog" aria-modal="true">${html}</div>`;
      const close = () => { veil.remove(); document.removeEventListener("keydown", onKey, true); };
      const onKey = event => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
      veil.addEventListener("click", event => { if (event.target === veil) close(); });
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(veil);
      ready(veil, close);
      veil.querySelector("button")?.focus({ preventScroll: true });
    }

    /* ---------- a run: a test, a mix, or the mistakes of a run once more ---------- */
    // A test goes on from the first card without an answer; it is saved after every answer.
    function open(test) {
      T = { test, p: store.tests[test.id], name: `Тест ${test.id}`, report: `📝 Тест ${test.id}`,
        again: () => open(test), againText: "Пройти ще раз" };
      // The page was closed right after the last answer: show the result and send it first.
      if (core.over(T.p, test)) return result();
      screen();
    }
    // A mix is new every time and its place is not saved: closed, it is gone. Only the words that went wrong are kept.
    function openMix(write) {
      const test = core.mix(tests, { weak: store.weak, write });
      T = { test, p: core.reconcile(null, test), name: write ? "Мікс: пишу" : "Мікс", report: write ? "✍️ Мікс: пишу" : "🎲 Мікс",
        again: () => openMix(write), againText: "Новий мікс" };
      screen();
    }
    // The cards that went wrong, in the same way (written, if they were written), until none is left.
    function repeat(run, wrong) {
      const from = run.from || run.name;
      T = { test: wrong, p: core.reconcile(null, wrong), name: "Помилки", report: `🔁 Помилки: ${from}`, from };
      screen();
    }

    function screen() {
      const write = T.test.write === true;
      render(`<div class="tn tn-lesson tc${write ? " tc-writing" : ""}" id="tcScreen">
        <div class="tn-head">
          <button class="tn-icon-btn" id="tcBack" type="button" aria-label="До списку тестів">${icon("back")}</button>
          <h2>${T.name}</h2>
          <span class="tn-stat" title="Рейтинг">${icon("star")}<span id="tcRating"></span></span>
          <span class="tn-stat ok" title="Правильно">${icon("ok")}<span id="tcRight"></span></span>
          <span class="tn-stat bad" title="Помилки">${icon("bad")}<span id="tcWrong"></span></span>
        </div>
        <p class="tn-hint" id="tcAsk"></p>
        <button class="tc-card" id="tcCard" type="button">
          <span class="tc-flip">
            <span class="tc-face" id="tcFront"><span class="tc-word" id="tcWord"></span><span class="tc-turn" id="tcTurn">${icon("turn")}</span></span>
            <span class="tc-face tc-back" id="tcFaceBack" aria-hidden="true"><span class="tc-hint" id="tcHint" lang="en"></span></span>
          </span>
        </button>
        ${write ? `<div class="tc-write">
          <p class="tc-mask" id="tcMask" lang="en" aria-hidden="true"></p>
          <div class="tc-field">
            <input class="tc-input" id="tcInput" type="text" lang="en" autocomplete="off" autocapitalize="off" autocorrect="off"
              spellcheck="false" enterkeyhint="done" aria-label="Слово англійською">
            <button class="btn" id="tcCheck" type="button">Перевірити</button>
          </div>
          <p class="tc-correct" id="tcCorrect"></p>
        </div>` : '<div class="tc-options" id="tcOptions"></div>'}
        <div class="tc-go" id="tcGoBox"></div>
        <div class="tn-progress" id="tcProgress" aria-hidden="true"></div>
      </div>`, "in");
      host.querySelector("#tcBack").onclick = () => list("back");
      host.querySelector("#tcCard").onclick = flip;
      if (write) {
        host.querySelector("#tcCheck").onclick = check;
        host.querySelector("#tcInput").onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); check(); } };
      }
      question();
    }

    const items = () => T.test.items;
    function question() {
      const it = T.it = items()[core.next(T.p, T.test)];
      T.done = T.turned = false;
      host.querySelector("#tcAsk").textContent = T.test.write ? "Напиши англійською" : isUkrainian(it.right) ? "Обери переклад"
        : isUkrainian(it.q) ? "Як це англійською?" : "Обери відповідь";
      const word = host.querySelector("#tcWord");
      word.textContent = it.q;
      // A word is set large; a question with a whole sentence in it, like a text.
      word.classList.toggle("long", it.q.length > 50);
      word.setAttribute("lang", langOf(it.q));
      host.querySelector("#tcTurn").hidden = !it.hint;
      host.querySelector("#tcCard").disabled = !it.hint;
      turn(false);
      host.querySelector("#tcHint").innerHTML = "";
      host.querySelector("#tcGoBox").innerHTML = "";
      if (T.test.write) {
        host.querySelector("#tcMask").textContent = core.mask(it.right);
        const input = host.querySelector("#tcInput");
        input.value = "";
        input.disabled = false;
        input.classList.remove("right", "wrong");
        host.querySelector("#tcCheck").hidden = false;
        host.querySelector("#tcCorrect").innerHTML = "";
        stats();
        input.focus({ preventScroll: true });
        return;
      }
      T.options = core.choices(it);
      const box = host.querySelector("#tcOptions");
      // Two columns hold a word or two; longer answers, and words too long for half a small phone, go one under another.
      // Decided by the longest answer of the card, so the layout is the same each time it comes up.
      box.classList.toggle("long", [it.right, ...it.wrong].some(text => text.length > 26 || text.split(" ").some(w => w.length > 12)));
      box.innerHTML = T.options.map((text, i) =>
        `<button class="opt" type="button" data-o="${i}" lang="${langOf(text)}">${esc(text)}</button>`).join("");
      box.querySelectorAll("[data-o]").forEach(button => { button.onclick = () => choose(+button.dataset.o); });
      stats();
    }

    // The card turns over to its sentence and back. Seen before the answer, it is a hint.
    // The sentence is put on the back only when it is asked for: a card left turned over swings
    // back to the next word and would show that word's sentence on the way.
    function turn(over) {
      const card = host.querySelector("#tcCard");
      if (over) sentence();
      card.classList.toggle("flipped", over);
      host.querySelector("#tcFront").setAttribute("aria-hidden", String(over));
      host.querySelector("#tcFaceBack").setAttribute("aria-hidden", String(!over));
      card.setAttribute("aria-label", over ? `${sentenceText()} Повернути картку` : T.it.hint ? `${T.it.q}. Перевернути картку` : T.it.q);
    }
    // The word that is asked for is left out until the answer is given.
    const hidden = () => T.it.hint.gap && !T.done;
    const sentenceText = () => T.it.hint.before + (hidden() ? "…" : T.it.hint.word) + T.it.hint.after;
    function sentence() {
      const { before, word, after } = T.it.hint;
      host.querySelector("#tcHint").innerHTML = esc(before) + (hidden() ? '<span class="tc-gap">______</span>' : `<b>${esc(word)}</b>`) + esc(after);
    }
    function flip() {
      if (!T.it.hint) return;
      if (!T.done) T.turned = true;
      turn(!host.querySelector("#tcCard").classList.contains("flipped"));
    }

    // The answer is kept at once: a test's place, and in any run the words that went wrong.
    function answered(ok, given) {
      T.done = true;
      core.answer(T.p, T.it, ok, T.turned, given);
      core.track(store.weak, T.it, ok);
      save();
      vibrate(ok ? "success" : "error");
    }

    function choose(i) {
      if (T.done) return;
      const it = T.it, ok = T.options[i] === it.right;
      answered(ok, T.options[i]);
      host.querySelectorAll("[data-o]").forEach(button => {
        const text = T.options[+button.dataset.o];
        button.disabled = true;
        if (text === it.right) button.classList.add("right");
        else if (+button.dataset.o === i) button.classList.add("wrong");
      });
      after(ok);
    }

    // One try: an empty field is not an answer yet.
    function check() {
      const input = host.querySelector("#tcInput");
      if (T.done || !input.value.trim()) return;
      const ok = core.written(T.it, input.value);
      answered(ok, input.value.trim());
      input.disabled = true;
      input.classList.add(ok ? "right" : "wrong");
      host.querySelector("#tcCheck").hidden = true;
      if (!ok) host.querySelector("#tcCorrect").innerHTML = `Правильно: <b lang="en">${esc(T.it.right)}</b>`;
      after(ok);
    }

    function after(ok) {
      if (host.querySelector("#tcCard").classList.contains("flipped")) turn(true);
      stats();
      const go = () => { stop(); if (core.over(T.p, T.test)) result(); else question(); };
      // A right answer moves on by itself; a wrong one waits for the button so the right answer can be read.
      stop();
      if (ok) { timer = setTimeout(go, 1100); return; }
      host.querySelector("#tcGoBox").innerHTML = '<button class="btn" id="tcNext" type="button">Далі</button>';
      const next = host.querySelector("#tcNext");
      next.onclick = go;
      next.focus({ preventScroll: true });
    }

    function stats() {
      const sc = core.score(T.p, T.test), current = T.done ? null : T.it.key;
      host.querySelector("#tcRating").textContent = core.fmt(sc.rating);
      host.querySelector("#tcRight").textContent = sc.right;
      host.querySelector("#tcWrong").textContent = sc.wrong;
      host.querySelector("#tcProgress").innerHTML = items().map(it =>
        `<i class="${T.p.marks[it.key] || ""}${it.key === current ? " cur" : ""}"></i>`).join("");
    }

    /* ---------- end of a run ---------- */
    function result() {
      stop();
      const run = T, { test, p } = run, sc = core.score(p, test), text = core.report(p, test), wrong = core.mistakes(p, test);
      const item = key => items().find(it => it.key === key);
      const slips = p.log.filter(m => !m.hint).map(m => `<div>${esc(item(m.key).q)}<br><b>${esc(item(m.key).right)}</b></div>`).join("");
      const n = wrong.items.length;
      render(`<div class="center" id="tcScreen">
        <h2>${run.name}: готово</h2>
        <div class="big${sc.wrong ? "" : " tn-big"}">${core.fmt(sc.rating)}</div>
        <p class="sub">Правильно: ${sc.right} з ${sc.total}.</p>
        ${slips ? `<div class="mistakes">${slips}</div>` : ""}
        <p class="status" id="tcStatus"></p>
        <button class="btn ghost" id="tcRetry" type="button" style="display:none">Надіслати ще раз</button>
        ${n ? `<button class="btn" id="tcRepeat" type="button">Повторити помилки (${n})</button>` : ""}
        ${run.again ? `<button class="btn${n ? " ghost" : ""}" id="tcAgain" type="button">${run.againText}</button>` : ""}
        <button class="btn ghost" id="tcMenu" type="button">До тестів</button>
      </div>`, "in");
      // The run is closed here, so its report goes out once; a test opened again starts from the first card.
      if (p === store.tests[test.id]) { core.finish(p, test); save(); }
      host.querySelector("#tcMenu").onclick = () => list("back");
      if (n) host.querySelector("#tcRepeat").onclick = () => repeat(run, wrong);
      if (run.again) host.querySelector("#tcAgain").onclick = run.again;
      if (profile.reports === false) return;
      const send = () => sendReport(run.report, text, host.querySelector("#tcStatus"), host.querySelector("#tcRetry"));
      host.querySelector("#tcRetry").onclick = send;
      send();
    }

    list();
  }

  window.TestCards = { mount };
})();
