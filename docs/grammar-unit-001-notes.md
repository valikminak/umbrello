# Grammar Unit 1: content and import notes

This unit combines the owner's CD-ROM practice material with newly authored
teaching material. The supplied CD is the third-edition supplementary practice
disc. The book's theory pages were not supplied. The theory in this app is an
original explanation of the relevant language patterns, **not a transcription or
reconstruction of the book's explanation**.

## Build a private upload package

From the repository root, run:

```sh
python3 tools/build-grammar-unit.py \
  --source "/path/to/Advanced Grammar in Use with Answers CD-ROM"
```

The optional `--output` argument selects another private destination. The default
is `private/grammar-upload/`, excluded from Git. The builder reads XML and copies
MP3 files; it never runs EXE, AIR or SWF files and does not modify the source disc.
It uses only Python's standard library, without network access or API keys.

The package contains these storage object paths:

```text
unit-001.json
unit-001/audio/11e1.mp3
unit-001/audio/11e2.mp3
unit-001/audio/111.mp3 ... 1110.mp3
unit-001/audio/12e1.mp3
unit-001/audio/12e2.mp3
unit-001/audio/121.mp3 ... 1210.mp3
```

There are exactly 24 audio files. Copy this directory's contents to the configured
private storage bucket, retaining those paths. The JSON and recordings belong in
private storage, not in the public site's assets or repository. This tool does not
upload files, configure storage or deploy the application. If choosing a different
output directory inside the repository, exclude it from Git before building.

## What is imported

The two inputs are `learning_objects/01_tenses__units_18/0011tesp.xml` and
`learning_objects/01_tenses__units_18/0012mc.xml`. Together they supply:

- 20 source questions, ten per exercise;
- four worked examples, two per exercise;
- source instructions, unit title, accepted answers and model answers;
- 24 references to the original recordings, copied without transcoding.

Source text is converted from HTML to plain text. Formatting line breaks and
non-breaking spaces are normalised; visible words and answer variants are kept.
The literal escaped line break at the end of one source field is removed as a
layout artifact. Each question shows one `____` blank. Example headings are
removed, and worked examples display the accepted answer or alternatives.

The first exercise's repeated verb tokens are presented as one list of six unique
verbs. This changes the word-bank display, not the available vocabulary or the
answer key. The importer distinguishes actual questions from the headings and
layout placeholders that the CD also represents with XML `question` elements.

In exercise 2, questions 2, 5, 7 and 9 have **both options correct**. The importer
keeps both correctness flags. All alternatives encoded inside a gap with `|` are
also preserved. Learner-facing checking must not reduce these to a single answer.

## Newly authored material

`tools/grammar-unit-001.json` contains only new teaching material: six short theory
sections, original illustrative examples, 20 original explanations tied to source
question IDs, six listening selections, an independent writing task and five new
review questions. It contains no copied source exercise prompts or recordings.

The theory covers states and activities; changing meanings of think, have, see,
measure, fit, appear and expect; direct speech acts; and situations where both
present forms are appropriate. Avoid teaching the shortcut that a verb is always
stative or that a word such as now or every day determines the tense by itself.

The CD's closed answer key is preserved. In particular, its direct uses of confess
and refuse select the simple form. The explanations describe the intended reading
and do not claim that continuous forms of those verbs are impossible in all
contexts. Free writing should accept a valid alternative that expresses a coherent
meaning; it is a different activity from reproducing the CD answer key.

Listening reuses first-exercise questions 1, 2, 3, 5, 6 and 7. Each has a single
source answer and a directly associated recording, avoiding questions where the
recording might illustrate only one of several written alternatives. Learners see
the sentence with its gap; the task is to hear the missing form.

The writing task suggests **60–120 words** to keep the activity manageable. This is
guidance, not a hard grading limit. The five review questions are newly authored
and do not come from the CD's separate test-generator CSV.

## Validation and limits

The builder checks the schema, two exercises, 20 question IDs, four examples,
five review questions, six unambiguous listening references and 24 existing,
non-empty MP3 files before writing output. It rejects missing files, conflicting
audio names and references escaping the source directory. All source files are
parsed as data. Rebuilding replaces this unit's JSON and referenced recordings.

`node --test tests/grammar-import.test.cjs` exercises the CLI using entirely
invented XML and synthetic audio bytes in a temporary directory. It checks HTML
conversion, alternative answers, multiselect choices, counts, copied bytes and
failure before output when a recording is missing. It does not require the CD.

The package validation verifies references and bytes, not speech recognition or
the quality of the original recordings. Browser playback and the final private
storage/Worker integration are separate checks. For a new edition or a different
unit, do not reuse this importer without checking its source structure and answer
conventions.
