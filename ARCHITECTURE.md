# Crosspect — устройство

## Стек
- Один самодостаточный HTML-файл [`sermon.html`](sermon.html): разметка, CSS и JS внутри, без сборки и без зависимостей.
- Шрифты Google Fonts: Unbounded (переменная толщина 200–900), Inter, Noto Sans Hebrew.
- Тексты Библии — XML (Beblia или Zefania), грузятся по требованию с GitHub.
- Настройки — [`data/config.json`](data/config.json) из этого репозитория (`CONFIG_URL_DEFAULT`), последняя копия кешируется в localStorage; при недоступности — встроенные списки.
- Хранение: черновик в localStorage; «Сохранить» скачивает копию самой формы с данными в `<script id="sermon-data" type="application/json">`.

## Разделы кода (по порядку в файле)
| Раздел | Что внутри |
|---|---|
| CSS | токены цветов (тёмная/светлая тема), интерфейс, слайд `.sl*` (кадр 1920×1080), печать `#print-op` |
| Настройки по умолчанию | `DEFAULT_SETTINGS` (лимиты), `CONFIG_URL_DEFAULT`, `SLIDES_DEFAULT` (поля, названия, размеры, временный `font.canva`), `ICONS`, `TYPES` (порядок = окно «Что добавить?») |
| Форматированный текст | `cleanHTML` / `sanitize` — разрешены только `b i u mark br span.up` |
| Справочники | `PREACHERS`, `LANGS` (переводы), `BOOKS`, `ABBR` (синодальные сокращения) |
| Названия слайдов | `BAD_CHARS`, `NAMED`, `cleanName`, `slideName`, `scriptureNamePart`, `quoteNamePart` |
| Тексты Библии | `loadBible` (Beblia/Zefania), `cleanVerse`, `syncVerses`, `refString` |
| Модель данных | `newBlock`, `newScripture`, `newPart` (свой перевод), `newTextItem`, `newLineItem`, `newThesisPart`, `normalize` / `normItem` (перевод старых форматов) |
| Общие настройки слайдов | `mergeSlides`, `slidesCfg` (config + localStorage `swp-slides-local`), `applySlides` (CSS-переменные полей), `missingNames`, `checkNames` |
| Состояние | `state`, `change`, `persistDraft`, `slideNums`, `blockSummary` |
| Каркас и отрисовка | меню «⋯», `renderEditor`, `renderBlock`, `rerender`, `BODY[type]` (редакторы блоков), `nameField`, `autoName`, списки (`toggleList`, `listEnter`, `autoList`), `toggleUp`, `toggleMark` |
| Просмотр | `renderView`, `viewSlide`, `nameView` |
| Предпросмотр слайдов | `typoText`, `fixOrphan`, `wrapScripts` (греческий/иврит → `span.xl`), `slideEl`, `slideHTML` (Писание), `boxHTML` / `paraHTML` (тезис, цитата, списки), `layoutAt`, `layoutBox`, `fitSlide` (бинарный поиск размера), `BASE`, `scrPx` |
| Файлы | `saveFile` (проверка названий) / `writeFile`, открытие файла, `newSermon` |
| Выгрузка JPEG | `exportFonts` (CSS шрифтов с встроенными woff2), `slideCSS`, `renderJPEG` (SVG foreignObject → canvas), `makeZip` (ZIP без сжатия, UTF-8), `exportOne`, `exportMany`, `markDone` |
| PDF для оператора | `#print-op`, `@page op` 80×170 мм, `buildOperatorPrint`, `operatorPDF` |
| Окна настроек | `openSettings` (лимиты), `openConfig` (источник), `openSlidesCfg` (поля, названия, размеры, шрифт) |

## Модель проповеди
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
- Playwright + Chromium (есть в рабочей среде Claude): загрузить форму, положить проповедь в localStorage (`swp-sermon:<id>`, `swp-sermon:last`, `swp-mode`), проверить редактор, просмотр, скачать JPEG/ZIP (`expect_download`), PDF — `page.pdf(prefer_css_page_size=True)` после `emulate_media('print')`.
- Перед отправкой: `node --check` для скрипта; в файле не должно быть «сырых» U+00A0/U+00AD/U+2028/U+2029 — только экранированные.

## Выпуск
Пока выпуска нет: `sermon.html` в корне — актуальная версия, её скачивают и открывают в Chrome. План — GitHub Pages (шаг 2 в `STATUS.md`).
