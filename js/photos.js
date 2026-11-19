'use strict';

/* ========= Фото авторов цитат (этапы 10.5 и 10.5.2) =========
   Фотобанк — в облаке, общий для всех пространств (этап 10.5.2): люди (bankPeople) и их фото (bankPhotos, картинка — bankFiles),
   у человека сколько угодно фото «без фона» (kind 'cut': вырезан силуэт, смотрит вправо или анфас) и «с фоном» (kind 'bg').
   Правит банк только админ (окно «Фотобанк», photobank.js); выбрать фото у цитаты — подсказкой под «Имя / Фамилия» или окном
   «Из фотобанка» (photopick.js). У цитаты «Текст слева / справа» — поле photo (model.js, normPhoto): photo.id — id фото.
   Фото стоит в пустой зоне слайда, поверх фона и рамки, текст цитаты — поверх фото. Фильтр и отражение вшиваются в картинку
   (photoVariant), поэтому редактор, JPEG и PowerPoint получают одну и ту же картинку. */

const PHOTO_DIR = 'img/authors/';   // фото этапа 10.5 в репозитории: показываются, пока база пуста (до переноса скриптом)
const PHOTO_FILTERS = [['none', 'Оригинал'], ['bw', 'ЧБ'], ['bwHard', 'ЧБ контрастный'], ['bwSoft', 'ЧБ мягкий'], ['sepia', 'Сепия'],
  ['warm', 'Тёплый'], ['cool', 'Холодный'], ['muted', 'Приглушённый'], ['tone', 'В цвет фона']];
const PHOTO_TONE_DEFAULT = '#c9702a';   // «В цвет фона» у System Template: цвет пятен прежнего фона
const PHOTO_KINDS = { cut:'без фона', bg:'с фоном' };

/* ----- Фотобанк -----
   people / photos — как пришли из облака (cloud-api.mjs, watchBank); list — люди по алфавиту фамилии, у каждого photos по порядку;
   byId — фото по id: { id, person, kind, faces, w, h, source, order, preset, thumb (адрес миниатюры), first, last, caption, aliases }.
   Слушаем с первого обращения (loadPhotoBank), а не при входе: банк нужен только тем, кто открыл цитату или окно фотобанка */
const photoBank = { people:{}, photos:{}, list:[], byId:new Map(), persons:new Map(), loaded:false, legacy:null, p:null, unsub:null, error:'' };
function loadPhotoBank(){
  if (photoBank.p) return photoBank.p;
  const api = typeof cloud !== 'undefined' && cloud.api;
  if (!api || !api.watchBank || !cloudOn()) return Promise.resolve();
  photoBank.p = new Promise(res => {
    const got = {};
    let done = false;
    const ready = () => { photoBank.loaded = true; bankRebuild(); if (!done){ done = true; res(); } };
    photoBank.unsub = api.watchBank((kind, map) => {
      photoBank[kind] = map || {}; got[kind] = true;
      if (got.people && got.photos) (Object.keys(photoBank.photos).length ? Promise.resolve() : loadLegacy()).then(ready);
    }, e => { photoBank.error = cloudExplain(e) || 'Не удалось загрузить фотобанк.'; ready(); });
  });
  return photoBank.p;
}
/* Сменился человек (вход / выход): перестать слушать и забыть банк */
function photoBankStop(){
  if (photoBank.unsub){ try { photoBank.unsub(); } catch(e){} }
  Object.assign(photoBank, { people:{}, photos:{}, list:[], byId:new Map(), persons:new Map(), loaded:false, p:null, unsub:null, error:'' });
}
/* Фото этапа 10.5 (img/authors/authors.json): пока в базе нет ни одного фото, показываем их — старые цитаты не теряют фото до переноса */
function loadLegacy(){
  if (photoBank.legacy) return Promise.resolve();
  return fetch(PHOTO_DIR + 'authors.json', { cache:'no-cache' }).then(r => r.ok ? r.json() : [])
    .then(d => { photoBank.legacy = (Array.isArray(d) ? d : []).filter(a => a && typeof a.id === 'string' && a.file && +a.w > 0 && +a.h > 0); })
    .catch(() => { photoBank.legacy = []; });
}
const strList = v => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : [];
const thumbUrls = new Map();   // миниатюры не меняются: адрес по id фото
function thumbUrl(id, u8){
  if (!thumbUrls.has(id) && u8 && u8.length) thumbUrls.set(id, URL.createObjectURL(new Blob([u8], { type:'image/webp' })));
  return thumbUrls.get(id) || '';
}
function bankRebuild(){
  const persons = new Map(), byId = new Map(), cloudPhotos = Object.keys(photoBank.photos).length;
  const person = (id, x) => ({ id, first:String(x.first || ''), last:String(x.last || ''), caption:String(x.caption || ''), aliases:strList(x.aliases), photos:[] });
  if (cloudPhotos || !(photoBank.legacy || []).length){
    Object.entries(photoBank.people).forEach(([id, x]) => persons.set(id, person(id, x)));
    Object.entries(photoBank.photos).forEach(([id, x]) => {
      const p = persons.get(x.person); if (!p || !(+x.w > 0 && +x.h > 0)) return;
      p.photos.push({ id, person:p.id, kind:x.kind === 'bg' ? 'bg' : 'cut', faces:x.kind === 'bg' ? null : (x.faces === 'front' ? 'front' : 'right'),
        w:+x.w, h:+x.h, source:String(x.source || ''), order:+x.order || 0, preset:normPreset(x.preset), thumb:thumbUrl(id, x.thumb) });
    });
  } else {   // база ещё пуста: фото этапа 10.5 из репозитория, только для показа
    photoBank.legacy.forEach(a => {
      const p = person(a.id, a);
      p.photos.push({ id:a.id, person:a.id, kind:'cut', faces:a.faces === 'front' ? 'front' : 'right', w:+a.w, h:+a.h, source:String(a.source || ''),
        order:0, preset:null, thumb:PHOTO_DIR + a.file, file:a.file, legacy:true });
      persons.set(a.id, p);
    });
  }
  persons.forEach(p => {
    p.photos.sort((x, y) => x.order - y.order || x.id.localeCompare(y.id));
    p.photos.forEach(ph => { Object.assign(ph, { first:p.first, last:p.last, caption:p.caption, aliases:p.aliases }); byId.set(ph.id, ph); });
  });
  photoBank.persons = persons; photoBank.byId = byId;
  photoBank.list = [...persons.values()].sort(byLastName);
  photoRepaintAll(); photoPanelRefresh();
  if (typeof photoBankChanged === 'function') photoBankChanged();   // окно «Фотобанк» (photobank.js)
  if (typeof pickChanged === 'function') pickChanged();             // окно выбора (photopick.js)
}
const byLastName = (x, y) => x.last.localeCompare(y.last, 'ru') || x.first.localeCompare(y.first, 'ru');
const bankLegacy = () => !Object.keys(photoBank.photos).length && !!(photoBank.legacy || []).length;
/* Вид фото по умолчанию для автора: положение и размер в долях слайда, сторона фото (left / right), фильтр, отражение */
function normPreset(p){
  if (!p || typeof p !== 'object' || !(p.side === 'left' || p.side === 'right')) return null;
  const n = (v, a, b) => { v = Number(v); return isFinite(v) ? Math.min(b, Math.max(a, v)) : null; };
  const x = n(p.x, -2, 3), y = n(p.y, -2, 4), hh = n(p.h, PHOTO_H.min, PHOTO_H.max);
  if (x == null || y == null || hh == null) return null;
  const out = { x, y, h:hh, side:p.side, filter:PHOTO_FILTERS.some(f => f[0] === p.filter) ? p.filter : 'none', mirror:p.mirror !== false };
  const fx = normPhoto({ id:'x', crop:p.crop, rot:p.rot, outline:p.outline, round:p.round, flipH:p.flipH, flipV:p.flipV });   // этап 10.5.3: обрезка, поворот, обводка, углы — как у фото на слайде; 10.5.7 — отражение
  ['crop', 'rot', 'outline', 'round', 'flipH', 'flipV'].forEach(k => { if (fx[k] != null) out[k] = fx[k]; });
  return out;
}
const bankEntry = id => (id && photoBank.byId.get(id)) || null;
const bankPerson = id => (id && photoBank.persons.get(id)) || null;
const bankName = a => [a.first, a.last].filter(Boolean).join(' ');

/* Поиск людей: без регистра, «ё» = «е», точки и дефисы — как пробел; каждое слово запроса — начало какого-то слова в имени,
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
    .sort((x, y) => exact(x) - exact(y) || byLastName(x, y));
}

/* ----- Где стоит фото ----- */
const photoHalf = b => b.type === 'quote' && (b.half === 'left' || b.half === 'right') ? b.half : null;
/* Зона без текста: «Текст справа» — левая часть слайда, «Текст слева» — правая (100 − halfW %). Середина зоны — x по умолчанию */
function photoZoneX(b){ const z = 1 - clampHalfW(b.halfW) / 100; return photoHalf(b) === 'left' ? 1 - z / 2 : z / 2; }
/* В банке человек смотрит вправо: при «Тексте слева» фото справа и отражается (смотрит к тексту). Анфас, «с фоном» и «Не отражать» — как есть */
const photoMirrors = a => a.kind !== 'bg' && a.faces !== 'front';
const photoAutoFlip = (b, a) => photoHalf(b) === 'left' && photoMirrors(a) && b.photo.mirror !== false;
/* Этап 10.5.7: кнопка «Слева направо» (flipH) отражает поверх этого, у всех видов фото; «Сверху вниз» — flipV */
const photoFlip = (b, a) => photoAutoFlip(b, a) !== (b.photo.flipH === true);
/* Состояние правки на слайде (photoedit.js): sel — id цитаты, у которой фото выделено, pop — не используется (была панель над фото),
   crop — id цитаты, у которой идёт обрезка, dragging — фото тянут мышью, rotating — фото крутят стрелкой { id, base, url, rect } */
const photoUI = { sel:null, pop:null, crop:null, dragging:false, rotating:null };
/* Что рисуем у фото b: в режиме обрезки поворот, обводка и углы выключены (рамка обрезки прямая) */
function photoFx(b, a){
  const p = b.photo, cropping = photoUI.crop === b.id;
  return { crop:p.crop || { l:0, t:0, r:0, b:0 }, rot:cropping ? 0 : (p.rot || 0), ow:cropping || !p.outline ? 0 : p.outline.w,
    oc:p.outline ? p.outline.color : PHOTO_OUT.color, round:cropping || a.kind !== 'bg' ? 0 : (p.round || 0) };
}
/* Рамка фото в пикселях кадра 1920×1080 или null (нет фото, «Во всю ширину», нет такого id, банк ещё грузится).
   left/top/width/height — прямоугольник готовой картинки (с поворотом и обводкой); F — вся картинка до обрезки (x, y, h хранятся для неё);
   V — видимая часть после обрезки, она поворачивается вокруг своей середины (cx, cy); fx — null, если правок нет (картинка как в банке) */
function photoBox(b){
  const p = b.photo, a = p && !p.off && photoHalf(b) && bankEntry(p.id); if (!a) return null;   // off — выключено переключателем «На слайде», фото хранится
  const hh = (p.h == null ? PHOTO_H.def : p.h) * SL.H, w = hh * a.w / a.h;
  const cx = (p.x == null ? photoZoneX(b) : p.x) * SL.W, bottom = (p.y == null ? 1 : p.y) * SL.H;
  const F = { left:cx - w / 2, top:bottom - hh, width:w, height:hh }, fx = photoFx(b, a), c = fx.crop;
  const V = { left:F.left + c.l * w, top:F.top + c.t * hh, width:w * (1 - c.l - c.r), height:hh * (1 - c.t - c.b) };
  V.cx = V.left + V.width / 2; V.cy = V.top + V.height / 2;
  const on = !!(fx.rot || fx.ow || fx.round || c.l || c.t || c.r || c.b), th = fx.rot * Math.PI / 180, cs = Math.abs(Math.cos(th)), sn = Math.abs(Math.sin(th));
  const W = on ? Math.ceil(V.width * cs + V.height * sn + 2 * fx.ow) : w, H = on ? Math.ceil(V.width * sn + V.height * cs + 2 * fx.ow) : hh;
  return { left:V.cx - W / 2, top:V.cy - H / 2, width:W, height:H, entry:a, flip:photoFlip(b, a), flipV:p.flipV === true, F, V, rot:fx.rot, fx:on ? fx : null, cropping:photoUI.crop === b.id };
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
/* Картинка фото: из кеша браузера (IndexedDB, по id: картинки в банке не меняются), иначе из базы — и в кеш */
const photoIdb = (() => {
  let db = null;
  const open = () => db || (db = new Promise(res => {
    try { const r = indexedDB.open('crosspect-photos', 1); r.onupgradeneeded = () => r.result.createObjectStore('img'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }
    catch(e){ res(null); }
  }));
  const tx = (mode, fn) => open().then(d => d && new Promise(res => {
    try { const t = d.transaction('img', mode), rq = fn(t.objectStore('img')); t.oncomplete = () => res(rq.result || null); t.onerror = t.onabort = () => res(null); }
    catch(e){ res(null); }
  }));
  return { get:id => tx('readonly', s => s.get(id)), put:(id, blob) => tx('readwrite', s => s.put(blob, id)) };
})();
const photoFiles = new Map();
function photoFileUrl(a){
  if (a.legacy) return Promise.resolve(PHOTO_DIR + a.file);
  if (!photoFiles.has(a.id)) photoFiles.set(a.id, (async () => {
    let bl = await photoIdb.get(a.id);
    if (!bl){
      const u8 = await cloud.api.bankFile(a.id);
      if (!u8) throw new Error('нет картинки фото ' + a.id);
      bl = new Blob([u8], { type:'image/webp' });
      photoIdb.put(a.id, bl);
    }
    return URL.createObjectURL(bl);
  })().catch(e => { photoFiles.delete(a.id); throw e; }));
  return photoFiles.get(a.id);
}
const photoImgCache = new Map();
function photoImage(a){
  if (!photoImgCache.has(a.id)) photoImgCache.set(a.id, photoFileUrl(a).then(url => new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('не открылась картинка фото ' + a.id));
    im.src = url;
  })).catch(e => { photoImgCache.delete(a.id); throw e; }));
  return photoImgCache.get(a.id);
}
/* Готовая картинка: фильтр и отражение уже применены. { url (blob: для экрана), canvas } — кешируется по id, фильтру и отражению (flip — слева направо, flipV — сверху вниз) */
const photoVars = new Map();
const variantKey = (a, f, flip, flipV) => a.id + '|' + f + '|' + (flip ? 1 : 0) + (flipV ? 'v' : '') + (f === 'tone' ? '|' + photoToneColor() : '');
function photoVariant(a, f, flip, flipV){
  const key = variantKey(a, f, flip, flipV);
  if (!photoVars.has(key)) photoVars.set(key, photoImage(a).then(im => {
    const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    const ctx = cv.getContext('2d');
    if (flip || flipV){ ctx.translate(flip ? cv.width : 0, flipV ? cv.height : 0); ctx.scale(flip ? -1 : 1, flipV ? -1 : 1); }
    ctx.drawImage(im, 0, 0);
    if (f !== 'none'){ const px = ctx.getImageData(0, 0, cv.width, cv.height); filterPixels(px.data, f, photoToneColor()); ctx.putImageData(px, 0, 0); }
    return new Promise(res => cv.toBlob(bl => { const v = { canvas:cv, url:bl ? URL.createObjectURL(bl) : cv.toDataURL('image/png') }; v.ready = true; photoVars.set(key, v); res(v); }, 'image/webp', 0.92));
  }).catch(e => { photoVars.delete(key); throw e; }));
  return photoVars.get(key);
}
/* Картинка с правками (этап 10.5.3): кадр → поворот → скругление → фильтр → обводка. Рисуется в пикселях слайда (толщина обводки от размера
   фото не зависит), поэтому ключ кеша включает высоту фото. Стек: отражение и обрезка заданы так, как фото видно на слайде */
const photoFxKeys = [];
const fxKey = (b, box) => { const c = box.fx.crop, o = box.fx;
  return [box.entry.id, b.photo.filter, (box.flip ? 1 : 0) + (box.flipV ? 'v' : ''), c.l, c.t, c.r, c.b, o.rot, o.ow, o.oc, o.round, Math.round(box.F.height),
    b.photo.filter === 'tone' ? photoToneColor() : ''].join('|'); };
function rrPath(g, x, y, w, h, r){
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function photoFxVariant(b, box){
  const key = fxKey(b, box), f = b.photo.filter, a = box.entry;
  if (!photoVars.has(key)) photoVars.set(key, photoImage(a).then(im => {
    const fx = box.fx, c = fx.crop, V = box.V, th = fx.rot * Math.PI / 180, CW = box.width, CH = box.height, q = Math.min(1, 4096 / Math.max(CW, CH));
    const mk = () => { const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(CW * q)); cv.height = Math.max(1, Math.round(CH * q)); return cv; };
    const P = mk(), g = P.getContext('2d'), rad = fx.round * Math.min(V.width, V.height);
    g.imageSmoothingQuality = 'high';
    g.scale(q, q); g.translate(CW / 2, CH / 2); g.rotate(th);
    if (rad > 0){ rrPath(g, -V.width / 2, -V.height / 2, V.width, V.height, rad); g.clip(); }
    if (box.flip || box.flipV) g.scale(box.flip ? -1 : 1, box.flipV ? -1 : 1);
    const iw = im.naturalWidth, ih = im.naturalHeight;
    g.drawImage(im, (box.flip ? c.r : c.l) * iw, (box.flipV ? c.b : c.t) * ih, (1 - c.l - c.r) * iw, (1 - c.t - c.b) * ih, -V.width / 2, -V.height / 2, V.width, V.height);
    if (f !== 'none'){ const px = P.getContext('2d').getImageData(0, 0, P.width, P.height); filterPixels(px.data, f, photoToneColor()); P.getContext('2d').putImageData(px, 0, 0); }
    const C = mk(), t = C.getContext('2d');
    if (fx.ow > 0){
      if (a.kind === 'bg'){   // «с фоном»: рамка по краю кадра, при скруглении повторяет скруглённые углы
        t.scale(q, q); t.translate(CW / 2, CH / 2); t.rotate(th); t.fillStyle = fx.oc;
        rrPath(t, -V.width / 2 - fx.ow, -V.height / 2 - fx.ow, V.width + 2 * fx.ow, V.height + 2 * fx.ow, rad > 0 ? rad + fx.ow : 0); t.fill();
        t.setTransform(1, 0, 0, 1, 0, 0);
      } else {   // «без фона»: по силуэту — силуэт со сдвигами по кругу
        const S = mk(), sg = S.getContext('2d'); sg.drawImage(P, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = fx.oc; sg.fillRect(0, 0, S.width, S.height);
        [fx.ow, fx.ow / 2].forEach((r, i) => {
          const n = Math.min(120, Math.max(24, Math.ceil(2 * Math.PI * r))) >> i;
          for (let k = 0; k < n; k++){ const ang = 2 * Math.PI * k / n; t.drawImage(S, Math.cos(ang) * r * q, Math.sin(ang) * r * q); }
        });
      }
    }
    t.drawImage(P, 0, 0);
    return new Promise(res => C.toBlob(bl => {
      const v = { canvas:C, url:bl ? URL.createObjectURL(bl) : C.toDataURL('image/png'), ready:true }; photoVars.set(key, v);
      photoFxKeys.push(key);
      while (photoFxKeys.length > 40){ const k = photoFxKeys.shift(), old = photoVars.get(k); photoVars.delete(k); if (old && old.url && old.url.startsWith('blob:')) URL.revokeObjectURL(old.url); }
      res(v);
    }, 'image/webp', 0.92));
  }).catch(e => { photoVars.delete(key); throw e; }));
  return photoVars.get(key);
}
const photoVariantFor = (b, box) => box.fx ? photoFxVariant(b, box) : photoVariant(box.entry, b.photo.filter, box.flip, box.flipV);
const photoKeyFor = (b, box) => box.fx ? fxKey(b, box) : variantKey(box.entry, b.photo.filter, box.flip, box.flipV);
/* Уже готовая картинка (синхронно) { url, rect } или null — тогда начинаем готовить и перерисуем слайды, когда будет готова.
   Пока новая не готова (фото тянут, крутят ползунок), показываем прежнюю: прежний прямоугольник, если пропорции другие, иначе — тот же вид в новом размере.
   Новая при перетаскивании готовится через ~150 мс после остановки */
const photoLast = new Map(), photoTimers = new Map();
function photoUrlNow(b, box){
  const key = photoKeyFor(b, box), v = photoVars.get(key), rect = { left:box.left, top:box.top, width:box.width, height:box.height };
  if (v && v.ready){ photoLast.set(b.id, { url:v.url, id:box.entry.id, rect, ratio:box.width / box.height }); return { url:v.url, rect }; }
  if (!v){
    clearTimeout(photoTimers.get(b.id));
    const go = () => { photoTimers.delete(b.id); photoVariantFor(b, box).then(() => photoRepaintAll()).catch(() => {}); };
    if (photoUI.dragging) photoTimers.set(b.id, setTimeout(go, 150)); else go();
  }
  const last = photoLast.get(b.id);
  if (!last || last.id !== box.entry.id) return null;
  return { url:last.url, rect:Math.abs(last.ratio - box.width / box.height) < 0.01 ? rect : last.rect };
}
/* Пока фото крутят стрелкой (этап 10.5.7): прежняя картинка, повёрнутая на разницу углов (середина рамки — середина видимой части, она не сдвигается) */
function photoRotPreview(b, box){
  const R = photoUI.rotating; if (!R || R.id !== b.id || !R.url) return null;
  return { url:R.url, rect:R.rect, turn:(box.rot || 0) - R.base };
}
const photoDataUrl = v => v.dataUrl || (v.dataUrl = v.canvas.toDataURL('image/webp', 0.92));
/* PowerPoint: фото отдельной картинкой PNG (фильтр, поворот, обводка и отражение уже применены, углы вне картинки прозрачные) */
const photoPng = v => new Promise((res, rej) => v.canvas.toBlob(x => x ? x.arrayBuffer().then(a => res(new Uint8Array(a))) : rej(new Error('браузер не отдал фото')), 'image/png'));
/* Для JPEG и PowerPoint: дождаться банка и картинки */
async function photoReady(b){
  if (!b || b.type !== 'quote' || !b.photo) return null;
  await loadPhotoBank();
  const box = photoBox(b); if (!box) return null;
  const v = await photoVariantFor(b, box);
  return Object.assign({}, box, { variant:v });
}

/* ----- На слайде ----- */
/* layoutBox (preview.js) зовёт для цитаты: картинка .sl-photo img; на большом слайде в правке — ещё рамка для мыши и
   полупрозрачная часть за краем слайда (.ph-layer в .stage-slide) */
function paintPhoto(sl, b){
  const wrap = sl.querySelector('.sl-photo'); if (!wrap) return;
  if (b.photo && !photoBank.loaded) loadPhotoBank();
  const box = photoBox(b), u = box && !box.cropping ? photoRotPreview(b, box) || photoUrlNow(b, box) : null, im = wrap.querySelector('img');   // при обрезке слайд без фото: картинка — в слое обрезки
  if (!u){ im.removeAttribute('src'); im.style.display = 'none'; }
  else {
    if (im.getAttribute('src') !== u.url) im.src = u.url;
    Object.assign(im.style, { display:'block', left:u.rect.left + 'px', top:u.rect.top + 'px', width:u.rect.width + 'px', height:u.rect.height + 'px', transform:u.turn ? 'rotate(' + u.turn + 'deg)' : '' });
  }
  const holder = sl.parentNode && sl.parentNode.classList && sl.parentNode.classList.contains('stage-slide') ? sl.parentNode : null;
  if (holder) paintPhotoLayer(holder, sl, b, box, u);
}
function paintPhotoLayer(holder, sl, b, box, u){
  let L = holder.querySelector('.ph-layer');
  const on = !!box && !readOnly() && (box.cropping || !!u);
  holder.classList.toggle('ph-on', on);
  if (!on){
    if (L){ L.remove(); if (photoUI.sel === b.id) photoUI.sel = photoUI.pop = null; if (photoUI.crop === b.id) photoUI.crop = null; }
    return;
  }
  if (!L){
    if (photoUI.sel === b.id) photoUI.sel = photoUI.pop = null;   // слой собран заново (другой слайд, правка отменена): выделения нет
    // обрезку только что начали, а слоя ещё не было (картинка фото не успела прийти) — её не сбрасываем (этап 10.5.7)
    if (photoUI.crop === b.id && photoUI.cropNew !== b.id) photoUI.crop = null;
    photoUI.cropNew = null;
    L = h('div', { class:'ph-layer', 'aria-hidden':'true' }, h('div', { class:'ph-ghost' }, h('img', { alt:'' })),
      h('div', { class:'ph-hit', title:'Перетащите фото. Размер — за угол' }, ['nw', 'ne', 'sw', 'se'].map(c => h('span', { class:'ph-corner c-' + c, 'data-c':c })),
        h('span', { class:'ph-rot', title:'Повернуть. Alt — без привязки к 0° и 90°' })));   // этап 10.5.7: поворот стрелкой (photoedit.js)
    holder.append(L);
    L.querySelector('.ph-hit').addEventListener('pointerdown', e => photoDrag(e, b.id));
    L.querySelector('.ph-rot').addEventListener('pointerdown', e => photoRotDrag(e, b.id));
    return paintPhotoLayer(holder, sl, b, photoBox(b), u);   // собранный слой — сразу с правильным кадром (в обрезке рамка прямая)
  }
  const k = sl.clientWidth / SL.W, g = L.querySelector('.ph-ghost img'), hit = L.querySelector('.ph-hit'), V = box.V;
  if (u){
    if (g.getAttribute('src') !== u.url) g.src = u.url;
    Object.assign(g.style, { display:'block', left:u.rect.left * k + 'px', top:u.rect.top * k + 'px', width:u.rect.width * k + 'px', height:u.rect.height * k + 'px', transform:u.turn ? 'rotate(' + u.turn + 'deg)' : '' });
  } else { g.removeAttribute('src'); g.style.display = 'none'; }
  hit.hidden = box.cropping;
  Object.assign(hit.style, { left:V.left * k + 'px', top:V.top * k + 'px', width:V.width * k + 'px', height:V.height * k + 'px', transform:box.rot ? 'rotate(' + box.rot + 'deg)' : '' });
  if (typeof photoEditSync === 'function') photoEditSync(L, holder, sl, b, box, k);   // панель над фото и обрезка (photoedit.js)
}
/* Перерисовать фото на всех слайдах (банк или картинка пришли, фото двигают): только положение, без раскладки текста */
function photoRepaintAll(id){
  if (typeof mainEl === 'undefined' || !mainEl || !state) return;
  document.querySelectorAll('.sl').forEach(sl => {
    if (id && sl.dataset.id !== id) return;
    const b = typeof unitById === 'function' ? unitById(sl.dataset.id) : null;
    if (b && b.type === 'quote') paintPhoto(sl, b);
  });
}
/* Блок «Фото» справа заполняется заново, только когда пришёл или изменился фотобанк (от картинок на слайде он не зависит:
   иначе кнопка успевала пропасть между нажатием и отпусканием) */
function photoPanelRefresh(){
  const side = typeof sideEl !== 'undefined' && sideEl ? sideEl.querySelector('.ph-panel') : null;
  if (!side || !side._b) return;
  // этап 10.5.7: снимки фотобанка приходят по нескольку раз — блок собирается заново, только если в нём что-то изменилось
  // (иначе кнопка, которую как раз нажимают, пропадала, и щелчок терялся)
  if (side._sig === photoPanelSig(side._b)) side.classList.toggle('sel', photoUI.sel === side._b.id || photoUI.crop === side._b.id);
  else photoPanelFill(side, side._b);
}
/* Всё, от чего зависит вид блока «Фото» (кроме ползунков — их значения меняются на месте) */
function photoPanelSig(b){
  const p = b.photo || {}, a = bankEntry(p.id);
  return JSON.stringify([photoBank.loaded, a && [a.id, a.thumb, bankName(a), a.kind, !!a.legacy], !!p.off, photoUI.crop === b.id,
    !!p.flipH, !!p.flipV, !!(cloud.admin && cloudOn()), readOnly()]);
}

/* Двигать мышью; за угол — размер с сохранением пропорций видимой части, противоположный угол стоит на месте (рамка может быть повёрнута).
   Щелчок без движения — выделить фото: рамка на слайде, блок «Фото» в «Редакторе» подсвечен (photoedit.js) */
function photoDrag(e, id){
  const b = blockById(id); if (!b || !b.photo || readOnly() || e.button !== 0) return;
  const sl = e.currentTarget.closest('.stage-slide').querySelector('.sl'), k = sl.clientWidth / SL.W;
  const box0 = photoBox(b); if (!box0 || box0.cropping) return;
  e.preventDefault();
  const corner = e.target.dataset && e.target.dataset.c, x0 = e.clientX, y0 = e.clientY, V0 = box0.V, F0 = box0.F, ar = V0.width / V0.height;
  const th = box0.rot * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th), vf = V0.height / F0.height;
  const off = { x:F0.left + F0.width / 2 - V0.cx, y:F0.top + F0.height / 2 - V0.cy };   // середина всей картинки относительно середины видимой части
  const hit = e.currentTarget; hit.setPointerCapture(e.pointerId); hit.classList.add('drag');
  let moved = false;
  const move = ev => {
    let dx = (ev.clientX - x0) / k, dy = (ev.clientY - y0) / k;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    if (!moved){ moved = true; photoUI.dragging = true; photoUI.pop = null; if (typeof photoEditSync === 'function') photoRepaintAll(b.id); }
    if (!corner){   // привязки при перетаскивании (правка 19 ноября, textframe.js); Alt — без них
      const s = ev.altKey ? { dx, dy, g:[] } : photoSnapMove(b, box0, dx, dy);
      dx = s.dx; dy = s.dy; slideGuides(hit.closest('.stage-slide'), s.g, k);
    }
    let cx = V0.cx + dx, cy = V0.cy + dy, f = 1;
    if (corner){
      const sx = corner.includes('e') ? 1 : -1, sy = corner.includes('s') ? 1 : -1;
      const lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;   // сдвиг мыши вдоль сторон рамки
      const px = sx * V0.width / 2 + lx, py = sy * V0.height / 2 + ly, ax = -sx * V0.width / 2, ay = -sy * V0.height / 2;   // угол под мышью и неподвижный угол
      let H = Math.max(Math.abs(py - ay), Math.abs(px - ax) / ar);
      H = Math.min(PHOTO_H.max * SL.H * vf, Math.max(PHOTO_H.min * SL.H * vf, H));
      f = H / V0.height;
      const W = H * ar, Ax = V0.cx + ax * cs - ay * sn, Ay = V0.cy + ax * sn + ay * cs;   // неподвижный угол на слайде
      cx = Ax + (sx * W / 2) * cs - (sy * H / 2) * sn; cy = Ay + (sx * W / 2) * sn + (sy * H / 2) * cs;
    }
    const hh = F0.height * f;
    Object.assign(b.photo, { x:+((cx + off.x * f) / SL.W).toFixed(4), y:+((cy + off.y * f + hh / 2) / SL.H).toFixed(4), h:+(hh / SL.H).toFixed(4) });
    photoRepaintAll(b.id);
  };
  const up = () => {
    hit.removeEventListener('pointermove', move); hit.removeEventListener('pointerup', up); hit.removeEventListener('pointercancel', up);
    hit.classList.remove('drag');
    slideGuides(hit.closest('.stage-slide'), [], k);
    photoUI.dragging = false;
    if (moved){ change(); updateCounter(b); }
    else if (typeof photoSelect === 'function') photoSelect(b.id);   // щелчок: панель над фото
    photoRepaintAll(b.id);
  };
  hit.addEventListener('pointermove', move); hit.addEventListener('pointerup', up); hit.addEventListener('pointercancel', up);
}

/* «Текст слева» ↔ «Текст справа»: сдвинутое фото переходит в другую зону зеркально. «Во всю ширину» фото прячет, но хранит.
   Из «Во всю ширину» (фото поставлено по виду по умолчанию для другой стороны) — тоже зеркально, если фото оказалось бы на стороне текста */
const photoSideFor = half => half === 'left' ? 'right' : 'left';   // фото — с другой стороны от текста
/* Обрезка и поворот заданы так, как фото видно на слайде: отразили картинку — левый край становится правым, поворот меняет знак.
   vertical — отражение сверху вниз: меняются верх и низ */
function photoMirrorFx(p, vertical){
  if (p.crop){ const c = p.crop; p.crop = vertical ? { l:c.l, t:c.b, r:c.r, b:c.t } : { l:c.r, t:c.t, r:c.l, b:c.b }; }
  if (p.rot) p.rot = -p.rot;
}
function photoHalfSwitch(b, v){
  const was = photoHalf(b), p = b.photo;
  if (!p || !(v === 'left' || v === 'right') || v === was) return;
  const a = bankEntry(p.id), flips = side => !!a && side === 'left' && photoMirrors(a) && p.mirror !== false;   // отражается ли фото при таком месте текста
  if (was && flips(was) !== flips(v)) photoMirrorFx(p);
  if (p.x == null) return;
  if (was || (photoSideFor(v) === 'right') !== (p.x > 0.5)) p.x = +(1 - p.x).toFixed(4);
}

/* ----- Выбор фото из фотобанка: подсказки под «Имя» и «Фамилия» (render.js) и окно «Из фотобанка» (photopick.js) -----
   Выбрали человека — имя, фамилия и подпись берутся из банка (прежние затираются; вернуть — ↶), у цитаты появляется фото
   (подсказка — первое фото человека), поставленное по его виду по умолчанию. Не выбрали — автор введён вручную, без фото */
function presetPhoto(b, a){
  const out = { id:a.id, x:null, y:null, h:null, filter:'none', mirror:true }, ps = a.preset;
  if (!ps) return out;
  const side = photoHalf(b) ? photoSideFor(photoHalf(b)) : ps.side, same = side === ps.side;
  Object.assign(out, { x:same ? ps.x : +(1 - ps.x).toFixed(4), y:ps.y, h:ps.h, filter:ps.filter, mirror:ps.mirror });
  // этап 10.5.3: вид по умолчанию хранит и обрезку, поворот, обводку, углы; на другой стороне отражённое фото отражает и их
  if (ps.crop) out.crop = { ...ps.crop };
  if (ps.rot) out.rot = ps.rot;
  if (!same && photoMirrors(a) && ps.mirror) photoMirrorFx(out);
  if (ps.outline) out.outline = { ...ps.outline };
  if (ps.round) out.round = ps.round;
  if (ps.flipH) out.flipH = true;   // этап 10.5.7
  if (ps.flipV) out.flipV = true;
  return out;
}
/* person — человек банка; photo — его фото (не задано — первое; у человека без фото фото у цитаты убирается) */
function pickAuthor(b, person, photo){
  const ph = photo || person.photos[0] || null;
  Object.assign(b, { first:person.first, last:person.last, caption:person.caption || '' });
  b.photo = ph ? presetPhoto(b, ph) : null;
  change(); rerender(b);
}
const personThumb = p => (p.photos[0] && p.photos[0].thumb) || '';
/* Подсказки: input — поле «Имя» или «Фамилия», box — список под полями. Показываем, пока человек печатает */
function authorSuggest(b, input, box){
  const close = () => { box.innerHTML = ''; box.hidden = true; box._items = []; box._at = -1; };
  const mark = i => { box._at = i; [...box.children].forEach((x, k) => x.classList.toggle('on', k === i)); };
  const fill = () => {
    if (!photoBank.loaded){ loadPhotoBank().then(() => { if (photoBank.loaded && document.activeElement === input) fill(); }); return close(); }
    // ищем по обоим полям; не нашлось — по полю, в котором печатают (меняют автора: в другом поле ещё прежний)
    const cur = b.photo && bankEntry(b.photo.id), look = q => q.trim() ? photoSearch(q, b).filter(p => !cur || p.id !== cur.person) : [];
    let found = look(quoteAuthor(b)); if (!found.length) found = look(input.value);
    found = found.slice(0, 6);
    if (!found.length) return close();
    box.innerHTML = ''; box.hidden = false; box._items = found; box._at = -1;
    found.forEach((p, i) => box.append(h('button', { type:'button', class:'au-item', role:'option', tabindex:'-1',
      onpointerdown:e => e.preventDefault(), onclick:() => { close(); pickAuthor(b, p); } },
      personThumb(p) ? h('img', { src:personThumb(p), alt:'' }) : h('span', { class:'au-noimg' }),
      h('span', { class:'au-text' }, h('span', { class:'au-name', text:bankName(p) }), p.caption ? h('span', { class:'au-cap', text:p.caption }) : null))));
  };
  input.addEventListener('input', fill);
  input.addEventListener('blur', () => setTimeout(close, 0));
  input.addEventListener('keydown', e => {
    if (box.hidden || !box._items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); const n = box._items.length; mark(((box._at + (e.key === 'ArrowDown' ? 1 : -1)) % n + n) % n); }
    else if (e.key === 'Enter' && box._at >= 0){ e.preventDefault(); const p = box._items[box._at]; close(); pickAuthor(b, p); }
    else if (e.key === 'Escape'){ e.stopPropagation(); close(); }
  });
  close();
}

/* ----- Блок «Фото» в правой панели: только у цитаты «Текст слева / справа» с выбранным из банка фото.
   Переключатель «На слайде» прячет фото, не забывая его (этап 10.5, решение Виталия 18 ноября 2026: «Без фото» терял выбор) ----- */
function photoPanel(b){
  const p = b.photo; if (!p) return null;
  const el = h('div', { class:'ph-panel' });
  el._b = b;
  photoPanelFill(el, b);
  if (!photoBank.loaded) loadPhotoBank();
  return el;
}
/* Сбросить — к виду по умолчанию этого фото, если админ его задал, иначе к общему: снизу по центру пустой зоны, 90 % высоты, «Оригинал» */
function photoReset(b){
  const a = bankEntry(b.photo.id); if (!a) return;
  b.photo = presetPhoto(b, a); change(); rerender(b);
}
/* Админ: запомнить, как стоит фото сейчас, — видом по умолчанию для этого фото (облако, bankPhotos/{id}.preset) */
async function photoSavePreset(b, btn){
  const box = photoBox(b), p = b.photo; if (!box || !cloud.admin || box.entry.legacy) return;
  const F = box.F;
  const preset = { x:+((F.left + F.width / 2) / SL.W).toFixed(4), y:+((F.top + F.height) / SL.H).toFixed(4), h:+(F.height / SL.H).toFixed(4),
    side:photoSideFor(photoHalf(b)), filter:p.filter || 'none', mirror:p.mirror !== false };
  ['crop', 'rot', 'outline', 'round', 'flipH', 'flipV'].forEach(k => { if (p[k]) preset[k] = JSON.parse(JSON.stringify(p[k])); });   // всё, кроме видимости
  btn.disabled = true;
  try { await cloud.api.setBankPhotos(cloud.user, { [p.id]:{ preset } }); toast('Вид по умолчанию сохранён: ' + bankName(box.entry)); }
  catch(e){ toast(cloudExplain(e) || 'Не удалось сохранить вид по умолчанию.'); }
  btn.disabled = false;
}
function photoPanelFill(el, b){
  const p = b.photo, a = p && bankEntry(p.id);
  const change1 = h('button', { type:'button', class:'btn small ph-change', onclick:() => openPhotoPick(b, true) }, 'Сменить фото');   // photopick.js
  const kids = [h('div', { class:'lbl-row' }, h('span', { class:'lbl', text:'Фото' }), change1)];
  // «На слайде»: выключили — фото не видно нигде, но выбор, положение и фильтр хранятся; включили — всё как было
  const onSlide = h('span', { class:'ph-onoff' }, sw('На слайде', !p.off, v => { if (v) delete p.off; else p.off = true; change(); rerender(b); }));
  if (!a){
    kids.push(h('div', { class:'ph-cur' }, h('span', { class:'ph-cur-name hint', text:photoBank.loaded ? 'Этого фото больше нет в фотобанке' : 'Загружаю фотобанк…' }), onSlide));
  } else {
    kids.push(h('div', { class:'ph-cur' + (p.off ? ' off' : '') }, h('img', { class:'ph-cur-img', src:a.thumb, alt:'' }),
      h('span', { class:'ph-cur-name' }, bankName(a), h('span', { class:'ph-kind', text:PHOTO_KINDS[a.kind] })), onSlide));
  }
  if (a && !p.off){
    // правка 19 ноября 2026: фильтр, обрезка, отражение, поворот, обводка и углы — под «Расширенными настройками» (photoedit.js)
    if (!readOnly()) kids.push(photoAdvanced(b, a));
    kids.push(h('div', { class:'ph-acts ph-foot' }, h('button', { type:'button', class:'btn small ph-reset', onclick:() => photoReset(b) }, 'Сбросить'),
      cloud.admin && cloudOn() && !a.legacy ? h('button', { type:'button', class:'btn small ph-preset', title:'Так фото встанет у всех, кто потом выберет это фото',
        onclick:e => photoSavePreset(b, e.currentTarget) }, 'Сделать видом по умолчанию') : null));
  }
  el.innerHTML = ''; el.append(...kids);
  el._sig = photoPanelSig(b);
  el.classList.toggle('sel', photoUI.sel === b.id || photoUI.crop === b.id);
}
