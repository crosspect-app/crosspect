'use strict';

/* ========= Раскладка экрана «Слайды» (этап 7.2) =========
   Лента, слайд и боковая панель. Границы между ними можно тянуть (соседняя панель сужается), панели — менять местами,
   перетащив за заголовок. Раскладка запоминается у человека: в облаке (people/{почта}/prefs/screen, одинаково на всех
   компьютерах), без входа — в этом браузере. «⋯ → Сбросить настройки экрана» — как было.
   На узком экране (≤ 1100 px) тянуть и менять местами нельзя: раскладка как раньше, из CSS. */
const LAYOUT_DEFAULT = { order:['film', 'stage', 'side'], film:214, side:400 };
const LAY_MIN = { film:150, side:300, stage:380 }, LAY_MAX = { film:420, side:680 };
const LAYOUT_SAVE_MS = 1500;
const wideScreen = () => window.matchMedia('(min-width:1101px)').matches;
function normLayout(o){
  o = o && typeof o === 'object' ? o : {};
  const keys = LAYOUT_DEFAULT.order;
  const order = Array.isArray(o.order) && o.order.length === 3 && keys.every(k => o.order.includes(k)) ? o.order.slice() : keys.slice();
  const w = (k) => { const v = Math.round(+o[k]); return isFinite(v) && v > 0 ? Math.min(LAY_MAX[k], Math.max(LAY_MIN[k], v)) : LAYOUT_DEFAULT[k]; };
  return { order, film:w('film'), side:w('side') };
}
let layout = (() => { try { return normLayout(JSON.parse(LS.get('swp-layout') || 'null')); } catch(e){ return normLayout(null); } })();
let layoutTimer = null;
const isDefaultLayout = l => JSON.stringify(l) === JSON.stringify(normLayout(null));

/* Раскладка из облака (после входа) или сброс */
function setLayout(o){
  layout = normLayout(o);
  LS.set('swp-layout', JSON.stringify(layout));
  applyLayout();
}
function saveLayout(){
  LS.set('swp-layout', JSON.stringify(layout));
  clearTimeout(layoutTimer);
  if (!cloudOn() || !cloud.api.setPrefs) return;
  const who = cloud.user;
  layoutTimer = setTimeout(() => { cloud.api.setPrefs(who, isDefaultLayout(layout) ? {} : layout).catch(() => {}); }, LAYOUT_SAVE_MS);   // запас базы общий: пишем после паузы
}
async function loadLayoutPrefs(){
  if (!cloudOn() || !cloud.api.getPrefs) return;
  try { const l = await cloud.api.getPrefs(cloud.user); if (l) setLayout(l); } catch(e){}   // нет связи — остаётся копия из браузера
}
function resetLayout(){
  setLayout(null);
  clearTimeout(layoutTimer);
  if (cloudOn() && cloud.api.setPrefs) cloud.api.setPrefs(cloud.user, {}).catch(() => {});
  toast('Экран — как по умолчанию');
}

const panelKey = el => el.classList.contains('film') ? 'film' : el.classList.contains('stage') ? 'stage' : 'side';
/* Поставить ширину и порядок панелей на экран «Слайды» */
function applyLayout(){
  const sv = mainEl.querySelector('.sv');
  if (!sv) return;
  const panels = [filmEl, stageEl, sideEl].filter(Boolean);
  if (!wideScreen() || panels.length < 3){
    sv.classList.remove('lay'); sv.style.gridTemplateColumns = '';
    panels.forEach(p => { p.style.order = ''; });
    sv.querySelectorAll('.sv-resize').forEach(x => x.remove());
    return;
  }
  sv.classList.add('lay');
  sv.style.gridTemplateColumns = layout.order.map(k => k === 'stage' ? 'minmax(0,1fr)' : layout[k] + 'px').join(' ');
  panels.forEach(p => { p.style.order = String(layout.order.indexOf(panelKey(p))); });
  if (!sv.querySelector('.sv-resize')) [0, 1].forEach(i => sv.append(h('div', { class:'sv-resize', 'data-i':String(i), role:'separator', 'aria-orientation':'vertical',
    title:'Потяните, чтобы изменить ширину' })));
  placeHandles(sv);
}
function placeHandles(sv){
  const left = sv.getBoundingClientRect().left;
  const byOrder = layout.order.map(k => ({ film:filmEl, stage:stageEl, side:sideEl })[k]);
  sv.querySelectorAll('.sv-resize').forEach(hd => {
    const p = byOrder[+hd.dataset.i]; if (!p) return;
    hd.style.left = (p.getBoundingClientRect().right - left) + 'px';
  });
}
window.addEventListener('resize', () => { if (inSlides()) applyLayout(); });

/* ----- Тянуть границу ----- */
mainEl.addEventListener('pointerdown', e => {
  const hd = e.target.closest && e.target.closest('.sv-resize'); if (!hd || e.button > 0) return;
  e.preventDefault();
  const sv = hd.closest('.sv'), i = +hd.dataset.i, a = layout.order[i], b = layout.order[i + 1];
  const x0 = e.clientX, w0 = { film:layout.film, side:layout.side }, total = sv.clientWidth;
  hd.setPointerCapture(e.pointerId); sv.classList.add('resizing');
  const move = ev => {
    const dx = ev.clientX - x0, next = { film:w0.film, side:w0.side };
    if (a !== 'stage') next[a] = w0[a] + dx;
    if (b !== 'stage') next[b] = w0[b] - dx;
    ['film', 'side'].forEach(k => { next[k] = Math.min(LAY_MAX[k], Math.max(LAY_MIN[k], Math.round(next[k]))); });
    if (a !== 'stage' && b !== 'stage'){ const sum = w0[a] + w0[b]; if (next[a] + next[b] !== sum){ if (next[a] === LAY_MIN[a] || next[a] === LAY_MAX[a]) next[b] = sum - next[a]; else next[a] = sum - next[b]; } }
    const room = total - LAY_MIN.stage;   // слайду в середине остаётся место
    if (next.film + next.side > room){ const k = a === 'stage' ? b : a; next[k] = Math.max(LAY_MIN[k], room - next[k === 'film' ? 'side' : 'film']); }
    layout.film = next.film; layout.side = next.side;
    applyLayout();
  };
  const up = () => {
    hd.removeEventListener('pointermove', move); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up);
    sv.classList.remove('resizing');
    saveLayout();
    state.blocks.forEach(x => { if (PREVIEW[x.type]) schedulePreview(x); });
  };
  hd.addEventListener('pointermove', move); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
});
mainEl.addEventListener('dblclick', e => { if (e.target.closest && e.target.closest('.sv-resize')) resetLayout(); });

/* ----- Поменять панели местами: перетащить за заголовок ----- */
const PANEL_HEAD = '.film-head, .stage-bar, .side-head';
mainEl.addEventListener('pointerdown', e => {
  const head = e.target.closest && e.target.closest(PANEL_HEAD);
  if (!head || e.button > 0 || !wideScreen() || e.target.closest('button, a, input, select, label, .stepper')) return;
  const sv = head.closest('.sv.lay'); if (!sv) return;
  const src = head.closest('.film, .stage, .side'); if (!src) return;
  const x0 = e.clientX, y0 = e.clientY;
  let on = false, target = null;
  const move = ev => {
    if (!on){ if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return; on = true; sv.classList.add('swapping'); src.classList.add('panel-drag'); }
    ev.preventDefault();
    const el = document.elementFromPoint(ev.clientX, ev.clientY), p = el && el.closest('.sv > .film, .sv > .stage, .sv > .side');
    target = p && p !== src ? p : null;
    sv.querySelectorAll('.panel-drop').forEach(x => { if (x !== target) x.classList.remove('panel-drop'); });
    if (target) target.classList.add('panel-drop');
  };
  const up = () => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
    sv.classList.remove('swapping'); src.classList.remove('panel-drag');
    sv.querySelectorAll('.panel-drop').forEach(x => x.classList.remove('panel-drop'));
    if (!on || !target) return;
    swapPanels(panelKey(src), panelKey(target));
  };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
});
function swapPanels(a, b){
  const o = layout.order.slice(), i = o.indexOf(a), j = o.indexOf(b);
  if (i < 0 || j < 0 || i === j) return;
  o[i] = b; o[j] = a; layout.order = o;
  applyLayout(); saveLayout();
  state.blocks.forEach(x => { if (PREVIEW[x.type]) schedulePreview(x); });
}
