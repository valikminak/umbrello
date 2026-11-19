(async function () {
  "use strict";
  const host = document.getElementById("app");
  const profile = await Profiles.require(host);
  if (!profile) return;
  const menu = Profiles.url("index.html");
  if (profile.id !== "sophia") {
    location.replace(menu);
    return;
  }
  backTo(menu);
  const file = Profiles.content("cards.json");

  function imageURL(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const base = new URL(file, location.href);
      const url = new URL(value, base);
      if (url.protocol === "https:" || (url.protocol === "http:" && url.origin === base.origin)) return url.href;
    } catch (_) {}
    return null;
  }

  function show(cards) {
    host.innerHTML = `
      <h1 lang="en">Cards</h1>
      <article class="word-card" aria-label="Картка" aria-live="polite">
        <div class="card-front" lang="en"></div>
        <div class="card-back" id="card-back" hidden>
          <img class="card-picture" alt="" referrerpolicy="no-referrer" hidden>
          <p class="card-definition" lang="en"></p>
          <div class="card-meaning">
            <button class="card-reveal" type="button" aria-expanded="false" aria-controls="card-translation">Показати переклад</button>
            <p id="card-translation" hidden></p>
          </div>
        </div>
      </article>
      <button class="btn card-flip" type="button" aria-expanded="false" aria-controls="card-back">Перевернути</button>
      ${cards.length > 1 ? `<nav class="card-nav" aria-label="Перегляд карток">
        <button class="btn ghost" type="button" id="card-prev">Попередня</button>
        <button class="btn ghost" type="button" id="card-next">Наступна</button>
      </nav>` : ""}`;

    const front = host.querySelector(".card-front");
    const back = host.querySelector(".card-back");
    const picture = host.querySelector(".card-picture");
    const definition = host.querySelector(".card-definition");
    const translation = host.querySelector("#card-translation");
    const flip = host.querySelector(".card-flip");
    const reveal = host.querySelector(".card-reveal");
    const prev = host.querySelector("#card-prev");
    const next = host.querySelector("#card-next");
    let index = 0;

    function showTranslation(visible) {
      translation.hidden = !visible;
      reveal.setAttribute("aria-expanded", String(visible));
      reveal.textContent = visible ? "Сховати переклад" : "Показати переклад";
    }

    function showBack(visible) {
      front.hidden = visible;
      back.hidden = !visible;
      flip.setAttribute("aria-expanded", String(visible));
      flip.textContent = visible ? "До слова" : "Перевернути";
      if (!visible) showTranslation(false);
    }

    function showCard() {
      const card = cards[index];
      showBack(false);
      front.textContent = card.word;
      definition.textContent = card.definition;
      translation.textContent = card.translation;
      const src = imageURL(card.image);
      picture.hidden = !src;
      picture.alt = typeof card.imageAlt === "string" ? card.imageAlt : "";
      if (src) picture.src = src;
      else picture.removeAttribute("src");
      if (prev) prev.disabled = index === 0;
      if (next) next.disabled = index === cards.length - 1;
    }

    picture.addEventListener("error", () => { picture.hidden = true; });
    flip.onclick = () => showBack(back.hidden);
    reveal.onclick = () => showTranslation(translation.hidden);
    if (prev && next) {
      prev.onclick = () => { if (index > 0) { index--; showCard(); } };
      next.onclick = () => { if (index < cards.length - 1) { index++; showCard(); } };
    }
    showCard();
  }

  async function load() {
    try {
      const cards = await loadJSON(file);
      const valid = card => card && ["word", "definition", "translation"]
        .every(key => typeof card[key] === "string" && card[key].trim());
      if (!Array.isArray(cards) || !cards.every(valid)) throw new Error("Перевірте формат cards.json.");
      if (!cards.length) return Profiles.empty(host, "Cards", "Карток поки немає.");
      show(cards);
    } catch (error) {
      showError(host, error, load);
    }
  }
  await load();
})();
