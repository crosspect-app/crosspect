'use strict';

/* ========= Ссылка для оператора и страница оператора (этап 9) =========
   Ссылка делается из конспекта: форма собирает снимок «что нужно оператору» (opSnapshot: слайды, места Писания, тезисы, цитаты,
   текст к слайду, заметки; подсказок для того, кто делает слайды, в нём нет) и кладёт его в облако, shares/{ключ}. Ключ запоминается
   в конспекте (shareKey), поэтому повторное нажатие даёт ту же ссылку. Снимок обновляется при каждом сохранении конспекта (lock.js → opSync).
   Страница оператора — адрес #op=<ключ>: открывается на телефоне без входа, слушает снимок и обновляется сама. Права проверяют правила базы
   (cloud/firestore.rules, shares/{ключ}); создать и отключить ссылку можно тому, кто может править конспект. */

const OP_VIEW_KEY = 'swp-op-view';   // размер текста и «Всё / Только слайды» — помнятся в этом телефоне
const opView = { size:1, showText:true };
try { Object.assign(opView, JSON.parse(LS.get(OP_VIEW_KEY) || '{}')); } catch(e){}
const opState = { key:'', status:'load', data:null, unsub:null };   // status: load — ждём ответ, ok — показываем, gone — ссылка не работает, error — не подключились
const opSent = {};   // ключ → последний записанный в облако снимок (строкой): если для оператора ничего не изменилось, запись не нужна

const opMode = () => new URLSearchParams(location.hash.slice(1)).has('op');
const opUrl = key => location.href.split('#')[0] + '#op=' + key;

/* ----- Снимок для оператора ----- */
/* Конспект → то, что видит оператор. Всё уже очищено (sanitize), как в PDF для оператора (print.js). s — конспект формы */
function opSnapshot(s){
  const m = s.meta || {};
  let n = 0;
  const blocks = [];
  (s.blocks || []).forEach(b => {
    if (!b || !TYPES[b.type]) return;
    if (b.type === 'note'){ const t = String(b.text || '').trim(); if (t) blocks.push({ t:'note', text:t }); return; }
    const o = { t:b.type, n:++n };
    switch (b.type){
      case 'scripture':
        o.items = [];
        (b.items || []).forEach(it => {
          if (it.kind === 'line') return;
          if (it.kind === 'text'){ const x = sanitize(it.html); if (plain(x).trim()) o.items.push({ kind:'text', html:x }); return; }
          const verses = (it.verses || []).filter(v => plain(v.text).trim()).map(v => ({ num:String(v.num || ''), text:sanitize(v.text) }));
          o.items.push({ kind:'ref', ref:String(it.ref || ''), tr:String(it.translation || ''), verses });
        });
        break;
      case 'thesis': o.html = sanitize(b.text); break;
      case 'quote': o.html = sanitize(b.text); o.author = String(b.author || ''); o.caption = String(b.caption || ''); break;
      case 'video': o.name = cleanName(b.name); o.from = String(b.from || ''); o.to = String(b.to || ''); break;
      case 'image': case 'free': o.name = cleanName(b.name); break;
    }
    const sp = sanitize(b.speech);
    if (plain(sp).trim()) o.speech = sp;
    blocks.push(o);
  });
  return { v:1, title:String(m.title || ''), date:String(m.date || ''), author:preacherName(m), total:n, blocks };
}

/* Конспект сохранён — обновить снимок, если ссылка есть. Запись отдельная, не в записи конспекта: сбой тут сохранению не мешает */
async function opSync(key, snap){
  const json = JSON.stringify(snap);
  if (!key || opSent[key] === json || !cloud.api || !cloud.api.shareSync) return;
  try { await cloud.api.shareSync(key, snap); opSent[key] = json; } catch(e){ /* следующее сохранение попробует снова */ }
}

/* Ключ ссылки хранится в конспекте. В правке облачная копия может быть свежее той, что в state (ссылку сделал или отключил другой) */
function shareKeyNow(){
  if (!state) return '';
  const r = ed.id === state.id ? ed.remote : null;
  return (r ? r.cloudShare : state.cloudShare) || '';
}
/* Случайный ключ: 24 знака из 62, ≈143 бита — перебрать нельзя (правила требуют 20–64 знака) */
function opNewKey(){
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', buf = new Uint8Array(48);
  let out = '';
  while (out.length < 24){
    crypto.getRandomValues(buf);
    for (const x of buf){ if (x < 248 && out.length < 24) out += A[x % 62]; }   // 248 = 62·4: без перекоса
  }
  return out;
}

/* ----- «Ссылка для оператора» в форме ----- */
let opBusy = false;
async function openOpLink(){
  if (opBusy || !cloudOn() || screen !== 'sermon' || !state) return;
  if (!canEditCloud()){ toast(authorWaits() ? AT_EDITOR_MSG : 'Ссылку для оператора делает тот, кто может править этот конспект'); return; }
  const id = state.id, had = shareKeyNow();
  if (!had && !state.blocks.length){ toast('В конспекте пока нет слайдов'); return; }
  opBusy = true;
  opLinkSheet(null);
  try {
    // что ещё не ушло в облако, уходит сначала: оператор увидит то же, что лежит в облаке
    if (editing() && isDirty()){ saveNow(); if (ed.pending) await ed.pending; }
    if (!state || state.id !== id) throw Object.assign(new Error('closed'), { code:'closed' });
    if (!state.cloudAt) throw Object.assign(new Error('unsaved'), { code:'unsaved' });
    const snap = opSnapshot(state);
    const r = await cloud.api.shareOn(cloud.space, id, cloud.user, had || opNewKey(), snap, { minutes:lockMins() });
    opSent[r.key] = JSON.stringify(snap);
    if (state && state.id === id){ state.cloudShare = r.key; if (ed.id === id) ed.remote = r.remote; }
    opLinkSheet(r.key);   // этап 9.3: сама ссылка не копируется, человек выбирает кнопку
  } catch(e){
    closeSettings();
    if (e.code === 'locked') toast('Сейчас конспект правит ' + lockWho(e.lock) + '. Ссылку можно сделать, когда он закончит');
    else if (e.code === 'unsaved') toast('Конспект ещё не сохранился в облаке. Попробуйте ещё раз через минуту');
    else if (e.code !== 'closed') toast(cloudExplain(e) || 'Не получилось сделать ссылку');
  } finally { opBusy = false; }
}

/* Окно со ссылкой: key — пока нет (делаем), показывается «Делаю ссылку…». Без пояснения и без «Отключить ссылку» (этап 9.2):
   ссылка живёт, пока жив конспект, и исчезает вместе с ним */
function opLinkSheet(key){
  settingsOverlay.innerHTML = '';
  const head = h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Ссылка для оператора' }), iconBtn('close', 'Закрыть', closeSettings));
  const sheet = h('div', { class:'sheet oplink', role:'dialog', 'aria-label':'Ссылка для оператора' }, head);
  if (!key) sheet.append(h('p', { class:'hint', text:'Делаю ссылку…' }));
  else {
    const url = opUrl(key), field = h('input', { type:'text', class:'input oplink-url', readonly:'readonly', value:url, 'aria-label':'Ссылка', onfocus:e => e.target.select() });
    sheet.append(
      field,
      h('div', { class:'sheet-foot wrap' },
        h('button', { type:'button', class:'btn', onclick:() => opCopy(url, false, field) }, ic('dup'), 'Скопировать'),
        h('button', { type:'button', class:'btn', onclick:() => opCopy(opShareLines(url).join('\n'), false, null, 'Текст скопирован') }, ic('dup'), 'Скопировать с форматом'),
        h('button', { type:'button', class:'btn primary', onclick:() => opTelegram(url) }, ic('telegram'), 'В Telegram')));
  }
  settingsOverlay.append(sheet);
  settingsOverlay.classList.add('open');
}

/* Копировать: после ожидания ответа облака браузер иногда не даёт писать в буфер без нажатия — тогда молча остаётся кнопка «Скопировать ссылку».
   field — поле со ссылкой (запасной путь: выделить его); без него запасной путь — скрытое поле. okMsg — что написать при успехе */
async function opCopy(text, quiet, field, okMsg){
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch(e){
    try {
      const f = field || h('textarea', { readonly:'readonly', style:'position:fixed;left:-9999px;top:0' });
      if (!field){ f.value = text; document.body.append(f); }
      f.select(); ok = document.execCommand('copy');
      if (!field) f.remove();
    } catch(e2){}
  }
  if (ok) toast(okMsg || 'Ссылка скопирована');
  else if (!quiet) toast(field ? 'Не получилось скопировать. Выделите ссылку и скопируйте её вручную' : 'Не получилось скопировать');
}
/* Текст для «Скопировать» и «В Telegram» (этап 9.2) — один и тот же, простой, без оформления: ссылка, линия из «─», «Конспект для оператора слайдов»,
   «Название | Автор» (нет автора — только название), дата словами («8 ноября 2026 г.», нет даты — строки нет) */
const OP_LINE = '─'.repeat(20);
function opShareLines(url){
  const m = (state && state.meta) || {}, author = preacherName(m), date = fmtDate(m.date);
  const title = String(m.title || '').trim() || 'Без названия';
  const lines = [url, OP_LINE, 'Конспект для оператора слайдов', author ? title + ' | ' + author : title];
  if (date) lines.push(date);
  return lines;
}
/* Telegram сам ставит адрес первой строкой, поэтому в text его нет: сообщение выходит таким же, как скопированный текст */
function opTelegram(url){
  const text = opShareLines(url).slice(1).join('\n');
  window.open('https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text), '_blank', 'noopener');
}

/* ----- Страница оператора ----- */
function openOperator(key){
  if (screen === 'op' && opState.key === key){ if (!opState.unsub && opState.status !== 'gone') opStart(); return; }   // route() зовут и вход, и смена пользователя
  opStop();
  Object.assign(opState, { key, status:'load', data:null });
  screen = 'op';
  renderAll();
  opStart();
}
function opStart(){
  if (!cloud.api){
    if (cloud.mode === 'error'){ opState.status = 'error'; renderOperator(); }
    return;   // облако ещё подключается: initCloud позовёт route() снова
  }
  opWake();
  const key = opState.key;
  opState.unsub = cloud.api.watchShare(key, (d, meta) => {
    if (opState.key !== key) return;
    if (d){ opState.data = d; opState.status = 'ok'; }
    else if (!(meta && meta.fromCache)) Object.assign(opState, { data:null, status:'gone' });   // сервер ответил: документа нет. Пока ответа сервера нет (нет сети), «не работает» не пишем
    else return;
    renderOperator();
  }, () => {
    if (opState.key !== key || opState.data) return;   // уже что-то показываем: связь пропала, текст остаётся
    opState.status = 'error'; renderOperator();
  });
}
function opStop(){
  if (opState.unsub){ try { opState.unsub(); } catch(e){} opState.unsub = null; }
  opRelease();
}
function closeOperator(){
  opStop();
  Object.assign(opState, { key:'', status:'load', data:null });
  screen = 'home';
  if (cloud.api) startAuth();   // со страницы оператора ушли в форму: теперь нужен вход
}

/* Экран не гаснет, пока страница открыта (Wake Lock, где телефон позволяет; нет — молча) */
let opWakeLock = null;
async function opWake(){
  try {
    if (!navigator.wakeLock || document.visibilityState !== 'visible' || opWakeLock || screen !== 'op') return;
    const l = await navigator.wakeLock.request('screen');
    opWakeLock = l;
    l.addEventListener('release', () => { if (opWakeLock === l) opWakeLock = null; });
  } catch(e){}
}
function opRelease(){ const l = opWakeLock; opWakeLock = null; if (l){ try { l.release(); } catch(e){} } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && screen === 'op') opWake(); });   // при выключении экрана замок снимается сам

function opSave(){ LS.set(OP_VIEW_KEY, JSON.stringify(opView)); }
function opUpdated(ts){
  if (!ts) return '';
  const d = new Date(ts), t = new Date();
  const sameDay = d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  return 'Обновлено ' + (sameDay ? '' : d.toLocaleDateString('ru-RU', { day:'numeric', month:'long' }) + ' ') + 'в ' + fmtTime(ts);
}

function renderOperator(){
  if (screen !== 'op') return;
  const ws = window.scrollY, d = opState.data;
  document.title = (d && d.sermon.title ? d.sermon.title : 'Конспект') + ' · для оператора';
  mainEl.innerHTML = '';
  if (opState.status === 'ok' && d){
    const sm = d.sermon, blocks = Array.isArray(sm.blocks) ? sm.blocks : [];
    const setSize = x => { opView.size = Math.max(0.8, Math.min(1.8, Math.round((opView.size + x) * 10) / 10)); opSave(); renderOperator(); };
    const root = h('div', { class:'opv', style:'--ops:' + opView.size },
      h('header', { class:'opv-head' },
        h('div', { class:'opv-kick', text:'Для оператора' }),
        h('h1', { class:'opv-title', text:sm.title || 'Без названия' }),
        h('div', { class:'opv-meta', text:[fmtDate(sm.date), sm.author].filter(Boolean).join(' · ') }),
        h('div', { class:'opv-upd', text:opUpdated(d.updatedAt) })),
      h('div', { class:'opv-bar' },
        toggle([['all', 'Всё'], ['slides', 'Только слайды']], opView.showText ? 'all' : 'slides', v => { opView.showText = v === 'all'; opSave(); renderOperator(); }),
        h('div', { class:'size' }, h('button', { type:'button', title:'Мельче', 'aria-label':'Мельче', onclick:() => setSize(-0.1) }, 'A−'), h('button', { type:'button', title:'Крупнее', 'aria-label':'Крупнее', onclick:() => setSize(0.1) }, 'A+'))));
    const list = h('div', { class:'opv-list' });
    blocks.forEach(b => { const el = opBlock(b); if (el) list.append(el); });
    if (!blocks.length) list.append(h('p', { class:'opv-empty', text:'В конспекте пока нет слайдов.' }));
    root.append(list);
    wrapScripts(root);
    mainEl.append(root);
  } else if (opState.status === 'gone'){
    mainEl.append(opMessage('Эта ссылка больше не работает', 'Попросите новую у автора или редактора.'));
  } else if (opState.status === 'error'){
    mainEl.append(opMessage('Не получилось подключиться', 'Проверьте интернет и откройте ссылку ещё раз.', h('button', { type:'button', class:'btn primary', onclick:() => location.reload() }, 'Повторить')));
  } else {
    mainEl.append(opMessage('Открываю конспект…', ''));
  }
  window.scrollTo(0, ws);
}
function opMessage(title, text, action){
  return h('div', { class:'opv opv-msg' }, h('div', { class:'opv-kick', text:'Для оператора' }), h('h1', { class:'opv-title', text:title }), text ? h('p', { class:'opv-text', text }) : null, action || null);
}

/* Один слайд или заметка. Данные из облака проходят sanitize ещё раз: страницу открывают без входа, верить содержимому слепо не нужно */
function opBlock(b){
  if (!b || typeof b !== 'object') return null;
  if (b.t === 'note'){
    const t = String(b.text || '').trim();
    return t ? h('div', { class:'opv-note' }, h('div', { class:'opv-note-tag', text:'⚠ Оператору' }), h('div', { class:'opv-note-body', text:t })) : null;
  }
  const T = TYPES[b.t];
  if (!T || b.t === 'note') return null;
  const card = h('section', { class:'opv-slide' + (b.t === 'splash' ? ' cover' : ''), style:'--tc:' + (OP_COLORS[b.t] || '#ecdfcf') },
    h('div', { class:'opv-row' }, h('span', { class:'opv-num', text:pad(b.n || 0) }), h('span', { class:'opv-type', text:T.label })));
  switch (b.t){
    case 'scripture':
      (Array.isArray(b.items) ? b.items : []).forEach(it => {
        if (it.kind === 'text'){ const x = sanitize(it.html); if (x) card.append(h('div', { class:'opv-p opv-verses', html:x })); return; }
        const vs = (Array.isArray(it.verses) ? it.verses : []).map(v => (v.num ? '<sup>' + esc(String(v.num)) + '</sup>' + NBSP : '') + sanitize(v.text)).join(' ');
        card.append(h('div', { class:'opv-p' },
          h('div', { class:'opv-ref' }, it.ref || 'Место не указано', it.tr ? h('span', { class:'opv-tr', text:it.tr }) : null),
          vs ? h('div', { class:'opv-verses', html:vs }) : null));
      });
      break;
    case 'thesis':
      card.append(h('div', { class:'opv-thesis', html:sanitize(b.html) }));
      break;
    case 'quote':
      card.append(h('div', { class:'opv-verses', html:'«' + sanitize(b.html) + '»' }));
      if (b.author || b.caption) card.append(h('div', { class:'opv-author', text:'— ' + [b.author, b.caption].filter(Boolean).join(', ') }));
      break;
    case 'video':
      card.append(h('div', { class:'opv-name', text:b.name || 'Видео' }));
      if (b.from || b.to) card.append(h('div', { class:'opv-play', text:'▶ с ' + (b.from || '0:00') + ' до ' + (b.to || 'конца') }));
      break;
    case 'splash': break;
    default: card.append(h('div', { class:'opv-name', text:b.name || T.label }));
  }
  const wrap = h('div', { class:'opv-blk' }, card);
  if (opView.showText && b.speech){ const sp = sanitize(b.speech); if (sp) wrap.append(h('div', { class:'opv-speech', html:sp })); }
  return wrap;
}
