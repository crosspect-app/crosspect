'use strict';

/* ========= Картинки конспекта (этап 10.9.1) =========
   У блока «Картинка» режим «Загрузить»: файл с компьютера или телефона сжимается в WebP (не больше 900 КБ, до 2560 px по
   длинной стороне — pbLoadImage / pbEncode из photobank.js) и кладётся в облако рядом с конспектом:
   spaces/{s}/sermons/{id}/slideImages/{imageId} (cloud-api.mjs: putSlideImage, slideImage). Сама картинка не меняется: «Заменить» кладёт новую;
   прежняя остаётся, пока на неё ссылается история сохранений, «сирот» ночью стирает cloud/scripts/admin.mjs purge-trash.
   Этап 10.9.2: на слайде — слои b.layers снизу вверх (model.js, normPicLayers): картинки { kind:'pic', imageId, imgW, imgH, pic, place, shadow }
   и рамки текста { kind:'text', text, x, y, w, size, bold, color, align }. Правки картинки (обрезка, поворот, фильтр, обводка) вшиваются
   в неё (picRender), тень — CSS (shadowCss), поэтому лента, сцена, показ, JPEG и PowerPoint получают одно и то же.
   Положение картинки place (normPicPlace): null — целиком внутри полей, { cover:true } — на весь слайд, { x, y, w } — своё (этап 10.9.1.2).
   Слои двигают мышью на большом слайде (picDrag — картинка, ptDrag — текст), привязки — к краям и середине слайда, полям и краям других слоёв.
   Скачанные картинки — в кеше браузера (IndexedDB, тот же, что у фотобанка, ключ slide:<id>): второй раз из облака не качаются.

   Своя заставка картинкой (этап 10.9.1.1): при «Своей заставке» можно загрузить одну картинку на все заставки конспекта
   (state.settings.customSplashImage { imageId, imgW, imgH }, model.js). Файл — тот же путь: WebP в slideImages рядом с конспектом.
   Картинка на весь слайд (лишнее по краям срезается), правок нет. Заставка с картинкой — слайд, который форма рисует сама. */

const PIC_MAX_SIDE = 2560;
const PIC_KEY = id => 'slide:' + id;
const splashOwnImage = () => { const x = state && state.settings && state.settings.customSplashImage; return x && typeof x.imageId === 'string' && x.imageId ? x : null; };
/* Слои «Картинки» в режиме «Загрузить» (снизу вверх) */
const picLayers = b => b && b.type === 'image' && b.mode === 'upload' && Array.isArray(b.layers) ? b.layers : [];
/* Что форма рисует на слайде: слои «Картинки» или картинка своей заставки (cover — на весь слайд, без правок) */
function picItems(b){
  if (!b) return [];
  if (b.type === 'image') return picLayers(b);
  if (b.type === 'splash' && !b.meta && (isCustomSplash(b) || isBgSplash(b))){ const x = splashImage(); if (x) return [{ kind:'pic', id:'splash', imageId:x.imageId, imgW:x.imgW, imgH:x.imgH, cover:true }]; }
  return [];
}
const picItem = (b, lid) => picItems(b).find(l => l.id === lid) || null;
const picCount = b => picLayers(b).filter(l => l.kind === 'pic').length;
const picOn = b => picItems(b).length > 0 && !isBgSplash(b);   // «Свой фон» (10.9.2.1): картинка лежит под текстом заставки — слайд остаётся текстовым
/* Слайд, который форма рисует: с текстом (PREVIEW) или с картинками */
const slideDrawn = b => !!b && (!!PREVIEW[b.type] || picOn(b));
const picSpace = () => (state && state.cloudSpace) || cloud.space;
/* Картинки фона заставки серий (этап 10.9.3) лежат не у конспекта, а в пространстве: spaces/{s}/seriesImages/{id}.
   PIC_SERIES: id картинки → пространство; заполняют space.js (серии пришли из облака) и загрузка в окне «Серии проповедей» */
const PIC_SERIES = new Map();
function picSeriesReg(map, space){
  Object.keys(map || {}).forEach(k => { const x = map[k] && map[k].splash; if (x && x.imageId && space) PIC_SERIES.set(x.imageId, space); });
}
/* Тень (этап 10.9.2) у картинок слайда и фото цитаты: сила 1…100, в px кадра 1920×1080 */
const shadowCss = s => s > 0 ? 'drop-shadow(0 ' + (4 + s * 0.2).toFixed(1) + 'px ' + (6 + s * 0.44).toFixed(1) + 'px rgba(0,0,0,' + (0.25 + s * 0.006).toFixed(3) + '))' : '';
/* Строки «Тень» для панели: галочка и сила. cur() — сила сейчас (0 — без тени), set(v) — записать */
function shadowRows(cur, set){
  const v0 = cur(), val = h('span', { class:'ph-val', text:(v0 || 50) + ' %' });
  const rng = h('input', { type:'range', class:'ph-range sh-range', min:1, max:100, step:1, value:v0 || 50, disabled:v0 ? null : true, 'aria-label':'Сила тени',
    oninput:e => { val.textContent = e.target.value + ' %'; set(+e.target.value); } });
  const box = h('input', { type:'checkbox', class:'sh-on', checked:v0 ? true : null, onchange:e => { rng.disabled = !e.target.checked; set(e.target.checked ? +rng.value : 0); } });
  return [h('div', { class:'ph-row sh-row' }, h('label', { class:'ph-lbl sh-lbl' }, box, 'Тень'), rng, val)];
}

/* ----- Картинка из облака ----- */
const picImgs = new Map();     // imageId → Promise<HTMLImageElement>
const picErr = new Map();      // imageId → текст ошибки (картинки нет в облаке, нет связи)
const picMissAt = new Map();   // imageId → когда облако ответило «нет такой»: 30 секунд не спрашиваем снова
function picImage(id){
  if (!picImgs.has(id) && Date.now() - (picMissAt.get(id) || 0) < 30000) return Promise.reject(Object.assign(new Error(picErr.get(id) || 'нет картинки'), { code:'missing' }));
  if (!picImgs.has(id)) picImgs.set(id, (async () => {
    let bl = await photoIdb.get(PIC_KEY(id));
    if (!bl){
      const ser = PIC_SERIES.get(id);
      if (!cloudOn() || (!state && !ser)) throw new Error('нет связи с облаком');
      const r = ser ? await cloud.api.seriesImage(ser, id) : await cloud.api.slideImage(picSpace(), state.id, id);
      if (!r) throw Object.assign(new Error('Картинки нет в облаке. Загрузите её заново.'), { code:'missing' });
      bl = new Blob([r.bytes], { type:imgMime(r.bytes) });
      photoIdb.put(PIC_KEY(id), bl);
    }
    picMissAt.delete(id);
    const url = URL.createObjectURL(bl);
    const im = await new Promise((res, rej) => { const x = new Image(); x.onload = () => res(x); x.onerror = () => rej(new Error('картинка не открылась')); x.src = url; });
    picErr.delete(id);
    return im;
  })().catch(e => {
    picImgs.delete(id);
    if (e && e.code === 'missing') picMissAt.set(id, Date.now());
    picErr.set(id, e && e.code === 'missing' ? e.message : 'Картинка не загрузилась: ' + (cloudExplain(e) || 'нет связи'));
    throw e;
  }));
  return picImgs.get(id);
}

/* ----- Картинка с правками (S — слой-картинка или картинка заставки) ----- */
/* Поля слайда, внутри которых стоит картинка, в пикселях кадра 1920×1080 */
function picArea(){
  const m = slidesCfg().margins, x = PANEL_INSET + m.side, t = PANEL_INSET + m.top;
  return { x, t, w:SL.W - 2 * x, h:SL.H - t - PANEL_INSET - m.bottom };
}
const PIC_CANVAS_MAX = 4096;   // готовая картинка больше кадра: холст не больше 4096 px по длинной стороне, дальше растягивает браузер
const PIC_MIN = 40;            // px кадра: меньше картинку мышью не сделать (короткая сторона видимой части)
/* Рамка готовой картинки на слайде (с поворотом и обводкой), без самих пикселей: по размеру файла.
   k — px кадра на px файла; iw, ih — видимая часть после обрезки до поворота; cx, cy — её середина; rect — прямоугольник готовой картинки
   (может выходить за край слайда: в редакторе это видно полупрозрачным, в выгрузке срезается — .sl-pic с overflow:hidden) */
function picGeom(S){
  if (S.cover) return { cover:true, W:SL.W, H:SL.H, rect:{ left:0, top:0, width:SL.W, height:SL.H } };   // заставка: весь кадр
  const p = S.pic || {}, c = p.crop || { l:0, t:0, r:0, b:0 }, P = S.place || null;
  const sw = S.imgW * (1 - c.l - c.r), sh = S.imgH * (1 - c.t - c.b), th = (p.rot || 0) * Math.PI / 180;
  const cs = Math.abs(Math.cos(th)), sn = Math.abs(Math.sin(th)), ow = p.outline ? p.outline.w : 0;
  let k, cx, cy;
  if (P && P.cover){   // на весь слайд: повёрнутая видимая часть закрывает кадр целиком
    k = Math.max((SL.W * cs + SL.H * sn) / sw, (SL.W * sn + SL.H * cs) / sh); cx = SL.W / 2; cy = SL.H / 2;
  } else if (P){ k = P.w * SL.W / S.imgW; cx = P.x * SL.W; cy = P.y * SL.H; }
  else {   // как в 10.9.1: целиком внутри полей, по середине
    const A = picArea(), RW = sw * cs + sh * sn, RH = sw * sn + sh * cs;
    k = Math.max(0.001, Math.min((A.w - 2 * ow) / RW, (A.h - 2 * ow) / RH)); cx = A.x + A.w / 2; cy = A.t + A.h / 2;
  }
  const iw = sw * k, ih = sh * k, W = iw * cs + ih * sn + 2 * ow, H = iw * sn + ih * cs + 2 * ow;
  return { c, sw, sh, th, k, ow, iw, ih, cx, cy, W, H, mode:P ? (P.cover ? 'cover' : 'free') : 'fit', rect:{ left:cx - W / 2, top:cy - H / 2, width:W, height:H } };
}
/* Ключ готовой картинки: от положения не зависит (двигают — та же картинка), от размера зависит */
const picKey = S => { const p = S.pic || {};
  if (S.cover) return [S.imageId, 'cover'].join('|');   // заставка: от полей слайда и настроек не зависит
  const G = picGeom(S);
  return [S.imageId, JSON.stringify(p.crop || null), p.rot || 0, p.filter || 'none', p.outline ? p.outline.w + p.outline.color : '', Math.round(G.iw), Math.round(G.ih),
    p.filter === 'tone' ? photoToneColor() : ''].join('|'); };
const picVars = new Map(), picOrder = [];   // ключ → { canvas, url } или Promise; последние 40
function picRender(S){
  const key = picKey(S);
  const store = (C, bl, res) => {
    const v = { canvas:C, url:bl ? URL.createObjectURL(bl) : C.toDataURL('image/png'), ready:true };
    picVars.set(key, v); picOrder.push(key);
    while (picOrder.length > 40){ const k = picOrder.shift(), old = picVars.get(k); picVars.delete(k); if (old && old.url && old.url.startsWith('blob:')) URL.revokeObjectURL(old.url); }
    res(v);
  };
  const p = JSON.parse(JSON.stringify(S.pic || {})), G = picGeom(S), f = p.filter || 'none';   // снимок: слой могут поменять, пока картинка готовится
  if (!picVars.has(key)) picVars.set(key, picImage(S.imageId).then(im => {
    if (G.cover){   // заставка: картинка во весь кадр, лишнее по краям срезается
      const C = pbCanvas(G.W, G.H), t = C.getContext('2d'), nw = im.naturalWidth, nh = im.naturalHeight, k = Math.max(G.W / nw, G.H / nh);
      t.imageSmoothingQuality = 'high';
      t.drawImage(im, (G.W - nw * k) / 2, (G.H - nh * k) / 2, nw * k, nh * k);
      return new Promise(res => C.toBlob(bl => store(C, bl, res), 'image/webp', 0.92));
    }
    // обрезанная картинка в размере слайда (огромная — меньше, см. PIC_CANVAS_MAX); фильтр — по пикселям, до обводки (photos.js, filterPixels)
    const r = Math.min(1, PIC_CANVAS_MAX / Math.max(G.W, G.H));
    const iw = Math.max(1, Math.round(G.iw * r)), ih = Math.max(1, Math.round(G.ih * r)), ow = G.ow * r;
    const P = pbCanvas(iw, ih), g = P.getContext('2d', { willReadFrequently:f !== 'none' });
    g.imageSmoothingQuality = 'high';
    const nw = im.naturalWidth, nh = im.naturalHeight;
    g.drawImage(im, G.c.l * nw, G.c.t * nh, (1 - G.c.l - G.c.r) * nw, (1 - G.c.t - G.c.b) * nh, 0, 0, iw, ih);
    if (f !== 'none'){ const px = g.getImageData(0, 0, iw, ih); filterPixels(px.data, f, photoToneColor()); g.putImageData(px, 0, 0); }
    const C = pbCanvas(Math.max(1, Math.round(G.W * r)), Math.max(1, Math.round(G.H * r))), t = C.getContext('2d');
    t.imageSmoothingQuality = 'high';
    t.translate(C.width / 2, C.height / 2); t.rotate(G.th);
    if (ow > 0){ t.fillStyle = p.outline.color; t.fillRect(-iw / 2 - ow, -ih / 2 - ow, iw + 2 * ow, ih + 2 * ow); }
    t.drawImage(P, -iw / 2, -ih / 2);
    return new Promise(res => C.toBlob(bl => store(C, bl, res), 'image/webp', 0.92));
  }).catch(e => { picVars.delete(key); throw e; }));
  return picVars.get(key);
}
/* Для JPEG и PowerPoint: дождаться всех картинок слайда. Map id слоя → готовая картинка (не загрузилась — нет в Map).
   Где она стоит на слайде — picGeom(picItem(b, id)).rect */
async function picReady(b){
  const out = new Map();
  for (const l of picItems(b)) if (l.kind === 'pic'){ try { out.set(l.id, await picRender(l)); } catch(e){} }
  return out;
}

/* ----- На слайде ----- */
/* fitSlide (preview.js) зовёт для слайда с картинками: в .sl-pic по слою — img (картинка) или .sl-ptext (текст), в порядке слоёв.
   Пока картинка готовится — прежняя в новой рамке или ничего. Пока картинку тянут мышью (picUI.drag), новая не готовится:
   прежняя растягивается, новая — когда отпустили */
const picLast = new Map();   // id блока:id слоя → { url, imageId }
const picUI = { drag:null, sel:new Map() };   // drag — id слоя, который тянут; sel — id блока → id выбранного слоя
const picPx = (el, R, k) => Object.assign(el.style, { display:'block', left:R.left * k + 'px', top:R.top * k + 'px', width:R.width * k + 'px', height:R.height * k + 'px' });
function picPaint(sl, b){
  const box = sl.querySelector('.sl-pic'); if (!box) return;
  const items = picItems(b), byId = new Map();
  [...box.children].forEach(c => { const l = items.find(x => x.id === c.dataset.l); if (!l || (l.kind === 'pic') !== (c.tagName === 'IMG')) c.remove(); else byId.set(l.id, c); });
  items.forEach((l, i) => {
    let c = byId.get(l.id);
    if (!c) c = l.kind === 'pic' ? h('img', { alt:'', 'data-l':l.id }) : h('div', { class:'sl-ptext', 'data-l':l.id });
    if (box.children[i] !== c) box.insertBefore(c, box.children[i] || null);
    if (l.kind === 'pic') picPaintImg(c, b, l); else ptPaint(c, l);
  });
  const holder = sl.parentNode && sl.parentNode.classList && sl.parentNode.classList.contains('stage-slide') ? sl.parentNode : null;
  if (holder) picPaintLayer(holder, sl, b, items);
}
function picPaintImg(im, b, l){
  const key = picKey(l), v = picVars.get(key), G = picGeom(l), lk = b.id + ':' + l.id;
  let url = null;
  if (v && v.ready){ url = v.url; picLast.set(lk, { url, imageId:l.imageId }); }
  else { const last = picLast.get(lk); if (last && last.imageId === l.imageId) url = last.url; }   // правки ещё готовятся: прежняя картинка в новой рамке
  if (url){ if (im.getAttribute('src') !== url) im.src = url; picPx(im, G.rect, 1); im.style.filter = shadowCss(l.shadow || 0); }
  else { im.removeAttribute('src'); im.style.display = 'none'; }
  im._url = url;
  if (!v && picUI.drag !== l.id) picRender(l).then(() => picRepaintAll(b.id)).catch(() => { picPanelRefresh(b.id); splashPanelRefresh(); });
}
/* Рамка текста: середина (x, y) и ширина — в долях слайда, высота — по тексту */
function ptPaint(el, l){
  if (el.textContent !== l.text) el.textContent = l.text;
  Object.assign(el.style, { left:l.x * SL.W + 'px', top:l.y * SL.H + 'px', width:l.w * SL.W + 'px', fontSize:l.size + 'px', fontWeight:l.bold ? '700' : '400',
    color:l.color, textAlign:l.align });
}
/* Перерисовать слои на всех слайдах этого блока (лента, сцена, вид «Текст», показ) */
function picRepaintAll(id){
  document.querySelectorAll('.sl[data-id="' + id + '"]').forEach(sl => {
    const b = typeof unitById === 'function' ? unitById(id) : null;
    if (picItems(b).length) picPaint(sl, b);
  });
}

/* ----- Двигать и менять размер мышью (этапы 10.9.1.2, 10.9.2) -----
   Слой на большом слайде в правке (.pic-layer в .stage-slide, в JPEG не попадает): полупрозрачные части картинок за краем слайда и
   по рамке на каждый слой (.pic-hit, в порядке слоёв) с ручками: у картинки — углы и края (пропорции сохраняются), у текста — левый и правый край.
   Нажали на слой — он выбран (picUI.sel), его настройки раскрыты в «Редакторе». Привязки (порог TB_SNAP, textframe.js): края — к краям слайда,
   внутреннему краю его рамки, полям и краям других слоёв; середина — к середине слайда и других слоёв. Зажатый Alt (Option) — без привязок */
const PIC_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const picSelId = b => { const items = picLayers(b), s = picUI.sel.get(b.id); return items.some(l => l.id === s) ? s : items.length ? items[items.length - 1].id : null; };
/* Рамка текста на слайде в px кадра: по самому тексту на этом слайде (пустой — не ниже 60 px) */
function ptRect(sl, l){
  const el = sl && sl.querySelector('.sl-pic [data-l="' + l.id + '"]'), w = l.w * SL.W, hh = Math.max(60, el ? el.offsetHeight : l.size * 1.2);
  return { left:l.x * SL.W - w / 2, top:l.y * SL.H - hh / 2, width:w, height:hh };
}
const layerRect = (sl, l) => l.kind === 'pic' ? picGeom(l).rect : ptRect(sl, l);
function picPaintLayer(holder, sl, b, items){
  let L = holder.querySelector(':scope > .pic-layer');
  const on = b.type === 'image' && !readOnly() && items.length > 0;
  holder.classList.toggle('pic-on', on);
  if (!on){ if (L) L.remove(); return; }
  if (!L){ L = h('div', { class:'pic-layer', 'aria-hidden':'true' }, h('div', { class:'pic-ghost' }), h('div', { class:'pic-hits' })); holder.append(L); }
  const k = sl.clientWidth / SL.W, ghost = L.querySelector('.pic-ghost'), hits = L.querySelector('.pic-hits'), sel = picSelId(b);
  const pics = items.filter(l => l.kind === 'pic');
  // полупрозрачные части за краем: по картинке на слой, в том же порядке
  [...ghost.children].forEach(c => { if (!pics.some(l => l.id === c.dataset.l)) c.remove(); });
  pics.forEach((l, i) => {
    let g = ghost.querySelector('[data-l="' + l.id + '"]'); if (!g) g = h('img', { alt:'', 'data-l':l.id });
    if (ghost.children[i] !== g) ghost.insertBefore(g, ghost.children[i] || null);
    const url = (sl.querySelector('.sl-pic img[data-l="' + l.id + '"]') || {})._url;
    if (url){ if (g.getAttribute('src') !== url) g.src = url; picPx(g, picGeom(l).rect, k); } else g.style.display = 'none';
  });
  [...hits.children].forEach(c => { const l = items.find(x => x.id === c.dataset.l); if (!l || c.dataset.kind !== l.kind) c.remove(); });
  items.forEach((l, i) => {
    let hit = hits.querySelector(':scope > [data-l="' + l.id + '"]');
    if (!hit){
      const hs = l.kind === 'pic' ? PIC_HANDLES : ['w', 'e'];
      hit = h('div', { class:'pic-hit ' + (l.kind === 'pic' ? 'pic-hit-pic' : 'pic-hit-text'), 'data-l':l.id, 'data-kind':l.kind,
        title:l.kind === 'pic' ? 'Перетащите картинку. Размер — за края и углы. Alt — без привязок' : 'Перетащите текст. Ширина — за края. Двойной щелчок — править текст. Alt — без привязок' },
        hs.map(c => h('span', { class:'pic-h c-' + c, 'data-c':c })));
      hit.addEventListener('pointerdown', e => layerDrag(e, b.id, l.id));
      if (l.kind === 'text') hit.addEventListener('dblclick', () => ptFocus(b.id, l.id));
    }
    if (hits.children[i] !== hit) hits.insertBefore(hit, hits.children[i] || null);
    hit.classList.toggle('sel', l.id === sel);
    hit.classList.toggle('empty', l.kind === 'text' && !l.text.trim());
    if (l.kind === 'pic'){
      const G = picGeom(l), vw = G.iw + 2 * G.ow, vh = G.ih + 2 * G.ow;
      Object.assign(hit.style, { left:(G.cx - vw / 2) * k + 'px', top:(G.cy - vh / 2) * k + 'px', width:vw * k + 'px', height:vh * k + 'px', transform:G.th ? 'rotate(' + G.th + 'rad)' : '' });
    } else {
      const R = ptRect(sl, l);
      Object.assign(hit.style, { left:R.left * k + 'px', top:R.top * k + 'px', width:R.width * k + 'px', height:R.height * k + 'px', transform:'' });
    }
  });
}
/* Линии привязки: края и середина слайда, поля и другие слои */
function picTargets(b, lid, sl){
  const m = tbMargins(), I = PANEL_INSET;
  const T = { x:{ edges:[0, I, m.x, SL.W - m.x, SL.W - I, SL.W], centers:[SL.W / 2] }, y:{ edges:[0, I, m.t, SL.H - m.b, SL.H - I, SL.H], centers:[SL.H / 2] } };
  picLayers(b).forEach(l => {
    if (l.id === lid) return;
    const R = layerRect(sl, l);
    T.x.edges.push(R.left, R.left + R.width); T.x.centers.push(R.left + R.width / 2);
    T.y.edges.push(R.top, R.top + R.height); T.y.centers.push(R.top + R.height / 2);
  });
  return T;
}
/* Выбрать слой: рамка на слайде и раскрытые настройки в «Редакторе» */
function picSelect(id, lid){
  if (picUI.sel.get(id) === lid) return;
  picUI.sel.set(id, lid); picRepaintAll(id); picPanelRefresh(id);
}
function layerDrag(e, id, lid){
  const b = blockById(id), l = picItem(b, lid); if (!l || readOnly() || e.button !== 0) return;
  const was = picSelId(b);
  picUI.sel.set(id, lid);
  if (was !== lid){ picPanelRefresh(id); e.currentTarget.parentNode.querySelectorAll('.pic-hit').forEach(x => x.classList.toggle('sel', x.dataset.l === lid)); }
  if (l.kind === 'pic') picDrag(e, b, l); else ptDrag(e, b, l);
}
/* Общая часть: захват мыши, перерисовка раз в кадр, по отпускании — запись. step(dx, dy, snap) → линии привязки */
function layerTrack(e, b, l, step, done){
  const hit = e.currentTarget, holder = hit.closest('.stage-slide'), sl = holder && holder.querySelector('.sl'); if (!sl) return null;
  e.preventDefault(); e.stopPropagation();
  const k = sl.clientWidth / SL.W, x0 = e.clientX, y0 = e.clientY, id = b.id;
  hit.setPointerCapture(e.pointerId); hit.classList.add('drag');
  let moved = false, raf = 0;
  const move = ev => {
    const dx = (ev.clientX - x0) / k, dy = (ev.clientY - y0) / k;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    moved = true; picUI.drag = l.id;
    slideGuides(holder, step(dx, dy, !ev.altKey), k);
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; picRepaintAll(id); });
  };
  const up = () => {
    hit.removeEventListener('pointermove', move); hit.removeEventListener('pointerup', up); hit.removeEventListener('pointercancel', up);
    if (raf){ cancelAnimationFrame(raf); raf = 0; }
    hit.classList.remove('drag'); slideGuides(holder, [], k);
    picUI.drag = null;
    if (moved){ done(); change(); updateCounter(b); picPanelRefresh(id); }
    picRepaintAll(id);
  };
  hit.addEventListener('pointermove', move); hit.addEventListener('pointerup', up); hit.addEventListener('pointercancel', up);
  return sl;
}
function picDrag(e, b, l){
  const hd = e.target.dataset && e.target.dataset.c || '';
  const holder = e.currentTarget.closest('.stage-slide'), sl0 = holder && holder.querySelector('.sl');
  const G0 = picGeom(l), T = picTargets(b, l.id, sl0);
  const cs = Math.cos(G0.th), sn = Math.sin(G0.th), straight = Math.abs(Math.sin(2 * G0.th)) < 1e-6;   // 0°, 90°, 180°: края рамки параллельны краям слайда
  const sx = hd.includes('e') ? 1 : hd.includes('w') ? -1 : 0, sy = hd.includes('s') ? 1 : hd.includes('n') ? -1 : 0;
  // во сколько раз можно уменьшить и увеличить: короткая сторона видимой части ≥ PIC_MIN, вся картинка — не шире PIC_PLACE.wMax слайдов
  const fMin = PIC_MIN / Math.max(1, Math.min(G0.iw, G0.ih)), fMax = PIC_PLACE.wMax * SL.W / (l.imgW * G0.k);
  const place0 = l.place ? JSON.parse(JSON.stringify(l.place)) : null;
  layerTrack(e, b, l, (dx, dy, snap) => {
    const g = [];
    let f = 1, cx, cy;
    if (!hd){
      const R = G0.rect;
      const tx = snap && tbSnap([[R.left + dx, 'edges'], [R.left + dx + R.width / 2, 'centers'], [R.left + dx + R.width, 'edges']], T.x);
      if (tx){ dx += tx.d; g.push({ dir:'v', at:tx.at }); }
      const ty = snap && tbSnap([[R.top + dy, 'edges'], [R.top + dy + R.height / 2, 'centers'], [R.top + dy + R.height, 'edges']], T.y);
      if (ty){ dy += ty.d; g.push({ dir:'h', at:ty.at }); }
      cx = G0.cx + dx; cy = G0.cy + dy;
    } else {
      const lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;   // сдвиг мыши вдоль сторон рамки
      const fx = sx ? 1 + sx * lx / G0.iw : -Infinity, fy = sy ? 1 + sy * ly / G0.ih : -Infinity;
      f = Math.max(fx, fy);
      if (snap && straight){   // ровная картинка: двигающийся край липнет к линиям
        const R = G0.rect, cand = [];
        const spanX = f2 => (R.width - 2 * G0.ow) * f2 + 2 * G0.ow, spanY = f2 => (R.height - 2 * G0.ow) * f2 + 2 * G0.ow;
        // по горизонтали двигается край картинки на слайде, если ручка его тянет (с поворотом на 90° стороны меняются местами)
        const turned = Math.abs(sn) > 0.5, mx = turned ? sy * (sn > 0 ? -1 : 1) : sx * (cs > 0 ? 1 : -1), my = turned ? sx * (sn > 0 ? 1 : -1) : sy * (cs > 0 ? 1 : -1);
        const ax2 = mx > 0 ? R.left : R.left + R.width, ay2 = my > 0 ? R.top : R.top + R.height;
        if (mx){ const s = tbSnap([[ax2 + mx * spanX(f), 'edges']], T.x); if (s) cand.push({ d:Math.abs(s.d), f:f + mx * s.d / (R.width - 2 * G0.ow), line:{ dir:'v', at:s.at } }); }
        if (my){ const s = tbSnap([[ay2 + my * spanY(f), 'edges']], T.y); if (s) cand.push({ d:Math.abs(s.d), f:f + my * s.d / (R.height - 2 * G0.ow), line:{ dir:'h', at:s.at } }); }
        cand.sort((a, z) => a.d - z.d);
        if (cand[0]){ f = cand[0].f; g.push(cand[0].line); }
      }
      f = Math.min(fMax, Math.max(fMin, f));
      // середина: неподвижная точка (угол или середина края) в осях картинки — (−sx·iw/2, −sy·ih/2); новая середина сдвигается от неё
      const lcx = sx * G0.iw * (f - 1) / 2, lcy = sy * G0.ih * (f - 1) / 2;
      cx = G0.cx + lcx * cs - lcy * sn; cy = G0.cy + lcx * sn + lcy * cs;
    }
    cx = Math.min(SL.W, Math.max(0, cx)); cy = Math.min(SL.H, Math.max(0, cy));
    l.place = { x:+(cx / SL.W).toFixed(4), y:+(cy / SL.H).toFixed(4), w:+(l.imgW * G0.k * f / SL.W).toFixed(4) };
    return g;
  }, () => { const n = normPicPlace(l.place); if (n) l.place = n; else if (place0) l.place = place0; else delete l.place; });
}
/* Рамка текста: тянуть — двигать, за левый или правый край — ширина (противоположный край стоит) */
function ptDrag(e, b, l){
  const hd = e.target.dataset && e.target.dataset.c || '';
  const holder = e.currentTarget.closest('.stage-slide'), sl0 = holder && holder.querySelector('.sl');
  const R0 = ptRect(sl0, l), T = picTargets(b, l.id, sl0), x0 = l.x, y0 = l.y, w0 = l.w;
  layerTrack(e, b, l, (dx, dy, snap) => {
    const g = [];
    if (!hd){
      const tx = snap && tbSnap([[R0.left + dx, 'edges'], [R0.left + dx + R0.width / 2, 'centers'], [R0.left + dx + R0.width, 'edges']], T.x);
      if (tx){ dx += tx.d; g.push({ dir:'v', at:tx.at }); }
      const ty = snap && tbSnap([[R0.top + dy, 'edges'], [R0.top + dy + R0.height / 2, 'centers'], [R0.top + dy + R0.height, 'edges']], T.y);
      if (ty){ dy += ty.d; g.push({ dir:'h', at:ty.at }); }
      l.x = +Math.min(1, Math.max(0, x0 + dx / SL.W)).toFixed(4); l.y = +Math.min(1, Math.max(0, y0 + dy / SL.H)).toFixed(4);
    } else {
      const s = hd === 'e' ? 1 : -1, fixed = s > 0 ? R0.left : R0.left + R0.width;
      let edge = (s > 0 ? R0.left + R0.width : R0.left) + dx;
      const t = snap && tbSnap([[edge, 'edges']], T.x); if (t){ edge += t.d; g.push({ dir:'v', at:t.at }); }
      const w = Math.min(PIC_TEXT.wMax * SL.W, Math.max(PIC_TEXT.wMin * SL.W, s * (edge - fixed)));
      l.w = +(w / SL.W).toFixed(4); l.x = +Math.min(1, Math.max(0, (fixed + s * w / 2) / SL.W)).toFixed(4);
    }
    return g;
  }, () => { if (!(l.w > 0)) l.w = w0; });
}
/* Двойной щелчок по тексту на слайде — к его полю в «Редакторе» */
function ptFocus(id, lid){
  picSelect(id, lid);
  const el = typeof sideEl !== 'undefined' && sideEl ? sideEl.querySelector('.pic-panel textarea.pt-text') : null;
  if (el){ el.focus(); el.scrollIntoView({ block:'nearest' }); }
}
/* «На весь слайд» (cover) и «Вписать в поля» (null — как в 10.9.1) */
function picPlaceSet(id, lid, place){
  const b = blockById(id), l = picItem(b, lid); if (!l || l.kind !== 'pic' || readOnly()) return;
  if (place) l.place = place; else delete l.place;
  change(); updateCounter(b); picRepaintAll(id); picPanelRefresh(id);
}

/* ----- Загрузка ----- */
const picBusy = new Map();   // id блока → 'prep' | 'up'
/* Файл → WebP не больше 900 КБ → облако рядом с конспектом. Возвращает { imageId, imgW, imgH }; onStage('up') — когда пошла загрузка */
/* series — картинка фона заставки серии (этап 10.9.3): тогда sermon не нужен, файл — в spaces/{space}/seriesImages */
async function picStore(file, sermon, space, onStage, series){
  const im = await pbLoadImage(file);   // photobank.js: понятная ошибка, если файл не картинка
  const k = Math.min(1, PIC_MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
  const cv = pbCanvas(im.naturalWidth * k, im.naturalHeight * k), g = cv.getContext('2d');
  g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, cv.width, cv.height);
  const enc = await pbEncode(cv);   // WebP не больше 900 КБ (Safari — JPEG или PNG, photobank.js)
  const bytes = new Uint8Array(await enc.blob.arrayBuffer()), imageId = (series ? 's' : 'p') + uid();
  onStage('up');
  if (series){ await cloud.api.putSeriesImage(cloud.user, space, imageId, bytes, enc.w, enc.h); PIC_SERIES.set(imageId, space); }
  else await cloud.api.putSlideImage(cloud.user, space, sermon, imageId, bytes, enc.w, enc.h);
  photoIdb.put(PIC_KEY(imageId), enc.blob);
  return { imageId, imgW:enc.w, imgH:enc.h };
}
const picNotSaved = () => { if (editing()) saveNow(); toast('Конспект ещё не сохранился в облаке. Подождите пару секунд и попробуйте снова.'); };
const picNewId = b => { const ids = new Set(picLayers(b).map(l => l.id)); let id; do id = 'l' + uid().replace(/[^a-z0-9]/g, '').slice(-10); while (ids.has(id)); return id; };
/* Где встанет новая картинка: первая — целиком в полях (как в 10.9.1), следующие — вдвое меньше и чуть ниже правее предыдущей */
function picNewPlace(b, l){
  const n = picCount(b); if (!n) return null;
  const G = picGeom(Object.assign({}, l, { place:null })), off = 0.04 * (n % 5);
  return normPicPlace({ x:0.5 + off, y:0.5 + off, w:l.imgW * G.k * 0.5 / SL.W });
}
/* Загрузить файлы: каждый — новый слой поверх; replace — id картинки, которую заменить (положение и тень остаются, правки сбрасываются) */
async function picUpload(b, files, replace){
  files = [...(files || [])].filter(Boolean);
  if (!b || !files.length || readOnly() || picBusy.has(b.id)) return;
  if (!cloudOn() || !state.cloudAt){ picNotSaved(); return; }
  const id = b.id, sermon = state.id, space = picSpace();
  if (replace) files = files.slice(0, 1);
  try {
    for (const file of files){
      picBusy.set(id, 'prep'); picPanelRefresh(id);
      const r = await picStore(file, sermon, space, st => { picBusy.set(id, st); picPanelRefresh(id); });
      const cur = state && state.id === sermon ? blockById(id) : null;
      if (!cur || readOnly()) return;   // ушли с конспекта или правку закрыли: картинка без ссылки уйдёт ночью
      const drawn = picOn(cur);
      cur.mode = 'upload'; if (!Array.isArray(cur.layers)) cur.layers = [];
      const old = replace && cur.layers.find(l => l.id === replace && l.kind === 'pic');
      if (old){ Object.assign(old, r); delete old.pic; }
      else {
        const l = Object.assign({ kind:'pic', id:picNewId(cur) }, r), pl = picNewPlace(cur, l);
        if (pl) l.place = pl;
        cur.layers.push(l); picUI.sel.set(id, l.id);
      }
      // картинку загрузили — слайд готов, как у Писания; если редактор уже решал про этот слайд, его отметка вернётся сама (editor.js)
      if (cur.todo && !(typeof fl !== 'undefined' && fl.map && fl.map[cur.id])) cur.todo = false;
      change(); if (drawn) picRepaintAll(id); else rerender(cur); updateCounter(cur);
    }
  } catch(e){
    toast(e && e.code ? cloudExplain(e) : (e && e.message) || 'Не получилось загрузить картинку.');
  } finally { picBusy.delete(id); picPanelRefresh(id); }
}
function picPick(b, replace){
  const inp = h('input', { type:'file', accept:'image/jpeg,image/png,image/webp', multiple:replace ? null : true, style:'display:none' });
  inp.addEventListener('change', () => { const f = inp.files ? [...inp.files] : []; inp.remove(); if (f.length) picUpload(blockById(b.id), f, replace); });
  document.body.append(inp); inp.click();
}

/* ----- Слои: добавить текст, выше / ниже, удалить ----- */
function picLayersSet(id, fn){
  const b = blockById(id); if (!b || readOnly()) return;
  const drawn = picOn(b);
  if (!Array.isArray(b.layers)) b.layers = [];
  fn(b.layers, b);
  change(); updateCounter(b);
  if (drawn !== picOn(b)) rerender(b); else { picRepaintAll(id); picPanelRefresh(id); }
}
function ptAdd(id){
  picLayersSet(id, (L, b) => {
    const n = L.filter(l => l.kind === 'text').length, l = { kind:'text', id:picNewId(b), text:'', x:0.5, y:+(0.5 + 0.08 * (n % 4)).toFixed(4), w:0.6,
      size:PIC_TEXT.size, color:PIC_TEXT.color, align:'center' };
    b.mode = 'upload'; L.push(l); picUI.sel.set(id, l.id);
  });
  setTimeout(() => { const el = sideEl && sideEl.querySelector('.pic-panel textarea.pt-text'); if (el) el.focus(); }, 0);
}
function layerMove(id, lid, d){
  picLayersSet(id, L => { const i = L.findIndex(l => l.id === lid), j = i + d; if (i < 0 || j < 0 || j >= L.length) return; [L[i], L[j]] = [L[j], L[i]]; });
}
function layerRemove(id, lid){
  picLayersSet(id, L => { const i = L.findIndex(l => l.id === lid); if (i >= 0) L.splice(i, 1); });
}
/* Правка слоя: записать и перерисовать слои на слайдах */
function layerSet(id, lid, fn){
  const b = blockById(id), l = picItem(b, lid); if (!l || readOnly()) return;
  fn(l);
  change(); updateCounter(b); picRepaintAll(id);
}
function picFxSet(id, lid, fn){
  layerSet(id, lid, l => { const p = Object.assign({}, l.pic || {}); fn(p); const n = normPic(p); if (n) l.pic = n; else delete l.pic; });
}

/* ----- Блок «Картинка», режим «Загрузить» ----- */
function picPanelRefresh(id){
  const el = typeof sideEl !== 'undefined' && sideEl ? sideEl.querySelector('.pic-panel') : null;
  if (el && el._id === id){ const b = blockById(id); if (b) picPanelFill(el, b); }
}
function picPanel(b){
  const el = h('div', { class:'pic-panel' }); el._id = b.id;
  picPanelFill(el, b);
  return el;
}
const layerName = (b, l) => { const same = picLayers(b).filter(x => x.kind === l.kind); return (l.kind === 'pic' ? 'Картинка' : 'Текст') + (same.length > 1 ? ' ' + (same.indexOf(l) + 1) : ''); };
function picPanelFill(el, b){
  const busy = picBusy.get(b.id), ro = readOnly(), kids = [], L = picLayers(b), id = b.id;
  const pickBtn = (label, cls, replace) => h('button', { type:'button', class:'btn ' + cls, disabled:ro || busy ? true : null, onclick:() => picPick(b, replace) }, label);
  const drop = zone => {
    if (ro) return zone;
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); const f = e.dataTransfer.files; if (f && f.length) picUpload(blockById(id), f); });
    return zone;
  };
  if (busy) kids.push(h('p', { class:'hint pic-busy', role:'status', text:busy === 'prep' ? 'Готовлю картинку…' : 'Загружаю в облако…' }));
  if (!L.length){
    kids.push(drop(h('div', { class:'pic-drop' }, pickBtn('Выбрать файл', 'primary pic-pick'), h('span', { class:'hint', text:'JPEG, PNG или WebP, можно несколько' }))));
    if (!ro) kids.push(h('div', { class:'pic-acts' }, h('button', { type:'button', class:'btn small pt-add', onclick:() => ptAdd(id) }, 'Добавить текст')));
    el.innerHTML = ''; el.append(...kids); return;
  }
  if (!ro){
    kids.push(drop(h('div', { class:'pic-acts pic-add' }, pickBtn('Добавить картинку', 'small pic-pick'),
      h('button', { type:'button', class:'btn small pt-add', onclick:() => ptAdd(id) }, 'Добавить текст'))));
    kids.push(h('p', { class:'hint pic-move-hint', text:'Картинки и текст можно двигать на слайде мышью, размер — за края и углы.' }));
  }
  const sel = picSelId(b);
  // слои сверху вниз, как их видно на слайде
  [...L].reverse().forEach(l => {
    const i = L.indexOf(l), on = l.id === sel;
    const head = h('div', { class:'ly-head', onclick:e => { if (!e.target.closest('button')) picSelect(id, l.id); } },
      h('span', { class:'ly-name', text:layerName(b, l) }),
      l.kind === 'text' && !on ? h('span', { class:'ly-sub hint', text:l.text.trim().split('\n')[0].slice(0, 40) }) : null,
      !ro && h('span', { class:'ly-btns' },
        h('button', { type:'button', class:'btn small ly-up', disabled:i === L.length - 1 ? true : null, title:'Выше: поверх слоя над ним', 'aria-label':'Выше', onclick:() => layerMove(id, l.id, 1) }, 'Выше'),
        h('button', { type:'button', class:'btn small ly-down', disabled:i === 0 ? true : null, title:'Ниже: под слой под ним', 'aria-label':'Ниже', onclick:() => layerMove(id, l.id, -1) }, 'Ниже'),
        h('button', { type:'button', class:'btn small ly-del', title:'Убрать со слайда', 'aria-label':'Удалить', onclick:() => layerRemove(id, l.id) }, '✕')));
    const card = h('div', { class:'ly-card' + (on ? ' on' : ''), 'data-l':l.id }, head);
    if (on && !ro) card.append(h('div', { class:'ly-body' }, ...(l.kind === 'pic' ? picLayerBody(b, l, pickBtn) : ptLayerBody(b, l))));
    else if (on && ro && l.kind === 'pic' && picErr.get(l.imageId)) card.append(h('p', { class:'pic-err', role:'alert', text:picErr.get(l.imageId) }));
    kids.push(card);
  });
  el.innerHTML = ''; el.append(...kids);
}
const prow = (label, ...x) => h('div', { class:'ph-row' }, h('span', { class:'ph-lbl', text:label }), ...x);
/* Настройки картинки: заменить, обрезать, повернуть, положение, фильтр, обводка, тень */
function picLayerBody(b, l, pickBtn){
  const id = b.id, lid = l.id, p = l.pic || {}, kids = [], cur = () => picItem(blockById(id), lid) || {};
  const err = picErr.get(l.imageId);
  if (err) kids.push(h('p', { class:'pic-err', role:'alert', text:err }));
  const rv = h('span', { class:'ph-val', text:(p.rot || 0) + '°' });
  const rr = h('input', { type:'range', class:'ph-range pic-rot', min:-180, max:180, step:1, value:p.rot || 0, 'aria-label':'Поворот',
    oninput:e => { rv.textContent = e.target.value + '°'; picFxSet(id, lid, q => { q.rot = +e.target.value; }); } });
  const turn = d => () => { const c = (cur().pic || {}).rot || 0; let v = Math.round((c + d) / 90) * 90; if (v > 180) v -= 360; if (v < -180) v += 360; rr.value = v; rv.textContent = v + '°'; picFxSet(id, lid, q => { q.rot = v; }); };
  kids.push(h('div', { class:'pic-acts' }, pickBtn('Заменить', 'small pic-replace', lid),
    h('button', { type:'button', class:'btn small pic-crop', onclick:() => picCropOpen(b, lid) }, 'Обрезать'),
    h('span', { class:'pic-turns' }, h('button', { type:'button', class:'btn small pic-left', title:'Повернуть влево на 90°', 'aria-label':'Повернуть влево на 90°', onclick:turn(-90) }, '↺'),
      h('button', { type:'button', class:'btn small pic-right', title:'Повернуть вправо на 90°', 'aria-label':'Повернуть вправо на 90°', onclick:turn(90) }, '↻'))));
  // этап 10.9.1.2: положение на слайде; нажатая кнопка — та, что сейчас действует
  const pl = l.place, sz = (label, cls, on, place) => h('button', { type:'button', class:'btn small ' + cls + (on ? ' on' : ''), 'aria-pressed':on ? 'true' : 'false', onclick:() => picPlaceSet(id, lid, place) }, label);
  kids.push(h('div', { class:'pic-acts pic-size' }, sz('На весь слайд', 'pic-cover', !!(pl && pl.cover), { cover:true }), sz('Вписать в поля', 'pic-fit', !pl, null)));
  kids.push(prow('Поворот', rr, rv));
  kids.push(prow('Фильтр', h('select', { class:'input pic-filter', 'aria-label':'Фильтр', onchange:e => picFxSet(id, lid, q => { q.filter = e.target.value; }) },
    PHOTO_FILTERS.map(([v, t]) => h('option', { value:v, selected:(p.filter || 'none') === v ? true : null }, t)))));
  const o = () => (cur().pic || {}).outline || { w:0, color:PHOTO_OUT.color };
  const ov = h('span', { class:'ph-val', text:o().w + ' px' });
  const setO = (w, color) => picFxSet(id, lid, q => { if (w > 0) q.outline = { w, color }; else delete q.outline; });
  const orng = h('input', { type:'range', class:'ph-range pic-ow', min:0, max:PHOTO_OUT.max, step:1, value:o().w, 'aria-label':'Толщина обводки',
    oninput:e => { ov.textContent = e.target.value + ' px'; setO(+e.target.value, o().color); } });
  const swatch = c => h('button', { type:'button', class:'ph-sw' + (o().color === c ? ' on' : ''), style:'background:' + c, title:c, 'aria-label':'Цвет ' + c,
    onclick:e => { const w = o().w || 4; orng.value = w; ov.textContent = w + ' px'; setO(w, c); e.currentTarget.parentNode.querySelectorAll('.ph-sw').forEach(x => x.classList.toggle('on', x === e.currentTarget)); } });
  kids.push(prow('Обводка', orng, ov), h('div', { class:'ph-sws' }, PHOTO_PALETTE.map(swatch)));
  kids.push(...shadowRows(() => cur().shadow || 0, v => layerSet(id, lid, x => { if (v) x.shadow = v; else delete x.shadow; })));
  if (l.pic) kids.push(h('div', { class:'ph-acts ph-foot' }, h('button', { type:'button', class:'btn small pic-reset', onclick:() => { layerSet(id, lid, x => { delete x.pic; }); picPanelRefresh(id); } }, 'Сбросить правки')));
  return kids;
}
/* Настройки текста: сам текст, размер, жирный, выравнивание, цвет */
function ptLayerBody(b, l){
  const id = b.id, lid = l.id;
  const ta = h('textarea', { class:'input pt-text', rows:'3', placeholder:'Текст на слайде. Enter — новая строка', 'aria-label':'Текст на слайде',
    oninput:e => { grow(e.target); layerSet(id, lid, x => { x.text = e.target.value.slice(0, PIC_TEXT.max); }); } });
  ta.value = l.text; requestAnimationFrame(() => grow(ta));
  const sv = h('span', { class:'ph-val', text:String(l.size) });
  const size = h('input', { type:'range', class:'ph-range pt-size', min:PIC_TEXT.sizeMin, max:PIC_TEXT.sizeMax, step:2, value:l.size, 'aria-label':'Размер текста',
    oninput:e => { sv.textContent = e.target.value; layerSet(id, lid, x => { x.size = +e.target.value; }); } });
  const bold = sw('Жирный', !!l.bold, v => layerSet(id, lid, x => { if (v) x.bold = true; else delete x.bold; }));
  bold.classList.add('pt-bold');
  const al = toggle([['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа']], l.align, v => { layerSet(id, lid, x => { x.align = v; }); picPanelRefresh(id); });
  al.classList.add('pt-align');
  const swatch = c => h('button', { type:'button', class:'ph-sw' + (l.color === c ? ' on' : ''), style:'background:' + c, title:c, 'aria-label':'Цвет ' + c,
    onclick:e => { layerSet(id, lid, x => { x.color = c; }); e.currentTarget.parentNode.querySelectorAll('.ph-sw').forEach(x => x.classList.toggle('on', x === e.currentTarget)); } });
  return [ta, prow('Размер', size, sv), bold, al, prow('Цвет', h('div', { class:'ph-sws pt-colors' }, PHOTO_PALETTE.map(swatch)))];
}

/* ----- Заставка с картинкой: «Свой фон» и «Картинка целиком» (этапы 10.9.1.1, 10.9.2.1) ----- */
/* Панель в настройках заставки, под выбором режима. all — обновить заставки (preview, лента, кнопка «JPEG») */
let splashBusy = '';
const SPLASH_MODES = [['normal', 'Обычная'], ['bg', 'Свой фон'], ['full', 'Картинка целиком']];
/* Заставка на фоне серии (этап 10.9.3): строка под выбором режима — откуда фон */
function splashSeriesNote(){
  const e = splashEff();
  if (e.from !== 'series') return null;
  const t = (e.mode === 'full' ? 'Заставка — картинка серии «' : 'Заставка — на фоне серии «') + e.series.seriesName + '». Своя картинка конспекта заменит его.';
  return h('p', { class:'hint spic-series', text:t });
}
function splashPanelFill(el){
  const ro = readOnly(), x = splashOwnImage(), kids = [], mode = splashOwnMode();
  const note = splashSeriesNote();
  el.hidden = mode === 'normal' && !note;   // в «Обычной» панель прячется целиком (кроме строки про фон серии)
  if (note) kids.push(note);
  if (mode === 'normal'){ el.innerHTML = ''; el.append(...kids); return; }
  const pick = (label, cls) => h('button', { type:'button', class:'btn ' + cls, disabled:ro || splashBusy ? true : null, onclick:() => splashPick(el) }, label);
  if (splashBusy) kids.push(h('p', { class:'hint pic-busy', role:'status', text:splashBusy === 'prep' ? 'Готовлю картинку…' : 'Загружаю в облако…' }));
  const err = x && picErr.get(x.imageId);
  if (err) kids.push(h('p', { class:'pic-err', role:'alert', text:err }));
  kids.push(h('div', { class:'pic-acts' }, x ? pick('Заменить картинку', 'small spic-replace') : pick('Загрузить картинку', 'primary spic-pick'),
    x && !ro && h('button', { type:'button', class:'btn small spic-del', disabled:splashBusy ? true : null, onclick:() => splashRemove(el) }, 'Удалить картинку')));
  if (mode === 'bg'){
    const val = h('span', { class:'ph-val spic-dim-val', text:splashOwnDim() + ' %' });
    const range = h('input', { type:'range', class:'ph-range spic-dim', min:0, max:SPLASH_DIM_MAX, step:1, value:splashOwnDim(), disabled:ro ? true : null, 'aria-label':'Затемнение',
      oninput:e => { val.textContent = e.target.value + ' %'; splashDimSet(+e.target.value, el._all); } });
    kids.push(h('div', { class:'ph-row' }, h('span', { class:'ph-lbl', text:'Затемнение' }), range, val));
  }
  el.innerHTML = ''; el.append(...kids);
}
function splashPanel(all){
  const el = h('div', { class:'spic-panel' }); el._all = all;
  el.refill = () => splashPanelFill(el);
  splashPanelFill(el);
  return el;
}
const splashPanelEl = () => (typeof sideEl !== 'undefined' && sideEl ? sideEl.querySelector('.spic-panel') : null);
function splashPanelRefresh(){ const el = splashPanelEl(); if (el) splashPanelFill(el); }
/* Режим заставки: «Обычная» / «Свой фон» / «Картинка целиком» — один на все заставки конспекта */
function splashModeSet(m, all){
  if (readOnly() || m === splashOwnMode()) return;
  if (m === 'bg' || m === 'full') state.settings.splashMode = m; else delete state.settings.splashMode;
  change(); if (all) all(); splashPanelRefresh();
}
/* Затемнение «Свой фон»: 0…70 %, одно на все заставки; по умолчанию — SPLASH_DIM_DEF */
function splashDimSet(v, all){
  if (readOnly() || !splashDimOk(v) || v === splashOwnDim()) return;
  state.settings.splashDim = v;
  change(); if (all) all();
}
function splashPick(el){
  if (readOnly() || splashBusy) return;
  const inp = h('input', { type:'file', accept:'image/jpeg,image/png,image/webp', style:'display:none' });
  inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.remove(); if (f) splashUpload(f, el._all); });
  document.body.append(inp); inp.click();
}
async function splashUpload(file, all){
  if (!file || readOnly() || splashBusy) return;
  if (!cloudOn() || !state.cloudAt){ picNotSaved(); return; }
  const sermon = state.id, space = picSpace();
  splashBusy = 'prep'; splashPanelRefresh();
  try {
    const r = await picStore(file, sermon, space, st => { splashBusy = st; splashPanelRefresh(); });
    if (!state || state.id !== sermon || readOnly()) return;   // ушли с конспекта или правку закрыли: картинка без ссылки уйдёт ночью
    state.settings.customSplashImage = r;
    change(); if (all) all();
  } catch(e){
    toast(e && e.code ? cloudExplain(e) : (e && e.message) || 'Не получилось загрузить картинку.');
  } finally { splashBusy = ''; splashPanelRefresh(); }
}
/* «Удалить картинку»: «Картинка целиком» снова серая заглушка, «Свой фон» — обычная заставка; сам файл в облаке стирает ночная уборка, когда на него не ссылаются ни конспект, ни история */
function splashRemove(el){
  if (readOnly() || !splashOwnImage()) return;
  delete state.settings.customSplashImage;
  change(); if (el._all) el._all(); splashPanelRefresh();
}

/* ----- Обрезка: окно с картинкой без правок, рамка с ручками по углам, внутри — двигать ----- */
let PCW = null;   // { id, lid, crop {l,t,r,b} }
async function picCropOpen(b, lid){
  const l = picItem(b, lid); if (!l || l.kind !== 'pic' || readOnly()) return;
  let im; try { im = await picImage(l.imageId); } catch(e){ picPanelRefresh(b.id); toast(picErr.get(l.imageId) || 'Картинка не загрузилась.'); return; }
  PCW = { id:b.id, lid, crop:Object.assign({ l:0, t:0, r:0, b:0 }, (l.pic || {}).crop || {}) };
  const box = h('div', { class:'picc-box' }), img = h('img', { class:'picc-img', src:im.src, alt:'', draggable:'false' });
  const sel = h('div', { class:'picc-sel' }, ['nw', 'ne', 'sw', 'se'].map(c => h('span', { class:'picc-h c-' + c, 'data-c':c })));
  box.append(img, sel);
  const paint = () => { const c = PCW.crop; Object.assign(sel.style, { left:c.l * 100 + '%', top:c.t * 100 + '%', right:c.r * 100 + '%', bottom:c.b * 100 + '%' }); };
  sel.addEventListener('pointerdown', e => {
    e.preventDefault(); sel.setPointerCapture(e.pointerId);
    const R = box.getBoundingClientRect(), c0 = Object.assign({}, PCW.crop), x0 = e.clientX, y0 = e.clientY, hd = e.target.dataset.c || '';
    const M = PHOTO_CROP_MIN, cl = (v, a, z) => Math.min(z, Math.max(a, v));
    const move = ev => {
      const dx = (ev.clientX - x0) / R.width, dy = (ev.clientY - y0) / R.height, c = Object.assign({}, c0);
      if (!hd){ const w = 1 - c0.l - c0.r, hh = 1 - c0.t - c0.b; c.l = cl(c0.l + dx, 0, 1 - w); c.r = 1 - w - c.l; c.t = cl(c0.t + dy, 0, 1 - hh); c.b = 1 - hh - c.t; }
      else {
        if (hd.includes('w')) c.l = cl(c0.l + dx, 0, 1 - c0.r - M);
        if (hd.includes('e')) c.r = cl(c0.r - dx, 0, 1 - c0.l - M);
        if (hd.includes('n')) c.t = cl(c0.t + dy, 0, 1 - c0.b - M);
        if (hd.includes('s')) c.b = cl(c0.b - dy, 0, 1 - c0.t - M);
      }
      PCW.crop = c; paint();
    };
    const up = () => { sel.removeEventListener('pointermove', move); sel.removeEventListener('pointerup', up); sel.removeEventListener('pointercancel', up); };
    sel.addEventListener('pointermove', move); sel.addEventListener('pointerup', up); sel.addEventListener('pointercancel', up);
  });
  const done = () => { const cr = PCW && PCW.crop, id = PCW && PCW.id, lid = PCW && PCW.lid; closeSettings(); if (id) { picFxSet(id, lid, q => { q.crop = cr; }); picPanelRefresh(id); } };
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet picc-sheet', role:'dialog', 'aria-label':'Обрезать картинку' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Обрезать картинку' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('div', { class:'picc-wrap' }, box),
    h('div', { class:'sheet-foot' },
      h('button', { type:'button', class:'btn picc-all', onclick:() => { PCW.crop = { l:0, t:0, r:0, b:0 }; paint(); } }, 'Вся картинка'),
      h('div', { class:'grow' }),
      h('button', { type:'button', class:'btn', onclick:closeSettings }, 'Отмена'),
      h('button', { type:'button', class:'btn primary picc-done', onclick:done }, 'Готово'))));
  settingsOverlay.classList.add('open');
  paint();
}
function picCropStop(){ PCW = null; }
