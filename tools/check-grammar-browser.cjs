// Optional real-browser checks. Uses mocked Telegram, Storage and AI; no credentials.
// Build the private Unit 1 package first. Requires Playwright and an installed Chrome.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
const argument = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const { chromium } = require(argument('--playwright-path', 'playwright'));
const root = path.resolve(__dirname, '..');
const unit = JSON.parse(fs.readFileSync(path.join(root, 'private/grammar-upload/unit-001.json'), 'utf8'));
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'umbrello-grammar-browser-'));
const initData = new URLSearchParams({ user: JSON.stringify({ id: 123456, first_name: 'Test learner' }) }).toString();
const telegram = `window.Telegram={WebApp:{initData:${JSON.stringify(initData)},ready(){},expand(){},BackButton:{show(){},hide(){},onClick(){}},HapticFeedback:{notificationOccurred(){}}}};`;
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
const questions = unit.practice.flatMap(section => section.questions);

(async () => {
  const browser = await chromium.launch({ headless: true, channel: argument('--browser', 'chrome') });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await context.addInitScript(() => {
      for (const key of ['localStorage', 'sessionStorage', 'indexedDB']) {
        Object.defineProperty(window, key, { get() { throw new Error(`Grammar must not access ${key}`); } });
      }
      window.testURLs = { created: [], revoked: [] };
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = value => { const url = create(value); window.testURLs.created.push(url); return url; };
      URL.revokeObjectURL = url => { window.testURLs.revoked.push(url); revoke(url); };
    });
    const calls = [], errors = [];
    let failUnit = false, failCheck = false, holdCheck = null;
    let checkWait = null;
    const audioWaits = new Map();
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.href.startsWith('https://telegram.org/js/telegram-web-app.js')) {
        await route.fulfill({ contentType: 'application/javascript', body: telegram }); return;
      }
      if (url.hostname === 'umbrello.valikminak.workers.dev' && url.pathname.startsWith('/grammar/')) {
        const body = route.request().postDataJSON(); calls.push({ route: url.pathname, body });
        assert.equal(body.initData, initData);
        if (url.pathname === '/grammar/unit') {
          await route.fulfill({ status: failUnit ? 503 : 200, contentType: 'application/json', body: JSON.stringify(failUnit ? { error: 'grammar_not_configured', message: '<script>private diagnostic</script>' } : unit) }); return;
        }
        if (url.pathname === '/grammar/audio') {
          if (audioWaits.has(body.path)) await audioWaits.get(body.path);
          const bytes = fs.readFileSync(path.join(root, 'private/grammar-upload', body.path));
          await route.fulfill({ contentType: 'audio/mpeg', body: bytes }); return;
        }
        if (url.pathname === '/grammar/check') {
          if (checkWait) await checkWait;
          await route.fulfill({ status: failCheck ? 502 : 200, contentType: 'application/json', body: JSON.stringify(failCheck ? { error: 'provider_unavailable' } : {
            summary: 'The text is clear. <img src=x onerror=alert(1)>', errors: [],
            targetFeedback: 'You used a state and an activity.', improvedVersion: body.text,
          }) }); return;
        }
        throw new Error(`Unexpected grammar route: ${url.pathname}`);
      }
      if (url.origin === 'http://umbrello.test') {
        const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
        if (!/^(?:[a-z-]+\.html|assets\/(?:css|js)\/[a-z.-]+|users\/index\.json)$/.test(relative)) { await route.abort(); return; }
        const file = path.join(root, relative);
        await route.fulfill({ contentType: mime[path.extname(file)] || 'text/plain', body: fs.readFileSync(file) }); return;
      }
      await route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const tab = name => page.locator(`[data-step="${name}"]`);
    const step = async name => { await tab(name).click(); };
    const answer = async q => {
      if (q.type === 'gap') await page.locator('#grammarAnswer').fill(q.answers[0]);
      else for (const option of q.options.filter(o => o.correct)) await page.locator(`input[name="choice"][value="${option.id}"]`).check();
      await page.locator('#answerForm button[type="submit"]').click();
      await page.locator('.grammar-result.correct').waitFor();
    };
    const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    // Me-only menu and the direct-link profile gate.
    await page.goto('http://umbrello.test/index.html?user=me');
    await page.locator('a[href*="grammar.html"]').waitFor();
    await page.goto('http://umbrello.test/index.html?user=sophia');
    await page.locator('.menu').waitFor();
    assert.equal(await page.locator('a[href*="grammar.html"]').count(), 0);
    await page.goto('http://umbrello.test/grammar.html?user=sophia');
    await page.getByText('Grammar is currently available in the me profile.').waitFor();
    assert.equal(calls.length, 0);

    // Safe setup error and the account ID can be read without another bot.
    failUnit = true;
    await page.goto('http://umbrello.test/grammar.html?user=me');
    await page.locator('#openUnit').click();
    await page.getByText('Connection help').waitFor();
    await page.getByText('Connection help').click();
    assert.match(await page.locator('#app').innerText(), /123456/);
    assert.doesNotMatch(await page.locator('#app').innerHTML(), /private diagnostic/);
    failUnit = false;
    await page.locator('#openUnit').click();
    await page.locator('#startPractice').waitFor();
    await noOverflow();
    await page.screenshot({ path: path.join(output, 'learn.png'), fullPage: true });
    assert.equal(calls.filter(c => c.route === '/grammar/check').length, 0);

    // A draft stays while switching tabs, and a revealed answer is not a first-try success.
    await page.locator('#startPractice').click();
    await page.locator('#grammarAnswer').fill('unfinished');
    await step('learn'); await step('practice');
    assert.equal(await page.locator('#grammarAnswer').inputValue(), 'unfinished');
    await page.locator('#answerForm button').click();
    await page.locator('#revealAnswer').click();
    assert.match(await page.locator('.grammar-result').innerText(), /Answer revealed/);
    await page.locator('#nextQuestion').click();
    for (const q of questions.slice(1)) {
      if (q.type === 'choice' && q.options.every(o => o.correct)) {
        await page.locator(`input[name="choice"][value="${q.options[0].id}"]`).check();
        await page.locator('#answerForm button').click();
        assert.equal(await page.locator('#nextQuestion').isDisabled(), true);
      }
      await answer(q);
      if (q.id === 'u1-e2-q2') {
        await noOverflow();
        await page.screenshot({ path: path.join(output, 'practice.png'), fullPage: true });
      }
      await page.locator('#nextQuestion').click();
    }
    await page.getByRole('heading', { name: 'Practice complete', exact: true }).waitFor();
    assert.equal(calls.filter(c => c.route === '/grammar/check').length, 0);

    // Real MP3 decoding from Blob, and slower playback.
    await step('listen');
    await page.locator('[data-play]').click();
    await page.waitForFunction(() => { const audio = document.querySelector('audio'); return audio && audio.readyState >= 2 && audio.duration > 0; });
    await page.locator('.grammar-audio select').selectOption('0.75');
    assert.equal(await page.locator('audio').evaluate(audio => audio.playbackRate), 0.75);
    await page.screenshot({ path: path.join(output, 'listen.png'), fullPage: true });
    for (const id of unit.listening.questionIds) { await answer(questions.find(q => q.id === id)); await page.locator('#nextQuestion').click(); }
    await page.getByRole('heading', { name: 'Listen complete', exact: true }).waitFor();

    // Failed AI requests retain writing; editing removes stale feedback.
    await step('write');
    const draft = 'I have a small office. This week I am thinking about a new project.';
    await page.locator('#grammarWriting').fill(draft);
    failCheck = true;
    await page.locator('#checkWriting').click();
    await page.getByText(/Writing feedback is temporarily unavailable/).waitFor();
    assert.equal(await page.locator('#grammarWriting').inputValue(), draft);
    failCheck = false;
    await page.locator('#checkWriting').click();
    await page.getByRole('heading', { name: 'Your feedback', exact: true }).waitFor();
    assert.equal(await page.locator('#writingFeedback img').count(), 0);
    assert.match(await page.locator('#writingFeedback').innerText(), /<img/);
    assert.equal(await page.locator('.grammar-model').getAttribute('open'), null);
    await noOverflow();
    await page.screenshot({ path: path.join(output, 'write.png'), fullPage: true });
    await page.locator('#grammarWriting').fill(draft + ' I prefer working quietly.');
    assert.equal(await page.locator('#writingFeedback').innerText(), '');

    // A background writing check updates the current review summary when it finishes.
    checkWait = new Promise(resolve => { holdCheck = resolve; });
    await page.locator('#checkWriting').click();
    await step('review');
    for (const q of unit.review) { await answer(q); await page.locator('#nextQuestion').click(); }
    await page.getByRole('heading', { name: 'Review complete', exact: true }).waitFor();
    holdCheck(); checkWait = null;
    await page.getByRole('heading', { name: 'Unit complete for today', exact: true }).waitFor();
    assert.match(await tab('write').innerText(), /Reviewed/);
    await noOverflow();

    // Last play wins even when an older request resolves late; one Blob per path.
    await step('practice');
    await page.locator('#reviewStep').click();
    await page.locator('.grammar-example-toggle summary').click();
    const examples = page.locator('.grammar-example-toggle [data-audio]');
    const firstPath = await examples.nth(0).getAttribute('data-audio');
    let releaseAudio;
    audioWaits.set(firstPath, new Promise(resolve => { releaseAudio = resolve; }));
    await examples.nth(0).locator('[data-play]').click();
    await examples.nth(1).locator('[data-play]').click();
    await page.waitForFunction(() => { const a = document.querySelectorAll('.grammar-example-toggle audio')[1]; return a && !a.paused; });
    releaseAudio(); audioWaits.delete(firstPath);
    await examples.nth(0).locator('.status').getByText('Recording ready. Press play to listen.').waitFor();
    assert.equal(await examples.nth(0).locator('audio').evaluate(a => a.paused), true);
    await examples.nth(0).locator('[data-play]').click();
    await page.waitForFunction(() => { const a = document.querySelectorAll('.grammar-example-toggle audio')[0]; return a && !a.paused; });
    assert.equal(await examples.nth(1).locator('audio').evaluate(a => a.paused), true);
    const uniqueAudio = new Set(calls.filter(c => c.route === '/grammar/audio').map(c => c.body.path));
    assert.equal(await page.evaluate(() => window.testURLs.created.length), uniqueAudio.size);

    // Page exit clears Blobs; reload clears all answers and text. Narrow layout stays usable.
    await page.evaluate(() => dispatchEvent(new Event('pagehide')));
    assert.equal(await page.evaluate(() => window.testURLs.created.length === window.testURLs.revoked.length), true);
    await page.reload();
    await page.locator('#startPractice').waitFor();
    await step('write');
    assert.equal(await page.locator('#grammarWriting').inputValue(), '');
    await step('practice');
    assert.equal(await page.locator('#grammarAnswer').inputValue(), '');
    assert.match(await tab('practice').innerText(), /0 \/ 20/);
    await page.setViewportSize({ width: 320, height: 720 });
    await noOverflow();
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: path.join(output, 'mobile-dark.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, tested: 'Full unit flow, profile gate, setup error, local marking, MP3 playback, AI failure/success, async tab switching, audio races, stateless reload, 320px layout', screenshots: output, apiCalls: calls.length }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
