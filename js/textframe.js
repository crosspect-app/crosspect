'use strict';

/* ========= Рамка текста цитаты с фото (этап 10.5.5) =========
   При «Тексте слева / справа» рамку текста можно двигать мышью и менять её размер за края и углы, как фото.
   Модель — b.textBox { x, y, w, h, ha, va } в долях слайда (normTextBox в model.js); null — прежний расчёт по «Месту» и «Ширине текста».
   Ставит рамку на слайд placeTextBox (preview.js): одна функция для сцены, ленты, JPEG и PowerPoint.
   Здесь — слой для мыши на большом слайде в правке (.tb-layer в .stage-slide, в JPEG не попадает), привязки, блок «Рамка текста» справа.
   Привязки (порог TB_SNAP px кадра 1920×1080): края фото (рамка photoBox — с обрезкой, поворотом и обводкой), поля слайда,
   середина свободного места между фото и полем, верх и низ фото, середина слайда. Зажатый Alt (Option) — без привязок. */

const TB_SNAP = 8;
const TB_MIN = { w:160, h:90 };   // px кадра: меньше рамку не сделать
const TB_GAP = 40;   // «Выровнять по свободному месту»: от низа рамки до подписи автора
const tbUI = { sel:null, drag:null, guides:[] };   // sel — id цитаты с выделенной рамкой; drag и guides — пока тянут

/* Поля слайда в px кадра (как --sl-x / --sl-t / --sl-b в slideVars) */
function tbMargins(){ const m = slidesCfg().margins; return { x:PANEL_INSET + m.side, t:PANEL_INSET + m.top, b:PANEL_INSET + m.bottom }; }

/* Рамка сейчас в px кадра: своя или та, что задали «Место» и «Ширина текста» (с большого слайда) */
function tbRect(b, sl){
  const t = textBoxOn(b);
  if (t) return { l:t.x * SL.W, t:t.y * SL.H, r:(t.x + t.w) * SL.W, b:(t.y + t.h) * SL.H };
  const box = sl && sl.querySelector('.sl-box');
  if (box && box.offsetWidth) return { l:box.offsetLeft, t:box.offsetTop, r:box.offsetLeft + box.offsetWidth, b:box.offsetTop + box.offsetHeight };
  const m = tbMargins(), hw = clampHalfW(b.halfW) / 100, gap = 48;   // без слайда на экране — по CSS .sl-box-quote
  return b.half === 'left' ? { l:m.x, t:m.t + 150, r:SL.W * hw - gap, b:SL.H - m.b - 150 } : { l:SL.W * (1 - hw) + gap, t:m.t + 150, r:SL.W - m.x, b:SL.H - m.b - 150 };
}
/* Свободное место между фото и полем слайда (по горизонтали) в px кадра. Без фото — от границы «Ширины текста» */
function tbFree(b){
  const m = tbMargins(), pb = photoBox(b), hw = clampHalfW(b.halfW) / 100, right = b.half === 'right';
  let edge = pb ? (right ? pb.left + pb.width : pb.left) : (right ? SL.W * (1 - hw) : SL.W * hw);
  const outer = right ? SL.W - m.x : m.x;
  if (right ? outer - edge < TB_MIN.w : edge - outer < TB_MIN.w) edge = right ? SL.W * (1 - hw) : SL.W * hw;   // фото заходит за поле: свободного места нет
  return { l:Math.min(edge, outer), r:Math.max(edge, outer) };
}
/* Линии привязки: края (к ним липнут края рамки) и середины (к ним липнет середина рамки) */
function tbTargets(b){
  const m = tbMargins(), pb = photoBox(b), f = tbFree(b);
  const x = { edges:[m.x, SL.W - m.x], centers:[SL.W / 2, (f.l + f.r) / 2] }, y = { edges:[m.t, SL.H - m.b], centers:[SL.H / 2] };
  if (pb){ x.edges.push(pb.left, pb.left + pb.width); y.edges.push(pb.top, pb.top + pb.height); }
  return { x, y };
}
/* Ближайшая линия к одной из точек рамки: pts — [[координата, 'edges' | 'centers'], …]. Возвращает сдвиг и линию или null */
function tbSnap(pts, T){
  let best = null;
  pts.forEach(([v, kind]) => T[kind].forEach(at => {
    const d = at - v;
    if (Math.abs(d) <= TB_SNAP && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at };
  }));
  return best;
}
const tbClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const tbR4 = v => +v.toFixed(4);
function tbStore(b, R){
  const old = b.textBox || { ha:'center', va:'center' };
  b.textBox = { x:tbR4(R.l / SL.W), y:tbR4(R.t / SL.H), w:tbR4((R.r - R.l) / SL.W), h:tbR4((R.b - R.t) / SL.H), ha:old.ha, va:old.va };
}

/* ----- Слой для мыши на большом слайде ----- */
function paintTextFrame(sl, b){
  const holder = sl.parentNode && sl.parentNode.classList && sl.parentNode.classList.contains('stage-slide') ? sl.parentNode : null;
  if (!holder) return;
  let L = holder.querySelector('.tb-layer');
  const on = !readOnly() && !!photoHalf(b);
  holder.classList.toggle('tb-on', on);
  if (!on){ if (L) L.remove(); if (tbUI.sel === b.id) tbUI.sel = null; return; }
  if (L && L._id !== b.id){ L.remove(); L = null; }
  if (!L){
    L = h('div', { class:'tb-layer', 'aria-hidden':'true' }, h('div', { class:'tb-guides' }),
      h('div', { class:'tb-hit', title:'Перетащите текст. Размер — за край или угол. Alt — без привязок' },
        ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(c => h('span', { class:'tb-h c-' + c, 'data-h':c }))));
    L._id = b.id;
    holder.append(L);
    L.querySelector('.tb-hit').addEventListener('pointerdown', e => tbDrag(e, b.id, e.target.dataset && e.target.dataset.h));
  }
  const k = sl.clientWidth / SL.W, R = tbRect(b, sl), hit = L.querySelector('.tb-hit');
  Object.assign(hit.style, { left:R.l * k + 'px', top:R.t * k + 'px', width:(R.r - R.l) * k + 'px', height:(R.b - R.t) * k + 'px' });
  hit.classList.toggle('sel', tbUI.sel === b.id);
  hit.classList.toggle('drag', tbUI.drag === b.id);
  const G = L.querySelector('.tb-guides'), gs = tbUI.drag === b.id ? tbUI.guides : [];
  G.replaceChildren(...gs.map(g => h('div', { class:'tb-guide ' + g.dir, style:g.dir === 'v' ? 'left:' + g.at * k + 'px' : 'top:' + g.at * k + 'px' })));
}
/* Перерисовать рамку на всех слайдах этой цитаты: большой — сразу (кадром), лента — после отпускания */
function tbRepaint(id, all){
  document.querySelectorAll('.sl[data-id="' + id + '"]').forEach(sl => {
    if (!all && !(sl.parentNode && sl.parentNode.classList.contains('stage-slide'))) return;
    const b = unitById(sl.dataset.id); if (b) fitSlide(sl, b);
  });
}

/* Двигать (за середину) или тянуть (за ручку h: n, s, e, w и углы). Щелчок без движения — выделить рамку */
function tbDrag(e, id, handle){
  const b = blockById(id); if (!b || readOnly() || e.button !== 0 || !photoHalf(b)) return;
  const holder = e.currentTarget.closest('.stage-slide'), sl = holder && holder.querySelector('.sl'); if (!sl) return;
  e.preventDefault(); e.stopPropagation();
  const k = sl.clientWidth / SL.W, R0 = tbRect(b, sl), w0 = R0.r - R0.l, h0 = R0.b - R0.t, x0 = e.clientX, y0 = e.clientY, T = tbTargets(b), had = !!b.textBox;
  const hit = e.currentTarget; hit.setPointerCapture(e.pointerId);
  let moved = false, raf = 0;
  const move = ev => {
    const dx = (ev.clientX - x0) / k, dy = (ev.clientY - y0) / k;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    moved = true; tbUI.drag = id; tbUI.sel = id;
    const snap = !ev.altKey, R = Object.assign({}, R0), g = [];
    if (!handle){
      R.l = tbClamp(R0.l + dx, 0, SL.W - w0); R.t = tbClamp(R0.t + dy, 0, SL.H - h0);
      const sx = snap && tbSnap([[R.l, 'edges'], [R.l + w0 / 2, 'centers'], [R.l + w0, 'edges']], T.x);
      if (sx && R.l + sx.d >= 0 && R.l + sx.d + w0 <= SL.W){ R.l += sx.d; g.push({ dir:'v', at:sx.at }); }
      const sy = snap && tbSnap([[R.t, 'edges'], [R.t + h0 / 2, 'centers'], [R.t + h0, 'edges']], T.y);
      if (sy && R.t + sy.d >= 0 && R.t + sy.d + h0 <= SL.H){ R.t += sy.d; g.push({ dir:'h', at:sy.at }); }
      R.r = R.l + w0; R.b = R.t + h0;
    } else {
      const edge = (key, v, lo, hi, axis) => {
        let nv = tbClamp(v, lo, hi);
        const s = snap && tbSnap([[nv, 'edges']], T[axis]);
        if (s && nv + s.d >= lo && nv + s.d <= hi){ nv += s.d; g.push({ dir:axis === 'x' ? 'v' : 'h', at:s.at }); }
        R[key] = nv;
      };
      if (handle.includes('w')) edge('l', R0.l + dx, 0, R0.r - TB_MIN.w, 'x');
      if (handle.includes('e')) edge('r', R0.r + dx, R0.l + TB_MIN.w, SL.W, 'x');
      if (handle.includes('n')) edge('t', R0.t + dy, 0, R0.b - TB_MIN.h, 'y');
      if (handle.includes('s')) edge('b', R0.b + dy, R0.t + TB_MIN.h, SL.H, 'y');
    }
    tbUI.guides = g;
    tbStore(b, R);
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; tbRepaint(id); });
  };
  const up = () => {
    hit.removeEventListener('pointermove', move); hit.removeEventListener('pointerup', up); hit.removeEventListener('pointercancel', up);
    if (raf){ cancelAnimationFrame(raf); raf = 0; }
    tbUI.drag = null; tbUI.guides = [];
    if (moved){ change(); if (had) updateCounter(b); else rerender(b); tbRepaint(id, true); }
    else { tbUI.sel = id; tbRepaint(id); }
  };
  hit.addEventListener('pointermove', move); hit.addEventListener('pointerup', up); hit.addEventListener('pointercancel', up);
}
document.addEventListener('pointerdown', e => {   // щелчок мимо рамки снимает выделение
  if (!tbUI.sel || (e.target && e.target.closest && e.target.closest('.tb-hit'))) return;
  const id = tbUI.sel; tbUI.sel = null; tbRepaint(id);
}, true);

/* ----- Действия из блока «Рамка текста» и при смене «Места текста» ----- */
function tbSet(b, fn){
  if (readOnly() || !photoHalf(b)) return;
  const sl = document.querySelector('.stage-slide .sl[data-id="' + b.id + '"]');
  if (!b.textBox) tbStore(b, tbRect(b, sl));
  fn(b.textBox, sl);
  change(); rerender(b);
}
/* Ровно между фото и полем слайда, по высоте — от верхнего поля до подписи автора (без подписи — до нижнего поля) */
function tbFitFree(b){
  tbSet(b, (t, sl) => {
    const m = tbMargins(), f = tbFree(b);
    let bottom = SL.H - m.b;
    for (let i = 0; i < 2; i++){   // подпись автора встаёт по краю рамки и может перенестись: меряем после того, как рамка встала
      tbStore(b, { l:f.l, r:f.r, t:m.t, b:bottom });
      Object.assign(b.textBox, { ha:t.ha, va:t.va });
      const au = sl && sl.querySelector('.sl-author');
      if (!au){ if (quoteAuthor(b) || b.caption) bottom = SL.H - m.b - 150; break; }   // слайда на экране нет: место под подпись — как у прежней рамки
      fitSlide(sl, b);
      bottom = au.textContent.trim() ? Math.max(m.t + TB_MIN.h, au.offsetTop - TB_GAP) : SL.H - m.b;
    }
    tbStore(b, { l:f.l, r:f.r, t:m.t, b:bottom });
    Object.assign(b.textBox, { ha:t.ha, va:t.va });
  });
}
function tbReset(b){
  if (readOnly() || !b.textBox) return;
  b.textBox = null; tbUI.sel = null;
  change(); rerender(b);
}
/* «Текст слева» ↔ «Текст справа»: рамка переходит зеркально (как фото). Из «Во всю ширину» — зеркально, если рамка на чужой стороне */
function textBoxHalfSwitch(b, v){
  const t = b.textBox, was = b.half === 'left' || b.half === 'right' ? b.half : null;
  if (!t || !(v === 'left' || v === 'right') || v === was) return;
  if (was || (v === 'left') !== (t.x + t.w / 2 < 0.5)){
    t.x = tbR4(Math.max(0, 1 - t.x - t.w));
    t.ha = { left:'right', right:'left' }[t.ha] || t.ha;
  }
}
/* Выравнивание в рамке, «Выровнять по свободному месту» и «Сбросить» — в строке и «Расположении» цитаты (render.js, quote; 26.11) */

/* ----- Привязки фото при перетаскивании (правка 19 ноября 2026) -----
   Рамка фото — photoBox (с обрезкой, поворотом и обводкой). Края липнут к краям слайда, внутреннему краю его рамки, полям слайда
   и краям рамки текста; середина — к середине слайда. Линии — .sl-guides на большом слайде */
function photoSnapMove(b, box0, dx, dy){
  const m = tbMargins(), I = PANEL_INSET, g = [];
  const T = { x:{ edges:[0, I, m.x, SL.W - m.x, SL.W - I, SL.W], centers:[SL.W / 2] }, y:{ edges:[0, I, m.t, SL.H - m.b, SL.H - I, SL.H], centers:[SL.H / 2] } };
  if (photoHalf(b)){
    const R = tbRect(b, document.querySelector('.stage-slide .sl[data-id="' + b.id + '"]'));
    T.x.edges.push(R.l, R.r); T.y.edges.push(R.t, R.b);
  }
  const l = box0.left + dx, t = box0.top + dy, w = box0.width, hh = box0.height;
  const sx = tbSnap([[l, 'edges'], [l + w / 2, 'centers'], [l + w, 'edges']], T.x);
  if (sx){ dx += sx.d; g.push({ dir:'v', at:sx.at }); }
  const sy = tbSnap([[t, 'edges'], [t + hh / 2, 'centers'], [t + hh, 'edges']], T.y);
  if (sy){ dy += sy.d; g.push({ dir:'h', at:sy.at }); }
  return { dx, dy, g };
}
/* Линии привязки на большом слайде: lines — [{ dir:'v' | 'h', at:px кадра }], пусто — убрать */
function slideGuides(holder, lines, k){
  if (!holder) return;
  let G = holder.querySelector(':scope > .sl-guides');
  if (!lines.length){ if (G) G.remove(); return; }
  if (!G) holder.append(G = h('div', { class:'sl-guides', 'aria-hidden':'true' }));
  G.replaceChildren(...lines.map(g => h('div', { class:'tb-guide ' + g.dir, style:g.dir === 'v' ? 'left:' + g.at * k + 'px' : 'top:' + g.at * k + 'px' })));
}
