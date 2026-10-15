#!/usr/bin/env python3
"""Build the private Unit 1 upload package from an owned CD-ROM directory.

Uses only Python's standard library. Reads XML and copies referenced MP3 files;
never runs the CD software. Licensed source text is not embedded in this script.
"""

import argparse
from copy import deepcopy
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
import xml.etree.ElementTree as ET


REPO = Path(__file__).resolve().parent.parent
CONTENT_FILE = Path(__file__).with_name("grammar-unit-001.json")
SOURCE_FILES = (
    ("learning_objects/01_tenses__units_18/0011tesp.xml", "texttoitem_var1", "gap"),
    ("learning_objects/01_tenses__units_18/0012mc.xml", "mcq_compound", "choice"),
)
UNIT_ID = "unit-001"


class PlainTextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() in {"br", "p", "div", "li"}:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag.lower() in {"p", "div", "li"}:
            self.parts.append(" ")

    def handle_data(self, data):
        self.parts.append(data)


def plain_text(value):
    """Decode markup without collapsing adjacent inline words or keeping tags."""
    parser = PlainTextParser()
    # A few CD fields contain literal escaped line breaks as layout artifacts.
    parser.feed((value or "").replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\r", "\n"))
    parser.close()
    return " ".join("".join(parser.parts).split())


def require(condition, message):
    if not condition:
        raise ValueError(message)


def safe_source_path(source, relative):
    path = (source / relative).resolve()
    try:
        path.relative_to(source)
    except ValueError as error:
        raise ValueError("A source reference escapes the CD directory.") from error
    require(path.is_file(), "Missing source file: " + relative)
    return path


def audio_reference(question, source, audio_files):
    relative = question.findtext("audioURL", "").strip()
    require(bool(relative), "A source question or example has no audio reference.")
    original = safe_source_path(source, relative)
    require(original.suffix.lower() == ".mp3" and original.stat().st_size > 0,
            "Expected a non-empty MP3 file: " + relative)
    destination = f"{UNIT_ID}/audio/{original.name}"
    require(destination not in audio_files or audio_files[destination] == original,
            "Conflicting source audio filenames: " + original.name)
    audio_files[destination] = original
    return destination


def choice_options(question):
    rows = question.findall("./answers/answer")
    require(len(rows) == 2, "Unit 1 choices must contain exactly two options.")
    options = []
    for index, answer in enumerate(rows):
        flag = answer.findtext("isCorrect", "").strip().lower()
        require(flag in {"true", "false"}, "A choice is missing its correctness flag.")
        text = plain_text(answer.findtext("text"))
        require(bool(text), "An answer option is empty.")
        options.append({"id": chr(ord("a") + index), "text": text, "correct": flag == "true"})
    require(any(option["correct"] for option in options), "A choice has no correct option.")
    return options


def gap_parts(text):
    matches = list(re.finditer(r"\[([^\[\]]+)\]", text))
    require(len(matches) == 1, "Unit 1 gap items must contain exactly one answer field.")
    answers = [plain_text(answer) for answer in matches[0].group(1).split("|")]
    require(all(answers), "A gap has an empty accepted answer.")
    prompt = text[:matches[0].start()] + "____" + text[matches[0].end():]
    return prompt, answers


def exercise_page(path, object_type, question_type, number, source, authored, audio_files):
    page = ET.parse(path).getroot()
    exercise_id = f"exercise-{number}"
    instruction = plain_text(page.findtext("./objects/object[@linkID='rubric']/params/instruction_str"))
    title = plain_text(page.findtext("./objects/object[@linkID='exercise']/params/params_xml/at_heading"))
    require(bool(instruction) and bool(title), "An exercise title or instruction is missing.")
    word_bank = []
    for token in page.findall("./objects/object[@linkID='text_entry_scratch_pad']//token"):
        word = plain_text(token.text).strip("[]")
        if word and word not in word_bank:
            word_bank.append(word)
    result = {"id": exercise_id, "title": authored["exerciseTitles"][exercise_id],
              "instruction": instruction, "wordBank": word_bank, "examples": [], "questions": []}
    for obj in page.findall(f"./objects/object[@linkID='{object_type}']"):
        for question in obj.findall(".//question"):
            text = plain_text(question.findtext("text"))
            is_example = question.findtext("isExample", "false").strip().lower() == "true"
            # The CD also encodes headings and empty layout rows as questions.
            if question_type == "gap" and not re.search(r"\[[^\[\]]+\]", text):
                continue
            if question_type == "choice" and question.find("answers") is None:
                continue
            audio = audio_reference(question, source, audio_files)
            if is_example:
                if question_type == "gap":
                    prompt, answers = gap_parts(text)
                    worked = prompt.replace("____", " / ".join(answers))
                else:
                    options = choice_options(question)
                    answer = " / ".join(option["text"] for option in options if option["correct"])
                    worked, changes = re.subn(r"\.{3,}", lambda _: answer, text)
                    require(changes == 1, "A choice example must have exactly one blank.")
                worked = re.sub(r"^Example\s+\d+\s*", "", worked).strip()
                result["examples"].append({"text": worked, "audio": audio})
                continue
            identifier = f"u1-e{number}-q{len(result['questions']) + 1}"
            model_answer = plain_text(question.findtext("modelAnswerString"))
            explanation = authored["explanations"].get(identifier, "")
            require(bool(model_answer) and bool(explanation), "Missing answer or authored explanation: " + identifier)
            item = {"id": identifier, "type": question_type}
            if question_type == "gap":
                prompt, answers = gap_parts(text)
                item.update({"prompt": prompt, "answers": answers})
            else:
                prompt, changes = re.subn(r"\.{3,}", "____", text)
                require(changes == 1, "A choice question must have exactly one blank.")
                item.update({"prompt": prompt, "options": choice_options(question)})
            item.update({"modelAnswer": model_answer, "explanation": explanation, "audio": audio})
            result["questions"].append(item)
    require(len(result["questions"]) == 10 and len(result["examples"]) == 2,
            f"Expected ten questions and two examples in {exercise_id}.")
    return title, result


def validate_unit(unit, audio_files):
    expected_keys = {"schemaVersion", "id", "number", "title", "focus", "objectives", "theory",
                     "practice", "listening", "writing", "review"}
    require(set(unit) == expected_keys, "Unexpected unit schema fields.")
    require(unit["schemaVersion"] == 1 and unit["id"] == UNIT_ID and unit["number"] == 1,
            "Invalid unit identity.")
    require(isinstance(unit["title"], str) and bool(unit["title"].strip()), "Unit title is missing.")
    require(isinstance(unit["focus"], str) and bool(unit["focus"].strip()), "Unit focus is missing.")
    require(isinstance(unit["objectives"], list) and unit["objectives"] and
            all(isinstance(value, str) and value.strip() for value in unit["objectives"]), "Objectives are missing.")
    require(isinstance(unit["theory"], list) and unit["theory"], "Theory is missing.")
    for section in unit["theory"]:
        require(set(section) == {"title", "paragraphs", "examples"}, "Invalid theory section.")
        require(isinstance(section["title"], str) and section["title"].strip() and section["paragraphs"] and
                all(isinstance(value, str) and value.strip() for value in section["paragraphs"]), "Empty theory section.")
        for example in section["examples"]:
            require(set(example) == {"text", "note"} and all(isinstance(v, str) and v.strip() for v in example.values()),
                    "Invalid theory example.")
    require(len(unit["practice"]) == 2 and len(unit["review"]) == 5, "Incorrect exercise or review count.")
    ids = set()
    referenced_audio = set()

    def check_question(question, private_audio=False):
        common = {"id", "type", "prompt", "modelAnswer", "explanation"}
        require(question.get("type") in {"gap", "choice"}, "Unknown question type.")
        expected = common | ({"answers"} if question["type"] == "gap" else {"options"})
        if "audio" in question:
            expected.add("audio")
        require(set(question) == expected, "Unexpected question fields.")
        require(all(isinstance(question[key], str) and question[key].strip() for key in common), "Empty question text.")
        require(question["id"] not in ids, "Duplicate question ID.")
        ids.add(question["id"])
        require(question["prompt"].count("____") == 1, "Expected one visible blank per question.")
        if question["type"] == "gap":
            require(isinstance(question["answers"], list) and question["answers"] and
                    all(isinstance(answer, str) and answer.strip() for answer in question["answers"]), "Invalid gap answers.")
        else:
            options = question["options"]
            require(isinstance(options, list) and len(options) == 2 and
                    [option.get("id") for option in options] == ["a", "b"], "Invalid choice option IDs.")
            require(all(set(option) == {"id", "text", "correct"} and type(option["correct"]) is bool and
                        isinstance(option["text"], str) and option["text"].strip() for option in options), "Invalid options.")
            require(any(option["correct"] for option in options), "No correct choice.")
        if private_audio or "audio" in question:
            require(question.get("audio") in audio_files, "Missing question audio.")
            referenced_audio.add(question["audio"])

    for number, exercise in enumerate(unit["practice"], 1):
        require(set(exercise) == {"id", "title", "instruction", "wordBank", "examples", "questions"}, "Invalid exercise schema.")
        require(exercise["id"] == f"exercise-{number}" and len(exercise["questions"]) == 10 and
                len(exercise["examples"]) == 2, "Invalid exercise identity or counts.")
        for index, question in enumerate(exercise["questions"], 1):
            require(question["id"] == f"u1-e{number}-q{index}", "Invalid source question ID.")
            check_question(question, private_audio=True)
        for example in exercise["examples"]:
            require(set(example) == {"text", "audio"} and isinstance(example["text"], str) and example["text"].strip() and
                    example["audio"] in audio_files, "Invalid worked example.")
            referenced_audio.add(example["audio"])
    for question in unit["review"]:
        check_question(question)
    require(len(audio_files) == 24 and referenced_audio == set(audio_files), "Expected exactly 24 referenced audio files.")
    listening = unit["listening"]
    require(set(listening) == {"instruction", "questionIds"}, "Invalid listening schema.")
    question_lookup = {question["id"]: question for exercise in unit["practice"] for question in exercise["questions"]}
    selected = listening["questionIds"]
    require(len(selected) == 6 and len(set(selected)) == 6 and all(
        identifier in question_lookup and question_lookup[identifier]["type"] == "gap" and
        len(question_lookup[identifier]["answers"]) == 1 for identifier in selected), "Listening needs six unambiguous source gaps.")
    writing = unit["writing"]
    require(set(writing) == {"prompt", "checklist", "minWords", "maxWords"} and
            writing["minWords"] == 60 and writing["maxWords"] == 120, "Invalid writing schema.")
    require(isinstance(writing["prompt"], str) and writing["prompt"].strip() and writing["checklist"] and
            all(isinstance(value, str) and value.strip() for value in writing["checklist"]), "Writing guidance is missing.")


def build(source, output, authored):
    source = source.expanduser().resolve()
    output = output.expanduser().resolve()
    require(source.is_dir(), "The source CD directory does not exist.")
    require(output != source and source not in output.parents, "Choose an output directory outside the source CD.")
    audio_files = {}
    practice = []
    titles = []
    for number, (relative, object_type, question_type) in enumerate(SOURCE_FILES, 1):
        title, exercise = exercise_page(safe_source_path(source, relative), object_type, question_type,
                                       number, source, authored, audio_files)
        titles.append(title)
        practice.append(exercise)
    require(titles[0] == titles[1], "The two exercises have different unit titles.")
    unit = {"schemaVersion": 1, "id": UNIT_ID, "number": 1, "title": titles[0],
            **{key: deepcopy(authored[key]) for key in ("focus", "objectives", "theory")},
            "practice": practice,
            **{key: deepcopy(authored[key]) for key in ("listening", "writing", "review")}}
    validate_unit(unit, audio_files)
    # Finish all source/schema checks before creating output files.
    output.mkdir(parents=True, exist_ok=True)
    for destination, original in audio_files.items():
        target = output / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
    (output / f"{UNIT_ID}.json").write_text(json.dumps(unit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"unit": UNIT_ID, "questions": 20, "examples": 4, "reviewQuestions": 5,
            "listeningQuestions": 6, "audioFiles": len(audio_files), "output": str(output)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Path to the owned CD-ROM directory")
    parser.add_argument("--output", type=Path, default=REPO / "private/grammar-upload", help="Private upload directory")
    args = parser.parse_args()
    try:
        authored = json.loads(CONTENT_FILE.read_text(encoding="utf-8"))
        result = build(args.source, args.output, authored)
    except (OSError, ValueError, KeyError, TypeError, ET.ParseError) as error:
        parser.exit(1, f"Cannot build Grammar Unit 1: {error}\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
