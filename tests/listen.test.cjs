const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { words, videoId, validateLesson, shuffledTokens } = require('../listen-core.js');

const sample = () => ({ title: 'Example', youtube: 'hT_nvWreIhg', segments: [
  { start: 0, end: 4, text: 'We learn and we listen.' },
  { start: 5.5, end: 10.2, text: 'Try another phrase.' }
] });

test('YouTube links support playlist parameters, short links and embed URLs', () => {
  for (const url of [
    'hT_nvWreIhg',
    'https://www.youtube.com/watch?v=hT_nvWreIhg&list=RDhT_nvWreIhg&start_radio=1',
    'https://youtu.be/hT_nvWreIhg?t=4',
    'https://www.youtube.com/embed/hT_nvWreIhg',
    'https://m.youtube.com/watch?v=hT_nvWreIhg'
  ]) assert.equal(videoId(url), 'hT_nvWreIhg');
  for (const bad of ['https://example.com/watch?v=hT_nvWreIhg', 'javascript:alert(1)', null, 'invalid']) {
    assert.throws(() => videoId(bad));
  }
});

test('tokenization handles punctuation, contractions and repeated words', () => {
  assert.deepEqual(words('“We’re here,” she said. We’re here!'), ["We're", 'here', 'she', 'said', "We're", 'here']);
  assert.deepEqual(validateLesson(sample()).segments[0].words, ['we', 'learn', 'and', 'we', 'listen']);
  assert.deepEqual(words("I'm goin' and she's dreamin’"), ["I'm", "goin'", 'and', "she's", "dreamin'"]);
});

test('rejects missing, negative, overlapping, nonnumeric or backwards timings', () => {
  for (const segment of [
    { start: -1, end: 4, text: 'hello' },
    { start: 4, end: 4, text: 'hello' },
    { start: 4, end: 2, text: 'hello' },
    { start: '0', end: 4, text: 'hello' },
    { start: 0, end: Infinity, text: 'hello' },
    { start: 0, end: 4, text: '…' },
    null
  ]) assert.throws(() => validateLesson({ ...sample(), segments: [segment] }));
  const overlap = sample();
  overlap.segments[1].start = 3;
  assert.throws(() => validateLesson(overlap));
  assert.throws(() => validateLesson({ ...sample(), segments: [] }));
  assert.equal(validateLesson(sample()).segments.length, 2);
});

test('shuffle keeps unique button identities and avoids revealing the answer', () => {
  const original = ['we', 'learn', 'and', 'we', 'listen'];
  for (const random of [() => 0, () => 0.999, Math.random]) {
    const tokens = shuffledTokens(original, random);
    assert.equal(new Set(tokens.map(t => t.id)).size, original.length);
    assert.deepEqual(tokens.map(t => t.word).sort(), [...original].sort());
    assert.notDeepEqual(tokens.map(t => t.word), original);
  }
  assert.deepEqual(shuffledTokens(['go', 'go']).map(t => t.word), ['go', 'go']);
});

test('all catalog entries resolve to valid lessons with unique IDs', () => {
  const root = path.join(__dirname, '..');
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'listen.json')));
  assert.equal(new Set(catalog.map(item => item.id)).size, catalog.length);
  for (const entry of catalog) validateLesson(JSON.parse(fs.readFileSync(path.join(root, entry.file))));
});

// Exercise controller transitions with an in-memory player. This verifies app
// logic, not actual YouTube/Telegram compatibility (checked separately).
async function controller() {
  const vm = require('node:vm');
  const nodes = new Map(), intervals = new Map(), events = {};
  let timerId = 0;
  class Element {
    constructor() {
      this.children = []; this.hidden = false; this.disabled = false;
      this.textContent = ''; this.style = {};
      this.classList = { add() {}, remove() {} };
    }
    set innerHTML(html) {
      for (const match of html.matchAll(/id="([^"]+)"/g)) nodes.set(match[1], new Element());
    }
    replaceChildren() { this.children = []; }
    append(child) { this.children.push(child); }
  }
  nodes.set('listenApp', new Element());
  const document = {
    hidden: false, head: new Element(),
    getElementById: id => nodes.get(id), createElement: () => new Element(),
    addEventListener: (name, callback) => { events[name] = callback; }
  };
  let player;
  class Player {
    constructor(id, options) { this.events = options.events; this.time = 0; this.loads = []; player = this; }
    cueVideoById() {}
    pauseVideo() { this.paused = true; }
    loadVideoById(clip) { this.loads.push(clip); this.time = clip.startSeconds; this.paused = false; }
    getCurrentTime() { return this.time; }
    state(data) { this.events.onStateChange({ data }); }
  }
  const context = {
    window: { addEventListener() {} }, document, URLSearchParams,
    location: { search: '?lesson=example', origin: 'http://localhost', reload() {} },
    ListenCore: require('../listen-core.js'), YT: { Player, PlayerState: { PLAYING: 1, ENDED: 0, PAUSED: 2, BUFFERING: 3 } },
    loadJSON: async file => file === 'listen.json' ? [{ id: 'example', file: 'example.json' }] : sample(),
    backTo() {}, esc: value => String(value), vibrate() {}, showError: (_, e) => { throw e; },
    setTimeout: () => ++timerId, clearTimeout() {},
    setInterval: callback => { const id = ++timerId; intervals.set(id, callback); return id; },
    clearInterval: id => intervals.delete(id)
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../listen.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  context.window.onYouTubeIframeAPIReady();
  player.events.onReady();
  const node = id => nodes.get(id);
  const click = id => { assert.equal(node(id).disabled, false); node(id).onclick(); };
  const endClip = () => {
    player.state(1);
    player.time = player.loads.at(-1).endSeconds;
    for (const callback of [...intervals.values()]) callback();
  };
  const choose = word => {
    const matches = node('wordBank').children.filter(button => button.textContent === word && !button.disabled);
    assert.ok(matches.length, `Missing word: ${word}`);
    matches.at(-1).onclick(); // Deliberately choose the second identical word first.
  };
  return { node, click, endClip, choose, player, events, document, intervals };
}

test('play → pause → wrong choice → duplicate words → repeat → next → complete → restart', async () => {
  const app = await controller();
  assert.equal(app.player.loads.length, 0, 'No autoplay on page load');
  app.click('playPhrase');
  app.endClip();
  assert.equal(app.node('puzzle').hidden, false);
  assert.equal(app.player.paused, true);
  app.choose('listen');
  assert.equal(app.node('answer').textContent, '');
  app.choose('we');
  app.choose('learn');
  app.click('playPhrase');
  assert.equal(app.node('puzzle').hidden, true);
  app.endClip();
  assert.equal(app.node('answer').textContent, '', 'Repeat clears the answer');
  assert.equal(app.node('nextPhrase').hidden, true);
  assert.ok(app.node('wordBank').children.every(button => !button.disabled));
  app.choose('we'); app.choose('learn');
  app.choose('and'); app.choose('we'); app.choose('listen');
  assert.equal(app.node('nextPhrase').hidden, false);
  assert.equal(app.player.loads.length, 2, 'Correct answer does not autoplay');
  app.click('nextPhrase');
  assert.equal(app.player.loads.at(-1).startSeconds, 5.5);
  app.endClip();
  app.choose('try'); app.choose('another'); app.choose('phrase');
  app.click('nextPhrase');
  assert.match(app.node('listenStatus').textContent, /Complete/);
  app.click('playPhrase');
  assert.equal(app.player.loads.at(-1).startSeconds, 0);
  assert.equal(app.node('answer').textContent, '');
});

test('manual pause, backgrounding and native clip end stop playback safely', async () => {
  const app = await controller();
  app.click('playPhrase'); app.player.state(1);
  app.click('pausePhrase'); app.player.state(2);
  assert.equal(app.node('puzzle').hidden, true, 'Do not reveal words before finishing');
  assert.equal(app.node('pausePhrase').hidden, true);
  app.click('playPhrase'); app.player.state(1);
  app.document.hidden = true; app.events.visibilitychange();
  assert.equal(app.player.paused, true);
  assert.equal(app.intervals.size, 0);
  app.click('playPhrase'); app.player.state(1); app.player.state(0);
  assert.equal(app.node('puzzle').hidden, false);
});

test('embedding failure disables playback and offers retry', async () => {
  const app = await controller();
  app.player.events.onError({ data: 150 });
  assert.equal(app.node('playPhrase').disabled, true);
  assert.equal(app.node('retryPlayer').hidden, false);
  assert.match(app.node('listenStatus').textContent, /blocked embedded playback/);
});

test('replaying a solved phrase clears the solution and allows solving again', async () => {
  const app = await controller();
  app.click('playPhrase'); app.endClip();
  for (const word of ['we', 'learn', 'and', 'we', 'listen']) app.choose(word);
  assert.equal(app.node('answer').textContent, 'We learn and we listen.');
  app.click('playPhrase');
  assert.equal(app.node('answer').textContent, '');
  assert.equal(app.node('nextPhrase').hidden, true);
  app.endClip();
  for (const word of ['we', 'learn', 'and', 'we', 'listen']) app.choose(word);
  assert.equal(app.node('nextPhrase').hidden, false);
  assert.equal(app.node('counter').textContent, '1 / 2');
});
