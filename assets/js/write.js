(async function () {
  "use strict";
  const host = document.getElementById("app");
  if (!await Profiles.require(host)) return;
  backTo(Profiles.url("index.html"));
  const el = id => document.getElementById(id);
  const ui = Object.fromEntries(["writeContent", "generateForm", "modeFields", "focus", "generate", "exercise",
    "exerciseFocus", "sourceText", "checkForm", "translation", "check", "writeStatus", "feedback"].map(id => [id, el(id)]));
  const labels = { article: "Article", tense: "Tense", preposition: "Preposition", word_order: "Word order",
    word_choice: "Word choice", agreement: "Agreement", spelling: "Spelling", meaning: "Meaning", other: "Other" };
  const errorMessages = {
    not_configured: "Write is not configured yet. Please check the server's model settings.",
    unauthorized: "Please close the app and open it again through Telegram.",
    invalid_input: "Please check your focus and translation.",
    bad_request: "The exercise request could not be read. Please try again.",
    too_large: "The text is too long. Please shorten it and try again.",
    not_found: "Write is not available on the server yet.",
    method_not_allowed: "The server could not accept this request. Please reopen Write and try again.",
    provider_auth: "The model provider rejected access. Please check the API key and its permissions.",
    model_not_found: "The configured model is unavailable. Please check the server's model setting.",
    provider_billing: "The model account does not have access to this request. Please check its access and billing settings.",
    provider_request: "The model could not accept this request. Please check the server's model and API settings.",
    rate_limit: "The model's request limit has been reached. Please try again later.",
    provider_unavailable: "The model is temporarily unavailable. Please try again later.",
    provider_error: "The model request failed. Please try again.",
    provider_connection: "The server could not connect to the model. Please try again.",
    timeout: "The model took too long to respond. Please try again.",
    blocked_response: "The model could not answer this request. Try rephrasing your focus.",
    incomplete_response: "The model's response was cut short. Please try again.",
    empty_response: "The model returned an empty response. Please try again.",
    invalid_json: "The model returned an unreadable response. Please try again.",
    invalid_response: "The model returned an invalid exercise or feedback. Please try again.",
    internal_error: "The server could not complete this request. Please try again.",
  };
  const statusMessages = {
    400: errorMessages.invalid_input, 403: errorMessages.unauthorized,
    404: errorMessages.not_found, 405: errorMessages.method_not_allowed, 413: errorMessages.too_large,
    429: errorMessages.rate_limit, 500: errorMessages.internal_error,
    502: "The model request failed. Please try again.",
    503: "Write is temporarily unavailable. Please try again later.",
    504: errorMessages.timeout,
  };
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
    if (!tg?.initData) throw new Error("Please open the app through Telegram to use Write.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55000);
    try {
      const response = await fetch(new URL(`/write/${action}`, WORKER_URL), {
        method: "POST", headers: { "Content-Type": "application/json" },
        cache: "no-store", signal: controller.signal,
        body: JSON.stringify({ initData: tg.initData, ...data }),
      });
      if (!response.ok) {
        let details;
        try { details = await response.json(); } catch (_) { /* Older Workers may return plain text. */ }
        const code = details && typeof details.error === "string" && Object.hasOwn(errorMessages, details.error)
          ? details.error : null;
        if (code) {
          const providerStatus = Number.isInteger(details.providerStatus) && details.providerStatus >= 100 && details.providerStatus <= 599
            ? `; HTTP ${details.providerStatus}` : "";
          throw new Error(`${errorMessages[code]} [${code}${providerStatus}]`);
        }
        throw new Error(`${statusMessages[response.status] || "The request failed. Please try again."} [HTTP ${response.status}]`);
      }
      try { return await response.json(); }
      catch (_) { throw new Error("The server returned an unreadable response. The Worker may need an update."); }
    } catch (error) {
      if (controller.signal.aborted) throw new Error("The response took too long. Please try again.");
      if (error instanceof TypeError) throw new Error("Could not connect. Please check your internet connection and try again.");
      throw error;
    } finally { clearTimeout(timer); }
  }

  ui.generateForm.onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    const focus = ui.focus.value.trim();
    if (!focus) { ui.focus.focus(); status("Enter what you would like to practise.", true); return; }
    const mode = ui.generateForm.querySelector('input[name="mode"]:checked').value;
    setBusy(true);
    status("Generating…");
    try {
      const result = await request("generate", { mode, focus });
      if (!result || !Array.isArray(result.sentences) || result.sentences.length < 3 || result.sentences.length > 5 ||
          !result.sentences.every(s => typeof s === "string" && s.trim())) throw new Error("Could not get an exercise. Please try again.");
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
    if (!translation) { ui.translation.focus(); status("Write your translation first.", true); return; }
    setBusy(true);
    clearFeedback();
    status("Checking…");
    try {
      const result = await request("check", { ...exercise, translation });
      if (!result || ![result.summary, result.targetFeedback, result.modelTranslation].every(s => typeof s === "string" && s.trim()) ||
          !Array.isArray(result.errors) || !result.errors.every(e => e && Object.hasOwn(labels, e.category) &&
            [e.original, e.correction, e.explanation].every(s => typeof s === "string"))) {
        throw new Error("Could not get feedback. Please try again.");
      }
      ui.feedback.innerHTML = `<h2 id="feedbackTitle">Feedback</h2>
        <p class="write-text">${esc(result.summary)}</p>
        ${result.errors.length ? `<div class="write-errors">${result.errors.map(e => `<article class="write-error">
          <b>${esc(labels[e.category])}</b>
          <p class="write-text write-original">${esc(e.original || "Missing text")}</p>
          <p class="write-text write-correction">→ ${esc(e.correction || "Remove this text")}</p>
          <p class="write-text">${esc(e.explanation)}</p></article>`).join("")}</div>` : '<p class="write-correction">No errors found.</p>'}
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
