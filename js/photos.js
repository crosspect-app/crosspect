'use strict';

/* ========= Фото авторов цитат (этап 10.5) =========
   Фотобанк — в репозитории: img/authors/authors.json и картинки img/authors/<id>.webp (прозрачный фон, человек смотрит вправо
   или анфас). Фото добавляет только Виталий через беседу с Claude (img/authors/README.md); загрузки картинок в форме нет.
   У цитаты «Текст слева / справа» — поле photo (model.js, normPhoto). Фото стоит в пустой зоне слайда, поверх фона и рамки,
   текст цитаты — поверх фото. Фильтр и отражение вшиваются в картинку (photoVariant), поэтому редактор, JPEG и PowerPoint
   получают одну и ту же картинку. */

const PHOTO_DIR = 'img/authors/';
const PHOTO_FILTERS = [['none', 'Оригинал'], ['bw', 'ЧБ'], ['bwHard', 'ЧБ контрастный'], ['bwSoft', 'ЧБ мягкий'], ['sepia', 'Сепия'],
  ['warm', 'Тёплый'], ['cool', 'Холодный'], ['muted', 'Приглушённый'], ['tone', 'В цвет фона']];
const PHOTO_TONE_DEFAULT = '#c9702a';   // «В цвет фона» у System Template: цвет пятен прежнего фона

/* ----- Фотобанк -----
   Описания — img/authors/authors.json; поверх — правки админа из облака (authors/{id}: first, last, caption, aliases, preset —
   вид фото по умолчанию). Правки приходят из cloud.js (watchAuthors → setBankEdits) */
const photoBank = { base:[], edits:{}, list:[], byId:new Map(), loaded:false, failed:false, p:null };
function loadPhotoBank(){
  if (photoBank.p) return photoBank.p;
  photoBank.p = fetch(PHOTO_DIR + 'authors.json', { cache:'no-cache' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => setPhotoBank(Array.isArray(d) ? d : (d && d.authors) || []))
    .catch(() => { photoBank.failed = true; photoBank.p = null; setPhotoBank([]); });
  return photoBank.p;
}
const strList = v => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : [];
function setPhotoBank(list){
  photoBank.base = list.filter(a => a && typeof a.id === 'string' && a.file && +a.w > 0 && +a.h > 0);
  photoBank.loaded = true;
  bankRebuild();
}
function setBankEdits(map){ photoBank.edits = map && typeof map === 'object' ? map : {}; if (photoBank.loaded) bankRebuild(); }
function bankRebuild(){
  photoBank.list = photoBank.base.map(a => {
    const e = photoBank.edits[a.id] || {}, pick = k => typeof e[k] === 'string' ? e[k] : a[k];
    return Object.assign({}, a, { first:String(pick('first') || ''), last:String(pick('last') || ''), caption:String(pick('caption') || ''),
      aliases:strList(Array.isArray(e.aliases) ? e.aliases : a.aliases), preset:normPreset(e.preset) });
  });
  photoBank.byId = new Map(photoBank.list.map(a => [a.id, a]));
  photoRepaintAll();
  if (typeof photoBankChanged === 'function') photoBankChanged();   // окно «Фотобанк» (photobank.js)
}
/* Вид фото по умолчанию для автора: положение и размер в долях слайда, сторона фото (left / right), фильтр, отражение */
function normPreset(p){
  if (!p || typeof p !== 'object' || !(p.side === 'left' || p.side === 'right')) return null;
  const n = (v, a, b) => { v = Number(v); return isFinite(v) ? Math.min(b, Math.max(a, v)) : null; };
  const x = n(p.x, -2, 3), y = n(p.y, -2, 4), hh = n(p.h, PHOTO_H.min, PHOTO_H.max);
  if (x == null || y == null || hh == null) return null;
  return { x, y, h:hh, side:p.side, filter:PHOTO_FILTERS.some(f => f[0] === p.filter) ? p.filter : 'none', mirror:p.mirror !== false };
}
const bankEntry = id => (id && photoBank.byId.get(id)) || null;
const bankName = a => [a.first, a.last].filter(Boolean).join(' ');

/* Поиск: без регистра, «ё» = «е», точки и дефисы — как пробел; каждое слово запроса — начало какого-то слова в имени,
   фамилии или другом написании. Сверху — совпадение с «Именем» и «Фамилией» цитаты */
const photoNorm = s => String(s || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^a-zа-яіїєґąćęłńóśźż0-9]+/gi, ' ').trim();
function photoHay(a){ return [bankName(a), a.last + ' ' + a.first].concat(a.aliases).map(photoNorm); }
function photoMatches(a, q){
  const ws = photoNorm(q).split(' ').filter(Boolean); if (!ws.length) return true;
  return photoHay(a).some(x => { const t = x.split(' '); return ws.every(w => t.some(y => y.startsWith(w))); });
}
function photoSearch(q, b){
  const me = photoNorm(q) || photoNorm(quoteAuthor(b || {})), exact = a => me && photoHay(a).includes(me) ? 0 : 1;
  return photoBank.list.filter(a => photoMatches(a, q))
    .sort((x, y) => exact(x) - exact(y) || x.last.localeCompare(y.last, 'ru') || x.first.localeCompare(y.first, 'ru'));
}

/* ----- Где стоит фото ----- */
const photoHalf = b => b.type === 'quote' && (b.half === 'left' || b.half === 'right') ? b.half : null;
/* Зона без текста: «Текст справа» — левая часть слайда, «Текст слева» — правая (100 − halfW %). Середина зоны — x по умолчанию */
function photoZoneX(b){ const z = 1 - clampHalfW(b.halfW) / 100; return photoHalf(b) === 'left' ? 1 - z / 2 : z / 2; }
/* В банке человек смотрит вправо: при «Тексте слева» фото справа и отражается (смотрит к тексту). Анфас и «Не отражать» — как есть */
const photoFlip = (b, a) => photoHalf(b) === 'left' && a.faces !== 'front' && b.photo.mirror !== false;
/* Рамка фото в пикселях кадра 1920×1080 или null (нет фото, «Во всю ширину», нет такого id, банк ещё грузится) */
function photoBox(b){
  const p = b.photo, a = p && !p.off && photoHalf(b) && bankEntry(p.id); if (!a) return null;   // off — выключено переключателем «На слайде», фото хранится
  const hh = (p.h == null ? PHOTO_H.def : p.h) * SL.H, w = hh * a.w / a.h;
  const cx = (p.x == null ? photoZoneX(b) : p.x) * SL.W, bottom = (p.y == null ? 1 : p.y) * SL.H;
  return { left:cx - w / 2, top:bottom - hh, width:w, height:hh, entry:a, flip:photoFlip(b, a) };
}

/* ----- Фильтры (по пикселям: одинаково в Chrome и Safari) ----- */
function hexRgb(hex){ const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); const n = m ? parseInt(m[1], 16) : 0xc9702a; return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function photoToneColor(){
  let bg = null; try { bg = sermonBg(state); } catch(e){}
  return (bg && bg.color) || PHOTO_TONE_DEFAULT;
}
function filterPixels(d, f, tone){
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b, cl = v => v < 0 ? 0 : v > 255 ? 255 : v;
  let dark, light;
  if (f === 'tone'){   // дуотон: тени — глубокий тон цвета фона, света — светлый тёплый тон рамки слайда
    const c = hexRgb(tone); dark = c.map(v => v * 0.18); light = c.map(v => v * 0.25 + 236 * 0.75);
  }
  for (let i = 0; i < d.length; i += 4){
    let r = d[i], g = d[i + 1], b = d[i + 2], y;
    switch (f){
      case 'bw': y = lum(r, g, b); r = g = b = y; break;
      case 'bwHard': y = cl((lum(r, g, b) - 128) * 1.45 + 128); r = g = b = y; break;
      case 'bwSoft': y = cl((lum(r, g, b) - 128) * 0.78 + 140); r = g = b = y; break;
      case 'sepia': { const R = r * .393 + g * .769 + b * .189, G = r * .349 + g * .686 + b * .168, B = r * .272 + g * .534 + b * .131; r = R; g = G; b = B; break; }
      case 'warm': r = r * 1.08 + 10; g = g * 1.02 + 3; b = b * 0.86; break;
      case 'cool': r = r * 0.88; g = g * 0.98 + 2; b = b * 1.08 + 12; break;
      case 'muted': y = lum(r, g, b); r = ((r - y) * 0.45 + y - 128) * 0.9 + 132; g = ((g - y) * 0.45 + y - 128) * 0.9 + 132; b = ((b - y) * 0.45 + y - 128) * 0.9 + 132; break;
      case 'tone': y = lum(r, g, b) / 255; r = dark[0] + (light[0] - dark[0]) * y; g = dark[1] + (light[1] - dark[1]) * y; b = dark[2] + (light[2] - dark[2]) * y; break;
    }
    d[i] = cl(r); d[i + 1] = cl(g); d[i + 2] = cl(b);
  }
}
const photoImgCache = new Map();
function photoImage(a){
  if (!photoImgCache.has(a.id)) photoImgCache.set(a.id, new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = () => { photoImgCache.delete(a.id); rej(new Error('нет файла фото ' + a.file)); };
    im.src = PHOTO_DIR + a.file;
  }));
  return photoImgCache.get(a.id);
}
/* Готовая картинка: фильтр и отражение уже применены. { url (blob: для экрана), canvas } — кешируется по id, фильтру и отражению */
const photoVars = new Map();
const variantKey = (a, f, flip) => a.id + '|' + f + '|' + (flip ? 1 : 0) + (f === 'tone' ? '|' + photoToneColor() : '');
function photoVariant(a, f, flip){
  const key = variantKey(a, f, flip);
  if (!photoVars.has(key)) photoVars.set(key, photoImage(a).then(im => {
    const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    const ctx = cv.getContext('2d');
    if (flip){ ctx.translate(cv.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(im, 0, 0);
    if (f !== 'none'){ const px = ctx.getImageData(0, 0, cv.width, cv.height); filterPixels(px.data, f, photoToneColor()); ctx.putImageData(px, 0, 0); }
    return new Promise(res => cv.toBlob(bl => { const v = { canvas:cv, url:bl ? URL.createObjectURL(bl) : cv.toDataURL('image/png') }; v.ready = true; photoVars.set(key, v); res(v); }, 'image/webp', 0.92));
  }).catch(e => { photoVars.delete(key); throw e; }));
  return photoVars.get(key);
}
/* Уже готовая картинка (синхронно) или null — тогда начинаем готовить и перерисуем слайды, когда будет готова */
function photoUrlNow(b, box){
  const key = variantKey(box.entry, b.photo.filter, box.flip), v = photoVars.get(key);
  if (v && v.ready) return v.url;
  if (!v) photoVariant(box.entry, b.photo.filter, box.flip).then(() => photoRepaintAll()).catch(() => {});
  return null;
}
const photoDataUrl = v => v.dataUrl || (v.dataUrl = v.canvas.toDataURL('image/webp', 0.92));
/* PowerPoint: фото отдельной картинкой PNG (фильтр и отражение уже применены) */
const photoPng = v => new Promise((res, rej) => v.canvas.toBlob(x => x ? x.arrayBuffer().then(a => res(new Uint8Array(a))) : rej(new Error('браузер не отдал фото')), 'image/png'));
/* Для JPEG и PowerPoint: дождаться банка и картинки */
async function photoReady(b){
  if (!b || b.type !== 'quote' || !b.photo) return null;
  await loadPhotoBank();
  const box = photoBox(b); if (!box) return null;
  const v = await photoVariant(box.entry, b.photo.filter, box.flip);
  return Object.assign({}, box, { variant:v });
}

/* ----- На слайде ----- */
/* layoutBox (preview.js) зовёт для цитаты: картинка .sl-photo img; на большом слайде в правке — ещё рамка для мыши и
   полупрозрачная часть за краем слайда (.ph-layer в .stage-slide) */
function paintPhoto(sl, b){
  const wrap = sl.querySelector('.sl-photo'); if (!wrap) return;
  if (b.photo && !photoBank.loaded) loadPhotoBank();
  const box = photoBox(b), url = box && photoUrlNow(b, box), im = wrap.querySelector('img');
  if (!box || !url){ im.removeAttribute('src'); im.style.display = 'none'; }
  else {
    if (im.getAttribute('src') !== url) im.src = url;
    Object.assign(im.style, { display:'block', left:box.left + 'px', top:box.top + 'px', width:box.width + 'px', height:box.height + 'px' });
  }
  const holder = sl.parentNode && sl.parentNode.classList && sl.parentNode.classList.contains('stage-slide') ? sl.parentNode : null;
  if (holder) paintPhotoLayer(holder, sl, b, box && url ? box : null, url);
}
function paintPhotoLayer(holder, sl, b, box, url){
  let L = holder.querySelector('.ph-layer');
  const on = !!box && !readOnly();
  holder.classList.toggle('ph-on', on);
  if (!on){ if (L) L.remove(); return; }
  if (!L){
    L = h('div', { class:'ph-layer', 'aria-hidden':'true' }, h('div', { class:'ph-ghost' }, h('img', { alt:'' })),
      h('div', { class:'ph-hit', title:'Перетащите фото. Размер — за угол' }, ['nw', 'ne', 'sw', 'se'].map(c => h('span', { class:'ph-corner c-' + c, 'data-c':c }))));
    holder.append(L);
    L.querySelector('.ph-hit').addEventListener('pointerdown', e => photoDrag(e, b.id));
  }
  const k = sl.clientWidth / SL.W, st = { left:box.left * k + 'px', top:box.top * k + 'px', width:box.width * k + 'px', height:box.height * k + 'px' };
  const g = L.querySelector('.ph-ghost img'); if (g.getAttribute('src') !== url) g.src = url;
  Object.assign(g.style, st); Object.assign(L.querySelector('.ph-hit').style, st);
}
/* Перерисовать фото на всех слайдах (банк или картинка пришли, фото двигают): только положение, без раскладки текста */
function photoRepaintAll(id){
  if (typeof mainEl === 'undefined' || !mainEl || !state) return;
  mainEl.querySelectorAll('.sl').forEach(sl => {
    if (id && sl.dataset.id !== id) return;
    const b = typeof unitById === 'function' ? unitById(sl.dataset.id) : null;
    if (b && b.type === 'quote') paintPhoto(sl, b);
  });
  const side = typeof sideEl !== 'undefined' && sideEl ? sideEl.querySelector('.ph-panel') : null;
  if (side && side._b) photoPanelFill(side, side._b);
}

/* Двигать мышью; за угол — размер с сохранением пропорций, противоположный угол стоит на месте */
function photoDrag(e, id){
  const b = blockById(id); if (!b || !b.photo || readOnly() || e.button !== 0) return;
  const sl = e.currentTarget.closest('.stage-slide').querySelector('.sl'), k = sl.clientWidth / SL.W;
  const box0 = photoBox(b); if (!box0) return;
  e.preventDefault();
  const corner = e.target.dataset && e.target.dataset.c, x0 = e.clientX, y0 = e.clientY, ar = box0.width / box0.height;
  const hit = e.currentTarget; hit.setPointerCapture(e.pointerId); hit.classList.add('drag');
  let moved = false;
  const move = ev => {
    const dx = (ev.clientX - x0) / k, dy = (ev.clientY - y0) / k;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    moved = true;
    let L = box0.left, T = box0.top, W = box0.width, H = box0.height;
    if (!corner){ L += dx; T += dy; }
    else {
      const right = corner.includes('e'), bottom = corner.includes('s');
      const ax = right ? box0.left : box0.left + box0.width, ay = bottom ? box0.top : box0.top + box0.height;   // неподвижный угол
      const px = (right ? box0.left + box0.width : box0.left) + dx, py = (bottom ? box0.top + box0.height : box0.top) + dy;
      H = Math.max(Math.abs(py - ay), Math.abs(px - ax) / ar);
      H = Math.min(PHOTO_H.max * SL.H, Math.max(PHOTO_H.min * SL.H, H)); W = H * ar;
      L = right ? ax : ax - W; T = bottom ? ay : ay - H;
    }
    Object.assign(b.photo, { x:+((L + W / 2) / SL.W).toFixed(4), y:+((T + H) / SL.H).toFixed(4), h:+(H / SL.H).toFixed(4) });
    photoRepaintAll(b.id);
  };
  const up = () => {
    hit.removeEventListener('pointermove', move); hit.removeEventListener('pointerup', up); hit.removeEventListener('pointercancel', up);
    hit.classList.remove('drag');
    if (moved){ change(); updateCounter(b); }
  };
  hit.addEventListener('pointermove', move); hit.addEventListener('pointerup', up); hit.addEventListener('pointercancel', up);
}

/* «Текст слева» ↔ «Текст справа»: сдвинутое фото переходит в другую зону зеркально. «Во всю ширину» фото прячет, но хранит.
   Из «Во всю ширину» (фото поставлено по виду по умолчанию для другой стороны) — тоже зеркально, если фото оказалось бы на стороне текста */
const photoSideFor = half => half === 'left' ? 'right' : 'left';   // фото — с другой стороны от текста
function photoHalfSwitch(b, v){
  const was = photoHalf(b), p = b.photo;
  if (!p || p.x == null || !(v === 'left' || v === 'right') || v === was) return;
  if (was || (photoSideFor(v) === 'right') !== (p.x > 0.5)) p.x = +(1 - p.x).toFixed(4);
}

/* ----- Выбор автора из фотобанка: подсказки под «Имя» и «Фамилия» (render.js) -----
   Выбрали подсказку — имя, фамилия и подпись берутся из банка (прежние затираются; вернуть — ↶), у цитаты появляется фото,
   поставленное по виду по умолчанию для этого автора. Не выбрали — автор введён вручную, без фото */
function presetPhoto(b, a){
  const out = { id:a.id, x:null, y:null, h:null, filter:'none', mirror:true }, ps = a.preset;
  if (!ps) return out;
  const side = photoHalf(b) ? photoSideFor(photoHalf(b)) : ps.side;
  return Object.assign(out, { x:side === ps.side ? ps.x : +(1 - ps.x).toFixed(4), y:ps.y, h:ps.h, filter:ps.filter, mirror:ps.mirror });
}
function pickAuthor(b, a){
  Object.assign(b, { first:a.first, last:a.last, caption:a.caption || '' });
  b.photo = presetPhoto(b, a);
  change(); rerender(b);
}
/* Подсказки: input — поле «Имя» или «Фамилия», box — список под полями. Показываем, пока человек печатает */
function authorSuggest(b, input, box){
  const close = () => { box.innerHTML = ''; box.hidden = true; box._items = []; box._at = -1; };
  const mark = i => { box._at = i; [...box.children].forEach((x, k) => x.classList.toggle('on', k === i)); };
  const fill = () => {
    if (!photoBank.loaded){ loadPhotoBank().then(() => { if (document.activeElement === input) fill(); }); return close(); }
    // ищем по обоим полям; не нашлось — по полю, в котором печатают (меняют автора: в другом поле ещё прежний)
    const cur = b.photo && b.photo.id, look = q => q.trim() ? photoSearch(q, b).filter(a => a.id !== cur) : [];
    let found = look(quoteAuthor(b)); if (!found.length) found = look(input.value);
    found = found.slice(0, 6);
    if (!found.length) return close();
    box.innerHTML = ''; box.hidden = false; box._items = found; box._at = -1;
    found.forEach((a, i) => box.append(h('button', { type:'button', class:'au-item', role:'option', tabindex:'-1',
      onpointerdown:e => e.preventDefault(), onclick:() => { close(); pickAuthor(b, a); } },
      h('img', { src:PHOTO_DIR + a.file, alt:'', loading:'lazy' }),
      h('span', { class:'au-text' }, h('span', { class:'au-name', text:bankName(a) }), a.caption ? h('span', { class:'au-cap', text:a.caption }) : null))));
  };
  input.addEventListener('input', fill);
  input.addEventListener('blur', () => setTimeout(close, 0));
  input.addEventListener('keydown', e => {
    if (box.hidden || !box._items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); const n = box._items.length; mark(((box._at + (e.key === 'ArrowDown' ? 1 : -1)) % n + n) % n); }
    else if (e.key === 'Enter' && box._at >= 0){ e.preventDefault(); const a = box._items[box._at]; close(); pickAuthor(b, a); }
    else if (e.key === 'Escape'){ e.stopPropagation(); close(); }
  });
  close();
}

/* ----- Блок «Фото» в правой панели: только у цитаты «Текст слева / справа» с выбранным из банка автором.
   Переключатель «На слайде» прячет фото, не забывая его (этап 10.5, решение Виталия 18 ноября 2026: «Без фото» терял выбор) ----- */
function photoPanel(b){
  const p = b.photo; if (!p) return null;
  const el = h('div', { class:'ph-panel' });
  el._b = b;
  photoPanelFill(el, b);
  if (!photoBank.loaded) loadPhotoBank();
  return el;
}
/* Сбросить — к виду по умолчанию для автора, если админ его задал, иначе к общему: снизу по центру пустой зоны, 90 % высоты, «Оригинал» */
function photoReset(b){
  const a = bankEntry(b.photo.id); if (!a) return;
  b.photo = presetPhoto(b, a); change(); rerender(b);
}
/* Админ: запомнить, как стоит фото сейчас, — видом по умолчанию для этого автора (облако, authors/{id}.preset) */
async function photoSavePreset(b, btn){
  const box = photoBox(b), p = b.photo; if (!box || !cloud.admin) return;
  const preset = { x:+((box.left + box.width / 2) / SL.W).toFixed(4), y:+((box.top + box.height) / SL.H).toFixed(4), h:+(box.height / SL.H).toFixed(4),
    side:photoSideFor(photoHalf(b)), filter:p.filter || 'none', mirror:p.mirror !== false };
  btn.disabled = true;
  try { await cloud.api.setAuthor(cloud.user, p.id, { preset }); toast('Вид по умолчанию сохранён: ' + bankName(box.entry)); }
  catch(e){ toast(cloudExplain(e) || 'Не удалось сохранить вид по умолчанию.'); }
  btn.disabled = false;
}
function photoPanelFill(el, b){
  const p = b.photo, a = p && bankEntry(p.id);
  const kids = [h('div', { class:'lbl-row' }, h('span', { class:'lbl', text:'Фото' }))];
  // «На слайде»: выключили — фото не видно нигде, но выбор, положение и фильтр хранятся; включили — всё как было
  const onSlide = h('span', { class:'ph-onoff' }, sw('На слайде', !p.off, v => { if (v) delete p.off; else p.off = true; change(); rerender(b); }));
  if (!a){
    kids.push(h('div', { class:'ph-cur' }, h('span', { class:'ph-cur-name hint', text:photoBank.loaded ? 'Этого фото больше нет в фотобанке' : 'Загружаю фотобанк…' }), onSlide));
  } else {
    kids.push(h('div', { class:'ph-cur' + (p.off ? ' off' : '') }, h('img', { class:'ph-cur-img', src:PHOTO_DIR + a.file, alt:'' }), h('span', { class:'ph-cur-name', text:bankName(a) }), onSlide));
  }
  if (a && !p.off){
    kids.push(h('label', { class:'field' }, h('span', { class:'lbl', text:'Фильтр' }),
      h('label', { class:'hf-sel' }, h('select', { class:'ph-filter', 'aria-label':'Фильтр фото',
        onchange:e => { p.filter = e.target.value; change(); updateCounter(b); } },
        PHOTO_FILTERS.map(([v, t]) => h('option', { value:v, text:t, selected:p.filter === v }))), ic('down'))));
    const row = h('div', { class:'ph-acts' });
    if (a.faces !== 'front') row.append(sw('Не отражать', p.mirror === false, v => { p.mirror = !v; change(); updateCounter(b); }));
    row.append(h('button', { type:'button', class:'btn small ph-reset', onclick:() => photoReset(b) }, 'Сбросить'));
    kids.push(row);
    if (cloud.admin && cloudOn()) kids.push(h('button', { type:'button', class:'btn small ph-preset', title:'Так фото встанет у всех, кто потом выберет этого автора',
      onclick:e => photoSavePreset(b, e.currentTarget) }, 'Сделать видом по умолчанию'));
  }
  el.innerHTML = ''; el.append(...kids);
}
