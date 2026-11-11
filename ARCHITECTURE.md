# Crosspect — устройство

## Стек
- Сайт без сборки: [`index.html`](index.html), [`css/style.css`](css/style.css) и модули [`js/*.js`](js). Сторонних библиотек нет. Облако (правила Firestore, тесты, скрипты) — отдельно в [`cloud/`](cloud), см. «Облако».
- Модули — обычные скрипты (не ES-модули): все они делят одну область видимости, как раньше делили один файл. Порядок подключения — в `index.html`, он же порядок выполнения. Функции можно вызывать откуда угодно, но на самом верху файла нельзя использовать то, что объявлено в файле ниже по списку: например, `onclick:saveFile` не сработает, а `onclick:() => saveFile()` сработает.
- К каждому файлу в `index.html` дописано `?v=__BUILD__`: при выпуске CI подставляет номер коммита, и браузер не смешивает старые и новые файлы.
- Шрифты Google Fonts: Unbounded (переменная толщина 200–900), Inter, Noto Sans Hebrew.
- Тексты Библии — XML (Beblia или Zefania), грузятся по требованию с GitHub.
- Настройки — [`data/config.json`](data/config.json) из этого репозитория (`CONFIG_URL_DEFAULT`), последняя копия кешируется в localStorage; при недоступности — встроенные списки.
- Экраны: главная (`#`) и проповедь (`#s=<id>`, «Текст» — `#s=<id>&v=text`). «Назад» в браузере и перезагрузка возвращают туда же. Тёмные — главная и «Слайды», светлый — «Текст» (`body.light`).
- Хранение: проповеди церкви — в облаке (Firestore); у каждой проповеди есть ещё черновик в localStorage; без входа — только он. Черновик в localStorage (`swp-sermon:<id>`, у каждой проповеди свой, `swp-sermon:last` — последняя); «Сохранить» скачивает файл `.json` с проповедью. «Открыть» понимает `.json` и старые HTML-файлы (проповедь лежит в `<script id="sermon-data">`).

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
| `js/cloud.js` | облако в форме: состояние `cloud` (`mode`: wait / out / noaccess / error / in; пользователь, пространство, роль, живой список `cloud.list`), `initCloud` (подключает SDK или подмену `window.CROSSPECT_FAKE_API`), `cloudUser`, `cloudGate` / `renderGate` (экран входа вместо главной и проповеди), `saveSermon` (облако — `saveNow`, без входа — файл), `conflictSheet`, `takeRemote`, `saveAsCopy`, `deleteCloudSermon` (не удаляет под чужим замком), `uploadToCloud` / `uploadOne`, `openCloudSermon` (выбор между облаком и черновиком), `canEditCloud`, `isUnsaved` |
| `js/lock.js` | замок и автосохранение (этап 6): состояние `ed` (`mode` view / edit, `remote` — последняя версия из облака с замком, `myAt` — начало моего замка), `beginCloud` / `endCloud` (открыли / ушли), `startWatch` / `onRemote` (живое обновление и «замок забрали»), `startEdit` / `takeOver`, `onEdit` / `scheduleSave` / `autoSave` / `saveNow` / `forceSave`, `cloudWrite` (запись, ошибки: lost-lock, conflict, нет сети, нет прав), `tick` (сигнал раз в минуту, простой), `closeEdit`, `lostLock` / `rescueCopy`, `readOnly` / `roBlock` / `roHint` (просмотр), `headAction` / `cloudStatusLine` (шапка), `lockMark` (карточка главной) |
| `js/editor.js` | работа редактора (этап 7): статус проповеди (`statusOnEdit` — вызывается из `change()`, `setSermonStatus`, `statusAction` — кнопка в шапке, `isReady` — в `state.js`); отметки «доработать»: `canFlag` / `todoOn` (кто видит), `blockSig` (подпись содержимого слайда), `loadFlags` / `applyFlags` (прочитать `editor/state` и наложить на проповедь), `toggleTodo` / `setFlag`, `resyncFlags` (после сохранения), `flushFlags` (запись с паузой 1,5 с) |
| `js/cloud-api.mjs` | единственное место, где форма говорит с Firebase: `createCloudAPI({auth, db, A, F})` — `onUser`, `signIn`, `spacesOf`, `getSpace`, `listen`, `get`, `watch` (живая проповедь), `save` (транзакция с проверкой версии; `status` — «В работе» / «Готов»; с `lock` — запись под замком, `lost-lock`; `todo` и `done` в документ не пишутся), `getFlags` / `setFlags` (отметки редактора, документ `editor/state`), `lock` (взять / забрать, `locked`), `beat`, `release`, `remove`; `explain` — понятный текст ошибки. ES-модуль: грузится динамическим `import()`, проверяется в Node в эмуляторе |
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
Блоки — слайды по порядку и заметки оператору между ними. Общее: `id, type, collapsed`. У слайдов (`TYPES[type].slide`) ещё `todo` («доработать») и `speech` — «Текст к слайду», HTML (`sanitize`). Поля `done` («готово») больше нет: `normalize` его убирает. По типам:
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

## Облако в форме
- Порядок запуска: `main.js` рисует экран (пока облако подключается — «Подключаюсь к облаку…»), потом `initCloud()`: SDK `firebasejs/13.1.0` с gstatic (`firebase-app/auth/firestore`) + `cloud-api.mjs?v=<сборка>` динамическим `import()`; номер сборки берётся из адреса самого `cloud.js`. Версия SDK на CDN — `FIREBASE_VERSION` в `cloud.js`; в `cloud/package.json` SDK для тестов может быть новее.
- Firestore подключён с постоянным кешем в браузере (`persistentLocalCache`, несколько вкладок): список и открытые проповеди читаются и без сети, но **записать** без сети нельзя (сохранение — транзакция).
- Метки облака в проповеди формы: `cloudSpace`, `cloudAt` (версия в облаке, мс, на которой основаны правки), `cloudOwner`, `cloudStatus`, `cloudBy`. Хранятся в черновике, `normalize` их сохраняет, в `.json` файл и при открытии файла выбрасываются (`stripCloud`). Конфликт — когда версия в облаке отличается от `cloudAt`.
- `isDirty()` для облака — прежнее правило (`updatedAt > savedAt`); после сохранения `savedAt` равен `updatedAt` на момент отправки, а `change()` не даёт `updatedAt` идти назад.
- «Только в браузере» на главной — черновики, которых нет в `cloud.list`; чистые копии облачных проповедей из браузера убираются сами (откроются из облака).
- Режим «без входа» запоминается на вкладку (`sessionStorage swp-local`); после входа сбрасывается.
- Документ в облаке: `v`, `meta`, `settings`, `blocks` из проповеди плюс `status`, `owner`, `createdBy/At`, `updatedBy/At` (поля — как в `cloud/firestore.rules`, новое поле — сначала правило и тест). Запись — `update` только полей содержимого и замка, поэтому `status`, `owner`, `shareKey` не трогаются.

### Работа редактора (`js/editor.js`, этап 7)
- **Статус.** В облаке `status`: `draft` = «В работе», `submitted` = «Готов» (`done` из старых данных тоже считается готовым, `isReady`). Форма держит его в `state.cloudStatus`, `cloudWrite` отправляет `status` вместе с содержимым (правила и так разрешают спикеру только `draft` / `submitted`). `change()` вызывает `statusOnEdit()`: роль `preacher` правит `submitted` → `cloudStatus = 'draft'`; кнопка статуса ставит `statusTouch`, чтобы собственная смена не считалась правкой.
- **«Доработать» в облаке** не лежит в проповеди: `cloud-api.mjs` вырезает `todo` и `done` из блоков при записи. Отметки — `spaces/…/sermons/<id>/editor/state`, `flags: { <id слайда>: { t: 1 | 0, s: подпись } }`; читает и пишет только редактор и админ, замок не нужен (так сделаны правила этапа 4). Показ: `applyFlags` накладывает отметки на `state.blocks[].todo` (вызывается в `openCloudSermon`, `setRemoteState`, `takeRemote`); записи нет — картинка, видео и свободный слайд «доработать» (`TYPES[type].todo`), остальные нет. `s` — `blockSig(b)`: канонический JSON блока без `todo`, `done`, `collapsed`; `t = 0` и подпись не совпала → отметка вернулась (считается при показе). `resyncFlags` после сохранения обновляет `s` у слайдов без отметки, чтобы собственные правки редактора её не возвращали. Запись — `flushFlags` с паузой, набор целиком; пока проповеди в облаке нет (`cloudAt` = 0), ждёт.
- Спикеру отметки не читаются (`getFlags` отдаёт `{}`), `canFlag()` = `false`: интерфейс (`todoOn`, кнопка, блок «Для редактора», счётчик) их не показывает. Без входа `toggleTodo` работает как раньше — правит проповедь через `change()`.
- Фильтр «только отмеченные» — `filmOnlyTodo` в `slides.js`, переключается щелчком по счётчику над лентой.
- Запас базы: код ошибки `resource-exhausted` — `ed.quota`, правки остаются в черновике браузера, повтор раз в `QUOTA_RETRY_MS` (5 минут), Ctrl+S — сразу; текст «Облако перегружено до 9:00» — в `explain`. Автосохранение — `AUTOSAVE_MS` (30 с); тесты сокращают его через `window.CROSSPECT_AUTOSAVE_MS` (подмена облака ставит 3 с).

### Замок и автосохранение (`js/lock.js`, этап 6)
- Замок в документе: `lock = { email, name, at, beat }`, время ставит сервер. «Свой» замок — почта **и** `at` (запоминается на вкладку в `sessionStorage swp-lock:<id>`): другая вкладка той же почты берёт замок заново с новым `at`, и прежняя вкладка понимает, что замок ушёл. После перезагрузки замок берётся заново (`force`), черновик перебазируется на свои же записи (`ownSince`).
- Режимы: `ed.mode` = `view` (по умолчанию для облачной проповеди) или `edit`. `readOnly()` — просмотр: `change()` откатывает правку (`roBlock`) и показывает подсказку; правая панель, «Текст к слайду» и текст в виде «Текст» — `inert`; черновик в браузере не пишется (`persistDraft` пропускает), чтобы не затереть черновик другой вкладки.
- Правка: `change()` → `onEdit()` → запись через 30 с (`AUTOSAVE_MS`, не чаще одной записи одновременно). `cloudWrite` → `api.save(..., { lock:{ name, at, release, minutes } })`: под своим замком запись продлевает `beat`, без замка (или с истёкшим чужим) — берёт новый, с живым чужим — `lost-lock`. Пока замок свой, свои же записи с более новой версией (дошедшие после обрыва связи) конфликтом не считаются (`ownLater` в транзакции).
- `tick` раз в 15 с: сигнал `beat` раз в минуту (только если человек что-то делал), простой ≥ `lockMinutes` — `closeEdit('idle')`; в просмотре — обновить шапку (чужой замок мог истечь). Активность — `pointerdown` / `keydown` / `wheel`.
- `watch` (onSnapshot документа): в просмотре — новая версия сразу на экран (`setRemoteState`, прокрутка сохраняется); в правке — только замок: чужой с `at` позже моего — `lostLock` (несохранённое — `rescueCopy`, окно «Правку забрали»).
- Уход с проповеди (`route`, «Новая», «Открыть файл», «Выйти») — `endCloud()`: сохранить и отпустить фоном. Скрыли вкладку — записать сразу; закрывают вкладку с несохранённым — браузер спрашивает «Покинуть сайт?».
- Без сети запись (транзакция) не проходит: `ed.offline`, правка ждёт в черновике, повтор через 15 с и по событию `online`. Начать правку без сети нельзя.

## Проверка
Тесты — `tests/`, Python + Playwright + pytest (Chromium есть в рабочей среде Claude). Запуск: `python3 -m pytest tests -q`. Тесты сами поднимают локальный сервер с репозиторием.
- `test_form.py`: форма запускается без ошибок; «Открыть» читает `.json` и старый HTML; «Сохранить» и Ctrl+S пишут `.json`, который открывается снова; черновик переживает перезагрузку; вид «Текст» (светлый, без ленты); главная: список, поиск, открытие карточки; кнопка «назад» и перезагрузка; «Новая проповедь»; выбор слайда в ленте и стрелки; JPEG 1920×1080; ZIP со слайдами; PDF для оператора шириной 80 мм.
- `test_model.py`: модель v2 — перевод старых файлов (текст → к слайду / заставка, имя и фамилия, подпись цитаты), сохранение и открытие новых полей, «доработать», «Текст к слайду» со счётчиком, удаление и копирование слайда с текстом, проповедник вручную, заставка (размер, имя, дата, название файла, JPEG), режимы Писания, рамки, подпись цитаты, нет отметки «готово», текст в виде «Текст» и PDF, шрифт как в Canva по умолчанию. Тесты, которым нужна пустая проповедь, начинают с `start_blank(page)` из `conftest.py`.
- `test_static.py`: `node --check` для каждого `js/*.js`; нет «сырых» U+00A0/U+00AD/U+2028/U+2029 (только экранированные); каждый модуль подключён в `index.html` один раз.
- `test_lock.py`: просмотр по умолчанию и откат правок, «Редактировать» берёт замок, автосохранение, Ctrl+S, «Сохранить и закрыть», чужой замок (имя, неактивная кнопка, живое обновление, карточка «Правит …»), истёкший замок и `lockMinutes`, «Забрать правку», замок забрали (копия несохранённого и без неё), другая вкладка, простой, сигнал, без сети, уход с проповеди и выход отпускают замок, черновик с правками при свободном и занятом замке, черновик другой вкладки не трогается, удаление под чужим замком, новая проповедь сразу в правке, удалённая при просмотре, вид «Текст» в просмотре.
- `test_cloud.py`: вход и экран входа, «Продолжить без входа», нет в списке, запомненный вход, сохранение новой проповеди, открытие и восстановление несохранённых правок, конфликт (копия, «Заменить облачную»), «В облако» для старых черновиков, пачка файлов, удаление, права проповедника (чужая — только чтение, закрытое пространство — только свои), выход, ссылка на проповедь до входа, файл без меток облака. Облако подменено (`tests/fixtures/fake_cloud.js`, база — в localStorage страницы); страница строится через `cloud_page` из `conftest.py`. Обычная фикстура `page` включает «без входа» (`sessionStorage swp-local`).
- `test_editor.py`: статус (спикер ставит «Готов», его правка сбрасывает, правка редактора — нет, старое `done` — готов), «доработать» (спикер не видит; редактор ставит в просмотре, замок не берётся и проповедь не пишется; в документ проповеди не попадает; возвращается после правки спикера, но не после правки самого редактора; фильтр), автосохранение по умолчанию 30 с, исчерпанный запас базы, «спикер» вместо «проповедник».
- `tests/fixtures/sermon.json` — проповедь в старом формате (v1) со всеми типами блоков, включая «Текст проповеди»: заодно проверяет перевод на новую модель.
- Выгрузка JPEG берёт шрифты из интернета, поэтому тестам нужна сеть.
- Для проверки в консоли страницы: `state`, `newBlock`, `exportOne(...)` и остальное доступны как глобальные имена.

## Облако (`cloud/`)
Firebase: Cloud Firestore + вход Google. Что строим и по каким этапам — [`docs/PLAN.md`](docs/PLAN.md), там же модель данных и таблица прав. Настройка проекта — [`docs/FIREBASE.md`](docs/FIREBASE.md). Форма подключена к облаку с этапа 5: см. «Облако в форме» ниже.

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

- `cloud/tests/client.test.mjs` — код `js/cloud-api.mjs` в эмуляторах Firestore и Auth (вход выдуманной учёткой Google, настоящие правила): членство, создание и обновление, конфликт версий, права проповедника, закрытое пространство, живой список, удаление; замок: новая проповедь с замком, продление и отпускание записью, взять / сигнал / отпустить, «занято», редактор забирает, `lost-lock`, другая вкладка той же почты, свои записи после обрыва связи, истёкший чужой замок, `watch`.
- Тесты: `cd cloud && npm ci && npm test` (Node 22, Java 21; эмулятор Firestore скачивается с Google Storage — в рабочей среде Claude он закрыт, поэтому тесты правил гоняются в CI: запушить ветку и запустить workflow вручную, `gh api -X POST repos/crosspect-app/crosspect/actions/workflows/ci.yml/dispatches -f ref=<ветка>`).
- Секрет `FIREBASE_SERVICE_ACCOUNT` (JSON-ключ сервисного аккаунта с ролью Firebase Admin) — в обоих репозиториях. Идентификатор проекта берётся из ключа (`project_id`).
- Email в базе — всегда строчными; `me()` в правилах приводит почту из токена к строчным.
- Время — только `serverTimestamp()`: правила сверяют его с `request.time`.
- Новое поле проповеди — добавить в `validSermon` (`hasOnly`) и тест; иначе база его не примет.

## Выпуск
Файл `.github/workflows/ci.yml`: на каждый коммит идут тесты формы (`Тесты`) и правил (`Правила Firestore`); если коммит в `main` и всё прошло, сайт (`index.html`, `css`, `js`, `data`) выкладывается на GitHub Pages, а правила и индексы — в Firebase (`Выкладка правил Firestore`; без секрета `FIREBASE_SERVICE_ACCOUNT` шаг пропускается). Адрес: `https://crosspect-app.github.io/crosspect/`. В Settings → Pages источник должен быть «GitHub Actions».
