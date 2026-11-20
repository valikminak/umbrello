/* Grammar → Tenses: lessons where the learner builds the English sentence from tiles.
   Mounted by grammar.js on grammar.html?tab=tenses. Rules live in tenses-core.js. */
(function () {
  "use strict";
  const core = window.TensesCore;
  const ICON = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
    ok: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>',
    bad: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  };
  const icon = name => `<span class="tn-ico" aria-hidden="true">${ICON[name]}</span>`;

  async function mount(host) {
    let data;
    try {
      data = core.validate(await loadJSON("grammar/tenses.json"));
    } catch (error) {
      showError(host, error, () => mount(host));
      return;
    }
    const lex = data.lex;

    // Progress is kept on this device per Telegram account, like Cards and Books.
    const key = Profiles.userId ? `umbrello.tenses.v1.${Profiles.userId}` : null;
    let store = { lessons: {} };
    try { if (key) store = JSON.parse(localStorage.getItem(key)) || store; } catch (_) {}
    if (!store || typeof store.lessons !== "object") store = { lessons: {} };
    const save = () => { try { if (key) localStorage.setItem(key, JSON.stringify(store)); } catch (_) {} };
    const progress = id => (store.lessons[id] ||= { marks: {}, order: [], pos: 0, passed: false });
    const scoreOf = lesson => core.score(lesson.items.length, progress(lesson.id).marks);
    const unlocked = i => data.lessons[i].ready && (i === 0 || progress(data.lessons[i - 1].id).passed);

    let L = null, timer = null;
    const stop = () => { clearTimeout(timer); timer = null; };

    /* ---------- lesson list ---------- */
    function menu() {
      stop();
      L = null;
      host.innerHTML = `<div class="tn">
        <h1>${esc(data.title)}</h1><p class="sub">${esc(data.subtitle)}</p>
        <ul class="tn-lessons">${data.lessons.map((lesson, i) => {
          const open = unlocked(i), p = progress(lesson.id), sc = scoreOf(lesson);
          const status = !open ? icon("lock") : p.passed ? icon("star") + core.fmt(sc.rating) : sc.answered ? `${sc.answered}/${sc.total}` : "";
          return `<li><button class="tn-row${open ? "" : " locked"}${p.passed ? " done" : ""}" type="button"
              ${open ? `data-lesson="${i}"` : 'disabled aria-disabled="true"'}>
            <span class="tn-num">${lesson.id}</span>
            <span><b>${esc(lesson.title)}</b><span>${esc(lesson.desc)}</span></span>
            <span class="tn-status">${status}</span></button></li>`;
        }).join("")}</ul></div>`;
      host.querySelectorAll("[data-lesson]").forEach(button => { button.onclick = () => open(+button.dataset.lesson); });
    }

    /* ---------- one lesson ---------- */
    function open(index) {
      const lesson = data.lessons[index], p = progress(lesson.id);
      L = { index, lesson, p, wasPassed: p.passed };
      if (p.order.length !== lesson.items.length || p.pos >= p.order.length) newRound();
      host.innerHTML = `<div class="tn tn-lesson">
        <div class="tn-head">
          <button class="tn-icon-btn" id="tnBack" type="button" aria-label="До списку уроків">${icon("back")}</button>
          <h2>Урок ${lesson.id}</h2>
          <span class="tn-stat" title="Рейтинг">${icon("star")}<span id="tnRating"></span></span>
          <span class="tn-stat ok" title="Правильно">${icon("ok")}<span id="tnRight"></span></span>
          <span class="tn-stat bad" title="Помилки">${icon("bad")}<span id="tnWrong"></span></span>
          <button class="tn-icon-btn" id="tnInfo" type="button" aria-label="Як це працює">${icon("info")}</button>
        </div>
        <p class="tn-hint">Перекладіть речення</p>
        <p class="tn-uk" id="tnUk" lang="uk"></p>
        <div class="tn-answer-row">
          <div class="tn-answer" id="tnAnswer" aria-live="polite"></div>
          <button class="tn-undo" id="tnUndo" type="button" aria-label="Відмінити останнє слово" hidden>${icon("undo")}</button>
        </div>
        <div class="tn-fix" id="tnFix" aria-live="polite"></div>
        <div class="tn-bank" id="tnBank"></div>
        <div class="tn-progress" id="tnProgress" aria-hidden="true"></div>
      </div>`;
      host.querySelector("#tnBack").onclick = menu;
      host.querySelector("#tnInfo").onclick = info;
      host.querySelector("#tnUndo").onclick = undo;
      question();
    }

    function newRound() {
      const p = L.p, last = p.order.length ? p.order[p.order.length - 1] : -1;
      p.order = core.newOrder(L.lesson.items.length, last);
      p.pos = 0;
      save();
    }

    // The sentence on screen. Kept apart from the round position, which moves on as soon as it is answered.
    const current = () => L.it;
    const chosenWords = () => L.chosen.map(id => L.tiles[id]);

    function question() {
      L.it = L.lesson.items[L.p.order[L.p.pos]];
      L.done = false;
      L.chosen = [];
      L.tiles = core.bank(current(), lex);
      host.querySelector("#tnUk").textContent = current().uk;
      host.querySelector("#tnFix").innerHTML = "";
      answer();
      tiles();
      stats();
    }

    function answer(state) {
      const box = host.querySelector("#tnAnswer"), it = current(), words = chosenWords();
      box.className = "tn-answer" + (state ? " " + state : "");
      const html = words.map((w, i) => {
        let text = i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
        if (state && i === words.length - 1) text += it.q ? "?" : ".";
        return state ? `<span lang="en">${esc(text)}</span>`
          : `<button class="tn-word" type="button" lang="en" data-k="${i}" aria-label="Прибрати ${esc(w)}">${esc(text)}</button>`;
      });
      if (!state) html.push('<span class="tn-caret"></span>');
      box.innerHTML = html.join("");
      box.querySelectorAll("[data-k]").forEach(button => {
        button.onclick = () => { L.chosen.splice(+button.dataset.k, 1); answer(); tiles(); };
      });
      host.querySelector("#tnUndo").hidden = Boolean(state) || !L.chosen.length;
    }

    function tiles() {
      const box = host.querySelector("#tnBank");
      box.innerHTML = L.tiles.map((t, id) => {
        const used = L.chosen.includes(id);
        return `<button class="tn-tile${used ? " used" : ""}" type="button" lang="en" data-id="${id}"${used ? ' tabindex="-1" aria-hidden="true"' : ""}>${esc(t)}</button>`;
      }).join("");
      box.querySelectorAll("[data-id]").forEach(button => { button.onclick = () => add(+button.dataset.id); });
    }

    // Nothing is judged until the last word is in place; a word can be taken back before that.
    function add(id) {
      if (L.done || L.chosen.includes(id)) return;
      L.chosen.push(id);
      if (L.chosen.length === current().steps.length) return finish(core.isRight(current(), lex, chosenWords()));
      answer();
      tiles();
    }

    function undo() {
      if (L.done || !L.chosen.length) return;
      L.chosen.pop();
      answer();
      tiles();
    }

    function finish(ok) {
      L.done = true;
      const it = current();
      L.p.marks[L.p.order[L.p.pos]] = ok ? core.RIGHT : core.WRONG;
      L.p.pos++;
      const sc = scoreOf(L.lesson), nowPassed = core.passes(sc, data.passRating);
      if (nowPassed) L.p.passed = true;
      save();
      vibrate(ok ? "success" : "error");
      answer(ok ? "right" : "wrong");
      if (!ok) host.querySelector("#tnFix").innerHTML = `Правильно:<span lang="en">${esc(core.sentence(it))}</span>`;
      stats();
      const bank = host.querySelector("#tnBank");
      bank.innerHTML = '<button class="btn tn-next" id="tnNext" type="button">Далі</button>';
      const go = () => {
        stop();
        if (L.p.pos >= L.p.order.length) newRound();
        if (nowPassed && !L.wasPassed) { L.wasPassed = true; passed(sc); }
        question();
      };
      bank.querySelector("#tnNext").onclick = go;
      bank.querySelector("#tnNext").focus({ preventScroll: true });
      // A right answer moves on by itself; a wrong one waits so the right sentence can be read.
      stop();
      if (ok) timer = setTimeout(go, 1100);
    }

    function stats() {
      const sc = scoreOf(L.lesson), cur = L.done ? -1 : L.p.order[L.p.pos];
      host.querySelector("#tnRating").textContent = core.fmt(sc.rating);
      host.querySelector("#tnRight").textContent = sc.right;
      host.querySelector("#tnWrong").textContent = sc.wrong;
      host.querySelector("#tnProgress").innerHTML = L.lesson.items.map((_, i) => {
        const m = L.p.marks[i];
        return `<i class="${m === core.RIGHT ? "r" : m === core.WRONG ? "w" : ""}${i === cur ? " cur" : ""}"></i>`;
      }).join("");
    }

    /* ---------- sheets ---------- */
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

    function info() {
      stop();
      sheet(`<h2>Прості часи</h2>
        <p class="sub">Три часи на три види фрази. Слово в українському реченні — «учора», «завтра», «щодня» — підказує час.</p>
        <table class="tn-grid" lang="en"><tr><th></th><th>?</th><th>+</th><th>−</th></tr>
          <tr><th lang="uk">Майбутнє</th><td><b>Will</b> he work?</td><td>He <b>will</b> work</td><td>He <b>won't</b> work</td></tr>
          <tr><th lang="uk">Теперішнє</th><td><b>Do</b> you work?<br><b>Does</b> he work?</td><td>I work<br>He work<b>s</b></td><td>I <b>don't</b> work<br>He <b>doesn't</b> work</td></tr>
          <tr><th lang="uk">Минуле</th><td><b>Did</b> he work?</td><td>He work<b>ed</b></td><td>He <b>didn't</b> work</td></tr></table>
        <p class="sub">Після do, does, did і will дієслово завжди в початковій формі. Закінчення -s тільки в he, she, it у теперішньому часі.</p>
        <p class="sub">Склади фразу з плиток. Слово можна прибрати, торкнувшись його, або кнопкою відміни. Перевірка — лише після останнього слова.</p>
        <p class="sub">Рейтинг — частка правильних відповідей серед усіх речень уроку, помножена на 5: поки речення не пройдене, воно рахується як неправильне. Кожне речення зберігає останню відповідь: виправити помилку можна, лише дійшовши до нього в наступному колі, а нова помилка псує правильну відповідь.</p>
        <button class="btn" id="tnClose" type="button">Зрозуміло</button>
        <button class="btn ghost tn-reset" id="tnReset" type="button">Почати урок заново</button>`, (veil, close) => {
        veil.querySelector("#tnClose").onclick = close;
        const reset = veil.querySelector("#tnReset");
        let armed = false;
        reset.onclick = () => {
          if (!armed) { armed = true; reset.textContent = "Точно скинути прогрес уроку?"; return; }
          store.lessons[L.lesson.id] = { marks: {}, order: [], pos: 0, passed: false };
          save();
          close();
          open(L.index);
        };
      });
    }

    function passed(sc) {
      const next = data.lessons[L.index + 1];
      const nextText = !next ? "Це був останній урок." :
        next.ready ? `Урок ${next.id} відкрито.` : `Урок ${next.id} відкриється, коли буде готовий.`;
      sheet(`<h2>Урок ${L.lesson.id} пройдено</h2><div class="big tn-big">${core.fmt(sc.rating)}</div>
        <p class="sub">${nextText} Можна продовжувати до 5.0.</p>
        <button class="btn" id="tnStay" type="button">Продовжити урок</button>
        <button class="btn ghost" id="tnMenu" type="button">До уроків</button>`, (veil, close) => {
        veil.querySelector("#tnStay").onclick = close;
        veil.querySelector("#tnMenu").onclick = () => { close(); menu(); };
      });
    }

    // Keyboard on a computer: Backspace takes the last word back, Enter goes on after an answer.
    document.addEventListener("keydown", event => {
      if (!L || document.querySelector(".tn-veil") || event.target.closest?.("input, textarea")) return;
      if (L.done && event.key === "Enter") { event.preventDefault(); host.querySelector("#tnNext")?.click(); }
      else if (!L.done && event.key === "Backspace") { event.preventDefault(); undo(); }
    });

    menu();
  }

  window.TensesApp = { mount };
})();
