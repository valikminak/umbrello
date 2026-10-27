(async function () {
  "use strict";
  const host = document.getElementById("app");
  const id = new URLSearchParams(location.search).get("user");
  const tile = (page, icon, title, description, profile) => `<a class="tile" href="${Profiles.url(page + ".html", profile)}">
        <span class="ico" aria-hidden="true">${icon}</span><span><b>${title}</b><span>${description}</span></span>
      </a>`;
  try {
    if (!await Profiles.ensureAccess(host)) return;
    if (!id) {
      if (tg?.BackButton) tg.BackButton.hide();
      const profiles = await Profiles.list();
      // Shared sections are open to every account and never carry a profile in the link.
      host.innerHTML = `<div class="welcome"><span class="welcome-icon" aria-hidden="true">☂️</span>
        <h1>Who's learning today?</h1><p class="sub">Choose your name to open your lessons.</p></div>
        <div class="menu">${profiles.map(profile => `<a class="tile profile-tile" href="${Profiles.url("index.html", profile)}">
          <span class="avatar" aria-hidden="true">${esc(profile.name[0].toUpperCase())}</span>
          <span><b>${esc(profile.name)}</b><span>Open my lessons</span></span><span class="tile-arrow" aria-hidden="true">→</span>
        </a>`).join("")}</div>
        <h2 class="shared-title">For everyone</h2>
        <div class="menu">${[
          ["listen", "🎧", "Listen", "Listen and put the words in order"],
          ["books", "📚", "Books", "Read a book with word hints"],
          ["grammar", "🧩", "Grammar", "Level test and grammar lessons"],
          ["vocabulary", "🔤", "Vocabulary", "English Vocabulary in Use, unit by unit"],
        ].map(([page, icon, title, description]) => tile(page, icon, title, description, null)).join("")}</div>`;
      return;
    }
    const profile = await Profiles.require(host);
    if (!profile) return;
    backTo("index.html?v=10");
    host.innerHTML = `<h1>Hi, ${esc(profile.name)}!</h1><p class="sub">What would you like to practise today?</p>
      <div class="menu">${[
        ["test", "✅", "Test", "Words and grammar, four options"],
        ["write", "✍️", "Write", "Translate a short text and get feedback"],
      ].map(([page, icon, title, description]) => tile(page, icon, title, description, profile)).join("")}</div>`;
  } catch (error) {
    showError(host, error, () => location.reload());
  }
})();
