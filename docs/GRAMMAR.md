# Grammar: one private unit, with no saved learning history

Grammar is a separate module alongside Write. Its first unit covers present simple
and present continuous. The page loads one private unit, lets you practise and
listen using answer keys, and asks OpenAI to review original English writing only
when you press the writing check button.

The CD-ROM supplies the two practice exercises and their recorded audio. The
short theory explanations, writing task and final review in
`tools/grammar-unit-001.json` are newly authored additions. This first unit is not
a digital copy of all the book's explanations, nor completion of the whole book.

## Architecture

```text
GitHub Pages: public HTML, CSS and JavaScript
    │ POST + Telegram initData in the request body
    ▼
Cloudflare Worker: checks Telegram signature and allowed user ID
    ├─ reads the private unit JSON and MP3 files from Supabase Storage
    └─ sends the unit's writing task + focus + learner text to OpenAI on Check
```

The browser receives neither the Supabase server key nor a public/signed download
URL. Audio is fetched through the Worker and played from a temporary browser
Blob. The Worker uses `Cache-Control: no-store` for Grammar responses, has a
15-second storage timeout, limits unit JSON to 256 KiB and each MP3 to 2 MiB, and
does not follow storage redirects. Audio must be listed in the unit before it can
be fetched.

Only `unit-001` is enabled in this version. Adding later units will require
extending the explicit Worker unit/path validation as well as adding content.

## Prepare the private files

From the repository directory, run the converter against your local CD folder:

```sh
python3 tools/build-grammar-unit.py --source '/Users/valentinminakov/Downloads/Advanced Grammar in Use with Answers CD-ROM'
```

The converter reads XML and copies the 24 referenced MP3 files. It does not run
the old CD application. Its default output directory is ignored by Git:

```text
private/grammar-upload/
├── unit-001.json
└── unit-001/
    └── audio/
        ├── 11e1.mp3
        ├── 11e2.mp3
        ├── 111.mp3
        └── …
```

Do not commit this output or copy it into the published GitHub Pages directory.
`tools/grammar-unit-001.json` is only the authored supplementary content used by
the converter; it is not the finished unit file to upload.

## Set up private Supabase Storage

1. Open your existing Supabase project, then **Storage**.
2. Create a bucket named `grammar`, leaving **Public bucket** disabled. If it
   already exists, confirm that it is private.
   An existing private bucket such as `Umbrello` works too: set
   `SUPABASE_GRAMMAR_BUCKET` to its exact, case-sensitive name in the Worker.
3. Upload the **contents** of `private/grammar-upload/` into that bucket,
   preserving folders. The exact storage keys must be `unit-001.json` and
   `unit-001/audio/111.mp3`, etc. Do not add an extra `grammar-upload/` parent.
   If the dashboard only uploads files, create the `unit-001/audio` folders and
   upload the MP3s there, then upload `unit-001.json` at the bucket root.
4. Copy the project's HTTPS URL from the project's connection details. This
   implementation expects `https://<project-ref>.supabase.co`, without extra
   paths or query strings.
5. In **Settings → API Keys**, use a server secret key beginning `sb_secret_`.
   The Worker also accepts the legacy JWT `service_role` key. Do not use the
   browser publishable/anon key for this backend.

No public read policy or browser Supabase login is needed for this design.
Supabase documents [private object downloads](https://supabase.com/docs/guides/storage/serving/downloads)
and [server API keys](https://supabase.com/docs/guides/api/api-keys). New secret
keys are sent in the `apikey` header; legacy JWT keys additionally use
`Authorization: Bearer`. The key remains exclusively in Cloudflare secrets.

## Configure the existing Cloudflare Worker

Keep the existing Worker and its working Write configuration. Open
**Settings → Variables and Secrets** and add:

| Name | Type | Value |
| --- | --- | --- |
| `SUPABASE_URL` | Variable | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Your `sb_secret_…` key, or legacy service-role JWT |
| `SUPABASE_GRAMMAR_BUCKET` | Variable, optional | `grammar` (the default) |
| `GRAMMAR_ALLOWED_USER_IDS` | Variable | Your numeric Telegram ID; additional IDs separated by commas |

Despite its compatibility-oriented name, `SUPABASE_SERVICE_ROLE_KEY` accepts the
new secret key format. Paste the key directly into Cloudflare, not into chat,
client JavaScript, the unit JSON or a Git-tracked file.

Keep `BOT_TOKEN`, `CHAT_ID`, `OPENAI_API_KEY` and `OPENAI_MODEL` unchanged. Grammar
writing feedback reuses the existing model. Other Grammar activities use no AI.

To find your Telegram ID without using another bot: after publishing the new
page and Worker, open **Grammar → Open unit** inside your Telegram mini app.
When access is not configured, the connection help displays **Your Telegram
account ID**. Copy that number into `GRAMMAR_ALLOWED_USER_IDS` and save/deploy
the updated Worker configuration. If the browser has no Telegram launch data,
close it and reopen through the bot. A profile label such as `?user=me` is not an
authentication credential and does not grant access.

An empty or malformed allowlist blocks Grammar. Valid Telegram users who are not
listed also cannot retrieve a unit, audio or AI feedback. This new restriction
applies to Grammar; it does not change Write or report authorization.

## Deploy and verify

1. Replace the Cloudflare Worker's code with `worker/cf_worker.js`, retaining all
   existing bindings, variables and secrets, then deploy it.
2. Publish the updated public site files using the project's existing GitHub
   Pages workflow. Keep private generated materials out of that publication.
3. Close and reopen the Telegram mini app, then open Grammar and load Unit 1.
4. Check theory, one gap exercise and a multiple-choice question with more than
   one valid answer. These checks should be immediate and require no AI request.
5. Play an example and a listening question. Both must work without opening a
   Supabase URL. An unreferenced filename must not be downloadable through the
   Worker.
6. Submit a short original text in the unit's writing task. Check that feedback
   discusses original writing and uses English, with an **improved version**
   rather than a Ukrainian translation. This step makes one paid AI request.
7. Reload the page. Answers, generated feedback and the current session's
   completion state should be gone. Recheck Write generation and checking once
   to confirm the deployed existing feature still works.
8. If you have another Telegram account outside the allowlist, verify that it
   cannot load Grammar. Opening the public page in an ordinary browser must not
   reveal course material without valid Telegram launch data.

Local regression checks:

```sh
node --test tests/grammar-worker.test.cjs tests/worker.test.cjs tests/grammar.test.cjs
```

Optional browser checks, after building the private package, with Playwright and
Chrome installed:

```sh
node tools/check-grammar-browser.cjs
# If Playwright is provided by another runtime:
node tools/check-grammar-browser.cjs --playwright-path /absolute/path/to/playwright
```

The browser check serves the local page through intercepted requests, mocks
Telegram and all API responses, and decodes the local MP3 recordings. It makes
no real storage or AI calls. It checks the full unit flow, failure recovery,
multiple correct answers, background feedback, audio races, narrow layouts and
clearing work on reload. Screenshots are written into a temporary directory.

These tests mock storage and AI. Passing them does not confirm that the actual
Supabase files, secrets or deployed Worker are configured; the live checks above
provide that confirmation.

## API contract

All routes require POST JSON containing `initData`. The Worker verifies its
Telegram signature and age, then checks the signed user's numeric ID against the
allowlist. All responses use `no-store`.

| Route | Additional request fields | Success |
| --- | --- | --- |
| `/grammar/unit` | `unitId: "unit-001"` | Validated unit JSON, schema version 1 |
| `/grammar/audio` | `path: "unit-001/audio/111.mp3"` | MP3 bytes, `audio/mpeg` |
| `/grammar/check` | `unitId: "unit-001", text: "…"` | `summary`, `errors`, `targetFeedback`, `improvedVersion` |

The writing endpoint ignores any client-supplied task, focus, model or history.
It loads the task and focus from the private unit itself. Each correction must
quote an exact non-empty fragment of the submitted text. Correct alternatives
and stylistic preferences should not be marked as errors; practising the target
is discussed separately. OpenAI uses [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses),
`store: false`, no conversation ID, and no automatic paid retries. Telegram
identity is not sent to OpenAI. Raw provider diagnostics and secret values are
not returned to the client.

## Troubleshooting

| Error code | What to check |
| --- | --- |
| `unauthorized` | Reopen from Telegram; launch data is invalid or older than 24 hours. |
| `grammar_not_configured` | Missing/malformed allowlist, Supabase URL/key, or bucket name. |
| `grammar_forbidden` | The signed Telegram account ID is not allowed. |
| `grammar_not_found` | Upload the exact storage path; requested audio must be listed in the unit. |
| `grammar_storage_auth` | Server secret key and private bucket access. |
| `grammar_storage_error` | Storage availability, file type/size, and uploaded files. |
| `grammar_runtime_cache` | Enable `cache_option_enabled` under Worker compatibility flags and deploy. Older runtime settings can reject `cache: no-store` before making a network request. |
| `grammar_storage_network` | Supabase project URL, availability and network connection; no HTTP response was received. |
| `grammar_storage_read` / `grammar_storage_empty` | Storage returned unreadable or empty data. |
| `grammar_storage_size` | Use the generated JSON (at most 256 KiB) and original MP3 (at most 2 MiB each). |
| `grammar_audio_type` | Upload the original MP3 with an audio MIME type. |
| `grammar_storage_timeout` | Try again after checking storage availability. |
| `grammar_content_invalid` | Rebuild and upload the complete generated `unit-001.json`. |
| `not_configured` / `provider_*` / `rate_limit` | Existing OpenAI configuration or account; see `WRITE.md`. |

Unit JSON is parsed and schema-validated regardless of its upload MIME metadata
(for example, `text/plain` is accepted when the contents are valid unit JSON).
Raw storage error bodies are never returned. HTTP failures include only the
numeric upstream status alongside a safe error code. The runtime cache flag is
documented in [Cloudflare's compatibility notes](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#enable-cache-no-store-http-standard-api).

## Stateless boundaries

Supabase stores fixed learning materials only. Grammar writes no learner answers,
history, scores or progress there. Cloudflare keeps no learning session. The
browser holds current work and audio Blobs in page memory and uses no persistent
storage for this module. A refresh starts again; persistent course completion or
spaced repetition would require a separately agreed storage design.

Only a writing check sends the learner's text to the AI provider. `store: false`
is used for that API request; it does not replace the provider's independent
data-handling policies. The application itself logs neither that text nor
Telegram launch data or server secrets.
