(function () {
  "use strict";
  let current = null;

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
    const params = new URLSearchParams({ v: "7" });
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
      <strong>${esc(current.name)}</strong><a href="index.html?v=7">Switch profile</a>`;
  }

  async function requireProfile(host) {
    try {
      const profiles = await list();
      const id = new URLSearchParams(location.search).get("user");
      current = profiles.find(p => p.id === id) || null;
      if (!current) { location.replace("index.html?v=7"); return null; }
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

  window.Profiles = { list, url, content, require: requireProfile, empty,
    get current() { return current; } };
})();
