'use strict';

/* ========= Отмена и возврат (этап 7.2) =========
   История — снимки содержимого проповеди (meta, settings, blocks) до каждой правки. Отметка «доработать» и статус
   в историю не входят: это не правка содержимого (у восстановленных слайдов отметка берётся текущая).
   Набор текста в одном поле подряд (паузы меньше HIST_GROUP_MS) — один шаг.
   История живёт до конца правки: автосохранение её не стирает; «Готово», уход с проповеди и смена версии из облака — сбрасывают.
   Ctrl+Z внутри поля, где печатают, сначала отменяет набор в самом поле (как в браузере), потом — действия со слайдами. */
const HIST_MAX = 200, HIST_GROUP_MS = 1500;
const hist = { id:null, cur:null, undo:[], redo:[], at:0, key:null, applying:false };

function histSnap(s){
  s = s || state;
  return JSON.stringify({ meta:s.meta, settings:s.settings, blocks:s.blocks.map(b => { const c = Object.assign({}, b); delete c.todo; delete c.done; return c; }) });
}
/* Начать историю заново: открыли проповедь, начали или закончили правку, пришла версия из облака */
function histReset(){
  Object.assign(hist, { id:state ? state.id : null, cur:state ? { snap:histSnap(), sel:selId } : null, undo:[], redo:[], at:0, key:null });
  histButtons();
}
const histOn = () => !!state && screen === 'sermon' && !readOnly();
/* Вызывается из change(): правка уже сделана — запомнить, как было до неё */
function histRecord(){
  if (hist.applying || !state) return;
  if (hist.id !== state.id || !hist.cur){ histReset(); return; }
  const snap = histSnap();
  if (snap === hist.cur.snap) return;   // ничего в содержимом не поменялось (отметка, статус)
  const now = Date.now(), a = document.activeElement;
  const typing = a && (a.isContentEditable || /^(INPUT|TEXTAREA)$/.test(a.tagName)) ? a : null;
  const top = hist.undo[hist.undo.length - 1];
  if (top && top.snap === snap){   // вернулись к прежнему (например, отменой набора в самом поле)
    hist.cur = hist.undo.pop();
    hist.cur.sel = selId;
  } else if (typing && typing === hist.key && now - hist.at < HIST_GROUP_MS && top){
    hist.cur = { snap, sel:selId };   // продолжение набора в том же поле — тот же шаг
  } else {
    hist.undo.push(hist.cur);
    if (hist.undo.length > HIST_MAX) hist.undo.shift();
    hist.cur = { snap, sel:selId };
  }
  hist.redo = [];
  hist.key = typing; hist.at = now;
  histButtons();
}
/* Выбрали другой слайд: отмена вернёт и выбор */
function histSel(id){ if (hist.cur && hist.id === state.id) hist.cur.sel = id; }

function histApply(e){
  const d = JSON.parse(e.snap), todo = {};
  state.blocks.forEach(b => { todo[b.id] = b.todo; });
  state.meta = d.meta; state.settings = d.settings;
  state.blocks = d.blocks.map(b => { if (TYPES[b.type] && TYPES[b.type].slide) b.todo = b.id in todo ? !!todo[b.id] : (cloudOn() ? defaultTodo(b) : !!b.todo); return b; });
  if (cloudOn()) applyFlags(state);   // отметки редактора — поверх, как при открытии
  selId = state.blocks.some(b => b.id === e.sel) ? e.sel : (state.blocks[0] ? state.blocks[0].id : null);
  hist.applying = true;
  try { change(); } finally { hist.applying = false; }
  hist.key = null;
  motionFilm(() => {   // отмена и возврат двигают миниатюры так же, как обычные правки (в просмотре и без ленты — просто перерисовка)
    const fs = filmEl && filmEl.isConnected ? filmEl.scrollTop : 0;
    renderAll();
    if (filmEl && filmEl.isConnected) filmEl.scrollTop = fs;
    if (inSlides()) flash(selId);
  });
}
function undo(){
  if (!histOn() || hist.id !== state.id || !hist.undo.length) return false;
  hist.redo.push(hist.cur);
  hist.cur = hist.undo.pop();
  histApply(hist.cur);
  histButtons();
  return true;
}
function redo(){
  if (!histOn() || hist.id !== state.id || !hist.redo.length) return false;
  hist.undo.push(hist.cur);
  hist.cur = hist.redo.pop();
  histApply(hist.cur);
  histButtons();
  return true;
}
const canUndo = () => histOn() && hist.id === state.id && hist.undo.length > 0;
const canRedo = () => histOn() && hist.id === state.id && hist.redo.length > 0;

/* Кнопки ↶ ↷ в шапке: только пока проповедь правится */
function histTools(){
  if (!histOn()) return null;
  return h('div', { class:'hist', role:'group', 'aria-label':'Отмена и возврат' },
    iconBtn('undo', 'Отменить (Ctrl+Z)', () => undo(), 'hist-undo'),
    iconBtn('redo', 'Вернуть (Ctrl+Y)', () => redo(), 'hist-redo'));
}
function histButtons(){
  const u = document.querySelector('.hist-undo'), r = document.querySelector('.hist-redo');
  if (u) u.disabled = !canUndo();
  if (r) r.disabled = !canRedo();
}

/* Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z. В поле, где печатают, сначала работает отмена самого браузера */
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase(), isUndo = (k === 'z' || e.code === 'KeyZ') && !e.shiftKey, isRedo = k === 'y' || e.code === 'KeyY' || ((k === 'z' || e.code === 'KeyZ') && e.shiftKey);
  if (!isUndo && !isRedo) return;
  if (settingsOverlay.classList.contains('open') || sheetOverlay.classList.contains('open')) return;   // в окнах — как обычно в браузере
  const a = document.activeElement, field = a && (a.isContentEditable || /^(INPUT|TEXTAREA)$/.test(a.tagName));
  if (field){
    let native = false;
    try { native = document.queryCommandEnabled(isUndo ? 'undo' : 'redo'); } catch(err){}
    if (native) return;   // браузер отменит набор в поле сам
  }
  if (!histOn()) return;
  e.preventDefault();
  if (isUndo) undo(); else redo();
});
