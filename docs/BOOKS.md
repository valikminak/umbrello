# Books: подготовка, хранение и чтение книг

**Read** состоит из двух вкладок:

- **Learn words** — прежнее чтение из `users/<id>/read.json` со словарём и тестом.
- **Books** — библиотека и простая читалка готовых книг.

Книги и каталог хранятся в приватном Supabase Storage и приходят только через
Cloudflare Worker. Worker проверяет подпись Telegram `initData` и пускает лишь
аккаунты из `BOOKS_ALLOWED_USER_IDS`. Выбранный профиль (`?user=me`) — только
подпись в интерфейсе, а не авторизация. Доступ к Grammar настраивается отдельно
и не меняется.

```text
GitHub Pages: books.html + JS/CSS, без текста книг
    │ POST + Telegram initData
    ▼
Cloudflare Worker: подпись Telegram → BOOKS_ALLOWED_USER_IDS
    └─ читает books/index.json и книги из каталога в приватном Storage
```

Позиция чтения, история, словарь и загрузка EPUB через интерфейс пока не
предусмотрены. Книга целиком загружается при открытии и живёт только в памяти
страницы.

## 1. Подготовить книгу (uv)

Зависимости конвертера описаны в `tools/pyproject.toml` и `tools/uv.lock`
(Python 3.14). Нужен установленный [uv](https://docs.astral.sh/uv/).
Команды выполняются из корня репозитория; `uv run` сам создаёт `tools/.venv`
и ставит зафиксированные версии.

```sh
uv run --project tools tools/prepare-book.py "path/to/My Book.epub" --output output/my-book
```

В `output/my-book/` появятся:

- `book.json` — то, что загружается в Storage;
- `preview.html` — локальная проверка разбиения, открывается двойным кликом.
  В Storage его не загружают.

Конвертер печатает `bookId` — он понадобится для каталога. Необязательный
`--words 250` меняет размер страницы (по умолчанию около 300 слов).
`output/` и `*.epub` исключены из Git: текст книг не должен попасть в репозиторий
или на GitHub Pages.

Проверка конвертера:

```sh
uv run --project tools python -m unittest tests/prepare_book_test.py
```

### Что делает конвертер

- Берёт название и автора из метаданных, текст — в порядке spine.
- Удаляет скрипты, стили, изображения, навигацию и номера страниц печатного
  издания. Текст не переписывается: только пробелы HTML схлопываются в один.
- Главы определяются по заголовкам: уровень, который встречается в книге
  хотя бы дважды (например `<h2>`). Более мелкие заголовки остаются внутри главы
  с `"kind": "heading"`. Файл без заголовков начинает главу, только если он есть
  в оглавлении EPUB; иначе продолжает предыдущую.
- Предложения режет pysbd с учётом сокращений (Mr., e.g., U.S.) и диалогов.
- Страницы ~300 слов, предложения не разрываются, каждая глава с новой страницы.

### Формат book.json

```json
{
  "formatVersion": 1,
  "bookId": "<SHA-256 подготовленного текста, 64 hex-символа>",
  "title": "…",
  "author": "…",
  "chapters": [
    {"id": "c1", "title": "Chapter 1", "paragraphs": [
      {"id": "c1.p1", "sentences": [{"id": "c1.p1.s1", "text": "…"}]}
    ]}
  ],
  "pages": [
    {"number": 1, "chapterId": "c1", "words": 297, "sentenceIds": ["c1.p1.s1", "…"]}
  ]
}
```

Идентификаторы — порядковые номера глав, абзацев и предложений, поэтому
повторная обработка того же текста даёт те же id. `bookId` считается по названию,
автору и тексту глав, а не по файлу: переименование EPUB его не меняет.

Читалка использует `pages` как есть и не пересчитывает их под экран: на телефоне
строки переносятся по ширине, а страница прокручивается вертикально. В DOM
сохраняются абзацы (`data-paragraph-id`), заголовки и предложения
(`data-sentence-id`). Перед показом читалка проверяет структуру файла и то, что
его `bookId` совпадает с выбранным в каталоге.

## 2. Расположение файлов в Storage

Используется тот же приватный bucket, что и для Grammar (`SUPABASE_GRAMMAR_BUCKET`,
по умолчанию `grammar`), если не задан отдельный `SUPABASE_BOOKS_BUCKET`.

```text
<bucket>/
├── unit-001.json            ← Grammar, без изменений
├── unit-001/audio/…
└── books/
    ├── index.json           ← каталог
    ├── my-book/
    │   └── book.json
    └── another-book.json    ← допустим и файл прямо в books/
```

Путь книги должен соответствовать шаблону
`books/<имя>.json` или `books/<папка>/<имя>.json`, где имя и папка состоят из
строчных латинских букв, цифр и дефиса (до 64 символов). Других уровней
вложенности, заглавных букв и `..` нет. Worker отдаёт только файлы, перечисленные
в каталоге; запрос по произвольному пути невозможен.

## 3. Формат каталога books/index.json

```json
{
  "formatVersion": 1,
  "books": [
    {
      "bookId": "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0",
      "title": "My Book",
      "author": "Author Name",
      "path": "books/my-book/book.json"
    }
  ]
}
```

Правила (иначе Worker отвечает `books_catalog_invalid`):

| Поле | Требование |
| --- | --- |
| `formatVersion` | Число `1`. |
| `books` | Массив, до 500 книг. Пустой массив — пустая библиотека. |
| `bookId` | Ровно `bookId` из `book.json`: 64 символа `0-9a-f`, без повторов. |
| `title` | Непустая строка до 300 символов (обычно `title` из `book.json`). |
| `author` | Строка до 300 символов или `null`. Поле обязательно. |
| `path` | Путь внутри bucket по шаблону из раздела 2, без повторов, не `books/index.json`. |

Порядок книг в массиве — порядок в библиотеке. Браузер получает только
`bookId`, `title` и `author`; пути остаются на сервере. Каталог — до 256 КиБ,
книга — до 8 МиБ.

## 4. Настройки Worker

Код — `worker/cf_worker.js`. В **Settings → Variables and Secrets** существующего
Worker нужны:

| Имя | Тип | Значение |
| --- | --- | --- |
| `BOOKS_ALLOWED_USER_IDS` | Variable | Два числовых Telegram ID через запятую, например `111111111,222222222` |
| `SUPABASE_BOOKS_BUCKET` | Variable, необязательно | Bucket для книг, если он отличается от Grammar |
| `SUPABASE_URL` | Variable | Уже есть для Grammar: `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Уже есть для Grammar: `sb_secret_…` или legacy service-role JWT |
| `SUPABASE_GRAMMAR_BUCKET` | Variable | Уже есть; используется для книг, если `SUPABASE_BOOKS_BUCKET` не задан |
| `BOT_TOKEN` | Secret | Уже есть; нужен для проверки подписи Telegram |

Флаг совместимости `cache_option_enabled`, включённый для Grammar, нужен и здесь.
`GRAMMAR_ALLOWED_USER_IDS`, OpenAI и отчёты не меняются. Ключ Supabase остаётся
только в секретах Worker: в браузер не попадают ни ключ, ни ссылки на Storage.

Пустой или некорректный `BOOKS_ALLOWED_USER_IDS` закрывает Books для всех
(`books_not_configured`). Аккаунт не из списка получает `books_forbidden`.
В обоих случаях Worker, уже проверив подпись Telegram, возвращает ID этого
аккаунта, и страница Books показывает **Your Telegram user ID** с кнопкой
**Copy ID**. ID из неподписанных данных не показывается.

## 5. Загрузка книги и публикация — по шагам

1. **Подготовь книгу** (раздел 1) и открой `output/my-book/preview.html`:
   проверь главы, порядок и пару страниц. Запиши `bookId` из вывода конвертера.
2. **Составь каталог** локально, например `output/index.json` (папка
   не попадает в Git). Добавь запись книги по формату из раздела 3; при
   следующей книге дополняй тот же файл, сохраняя прежние записи.
3. **Загрузи книгу.** Supabase → **Storage** → приватный bucket (тот же, что
   у Grammar). Создай папку `books`, внутри — `my-book`, и загрузи туда
   `output/my-book/book.json`. Итоговый ключ: `books/my-book/book.json`.
   `preview.html` и EPUB не загружай. Bucket должен оставаться не Public.
4. **Загрузи каталог** в `books/` под именем `index.json`. Если файл уже есть,
   удали старый `books/index.json` (или выбери замену, если панель её
   предлагает) и загрузи новый. Название файла должно быть ровно `index.json`.
5. **Обнови Worker:** вставь код из `worker/cf_worker.js`, сохрани все
   существующие переменные и секреты и нажми **Deploy**.
6. **Опубликуй сайт** привычным способом (GitHub Pages). Нужны файлы:
   `books.html`, `read.html`, `index.html`, `assets/js/books.js`,
   `assets/js/books-core.js`, `assets/js/read-tabs.js`, `assets/js/home.js`,
   `assets/css/style.css`, `assets/css/books.css`. Не публикуй `output/`,
   `private/` и `*.epub` — они и так исключены из Git.
7. **Узнай Telegram ID.** Закрой и снова открой мини‑приложение из Telegram,
   затем **Read → Books**. Пока `BOOKS_ALLOWED_USER_IDS` не задан, страница
   покажет **Your Telegram user ID** — нажми **Copy ID**. То же сделай со
   второго аккаунта.
8. **Разреши доступ:** впиши оба ID в `BOOKS_ALLOWED_USER_IDS` через запятую
   и снова задеплой Worker.
9. **Проверь вживую:** открой Books с обоих аккаунтов — книга видна, страницы
   листаются, оглавление работает. Аккаунт не из списка видит только сообщение
   и свой ID. В обычном браузере без Telegram книги не загружаются.
   Grammar и Learn words работают как раньше.

Новая книга позже: шаги 1–4 и 9 (Worker и сайт трогать не нужно).
Если Telegram показывает старую версию страниц, перезапусти мини‑приложение;
номера `?v=` у изменённых файлов уже обновлены.

## API

Все маршруты — `POST` JSON с `initData`; ответы с `Cache-Control: no-store`.

| Маршрут | Дополнительные поля | Успешный ответ |
| --- | --- | --- |
| `/books/list` | — | `{"books": [{"bookId", "title", "author"}]}` |
| `/books/book` | `bookId` (64 hex) | `book.json` из пути, указанного в каталоге |

## Ошибки

| Код | Что проверить |
| --- | --- |
| `unauthorized` | Открой приложение заново из Telegram: подпись неверна или старше 24 часов. |
| `books_not_configured` | С ID: не задан или некорректен `BOOKS_ALLOWED_USER_IDS`. Без ID: `SUPABASE_URL`, ключ или имя bucket. |
| `books_forbidden` | Подписанный ID не в `BOOKS_ALLOWED_USER_IDS`. |
| `books_not_found` | Нет `books/index.json` или файла книги по пути из каталога; книги нет в каталоге. |
| `books_catalog_invalid` | Формат `books/index.json` (раздел 3). |
| `books_storage_auth` | Секретный ключ и доступ к приватному bucket. |
| `books_storage_size` | Каталог больше 256 КиБ или книга больше 8 МиБ. |
| `books_storage_network` / `_timeout` / `_error` / `_read` / `_empty` | Доступность Supabase и загруженные файлы. |
| `books_runtime_cache` | Включи `cache_option_enabled` в compatibility flags Worker. |
| `invalid_input` | Неверный `bookId` в запросе. |
| «The book file is invalid (…)» | Загружен не тот или повреждённый `book.json`, либо `bookId` в каталоге не совпадает с файлом. |

## Локальные проверки

```sh
node --test tests/*.test.cjs
uv run --project tools python -m unittest tests/prepare_book_test.py
```

Проверка в браузере (Playwright + Chrome) на готовой локальной книге,
с подставными ответами Telegram и Worker, без Storage и ключей:

```sh
node tools/check-books-browser.cjs --book output/my-book/book.json
# если Playwright установлен в другом месте:
node tools/check-books-browser.cjs --book output/my-book/book.json --playwright-path /absolute/path/to/playwright
```

Она проверяет вкладки Read, библиотеку, все страницы книги при ширине 360 px
(часть — при 390 px), переходы между главами, оглавление, возврат в библиотеку,
отсутствие горизонтальной прокрутки, безопасный вывод текста, ошибки загрузки,
показ ID с Copy ID и игнорирование запоздалых ответов. Скриншоты сохраняются
во временную папку. Эти проверки не подтверждают настройку настоящих Supabase и
Worker — для этого нужен шаг 9.
