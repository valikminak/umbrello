(async function () {
"use strict";
const app = document.getElementById("app");
const profile = await Profiles.require(app);
if (!profile) return;
const menuUrl = Profiles.url("index.html");
backTo(menuUrl);

let questions = [];

async function load() {
  try {
    const data = await loadJSON(Profiles.content("test.json"));
    questions = data.filter(x => x && x.q && x.right && Array.isArray(x.wrong));
    if (!questions.length) { Profiles.empty(app, "Test", "No tests yet."); return; }
    start();
  } catch (e) {
    showError(app, e, load);
  }
}

function start() {
  runQuiz(app, questions, finish);
}

function finish(r) {
  app.innerHTML = quizSummaryHTML(r);
  const status = app.querySelector("#status"), retry = app.querySelector("#retry");
  app.querySelector("#again").onclick = start;
  app.querySelector("#menu").onclick = () => { location.href = menuUrl; };
  const send = () => sendReport("📝 Тест", quizReportText(r), status, retry);
  retry.onclick = send;
  send();
}

load();
})();
