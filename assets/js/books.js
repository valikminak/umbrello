(async function () {
  "use strict";
  const host = document.getElementById("app");
  if (!await Profiles.shared(host)) return;

  const core = BooksCore;
  const menuUrl = Profiles.url("index.html");
  const controllers = new Set();
  let view = "library", library = null, reader = null, ticket = 0, disposed = false, session = null;

  window.addEventListener("pagehide", () => { disposed = true; reader?.destroy(); controllers.forEach(controller => controller.abort()); });
  // Telegram Back: definition popup → reader → library → menu.
  if (tg?.BackButton) {
    tg.BackButton.show();
    tg.BackButton.onClick(() => {
      if (popup.open) closePopup();
      else if (view === "library") location.href = menuUrl;
      else showLibrary();
    });
  }

  class BooksError extends Error {
    constructor(message, code = "") { super(message); this.code = code; }
  }

  async function request(action, payload) {
    if (!tg?.initData) throw new BooksError("Open Umbrello from Telegram to read books.", "no_telegram");
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), action === "book" ? 60000 : 30000);
    try {
      const response = await fetch(new URL(`/books/${action}`, WORKER_URL), {
        method: "POST", headers: { "Content-Type": "application/json" },
        cache: "no-store", signal: controller.signal,
        body: JSON.stringify({ initData: tg.initData, ...payload }),
      });
      let data = null;
      try { data = await response.json(); } catch (_) {}
      if (!response.ok) {
        const code = typeof data?.error === "string" ? data.error : "";
        if (Profiles.refuse(code)) throw new BooksError("Umbrello is closed for this account.", code);
        const reason = typeof data?.message === "string" && data.message.trim() ? data.message.trim() : "";
        const upstream = Number.isInteger(data?.providerStatus) ? `; HTTP ${data.providerStatus}` : "";
        if (code) throw new BooksError(`${reason || "The request failed. Please try again."} [${code}${upstream}]`, code);
        throw new BooksError(`The Worker did not return a readable answer. Check its deployment and logs in Cloudflare. [HTTP ${response.status}]`);
      }
      if (data === null) throw new BooksError("The server returned an unreadable answer. Please try again.");
      return data;
    } catch (error) {
      if (controller.signal.aborted) throw new BooksError("The request took too long. Please try again.", "timeout");
      if (error instanceof TypeError) throw new BooksError("Could not connect. Check your internet connection and try again.", "network");
      throw error;
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function setReading(reading) { document.body.classList.toggle("reading", reading); }

  /* ---------- local data: per verified Telegram account and book ---------- */

  // localStorage is shared by the whole site origin, so the Worker-verified account ID
  // is part of every key. Position and definitions are separate entries: a page turn
  // never rewrites the definitions.
  const storeKey = (bookId, kind) => `umbrello.books.v1.${Profiles.userId}.${bookId}.${kind}`;
  function readStore(bookId, kind) {
    if (!Profiles.userId) return null;
    try { return JSON.parse(localStorage.getItem(storeKey(bookId, kind)) ?? "null"); } catch (_) { return null; }
  }
  function writeStore(bookId, kind, value) {
    if (!Profiles.userId) return false;
    try { localStorage.setItem(storeKey(bookId, kind), JSON.stringify(value)); return true; } catch (_) { return false; }
  }
  const PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  function savedPosition(bookId) {
    const saved = readStore(bookId, "position");
    return saved && PART.test(saved.chapterId) && PART.test(saved.sentenceId) && Number.isInteger(saved.offset) && saved.offset >= 0 ? saved : null;
  }
  function savedDefinitions(bookId) {
    const saved = readStore(bookId, "definitions");
    const definitions = new Map();
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      for (const [key, entry] of Object.entries(saved)) {
        if (typeof entry?.term === "string" && typeof entry?.definition === "string") definitions.set(key, { term: entry.term, definition: entry.definition });
      }
    }
    return definitions;
  }

  // Everything that belongs to the open book. A late answer for a book that was closed
  // is still stored for that book, but never touches the screen of another one.
  function startSession(book) {
    const definitions = savedDefinitions(book.bookId);
    return { book, definitions, definedKeys: new Set(definitions.keys()), pending: new Map(), warned: false };
  }
  function warnStorage(current) {
    if (current.warned || current !== session) return;
    current.warned = true;
    reader?.note("Could not save on this device.");
  }
  function savePosition(current, anchor) {
    if (current !== session) return;
    const { chapterId, sentenceId, wordId, offset } = anchor;
    if (!writeStore(current.book.bookId, "position", { chapterId, sentenceId, wordId, offset, savedAt: Date.now() })) warnStorage(current);
  }
  function persistDefinitions(current) {
    if (!writeStore(current.book.bookId, "definitions", Object.fromEntries(current.definitions))) warnStorage(current);
  }

  /* ---------- library ---------- */

  function showLibrary() {
    ticket++;
    view = "library";
    closePopup();
    reader?.destroy(); reader = null;
    session = null;
    setReading(false);
    if (library) renderLibrary(); else loadLibrary();
    window.scrollTo(0, 0);
  }

  async function loadLibrary() {
    const current = ++ticket;
    host.innerHTML = `<header class="books-hero"><h1>Books</h1><p class="sub" role="status">Loading your library…</p></header>`;
    try {
      const books = core.validateCatalog(await request("list", {}));
      if (disposed || current !== ticket) return;
      library = books;
      renderLibrary();
    } catch (error) {
      if (!disposed && current === ticket) renderError(error, loadLibrary);
    }
  }

  function renderLibrary() {
    host.innerHTML = `<header class="books-hero"><h1>Books</h1>
      <p class="sub">Choose a book to start reading.</p></header>
      <ul class="book-list" id="bookList"></ul>`;
    const list = host.querySelector("#bookList");
    if (!library.length) {
      list.replaceWith(el("p", "sub books-empty", "No books in your library yet."));
      return;
    }
    library.forEach(entry => {
      const button = el("button", "book-item");
      button.type = "button";
      button.dataset.bookId = entry.bookId;
      button.append(el("strong", "book-title", entry.title), el("span", "book-author", entry.author || "Unknown author"),
        el("span", "book-open", "Read →"));
      button.onclick = () => openBook(entry);
      const item = el("li");
      item.append(button);
      list.append(item);
    });
  }

  /* ---------- errors ---------- */

  function renderError(error, retry, inReader = false) {
    // Access refusals never get here: request() has already put the umbrella up.
    const titles = { no_telegram: "Open in Telegram" };
    host.innerHTML = `<div class="books-error" role="alert">
      ${inReader ? `<div class="reader-bar"><button class="reader-action" type="button" id="errorLibrary">← Library</button></div>` : ""}
      <h2 id="errorTitle"></h2><p class="sub" id="errorMessage"></p>
      ${error.code === "no_telegram" ? "" : `<button class="btn" type="button" id="errorRetry">Try again</button>`}</div>`;
    host.querySelector("#errorTitle").textContent = titles[error.code] || "Could not load";
    host.querySelector("#errorMessage").textContent = error.message;
    host.querySelector("#errorRetry")?.addEventListener("click", retry);
    host.querySelector("#errorLibrary")?.addEventListener("click", showLibrary);
  }

  /* ---------- reader ---------- */

  async function openBook(entry) {
    const current = ++ticket;
    view = "loading";
    closePopup();
    reader?.destroy(); reader = null;
    session = null;
    setReading(true);
    host.innerHTML = `<div class="reader-bar"><button class="reader-action" type="button" id="loadingLibrary">← Library</button></div>
      <p class="sub" role="status" id="loadingStatus"></p>`;
    host.querySelector("#loadingStatus").textContent = `Opening “${entry.title}”…`;
    host.querySelector("#loadingLibrary").onclick = showLibrary;
    window.scrollTo(0, 0);
    try {
      const loaded = core.validateBook(await request("book", { bookId: entry.bookId }), entry.bookId);
      if (disposed || current !== ticket) return;
      view = "reader";
      const active = session = startSession(loaded);
      reader = new BookReader({ host, book: loaded, telegram: tg, onBack: showLibrary,
        position: savedPosition(loaded.bookId), definedKeys: active.definedKeys,
        onPosition: anchor => savePosition(active, anchor),
        onWord: word => openDefinition(active, word) });
    } catch (error) {
      if (!disposed && current === ticket) {
        reader?.destroy(); reader = null;
        renderError(error, () => openBook(entry), true);
      }
    }
  }

  /* ---------- definitions ---------- */

  const popup = { open: false, key: null, ui: null };

  function popupUI() {
    if (popup.ui) return popup.ui;
    const backdrop = el("div", "define-backdrop");
    const sheet = el("section", "define-sheet");
    backdrop.hidden = sheet.hidden = true;
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", "defineTerm");
    sheet.innerHTML = `<header class="define-head"><strong class="define-term" id="defineTerm"></strong>
      <button class="define-close" type="button" id="defineClose" aria-label="Close">✕</button></header>
      <p class="define-status" id="defineStatus" role="status" aria-live="polite"></p>
      <p class="define-text" id="defineText"></p>
      <div class="define-actions">
        <button class="btn ghost" type="button" id="defineRetry">Try again</button>
        <button class="btn ghost define-delete" type="button" id="defineDelete">Delete definition</button>
      </div>`;
    document.body.append(backdrop, sheet);
    backdrop.onclick = closePopup;
    sheet.querySelector("#defineClose").onclick = closePopup;
    document.addEventListener("keydown", event => { if (event.key === "Escape") closePopup(); });
    popup.ui = { backdrop, sheet, term: sheet.querySelector("#defineTerm"), status: sheet.querySelector("#defineStatus"),
      text: sheet.querySelector("#defineText"), retry: sheet.querySelector("#defineRetry"), remove: sheet.querySelector("#defineDelete") };
    return popup.ui;
  }

  function renderPopup({ term, status = "", definition = "", error = false, saved = false }) {
    const ui = popupUI();
    ui.term.textContent = term;
    ui.status.textContent = status;
    ui.status.className = `define-status${error ? " bad" : ""}`;
    ui.status.hidden = !status;
    ui.text.textContent = definition;
    ui.text.hidden = !definition;
    ui.retry.hidden = !error;
    ui.remove.hidden = !saved;
  }

  // The popup sits above the book and blocks its gestures; the page underneath is not touched.
  function openPopup(key) {
    const ui = popupUI();
    popup.open = true;
    popup.key = key;
    ui.backdrop.hidden = ui.sheet.hidden = false;
    reader?.setBlocked(true);
  }

  function closePopup() {
    if (!popup.open) return;
    popup.open = false;
    popup.key = null;
    popup.ui.backdrop.hidden = popup.ui.sheet.hidden = true;
    reader?.setBlocked(false);
  }

  // What the AI receives: the whole sentence and which occurrence of the word was tapped.
  function wordContext(book, word) {
    const sentence = book.sentences.get(word.sentenceId), entry = book.words.get(word.wordId);
    if (!sentence || !entry || entry.sentenceId !== sentence.id) return null;
    const same = (sentence.words || []).filter(item => item.key === entry.key);
    return { sentence: sentence.text, word: sentence.text.slice(entry.start, entry.end), start: entry.start, end: entry.end,
      occurrence: same.findIndex(item => item.id === entry.id) + 1, occurrences: same.length };
  }

  function openDefinition(current, word) {
    if (current !== session || !reader) return;
    const context = wordContext(current.book, word);
    if (!context) return;
    const key = word.key;
    const ui = popupUI();
    ui.retry.onclick = () => lookup(current, key, context);
    ui.remove.onclick = () => deleteDefinition(current, key);
    openPopup(key);
    const saved = current.definitions.get(key);
    if (saved) renderPopup({ term: saved.term, definition: saved.definition, saved: true });
    else lookup(current, key, context);
  }

  const showing = (current, key) => popup.open && popup.key === key && current === session;

  function lookup(current, key, context) {
    renderPopup({ term: context.word, status: "Looking up…" });
    let entry = current.pending.get(key);
    if (!entry) {
      // One request per word at a time: another tap during the request waits for the same answer.
      entry = { cancelled: false };
      entry.promise = request("define", context).then(result => {
        if (typeof result?.term !== "string" || typeof result?.definition !== "string" || !result.term.trim() || !result.definition.trim()) {
          throw new BooksError("The definition could not be read. Please try again.");
        }
        const definition = { term: result.term.trim().slice(0, 80), definition: result.definition.trim().slice(0, 300) };
        // A deletion during the request wins: the late answer is not written back.
        if (!entry.cancelled) {
          current.definitions.set(key, definition);
          current.definedKeys.add(key);
          persistDefinitions(current);
          if (current === session) reader?.refreshWord(key);
        }
        return definition;
      }).finally(() => { if (current.pending.get(key) === entry) current.pending.delete(key); });
      current.pending.set(key, entry);
    }
    entry.promise.then(definition => {
      if (showing(current, key)) renderPopup({ term: definition.term, definition: definition.definition, saved: current.definitions.get(key) === definition });
    }, error => {
      // Errors are shown, never stored, and the word stays without an underline.
      if (showing(current, key)) renderPopup({ term: context.word, status: error.message, error: true });
    });
  }

  function deleteDefinition(current, key) {
    const entry = current.pending.get(key);
    if (entry) { entry.cancelled = true; current.pending.delete(key); }
    current.definitions.delete(key);
    current.definedKeys.delete(key);
    persistDefinitions(current);
    if (current === session) reader?.refreshWord(key);
    closePopup();
  }

  showLibrary();
})();
