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
function newTextItem(){ return { kind:'text', html:'', align:'center', caps:true }; }
function newLineItem(){ return { kind:'line' }; }
function newThesisPart(){ return { kind:'text', html:'', align:'center', scale:100, caps:true, frame:false }; }
/* Текст всех частей тезиса одной строкой с переносами — для названия, счётчика, просмотра и PDF */
function syncThesisText(b){ b.text = b.parts.filter(p => p.kind === 'text' && plain(p.html).trim()).map(p => p.html).join('<br>'); }
/* У каждого слайда есть «Текст к слайду» (speech, HTML): что проповедник говорит, пока слайд на экране.
   todo — отметка «доработать» для того, кто готовит слайды; картинка, видео и свободный слайд получают её сами */
/* Ширина области текста у цитаты «слева / справа», % ширины слайда (этап 9.5): 30–80, по умолчанию 50 */
const HALF_W = { min:30, max:80, step:5, dflt:50 };
function clampHalfW(v){ v = v == null || v === '' ? NaN : Math.round(+v); return isFinite(v) ? Math.min(HALF_W.max, Math.max(HALF_W.min, v)) : HALF_W.dflt; }
/* «Своя заставка» (этап 9.5): одна на все заставки проповеди (state.settings.customSplash). В архив JPEG не идёт, в PowerPoint — чёрный слайд */
const isCustomSplash = b => !!b && b.type === 'splash' && !!(state && state.settings && state.settings.customSplash);
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
    case 'quote':      return Object.assign({ id, type, text:'', author:'', caption:'', scale:100, caps:false, half:'full', halfW:50, frame:false }, slide);   // frame — обводка текста пунктиром (этап 9.5)   // half: «Во всю ширину» / текст слева / текст справа (этап 9.3); halfW — ширина области текста при «слева / справа», % слайда (этап 9.5)
    case 'image':      return Object.assign({ id, type, name:'', mode:'find', desc:'' }, slide);
    case 'video':      return Object.assign({ id, type, name:'', mode:'link', url:'', from:'', to:'', desc:'' }, slide);
    case 'free':       return Object.assign({ id, type, name:'', desc:'' }, slide);
    case 'note':       return { id, type, text:'' };
  }
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
  if (it.kind === 'text') return { kind:'text', caps:it.caps === true, html:sanitize(it.html), align:['left', 'center', 'right'].includes(it.align) ? it.align : 'center' };
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
  // этап 9.5: «своя заставка» и нижняя строка — тоже одни на все заставки проповеди (раньше «своя» стояла у отдельной заставки)
  if ((d.settings && d.settings.customSplash) || (d.blocks || []).some(b => b && b.type === 'splash' && b.custom)) s.settings.customSplash = true;
  if (d.settings && typeof d.settings.splashFoot === 'boolean') s.settings.splashFoot = d.settings.splashFoot;
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
      const a = String(b.author || '').trim();
      if (b.caption == null && a.includes(',')){ const i = a.indexOf(','); nb.author = a.slice(0, i).trim(); nb.caption = a.slice(i + 1).trim(); }
      else { nb.author = a; nb.caption = String(b.caption || '').trim(); }
      nb.half = oneOf(b.half, ['full', 'left', 'right'], 'full');
      nb.halfW = clampHalfW(b.halfW);
      nb.frame = !!b.frame;
    }
    delete nb.custom;   // перенесено в state.settings.customSplash
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
  r.pickFormat = o.pickFormat === true || (!('pickFormat' in o) && r.pickFormat === true);   // «Выбирать формат фона в проповеди» (этап 10)
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

