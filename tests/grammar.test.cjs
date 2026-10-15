const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { validateUnit, normalizeAnswer, evaluate, wordCount, allQuestions } = require('../assets/js/grammar-core.js');

const gap = (id = 'u1-e1-q1') => ({
  id, type: 'gap', prompt: 'They ____ a new classroom this week.', answers: ['are using', "they're using"],
  modelAnswer: 'They are using a new classroom this week.', explanation: 'This is a temporary arrangement.',
  audio: 'unit-001/audio/111.mp3'
});
const choice = (id = 'u1-e2-q1') => ({
  id, type: 'choice', prompt: 'Select every correct sentence.', options: [
    { id: 'a', text: 'I understand.', correct: true },
    { id: 'b', text: 'I am understanding.', correct: false },
    { id: 'c', text: 'I do understand.', correct: true }
  ], modelAnswer: 'I understand. / I do understand.', explanation: 'Understand usually describes a state.'
});
const sample = () => ({
  schemaVersion: 1, id: 'unit-001', number: 1, title: 'Present tenses', focus: 'Present simple and present continuous',
  objectives: ['Distinguish states and actions.'],
  theory: [{ title: 'States and actions', paragraphs: ['Use the present simple for many states.'], examples: [{ text: 'I know.', note: '' }] }],
  practice: [{ id: 'exercise-1', title: 'Complete', instruction: 'Fill in the gap.', wordBank: ['use'],
    examples: [{ text: 'I am working.', audio: 'unit-001/audio/11e1.mp3' }], questions: [gap(), choice()] }],
  listening: { instruction: 'Listen and complete the sentence.', questionIds: ['u1-e1-q1'] },
  writing: { prompt: 'Describe a temporary change in your routine.', checklist: ['Use both present tenses.'], minWords: 60, maxWords: 120 },
  review: [gap('u1-review-q1')]
});

test('validates and copies an entire unit, retaining plain text without unknown fields', () => {
  const input = sample();
  input.title = '  Present tenses  ';
  input.theory[0].paragraphs[0] = '<script>not executed</script>';
  input.hidden = { ignored: true };
  input.practice[0].questions[0].hidden = true;
  const unit = validateUnit(input);
  assert.equal(unit.title, 'Present tenses');
  assert.equal(unit.theory[0].paragraphs[0], '<script>not executed</script>');
  assert.equal('hidden' in unit, false);
  assert.equal('hidden' in unit.practice[0].questions[0], false);
  unit.practice[0].questions[0].answers.push('a new answer');
  assert.equal(input.practice[0].questions[0].answers.length, 2);
  assert.deepEqual(allQuestions(unit).map(question => question.id), ['u1-e1-q1', 'u1-e2-q1']);
  assert.equal('audio' in unit.practice[0].questions[1], false);
});

test('accepts casing, smart apostrophes, spacing, punctuation and unambiguous contractions', () => {
  for (const [left, right] of [
    ['  ARE   USING! ', 'are using'], ['“I’m working.”', 'I am working'], ["'I'm working'", 'I am working'],
    ["'I'm working.'", 'I am working'],
    ['They’re working', 'they are working'], ['We’ve arrived', 'we have arrived'], ["he'll help", 'he will help'],
    ["don't know", 'do not know'], ["doesn’t fit", 'does not fit'], ["isn't working", 'is not working'],
    ["won't go", 'will not go'], ["can't go", 'cannot go'], ['cannot go', 'can not go']
  ]) assert.equal(normalizeAnswer(left), normalizeAnswer(right), `${left} should match ${right}`);
  assert.deepEqual(evaluate(gap(), ' ARE USING! '), { correct: true });
  assert.deepEqual(evaluate(gap(), 'use'), { correct: false });
});

test('does not turn ambiguous contractions or different grammar into the same answer', () => {
  for (const [left, right] of [
    ["he's finished", 'he is finished'], ["he's finished", 'he has finished'],
    ["I'd finished", 'I had finished'], ["I'd finish", 'I would finish'],
    ["don't", 'dont'], ["students'", 'students'], ['lets eat, Grandma', 'lets eat Grandma'], ['is using', 'uses']
  ]) assert.notEqual(normalizeAnswer(left), normalizeAnswer(right));
  const explicit = { type: 'gap', answers: ['he is working', "he's working"] };
  assert.deepEqual(evaluate(explicit, 'He’s working.'), { correct: true });
  for (const response of ['', ' ', '...?!', undefined, null, [], {}]) assert.deepEqual(evaluate(gap(), response), { correct: false });
});

test('choice answers require exactly all correct ids, in any order', () => {
  assert.deepEqual(evaluate(choice(), ['c', 'a']), { correct: true });
  for (const response of [[], ['a'], ['a', 'b', 'c'], ['a', 'a', 'c'], ['a', 'unknown'], ['a', true], 'a,c', null]) {
    assert.deepEqual(evaluate(choice(), response), { correct: false });
  }
  assert.deepEqual(evaluate(null, 'answer'), { correct: false });
  assert.deepEqual(evaluate({ type: 'unsupported' }, 'answer'), { correct: false });
});

test('counts actual words while retaining contractions and hyphenated words', () => {
  assert.equal(wordCount("I'm learning — every day!"), 4);
  assert.equal(wordCount('A well-known author has 2 books.'), 6);
  assert.equal(wordCount('Український текст\nand English.'), 4);
  assert.equal(wordCount('…  --  !'), 0);
  assert.equal(wordCount(null), 0);
});

test('rejects duplicate ids, malformed answer keys and incomplete teaching content', () => {
  const mutations = [
    unit => { unit.schemaVersion = 2; },
    unit => { unit.number = 2; },
    unit => { unit.id = 'unit-000'; unit.number = 0; },
    unit => { unit.practice[0].questions.push(gap()); },
    unit => { unit.review[0].id = unit.practice[0].questions[0].id; },
    unit => { unit.practice.push(structuredClone(unit.practice[0])); },
    unit => { unit.practice[0].questions[0].answers = []; },
    unit => { unit.practice[0].questions[0].answers = ['!?']; },
    unit => { unit.practice[0].questions[0].prompt = 'No blank here.'; },
    unit => { unit.practice[0].questions[1].options[1].id = 'a'; },
    unit => { unit.practice[0].questions[1].options.forEach(option => { option.correct = false; }); },
    unit => { unit.practice[0].questions[1].options[0].correct = 'true'; },
    unit => { unit.objectives = []; },
    unit => { unit.theory = []; },
    unit => { unit.theory[0].paragraphs[0] = ' '; },
    unit => { unit.practice[0].questions[0].explanation = ''; },
    unit => { unit.title = 'x'.repeat(251); },
    unit => { unit.review = []; },
    unit => { unit.writing.minWords = 121; },
    unit => { unit.writing.maxWords = 1001; },
    unit => { unit.writing.minWords = 1.5; }
  ];
  for (const mutate of mutations) {
    const unit = sample();
    mutate(unit);
    assert.throws(() => validateUnit(unit), mutate.toString());
  }
  for (const unit of [null, [], {}, 'unit']) assert.throws(() => validateUnit(unit));
});

test('rejects external, encoded and traversing audio paths in all audio locations', () => {
  for (const unsafe of [
    'https://example.com/file.mp3', 'javascript:alert(1)', '/unit-001/audio/111.mp3',
    'unit-002/audio/111.mp3', 'unit-001/audio/../111.mp3', 'unit-001/audio/%2e%2e.mp3',
    'unit-001/audio/sub/111.mp3', 'unit-001/audio/111.mp3?token=secret', 'unit-001/audio/111.mp3#fragment',
    'unit-001/audio/111\\test.mp3', 'unit-001/audio/111.wav', 'unit-001/audio/.hidden.mp3', '', null
  ]) {
    for (const destination of ['question', 'example', 'review']) {
      const unit = sample();
      if (destination === 'question') unit.practice[0].questions[0].audio = unsafe;
      if (destination === 'example') unit.practice[0].examples[0].audio = unsafe;
      if (destination === 'review') unit.review[0].audio = unsafe;
      assert.throws(() => validateUnit(unit), `${destination}: ${unsafe}`);
    }
  }
});

test('listening only references unique practice questions with an audio recording', () => {
  for (const questionIds of [[], ['missing'], ['u1-review-q1'], ['u1-e2-q1'], ['u1-e1-q1', 'u1-e1-q1']]) {
    const unit = sample();
    unit.listening.questionIds = questionIds;
    assert.throws(() => validateUnit(unit));
  }
});

test('browser export works independently of CommonJS or browser storage', () => {
  const source = fs.readFileSync(path.join(__dirname, '../assets/js/grammar-core.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  assert.equal(typeof sandbox.window.GrammarCore.validateUnit, 'function');
  assert.equal(sandbox.window.GrammarCore.wordCount('Two words'), 2);
  assert.equal(sandbox.window.GrammarCore.evaluate(gap(), 'are using').correct, true);
});
