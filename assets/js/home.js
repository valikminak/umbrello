(async function () {
  "use strict";
  const host = document.getElementById("app");
  const id = new URLSearchParams(location.search).get("user");
  try {
    if (!id) {
      if (tg?.BackButton) tg.BackButton.hide();
      const profiles = await Profiles.list();
      host.innerHTML = `<div class="welcome"><span class="welcome-icon" aria-hidden="true">☂️</span>
        <h1>Who's learning today?</h1><p class="sub">Choose your name to open your lessons.</p></div>
        <div class="menu">${profiles.map(profile => `<a class="tile profile-tile" href="${Profiles.url("index.html", profile)}">
          <span class="avatar" aria-hidden="true">${esc(profile.name[0].toUpperCase())}</span>
          <span><b>${esc(profile.name)}</b><span>Open my lessons</span></span><span class="tile-arrow" aria-hidden="true">→</span>
        </a>`).join("")}</div>`;
      return;
    }
    const profile = await Profiles.require(host);
    if (!profile) return;
    backTo("index.html?v=6");
    host.innerHTML = `<h1>Hi, ${esc(profile.name)}!</h1><p class="sub">What would you like to practise today?</p>
      <div class="menu">${[
        ["listen", "🎧", "Listen", "Listen and put the words in order"],
        ["test", "✅", "Test", "Words and grammar, four options"],
        ["read", "📖", "Read", "Tap any word to see the translation"]
      ].map(([page, icon, title, description]) => `<a class="tile" href="${Profiles.url(page + ".html")}">
        <span class="ico" aria-hidden="true">${icon}</span><span><b>${title}</b><span>${description}</span></span>
      </a>`).join("")}</div>`;
  } catch (error) {
    showError(host, error, () => location.reload());
  }
})();
