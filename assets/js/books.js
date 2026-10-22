(async function () {
  "use strict";
  const host = document.getElementById("app");
  const profile = await Profiles.require(host);
  if (!profile) return;

  const core = BooksCore;
  const menuUrl = Profiles.url("index.html");
  const controllers = new Set();
  let view = "library", library = null, book = null, index = 0, ticket = 0, disposed = false;

  window.addEventListener("pagehide", () => { disposed = true; controllers.forEach(controller => controller.abort()); });
  window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
  // Telegram Back: reader → library → menu. Profile choice is only a label, not access.
  if (tg?.BackButton) {
    tg.BackButton.show();
    tg.BackButton.onClick(() => { if (view === "library") location.href = menuUrl; else showLibrary(); });
  }
  document.addEventListener("keydown", event => {
    if (view !== "reader" || !book || event.altKey || event.ctrlKey || event.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    if (event.key === "ArrowLeft") go(index - 1);
    if (event.key === "ArrowRight") go(index + 1);
  });

  class BooksError extends Error {
    constructor(message, code = "", userId = null) { super(message); this.code = code; this.userId = userId; }
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
        const reason = typeof data?.message === "string" && data.message.trim() ? data.message.trim() : "";
        // Shown only when the Worker verified the Telegram signature and returned this account's ID.
        const userId = Number.isSafeInteger(data?.userId) && data.userId > 0 ? data.userId : null;
        const upstream = Number.isInteger(data?.providerStatus) ? `; HTTP ${data.providerStatus}` : "";
        if (code) throw new BooksError(`${reason || "The request failed. Please try again."} [${code}${upstream}]`, code, userId);
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

  /* ---------- library ---------- */

  function showLibrary() {
    ticket++;
    view = "library"; book = null;
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
      <p class="sub">Choose a book. Its pages are prepared in advance.</p></header>
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
    const titles = {
      books_forbidden: "Books are not enabled for this account",
      books_not_configured: "Books are not set up yet",
      no_telegram: "Open in Telegram",
    };
    host.innerHTML = `<div class="books-error" role="alert">
      ${inReader ? `<div class="reader-bar"><button class="reader-action" type="button" id="errorLibrary">← Library</button></div>` : ""}
      <h2 id="errorTitle"></h2><p class="sub" id="errorMessage"></p><div id="errorExtra"></div>
      ${error.code === "no_telegram" ? "" : `<button class="btn" type="button" id="errorRetry">Try again</button>`}</div>`;
    host.querySelector("#errorTitle").textContent = titles[error.code] || "Could not load";
    host.querySelector("#errorMessage").textContent = error.message;
    if (error.userId) host.querySelector("#errorExtra").append(userIdCard(error.userId));
    host.querySelector("#errorRetry")?.addEventListener("click", retry);
    host.querySelector("#errorLibrary")?.addEventListener("click", showLibrary);
  }

  function userIdCard(userId) {
    const card = el("div", "user-id-card");
    const value = el("output", "user-id", String(userId));
    value.id = "telegramUserId";
    const copy = el("button", "btn ghost", "Copy ID");
    copy.type = "button"; copy.id = "copyUserId";
    const status = el("p", "status", "");
    status.setAttribute("role", "status");
    copy.onclick = () => copyText(String(userId), value, status);
    card.append(el("p", "user-id-label", "Your Telegram user ID"), value, copy, status,
      el("p", "books-note", "Send this ID to the app owner to enable Books for your account."));
    return card;
  }

  async function copyText(value, source, status) {
    try {
      await navigator.clipboard.writeText(value);
      status.className = "status ok"; status.textContent = "Copied.";
      return;
    } catch (_) {}
    const area = el("textarea");
    area.value = value; area.readOnly = true; area.className = "copy-buffer";
    document.body.append(area);
    area.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } catch (_) {}
    area.remove();
    if (copied) { status.className = "status ok"; status.textContent = "Copied."; return; }
    const range = document.createRange();
    range.selectNodeContents(source);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    status.className = "status bad"; status.textContent = "Could not copy automatically. The number is selected — copy it manually.";
  }

  /* ---------- reader ---------- */

  async function openBook(entry) {
    const current = ++ticket;
    view = "loading"; book = null;
    setReading(true);
    host.innerHTML = `<div class="reader-bar"><button class="reader-action" type="button" id="loadingLibrary">← Library</button></div>
      <p class="sub" role="status" id="loadingStatus"></p>`;
    host.querySelector("#loadingStatus").textContent = `Opening “${entry.title}”…`;
    host.querySelector("#loadingLibrary").onclick = showLibrary;
    window.scrollTo(0, 0);
    try {
      const loaded = core.validateBook(await request("book", { bookId: entry.bookId }), entry.bookId);
      if (disposed || current !== ticket) return;
      book = loaded; view = "reader";
      renderReader();
      go(0);
    } catch (error) {
      if (!disposed && current === ticket) renderError(error, () => openBook(entry), true);
    }
  }

  function renderReader() {
    host.innerHTML = `<div class="reader">
      <div class="reader-bar">
        <button class="reader-action" type="button" id="toLibrary">← Library</button>
        <button class="reader-action" type="button" id="tocToggle" aria-expanded="false" aria-controls="toc">Contents</button>
      </div>
      <header class="reader-head"><p class="reader-book" id="bookTitle"></p><p class="reader-chapter" id="chapterTitle"></p></header>
      <nav class="toc" id="toc" aria-label="Contents" hidden><h2>Contents</h2><ol id="tocList"></ol></nav>
      <article class="reader-page" id="readerPage" lang="en"></article>
      <nav class="pager" id="pager" aria-label="Pages">
        <button class="pager-btn" type="button" id="prevPage">Previous</button>
        <span class="pager-number" id="pageNumber" aria-live="polite"></span>
        <button class="pager-btn" type="button" id="nextPage">Next</button>
      </nav></div>`;
    host.querySelector("#bookTitle").textContent = book.author ? `${book.title} · ${book.author}` : book.title;
    host.querySelector("#toLibrary").onclick = showLibrary;
    host.querySelector("#tocToggle").onclick = () => toggleContents();
    host.querySelector("#prevPage").onclick = () => go(index - 1);
    host.querySelector("#nextPage").onclick = () => go(index + 1);
    const list = host.querySelector("#tocList");
    core.contents(book).forEach(entry => {
      const button = el("button", "toc-item");
      button.type = "button";
      button.dataset.chapterId = entry.id;
      button.append(el("span", "toc-title", entry.title || "Untitled section"), el("span", "toc-page", `p. ${entry.page + 1}`));
      button.onclick = () => go(entry.page);
      const item = el("li");
      item.append(button);
      list.append(item);
    });
  }

  function toggleContents(open = host.querySelector("#toc").hidden) {
    const toggle = host.querySelector("#tocToggle");
    host.querySelector("#toc").hidden = !open;
    host.querySelector("#readerPage").hidden = open;
    host.querySelector("#pager").hidden = open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Close contents" : "Contents";
    if (open) {
      host.querySelector(`.toc-item[aria-current="true"]`)?.scrollIntoView({ block: "center" });
    }
  }

  function go(target) {
    if (!book || target < 0 || target >= book.pages.length) return;
    index = target;
    const model = core.pageModel(book, index);
    const article = host.querySelector("#readerPage");
    article.replaceChildren();
    article.dataset.page = String(model.page.number);
    article.dataset.chapterId = model.chapter.id;
    if (model.startsChapter && model.chapter.title) article.append(el("h2", "chapter-title", model.chapter.title));
    model.blocks.forEach(block => {
      const node = el(block.kind === "heading" ? "h3" : "p", block.continued ? "continued" : "");
      node.dataset.paragraphId = block.id;
      block.sentences.forEach((sentence, position) => {
        if (position) node.append(" ");
        const span = el("span", "sentence", sentence.text);
        span.dataset.sentenceId = sentence.id;
        node.append(span);
      });
      article.append(node);
    });
    host.querySelector("#chapterTitle").textContent = model.chapter.title || "";
    host.querySelector("#pageNumber").textContent = `Page ${model.page.number} of ${book.pages.length}`;
    host.querySelector("#prevPage").disabled = index === 0;
    host.querySelector("#nextPage").disabled = index === book.pages.length - 1;
    host.querySelectorAll(".toc-item").forEach(item => {
      if (item.dataset.chapterId === model.chapter.id) item.setAttribute("aria-current", "true");
      else item.removeAttribute("aria-current");
    });
    if (!host.querySelector("#toc").hidden) toggleContents(false);
    window.scrollTo(0, 0);
  }

  showLibrary();
})();
