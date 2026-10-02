# Listen

A static page with one native HTML video player. The video streams directly
from its public Supabase Storage URL. No YouTube API, backend, storage SDK, tokens,
package installation or build step is needed.

## Playback

1. Press Play once. The video starts at the beginning.
2. At each phrase's `end`, playback pauses and shuffled words appear below it.
3. Click the words in the order heard. A wrong word does not advance the answer.
4. The last correct word immediately resumes the same video at its current
   position. There is no Next button and no automatic seeking.
5. Instrumental passages and the outro play in full. The lesson finishes when
   the video itself ends.

Repeat is the only phrase-level action that rewinds: it clears the answer and
returns to that phrase's `start`. Leaving the app pauses playback; returning
shows a Play button. If a browser rejects playback, Play retries without losing
the current position. Progress is kept only in the current page.

## Lesson files

`listen.json` lists the available lessons. Each lesson has its own JSON file:

```json
{
  "title": "My lesson",
  "video": "https://media.example.com/my-video.mp4",
  "segments": [
    { "start": 12.52, "end": 17.24, "text": "Today is a good day" },
    { "start": 21.08, "end": 25.43, "text": "Let us walk together" }
  ]
}
```

These are example sentences. Times are seconds from the beginning of the exact
video file. Use fractional seconds, chronological non-overlapping phrases,
and `end > start`. `end` controls the pause; `start` is used only for Repeat.
An instrumental gap between phrases is never skipped. The title appears only
in the lesson list.

Add the new lesson to `listen.json`:

```json
{
  "id": "my-lesson",
  "title": "My lesson",
  "file": "listen/my-lesson.json"
}
```

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

The 69 phrases are aligned to the embedded English WebVTT track in the supplied
283.051-second video. Millisecond timestamps replace the earlier rounded
caption export. Split caption fragments are merged into complete phrases;
music/effect captions are omitted. Contractions such as `I've` remain intact.
These are the source caption boundaries, not a claim that every cut has been
independently verified by ear.

## Checks

```sh
python3 -m http.server 8765 --bind 127.0.0.1
node --test tests/listen.test.cjs
```

Open `http://127.0.0.1:8765/listen.html` and test the published site inside
Telegram as well. Opening the page as `file://` does not support loading JSON.
