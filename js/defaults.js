'use strict';

/* ========= Настройки по умолчанию (можно править здесь) ========= */
/* Файл настроек в репозитории: переводы и авторы. Если он недоступен, форма работает на встроенных списках.
   Ссылка постоянная (окно «Источник настроек» убрано на этапе 7.3). Раздел "slides" в нём больше ни на что не влияет */
const CONFIG_URL_DEFAULT = 'https://raw.githubusercontent.com/crosspect-app/crosspect/main/data/config.json';
/* Куда писать, чтобы получить доступ: показывается на экране «Вас нет в списке» */
const CONTACT_EMAIL = 'swpoznan.media@gmail.com';
/* Настройки слайдов — общие для всего пространства, лежат в облаке (spaces/…/config/slides), меняют админ и редактор
   в окне «Настройки слайдов». Здесь — значения, пока в облаке ничего не записано.
   margins — поля от края цветной панели, px кадра 1920×1080; names.maxLength — длина названия слайда;
   limits — сколько символов в тезисе и цитате, дальше подсветка жёлтым;
   fonts — шрифты (пока по одному в каждом списке, см. SLIDE_FONTS);
   kinds — виды слайдов: size — размер 100% в px; min / max — диапазон в % от size (у тезиса, цитаты и заставки — пределы
     кнопок −/+ размера; у заставки min ещё и до какого размера название может уменьшиться само, чтобы уложиться в три строки;
     у Писания — ниже этого форма предлагает разбить слайд); track — расстояние между символами, em; lead — между строками;
     splash.foot — имя и дата внизу заставки, px; footTrack / footLead — их расстояния;
   verses — вид стихов на всех слайдах Писания: flow 'inline' (в строку) | 'lines' (с новой строки), frame — рамка пунктиром,
     caps — заглавными, showTr — подпись перевода, align 'left' | 'center' | 'right', valign 'top' | 'center' | 'bottom',
     gap — расстояние между стихами с новой строки, em; refGap — между ссылкой (местом Писания) и текстом (и между частями слайда), em;
   kinds.splash.titleOnly — заставка «Только название»: название посередине, без линии, имени и даты (этап 7.3);
   formats — форматы фона пространства (этап 7.5): { <id>: { name, bg } }, bg — null (прежний фон «Ember») или параметры
     генератора (background.js, normBg); defaultFormat — формат по умолчанию: <id> или 'system' (встроенный System Template,
     прежний фон; в облаке не хранится). Фон этапа 7.3 (раздел bg) при чтении переносится в формат «Фон пространства»;
   panels — расположение панелей экрана «Слайды» по умолчанию для всего пространства (этап 7.4): порядок слева направо из
     'film' (миниатюры), 'stage' (слайд), 'side' (редактор); у кого нет своей раскладки (layout.js), панели стоят так */
const SLIDES_DEFAULT = {
  margins:{ side:60, top:60, bottom:60 },
  names:{ maxLength:35 },
  limits:{ thesis:220, quote:300 },
  fonts:{ main:'unbounded', greek:'inter', hebrew:'noto-hebrew' },
  kinds:{
    splash:{ size:200, min:55, max:130, track:0, lead:1.1, foot:44, footTrack:-0.03, footLead:1.1, titleOnly:false },
    scripture:{ size:52.8, min:80, track:-0.04, lead:1.05 },
    thesis:{ size:50.4, min:70, max:130, track:-0.04, lead:1.05 },
    quote:{ size:51.48, min:70, max:110, track:-0.04, lead:1.05 }
  },
  verses:{ flow:'inline', frame:false, caps:true, showTr:true, align:'center', valign:'top', gap:0.3, refGap:0.85 },
  formats:{},
  defaultFormat:'system',
  panels:['film', 'stage', 'side']
};
/* Шрифты в списках — только те, что форма загружает и встраивает в JPEG (см. EXPORT_FONTS в export.js) */
const SLIDE_FONTS = {
  main:{ unbounded:{ label:'Unbounded', css:"'Unbounded'" } },
  greek:{ inter:{ label:'Inter', css:"'Inter'" } },
  hebrew:{ 'noto-hebrew':{ label:'Noto Sans Hebrew', css:"'Noto Sans Hebrew'" } }
};
const PANEL_INSET = 44;   // панель отступает от края кадра на 44 px

const ICONS = {
  edit:'<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  book:'<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19"/><path d="M9 7.5h6"/>',
  split:'<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M3.5 12h17"/>',
  thesis:'<path d="M5 7V5h14v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
  quote:'<path d="M10 7H6.5A1.5 1.5 0 0 0 5 8.5V12h5z"/><path d="M10 12c0 3-1.5 5-4.5 5.5"/><path d="M19 7h-3.5A1.5 1.5 0 0 0 14 8.5V12h5z"/><path d="M19 12c0 3-1.5 5-4.5 5.5"/>',
  image:'<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 15.5-4.5-4.5-8.5 8.5"/>',
  video:'<rect x="3.5" y="5.5" width="17" height="13" rx="3"/><path d="m10.5 9.5 4 2.5-4 2.5z"/>',
  free:'<rect x="3.5" y="3.5" width="17" height="17" rx="3" stroke-dasharray="3 3.2"/><path d="M12 8.5v7M8.5 12h7"/>',
  text:'<path d="M4.5 6.5h15M4.5 10.5h15M4.5 14.5h11M4.5 18.5h7"/>',
  note:'<path d="M12 3.8 21 19.5H3z"/><path d="M12 10v4.5"/><path d="M12 17.3v.2"/>',
  check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  tag:'<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.7 8.7z"/><circle cx="8" cy="8" r="1.4"/>',
  jpg:'<rect x="3.5" y="4.5" width="17" height="13" rx="2.5"/><path d="m3.5 14 4.5-4 4 3.5 2.5-2 6 4.5"/><path d="M12 17.5v4M9.5 19.5 12 22l2.5-2.5"/>',
  zip:'<path d="M5.5 3.5h9l4 4v13h-13z"/><path d="M10.5 3.5v2h1.5v2h-1.5v2h1.5v2h-1.5v2"/><rect x="9.5" y="14.5" width="3" height="3" rx=".8"/>',
  phone:'<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M10.5 18.5h3"/>',
  frame:'<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><rect x="7" y="9" width="10" height="6" rx="1" stroke-dasharray="2 1.6"/>',
  up:'<path d="m6 14 6-6 6 6"/>',
  top:'<path d="M6 4.5h12"/><path d="m7 15 5-5 5 5"/><path d="M12 10v10"/>',
  bottom:'<path d="M6 19.5h12"/><path d="m7 9 5 5 5-5"/><path d="M12 14V4"/>',
  down:'<path d="m6 10 6 6 6-6"/>',
  fold:'<path d="m7 4 5 5 5-5"/><path d="m7 20 5-5 5 5"/>',
  unfold:'<path d="m7 9 5-5 5 5"/><path d="m7 15 5 5 5-5"/>',
  dup:'<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  trash:'<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  save:'<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
  open:'<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  more:'<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  close:'<path d="M6 6l12 12M18 6 6 18"/>',
  marker:'<path d="m14.5 4.5 5 5-8 8H6.5v-5z"/><path d="M4 20.5h8"/>',
  clear:'<path d="M5 6h11"/><path d="M10.5 6 8 18"/><path d="m15 14 5 5M20 14l-5 5"/>',
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  settings:'<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  newdoc:'<path d="M14 3.5H7A2.5 2.5 0 0 0 4.5 6v12A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5V9z"/><path d="M14 3.5V9h5.5"/><path d="M12 12v5M9.5 14.5h5"/>',
  splash:'<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/>',
  link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  alignl:'<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  vtop:'<path d="M4 4.5h16"/><path d="M8 9h8M8 13h8M10 17h4"/>',
  vmid:'<path d="M4 4.5h16M4 19.5h16"/><path d="M8 10h8M9 14h6"/>',
  vbot:'<path d="M4 19.5h16"/><path d="M10 7h4M8 11h8M8 15h8"/>',
  alignc:'<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  alignr:'<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  reset:'<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/>',
  cover:'<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M8 10h8M9.5 13h5"/><path d="M6.5 16.5h11" opacity=".55"/>',
  flag:'<path d="M5.5 21V4"/><path d="M5.5 4.5h11l-2.5 4 2.5 4h-11"/>',
  back:'<path d="m15 18-6-6 6-6"/>',
  next:'<path d="m9 18 6-6-6-6"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/>',
  frameDash:'<rect x="4" y="6" width="16" height="12" rx="2" stroke-dasharray="2.6 2.2"/>',
  undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo:'<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  done:'<path d="m4.5 12.5 4.5 4.5 10.5-10.5"/>'
};

/* Порядок здесь = порядок в окне «Что добавить?»: плитки парами (заставка — Писание, тезис — цитата, картинка — видео,
   свободный — заметка). slide — слайд с номером; todo — при создании сразу получает отметку «доработать» (такой слайд делают вручную) */
const TYPES = {
  splash:    { label:'Заставка проповеди', icon:'cover', slide:true, desc:'Название проповеди на экране, пока вы говорите без слайда' },
  scripture: { label:'Место Писания', icon:'book', slide:true, desc:'Одно или несколько мест Писания, а также дополнительный текст' },
  thesis:    { label:'Тезис', icon:'thesis', slide:true, desc:'Мысль, пункт плана, пояснение слова или понятия, список' },
  quote:     { label:'Цитата', icon:'quote', slide:true, desc:'Текст, автор и подпись' },
  image:     { label:'Картинка', icon:'image', slide:true, todo:true, desc:'Найти по описанию или прислать файл' },
  video:     { label:'Видео', icon:'video', slide:true, todo:true, desc:'Ссылка или файл отдельно' },
  free:      { label:'Свободный слайд', icon:'free', slide:true, todo:true, desc:'Всё нестандартное: опишите словами' },
  note:      { label:'Заметка оператору', icon:'note', slide:false, desc:'Что сделать: запустить видео, включить музыку…' }
};
/* Типы, у которых в редакторе есть предпросмотр слайда и которые форма сама собирает в JPEG (и в «Скачать все слайды») */
const PREVIEW = { splash:true, scripture:true, thesis:true, quote:true };
/* Картинка, видео и свободный слайд: кнопка JPEG скачивает пустой слайд (рамка и фон, без текста) — основа для Canva */
const BLANK_JPEG = { image:true, video:true, free:true };
/* Сколько слов в минуту — для оценки времени по «Тексту к слайду» */
const WORDS_PER_MIN = 130;

