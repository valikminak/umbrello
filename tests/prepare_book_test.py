"""Checks for tools/prepare-book.py.

Run: python -m unittest tests/prepare_book_test.py  (needs tools/requirements.txt)
"""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import re
import shutil
import tempfile
import unittest
import zipfile


TOOL = Path(__file__).resolve().parent.parent / "tools" / "prepare-book.py"
spec = importlib.util.spec_from_file_location("prepare_book", TOOL)
prepare_book = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare_book)


CHAPTER_ONE = """<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>One</title><style>p { color: red; }</style><script>alert("head")</script></head>
<body>
<h1>Chapter 1</h1>
<h2>The <em>Visitor</em></h2>
<p>Mr. Smith met Dr. Jones at 5 p.m. on Baker St. yesterday. They talked about the U.S. economy, e.g. prices in Jan. and Feb.</p>
<p>“Stop!” she cried. “Where are you going?”</p>
<p>"I don't know," said Mrs. Brown. "Maybe tomorrow." Then she left.</p>
<p>“Wait,” whispered Anna. “Did you hear that?” “No.”</p>
<script>document.write("hidden")</script>
<p>See ch. 4 for details.<span epub:type="pagebreak" title="12">12</span> J. R. R. Tolkien wrote it.</p>
<p>Code: &lt;script&gt;alert("x")&lt;/script&gt; &amp; more.</p>
</body></html>
"""

CHAPTER_TWO_INTRO = """<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Two</title></head>
<body><h1>Chapter 2</h1><p><span class="dropcap"><img alt="T" src="t.png"/></span>HIS chapter starts with a drop cap.</p><p>__BODY__</p></body></html>"""

LONG_SENTENCE = "The quiet river ran past the old mill and on towards the sea"


def long_chapter():
    # 60 sentences of 13 words = 780 words, so several pages.
    sentences = [f"{LONG_SENTENCE} number {i}." for i in range(1, 61)]
    return CHAPTER_TWO_INTRO.replace("__BODY__", " ".join(sentences))


CONTAINER = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"""

# Manifest order differs from spine order on purpose.
PACKAGE = """<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">test-book</dc:identifier><dc:title>__TITLE__</dc:title>
<dc:creator>Jane Doe</dc:creator><dc:language>en</dc:language>
</metadata>
<manifest>
<item id="two" href="text/two.xhtml" media-type="application/xhtml+xml"/>
<item id="one" href="text/one.xhtml" media-type="application/xhtml+xml"/>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
</manifest>
<spine><itemref idref="nav"/><itemref idref="one"/><itemref idref="two"/></spine>
</package>"""

NAV = """<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head><body><nav epub:type="toc"><h1>Contents</h1><ol>
<li><a href="text/one.xhtml">First</a></li><li><a href="text/two.xhtml">Second</a></li>
</ol></nav></body></html>"""

ENCRYPTION = """<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
 xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData>
<enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
<enc:CipherData><enc:CipherReference URI="OEBPS/text/one.xhtml"/></enc:CipherData>
</enc:EncryptedData></encryption>"""


def make_epub(path, title="Small Test Book"):
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("mimetype", "application/epub+zip", zipfile.ZIP_STORED)
        archive.writestr("META-INF/container.xml", CONTAINER)
        archive.writestr("OEBPS/content.opf", PACKAGE.replace("__TITLE__", title))
        archive.writestr("OEBPS/nav.xhtml", NAV)
        archive.writestr("OEBPS/text/one.xhtml", CHAPTER_ONE)
        archive.writestr("OEBPS/text/two.xhtml", long_chapter())


class PrepareBookTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.source = self.dir / "book.epub"
        make_epub(self.source)
        self.book = prepare_book.build_book(self.source)

    def tearDown(self):
        shutil.rmtree(self.dir)

    def sentences(self, chapter=0):
        return [s["text"] for p in self.book["chapters"][chapter]["paragraphs"] for s in p["sentences"]]

    def test_metadata_and_spine_order(self):
        self.assertEqual(self.book["formatVersion"], 1)
        self.assertEqual(self.book["title"], "Small Test Book")
        self.assertEqual(self.book["author"], "Jane Doe")
        self.assertEqual([c["title"] for c in self.book["chapters"]], ["Chapter 1", "Chapter 2"])
        self.assertEqual([c["id"] for c in self.book["chapters"]], ["c1", "c2"])

    def test_subheading_and_markup_removed(self):
        first = self.book["chapters"][0]["paragraphs"][0]
        self.assertEqual(first["kind"], "heading")
        self.assertEqual(first["sentences"][0]["text"], "The Visitor")
        text = json.dumps(self.book)
        for leaked in ("color: red", 'alert(\\"head\\")', "document.write", "12 J."):
            self.assertNotIn(leaked, text)

    def test_abbreviations_and_dialogue(self):
        self.assertEqual(self.sentences()[1:], [
            "Mr. Smith met Dr. Jones at 5 p.m. on Baker St. yesterday.",
            "They talked about the U.S. economy, e.g. prices in Jan. and Feb.",
            "“Stop!” she cried.",
            "“Where are you going?”",
            "\"I don't know,\" said Mrs. Brown.",
            "\"Maybe tomorrow.\"",
            "Then she left.",
            "“Wait,” whispered Anna.",
            "“Did you hear that?”",
            "“No.”",
            "See ch. 4 for details.",
            "J. R. R. Tolkien wrote it.",
            "Code: <script>alert(\"x\")</script> & more.",
        ])

    def test_drop_cap_letter_kept(self):
        self.assertEqual(self.sentences(1)[0], "THIS chapter starts with a drop cap.")

    def test_ids_and_hash_are_stable(self):
        renamed = self.dir / "renamed-copy.epub"
        shutil.copy(self.source, renamed)
        again = prepare_book.build_book(renamed)
        self.assertEqual(again, self.book)
        self.assertRegex(self.book["bookId"], r"^[0-9a-f]{64}$")
        paragraph = self.book["chapters"][0]["paragraphs"][1]
        self.assertEqual(paragraph["id"], "c1.p2")
        self.assertEqual([s["id"] for s in paragraph["sentences"]], ["c1.p2.s1", "c1.p2.s2"])

    def test_hash_follows_text(self):
        other = self.dir / "other.epub"
        make_epub(other, title="Another Title")
        self.assertNotEqual(prepare_book.build_book(other)["bookId"], self.book["bookId"])

    def test_pages(self):
        pages = self.book["pages"]
        self.assertEqual([p["number"] for p in pages], list(range(1, len(pages) + 1)))
        self.assertEqual(pages[0]["chapterId"], "c1")
        self.assertTrue(all(p["chapterId"] == "c2" for p in pages[1:]))
        self.assertTrue(all(p["sentenceIds"][0].startswith(p["chapterId"] + ".") for p in pages))
        # Chapter 2 has a 7-word sentence, then 60 sentences of 15 words: about 300 words per page.
        self.assertEqual([p["words"] for p in pages[1:]], [306, 300, 301])
        for page in pages:  # References only, no text.
            self.assertEqual(set(page), {"number", "chapterId", "words", "sentenceIds"})

    def test_short_chapter_end_joins_previous_page(self):
        texts = ["one two three four five six seven eight nine ten."] * 6 + ["one two three four five."]
        chapter = {"id": "c1", "paragraphs": [
            {"id": "c1.p1", "sentences": [{"id": f"c1.p1.s{i}", "text": t} for i, t in enumerate(texts, 1)]},
        ]}
        pages = prepare_book.paginate([chapter], page_words=30)
        self.assertEqual([p["words"] for p in pages], [30, 35])

    def test_encrypted_epub_is_rejected(self):
        with zipfile.ZipFile(self.source, "a") as archive:
            archive.writestr("META-INF/encryption.xml", ENCRYPTION)
        with self.assertRaisesRegex(prepare_book.BookError, "DRM"):
            prepare_book.build_book(self.source)

    def test_cli_writes_safe_preview(self):
        output = self.dir / "out"
        with contextlib.redirect_stdout(io.StringIO()):
            prepare_book.main([str(self.source), "--output", str(output)])
        saved = json.loads((output / "book.json").read_text(encoding="utf-8"))
        self.assertEqual(saved, self.book)
        preview = (output / "preview.html").read_text(encoding="utf-8")
        data = re.search(r'<script id="book-data" type="application/json">(.*?)</script>', preview, re.S)
        self.assertEqual(json.loads(data.group(1)), saved)
        self.assertNotIn("<script>alert", preview)
        self.assertEqual(preview.count("</script>"), 2)


if __name__ == "__main__":
    unittest.main()
