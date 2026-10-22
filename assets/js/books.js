(async function () {
  "use strict";
  const host = document.getElementById("app");
  const profile = await Profiles.require(host);
  if (!profile) return;

  const core = BooksCore;
  const menuUrl = Profiles.url("index.html");
  const controllers = new Set();
  let view = "library", library = null, reader = null, ticket = 0, disposed = false;

  window.addEventListener("pagehide", () => { disposed = true; reader?.destroy(); controllers.forEach(controller => controller.abort()); });
  window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
  // Telegram Back: reader → library → menu. Profile choice is only a label, not access.
  if (tg?.BackButton) {
    tg.BackButton.show();
    tg.BackButton.onClick(() => { if (view === "library") location.href = menuUrl; else showLibrary(); });
  }

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
    view = "library";
    reader?.destroy(); reader = null;
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
    view = "loading";
    reader?.destroy(); reader = null;
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
      reader = new BookReader({ host, book: loaded, telegram: tg, onBack: showLibrary });
    } catch (error) {
      if (!disposed && current === ticket) {
        reader?.destroy(); reader = null;
        renderError(error, () => openBook(entry), true);
      }
    }
  }

  showLibrary();
})();
