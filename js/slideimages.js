'use strict';

/* ========= Картинки конспекта (этап 10.9.1) =========
   У блока «Картинка» третий режим «Загрузить»: файл с компьютера или телефона сжимается в WebP (не больше 900 КБ, до 2560 px по
   длинной стороне — pbLoadImage / pbEncode из photobank.js) и кладётся в облако рядом с конспектом:
   spaces/{s}/sermons/{id}/slideImages/{imageId} (cloud-api.mjs: putSlideImage, slideImage). В блоке — imageId, imgW, imgH и правки pic
   (model.js, normPic): обрезка, поворот, фильтр, обводка. Сама картинка не меняется: «Заменить» кладёт новую; прежняя остаётся,
   пока на неё ссылается история сохранений, «сирот» ночью стирает cloud/scripts/admin.mjs purge-trash.
   На слайде картинка стоит целиком внутри полей слайда (те же поля, что у текста), поверх фона; правки вшиваются в картинку
   (picRender), поэтому лента, сцена, показ, JPEG и PowerPoint получают одно и то же. Скачанные картинки — в кеше браузера
   (IndexedDB, тот же, что у фотобанка, ключ slide:<id>): второй раз из облака не качаются.

   Своя заставка картинкой (этап 10.9.1.1): при «Своей заставке» можно загрузить одну картинку на все заставки конспекта
   (state.settings.customSplashImage { imageId, imgW, imgH }, model.js). Файл — тот же путь: WebP в slideImages рядом с конспектом.
   Картинка на весь слайд (лишнее по краям срезается), правок нет. Заставка с картинкой — слайд, который форма рисует сама. */

const PIC_MAX_SIDE = 2560;
const PIC_KEY = id => 'slide:' + id;
/* Слайд с загруженной картинкой: форма рисует его сама, как Писание или цитату */
const splashImage = () => { const x = state && state.settings && state.settings.customSplashImage; return x && typeof x.imageId === 'string' && x.imageId ? x : null; };
/* Откуда слайд берёт картинку: у блока «Картинка» — из блока, у заставки — из настроек конспекта (cover — на весь слайд, без правок) */
function picSrc(b){
  if (!b) return null;
  if (b.type === 'image' && b.mode === 'upload' && typeof b.imageId === 'string' && b.imageId) return { imageId:b.imageId, imgW:b.imgW, imgH:b.imgH, pic:b.pic || {}, cover:false };
  if (b.type === 'splash' && !b.meta && isCustomSplash(b)){ const x = splashImage(); if (x) return { imageId:x.imageId, imgW:x.imgW, imgH:x.imgH, pic:{}, cover:true }; }
  return null;
}
const picOn = b => !!picSrc(b);
/* Слайд, который форма рисует: с текстом (PREVIEW) или с картинкой */
const slideDrawn = b => !!b && (!!PREVIEW[b.type] || picOn(b));
/* Где лежит картинка: пространство открытого конспекта */
const picSpace = () => (state && state.cloudSpace) || cloud.space;

/* ----- Картинка из облака ----- */
const picImgs = new Map();     // imageId → Promise<HTMLImageElement>
const picErr = new Map();      // imageId → текст ошибки (картинки нет в облаке, нет связи)
const picMissAt = new Map();   // imageId → когда облако ответило «нет такой»: 30 секунд не спрашиваем снова
function picImage(id){
  if (!picImgs.has(id) && Date.now() - (picMissAt.get(id) || 0) < 30000) return Promise.reject(Object.assign(new Error(picErr.get(id) || 'нет картинки'), { code:'missing' }));
  if (!picImgs.has(id)) picImgs.set(id, (async () => {
    let bl = await photoIdb.get(PIC_KEY(id));
    if (!bl){
      if (!cloudOn() || !state) throw new Error('нет связи с облаком');
      const r = await cloud.api.slideImage(picSpace(), state.id, id);
      if (!r) throw Object.assign(new Error('Картинки нет в облаке. Загрузите её заново.'), { code:'missing' });
      bl = new Blob([r.bytes], { type:'image/webp' });
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

/* ----- Картинка с правками ----- */
/* Поля слайда, внутри которых стоит картинка, в пикселях кадра 1920×1080 */
function picArea(){
  const m = slidesCfg().margins, x = PANEL_INSET + m.side, t = PANEL_INSET + m.top;
  return { x, t, w:SL.W - 2 * x, h:SL.H - t - PANEL_INSET - m.bottom };
}
const picFx = b => (picSrc(b) || {}).pic || {};
const picKey = b => { const S = picSrc(b), p = picFx(b), A = picArea();
  if (S.cover) return [S.imageId, 'cover'].join('|');   // заставка: от полей слайда и настроек не зависит
  return [S.imageId, JSON.stringify(p.crop || null), p.rot || 0, p.filter || 'none', p.outline ? p.outline.w + p.outline.color : '', A.x, A.t, A.w, A.h,
    p.filter === 'tone' ? photoToneColor() : ''].join('|'); };
const picVars = new Map(), picOrder = [];   // ключ → { canvas, url, rect } или Promise; последние 30
/* Рамка готовой картинки на слайде (с поворотом и обводкой), без самих пикселей: по размеру файла из блока */
function picGeom(b){
  const S = picSrc(b);
  if (S.cover) return { cover:true, W:SL.W, H:SL.H, rect:{ left:0, top:0, width:SL.W, height:SL.H } };   // заставка: весь кадр
  const p = picFx(b), c = p.crop || { l:0, t:0, r:0, b:0 }, A = picArea();
  const sw = S.imgW * (1 - c.l - c.r), sh = S.imgH * (1 - c.t - c.b), th = (p.rot || 0) * Math.PI / 180;
  const cs = Math.abs(Math.cos(th)), sn = Math.abs(Math.sin(th)), RW = sw * cs + sh * sn, RH = sw * sn + sh * cs;
  const ow = p.outline ? p.outline.w : 0, k = Math.max(0.001, Math.min((A.w - 2 * ow) / RW, (A.h - 2 * ow) / RH));
  const W = Math.max(1, Math.round(RW * k + 2 * ow)), H = Math.max(1, Math.round(RH * k + 2 * ow));
  return { c, sw, sh, th, k, ow, W, H, rect:{ left:Math.round(A.x + (A.w - W) / 2), top:Math.round(A.t + (A.h - H) / 2), width:W, height:H } };
}
function picRender(b){
  const key = picKey(b);
  const store = (C, bl, G, res) => {
    const v = { canvas:C, url:bl ? URL.createObjectURL(bl) : C.toDataURL('image/png'), rect:G.rect, ready:true };
    picVars.set(key, v); picOrder.push(key);
    while (picOrder.length > 30){ const k = picOrder.shift(), old = picVars.get(k); picVars.delete(k); if (old && old.url && old.url.startsWith('blob:')) URL.revokeObjectURL(old.url); }
    res(v);
  };
  if (!picVars.has(key)) picVars.set(key, picImage(picSrc(b).imageId).then(im => {
    const p = picFx(b), G = picGeom(b), f = p.filter || 'none';
    if (G.cover){   // заставка: картинка во весь кадр, лишнее по краям срезается
      const C = pbCanvas(G.W, G.H), t = C.getContext('2d'), nw = im.naturalWidth, nh = im.naturalHeight, k = Math.max(G.W / nw, G.H / nh);
      t.imageSmoothingQuality = 'high';
      t.drawImage(im, (G.W - nw * k) / 2, (G.H - nh * k) / 2, nw * k, nh * k);
      return new Promise(res => C.toBlob(bl => store(C, bl, G, res), 'image/webp', 0.92));
    }
    // обрезанная картинка в размере слайда; фильтр — по пикселям, до обводки (photos.js, filterPixels)
    const iw = Math.max(1, Math.round(G.sw * G.k)), ih = Math.max(1, Math.round(G.sh * G.k));
    const P = pbCanvas(iw, ih), g = P.getContext('2d', { willReadFrequently:f !== 'none' });
    g.imageSmoothingQuality = 'high';
    const nw = im.naturalWidth, nh = im.naturalHeight;
    g.drawImage(im, G.c.l * nw, G.c.t * nh, (1 - G.c.l - G.c.r) * nw, (1 - G.c.t - G.c.b) * nh, 0, 0, iw, ih);
    if (f !== 'none'){ const px = g.getImageData(0, 0, iw, ih); filterPixels(px.data, f, photoToneColor()); g.putImageData(px, 0, 0); }
    const C = pbCanvas(G.W, G.H), t = C.getContext('2d');
    t.imageSmoothingQuality = 'high';
    t.translate(G.W / 2, G.H / 2); t.rotate(G.th);
    if (G.ow > 0){ t.fillStyle = p.outline.color; t.fillRect(-iw / 2 - G.ow, -ih / 2 - G.ow, iw + 2 * G.ow, ih + 2 * G.ow); }
    t.drawImage(P, -iw / 2, -ih / 2);
    return new Promise(res => C.toBlob(bl => store(C, bl, G, res), 'image/webp', 0.92));
  }).catch(e => { picVars.delete(key); throw e; }));
  return picVars.get(key);
}
/* Для JPEG и PowerPoint: дождаться картинки с правками; null — у слайда нет картинки или она не загрузилась */
async function picReady(b){
  if (!picOn(b)) return null;
  try { return await picRender(b); } catch(e){ return null; }
}

/* ----- На слайде ----- */
/* fitSlide (preview.js) зовёт для слайда с картинкой: .sl-pic img на месте; пока картинка готовится — прежняя или ничего */
const picLast = new Map();   // id блока → { url, imageId }
function picPaint(sl, b){
  const im = sl.querySelector('.sl-pic img'); if (!im) return;
  const v = picVars.get(picKey(b));
  if (v && v.ready){
    picLast.set(b.id, { url:v.url, imageId:picSrc(b).imageId });
    if (im.getAttribute('src') !== v.url) im.src = v.url;
    Object.assign(im.style, { display:'block', left:v.rect.left + 'px', top:v.rect.top + 'px', width:v.rect.width + 'px', height:v.rect.height + 'px' });
    return;
  }
  const last = picLast.get(b.id), G = picGeom(b);
  if (last && last.imageId === picSrc(b).imageId){   // правки ещё готовятся: прежняя картинка в новой рамке
    if (im.getAttribute('src') !== last.url) im.src = last.url;
    Object.assign(im.style, { display:'block', left:G.rect.left + 'px', top:G.rect.top + 'px', width:G.rect.width + 'px', height:G.rect.height + 'px' });
  } else { im.removeAttribute('src'); im.style.display = 'none'; }
  if (!v) picRender(b).then(() => picRepaintAll(b.id)).catch(() => { picPanelRefresh(b.id); splashPanelRefresh(); });
}
/* Перерисовать картинку на всех слайдах этого блока (лента, сцена, вид «Текст», показ) */
function picRepaintAll(id){
  document.querySelectorAll('.sl[data-id="' + id + '"]').forEach(sl => {
    const b = typeof unitById === 'function' ? unitById(id) : null;
    if (picOn(b)) picPaint(sl, b);
  });
}

/* ----- Загрузка ----- */
const picBusy = new Map();   // id блока → 'prep' | 'up'
/* Файл → WebP не больше 900 КБ → облако рядом с конспектом. Возвращает { imageId, imgW, imgH }; onStage('up') — когда пошла загрузка */
async function picStore(file, sermon, space, onStage){
  const im = await pbLoadImage(file);   // photobank.js: понятная ошибка, если файл не картинка
  const k = Math.min(1, PIC_MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
  const cv = pbCanvas(im.naturalWidth * k, im.naturalHeight * k), g = cv.getContext('2d');
  g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, cv.width, cv.height);
  const enc = await pbEncode(cv);   // WebP не больше 900 КБ
  const bytes = new Uint8Array(await enc.blob.arrayBuffer()), imageId = 'p' + uid();
  onStage('up');
  await cloud.api.putSlideImage(cloud.user, space, sermon, imageId, bytes, enc.w, enc.h);
  photoIdb.put(PIC_KEY(imageId), enc.blob);
  return { imageId, imgW:enc.w, imgH:enc.h };
}
const picNotSaved = () => { if (editing()) saveNow(); toast('Конспект ещё не сохранился в облаке. Подождите пару секунд и попробуйте снова.'); };
async function picUpload(b, file){
  if (!b || !file || readOnly() || picBusy.has(b.id)) return;
  if (!cloudOn() || !state.cloudAt){ picNotSaved(); return; }
  const id = b.id, sermon = state.id, space = picSpace();
  picBusy.set(id, 'prep'); picPanelRefresh(id);
  try {
    const r = await picStore(file, sermon, space, st => { picBusy.set(id, st); picPanelRefresh(id); });
    const cur = state && state.id === sermon ? blockById(id) : null;
    if (!cur || readOnly()) return;   // ушли с конспекта или правку закрыли: картинка без ссылки уйдёт ночью
    Object.assign(cur, { mode:'upload' }, r); delete cur.pic;
    // картинку загрузили — слайд готов, как у Писания; если редактор уже решал про этот слайд, его отметка вернётся сама (editor.js)
    if (cur.todo && !(typeof fl !== 'undefined' && fl.map && fl.map[cur.id])) cur.todo = false;
    picBusy.delete(id);
    change(); rerender(cur); updateCounter(cur);
  } catch(e){
    toast(e && e.code ? cloudExplain(e) : (e && e.message) || 'Не получилось загрузить картинку.');
  } finally { picBusy.delete(id); picPanelRefresh(id); }
}
function picPick(b){
  const inp = h('input', { type:'file', accept:'image/jpeg,image/png,image/webp', style:'display:none' });
  inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.remove(); if (f) picUpload(blockById(b.id), f); });
  document.body.append(inp); inp.click();
}

/* ----- Блок «Картинка», режим «Загрузить» ----- */
/* Правка: записать и перерисовать картинку на слайдах */
function picFxSet(id, fn){
  const b = blockById(id); if (!picOn(b) || readOnly()) return;
  const p = Object.assign({}, b.pic || {}); fn(p);
  const n = normPic(p); if (n) b.pic = n; else delete b.pic;
  change(); updateCounter(b); picRepaintAll(id);
}
function picPanelRefresh(id){
  const el = typeof sideEl !== 'undefined' && sideEl ? sideEl.querySelector('.pic-panel') : null;
  if (el && el._id === id){ const b = blockById(id); if (b) picPanelFill(el, b); }
}
function picPanel(b){
  const el = h('div', { class:'pic-panel' }); el._id = b.id;
  picPanelFill(el, b);
  return el;
}
function picPanelFill(el, b){
  const busy = picBusy.get(b.id), ro = readOnly(), kids = [];
  const pickBtn = (label, cls) => h('button', { type:'button', class:'btn ' + cls, disabled:ro || busy ? true : null, onclick:() => picPick(b) }, label);
  if (busy) kids.push(h('p', { class:'hint pic-busy', role:'status', text:busy === 'prep' ? 'Готовлю картинку…' : 'Загружаю в облако…' }));
  if (!picOn(b)){
    const zone = h('div', { class:'pic-drop' }, pickBtn('Выбрать файл', 'primary pic-pick'), h('span', { class:'hint', text:'JPEG, PNG или WebP' }));
    if (!ro){
      zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('over'));
      zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) picUpload(blockById(b.id), f); });
    }
    kids.unshift(zone);
  } else {
    const err = picErr.get(b.imageId), p = picFx(b), id = b.id;
    if (err) kids.push(h('p', { class:'pic-err', role:'alert', text:err }));
    const row = (label, ...x) => h('div', { class:'ph-row' }, h('span', { class:'ph-lbl', text:label }), ...x);
    if (ro){ kids.push(h('div', { class:'pic-acts' }, pickBtn('Заменить', 'small pic-replace'))); }
    else {
      const rv = h('span', { class:'ph-val', text:(p.rot || 0) + '°' });
      const rr = h('input', { type:'range', class:'ph-range pic-rot', min:-180, max:180, step:1, value:p.rot || 0, 'aria-label':'Поворот',
        oninput:e => { rv.textContent = e.target.value + '°'; picFxSet(id, q => { q.rot = +e.target.value; }); } });
      const turn = d => () => { const cur = picFx(blockById(id)).rot || 0; let v = Math.round((cur + d) / 90) * 90; if (v > 180) v -= 360; if (v < -180) v += 360; rr.value = v; rv.textContent = v + '°'; picFxSet(id, q => { q.rot = v; }); };
      kids.push(h('div', { class:'pic-acts' }, pickBtn('Заменить', 'small pic-replace'),
        h('button', { type:'button', class:'btn small pic-crop', onclick:() => picCropOpen(b) }, 'Обрезать'),
        h('span', { class:'pic-turns' }, h('button', { type:'button', class:'btn small pic-left', title:'Повернуть влево на 90°', 'aria-label':'Повернуть влево на 90°', onclick:turn(-90) }, '↺'),
        h('button', { type:'button', class:'btn small pic-right', title:'Повернуть вправо на 90°', 'aria-label':'Повернуть вправо на 90°', onclick:turn(90) }, '↻'))));
      kids.push(row('Поворот', rr, rv));
      kids.push(row('Фильтр', h('select', { class:'input pic-filter', 'aria-label':'Фильтр', onchange:e => picFxSet(id, q => { q.filter = e.target.value; }) },
        PHOTO_FILTERS.map(([v, t]) => h('option', { value:v, selected:(p.filter || 'none') === v ? true : null }, t)))));
      const o = () => picFx(blockById(id)).outline || { w:0, color:PHOTO_OUT.color };
      const ov = h('span', { class:'ph-val', text:o().w + ' px' });
      const setO = (w, color) => picFxSet(id, q => { if (w > 0) q.outline = { w, color }; else delete q.outline; });
      const orng = h('input', { type:'range', class:'ph-range pic-ow', min:0, max:PHOTO_OUT.max, step:1, value:o().w, 'aria-label':'Толщина обводки',
        oninput:e => { ov.textContent = e.target.value + ' px'; setO(+e.target.value, o().color); } });
      const swatch = c => h('button', { type:'button', class:'ph-sw' + (o().color === c ? ' on' : ''), style:'background:' + c, title:c, 'aria-label':'Цвет ' + c,
        onclick:e => { const w = o().w || 4; orng.value = w; ov.textContent = w + ' px'; setO(w, c); e.currentTarget.parentNode.querySelectorAll('.ph-sw').forEach(x => x.classList.toggle('on', x === e.currentTarget)); } });
      kids.push(row('Обводка', orng, ov), h('div', { class:'ph-sws' }, PHOTO_PALETTE.map(swatch)));
      if (b.pic) kids.push(h('div', { class:'ph-acts ph-foot' }, h('button', { type:'button', class:'btn small pic-reset', onclick:() => { const x = blockById(id); delete x.pic; change(); updateCounter(x); picRepaintAll(id); picPanelRefresh(id); } }, 'Сбросить правки')));
    }
  }
  el.innerHTML = ''; el.append(...kids);
}

/* ----- Своя заставка картинкой (этап 10.9.1.1) ----- */
/* Панель в настройках заставки, под переключателем «Своя заставка». all — обновить заставки (preview, лента, кнопка «JPEG») */
let splashBusy = '';
function splashPanelFill(el){
  const ro = readOnly(), x = splashImage(), kids = [];
  el.hidden = !isCustomSplash({ type:'splash' });   // подсказка остаётся в разметке и прячется целиком
  const pick = (label, cls) => h('button', { type:'button', class:'btn ' + cls, disabled:ro || splashBusy ? true : null, onclick:() => splashPick(el) }, label);
  kids.push(h('p', { class:'hint', text:x
    ? 'Одна картинка на все заставки конспекта, на весь слайд: лишнее по краям обрезается. В PowerPoint она стоит на каждой заставке, в архив JPEG попадает первая.'
    : 'Картинки пока нет: в PowerPoint на месте заставки будет серая заглушка, в архив JPEG заставка не попадёт. Загрузите картинку, и она встанет на все заставки.' }));
  if (splashBusy) kids.push(h('p', { class:'hint pic-busy', role:'status', text:splashBusy === 'prep' ? 'Готовлю картинку…' : 'Загружаю в облако…' }));
  const err = x && picErr.get(x.imageId);
  if (err) kids.push(h('p', { class:'pic-err', role:'alert', text:err }));
  kids.push(h('div', { class:'pic-acts' }, x ? pick('Заменить картинку', 'small spic-replace') : pick('Загрузить картинку', 'primary spic-pick'),
    x && !ro && h('button', { type:'button', class:'btn small spic-del', disabled:splashBusy ? true : null, onclick:() => splashRemove(el) }, 'Удалить картинку')));
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
/* «Удалить картинку»: заставка снова серая заглушка; сам файл в облаке стирает ночная уборка, когда на него не ссылаются ни конспект, ни история */
function splashRemove(el){
  if (readOnly() || !splashImage()) return;
  delete state.settings.customSplashImage;
  change(); if (el._all) el._all(); splashPanelRefresh();
}

/* ----- Обрезка: окно с картинкой без правок, рамка с ручками по углам, внутри — двигать ----- */
let PCW = null;   // { id, crop {l,t,r,b} }
async function picCropOpen(b){
  if (!picOn(b) || readOnly()) return;
  let im; try { im = await picImage(b.imageId); } catch(e){ picPanelRefresh(b.id); toast(picErr.get(b.imageId) || 'Картинка не загрузилась.'); return; }
  PCW = { id:b.id, crop:Object.assign({ l:0, t:0, r:0, b:0 }, picFx(b).crop || {}) };
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
  const done = () => { const cr = PCW && PCW.crop, id = PCW && PCW.id; closeSettings(); if (id) { picFxSet(id, q => { q.crop = cr; }); picPanelRefresh(id); } };
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
