/* Shared by the page and Node tests. No storage, network or build step. */
(function (root) {
  "use strict";

  const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
  const UNIT_ID = /^unit-\d{3}$/;
  const NEGATIVES = {
    "can't": "can not", "won't": "will not", "shan't": "shall not",
    "isn't": "is not", "aren't": "are not", "wasn't": "was not", "weren't": "were not",
    "don't": "do not", "doesn't": "does not", "didn't": "did not",
    "haven't": "have not", "hasn't": "has not", "hadn't": "had not",
    "couldn't": "could not", "wouldn't": "would not", "shouldn't": "should not",
    "mustn't": "must not", "needn't": "need not", "mightn't": "might not", "daren't": "dare not"
  };

  function normalizeAnswer(value) {
    if (typeof value !== "string") return "";
    let answer = value.normalize("NFKC").replace(/[’‘ʼ]/g, "'").toLowerCase().trim();
    // Ignore sentence punctuation and quotation marks around an answer. Keep
    // internal punctuation, and preserve a possessive apostrophe at the end.
    const edgePunctuation = /^[\s.,!?;:"“”„«»()[\]{}…]+|[\s.,!?;:"“”„«»()[\]{}…]+$/g;
    answer = answer.replace(edgePunctuation, "");
    if (answer.length > 1 && answer.startsWith("'") && answer.endsWith("'")) answer = answer.slice(1, -1).trim();
    answer = answer.replace(edgePunctuation, "");
    answer = answer.replace(/\b(?:can't|won't|shan't|isn't|aren't|wasn't|weren't|don't|doesn't|didn't|haven't|hasn't|hadn't|couldn't|wouldn't|shouldn't|mustn't|needn't|mightn't|daren't)\b/g,
      contraction => NEGATIVES[contraction]);
    // 's and 'd have several meanings, so they require explicit answer keys.
    return answer.replace(/\bcannot\b/g, "can not")
      .replace(/\bi'm\b/g, "i am")
      .replace(/\b([a-z]+)'re\b/g, "$1 are")
      .replace(/\b([a-z]+)'ve\b/g, "$1 have")
      .replace(/\b([a-z]+)'ll\b/g, "$1 will")
      .replace(/\s+/g, " ").trim();
  }

  function wordCount(value) {
    if (typeof value !== "string") return 0;
    return (value.replace(/[’‘ʼ]/g, "'").match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) || []).length;
  }

  function object(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    return value;
  }

  function string(value, label, max = 2000, allowEmpty = false) {
    if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) {
      throw new Error(`${label} must be ${allowEmpty ? "" : "non-empty "}text of at most ${max} characters.`);
    }
    return value.trim();
  }

  function list(value, label, min, max) {
    if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${label} must contain ${min}–${max} items.`);
    return value;
  }

  function id(value, label) {
    if (typeof value !== "string" || !ID.test(value)) throw new Error(`${label} is invalid.`);
    return value;
  }

  function audio(value, unitId, label) {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.startsWith(`${unitId}/audio/`) ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}\.mp3$/.test(value.slice(`${unitId}/audio/`.length))) {
      throw new Error(`${label} must point to an MP3 inside this unit's audio folder.`);
    }
    return value;
  }

  function validateQuestion(value, unitId, seen, label) {
    object(value, label);
    const questionId = id(value.id, `${label} id`);
    if (seen.has(questionId)) throw new Error(`Duplicate question id: ${questionId}.`);
    seen.add(questionId);
    if (value.type !== "gap" && value.type !== "choice") throw new Error(`${label} has an unsupported question type.`);
    const question = {
      id: questionId,
      type: value.type,
      prompt: string(value.prompt, `${label} prompt`, 4000),
      modelAnswer: string(value.modelAnswer, `${label} model answer`, 4000),
      explanation: string(value.explanation, `${label} explanation`, 4000)
    };
    if (question.type === "gap") {
      if (!question.prompt.includes("____")) throw new Error(`${label} needs a ____ gap.`);
      question.answers = list(value.answers, `${label} answers`, 1, 20)
        .map((answer, index) => string(answer, `${label} answer ${index + 1}`, 1000));
      if (question.answers.some(answer => !normalizeAnswer(answer))) throw new Error(`${label} has an empty answer.`);
    } else {
      const optionIds = new Set();
      question.options = list(value.options, `${label} options`, 2, 20).map((option, index) => {
        const optionLabel = `${label} option ${index + 1}`;
        object(option, optionLabel);
        const optionId = id(option.id, `${optionLabel} id`);
        if (optionIds.has(optionId)) throw new Error(`${label} has a duplicate option id.`);
        optionIds.add(optionId);
        if (typeof option.correct !== "boolean") throw new Error(`${optionLabel} needs a boolean correct field.`);
        return { id: optionId, text: string(option.text, `${optionLabel} text`, 2000), correct: option.correct };
      });
      if (!question.options.some(option => option.correct)) throw new Error(`${label} needs at least one correct option.`);
    }
    const audioPath = audio(value.audio, unitId, `${label} audio`);
    if (audioPath !== undefined) question.audio = audioPath;
    return question;
  }

  function validateUnit(value) {
    object(value, "Unit");
    if (value.schemaVersion !== 1) throw new Error("Unsupported grammar unit schema.");
    if (typeof value.id !== "string" || !UNIT_ID.test(value.id) || !Number.isInteger(value.number) ||
        value.number < 1 || value.number > 999 || value.number !== Number(value.id.slice(5))) {
      throw new Error("Unit id and number must match.");
    }
    const unit = {
      schemaVersion: 1,
      id: value.id,
      number: value.number,
      title: string(value.title, "Unit title", 250),
      focus: string(value.focus, "Unit focus", 1200),
      objectives: list(value.objectives, "Objectives", 1, 20).map((item, index) => string(item, `Objective ${index + 1}`, 1000)),
      theory: list(value.theory, "Theory", 1, 30).map((section, index) => {
        const label = `Theory section ${index + 1}`;
        object(section, label);
        return {
          title: string(section.title, `${label} title`, 250),
          paragraphs: list(section.paragraphs, `${label} paragraphs`, 1, 20).map(item => string(item, `${label} paragraph`, 6000)),
          examples: list(section.examples, `${label} examples`, 0, 20).map(example => {
            object(example, `${label} example`);
            return { text: string(example.text, `${label} example text`, 2000), note: string(example.note, `${label} example note`, 2000, true) };
          })
        };
      })
    };
    const questionIds = new Set();
    const exerciseIds = new Set();
    unit.practice = list(value.practice, "Practice", 1, 20).map((exercise, index) => {
      const label = `Exercise ${index + 1}`;
      object(exercise, label);
      const exerciseId = id(exercise.id, `${label} id`);
      if (exerciseIds.has(exerciseId)) throw new Error(`Duplicate exercise id: ${exerciseId}.`);
      exerciseIds.add(exerciseId);
      return {
        id: exerciseId,
        title: string(exercise.title, `${label} title`, 250),
        instruction: string(exercise.instruction, `${label} instruction`, 2000),
        wordBank: list(exercise.wordBank, `${label} word bank`, 0, 100).map(item => string(item, `${label} word bank item`, 200)),
        examples: list(exercise.examples, `${label} examples`, 0, 20).map(example => {
          object(example, `${label} example`);
          const result = { text: string(example.text, `${label} example text`, 4000) };
          const audioPath = audio(example.audio, unit.id, `${label} example audio`);
          if (audioPath !== undefined) result.audio = audioPath;
          return result;
        }),
        questions: list(exercise.questions, `${label} questions`, 1, 100)
          .map((question, questionIndex) => validateQuestion(question, unit.id, questionIds, `${label}, question ${questionIndex + 1}`))
      };
    });
    object(value.listening, "Listening");
    const practiceById = new Map(allQuestions(unit).map(question => [question.id, question]));
    const listeningIds = new Set();
    unit.listening = {
      instruction: string(value.listening.instruction, "Listening instruction", 2000),
      questionIds: list(value.listening.questionIds, "Listening questions", 1, 100).map(questionId => {
        id(questionId, "Listening question id");
        if (!practiceById.has(questionId) || !practiceById.get(questionId).audio || listeningIds.has(questionId)) {
          throw new Error("Listening must reference unique practice questions with audio.");
        }
        listeningIds.add(questionId);
        return questionId;
      })
    };
    object(value.writing, "Writing");
    if (!Number.isInteger(value.writing.minWords) || !Number.isInteger(value.writing.maxWords) ||
        value.writing.minWords < 1 || value.writing.maxWords < value.writing.minWords || value.writing.maxWords > 1000) {
      throw new Error("Writing word limits must be whole numbers from 1 to 1000 in increasing order.");
    }
    unit.writing = {
      prompt: string(value.writing.prompt, "Writing prompt", 4000),
      checklist: list(value.writing.checklist, "Writing checklist", 1, 20).map(item => string(item, "Writing checklist item", 1000)),
      minWords: value.writing.minWords,
      maxWords: value.writing.maxWords
    };
    unit.review = list(value.review, "Review", 1, 30)
      .map((question, index) => validateQuestion(question, unit.id, questionIds, `Review question ${index + 1}`));
    return unit;
  }

  function evaluate(question, response) {
    if (!question || typeof question !== "object") return { correct: false };
    if (question.type === "gap") {
      const normalized = normalizeAnswer(response);
      return { correct: Boolean(normalized) && Array.isArray(question.answers) &&
        question.answers.some(answer => normalizeAnswer(answer) === normalized) };
    }
    if (question.type === "choice" && Array.isArray(question.options) && Array.isArray(response)) {
      const selected = new Set(response);
      const allowed = new Set(question.options.map(option => option.id));
      const correct = question.options.filter(option => option.correct).map(option => option.id);
      return { correct: correct.length > 0 && selected.size === response.length && response.length === correct.length &&
        response.every(optionId => typeof optionId === "string" && allowed.has(optionId)) &&
        correct.every(optionId => selected.has(optionId)) };
    }
    return { correct: false };
  }

  function allQuestions(unit) {
    return unit.practice.flatMap(exercise => exercise.questions);
  }

  const api = { validateUnit, normalizeAnswer, evaluate, wordCount, allQuestions };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GrammarCore = api;
})(typeof window !== "undefined" ? window : globalThis);
