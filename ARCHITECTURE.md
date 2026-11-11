# Crosspect — устройство

## Стек
- Сайт без сборки: [`index.html`](index.html), [`css/style.css`](css/style.css) и модули [`js/*.js`](js). Сторонних библиотек нет. Облако (правила Firestore, тесты, скрипты) — отдельно в [`cloud/`](cloud), см. «Облако».
- Модули — обычные скрипты (не ES-модули): все они делят одну область видимости, как раньше делили один файл. Порядок подключения — в `index.html`, он же порядок выполнения. Функции можно вызывать откуда угодно, но на самом верху файла нельзя использовать то, что объявлено в файле ниже по списку: например, `onclick:saveFile` не сработает, а `onclick:() => saveFile()` сработает.
- К каждому файлу в `index.html` дописано `?v=__BUILD__`: при выпуске CI подставляет номер коммита, и браузер не смешивает старые и новые файлы.
- Шрифты Google Fonts: Unbounded (переменная толщина 200–900), Inter, Noto Sans Hebrew.
- Тексты Библии — XML (Beblia или Zefania), грузятся по требованию с GitHub.
- Настройки — [`data/config.json`](data/config.json) из этого репозитория (`CONFIG_URL_DEFAULT`), последняя копия кешируется в localStorage; при недоступности — встроенные списки.
- Экраны: главная (`#`) и проповедь (`#s=<id>`, «Текст» — `#s=<id>&v=text`). «Назад» в браузере и перезагрузка возвращают туда же. Тёмные — главная и «Слайды», светлый — «Текст» (`body.light`).
- Хранение: черновик в localStorage (`swp-sermon:<id>`, у каждой проповеди свой, `swp-sermon:last` — последняя); «Сохранить» скачивает файл `.json` с проповедью. «Открыть» понимает `.json` и старые HTML-файлы (проповедь лежит в `<script id="sermon-data">`).

## Файлы кода (порядок подключения)
| Файл | Что внутри |
|---|---|
| `css/style.css` | токены цветов (`:root` тёмные, `body.light` — «Текст»), шапка, кнопки, главная (`.home`, `.scard`), «Слайды» (`.sv`, `.film`, `.st`, `.stage`, `.side`), «Текст» (`.tv`, `.blk`), слайд `.sl*` (кадр 1920×1080), печать `#print-op`. Классы интерфейса не должны начинаться с `.sl` / `.sl-`: `slideCSS()` копирует такие правила в JPEG |
| `js/defaults.js` | `DEFAULT_SETTINGS` (лимиты), `CONFIG_URL_DEFAULT`, `SLIDES_DEFAULT` (поля, названия, размеры, `font.canva` — плотность шрифта, по умолчанию `all`), `ICONS`, `TYPES` (порядок = окно «Что добавить?»; `slide`, `top`, `todo`), `PREVIEW`, `WORDS_PER_MIN` |
| `js/util.js` | утилиты (`h`, `$`, `LS`, `plural`…); форматированный текст: `cleanHTML` / `sanitize` — разрешены только `b i u mark br span.up` |
| `js/refs.js` | справочники `PREACHERS`, `LANGS` (переводы), `BOOKS`, `ABBR` (синодальные сокращения); названия слайдов: `BAD_CHARS`, `NAMED`, `cleanName`, `slideName`, `scriptureNamePart`, `quoteNamePart` |
| `js/bible.js` | тексты Библии: `loadBible` (Beblia/Zefania), `cleanVerse`, `syncVerses`, `refString` |
| `js/model.js` | модель данных: `newBlock`, `newScripture`, `newPart` (свой перевод), `newTextItem`, `newLineItem`, `newThesisPart`, `splitPreacher` / `preacherName` / `preacherKey`, `normalize` / `normItem` (перевод старых форматов, в том числе v1 → v2), `wordCount` / `speechInfo`; общие настройки слайдов: `mergeSlides`, `slidesCfg` (config + localStorage `swp-slides-local`), `applySlides` (CSS-переменные полей), `missingNames`, `checkNames` |
| `js/state.js` | `state`, `change`, `persistDraft`, `slideNums`, `blockSummary`; экран и вид: `screen` (`home` / `sermon`), `view` (`slides` / `text`), `selId` (выбранный слайд), `speechOpen`; `sermonStatus`, `fmtDay` |
| `js/shell.js` | каркас: контейнеры `topbar` и `mainEl`, меню «⋯» (`fillMenu`), окна, панель оформления |
| `js/render.js` | `preacherField`, `refreshSplash`, `BODY[type]` (редакторы слайдов: показываются в правой панели «Слайдов»), `nameField`, `autoName`, `rich` (редактор с панелью оформления), списки (`toggleList`, `listEnter`, `autoList`), `toggleUp`, `toggleMark`, `toggleTodo`, `toggleDone`, `addBlock`, `move`, `duplicate`, `removeBlock` (текст удалённого слайда переходит соседу), `openSheet` |
| `js/app.js` | маршруты и каркас экранов: `route` (разбор `#s=<id>&v=text`), `navigate`, `sermonHash`, `renderAll` / `renderMain` (перерисовать текущий экран), `setView` (в «Текст» пускает только если у слайдов есть названия), `renderTopbar`, `updateStatus`, `openMeta` (окно «О проповеди») |
| `js/home.js` | главная: `renderHome`, список черновиков из localStorage (`draftList`), поиск, карточки `sermonCard` и строки `sermonRow`, `deleteDraft`, `slideCount` |
| `js/slides.js` | вид «Слайды»: `renderSlides`, лента `renderFilm` / `filmItem` / `refreshThumb`, `selectBlock`, `stepSel`, сцена `renderStage` (слайд, «Текст к слайду» — `speechBox`), правая панель `renderSide`, `rerender(b)` / `updateCounter(b)` обновляют только выбранный слайд |
| `js/textview.js` | вид «Текст» (светлый): `renderTextView`, `tvBlock`, `tvSlide`, `sermonChecks` (проверка перед отправкой), `tvSide` |
| `js/preview.js` | предпросмотр слайдов: `typoText`, `fixOrphan`, `wrapScripts` (греческий/иврит → `span.xl`), `slideEl`, `slideHTML` (Писание: в строку / с новой строки), `boxHTML` / `paraHTML` (тезис, цитата, списки), `authorHTML`, `layoutSplash` (заставка), `layoutAt` (Писание, выравнивание по вертикали), `layoutBox`, `fitSlide` (бинарный поиск размера), `BASE`, `SPLASH`, `scrPx` |
| `js/files.js` | `saveFile` (проверка названий) / `writeFile`, `parseSermonFile`, открытие файла, `newSermon` |
| `js/export.js` | выгрузка JPEG: `exportFonts` (CSS шрифтов с встроенными woff2), `slideCSS`, `renderJPEG` (SVG foreignObject → canvas), `makeZip` (ZIP без сжатия, UTF-8), `exportOne`, `exportMany`, `markDone` |
| `js/print.js` | PDF для оператора: `#print-op`, `@page op` 80×170 мм, `buildOperatorPrint`, `operatorPDF` |
| `js/settings.js` | окна настроек: `openSettings` (лимиты), `openConfig` (источник), `openSlidesCfg` (поля, названия, размеры, шрифт) |
| `js/misc.js` | `toast`, закрытие меню, горячие клавиши |
| `js/main.js` | запуск: настройки из кеша, `route()` (по адресу открывает главную или проповедь), свежие настройки из репозитория |

## Модель проповеди
Файл проповеди (`.json`) — это сам `state`:
```
state = { app:'swp-sermon', v:2, id, createdAt, updatedAt, savedAt,
  meta:{ title, date, firstName, lastName }, settings:{ minScale, limitThesis, limitQuote, lang }, blocks:[…] }
```
Блоки — слайды по порядку и заметки оператору между ними. Общее: `id, type, collapsed`. У слайдов (`TYPES[type].slide`) ещё `done` («готово»), `todo` («доработать») и `speech` — «Текст к слайду», HTML (`sanitize`). По типам:
- `splash`: только общие поля; название, имя и дата берутся из `meta`
- `scripture`: `showTr`, `caps` (стихи заглавными), `flow` ('inline' | 'lines'), `frame` (рамка пунктиром, только 'inline'), `align` ('left' | 'center'), `valign` ('top' | 'center' | 'bottom'), `items:[ {kind:'scripture', lang, book, chapter, sel, verses:[{num,text,orig}], ref, translation} | {kind:'scripture', manual:true, mBook, mChapter, mVerses, translation, verses:[{num,text}]} | {kind:'text', html, align, caps} | {kind:'line'} ]`
- `thesis`: `name, nameAuto, valign, parts:[ {kind:'text', html, align, scale, caps, frame} | {kind:'line'} ]`; `text` — склейка частей (для названия и старых версий)
- `quote`: `text, author, caption, scale, caps`
- `image`: `name, mode('find'|'send'), desc`; `video`: `name, mode('link'|'send'), url, from, to, desc`; `free`: `name, desc`
- `note`: `text` (не слайд: без номера, `done`, `todo`, `speech`)

Версия 1 (до 11 ноября 2026) переводится в `normalize`: блоки `text` (`text, splash`) становятся `speech` слайда перед ними, а если слайда перед ними нет или `splash:true` — новой заставкой; `meta.preacher` («Фамилия Имя») → `lastName` + `firstName`; `quote.author` «Имя Фамилия, источник» → `author` + `caption`; картинка, видео и свободный без `todo` получают `todo = !done`; новые поля Писания — значения по умолчанию.

`id` переводов в `config.json` не менять: по ним сохранённые проповеди помнят перевод.

## Слайд
- Кадр раскладывается в полном размере 1920×1080 и только масштабируется (`--s`), поэтому переносы в предпросмотре и JPEG совпадают.
- Поля — CSS-переменные `--sl-x/--sl-t/--sl-b` = 44 (отступ панели) + поле из настроек.
- `letter-spacing` в em на `.sl-stage` наследуется как абсолютное значение от 16 px — фактически почти ноль; трекинг задавать на самих текстовых элементах.
- JPEG: слайд раскладывается в скрытом контейнере тем же кодом, клонируется вместе с CSS-правилами `.sl*` и шрифтами в SVG foreignObject и рисуется в canvas. Поэтому классы режимов вешаются на `.sl-stage`, а не на `.sl`.

## Проверка
Тесты — `tests/`, Python + Playwright + pytest (Chromium есть в рабочей среде Claude). Запуск: `python3 -m pytest tests -q`. Тесты сами поднимают локальный сервер с репозиторием.
- `test_form.py`: форма запускается без ошибок; «Открыть» читает `.json` и старый HTML; «Сохранить» и Ctrl+S пишут `.json`, который открывается снова; черновик переживает перезагрузку; вид «Текст» (светлый, без ленты); главная: список, поиск, открытие карточки; кнопка «назад» и перезагрузка; «Новая проповедь»; выбор слайда в ленте и стрелки; JPEG 1920×1080; ZIP со слайдами; PDF для оператора шириной 80 мм.
- `test_model.py`: модель v2 — перевод старых файлов (текст → к слайду / заставка, имя и фамилия, подпись цитаты), сохранение и открытие новых полей, «доработать», «Текст к слайду» со счётчиком, удаление и копирование слайда с текстом, проповедник вручную, заставка (размер, имя, дата, название файла, JPEG), режимы Писания, рамки, подпись цитаты, «готово» в ленте и на карточке, текст в виде «Текст» и PDF, шрифт как в Canva по умолчанию. Тесты, которым нужна пустая проповедь, начинают с `start_blank(page)` из `conftest.py`.
- `test_static.py`: `node --check` для каждого `js/*.js`; нет «сырых» U+00A0/U+00AD/U+2028/U+2029 (только экранированные); каждый модуль подключён в `index.html` один раз.
- `tests/fixtures/sermon.json` — проповедь в старом формате (v1) со всеми типами блоков, включая «Текст проповеди»: заодно проверяет перевод на новую модель.
- Выгрузка JPEG берёт шрифты из интернета, поэтому тестам нужна сеть.
- Для проверки в консоли страницы: `state`, `newBlock`, `exportOne(...)` и остальное доступны как глобальные имена.

## Облако (`cloud/`)
Firebase: Cloud Firestore + вход Google. Что строим и по каким этапам — [`docs/PLAN.md`](docs/PLAN.md), там же модель данных и таблица прав. Настройка проекта — [`docs/FIREBASE.md`](docs/FIREBASE.md). Форма к облаку пока не подключена (этап 5).

| Файл | Что внутри |
|---|---|
| `cloud/firestore.rules` | права: пространства, участники, проповеди, замок, отметки редактора, ссылки для оператора. Функции наверху (`signedIn`, `me`, `hasRole`, `isEditor`…), затем `match` по коллекциям |
| `cloud/firestore.indexes.json` | индекс `members.email` для запроса по всем пространствам (collection group); тяжёлые поля (`blocks`, `settings`, `flags`, `sermon`) исключены из индексов |
| `cloud/firebase.json` | пути к правилам и индексам, порт эмулятора |
| `cloud/tests/rules.test.mjs` | тесты правил в эмуляторе (`node:test` + `@firebase/rules-unit-testing`): вход, пространство, участники, чтение / создание / правка / удаление проповедей, замок, отметки, ссылки. `RULES_FILE=путь` — прогнать на другом файле правил |
| `cloud/tests/scripts.test.mjs` | служебные скрипты в эмуляторе: пространство и участники (и что их записи проходят правила), бэкап → очистка → восстановление даёт ту же копию |
| `cloud/scripts/lib.mjs` | подключение (эмулятор или ключ `GOOGLE_APPLICATION_CREDENTIALS`), перевод документов в JSON (`$timestamp`, `$ref`, `$map` …) и обратно |
| `cloud/scripts/backup.mjs` | вся база в папку: документ → `путь/документа.json` |
| `cloud/scripts/restore.mjs` | папка → база, `--wipe` сначала очищает |
| `cloud/scripts/admin.mjs` | `create-space`, `set-member`, `remove-member`, `list` — в обход правил |
| `cloud/private-repo/` | файлы для приватного репозитория `crosspect-app/crosspect-backup`: ночная копия, восстановление, «Пространства». Меняешь здесь — перенеси туда |

- Тесты: `cd cloud && npm ci && npm test` (Node 22, Java 21; эмулятор Firestore скачивается с Google Storage — в рабочей среде Claude он закрыт, поэтому тесты правил гоняются в CI: запушить ветку и запустить workflow вручную, `gh api -X POST repos/crosspect-app/crosspect/actions/workflows/ci.yml/dispatches -f ref=<ветка>`).
- Секрет `FIREBASE_SERVICE_ACCOUNT` (JSON-ключ сервисного аккаунта с ролью Firebase Admin) — в обоих репозиториях. Идентификатор проекта берётся из ключа (`project_id`).
- Email в базе — всегда строчными; `me()` в правилах приводит почту из токена к строчным.
- Время — только `serverTimestamp()`: правила сверяют его с `request.time`.
- Новое поле проповеди — добавить в `validSermon` (`hasOnly`) и тест; иначе база его не примет.

## Выпуск
Файл `.github/workflows/ci.yml`: на каждый коммит идут тесты формы (`Тесты`) и правил (`Правила Firestore`); если коммит в `main` и всё прошло, сайт (`index.html`, `css`, `js`, `data`) выкладывается на GitHub Pages, а правила и индексы — в Firebase (`Выкладка правил Firestore`; без секрета `FIREBASE_SERVICE_ACCOUNT` шаг пропускается). Адрес: `https://crosspect-app.github.io/crosspect/`. В Settings → Pages источник должен быть «GitHub Actions».
