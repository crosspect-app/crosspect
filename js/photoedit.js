'use strict';

/* ========= Редактор фото (этап 10.5.3; правка 19 ноября 2026 — настройки в «Редакторе») =========
   На слайде фото только двигают и тянут за углы (photos.js), щелчок выделяет его: рамка на фото, блок «Фото» в «Редакторе» подсвечен
   и прокручен в вид. Настройки — в блоке «Фото» (photoPanelFill, photos.js): на виду «Сменить фото», «На слайде», «Сбросить» и
   (админ) «Сделать видом по умолчанию»; вкладки «Кадр · Фильтр · Обводка · Тень» (photoAdvanced, 26.11) — фильтр, «Обрезать», «Отразить»
   слева направо и сверху вниз (этап 10.5.7), обводка, углы (только «с фоном»). Свёрнуто или раскрыто — помнит браузер. Обрезка — режим
   с ручками на слайде; над фото тогда подсказка и «Готово» (на телефоне — снизу экрана). Поворот — только круглой стрелкой над
   выделенным фото (photoRotDrag, этап 10.5.7). В JPEG и PowerPoint ничего из этого не попадает. Состояние — photoUI (photos.js). */

const PHOTO_PALETTE = ['#ffffff', '#000000', '#f2c14e', '#c9702a', '#d94b4b', '#4b8bd9', '#3fa66b', '#8a8f98'];
const PHOTO_MAGNET = 3;   // поворот стрелкой «прилипает» к 0°, 90°, 180°, −90° в пределах 3° (Alt — без привязки)
const PHOTO_ROT_SNAP = [0, 90, 180, -180, -90];

/* Что-то поменяли у фото цитаты id: записать и перерисовать слайд (картинка с правками готовится заново) */
function photoFxSet(id, fn){
  const b = blockById(id); if (!b || !b.photo || readOnly()) return;
  fn(b.photo, b);
  change(); updateCounter(b); photoRepaintAll(id);
}
/* Выделение фото: рамка на слайде и подсвеченный блок «Фото» в «Редакторе» */
function photoPanelMark(scroll){
  const el = typeof sideEl !== 'undefined' && sideEl ? sideEl.querySelector('.ph-panel') : null; if (!el) return;
  const on = !!el._b && (photoUI.sel === el._b.id || photoUI.crop === el._b.id);
  // этап 10.9.6.4: выделили — настройки раскрылись; сняли щелчком мимо — свернутся после щелчка (иначе панель сдвигается под мышью и щелчок промахивается)
  const refill = () => { if (el._b && el.isConnected && el._sig !== photoPanelSig(el._b)) photoPanelFill(el, el._b); };
  if (on || !el.querySelector('.ph-adv')) refill();
  else { const t = setTimeout(refill, 800); addEventListener('click', () => { clearTimeout(t); setTimeout(refill, 0); }, { once:true, capture:true }); }
  el.classList.toggle('sel', on);
  // на телефоне блок «Фото» под слайдом: не прокручиваем, иначе выделенное фото уезжает за экран (этап 10.5.7)
  if (on && scroll && el.scrollIntoView && !matchMedia('(max-width:760px)').matches) el.scrollIntoView({ block:'nearest', behavior:'smooth' });
}
function photoSelect(id){ photoUI.sel = id; photoUI.pop = null; photoRepaintAll(id); photoPanelMark(true); }
function photoDeselect(){
  const ids = [photoUI.sel, photoUI.crop].filter(Boolean), crop = !!photoUI.crop;
  photoUI.sel = photoUI.pop = photoUI.crop = null;
  ids.forEach(id => photoRepaintAll(id));
  if (crop) photoPanelRefresh(); else photoPanelMark();
}
function photoCropStart(id){ photoUI.crop = photoUI.cropNew = id; photoUI.pop = null; photoUI.sel = id; photoRepaintAll(id); photoUI.cropNew = null; photoPanelRefresh(); }
function photoCropEnd(){ const id = photoUI.crop; photoUI.crop = null; if (id) photoRepaintAll(id); photoPanelRefresh(); }

document.addEventListener('pointerdown', e => {   // щелчок мимо фото, блока «Фото» и рамки обрезки
  if (!photoUI.sel && !photoUI.crop) return;
  if (e.target && e.target.closest && e.target.closest('.ph-hit, .ph-bar, .ph-crop, .ph-panel, .ph-angle')) return;
  photoDeselect();
}, true);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && photoUI.crop){ e.preventDefault(); e.stopPropagation(); photoCropEnd(); }
  else if (e.key === 'Escape' && photoUI.sel && !document.querySelector('.overlay.open, .dd-list')) photoDeselect();   // этап 10.9.6.4: как у слоёв картинки
}, true);

/* Вызывается из paintPhotoLayer (photos.js) при каждой перерисовке: рамка выделения, а при обрезке — подсказка с «Готово» и ручки */
function photoEditSync(L, holder, sl, b, box, k){
  const id = b.id, cropping = box.cropping, hit = L.querySelector('.ph-hit');
  if (hit) hit.classList.toggle('sel', !photoUI.dragging && photoUI.sel === id && !cropping);
  if (hit) hit.classList.toggle('rotating', !!photoUI.rotating && photoUI.rotating.id === id);
  let bar = L.querySelector('.ph-bar');
  if (cropping && !bar){ bar = photoBuildBar(id); L.append(bar); }
  if (!cropping && bar) bar.remove();
  const cl = L.querySelector('.ph-crop');
  if (cropping) photoCropSync(L, b, box, k); else if (cl) cl.remove();
  if (!cropping) return;
  if (matchMedia('(max-width:760px)').matches){ bar.style.left = bar.style.top = ''; return; }   // на телефоне — снизу экрана (css)
  const w = bar.offsetWidth, hgt = bar.offsetHeight, cx = box.left * k + box.width * k / 2;
  bar.style.left = Math.max(0, Math.min(holder.clientWidth - w, cx - w / 2)) + 'px';
  bar.style.top = Math.max(4, box.top * k - hgt - 8) + 'px';
}
function photoBuildBar(id){
  return h('div', { class:'ph-bar', role:'toolbar', 'aria-label':'Обрезка фото' },
    h('span', { class:'ph-hint', text:'Тяните за края. Esc — готово' }),
    h('button', { type:'button', class:'ph-b ph-b-done', title:'Закончить обрезку', onclick:() => photoCropEnd() }, 'Готово'));
}

/* Строка «Фильтр, Обрезать, отражение» (этап 10.9.6.4): маленький список фильтров и кнопки в одну строку */
function fxToolsRow(...x){ return h('div', { class:'ph-tools' }, ...x); }
/* «Расширенные настройки» в блоке «Фото»: свёрнуты по умолчанию */
/* 26.11: обработка фото цитаты — вкладками, как у картинки на слайде: «Кадр» (обрезать, отражение, углы у фото с фоном), «Фильтр» (миниатюры 3×3),
   «Обводка», «Тень». Открытая вкладка — общая с картинкой (PIC_TAB_KEY, помнит браузер). Видно всегда, пока фото не скрыто */
const photoFltThumbs = new Map();
function photoFltThumb(a, f){
  const key = a.id + '|' + f + '|' + (f === 'tone' ? photoToneColor() : '');
  if (!photoFltThumbs.has(key)) photoFltThumbs.set(key, photoImage(a).then(img => {
    const W = 88, H = 60, c = document.createElement('canvas'); c.width = W; c.height = H;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, k = Math.max(W / iw, H / ih);
    const g = c.getContext('2d'); g.drawImage(img, (W - iw * k) / 2, 0, iw * k, ih * k);   // по верху: у людей важнее лицо
    if (f !== 'none'){ const d = g.getImageData(0, 0, W, H); filterPixels(d.data, f, photoToneColor()); g.putImageData(d, 0, 0); }
    return c.toDataURL('image/png');
  }).catch(e => { photoFltThumbs.delete(key); throw e; }));
  return photoFltThumbs.get(key);
}
function photoAdvanced(b, a){
  const id = b.id, p = b.photo, cropping = photoUI.crop === id;
  const flip = (k, cls, icon, tip, vert) => h('button', { type:'button', class:'btn small ph-ico ' + cls + (p[k] ? ' on' : ''), title:tip, 'aria-label':tip, 'aria-pressed':p[k] ? 'true' : 'false',
    onclick:() => photoFxSet(id, q => { if (q[k]) delete q[k]; else q[k] = true; photoMirrorFx(q, vert); photoPanelRefresh(); }) }, ic(icon));
  const fbtn = ([v, t]) => {
    const im = h('span', { class:'pic-flt-img' }), on = (p.filter || 'none') === v;
    photoFltThumb(a, v).then(u => { im.style.backgroundImage = 'url(' + u + ')'; }).catch(() => {});
    return h('button', { type:'button', class:'pic-flt ph-flt' + (on ? ' on' : ''), 'data-f':v, title:t, 'aria-pressed':on ? 'true' : 'false',
      onclick:e => { const btn = e.currentTarget; btn.parentNode.querySelectorAll('.pic-flt').forEach(x => { x.classList.toggle('on', x === btn); x.setAttribute('aria-pressed', x === btn ? 'true' : 'false'); });
        photoFxSet(id, q => { q.filter = v; }); } }, im, h('span', { class:'pic-flt-name', text:t }));
  };
  const panes = {
    frame:[h('div', { class:'pic-frame-row ph-tools' },
        h('button', { type:'button', class:'btn small ph-crop-btn' + (cropping ? ' on' : ''), title:cropping ? 'Закончить обрезку' : 'Обрезать: ручки по краям фото на слайде',
          onclick:() => cropping ? photoCropEnd() : photoCropStart(id) }, ic('crop'), cropping ? 'Готово' : 'Обрезать'),
        flip('flipH', 'ph-flip', 'fliph', 'Отразить по горизонтали', false), flip('flipV', 'ph-flipv', 'flipv', 'Отразить по вертикали', true)),
      ...(a.kind === 'bg' ? photoToolBody('round', id, b) : [])],
    filter:[h('div', { class:'pic-flts ph-flts' }, PHOTO_FILTERS.map(fbtn))],
    out:photoToolBody('out', id, b),
    shadow:shadowRows(() => blockById(id).photo.shadow || 0, v => photoFxSet(id, q => { if (v) q.shadow = v; else delete q.shadow; }), 'Сила')
  };
  let act = cropping ? 'frame' : picTabGet();
  const paneEls = {}, tabEls = {};
  PIC_TABS.forEach(([k]) => { paneEls[k] = h('div', { class:'pic-pane pic-pane-' + k, role:'tabpanel', hidden:k !== act ? true : null }, ...panes[k]); });
  const tabs = h('div', { class:'pic-tabs', role:'tablist' }, PIC_TABS.map(([k, t, icon]) => tabEls[k] = h('button', { type:'button', role:'tab', class:'pic-tab' + (k === act ? ' on' : ''), 'data-tab':k,
    'aria-selected':k === act ? 'true' : 'false', onclick:() => {
      act = k; picTabSave(k);
      PIC_TABS.forEach(([j]) => { const on = j === k; tabEls[j].classList.toggle('on', on); tabEls[j].setAttribute('aria-selected', on ? 'true' : 'false'); paneEls[j].hidden = !on; });
    } }, ic(icon), h('span', { text:t }))));
  return h('div', { class:'ph-adv' }, tabs, h('div', { class:'pic-panes' }, PIC_TABS.map(([k]) => paneEls[k])));
}
/* Любой цвет и пипетка (после готовых кружков): get() — текущий цвет, apply(hex) — применить. Пипетка — EyeDropper API (Chrome, Edge, Opera); где его нет, кнопки нет */
function colorExtras(get, apply){
  const mark = (el, c) => el.parentNode && el.parentNode.querySelectorAll('.ph-sw').forEach(x => x.classList.toggle('on', (x.title || '').toLowerCase() === c));
  const any = h('input', { type:'color', class:'ph-color', value:get(), title:'Любой цвет', 'aria-label':'Любой цвет',
    oninput:e => { const c = e.target.value.toLowerCase(); mark(any, c); apply(c); } });
  const out = [any];
  if (typeof window.EyeDropper === 'function'){
    out.push(h('button', { type:'button', class:'ph-pipette', title:'Пипетка: взять цвет с экрана', 'aria-label':'Пипетка',
      onclick:async () => { try { const r = await new window.EyeDropper().open(), c = String(r.sRGBHex).toLowerCase(); any.value = c; mark(any, c); apply(c); } catch(e){ /* закрыли без выбора */ } } }, ic('pipette')));
  }
  return out;
}
/* Обводка (этап 10.9.6.3): толщина и цвет независимы — цвет не трогает толщину, и выбранный цвет остаётся, пока не выбран другой (в том числе при 0 px).
   get() — {w, color} или пусто, set(w, color) — записать; cls — класс ползунка */
function outlineRows(get, set, cls, tip, label){
  const o = () => get() || { w:0, color:PHOTO_OUT.color };
  const val = h('span', { class:'ph-val', text:o().w + ' px' });
  const range = h('input', { type:'range', class:'ph-range ' + cls, min:0, max:PHOTO_OUT.max, step:1, value:o().w, 'aria-label':'Толщина обводки',
    oninput:e => { val.textContent = e.target.value + ' px'; set(+e.target.value, o().color); } });
  const sw = c => h('button', { type:'button', class:'ph-sw' + (o().color === c ? ' on' : ''), style:'background:' + c, title:c, 'aria-label':'Цвет ' + c,
    onclick:e => { set(o().w, c); e.currentTarget.parentNode.querySelectorAll('.ph-sw').forEach(x => x.classList.toggle('on', x === e.currentTarget)); } });
  return [h('div', { class:'ph-row' }, h('span', { class:'ph-lbl', text:label || 'Обводка' }), range, val),
    h('div', { class:'ph-sws', title:tip || null }, PHOTO_PALETTE.map(sw), ...colorExtras(() => o().color, c => set(o().w, c)))];
}
function photoToolBody(name, id, b){
  const p = b.photo, row = (label, ...kids) => h('div', { class:'ph-row' }, h('span', { class:'ph-lbl', text:label }), ...kids);
  if (name === 'out'){
    const a = bankEntry(p.id);
    return outlineRows(() => blockById(id).photo.outline, (w, color) => photoFxSet(id, q => { if (w > 0 || color !== PHOTO_OUT.color) q.outline = { w, color }; else delete q.outline; }),
      'ph-ow', a && a.kind === 'bg' ? 'По краю кадра' : 'По силуэту');
  }
  if (name === 'round'){
    const val = h('span', { class:'ph-val', text:Math.round((p.round || 0) * 100) + ' %' });
    return [row('Углы', h('input', { type:'range', class:'ph-range ph-rd', min:0, max:50, step:1, value:Math.round((p.round || 0) * 100), 'aria-label':'Скругление углов',
      oninput:e => { const v = +e.target.value; val.textContent = v + ' %'; photoFxSet(id, q => { if (v) q.round = v / 100; else delete q.round; }); } }), val)];
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
  const F = box.F, V = box.V, c = b.photo.crop || { l:0, t:0, r:0, b:0 }, key = variantKey(box.entry, b.photo.filter, box.flip, box.flipV), v = photoVars.get(key);
  if (!v) photoVariant(box.entry, b.photo.filter, box.flip, box.flipV).then(() => photoRepaintAll(b.id)).catch(() => {});
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

/* ----- Поворот круглой стрелкой над выделенным фото (этап 10.5.7, как в Canva) -----
   Тянут стрелку — фото крутится вокруг середины видимой части. Прилипает к 0°, 90°, 180°, −90° (порог PHOTO_MAGNET), Alt — без привязки;
   рядом со стрелкой виден угол. Пока крутят, на слайде поворачивается уже готовая картинка (photoRotPreview в photos.js),
   новая с правками готовится, когда отпустили. Модель — photo.rot (−180…180, по часовой) */
function photoRotSnap(v, free){
  v = ((v + 180) % 360 + 360) % 360 - 180;   // −180…180
  if (!free){ const t = PHOTO_ROT_SNAP.find(t => Math.abs(v - t) <= PHOTO_MAGNET); if (t != null) v = t; }
  v = Math.round(v);
  if (v === -180) v = 180;
  return v;
}
function photoRotDrag(e, id){
  const b = blockById(id); if (!b || !b.photo || readOnly() || (e.button != null && e.button !== 0)) return;
  e.preventDefault(); e.stopPropagation();
  const box = photoBox(b), hit = e.currentTarget.closest('.ph-hit'); if (!box || !hit) return;
  const now = photoUrlNow(b, box), r = hit.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const base = b.photo.rot || 0, a0 = Math.atan2(e.clientY - cy, e.clientX - cx), knob = e.currentTarget, L = hit.closest('.ph-layer');
  knob.setPointerCapture(e.pointerId);
  photoUI.rotating = { id, base, url:now ? now.url : null, rect:now ? now.rect : null };
  let tag = L.querySelector('.ph-angle'); if (!tag){ tag = h('div', { class:'ph-angle' }); L.append(tag); }
  const lr = L.getBoundingClientRect();
  const show = (v, ev) => { tag.textContent = v + '°'; tag.hidden = false; tag.style.left = (ev.clientX - lr.left + 16) + 'px'; tag.style.top = (ev.clientY - lr.top - 34) + 'px'; };
  show(base, e);
  let moved = false;
  const move = ev => {
    const a = Math.atan2(ev.clientY - cy, ev.clientX - cx), v = photoRotSnap(base + (a - a0) * 180 / Math.PI, ev.altKey);
    moved = true;
    if (v) b.photo.rot = v; else delete b.photo.rot;
    show(v, ev);
    photoRepaintAll(id);
  };
  const up = () => {
    knob.removeEventListener('pointermove', move); knob.removeEventListener('pointerup', up); knob.removeEventListener('pointercancel', up);
    photoUI.rotating = null; tag.remove();
    if (moved && (b.photo.rot || 0) !== base){ change(); updateCounter(b); }
    photoRepaintAll(id);
  };
  knob.addEventListener('pointermove', move); knob.addEventListener('pointerup', up); knob.addEventListener('pointercancel', up);
}
