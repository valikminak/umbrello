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
  host.innerHTML = `<div class="center"><h2>Could not load</h2>
    <p class="sub">${esc(e.message)}</p><button class="btn" id="rt">Try again</button></div>`;
  host.querySelector("#rt").onclick = retry;
}

async function sendReport(title, text, statusEl, retryEl) {
  if (statusEl) { statusEl.className = "status"; statusEl.textContent = "Sending result…"; }
  if (retryEl) retryEl.style.display = "none";
  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: tg ? tg.initData : "", title,
        text: (window.Profiles?.current ? `Учень: ${Profiles.current.name}\n\n` : "") + text })
    });
    if (!res.ok) {
      let data;
      try { data = await res.json(); } catch (_) {}
      if (window.Profiles?.refuse(data?.error)) { if (statusEl) statusEl.textContent = ""; return false; }
      throw new Error(res.status);
    }
    if (statusEl) { statusEl.className = "status ok"; statusEl.textContent = "Result sent to teacher ✓"; }
    return true;
  } catch (e) {
    if (statusEl) { statusEl.className = "status bad"; statusEl.textContent = "Couldn't send the result."; }
    if (retryEl) retryEl.style.display = "block";
    return false;
  }
}
