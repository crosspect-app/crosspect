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
function newThesisPart(){ return { kind:'text', html:'', align:'center', scale:100, caps:true }; }
/* Текст всех частей тезиса одной строкой с переносами — для названия, счётчика, просмотра и PDF */
function syncThesisText(b){ b.text = b.parts.filter(p => p.kind === 'text' && plain(p.html).trim()).map(p => p.html).join('<br>'); }
function newBlock(type){
  const id = uid();
  switch (type){
    case 'scripture':  return { id, type, items:[newScripture()] };
    case 'thesis':     return { id, type, name:'', nameAuto:true, text:'', valign:'center', scale:100, parts:[newThesisPart()] };
    case 'quote':      return { id, type, text:'', author:'', scale:100, caps:false };
    case 'image':      return { id, type, name:'', mode:'find', desc:'' };
    case 'video':      return { id, type, name:'', mode:'link', url:'', from:'', to:'', desc:'' };
    case 'free':       return { id, type, name:'', desc:'' };
    case 'text':       return { id, type, text:'', splash:false };
    case 'note':       return { id, type, text:'' };
  }
}
function blank(){
  return { app:'swp-sermon', v:1, id:uid(), createdAt:Date.now(), updatedAt:Date.now(), savedAt:0,
    meta:{ title:'', date:nextSunday(), preacher:'' },
    settings:Object.assign({}, DEFAULT_SETTINGS), blocks:[] };
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
function normalize(d){
  const s = blank();
  s.id = d.id || s.id;
  s.createdAt = d.createdAt || s.createdAt;
  s.updatedAt = d.updatedAt || s.updatedAt;
  s.savedAt = d.savedAt || 0;
  s.meta = Object.assign({ title:'', date:'', preacher:'' }, d.meta || {});
  s.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings || {});
  (d.blocks || []).forEach(b => {
    if (!b) return;
    if (b.type === 'scripture2') b = Object.assign({}, b, { type:'scripture' });
    if (!TYPES[b.type]) return;
    const nb = Object.assign(newBlock(b.type), b);
    if (!nb.id) nb.id = uid();
    nb.collapsed = !!b.collapsed;
    nb.done = !!b.done && TYPES[b.type].slide;
    if (b.type === 'scripture'){
      let items = b.items;
      if (!Array.isArray(items)){   // старые файлы: parts / одно место + «пояснение»
        const parts = Array.isArray(b.parts) ? b.parts : [{ ref:b.ref, translation:b.translation, verses:b.verses, autoFirst:b.autoFirst }];
        items = parts.map(p => Object.assign({ kind:'scripture', manual:true }, p));
        if (b.showNote && b.note) items.push({ kind:'text', html:b.note, align:'center' });
      }
      nb.items = items.map(normItem).filter(Boolean);
      if (!nb.items.length) nb.items = [newScripture('ru')];
      ['parts', 'note', 'showNote', 'ref', 'translation', 'verses', 'autoFirst'].forEach(k => delete nb[k]);
    }
    if (b.type === 'thesis' || b.type === 'quote') nb.text = sanitize(nb.text);
    if (b.type === 'thesis'){
      // старые тезисы: один текстовый блок с прежними настройками
      if (!Array.isArray(b.parts) || !b.parts.length)
        nb.parts = [{ kind:'text', html:nb.text || '', align:['left', 'center', 'right'].includes(b.align) ? b.align : 'center', scale:+b.scale || 100, caps:b.caps !== false }];
      nb.parts = nb.parts.map(p => p && p.kind === 'line' ? { kind:'line' }
        : { kind:'text', html:sanitize(p && p.html), align:['left', 'center', 'right'].includes(p && p.align) ? p.align : 'center', scale:+(p && p.scale) || 100, caps:!!(p && p.caps) });
      nb.scale = 100;
      syncThesisText(nb);
    }
    if (NAMED[b.type]) nb.name = cleanName(nb.name);
    if (b.type === 'thesis'){ if (nb.nameAuto == null) nb.nameAuto = !nb.name; if (nb.nameAuto) nb.name = autoName(nb.text); }
    s.blocks.push(nb);
  });
  return s;
}

/* ========= Общие настройки слайдов: поля и названия ========= */
let SLIDES_BASE = JSON.parse(JSON.stringify(SLIDES_DEFAULT));   // из config.json (или встроенные)
const clampN = (v, a, b, d) => { v = Number(v); return isFinite(v) ? Math.min(b, Math.max(a, Math.round(v))) : d; };
function mergeSlides(base, over){
  const r = JSON.parse(JSON.stringify(base));
  if (over && typeof over === 'object'){
    ['margins', 'names', 'font'].forEach(k => { if (over[k] && typeof over[k] === 'object') Object.assign(r[k], over[k]); });
    if (over.sizes && typeof over.sizes === 'object') ['scripture', 'thesis', 'quote'].forEach(k => { if (over.sizes[k] && typeof over.sizes[k] === 'object') Object.assign(r.sizes[k], over.sizes[k]); });
  }
  r.margins.side = clampN(r.margins.side, 0, 400, 60); r.margins.top = clampN(r.margins.top, 0, 400, 60); r.margins.bottom = clampN(r.margins.bottom, 0, 400, 60);
  r.names.required = r.names.required !== false; r.names.maxLength = clampN(r.names.maxLength, 5, 120, 35);
  ['thesis', 'quote'].forEach(k => { const z = r.sizes[k]; z.min = clampN(z.min, 30, 100, 70); z.max = clampN(z.max, 100, 200, 110); });
  r.sizes.scripture = { size:clampN(r.sizes.scripture && r.sizes.scripture.size, 50, 200, 100) };
  r.font = { canva:['verses', 'all'].includes(r.font && r.font.canva) ? r.font.canva : 'off' };
  return r;
}
function slidesLocal(){ try { return JSON.parse(LS.get('swp-slides-local') || 'null'); } catch(e){ return null; } }
function slidesCfg(){ return mergeSlides(SLIDES_BASE, slidesLocal()); }
function marginVars(m){ return { '--sl-x':(PANEL_INSET + m.side) + 'px', '--sl-t':(PANEL_INSET + m.top) + 'px', '--sl-b':(PANEL_INSET + m.bottom) + 'px' }; }
function applySlides(){
  const v = marginVars(slidesCfg().margins);
  Object.keys(v).forEach(k => document.documentElement.style.setProperty(k, v[k]));
}
/* Слайды, у которых обязательное название не заполнено */
function missingNames(){
  if (!slidesCfg().names.required) return [];
  return state.blocks.filter(b => NAMED[b.type] && !cleanName(b.name));
}
let flagMissing = false;   // подсвечивать пустые названия красным — после первой неудачной попытки
function checkNames(){
  const miss = missingNames(); if (!miss.length) return true;
  flagMissing = true;
  const nums = slideNums();
  if (mode !== 'edit'){ mode = 'edit'; LS.set('swp-mode', 'edit'); }
  miss.forEach(b => { b.collapsed = false; });
  renderMain();
  const card = document.querySelector('.block[data-id="' + miss[0].id + '"]');
  if (card){ card.scrollIntoView({ block:'center', behavior:'smooth' }); const f = card.querySelector('.namebox input'); if (f) f.focus({ preventScroll:true }); }
  toast('Напишите названия слайдов: ' + miss.map(b => nums[b.id]).join(', '));
  return false;
}

