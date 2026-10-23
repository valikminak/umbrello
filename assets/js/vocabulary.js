(async function () {
  "use strict";
  const host = document.getElementById("app");
  if (!await Profiles.shared(host)) return;
  backTo(Profiles.url("index.html"));
  // Shared section with no materials yet; they will live in vocabulary/.
  Profiles.empty(host, "Vocabulary", "No vocabulary materials yet.");
})();
