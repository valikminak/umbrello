# Listen

A static page with one native HTML video player. The video streams directly
from its public Supabase Storage URL. No YouTube API, backend, storage SDK, tokens,
package installation or build step is needed.

## Playback

1. Press Play once. The video starts at the beginning and shuffled words appear immediately.
2. At each unfinished phrase's `end`, playback pauses. Words and any partial answer stay visible.
3. Click the words in the order heard, during playback or while paused. Each
   correct word glides to the next slot at the front of the row, turns green and
   ignores further taps. The words it passes shift along without changing their
   order. A wrong word shakes and stays where it is. With reduced motion enabled
   in the system, words move without the glide.
4. The last correct word immediately resumes the same video at its current
   position. The assembled phrase stays on screen for a second, then the next
   phrase's words replace it, or at once if the video pauses for that phrase
   sooner. There is no Next button and no automatic seeking.
5. Instrumental passages and the outro play in full. The lesson finishes when
   the video itself ends.

Enable the **показати переклад** switch to show a Ukrainian hint above the words while
arranging a phrase. The switch stays visible in every playback state and sticks
to the top when scrolling. It is off by default; the browser remembers your choice
when local storage is available. Switching it does not reset your answer.
Phrases without a translation simply show no hint.

Repeat is the only phrase-level action that rewinds: it returns to that phrase's
`start`, preserving the placed words, word order and translation.
Leaving the app pauses playback; returning
shows a Play button. If a browser rejects playback, Play retries without losing
the current position. Progress is kept only in the current page.

## Lesson files

`listen/index.json` lists the lessons shared by every allowed account. Each lesson has its own JSON file in the same `listen/` folder:

```json
{
  "title": "My lesson",
  "video": "https://media.example.com/my-video.mp4",
  "segments": [
    { "start": 12.52, "end": 17.24, "text": "Today is a good day", "translationUk": "Сьогодні гарний день." },
    { "start": 21.08, "end": 25.43, "text": "Let us walk together", "translationUk": "Ходімо разом." }
  ]
}
```

These are example sentences. Times are seconds from the beginning of the exact
video file. Use fractional seconds, chronological non-overlapping phrases,
and `end > start`. `end` controls the pause; `start` is used only for Repeat.
An instrumental gap between phrases is never skipped. The title appears only
in the lesson list.
`translationUk` is optional Ukrainian text, displayed as plain text.

Add the new lesson to `listen/index.json`:

```json
{
  "id": "my-lesson",
  "title": "My lesson",
  "file": "my-lesson.json",
  "level": "B1"
}
```

`file` is a file name inside `listen/`, so the entry above loads
`listen/my-lesson.json`. `level` is the CEFR difficulty (`A1`–`C2`); the lesson
list shows every lesson by default and offers a filter for each level present.
Use `tools/listen-time-getter.html` to prepare phrase timings.

## Supabase video

Use a stable public HTTPS object URL, not a dashboard link, API endpoint or
an expiring signed URL. MP4 with H.264 video and AAC audio is recommended for
mobile compatibility. Set the object's Content-Type to `video/mp4`. Byte-range
responses allow the browser to buffer and seek efficiently. Keep the original
video timeline when converting the file.

The player uses `<video src>` directly, without `crossorigin`, canvas, or
JavaScript fetching of the media bytes. It does not need Supabase API keys or
SDKs. The current public URL is already in `listen/counting-stars.json`.
Another public file host, including R2, works with the same `video` field.

## Counting Stars timing

Phrase boundaries are edited manually in `listen/counting-stars.json` against
the video. Keep those timings and phrase groupings when adding translations;
do not replace them with automatic caption boundaries. Contractions such as
`I've` remain intact. Every current phrase includes a Ukrainian translation.

## Checks

```sh
python3 -m http.server 8765 --bind 127.0.0.1
node --test tests/listen.test.cjs
```

Open `http://127.0.0.1:8765/listen.html` and test the published site inside
Telegram as well. Opening the page as `file://` does not support loading JSON.

## Updating the Telegram mini app

The Listen controller and styles currently use `v=11`. When publishing a new release,
bump them together with the page: an old cached HTML page can still request old scripts.
If Telegram keeps the old entry page after deployment, update the bot's mini-app
launch URL to `index.html?v=10` (or append `&v=10` if it already has a query).
For a direct lesson launch, keep `lesson=counting-stars` in the URL; no profile is needed.
The launch URL is configured outside this repository; local edits do not update it.
