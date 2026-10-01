/* Shared by the page and Node tests. No dependencies or build step. */
(function (root) {
  "use strict";

  function words(text) {
    return text.replace(/[’‘]/g, "'").match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) || [];
  }

  function videoId(value) {
    if (typeof value !== "string") throw new Error("Add a YouTube link to the lesson.");
    if (/^[\w-]{11}$/.test(value)) return value;
    let url;
    try { url = new URL(value); } catch (_) { throw new Error("Invalid YouTube link."); }
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "https:") throw new Error("Use an HTTPS YouTube link.");
    let id;
    if (host === "youtu.be") id = url.pathname.slice(1);
    else if (host === "youtube.com" || host === "m.youtube.com") {
      id = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:embed|shorts)\/([\w-]+)$/)?.[1];
    }
    if (!id || !/^[\w-]{11}$/.test(id)) throw new Error("Invalid YouTube link.");
    return id;
  }

  function validateLesson(data) {
    if (!data || typeof data.title !== "string" || !data.title.trim()) throw new Error("The lesson needs a title.");
    const id = videoId(data.youtube);
    if (!Array.isArray(data.segments) || !data.segments.length) throw new Error("Add at least one phrase with start, end and text.");
    let previousEnd = 0;
    const segments = data.segments.map((segment, index) => {
      if (!segment || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) ||
          segment.start < previousEnd || segment.end <= segment.start ||
          typeof segment.text !== "string" || !words(segment.text).length) {
        throw new Error(`Check phrase ${index + 1}: use text and non-overlapping start/end times in seconds.`);
      }
      previousEnd = segment.end;
      return { start: segment.start, end: segment.end, text: segment.text.trim(), words: words(segment.text).map(w => w.toLowerCase()) };
    });
    return { title: data.title, videoId: id, note: typeof data.note === "string" ? data.note : "", segments };
  }

  function shuffledTokens(items, random = Math.random) {
    const tokens = items.map((word, id) => ({ word, id }));
    for (let i = tokens.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [tokens[i], tokens[j]] = [tokens[j], tokens[i]];
    }
    // Avoid accidentally showing the answer in its original order.
    if (tokens.every((token, i) => token.word === items[i])) {
      const different = tokens.findIndex(token => token.word !== tokens[0].word);
      if (different > 0) [tokens[0], tokens[different]] = [tokens[different], tokens[0]];
    }
    return tokens;
  }

  const api = { words, videoId, validateLesson, shuffledTokens };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ListenCore = api;
})(typeof window !== "undefined" ? window : globalThis);
