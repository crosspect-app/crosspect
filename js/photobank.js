'use strict';

/* ========= Окно «Фотобанк» (этапы 10.5 и 10.5.2): только у админа всей формы =========
   Открывается из списка пространств в шапке главной («Фотобанк», app.js). Люди по алфавиту фамилии и поиск. У человека — имя,
   фамилия, подпись и другие написания (через «;», по ним работает поиск), «Сохранить» и «Удалить»; ниже — его фото по порядку
   (стрелки — порядок, первое ставится подсказкой) и «Добавить фото». Загрузка (pbProcess): «Без фона» — PNG или WebP с прозрачностью,
   прозрачные поля обрезаются, до 1600 px по высоте, «Смотрит влево» — отражается; «С фоном» — до 2400 px по длинной стороне.
   Всё сжимается в WebP (~0,85) не больше 900 КБ, миниатюра 160 px — отдельно. Пишет в облако сразу, у всех видно тут же.
   Уже выбранные в конспектах имена и подписи не меняются; удалённое фото в конспектах больше не рисуется */
let PBW = null;   // { q, drafts: { id: { first, last, caption, aliases } }, fresh: черновик нового человека или null, saving: Set, err: { id: текст }, add: { person, kind, faces, source, file, res, busy, err } | null }
const PB_FIELDS = [['first', 'Имя', 100], ['last', 'Фамилия', 100], ['caption', 'Подпись', 200], ['aliases', 'Другие написания', 400]];
const PB_MAX = 900 * 1024, PB_CUT_H = 1600, PB_BG_SIDE = 2400, PB_THUMB = 160;
const pbValue = (a, k) => k === 'aliases' ? (a.aliases || []).join('; ') : String(a[k] || '');
const pbDraft = a => PBW.drafts[a.id] || null;
const pbChanged = a => { const d = pbDraft(a); return !!d && PB_FIELDS.some(([k]) => d[k].trim() !== pbValue(a, k)); };
const pbDirty = () => !!PBW && (photoBank.list.some(pbChanged) || (PBW.fresh && PB_FIELDS.some(([k]) => PBW.fresh[k].trim())) || !!(PBW.add && PBW.add.res));
const pbBusy = () => !!PBW && (PBW.saving.size > 0 || !!(PBW.add && PBW.add.busy));
const pbId = p => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

function openPhotoBank(){
  if (!cloud.admin || !cloudOn()) return;
  PBW = { q:'', drafts:{}, fresh:null, saving:new Set(), err:{}, add:null };
  settingsGuard = () => !pbDirty() || confirm('Изменения в фотобанке не сохранены. Закрыть без сохранения?');
  settingsOverlay.classList.add('open');
  drawPhotoBank();
  loadPhotoBank().then(() => drawPhotoBank());
  const q = settingsOverlay.querySelector('.pb-q'); if (q) q.focus();
}
function pbStop(){ PBW = null; }
/* Пришли правки из облака: перерисовать, сохранив поле с курсором */
function photoBankChanged(){ if (PBW && settingsOverlay.querySelector('.pb-sheet')) drawPhotoBank(); }

const pbFields = d => ({ first:d.first.trim(), last:d.last.trim(), caption:d.caption.trim(), aliases:d.aliases.split(';').map(x => x.trim()).filter(Boolean) });
async function pbSave(a){
  const fresh = a === 'new', d = fresh ? PBW.fresh : pbDraft(a), id = fresh ? d.id : a.id; if (!d) return;
  const f = pbFields(d);
  if (!f.first && !f.last){ PBW.err[id] = 'Нужно имя или фамилия'; drawPhotoBank(); return; }
  PBW.saving.add(id); delete PBW.err[id]; drawPhotoBank();
  try {
    await cloud.api.setBankPerson(cloud.user, id, f);
    if (!PBW) return;
    if (fresh){ PBW.fresh = null; PBW.add = pbAddState(id); PBW.reveal = true; } else delete PBW.drafts[id];   // новый человек — сразу «Добавить фото»
  } catch(e){ if (PBW) PBW.err[id] = cloudExplain(e) || 'Не удалось сохранить.'; }
  if (!PBW) return;
  PBW.saving.delete(id); drawPhotoBank();
}
async function pbRemovePerson(p){
  const n = p.photos.length;
  if (!confirm('Удалить из фотобанка «' + bankName(p) + '»' + (n ? ' и ' + (n === 1 ? 'его фото' : 'все его фото (' + n + ')') : '') + '?'
    + (n ? ' В конспектах, где стоят эти фото, их больше не будет видно; имя и подпись там останутся.' : ''))) return;
  PBW.saving.add(p.id); drawPhotoBank();
  try { await cloud.api.removeBank(cloud.user, p.photos.map(x => x.id), p.id); if (PBW){ delete PBW.drafts[p.id]; if (PBW.add && PBW.add.person === p.id) PBW.add = null; } }
  catch(e){ if (PBW) PBW.err[p.id] = cloudExplain(e) || 'Не удалось удалить.'; }
  if (PBW){ PBW.saving.delete(p.id); drawPhotoBank(); }
}
async function pbRemovePhoto(p, ph){
  if (!confirm('Удалить это фото «' + bankName(p) + '»? В конспектах, где оно стоит, его больше не будет видно; имя и подпись там останутся.')) return;
  PBW.saving.add(ph.id); drawPhotoBank();
  try { await cloud.api.removeBank(cloud.user, [ph.id], null); }
  catch(e){ if (PBW) PBW.err[p.id] = cloudExplain(e) || 'Не удалось удалить фото.'; }
  if (PBW){ PBW.saving.delete(ph.id); drawPhotoBank(); }
}
/* Порядок: фото меняется местами с соседом; номера — по порядку с нуля, пишутся только изменившиеся */
async function pbMove(p, i, d){
  const list = p.photos.slice(), j = i + d; if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const changes = {}; list.forEach((ph, k) => { if (ph.order !== k) changes[ph.id] = { order:k }; });
  PBW.saving.add(p.id + ':order'); drawPhotoBank();
  try { await cloud.api.setBankPhotos(cloud.user, changes); }
  catch(e){ if (PBW) PBW.err[p.id] = cloudExplain(e) || 'Не удалось поменять порядок.'; }
  if (PBW){ PBW.saving.delete(p.id + ':order'); drawPhotoBank(); }
}

/* ----- Загрузка фото ----- */
const pbAddState = person => ({ person, kind:'cut', faces:'right', source:'', file:null, res:null, busy:false, err:'' });
const pbCanvas = (w, hh) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(hh)); return c; };
/* Этап 10.9.6: Safari (Mac, iPhone, iPad; на iPhone и Chrome — тоже Safari внутри) не умеет сохранять холст в WebP — молча отдаёт PNG.
   Тогда сжимаем в JPEG, а картинку с прозрачностью — в PNG. Читают всё одинаково: <img> сам узнаёт формат по байтам. */
let pbWebpOk = null;
const pbCanWebp = () => { if (pbWebpOk === null){ try { const c = pbCanvas(2, 2); pbWebpOk = c.toDataURL('image/webp').startsWith('data:image/webp'); } catch(e){ pbWebpOk = false; } } return pbWebpOk; };
const pbType = alpha => pbCanWebp() ? 'image/webp' : alpha ? 'image/png' : 'image/jpeg';
/* Есть ли на холсте прозрачные точки (нужно, только когда WebP недоступен) */
function pbHasAlpha(cv){
  try { const d = cv.getContext('2d', { willReadFrequently:true }).getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true; } catch(e){}
  return false;
}
const pbBlob = (cv, q, type) => new Promise(res => cv.toBlob(res, type || pbType(false), q));
async function pbLoadImage(file){
  const url = URL.createObjectURL(file);
  try {
    const im = new Image(); im.src = url;
    await im.decode();
    return im;
  } catch(e){ throw new Error('Не получилось открыть картинку. Нужен файл PNG, WebP или JPEG.'); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}
/* Сжать в WebP (в Safari — JPEG, с прозрачностью — PNG) не больше PB_MAX: сначала качество, потом размер. → { blob, w, h, type }.
   alpha: true — прозрачность нужна, false — нет, не задано — проверить по самой картинке */
async function pbEncode(src, alpha){
  let cv = src;
  const type = pbCanWebp() ? 'image/webp' : pbType(alpha === undefined ? pbHasAlpha(src) : alpha);
  for (let step = 0; step < 12; step++){
    for (const q of type === 'image/png' ? [1] : [0.85, 0.75, 0.65]){
      const bl = await pbBlob(cv, q, type);
      if (!bl) throw new Error('Браузер не смог сжать картинку. Попробуйте другой файл.');
      if (bl.size <= PB_MAX) return { blob:bl, w:cv.width, h:cv.height, type };
    }
    const nc = pbCanvas(cv.width * 0.85, cv.height * 0.85), g = nc.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cv, 0, 0, nc.width, nc.height); cv = nc;
  }
  throw new Error('Картинку не получилось сжать до 900 КБ.');
}
/* file → { img, thumb (Uint8Array WebP), w, h, url (просмотр), size } */
async function pbProcess(file, kind, faces){
  const im = await pbLoadImage(file);
  let cv = pbCanvas(im.naturalWidth, im.naturalHeight), ctx = cv.getContext('2d', { willReadFrequently:true });
  ctx.drawImage(im, 0, 0);
  if (kind === 'cut'){
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data, W = cv.width;
    let x0 = W, y0 = cv.height, x1 = -1, y1 = -1, see = false;
    for (let i = 3, k = 0; i < d.length; i += 4, k++){
      if (d[i] < 255) see = true;
      if (d[i] > 8){ const x = k % W, y = (k - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (!see) throw new Error('У картинки нет прозрачного фона. Для «Без фона» нужен PNG или WebP, где фон уже вырезан (например, в Canva). Обычное фото загрузите как «С фоном».');
    if (x1 < 0) throw new Error('Картинка целиком прозрачная.');
    const cw = x1 - x0 + 1, chh = y1 - y0 + 1, k = Math.min(1, PB_CUT_H / chh);
    const out = pbCanvas(cw * k, chh * k), o = out.getContext('2d');
    o.imageSmoothingQuality = 'high';
    if (faces === 'left'){ o.translate(out.width, 0); o.scale(-1, 1); }   // смотрит влево — отражаем: в банке человек смотрит вправо
    o.drawImage(cv, x0, y0, cw, chh, 0, 0, out.width, out.height);
    cv = out;
  } else {
    const k = Math.min(1, PB_BG_SIDE / Math.max(cv.width, cv.height));
    if (k < 1){ const out = pbCanvas(cv.width * k, cv.height * k), o = out.getContext('2d'); o.imageSmoothingQuality = 'high'; o.drawImage(cv, 0, 0, out.width, out.height); cv = out; }
  }
  const big = await pbEncode(cv, kind === 'cut');
  const tk = PB_THUMB / Math.max(big.w, big.h), tc = pbCanvas(big.w * Math.min(1, tk), big.h * Math.min(1, tk)), t = tc.getContext('2d');
  t.imageSmoothingQuality = 'high'; t.drawImage(cv, 0, 0, tc.width, tc.height);
  const tb = await pbBlob(tc, 0.8, big.type);
  const u8 = async bl => new Uint8Array(await bl.arrayBuffer());
  return { img:await u8(big.blob), thumb:await u8(tb), w:big.w, h:big.h, size:big.blob.size, url:URL.createObjectURL(big.blob) };
}
async function pbPrepare(file){
  const A = PBW && PBW.add; if (!A || !file) return;
  if (A.res) URL.revokeObjectURL(A.res.url);
  Object.assign(A, { file, res:null, err:'', busy:true }); drawPhotoBank();
  let res = null, err = '';
  try { res = await pbProcess(file, A.kind, A.faces); } catch(e){ err = e.message || 'Не удалось обработать картинку.'; }
  if (!PBW || PBW.add !== A || A.file !== file){ if (res) URL.revokeObjectURL(res.url); return; }   // пока обрабатывали — выбрали другое
  Object.assign(A, { res, err, busy:false }); PBW.reveal = true; drawPhotoBank();
}
async function pbUpload(){
  const A = PBW && PBW.add, p = A && bankPerson(A.person); if (!A || !A.res || !p) return;
  A.busy = true; A.err = ''; drawPhotoBank();
  const meta = { person:p.id, kind:A.kind, faces:A.faces === 'front' ? 'front' : 'right', w:A.res.w, h:A.res.h, source:A.source,
    order:p.photos.reduce((m, x) => Math.max(m, x.order + 1), 0) };
  try {
    await cloud.api.addBankPhoto(cloud.user, pbId('f'), meta, A.res.img, A.res.thumb);
    if (PBW && PBW.add === A){ URL.revokeObjectURL(A.res.url); PBW.add = null; toast('Фото добавлено: ' + bankName(p)); }
  } catch(e){ if (PBW && PBW.add === A){ A.err = cloudExplain(e) || 'Не удалось загрузить фото.'; A.busy = false; } }
  drawPhotoBank();
}
/* Смена типа или «куда смотрит» — обработать выбранный файл заново */
function pbAddSet(k, v){ const A = PBW.add; A[k] = v; if (A.file) pbPrepare(A.file); else drawPhotoBank(); }

function pbAddPanel(p){
  const A = PBW.add;
  const pickFile = h('input', { type:'file', accept:'image/png,image/webp,image/jpeg', class:'pb-file', 'aria-label':'Файл фото', hidden:true,
    onchange:e => pbPrepare(e.target.files[0]) });
  const drop = h('div', { class:'pb-drop' + (A.res ? ' has' : ''), tabindex:'0', role:'button', 'aria-label':'Выбрать файл фото',
    onclick:() => pickFile.click(), onkeydown:e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); pickFile.click(); } },
    ondragover:e => { e.preventDefault(); e.currentTarget.classList.add('over'); }, ondragleave:e => e.currentTarget.classList.remove('over'),
    ondrop:e => { e.preventDefault(); e.currentTarget.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) pbPrepare(f); } },
    A.res ? h('img', { class:'pb-prev', src:A.res.url, alt:'' }) : null,
    h('span', { class:'hint', text:A.busy && !A.res ? 'Обрабатываю…' : A.res ? A.res.w + '×' + A.res.h + ' px · ' + Math.round(A.res.size / 1024) + ' КБ — другой файл: щёлкните или перетащите'
      : 'Перетащите файл сюда или щёлкните, чтобы выбрать' }));
  return h('div', { class:'pb-add' },
    h('div', { class:'pb-add-opts' },
      h('div', null, h('span', { class:'lbl', text:'Тип' }), toggle([['cut', 'Без фона'], ['bg', 'С фоном']], A.kind, v => pbAddSet('kind', v))),
      A.kind === 'cut' ? h('div', null, h('span', { class:'lbl', text:'Куда смотрит' }),
        toggle([['right', 'Вправо'], ['left', 'Влево'], ['front', 'Анфас']], A.faces, v => pbAddSet('faces', v))) : null,
      h('label', { class:'field pb-src' }, h('span', { class:'lbl', text:'Источник' }),
        h('input', { class:'input', value:A.source, maxlength:'300', placeholder:'Откуда фото: сайт, автор, лицензия', oninput:e => { A.source = e.target.value; } }))),
    h('p', { class:'hint', text:A.kind === 'cut' ? 'Нужен PNG или WebP с прозрачным фоном: фон заранее вырезать, например в Canva. Прозрачные поля форма обрежет сама. «Влево» — форма отразит фото, чтобы человек смотрел вправо.'
      : 'Обычное фото, прямоугольником. На слайде оно не отражается.' }),
    drop, pickFile,
    A.err ? h('p', { class:'sp-err', role:'alert', text:A.err }) : null,
    h('div', { class:'pb-add-acts' },
      h('button', { type:'button', class:'btn small', onclick:() => { if (A.res) URL.revokeObjectURL(A.res.url); PBW.add = null; drawPhotoBank(); } }, 'Отмена'),
      h('button', { type:'button', class:'btn primary small pb-upload', disabled:A.res && !A.busy ? null : true, onclick:pbUpload }, A.busy && A.res ? 'Загружаю…' : 'Загрузить')));
}

function pbInputs(id, label, val, set, busy){
  return PB_FIELDS.map(([k, t, max]) => h('input', { class:'input', 'aria-label':t + ': ' + label, placeholder:t, value:val(k), maxlength:String(max),
    autocomplete:'off', spellcheck:'false', 'data-pb':id + ':' + k, disabled:busy ? true : null, oninput:e => set(k, e.target.value, e) }));
}
const pbIcon = (n, t, fn, off) => { const b = iconBtn(n, t, fn, 'small'); if (off) b.disabled = true; return b; };
function pbPhotos(p){
  const legacy = bankLegacy(), moving = PBW.saving.has(p.id + ':order');
  return h('div', { class:'pb-photos' },
    p.photos.map((ph, i) => h('div', { class:'pb-ph' + (PBW.saving.has(ph.id) ? ' busy' : ''), title:ph.source ? 'Источник: ' + ph.source : '' },
      h('img', { class:'pb-img', src:ph.thumb, alt:'' }),
      h('span', { class:'pb-ph-kind', text:PHOTO_KINDS[ph.kind] + (ph.kind === 'cut' && ph.faces === 'front' ? ' · анфас' : '') }),
      ph.preset ? h('span', { class:'pb-ph-preset', text:'вид по умолчанию' }) : null,
      legacy ? null : h('div', { class:'pb-ph-acts' },
        pbIcon('back', 'Раньше', () => pbMove(p, i, -1), i === 0 || moving),
        pbIcon('next', 'Позже', () => pbMove(p, i, 1), i === p.photos.length - 1 || moving),
        pbIcon('trash', 'Удалить фото', () => pbRemovePhoto(p, ph), PBW.saving.has(ph.id))))),
    legacy || (PBW.add && PBW.add.person === p.id) ? null
      : h('button', { type:'button', class:'pb-ph pb-ph-add', onclick:() => { if (PBW.add && PBW.add.res) URL.revokeObjectURL(PBW.add.res.url); PBW.add = pbAddState(p.id); PBW.reveal = true; drawPhotoBank(); } },
        ic('plus'), h('span', { text:'Добавить фото' })));
}
function pbCard(p){
  const d = pbDraft(p), changed = pbChanged(p), busy = PBW.saving.has(p.id), legacy = bankLegacy();
  const val = k => d ? d[k] : pbValue(p, k);
  const set = (k, v, e) => {
    const x = PBW.drafts[p.id] || (PBW.drafts[p.id] = Object.fromEntries(PB_FIELDS.map(([f]) => [f, pbValue(p, f)])));
    x[k] = v;
    const card = e.target.closest('.pb-card'), btn = card && card.querySelector('.pb-save');
    if (btn) btn.disabled = !pbChanged(p);
  };
  return h('div', { class:'pb-card' + (changed ? ' changed' : ''), 'data-person':p.id },
    h('div', { class:'pb-row' },
      h('div', { class:'pb-fields' }, pbInputs(p.id, bankName(p), val, set, busy || legacy)),
      legacy ? null : h('div', { class:'pb-acts' },
        h('button', { type:'button', class:'btn primary small pb-save', disabled:changed && !busy ? null : true, onclick:() => pbSave(p) }, busy ? 'Сохраняю…' : 'Сохранить'),
        h('button', { type:'button', class:'btn small pb-del', disabled:busy ? true : null, onclick:() => pbRemovePerson(p) }, 'Удалить'))),
    PBW.err[p.id] ? h('p', { class:'sp-err', role:'alert', text:PBW.err[p.id] }) : null,
    pbPhotos(p),
    PBW.add && PBW.add.person === p.id ? pbAddPanel(p) : null);
}
function pbFreshCard(){
  const d = PBW.fresh, busy = PBW.saving.has(d.id);
  return h('div', { class:'pb-card changed pb-fresh' },
    h('div', { class:'pb-row' },
      h('div', { class:'pb-fields' }, pbInputs('new', 'новый человек', k => d[k], (k, v) => { d[k] = v; }, busy)),
      h('div', { class:'pb-acts' },
        h('button', { type:'button', class:'btn primary small pb-save', disabled:busy ? true : null, onclick:() => pbSave('new') }, busy ? 'Сохраняю…' : 'Сохранить'),
        h('button', { type:'button', class:'btn small', disabled:busy ? true : null, onclick:() => { PBW.fresh = null; drawPhotoBank(); } }, 'Отмена'))),
    PBW.err[d.id] ? h('p', { class:'sp-err', role:'alert', text:PBW.err[d.id] }) : null,
    h('p', { class:'hint', text:'Сначала сохраните человека, потом добавьте фото.' }));
}

function drawPhotoBank(){
  if (!PBW) return;
  const a = document.activeElement, focus = a && a.dataset && (a.dataset.pb || (a.classList.contains('pb-q') ? 'q' : '')),
    caret = focus && a.selectionStart;
  // этап 10.8: окно собирается заново, поэтому прокрутку окна и списка запоминаем и возвращаем (иначе любая кнопка в плашке «Добавить фото» прыгает наверх)
  const oldSheet = settingsOverlay.querySelector('.pb-sheet'), oldList = settingsOverlay.querySelector('.pb-list');
  const scroll = { sheet:oldSheet ? oldSheet.scrollTop : 0, list:oldList ? oldList.scrollTop : 0 };
  const legacy = bankLegacy();
  const found = photoSearch(PBW.q, null).sort(byLastName);
  // человек, которому только что добавили фото, остаётся в списке, даже если не подходит под поиск
  const list = !photoBank.loaded ? h('p', { class:'hint sp-empty', text:'Загружаю фотобанк…' })
    : photoBank.error && !photoBank.list.length ? h('p', { class:'sp-err', role:'alert', text:photoBank.error })
    : h('div', { class:'pb-list' },
      PBW.fresh ? pbFreshCard() : null,
      !photoBank.list.length ? h('p', { class:'hint sp-empty', text:'В фотобанке пока никого нет.' })
        : !found.length ? h('p', { class:'hint sp-empty', text:'Никого не нашлось.' })
        : h('div', { class:'pb-head', 'aria-hidden':'true' }, h('div', { class:'pb-fields' }, PB_FIELDS.map(([, t]) => h('span', { text:t })))),
      found.map(pbCard));
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet wide pb-sheet', role:'dialog', 'aria-label':'Фотобанк' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Фотобанк' }), iconBtn('close', 'Закрыть', closeSettings)),
    legacy ? h('p', { class:'hint pb-legacy', text:'Фото этапа 10.5 ещё не перенесены в базу: пока их нельзя править, и добавлять новых людей тоже нельзя. Перенос — скриптом «Фотобанк» в crosspect-backup.' }) : null,
    h('div', { class:'pb-top' },
      h('input', { class:'input pb-q', type:'search', placeholder:'Поиск по имени', 'aria-label':'Поиск по имени', value:PBW.q, autocomplete:'off', spellcheck:'false',
        oninput:e => { PBW.q = e.target.value; drawPhotoBank(); } }),
      h('button', { type:'button', class:'btn small pb-new', disabled:legacy || PBW.fresh || !photoBank.loaded ? true : null,
        onclick:() => { PBW.fresh = { id:pbId('p'), first:'', last:'', caption:'', aliases:'' }; drawPhotoBank(); const f = settingsOverlay.querySelector('[data-pb="new:first"]'); if (f) f.focus(); } }, 'Добавить человека')),
    list));
  if (focus){
    const el = focus === 'q' ? settingsOverlay.querySelector('.pb-q') : settingsOverlay.querySelector('[data-pb="' + focus + '"]');
    if (el){ el.focus({ preventScroll:true }); if (caret != null) try { el.setSelectionRange(caret, caret); } catch(e){} }
  }
  const sheet = settingsOverlay.querySelector('.pb-sheet'), lst = settingsOverlay.querySelector('.pb-list');
  if (sheet) sheet.scrollTop = scroll.sheet;
  if (lst) lst.scrollTop = scroll.list;
  if (PBW.reveal){   // плашка загрузки открылась (или выросла): показать её целиком, если она ниже края окна
    PBW.reveal = false;
    const add = settingsOverlay.querySelector('.pb-add');
    if (add) add.scrollIntoView({ block:'nearest' });
  }
}
