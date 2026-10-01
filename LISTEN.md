# Listen

Static HTML + JavaScript, served by GitHub Pages. No backend, API key,
package installation or build step is required. Open `listen.html` from the menu.

## Add a lesson

1. Create `listen/my-lesson.json`:

   ```json
   {
     "title": "My lesson",
     "youtube": "https://www.youtube.com/watch?v=VIDEO_ID",
     "segments": [
       { "start": 12.5, "end": 17.2, "text": "Today is a good day" },
       { "start": 18, "end": 22.4, "text": "Let us walk together" }
     ]
   }
   ```

   These sentences are format examples, not a transcript of the test video.
   Supply the text you want to use. Times are seconds from the beginning of
   that exact YouTube video, including its intro. Fractions are allowed.
   Phrases must be chronological, must not overlap, and must have `end > start`.
   Leave a small gap before the next phrase where possible.

2. Add an entry to `listen.json`:

   ```json
   {
     "id": "my-lesson",
     "title": "My lesson",
     "description": "A short description",
     "file": "listen/my-lesson.json"
   }
   ```

3. Publish the changed files with your usual GitHub Pages workflow.
   Lesson link: `listen.html?lesson=my-lesson`.

The optional `note` field in a lesson is shown above its player.
Do not repeat the full transcript separately: `segments[].text` is enough.

## Test lesson

The supplied Counting Stars lesson contains only one short quotation (7 words),
not the full song. Its provisional 0–5 second boundaries come from the English
captions of the [selected video](https://www.youtube.com/watch?v=hT_nvWreIhg).
The caption export reports whole seconds; check the cut by ear in Telegram.
The site neither downloads the video nor stores an audio copy.

## Playback

- Listen starts a bounded clip through the official YouTube IFrame API.
- At the end, the player pauses and the word buttons appear.
- Incorrect choices leave the answer untouched. Identical words are interchangeable.
- Listen again replays the current phrase and preserves the answer so far.
- The next phrase starts only when Next phrase is clicked. Finishing never starts
  the next video automatically.
- Leaving the page or putting it in the background pauses playback.
- Progress lives only in the current page; refreshing starts over.

The player stays visible, including YouTube controls. If the browser blocks
playback, press Play inside the video. Videos must permit embedding. Ads,
network conditions and Telegram's browser can affect playback. A connection
error displays Retry and a link to the original video. Opening the original
video does not carry over the exercise.

## Local checks

Serve the repository over HTTP (opening the HTML as `file://` will not work):

```sh
python3 -m http.server 8765 --bind 127.0.0.1
node --test tests/listen.test.cjs
```

Then open `http://127.0.0.1:8765/listen.html`. Test the published version inside
Telegram as well: local browser playback does not guarantee Telegram playback.
