/* Card tests: a list of numbered tests; in a test each card has four answers and turns over to its emoji hint.
   Mounted by test.js for the profile's users/<id>/tests/. Rules live in test-cards-core.js; the look is
   shared with Grammar lessons (tenses.css). */
(function () {
  "use strict";
  const core = window.TestCardsCore;
  const ICON = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
    ok: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>',
    bad: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
    turn: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.6-3.5M4 4v4h4M4 13a8 8 0 0 0 14.6 3.5M20 20v-4h-4"/></svg>',
  };
  const icon = name => `<span class="tn-ico" aria-hidden="true">${ICON[name]}</span>`;
  const isUkrainian = text => /[А-Яа-яІіЇїЄєҐґ]/.test(text);
  const langOf = text => (isUkrainian(text) ? "uk" : "en");

  async function mount(host, profile, menuUrl) {
    // Progress is kept on this device per Telegram account and profile, like Cards.
    const storeKey = Profiles.userId ? `umbrello.tests.v1.${Profiles.userId}.${profile.id}` : null;
    let store = null;
    try { if (storeKey) store = JSON.parse(localStorage.getItem(storeKey)); } catch (_) {}
    if (!store || typeof store.tests !== "object" || !store.tests) store = { tests: {} };
    const save = () => { try { if (storeKey) localStorage.setItem(storeKey, JSON.stringify(store)); } catch (_) {} };

    let passRating, tests;
    try {
      const index = core.validateIndex(await loadJSON(Profiles.content("tests/index.json")));
      passRating = index.passRating;
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
    const scoreOf = test => core.score(store.tests[test.id], test);
    const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one
      : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);

    function render(html, dir) {
      host.innerHTML = html;
      const screen = host.querySelector("#tcScreen");
      if (dir) screen.classList.add(dir === "back" ? "tn-in-back" : "tn-in");
    }

    /* ---------- list of tests ---------- */
    function list(dir) {
      stop();
      T = null;
      // The newest test is this week's homework, so it comes first; every test is open.
      render(`<div class="tn" id="tcScreen">
        <h1>Тести</h1><p class="sub">Тест складено, коли рейтинг ${core.fmt(passRating)}.</p>
        <ul class="tn-lessons">${tests.slice().reverse().map(test => {
          const p = store.tests[test.id], sc = scoreOf(test);
          const status = p.passed ? icon("star") + core.fmt(passRating) : p.round ? icon("star") + core.fmt(sc.rating) : "";
          return `<li><button class="tn-row${p.passed ? " done" : ""}" type="button" data-test="${test.id}">
            <span class="tn-num">${test.id}</span>
            <span><b>${esc(test.title)}</b><span>${esc(test.desc)}</span></span>
            <span class="tn-status">${status}</span></button></li>`;
        }).join("")}</ul></div>`, dir);
      host.querySelectorAll("[data-test]").forEach(button => {
        button.onclick = () => open(tests.find(test => test.id === +button.dataset.test));
      });
    }

    /* ---------- one test ---------- */
    function open(test) {
      const p = store.tests[test.id];
      T = { test, p };
      // The page was closed after the last answer of a round: finish that round first.
      if (core.roundOver(p)) return roundEnd();
      if (!p.order.length) newRound();
      screen();
      if (!p.seenInfo) { p.seenInfo = true; save(); info(true); }
    }

    function newRound() {
      core.newRound(T.p, T.test);
      save();
    }

    function screen() {
      render(`<div class="tn tn-lesson tc" id="tcScreen">
        <div class="tn-head">
          <button class="tn-icon-btn" id="tcBack" type="button" aria-label="До списку тестів">${icon("back")}</button>
          <h2>Тест ${T.test.id}</h2>
          <span class="tn-stat" title="Рейтинг">${icon("star")}<span id="tcRating"></span></span>
          <span class="tn-stat ok" title="Правильно">${icon("ok")}<span id="tcRight"></span></span>
          <span class="tn-stat bad" title="Помилки">${icon("bad")}<span id="tcWrong"></span></span>
          <button class="tn-icon-btn" id="tcInfo" type="button" aria-label="Як це працює">${icon("info")}</button>
        </div>
        <p class="tn-hint" id="tcAsk"></p>
        <button class="tc-card" id="tcCard" type="button">
          <span class="tc-flip">
            <span class="tc-face" id="tcFront"><span class="tc-word" id="tcWord"></span><span class="tc-turn" id="tcTurn">${icon("turn")}Підказка</span></span>
            <span class="tc-face tc-back" id="tcFaceBack" aria-hidden="true"><span class="tc-emoji" id="tcEmoji"></span></span>
          </span>
        </button>
        <p class="tc-note" id="tcNote" aria-live="polite"></p>
        <div class="tc-options" id="tcOptions"></div>
        <div class="tc-go" id="tcGoBox"></div>
        <div class="tn-progress" id="tcProgress" aria-hidden="true"></div>
      </div>`, "in");
      host.querySelector("#tcBack").onclick = () => list("back");
      host.querySelector("#tcInfo").onclick = () => info();
      host.querySelector("#tcCard").onclick = flip;
      question();
    }

    const items = () => T.test.items;
    function question() {
      const it = T.it = items().find(item => item.key === T.p.order[T.p.pos]);
      T.done = false;
      T.options = core.choices(it);
      host.querySelector("#tcAsk").textContent = isUkrainian(it.right) ? "Обери переклад"
        : isUkrainian(it.q) ? "Як це англійською?" : "Обери відповідь";
      const word = host.querySelector("#tcWord");
      word.textContent = it.q;
      // A word is set large; a question with a whole sentence in it, like a text.
      word.classList.toggle("long", it.q.length > 50);
      word.setAttribute("lang", langOf(it.q));
      host.querySelector("#tcTurn").hidden = !it.emoji;
      host.querySelector("#tcCard").disabled = !it.emoji;
      turn(false);
      host.querySelector("#tcEmoji").textContent = "";
      note();
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

    // The card turns over to its emoji and back. Seen before the answer, it is a hint.
    // The emoji is put on the back only when it is asked for: a card left turned over swings
    // back to the next word and would show that word's emoji on the way.
    function turn(over) {
      const card = host.querySelector("#tcCard");
      if (over) host.querySelector("#tcEmoji").textContent = T.it.emoji;
      card.classList.toggle("flipped", over);
      host.querySelector("#tcFront").setAttribute("aria-hidden", String(over));
      host.querySelector("#tcFaceBack").setAttribute("aria-hidden", String(!over));
      card.setAttribute("aria-label", over ? `${T.it.emoji}. Повернути картку` : T.it.emoji ? `${T.it.q}. Показати підказку` : T.it.q);
    }
    function flip() {
      if (!T.it.emoji) return;
      if (!T.done && T.p.hinted !== T.it.key) { T.p.hinted = T.it.key; save(); note(); }
      turn(!host.querySelector("#tcCard").classList.contains("flipped"));
    }
    function note() {
      host.querySelector("#tcNote").textContent = T.p.hinted === T.it.key ? "З підказкою картка повернеться ще раз" : "";
    }

    function choose(i) {
      if (T.done) return;
      T.done = true;
      const it = T.it, ok = T.options[i] === it.right, hint = T.p.hinted === it.key;
      core.answer(T.p, ok, hint, T.options[i]);
      // Kept now, so a page closed at this point keeps the star; the report goes out with the round.
      if (core.passed(core.score(T.p, T.test), passRating)) T.p.passed = true;
      save();
      vibrate(ok ? "success" : "error");
      host.querySelectorAll("[data-o]").forEach(button => {
        const text = T.options[+button.dataset.o];
        button.disabled = true;
        if (text === it.right) button.classList.add("right");
        else if (+button.dataset.o === i) button.classList.add("wrong");
      });
      stats();
      const go = () => { stop(); if (core.roundOver(T.p)) roundEnd(); else question(); };
      const box = host.querySelector("#tcGoBox");
      box.innerHTML = '<button class="btn" id="tcNext" type="button">Далі</button>';
      box.querySelector("#tcNext").onclick = go;
      box.querySelector("#tcNext").focus({ preventScroll: true });
      // A right answer moves on by itself; a wrong one waits so the right answer can be read.
      stop();
      if (ok) timer = setTimeout(go, 1100);
    }

    function stats() {
      const sc = scoreOf(T.test), current = T.done ? null : T.it.key;
      host.querySelector("#tcRating").textContent = core.fmt(sc.rating);
      host.querySelector("#tcRight").textContent = sc.right;
      host.querySelector("#tcWrong").textContent = sc.wrong;
      host.querySelector("#tcProgress").innerHTML = items().map(it =>
        `<i class="${T.p.marks[it.key] || ""}${it.key === current ? " cur" : ""}"></i>`).join("");
    }

    /* ---------- end of a round ---------- */
    function roundEnd() {
      stop();
      const { test, p } = T, sc = scoreOf(test), passed = core.passed(sc, passRating);
      const text = core.report(p, test, passRating), left = sc.total - sc.right;
      const item = key => items().find(it => it.key === key);
      const slips = p.log.map(m => `<div>${esc(item(m.key).q)}<br><b>${esc(item(m.key).right)}</b>${m.hint ? " <span>· з підказкою</span>" : ""}</div>`).join("");
      render(`<div class="center" id="tcScreen">
        <h2>${passed ? `Тест ${test.id} складено!` : `Коло ${p.round} пройдено`}</h2>
        <div class="big${passed ? " tn-big" : ""}">${core.fmt(sc.rating)}</div>
        <p class="sub">${passed ? "Усі відповіді правильні." : `До ${core.fmt(passRating)} лишилося: ${left} ${plural(left, "картка", "картки", "карток")}.`}</p>
        ${slips ? `<div class="mistakes">${slips}</div>` : ""}
        <p class="status" id="tcStatus"></p>
        <button class="btn ghost" id="tcRetry" type="button" style="display:none">Надіслати ще раз</button>
        ${passed ? "" : '<button class="btn" id="tcGo" type="button">Далі</button>'}
        <button class="btn ghost" id="tcMenu" type="button">До тестів</button>
        ${passed ? '<button class="btn ghost" id="tcHome" type="button">До меню</button>' : ""}
      </div>`, "in");
      // The round is closed here, so its report goes out once; opening the test later starts the next one.
      if (passed) { p.passed = true; core.restart(p); } else core.newRound(p, test);
      save();
      host.querySelector("#tcMenu").onclick = () => list("back");
      const home = host.querySelector("#tcHome"), go = host.querySelector("#tcGo");
      if (home) home.onclick = () => { location.href = menuUrl; };
      if (go) go.onclick = screen;
      if (profile.reports === false) return;
      const send = () => sendReport(`📝 Тест ${test.id}: ${test.title}`, text, host.querySelector("#tcStatus"), host.querySelector("#tcRetry"));
      host.querySelector("#tcRetry").onclick = send;
      send();
    }

    /* ---------- how it works ---------- */
    function info(first = false) {
      stop();
      const started = scoreOf(T.test).answered > 0;
      const veil = document.createElement("div");
      const close = () => { veil.remove(); document.removeEventListener("keydown", onKey, true); if (T.done) host.querySelector("#tcNext")?.focus({ preventScroll: true }); };
      const onKey = event => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
      veil.className = "tn-veil";
      veil.innerHTML = `<div class="tn-sheet" role="dialog" aria-modal="true"><h2>Як це працює</h2>
        <p class="sub">На картці слово, під нею чотири відповіді. Спроба одна.</p>
        ${items().some(it => it.emoji) ? '<p class="sub">Натисни на картку, і вона перевернеться: на звороті підказка. Відповідь із підказкою не додає рейтингу, і картка повернеться ще раз.</p>' : ""}
        <p class="sub">У першому колі всі картки, далі тільки ті, де ще немає правильної відповіді. Рейтинг ${core.fmt(passRating)} — тест складено.</p>
        <button class="btn" id="tcClose" type="button">${first ? "Почати" : "Зрозуміло"}</button>
        ${started ? '<button class="btn ghost tn-reset" id="tcReset" type="button">Почати тест заново</button>' : ""}</div>`;
      veil.addEventListener("click", event => { if (event.target === veil) close(); });
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(veil);
      veil.querySelector("#tcClose").onclick = close;
      veil.querySelector("#tcClose").focus({ preventScroll: true });
      const reset = veil.querySelector("#tcReset");
      if (!reset) return;
      let armed = false;
      reset.onclick = () => {
        if (!armed) { armed = true; reset.textContent = "Точно скинути відповіді?"; return; }
        core.restart(T.p);
        newRound();
        close();
        screen();
      };
    }

    list();
  }

  window.TestCards = { mount };
})();
