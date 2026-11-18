'use strict';

/* ========= Редактор фото на слайде (этап 10.5.3) =========
   Панель над фото (как в Canva): появляется после щелчка по фото, пропадает при щелчке мимо и пока фото тянут; открыто не больше одного окошка.
   Кнопки: 👁 спрятать, «Обрезать», «Повернуть», «Обводка», «Углы» (только «с фоном»), «Фильтр», «Отразить». На телефоне панель — снизу экрана.
   Обрезка — режим с ручками по краям: исходник не портится, у цитаты хранится рамка в долях картинки (photo.crop). Ставит и рисует всё photos.js
   (photoBox, photoFxVariant); здесь — только панель, окошки и режим обрезки. В JPEG и PowerPoint панель не попадает: её рисует слой .ph-layer,
   а он есть только на большом слайде в правке. Состояние выбора — photoUI (photos.js). */

const PHOTO_PALETTE = ['#ffffff', '#000000', '#f2c14e', '#c9702a', '#d94b4b', '#4b8bd9', '#3fa66b', '#8a8f98'];
const PHOTO_MAGNET = 3;   // у 0° поворот «прилипает» в пределах 3°

/* Что-то поменяли у фото цитаты id: записать и перерисовать слайд (картинка с правками готовится заново) */
function photoFxSet(id, fn){
  const b = blockById(id); if (!b || !b.photo || readOnly()) return;
  fn(b.photo, b);
  change(); updateCounter(b); photoRepaintAll(id);
}
function photoSelect(id){ photoUI.sel = id; photoUI.pop = null; photoRepaintAll(id); }
function photoDeselect(){
  const ids = [photoUI.sel, photoUI.crop].filter(Boolean);
  photoUI.sel = photoUI.pop = photoUI.crop = null;
  ids.forEach(id => photoRepaintAll(id));
}
function photoCropStart(id){ photoUI.crop = id; photoUI.pop = null; photoUI.sel = id; photoRepaintAll(id); }
function photoCropEnd(){ const id = photoUI.crop; photoUI.crop = null; if (id) photoRepaintAll(id); }

document.addEventListener('pointerdown', e => {   // щелчок мимо фото, панели и рамки обрезки
  if (!photoUI.sel && !photoUI.crop) return;
  if (e.target && e.target.closest && e.target.closest('.ph-hit, .ph-bar, .ph-crop')) return;
  photoDeselect();
}, true);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (photoUI.crop){ e.preventDefault(); e.stopPropagation(); photoCropEnd(); }
  else if (photoUI.pop){ e.preventDefault(); e.stopPropagation(); photoUI.pop = null; photoRepaintAll(photoUI.sel); }
}, true);

const EYE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';

/* Вызывается из paintPhotoLayer (photos.js) при каждой перерисовке: панель, окошко и рамка обрезки. k — масштаб кадра 1920 к слайду на экране */
function photoEditSync(L, holder, sl, b, box, k){
  const id = b.id, cropping = box.cropping, show = !photoUI.dragging && (cropping || photoUI.sel === id), sig = (cropping ? 'c' : 'n') + box.entry.kind + (photoMirrors(box.entry) ? 'm' : '');
  let bar = L.querySelector('.ph-bar');
  if (show && (!bar || bar._sig !== sig)){
    if (bar) bar.remove();
    bar = photoBuildBar(id, box, cropping); bar._sig = sig; L.append(bar);
  }
  if (bar) bar.hidden = !show;
  const cl = L.querySelector('.ph-crop');
  if (cropping) photoCropSync(L, b, box, k); else if (cl) cl.remove();
  if (!show || !bar) return;
  photoPopSync(bar, id);
  if (matchMedia('(max-width:760px)').matches){ bar.style.left = bar.style.top = ''; return; }   // на телефоне панель снизу экрана (css)
  const w = bar.offsetWidth, hgt = bar.offsetHeight, cx = box.left * k + box.width * k / 2;
  bar.style.left = Math.max(0, Math.min(holder.clientWidth - w, cx - w / 2)) + 'px';
  bar.style.top = Math.max(4, box.top * k - hgt - 8) + 'px';
}

function photoBuildBar(id, box, cropping){
  const bar = h('div', { class:'ph-bar', role:'toolbar', 'aria-label':'Фото на слайде' });
  const btn = (label, title, fn, cls) => h('button', { type:'button', class:'ph-b ' + (cls || ''), title, onclick:fn }, label);
  if (cropping){
    bar.append(h('span', { class:'ph-hint', text:'Тяните за края. Esc — готово' }), btn('Готово', 'Закончить обрезку', () => photoCropEnd(), 'ph-b-done'));
    return bar;
  }
  const pop = name => () => { photoUI.pop = photoUI.pop === name ? null : name; photoRepaintAll(id); };
  bar.append(
    h('button', { type:'button', class:'ph-b ph-b-eye', title:'Спрятать фото со слайда (вернуть — в блоке «Фото» справа)', 'aria-label':'Спрятать фото',
      html:EYE_SVG, onclick:() => { const b = blockById(id); if (!b || !b.photo || readOnly()) return; b.photo.off = true; photoUI.sel = photoUI.pop = null; change(); rerender(b); } }),
    btn('Обрезать', 'Обрезать: ручки по краям', () => photoCropStart(id), 'ph-b-crop'),
    btn('Повернуть', 'Повернуть', pop('rot'), 'ph-b-rot'),
    btn('Обводка', 'Обводка', pop('out'), 'ph-b-out'));
  if (box.entry.kind === 'bg') bar.append(btn('Углы', 'Скруглить углы', pop('round'), 'ph-b-round'));
  bar.append(btn('Фильтр', 'Фильтр', pop('filter'), 'ph-b-filter'));
  if (photoMirrors(box.entry)) bar.append(btn('Отразить', 'Отразить. Сторона фото при «Текст слева» — к тексту; повернули — отражается и поворот', () => {
    photoFxSet(id, (p, b) => { const a = bankEntry(p.id), before = a && photoFlip(b, a); p.mirror = p.mirror === false; if (a && before !== photoFlip(b, a)) photoMirrorFx(p); });
    photoRepaintAll(id);
  }, 'ph-b-flip'));
  return bar;
}

/* Окошко под панелью: пересобирается, только когда открыли другое; кнопка открытого окошка подсвечена */
function photoPopSync(bar, id){
  const name = photoUI.pop;
  bar.querySelectorAll('.ph-b').forEach(x => x.classList.toggle('on', !!name && x.classList.contains('ph-b-' + name)));
  let pop = bar.querySelector('.ph-pop');
  if (!name){ if (pop) pop.remove(); bar._pop = null; return; }
  if (pop && bar._pop === name) return;
  if (pop) pop.remove();
  const b = blockById(id); if (!b || !b.photo) return;
  pop = h('div', { class:'ph-pop ph-pop-' + name }, photoPopBody(name, id, b));
  bar._pop = name; bar.append(pop);
}
function photoPopBody(name, id, b){
  const p = b.photo, row = (label, ...kids) => h('div', { class:'ph-row' }, h('span', { class:'ph-lbl', text:label }), ...kids);
  if (name === 'rot'){
    const val = h('span', { class:'ph-val', text:(p.rot || 0) + '°' });
    const range = h('input', { type:'range', class:'ph-range ph-rot', min:-180, max:180, step:1, value:p.rot || 0, 'aria-label':'Угол поворота',
      oninput:e => { let v = +e.target.value; if (Math.abs(v) <= PHOTO_MAGNET) v = 0; e.target.value = v; val.textContent = v + '°'; photoFxSet(id, q => { if (v) q.rot = v; else delete q.rot; }); } });
    return [row('Поворот', range, val), h('button', { type:'button', class:'btn small ph-r90', onclick:() => {
      let v = (blockById(id).photo.rot || 0) + 90; if (v > 180) v -= 360;
      range.value = v; val.textContent = v + '°'; photoFxSet(id, q => { if (v) q.rot = v; else delete q.rot; });
    } }, 'На 90°')];
  }
  if (name === 'out'){
    const o = () => blockById(id).photo.outline || { w:0, color:PHOTO_OUT.color };
    const val = h('span', { class:'ph-val', text:o().w + ' px' });
    const set = (w, color) => photoFxSet(id, q => { if (w > 0 || color !== PHOTO_OUT.color) q.outline = { w, color }; else delete q.outline; });
    const range = h('input', { type:'range', class:'ph-range ph-ow', min:0, max:PHOTO_OUT.max, step:1, value:o().w, 'aria-label':'Толщина обводки',
      oninput:e => { val.textContent = e.target.value + ' px'; set(+e.target.value, o().color); } });
    const sw = c => h('button', { type:'button', class:'ph-sw' + (o().color === c ? ' on' : ''), style:'background:' + c, title:c, 'aria-label':'Цвет ' + c,
      onclick:e => { const w = o().w || 4; range.value = w; val.textContent = w + ' px'; set(w, c); e.currentTarget.parentNode.querySelectorAll('.ph-sw').forEach(x => x.classList.toggle('on', x === e.currentTarget)); } });
    const any = h('input', { type:'color', class:'ph-color', value:o().color, 'aria-label':'Любой цвет',
      oninput:e => { const w = o().w || 4; range.value = w; val.textContent = w + ' px'; set(w, e.target.value.toLowerCase()); } });
    return [row('Толщина', range, val), h('div', { class:'ph-sws' }, PHOTO_PALETTE.map(sw), any),
      h('div', { class:'ph-note', text:b.photo && bankEntry(p.id) && bankEntry(p.id).kind === 'bg' ? 'По краю кадра' : 'По силуэту' })];
  }
  if (name === 'round'){
    const val = h('span', { class:'ph-val', text:Math.round((p.round || 0) * 100) + ' %' });
    return [row('Скругление', h('input', { type:'range', class:'ph-range ph-rd', min:0, max:50, step:1, value:Math.round((p.round || 0) * 100), 'aria-label':'Скругление углов',
      oninput:e => { const v = +e.target.value; val.textContent = v + ' %'; photoFxSet(id, q => { if (v) q.round = v / 100; else delete q.round; }); } }), val)];
  }
  if (name === 'filter'){
    return h('div', { class:'ph-list' }, PHOTO_FILTERS.map(([v, t]) => h('button', { type:'button', class:'ph-opt' + (p.filter === v ? ' on' : ''), 'data-f':v, text:t,
      onclick:e => { photoFxSet(id, q => { q.filter = v; }); e.currentTarget.parentNode.querySelectorAll('.ph-opt').forEach(x => x.classList.toggle('on', x === e.currentTarget)); } })));
  }
  return [];
}

/* ----- Обрезка: вся картинка бледно, видимая часть ярко, ручки на рамке ----- */
function photoCropSync(L, b, box, k){
  let C = L.querySelector('.ph-crop');
  if (!C){
    C = h('div', { class:'ph-crop' }, h('img', { class:'pc-full', alt:'' }), h('img', { class:'pc-bright', alt:'' }),
      h('div', { class:'pc-frame' }, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(c => h('span', { class:'pc-h c-' + c, 'data-h':c }))));
    C.querySelector('.pc-frame').addEventListener('pointerdown', e => { if (e.target.dataset && e.target.dataset.h) photoCropDrag(e, b.id, e.target.dataset.h); });
    L.append(C);
  }
  const F = box.F, V = box.V, c = b.photo.crop || { l:0, t:0, r:0, b:0 }, key = variantKey(box.entry, b.photo.filter, box.flip), v = photoVars.get(key);
  if (!v) photoVariant(box.entry, b.photo.filter, box.flip).then(() => photoRepaintAll(b.id)).catch(() => {});
  const url = v && v.ready ? v.url : '', geo = { left:F.left * k + 'px', top:F.top * k + 'px', width:F.width * k + 'px', height:F.height * k + 'px' };
  C.querySelectorAll('img').forEach(im => { if (url && im.getAttribute('src') !== url) im.src = url; Object.assign(im.style, geo, { display:url ? 'block' : 'none' }); });
  C.querySelector('.pc-bright').style.clipPath = 'inset(' + [c.t, c.r, c.b, c.l].map(x => (x * 100).toFixed(3) + '%').join(' ') + ')';
  Object.assign(C.querySelector('.pc-frame').style, { left:V.left * k + 'px', top:V.top * k + 'px', width:V.width * k + 'px', height:V.height * k + 'px' });
}
function photoCropDrag(e, id, handle){
  const b = blockById(id); if (!b || !b.photo || readOnly() || e.button !== 0) return;
  const box0 = photoBox(b); if (!box0) return;
  e.preventDefault(); e.stopPropagation();
  const sl = e.currentTarget.closest('.stage-slide').querySelector('.sl'), k = sl.clientWidth / SL.W, F = box0.F, x0 = e.clientX, y0 = e.clientY;
  const c0 = Object.assign({ l:0, t:0, r:0, b:0 }, b.photo.crop), min = PHOTO_CROP_MIN, fr = e.currentTarget;
  fr.setPointerCapture(e.pointerId);
  photoUI.dragging = true;
  const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, v)), rnd = v => +v.toFixed(4);
  const move = ev => {
    const dl = (ev.clientX - x0) / k / F.width, dt = (ev.clientY - y0) / k / F.height, c = Object.assign({}, c0);
    if (handle.includes('w')) c.l = rnd(cl(c0.l + dl, 0, 1 - c0.r - min));
    if (handle.includes('e')) c.r = rnd(cl(c0.r - dl, 0, 1 - c0.l - min));
    if (handle.includes('n')) c.t = rnd(cl(c0.t + dt, 0, 1 - c0.b - min));
    if (handle.includes('s')) c.b = rnd(cl(c0.b - dt, 0, 1 - c0.t - min));
    b.photo.crop = c;
    photoRepaintAll(id);
  };
  const up = () => {
    fr.removeEventListener('pointermove', move); fr.removeEventListener('pointerup', up); fr.removeEventListener('pointercancel', up);
    photoUI.dragging = false;
    const n = normPhotoCrop(b.photo.crop); if (n) b.photo.crop = n; else delete b.photo.crop;
    change(); updateCounter(b); photoRepaintAll(id);
  };
  fr.addEventListener('pointermove', move); fr.addEventListener('pointerup', up); fr.addEventListener('pointercancel', up);
}
