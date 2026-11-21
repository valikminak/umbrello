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
    const progress = id => (store.lessons[id] ||= { marks: {}, order: [], pos: 0, passed: false, seenInfo: false });
    const scoreOf = lesson => core.score(lesson.items.length, progress(lesson.id).marks);
    // A lesson opens when the one before it is passed; a lesson already started stays open.
    const unlocked = i => data.lessons[i].ready &&
      (i === 0 || progress(data.lessons[i - 1].id).passed || scoreOf(data.lessons[i]).answered > 0);

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
        <p class="tn-hint" id="tnHint">Перекладіть речення</p>
        <p class="tn-uk" id="tnUk" lang="uk"></p>
        <div class="tn-answer-row">
          <div class="tn-answer" id="tnAnswer" aria-live="polite"></div>
          <button class="tn-undo" id="tnUndo" type="button" aria-label="Відмінити останнє слово" hidden>${icon("undo")}</button>
        </div>
        <button class="btn tn-check" id="tnCheck" type="button" hidden>Перевірити</button>
        <div class="tn-fix" id="tnFix" aria-live="polite"></div>
        <div class="tn-bank" id="tnBank"></div>
        <div class="tn-progress" id="tnProgress" aria-hidden="true"></div>
      </div>`;
      host.querySelector("#tnBack").onclick = menu;
      host.querySelector("#tnInfo").onclick = info;
      host.querySelector("#tnUndo").onclick = undo;
      host.querySelector("#tnCheck").onclick = check;
      question();
      // The first time a lesson opens, its explanation comes up by itself.
      if (lesson.info && !p.seenInfo) { p.seenInfo = true; save(); info(); }
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
      const groups = core.bankGroups(current(), lex, Math.random, L.lesson.nearMisses);
      L.tiles = groups.flat();
      L.groups = groups.map(group => group.length);
      L.roles = current().steps.map((_, i) => core.role(current(), i, lex));
      host.querySelector("#tnUk").textContent = current().uk;
      host.querySelector("#tnHint").textContent = L.lesson.hints === "count"
        ? `Перекладіть речення · ${core.tilesWord(current().steps.length)}` : "Перекладіть речення";
      host.querySelector("#tnFix").innerHTML = "";
      answer();
      tiles();
      stats();
    }

    // Words placed so far. In lessons with slots the answer line shows a place for every tile,
    // and in the word-order lesson each place is named (хто, дія, коли).
    function answer(state) {
      const box = host.querySelector("#tnAnswer"), it = current(), words = chosenWords();
      const slots = !state && (L.lesson.hints === "labels" || L.lesson.hints === "slots"), labels = slots && L.lesson.hints === "labels";
      box.className = "tn-answer" + (state ? " " + state : "") + (slots ? " slotted" : "");
      const word = (w, i) => {
        let text = i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
        if (state && i === words.length - 1) text += it.q ? "?" : ".";
        return state ? `<span lang="en">${esc(text)}</span>`
          : `<button class="tn-word" type="button" lang="en" data-k="${i}" aria-label="Прибрати ${esc(w)}">${esc(text)}</button>`;
      };
      let html;
      if (slots) {
        html = it.steps.map((_, i) => `<span class="tn-slot${i < words.length ? " filled" : ""}${i === words.length ? " next" : ""}">` +
          (i < words.length ? word(words[i], i) : '<span class="tn-blank"></span>') +
          (labels ? `<small>${esc(L.roles[i])}</small>` : "") + "</span>");
      } else {
        html = words.map(word);
        if (!state) html.push('<span class="tn-caret"></span>');
      }
      box.innerHTML = html.join("");
      box.querySelectorAll("[data-k]").forEach(button => {
        button.onclick = () => { L.chosen.splice(+button.dataset.k, 1); answer(); tiles(); };
      });
      host.querySelector("#tnUndo").hidden = Boolean(state) || !L.chosen.length;
      host.querySelector("#tnCheck").hidden = Boolean(state) || L.lesson.check !== "button" || !L.chosen.length;
    }

    function tiles() {
      const box = host.querySelector("#tnBank");
      const tile = id => {
        const used = L.chosen.includes(id);
        return `<button class="tn-tile${used ? " used" : ""}" type="button" lang="en" data-id="${id}"${used ? ' tabindex="-1" aria-hidden="true"' : ""}>${esc(L.tiles[id])}</button>`;
      };
      // Each word sits with its near misses (didn't, don't, won't), so the choice is made inside a group.
      let next = 0;
      box.innerHTML = L.groups.map(size => {
        const ids = [...Array(size).keys()].map(k => next + k);
        next += size;
        return `<span class="tn-group">${ids.map(tile).join("")}</span>`;
      }).join("");
      box.querySelectorAll("[data-id]").forEach(button => { button.onclick = () => add(+button.dataset.id); });
    }

    // Nothing is judged until the last word is in place; a word can be taken back before that.
    // In lessons that mix tenses the learner presses Перевірити instead, so the number of
    // tiles in the answer does not tell the tense.
    function add(id) {
      if (L.done || L.chosen.includes(id)) return;
      L.chosen.push(id);
      if (L.lesson.check === "auto" && L.chosen.length === current().steps.length) return check();
      answer();
      tiles();
    }

    function check() {
      if (L.done || !L.chosen.length) return;
      finish(core.isRight(current(), lex, chosenWords()));
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

    const INFO = {
      "word-order": `<h2>Порядок слів</h2>
        <p class="sub">В англійському реченні кожне слово має своє місце. Українською можна сказати «Каву ми п'ємо вранці», англійською — тільки так:</p>
        <table class="tn-grid tn-order" lang="en">
          <tr lang="uk"><th>хто</th><th>дія</th><th>кого / що</th><th>де</th><th>коли</th></tr>
          <tr><td>We</td><td>drink</td><td>coffee</td><td>in a cafe</td><td>every morning</td></tr>
          <tr><td>I</td><td>saw</td><td>Anna</td><td>in the shop</td><td>yesterday</td></tr>
        </table>
        <p class="sub">Де — перед коли. «Як» (well, fast) стоїть одразу після того, що робимо: She sings well.</p>
        <table class="tn-grid tn-order" lang="en">
          <tr lang="uk"><th></th><th>допоміжне</th><th>хто</th><th>дія</th><th>…</th></tr>
          <tr><th lang="uk">Питання</th><td><b>Did</b></td><td>you</td><td>see</td><td>Tom yesterday?</td></tr>
        </table>
        <table class="tn-grid tn-order" lang="en">
          <tr lang="uk"><th></th><th>хто</th><th>допоміжне</th><th>дія</th><th>…</th></tr>
          <tr><th lang="uk">Заперечення</th><td>We</td><td><b>didn't</b></td><td>see</td><td>them in the park.</td></tr>
        </table>
        <p class="sub">У питанні допоміжне слово (do, does, did, will) виходить уперед. У запереченні до нього додається not: don't, doesn't, didn't, won't. Час можна поставити і на початок: Yesterday I saw Anna.</p>
        <p class="sub">У цьому уроці на плитках тільки слова відповіді, а під кожним місцем написано, що там стоїть. Завдання — лише порядок.</p>`,
      "simple-tenses": `<h2>Прості часи</h2>
        <p class="sub">Три часи на три види фрази. Слово в українському реченні — «учора», «завтра», «щодня» — підказує час.</p>
        <table class="tn-grid" lang="en"><tr><th></th><th>?</th><th>+</th><th>−</th></tr>
          <tr><th lang="uk">Майбутнє</th><td><b>Will</b> he work?</td><td>He <b>will</b> work</td><td>He <b>won't</b> work</td></tr>
          <tr><th lang="uk">Теперішнє</th><td><b>Do</b> you work?<br><b>Does</b> he work?</td><td>I work<br>He work<b>s</b></td><td>I <b>don't</b> work<br>He <b>doesn't</b> work</td></tr>
          <tr><th lang="uk">Минуле</th><td><b>Did</b> he work?</td><td>He work<b>ed</b></td><td>He <b>didn't</b> work</td></tr></table>
        <p class="sub">Після do, does, did і will дієслово завжди в початковій формі. Закінчення -s тільки в he, she, it у теперішньому часі.</p>
        <p class="sub">Тепер на плитках є й схожі неправильні слова: didn't поруч із don't і won't, call поруч із called і calls.</p>`,
    };
    INFO.continuous = `<h2>У процесі</h2>
        <p class="sub">Continuous — дія триває в якийсь момент: зараз, учора о восьмій, завтра в цей час. Будова: be + дієслово з -ing.</p>
        <table class="tn-grid" lang="en"><tr><th></th><th>+</th><th>−</th><th>?</th></tr>
          <tr><th lang="uk">Зараз</th><td>I <b>am</b> work<b>ing</b><br>She <b>is</b> work<b>ing</b></td><td>I <b>am not</b> working<br>They <b>aren't</b> working</td><td><b>Are</b> you working?</td></tr>
          <tr><th lang="uk">У момент у минулому</th><td>I <b>was</b> work<b>ing</b><br>We <b>were</b> work<b>ing</b></td><td>She <b>wasn't</b> working</td><td><b>Was</b> he working?</td></tr>
          <tr><th lang="uk">У момент у майбутньому</th><td>I <b>will be</b> work<b>ing</b></td><td>He <b>won't be</b> working</td><td><b>Will</b> you <b>be</b> working?</td></tr></table>
        <p class="sub">am — тільки з I; is — he, she, it; are — you, we, they. У минулому: was — I, he, she, it; were — you, we, they.</p>
        <p class="sub">Підказка в українському реченні: «зараз», «саме», «у той момент», «завтра в цей час».</p>`;
    INFO["mix-simple-continuous"] = `<h2>Simple чи continuous</h2>
        <p class="sub">Simple — так буває взагалі або подія ціла: щодня, по суботах, учора, завтра. Continuous — дія триває саме в цей момент: зараз, саме, у той момент, завтра в цей час.</p>
        <table class="tn-grid" lang="en"><tr><th lang="uk">Simple</th><th lang="uk">Continuous</th></tr>
          <tr><td>He walks to work every day.</td><td>He is walking to work now.</td></tr>
          <tr><td>I finished work at six yesterday.</td><td>I was working at six yesterday.</td></tr>
          <tr><td>I will call you tomorrow.</td><td>I will be flying at this time tomorrow.</td></tr></table>
        <p class="sub">У цьому уроці фраза не перевіряється сама і кількість слів не підказується: склади відповідь і натисни «Перевірити».</p>`;
    INFO["present-perfect"] = `<h2>Уже до «зараз»</h2>
        <p class="sub">Present perfect — have / has + третя форма дієслова. Важливо, що вже є зараз: результат, досвід, «ще не». Коли саме — не важливо.</p>
        <table class="tn-grid" lang="en"><tr><th></th><th>Present perfect</th><th>Past simple</th></tr>
          <tr><th>+</th><td>I <b>have</b> seen it.<br>She <b>has</b> seen it.</td><td>I <b>saw</b> it yesterday.</td></tr>
          <tr><th>−</th><td>I <b>haven't</b> seen it yet.</td><td>I <b>didn't</b> see it yesterday.</td></tr>
          <tr><th>?</th><td><b>Have</b> you ever seen it?</td><td><b>Did</b> you see it last week?</td></tr></table>
        <p class="sub">Past simple — коли названо закінчений час: учора, минулого тижня, два роки тому, у 2020 році. Present perfect — без такого часу: вже (already), щойно (just), ніколи (never), коли-небудь (ever), ще не (… yet).</p>
        <p class="sub">Третя форма у правильних дієсловах така сама, як минула: worked, finished. У неправильних — своя: see — saw — seen, go — went — gone, eat — ate — eaten.</p>
        <p class="sub">Тут фраза перевіряється кнопкою «Перевірити», а кількість слів не підказується: have і has є серед плиток у кожному реченні.</p>`;
    INFO["perfect-continuous"] = `<h2>Триває вже якийсь час</h2>
        <p class="sub">Present perfect continuous — have / has been + -ing: дія почалася раніше і триває досі. Українською це теперішній час із «уже дві години», «з ранку», «скільки часу».</p>
        <table class="tn-grid" lang="en"><tr><th lang="uk">Українською</th><th>Англійською</th></tr>
          <tr><td lang="uk">Я чекаю вже годину.</td><td>I <b>have been</b> wait<b>ing</b> for an hour.</td></tr>
          <tr><td lang="uk">Скільки часу ти чекаєш?</td><td><b>How long have</b> you <b>been</b> waiting?</td></tr>
          <tr><td lang="uk">Я вже написав три листи.</td><td>I <b>have</b> already <b>written</b> three letters.</td></tr></table>
        <p class="sub">Present perfect — коли важливий результат або скільки зроблено: three letters, a hundred words.</p>
        <p class="sub">for — скільки часу: for two hours, for ten years. since — з якого моменту: since Monday, since this morning. Не «since two hours» і не «from Monday».</p>
        <p class="sub">know і be не бувають у continuous: «Я знаю його десять років» — I have known him for ten years. Із «не» теж present perfect: I haven't seen him since Monday.</p>`;
    INFO["mix-present-past"] = `<h2>Усе теперішнє й минуле</h2>
        <p class="sub">Шість форм. Час підказує тільки українське речення: серед плиток завжди є і be, і have.</p>
        <table class="tn-grid" lang="en"><tr><th lang="uk">Підказка</th><th>Форма</th></tr>
          <tr><td lang="uk">щодня, по неділях</td><td>He <b>plays</b> tennis on Sundays.</td></tr>
          <tr><td lang="uk">зараз, саме</td><td>He <b>is playing</b> tennis now.</td></tr>
          <tr><td lang="uk">вже, щойно, ніколи</td><td>He <b>has</b> never <b>played</b> tennis.</td></tr>
          <tr><td lang="uk">уже дві години, з ранку</td><td>He <b>has been playing</b> for two hours.</td></tr>
          <tr><td lang="uk">учора, годину тому</td><td>He <b>played</b> tennis yesterday.</td></tr>
          <tr><td lang="uk">у той момент, коли ти прийшов</td><td>He <b>was playing</b> when you came.</td></tr></table>`;
    INFO["past-perfect"] = `<h2>Уже до моменту в минулому</h2>
        <p class="sub">Past perfect — had + третя форма: одна дія в минулому сталася раніше за іншу. Past perfect continuous — had been + -ing: дія тривала до того моменту.</p>
        <table class="tn-grid" lang="en"><tr><th lang="uk">Українською</th><th>Англійською</th></tr>
          <tr><td lang="uk">Коли ми прийшли, фільм <b>уже</b> почався.</td><td>The film <b>had</b> already <b>started</b> when we arrived.</td></tr>
          <tr><td lang="uk">Фільм почався, коли ми прийшли.</td><td>The film <b>started</b> when we arrived.</td></tr>
          <tr><td lang="uk">Коли я прийшов, вона чекала вже годину.</td><td>She <b>had been waiting</b> for an hour when I came.</td></tr></table>
        <p class="sub">«Уже», «до того дня», «ніколи раніше» в українському реченні підказують past perfect. Без них дії йдуть одна за одною — past simple в обох частинах.</p>
        <p class="sub">Речення з двох частин. Частину з when, because чи by the time можна поставити і першою: When we arrived, the film had already started.</p>`;
    INFO.future = `<h2>Майбутнє</h2>
        <table class="tn-grid" lang="en"><tr><th lang="uk">Українською</th><th>Англійською</th></tr>
          <tr><td lang="uk">Я тобі допоможу.</td><td>I <b>will</b> help you.</td></tr>
          <tr><td lang="uk">Я збираюся продати машину.</td><td>I <b>am going to</b> sell my car.</td></tr>
          <tr><td lang="uk">Завтра в цей час я летітиму.</td><td>I <b>will be</b> fly<b>ing</b> at this time tomorrow.</td></tr>
          <tr><td lang="uk">До п'ятниці я вже закінчу звіт.</td><td>I <b>will have finished</b> the report by Friday.</td></tr></table>
        <p class="sub">will — рішення, обіцянка, прогноз. «Збираюся», «ось-ось» — be going to. «Завтра в цей час» — will be + -ing. «До п'ятниці… вже» — will have + третя форма.</p>
        <p class="sub">«До п'ятниці» тут — by Friday, а не until: until — «аж до», поки щось триває.</p>`;
    INFO["when-if"] = `<h2>When і if</h2>
        <p class="sub">Українською після «якщо», «коли», «щойно», «поки не» кажемо майбутній час: «Якщо піде дощ». Англійською там теперішній: If it <b>rains</b>. Will лишається тільки в другій частині.</p>
        <table class="tn-grid" lang="en"><tr><th lang="uk">Українською</th><th>Англійською</th></tr>
          <tr><td lang="uk">Якщо завтра піде дощ, ми залишимося вдома.</td><td>If it <b>rains</b> tomorrow, we <b>will</b> stay at home.</td></tr>
          <tr><td lang="uk">Коли я прийду додому, я подзвоню.</td><td>When I <b>get</b> home, I <b>will</b> call you.</td></tr>
          <tr><td lang="uk">Я чекатиму, поки ти не подзвониш.</td><td>I <b>will</b> wait until you <b>call</b>.</td></tr></table>
        <p class="sub">Так само після as soon as (щойно), before (перш ніж), after (після того як), until (поки не). Частини можна поміняти місцями: We will stay at home if it rains.</p>`;
    INFO["mix-all"] = `<h2>Усі дванадцять форм</h2>
        <table class="tn-grid" lang="en"><tr><th></th><th>Simple</th><th>Continuous</th><th>Perfect</th><th>Perfect continuous</th></tr>
          <tr><th>Present</th><td>I work</td><td>I am working</td><td>I have worked</td><td>I have been working</td></tr>
          <tr><th>Past</th><td>I worked</td><td>I was working</td><td>I had worked</td><td>I had been working</td></tr>
          <tr><th>Future</th><td>I will work</td><td>I will be working</td><td>I will have worked</td><td>I will have been working</td></tr></table>
        <p class="sub">Стовпчик підказує українське речення: щодня, по суботах — simple; зараз, саме, у той момент, завтра в цей час — continuous; вже, щойно, ніколи, до п'ятниці — perfect; уже дві години, з ранку — perfect continuous.</p>
        <p class="sub">Рядок — сам час: теперішній, минулий (учора, коли ти прийшов) чи майбутній (завтра, до грудня).</p>`;
    INFO.passive = `<h2>Пасив</h2>
        <p class="sub">Пасив — be + третя форма: важливо, що зробили, а не хто. Українською часто без того, хто робить: «Будинок побудували», «Тут говорять англійською», «Листа відправлено».</p>
        <table class="tn-grid" lang="en"><tr><th lang="uk">Українською</th><th>Англійською</th></tr>
          <tr><td lang="uk">Тут говорять англійською.</td><td>English <b>is spoken</b> here.</td></tr>
          <tr><td lang="uk">Будинок побудували у 1990 році.</td><td>The house <b>was built</b> in 1990.</td></tr>
          <tr><td lang="uk">Машину зараз ремонтують.</td><td>The car <b>is being repaired</b> now.</td></tr>
          <tr><td lang="uk">Листа вже відправили.</td><td>The letter <b>has been sent</b>.</td></tr>
          <tr><td lang="uk">Звіт закінчать завтра.</td><td>The report <b>will be finished</b> tomorrow.</td></tr></table>
        <p class="sub">Час показує be: is, was, is being, has been, will be. Дієслово завжди в третій формі: written, не wrote.</p>
        <p class="sub">Якщо в українському реченні є той, хто робить («Мій дід побудував будинок»), — звичайний актив: My grandfather built the house.</p>`;
    INFO.conditionals = `<h2>Умовні з «би»</h2>
        <p class="sub">Українською «якби… б» однакове для теперішнього й минулого. Англійською — різне, і час підказують слова «тепер», «щодня» чи «вчора», «тоді».</p>
        <table class="tn-grid" lang="en"><tr><th lang="uk">Коли</th><th>Англійською</th></tr>
          <tr><td lang="uk">Тепер, щодня<br>Якби я знав, я б сказав.</td><td>If I <b>knew</b>, I <b>would tell</b> you.</td></tr>
          <tr><td lang="uk">Тоді, учора<br>Якби я тоді знав, я б сказав.</td><td>If I <b>had known</b>, I <b>would have told</b> you.</td></tr>
          <tr><td lang="uk">Тоді → тепер<br>Якби я тоді вчився, я б тепер був лікарем.</td><td>If I <b>had studied</b>, I <b>would be</b> a doctor now.</td></tr></table>
        <p class="sub">would — тільки в частині без if. Після if: минулий час (knew) або had + третя форма (had known), ніколи не would і не will.</p>
        <p class="sub">Частини можна поміняти місцями: I would tell you if I knew.</p>`;
    INFO.final = `<h2>Фінальна суміш</h2>
        <p class="sub">Усе разом: дванадцять форм, going to, пасив, when / if і «якби… б». Перш ніж складати, знайди в українському реченні підказку:</p>
        <table class="tn-grid" lang="en"><tr><th lang="uk">Підказка</th><th>Що будувати</th></tr>
          <tr><td lang="uk">щодня / зараз, саме / вже, щойно / уже годину, з ранку</td><td>simple / continuous / perfect / perfect continuous</td></tr>
          <tr><td lang="uk">учора, два дні тому</td><td>past simple</td></tr>
          <tr><td lang="uk">збираюся, ось-ось</td><td>be going to</td></tr>
          <tr><td lang="uk">до п'ятниці… вже</td><td>will have + третя форма</td></tr>
          <tr><td lang="uk">немає того, хто робить: «квартиру продали»</td><td>пасив: was sold</td></tr>
          <tr><td lang="uk">якщо, коли, щойно + майбутнє</td><td>теперішній: if it rains</td></tr>
          <tr><td lang="uk">якби… б (тепер / тоді)</td><td>would / would have</td></tr></table>`;
    const HOW = `<p class="sub">Склади фразу з плиток. Слово можна прибрати, торкнувшись його, або кнопкою відміни. Перевірка — лише після останнього слова.</p>
      <p class="sub">Рейтинг — частка правильних відповідей серед усіх речень уроку, помножена на 5: поки речення не пройдене, воно рахується як неправильне. Кожне речення зберігає останню відповідь: виправити помилку можна, лише дійшовши до нього в наступному колі, а нова помилка псує правильну відповідь.</p>`;

    function info() {
      stop();
      sheet(`${INFO[L.lesson.info] || `<h2>${esc(L.lesson.title)}</h2>`}${HOW}
        <button class="btn" id="tnClose" type="button">Зрозуміло</button>
        <button class="btn ghost tn-reset" id="tnReset" type="button">Почати урок заново</button>`, (veil, close) => {
        veil.querySelector("#tnClose").onclick = close;
        const reset = veil.querySelector("#tnReset");
        let armed = false;
        reset.onclick = () => {
          if (!armed) { armed = true; reset.textContent = "Точно скинути прогрес уроку?"; return; }
          store.lessons[L.lesson.id] = { marks: {}, order: [], pos: 0, passed: false, seenInfo: true };
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
      else if (!L.done && event.key === "Enter" && L.lesson.check === "button") { event.preventDefault(); check(); }
      else if (!L.done && event.key === "Backspace") { event.preventDefault(); undo(); }
    });

    menu();
  }

  window.TensesApp = { mount };
})();
