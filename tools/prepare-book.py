#!/usr/bin/env python3
"""Prepare an English EPUB for reading: book.json plus a local preview.html.

Usage:
    python tools/prepare-book.py input.epub --output output/

Reads plain-text EPUBs without DRM via EbookLib, keeps chapter headings and
paragraphs in spine order, splits paragraphs into sentences with pysbd and groups
sentences into pages of about 300 words. Text is never rewritten: only markup is
removed and runs of HTML whitespace are collapsed to one space.
"""

import argparse
from collections import Counter
import hashlib
import html
import json
from pathlib import Path, PurePosixPath
import re
import sys
import unicodedata
from urllib.parse import unquote
import warnings
import zipfile

try:
    import ebooklib
    from ebooklib import epub
    import lxml.etree
    import lxml.html
    import pysbd
except ImportError as error:
    sys.exit(f"Missing dependency ({error.name}). Install: pip install -r tools/requirements.txt")


FORMAT_VERSION = 1
PAGE_WORDS = 300
# A chapter's last page shorter than this share of a page joins the previous page.
MIN_LAST_PAGE_SHARE = 0.25

BLOCK_TAGS = {
    "address", "article", "aside", "blockquote", "body", "caption", "dd", "div",
    "dl", "dt", "figcaption", "figure", "footer", "header", "hr", "li", "main",
    "ol", "p", "pre", "section", "table", "tbody", "td", "tfoot", "th", "thead",
    "tr", "ul",
}
HEADING_TAGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}
SKIP_TAGS = {
    "audio", "button", "canvas", "embed", "form", "head", "iframe", "img", "input",
    "link", "math", "meta", "nav", "noscript", "object", "script", "select", "style",
    "svg", "template", "textarea", "title", "video",
}
SKIP_EPUB_TYPES = {"pagebreak", "toc", "landmarks", "page-list"}
# Font obfuscation also uses encryption.xml, but it does not hide text.
FONT_OBFUSCATION = {
    "http://www.idpf.org/2008/embedding",
    "http://ns.adobe.com/pdf/enc#RC",
}

WHITESPACE = re.compile(r"[ \t\n\r\f]+")
DROP_CAP = re.compile(r"[A-Za-z]")
WORD = re.compile(r"\w+(?:['’]\w+)*")
LONG_SENTENCE_WORDS = 50
QUOTE_MARK = re.compile(r"[“”\"‘]|(?<!\w)’|’(?!\w)")
# pysbd keeps two quoted lines together: “Did you hear that?” “No.”
QUOTE_BOUNDARY = re.compile(r"(?<=[.!?…][”\"])[ \t\n\r\f]+(?=[“\"])")
NUMBERED_ABBREVIATION = re.compile(r"\b(?:ch|chap|fig|no|nos|p|pp|vol|art|sec)\.\s*$", re.I)


class BookError(Exception):
    pass


# ---------------------------------------------------------------- EPUB reading


def check_drm(path):
    try:
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            if "META-INF/rights.xml" in names:
                raise BookError("The EPUB is DRM-protected (META-INF/rights.xml).")
            if "META-INF/encryption.xml" not in names:
                return
            root = lxml.etree.fromstring(archive.read("META-INF/encryption.xml"))
    except zipfile.BadZipFile:
        raise BookError("The file is not a valid EPUB (ZIP) archive.") from None
    for method in root.iter("{*}EncryptionMethod"):
        if method.get("Algorithm") not in FONT_OBFUSCATION:
            raise BookError("The EPUB is DRM-protected (encrypted content).")


def read_epub(path):
    check_drm(path)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            return epub.read_epub(str(path), {"ignore_ncx": False})
        except Exception as error:
            raise BookError(f"Cannot read EPUB: {error}") from None


def metadata_values(book, name):
    values = []
    for value, attributes in book.get_metadata("DC", name):
        text = clean_text(value or "")
        if text:
            values.append((text, attributes or {}))
    return values


def book_title(book):
    titles = metadata_values(book, "title")
    return titles[0][0] if titles else "Untitled"


def book_author(book):
    creators = metadata_values(book, "creator")
    authors = [
        text for text, attributes in creators
        if attributes.get("{http://www.idpf.org/2007/opf}role", "aut") == "aut"
    ]
    names = list(dict.fromkeys(authors or [text for text, _ in creators]))
    return ", ".join(names) or None


def toc_titles(book):
    """Map document file name to the first TOC title pointing into it."""
    titles = {}

    def visit(entries):
        for entry in entries:
            if isinstance(entry, (tuple, list)):
                section, children = entry[0], entry[1]
                visit([section])
                visit(children)
                continue
            href = getattr(entry, "href", None)
            title = clean_text(getattr(entry, "title", None) or "")
            if href and title:
                name = PurePosixPath(unquote(href.split("#", 1)[0])).name
                titles.setdefault(name, title)

    visit(book.toc or [])
    return titles


def spine_documents(book):
    for idref, linear in book.spine:
        if linear == "no":
            continue
        item = book.get_item_with_id(idref)
        if item is not None and item.get_type() == ebooklib.ITEM_DOCUMENT:
            yield item


# ---------------------------------------------------------------- HTML to blocks


def clean_text(text):
    return WHITESPACE.sub(" ", unicodedata.normalize("NFC", text)).strip()


def decode_document(content):
    if content.startswith(b"\xef\xbb\xbf"):
        return content[3:].decode("utf-8")
    if content.startswith((b"\xff\xfe", b"\xfe\xff")):
        return content.decode("utf-16")
    declared = re.match(rb"<\?xml[^>]*encoding=[\"']([\w.-]+)", content)
    encoding = declared.group(1).decode("ascii") if declared else "utf-8"
    try:
        return content.decode(encoding)
    except (LookupError, UnicodeDecodeError):
        return content.decode("utf-8", errors="replace")


def local_name(tag):
    """Tag or attribute name without namespace: {ns}type, epub:type -> type."""
    return re.split(r"[}:]", tag)[-1].lower() if isinstance(tag, str) else None


def should_skip(element, tag):
    if tag in SKIP_TAGS or element.get("hidden") is not None:
        return True
    for name, value in element.attrib.items():
        if local_name(name) == "type" and set(value.split()) & SKIP_EPUB_TYPES:
            return True
    return False


def document_blocks(content):
    """Return [(heading_level or 0, text)] for one XHTML document."""
    text = decode_document(content)
    text = re.sub(r"^\s*<\?xml[^>]*\?>", "", text)
    if not text.strip():
        return []
    root = lxml.html.document_fromstring(text)
    body = next((el for el in root.iter() if local_name(el.tag) == "body"), root)

    blocks = []
    buffer = []

    def flush(level=0):
        value = clean_text("".join(buffer))
        buffer.clear()
        if value:
            blocks.append((level, value))

    def walk(element):
        tag = local_name(element.tag)
        if tag == "img" and DROP_CAP.fullmatch(element.get("alt") or ""):
            buffer.append(element.get("alt"))  # Drop cap drawn as an image: <img alt="W"/>HEN
            return
        if tag is None or should_skip(element, tag):
            return
        level = HEADING_TAGS.get(tag)
        if level:
            flush()
            collect(element)
            flush(level)
            return
        if tag == "br":
            buffer.append(" ")
            return
        block = tag in BLOCK_TAGS
        if block:
            flush()
        collect(element)
        if block:
            flush()

    def collect(element):
        if element.text:
            buffer.append(element.text)
        for child in element:
            walk(child)
            if child.tail:
                buffer.append(child.tail)

    walk(body)
    flush()
    return blocks


# ---------------------------------------------------------------- Structure


def chapter_heading_level(documents):
    """The shallowest heading level used at least twice marks chapters.

    A single book-title <h1> above many <h2> chapters is then not a chapter level.
    """
    counts = Counter(level for blocks in documents for level, _ in blocks if level)
    repeated = [level for level, count in counts.items() if count >= 2]
    return min(repeated or counts or [0])


def build_chapters(book):
    """Group spine blocks into chapters of paragraphs (still unsplit text)."""
    titles = toc_titles(book)
    documents = [(item, document_blocks(item.get_content())) for item in spine_documents(book)]
    chapter_level = chapter_heading_level(blocks for _, blocks in documents)
    chapters = []

    def start(title):
        chapters.append({"title": title, "paragraphs": []})
        return chapters[-1]

    current = None
    for item, blocks in documents:
        # A document without headings starts a chapter only if the TOC names it;
        # otherwise it continues the previous chapter (e.g. a file split for size).
        if blocks and not any(level for level, _ in blocks):
            toc_title = titles.get(PurePosixPath(item.get_name()).name)
            if toc_title:
                current = start(toc_title)

        for level, text in blocks:
            if level and level <= chapter_level and (current is None or current["paragraphs"]):
                current = start(text)
                continue
            if current is None:
                current = start(None)
            # Headings right after a chapter title (subtitle) and deeper headings stay in the text.
            current["paragraphs"].append({"kind": "heading" if level else "text", "text": text})

    return chapters


class SentenceSplitter:
    def __init__(self):
        self.segmenter = pysbd.Segmenter(language="en", clean=False)

    def split(self, text):
        """Split without changing text: joining sentences with spaces gives text back."""
        sentences = []
        for piece in self.pieces(text):
            # pysbd keeps a whole quotation together; a long one is split again
            # with quote marks hidden.
            parts = self.pieces(piece, mask_quotes=True) if word_count(piece) > LONG_SENTENCE_WORDS else [piece]
            for part in parts:
                for sentence in QUOTE_BOUNDARY.split(part):
                    if sentences and continues_sentence(sentences[-1], sentence):
                        sentences[-1] += " " + sentence
                    else:
                        sentences.append(sentence)
        return sentences

    def pieces(self, text, mask_quotes=False):
        # Masking keeps every position, so boundaries found in view apply to text.
        view = QUOTE_MARK.sub(" ", text) if mask_quotes else text
        spans = []
        position = 0
        for segment in self.segmenter.segment(view):
            segment = segment.strip()
            if not segment:
                continue
            start = view.find(segment, position)
            if start < 0 or view[position:start].strip():
                return [text]  # Segmenter altered text; keep it whole.
            spans.append((start, start + len(segment)))
            position = start + len(segment)
        if not spans or view[position:].strip():
            return [text]

        pieces = []
        cut = 0
        for (_, end), (next_start, _) in zip(spans, spans[1:]):
            # Cut at the first space between segments: a closing quote stays with
            # the sentence before, an opening quote goes to the next one.
            space = re.search(r" +", text[end:next_start])
            if space:  # No space between segments: not a sentence boundary.
                pieces.append(text[cut:end + space.start()])
                cut = end + space.end()
        pieces.append(text[cut:])
        return [piece.strip() for piece in pieces]


def continues_sentence(previous, following):
    first = following[:1]
    if first.islower():  # "Stop!" | she cried.
        return True
    return first.isdigit() and bool(NUMBERED_ABBREVIATION.search(previous))  # See ch. | 4


def word_count(text):
    return len(WORD.findall(text))


def prepare(book):
    splitter = SentenceSplitter()
    chapters = []
    for chapter_number, raw in enumerate(build_chapters(book), 1):
        chapter_id = f"c{chapter_number}"
        paragraphs = []
        for paragraph_number, paragraph in enumerate(raw["paragraphs"], 1):
            paragraph_id = f"{chapter_id}.p{paragraph_number}"
            sentences = [
                {"id": f"{paragraph_id}.s{number}", "text": text}
                for number, text in enumerate(splitter.split(paragraph["text"]), 1)
            ]
            entry = {"id": paragraph_id}
            if paragraph["kind"] != "text":
                entry["kind"] = paragraph["kind"]
            entry["sentences"] = sentences
            paragraphs.append(entry)
        chapters.append({"id": chapter_id, "title": raw["title"], "paragraphs": paragraphs})
    if not chapters:
        raise BookError("No readable text found in the EPUB spine.")
    return chapters


def paginate(chapters, page_words=PAGE_WORDS):
    pages = []
    for chapter in chapters:
        chapter_pages = []
        current, words = [], 0
        for paragraph in chapter["paragraphs"]:
            for sentence in paragraph["sentences"]:
                count = word_count(sentence["text"])
                # Close the page when this sentence takes it further from the target.
                if current and abs(words + count - page_words) > abs(words - page_words):
                    chapter_pages.append((current, words))
                    current, words = [], 0
                current.append(sentence["id"])
                words += count
        if current:
            if chapter_pages and words < page_words * MIN_LAST_PAGE_SHARE:
                previous, previous_words = chapter_pages.pop()
                current, words = previous + current, previous_words + words
            chapter_pages.append((current, words))
        for sentence_ids, words in chapter_pages:
            pages.append({
                "number": len(pages) + 1,
                "chapterId": chapter["id"],
                "words": words,
                "sentenceIds": sentence_ids,
            })
    return pages


def text_hash(title, author, chapters):
    """SHA-256 of the prepared text only, so the source file name never matters."""
    canonical = {
        "title": title,
        "author": author,
        "chapters": [
            {
                "title": chapter["title"],
                "paragraphs": [
                    {
                        "kind": paragraph.get("kind", "text"),
                        "sentences": [sentence["text"] for sentence in paragraph["sentences"]],
                    }
                    for paragraph in chapter["paragraphs"]
                ],
            }
            for chapter in chapters
        ],
    }
    data = json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def check_pages(chapters, pages):
    expected = [s["id"] for c in chapters for p in c["paragraphs"] for s in p["sentences"]]
    actual = [sentence_id for page in pages for sentence_id in page["sentenceIds"]]
    if actual != expected:
        raise BookError("Internal error: pages do not cover every sentence exactly once.")


def build_book(path, page_words=PAGE_WORDS):
    book = read_epub(path)
    title, author = book_title(book), book_author(book)
    chapters = prepare(book)
    pages = paginate(chapters, page_words)
    check_pages(chapters, pages)
    return {
        "formatVersion": FORMAT_VERSION,
        "bookId": text_hash(title, author, chapters),
        "title": title,
        "author": author,
        "chapters": chapters,
        "pages": pages,
    }


# ---------------------------------------------------------------- Preview


PREVIEW_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__ · preview</title>
<style>
  :root { color-scheme: light dark; --bg: #faf8f3; --fg: #1f1d1a; --muted: #77716a; --line: #e2ddd3; --accent: #2f5d8a; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1b1a18; --fg: #e9e5dd; --muted: #9a948b; --line: #34312d; --accent: #8ab4dc; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 19px/1.6 Georgia, "Times New Roman", serif; }
  .wrap { max-width: 40rem; margin: 0 auto; padding: 1.5rem 1rem 6rem; }
  header { border-bottom: 1px solid var(--line); padding-bottom: .75rem; margin-bottom: 1.5rem; font-family: system-ui, sans-serif; }
  header h1 { font-size: 1.1rem; margin: 0; }
  header p { margin: .15rem 0 0; color: var(--muted); font-size: .9rem; }
  .running { color: var(--muted); font: .85rem system-ui, sans-serif; margin-bottom: 1rem; }
  h2 { font-size: 1.5rem; line-height: 1.3; margin: .5rem 0 1.5rem; }
  h3 { font-size: 1.15rem; margin: 1.5rem 0 .75rem; }
  p { margin: 0 0 .9rem; }
  nav { position: fixed; left: 0; right: 0; bottom: 0; background: var(--bg); border-top: 1px solid var(--line);
        display: flex; align-items: center; justify-content: center; gap: 1rem; padding: .6rem 1rem; font-family: system-ui, sans-serif; }
  button { font: inherit; padding: .4rem 1rem; border: 1px solid var(--line); border-radius: .4rem; background: transparent; color: var(--accent); cursor: pointer; }
  button:disabled { color: var(--muted); cursor: default; }
  #counter { min-width: 9rem; text-align: center; color: var(--muted); font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<div class="wrap">
  <header><h1 id="book-title"></h1><p id="book-author"></p></header>
  <main id="page"></main>
</div>
<nav>
  <button id="prev" type="button">Previous</button>
  <span id="counter"></span>
  <button id="next" type="button">Next</button>
</nav>
<script id="book-data" type="application/json">__BOOK_JSON__</script>
<script>
(function () {
  "use strict";
  var book = JSON.parse(document.getElementById("book-data").textContent);
  var sentences = {}, chapters = {};
  book.chapters.forEach(function (chapter) {
    chapters[chapter.id] = chapter;
    chapter.paragraphs.forEach(function (paragraph) {
      paragraph.sentences.forEach(function (sentence, index) {
        sentences[sentence.id] = { text: sentence.text, paragraph: paragraph, first: index === 0 };
      });
    });
  });

  function el(tag, text) {
    var node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  }

  document.title = book.title + " · preview";
  document.getElementById("book-title").textContent = book.title;
  document.getElementById("book-author").textContent = book.author || "";

  var main = document.getElementById("page");
  var prev = document.getElementById("prev");
  var next = document.getElementById("next");
  var counter = document.getElementById("counter");
  var index = 0;

  function render() {
    var page = book.pages[index];
    var chapter = chapters[page.chapterId];
    var chapterStart = index === 0 || book.pages[index - 1].chapterId !== page.chapterId;
    main.replaceChildren();
    if (chapterStart) {
      if (chapter.title) main.appendChild(el("h2", chapter.title));
    } else {
      main.appendChild(el("div", chapter.title || "")).className = "running";
    }
    var block = null, current = null;
    page.sentenceIds.forEach(function (id) {
      var sentence = sentences[id];
      if (sentence.paragraph !== current) {
        current = sentence.paragraph;
        block = main.appendChild(el(current.kind === "heading" ? "h3" : "p"));
      }
      if (block.childNodes.length) block.appendChild(document.createTextNode(" "));
      block.appendChild(el("span", sentence.text)).dataset.id = id;
    });
    counter.textContent = "Page " + page.number + " of " + book.pages.length;
    prev.disabled = index === 0;
    next.disabled = index === book.pages.length - 1;
    if (location.hash !== "#page=" + page.number) history.replaceState(null, "", "#page=" + page.number);
    window.scrollTo(0, 0);
  }

  function go(delta) {
    var target = index + delta;
    if (target >= 0 && target < book.pages.length) { index = target; render(); }
  }

  prev.addEventListener("click", function () { go(-1); });
  next.addEventListener("click", function () { go(1); });
  document.addEventListener("keydown", function (event) {
    if (event.key === "ArrowLeft") go(-1);
    if (event.key === "ArrowRight") go(1);
  });
  var match = /^#page=(\\d+)$/.exec(location.hash);
  if (match) index = Math.min(Math.max(Number(match[1]) - 1, 0), book.pages.length - 1);
  render();
})();
</script>
</body>
</html>
"""


def embed_json(data):
    """JSON that cannot close the <script> element or break JavaScript parsing."""
    return (
        data.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
        .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    )


def render_preview(book_json, title):
    return (
        PREVIEW_TEMPLATE
        .replace("__TITLE__", html.escape(title))
        .replace("__BOOK_JSON__", embed_json(book_json))
    )


# ---------------------------------------------------------------- CLI


def main(argv=None):
    parser = argparse.ArgumentParser(description="Prepare an English EPUB for reading.")
    parser.add_argument("input", type=Path, help="EPUB file without DRM")
    parser.add_argument("--output", type=Path, default=Path("output"), help="output folder")
    parser.add_argument("--words", type=int, default=PAGE_WORDS, help="target words per page")
    args = parser.parse_args(argv)

    if not args.input.is_file():
        parser.error(f"file not found: {args.input}")
    if args.words < 1:
        parser.error("--words must be positive")
    try:
        book = build_book(args.input, args.words)
    except BookError as error:
        sys.exit(f"Error: {error}")

    book_json = json.dumps(book, ensure_ascii=False, indent=2) + "\n"
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "book.json").write_text(book_json, encoding="utf-8")
    (args.output / "preview.html").write_text(render_preview(book_json, book["title"]), encoding="utf-8")

    sentence_total = sum(len(p["sentences"]) for c in book["chapters"] for p in c["paragraphs"])
    print(f"{book['title']} — {book['author'] or 'unknown author'}")
    print(f"{len(book['chapters'])} chapters, {sentence_total} sentences, {len(book['pages'])} pages")
    print(f"bookId {book['bookId']}")
    print(f"Wrote {args.output / 'book.json'} and {args.output / 'preview.html'}")


if __name__ == "__main__":
    main()
