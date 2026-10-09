(async function () {
  "use strict";
  const host = document.getElementById("listenApp");
  const profile = await Profiles.require(host);
  if (!profile) return;
  const lessonId = new URLSearchParams(location.search).get("lesson");
  const lessonListUrl = Profiles.url("listen.html");
  const menuUrl = Profiles.url("index.html");
  backTo(lessonId ? lessonListUrl : menuUrl);
  let lesson, video, ui, index = 0, phase = "ready", chosen = [], frame = 0, playRequest = 0;
  const translationKey = `listen.${profile.id}.translationUk`;

  function updateTranslation() {
    const text = phase === "answer" && ui.translationToggle.checked
      ? lesson.segments[index]?.translationUk : "";
    ui.translation.textContent = text || "";
    ui.translation.hidden = !text;
  }

  function message(text = "") {
    ui.status.textContent = text;
    ui.status.hidden = !text;
  }

  function controls() {
    ui.counter.textContent = `${Math.min(index + 1, lesson.segments.length)} / ${lesson.segments.length}`;
    ui.play.hidden = phase === "answer";
    ui.play.disabled = phase === "ready" && video.readyState < 1;
    ui.play.textContent = phase === "complete" ? "↻ Start again" : phase === "error" ? "Retry" : phase === "playing" ? "Pause" : "▶ Play";
    ui.repeat.hidden = ["ready", "error", "complete"].includes(phase) || index >= lesson.segments.length;
    video.setAttribute("aria-label", phase === "playing" ? "Pause video" : "Play video");
  }

  function stopFrames() {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function clearAnswer() {
    chosen = [];
    ui.answer.textContent = "";
    ui.bank.replaceChildren();
    ui.translation.textContent = "";
    ui.translation.hidden = true;
    ui.puzzle.hidden = true;
  }

  function finish() {
    phase = "complete";
    stopFrames();
    clearAnswer();
    controls();
    message("Complete ✓");
  }

  function showWords() {
    phase = "answer";
    stopFrames();
    video.pause();
    clearAnswer();
    const segment = lesson.segments[index];
    ListenCore.shuffledTokens(segment.words).forEach(token => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "listen-word";
      button.textContent = token.word;
      button.onclick = () => {
        if (phase !== "answer" || button.disabled) return;
        if (ListenCore.normalize(token.word) !== ListenCore.normalize(segment.words[chosen.length])) {
          button.classList.remove("wrong");
          void button.offsetWidth;
          button.classList.add("wrong");
          vibrate("error");
          return;
        }
        button.disabled = true;
        chosen.push(segment.words[chosen.length]);
        ui.answer.textContent = chosen.join(" ");
        if (chosen.length === segment.words.length) {
          vibrate("success");
          index++;
          clearAnswer();
          // Resume inside this click: no delay, reload, or seek between phrases.
          if (video.ended && index === lesson.segments.length) finish();
          else resume();
        }
      };
      ui.bank.append(button);
    });
    ui.puzzle.hidden = false;
    updateTranslation();
    controls();
    message();
  }

  function checkTime() {
    if (phase !== "playing" || video.seeking) return;
    if (index < lesson.segments.length && video.currentTime >= lesson.segments[index].end) showWords();
  }

  function watch() {
    stopFrames();
    checkTime();
    if (phase === "playing" && !video.paused) frame = requestAnimationFrame(watch);
  }

  function resume() {
    const request = ++playRequest;
    phase = "playing";
    controls();
    message();
    // Keep the current position, including instrumental breaks and the outro.
    const result = video.play();
    if (result) result.catch(() => {
      if (request !== playRequest || phase !== "playing") return;
      phase = "paused";
      stopFrames();
      controls();
      message("Tap Play to continue.");
    });
  }

  function pause() {
    if (phase !== "playing") return;
    ++playRequest;
    phase = "paused";
    stopFrames();
    video.pause();
    controls();
    message();
  }

  function toggle() {
    if (phase === "answer") return;
    if (phase === "playing") { pause(); return; }
    if (phase === "error") { location.reload(); return; }
    if (phase === "complete") {
      index = 0;
      clearAnswer();
      video.currentTime = 0;
    }
    resume();
  }

  function renderLesson() {
    host.innerHTML = `
      <nav class="listen-nav" aria-label="Lesson navigation">
        <a class="listen-back" href="${lessonListUrl}" aria-label="All lessons">←</a>
        <span class="counter" id="counter"></span>
      </nav>
      <div class="listen-player"><video id="lessonVideo" playsinline preload="auto" tabindex="0" aria-label="Play video"></video></div>
      <label class="listen-translation-toggle" lang="uk">
        <input type="checkbox" id="translationToggle" aria-controls="phraseTranslation">
        Переклад українською
      </label>
      <section id="puzzle" aria-label="Arrange the words" hidden>
        <p class="listen-translation" id="phraseTranslation" lang="uk" aria-live="polite" hidden></p>
        <div class="listen-answer" id="answer" aria-live="polite"></div>
        <div class="listen-words" id="wordBank"></div>
      </section>
      <div class="listen-actions">
        <button class="btn" id="playPhrase" disabled>▶ Play</button>
        <button class="btn ghost" id="repeatPhrase" hidden>↻ Repeat</button>
      </div>
      <p class="status listen-status" id="listenStatus" role="status" aria-live="polite" hidden></p>`;
    const el = id => document.getElementById(id);
    video = el("lessonVideo");
    ui = { counter: el("counter"), play: el("playPhrase"), repeat: el("repeatPhrase"),
      puzzle: el("puzzle"), answer: el("answer"), bank: el("wordBank"), status: el("listenStatus"),
      translationToggle: el("translationToggle"), translation: el("phraseTranslation") };
    try { ui.translationToggle.checked = localStorage.getItem(translationKey) === "true"; } catch (_) {}
    ui.translationToggle.onchange = () => {
      updateTranslation();
      try { localStorage.setItem(translationKey, String(ui.translationToggle.checked)); } catch (_) {}
    };
    ui.play.onclick = toggle;
    video.onclick = toggle;
    video.onkeydown = event => {
      if (event.key === " " || event.key === "Enter") { event.preventDefault(); toggle(); }
    };
    ui.repeat.onclick = () => {
      if (index >= lesson.segments.length) return;
      ++playRequest;
      phase = "paused";
      stopFrames();
      video.pause();
      clearAnswer();
      // Rewinding is only performed when explicitly requested with Repeat.
      video.currentTime = lesson.segments[index].start;
      resume();
    };
    video.addEventListener("loadedmetadata", () => {
      if (lesson.segments.at(-1).end > video.duration + 0.1) {
        phase = "error";
        controls();
        message("The video is shorter than this lesson. Check the video link.");
        return;
      }
      controls();
      message();
    });
    video.addEventListener("playing", () => {
      if (phase !== "playing") { video.pause(); return; }
      message();
      watch();
    });
    video.addEventListener("timeupdate", checkTime);
    video.addEventListener("seeked", () => { if (phase === "playing") watch(); });
    video.addEventListener("pause", () => {
      if (phase === "playing" && video.paused && !video.ended) pause();
    });
    video.addEventListener("waiting", () => { if (phase === "playing") message("Loading…"); });
    video.addEventListener("ended", () => {
      if (phase === "answer") return;
      if (index < lesson.segments.length) showWords();
      else finish();
    });
    video.addEventListener("error", () => {
      ++playRequest;
      phase = "error";
      stopFrames();
      video.pause();
      controls();
      message("Could not play the video. Check the connection and try again.");
    });
    video.src = lesson.video;
    controls();
    message("Loading…");
  }

  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  window.addEventListener("pagehide", pause);

  async function init() {
    try {
      const catalog = await loadJSON(Profiles.content("listen.json"));
      if (!Array.isArray(catalog)) throw new Error("The lesson list must be an array.");
      if (!catalog.length) { Profiles.empty(host, "Listen", "No listening lessons yet."); return; }
      if (!lessonId) {
        host.innerHTML = `<a class="listen-back" href="${menuUrl}">← Menu</a><h1>Listen</h1>
          <div class="menu">${catalog.map(item => `<a class="tile" href="${lessonListUrl}&lesson=${encodeURIComponent(item.id)}">
          <span class="ico">🎵</span><span><b>${esc(item.title)}</b></span></a>`).join("")}</div>`;
        return;
      }
      const entry = catalog.find(item => item.id === lessonId);
      if (!entry) throw new Error("Lesson not found.");
      lesson = ListenCore.validateLesson(await loadJSON(Profiles.content(entry.file)));
      renderLesson();
    } catch (error) {
      showError(host, error, () => location.reload());
      host.insertAdjacentHTML("afterbegin", `<a class="listen-back" href="${lessonListUrl}">← All lessons</a>`);
    }
  }
  init();
})();
