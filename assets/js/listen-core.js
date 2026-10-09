/* Shared by the page and Node tests. No dependencies or build step. */
(function (root) {
  "use strict";

  function words(text) {
    return text.replace(/[’‘]/g, "'").match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*'?/gu) || [];
  }

  function normalize(word) {
    return word.replace(/[’‘]/g, "'").toLowerCase();
  }

  function validateLesson(data) {
    if (!data || typeof data.title !== "string" || !data.title.trim()) throw new Error("The lesson needs a title.");
    if (typeof data.video !== "string" || !data.video.trim()) throw new Error("Add a video file to the lesson.");
    const url = new URL(data.video, "https://example.invalid/");
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("Use a video file path or HTTPS link.");
    if (!Array.isArray(data.segments) || !data.segments.length) throw new Error("Add at least one phrase with start, end and text.");
    let previousEnd = 0;
    const segments = data.segments.map((segment, index) => {
      if (!segment || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) ||
          segment.start < previousEnd || segment.end <= segment.start ||
          typeof segment.text !== "string" || !words(segment.text).length) {
        throw new Error(`Check phrase ${index + 1}: use text and non-overlapping start/end times in seconds.`);
      }
      if (segment.translationUk !== undefined && typeof segment.translationUk !== "string") {
        throw new Error(`Check phrase ${index + 1}: translationUk must be text.`);
      }
      previousEnd = segment.end;
      return { start: segment.start, end: segment.end, text: segment.text.trim(),
        translationUk: (segment.translationUk || "").trim(), words: words(segment.text) };
    });
    return { title: data.title, video: data.video, segments };
  }

  function shuffledTokens(items, random = Math.random) {
    const tokens = items.map((word, id) => ({ word, id }));
    for (let i = tokens.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [tokens[i], tokens[j]] = [tokens[j], tokens[i]];
    }
    // Avoid accidentally showing the answer in its original order.
    if (tokens.every((token, i) => normalize(token.word) === normalize(items[i]))) {
      const different = tokens.findIndex(token => normalize(token.word) !== normalize(tokens[0].word));
      if (different > 0) [tokens[0], tokens[different]] = [tokens[different], tokens[0]];
    }
    return tokens;
  }

  const api = { words, normalize, validateLesson, shuffledTokens };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ListenCore = api;
})(typeof window !== "undefined" ? window : globalThis);
