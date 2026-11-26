/* Card tests: a list of numbered tests and the mix; in a test each card has four answers and turns over to a sentence
   with the word. Mounted by test.js for the profile's users/<id>/tests/. Rules live in test-cards-core.js; the look is
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
        <button class="tn-row tc-mix" id="tcMix" type="button">
          <span class="tn-num">${icon("mix")}</span>
          <span><b>Мікс</b><span>${core.words(core.mix(tests).items.length)} з усіх тестів, щоразу нові</span></span></button>
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
      host.querySelector("#tcMix").onclick = openMix;
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

    /* ---------- one test, or the mix ---------- */
    // A test goes on from the first card without an answer; it is saved after every answer.
    function open(test) {
      T = { test, p: store.tests[test.id], name: `Тест ${test.id}` };
      // The page was closed right after the last answer: show the result and send it first.
      if (core.over(T.p, test)) return result();
      screen();
    }
    // The mix is new every time and is not saved: closed, it is gone.
    function openMix() {
      const test = core.mix(tests);
      T = { test, p: core.reconcile(null, test), name: "Мікс", mix: true };
      screen();
    }
    const keep = () => { if (!T.mix) save(); };

    function screen() {
      render(`<div class="tn tn-lesson tc" id="tcScreen">
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
        <div class="tc-options" id="tcOptions"></div>
        <div class="tc-go" id="tcGoBox"></div>
        <div class="tn-progress" id="tcProgress" aria-hidden="true"></div>
      </div>`, "in");
      host.querySelector("#tcBack").onclick = () => list("back");
      host.querySelector("#tcCard").onclick = flip;
      question();
    }

    const items = () => T.test.items;
    function question() {
      const it = T.it = items()[core.next(T.p, T.test)];
      T.done = T.turned = false;
      T.options = core.choices(it);
      host.querySelector("#tcAsk").textContent = isUkrainian(it.right) ? "Обери переклад"
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

    function choose(i) {
      if (T.done) return;
      T.done = true;
      const it = T.it, ok = T.options[i] === it.right;
      core.answer(T.p, it, ok, T.turned, T.options[i]);
      keep();
      vibrate(ok ? "success" : "error");
      host.querySelectorAll("[data-o]").forEach(button => {
        const text = T.options[+button.dataset.o];
        button.disabled = true;
        if (text === it.right) button.classList.add("right");
        else if (+button.dataset.o === i) button.classList.add("wrong");
      });
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

    /* ---------- end of the pass ---------- */
    function result() {
      stop();
      const { test, p } = T, sc = core.score(p, test), text = core.report(p, test);
      const item = key => items().find(it => it.key === key);
      const slips = p.log.filter(m => !m.hint).map(m => `<div>${esc(item(m.key).q)}<br><b>${esc(item(m.key).right)}</b></div>`).join("");
      render(`<div class="center" id="tcScreen">
        <h2>${T.name}: готово</h2>
        <div class="big${sc.wrong ? "" : " tn-big"}">${core.fmt(sc.rating)}</div>
        <p class="sub">Правильно: ${sc.right} з ${sc.total}.</p>
        ${slips ? `<div class="mistakes">${slips}</div>` : ""}
        <p class="status" id="tcStatus"></p>
        <button class="btn ghost" id="tcRetry" type="button" style="display:none">Надіслати ще раз</button>
        <button class="btn" id="tcAgain" type="button">${T.mix ? "Новий мікс" : "Пройти ще раз"}</button>
        <button class="btn ghost" id="tcMenu" type="button">До тестів</button>
      </div>`, "in");
      // The pass is closed here, so its report goes out once; opening the test again starts from the first card.
      if (!T.mix) { core.finish(p, test); save(); }
      host.querySelector("#tcMenu").onclick = () => list("back");
      host.querySelector("#tcAgain").onclick = T.mix ? openMix : () => open(test);
      if (profile.reports === false) return;
      const title = T.mix ? "🎲 Мікс" : `📝 Тест ${test.id}`;
      const send = () => sendReport(title, text, host.querySelector("#tcStatus"), host.querySelector("#tcRetry"));
      host.querySelector("#tcRetry").onclick = send;
      send();
    }

    list();
  }

  window.TestCards = { mount };
})();
