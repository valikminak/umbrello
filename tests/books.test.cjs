const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateCatalog, validateBook, pageModel, contents } = require('../assets/js/books-core.js');

const ID = 'd'.repeat(64);
const sentence = (id, text) => ({ id, text });
// Same shape as tools/prepare-book.py output.
const book = () => ({
  formatVersion: 1, bookId: ID, title: 'Sample', author: 'Writer',
  chapters: [
    { id: 'c1', title: 'Chapter 1', paragraphs: [
      { id: 'c1.p1', kind: 'heading', sentences: [sentence('c1.p1.s1', 'A Subheading')] },
      { id: 'c1.p2', sentences: [sentence('c1.p2.s1', 'One.'), sentence('c1.p2.s2', 'Two.'), sentence('c1.p2.s3', 'Three.')] },
    ] },
    { id: 'c2', title: null, paragraphs: [{ id: 'c2.p1', sentences: [sentence('c2.p1.s1', '<b>not html</b>')] }] },
  ],
  pages: [
    { number: 1, chapterId: 'c1', words: 4, sentenceIds: ['c1.p1.s1', 'c1.p2.s1', 'c1.p2.s2'] },
    { number: 2, chapterId: 'c1', words: 1, sentenceIds: ['c1.p2.s3'] },
    { number: 3, chapterId: 'c2', words: 2, sentenceIds: ['c2.p1.s1'] },
  ],
});

test('catalog keeps only bookId, title and author and rejects malformed entries', () => {
  assert.deepEqual(validateCatalog({ books: [{ bookId: ID, title: 'T', author: null, path: 'books/x.json' }] }),
    [{ bookId: ID, title: 'T', author: null }]);
  assert.deepEqual(validateCatalog({ books: [] }), []);
  for (const books of [undefined, {}, [{ bookId: 'x', title: 'T', author: null }], [{ bookId: ID, title: '', author: null }],
    [{ bookId: ID, title: 'T' }], [{ bookId: ID, title: 'T', author: null }, { bookId: ID, title: 'U', author: null }]]) {
    assert.throws(() => validateCatalog({ books }));
  }
});

test('prepared pages are used as is, with paragraphs, headings and sentence ids', () => {
  const loaded = validateBook(book(), ID);
  assert.equal(loaded.pages.length, 3);
  const first = pageModel(loaded, 0);
  assert.equal(first.startsChapter, true);
  assert.equal(first.chapter.title, 'Chapter 1');
  assert.deepEqual(first.blocks.map(b => [b.id, b.kind, b.continued, b.sentences.map(s => s.id)]), [
    ['c1.p1', 'heading', false, ['c1.p1.s1']],
    ['c1.p2', 'text', false, ['c1.p2.s1', 'c1.p2.s2']],
  ]);
  const second = pageModel(loaded, 1);
  assert.equal(second.startsChapter, false);
  assert.deepEqual(second.blocks.map(b => [b.id, b.continued]), [['c1.p2', true]]);
  assert.equal(pageModel(loaded, 2).blocks[0].sentences[0].text, '<b>not html</b>');
  assert.deepEqual(contents(loaded), [{ id: 'c1', title: 'Chapter 1', page: 0 }, { id: 'c2', title: null, page: 2 }]);
});

test('books with a different id or broken page references are rejected', () => {
  assert.throws(() => validateBook(book(), 'e'.repeat(64)), /bookId/);
  const cases = [
    b => { b.formatVersion = 2; }, b => { delete b.title; }, b => { b.pages = []; },
    b => { b.pages[1].number = 5; }, b => { b.pages[0].chapterId = 'c9'; },
    b => { b.pages[2].sentenceIds = ['c1.p2.s3']; }, // repeated sentence
    b => { b.pages[2].chapterId = 'c1'; },             // sentence from another chapter
    b => { b.pages[0].sentenceIds.push('missing'); },
    b => { b.chapters[1].paragraphs[0].id = 'c1.p1'; },
    b => { b.chapters[0].paragraphs[0].kind = 'script'; },
    b => { b.chapters[0].paragraphs[1].sentences[0].text = 7; },
  ];
  for (const change of cases) {
    const data = book(); change(data);
    assert.throws(() => validateBook(data, ID));
  }
});

test('the local prepared book validates when present (not part of the repository)', { skip: !fs.existsSync(path.join(__dirname, '../output/woman-in-the-dunes/book.json')) }, () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../output/woman-in-the-dunes/book.json'), 'utf8'));
  const loaded = validateBook(data, data.bookId);
  const seen = loaded.pages.flatMap((_, i) => pageModel(loaded, i).blocks.flatMap(b => b.sentences.map(s => s.id)));
  assert.equal(seen.length, loaded.sentences.size);
});
