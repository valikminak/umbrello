(async function () {
  "use strict";
  const host = document.getElementById("app");
  if (!await Profiles.require(host)) return;
  backTo(Profiles.url("index.html"));
  const el = id => document.getElementById(id);
  const ui = Object.fromEntries(["writeContent", "generateForm", "modeFields", "focus", "generate", "exercise",
    "exerciseFocus", "sourceText", "checkForm", "translation", "check", "writeStatus", "feedback"].map(id => [id, el(id)]));
  const labels = { article: "Артикль", tense: "Время", preposition: "Предлог", word_order: "Порядок слов",
    word_choice: "Выбор слова", agreement: "Согласование", spelling: "Написание", meaning: "Смысл", other: "Другое" };
  let exercise = null, busy = false;
  ui.generateForm.reset();
  ui.checkForm.reset();
  ui.focus.value = "";
  ui.translation.value = "";
  ui.writeContent.hidden = false;

  function status(message = "", error = false) {
    ui.writeStatus.textContent = message;
    ui.writeStatus.className = "status write-status" + (error ? " bad" : "");
  }
  function setBusy(value) {
    busy = value;
    for (const key of ["modeFields", "focus", "generate", "translation", "check"]) ui[key].disabled = value;
    ui.writeContent.setAttribute("aria-busy", String(value));
  }
  function clearFeedback() {
    ui.feedback.hidden = true;
    ui.feedback.replaceChildren();
  }
  async function request(action, data) {
    if (!tg?.initData) throw new Error("Для Write открой приложение через Telegram.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55000);
    try {
      const response = await fetch(new URL(`/write/${action}`, WORKER_URL), {
        method: "POST", headers: { "Content-Type": "application/json" },
        cache: "no-store", signal: controller.signal,
        body: JSON.stringify({ initData: tg.initData, ...data }),
      });
      const messages = {
        400: "Проверь тему и перевод.", 403: "Открой приложение заново через Telegram.",
        404: "Write ещё не подключён на сервере.", 413: "Текст слишком длинный.",
        429: "Лимит модели исчерпан. Попробуй позже.",
        502: "Модель не вернула корректный ответ. Попробуй ещё раз.",
        503: "Write пока недоступен. Проверь подключение модели или попробуй позже.",
        504: "Модель не успела ответить. Попробуй ещё раз.",
      };
      if (!response.ok) throw new Error(messages[response.status] || "Не удалось выполнить запрос. Попробуй ещё раз.");
      try { return await response.json(); }
      catch (_) { throw new Error("Сервер вернул непонятный ответ. Возможно, Worker ещё не обновлён."); }
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Ответ не получен вовремя. Попробуй ещё раз.");
      if (error instanceof TypeError) throw new Error("Не удалось подключиться. Проверь интернет и попробуй ещё раз.");
      throw error;
    } finally { clearTimeout(timer); }
  }

  ui.generateForm.onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    const focus = ui.focus.value.trim();
    if (!focus) { ui.focus.focus(); status("Напиши, что хочешь потренировать.", true); return; }
    const mode = ui.generateForm.querySelector('input[name="mode"]:checked').value;
    setBusy(true);
    status("Generating…");
    try {
      const result = await request("generate", { mode, focus });
      if (!result || !Array.isArray(result.sentences) || result.sentences.length < 3 || result.sentences.length > 5 ||
          !result.sentences.every(s => typeof s === "string" && s.trim())) throw new Error("Не удалось получить текст. Попробуй ещё раз.");
      // Replace the old exercise only after a successful response.
      exercise = { mode, focus, sourceText: result.sentences.join(" ") };
      ui.sourceText.textContent = exercise.sourceText;
      ui.exerciseFocus.textContent = `${mode === "words" ? "Words" : "Grammar"}: ${focus}`;
      ui.translation.value = "";
      clearFeedback();
      ui.exercise.hidden = false;
      status();
    } catch (error) { status(error.message, true); }
    finally { setBusy(false); }
  };

  ui.checkForm.onsubmit = async event => {
    event.preventDefault();
    if (busy || !exercise) return;
    const translation = ui.translation.value.trim();
    if (!translation) { ui.translation.focus(); status("Сначала напиши свой перевод.", true); return; }
    setBusy(true);
    clearFeedback();
    status("Checking…");
    try {
      const result = await request("check", { ...exercise, translation });
      if (!result || ![result.summary, result.targetFeedback, result.modelTranslation].every(s => typeof s === "string" && s.trim()) ||
          !Array.isArray(result.errors) || !result.errors.every(e => e && Object.hasOwn(labels, e.category) &&
            [e.original, e.correction, e.explanation].every(s => typeof s === "string"))) {
        throw new Error("Не удалось получить разбор. Попробуй ещё раз.");
      }
      ui.feedback.innerHTML = `<h2 id="feedbackTitle">Feedback</h2>
        <p class="write-text">${esc(result.summary)}</p>
        ${result.errors.length ? `<div class="write-errors">${result.errors.map(e => `<article class="write-error">
          <b>${esc(labels[e.category])}</b>
          <p class="write-text write-original">${esc(e.original || "Пропущенный фрагмент")}</p>
          <p class="write-text write-correction">→ ${esc(e.correction || "Убрать этот фрагмент")}</p>
          <p class="write-text">${esc(e.explanation)}</p></article>`).join("")}</div>` : '<p class="write-correction">Ошибок не найдено.</p>'}
        <h3>Your focus</h3><p class="write-text">${esc(result.targetFeedback)}</p>
        <details class="write-sample"><summary>Show one possible translation</summary>
          <p class="write-text" lang="en">${esc(result.modelTranslation)}</p></details>
        <p class="sub write-note">You can edit your translation and check it again. AI feedback can be mistaken; you decide what to practise next.</p>`;
      ui.feedback.hidden = false;
      status();
    } catch (error) { status(error.message, true); }
    finally { setBusy(false); }
  };
  ui.translation.oninput = () => { clearFeedback(); status(); };
})();
