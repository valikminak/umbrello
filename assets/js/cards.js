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
  const storageKey = Profiles.userId ? `umbrello.cards.known.v1.${Profiles.userId}.${profile.id}` : null;

  function readKnown() {
    if (!storageKey) return new Set();
    try {
      const ids = JSON.parse(localStorage.getItem(storageKey));
      return new Set(Array.isArray(ids) ? ids.filter(id => typeof id === "string") : []);
    } catch (_) {
      return new Set();
    }
  }

  const known = readKnown();

  function markKnown(id) {
    known.add(id);
    if (!storageKey) return;
    try {
      const saved = readKnown();
      for (const cardId of known) saved.add(cardId);
      localStorage.setItem(storageKey, JSON.stringify([...saved]));
    } catch (_) {}
  }

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
        <button class="card-turn" type="button" aria-label="Перевернути картку" aria-expanded="false" aria-controls="card-back"></button>
        <div class="card-front" lang="en"></div>
        <div class="card-back" id="card-back" hidden>
          <div class="card-art" hidden>
            <img class="card-picture" alt="" referrerpolicy="no-referrer" draggable="false" hidden>
            <span class="card-emoji" aria-hidden="true" hidden></span>
          </div>
          <p class="card-definition" lang="en"></p>
          <div class="card-meaning">
            <button class="card-reveal" type="button" aria-expanded="false" aria-controls="card-translation">Показати переклад</button>
            <p id="card-translation" hidden></p>
          </div>
        </div>
      </article>
      <nav class="card-nav" aria-label="Перегляд карток">
        <button class="btn ghost" type="button" id="card-prev">Попередня</button>
        <button class="btn ghost" type="button" id="card-next">Наступна</button>
      </nav>
      <button class="btn card-known" type="button" id="card-known">Знаю</button>`;

    const surface = host.querySelector(".word-card");
    const front = host.querySelector(".card-front");
    const back = host.querySelector(".card-back");
    const art = host.querySelector(".card-art");
    const picture = host.querySelector(".card-picture");
    const emoji = host.querySelector(".card-emoji");
    const definition = host.querySelector(".card-definition");
    const translation = host.querySelector("#card-translation");
    const turn = host.querySelector(".card-turn");
    const reveal = host.querySelector(".card-reveal");
    const prev = host.querySelector("#card-prev");
    const next = host.querySelector("#card-next");
    const know = host.querySelector("#card-known");
    let index = 0;
    let swipeStart = null;
    let dragged = false;

    function showTranslation(visible) {
      translation.hidden = !visible;
      reveal.setAttribute("aria-expanded", String(visible));
      reveal.textContent = visible ? "Сховати переклад" : "Показати переклад";
    }

    function showBack(visible) {
      front.hidden = visible;
      back.hidden = !visible;
      turn.setAttribute("aria-expanded", String(visible));
      turn.setAttribute("aria-label", visible ? "Повернутися до слова" : `Перевернути картку: ${cards[index].word}`);
      if (!visible) showTranslation(false);
    }

    function showCard() {
      const card = cards[index];
      showBack(false);
      front.textContent = card.word;
      definition.textContent = card.definition;
      translation.textContent = card.translation;
      const src = imageURL(card.image);
      emoji.textContent = typeof card.emoji === "string" ? card.emoji.trim() : "";
      emoji.hidden = Boolean(src) || !emoji.textContent;
      picture.hidden = !src;
      art.hidden = picture.hidden && emoji.hidden;
      picture.alt = typeof card.imageAlt === "string" ? card.imageAlt : "";
      if (src) picture.src = src;
      else picture.removeAttribute("src");
      prev.disabled = index === 0;
      next.disabled = index === cards.length - 1;
    }

    function step(direction) {
      const target = index + direction;
      if (target < 0 || target >= cards.length) return;
      index = target;
      showCard();
    }

    picture.addEventListener("error", () => {
      picture.hidden = true;
      emoji.hidden = !emoji.textContent;
      art.hidden = emoji.hidden;
    });
    turn.onclick = event => {
      if (!dragged || event.detail === 0) showBack(back.hidden);
    };
    reveal.onclick = () => showTranslation(translation.hidden);
    prev.onclick = () => step(-1);
    next.onclick = () => step(1);
    know.onclick = () => {
      markKnown(cards[index].id);
      cards.splice(index, 1);
      if (!cards.length) return Profiles.empty(host, "Cards", "Ти знаєш усі картки!");
      index = Math.min(index, cards.length - 1);
      showCard();
    };

    surface.addEventListener("pointerdown", event => {
      if (!event.isPrimary) {
        swipeStart = null;
        return;
      }
      if (event.button !== 0 || event.target !== turn) return;
      dragged = false;
      swipeStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
      turn.setPointerCapture(event.pointerId);
    });
    surface.addEventListener("lostpointercapture", event => {
      if (swipeStart?.id === event.pointerId) swipeStart = null;
    });
    surface.addEventListener("pointerup", event => {
      if (swipeStart?.id !== event.pointerId) return;
      const dx = event.clientX - swipeStart.x;
      const dy = event.clientY - swipeStart.y;
      swipeStart = null;
      dragged = Math.hypot(dx, dy) > 12;
      if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
      step(dx < 0 ? 1 : -1);
    });
    showCard();
  }

  async function load() {
    try {
      const deck = await loadJSON(file);
      const valid = card => card && ["word", "definition", "translation"]
        .every(key => typeof card[key] === "string" && card[key].trim()) &&
        (card.id === undefined || (typeof card.id === "string" && card.id.trim()));
      if (!Array.isArray(deck) || !deck.every(valid)) throw new Error("Перевірте формат cards.json.");
      if (!deck.length) return Profiles.empty(host, "Cards", "Карток поки немає.");
      const cards = deck.map(card => ({ ...card, id: (card.id ?? card.word.toLowerCase()).trim() }));
      if (new Set(cards.map(card => card.id)).size !== cards.length) throw new Error("Кожна картка має мати унікальний id.");
      const remaining = cards.filter(card => !known.has(card.id));
      if (!remaining.length) return Profiles.empty(host, "Cards", "Ти знаєш усі картки!");
      show(remaining);
    } catch (error) {
      showError(host, error, load);
    }
  }
  await load();
})();
