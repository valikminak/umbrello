/* Grammar level test rules. Shared by the page and Node tests. No dependencies or build step. */
(function (root) {
  "use strict";
  const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const NAMES = { A1: "Beginner", A2: "Elementary", B1: "Intermediate", B2: "Upper-Intermediate", C1: "Advanced", C2: "Proficiency" };
  const PER_LEVEL = 8;
  const PASS = 6;

  const filled = value => typeof value === "string" && value.trim() !== "";

  // Returns the questions grouped by level, in file order, or throws a message naming the question.
  function validateTest(data) {
    if (!Array.isArray(data)) throw new Error("The level test must be a list of questions.");
    const blocks = LEVELS.map(() => []);
    data.forEach((item, index) => {
      const fail = problem => { throw new Error(`Check question ${index + 1}: ${problem}`); };
      const level = LEVELS.indexOf(item?.level);
      if (level < 0) fail(`level must be one of ${LEVELS.join(", ")}.`);
      if (typeof item.q !== "string" || item.q.split("___").length !== 2) fail("the sentence needs exactly one ___ gap.");
      const options = [item.right, ...(Array.isArray(item.wrong) ? item.wrong : [])];
      if (!Array.isArray(item.wrong) || item.wrong.length !== 3 || !options.every(filled) ||
          new Set(options.map(option => option.trim().toLowerCase())).size !== 4) {
        fail("give one right and three different wrong answers.");
      }
      if (!filled(item.topic)) fail("add a topic.");
      if (!filled(item.explain)) fail("add an explanation.");
      blocks[level].push({ level: item.level, topic: item.topic.trim(), q: item.q.trim(), right: item.right.trim(),
        wrong: item.wrong.map(option => option.trim()), explain: item.explain.trim() });
    });
    blocks.forEach((block, i) => {
      if (block.length !== PER_LEVEL) throw new Error(`Level ${LEVELS[i]} needs exactly ${PER_LEVEL} questions.`);
    });
    return blocks;
  }

  // scores: right answers on each level taken, in order. The test stops at the first level below PASS,
  // so the result is the last level passed; five of eight on the next one reads as "close to" it.
  function placement(scores) {
    const missed = scores.findIndex(score => score < PASS);
    const passed = missed < 0 ? scores.length : missed;
    const level = passed ? LEVELS[passed - 1] : null;
    return { level, name: level ? NAMES[level] : "Starter", next: LEVELS[passed] || null, close: scores[missed] === PASS - 1 };
  }

  // answers: { level, topic, correct } for every question asked; "I don't know" is not correct.
  function summary(answers) {
    const scores = LEVELS.map(level => answers.filter(answer => answer.level === level))
      .filter(taken => taken.length).map(taken => taken.filter(answer => answer.correct).length);
    const topics = [...new Set(answers.filter(answer => !answer.correct).map(answer => answer.topic))];
    return { scores, ...placement(scores), answered: answers.length, topics };
  }

  function reportText(result, minutes) {
    const level = `${result.level || "Pre-A1"} (${result.name})${result.close ? `, близько до ${result.next}` : ""}`;
    return [
      `Рівень граматики: ${level}`,
      result.scores.map((score, i) => `${LEVELS[i]} ${score}/${PER_LEVEL}`).join(" · "),
      `Відповідей: ${result.answered} · час: ${Math.max(1, minutes)} хв`,
      result.topics.length ? `Над чим попрацювати: ${result.topics.join("; ")}` : "Помилок немає",
    ].join("\n");
  }

  const api = { LEVELS, NAMES, PER_LEVEL, PASS, validateTest, placement, summary, reportText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GrammarCore = api;
})(typeof window !== "undefined" ? window : globalThis);
