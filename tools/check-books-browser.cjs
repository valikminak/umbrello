// Optional real-browser checks for Read → Books. Mocks Telegram and the Worker; no credentials,
// no Storage. Uses a locally prepared book (ignored by Git). Requires Playwright and Chrome.
//   node tools/check-books-browser.cjs [--book output/woman-in-the-dunes/book.json] [--playwright-path …]
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
const argument = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const { chromium } = require(argument('--playwright-path', 'playwright'));
const root = path.resolve(__dirname, '..');
const bookFile = path.resolve(root, argument('--book', 'output/woman-in-the-dunes/book.json'));
const bookBytes = fs.readFileSync(bookFile, 'utf8');
const book = JSON.parse(bookBytes);
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'umbrello-books-browser-'));
const initData = 'query_id=test&user=%7B%22id%22%3A555%7D&auth_date=1&hash=' + '0'.repeat(64);
const telegram = (data) => `window.Telegram={WebApp:{initData:${JSON.stringify(data)},ready(){},expand(){},
  BackButton:{show(){window.backShown=true},hide(){},onClick(f){window.backHandler=f}},HapticFeedback:{notificationOccurred(){}}}};`;
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
const entry = { bookId: book.bookId, title: book.title, author: book.author };
const firstPage = new Map();
book.pages.forEach((page, index) => { if (!firstPage.has(page.chapterId)) firstPage.set(page.chapterId, index); });
const chapterTitle = id => book.chapters.find(c => c.id === id).title;
const hostile = '<img src=x onerror="window.hacked=1">';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: argument('--browser', 'chrome') });
  let failures = 0;
  try {
    for (const width of [360, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 740 }, deviceScaleFactor: 1, hasTouch: true });
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://umbrello.test' });
      const calls = [];
      const state = { list: 'ok', book: 'ok', launch: initData, hold: null };
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.href.startsWith('https://telegram.org/js/telegram-web-app.js')) {
          await route.fulfill({ contentType: 'application/javascript', body: telegram(state.launch) }); return;
        }
        if (url.hostname === 'umbrello.valikminak.workers.dev') {
          const body = route.request().postDataJSON();
          calls.push({ route: url.pathname, body });
          assert.equal(body.initData, state.launch);
          const reply = (status, data) => route.fulfill({ status, contentType: 'application/json', body: typeof data === 'string' ? data : JSON.stringify(data) });
          const mode = url.pathname === '/books/list' ? state.list : state.book;
          if (state.hold) await state.hold;
          if (mode === 'forbidden') return reply(403, { error: 'books_forbidden', message: 'Books are available only to the accounts enabled by the owner.', userId: 555 });
          if (mode === 'unconfigured') return reply(503, { error: 'books_not_configured', message: 'Books access is not configured.', userId: 555 });
          if (mode === 'storage') return reply(502, { error: 'books_storage_error', message: '<script>window.hacked=1</script>', providerStatus: 500 });
          if (mode === 'html') return route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad gateway</h1>' });
          if (mode === 'network') return route.abort('failed');
          if (url.pathname === '/books/list') {
            return reply(200, { books: mode === 'empty' ? [] : [entry, { bookId: 'f'.repeat(64), title: hostile, author: null }] });
          }
          if (mode === 'other-id') return reply(200, bookBytes.replace(book.bookId, 'f'.repeat(64)));
          if (mode === 'hostile') {
            const copy = JSON.parse(bookBytes);
            copy.chapters[0].paragraphs[0].sentences[0].text = hostile;
            copy.chapters[0].title = hostile;
            return reply(200, copy);
          }
          return reply(200, bookBytes);
        }
        if (url.origin === 'https://umbrello.test') {
          const relative = decodeURIComponent(url.pathname.slice(1));
          if (!/^(?:[a-z-]+\.html|assets\/(?:css|js)\/[a-z.-]+|users\/(?:index|[a-z]+\/read)\.json)$/.test(relative)) { await route.abort(); return; }
          await route.fulfill({ contentType: mime[path.extname(relative)] || 'text/plain', body: fs.readFileSync(path.join(root, relative)) }); return;
        }
        await route.abort();
      });

      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => { errors.push('dialog: ' + dialog.message()); dialog.dismiss(); });
      const step = async (name, fn) => {
        try { await fn(); console.log(`ok   ${width}px  ${name}`); }
        catch (error) {
          failures++;
          const shown = await page.locator('#app').innerText().catch(() => '');
          console.log(`FAIL ${width}px  ${name}\n     ${error.message.split('\n').join('\n     ')}\n     Page: ${shown.slice(0, 300).replace(/\s+/g, ' ')}`);
        }
      };
      const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'horizontal scroll');
      const shot = name => page.screenshot({ path: path.join(output, `${width}-${name}.png`), fullPage: false });
      const current = () => page.evaluate(() => ({
        number: Number(document.querySelector('#readerPage').dataset.page),
        ids: [...document.querySelectorAll('#readerPage [data-sentence-id]')].map(n => n.dataset.sentenceId),
        paragraphs: [...document.querySelectorAll('#readerPage [data-paragraph-id]')].map(n => n.dataset.paragraphId),
        heading: document.querySelector('#readerPage .chapter-title')?.textContent ?? null,
        chapter: document.querySelector('#chapterTitle').textContent,
        counter: document.querySelector('#pageNumber').textContent,
        scrollY: scrollY,
      }));
      const expectPage = async index => {
        const shown = await current();
        const expected = book.pages[index];
        assert.equal(shown.number, expected.number);
        assert.deepEqual(shown.ids, expected.sentenceIds, `sentences of page ${expected.number}`);
        const paragraphs = [...new Set(expected.sentenceIds.map(id => id.replace(/\.s\d+$/, '')))];
        assert.deepEqual(shown.paragraphs, paragraphs);
        assert.equal(shown.chapter, chapterTitle(expected.chapterId) || '');
        assert.equal(shown.heading, firstPage.get(expected.chapterId) === index ? chapterTitle(expected.chapterId) : null);
        assert.equal(shown.counter, `Page ${expected.number} of ${book.pages.length}`);
        assert.equal(shown.scrollY, 0, 'page starts at the top');
      };
      const openLibrary = async () => {
        await page.goto('https://umbrello.test/books.html?user=me');
        await page.locator('.book-item').first().waitFor();
      };
      const openBook = async () => {
        await openLibrary();
        await page.locator(`.book-item[data-book-id="${book.bookId}"]`).click();
        await page.locator('#readerPage [data-sentence-id]').first().waitFor();
      };

      await step('Read has Learn words and Books tabs; Learn words keeps the existing reader', async () => {
        await page.goto('https://umbrello.test/read.html?user=sophia');
        await page.locator('.story .w').first().waitFor();
        assert.equal(await page.locator('.read-tabs a[aria-current="page"]').textContent(), 'Learn words');
        assert.match(await page.locator('.read-tabs a', { hasText: 'Books' }).getAttribute('href'), /^books\.html\?v=7&user=sophia$/);
        await page.locator('.story .w').first().click();
        await page.locator('#sheet.open').waitFor();
        await noOverflow();
        await page.locator('#backdrop').click();
        await page.locator('.read-tabs a', { hasText: 'Books' }).click();
        await page.waitForURL(/books\.html\?v=7&user=sophia/);
        await page.locator('.book-item').first().waitFor();
        assert.match(await page.locator('.read-tabs a', { hasText: 'Learn words' }).getAttribute('href'), /user=sophia/);
      });

      await step('library lists catalog entries safely, with no horizontal scroll', async () => {
        await openLibrary();
        assert.equal(await page.locator('.book-item').count(), 2);
        assert.equal(await page.locator('.book-item .book-title').nth(1).textContent(), hostile);
        assert.equal(await page.locator('.book-item img').count(), 0);
        assert.equal(await page.locator('.book-item').first().locator('.book-author').textContent(), book.author);
        await noOverflow();
        await shot('library');
      });

      await step('reader shows prepared page 1 with book and chapter titles', async () => {
        await openBook();
        await expectPage(0);
        assert.equal(await page.locator('#bookTitle').textContent(), `${book.title} · ${book.author}`);
        assert.equal(await page.locator('#prevPage').isDisabled(), true);
        assert.equal(await page.locator('.read-tabs').isVisible(), false, 'tabs are hidden while reading');
        await noOverflow();
        await shot('page-1');
      });

      await step('every prepared page renders exactly, Next scrolls to top, no horizontal scroll', async () => {
        const all = width === 360;
        for (let index = 1; index < book.pages.length; index++) {
          if (!all && index > 25) break;
          await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
          await page.locator('#nextPage').click();
          await expectPage(index);
          if (all) await noOverflow();
          const box = await page.locator('#nextPage').boundingBox();
          assert.ok(box.height >= 44 && box.width >= 44, 'touch target size');
        }
        if (all) {
          assert.equal(await page.locator('#nextPage').isDisabled(), true);
          await shot('last-page');
        }
      });

      await step('Previous crosses back from a chapter start to the previous chapter', async () => {
        await openBook();
        const target = firstPage.get(book.chapters[5].id);
        await page.locator('#tocToggle').click();
        await page.locator(`.toc-item[data-chapter-id="${book.chapters[5].id}"]`).click();
        await expectPage(target);
        await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
        await page.locator('#prevPage').click();
        await expectPage(target - 1);
        assert.notEqual(book.pages[target - 1].chapterId, book.pages[target].chapterId);
        await page.keyboard.press('ArrowRight');
        await expectPage(target);
        await page.keyboard.press('ArrowLeft');
        await expectPage(target - 1);
      });

      await step('contents lists every chapter and jumps to its first page', async () => {
        await openBook();
        await page.locator('#tocToggle').click();
        assert.equal(await page.locator('#tocToggle').getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator('#readerPage').isVisible(), false);
        assert.equal(await page.locator('.toc-item').count(), book.chapters.length);
        assert.equal(await page.locator('.toc-item[aria-current="true"]').getAttribute('data-chapter-id'), book.chapters[0].id);
        await noOverflow();
        await shot('contents');
        for (const chapter of [book.chapters[12], book.chapters[book.chapters.length - 1], book.chapters[2]]) {
          if (!(await page.locator('#toc').isVisible())) await page.locator('#tocToggle').click();
          await page.locator(`.toc-item[data-chapter-id="${chapter.id}"]`).scrollIntoViewIfNeeded();
          await page.locator(`.toc-item[data-chapter-id="${chapter.id}"]`).click();
          assert.equal(await page.locator('#toc').isVisible(), false);
          await expectPage(firstPage.get(chapter.id));
        }
        await shot('chapter-start');
      });

      await step('Library button and Telegram Back return to the library, then to the menu', async () => {
        await openBook();
        await page.locator('#toLibrary').click();
        await page.locator('.book-item').first().waitFor();
        assert.equal(await page.locator('.read-tabs').isVisible(), true);
        await page.locator('.book-item').first().click();
        await page.locator('#readerPage [data-sentence-id]').first().waitFor();
        await page.evaluate(() => window.backHandler());
        await page.locator('.book-item').first().waitFor();
        const listCalls = calls.filter(c => c.route === '/books/list').length;
        await page.evaluate(() => window.backHandler());
        await page.waitForURL(/index\.html\?v=7&user=me/);
        assert.equal(calls.filter(c => c.route === '/books/list').length, listCalls, 'library list is reused');
      });

      await step('book text, chapter titles and server messages are rendered as text', async () => {
        state.book = 'hostile';
        await openBook();
        assert.equal(await page.locator('#readerPage [data-sentence-id="c1.p1.s1"]').textContent(), hostile);
        assert.equal(await page.locator('#readerPage .chapter-title').textContent(), hostile);
        assert.equal(await page.locator('#readerPage img').count(), 0);
        state.book = 'storage';
        await openLibrary();
        await page.locator('.book-item').first().click();
        await page.locator('.books-error').waitFor();
        assert.match(await page.locator('#errorMessage').textContent(), /<script>window\.hacked=1<\/script> \[books_storage_error; HTTP 500\]/);
        assert.equal(await page.evaluate(() => window.hacked), undefined);
        state.book = 'ok';
      });

      await step('access errors show the server-verified Telegram ID with Copy ID', async () => {
        for (const mode of ['forbidden', 'unconfigured']) {
          state.list = mode;
          await page.goto('https://umbrello.test/books.html?user=sophia');
          await page.locator('#telegramUserId').waitFor();
          assert.equal(await page.locator('#telegramUserId').textContent(), '555');
          await page.locator('#copyUserId').click();
          await page.getByText('Copied.').waitFor();
          assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '555');
          assert.ok((await page.locator('#copyUserId').boundingBox()).height >= 44);
          await noOverflow();
          if (mode === 'forbidden') await shot('forbidden');
        }
        // Fallback when the Clipboard API is unavailable or rejected.
        await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); });
        await page.locator('#copyUserId').click();
        await page.locator('.user-id-card .status').filter({ hasText: /Copied\.|copy it manually/ }).waitFor();
        state.list = 'ok';
        await page.locator('#errorRetry').click();
        await page.locator('.book-item').first().waitFor();
      });

      await step('other loading errors offer Try again and show no ID', async () => {
        for (const [mode, text] of [['storage', /books_storage_error/], ['html', /did not return a readable answer.*HTTP 502/], ['network', /Could not connect/]]) {
          state.list = mode;
          await page.goto('https://umbrello.test/books.html?user=me');
          await page.locator('#errorMessage').waitFor();
          assert.match(await page.locator('#errorMessage').textContent(), text);
          assert.equal(await page.locator('#telegramUserId').count(), 0);
        }
        state.list = 'empty';
        await page.locator('#errorRetry').click();
        await page.getByText('No books in your library yet.').waitFor();
        state.list = 'ok';
      });

      await step('book loading failures stay in the reader with retry and a way back', async () => {
        for (const mode of ['network', 'other-id', 'forbidden']) {
          state.book = mode;
          await openLibrary();
          await page.locator('.book-item').first().click();
          await page.locator('.books-error').waitFor();
          if (mode === 'other-id') assert.match(await page.locator('#errorMessage').textContent(), /bookId/);
          if (mode === 'forbidden') assert.equal(await page.locator('#telegramUserId').textContent(), '555');
          await noOverflow();
        }
        state.book = 'ok';
        await page.locator('#errorRetry').click();
        await page.locator('#readerPage [data-sentence-id]').first().waitFor();
        await expectPage(0);
        state.book = 'network';
        await page.locator('#toLibrary').click();
        await page.locator('.book-item').first().click();
        await page.locator('#errorLibrary').click();
        await page.locator('.book-item').first().waitFor();
        state.book = 'ok';
      });

      await step('returning to the library while a book loads ignores the late response', async () => {
        let release;
        state.hold = new Promise(resolve => { release = resolve; });
        await page.goto('https://umbrello.test/books.html?user=me');
        await page.waitForTimeout(50);
        release(); state.hold = null;
        await page.locator('.book-item').first().waitFor();
        state.hold = new Promise(resolve => { release = resolve; });
        await page.locator('.book-item').first().click();
        await page.locator('#loadingLibrary').click();
        await page.locator('.book-item').first().waitFor();
        release(); state.hold = null;
        await page.waitForTimeout(300);
        assert.equal(await page.locator('#readerPage').count(), 0);
        assert.equal(await page.locator('.book-item').count(), 2);
      });

      await step('without Telegram launch data no request is sent', async () => {
        state.launch = '';
        const before = calls.length;
        await page.goto('https://umbrello.test/books.html?user=me');
        await page.getByText('Open Umbrello from Telegram to read books.').waitFor();
        assert.equal(calls.length, before);
        assert.equal(await page.locator('#errorRetry').count(), 0);
        state.launch = initData;
      });

      await step('no page errors or dialogs', async () => assert.deepEqual(errors, []));
      await context.close();
    }
  } finally { await browser.close(); }
  console.log(`Screenshots: ${output}`);
  if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
})().catch(error => { console.error(error); process.exit(1); });
