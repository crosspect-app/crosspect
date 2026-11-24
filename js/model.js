'use strict';

/* ========= Модель данных ========= */
function newPart(){ return { kind:'scripture', manual:true, mBook:'', mChapter:'', mVerses:'', ref:'', translation:'', verses:[{ num:'', text:'' }] }; }
/* «Свой перевод»: книга, глава и стихи вводятся вручную, ссылка собирается из них */
const manualRef = it => { const b = (it.mBook || '').trim(), c = String(it.mChapter || '').trim(), v = String(it.mVerses || '').trim(); return b + (c ? ' ' + c + (v ? ':' + v : '') : ''); };
function splitManualRef(it){   // старые файлы: было одно поле «Место»
  const m = /^(.*?)\s*(\d+)\s*(?::\s*(.+))?$/.exec((it.ref || '').trim());
  if (m && m[1]){ it.mBook = m[1].trim(); it.mChapter = m[2]; it.mVerses = (m[3] || '').trim(); }
  else { it.mBook = (it.ref || '').trim(); it.mChapter = ''; it.mVerses = ''; }
}
function findBook(name){
  const n = String(name || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); if (!n) return 0;
  for (const lg of Object.keys(BOOKS)){ const i = BOOKS[lg].findIndex(x => x.toLowerCase().replace(/ё/g, 'е') === n); if (i >= 0) return i + 1; }
  return 0;
}
/* Перенос в ручной ввод с сохранением книги, главы и текста — когда перевод не загрузился */
function toManual(it){
  Object.assign(it, { manual:true, mBook:it.book ? bookName(it.lang, it.book) : '', mChapter:it.chapter ? String(it.chapter) : '', mVerses:it.sel && it.sel.length ? formatSel(it.sel) : '', translation:'' });
  it.verses = (it.verses && it.verses.length ? it.verses : [{ num:'', text:'' }]).map(v => ({ num:String(v.num || ''), text:v.text || '' }));
  it.ref = manualRef(it);
}
/* Выбран «Свой перевод»: все поля пустые, проповедник вводит всё сам */
function resetToOwn(it){
  Object.keys(it).forEach(k => delete it[k]);
  Object.assign(it, newPart());
}
function fromManual(it, lang){
  const bk = findBook(it.mBook), ch = +it.mChapter || 0, sel = parseSel(it.mVerses);
  Object.keys(it).forEach(k => delete it[k]);
  Object.assign(it, newScripture(lang), { book:bk, chapter:bk ? ch : 0, sel:bk && ch ? sel : [] });
}
function syncManualVerses(it){   // строки стихов по полю «Стихи»; набранный текст сохраняется
  const nums = parseSel(it.mVerses); if (!nums.length) return;
  const old = {}; (it.verses || []).forEach(v => { old[v.num] = v; });
  const loose = (it.verses || []).find(v => !v.num && plain(v.text).trim());
  it.verses = nums.map((n, i) => old[String(n)] || { num:String(n), text:i === 0 && loose ? loose.text : '' });
}
function curLang(){ return (state && state.settings && LANGS[state.settings.lang]) ? state.settings.lang : 'ru'; }
function newScripture(lang){ lang = LANGS[lang] ? lang : curLang(); const it = { kind:'scripture', manual:false, lang, book:0, chapter:0, sel:[], verses:[], ref:'', trName:'' }; it.translation = trOf(it); return it; }
function newTextItem(){ return { kind:'text', html:'', align:'center', caps:true, scale:100 }; }
function newLineItem(){ return { kind:'line' }; }
function newThesisPart(){ return { kind:'text', html:'', align:'center', scale:100, caps:true, frame:false }; }
/* Текст всех частей тезиса одной строкой с переносами — для названия, счётчика, просмотра и PDF */
function syncThesisText(b){ b.text = b.parts.filter(p => p.kind === 'text' && plain(p.html).trim()).map(p => p.html).join('<br>'); }
/* У каждого слайда есть «Текст к слайду» (speech, HTML): что проповедник говорит, пока слайд на экране.
   todo — отметка «доработать» для того, кто готовит слайды; картинка, видео и свободный слайд получают её сами */
/* Ширина области текста у цитаты «слева / справа», % ширины слайда (этап 9.5): 30–80, по умолчанию 50 */
const HALF_W = { min:30, max:80, step:5, dflt:50 };
function clampHalfW(v){ v = v == null || v === '' ? NaN : Math.round(+v); return isFinite(v) ? Math.min(HALF_W.max, Math.max(HALF_W.min, v)) : HALF_W.dflt; }
/* Рамка текста цитаты с фото (этап 10.5.5): x, y, w, h — доли слайда, ha / va — выравнивание текста в рамке; null — прежний расчёт
   по «Месту текста» и «Ширине текста». Рамка — целиком на слайде; неверное → null */
const TB_HA = ['left', 'center', 'right'], TB_VA = ['top', 'center', 'bottom'];
function normTextBox(t){
  if (!t || typeof t !== 'object') return null;
  const v = ['x', 'y', 'w', 'h'].map(k => t[k] == null || t[k] === '' ? NaN : +t[k]);
  if (!v.every(isFinite)) return null;
  const [x, y, w, hh] = v.map(n => +n.toFixed(4));
  if (w < 0.03 || hh < 0.03 || x < 0 || y < 0 || x + w > 1.0001 || y + hh > 1.0001) return null;
  return { x, y, w, h:hh, ha:TB_HA.includes(t.ha) ? t.ha : 'center', va:TB_VA.includes(t.va) ? t.va : 'center' };
}
/* Режим заставки (этапы 9.5, 10.9.1.1, 10.9.2.1): один на все заставки проповеди, state.settings.splashMode.
   Нет значения — «Обычная»; 'bg' — «Свой фон»: картинка вместо стандартного фона, название, автор и дата поверх, затемнение splashDim;
   'full' — «Картинка целиком» (бывшая «Своя заставка»): без картинки — серая заглушка, в архив JPEG не идёт; с картинкой (state.settings.customSplashImage
   { imageId, imgW, imgH }, slideimages.js) форма рисует её сама на весь слайд. «Свой фон» без картинки рисуется как «Обычная» */
const SPLASH_DIM_MAX = 70, SPLASH_DIM_DEF = 30;
const splashDimOk = v => Number.isInteger(v) && v >= 0 && v <= SPLASH_DIM_MAX;
/* Свой режим и затемнение конспекта (то, что выбрано в панели заставки) */
const splashOwnMode = () => { const m = state && state.settings ? state.settings.splashMode : ''; return m === 'bg' || m === 'full' ? m : 'normal'; };
function splashOwnDim(){
  const v = state && state.settings ? state.settings.splashDim : undefined;
  return splashDimOk(v) ? v : SPLASH_DIM_DEF;
}
/* Фон заставки серии (этап 10.9.3): SERIES[id].splash { mode:'bg'|'full', imageId, imgW, imgH, dim } (space.js, normSplash).
   Какой фон у заставки: свой у конспекта (режим «Свой фон» / «Картинка целиком» и своя картинка) → у серии → как раньше.
   splashEff() — { from:'own'|'series'|'', mode, img, dim }; from:'series' — заставка на фоне серии, img — её картинка */
const splashSeries = () => {
  const id = state && state.meta && state.meta.series, x = id && typeof SERIES !== 'undefined' && SERIES[id];
  return x && x.splash ? Object.assign({ seriesId:id, seriesName:x.name }, x.splash) : null;
};
function splashEff(){
  const m = splashOwnMode(), own = typeof splashOwnImage === 'function' ? splashOwnImage() : null;
  if (m !== 'normal' && own) return { from:'own', mode:m, img:own, dim:splashOwnDim() };
  const s = splashSeries();
  if (s) return { from:'series', mode:s.mode, img:{ imageId:s.imageId, imgW:s.imgW, imgH:s.imgH }, dim:s.dim, series:s };
  return { from:'', mode:m, img:null, dim:splashOwnDim() };
}
/* Действующие режим, картинка и затемнение — их рисуют сцена, лента, показ, JPEG, PowerPoint и PDF */
const splashMode = () => splashEff().mode;
const splashImage = () => splashEff().img;
const splashDim = () => splashEff().dim;
const isCustomSplash = b => !!b && b.type === 'splash' && splashMode() === 'full';
const isBgSplash = b => !!b && b.type === 'splash' && !b.meta && splashMode() === 'bg' && !!splashImage();
/* «Нижняя строка» заставки (линия, имя и дата): у проповеди своя (state.settings.splashFoot), пока не меняли — как в настройках слайдов пространства.
   b.meta — пример в окне настроек слайдов: там всегда по настройкам */
function splashFootOn(b){
  const dflt = !slidesCfg().kinds.splash.titleOnly;
  if (b && b.meta) return dflt;
  const v = state && state.settings ? state.settings.splashFoot : undefined;
  return typeof v === 'boolean' ? v : dflt;
}

function newBlock(type){
  const id = uid(), T = TYPES[type];
  const slide = T && T.slide ? { speech:'', todo:!!T.todo } : {};
  switch (type){
    case 'splash':     return Object.assign({ id, type }, slide);   // настройки заставки (размер, «своя», нижняя строка) — общие на проповедь, в state.settings
    case 'scripture':  return Object.assign({ id, type, items:[newScripture()] }, slide);   // вид стихов — общий для всех слайдов (настройки слайдов, verses)
    case 'thesis':     return Object.assign({ id, type, name:'', nameAuto:true, text:'', valign:'center', scale:100, parts:[newThesisPart()] }, slide);
    case 'quote':      return Object.assign({ id, type, text:'', first:'', last:'', caption:'', photo:null, scale:100, caps:false, half:'full', halfW:50, frame:false, textBox:null }, slide);   // frame — обводка текста пунктиром (этап 9.5)   // half: «Во всю ширину» / текст слева / текст справа (этап 9.3); halfW — ширина области текста при «слева / справа», % слайда (этап 9.5)
    case 'image':      return Object.assign({ id, type, name:'', mode:'ask', desc:'' }, slide);   // этап 10.9.2: «Попросить редактора»
    case 'video':      return Object.assign({ id, type, name:'', mode:'link', url:'', from:'', to:'', desc:'' }, slide);
    case 'free':       return Object.assign({ id, type, name:'', desc:'' }, slide);
    case 'note':       return { id, type, text:'' };
  }
}
/* Автор цитаты (этап 10.5): «Имя Фамилия» из двух полей — для названия слайда, «Текста», PDF, оператора и счёта символов */
const quoteAuthor = b => [b.first, b.last].map(x => String(x || '').trim()).filter(Boolean).join(' ');
/* Фото автора у цитаты (этап 10.5): id из фотобанка; x — середина фото, y — нижний край, h — высота, всё в долях слайда (null — по умолчанию);
   filter — один из PHOTO_FILTERS; mirror:false — «Не отражать». Неверное — к умолчанию, без id — фото нет */
const PHOTO_FILTER_IDS = ['none', 'bw', 'bwHard', 'bwSoft', 'sepia', 'warm', 'cool', 'muted', 'tone'];
const PHOTO_H = { def:0.9, min:0.15, max:3 };
/* Этап 10.5.3 — правки фото на слайде (поля есть, только если не по умолчанию): crop {l,t,r,b} — обрезка в долях картинки, как она видна
   на слайде (после отражения; остаётся хотя бы 10 % по каждой стороне); rot — поворот в градусах, −180…180, по часовой; outline {w, color} —
   обводка, w от 0 до 30 px слайда, color — #rrggbb; round — скругление углов 0…0,5 (только у фото «с фоном»).
   Этап 10.5.7: flipH:true — отражено слева направо поверх отражения к тексту (mirror), flipV:true — сверху вниз */
const PHOTO_OUT = { max:30, color:'#ffffff' }, PHOTO_CROP_MIN = 0.1;
function normPhotoCrop(c){
  if (!c || typeof c !== 'object') return null;
  const n = v => typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1 - PHOTO_CROP_MIN ? +v.toFixed(4) : 0;
  const r = { l:n(c.l), t:n(c.t), r:n(c.r), b:n(c.b) };
  if (r.l + r.r > 1 - PHOTO_CROP_MIN + 1e-9 || r.t + r.b > 1 - PHOTO_CROP_MIN + 1e-9) return null;
  return r.l || r.t || r.r || r.b ? r : null;
}
function normPhoto(p){
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !/^[a-z0-9-]{1,60}$/.test(p.id)) return null;
  const num = (v, a, z) => typeof v === 'number' && isFinite(v) && v >= a && v <= z ? v : null;
  const out = { id:p.id, x:num(p.x, -2, 3), y:num(p.y, -2, 4), h:num(p.h, PHOTO_H.min, PHOTO_H.max),
    filter:PHOTO_FILTER_IDS.includes(p.filter) ? p.filter : 'none', mirror:p.mirror !== false, ...(p.off === true ? { off:true } : {}) };
  const crop = normPhotoCrop(p.crop), rot = num(p.rot, -180, 180), round = num(p.round, 0, 0.5), o = p.outline && typeof p.outline === 'object' ? p.outline : null;
  if (crop) out.crop = crop;
  if (rot) out.rot = +rot.toFixed(1);
  if (o){
    const w = num(o.w, 0, PHOTO_OUT.max) || 0, color = typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color.toLowerCase() : PHOTO_OUT.color;
    if (w > 0 || color !== PHOTO_OUT.color) out.outline = { w:+w.toFixed(1), color };
  }
  if (round) out.round = +round.toFixed(3);
  if (p.flipH === true) out.flipH = true;
  if (p.flipV === true) out.flipV = true;
  const sh = picShadow(p.shadow); if (sh) out.shadow = sh;   // этап 10.9.2: тень, как у картинок слайда
  return out;
}
/* Картинка слайда (этап 10.9.1): mode 'upload' — файл загружен в форму и лежит в облаке рядом с конспектом
   (spaces/{s}/sermons/{id}/slideImages/{imageId}); imgW, imgH — размер файла в пикселях. Правки pic (поля есть, только если
   не по умолчанию): crop {l,t,r,b} — обрезка в долях картинки, rot — поворот −180…180, filter — один из PHOTO_FILTERS,
   outline { w — 0…30 px слайда, color }. Картинка не меняется: «Заменить» — новый imageId */
const PIC_ID_RE = /^[a-z0-9-]{1,60}$/;
function normPic(p){
  if (!p || typeof p !== 'object') return null;
  const out = {}, crop = normPhotoCrop(p.crop), rot = typeof p.rot === 'number' && isFinite(p.rot) && p.rot >= -180 && p.rot <= 180 ? +p.rot.toFixed(1) : 0;
  if (crop) out.crop = crop;
  if (rot) out.rot = rot;
  if (PHOTO_FILTER_IDS.includes(p.filter) && p.filter !== 'none') out.filter = p.filter;
  const o = p.outline && typeof p.outline === 'object' ? p.outline : null;
  if (o){
    const w = typeof o.w === 'number' && isFinite(o.w) ? Math.min(PHOTO_OUT.max, Math.max(0, o.w)) : 0;
    const color = typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color.toLowerCase() : PHOTO_OUT.color;
    if (w > 0) out.outline = { w:+w.toFixed(1), color };
  }
  return Object.keys(out).length ? out : null;
}
/* Положение картинки на слайде (этап 10.9.1.2; в 10.9.2 — у каждой картинки списка): null — целиком внутри полей, как в 10.9.1;
   { cover:true } — на весь слайд (закрывает кадр при любом повороте и обрезке, лишнее срезается); { x, y, w } — середина видимой
   части в долях слайда (0…1) и ширина всей картинки до обрезки в долях ширины слайда */
const PIC_PLACE = { wMin:0.02, wMax:12 };
function normPicPlace(p){
  if (!p || typeof p !== 'object') return null;
  if (p.cover === true) return { cover:true };
  const n = (v, a, z) => typeof v === 'number' && isFinite(v) && v >= a && v <= z ? +v.toFixed(4) : null;
  const x = n(p.x, 0, 1), y = n(p.y, 0, 1), w = n(p.w, PIC_PLACE.wMin, PIC_PLACE.wMax);
  return x == null || y == null || w == null ? null : { x, y, w };
}
/* Слои «Картинки» (этап 10.9.2), снизу вверх: картинки и рамки текста.
   { kind:'pic', id, imageId, imgW, imgH, pic?, place?, shadow? } — картинка (pic и place — как в 10.9.1–10.9.1.2; shadow — сила тени 1…100, нет — без тени);
   { kind:'text', id, text, x, y, w, size, bold?, color, align } — рамка текста: x, y — середина в долях слайда, w — ширина в долях ширины слайда,
   size — размер шрифта в px кадра 1920×1080. Старый блок с imageId у самого блока — одна картинка-слой */
const PIC_TEXT = { size:72, sizeMin:20, sizeMax:240, wMin:0.04, wMax:1.5, color:'#ffffff', max:2000 };
const PIC_LAYER_ID = /^[a-z0-9]{1,24}$/;
const picDim = v => Number.isInteger(v) && v > 0 && v <= 4000 ? v : 0;
const picShadow = v => typeof v === 'number' && isFinite(v) && v >= 1 ? Math.min(100, Math.round(v)) : 0;
function normPicLayer(l, seen){
  if (!l || typeof l !== 'object') return null;
  let id = typeof l.id === 'string' && PIC_LAYER_ID.test(l.id) && !seen.has(l.id) ? l.id : '';
  while (!id || seen.has(id)) id = uid().replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 24) || 'l' + seen.size;
  seen.add(id);
  if (l.kind === 'text'){
    const n = (v, a, z, d) => typeof v === 'number' && isFinite(v) ? Math.min(z, Math.max(a, v)) : d;
    const out = { kind:'text', id, text:String(l.text == null ? '' : l.text).replace(/\r\n?/g, '\n').slice(0, PIC_TEXT.max),
      x:+n(l.x, 0, 1, 0.5).toFixed(4), y:+n(l.y, 0, 1, 0.5).toFixed(4), w:+n(l.w, PIC_TEXT.wMin, PIC_TEXT.wMax, 0.6).toFixed(4),
      size:Math.round(n(l.size, PIC_TEXT.sizeMin, PIC_TEXT.sizeMax, PIC_TEXT.size)),
      color:typeof l.color === 'string' && /^#[0-9a-f]{6}$/i.test(l.color) ? l.color.toLowerCase() : PIC_TEXT.color,
      align:['left', 'center', 'right'].includes(l.align) ? l.align : 'center' };
    if (l.bold === true) out.bold = true;
    return out;
  }
  if (!(typeof l.imageId === 'string' && PIC_ID_RE.test(l.imageId) && picDim(l.imgW) && picDim(l.imgH))) return null;
  const out = { kind:'pic', id, imageId:l.imageId, imgW:l.imgW, imgH:l.imgH };
  const pic = normPic(l.pic), place = normPicPlace(l.place), sh = picShadow(l.shadow);
  if (pic) out.pic = pic;
  if (place) out.place = place;
  if (sh) out.shadow = sh;
  return out;
}
function normPicLayers(b){
  const seen = new Set();
  const src = Array.isArray(b.layers) ? b.layers : typeof b.imageId === 'string' ? [{ kind:'pic', id:'p1', imageId:b.imageId, imgW:b.imgW, imgH:b.imgH, pic:b.pic, place:b.place }] : [];
  return src.map(l => normPicLayer(l, seen)).filter(Boolean);
}
/* Проповедник: имя и фамилия хранятся раздельно (на заставке — «Имя ФАМИЛИЯ»). В списке проповедников — «Фамилия Имя» */
function splitPreacher(s){
  const w = String(s || '').trim().split(/\s+/).filter(Boolean);
  return { lastName:w[0] || '', firstName:w.slice(1).join(' ') };
}
const preacherName = m => [m.firstName, m.lastName].map(x => String(x || '').trim()).filter(Boolean).join(' ');   // «Имя Фамилия»
const preacherKey = m => [m.lastName, m.firstName].map(x => String(x || '').trim()).filter(Boolean).join(' ');    // «Фамилия Имя», как в списке
function blank(){
  return { app:'swp-sermon', v:2, id:uid(), createdAt:Date.now(), updatedAt:Date.now(), savedAt:0,
    meta:{ title:'', date:nextSunday(), firstName:'', lastName:'' },
    settings:{}, blocks:[] };
}
function normItem(it){
  if (!it) return null;
  if (it.kind === 'line') return { kind:'line' };
  if (it.kind === 'text') return { kind:'text', caps:it.caps === true, html:sanitize(it.html), align:['left', 'center', 'right'].includes(it.align) ? it.align : 'center',
    scale:+it.scale > 0 && isFinite(+it.scale) ? Math.round(+it.scale) : 100 };   // размер блока «Текст» в % (этап 10.5.6); обрезка по диапазону — при показе
  if (it.manual || it.kind !== 'scripture'){
    const r = Object.assign(newPart(), it, { kind:'scripture', manual:true });
    r.verses = (Array.isArray(r.verses) && r.verses.length ? r.verses : [{ num:'', text:'' }])
      .map(v => ({ num:String((v && v.num) || ''), text:sanitize(v && v.text) }));
    if (it.mBook == null) splitManualRef(r);
    if (!String(r.ref || '').trim()) r.ref = manualRef(r);
    return r;
  }
  if (!LANGS[it.lang]){   // такого перевода больше нет в списке — сохраняем текст как ручной ввод
    const r = Object.assign(newPart(), { ref:it.ref || '', translation:it.translation || it.trName || '' });
    r.verses = (Array.isArray(it.verses) && it.verses.length ? it.verses : [{ num:'', text:'' }]).map(v => ({ num:String(v.num || ''), text:sanitize(v.text) }));
    splitManualRef(r);
    return r;
  }
  const r = Object.assign(newScripture(it.lang), it, { kind:'scripture', manual:false });
  r.book = +r.book || 0; r.chapter = +r.chapter || 0;
  r.sel = (Array.isArray(r.sel) ? r.sel : []).map(Number).filter(n => n > 0);
  r.verses = (Array.isArray(r.verses) ? r.verses : []).map(v => ({ num:String(v.num || ''), text:sanitize(v.text), orig:String(v.orig || '') }));
  return r;
}
/* Обычный текст (старые блоки «Текст проповеди») → HTML с переносами строк */
const textToHTML = t => sanitize(esc(String(t || '').replace(/\r\n?/g, '\n').trim()).replace(/\n/g, '<br>'));
const joinSpeech = (a, b) => a && b ? a + '<br><br>' + b : (a || b || '');
const oneOf = (v, list, d) => list.includes(v) ? v : d;
/* Любой файл проповеди (старые версии тоже) → нынешняя модель.
   Версия 1: текст проповеди лежал отдельными блоками «Текст проповеди» между слайдами. Теперь он — «Текст к слайду»:
   кусок текста переходит к слайду перед ним; если перед ним слайда нет или в блоке стояла галочка «Здесь вывести заставку» —
   на этом месте появляется слайд-заставка с этим текстом. */
function normalize(d){
  const s = blank();
  s.id = d.id || s.id;
  s.createdAt = d.createdAt || s.createdAt;
  s.updatedAt = d.updatedAt || s.updatedAt;
  s.savedAt = d.savedAt || 0;
  if (d.cloudSpace) Object.assign(s, { cloudSpace:String(d.cloudSpace), cloudAt:+d.cloudAt || 0, cloudOwner:d.cloudOwner == null ? '' : String(d.cloudOwner),
    cloudStatus:d.cloudStatus || 'draft', cloudBy:d.cloudBy || '', cloudShare:typeof d.cloudShare === 'string' ? d.cloudShare : '' });   // метки облака: где лежит проповедь и какую версию форма видела в последний раз
  const dm = d.meta || {};
  s.meta = { title:String(dm.title || ''), date:String(dm.date || '') };
  if (dm.firstName != null || dm.lastName != null) Object.assign(s.meta, { firstName:String(dm.firstName || '').trim(), lastName:String(dm.lastName || '').trim() });
  else Object.assign(s.meta, splitPreacher(dm.preacher));
  // серия и свой формат фона (этап 10): id из таблицы серий и форматов; нет — «Свободная тема» и «По умолчанию»
  if (typeof dm.series === 'string' && dm.series) s.meta.series = dm.series.slice(0, 64);
  if (typeof dm.format === 'string' && dm.format) s.meta.format = dm.format.slice(0, 64);
  s.settings = {};   // лимиты и размер Писания теперь общие (настройки слайдов пространства); у проповеди — перевод и размер заставки
  if (d.settings && typeof d.settings.lang === 'string') s.settings.lang = d.settings.lang;
  // размер названия на заставках (−/+), один на всю проповедь (этап 7.2), в % от размера из настроек слайдов
  if (d.settings && isFinite(+d.settings.splash) && +d.settings.splash > 0) s.settings.splash = Math.round(+d.settings.splash);
  // этап 9.5: режим заставки и нижняя строка — одни на все заставки проповеди (раньше «своя» стояла у отдельной заставки).
  // Этап 10.9.2.1: «Своя заставка» (customSplash) стала режимом «Картинка целиком», добавился «Свой фон» с затемнением
  const sm = d.settings && d.settings.splashMode;
  if (sm === 'bg' || sm === 'full') s.settings.splashMode = sm;
  else if ((d.settings && d.settings.customSplash) || (d.blocks || []).some(b => b && b.type === 'splash' && b.custom)) s.settings.splashMode = 'full';
  if (d.settings && splashDimOk(d.settings.splashDim)) s.settings.splashDim = d.settings.splashDim;
  if (d.settings && typeof d.settings.splashFoot === 'boolean') s.settings.splashFoot = d.settings.splashFoot;
  // этап 10.9.1.1: картинка своей заставки — одна на все заставки; лежит в облаке рядом с конспектом (slideImages), как у блока «Картинка»
  const ci = d.settings && d.settings.customSplashImage, cdim = v => Number.isInteger(v) && v > 0 && v <= 4000;
  if (ci && typeof ci === 'object' && typeof ci.imageId === 'string' && PIC_ID_RE.test(ci.imageId) && cdim(ci.imgW) && cdim(ci.imgH)) s.settings.customSplashImage = { imageId:ci.imageId, imgW:ci.imgW, imgH:ci.imgH };
  let cur = null;   // слайд, к которому относится идущий дальше текст
  (d.blocks || []).forEach(b => {
    if (!b) return;
    if (b.type === 'text'){
      const html = textToHTML(b.text);
      if (b.splash || (!cur && html)){
        const sp = newBlock('splash'); sp.speech = html; sp.collapsed = !!b.collapsed;
        s.blocks.push(sp); cur = sp;
      } else if (cur) cur.speech = joinSpeech(cur.speech, html);
      return;
    }
    if (b.type === 'scripture2') b = Object.assign({}, b, { type:'scripture' });
    if (!TYPES[b.type]) return;
    const T = TYPES[b.type];
    const nb = Object.assign(newBlock(b.type), b);
    if (!nb.id) nb.id = uid();
    nb.collapsed = !!b.collapsed;
    delete nb.done;   // отметки «готово» у слайдов больше нет (этап 7): у старых файлов она только решает, нужна ли «доработать»
    if (T.slide){
      nb.speech = sanitize(b.speech);
      nb.todo = b.todo == null ? !!T.todo && !b.done : !!b.todo;   // старые картинки, видео, свободные: «доработать», если ещё не готовы
    } else { delete nb.speech; delete nb.todo; }
    if (b.type === 'scripture'){
      let items = b.items;
      if (!Array.isArray(items)){   // старые файлы: parts / одно место + «пояснение»
        const parts = Array.isArray(b.parts) ? b.parts : [{ ref:b.ref, translation:b.translation, verses:b.verses, autoFirst:b.autoFirst }];
        items = parts.map(p => Object.assign({ kind:'scripture', manual:true }, p));
        if (b.showNote && b.note) items.push({ kind:'text', html:b.note, align:'center' });
      }
      nb.items = items.map(normItem).filter(Boolean);
      if (!nb.items.length) nb.items = [newScripture('ru')];
      const sp = normSplit(b.split); if (sp) nb.split = sp; else delete nb.split;   // отрывок по слайдам (этап 10.4, passage.js)
      // вид стихов (в строку / с новой строки, рамка, заглавные, перевод, выравнивание) с 7.1 общий для всех слайдов:
      // собственные значения старых слайдов не используются
      ['parts', 'note', 'showNote', 'ref', 'translation', 'verses', 'autoFirst', 'caps', 'flow', 'frame', 'align', 'valign', 'showTr'].forEach(k => delete nb[k]);
    }
    if (b.type === 'thesis' || b.type === 'quote') nb.text = sanitize(nb.text);
    if (b.type === 'thesis'){
      // старые тезисы: один текстовый блок с прежними настройками
      if (!Array.isArray(b.parts) || !b.parts.length)
        nb.parts = [{ kind:'text', html:nb.text || '', align:['left', 'center', 'right'].includes(b.align) ? b.align : 'center', scale:+b.scale || 100, caps:b.caps !== false }];
      nb.parts = nb.parts.map(p => p && p.kind === 'line' ? { kind:'line' }
        : { kind:'text', html:sanitize(p && p.html), align:['left', 'center', 'right'].includes(p && p.align) ? p.align : 'center', scale:+(p && p.scale) || 100, caps:!!(p && p.caps), frame:!!(p && p.frame) });
      nb.scale = 100;
      nb.valign = oneOf(nb.valign, ['top', 'center', 'bottom'], 'center');
      syncThesisText(nb);
    }
    if (b.type === 'quote'){
      // раньше подпись писали в поле автора через запятую: «Жан Кальвин, Наставление»
      // этап 10.5: вместо одного «Автора» — имя и фамилия; у старых цитат фамилия — последнее слово, имя — остальное
      let a = String(b.author || '').trim();
      if (b.caption == null && a.includes(',')){ const i = a.indexOf(','); nb.caption = a.slice(i + 1).trim(); a = a.slice(0, i).trim(); }
      else nb.caption = String(b.caption || '').trim();
      if (typeof b.first === 'string' || typeof b.last === 'string'){ nb.first = String(b.first || ''); nb.last = String(b.last || ''); }
      else { const w = a.split(/\s+/).filter(Boolean); nb.last = w.pop() || ''; nb.first = w.join(' '); }
      delete nb.author;
      nb.photo = normPhoto(b.photo);
      nb.half = oneOf(b.half, ['full', 'left', 'right'], 'full');
      nb.halfW = clampHalfW(b.halfW);
      nb.textBox = normTextBox(b.textBox);   // этап 10.5.5; при «Во всю ширину» хранится, но не применяется
      nb.frame = !!b.frame;
    }
    if (b.type === 'image'){
      // этап 10.9.2: «Найди сам» и «Пришлю отдельно» стали одним режимом «Попросить редактора» (про файл отдельно — в описании)
      nb.mode = b.mode === 'upload' ? 'upload' : 'ask';
      if (b.mode === 'send'){ const d = String(b.desc || '').trim(); nb.desc = d ? 'Файл пришлю отдельно. ' + d : 'Файл пришлю отдельно.'; }
      nb.layers = normPicLayers(b);
      ['imageId', 'imgW', 'imgH', 'pic', 'place'].forEach(k => delete nb[k]);   // до 10.9.2 — одна картинка прямо в блоке
    }
    delete nb.custom;   // перенесено в state.settings.splashMode
    if (NAMED[b.type]) nb.name = cleanName(nb.name);
    if (b.type === 'thesis'){ if (nb.nameAuto == null) nb.nameAuto = !nb.name; if (nb.nameAuto) nb.name = autoName(nb.text); }
    s.blocks.push(nb);
    if (T.slide) cur = nb;
  });
  return s;
}
/* «Текст к слайду»: слова и время */
const WORD_RE = /[0-9A-Za-zА-Яа-яЁёІіЇїЄєҐґÀ-ɏͰ-Ͽἀ-῿֐-׿]+/g;
const wordCount = html => (plain(html || '').match(WORD_RE) || []).length;
function speechInfo(words){
  if (!words) return '';
  const m = words / WORDS_PER_MIN;
  return words + ' ' + plural(words, 'слово', 'слова', 'слов') + ' · ' + (m < 0.75 ? 'меньше минуты' : '≈ ' + Math.max(1, Math.round(m)) + ' мин');
}

/* ========= Общие настройки слайдов (пространства) =========
   Берутся из облака (cloud.js: watchSlides) и действуют на все проповеди сразу. Без входа — последняя копия
   из облака в этом браузере или значения по умолчанию. Пока открыто окно «Настройки слайдов», его пример
   слайда раскладывается с ещё не применёнными значениями (SLIDES_TRY). */
const clampN = (v, a, b, d) => { v = Number(v); return isFinite(v) ? Math.min(b, Math.max(a, Math.round(v))) : d; };
const clampF = (v, a, b, d, k) => { v = Number(v); if (!isFinite(v)) return d; const m = Math.pow(10, k || 2); return Math.round(Math.min(b, Math.max(a, v)) * m) / m; };
let SLIDES_BASE = mergeSlides(SLIDES_DEFAULT, null);
let SLIDES_TRY = null;
let BG_TRY;   // фон примера в окне «Настройки слайдов» (формат, который там правят); undefined — фон проповеди
/* Фон, с которым сейчас рисуются слайды: в примере окна — формат из окна, иначе — фон открытой проповеди (sermonBg) */
function curBg(sermon, cfg){ return BG_TRY !== undefined ? BG_TRY : sermonBg(sermon !== undefined ? sermon : (typeof state !== 'undefined' ? state : null), cfg); }
function mergeSlides(base, over){
  const r = JSON.parse(JSON.stringify(base)), D = SLIDES_DEFAULT;
  const o = over && typeof over === 'object' ? over : {};
  const obj = x => x && typeof x === 'object' ? x : {};
  ['margins', 'names', 'limits', 'fonts', 'verses'].forEach(k => Object.assign(r[k], obj(o[k])));
  Object.keys(D.kinds).forEach(k => Object.assign(r.kinds[k], obj(obj(o.kinds)[k])));
  ['side', 'top', 'bottom'].forEach(k => { r.margins[k] = clampN(r.margins[k], 0, 400, D.margins[k]); });
  r.names = { maxLength:clampN(r.names.maxLength, 5, 120, D.names.maxLength) };
  r.limits = { thesis:clampN(r.limits.thesis, 20, 3000, D.limits.thesis), quote:clampN(r.limits.quote, 20, 3000, D.limits.quote) };
  Object.keys(SLIDE_FONTS).forEach(k => { if (!SLIDE_FONTS[k][r.fonts[k]]) r.fonts[k] = D.fonts[k]; });
  r.fonts = { main:r.fonts.main, greek:r.fonts.greek, hebrew:r.fonts.hebrew };
  Object.keys(D.kinds).forEach(k => {
    const z = r.kinds[k], d = D.kinds[k], out = {};
    out.size = clampF(z.size, 10, 400, d.size);
    out.min = clampN(z.min, 20, 100, d.min);
    if ('max' in d) out.max = clampN(z.max, 100, 200, d.max);
    if ('track' in d) out.track = clampF(z.track, -0.2, 0.3, d.track, 3);
    if ('lead' in d) out.lead = clampF(z.lead, 0.8, 2, d.lead);
    if ('foot' in d) out.foot = clampF(z.foot, 10, 200, d.foot);
    if ('footTrack' in d) out.footTrack = clampF(z.footTrack, -0.2, 0.3, d.footTrack, 3);
    if ('footLead' in d) out.footLead = clampF(z.footLead, 0.8, 2, d.footLead);
    if ('titleOnly' in d) out.titleOnly = !!z.titleOnly;
    r.kinds[k] = out;
  });
  const v = r.verses;
  r.verses = { flow:oneOf(v.flow, ['inline', 'lines'], 'inline'), frame:!!v.frame, caps:v.caps !== false, showTr:v.showTr !== false,
    align:oneOf(v.align, ['left', 'center', 'right'], 'center'), valign:oneOf(v.valign, ['top', 'center', 'bottom'], 'top'),
    gap:clampF(v.gap, 0, 2, D.verses.gap), refGap:clampF(v.refGap, 0, 3, D.verses.refGap) };
  // форматы фона (этап 7.5, background.js): документ этапа 7.3 без форматов, но с фоном bg — фон становится форматом «Фон пространства»
  const fm = normFormats('formats' in o ? o : 'bg' in o ? { bg:o.bg } : r);
  delete r.bg;
  r.formats = fm.formats; r.defaultFormat = fm.defaultFormat;
  r.panels = normPanels('panels' in o ? o.panels : r.panels);
  // кто выбирает фон проповеди вручную (этап 10.1.3); прежнее «Выбирать формат фона в проповеди» (pickFormat, этап 10) — обе роли
  const pr = Array.isArray(o.pickRoles) ? o.pickRoles : o.pickFormat === true ? BG_ROLES : 'pickFormat' in o ? [] : r.pickRoles;
  r.pickRoles = BG_ROLES.filter(k => Array.isArray(pr) && pr.includes(k));
  delete r.pickFormat;
  return r;
}
/* Порядок панелей: ровно те три, каждая один раз; иначе — по умолчанию (этап 7.4) */
function normPanels(p){
  const keys = SLIDES_DEFAULT.panels;
  return Array.isArray(p) && p.length === keys.length && keys.every(k => p.includes(k)) ? p.slice() : keys.slice();
}
function slidesCfg(){ return SLIDES_TRY || SLIDES_BASE; }
/* Новые настройки из облака (или из кеша): применить и перерисовать слайды */
function setSlidesBase(over){
  const next = mergeSlides(SLIDES_DEFAULT, over);
  const same = JSON.stringify(next) === JSON.stringify(SLIDES_BASE);
  SLIDES_BASE = next; applySlides();
  return !same;
}
/* CSS-переменные слайда: поля, шрифты, расстояния между символами и строками по видам слайдов, фон (bg — из curBg) */
function slideVars(c, bg){
  const m = c.margins, K = c.kinds, F = c.fonts;
  return { '--sl-x':(PANEL_INSET + m.side) + 'px', '--sl-t':(PANEL_INSET + m.top) + 'px', '--sl-b':(PANEL_INSET + m.bottom) + 'px',
    '--f-main':SLIDE_FONTS.main[F.main].css, '--f-greek':SLIDE_FONTS.greek[F.greek].css, '--f-hebrew':SLIDE_FONTS.hebrew[F.hebrew].css,
    '--sc-track':K.scripture.track + 'em', '--sc-lead':String(K.scripture.lead),
    '--st-track':K.scrText.track + 'em', '--st-lead':String(K.scrText.lead),
    '--th-track':K.thesis.track + 'em', '--th-lead':String(K.thesis.lead),
    '--qt-track':K.quote.track + 'em', '--qt-lead':String(K.quote.lead),
    '--sc-gap':c.verses.refGap + 'em', '--sc-vgap':c.verses.gap + 'em',
    '--sp-track':K.splash.track + 'em', '--sp-lead':String(K.splash.lead),
    '--sp-foot':K.splash.foot + 'px', '--sp-ftrack':K.splash.footTrack + 'em', '--sp-flead':String(K.splash.footLead),
    ...bgVars(bg === undefined ? curBg(undefined, c) : bg) };   // фон слайда (background.js)
}
function marginVars(m){ return { '--sl-x':(PANEL_INSET + m.side) + 'px', '--sl-t':(PANEL_INSET + m.top) + 'px', '--sl-b':(PANEL_INSET + m.bottom) + 'px' }; }
function applySlides(){
  const v = slideVars(SLIDES_BASE);
  Object.keys(v).forEach(k => document.documentElement.style.setProperty(k, v[k]));
}
/* Слайды, у которых обязательное название не заполнено */
function missingNames(){
  return state.blocks.filter(b => NAMED[b.type] && !cleanName(b.name));
}
let flagMissing = false;   // подсвечивать пустые названия красным — после первой неудачной попытки
function checkNames(){
  const miss = missingNames(); if (!miss.length) return true;
  flagMissing = true;
  const nums = slideNums();
  selId = miss[0].id;
  if (screen === 'sermon' && view === 'slides') renderMain(); else navigate(sermonHash(state.id));
  setTimeout(() => {   // после перерисовки ставим курсор в пустое название
    const f = sideEl && sideEl.querySelector('.namebox input');
    if (f) f.focus({ preventScroll:true });
  }, 80);
  toast('Напишите названия слайдов: ' + miss.map(b => nums[b.id]).join(', '));
  return false;
}

