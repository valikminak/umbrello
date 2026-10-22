# Общие настройки Cloudflare Worker

У приложения один существующий Worker, один приватный bucket `Umbrello`
и один список разрешённых Telegram-аккаунтов. Настройки задаются в
**Settings → Variables and Secrets**, секреты в репозиторий не записываются.

| Имя | Тип | Назначение / значение |
| --- | --- | --- |
| `BOT_TOKEN` | Secret | Существующий токен бота: проверка Telegram-подписи и отправка сообщений |
| `CHAT_ID` | Variable | Чат, куда бот отправляет отчёты |
| `ALLOWED_USER_IDS` | Variable | Числовые Telegram ID через запятую, например `111111111,222222222` |
| `SUPABASE_URL` | Variable | Существующий URL проекта `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Существующий серверный ключ Supabase: `sb_secret_…` или legacy service-role JWT |
| `SUPABASE_BUCKET` | Variable | `Umbrello` — точное имя общего приватного bucket, с учётом регистра |
| `OPENAI_API_KEY` | Secret | Существующий ключ для запросов к ИИ |
| `OPENAI_MODEL` | Variable | Существующий ID модели |

`CHAT_ID` — адресат сообщений, `ALLOWED_USER_IDS` — пользователи с доступом.
Они могут содержать одно и то же число, но выполняют разные задачи. ID получателя
сам по себе не даёт доступ. Дополнительных bucket и ключей для Books не нужно.

## Переход с прежних имён

1. Перенеси значение `GRAMMAR_ALLOWED_USER_IDS` в `ALLOWED_USER_IDS`.
2. Перенеси значение `SUPABASE_GRAMMAR_BUCKET` в `SUPABASE_BUCKET` (`Umbrello`).
3. Если ранее добавлял `BOOKS_ALLOWED_USER_IDS`, объедини нужные ID в общий список.
   Если задавал `SUPABASE_BOOKS_BUCKET`, материалы Books должны находиться
   в общем bucket `Umbrello` по прежним путям `books/…`.
4. Опубликуй актуальный `worker/cf_worker.js` вместе с новыми переменными.
   Удали старые `GRAMMAR_ALLOWED_USER_IDS`, `BOOKS_ALLOWED_USER_IDS`,
   `SUPABASE_GRAMMAR_BUCKET`, `SUPABASE_BOOKS_BUCKET`: новый код их не читает.
5. Сохрани остальные переменные и секреты. Обновление GitHub Pages само по себе
   не обновляет Worker; его нужно отдельно опубликовать в Cloudflare.

Флаг совместимости `cache_option_enabled`, если он уже включён, оставь.
Имена файлов и каталогов в Storage не меняются из-за переименования переменной:

```text
Umbrello/                         ← bucket (не Public)
└── books/
    ├── index.json
    └── the-woman-in-the-dunes/
        └── book.json
```

## Как применяются настройки

- Каждый рабочий POST-запрос сначала проходит проверку Telegram-подписи,
  затем общего `ALLOWED_USER_IDS`: Books, существующие маршруты Grammar,
  Write и отправка отчётов.
- Пустой или некорректный список закрывает доступ к этим API. Имя профиля
  в URL не влияет на проверку.
- Отсутствующий `SUPABASE_BUCKET` даёт ошибку конфигурации. Скрытого перехода
  к `grammar` или к отдельному bucket раздела нет.
- HTML, JS и обычные учебные JSON на GitHub Pages остаются статическими файлами.
  Эта настройка ограничивает запросы к Worker; экран проверки доступа при
  открытии всего приложения и уведомления об отказах пока не реализованы.

После изменения конфигурации закрой Mini App и открой заново. Если Books
показывает отказ, на его экране можно скопировать подписанный Telegram user ID
и добавить его в `ALLOWED_USER_IDS`.
