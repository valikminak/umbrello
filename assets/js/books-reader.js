/* Screen-sized pages. The browser lays out one chapter in horizontal columns;
   the source sentences and their UTF-16 word offsets remain unchanged. */
(function (root) {
  "use strict";

  class BookReader {
    constructor({ host, book, telegram, onBack, onWord, onPosition, position, definedKeys }) {
      this.host = host;
      this.book = book;
      this.telegram = telegram;
      this.onWord = onWord;
      this.onPosition = onPosition;
      this.definedKeys = definedKeys || new Set();
      this.chapterIndex = 0;
      this.page = 0;
      this.pageCount = 1;
      this.gap = 32;
      this.anchor = null;
      this.blocked = false;
      this.destroyed = false;
      this.listeners = [];
      this.frame = 0;
      this.suppressClickUntil = 0;
      this.range = document.createRange();

      host.innerHTML = `<section class="reader" aria-label="Book reader">
        <header class="reader-bar">
          <button class="reader-action" type="button" id="toLibrary">← Library</button>
          <p class="reader-book" id="bookTitle"></p>
        </header>
        <div class="reader-viewport" id="readerViewport">
          <article class="reader-flow" id="readerFlow" dir="ltr"></article>
        </div>
        <footer class="reader-footer">
          <span class="reader-chapter" id="chapterTitle"></span>
          <span class="reader-page-number" id="pageNumber" aria-live="polite"></span>
        </footer>
      </section>`;
      this.viewport = host.querySelector("#readerViewport");
      this.flow = host.querySelector("#readerFlow");
      this.chapterLabel = host.querySelector("#chapterTitle");
      this.pageLabel = host.querySelector("#pageNumber");
      this.flow.lang = typeof book.language === "string" ? book.language : "en";
      host.querySelector("#bookTitle").textContent = book.title;
      this.listen(host.querySelector("#toLibrary"), "click", onBack);
      this.setupGestures();

      this.scheduleLayout = () => {
        if (this.destroyed || this.frame) return;
        this.frame = requestAnimationFrame(() => {
          this.frame = 0;
          this.layout();
        });
      };
      this.listen(window, "resize", this.scheduleLayout);
      this.resizeObserver = new ResizeObserver(this.scheduleLayout);
      this.resizeObserver.observe(this.viewport);
      this.viewportChanged = event => { if (event.isStateStable) this.scheduleLayout(); };
      telegram?.onEvent("viewportChanged", this.viewportChanged);
      telegram?.onEvent("safeAreaChanged", this.scheduleLayout);
      telegram?.onEvent("contentSafeAreaChanged", this.scheduleLayout);
      this.restoreVerticalSwipes = Boolean(telegram?.isVersionAtLeast("7.7") && telegram.isVerticalSwipesEnabled);
      if (this.restoreVerticalSwipes) telegram.disableVerticalSwipes();

      const start = this.locate(position);
      this.renderChapter(start.index, false, start.anchor);
      // System serif fonts need no download, but respect font swaps before reflow.
      document.fonts?.ready.then(this.scheduleLayout);
    }

    listen(target, event, handler, options) {
      target.addEventListener(event, handler, options);
      this.listeners.push(() => target.removeEventListener(event, handler, options));
    }

    // A saved place is a chapter plus a character offset inside a sentence. Page numbers
    // are never stored: they change with the screen size, the anchor does not.
    locate(position) {
      if (!position || typeof position !== "object") return { index: 0, anchor: null };
      const index = this.book.chapterOrder.findIndex(chapter => chapter.id === position.chapterId);
      if (index < 0) return { index: 0, anchor: null };
      const sentence = this.book.sentences.get(position.sentenceId);
      if (!sentence || sentence.chapter.id !== position.chapterId) return { index, anchor: null };
      const offset = Number.isInteger(position.offset) ? Math.max(0, Math.min(position.offset, sentence.text.length - 1)) : 0;
      return { index, anchor: { sentenceId: sentence.id, offset } };
    }

    renderChapter(index, lastPage = false, anchor = null) {
      this.chapterIndex = index;
      this.anchor = anchor;
      this.pendingPage = anchor ? null : lastPage ? Infinity : 0;
      this.runs = [];
      this.runsBySentence = new Map();
      this.flow.style.transform = "none";
      const chapter = this.book.chapterOrder[index];
      const fragment = document.createDocumentFragment();
      for (const paragraph of chapter.paragraphs) {
        const heading = paragraph.kind === "heading";
        const block = document.createElement(heading ? `h${paragraph.level || 2}` : "p");
        block.className = heading ? "reader-heading" : "reader-paragraph";
        block.dataset.paragraphId = paragraph.id;
        paragraph.sentences.forEach((sentence, position) => {
          if (position) block.append(" ");
          const span = document.createElement("span");
          span.className = "sentence";
          span.dataset.sentenceId = sentence.id;
          const runs = [];
          const appendText = (parent, start, end, wordId = null) => {
            if (end <= start) return;
            const text = sentence.text.slice(start, end);
            const node = document.createTextNode(text);
            parent.append(node);
            if (/\S/u.test(text)) {
              const run = { node, start, end, sentenceId: sentence.id, wordId };
              runs.push(run);
              this.runs.push(run);
            }
          };
          let cursor = 0;
          // Version 1 is still readable; version 2 needs no tokenization here.
          for (const word of this.book.formatVersion === 2 ? sentence.words : []) {
            appendText(span, cursor, word.start);
            const token = document.createElement("span");
            token.className = "book-word";
            token.dataset.wordId = word.id;
            token.dataset.wordKey = word.key;
            if (this.definedKeys.has(word.key)) token.classList.add("defined");
            appendText(token, word.start, word.end, word.id);
            span.append(token);
            cursor = word.end;
          }
          appendText(span, cursor, sentence.text.length);
          this.runsBySentence.set(sentence.id, runs);
          block.append(span);
        });
        fragment.append(block);
      }
      // Chapter titles are metadata. The source heading is already in paragraphs.
      this.flow.replaceChildren(fragment);
      this.flow.dataset.chapterId = chapter.id;
      this.chapterTitle = chapter.title || `Section ${index + 1}`;
      this.chapterLabel.textContent = this.chapterTitle;
      this.layout();
    }

    // Underlines follow the saved definitions; they never change the text layout.
    refreshWord(key) {
      const defined = this.definedKeys.has(key);
      this.flow.querySelectorAll(".book-word").forEach(token => {
        if (token.dataset.wordKey === key) token.classList.toggle("defined", defined);
      });
    }

    setBlocked(blocked) {
      this.blocked = blocked;
      this.gesture = null;
    }

    // A short footer message, for example when the device refused to save.
    note(text) {
      clearTimeout(this.noteTimer);
      this.chapterLabel.textContent = text;
      this.noteTimer = setTimeout(() => { if (!this.destroyed) this.chapterLabel.textContent = this.chapterTitle; }, 4000);
    }

    layout() {
      if (this.destroyed) return;
      const width = Math.floor(this.viewport.clientWidth);
      const height = Math.floor(this.viewport.clientHeight);
      if (!width || !height) return; // ResizeObserver will retry once visible.
      this.gesture = null;
      this.stride = width + this.gap;
      this.flow.style.width = `${width}px`;
      this.flow.style.height = `${height}px`;
      this.flow.style.columnWidth = `${width}px`;
      this.flow.style.columnGap = `${this.gap}px`;
      this.flow.style.transform = "none";
      this.origin = this.flow.getBoundingClientRect().left;
      // The final character avoids counting a trailing empty column from margins.
      const last = this.runs[this.runs.length - 1];
      this.pageCount = last ? this.pageOf(last, last.node.length - 1) + 1 : 1;
      let target = this.pendingPage ?? this.page;
      if (this.anchor) {
        const runs = this.runsBySentence.get(this.anchor.sentenceId) || [];
        const run = runs.find(item => item.end > this.anchor.offset) || runs[runs.length - 1];
        if (run) target = this.pageOf(run, this.anchor.offset - run.start);
      }
      this.pendingPage = null;
      this.showPage(target);
    }

    // One-character ranges also work when a word or sentence spans two pages.
    pageOf(run, offset) {
      offset = Math.max(0, Math.min(offset, run.node.length - 1));
      const text = run.node.data;
      if (offset > 0 && /[\uDC00-\uDFFF]/.test(text[offset]) && /[\uD800-\uDBFF]/.test(text[offset - 1])) offset--;
      const length = text.codePointAt(offset) > 0xffff ? 2 : 1;
      this.range.setStart(run.node, offset);
      this.range.setEnd(run.node, offset + length);
      const rect = this.range.getBoundingClientRect();
      return Math.max(0, Math.floor((rect.left - this.origin + 0.5) / this.stride));
    }

    firstVisiblePosition() {
      // End positions are ordered in the left-to-right text flow. Binary search
      // avoids measuring every word on each swipe, including in long chapters.
      let low = 0, high = this.runs.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        const run = this.runs[middle];
        if (this.pageOf(run, run.node.length - 1) < this.page) low = middle + 1;
        else high = middle;
      }
      const run = this.runs[low];
      if (!run) return null;
      let start = 0, end = run.node.length - 1;
      while (start < end) {
        const middle = (start + end) >>> 1;
        if (this.pageOf(run, middle) < this.page) start = middle + 1;
        else end = middle;
      }
      if (start > 0 && /[\uDC00-\uDFFF]/.test(run.node.data[start])) start--;
      return { chapterId: this.book.chapterOrder[this.chapterIndex].id,
        sentenceId: run.sentenceId, wordId: run.wordId, offset: run.start + start };
    }

    showPage(page) {
      this.page = Math.max(0, Math.min(page, this.pageCount - 1));
      this.flow.style.transform = `translateX(${-this.page * this.stride}px)`;
      // This origin follows the same transform as all character ranges.
      this.origin = this.flow.getBoundingClientRect().left;
      this.flow.dataset.page = String(this.page + 1);
      this.anchor = this.firstVisiblePosition();
      this.pageLabel.textContent = `${this.page + 1} / ${this.pageCount}`;
      this.pageLabel.setAttribute("aria-label", `Page ${this.page + 1} of ${this.pageCount} in this section`);
      if (this.anchor) this.onPosition?.(this.anchor);
    }

    turn(direction) {
      if (this.destroyed || this.blocked || !this.stride) return;
      const target = this.page + direction;
      if (target >= 0 && target < this.pageCount) this.showPage(target);
      else if (direction > 0 && this.chapterIndex + 1 < this.book.chapterOrder.length) this.renderChapter(this.chapterIndex + 1);
      else if (direction < 0 && this.chapterIndex > 0) this.renderChapter(this.chapterIndex - 1, true);
    }

    setupGestures() {
      this.listen(this.viewport, "pointerdown", event => {
        if (!event.isPrimary || this.blocked) { this.gesture = null; return; }
        if (event.button !== 0) return;
        this.gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(), moved: false };
      });
      this.listen(this.viewport, "pointermove", event => {
        const gesture = this.gesture;
        if (!gesture || gesture.id !== event.pointerId) return;
        if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 10) {
          gesture.moved = true;
          // Capture only a drag. A tap retains its original word as the target.
          this.viewport.setPointerCapture(event.pointerId);
        }
      });
      this.listen(this.viewport, "pointerup", event => {
        const gesture = this.gesture;
        this.gesture = null;
        if (!gesture || gesture.id !== event.pointerId) return;
        const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
        if (gesture.moved || Math.hypot(dx, dy) > 10) this.suppressClickUntil = performance.now() + 400;
        if (this.blocked || performance.now() - gesture.time > 1200) return;
        const threshold = Math.max(40, Math.min(80, this.viewport.clientWidth * 0.15));
        if (Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * 1.5) this.turn(dx < 0 ? 1 : -1);
      });
      this.listen(this.viewport, "pointercancel", () => {
        this.gesture = null;
        this.suppressClickUntil = performance.now() + 400;
      });
      this.listen(this.viewport, "click", event => {
        if (this.blocked || performance.now() < this.suppressClickUntil) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
      // A tap on a word (never a swipe: those are stopped above) asks the page for its definition.
      this.listen(this.flow, "click", event => {
        const token = event.target.closest?.(".book-word");
        if (!token || this.blocked || !this.onWord) return;
        this.onWord({ wordId: token.dataset.wordId, key: token.dataset.wordKey, sentenceId: token.closest(".sentence")?.dataset.sentenceId });
      });
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      cancelAnimationFrame(this.frame);
      clearTimeout(this.noteTimer);
      this.resizeObserver.disconnect();
      this.listeners.forEach(remove => remove());
      this.telegram?.offEvent("viewportChanged", this.viewportChanged);
      this.telegram?.offEvent("safeAreaChanged", this.scheduleLayout);
      this.telegram?.offEvent("contentSafeAreaChanged", this.scheduleLayout);
      if (this.restoreVerticalSwipes) this.telegram.enableVerticalSwipes();
      this.gesture = null;
    }
  }

  root.BookReader = BookReader;
})(window);
