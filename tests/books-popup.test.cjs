const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../assets/js/books-core.js');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/books.js'), 'utf8');
const ID = 'a'.repeat(64);
const storageKey = `umbrello.books.v1.123.${ID}.definitions`;
const card = { term: 'book', definition: 'A set of pages to read.', example: 'I read a book every week.', translation: 'книга' };
const tick = () => new Promise(resolve => setImmediate(resolve));
const fixture = () => ({ formatVersion: 2, bookId: ID, title: 'Test Book', author: 'Writer', processing: { offsetUnit: 'utf16' },
  chapters: [{ id: 'c1', title: 'One', paragraphs: [{ id: 'p1', sentences: [
    { id: 's1', text: 'Read a book.', words: [{ id: 'w1', key: 'book', start: 7, end: 11 }] },
  ] }] }],
});

// Exercise the real page controller, requests and persistence; layout is supplied by a reader stub.
async function page({ storage = {}, answer = () => card } = {}) {
  const nodes = new Map();
  class Element {
    constructor() { this.children = []; this.attrs = {}; this.dataset = {}; this.hidden = false; this.disabled = false; }
    set innerHTML(value) {
      this.html = value;
      for (const match of value.matchAll(/<\w+\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
        const node = new Element();
        for (const attr of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) node.setAttribute(attr[1], attr[2]);
        node.hidden = /\bhidden\b/.test(match[0]);
        nodes.set('#' + match[1], node);
      }
    }
    setAttribute(key, value) { this.attrs[key] = value; }
    querySelector(key) { return nodes.get(key) || null; }
    append(...items) { this.children.push(...items); }
    replaceWith() {}
    addEventListener(event, fn) { this['on' + event] = fn; }
    click() { if (!this.disabled) this.onclick?.(); }
  }
  const host = new Element(), readers = [], requests = [];
  const context = vm.createContext({
    URL, AbortController, setTimeout, clearTimeout, console,
    document: { getElementById: () => host, createElement: () => new Element(), addEventListener() {},
      body: { append() {}, classList: { toggle() {} } } },
    window: { addEventListener() {}, scrollTo() {} },
    Profiles: { shared: async () => true, userId: 123, url: value => value, refuse: () => false },
    BooksCore: core, WORKER_URL: 'https://worker.test', tg: { initData: 'signed' },
    localStorage: { getItem: key => storage[key] ?? null, setItem: (key, value) => { storage[key] = value; } },
    BookReader: class {
      constructor(options) { Object.assign(this, options); readers.push(this); }
      setBlocked(value) { this.blocked = value; }
      refreshWord(key) { this.refreshed = key; }
      destroy() {} note() {}
    },
    fetch: async (url, config) => {
      const action = url.pathname.split('/').pop();
      const body = JSON.parse(config.body);
      requests.push({ action, body });
      const result = action === 'list' ? { books: [{ bookId: ID, title: 'Test Book', author: 'Writer' }] }
        : action === 'book' ? fixture() : await answer(body);
      return { ok: true, json: async () => result };
    },
  });
  await vm.runInContext(source, context);
  await tick();
  nodes.get('#bookList').children[0].children[0].click();
  await tick();
  const tap = () => readers.at(-1).onWord({ wordId: 'w1', key: 'book', sentenceId: 's1' });
  return { node: id => nodes.get('#' + id), tap, storage, readers, requests,
    lookups: () => requests.filter(r => r.action === 'define') };
}

test('one lookup supplies both toggles, persists all fields and reopens offline without another request', async () => {
  const app = await page();
  app.tap(); await tick();
  assert.equal(app.lookups().length, 1);
  assert.equal(app.node('defineText').textContent, card.definition);
  assert.equal(app.node('defineDetail').hidden, true);
  assert.equal(app.node('defineRetry'), undefined);
  app.node('defineExample').click();
  assert.equal(app.node('defineDetailText').textContent, card.example);
  assert.equal(app.node('defineExample').attrs['aria-pressed'], 'true');
  app.node('defineTranslation').click();
  assert.equal(app.node('defineDetailText').textContent, card.translation);
  assert.equal(app.node('defineDetailText').lang, 'uk');
  assert.equal(app.node('defineExample').attrs['aria-pressed'], 'false');
  app.node('defineTranslation').click();
  assert.equal(app.node('defineDetail').hidden, true);
  assert.equal(app.lookups().length, 1);
  assert.deepEqual(JSON.parse(app.storage[storageKey]).book, card);
  const reopened = await page({ storage: app.storage, answer: () => { throw Error('offline'); } });
  reopened.tap(); await tick();
  reopened.node('defineTranslation').click();
  assert.equal(reopened.node('defineDetailText').textContent, card.translation);
  assert.equal(reopened.lookups().length, 0);
});

test('old definitions remain visible and are upgraded in one request without touching reading progress', async () => {
  const storage = { [storageKey]: JSON.stringify({ book: { term: card.term, definition: card.definition } }),
    [`umbrello.books.v1.123.${ID}.position`]: '{"chapterId":"c1","sentenceId":"s1","offset":7}' };
  const original = storage[`umbrello.books.v1.123.${ID}.position`];
  let resolve;
  const app = await page({ storage, answer: () => new Promise(r => { resolve = r; }) });
  app.tap();
  assert.equal(app.node('defineText').textContent, card.definition);
  assert.equal(app.node('defineExample').disabled, true);
  app.node('defineClose').click(); app.tap();
  assert.equal(app.lookups().length, 1, 'reopening while pending shares the request');
  resolve(card); await tick();
  assert.deepEqual(JSON.parse(storage[storageKey]).book, card);
  assert.equal(storage[`umbrello.books.v1.123.${ID}.position`], original);
});

test('deleting a pending word cancels its save and an old answer cannot replace a newer lookup', async () => {
  const replies = [];
  const app = await page({ answer: () => new Promise(resolve => replies.push(resolve)) });
  app.tap();
  app.node('defineDelete').click();
  app.tap();
  assert.equal(app.lookups().length, 2);
  replies[0]({ ...card, definition: 'Old answer' }); await tick();
  assert.equal(JSON.parse(app.storage[storageKey]).book, undefined);
  assert.equal(app.node('defineStatus').textContent, 'Looking up…');
  replies[1](card); await tick();
  assert.equal(app.node('defineText').textContent, card.definition);
  app.node('defineDelete').click();
  assert.equal(JSON.parse(app.storage[storageKey]).book, undefined);
  assert.equal(app.readers.at(-1).definedKeys.has('book'), false);
});

test('failed upgrades keep old definitions; closing and tapping again retries with no retry button', async () => {
  let attempts = 0;
  const legacy = { term: card.term, definition: card.definition };
  const app = await page({ storage: { [storageKey]: JSON.stringify({ book: legacy }) },
    answer: () => { if (!attempts++) throw Error('Temporary failure'); return card; } });
  app.tap(); await tick();
  assert.equal(app.node('defineText').textContent, legacy.definition);
  assert.equal(app.node('defineStatus').textContent, 'Temporary failure');
  assert.equal(app.node('defineTranslation').disabled, true);
  assert.deepEqual(JSON.parse(app.storage[storageKey]).book, legacy);
  app.node('defineClose').click(); app.tap(); await tick();
  assert.equal(app.lookups().length, 2);
  assert.equal(app.node('defineTranslation').disabled, false);
});

test('missing new fields are not saved as a complete card', async () => {
  const app = await page({ answer: () => ({ term: card.term, definition: card.definition }) });
  app.tap(); await tick();
  assert.match(app.node('defineStatus').textContent, /could not be read/);
  assert.equal(app.storage[storageKey], undefined);
  assert.equal(app.lookups().length, 1);
});
