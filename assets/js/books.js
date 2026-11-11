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
  // Reopening the same book while a lookup runs must share its pending saves and deletions.
  const booksWithLookups = new Map();
  function startSession(book) {
    if (booksWithLookups.has(book.bookId)) return booksWithLookups.get(book.bookId);
    const legacy = new Map(), byWord = new Map();
    for (const [key, card] of Object.entries(readStore(book.bookId, "definitions") || {})) {
      if (typeof card?.term !== "string" || typeof card.definition !== "string") continue;
      if (!key.startsWith("@")) {
        legacy.set(key, card);
        continue;
      }
      const ids = card.wordIds;
      const sentenceId = book.words.get(ids?.[0])?.sentenceId;
      if (sentenceId && Array.isArray(ids) && ids.every(id => book.words.get(id)?.sentenceId === sentenceId)) {
        for (const id of ids) byWord.set(id, card);
      }
    }
    return { book, legacy, byWord, pending: new Map(), warned: false };
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
    const cards = new Map(current.legacy);
    for (const card of new Set(current.byWord.values())) cards.set("@" + card.wordIds[0], card);
    if (!writeStore(current.book.bookId, "definitions", Object.fromEntries(cards))) warnStorage(current);
    if (current === session) reader?.refreshUnderlines();
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
        position: savedPosition(loaded.bookId), isDefined: (id, key) => active.byWord.has(id) || active.legacy.has(key),
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

  const popup = { open: false, key: null, ui: null, data: null, detail: null };

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
      <div class="define-detail" id="defineDetail" hidden aria-live="polite">
        <span class="define-detail-label" id="defineDetailLabel"></span>
        <p id="defineDetailText"></p>
      </div>
      <div class="define-actions">
        <button class="define-action" type="button" id="defineExample" aria-pressed="false" aria-controls="defineDetail">Example</button>
        <button class="define-action" type="button" id="defineTranslation" aria-pressed="false" aria-controls="defineDetail">Translation</button>
        <button class="define-action define-delete" type="button" id="defineDelete">Delete</button>
      </div>`;
    document.body.append(backdrop, sheet);
    backdrop.onclick = closePopup;
    sheet.querySelector("#defineClose").onclick = closePopup;
    sheet.querySelector("#defineExample").onclick = () => toggleDetail("example");
    sheet.querySelector("#defineTranslation").onclick = () => toggleDetail("translation");
    document.addEventListener("keydown", event => { if (event.key === "Escape") closePopup(); });
    popup.ui = { backdrop, sheet, term: sheet.querySelector("#defineTerm"), status: sheet.querySelector("#defineStatus"),
      text: sheet.querySelector("#defineText"), example: sheet.querySelector("#defineExample"),
      translation: sheet.querySelector("#defineTranslation"), remove: sheet.querySelector("#defineDelete"),
      detail: sheet.querySelector("#defineDetail"), detailLabel: sheet.querySelector("#defineDetailLabel"),
      detailText: sheet.querySelector("#defineDetailText") };
    return popup.ui;
  }

  function renderPopup({ term, status = "", definition = "", example = "", translation = "", error = false, saved = false, pending = false }) {
    const ui = popupUI();
    popup.data = { example, translation };
    popup.detail = null;
    ui.term.textContent = term;
    ui.status.textContent = status;
    ui.status.className = `define-status${error ? " bad" : ""}`;
    ui.status.hidden = !status;
    ui.text.textContent = definition;
    ui.text.hidden = !definition;
    ui.example.disabled = !example;
    ui.translation.disabled = !translation;
    ui.remove.disabled = !saved && !pending;
    renderDetail();
  }

  function toggleDetail(kind) {
    if (!popup.data?.[kind]) return;
    popup.detail = popup.detail === kind ? null : kind;
    renderDetail();
  }

  function renderDetail() {
    const ui = popupUI(), kind = popup.detail;
    ui.example.setAttribute("aria-pressed", String(kind === "example"));
    ui.translation.setAttribute("aria-pressed", String(kind === "translation"));
    ui.detail.hidden = !kind;
    ui.detailLabel.textContent = kind === "example" ? "Example" : kind === "translation" ? "Translation" : "";
    ui.detailText.textContent = kind ? popup.data[kind] : "";
    ui.detailText.lang = kind === "translation" ? "uk" : "en";
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
    popup.data = null;
    popup.detail = null;
    popup.ui.backdrop.hidden = popup.ui.sheet.hidden = true;
    reader?.setBlocked(false);
  }

  function openDefinition(current, word) {
    if (current !== session || !reader) return;
    const entry = current.book.words.get(word.wordId);
    if (!entry || entry.sentenceId !== word.sentenceId) return;
    popupUI().remove.onclick = () => deleteDefinition(current, entry);
    openPopup(entry.id);
    const saved = current.byWord.get(entry.id);
    if (saved) {
      renderPopup({ ...saved, saved: true });
      return;
    }
    lookup(current, entry);
  }

  const showing = (current, id) => popup.open && popup.key === id && current === session;

  function unlinkCard(current, card) {
    if (card) for (const id of card.wordIds) current.byWord.delete(id);
  }

  async function lookup(current, word) {
    const sentence = current.book.sentences.get(word.sentenceId);
    const term = sentence.text.slice(word.start, word.end);
    const saved = current.legacy.get(word.key);
    renderPopup({ term, ...saved, saved: Boolean(saved), pending: true, status: saved ? "Updating…" : "Looking up…" });
    if (current.pending.has(word.id)) return;
    const ticket = {};
    current.pending.set(word.id, ticket);
    booksWithLookups.set(current.book.bookId, current);
    try {
      const same = sentence.words.filter(item => item.key === word.key);
      const result = await request("define", { sentence: sentence.text, word: term, start: word.start, end: word.end,
        occurrence: same.findIndex(item => item.id === word.id) + 1, occurrences: same.length,
        wordRanges: sentence.words.map(item => [item.start, item.end]) });
      if (current.pending.get(word.id) !== ticket) return;
      if (!["term", "definition"].every(field => typeof result?.[field] === "string" && result[field].trim())) {
        throw new BooksError("The word details could not be read. Close this card and tap the word again.");
      }
      // During a staggered deployment an older Worker can still supply a readable definition.
      if (result.wordIndexes === undefined) {
        if (showing(current, word.id)) renderPopup({ ...saved, term: result.term, definition: result.definition,
          example: result.example || saved?.example, translation: result.translation || saved?.translation,
          saved: Boolean(saved), status: "Update the Books Worker to enable phrase underlining." });
        return;
      }
      const indexes = result.wordIndexes;
      if (!["example", "translation"].every(field => typeof result[field] === "string" && result[field].trim()) ||
          !Array.isArray(indexes) || !indexes.every((n, i) => Number.isInteger(n) && n >= 0 && n < sentence.words.length &&
            (i === 0 || n > indexes[i - 1])) || !indexes.some(n => sentence.words[n].id === word.id)) {
        throw new BooksError("The word details could not be read. Close this card and tap the word again.");
      }
      const wordIds = indexes.map(n => sentence.words[n].id);
      const card = { term: result.term.trim(), definition: result.definition.trim(), example: result.example.trim(),
        translation: result.translation.trim(), wordIds };
      for (const id of wordIds) unlinkCard(current, current.byWord.get(id));
      for (const id of wordIds) {
        current.byWord.set(id, card);
        current.pending.delete(id);
        const key = current.book.words.get(id).key;
        if (current.legacy.get(key)?.term === card.term) current.legacy.delete(key);
      }
      current.legacy.delete(word.key);
      persistDefinitions(current);
      if (wordIds.some(id => showing(current, id))) renderPopup({ ...card, saved: true });
    } catch (error) {
      if (current.pending.get(word.id) === ticket && showing(current, word.id)) {
        renderPopup({ term, ...saved, saved: Boolean(saved), status: error.message, error: true });
      }
    } finally {
      if (current.pending.get(word.id) === ticket) current.pending.delete(word.id);
      if (!current.pending.size && booksWithLookups.get(current.book.bookId) === current) booksWithLookups.delete(current.book.bookId);
    }
  }

  function deleteDefinition(current, word) {
    current.pending.delete(word.id);
    const card = current.byWord.get(word.id);
    if (card) unlinkCard(current, card);
    else current.legacy.delete(word.key);
    persistDefinitions(current);
    closePopup();
  }

  showLibrary();
})();
