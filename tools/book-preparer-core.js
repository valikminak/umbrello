/* Local EPUB → book.json v2. Used only by tools/book-preparer.html.
   Dependencies are vendored: JSZip 3.10.1 and sbd 1.0.19. No network or AI. */
(function () {
  "use strict";

  const BLOCKS = new Set("address article aside blockquote body caption dd div dl dt figcaption figure footer header hr li main ol p pre section table tbody td tfoot th thead tr ul".split(" "));
  const SKIP = new Set("audio button canvas embed form head iframe img input link math meta nav noscript object script select style svg template textarea title video".split(" "));
  const SKIP_TYPES = new Set(["pagebreak", "toc", "landmarks", "page-list"]);
  const FONT_ENCRYPTION = new Set(["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"]);
  const MAX_TEXT_BYTES = 48 * 1024 * 1024;
  const origin = "https://epub.invalid/";
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));
  const clean = text => String(text || "").normalize("NFC").replace(/\s+/gu, " ").trim();
  const name = node => (node.localName || node.nodeName || "").split(":").pop().toLowerCase();
  const elements = (root, tag) => Array.from(root.getElementsByTagName("*")).filter(node => name(node) === tag);
  const child = (root, tag) => Array.from(root.children || []).find(node => name(node) === tag);
  const types = node => (node.getAttribute("epub:type") || node.getAttributeNS("http://www.idpf.org/2007/ops", "type") || "").split(/\s+/);
  const property = (node, value) => (node.getAttribute("properties") || "").split(/\s+/).includes(value);

  function parseXML(text, label) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (elements(doc, "parsererror").length) throw new Error(`Не удалось прочитать XML: ${label}.`);
    return doc;
  }

  // A fixed, fictitious base resolves EPUB paths; nothing is fetched from it.
  function reference(base, href) {
    const url = new URL(href, new URL(base, origin));
    if (url.origin !== new URL(origin).origin) return null;
    return { path: decodeURIComponent(url.pathname.slice(1)), fragment: decodeURIComponent(url.hash.slice(1)) };
  }

  function decode(bytes) {
    let encoding = "utf-8";
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
    else {
      const prefix = new TextDecoder().decode(bytes.slice(0, 300));
      const declaration = prefix.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)/i);
      if (declaration) encoding = declaration[1];
    }
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  }

  function markup(text, label, warnings) {
    const withoutDeclaration = text.replace(/^\uFEFF?\s*<\?xml[^>]*\?>/i, "");
    const doc = new DOMParser().parseFromString(withoutDeclaration, "application/xhtml+xml");
    if (!elements(doc, "parsererror").length) return doc;
    // Some EPUBs use HTML entities or malformed XHTML. Parsed nodes never enter the live DOM.
    warnings.push(`Разметка ${label} прочитана как HTML: исходный XHTML некорректен.`);
    return new DOMParser().parseFromString(withoutDeclaration, "text/html");
  }

  function documentBlocks(doc, path, targets) {
    const body = elements(doc, "body")[0] || doc.documentElement;
    const blocks = [];
    let buffer = "", anchors = [];
    function flush(level = 0) {
      const text = clean(buffer);
      buffer = "";
      if (text) {
        blocks.push({ text, level, anchors });
        anchors = [];
      }
    }
    function collect(node) {
      for (const part of node.childNodes) {
        if (part.nodeType === 3 || part.nodeType === 4) buffer += part.nodeValue;
        else if (part.nodeType === 1) walk(part);
      }
    }
    function walk(node) {
      const tag = name(node);
      if (node.hasAttribute("hidden") || types(node).some(type => SKIP_TYPES.has(type))) return;
      if (tag === "img" && /^[A-Za-z]$/.test(node.getAttribute("alt") || "")) {
        buffer += node.getAttribute("alt"); // Illustrated drop cap.
        return;
      }
      if (SKIP.has(tag)) return;
      const id = node.getAttribute("id") || node.getAttribute("xml:id") || (tag === "a" && node.getAttribute("name"));
      const heading = /^h[1-6]$/.test(tag) ? Number(tag[1]) : 0;
      // Inline IDs (footnotes, publisher anchors) must not break ordinary paragraphs.
      if (heading || BLOCKS.has(tag) || (id && targets.has(`${path}#${id}`))) flush();
      if (id) anchors.push(id);
      if (heading) { collect(node); flush(heading); return; }
      if (tag === "br") { buffer += " "; return; }
      collect(node);
      if (BLOCKS.has(tag)) flush();
    }
    walk(body);
    flush();
    return blocks;
  }

  async function readEPUB(file, progress, warnings) {
    let zip;
    try { zip = await JSZip.loadAsync(await file.arrayBuffer()); }
    catch (_) { throw new Error("Не удалось открыть EPUB. Выбери книгу в формате .epub без DRM."); }
    let readBytes = 0;
    const texts = new Map();
    async function read(path) {
      if (texts.has(path)) return texts.get(path);
      const entry = zip.file(path);
      if (!entry) throw new Error(`В EPUB отсутствует файл: ${path}`);
      const bytes = await entry.async("uint8array");
      readBytes += bytes.length;
      if (readBytes > MAX_TEXT_BYTES) throw new Error("В книге слишком много текстовых данных для этого инструмента (больше 48 МиБ).");
      let text;
      try { text = decode(bytes); }
      catch (_) { throw new Error(`Не удалось прочитать кодировку текста: ${path}`); }
      texts.set(path, text);
      return text;
    }
    if (zip.file("META-INF/rights.xml")) throw new Error("Этот EPUB защищён DRM. Инструмент работает с книгами без DRM.");
    if (zip.file("META-INF/encryption.xml")) {
      const encryption = parseXML(await read("META-INF/encryption.xml"), "encryption.xml");
      if (elements(encryption, "encryptionmethod").some(node => !FONT_ENCRYPTION.has(node.getAttribute("Algorithm")))) {
        throw new Error("В EPUB есть зашифрованное содержимое. Нужна книга без DRM.");
      }
    }
    const container = parseXML(await read("META-INF/container.xml"), "container.xml");
    const roots = elements(container, "rootfile");
    const root = roots.find(node => node.getAttribute("media-type") === "application/oebps-package+xml") || roots[0];
    const packagePath = root && reference("", root.getAttribute("full-path") || "")?.path;
    if (!packagePath) throw new Error("В EPUB не найден основной файл книги (OPF).");
    const opf = parseXML(await read(packagePath), packagePath);
    const metadata = elements(opf, "metadata")[0];
    const metadataText = tag => metadata ? elements(metadata, tag).map(node => clean(node.textContent)).filter(Boolean) : [];
    const title = metadataText("title")[0] || file.name.replace(/\.epub$/i, "") || "Untitled";
    const creators = metadata ? elements(metadata, "creator") : [];
    const refinements = new Map(metadata ? elements(metadata, "meta").filter(node => node.getAttribute("property") === "role")
      .map(node => [(node.getAttribute("refines") || "").replace(/^#/, ""), clean(node.textContent)]) : []);
    const authorNodes = creators.filter(node => {
      const role = node.getAttribute("opf:role") || node.getAttributeNS("http://www.idpf.org/2007/opf", "role") || refinements.get(node.getAttribute("id"));
      return !role || role === "aut";
    });
    const author = [...new Set((authorNodes.length ? authorNodes : creators).map(node => clean(node.textContent)).filter(Boolean))].join(", ") || null;
    const language = metadataText("language")[0] || "en";
    if (!/^(en|eng)(-|$)/i.test(language)) warnings.push(`Язык EPUB: ${language}. Разбиение предложений настроено для английского.`);
    const manifest = new Map();
    for (const item of elements(opf, "item")) {
      const href = item.getAttribute("href");
      const ref = href ? reference(packagePath, href) : null;
      if (ref) manifest.set(item.getAttribute("id"), { node: item, path: ref.path, mediaType: item.getAttribute("media-type") });
    }
    const titles = new Map(), targets = new Map();
    function addTitle(base, href, label) {
      const ref = href ? reference(base, href) : null;
      const title = clean(label);
      if (!ref || !title) return;
      if (!titles.has(ref.path)) titles.set(ref.path, title);
      if (ref.fragment && !targets.has(`${ref.path}#${ref.fragment}`)) targets.set(`${ref.path}#${ref.fragment}`, title);
    }
    // Prefer the EPUB 3 navigation; use EPUB 2 NCX when that is absent.
    const nav = [...manifest.values()].find(item => property(item.node, "nav"));
    if (nav) {
      const navDoc = markup(await read(nav.path), nav.path, warnings);
      for (const section of elements(navDoc, "nav").filter(node => types(node).includes("toc"))) {
        for (const link of elements(section, "a")) addTitle(nav.path, link.getAttribute("href"), link.textContent);
      }
    }
    const spine = elements(opf, "spine")[0];
    if (!spine) throw new Error("В EPUB нет порядка чтения (spine).");
    if (!titles.size) {
      const ncx = manifest.get(spine.getAttribute("toc")) || [...manifest.values()].find(item => item.mediaType === "application/x-dtbncx+xml");
      if (ncx) {
        const ncxDoc = parseXML(await read(ncx.path), ncx.path);
        for (const point of elements(ncxDoc, "navpoint")) {
          addTitle(ncx.path, child(point, "content")?.getAttribute("src"), child(point, "navlabel")?.textContent);
        }
      }
    }
    const items = elements(spine, "itemref").filter(node => node.getAttribute("linear") !== "no");
    const documents = [];
    for (let i = 0; i < items.length; i++) {
      const item = manifest.get(items[i].getAttribute("idref"));
      if (!item) throw new Error(`В manifest нет раздела ${items[i].getAttribute("idref")} из порядка чтения.`);
      if (property(item.node, "nav")) continue;
      if (!["application/xhtml+xml", "text/html"].includes(item.mediaType)) {
        warnings.push(`Пропущен нетекстовый раздел: ${item.path}`);
        continue;
      }
      progress(`Читаю текст: ${i + 1} из ${items.length}…`, 0.1 + 0.45 * ((i + 1) / items.length));
      const blocks = documentBlocks(markup(await read(item.path), item.path, warnings), item.path, targets);
      if (blocks.length) documents.push({ path: item.path, blocks });
      await pause();
    }
    if (!documents.length) throw new Error("В EPUB не найден текст. Книги, состоящие только из изображений, не поддерживаются.");
    return { title, author, language, documents, titles, targets };
  }

  function buildChapters(source) {
    const counts = new Map();
    source.documents.forEach(doc => doc.blocks.forEach(block => {
      if (block.level) counts.set(block.level, (counts.get(block.level) || 0) + 1);
    }));
    const repeated = [...counts.keys()].filter(level => counts.get(level) >= 2);
    const headingLevel = Math.min(...(repeated.length ? repeated : counts.keys()));
    const chapters = [];
    let current = null;
    const start = title => { current = { title: title || null, paragraphs: [] }; chapters.push(current); };
    for (const doc of source.documents) {
      const anchored = doc.blocks.some(block => block.anchors.some(id => source.targets.has(`${doc.path}#${id}`)));
      const hasHeadings = doc.blocks.some(block => block.level);
      const documentTitle = source.titles.get(doc.path);
      for (let i = 0; i < doc.blocks.length; i++) {
        const block = doc.blocks[i];
        const anchor = block.anchors.find(id => source.targets.has(`${doc.path}#${id}`));
        const sectionTitle = anchor && source.targets.get(`${doc.path}#${anchor}`);
        // Explicit TOC anchors in a file outrank heading-level guesses in that file.
        if (sectionTitle) start(sectionTitle);
        else if (!anchored && block.level && block.level <= headingLevel) start(block.text);
        else if (i === 0 && documentTitle && !hasHeadings) start(documentTitle);
        if (!current) start(null);
        current.paragraphs.push({ text: block.text, kind: block.level ? "heading" : "text", ...(block.level ? { level: block.level } : {}) });
      }
    }
    return chapters;
  }

  function splitSentences(text, label, warnings) {
    const segments = tokenizer.sentences(text, { preserve_whitespace: true, sanitize: false, newline_boundaries: false, html_boundaries: false });
    // Never accept a segmenter changing or losing the underlying characters.
    if (!segments.length || segments.join("") !== text) {
      warnings.push(`Абзац ${label} оставлен одним предложением: неоднозначное разбиение.`);
      return [text];
    }
    const result = [];
    for (const segment of segments) {
      // Separate adjacent dialogue sentences while preserving the closing quote.
      const pieces = segment.trim().split(/(?<=[.!?…][”"’'])\s+(?=[“"‘']?[A-Z])/u);
      for (const piece of pieces) {
        const value = piece.trim();
        if (!value) continue;
        const previous = result[result.length - 1];
        const continuation = previous && (/^[a-z]/.test(value) || (/^\d/.test(value) && /\b(?:ch|chap|fig|no|nos|p|pp|vol|art|sec)\.$/i.test(previous)));
        if (continuation) result[result.length - 1] += ` ${value}`;
        else result.push(value);
      }
    }
    if (result.join(" ") !== text) {
      warnings.push(`Абзац ${label} оставлен одним предложением, чтобы сохранить исходный текст.`);
      return [text];
    }
    return result;
  }

  function wordKey(text) {
    return text.normalize("NFC").toLowerCase().replace(/[’ʼ]/g, "'").replace(/[‐‑]/g, "-").replace(/\u00ad/g, "");
  }

  function canonicalJSON(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
    if (value !== null && typeof value === "object") {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  async function convert(file, progress = () => {}) {
    if (!window.JSZip || !window.tokenizer) throw new Error("Не найдены библиотеки. Оставь папку vendor рядом с book-preparer.html.");
    if (!window.crypto?.subtle) throw new Error("Браузер не поддерживает вычисление bookId в этом режиме. Открой инструмент в актуальном Chrome или через localhost.");
    const warnings = [];
    progress("Открываю EPUB…", 0.02);
    const source = await readEPUB(file, progress, warnings);
    const rawChapters = buildChapters(source);
    const stats = { chapters: 0, paragraphs: 0, sentences: 0, words: 0, uniqueWords: 0 };
    const keys = new Set();
    const chapters = [];
    // Native JS indices are UTF-16 offsets; do not count code points or bytes here.
    const wordPattern = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’ʼ\-‐‑\u00ad][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu;
    for (let c = 0; c < rawChapters.length; c++) {
      const raw = rawChapters[c];
      const chapter = { id: `c${c + 1}`, title: raw.title, paragraphs: [] };
      for (let p = 0; p < raw.paragraphs.length; p++) {
        const block = raw.paragraphs[p];
        const paragraph = { id: `${chapter.id}.p${p + 1}`, kind: block.kind, ...(block.level ? { level: block.level } : {}), sentences: [] };
        // A heading is one logical block; punctuation in it doesn't split it.
        const sentences = block.kind === "heading" ? [block.text] : splitSentences(block.text, paragraph.id, warnings);
        for (let s = 0; s < sentences.length; s++) {
          const text = sentences[s];
          const words = Array.from(text.matchAll(wordPattern), match => {
            const key = wordKey(match[0]);
            keys.add(key);
            return { id: `w${++stats.words}`, key, start: match.index, end: match.index + match[0].length };
          });
          paragraph.sentences.push({ id: `${paragraph.id}.s${s + 1}`, text, words });
          stats.sentences++;
        }
        chapter.paragraphs.push(paragraph);
        stats.paragraphs++;
        if (p % 40 === 0) {
          progress(`Размечаю слова: раздел ${c + 1} из ${rawChapters.length}…`, 0.55 + 0.35 * ((c + p / raw.paragraphs.length) / rawChapters.length));
          await pause();
        }
      }
      chapters.push(chapter);
    }
    stats.chapters = chapters.length;
    stats.uniqueWords = keys.size;
    if (!stats.words) throw new Error("В книге не удалось найти слова.");
    progress("Формирую JSON…", 0.93);
    await pause();
    // Identity follows prepared text, not the filename, word IDs, or screen layout.
    const identity = { title: source.title, author: source.author, chapters: chapters.map(chapter => ({
      title: chapter.title, paragraphs: chapter.paragraphs.map(paragraph => ({
        kind: paragraph.kind, ...(paragraph.level ? { level: paragraph.level } : {}),
        sentences: paragraph.sentences.map(sentence => sentence.text),
      })),
    })) };
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJSON(identity)));
    const bookId = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const book = {
      formatVersion: 2, bookId, title: source.title, author: source.author, language: source.language,
      processing: { version: 1, sentenceSplitter: "sbd-1.0.19+umbrello-1", wordTokenizer: "umbrello-1", offsetUnit: "utf16" },
      stats, chapters,
    };
    const json = JSON.stringify(book);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    if (blob.size > 8 * 1024 * 1024) warnings.push("JSON больше текущего лимита Worker 8 МиБ. Перед подключением этой книги потребуется изменить загрузку или разделить файл.");
    progress("Готово. Можно скачать JSON или выбрать абзац для копирования.", 1);
    return { book, blob, warnings };
  }

  window.BookPreparer = { convert };
})();
