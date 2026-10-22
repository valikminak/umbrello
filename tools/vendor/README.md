# Dependencies for book-preparer.html

Browser distributions are stored locally so the converter can be opened without
an internet connection. They are loaded as classic scripts; no build is needed.

| File | Version | Source | License |
| --- | --- | --- | --- |
| `jszip-3.10.1.min.js` | JSZip 3.10.1 | https://raw.githubusercontent.com/Stuk/jszip/v3.10.1/dist/jszip.min.js | MIT or GPLv3; see `jszip-LICENSE.md` |
| `sbd-1.0.19.min.js` | SBD 1.0.19 | https://cdn.jsdelivr.net/npm/sbd@1.0.19/dist/sbd.min.js | MIT; see `sbd-LICENSE.txt` |

Upstream projects: https://github.com/Stuk/jszip and https://github.com/Tessmore/sbd.
The sentence splitter is called with HTML sanitization disabled because the
converter extracts plain text from an inert document before segmentation.
