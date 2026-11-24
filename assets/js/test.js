/* test.html: the profile's numbered card tests from users/<id>/tests/. */
(async function () {
"use strict";
const app = document.getElementById("app");
const profile = await Profiles.require(app);
if (!profile) return;
const menuUrl = Profiles.url("index.html");
backTo(menuUrl);
await TestCards.mount(app, profile, menuUrl);
})();
