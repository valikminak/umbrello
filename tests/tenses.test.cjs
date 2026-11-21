const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../assets/js/tenses-core.js');
const root = path.join(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, 'grammar', name), 'utf8'));
// A topic file with the shared grammar/lexicon.json merged in, the way the page loads it.
const topic = name => { const data = read(name); return { ...data, lexicon: core.mergeLexicon(read('lexicon.json'), data.lexicon) }; };
const file = () => topic('tenses.json');
const lexicon = () => core.makeLexicon(file().lexicon);
// A seeded generator, so random tile banks are the same on every run.
const seeded = seed => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('the tenses file is valid: all 14 lessons are ready with their settings', () => {
  const data = core.validate(file());
  assert.equal(data.passRating, 4.5);
  assert.equal(data.lessons.length, 14);
  assert.deepEqual(data.lessons.map(lesson => lesson.id), [...Array(14).keys()]);
  const [order, simple] = data.lessons;
  assert.deepEqual([order.ready, order.hints, order.nearMisses, order.info], [true, 'labels', false, 'word-order']);
  assert.deepEqual([simple.ready, simple.hints, simple.nearMisses, simple.info], [true, 'slots', true, 'simple-tenses']);
  assert.equal(order.items.length, 22);
  assert.equal(simple.items.length, 45);
  const [, , continuous, mix] = data.lessons;
  assert.deepEqual([continuous.ready, continuous.forms, continuous.check, continuous.info], [true, ['continuous'], 'auto', 'continuous']);
  assert.deepEqual([mix.ready, mix.forms, mix.decoys, mix.hints, mix.check], [true, ['simple', 'continuous'], true, 'none', 'button']);
  assert.ok(continuous.items.length >= 40 && mix.items.length >= 40);
  const settings = lesson => [lesson.forms, lesson.decoys, lesson.hints, lesson.check, lesson.info];
  assert.deepEqual(data.lessons.slice(4).map(settings), [
    [['simple', 'perfect'], true, 'none', 'button', 'present-perfect'],
    [['perfect', 'perfect-continuous'], true, 'none', 'button', 'perfect-continuous'],
    [['simple', 'continuous', 'perfect', 'perfect-continuous'], true, 'none', 'button', 'mix-present-past'],
    [['simple', 'perfect', 'perfect-continuous'], true, 'none', 'button', 'past-perfect'],
    [['simple', 'continuous', 'perfect'], true, 'none', 'button', 'future'],
    [['simple'], false, 'count', 'auto', 'when-if'],
    [['simple', 'continuous', 'perfect', 'perfect-continuous'], true, 'none', 'button', 'mix-all'],
    [['simple', 'continuous', 'perfect', 'passive'], true, 'none', 'button', 'passive'],
    [['simple', 'perfect'], true, 'none', 'button', 'conditionals'],
    [['simple', 'continuous', 'perfect', 'perfect-continuous', 'passive'], true, 'none', 'button', 'final'],
  ]);
  for (const lesson of data.lessons.slice(4)) assert.ok(lesson.ready && lesson.items.length >= 30, lesson.title);
  for (const it of data.lessons.filter(lesson => lesson.ready).flatMap(lesson => lesson.items)) {
    assert.match(it.uk, /[ІіЇїЄєҐґ'А-Яа-я]/u, it.uk);
    assert.doesNotMatch(it.uk, /[ЫыЭэЪъЁё]/u, `no Russian letters: ${it.uk}`);
  }
});

test('every sentence of lesson 1 gets a tile bank with all of its words, near misses and no repeated tile', () => {
  const data = core.validate(file()), rand = seeded(7);
  for (const it of data.lessons[1].items) {
    for (let k = 0; k < 200; k++) {
      const tiles = core.bank(it, data.lex, rand), words = tiles.map(t => t.toLowerCase());
      for (const step of it.steps) assert.ok(words.includes(step.toLowerCase()), `${it.uk}: missing ${step}`);
      assert.equal(new Set(words).size, words.length, `${it.uk}: repeated tile in ${tiles}`);
      assert.ok(tiles.length > it.steps.length, `${it.uk}: no near misses`);
      assert.ok(tiles.length <= 12, `${it.uk}: too many tiles (${tiles.length})`);
    }
  }
});

test('near misses are the neighbours that teach: negative helpers, verb forms, other times, him and he', () => {
  const lex = lexicon(), rand = seeded(3);
  const it = core.parse({ uk: 'Учора я його не бачив.', en: 'I|didn\'t|see|him|yesterday.' }, lex);
  assert.deepEqual(core.options(it, 1, lex, rand).sort(), ["didn't", "doesn't", "don't", "won't"]);
  assert.deepEqual(core.options(it, 2, lex, rand).sort(), ['saw', 'see', 'sees'], 'after didn\'t only forms of see');
  assert.ok(core.options(it, 3, lex, rand).includes('he'), 'him brings he');
  const times = core.options(it, 4, lex, rand);
  assert.equal(times.length, 3);
  assert.ok(times.some(t => lex.timeOf[t.toLowerCase()] === 'present') && times.some(t => lex.timeOf[t.toLowerCase()] === 'future'));
  const statement = core.parse({ uk: 'Я працюю щодня.', en: 'I|work|every day.' }, lex);
  assert.deepEqual(core.options(statement, 1, lex, rand).sort(), ['will', 'work', 'worked', 'works'], 'present, past and future in one choice');
  const question = core.parse({ uk: 'Ти прийдеш завтра?', en: 'Will|you|come|tomorrow?' }, lex);
  assert.deepEqual(question.steps, ['will', 'you', 'come', 'tomorrow']);
  assert.deepEqual(core.options(question, 0, lex, rand).sort(), ['did', 'do', 'does', 'will']);
});

test('only a finished sentence is judged; a statement may start with its time phrase, a question may not', () => {
  const lex = lexicon();
  const it = core.parse({ uk: 'Учора вона не зателефонувала.', en: 'She|didn\'t|call|yesterday.' }, lex);
  assert.equal(core.isRight(it, lex, ['she', "didn't", 'call', 'yesterday']), true);
  assert.equal(core.isRight(it, lex, ['yesterday', 'she', "didn't", 'call']), true);
  assert.equal(core.isRight(it, lex, ['tomorrow', 'she', "didn't", 'call']), false);
  assert.equal(core.isRight(it, lex, ['she', "didn't", 'called', 'yesterday']), false);
  assert.equal(core.sentence(it), "She didn't call yesterday.");
  const q = core.parse({ uk: 'Він прийшов учора?', en: 'Did|he|come|yesterday?' }, lex);
  assert.deepEqual(core.accepted(q, lex), ['did he come yesterday']);
  assert.equal(core.sentence(q), 'Did he come yesterday?');
});

test('the rating counts every sentence of the lesson; 4.5 needs all answered and at most 4 of 45 wrong', () => {
  const marks = (right, wrong) => Object.fromEntries([...Array(right).fill('r'), ...Array(wrong).fill('w')].map((m, i) => [i, m]));
  const seven = core.score(45, marks(7, 0));
  assert.equal(core.fmt(seven.rating), '0.7', 'seven right answers are far from a pass');
  assert.equal(core.passes(seven, 4.5), false);
  assert.equal(core.passes(core.score(45, marks(41, 4)), 4.5), true);
  assert.equal(core.passes(core.score(45, marks(40, 5)), 4.5), false);
  assert.equal(core.passes(core.score(45, marks(41, 0)), 4.5), false, 'every sentence must be answered');
  assert.equal(core.fmt(5 * 42 / 45), '4.6', '4.67 is shown rounded down');
  assert.equal(core.fmt(4.5), '4.5');
  assert.equal(core.fmt(5), '5.0');
});

test('a new round never starts with the sentence that was just answered', () => {
  const rand = seeded(11);
  for (let last = 0; last < 45; last++) {
    const order = core.newOrder(45, last, rand);
    assert.deepEqual([...order].sort((a, b) => a - b), [...Array(45).keys()]);
    assert.notEqual(order[0], last);
  }
});

test('malformed tenses files are rejected with the lesson and sentence named', () => {
  const broken = change => { const data = file(); change(data); return data; };
  const item = (data, index, value) => { data.lessons[1].items[index] = { ...data.lessons[1].items[index], ...value }; };
  for (const [data, message] of [
    [broken(d => { d.passRating = 6; }), /passRating/],
    [broken(d => { delete d.lexicon.verbs; }), /lexicon/],
    [broken(d => { d.lexicon.verbs.go = ['goes', 'went']; }), /verb "go" needs four forms/],
    [broken(d => { d.lessons[1].id = 0; }), /lesson 2 needs its own/],
    [broken(d => { d.lessons[10].items = []; }), /lesson 11 is ready but has no sentences/],
    [broken(d => item(d, 0, { en: 'The house|was|built|in 1990.' })), /lesson 2, sentence 1 is passive, which this lesson's forms do not include/],
    [broken(d => { d.lessons[12].items[0].en = 'If|I|lived|by the sea / I|would|swim|every day.'.replace('swim', 'paddle'); }), /lesson 13, sentence 1: add the verb after "would"/],
    [broken(d => item(d, 2, { uk: 'We play tennis.' })), /lesson 2, sentence 3: uk/],
    [broken(d => item(d, 2, { en: 'We|play|tennis' })), /sentence 3: en must end/],
    [broken(d => item(d, 2, { en: 'We||play.' })), /sentence 3: en has an empty step/],
    [broken(d => item(d, 7, { en: 'You|work|on Saturdays.' })), /sentence 8: a question/],
    [broken(d => item(d, 3, { uk: d.lessons[1].items[0].uk })), /sentence 4 repeats/],
    [broken(d => item(d, 21, { en: 'I|will|phone|you|tomorrow.' })), /sentence 22: add the verb after "will"/],
    [broken(d => item(d, 2, { en: 'We|ride|horses|at weekends.' })), /sentence 3: add its verb/],
    [broken(d => { d.lessons[0].hints = 'arrows'; }), /lesson 1: hints must be one of labels, slots, count/],
    [broken(d => { d.lessons[0].nearMisses = 'no'; }), /lesson 1: nearMisses/],
    [broken(d => { d.lessons[1].info = 'tables'; }), /lesson 2: info must be one of/],
    [broken(d => { d.lessons[1].check = 'later'; }), /lesson 2: check must be one of auto, button/],
    [broken(d => { d.lessons[1].forms = ['middle']; }), /lesson 2: forms must list some of/],
    [broken(d => item(d, 0, { en: 'I|am|working|every day.' })), /lesson 2, sentence 1 is continuous, which this lesson's forms do not include/],
    [broken(d => { delete d.lexicon.beAux; }), /lexicon needs/],
    [broken(d => { delete d.lexicon.haveAux; }), /lexicon needs/],
    [broken(d => { d.lexicon.timeTwins = { 'for an hour': 'since an hour' }; }), /timeTwins/],
    [broken(d => item(d, 0, { en: 'I|have|worked|every day.' })), /lesson 2, sentence 1 is perfect, which this lesson's forms do not include/],
    [broken(d => { d.lessons[7].items[0].en = 'The film|had|already|started / when|we|blorped.'; }), /lesson 8, sentence 1: add its verb to the lexicon \(clause 2\)/],
    [broken(d => { d.lessons[7].items[0].en = 'The film|had|already|started /  / when|we|arrived.'; }), /lesson 8, sentence 1: en has an empty step/],
  ]) assert.throws(() => core.validate(data), message);
});

test('Grammar opens on the Lessons tab by default and mounts the topics without loading the level test', async () => {
  for (const search of ['', '?tab=tenses', '?tab=learn', '?tab=unknown', '?user=sophia']) {
  const tabs = { innerHTML: '' }, host = { innerHTML: '' }, requested = [], mounted = [];
  const context = vm.createContext({
    Profiles: { shared: async () => true, url: page => `${page}?v=10` },
    document: { getElementById: id => (id === 'grammarTabs' ? tabs : host) },
    location: { href: '', search }, URLSearchParams, console,
    TensesApp: { mount: target => mounted.push(target) },
    fetch: async url => { requested.push(url); return { ok: true, json: async () => [] }; },
  });
  context.window = context;
  for (const name of ['app.js', 'grammar-core.js', 'grammar.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'assets/js', name), 'utf8'), context);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tabs.innerHTML, '<a href="grammar.html?v=10" aria-current="page">Lessons</a><a href="grammar.html?v=10&tab=test">Test</a>', search);
  assert.deepEqual(mounted, [host], search);
  assert.deepEqual(requested, [], search);
  }
});

test('grammar.html loads the tenses rules before the page script', () => {
  const html = fs.readFileSync(path.join(root, 'grammar.html'), 'utf8');
  const at = name => html.indexOf(`assets/js/${name}`);
  assert.ok(at('tenses-core.js') > 0 && at('tenses-core.js') < at('tenses.js') && at('tenses.js') < at('grammar.js'));
  assert.match(html, /assets\/css\/tenses\.css/);
});

test('the word-order lesson gives only the answer\'s own words and names every place in the sentence', () => {
  const data = core.validate(file()), rand = seeded(5), lesson = data.lessons[0];
  for (const it of lesson.items) {
    const tiles = core.bank(it, data.lex, rand, lesson.nearMisses);
    assert.deepEqual([...tiles].sort(), [...it.steps].sort(), it.uk);
    const roles = it.steps.map((_, i) => core.role(it, i, data.lex));
    assert.equal(roles.filter(r => r === 'хто').length, 1, `${it.uk}: one subject`);
    assert.equal(roles.filter(r => r === 'дія').length, 1, `${it.uk}: one verb`);
    if (it.q) assert.deepEqual(roles.slice(0, 2), ['допоміжне', 'хто'], `${it.uk}: the helper comes first in a question`);
  }
  const roles = en => { const it = core.parse({ uk: 'Речення.', en }, data.lex); return it.steps.map((_, i) => core.role(it, i, data.lex)); };
  assert.deepEqual(roles('We|drink|coffee|in a cafe|every morning.'), ['хто', 'дія', 'кого / що', 'де', 'коли']);
  assert.deepEqual(roles('We|will|go|to the sea|tomorrow.'), ['хто', 'допоміжне', 'дія', 'куди', 'коли']);
  assert.deepEqual(roles('She|sings|well.'), ['хто', 'дія', 'як']);
  assert.deepEqual(roles('Does|he|work|here?'), ['допоміжне', 'хто', 'дія', 'де']);
});

test('tiles come in groups: each word with its own near misses, in random group order', () => {
  const lex = lexicon();
  const it = core.parse({ uk: 'Учора вона не зателефонувала.', en: "She|didn't|call|yesterday." }, lex);
  const firsts = new Set();
  for (let seed = 1; seed < 40; seed++) {
    const groups = core.bankGroups(it, lex, seeded(seed));
    assert.equal(groups.length, it.steps.length);
    const find = word => groups.find(group => group.includes(word));
    assert.ok(find("didn't").every(w => lex.negativeAux.includes(w)), 'helpers stay together');
    assert.ok(find('call').every(w => ['call', 'calls', 'called'].includes(w)), 'forms of call stay together');
    assert.ok(find('yesterday').every(w => lex.timeOf[w.toLowerCase()]), 'time words stay together');
    firsts.add(groups[0].join());
  }
  assert.ok(firsts.size > 2, 'the groups are not always in sentence order');
});

test('the number of tiles is written with the right Ukrainian ending', () => {
  assert.deepEqual([1, 2, 4, 5, 11, 12, 21, 22, 25].map(core.tilesWord),
    ['1 плитка', '2 плитки', '4 плитки', '5 плиток', '11 плиток', '12 плиток', '21 плитка', '22 плитки', '25 плиток']);
});

// Words in the Ukrainian sentence that say "in progress at this moment". A continuous answer needs
// one of them; a simple answer must not have any, or the learner could not tell which tense is meant.
const CONTINUOUS_MARKERS = ['зараз', 'саме', 'у той момент', 'в той момент', 'у цей час', 'в цей час', 'цього тижня'];
test('every Ukrainian sentence shows its tense: continuous ones say зараз / саме / в цей час, simple ones never do', () => {
  const data = core.validate(file());
  for (const lesson of data.lessons.filter(l => l.ready)) {
    for (const it of lesson.items) {
      const uk = it.uk.toLowerCase(), has = CONTINUOUS_MARKERS.some(m => uk.includes(m));
      if (core.tenses(it, data.lex).some(t => t.aspect === 'continuous')) assert.ok(has, `lesson ${lesson.id}: "${it.uk}" needs зараз, саме or в цей час`);
      else assert.ok(!has, `lesson ${lesson.id}: "${it.uk}" is simple but reads as continuous`);
    }
  }
});

test('the tense is read from the English answer', () => {
  const lex = lexicon(), t = en => { const { time, aspect } = core.tense(core.parse({ uk: 'Речення.', en }, lex), lex); return { time, aspect }; };
  assert.deepEqual(t('I|am|working|now.'), { time: 'present', aspect: 'continuous' });
  assert.deepEqual(t('She|wasn\'t|sleeping|at that moment.'), { time: 'past', aspect: 'continuous' });
  assert.deepEqual(t('Will|you|be|driving|at nine tomorrow?'), { time: 'future', aspect: 'continuous' });
  assert.deepEqual(t('He|walks|to work|every day.'), { time: 'present', aspect: 'simple' });
  assert.deepEqual(t('I|finished|work|at six yesterday.'), { time: 'past', aspect: 'simple' });
  assert.deepEqual(t('I|won\'t|be|late|tomorrow.'), { time: 'future', aspect: 'simple' });
  assert.deepEqual(t('I|have|already|finished|the report.'), { time: 'present', aspect: 'perfect' });
  assert.deepEqual(t('How long|have|you|been|waiting?'), { time: 'present', aspect: 'perfect-continuous' });
  assert.deepEqual(t('We|have|been|friends|for a long time.'), { time: 'present', aspect: 'perfect' });
  assert.deepEqual(t('She|hadn\'t|finished|her work.'), { time: 'past', aspect: 'perfect' });
  assert.deepEqual(t('I|will|have|finished|the report|by Friday.'), { time: 'future', aspect: 'perfect' });
  assert.deepEqual(t('I|am|going to|sell|my car.'), { time: 'present', aspect: 'simple' });
  const two = core.parse({ uk: 'Речення.', en: 'The film|had|already|started / when|we|arrived.' }, lex);
  assert.deepEqual(core.tenses(two, lex), [{ time: 'past', aspect: 'perfect', passive: false }, { time: 'past', aspect: 'simple', passive: false }]);
  const full = en => core.tense(core.parse({ uk: 'Речення.', en }, lex), lex);
  assert.deepEqual(full('The car|is|being|repaired|now.'), { time: 'present', aspect: 'continuous', passive: true });
  assert.deepEqual(full('The room|is|cleaned|every day.'), { time: 'present', aspect: 'simple', passive: true });
  assert.deepEqual(full('This house|was|built|in 1990.'), { time: 'past', aspect: 'simple', passive: true });
  assert.deepEqual(full('The letter|has|already|been|sent.'), { time: 'present', aspect: 'perfect', passive: true });
  assert.deepEqual(full('My grandfather|built|this house|in 1990.'), { time: 'past', aspect: 'simple', passive: false });
  assert.deepEqual(full('I|was|tired.'), { time: 'past', aspect: 'simple', passive: false });
  assert.deepEqual(t('I|would|have|told|you.'), { time: 'unreal', aspect: 'perfect' });
});

test('lessons 2 and 3 give every sentence a tile bank with its words, near misses and no repeated tile', () => {
  const data = core.validate(file()), rand = seeded(13);
  for (const lesson of data.lessons.slice(2, 4)) {
    for (const it of lesson.items) {
      for (let k = 0; k < 100; k++) {
        const tiles = core.bank(it, data.lex, rand, lesson.nearMisses), words = tiles.map(t => t.toLowerCase());
        for (const step of it.steps) assert.ok(words.includes(step.toLowerCase()), `${it.uk}: missing ${step}`);
        assert.equal(new Set(words).size, words.length, `${it.uk}: repeated tile in ${tiles}`);
        assert.ok(tiles.length <= 15, `${it.uk}: too many tiles (${tiles.length})`);
      }
    }
  }
});

test('the continuous lesson offers be-words for the right person and time, and never do or did', () => {
  const data = core.validate(file()), lesson = data.lessons[2], rand = seeded(17);
  const be = core.parse({ uk: 'Вона зараз готує.', en: 'She|is|cooking|now.' }, data.lex, lesson);
  assert.deepEqual(core.options(be, 1, data.lex, rand).sort(), ['are', 'is', 'was']);
  assert.deepEqual(core.options(be, 2, data.lex, rand).sort(), ['cook', 'cooked', 'cooking', 'cooks']);
  for (const it of lesson.items) {
    const words = core.bank(it, data.lex, rand, true).map(w => w.toLowerCase());
    for (const w of ['do', 'does', 'did', "don't", "doesn't", "didn't"]) assert.ok(!words.includes(w), `${it.uk}: ${w} is not part of lesson 2`);
  }
});

test('in the mixed lesson the tiles do not tell simple from continuous', () => {
  const data = core.validate(file()), lesson = data.lessons[3];
  const beWords = [...data.lex.beAux, ...data.lex.beNegative, 'be'];
  for (const it of lesson.items) {
    for (let seed = 1; seed < 30; seed++) {
      const groups = core.bankGroups(it, data.lex, seeded(seed), true), words = groups.flat().map(w => w.toLowerCase());
      if (!it.q) assert.ok(words.some(w => beWords.includes(w)), `${it.uk}: a statement always has a be-word among its tiles`);
      it.steps.forEach((s, i) => {
        const kind = core.kind(it, i, data.lex);
        // will and won't belong to both aspects (will call, will be calling), so their group may hold either.
        if ((kind !== 'verb' && kind !== 'aux') || ['will', "won't"].includes(s.toLowerCase())) return;
        const group = groups.find(g => g.includes(s)), ing = w => data.lex.verbs[data.lex.formOf[w.toLowerCase()]]?.[3] === w.toLowerCase();
        if (kind === 'verb') assert.ok(group.some(w => ing(w)) && group.some(w => !ing(w)), `${it.uk}: ${group} offers both aspects`);
        else assert.ok(new Set(group.map(w => beWords.includes(w.toLowerCase()) ? 'be' : 'other')).size === 2, `${it.uk}: ${group} offers both aspects`);
      });
    }
  }
});

test('lessons 4–13 give every sentence a tile bank with its words, no repeated near miss and at most 18 tiles', () => {
  const data = core.validate(file()), rand = seeded(19);
  for (const lesson of data.lessons.slice(4)) {
    for (const it of lesson.items) {
      const need = {};
      for (const step of it.steps) need[step.toLowerCase()] = (need[step.toLowerCase()] || 0) + 1;
      for (let k = 0; k < 60; k++) {
        const words = core.bank(it, data.lex, rand, true).map(t => t.toLowerCase());
        for (const [word, count] of Object.entries(need)) assert.ok(words.filter(w => w === word).length >= count, `${it.uk}: missing ${word}`);
        const extra = words.filter(w => !need[w]);
        assert.equal(new Set(extra).size, extra.length, `${it.uk}: repeated tile in ${words}`);
        assert.ok(words.length <= 18, `${it.uk}: too many tiles (${words.length})`);
      }
    }
  }
});

test('in the mixed lessons the helpers on the tiles do not tell the tense', () => {
  const data = core.validate(file());
  const isBe = w => [...data.lex.beAux, ...data.lex.beNegative, 'be', 'been'].includes(w);
  const isHave = w => [...data.lex.haveAux, ...data.lex.haveNegative].includes(w);
  for (const lesson of data.lessons.filter(l => l.decoys)) {
    const perfect = lesson.forms.some(f => f.startsWith('perfect')), continuous = lesson.forms.some(f => f.includes('continuous'));
    for (const it of lesson.items) {
      for (let seed = 1; seed < 25; seed++) {
        const words = core.bank(it, data.lex, seeded(seed), true).map(w => w.toLowerCase());
        if (!it.q && (continuous || lesson.going)) assert.ok(words.some(isBe), `lesson ${lesson.id}, ${it.uk}: no be-word among ${words}`);
        if (!it.q && perfect) assert.ok(words.some(isHave), `lesson ${lesson.id}, ${it.uk}: no have among ${words}`);
        // "have been waiting" and "have known": both sentences show been.
        if (lesson.forms.includes('perfect-continuous') && it.steps.some(w => isHave(w.toLowerCase()))) assert.ok(words.includes('been'), `lesson ${lesson.id}, ${it.uk}: no been among ${words}`);
      }
    }
  }
});

test('perfect lessons offer the third form, for beside since, by beside until, and had only with the past perfect', () => {
  const data = core.validate(file()), raw = file(), rand = seeded(23);
  const [l4, l5, , l7, l8] = data.lessons.slice(4, 9);
  const seen = core.parse({ uk: 'Ми бачили море минулого року.', en: 'We|saw|the sea|last year.' }, data.lex, l4);
  assert.ok(core.options(seen, 1, data.lex, rand).includes('seen'), 'saw sits beside seen');
  assert.ok(!core.options(seen, 1, data.lex, rand).includes('seeing'), 'lesson 4 has no -ing forms');
  const has = core.parse({ uk: 'Вона щойно пішла.', en: 'She|has|just|left.' }, data.lex, l4);
  assert.deepEqual(core.options(has, 1, data.lex, rand), ['has', 'have'], 'no had before lesson 7');
  const had = core.parse(raw.lessons[7].items[0], data.lex, l7);
  assert.deepEqual(core.options(had, 1, data.lex, rand).sort(), ['had', 'has', 'have']);
  const wait = core.parse({ uk: 'Я чекаю вже дві години.', en: 'I|have|been|waiting|for two hours.' }, data.lex, l5);
  for (let seed = 1; seed < 10; seed++) {
    const group = core.bankGroups(wait, data.lex, seeded(seed), true).find(g => g.includes('for two hours'));
    assert.deepEqual(group.sort(), ['for two hours', 'since two hours']);
  }
  const by = core.parse({ uk: 'До п\'ятниці я вже закінчу звіт.', en: 'I|will|have|finished|the report|by Friday.' }, data.lex, l8);
  assert.ok(core.bankGroups(by, data.lex, seeded(3), true).some(g => g.includes('by Friday') && g.includes('until Friday')));
});

test('a sentence of two clauses may come in either order and is shown with a comma after its when / if part', () => {
  const lex = lexicon();
  const it = core.parse({ uk: 'Якщо завтра піде дощ, ми залишимося вдома.', en: 'If|it|rains|tomorrow / we|will|stay|at home.' }, lex);
  assert.deepEqual(it.steps, ['if', 'it', 'rains', 'tomorrow', 'we', 'will', 'stay', 'at home']);
  assert.equal(core.sentence(it), 'If it rains tomorrow, we will stay at home.');
  assert.equal(core.isRight(it, lex, ['we', 'will', 'stay', 'at home', 'if', 'it', 'rains', 'tomorrow']), true);
  assert.equal(core.isRight(it, lex, ['if', 'it', 'will rain', 'tomorrow', 'we', 'will', 'stay', 'at home']), false);
  assert.deepEqual(it.steps.map((_, i) => core.kind(it, i, lex)), ['conj', 'subject', 'verb', 'time', 'subject', 'will', 'verb', 'other']);
  const late = core.parse({ uk: 'Коли ми прийшли, фільм уже почався.', en: 'The film|had|already|started / when|we|arrived.' }, lex);
  assert.equal(core.sentence(late), 'The film had already started when we arrived.');
  assert.equal(late.steps[0], 'the film', 'the first tile does not show the capital that starts the sentence');
  assert.equal(core.isRight(late, lex, ['when', 'we', 'arrived', 'the film', 'had', 'already', 'started']), true);
  const work = core.parse({ uk: 'Учора я закінчив роботу о шостій.', en: 'I|finished|work|at six yesterday.' }, lex);
  assert.equal(core.kind(work, 2, lex), 'other', 'work after finished is what was finished, not a second verb');
});

test('when / if clauses offer "will rain" as the slip and never hold will themselves', () => {
  const data = core.validate(file()), lesson = data.lessons[9], raw = file().lessons[9];
  for (const it of lesson.items) {
    it.clauses.forEach(([a, b]) => {
      const words = it.steps.slice(a, b).map(w => w.toLowerCase());
      if (['when', 'if', 'as soon as', 'until', 'before', 'after'].includes(words[0])) {
        assert.ok(!words.includes('will') && !words.includes("won't"), `${it.uk}: no will after ${words[0]}`);
      }
    });
    assert.ok(it.clauses.length === 2, `${it.uk}: two clauses`);
  }
  const rains = core.parse(raw.items[0], data.lex, lesson);
  for (let seed = 1; seed < 10; seed++) assert.ok(core.bankGroups(rains, data.lex, seeded(seed), true).some(g => g.includes('rains') && g.includes('will rain')));
  const is = core.parse({ uk: 'Якщо магазин буде відчинений, я куплю хліба.', en: 'If|the shop|is|open / I|will|buy|some bread.' }, data.lex, lesson);
  assert.ok(core.options(is, 2, data.lex, seeded(1)).includes('will be'));
});

// Past simple needs a finished time in the Ukrainian sentence (учора, два роки тому); the present
// perfect must not have one, or the learner could not tell which is meant.
// «з минулого літа» is since last summer, not a finished time.
const FINISHED = /учора|вчора|(?<!з )минулого|минулої|тому|у \d{4}/;
test('lessons 4, 6, 10, 11 and 13 tell past simple from present perfect by a finished time in the Ukrainian sentence', () => {
  const data = core.validate(file());
  for (const lesson of [4, 6, 10, 11, 13].map(id => data.lessons[id])) {
    // Two clauses and When…? / Where…? questions take their time from the other part or the question word.
    for (const it of lesson.items.filter(it => it.clauses.length === 1 && !it.head)) {
      const t = core.tense(it, data.lex), uk = it.uk.toLowerCase(), has = FINISHED.test(uk);
      if (t.time === 'past' && t.aspect === 'simple') assert.ok(has, `lesson ${lesson.id}: "${it.uk}" needs учора, минулого or тому`);
      if (t.time === 'present' && t.aspect.startsWith('perfect')) assert.ok(!has, `lesson ${lesson.id}: "${it.uk}" is present perfect but names a finished time`);
    }
  }
});

test('the future lesson says збираюся (or ось-ось) exactly where the answer has going to, and до … for the future perfect', () => {
  const data = core.validate(file());
  for (const it of data.lessons[8].items) {
    const going = it.steps.map(w => w.toLowerCase()).includes('going to');
    // «Ось-ось піде дощ» — going to for what is about to happen.
    assert.equal(/збира|ось-ось/i.test(it.uk), going, `"${it.uk}": збираюся goes with going to`);
    if (core.tense(it, data.lex).aspect === 'perfect') assert.match(it.uk, /^До /, `"${it.uk}": the future perfect needs до …`);
  }
});

test('every lesson explanation named in the file has its text on the page', () => {
  const page = fs.readFileSync(path.join(root, 'assets/js/tenses.js'), 'utf8');
  for (const key of core.INFO) assert.ok(page.includes(`INFO["${key}"]`) || page.includes(`INFO.${key} `) || page.includes(`"${key}": \``), key);
  for (const lesson of core.validate(file()).lessons.filter(l => l.ready)) assert.ok(lesson.info, `lesson ${lesson.id} has an explanation`);
});

test('lesson 10 has all twelve forms, lesson 13 has a bit of everything', () => {
  const data = core.validate(file());
  const forms = lesson => new Set(lesson.items.flatMap(it => core.tenses(it, data.lex).map(t => `${t.time} ${t.aspect}`)));
  const ten = forms(data.lessons[10]);
  for (const time of ['present', 'past', 'future']) for (const aspect of ['simple', 'continuous', 'perfect', 'perfect-continuous']) {
    assert.ok(ten.has(`${time} ${aspect}`), `lesson 11 lacks ${time} ${aspect}`);
  }
  const final = data.lessons[13], all = final.items.flatMap(it => core.tenses(it, data.lex));
  assert.ok(all.some(t => t.passive) && all.some(t => t.time === 'unreal') && final.going, 'passive, would and going to');
  assert.ok(final.items.some(it => it.clauses.length > 1 && ['if', 'when', 'as soon as', 'until', 'by the time'].includes(it.steps[0].toLowerCase())));
});

test('passive sentences keep the third form and its look-alikes on the tiles', () => {
  const data = core.validate(file()), lesson = data.lessons[11], lex = data.lex;
  const spoken = core.parse({ uk: 'Тут говорять англійською.', en: 'English|is|spoken|here.' }, lex, lesson);
  assert.deepEqual(spoken.steps.map((_, i) => core.kind(spoken, i, lex)), ['other', 'be', 'verb', 'other']);
  const opts = core.options(spoken, 2, lex, seeded(1));
  assert.ok(opts.includes('spoke') && opts.includes('spoken'), 'spoken beside spoke');
  const repaired = core.parse({ uk: 'Машину зараз ремонтують.', en: 'The car|is|being|repaired|now.' }, lex, lesson);
  assert.deepEqual(repaired.steps.map((_, i) => core.kind(repaired, i, lex)), ['other', 'be', 'be', 'verb', 'time']);
  const sent = core.parse({ uk: 'Листа вже відправили.', en: 'The letter|has|already|been|sent.' }, lex, lesson);
  assert.equal(core.kind(sent, 3, lex), 'be', 'been before the third form is a helper');
  assert.ok(lesson.items.some(it => !core.tense(it, lex).passive) && lesson.items.some(it => core.tense(it, lex).passive), 'both voices');
});

// «Якби… б» is the same for now and then in Ukrainian, so the sentence says which: тепер, щодня
// for would + verb; учора, тоді for would have and had + third form.
test('conditionals: would never follows if, and the Ukrainian sentence says now or then', () => {
  const data = core.validate(file()), lesson = data.lessons[12], raw = file().lessons[12], lex = data.lex;
  for (const it of lesson.items) {
    const parts = core.tenses(it, lex), uk = it.uk.toLowerCase();
    it.clauses.forEach(([a, b]) => {
      const words = it.steps.slice(a, b).map(w => w.toLowerCase());
      if (words[0] === 'if') assert.ok(!words.includes('would') && !words.includes("wouldn't") && !words.includes('will'), `${it.uk}: no would after if`);
    });
    assert.ok(parts.some(t => t.time === 'unreal'), `${it.uk}: has would`);
    const then = parts.some(t => t.aspect === 'perfect'), now = parts.some(t => t.time === 'unreal' && t.aspect === 'simple');
    assert.equal(/учора|вчора|тоді|минулого|того /.test(uk), then, `"${it.uk}": тоді / учора goes with had and would have`);
    assert.equal(/тепер|щодня|сьогодні|частіше/.test(uk), now, `"${it.uk}": тепер / щодня goes with would + verb`);
  }
  const knew = core.parse(raw.items[1], lex, lesson);
  assert.ok(core.options(knew, 2, lex, seeded(1)).includes('would know'), 'knew sits beside would know');
  assert.deepEqual(core.options(knew, knew.steps.indexOf('would'), lex, seeded(1)), ['would', 'will']);
  const known = core.parse(raw.items[13], lex, lesson);
  assert.ok(core.options(known, 2, lex, seeded(1)).includes('would have'), 'had sits beside would have');
  assert.equal(core.isRight(known, lex, ['i', 'would', 'have', 'told', 'you', 'if', 'i', 'had', 'known']), true);
});

test('topics.json lists the topics in order; every topic with a file is valid on top of the shared lexicon', () => {
  const topics = core.validateTopics(read('topics.json'));
  assert.deepEqual(topics.slice(0, 4).map(t => t.id), ['tenses', 'modals', 'questions', 'phrasal']);
  assert.equal(topics.length, 14);
  for (const t of topics.filter(t => t.file)) {
    const data = core.validate(topic(t.file.replace('grammar/', '')), t.file);
    assert.ok(data.lessons.every(l => l.ready && l.items.length >= 20), t.id);
    for (const lesson of data.lessons) assert.ok(lesson.info && (core.INFO.includes(lesson.info) || data.notes[lesson.info]), `${t.id} lesson ${lesson.id} explanation`);
  }
  for (const bad of [{}, { topics: [{ id: 'Tenses', title: 'x', desc: 'y' }] }, { topics: [{ id: 'a', title: 'x', desc: 'y', file: '../a.json' }] },
    { topics: [{ id: 'a', title: 'x', desc: 'y' }, { id: 'a', title: 'x', desc: 'y' }] }]) {
    assert.throws(() => core.validateTopics(bad), /grammar\/topics\.json/);
  }
});

test('a topic adds its own words to the shared lexicon without losing any', () => {
  const merged = core.mergeLexicon({ verbs: { go: ['goes', 'went', 'gone', 'going'] }, time: { past: ['yesterday'] }, subjects: ['I'] },
    { verbs: { park: ['parks', 'parked', 'parked', 'parking'] }, time: { past: ['last week'], future: ['soon'] }, subjects: ['I', 'we'], modals: ['can'] });
  assert.deepEqual(Object.keys(merged.verbs), ['go', 'park']);
  assert.deepEqual(merged.time, { past: ['yesterday', 'last week'], future: ['soon'] });
  assert.deepEqual(merged.subjects, ['I', 'we']);
  assert.deepEqual(merged.modals, ['can']);
});

const modals = () => core.validate(topic('modals.json'), 'grammar/modals.json');
test('modals: a modal is one tile with its twins beside it, and the verb after it sits beside "to go"', () => {
  const data = modals(), lex = data.lex, [can, must] = data.lessons;
  const swim = core.parse({ uk: 'Я вмію плавати.', en: 'I|can|swim.' }, lex, can);
  assert.deepEqual(swim.steps.map((_, i) => core.kind(swim, i, lex)), ['subject', 'modal', 'verb']);
  const opts = core.options(swim, 2, lex, seeded(1));
  assert.ok(opts.includes('to swim') && opts.includes('swims'), 'swim beside to swim and swims');
  const smoke = core.parse({ uk: 'Тут не можна курити.', en: 'You|mustn\'t|smoke|here.' }, lex, must);
  for (let seed = 1; seed < 15; seed++) {
    const group = core.bankGroups(smoke, lex, seeded(seed), true).find(g => g.includes("mustn't"));
    assert.ok(group.includes("don't have to"), "mustn't always sits beside don't have to");
  }
  const has = core.parse({ uk: 'Їй доводиться вставати о шостій.', en: 'She|has to|get|up|at six.' }, lex, must);
  assert.ok(!core.options(has, 2, lex, seeded(1)).some(o => o.startsWith('to ')), 'no "to get" after has to');
  const q = core.parse({ uk: 'Ти вмієш готувати?', en: 'Can|you|cook?' }, lex, can);
  assert.equal(q.steps[0], 'can', 'the first tile does not show the capital');
  assert.equal(core.sentence(q), 'Can you cook?');
  const future = core.parse(read('modals.json').lessons[0].items.find(i => /зможу тобі/.test(i.uk)), lex, can);
  assert.ok(core.options(future, 1, lex, seeded(1)).includes('will can'), '"will can" is the slip for will be able to');
});

test('modals: other right answers count, and every lesson has its tiles', () => {
  const data = modals(), lex = data.lex;
  const go = core.parse({ uk: 'Я мушу йти.', en: 'I|must|go.', alt: ['I|have to|go.'] }, lex, data.lessons[1]);
  assert.equal(core.isRight(go, lex, ['I', 'have to', 'go']), true);
  assert.equal(core.isRight(go, lex, ['I', 'must', 'to go']), false);
  for (const lesson of data.lessons) {
    for (const it of lesson.items) {
      for (let seed = 1; seed < 20; seed++) {
        const words = core.bank(it, lex, seeded(seed), true).map(w => w.toLowerCase());
        for (const step of it.steps) assert.ok(words.includes(step.toLowerCase()), `${it.uk}: ${step}`);
        assert.ok(words.length <= 16, `${it.uk}: ${words.length} tiles`);
        assert.equal(new Set(words.filter(w => !it.steps.map(s => s.toLowerCase()).includes(w))).size,
          words.filter(w => !it.steps.map(s => s.toLowerCase()).includes(w)).length, `${it.uk}: repeated near miss`);
      }
      for (const alt of it.alt) assert.ok(core.isRight(it, lex, alt.split(' ')), `${it.uk}: alt ${alt}`);
    }
  }
});

// mustn't is «не можна», don't have to is «не треба»; can't (be) is «не може бути»; should have is «варто було».
test('modals: the Ukrainian sentence says which modal is meant', () => {
  const data = modals();
  const rules = [
    [/mustn't/, /не можна/], [/(don't|doesn't|didn't|won't) have to/, /не треба|не довелося|не доведеться|не мусиш/],
    [/^(?!.*\bhave\b).*can't\|be|can't\|live/, /не може бути|не можеш говорити серйозно/], [/should\|have/, /варто було/],
    [/shouldn't\|have/, /не варто було/], [/must\|have/, /напевно/], [/could\|have/, /міг би|могли б|міг упасти/],
    [/will be able to/, /зможу|зможе|зможеш/], [/was able to|were able to/, /зміг|змогли/], [/had to/, /довелося/], [/will have to/, /доведеться/],
  ];
  for (const lesson of data.lessons) {
    for (const it of lesson.items) {
      const en = it.steps.join('|').toLowerCase(), uk = it.uk.toLowerCase();
      for (const [answer, cue] of rules) if (answer.test(en)) assert.match(uk, cue, `"${it.uk}" → ${en}`);
    }
  }
});
