/* Shared by the Books page and Node tests. No storage, network or build step. */
(function (root) {
  "use strict";

  const BOOK_ID = /^[0-9a-f]{64}$/;
  const PART_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  const string = (value, max, empty = false) => typeof value === "string" && value.length <= max && (empty || value.trim().length > 0);

  // Library list from the Worker: [{bookId, title, author}].
  function validateCatalog(data) {
    const fail = () => { throw new Error("The library list has an unexpected format."); };
    if (!data || !Array.isArray(data.books) || data.books.length > 500) fail();
    const ids = new Set();
    return data.books.map(book => {
      if (!book || !BOOK_ID.test(book.bookId) || ids.has(book.bookId) || !string(book.title, 300) ||
          !(book.author === null || string(book.author, 300))) fail();
      ids.add(book.bookId);
      return { bookId: book.bookId, title: book.title, author: book.author };
    });
  }

  /* book.json from tools/prepare-book.py (formatVersion 1). Returns the book with
     lookup tables; pages must reference existing sentences of their own chapter. */
  function validateBook(data, expectedId) {
    const fail = reason => { throw new Error(`The book file is invalid (${reason}).`); };
    if (!data || typeof data !== "object" || data.formatVersion !== 1) fail("format version");
    if (!BOOK_ID.test(data.bookId) || (expectedId !== undefined && data.bookId !== expectedId)) fail("bookId");
    if (!string(data.title, 300) || !(data.author === null || string(data.author, 300))) fail("title or author");
    if (!Array.isArray(data.chapters) || !data.chapters.length) fail("chapters");
    if (!Array.isArray(data.pages) || !data.pages.length) fail("pages");

    const ids = new Set(), chapters = new Map(), sentences = new Map();
    const unique = id => { if (typeof id !== "string" || !PART_ID.test(id) || ids.has(id)) fail(`id ${String(id).slice(0, 40)}`); ids.add(id); return id; };
    data.chapters.forEach(chapter => {
      if (!chapter || !(chapter.title === null || string(chapter.title, 1000)) || !Array.isArray(chapter.paragraphs)) fail("chapter");
      chapters.set(unique(chapter.id), chapter);
      chapter.paragraphs.forEach(paragraph => {
        if (!paragraph || !Array.isArray(paragraph.sentences) || !paragraph.sentences.length ||
            !(paragraph.kind === undefined || paragraph.kind === "text" || paragraph.kind === "heading")) fail("paragraph");
        unique(paragraph.id);
        paragraph.sentences.forEach((sentence, index) => {
          if (!sentence || !string(sentence.text, 20000)) fail("sentence");
          sentences.set(unique(sentence.id), { text: sentence.text, paragraph, chapter, first: index === 0 });
        });
      });
    });

    const used = new Set(), firstPage = new Map();
    data.pages.forEach((page, index) => {
      if (!page || page.number !== index + 1 || !chapters.has(page.chapterId) ||
          !Array.isArray(page.sentenceIds) || !page.sentenceIds.length) fail(`page ${index + 1}`);
      page.sentenceIds.forEach(id => {
        const sentence = sentences.get(id);
        if (!sentence || sentence.chapter.id !== page.chapterId || used.has(id)) fail(`page ${index + 1}`);
        used.add(id);
      });
      if (!firstPage.has(page.chapterId)) firstPage.set(page.chapterId, index);
    });
    return { ...data, sentences, chapters, firstPage };
  }

  // Blocks of one prepared page: paragraphs split across pages are marked as continued.
  function pageModel(book, index) {
    const page = book.pages[index];
    const chapter = book.chapters.get(page.chapterId);
    const blocks = [];
    page.sentenceIds.forEach(id => {
      const sentence = book.sentences.get(id);
      let block = blocks[blocks.length - 1];
      if (!block || block.paragraph !== sentence.paragraph) {
        block = { paragraph: sentence.paragraph, id: sentence.paragraph.id,
          kind: sentence.paragraph.kind === "heading" ? "heading" : "text", continued: !sentence.first, sentences: [] };
        blocks.push(block);
      }
      block.sentences.push({ id, text: sentence.text });
    });
    return { page, chapter, startsChapter: book.firstPage.get(chapter.id) === index, blocks };
  }

  // Contents entries: every chapter that has pages, with its first page index.
  function contents(book) {
    return [...book.chapters.values()].filter(chapter => book.firstPage.has(chapter.id))
      .map(chapter => ({ id: chapter.id, title: chapter.title, page: book.firstPage.get(chapter.id) }));
  }

  const api = { validateCatalog, validateBook, pageModel, contents };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BooksCore = api;
})(typeof window !== "undefined" ? window : globalThis);
