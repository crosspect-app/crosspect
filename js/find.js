'use strict';

/* ========= Найти и заменить в конспекте (этап 9.6) =========
   Ctrl+F на экране «Слайды» открывает строку поиска по всему конспекту: тексты слайдов, текст к слайду, названия, описания, заметки.
   Совпадение — переход к слайду и подсветка в поле (CSS Custom Highlight, если браузер умеет). «Заменить» и «Заменить все» — только в правке;
   «Заменить все» — один шаг отмены (history.js). В оформленных полях ищется внутри одного оформления: «Бог <b>любит</b>» целиком не найдётся.
   Неразрывный пробел ищется как обычный. В виде «Текст» Ctrl+F работает как в браузере. */
const FIND = { q:'', rep:'', cs:false, hits:[], cur:-1, bar:null };

/* Поля слайда, в которых ищем: key — как у поля в форме (data-key), html — оформленный текст или простая строка */
function findFields(b){
  const f = [], T = TYPES[b.type];
  const html = (key, label, get, set) => f.push({ key, label, html:true, get, set });
  const text = (key, label, get, set) => f.push({ key, label, html:false, get, set });
  switch (b.type){
    case 'scripture':
      (b.items || []).forEach((it, pi) => {
        if (it.kind === 'text') html(b.id + ':' + pi + ':t', 'Текст на слайде', () => it.html || '', v => { it.html = v; });
        else if (it.kind === 'scripture') (it.verses || []).forEach((v, vi) => html(b.id + ':' + pi + ':' + vi, 'Стихи', () => v.text || '', x => { v.text = x; }));
      });
      break;
    case 'thesis':
      (b.parts || []).forEach((p, i) => { if (p.kind === 'text') html(b.id + ':p' + i, 'Текст на слайде', () => p.html || '', v => { p.html = v; syncThesisText(b); syncAutoName(b); }); });
      break;
    case 'quote':
      html(b.id + ':t', 'Текст цитаты', () => b.text || '', v => { b.text = v; });
      text(b.id + ':author', 'Автор цитаты', () => b.author || '', v => { b.author = v; });
      text(b.id + ':caption', 'Подпись цитаты', () => b.caption || '', v => { b.caption = v; });
      break;
    case 'image': case 'video': case 'free':
      text(b.id + ':name', 'Название слайда', () => b.name || '', v => { b.name = cleanName(v); });
      text(b.id + ':desc', 'Описание', () => b.desc || '', v => { b.desc = v; });
      break;
    case 'note':
      text(b.id + ':note', 'Заметка оператору', () => b.text || '', v => { b.text = v; });
      break;
  }
  if (T && T.slide) html(b.id + ':speech', 'Текст к слайду', () => b.speech || '', v => { b.speech = v; });
  return f;
}
const findEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function findRe(){
  if (!FIND.q) return null;
  return new RegExp(findEsc(FIND.q).replace(/ /g, '[ \\u00a0]'), FIND.cs ? 'g' : 'gi');
}
/* Непустые текстовые узлы оформленного текста */
function findTextNodes(root){
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), ns = []; let n;
  while ((n = w.nextNode())) if (n.nodeValue) ns.push(n);
  return ns;
}
const findParse = html => { const t = document.createElement('template'); t.innerHTML = String(html || ''); return t; };
const ordLess = (a, b) => { for (let i = 0; i < a.length; i++){ if (a[i] !== b[i]) return a[i] < b[i]; } return false; };

/* Все совпадения по порядку слайдов и полей. ord — положение для сравнения (слайд, поле, узел, символ) */
function findAll(){
  const re = findRe(), out = [];
  if (!re || !state) return out;
  state.blocks.forEach((b, bi) => findFields(b).forEach((fd, fi) => {
    let n = 0;
    const scan = (str, ni) => { re.lastIndex = 0; let m; while ((m = re.exec(str))){ out.push({ id:b.id, fd, bi, fi, ni, n:n++, at:m.index, len:m[0].length, ord:[bi, fi, ni, m.index] }); if (!m[0].length) re.lastIndex++; } };
    if (fd.html) findTextNodes(findParse(fd.get()).content).forEach((tn, ni) => scan(tn.nodeValue, ni));
    else scan(fd.get(), 0);
  }));
  return out;
}
/* Заменить совпадения в поле: only — номер совпадения в поле (n), иначе все. Возвращает число замен */
function findReplaceIn(fd, only){
  const re = findRe(), rep = FIND.rep; if (!re) return 0;
  let n = 0, done = 0;
  const sub = str => str.replace(re, m => { const k = n++; if (only != null && k !== only) return m; done++; return rep; });
  if (fd.html){
    const t = findParse(fd.get());
    findTextNodes(t.content).forEach(tn => { tn.nodeValue = sub(tn.nodeValue); });
    if (done) fd.set(sanitize(t.innerHTML));
  } else {
    const v = sub(fd.get());
    if (done) fd.set(v);
  }
  return done;
}

/* ----- Подсветка и переход ----- */
function findClearMark(){ try { if (window.CSS && CSS.highlights) CSS.highlights.delete('fr-cur'); } catch(e){} }
function findShow(hit){
  findClearMark();
  const mainEl_ = document.querySelector('main') || document.body;
  if (hit.fd.label === 'Текст к слайду' && !speechOpen){   // свёрнутый текст к слайду: развернуть, чтобы совпадение было видно
    const tg = mainEl_.querySelector('.speech-head .btn'); if (tg) tg.click();
  }
  const el = mainEl_.querySelector('[data-key="' + hit.fd.key + '"]');
  if (!el){ return; }
  el.scrollIntoView({ block:'nearest', inline:'nearest' });
  if (!hit.fd.html || !(window.CSS && CSS.highlights && window.Highlight)) return;
  const tn = findTextNodes(el)[hit.ni]; if (!tn || tn.nodeValue.length < hit.at + hit.len) return;
  const r = document.createRange(); r.setStart(tn, hit.at); r.setEnd(tn, hit.at + hit.len);
  try { CSS.highlights.set('fr-cur', new Highlight(r)); } catch(e){}
}
function findGo(i){
  const n = FIND.hits.length;
  if (!n){ FIND.cur = -1; findPaint(); return; }
  FIND.cur = ((i % n) + n) % n;
  const hit = FIND.hits[FIND.cur];
  if (hit.id !== selId) selectBlock(hit.id);
  findPaint();
  requestAnimationFrame(() => findShow(hit));
}
function findRefresh(keepCur){
  FIND.q = FIND.bar.querySelector('.fb-q').value;
  FIND.hits = findAll();
  FIND.cur = FIND.hits.length ? Math.min(Math.max(keepCur ? FIND.cur : 0, 0), FIND.hits.length - 1) : -1;
  findPaint();
}
function findPaint(){
  const b = FIND.bar; if (!b) return;
  const c = b.querySelector('.fb-count'), n = FIND.hits.length;
  c.textContent = !FIND.q ? '' : n ? (FIND.cur + 1) + ' из ' + n + ' · ' + FIND.hits[FIND.cur].fd.label : 'Не найдено';
  c.classList.toggle('none', !!FIND.q && !n);
  b.querySelectorAll('.fb-prev, .fb-next').forEach(x => { x.disabled = !n; });
  const can = !readOnly();
  b.classList.toggle('ro', !can);
  const one = b.querySelector('.fb-one'), all = b.querySelector('.fb-all');
  if (one) one.disabled = !can || !n;
  if (all) all.disabled = !can || !n;
}

/* ----- Замена ----- */
function findAfterChange(){
  hist.key = null;   // каждая замена — отдельный шаг отмены, а не продолжение набора
  syncFilm(); syncStage();
  const cur = curBlock(); if (cur) rerender(cur);
}
function findReplaceOne(){
  if (readOnly() || FIND.cur < 0) return;
  const hit = FIND.hits[FIND.cur]; if (!hit) return;
  if (!findReplaceIn(hit.fd, hit.n)) return;
  change(); findAfterChange();
  const after = [hit.bi, hit.fi, hit.ni, hit.at + FIND.rep.length];   // следующее совпадение — правее заменённого, чтобы замена не зацикливалась на себе
  FIND.hits = findAll();
  const next = FIND.hits.findIndex(x => ordLess(after, x.ord) || String(after) === String(x.ord));
  findGo(FIND.hits.length ? (next < 0 ? 0 : next) : -1);
}
function findReplaceAll(){
  if (readOnly() || !FIND.hits.length) return;
  let total = 0;
  const seen = new Set();   // одно поле — один раз, даже если в нём несколько совпадений
  FIND.hits.forEach(h => { if (seen.has(h.fd.key)) return; seen.add(h.fd.key); total += findReplaceIn(h.fd, null); });
  if (!total) return;
  change(); findAfterChange();   // одна правка — один шаг отмены
  toast('Заменено: ' + total + ' ' + plural(total, 'раз', 'раза', 'раз'));
  FIND.hits = findAll(); FIND.cur = FIND.hits.length ? 0 : -1;
  findPaint();
}

/* ----- Строка поиска ----- */
const findAvail = () => screen === 'sermon' && view === 'slides' && !!state && state.blocks.length > 0;
function findBuild(){
  const q = h('input', { class:'input fb-q', type:'search', placeholder:'Найти в конспекте', 'aria-label':'Найти', autocomplete:'off', spellcheck:'false', value:FIND.q });
  const rep = h('input', { class:'input fb-r', placeholder:'Заменить на', 'aria-label':'Заменить на', autocomplete:'off', spellcheck:'false', value:FIND.rep });
  const cs = h('button', { type:'button', class:'btn ghost small fb-cs' + (FIND.cs ? ' on' : ''), title:'Учитывать регистр', 'aria-pressed':String(FIND.cs), text:'Aa',
    onclick:() => { FIND.cs = !FIND.cs; cs.classList.toggle('on', FIND.cs); cs.setAttribute('aria-pressed', String(FIND.cs)); findRefresh(false); if (FIND.hits.length) findGo(0); } });
  const bar = h('div', { class:'findbar', role:'search', 'aria-label':'Найти и заменить' },
    h('div', { class:'fb-row' }, q, h('span', { class:'fb-count', 'aria-live':'polite' }),
      iconBtn('up', 'Предыдущее (Shift+Enter)', () => { findRefresh(true); findGo(FIND.cur - 1); }, 'fb-prev'),
      iconBtn('down', 'Следующее (Enter)', () => { findRefresh(true); findGo(FIND.cur + 1); }, 'fb-next'),
      cs, iconBtn('close', 'Закрыть (Esc)', () => findClose())),
    h('div', { class:'fb-row fb-rep' }, rep,
      h('button', { type:'button', class:'btn small fb-one', onclick:() => findReplaceOne() }, 'Заменить'),
      h('button', { type:'button', class:'btn small fb-all', title:'Заменить везде одним шагом: отменить можно одним Ctrl+Z', onclick:() => findReplaceAll() }, 'Заменить все')));
  q.addEventListener('input', () => { findRefresh(false); if (FIND.hits.length) findGo(0); });
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); findRefresh(true); findGo(FIND.cur + (e.shiftKey ? -1 : 1)); }
  });
  rep.addEventListener('input', () => { FIND.rep = rep.value; });
  rep.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); findReplaceOne(); } });
  bar.addEventListener('keydown', e => { if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); findClose(); } });
  return bar;
}
function findOpen(){
  if (!findAvail()) return;
  const sel = String(window.getSelection ? window.getSelection() : '').trim();
  if (!FIND.bar){ FIND.bar = findBuild(); document.body.append(FIND.bar); }
  if (sel && sel.length < 80 && !/\n/.test(sel)) FIND.bar.querySelector('.fb-q').value = sel;
  findRefresh(false);
  const q = FIND.bar.querySelector('.fb-q'); q.focus(); q.select();
}
function findClose(){
  if (!FIND.bar) return;
  findClearMark();
  FIND.q = FIND.bar.querySelector('.fb-q').value;
  FIND.bar.remove(); FIND.bar = null; FIND.hits = []; FIND.cur = -1;
}
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || (e.key || '').toLowerCase() !== 'f') return;
  if (settingsOverlay.classList.contains('open') || sheetOverlay.classList.contains('open')) return;
  if (!findAvail()) return;   // «Текст», главная и другие экраны — поиск браузера
  e.preventDefault();
  findOpen();
});
window.addEventListener('hashchange', () => { if (FIND.bar && !findAvail()) findClose(); });
