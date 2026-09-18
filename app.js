const tg = window.Telegram && window.Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const vibrate = t => { try { tg && tg.HapticFeedback.notificationOccurred(t); } catch (e) {} };
const speak = text => { try { const u = new SpeechSynthesisUtterance(text); u.lang = "en-US"; u.rate = .9; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {} };

function backTo(url) {
  if (!tg || !tg.BackButton) return;
  tg.BackButton.show();
  tg.BackButton.onClick(() => { location.href = url; });
}

async function loadJSON(file) {
  const res = await fetch(file + "?t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error(file + " — " + res.status);
  return res.json();
}

function showError(host, e, retry) {
  host.innerHTML = `<div class="center"><h2>Не вдалося завантажити</h2>
    <p class="sub">${esc(e.message)}</p><button class="btn" id="rt">Спробувати ще раз</button></div>`;
  host.querySelector("#rt").onclick = retry;
}

async function sendReport(title, text, statusEl, retryEl) {
  if (statusEl) { statusEl.className = "status"; statusEl.textContent = "Sending result…"; }
  if (retryEl) retryEl.style.display = "none";
  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: tg ? tg.initData : "", title, text })
    });
    if (!res.ok) throw new Error(res.status);
    if (statusEl) { statusEl.className = "status ok"; statusEl.textContent = "Result sent to teacher ✓"; }
    return true;
  } catch (e) {
    if (statusEl) { statusEl.className = "status bad"; statusEl.textContent = "Couldn't send the result."; }
    if (retryEl) retryEl.style.display = "block";
    return false;
  }
}

function runQuiz(host, list, onDone) {
  let questions = shuffle(list), index = 0, mistakes = 0, log = [], tries = 0;

  function show() {
    const item = questions[index];
    tries = 0;
    const opts = shuffle([item.right, ...item.wrong]);
    const long = String(item.q).length > 90 ? " long" : "";
    host.innerHTML = `
      <div class="top">
        <span class="counter">${index + 1} / ${questions.length}</span>
        <div class="bar"><i style="width:${index / questions.length * 100}%"></i></div>
      </div>
      <div class="question${long}">${esc(item.q)}</div>
      <div class="options">${opts.map((o, i) => `<button class="opt" data-i="${i}">${esc(o)}</button>`).join("")}</div>
      <div class="msg" id="msg"></div>`;
    host.querySelectorAll(".opt").forEach(btn => {
      btn.onclick = () => choose(btn, opts[btn.dataset.i], item);
    });
  }

  function choose(btn, value, item) {
    if (btn.disabled) return;
    if (value === item.right) {
      btn.classList.add("right");
      host.querySelectorAll(".opt").forEach(b => b.disabled = true);
      vibrate("success");
      if (tries > 0) log.push({ q: item.q, right: item.right, tries });
      setTimeout(() => {
        index++;
        if (index < questions.length) show();
        else onDone({ total: questions.length, firstTry: questions.length - log.length, mistakes, log });
      }, 450);
    } else {
      tries++; mistakes++;
      btn.classList.add("wrong");
      btn.disabled = true;
      vibrate("error");
      host.querySelector("#msg").textContent = "Wrong. Try again!";
    }
  }

  show();
}

function quizSummaryHTML(r) {
  return `<div class="center">
    <h2>Well done!</h2>
    <div class="big">${r.firstTry} / ${r.total}</div>
    <p class="sub">first try · mistakes: ${r.mistakes}</p>
    ${r.log.length ? `<div class="mistakes">${r.log.map(m =>
      `<div>${esc(m.q)}<br><b>${esc(m.right)}</b> <span>· mistakes: ${m.tries}</span></div>`).join("")}</div>` : ""}
    <p class="status" id="status"></p>
    <button class="btn ghost" id="retry" style="display:none">Send again</button>
    <button class="btn" id="again">Try again</button>
    <button class="btn ghost" id="menu">Finish</button>
  </div>`;
}

function quizReportText(r) {
  let text = `З першої спроби: ${r.firstTry} з ${r.total}\nУсього помилок: ${r.mistakes}`;
  if (r.log.length) {
    text += "\n\nПомилки:\n" + r.log.map(m => `• ${m.q} → ${m.right} (${m.tries})`).join("\n");
  }
  return text;
}