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

/* ----- Фотобанк ----- */
const photoBank = { list:[], byId:new Map(), loaded:false, failed:false, p:null };
function loadPhotoBank(){
  if (photoBank.p) return photoBank.p;
  photoBank.p = fetch(PHOTO_DIR + 'authors.json', { cache:'no-cache' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => setPhotoBank(Array.isArray(d) ? d : (d && d.authors) || []))
    .catch(() => { photoBank.failed = true; photoBank.p = null; setPhotoBank([]); });
  return photoBank.p;
}
function setPhotoBank(list){
  photoBank.list = list.filter(a => a && typeof a.id === 'string' && a.file && +a.w > 0 && +a.h > 0)
    .map(a => Object.assign({}, a, { first:String(a.first || ''), last:String(a.last || ''), aliases:Array.isArray(a.aliases) ? a.aliases.map(String) : [] }));
  photoBank.byId = new Map(photoBank.list.map(a => [a.id, a]));
  photoBank.loaded = true;
  photoRepaintAll();
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
  const me = photoNorm(quoteAuthor(b || {})), exact = a => me && photoHay(a).includes(me) ? 0 : 1;
  return photoBank.list.filter(a => photoMatches(a, q))
    .sort((x, y) => exact(x) - exact(y) || x.last.localeCompare(y.last, 'ru') || x.first.localeCompare(y.first, 'ru'));
}
/* Совпадение с именем и фамилией цитаты — для подсказки «есть в фотобанке» */
function photoFor(b){ const me = photoNorm(quoteAuthor(b)); return me ? photoBank.list.find(a => photoHay(a).includes(me)) || null : null; }

/* ----- Где стоит фото ----- */
const photoHalf = b => b.type === 'quote' && (b.half === 'left' || b.half === 'right') ? b.half : null;
/* Зона без текста: «Текст справа» — левая часть слайда, «Текст слева» — правая (100 − halfW %). Середина зоны — x по умолчанию */
function photoZoneX(b){ const z = 1 - clampHalfW(b.halfW) / 100; return photoHalf(b) === 'left' ? 1 - z / 2 : z / 2; }
/* В банке человек смотрит вправо: при «Тексте слева» фото справа и отражается (смотрит к тексту). Анфас и «Не отражать» — как есть */
const photoFlip = (b, a) => photoHalf(b) === 'left' && a.faces !== 'front' && b.photo.mirror !== false;
/* Рамка фото в пикселях кадра 1920×1080 или null (нет фото, «Во всю ширину», нет такого id, банк ещё грузится) */
function photoBox(b){
  const p = b.photo, a = p && photoHalf(b) && bankEntry(p.id); if (!a) return null;
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

/* «Текст слева» ↔ «Текст справа»: сдвинутое фото переходит в другую зону зеркально. «Во всю ширину» фото прячет, но хранит */
function photoHalfSwitch(b, v){
  const was = photoHalf(b);
  if (b.photo && b.photo.x != null && was && (v === 'left' || v === 'right') && v !== was) b.photo.x = +(1 - b.photo.x).toFixed(4);
}

/* ----- Блок «Фото автора» в правой панели ----- */
const photoUI = {};   // id цитаты → { q: текст поиска, pick: открыт выбор (при уже выбранном фото) }
function photoPanel(b){
  const el = h('div', { class:'ph-panel' });
  el._b = b;
  photoPanelFill(el, b);
  if (!photoBank.loaded) loadPhotoBank();
  return el;
}
function photoSearchRefresh(b){
  const el = sideEl && sideEl.querySelector('.ph-panel');
  if (el && el._b === b){ const ui = photoUI[b.id]; if (!ui || !ui.q) photoPanelFill(el, b); }
}
function setPhoto(b, a){
  b.photo = { id:a.id, x:null, y:null, h:null, filter:b.photo ? b.photo.filter : 'none', mirror:true };
  // имя и фамилия — из банка, если поля пустые; заполненные не трогаем
  if (!String(b.first || '').trim() && !String(b.last || '').trim()){ b.first = a.first; b.last = a.last; }
  photoUI[b.id] = {};
  change(); rerender(b);
}
function photoPanelFill(el, b){
  const ui = photoUI[b.id] || (photoUI[b.id] = {}), p = b.photo, a = p && bankEntry(p.id);
  const kids = [h('div', { class:'lbl-row' }, h('span', { class:'lbl', text:'Фото автора' }))];
  if (p && a && !ui.pick){
    kids.push(h('div', { class:'ph-cur' },
      h('img', { class:'ph-thumb', src:PHOTO_DIR + a.file, alt:'' }),
      h('span', { class:'ph-cur-name', text:bankName(a) }),
      h('button', { type:'button', class:'btn small', onclick:() => { ui.pick = true; ui.q = ''; photoPanelFill(el, b); } }, 'Заменить'),
      h('button', { type:'button', class:'btn small', onclick:() => { b.photo = null; change(); rerender(b); } }, 'Убрать')));
    kids.push(h('label', { class:'field' }, h('span', { class:'lbl', text:'Фильтр' }),
      h('label', { class:'hf-sel' }, h('select', { class:'ph-filter', 'aria-label':'Фильтр фото',
        onchange:e => { p.filter = e.target.value; change(); updateCounter(b); } },
        PHOTO_FILTERS.map(([v, t]) => h('option', { value:v, text:t, selected:p.filter === v }))), ic('down'))));
    const row = h('div', { class:'ph-acts' });
    if (a.faces !== 'front') row.append(sw('Не отражать', p.mirror === false, v => { p.mirror = !v; change(); updateCounter(b); }));
    row.append(h('button', { type:'button', class:'btn small ph-reset', onclick:() => { Object.assign(p, { x:null, y:null, h:null, filter:'none' }); change(); rerender(b); } }, 'Сбросить'));
    kids.push(row);
  } else {
    if (p && !a && photoBank.loaded) kids.push(h('p', { class:'hint', text:'Выбранного фото больше нет в фотобанке.' }));
    const q = h('input', { class:'input ph-q', type:'search', placeholder:'Поиск по фотобанку', value:ui.q || '', 'aria-label':'Поиск по фотобанку', autocomplete:'off', spellcheck:'false',
      oninput:e => { ui.q = e.target.value; fillList(); } });
    const list = h('div', { class:'ph-list', role:'listbox', 'aria-label':'Фото в фотобанке' });
    const fillList = () => {
      list.innerHTML = '';
      if (!photoBank.loaded){ list.append(h('p', { class:'hint', text:'Загружаю фотобанк…' })); return; }
      const query = ui.q || '', found = photoSearch(query, b);
      found.forEach(x => list.append(h('button', { type:'button', class:'ph-item' + (p && p.id === x.id ? ' on' : ''), role:'option', title:bankName(x), onclick:() => setPhoto(b, x) },
        h('img', { src:PHOTO_DIR + x.file, alt:'', loading:'lazy' }), h('span', { text:bankName(x) }))));
      const who = String(query).trim() || quoteAuthor(b);
      if (!found.length || (!query && who && !photoFor(b)))
        list.append(h('div', { class:'ph-none' },
          h('p', { class:'hint', text:!photoBank.list.length ? 'В фотобанке пока нет фото.' : query.trim() ? 'Фото не нашлось.' : 'Фото этого автора в фотобанке нет.' }),
          who ? h('button', { type:'button', class:'btn small ph-ask', onclick:e => photoAsk(e.currentTarget, who) }, ic('telegram'), 'Попросить фото') : null));
    };
    fillList();
    kids.push(q, list);
    if (ui.pick) kids.push(h('button', { type:'button', class:'btn small', onclick:() => { ui.pick = false; photoPanelFill(el, b); } }, 'Отмена'));
  }
  const had = el.contains(document.activeElement) && document.activeElement.classList.contains('ph-q');
  el.innerHTML = ''; el.append(...kids);
  if (had){ const q = el.querySelector('.ph-q'); if (q){ q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
}

/* «Попросить фото»: сообщение в Telegram тем, у кого в «Людях» роль «Claude User» (их несколько — список);
   никого нет — Telegram с выбором чата. Запрос живёт вне формы: Виталий присылает фото в беседу «Фотобанк» */
const claudePeople = () => (cloud.people || []).filter(p => p.role === 'claude' && p.tg).map(p => ({ name:preacherName(p) || '@' + p.tg, tg:p.tg }))
  .sort((x, y) => x.name.localeCompare(y.name, 'ru'));
function photoAskText(who){
  const m = (state && state.meta) || {}, title = String(m.title || '').trim();
  const url = location.origin + location.pathname + sermonHash(state.id);
  return { url, text:['Нужно фото автора цитаты: ' + who, title ? 'Конспект: ' + title : ''].filter(Boolean).join('\n') };
}
function photoAsk(anchor, who){
  const { url, text } = photoAskText(who), list = claudePeople();
  const to = tg => window.open('https://t.me/' + encodeURIComponent(tg) + '?text=' + encodeURIComponent(text + '\n' + url), '_blank', 'noopener');
  const any = () => window.open('https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text), '_blank', 'noopener');
  if (!list.length) any();
  else if (list.length === 1) to(list[0].tg);
  else dropdown(anchor, list.map(x => ({ label:x.name, pick:() => to(x.tg) })));
}
