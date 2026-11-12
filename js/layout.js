'use strict';

/* ========= Раскладка экрана «Слайды» (этап 7.2) =========
   Лента, слайд и боковая панель. Границы между ними можно тянуть (соседняя панель сужается), панели — менять местами,
   перетащив за заголовок. Раскладка запоминается у человека: в облаке (people/{почта}/prefs/screen, одинаково на всех
   компьютерах), без входа — в этом браузере. «⋯ → Сбросить настройки экрана» — как было.
   Порядок панелей по умолчанию — общий для пространства (SLIDES_BASE.panels, «Настройки слайдов → Расположение панелей», этап 7.4):
   свой порядок есть только у того, кто сам переставил панели (layout.order), у остальных панели стоят, как задано в пространстве;
   «Сбросить настройки экрана» убирает свой порядок и возвращает порядок пространства.
   На узком экране (≤ 1100 px) тянуть и менять местами нельзя: раскладка как раньше, из CSS.
   Этап 7.8: ширины ленты и боковой панели — доли ширины экрана «Слайды» (film, side от 0 до 1, запись v:3), а не пиксели:
   на любом мониторе пропорции те же. Есть нижние пределы в пикселях, и слайду всегда остаётся не меньше трети ширины
   (не помещается — первой сужается боковая панель, потом лента). Прежние записи в пикселях (v:2 и раньше) пересчитываются
   от ширины 1900 px — большого экрана, на котором их настраивали. */
const LAY_REF = 1900;
const LAYOUT_DEFAULT = { order:['film', 'stage', 'side'], film:214 / LAY_REF, side:400 / LAY_REF };   // order — порядок из прежних версий; у пространства свой (SLIDES_DEFAULT.panels)
const LAY_MIN = { film:150, side:300, stage:380 };   // px
const LAY_MAX = { film:0.25, side:0.45 };            // доля
const LAY_STAGE = 1 / 3;                             // слайду — не меньше трети
const LAYOUT_SAVE_MS = 1500;
const wideScreen = () => window.matchMedia('(min-width:1101px)').matches;
/* Своя раскладка: order — свой порядок панелей или null (тогда порядок пространства); v:2 — версия записи. В записях без v (до 7.4)
   порядок по умолчанию 'film, stage, side' всегда лежал в браузере, хотя человек его не выбирал: он не считается своим */
function normLayout(o){
  o = o && typeof o === 'object' ? o : {};
  const keys = LAYOUT_DEFAULT.order;
  const ok = Array.isArray(o.order) && o.order.length === 3 && keys.every(k => o.order.includes(k));
  const order = ok && (o.v >= 2 || o.order.join() !== keys.join()) ? o.order.slice() : null;
  const w = (k) => {
    let v = +o[k];
    if (!isFinite(v) || v <= 0) return LAYOUT_DEFAULT[k];
    if (o.v !== 3 || v > 1) v = v / LAY_REF;   // пиксели из прежних версий
    return Math.round(Math.min(LAY_MAX[k], Math.max(0.04, v)) * 10000) / 10000;
  };
  return { v:3, order, film:w('film'), side:w('side') };
}
/* Ширины в пикселях для текущего экрана: доли → px, нижние пределы, слайду — не меньше трети (и не меньше LAY_MIN.stage) */
function layoutPx(total){
  const px = { film:Math.max(LAY_MIN.film, Math.round(layout.film * total)), side:Math.max(LAY_MIN.side, Math.round(layout.side * total)) };
  const room = total - Math.max(LAY_MIN.stage, Math.round(total * LAY_STAGE)) - 24;   // 24 — зазоры между панелями
  let over = px.film + px.side - room;
  if (over > 0){ const d = Math.min(over, px.side - LAY_MIN.side); px.side -= d; over -= d; }
  if (over > 0){ const d = Math.min(over, px.film - LAY_MIN.film); px.film -= d; }
  return px;
}
/* Порядок панелей на экране: свой или, если его нет, общий для пространства */
const curOrder = () => layout.order || normPanels(SLIDES_BASE.panels);
let layout = (() => { try { return normLayout(JSON.parse(LS.get('swp-layout') || 'null')); } catch(e){ return normLayout(null); } })();
let layoutTimer = null;
const isDefaultLayout = l => JSON.stringify(l) === JSON.stringify(normLayout(null));
const cloudLayout = () => { const o = Object.assign({}, layout); if (!o.order) delete o.order; return o; };   // пустого порядка в облако не пишем

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
  layoutTimer = setTimeout(() => { cloud.api.setPrefs(who, isDefaultLayout(layout) ? {} : cloudLayout()).catch(() => {}); }, LAYOUT_SAVE_MS);   // запас базы общий: пишем после паузы
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
  const px = layoutPx(sv.clientWidth);
  sv.style.gridTemplateColumns = curOrder().map(k => k === 'stage' ? 'minmax(0,1fr)' : px[k] + 'px').join(' ');
  panels.forEach(p => { p.style.order = String(curOrder().indexOf(panelKey(p))); });
  if (!sv.querySelector('.sv-resize')) [0, 1].forEach(i => sv.append(h('div', { class:'sv-resize', 'data-i':String(i), role:'separator', 'aria-orientation':'vertical',
    title:'Потяните, чтобы изменить ширину' })));
  placeHandles(sv);
}
function placeHandles(sv){
  const left = sv.getBoundingClientRect().left;
  const byOrder = curOrder().map(k => ({ film:filmEl, stage:stageEl, side:sideEl })[k]);
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
  const sv = hd.closest('.sv'), i = +hd.dataset.i, ord = curOrder(), a = ord[i], b = ord[i + 1];
  const total = sv.clientWidth, x0 = e.clientX, w0 = layoutPx(total);   // тянем в пикселях, храним доли
  hd.setPointerCapture(e.pointerId); sv.classList.add('resizing');
  const move = ev => {
    const dx = ev.clientX - x0, next = { film:w0.film, side:w0.side };
    if (a !== 'stage') next[a] = w0[a] + dx;
    if (b !== 'stage') next[b] = w0[b] - dx;
    ['film', 'side'].forEach(k => { next[k] = Math.min(Math.round(LAY_MAX[k] * total), Math.max(LAY_MIN[k], Math.round(next[k]))); });
    if (a !== 'stage' && b !== 'stage'){ const sum = w0[a] + w0[b]; if (next[a] + next[b] !== sum){ if (next[a] === LAY_MIN[a] || next[a] === LAY_MAX[a]) next[b] = sum - next[a]; else next[a] = sum - next[b]; } }
    const room = total - Math.max(LAY_MIN.stage, Math.round(total * LAY_STAGE)) - 24;   // слайду остаётся не меньше трети
    if (next.film + next.side > room){ const k = a === 'stage' ? b : a; next[k] = Math.max(LAY_MIN[k], room - next[k === 'film' ? 'side' : 'film']); }
    layout.film = Math.round(next.film / total * 10000) / 10000; layout.side = Math.round(next.side / total * 10000) / 10000;
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
  const o = curOrder().slice(), i = o.indexOf(a), j = o.indexOf(b);
  if (i < 0 || j < 0 || i === j) return;
  o[i] = b; o[j] = a; layout.order = o;
  applyLayout(); saveLayout();
  state.blocks.forEach(x => { if (PREVIEW[x.type]) schedulePreview(x); });
}
