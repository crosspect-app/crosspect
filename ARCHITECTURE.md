# Crosspect — устройство

## Стек
- Сайт без сборки: [`index.html`](index.html), [`css/style.css`](css/style.css) и модули [`js/*.js`](js). Сторонних библиотек нет.
- Модули — обычные скрипты (не ES-модули): все они делят одну область видимости, как раньше делили один файл. Порядок подключения — в `index.html`, он же порядок выполнения. Функции можно вызывать откуда угодно, но на самом верху файла нельзя использовать то, что объявлено в файле ниже по списку: например, `onclick:saveFile` не сработает, а `onclick:() => saveFile()` сработает.
- К каждому файлу в `index.html` дописано `?v=__BUILD__`: при выпуске CI подставляет номер коммита, и браузер не смешивает старые и новые файлы.
- Шрифты Google Fonts: Unbounded (переменная толщина 200–900), Inter, Noto Sans Hebrew.
- Тексты Библии — XML (Beblia или Zefania), грузятся по требованию с GitHub.
- Настройки — [`data/config.json`](data/config.json) из этого репозитория (`CONFIG_URL_DEFAULT`), последняя копия кешируется в localStorage; при недоступности — встроенные списки.
- Хранение: черновик в localStorage (`swp-sermon:<id>`, у каждой проповеди свой, `swp-sermon:last` — последняя); «Сохранить» скачивает файл `.json` с проповедью. «Открыть» понимает `.json` и старые HTML-файлы (проповедь лежит в `<script id="sermon-data">`).

## Файлы кода (порядок подключения)
| Файл | Что внутри |
|---|---|
| `css/style.css` | токены цветов (тёмная/светлая тема), интерфейс, слайд `.sl*` (кадр 1920×1080), печать `#print-op` |
| `js/defaults.js` | `DEFAULT_SETTINGS` (лимиты), `CONFIG_URL_DEFAULT`, `SLIDES_DEFAULT` (поля, названия, размеры, временный `font.canva`), `ICONS`, `TYPES` (порядок = окно «Что добавить?») |
| `js/util.js` | утилиты (`h`, `$`, `LS`…); форматированный текст: `cleanHTML` / `sanitize` — разрешены только `b i u mark br span.up` |
| `js/refs.js` | справочники `PREACHERS`, `LANGS` (переводы), `BOOKS`, `ABBR` (синодальные сокращения); названия слайдов: `BAD_CHARS`, `NAMED`, `cleanName`, `slideName`, `scriptureNamePart`, `quoteNamePart` |
| `js/bible.js` | тексты Библии: `loadBible` (Beblia/Zefania), `cleanVerse`, `syncVerses`, `refString` |
| `js/model.js` | модель данных: `newBlock`, `newScripture`, `newPart` (свой перевод), `newTextItem`, `newLineItem`, `newThesisPart`, `normalize` / `normItem` (перевод старых форматов); общие настройки слайдов: `mergeSlides`, `slidesCfg` (config + localStorage `swp-slides-local`), `applySlides` (CSS-переменные полей), `missingNames`, `checkNames` |
| `js/state.js` | `state`, `change`, `persistDraft`, `slideNums`, `blockSummary` |
| `js/shell.js` | каркас: верхняя панель, меню «⋯», окна, панель оформления |
| `js/render.js` | `renderAll`, `renderEditor`, `renderBlock`, `rerender`, `BODY[type]` (редакторы блоков), `nameField`, `autoName`, списки (`toggleList`, `listEnter`, `autoList`), `toggleUp`, `toggleMark`; просмотр: `renderView`, `viewSlide`, `nameView` |
| `js/preview.js` | предпросмотр слайдов: `typoText`, `fixOrphan`, `wrapScripts` (греческий/иврит → `span.xl`), `slideEl`, `slideHTML` (Писание), `boxHTML` / `paraHTML` (тезис, цитата, списки), `layoutAt`, `layoutBox`, `fitSlide` (бинарный поиск размера), `BASE`, `scrPx` |
| `js/files.js` | `saveFile` (проверка названий) / `writeFile`, `parseSermonFile`, открытие файла, `newSermon` |
| `js/export.js` | выгрузка JPEG: `exportFonts` (CSS шрифтов с встроенными woff2), `slideCSS`, `renderJPEG` (SVG foreignObject → canvas), `makeZip` (ZIP без сжатия, UTF-8), `exportOne`, `exportMany`, `markDone` |
| `js/print.js` | PDF для оператора: `#print-op`, `@page op` 80×170 мм, `buildOperatorPrint`, `operatorPDF` |
| `js/settings.js` | окна настроек: `openSettings` (лимиты), `openConfig` (источник), `openSlidesCfg` (поля, названия, размеры, шрифт) |
| `js/misc.js` | `toast`, закрытие меню, горячие клавиши |
| `js/main.js` | запуск: настройки из кеша, черновик, первая отрисовка, свежие настройки из репозитория |

## Модель проповеди
Файл проповеди (`.json`) — это сам `state`:
```
state = { app:'swp-sermon', v:1, id, createdAt, updatedAt, savedAt,
  meta:{ title, date, preacher }, settings:{ minScale, limitThesis, limitQuote, lang }, blocks:[…] }
```
Общее у блоков: `id, type, collapsed, done`. По типам:
- `scripture`: `showTr`, `items:[ {kind:'scripture', lang, book, chapter, sel, verses:[{num,text,orig}], ref, translation} | {kind:'scripture', manual:true, mBook, mChapter, mVerses, translation, verses:[{num,text}]} | {kind:'text', html, align, caps} | {kind:'line'} ]`
- `thesis`: `name, nameAuto, valign, parts:[ {kind:'text', html, align, scale, caps} | {kind:'line'} ]`; `text` — склейка частей (для названия и старых версий)
- `quote`: `text, author, scale, caps`
- `image`: `name, mode('find'|'send'), desc`; `video`: `name, mode('link'|'send'), url, from, to, desc`; `free`: `name, desc`
- `text`: `text, splash`; `note`: `text`

`id` переводов в `config.json` не менять: по ним сохранённые проповеди помнят перевод.

## Слайд
- Кадр раскладывается в полном размере 1920×1080 и только масштабируется (`--s`), поэтому переносы в предпросмотре и JPEG совпадают.
- Поля — CSS-переменные `--sl-x/--sl-t/--sl-b` = 44 (отступ панели) + поле из настроек.
- `letter-spacing` в em на `.sl-stage` наследуется как абсолютное значение от 16 px — фактически почти ноль; трекинг задавать на самих текстовых элементах.
- JPEG: слайд раскладывается в скрытом контейнере тем же кодом, клонируется вместе с CSS-правилами `.sl*` и шрифтами в SVG foreignObject и рисуется в canvas. Поэтому классы режимов вешаются на `.sl-stage`, а не на `.sl`.

## Проверка
Тесты — `tests/`, Python + Playwright + pytest (Chromium есть в рабочей среде Claude). Запуск: `python3 -m pytest tests -q`. Тесты сами поднимают локальный сервер с репозиторием.
- `test_form.py`: форма запускается без ошибок; «Открыть» читает `.json` и старый HTML; «Сохранить» и Ctrl+S пишут `.json`, который открывается снова; черновик переживает перезагрузку; просмотр; JPEG 1920×1080; ZIP со слайдами; PDF для оператора шириной 80 мм.
- `test_static.py`: `node --check` для каждого `js/*.js`; нет «сырых» U+00A0/U+00AD/U+2028/U+2029 (только экранированные); каждый модуль подключён в `index.html` один раз.
- `tests/fixtures/sermon.json` — проповедь со всеми типами блоков.
- Выгрузка JPEG берёт шрифты из интернета, поэтому тестам нужна сеть.
- Для проверки в консоли страницы: `state`, `newBlock`, `exportOne(...)` и остальное доступны как глобальные имена.

## Выпуск
Файл `.github/workflows/ci.yml`: на каждый коммит идут тесты; если коммит в `main` и тесты прошли, сайт (`index.html`, `css`, `js`, `data`) выкладывается на GitHub Pages. Адрес: `https://crosspect-app.github.io/crosspect/`. В Settings → Pages источник должен быть «GitHub Actions».
