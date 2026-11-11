'use strict';

/* ========= Справочники ========= */
const PREACHERS = [
  ['Чони','Александр'], ['Матвиенко','Андрей'], ['Шух','Валентин'], ['Астафьев','Валерий'], ['Бисюков','Виталий'],
  ['Лесюк','Владимир'], ['Якубович','Владимир'], ['Зеленкин','Евгений'], ['Шода','Евгений'], ['Фетисов','Иван'],
  ['Шаповал','Кирилл'], ['Назарьев','Руслан'], ['Тахман','Сергей'], ['Сивец','Эд'], ['Lilleorg','Allan']
].map(([l, f]) => l + ' ' + f).sort((a, b) => a.localeCompare(b, 'ru'));

/* Переводы. group — язык в списке выбора; books — на каком языке названия книг; src — чей файл даёт главы и стихи
   (для «Своего перевода» — Синодальный); note — пометка в списке; alias — дополнительные слова для поиска */
const NT = 'Новый Завет';
const LANGS = {
  ru:    { group:'ru', label:'Синодальный',                     tr:'Синодальный',                         file:'RussianSynodalBible.xml', books:'ru', alias:'синод rst' },
  nrt:   { group:'ru', label:'Новый русский перевод (НРП)',      tr:'Новый русский перевод',               file:'RussianNRTBible.xml',     books:'ru', alias:'нрп nrt biblica' },
  bti:   { group:'ru', label:'Под ред. Кулакова (Заокский)',     tr:'Перевод под ред. Кулакова',           file:'RussianBTI2015Bible.xml', books:'ru', alias:'кулаков заокский bti' },
  srp:   { group:'ru', label:'Современный русский перевод (РБО)', tr:'Современный русский перевод (РБО)',  file:'Russian2012Bible.xml',    books:'ru', note:NT, alias:'срп рбо радостная весть' },
  rsp:   { group:'ru', label:'Современный перевод (Библ. лига)', tr:'Современный перевод',                 file:'RussianRSPBible.xml',     books:'ru', alias:'rsp библейская лига' },
  cas:   { group:'ru', label:'Под ред. еп. Кассиана',            tr:'Перевод под ред. еп. Кассиана',       file:'RussianCASBible.xml',     books:'ru', note:NT, alias:'кассиан' },
  uk:    { group:'uk', label:'Огієнко',                          tr:'Огієнко',                             file:'UkrainianBible.xml',      books:'uk', alias:'огиенко' },
  ukt:   { group:'uk', label:'Турконяк (2011)',                  tr:'Переклад Р. Турконяка',               file:'Ukrainian2011Bible.xml',  books:'uk', alias:'турконяк' },
  ukh:   { group:'uk', label:'Хоменко',                          tr:'Переклад І. Хоменка',                 file:'UkrainianHOMBible.xml',   books:'uk', alias:'хоменко' },
  uku:   { group:'uk', label:'Сучасною мовою',                   tr:'Сучасною мовою',                      file:'UkrainianUMTBible.xml',   books:'uk', alias:'сучасною umt' },
  ukn:   { group:'uk', label:'Новий переклад українською (НПУ)', tr:'Новий переклад українською',          file:'Ukrainian2022Bible.xml',  books:'uk', note:'Новий Завіт', alias:'нпу biblica' },
  pl:    { group:'pl', label:'Biblia Warszawska',                tr:'Biblia Warszawska',                   file:'PolishBible.xml',         books:'pl', alias:'bw warszawska' },
  plu:   { group:'pl', label:'Uwspółcześniona Biblia Gdańska',   tr:'Uwspółcześniona Biblia Gdańska',      file:'PolishGdansk2017Bible.xml', books:'pl', alias:'ubg gdanska gdańska' },
  plg:   { group:'pl', label:'Biblia Gdańska',                   tr:'Biblia Gdańska',                      file:'PolishGdanskBible.xml',   books:'pl', alias:'gdanska gdańska 1632 1881' },
  pln:   { group:'pl', label:'Nowa Biblia Gdańska',              tr:'Nowa Biblia Gdańska',                 file:'PolishNBGBible.xml',      books:'pl', alias:'nbg gdanska gdańska' },
  ple:   { group:'pl', label:'Biblia EIB (2018)',                tr:'Biblia EIB',                          file:'Polish2018Bible.xml',     books:'pl', alias:'eib' },
  pls:   { group:'pl', label:'Słowo Życia',                      tr:'Słowo Życia',                         file:'Polish2016Bible.xml',     books:'pl', note:'Nowy Testament', alias:'slowo zycia' },
  plp:   { group:'pl', label:'Nowy Przekład Dynamiczny (NPD)',   tr:'Nowy Przekład Dynamiczny',            file:'PolishNPDBible.xml',      books:'pl', note:'Nowy Testament', alias:'npd' },
  en:    { group:'en', label:'NIV',                              tr:'NIV',                                 file:'EnglishNIVBible.xml',     books:'en' },
  enk:   { group:'en', label:'King James Version (KJV)',         tr:'KJV',                                 file:'EnglishKJBible.xml',      books:'en', alias:'kjv king james' },
  enn:   { group:'en', label:'New King James Version (NKJV)',    tr:'NKJV',                                file:'EnglishNKJBible.xml',     books:'en', alias:'nkjv king james' },
  ene:   { group:'en', label:'English Standard Version (ESV)',   tr:'ESV',                                 file:'EnglishESVBible.xml',     books:'en', alias:'esv' }
};
const TR_GROUPS = [['ru', 'Русский'], ['uk', 'Українська'], ['pl', 'Polski'], ['en', 'English']];   // первый перевод в группе — по умолчанию
/* Как перевод подписан на слайде. В настройках — поле slide у перевода и шаблон scriptureFooter */
const SLIDE_NAMES = { ru:'Синодальный перевод', nrt:'Новый русский перевод', bti:'Перевод под ред. М. П. Кулакова', srp:'Современный русский перевод (РБО)',
  rsp:'Современный перевод', cas:'Перевод под ред. еп. Кассиана', uk:'Переклад І. Огієнка', ukt:'Переклад Р. Турконяка', ukh:'Переклад І. Хоменка' };
Object.keys(SLIDE_NAMES).forEach(k => { if (LANGS[k]) LANGS[k].slide = SLIDE_NAMES[k]; });
let TR_FOOTER = '* {name}';
const OWN = '__own';   // «Свой перевод»: всё вводится вручную
const srcKey = l => (LANGS[l] && LANGS[l].src) || l;      // какой файл грузить
const bkLang = l => (LANGS[l] && LANGS[l].books) || l;    // на каком языке названия книг
const trOf = it => it.lang === 'own' ? ((it.trName || '').trim() || 'Свой перевод') : (LANGS[it.lang] ? LANGS[it.lang].tr : '');
/* Порядок книг — синодальный: соборные послания сразу после Деяний */
const BOOK_ORDER_OT = Array.from({ length:39 }, (_, i) => i + 1);
const BOOK_ORDER_NT = [40, 41, 42, 43, 44, 59, 60, 61, 62, 63, 64, 65, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 66];
const BOOKS = {
  ru:'Бытие|Исход|Левит|Числа|Второзаконие|Иисус Навин|Судьи|Руфь|1 Царств|2 Царств|3 Царств|4 Царств|1 Паралипоменон|2 Паралипоменон|Ездра|Неемия|Есфирь|Иов|Псалтирь|Притчи|Екклесиаст|Песня Песней|Исаия|Иеремия|Плач Иеремии|Иезекииль|Даниил|Осия|Иоиль|Амос|Авдий|Иона|Михей|Наум|Аввакум|Софония|Аггей|Захария|Малахия|От Матфея|От Марка|От Луки|От Иоанна|Деяния|Римлянам|1 Коринфянам|2 Коринфянам|Галатам|Ефесянам|Филиппийцам|Колоссянам|1 Фессалоникийцам|2 Фессалоникийцам|1 Тимофею|2 Тимофею|Титу|Филимону|Евреям|Иакова|1 Петра|2 Петра|1 Иоанна|2 Иоанна|3 Иоанна|Иуды|Откровение',
  uk:'Буття|Вихід|Левит|Числа|Повторення Закону|Ісус Навин|Судді|Рут|1 Самуїлова|2 Самуїлова|1 Царів|2 Царів|1 Хроніки|2 Хроніки|Ездра|Неемія|Естер|Йов|Псалми|Приповісті|Екклезіяст|Пісня над піснями|Ісая|Єремія|Плач Єремії|Єзекіїль|Даниїл|Осія|Йоіл|Амос|Овдій|Йона|Михей|Наум|Авакум|Софонія|Огій|Захарій|Малахії|Від Матвія|Від Марка|Від Луки|Від Івана|Дії|Римлян|1 Коринтян|2 Коринтян|Галатів|Ефесян|Филип’ян|Колоссян|1 Солунян|2 Солунян|1 Тимофію|2 Тимофію|Титу|Филимону|Євреїв|Якова|1 Петра|2 Петра|1 Івана|2 Івана|3 Івана|Юди|Об’явлення',
  pl:'1 Mojżeszowa|2 Mojżeszowa|3 Mojżeszowa|4 Mojżeszowa|5 Mojżeszowa|Jozuego|Sędziów|Rut|1 Samuela|2 Samuela|1 Królewska|2 Królewska|1 Kronik|2 Kronik|Ezdrasza|Nehemiasza|Estery|Joba|Psalmy|Przypowieści|Kaznodziei|Pieśń nad pieśniami|Izajasza|Jeremiasza|Treny|Ezechiela|Daniela|Ozeasza|Joela|Amosa|Abdiasza|Jonasza|Micheasza|Nahuma|Habakuka|Sofoniasza|Aggeusza|Zachariasza|Malachiasza|Mateusza|Marka|Łukasza|Jana|Dzieje Apostolskie|Rzymian|1 Koryntian|2 Koryntian|Galacjan|Efezjan|Filipian|Kolosan|1 Tesaloniczan|2 Tesaloniczan|1 Tymoteusza|2 Tymoteusza|Tytusa|Filemona|Hebrajczyków|Jakuba|1 Piotra|2 Piotra|1 Jana|2 Jana|3 Jana|Judy|Objawienie',
  en:'Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|1 Samuel|2 Samuel|1 Kings|2 Kings|1 Chronicles|2 Chronicles|Ezra|Nehemiah|Esther|Job|Psalms|Proverbs|Ecclesiastes|Song of Songs|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|1 Corinthians|2 Corinthians|Galatians|Ephesians|Philippians|Colossians|1 Thessalonians|2 Thessalonians|1 Timothy|2 Timothy|Titus|Philemon|Hebrews|James|1 Peter|2 Peter|1 John|2 John|3 John|Jude|Revelation'
};
Object.keys(BOOKS).forEach(k => { BOOKS[k] = BOOKS[k].split('|'); });
const PSALM_REF = { ru:'Псалом', uk:'Псалом', pl:'Psalm', en:'Psalm' };
const bookName = (lang, n) => (BOOKS[bkLang(lang)] || BOOKS.ru)[n - 1] || '';
const bookRefName = (lang, n) => n === 19 ? (PSALM_REF[bkLang(lang)] || PSALM_REF.ru) : bookName(lang, n);
/* Синодальные сокращения книг — для названий файлов слайдов (всегда по-русски, в любом переводе) */
const ABBR = 'Быт.|Исх.|Лев.|Чис.|Втор.|Нав.|Суд.|Руф.|1 Цар.|2 Цар.|3 Цар.|4 Цар.|1 Пар.|2 Пар.|Езд.|Неем.|Есф.|Иов.|Пс.|Притч.|Еккл.|Песн.|Ис.|Иер.|Плач.|Иез.|Дан.|Ос.|Иоил.|Ам.|Авд.|Ион.|Мих.|Наум.|Авв.|Соф.|Агг.|Зах.|Мал.|Мф.|Мк.|Лк.|Ин.|Деян.|Рим.|1 Кор.|2 Кор.|Гал.|Еф.|Флп.|Кол.|1 Фес.|2 Фес.|1 Тим.|2 Тим.|Тит.|Флм.|Евр.|Иак.|1 Пет.|2 Пет.|1 Ин.|2 Ин.|3 Ин.|Иуд.|Откр.'.split('|');

/* ========= Названия слайдов (имена файлов) =========
   Заставка: «[1] заставка» · Писание: «[3] 1 КОР. 12_7-9,12» · цитата: «[4] цитата Оливер КАН» · тезис, картинка, видео, свободный: «[5] своё название» */
const BAD_CHARS = /[\\/:*?"<>|]/g;          // символы, которые нельзя в именах файлов Windows
const NAMED = { thesis:true, image:true, video:true, free:true };   // у этих слайдов название пишут вручную
const cleanName = s => String(s || '').replace(BAD_CHARS, '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().replace(/[ .]+$/, '');
const versesForName = s => String(s || '').replace(/[–—]/g, '-').replace(/\s+/g, '');
function scriptureNamePart(b){
  const it = b.items.find(x => x.kind === 'scripture' && (x.manual ? (x.mBook || '').trim() : x.book));
  if (!it) return '';
  let abbr, ch, vs;
  if (it.manual){
    const bk = findBook(it.mBook);
    abbr = bk ? ABBR[bk - 1] : it.mBook.trim();
    ch = String(it.mChapter || '').trim(); vs = versesForName(it.mVerses);
  } else {
    abbr = ABBR[it.book - 1] || ''; ch = it.chapter ? String(it.chapter) : ''; vs = versesForName(formatSel(it.sel || []));
  }
  return (abbr.toUpperCase() + (ch ? ' ' + ch + (vs ? '_' + vs : '') : '')).trim();
}
function quoteNamePart(b){
  const a = String(b.author || '').split(',')[0].trim();
  if (!a) return 'цитата';
  const w = a.split(/\s+/), last = w.pop();
  return 'цитата ' + (w.length ? w.join(' ') + ' ' : '') + last.toUpperCase();
}
function slideName(b, n){
  let part = '';
  if (b.type === 'splash') part = 'заставка';
  else if (b.type === 'scripture') part = scriptureNamePart(b);
  else if (b.type === 'quote') part = quoteNamePart(b);
  else if (NAMED[b.type]) part = b.name || '';
  return cleanName('[' + n + '] ' + cleanName(part));
}

/* 1, 2, 4 → «1–2, 4» */
function formatSel(sel){
  const a = Array.from(new Set(sel)).sort((x, y) => x - y), out = [];
  for (let i = 0; i < a.length; i++){
    let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
    out.push(j > i ? a[i] + '–' + a[j] : String(a[i])); i = j;
  }
  return out.join(', ');
}
function parseSel(str, max){
  const out = [];
  String(str || '').split(/[,;]+/).forEach(part => {
    const m = /^\s*(\d+)\s*(?:[-–—]\s*(\d+))?\s*$/.exec(part); if (!m) return;
    let a = +m[1], b = m[2] ? +m[2] : a; if (a > b) [a, b] = [b, a];
    for (let v = a; v <= b; v++) if (!max || v <= max) out.push(v);
  });
  return Array.from(new Set(out)).sort((x, y) => x - y);
}

