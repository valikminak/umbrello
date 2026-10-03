const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { words, normalize, validateLesson, shuffledTokens } = require('../listen-core.js');

const sample = () => ({ title: 'Example', video: 'https://media.example.com/counting-stars.mp4', segments: [
  { start: 0.131, end: 4.125, text: 'We learn and we listen.' },
  { start: 6.5, end: 10.275, text: 'Try another phrase.' }
] });

test('accepts a native video file path or direct URL without YouTube configuration', () => {
  for (const video of ['media/counting-stars.mp4', 'https://media.example.com/song.mp4', '/media/song.webm']) {
    assert.equal(validateLesson({ ...sample(), video }).video, video);
  }
  for (const video of ['', null, 'javascript:alert(1)', 'data:video/mp4;base64,AA==']) {
    assert.throws(() => validateLesson({ ...sample(), video }));
  }
  assert.throws(() => validateLesson({ ...sample(), title: '' }));
});

test('tokenization preserves display case, contractions and repeated words', () => {
  assert.deepEqual(words('“We’re here,” she said. We’re here!'), ["We're", 'here', 'she', 'said', "We're", 'here']);
  assert.deepEqual(validateLesson(sample()).segments[0].words, ['We', 'learn', 'and', 'we', 'listen']);
  assert.deepEqual(words("I've been, I've been losing sleep"), ["I've", 'been', "I've", 'been', 'losing', 'sleep']);
  assert.deepEqual(words("I'm goin' and she's dreamin’"), ["I'm", "goin'", 'and', "she's", "dreamin'"]);
  assert.equal(normalize('I’VE'), normalize("I've"));
  assert.equal(normalize('We'), normalize('we'));
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
  overlap.segments[1].start = 4.124;
  assert.throws(() => validateLesson(overlap));
  assert.throws(() => validateLesson({ ...sample(), segments: [] }));
  const lesson = validateLesson(sample());
  assert.equal(lesson.segments[0].start, 0.131);
  assert.equal(lesson.segments[0].end, 4.125);
  assert.equal(lesson.segments[1].start, 6.5);
});

test('shuffle keeps duplicate button identities without revealing the answer', () => {
  const original = ['We', 'learn', 'and', 'we', 'listen'];
  for (const random of [() => 0, () => 0.999, Math.random]) {
    const tokens = shuffledTokens(original, random);
    assert.equal(new Set(tokens.map(t => t.id)).size, original.length);
    assert.deepEqual(tokens.map(t => t.word).sort(), [...original].sort());
    assert.notDeepEqual(tokens.map(t => normalize(t.word)), original.map(normalize));
  }
  assert.deepEqual(shuffledTokens(['go', 'go']).map(t => t.word), ['go', 'go']);
});

test('Ukrainian translations are optional trimmed text and do not change English words', () => {
  const lesson = sample();
  lesson.segments[0].translationUk = '  Ми вчимося й слухаємо.  ';
  const validated = validateLesson(lesson);
  assert.equal(validated.segments[0].translationUk, 'Ми вчимося й слухаємо.');
  assert.equal(validated.segments[1].translationUk, '');
  assert.deepEqual(validated.segments[0].words, words(lesson.segments[0].text));
  lesson.segments[0].translationUk = '   ';
  assert.equal(validateLesson(lesson).segments[0].translationUk, '');
  for (const value of [42, null, {}, []]) {
    lesson.segments[0].translationUk = value;
    assert.throws(() => validateLesson(lesson), /phrase 1: translationUk must be text/);
  }
});

test('catalog lessons have valid manual timings and Ukrainian translations for every phrase', () => {
  const root = path.join(__dirname, '..');
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'listen.json')));
  assert.equal(new Set(catalog.map(item => item.id)).size, catalog.length);
  for (const entry of catalog) validateLesson(JSON.parse(fs.readFileSync(path.join(root, entry.file))));
  const song = validateLesson(JSON.parse(fs.readFileSync(path.join(root, 'listen/counting-stars.json'))));
  assert.ok(song.segments.every(segment => /[А-Яа-яІіЇїЄєҐґ]/u.test(segment.translationUk)));
  const translations = new Map();
  for (const segment of song.segments) {
    if (translations.has(segment.text)) assert.equal(segment.translationUk, translations.get(segment.text));
    translations.set(segment.text, segment.translationUk);
  }
  assert.match(song.segments[0].text, /I've been/);
  assert.ok(song.segments.every(segment => !/\bI been\b/.test(segment.text)));
});

// The mock advances media time without invoking its public setter. Recorded
// assignments therefore detect accidental seeks or src reloads between phrases.
// Browser playback/codec support is verified separately with the real video.
async function controller({ lesson = sample(), storage = new Map(), storageBlocked = false } = {}) {
  const nodes = new Map();
  const intervals = new Map();
  const frames = new Map();
  const timeouts = new Map();
  const events = new Map();
  let timerId = 0;
  class Element {
    constructor() {
      this.children = []; this.hidden = false; this.disabled = false; this.checked = false;
      this.textContent = ''; this.style = {}; this.listeners = new Map();
      this.classList = { add() {}, remove() {}, toggle() {} };
    }
    set innerHTML(html) {
      this.html = html;
      for (const match of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
        const element = match[1] === 'video' ? new Video() : new Element();
        element.hidden = /\bhidden\b/.test(match[2]);
        element.disabled = /\bdisabled\b/.test(match[2]);
        nodes.set(match[3], element);
      }
    }
    get innerHTML() { return this.html || ''; }
    replaceChildren(...children) { this.children = children; }
    append(...children) { this.children.push(...children); }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, callback) {
      const callbacks = this.listeners.get(name) || [];
      callbacks.push(callback); this.listeners.set(name, callbacks);
    }
    emit(name) {
      this['on' + name]?.({ target: this });
      for (const callback of this.listeners.get(name) || []) callback({ target: this });
    }
    insertAdjacentHTML() {}
  }
  class Video extends Element {
    constructor() {
      super(); this.time = 0; this.paused = true; this.ended = false;
      this.duration = 13; this.readyState = 4; this.seeks = [];
      this.sources = []; this.playCalls = 0; this.loadCalls = 0;
      this.rejectNextPlay = false; this.deferPauseEvents = false; this.pendingPauseEvents = [];
    }
    set src(value) { this.sources.push(value); this.source = value; }
    get src() { return this.source; }
    set currentTime(value) { this.seeks.push(value); this.time = value; this.ended = false; }
    get currentTime() { return this.time; }
    play() {
      this.playCalls++;
      if (this.rejectNextPlay) {
        this.rejectNextPlay = false;
        return Promise.reject(Object.assign(new Error('A tap is required'), { name: 'NotAllowedError' }));
      }
      this.paused = false;
      this.emit('play'); this.emit('playing');
      return Promise.resolve();
    }
    pause() {
      const wasPlaying = !this.paused;
      this.paused = true;
      if (wasPlaying) {
        if (this.deferPauseEvents) this.pendingPauseEvents.push(() => this.emit('pause'));
        else this.emit('pause');
      }
    }
    load() { this.loadCalls++; }
  }
  nodes.set('listenApp', new Element());
  const document = {
    hidden: false,
    getElementById: id => nodes.get(id), createElement: () => new Element(),
    addEventListener: (name, callback) => { events.set(name, callback); }
  };
  const context = {
    window: { addEventListener: (name, callback) => events.set(name, callback) },
    document, URLSearchParams, URL, console,
    location: { search: '?lesson=example', origin: 'http://localhost', reload() {} },
    ListenCore: require('../listen-core.js'),
    loadJSON: async file => file === 'listen.json' ? [{ id: 'example', file: 'example.json' }] : lesson,
    localStorage: {
      getItem(key) { if (storageBlocked) throw new Error('Storage unavailable'); return storage.get(key) ?? null; },
      setItem(key, value) { if (storageBlocked) throw new Error('Storage unavailable'); storage.set(key, value); }
    },
    backTo() {}, esc: value => String(value), vibrate() {}, showError: (_, e) => { throw e; },
    setTimeout: callback => { const id = ++timerId; timeouts.set(id, callback); return id; },
    clearTimeout: id => timeouts.delete(id),
    setInterval: callback => { const id = ++timerId; intervals.set(id, callback); return id; },
    clearInterval: id => intervals.delete(id),
    requestAnimationFrame: callback => { const id = ++timerId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id)
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../listen.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const video = [...nodes.values()].find(node => node instanceof Video);
  assert.ok(video, 'Lesson uses a native video element');
  video.emit('loadedmetadata'); video.emit('canplay');
  const node = id => {
    assert.ok(nodes.has(id), `Missing element ${id}`);
    return nodes.get(id);
  };
  const click = id => {
    const button = node(id);
    assert.equal(button.disabled, false, `${id} is enabled`);
    assert.equal(button.hidden, false, `${id} is visible`);
    button.emit('click');
  };
  const tick = time => {
    video.time = time;
    video.emit('timeupdate');
    for (const callback of [...intervals.values()]) callback();
    const pendingFrames = [...frames.values()]; frames.clear();
    for (const callback of pendingFrames) callback();
  };
  const choose = word => {
    const matches = node('wordBank').children.filter(button =>
      normalize(button.textContent) === normalize(word) && !button.disabled);
    assert.ok(matches.length, `Missing word: ${word}`);
    // Pick the later duplicate first, including a differently capitalized one.
    matches.at(-1).emit('click');
  };
  const solveFirst = () => ['we', 'learn', 'and', 'we', 'listen'].forEach(choose);
  const solveSecond = () => ['try', 'another', 'phrase'].forEach(choose);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { node, nodes, click, tick, choose, solveFirst, solveSecond,
    video, document, events, intervals, frames, timeouts, flush };
}

test('translation toggle preserves answers, follows phrases and clears on Repeat and completion', async () => {
  const lesson = sample();
  lesson.segments[0].translationUk = 'Ми вчимося й слухаємо.';
  lesson.segments[1].translationUk = 'Спробуй іншу фразу.';
  const app = await controller({ lesson });
  const hint = app.node('phraseTranslation');
  const toggle = app.node('translationToggle');
  assert.equal(toggle.checked, false);
  app.click('playPhrase'); app.tick(4.125);
  assert.equal(hint.hidden, true);
  app.choose('we');
  const bank = [...app.node('wordBank').children];
  toggle.checked = true; toggle.emit('change');
  assert.equal(hint.hidden, false);
  assert.equal(hint.textContent, lesson.segments[0].translationUk);
  toggle.checked = false; toggle.emit('change');
  assert.equal(hint.hidden, true);
  assert.equal(hint.textContent, '');
  assert.equal(app.node('answer').textContent, 'We');
  assert.deepEqual(app.node('wordBank').children, bank);
  assert.equal(app.video.playCalls, 1);
  assert.deepEqual(app.video.seeks, []);
  toggle.checked = true; toggle.emit('change');
  app.click('repeatPhrase');
  assert.equal(hint.hidden, true);
  assert.equal(hint.textContent, '');
  app.tick(4.125);
  assert.equal(hint.textContent, lesson.segments[0].translationUk);
  app.solveFirst();
  assert.equal(hint.hidden, true);
  assert.equal(hint.textContent, '');
  app.tick(10.275);
  assert.equal(hint.textContent, lesson.segments[1].translationUk);
  app.solveSecond();
  app.video.ended = true; app.video.paused = true; app.video.emit('ended');
  assert.equal(hint.hidden, true);
  app.click('playPhrase'); app.tick(4.125);
  assert.equal(hint.textContent, lesson.segments[0].translationUk);
});

test('translation preference persists and missing translations never reuse a previous hint', async () => {
  const lesson = sample();
  lesson.segments[0].translationUk = 'Ми вчимося й слухаємо.';
  const storage = new Map();
  const first = await controller({ lesson, storage });
  first.node('translationToggle').checked = true;
  first.node('translationToggle').emit('change');
  const app = await controller({ lesson, storage });
  assert.equal(app.node('translationToggle').checked, true);
  assert.equal(app.node('phraseTranslation').hidden, true);
  app.click('playPhrase'); app.tick(4.125);
  assert.equal(app.node('phraseTranslation').hidden, false);
  app.solveFirst(); app.tick(10.275);
  assert.equal(app.node('phraseTranslation').hidden, true);
  assert.equal(app.node('phraseTranslation').textContent, '');
  app.node('translationToggle').checked = false;
  app.node('translationToggle').emit('change');
  const next = await controller({ lesson, storage });
  assert.equal(next.node('translationToggle').checked, false);
});

test('translation works when browser storage is unavailable', async () => {
  const lesson = sample();
  lesson.segments[0].translationUk = 'Ми вчимося й слухаємо.';
  const app = await controller({ lesson, storageBlocked: true });
  app.click('playPhrase'); app.tick(4.125);
  app.node('translationToggle').checked = true;
  app.node('translationToggle').emit('change');
  assert.equal(app.node('phraseTranslation').textContent, lesson.segments[0].translationUk);
  assert.equal(app.node('phraseTranslation').hidden, false);
  app.solveFirst();
  assert.equal(app.video.paused, false);
});

test('one source plays from zero through all gaps and the outro without seeking', async () => {
  const app = await controller();
  assert.deepEqual(app.video.sources, [sample().video]);
  assert.equal(app.video.playCalls, 0, 'Page load never starts playback');
  assert.equal(app.video.currentTime, 0, 'Keep the intro before the first lyric');
  assert.deepEqual(app.video.seeks, []);
  app.click('playPhrase');
  assert.equal(app.video.paused, false);
  app.tick(4.124);
  assert.equal(app.video.paused, false, 'Do not round fractional phrase ends down');
  app.tick(4.125);
  assert.equal(app.video.paused, true);
  assert.equal(app.node('puzzle').hidden, false);

  app.choose('listen');
  assert.equal(app.node('answer').textContent, '', 'Wrong words never advance the answer');
  assert.equal(app.video.playCalls, 1);
  app.solveFirst();
  // Deliberately no promise/timer flush: play must happen within the last click.
  assert.equal(app.video.playCalls, 2, 'The final correct word immediately resumes playback');
  assert.equal(app.video.paused, false);
  assert.equal(app.video.currentTime, 4.125, 'Continue where playback paused');
  assert.equal(app.node('puzzle').hidden, true);
  assert.equal(app.node('counter').textContent, '2 / 2');
  assert.equal(app.nodes.has('nextPhrase'), false, 'No extra Next button');
  app.tick(5);
  assert.equal(app.video.paused, false, 'Play the instrumental gap before the next lyric');
  app.tick(10.274);
  assert.equal(app.video.paused, false);
  app.tick(10.275);
  assert.equal(app.video.paused, true);
  app.solveSecond();
  assert.equal(app.video.playCalls, 3);
  assert.equal(app.video.paused, false, 'The final answer resumes the outro');
  app.tick(12.9);
  assert.equal(app.video.paused, false, 'Do not finish while the outro is still playing');
  assert.deepEqual(app.video.seeks, [], 'Only user-requested Repeat/restart may seek');
  assert.deepEqual(app.video.sources, [sample().video], 'Do not reload the source between phrases');
  assert.equal(app.video.loadCalls, 0, 'Normal playback never calls load()');

  app.video.time = app.video.duration;
  app.video.ended = true; app.video.paused = true; app.video.emit('ended');
  assert.equal(app.node('playPhrase').hidden, false, 'Show restart after the real video ends');
  app.click('playPhrase');
  assert.deepEqual(app.video.seeks, [0], 'Explicit restart rewinds to zero');
  assert.equal(app.video.playCalls, 4);
  assert.equal(app.node('counter').textContent, '1 / 2');
  assert.deepEqual(app.video.sources, [sample().video]);
});

test('case-different duplicate tokens are interchangeable and each is consumed once', async () => {
  const app = await controller();
  app.click('playPhrase'); app.tick(4.125);
  const bank = () => app.node('wordBank').children;
  assert.ok(bank().some(button => button.textContent === 'We'), 'Keep written case on buttons');
  const lowercase = bank().find(button => button.textContent === 'we');
  lowercase.emit('click');
  assert.equal(app.node('answer').textContent, 'We',
    'A lowercase duplicate is valid while preserving the sentence capitalization');
  lowercase.emit('click');
  assert.equal(words(app.node('answer').textContent).length, 1, 'Used tokens cannot be selected twice');
  app.choose('learn'); app.choose('and'); app.choose('We'); app.choose('listen');
  assert.equal(app.video.playCalls, 2);
  assert.equal(app.video.paused, false);
});

test('Repeat explicitly rewinds the current phrase and clears every selected word', async () => {
  const app = await controller();
  app.click('playPhrase'); app.tick(4.125);
  app.choose('we'); app.choose('learn');
  assert.equal(words(app.node('answer').textContent).length, 2);
  app.click('repeatPhrase');
  assert.deepEqual(app.video.seeks, [0.131]);
  assert.equal(app.node('answer').textContent, '');
  assert.equal(app.node('puzzle').hidden, true);
  app.video.emit('seeked');
  assert.equal(app.video.paused, false);
  app.tick(4.125);
  assert.ok(app.node('wordBank').children.every(button => !button.disabled));
  app.solveFirst();
  app.tick(10.275);
  app.choose('try');
  app.click('repeatPhrase');
  assert.deepEqual(app.video.seeks, [0.131, 6.5]);
  assert.equal(app.node('answer').textContent, '');
  app.video.emit('seeked'); app.tick(10.275); app.solveSecond();
  assert.equal(app.video.paused, false);
  assert.deepEqual(app.video.sources, [sample().video]);
});

test('play rejection offers an explicit retry without resetting progress or seeking', async () => {
  const app = await controller();
  app.video.rejectNextPlay = true;
  app.click('playPhrase');
  await app.flush();
  assert.equal(app.video.paused, true);
  assert.equal(app.node('playPhrase').hidden, false);
  app.click('playPhrase');
  assert.equal(app.video.paused, false);
  app.tick(4.125);
  app.video.rejectNextPlay = true;
  app.solveFirst();
  assert.equal(app.video.playCalls, 3, 'Try continuing in the word-click gesture');
  await app.flush();
  assert.equal(app.video.paused, true);
  assert.equal(app.node('playPhrase').hidden, false);
  app.click('playPhrase');
  assert.equal(app.video.paused, false);
  assert.equal(app.video.currentTime, 4.125);
  app.tick(10.275);
  assert.equal(app.node('puzzle').hidden, false);
  app.solveSecond();
  assert.deepEqual(app.video.seeks, []);
  assert.deepEqual(app.video.sources, [sample().video]);
});

test('backgrounding pauses and explicit resume preserves the current playback position', async () => {
  const app = await controller();
  app.click('playPhrase'); app.tick(1.25);
  app.document.hidden = true;
  app.events.get('visibilitychange')();
  assert.equal(app.video.paused, true);
  assert.equal(app.node('puzzle').hidden, true, 'Do not reveal an unfinished phrase');
  assert.equal(app.frames.size, 0);
  app.document.hidden = false;
  app.events.get('visibilitychange')();
  assert.equal(app.video.paused, true, 'Returning to the page does not autoplay');
  app.click('playPhrase');
  assert.equal(app.video.currentTime, 1.25);
  assert.equal(app.video.paused, false);
  app.tick(4.15);
  assert.equal(app.video.paused, true, 'A delayed frame still catches the boundary');
  assert.equal(app.video.currentTime, 4.15, 'Do not rewind after a late frame');
  app.solveFirst();
  app.events.get('pagehide')();
  assert.equal(app.video.paused, true);
  assert.deepEqual(app.video.seeks, []);
});


test('a queued pause event from Repeat cannot cancel the newly resumed playback', async () => {
  const app = await controller();
  app.video.deferPauseEvents = true;
  app.click('playPhrase'); app.tick(2);
  app.click('repeatPhrase');
  assert.equal(app.video.paused, false);
  for (const event of app.video.pendingPauseEvents.splice(0)) event();
  assert.equal(app.video.paused, false, 'Ignore stale pause events after a newer play request');
  app.tick(4.125);
  assert.equal(app.node('puzzle').hidden, false);
  assert.deepEqual(app.video.seeks, [0.131]);
});
