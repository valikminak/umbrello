# План тем грамматики

Вкладка **Lessons** раздела Grammar — темы по порядку. Каждая тема устроена как «Часи»:
украинская фраза, плитки с похожими ошибками, рейтинг 4.5, последний урок темы — смесь.
Формат файлов и правила — [TENSES.md](TENSES.md). Список тем в приложении —
`grammar/topics.json`; у темы без `file` написано «Незабаром».

Порядок — по пользе для B2 → C1 и по тому, насколько готов движок.
Делаем по одной теме: тема целиком → проверка на телефоне → следующая.

| # | Тема (`id`) | Уроков | Что выбирает ученик, главная ловушка | Статус |
|---|---|---|---|---|
| 1 | Часи (`tenses`) | 14 | все 12 форм, going to, пассив, when / if, «якби» | готово |
| 2 | Модальні (`modals`) | 6 | can / could / was able to; must / have to; **mustn't** («не можна») или **don't have to** («не треба»); should; might; must be; should have done | готово |
| 3 | Питання (`questions`) | 4 | Who called? или Who did you call?; хвостики (isn't it?); Do you know where **he lives**? | |
| 4 | Фразові дієслова (`phrasal`) | 6 | см. ниже | |
| 5 | Gerund та infinitive (`gerund`) | 4 | enjoy **doing** / want **to do**; stop doing или stop to do; make / let + глагол; used to / be used to / get used to | |
| 6 | Непряма мова (`reported`) | 4 | сдвиг времени (said he **was**); say или tell; asked **if** / **where**; told me **to wait** | |
| 7 | Умовні далі (`wishes`) | 3 | I wish I **knew** / **had known**; if only; unless, in case; I'd rather, it's time | |
| 8 | Пасив далі (`passive-more`) | 3 | must **be done**; have something **done** («мені полагодили машину»); he is said **to be** | |
| 9 | Відносні речення (`relative`) | 3 | who / which / that / whose / where; с запятыми и без; когда that можно убрать | |
| 10 | Прикметники та прислівники (`adjectives`) | 4 | bigger / the biggest / as big as; the more… the better; bored или boring; too / enough; so или such | |
| 11 | Артиклі та кількість (`articles`) | 4 | a / the / без артикля; some / any / no; much / many / few / little | |
| 12 | Займенники (`pronouns`) | 3 | myself / each other; everyone, nobody; both / either / neither | |
| 13 | Прийменники (`prepositions`) | 3 | in / on / at (время и место); interested **in**, depend **on**, good **at** | |
| 14 | Конструкції C1 (`advanced`) | 4 | although / despite / however; so that / in order to; Never **have I** seen…; What I need **is**… | |

## Фразові дієслова: как понимать, а не зубрить

Смысл фразового глагола чаще всего даёт частица. Уроки построены вокруг частиц,
а не вокруг глаголов, и в окне ⓘ каждого урока — что частица значит.

1. **Куди рух** — буквальные: go out, come back, sit down, stand up, get in, look round.
2. **up і down** — up «до кінця, повністю» (eat up, fill up, give up),
   «вгору, більше» (turn up, speed up); down «вниз, менше, записати» (turn down, slow down, write down).
3. **out** — «назовні» и «до кінця, з'ясувати» (find out, run out of, work out, sort out).
4. **on і off** — on «продовжувати, увімкнути, надіти» (go on, turn on, put on);
   off «від, вимкнути, зняти, скасувати» (turn off, take off, put off, call off).
5. **Де стоїть it** — turn **it** off, pick **her** up, но look **for it**: какие глаголы
   разделяются, а какие нет; turn off the TV и turn the TV off — оба верны.
6. **Суміш** — плюс трёхчастные: look forward to, get on with, run out of, put up with.

Ловушки на плитках: другие частицы того же глагола (look for / look after / look up),
местоимение не на своём месте (turn off it), предлог после глагола (look forward to **see**).

## Что делается в движке

- Тема = файл `grammar/<id>.json` со своими словами и объяснениями (`lexicon`, `notes`);
  общие глаголы и помощники — в `grammar/lexicon.json`.
- Для новых видов слов (модальные, частицы, относительные слова) — свой вид плитки
  и пары «что с чем путают» в словаре темы, как `modals` и `modalTwins`.
- Где по-английски верно двумя способами, второй ответ — в `alt` предложения.
- В украинском нет артиклей, поэтому в теме 11 подсказкой будет смысл
  («якийсь» / «той самий»); поэтому она ближе к концу.
