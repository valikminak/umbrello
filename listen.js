(function () {
  "use strict";
  const host = document.getElementById("listenApp");
  const lessonId = new URLSearchParams(location.search).get("lesson");
  backTo(lessonId ? "listen.html" : "index.html");
  let lesson, player, ready = false, index = 0, chosen = [], tokens = [];
  let phase = "idle", heard = false, playing = false, timer, startupTimer;

  function status(message, kind = "") {
    const el = document.getElementById("listenStatus");
    if (el) { el.textContent = message; el.className = "status listen-status " + kind; el.hidden = !message; }
  }

  function stop() {
    clearInterval(timer);
    playing = false;
    if (ready) player.pauseVideo();
  }

  function fail(message) {
    clearTimeout(startupTimer);
    stop();
    ready = false;
    phase = "error";
    status(message, "bad");
    document.getElementById("playPhrase").disabled = true;
    document.getElementById("pausePhrase").hidden = true;
    document.getElementById("retryPlayer").hidden = false;
    document.getElementById("videoLink").hidden = false;
  }

  function renderWords() {
    const bank = document.getElementById("wordBank");
    bank.replaceChildren();
    tokens.forEach(token => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "listen-word";
      button.textContent = token.word;
      button.disabled = chosen.some(item => item.id === token.id);
      button.onclick = () => {
        if (phase !== "answer" || button.disabled) return;
        const segment = lesson.segments[index];
        if (token.word !== segment.words[chosen.length]) {
          button.classList.remove("wrong");
          void button.offsetWidth;
          button.classList.add("wrong");
          vibrate("error");
          return;
        }
        chosen.push(token);
        document.getElementById("answer").textContent = chosen.map(item => item.word).join(" ");
        status("");
        if (chosen.length === segment.words.length) {
          phase = "solved";
          document.getElementById("answer").textContent = segment.text;
          const next = document.getElementById("nextPhrase");
          next.hidden = false;
          next.textContent = index + 1 < lesson.segments.length ? "Next →" : "Finish ✓";
          document.getElementById("answer").classList.add("correct");
          vibrate("success");
        }
        renderWords();
      };
      bank.append(button);
    });
  }

  function prepare() {
    stop();
    phase = "idle";
    heard = false;
    chosen = [];
    tokens = ListenCore.shuffledTokens(lesson.segments[index].words);
    document.getElementById("counter").textContent = `${index + 1} / ${lesson.segments.length}`;
    document.getElementById("answer").textContent = "";
    document.getElementById("answer").classList.remove("correct");
    document.getElementById("puzzle").hidden = true;
    document.getElementById("nextPhrase").hidden = true;
    document.getElementById("pausePhrase").hidden = true;
    const button = document.getElementById("playPhrase");
    button.textContent = "▶ Listen";
    button.disabled = !ready;
    renderWords();
    status(ready ? "" : "Loading…");
  }

  function endPhrase() {
    stop();
    heard = true;
    phase = chosen.length === lesson.segments[index].words.length ? "solved" : "answer";
    document.getElementById("puzzle").hidden = false;
    document.getElementById("pausePhrase").hidden = true;
    document.getElementById("playPhrase").textContent = "↻ Listen again";
    status("");
  }

  function playPhrase() {
    if (!ready) return;
    // Replay is a new attempt, including after a correct answer.
    prepare();
    phase = "listening";
    document.getElementById("puzzle").hidden = true;
    document.getElementById("pausePhrase").hidden = false;
    document.getElementById("playPhrase").textContent = "↻ Listen again";
    const segment = lesson.segments[index];
    // Passing endSeconds also lets YouTube stop the clip if browser timers lag.
    player.loadVideoById({ videoId: lesson.videoId, startSeconds: segment.start, endSeconds: segment.end });
  }

  function onState(event) {
    if (!ready) return;
    if (event.data === YT.PlayerState.PLAYING) {
      if (phase === "complete") { stop(); return; }
      playing = true;
      phase = "listening";
      document.getElementById("puzzle").hidden = true;
      document.getElementById("pausePhrase").hidden = false;
      status("");
      clearInterval(timer);
      timer = setInterval(() => {
        if (player.getCurrentTime() >= lesson.segments[index].end) endPhrase();
      }, 80);
    } else if (event.data === YT.PlayerState.ENDED) {
      endPhrase();
    } else if (event.data === YT.PlayerState.PAUSED) {
      clearInterval(timer);
      playing = false;
      if (phase !== "listening") return;
      if (player.getCurrentTime() >= lesson.segments[index].end - 0.15) endPhrase();
      else {
        phase = heard ? "answer" : "idle";
        document.getElementById("puzzle").hidden = !heard;
        document.getElementById("pausePhrase").hidden = true;
        status("");
        document.getElementById("playPhrase").textContent = "↻ Listen again";
      }
    } else if (event.data === YT.PlayerState.BUFFERING) {
      clearInterval(timer);
      status("Buffering…");
    }
  }

  function loadPlayer() {
    startupTimer = setTimeout(() => fail("YouTube is taking too long to load. Retry or open the video on YouTube."), 20000);
    window.onYouTubeIframeAPIReady = () => {
      if (phase === "error") return;
      player = new YT.Player("youtubePlayer", {
        videoId: lesson.videoId,
        width: "100%", height: "100%",
        playerVars: { autoplay: 0, playsinline: 1, rel: 0, origin: location.origin },
        events: {
          onReady: () => {
            if (phase === "error") return;
            clearTimeout(startupTimer);
            ready = true;
            player.cueVideoById({ videoId: lesson.videoId, startSeconds: lesson.segments[index].start, endSeconds: lesson.segments[index].end });
            prepare();
          },
          onStateChange: onState,
          onAutoplayBlocked: () => status("Tap ▶ in the video."),
          onError: event => {
            const messages = {
              2: "YouTube could not read this video link.",
              5: "This video cannot play in this browser.",
              100: "This video is unavailable or private.",
              101: "YouTube blocked embedded playback of this video. Try another video or open it on YouTube.",
              150: "YouTube blocked embedded playback of this video. Try another video or open it on YouTube.",
              153: "YouTube could not verify this browser. Try opening this lesson in Safari or Chrome."
            };
            fail(messages[event.data] || "YouTube could not play this video. Please retry.");
          }
        }
      });
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => fail("Could not connect to YouTube. Check your connection and retry.");
    document.head.append(script);
  }

  function renderLesson() {
    host.innerHTML = `
      <nav class="listen-nav" aria-label="Lesson navigation">
        <a class="listen-back" href="listen.html" aria-label="All lessons">←</a>
        <span class="counter" id="counter" aria-label="Phrase"></span>
      </nav>
      <div class="listen-player"><div id="youtubePlayer"></div></div>
      <section id="puzzle" aria-label="Arrange the words" hidden>
        <div class="listen-answer" id="answer" aria-live="polite"></div>
        <div class="listen-words" id="wordBank"></div>
      </section>
      <div class="listen-actions">
        <button class="btn ghost" id="playPhrase" disabled>▶ Listen</button>
        <button class="btn ghost" id="pausePhrase" hidden>Pause</button>
        <button class="btn" id="nextPhrase" hidden></button>
      </div>
      <p class="status listen-status" id="listenStatus" role="status" aria-live="polite" hidden></p>
      <button class="btn ghost" id="retryPlayer" hidden>Retry player</button>
      <a class="listen-external" id="videoLink" href="https://www.youtube.com/watch?v=${lesson.videoId}" target="_blank" rel="noopener noreferrer" hidden>Open on YouTube ↗</a>`;
    document.getElementById("playPhrase").onclick = playPhrase;
    document.getElementById("pausePhrase").onclick = stop;
    document.getElementById("retryPlayer").onclick = () => location.reload();
    document.getElementById("nextPhrase").onclick = () => {
      stop();
      if (index + 1 < lesson.segments.length) {
        index++;
        playPhrase();
      } else {
        phase = "complete";
        document.getElementById("nextPhrase").hidden = true;
        const button = document.getElementById("playPhrase");
        button.textContent = "↻ Try again";
        button.onclick = () => { index = 0; button.onclick = playPhrase; playPhrase(); };
        status("Complete ✓", "ok");
      }
    };
    prepare();
    loadPlayer();
  }

  document.addEventListener("visibilitychange", () => { if (document.hidden && ready && playing) stop(); });
  window.addEventListener("pagehide", () => { clearTimeout(startupTimer); stop(); });

  async function init() {
    try {
      const catalog = await loadJSON("listen.json");
      if (!Array.isArray(catalog)) throw new Error("The lesson list must be an array.");
      if (!lessonId) {
        host.innerHTML = `<a class="listen-back" href="index.html">← Menu</a><h1>Listen</h1>
          <div class="menu">${catalog.map(item => `
          <a class="tile" href="listen.html?lesson=${encodeURIComponent(item.id)}"><span class="ico">🎵</span>
          <span><b>${esc(item.title)}</b></span></a>`).join("")}</div>`;
        if (!catalog.length) host.insertAdjacentHTML("beforeend", '<p class="sub">No lessons yet.</p>');
        return;
      }
      const entry = catalog.find(item => item.id === lessonId);
      if (!entry) throw new Error("Lesson not found. Return to the lesson list.");
      lesson = ListenCore.validateLesson(await loadJSON(entry.file));
      renderLesson();
    } catch (error) {
      showError(host, error, () => location.reload());
      host.insertAdjacentHTML("afterbegin", '<a class="listen-back" href="listen.html">← All lessons</a>');
    }
  }
  init();
})();
