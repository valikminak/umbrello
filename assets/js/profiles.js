(function () {
  "use strict";
  let current = null;
  let accessPromise = null, accessGranted = false;

  // A restored page must not reuse an old access decision from the back/forward cache.
  window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });

  // One request per page load. Anything other than a confirmed "allowed" ends on the
  // umbrella screen; the reason stays on the server and is never shown or retried here.
  async function checkAccess() {
    if (!tg?.initData) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(new URL("/access/check", WORKER_URL), {
        method: "POST", headers: { "Content-Type": "application/json" },
        cache: "no-store", signal: controller.signal,
        body: JSON.stringify({ initData: tg.initData }),
      });
      let data;
      try { data = await response.json(); } catch (_) {}
      return response.ok && data?.allowed === true;
    } catch (_) {
      return false;
    } finally { clearTimeout(timer); }
  }

  function lockScreen(host) {
    document.body.classList.add("access-locked");
    tg?.BackButton?.hide();
    let screen = document.getElementById("accessScreen");
    if (!screen) {
      screen = document.createElement("section");
      screen.id = "accessScreen";
      screen.className = "app access-screen";
      if (host) host.before(screen); else document.body.prepend(screen);
    }
    return screen;
  }

  async function ensureAccess(host) {
    if (accessGranted) return true;
    const screen = lockScreen(host);
    screen.innerHTML = `<div class="center"><p class="sub" role="status">Checking access…</p></div>`;
    accessPromise ||= checkAccess();
    if (await accessPromise) {
      accessGranted = true;
      screen.remove();
      document.body.classList.remove("access-locked");
      return true;
    }
    renderUmbrella(screen);
    return false;
  }

  // The pages are public static files, so the entry check can be skipped: every Worker refusal
  // (no access, allowlist not configured, unverifiable launch data) locks the page the same way.
  // Returns true when the code was such a refusal and the umbrella is up.
  const REFUSAL = /^(?:app|books|grammar)_(?:forbidden|not_configured)$|^unauthorized$/;
  function refuse(code) {
    if (typeof code !== "string" || !REFUSAL.test(code)) return false;
    accessGranted = false;
    renderUmbrella(lockScreen(document.getElementById("app")));
    return true;
  }

  // An umbrella floating in the rain, looping forever: no words, no ID, no buttons.
  // Closing and reopening the Mini App is the only way to a new check.
  function renderUmbrella(screen) {
    // Each streak has its own fall time and starts mid-fall, so the sky is full from the first frame.
    const rain = Array.from({ length: 17 }, (_, i) => {
      const x = 10 + i * 18, time = (0.9 + (i * 7 % 5) * 0.09).toFixed(2), start = (-(i * 11 % 9) * 0.14).toFixed(2);
      return `<line x1="${x}" y1="-40" x2="${x - 5}" y2="-16" style="--t:${time}s;--s:${start}s"/>`;
    }).join("");
    const drips = [[40, -0.3], [80, -1.1], [160, -0.7], [200, -1.5]]
      .map(([x, start]) => `<circle cx="${x}" cy="121" r="3" style="--s:${start}s"/>`).join("");
    screen.innerHTML = `<div class="center">
      <svg class="umbrella" viewBox="0 0 240 240" role="img" aria-label="Umbrello" focusable="false">
        <defs><clipPath id="umbrellaSky"><path d="M0 0H240V240H208V122A88 88 0 0 0 32 122V240H0Z"/></clipPath></defs>
        <g class="umbrella-rain" clip-path="url(#umbrellaSky)">${rain}</g>
        <g class="umbrella-puddle">
          <ellipse class="umbrella-pool" cx="120" cy="222" rx="54" ry="6"/>
          <ellipse class="umbrella-ripple" cx="120" cy="222" rx="54" ry="6" style="--s:0s"/>
          <ellipse class="umbrella-ripple" cx="120" cy="222" rx="54" ry="6" style="--s:-1.4s"/>
        </g>
        <g class="umbrella-bob"><g class="umbrella-sway">
          <g class="umbrella-drips">${drips}</g>
          <path class="umbrella-shaft" d="M120 44V196a12 12 0 0 0 24 0"/>
          <path class="umbrella-canopy" d="M40 120A80 80 0 0 1 200 120Q180 108 160 120Q140 108 120 120Q100 108 80 120Q60 108 40 120Z"/>
          <path class="umbrella-shine" d="M120 40A80 80 0 0 0 40 120Q60 108 80 120Q98 76 120 40Z"/>
          <path class="umbrella-seams" d="M120 40Q98 76 80 120M120 40V120M120 40Q142 76 160 120"/>
          <circle class="umbrella-tip" cx="120" cy="38" r="4"/>
        </g></g>
      </svg>
    </div>`;
  }

  async function list() {
    const profiles = await loadJSON("users/index.json");
    if (!Array.isArray(profiles) || !profiles.length ||
        profiles.some(p => !p || !/^[a-z0-9-]+$/.test(p.id) || typeof p.name !== "string" || !p.name.trim()) ||
        new Set(profiles.map(p => p.id)).size !== profiles.length) {
      throw new Error("Check the user list in users/index.json.");
    }
    return profiles;
  }

  function url(page, profile = current) {
    const params = new URLSearchParams({ v: "10" });
    if (profile) params.set("user", profile.id);
    return `${page}?${params}`;
  }

  function content(file) {
    if (!current) throw new Error("Choose a profile first.");
    if (!/^[a-zA-Z0-9_/-]+\.json$/.test(file) || file.startsWith("/")) {
      throw new Error("Use a JSON path inside this user's folder.");
    }
    return `users/${current.id}/${file}`;
  }

  function header() {
    let nav = document.getElementById("profileNav");
    if (!nav) {
      nav = document.createElement("nav");
      nav.id = "profileNav";
      nav.className = "profile-nav";
      nav.setAttribute("aria-label", "Profile navigation");
      document.body.prepend(nav);
    }
    nav.innerHTML = `<a href="${url("index.html")}">← Menu</a>
      <strong>${esc(current.name)}</strong><a href="index.html?v=10">Switch profile</a>`;
  }

  async function requireProfile(host) {
    try {
      if (!await ensureAccess(host)) return null;
      const profiles = await list();
      const id = new URLSearchParams(location.search).get("user");
      current = profiles.find(p => p.id === id) || null;
      if (!current) { location.replace("index.html?v=10"); return null; }
      header();
      return current;
    } catch (error) {
      showError(host, error, () => location.reload());
      return null;
    }
  }

  function empty(host, title, message) {
    host.innerHTML = `<div class="center"><h1>${esc(title)}</h1>
      <p class="sub">${esc(message)}</p><a class="btn" href="${url("index.html")}">Back to menu</a></div>`;
  }

  window.Profiles = { list, url, content, require: requireProfile, ensureAccess, refuse, empty,
    get current() { return current; } };
})();
