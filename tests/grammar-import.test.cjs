const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const script = path.join(root, 'tools/build-grammar-unit.py');
const pythonAvailable = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
const xml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[char]));

// This fixture is invented test content. It contains no CD exercise text or media.
function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'umbrello-grammar-import-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const source = path.join(temporary, 'source');
  const output = path.join(temporary, 'output');
  const xmlDirectory = path.join(source, 'learning_objects/01_tenses__units_18');
  const audioDirectory = path.join(source, 'learning_objects/assets');
  fs.mkdirSync(xmlDirectory, { recursive: true });
  fs.mkdirSync(audioDirectory, { recursive: true });
  for (const exercise of [1, 2]) {
    function question(index, example = false) {
      const basename = example ? `1${exercise}e${index}.mp3` : `1${exercise}${index}.mp3`;
      fs.writeFileSync(path.join(audioDirectory, basename), `ID3 synthetic fixture ${basename}`);
      const exampleLabel = example ? `<b>Example ${index}</b><br/>` : '';
      const gap = !example && index === 4 ? '[works|is working]' : '[works]';
      const text = exercise === 1
        ? `The <b>fixture&nbsp;item</b> ${gap} &amp; stays ready.<br/>Next line.`
        : `${exampleLabel}Test component ${index} ...... correctly.`;
      const modelAnswer = exercise === 1 ? 'The fixture item works & stays ready. Next line.' : 'Test component works correctly.';
      const options = exercise === 2 ? `<answers>
        <answer><text>works</text><isCorrect>true</isCorrect></answer>
        <answer><text>is working</text><isCorrect>${index === 2}</isCorrect></answer>
      </answers>` : '';
      return `<question><text>${xml(text)}</text><isExample>${example}</isExample>
        <audioURL>learning_objects/assets/${basename}</audioURL>
        <modelAnswerString>${xml(modelAnswer)}</modelAnswerString>${options}</question>`;
    }
    const type = exercise === 1 ? 'texttoitem_var1' : 'mcq_compound';
    const tokens = exercise === 1 ? '<object linkID="text_entry_scratch_pad"><params><tokens><token>[work]</token><token>work</token></tokens></params></object>' : '';
    const body = `<page><objects>
      <object linkID="exercise"><params><params_xml><at_heading>Fixture title</at_heading></params_xml></params></object>
      <object linkID="rubric"><params><instruction_str>${xml('<p>Complete the <b>test</b> items.</p>')}</instruction_str></params></object>
      ${tokens}<object linkID="${type}"><params><params_xml><mcq_xml><question_xml>
        <question><text>Example heading only</text><isExample>false</isExample></question>
        ${question(1, true)}${question(2, true)}
        ${Array.from({ length: 10 }, (_, index) => question(index + 1)).join('')}
      </question_xml></mcq_xml></params_xml></params></object>
    </objects></page>`;
    fs.writeFileSync(path.join(xmlDirectory, exercise === 1 ? '0011tesp.xml' : '0012mc.xml'), body);
  }
  const run = extra => spawnSync('python3', [script, '--source', source, '--output', output, ...(extra || [])], { encoding: 'utf8' });
  return { source, output, audioDirectory, run };
}

test('Grammar importer creates the complete schema from XML, preserving alternatives and original MP3 bytes', { skip: !pythonAvailable }, t => {
  const app = fixture(t);
  const process = app.run();
  assert.equal(process.status, 0, process.stderr);
  const report = JSON.parse(process.stdout);
  assert.equal(report.questions, 20);
  assert.equal(report.audioFiles, 24);
  const unit = JSON.parse(fs.readFileSync(path.join(app.output, 'unit-001.json'), 'utf8'));
  assert.equal(unit.schemaVersion, 1);
  assert.equal(unit.id, 'unit-001');
  assert.equal(unit.title, 'Fixture title');
  assert.equal(unit.practice.length, 2);
  assert.equal(unit.practice.flatMap(exercise => exercise.questions).length, 20);
  assert.equal(unit.practice.flatMap(exercise => exercise.examples).length, 4);
  assert.deepEqual(unit.practice[0].wordBank, ['work']);
  const first = unit.practice[0].questions[0];
  assert.equal(first.prompt, 'The fixture item ____ & stays ready. Next line.');
  assert.deepEqual(unit.practice[0].questions[3].answers, ['works', 'is working']);
  assert.deepEqual(unit.practice[1].questions[1].options.map(option => option.correct), [true, true]);
  assert.doesNotMatch(unit.practice[1].examples[1].text, /Example 2|<|\.\.\./);
  assert.match(unit.practice[1].examples[1].text, /works \/ is working/);
  assert.equal(unit.review.length, 5);
  assert.equal(unit.listening.questionIds.length, 6);
  const questions = new Map(unit.practice.flatMap(exercise => exercise.questions).map(question => [question.id, question]));
  for (const id of unit.listening.questionIds) {
    assert.equal(questions.get(id).type, 'gap');
    assert.equal(questions.get(id).answers.length, 1);
    assert.ok(fs.existsSync(path.join(app.output, questions.get(id).audio)));
  }
  const audioFiles = fs.readdirSync(path.join(app.output, 'unit-001/audio'));
  assert.equal(audioFiles.length, 24);
  for (const name of audioFiles) {
    assert.deepEqual(fs.readFileSync(path.join(app.output, 'unit-001/audio', name)), fs.readFileSync(path.join(app.audioDirectory, name)));
  }
  assert.match(unit.writing.prompt, /guide, not a pass-or-fail limit/);
  assert.deepEqual([unit.writing.minWords, unit.writing.maxWords], [60, 120]);
});

test('Grammar importer rejects a missing recording before producing a partial upload package', { skip: !pythonAvailable }, t => {
  const app = fixture(t);
  fs.unlinkSync(path.join(app.audioDirectory, '1210.mp3'));
  const process = app.run();
  assert.equal(process.status, 1);
  assert.match(process.stderr, /Missing source file/);
  assert.equal(fs.existsSync(app.output), false);
});

test('Grammar importer refuses to write into the source CD directory', { skip: !pythonAvailable }, t => {
  const app = fixture(t);
  const process = app.run(['--output', path.join(app.source, 'generated')]);
  assert.equal(process.status, 1);
  assert.match(process.stderr, /outside the source CD/);
  assert.equal(fs.existsSync(path.join(app.source, 'generated')), false);
});
