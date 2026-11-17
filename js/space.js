'use strict';

/* ========= Пространства (этапы 10 и 10.1.2): люди, серии проповедей, название и настройки =========
   Окно «Пространства» открывается из выпадающего списка пространств в шапке главной («Настроить пространства…», app.js),
   только админу и редактору. Слева — пространства (админ — все, редактор — те, где он редактор), справа — вкладки выбранного:
   • «Люди» (spaces/{s}/members): имя, фамилия, почта, Telegram, роль (Редактор, Автор, Оператор), последний вход. Правят админ и редактор;
     себе редактор не меняет почту и роль и себя не убирает (потерял бы доступ). Почта и Telegram необязательны: без почты в форму
     не войти, без Telegram человека нет в списке отправки. Оператор в форму не входит, даже с почтой. У человека без почты ключ
     записи p-<случайный>; почту добавили или сменили — запись переезжает (cloud-api.mjs, setMemberEmail).
     Из людей текущего пространства — список авторов в «О проповеди» (PREACHERS, только роль «Автор») и получатели «В Telegram»
     (tgPeople, operator.js: все, у кого указан Telegram);
   • «Серии проповедей» (config/series): название, «Активна», формат фона. «Свободная тема» встроена (у проповеди без серии), не меняется
     и не хранится. Удалить можно серию, которой нет ни в одном конспекте (и в корзине): считаем по сводкам. Выключенная остаётся
     в старых проповедях, но в выборе её больше нет;
   • «Общее»: название, время правки (lockMinutes), удаление пустого
     пространства. Правит админ, редактор только смотрит.
   Окно слушает выбранное пространство само (SPW, spwSelect). Для работы формы люди и серии текущего пространства приходят
   слушателями из cloud.js: setPeople, setSeriesData. Операторы этапа 10.1 (config/operators) переносятся в людей: migrateOps. */

const FREE_SERIES = 'Свободная тема';
const ROLE_LABEL = { editor:'Редактор', preacher:'Автор', operator:'Оператор' };
const canSpace = () => cloudOn() && (cloud.role === 'admin' || cloud.role === 'editor');
/* Пространства, которые человек настраивает: админ — все, редактор — те, где он редактор */
const setupSpaces = () => cloudOn() ? cloud.spaces.filter(sp => sp.role === 'admin' || sp.role === 'editor') : [];
const normName = s => String(s || '').trim().replace(/\s+/g, ' ');
const EMAIL_RE = /^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/;

/* ----- Люди ----- */
const personLabel = p => preacherName(p) || p.email || (p.tg ? '@' + p.tg : '');
function sortPeople(list){
  return (list || []).slice().sort((a, b) => (preacherKey(a) || a.email || a.tg || a.key || '').localeCompare(preacherKey(b) || b.email || b.tg || b.key || '', 'ru'));
}
/* Пришёл список людей текущего пространства: авторы для «О проповеди» — только роль «Автор» (этап 10.1.2) */
function setPeople(list){
  cloud.people = sortPeople(list);
  const keys = new Set();
  cloud.people.forEach(p => { const k = p.role === 'preacher' && preacherKey(p); if (k) keys.add(k); });
  PREACHERS.length = 0;
  [...keys].sort((a, b) => a.localeCompare(b, 'ru')).forEach(k => PREACHERS.push(k));
}
/* Кому отправить ссылку в Telegram (operator.js): все люди текущего пространства с Telegram, любой роли */
const tgPeople = () => (cloud.people || []).filter(p => p.tg).map(p => ({ name:preacherName(p) || '@' + p.tg, tg:p.tg }))
  .sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.tg.localeCompare(b.tg));
/* «Последний вход»: сегодня, 15:20 · вчера, 15:20 · 3 нояб., 15:20 (другой год — с годом) */
function seenWhen(ms){
  const d = new Date(ms), now = new Date(), day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const t = d.toLocaleTimeString('ru', { hour:'2-digit', minute:'2-digit' });
  const diff = Math.round((day(now) - day(d)) / DAY_MS);
  if (diff === 0) return 'сегодня, ' + t;
  if (diff === 1) return 'вчера, ' + t;
  return d.toLocaleDateString('ru', d.getFullYear() === now.getFullYear() ? { day:'numeric', month:'short' } : { day:'numeric', month:'short', year:'numeric' }) + ', ' + t;
}

/* ----- Операторы этапа 10.1 → люди с ролью «Оператор» (этап 10.1.2) ----- */
/* Один раз за страницу в каждом пространстве, которое настраивает этот человек. Не вышло (нет сети) — попробуем в следующий раз */
const opsMigrated = new Set();
function migrateOps(space){
  if (!space || !cloud.api || !cloud.api.migrateOperators || opsMigrated.has(space)) return;
  opsMigrated.add(space);
  cloud.api.migrateOperators(space, cloud.user).catch(() => opsMigrated.delete(space));
}

/* ----- Telegram (этап 10.1) ----- */
const TG_FORMAT_ERR = 'Имя пользователя в Telegram — латиницей, от 5 до 32 символов';
/* Любой вид ввода → имя пользователя: @ivan_op, ivan_op, t.me/ivan_op, https://t.me/ivan_op, telegram.me/ivan_op → ivan_op */
function tgNormalize(raw){
  let t = String(raw || '').trim().replace(/^https?:\/\//i, '').replace(/^(www\.)?(t\.me|telegram\.me|telegram\.dog)\//i, '').replace(/^@/, '');
  return t.split(/[/?#\s]/)[0];
}
/* Проверка по правилам Telegram: 5–32 символа, латиница, цифры и «_», с буквы, не на «_», без «__». Возвращает { tg, err } */
function tgCheck(raw){
  const t = String(raw || '').trim();
  if (!t || t === '@') return { tg:'', err:'Укажите имя пользователя в Telegram' };
  if (/^\+?[\d\s()\-.]{5,}$/.test(t)) return { tg:'', err:'Нужно имя пользователя в Telegram, а не номер' };
  const tg = tgNormalize(t);
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(tg)) return { tg, err:TG_FORMAT_ERR };
  if (/_$/.test(tg) || /__/.test(tg)) return { tg, err:'Имя пользователя не кончается на «_» и не содержит два «_» подряд' };
  return { tg, err:'' };
}
const tgTaken = (people, tg, exceptKey) => (people || []).some(p => p.key !== exceptKey && p.tg && p.tg.toLowerCase() === tg.toLowerCase());
/* «Проверить»: Telegram не даёт сайту узнать, есть ли такой человек, поэтому открываем его профиль — пусть посмотрят сами */
const openTgProfile = tg => window.open('https://t.me/' + encodeURIComponent(tg), '_blank', 'noopener');

/* ----- Серии ----- */
const seriesCacheKey = sp => 'swp-series-cache:' + (sp || '');
function normSeries(m){
  const out = {};
  if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
  Object.keys(m).forEach(id => {
    const x = m[id];
    if (!id || !x || typeof x !== 'object' || !normName(x.name)) return;
    out[id] = { name:normName(x.name).slice(0, 100), active:x.active !== false, format:typeof x.format === 'string' ? x.format : '' };
  });
  return out;
}
function setSeriesData(map, fromCache){
  SERIES = normSeries(map);
  if (!fromCache) LS.set(seriesCacheKey(cloud.space), JSON.stringify(SERIES));
  if (typeof refreshSlides === 'function') refreshSlides();   // фон проповеди зависит от формата серии
  if (screen === 'home' && cloudOn()) renderHomeList();
}
function loadSeriesCache(sp){
  let m = null; try { m = JSON.parse(LS.get(seriesCacheKey(sp)) || 'null'); } catch(e){}
  SERIES = normSeries(m);
}
/* Название серии проповеди: пусто — «Свободная тема»; серии нет в таблице (ещё не пришла или удалена) — пусто */
const seriesName = id => !id ? FREE_SERIES : SERIES[id] ? SERIES[id].name : '';
const seriesList = map => Object.keys(map || SERIES).map(id => Object.assign({ id }, (map || SERIES)[id])).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
const activeSeries = () => seriesList().filter(x => x.active);
const hasSeries = () => Object.keys(SERIES).length > 0;
function newSeriesId(map){ let id; do { id = 's' + Math.random().toString(36).slice(2, 10); } while (map[id]); return id; }
const seriesNameTaken = (map, name, except) => Object.keys(map).some(id => id !== except && map[id].name.toLowerCase() === normName(name).toLowerCase())
  || normName(name).toLowerCase() === FREE_SERIES.toLowerCase();
/* Записать серии пространства sp целиком; текущее пространство и окно обновляются сразу, не дожидаясь слушателя */
async function writeSeries(sp, next){
  try {
    await cloud.api.setSeries(sp, cloud.user, next);
    if (sp === cloud.space) setSeriesData(next);
    if (SPW && SPW.id === sp){ SPW.series = normSeries(next); renderSpaceSheet(); }
    return true;
  } catch(e){ toast(cloudExplain(e) || 'Не получилось сохранить серии.'); renderSpaceSheet(true); return false; }
}
/* Удалили формат фона (settings.js): у серий текущего пространства с ним — «По умолчанию» */
async function seriesFormatGone(fid){
  if (!canSpace() || !Object.keys(SERIES).some(id => SERIES[id].format === fid)) return;
  const next = JSON.parse(JSON.stringify(SERIES));
  Object.keys(next).forEach(id => { if (next[id].format === fid) next[id].format = ''; });
  await writeSeries(cloud.space, next);
}

/* ----- Поля в «О проповеди» ----- */
/* «Серия проповедей»: выбор из активных серий и «Свободной темы». Других активных серий нет и проповедь без серии —
   поле не меняется. Выключенная серия, которая уже стоит в проповеди, видна, но в списке её нет: сменили — не вернуть */
function seriesField(m, upd){
  const act = activeSeries(), cur = m.series || '';
  const label = () => seriesName(m.series || '') || FREE_SERIES;
  if (!act.length && !cur){
    return h('div', { class:'field' }, h('span', { class:'lbl', text:'Серия проповедей' }),
      h('div', { class:'dfield fixed', 'aria-disabled':'true', title:'Других серий в пространстве пока нет' }, FREE_SERIES));
  }
  const text = h('span', { class:'dtext', text:label() });
  const pick = id => { if (id) m.series = id; else delete m.series; text.textContent = label(); upd(); };
  const trig = h('button', { type:'button', class:'dfield', 'aria-haspopup':'listbox', 'aria-label':'Серия проповедей', onclick:() => dropdown(trig,
    [{ id:'', name:FREE_SERIES }].concat(act).map(x => ({ label:x.name, on:(m.series || '') === x.id, pick:() => pick(x.id) }))) }, text, ic('down'));
  return h('div', { class:'field' }, h('span', { class:'lbl', text:'Серия проповедей' }), trig);
}
/* «Формат фона» (этап 10.1.3) — только у админа и ролей, которым разрешено в «Настройках слайдов → Фон» (canPickBg).
   В поле — действующий фон и откуда он: «Фон 1 (указан для серии)», «Фон 2 (по умолчанию)», выбранный вручную — без скобок;
   в списке у форматов те же пометки. Выбрали формат, который подставился бы и сам (формат серии, без него — по умолчанию), —
   ручной выбор снимается: конспект снова идёт за серией */
function formatField(m, upd){
  const cfg = slidesCfg();
  if (!canPickBg(cfg)) return null;
  const s = { meta:m };
  const auto = () => seriesFormatOk(s, cfg) || cfg.defaultFormat;
  const cur = () => sermonFormatId(s, cfg);
  const text = h('span', { class:'dtext', text:formatLabel(cur(), s, cfg) });
  const pick = id => { if (id === auto()) delete m.format; else m.format = id; text.textContent = formatLabel(cur(), s, cfg); upd(); };
  const trig = h('button', { type:'button', class:'dfield', 'aria-haspopup':'listbox', 'aria-label':'Формат фона', onclick:() => dropdown(trig,
    formatList(cfg).map(f => ({ label:formatLabel(f.id, s, cfg), on:cur() === f.id, pick:() => pick(f.id) }))) },
    text, ic('down'));
  const box = h('div', { class:'field' }, h('span', { class:'lbl', text:'Формат фона' }), trig);
  box._refresh = () => { if (m.format && m.format === auto()) delete m.format; text.textContent = formatLabel(cur(), s, cfg); };   // сменили серию: подпись (и ручной выбор, если он совпал с форматом серии) — заново
  return box;
}

/* ----- Окно «Пространства» ----- */
/* SPW — открытое окно: выбранное пространство, вкладка и его данные из своих слушателей.
   people / series: null — ещё не пришли; slides — настройки слайдов другого пространства (undefined — ещё не пришли, null — нет записи);
   usage — сколько конспектов в каких сериях (у текущего пространства считаем по cloud.list) */
let SPW = null;
const spwSpace = () => SPW && cloud.spaces.find(x => x.id === SPW.id);
const spwAdmin = () => { const sp = spwSpace(); return !!sp && sp.role === 'admin'; };
function openSpaces(id, tab){
  const list = setupSpaces();
  if (!list.length) return;
  const pick = list.find(x => x.id === id) || list.find(x => x.id === cloud.space) || list[0];
  spwSelect(pick.id, tab || 'people');
  settingsGuard = () => spLeave();   // несохранённая правка таблицы: спросить перед закрытием
  settingsOverlay.classList.add('open');
}
function spwStop(){
  if (!SPW) return;
  SPW.off.forEach(f => { try { f(); } catch(e){} });
  SPW = null;
}
function spwSelect(id, tab){
  const keep = tab || (SPW && SPW.tab) || 'people';
  spwStop();
  const me = SPW = { id, tab:keep, people:null, series:null, slides:undefined, usage:null, off:[] };
  const live = () => SPW === me, api = cloud.api;
  me.off.push(api.watchMembers(id, list => { if (live()){ me.people = sortPeople(list); renderSpaceSheet(); } }, () => {}));
  me.off.push(api.watchSeries(id, m => { if (live()){ me.series = normSeries(m); renderSpaceSheet(); } }, () => {}));
  if (id !== cloud.space){
    if (api.watchSlides) me.off.push(api.watchSlides(id, cfg => { if (live()){ me.slides = cfg || null; renderSpaceSheet(); } }, () => {}));
    if (api.spaceUsage) api.spaceUsage(id).then(u => { if (live()){ me.usage = u; renderSpaceSheet(); } }, () => {});
  }
  migrateOps(id);
  drawSpace();
}
/* Сколько конспектов (с корзиной) в каждой серии выбранного пространства; null — ещё не знаем */
function seriesUse(){
  if (!SPW) return null;
  if (SPW.id === cloud.space){
    if (!cloud.list) return null;
    const out = {};
    cloud.list.forEach(r => { const x = r.meta && r.meta.series; if (x) out[x] = (out[x] || 0) + 1; });
    return out;
  }
  return SPW.usage ? SPW.usage.series || {} : null;
}
/* Настройки слайдов выбранного пространства (форматы фона для серий) */
const spwCfg = () => SPW.id === cloud.space ? slidesCfg() : mergeSlides(SLIDES_DEFAULT, SPW.slides || null);

/* Пришли новые данные: окно открыто — перерисовать. Пока человек печатает в поле, не мешаем: перерисуем, когда уйдёт из поля */
let spaceRedraw = false;
function renderSpaceSheet(force){
  const sh = settingsOverlay.querySelector('.space-sheet');
  if (!sh || !settingsOverlay.classList.contains('open') || !SPW) return;
  const a = document.activeElement;
  if (!force && a && sh.contains(a) && /^(INPUT|SELECT)$/.test(a.tagName)){ spaceRedraw = true; return; }
  drawSpace();
}
function drawSpace(){
  spaceRedraw = false;
  if (!SPW) return;
  if (!spwSpace()){   // пространство пропало (удалили): выбрать другое
    const next = setupSpaces()[0];
    if (next) spwSelect(next.id); else closeSettings(true);
    return;
  }
  const tabs = [['people', 'Люди'], ['series', 'Серии проповедей'], ['general', 'Общее']];
  const body = SPW.tab === 'series' ? seriesTable() : SPW.tab === 'general' ? spaceGeneral() : peopleTable();
  const side = h('div', { class:'spw-side' },
    h('div', { class:'spw-list', role:'tablist', 'aria-label':'Пространства', 'aria-orientation':'vertical' }, setupSpaces().map(x =>
      h('button', { type:'button', role:'tab', class:'spw-item' + (x.id === SPW.id ? ' on' : ''), 'aria-selected':String(x.id === SPW.id), 'data-id':x.id,
        onclick:() => { if (x.id !== SPW.id && spLeave()) spwSelect(x.id); } }, x.name || x.id))),
    cloud.admin ? h('button', { type:'button', class:'btn small spw-new', onclick:() => openNewSpace(() => drawSpace()) }, ic('plus'), 'Новое пространство') : null);
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet wide space-sheet', role:'dialog', 'aria-label':'Пространства',
    onfocusout:e => { if (spaceRedraw && !(e.relatedTarget && e.currentTarget.contains(e.relatedTarget))) setTimeout(() => renderSpaceSheet(), 0); } },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Пространства' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('div', { class:'spw' }, side,
      h('div', { class:'spw-main' },
        h('div', { class:'seg space-tabs', role:'tablist' }, tabs.map(([k, t]) => h('button', { type:'button', role:'tab', class:SPW.tab === k ? 'on' : '', 'aria-selected':String(SPW.tab === k),
          onclick:() => { if (SPW.tab !== k && spLeave()){ SPW.tab = k; drawSpace(); } } }, t))),
        body))));
  requestAnimationFrame(() => {   // на узком экране полосы прокручиваются: выбранное пространство и вкладка видны целиком (этап 10.1.1)
    settingsOverlay.querySelectorAll('.space-tabs, .spw-list').forEach(strip => {
      const on = strip.querySelector('.on');
      if (!on || strip.scrollWidth <= strip.clientWidth) return;
      const d = on.getBoundingClientRect().right - strip.getBoundingClientRect().right + 12;
      if (d > 0) strip.scrollLeft += d;
    });
  });
}
const spaceErr = (e, fallback) => toast(cloudExplain(e) || fallback);
const loadingBody = () => h('div', { class:'sp-body' }, h('p', { class:'hint sp-empty', text:'Загружаю…' }));

/* ----- Таблицы «Люди» и «Серии проповедей» (этап 10.4.1): просмотр и правка -----
   Просмотр — только текст, кнопка «Изменить» (админ и редактор). Правка — вся таблица сразу: поля тёмные с жёлтой рамкой, как в конспекте,
   изменения копятся в черновике (SPW.edit) и уходят в облако одной кнопкой «Сохранить»; «Отменить» всё возвращает.
   Пока идёт правка, строки не сортируются: новые — внизу; по алфавиту — после «Сохранить» или «Отменить».
   Ушли с несохранёнными изменениями (другая вкладка, пространство, крестик, Esc) — форма спросит */
const spEditing = tab => !!(SPW && SPW.edit && SPW.edit.tab === tab);
const clone = x => JSON.parse(JSON.stringify(x));
function spDirty(){
  const e = SPW && SPW.edit;
  if (!e) return false;
  if (e.tab === 'series') return JSON.stringify(e.draft) !== JSON.stringify(e.base) || e.order.some(id => !e.base[id] && normName(e.draft[id].name));
  return e.rows.some(r => r.del ? !r.isNew : r.isNew ? personFilled(r) : personChanged(r));
}
/* Уйти из правки: изменений нет или человек согласился их выбросить */
function spLeave(){
  if (!spDirty()) { if (SPW) SPW.edit = null; return true; }
  if (!confirm('Изменения в таблице не сохранены. Выйти без сохранения?')) return false;
  SPW.edit = null;
  return true;
}
function spStartEdit(tab){
  if (tab === 'series'){
    const base = clone(SPW.series || {});
    SPW.edit = { tab, base, draft:clone(base), order:seriesList(base).map(x => x.id), err:{} };
  } else {
    SPW.edit = { tab, rows:(SPW.people || []).map(p => Object.assign(clone(p), { orig:clone(p) })), err:{} };
  }
  drawSpace();
  const first = settingsOverlay.querySelector('.sp-table.editing input');
  if (first) first.focus();
}
function spCancel(){ if (spLeave()) drawSpace(); }
/* Полоса над таблицей: подсказка и «Изменить» в просмотре; в правке — «Правка таблицы» и сколько изменений */
function spBar(tab, hint){
  if (spEditing(tab)) return h('div', { class:'sp-bar editing' }, h('span', { class:'sp-mode', text:'Правка таблицы. Сохраните, когда закончите' }));
  return h('div', { class:'sp-bar' }, h('p', { class:'hint', text:hint || '' }),
    canSpace() ? h('button', { type:'button', class:'btn primary small sp-edit', onclick:() => spStartEdit(tab) }, ic('edit'), 'Изменить') : null);
}
function spFoot(tab, onSave){
  if (!spEditing(tab)) return null;
  const save = h('button', { type:'button', class:'btn small sp-save', onclick:async () => { save.disabled = true; try { await onSave(); } finally { save.disabled = false; } } }, 'Сохранить');
  return h('div', { class:'sp-foot' }, h('span'), h('div', { class:'chips' },
    h('button', { type:'button', class:'btn ghost small', onclick:spCancel }, 'Отменить'), save));
}
const errLine = msg => h('span', { class:'sp-err', role:'alert', text:msg || '' });

/* ----- Люди ----- */
const PERSON_KEYS = ['firstName', 'lastName', 'email', 'tg', 'role'];
const personFilled = r => !!(normName(r.firstName) || normName(r.lastName) || String(r.email || '').trim() || String(r.tg || '').trim());
const personChanged = r => PERSON_KEYS.some(k => String(r[k] || '') !== String(r.orig[k] || ''));
function peopleTable(){
  const list = SPW.people;
  if (!list) return loadingBody();
  const sid = SPW.id, adm = spwAdmin(), edit = spEditing('people');
  const self = p => !adm && !!p.email && p.email === myEmail();   // редактор себе почту и роль не меняет и себя не убирает
  const seen = p => p.isNew ? h('span', { class:'sp-seen', text:'' })
    : p.role === 'operator' ? h('span', { class:'sp-seen', title:'Оператор в форму не входит', text:'—' })
    : !p.email ? h('span', { class:'sp-seen', title:'Без почты в форму не войти', text:'—' })
    : p.seenAt ? h('span', { class:'sp-seen on', title:'Последний вход в форму', text:seenWhen(p.seenAt) })
    : h('span', { class:'sp-seen', title:'Ещё ни разу не входил под этой почтой', text:'не входил' });
  const head = h('div', { class:'sp-row sp-head', role:'row' },
    [['Имя'], ['Фамилия'], ['Почта', 'С почтой человек входит в форму'], ['Telegram', 'С Telegram ему можно отправить ссылку на конспект'], ['Роль'], ['Последний вход'], ['']]
      .map(([t, tip]) => h('span', { role:'columnheader', text:t, title:tip || null })));
  let rows;
  if (!edit){
    const txt = (v, cls) => h('span', { class:'sp-cell' + (cls ? ' ' + cls : ''), text:v || '' });
    rows = list.map(p => h('div', { class:'sp-row', role:'row', 'data-key':p.key, 'data-email':p.email || null },
      txt(p.firstName), txt(p.lastName), txt(p.email, 'sp-mail'),
      h('span', { class:'sp-tg' }, txt(p.tg ? '@' + p.tg : ''),
        p.tg ? iconBtn('telegram', 'Проверить: откроется профиль в Telegram, посмотрите, тот ли это человек', () => openTgProfile(p.tg), 'sp-check') : null),
      txt(ROLE_LABEL[p.role] || p.role, 'sp-role'), seen(p), h('span')));
  } else {
    const E = SPW.edit;
    rows = E.rows.filter(r => !r.del).map(r => {
      const id = r.key || r.tmp;
      const inp = (k, ph, extra) => h('input', Object.assign({ class:'input', value:r[k] || '', placeholder:ph, 'aria-label':ph, autocomplete:'off',
        oninput:e => { r[k] = e.target.value; } }, extra || {}));
      const mail = self(r) ? h('span', { class:'sp-mail', title:'Свою почту вам поменяет админ', text:r.email })
        : inp('email', 'Почта Google', { type:'email', spellcheck:'false', autocapitalize:'off' });
      const tg = h('span', { class:'sp-tg' }, h('input', { class:'input', value:r.tg ? (String(r.tg).startsWith('@') ? r.tg : '@' + r.tg) : '', placeholder:'@имя в Telegram', 'aria-label':'Telegram',
        autocomplete:'off', autocapitalize:'off', spellcheck:'false', oninput:e => { r.tg = e.target.value; } }));
      const role = self(r) ? h('span', { class:'sp-role', title:'Свою роль вам поменяет админ', text:ROLE_LABEL[r.role] || r.role })
        : h('label', { class:'hf-sel' }, h('select', { 'aria-label':'Роль', onchange:e => { r.role = e.target.value; } },
          Object.keys(ROLE_LABEL).map(k => h('option', { value:k, text:ROLE_LABEL[k], selected:r.role === k }))), ic('down'));
      const del = self(r) ? h('span') : iconBtn('trash', r.isNew ? 'Убрать строку' : 'Убрать из пространства', () => { r.del = true; drawSpace(); }, 'danger');
      return h('div', { class:'sp-row' + (r.isNew ? ' sp-new' : ''), role:'row', 'data-key':r.key || null, 'data-email':r.email || null, 'data-tmp':r.tmp || null },
        inp('firstName', 'Имя', { maxlength:'100' }), inp('lastName', 'Фамилия', { maxlength:'100' }), mail, tg, role, seen(r), del, errLine(E.err[id]));
    });
    rows.push(h('div', { class:'sp-row sp-addline', role:'row' }, h('button', { type:'button', class:'btn ghost small sp-addrow', onclick:() => {
      SPW.edit.rows.push({ tmp:'n' + Math.random().toString(36).slice(2, 8), isNew:true, firstName:'', lastName:'', email:'', tg:'', role:'preacher' });
      drawSpace();
      const ins = settingsOverlay.querySelectorAll('.sp-people .sp-new input[aria-label="Имя"]');
      if (ins.length) ins[ins.length - 1].focus();
    } }, ic('plus'), 'Добавить человека')));
  }
  return h('div', { class:'sp-body' }, spBar('people'),
    h('div', { class:'sp-table sp-people' + (edit ? ' editing' : ''), role:'table', 'aria-label':'Люди' }, head,
      rows.length ? rows : h('p', { class:'hint sp-empty', text:'В пространстве пока никого нет' })),
    spFoot('people', () => savePeople(sid)));
}
/* Проверить черновик «Людей»: ошибки — у строк (E.err), true — можно сохранять. Пустые новые строки просто выпадают */
function checkPeople(E){
  E.err = {};
  E.rows = E.rows.filter(r => !(r.isNew && (r.del || !personFilled(r))));
  const live = E.rows.filter(r => !r.del), mails = new Map(), tgs = new Map();
  /* Повтор почты или Telegram: ошибка — у строки, которую правили (новая или изменённая), а не просто у нижней */
  const touched = (r, k) => r.isNew || String(r[k] || '') !== String(r.orig[k] || '');
  const dup = (r, other, k, m) => { const t = touched(r, k) || !touched(other, k) ? r : other, tid = t.key || t.tmp; if (!E.err[tid]) E.err[tid] = m; };
  live.forEach(r => {
    const id = r.key || r.tmp, bad = m => { if (!E.err[id]) E.err[id] = m; };
    r.firstName = normName(r.firstName); r.lastName = normName(r.lastName);
    r.email = String(r.email || '').trim().toLowerCase();
    if (!r.firstName && !r.lastName && (r.isNew || !r.email)) bad(r.isNew || !r.orig.email ? 'Укажите имя или фамилию' : 'Укажите имя или фамилию, потом уберите почту');
    if (r.email && !EMAIL_RE.test(r.email)) bad('Проверьте почту');
    if (r.email){ if (mails.has(r.email)) dup(r, mails.get(r.email), 'email', 'Человек с такой почтой уже есть'); else mails.set(r.email, r); }
    const raw = String(r.tg || '').trim();
    if (!raw || raw === '@') r.tg = '';
    else {
      const c = tgCheck(raw);
      if (c.err) bad(c.err);
      else { const k = c.tg.toLowerCase(), was = String(r.orig && r.orig.tg || '').toLowerCase(); r.tg = c.tg;
        if (tgs.has(k)){ const o = tgs.get(k); (r.isNew || was !== k) || String(o.orig && o.orig.tg || '').toLowerCase() === k ? bad('Этот Telegram уже указан у другого человека') : (E.err[o.key || o.tmp] = E.err[o.key || o.tmp] || 'Этот Telegram уже указан у другого человека'); }
        else tgs.set(k, r); }
    }
  });
  return !Object.keys(E.err).length;
}
async function savePeople(sid){
  const E = SPW.edit, api = cloud.api;
  if (!checkPeople(E)){ drawSpace(); return; }
  const gone = E.rows.filter(r => r.del && !r.isNew);
  if (gone.length){
    const logins = gone.some(p => p.orig.email && p.orig.role !== 'operator');
    if (!confirm('Убрать из пространства: ' + gone.map(p => personLabel(p.orig)).join(', ') + '?' + (logins ? ' Войти сюда они больше не смогут, а их конспекты останутся.' : ''))) return;
  }
  let failed = false;
  const fail = (r, e, msg) => { failed = true; E.err[r.key || r.tmp] = e && e.code === 'exists' ? 'Человек с такой почтой уже есть' : cloudExplain(e) || msg; };
  for (const r of gone){
    try { await api.removeMember(sid, r.key); r.done = true; } catch(e){ failed = true; r.del = false; E.err[r.key] = cloudExplain(e) || 'Не получилось убрать'; }
  }
  E.rows = E.rows.filter(r => !r.done);
  for (const r of E.rows.filter(x => !x.del)){
    if (r.isNew){
      try { await api.addMember(sid, cloud.user, { email:r.email, role:r.role, firstName:r.firstName, lastName:r.lastName, tg:r.tg }); r.isNew = false; r.orig = clone(r); r.saved = true; }
      catch(e){ fail(r, e, 'Не получилось добавить'); }
      continue;
    }
    const fields = {};
    ['firstName', 'lastName', 'tg', 'role'].forEach(k => { if (String(r[k] || '') !== String(r.orig[k] || '')) fields[k] = r[k] || ''; });
    try {
      if (Object.keys(fields).length){ await api.updateMember(sid, r.key, fields); Object.assign(r.orig, fields); }
      if (r.email !== (r.orig.email || '')){ await api.setMemberEmail(sid, cloud.user, r.key, r.email); r.orig.email = r.email; }
    } catch(e){ fail(r, e, 'Не получилось сохранить'); }
  }
  if (failed){ drawSpace(); return; }
  SPW.edit = null;
  toast('Сохранено');
  drawSpace();
}

/* ----- Серии проповедей ----- */
function seriesTable(){
  const map = SPW.series;
  if (!map) return loadingBody();
  const sid = SPW.id, cfg = spwCfg(), use = seriesUse(), edit = spEditing('series'), E = SPW.edit;
  const fmtName = id => id && (id === SYSTEM_FORMAT || cfg.formats[id]) ? formatName(id, cfg) : 'По умолчанию';
  const useText = id => { const n = use ? use[id] || 0 : null; return n == null ? '…' : n ? String(n) : '—'; };
  const head = h('div', { class:'sp-row sp-head', role:'row' }, ['Название', 'Активна', 'Формат фона', 'В конспектах', ''].map(t => h('span', { role:'columnheader', text:t })));
  const free = h('div', { class:'sp-row sp-fixed', role:'row', title:'Встроенная серия: у проповедей без серии. Её нельзя изменить' },
    h('span', { class:'sp-name', text:FREE_SERIES }), h('span', { class:'muted', text:'Всегда' }), h('span', { class:'muted', text:'По умолчанию' }), h('span', { class:'muted', text:'—' }), h('span'));
  let rows;
  if (!edit){
    rows = seriesList(map).map(x => h('div', { class:'sp-row', role:'row', 'data-id':x.id },
      h('span', { class:'sp-cell sp-name', text:x.name }),
      h('span', { class:'sp-state' + (x.active ? ' on' : ''), text:x.active ? 'Активна' : 'Выключена' }),
      h('span', { class:'sp-cell', text:fmtName(x.format) }),
      h('span', { class:'sp-cell muted', text:useText(x.id) }), h('span')));
  } else {
    const fmtSel = x => h('label', { class:'hf-sel' }, h('select', { 'aria-label':'Формат фона', onchange:e => { x.format = e.target.value; } },
      [['', 'По умолчанию']].concat(formatList(cfg).map(f => [f.id, f.name])).map(([v, t]) => h('option', { value:v, text:t, selected:v === (x.format && (x.format === SYSTEM_FORMAT || cfg.formats[x.format]) ? x.format : '') }))), ic('down'));
    const delBtn = id => {
      const n = E.base[id] ? (use ? use[id] || 0 : null) : 0;
      if (n === 0) return iconBtn('trash', 'Удалить серию', () => { delete E.draft[id]; E.order = E.order.filter(x => x !== id); drawSpace(); }, 'danger');
      const tip = n == null ? 'Проверяю, выбрана ли серия в конспектах' : 'Выбрана в конспектах: ' + n;
      const b = iconBtn('trash', tip, null, 'danger'); b.disabled = true;
      return h('span', { class:'sp-del-off', title:tip }, b);
    };
    rows = E.order.filter(id => E.draft[id]).map(id => {
      const x = E.draft[id];
      return h('div', { class:'sp-row' + (E.base[id] ? '' : ' sp-new'), role:'row', 'data-id':id },
        h('input', { class:'input', value:x.name, maxlength:'100', placeholder:'Название серии', 'aria-label':'Название серии', autocomplete:'off', oninput:e => { x.name = e.target.value; } }),
        sw('Активна', x.active, on => { x.active = on; }),
        fmtSel(x), h('span', { class:'sp-cell muted', text:E.base[id] ? useText(id) : '—' }), delBtn(id), errLine(E.err[id]));
    });
    rows.push(h('div', { class:'sp-row sp-addline', role:'row' }, h('button', { type:'button', class:'btn ghost small sp-addrow', onclick:() => {
      const id = newSeriesId(Object.assign({}, SPW.series, E.draft));
      E.draft[id] = { name:'', active:true, format:'' }; E.order.push(id);
      drawSpace();
      const inp = settingsOverlay.querySelector('.sp-series .sp-row[data-id="' + id + '"] input');
      if (inp) inp.focus();
    } }, ic('plus'), 'Добавить серию')));
  }
  return h('div', { class:'sp-body' },
    spBar('series', 'Серию выбирают в «О проповеди». Фон слайдов проповеди — формат её серии. Выключенная серия остаётся в прошлых проповедях, но выбрать её больше нельзя.'),
    h('div', { class:'sp-table sp-series' + (edit ? ' editing' : ''), role:'table', 'aria-label':'Серии проповедей' }, head, free, rows),
    spFoot('series', () => saveSeries(sid)));
}
/* Сохранить черновик серий: пустые новые строки выпадают; изменения ложатся поверх последних данных из облака (SPW.series),
   чтобы не стереть то, что за это время поменял другой человек */
async function saveSeries(sid){
  const E = SPW.edit;
  E.err = {};
  E.order = E.order.filter(id => E.draft[id] && (E.base[id] || normName(E.draft[id].name)));
  Object.keys(E.draft).forEach(id => { if (!E.order.includes(id)) delete E.draft[id]; });
  const seen = new Set();
  E.order.forEach(id => {
    const x = E.draft[id], v = normName(x.name), k = v.toLowerCase();
    x.name = v;
    if (!v) E.err[id] = 'У серии должно быть название';
    else if (seen.has(k) || k === FREE_SERIES.toLowerCase()) E.err[id] = 'Серия с таким названием уже есть';
    seen.add(k);
  });
  if (Object.keys(E.err).length){ drawSpace(); return; }
  const next = clone(SPW.series || {});
  Object.keys(E.base).forEach(id => { if (!E.draft[id]) delete next[id]; });
  E.order.forEach(id => { next[id] = Object.assign({}, next[id], E.draft[id]); });
  if (!(await writeSeries(sid, next))) return;
  SPW.edit = null;
  toast('Сохранено');
  drawSpace();
}

/* Общее: правит админ, редактор только смотрит. Новое пространство — кнопка слева, под списком */
function spaceGeneral(){
  const sp = spwSpace(), adm = spwAdmin(), mins = +(sp.settings || {}).lockMinutes || 10;
  const saveSpace = async (fields, input) => {
    try {
      await cloud.api.updateSpace(sp.id, cloud.user, fields);
      if (fields.name != null){
        sp.name = fields.name;
        if (sp.id === cloud.space) cloud.spaceName = fields.name;
        cloud.spaces.sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id));
        renderTopbar();
      }
      if (fields.lockMinutes != null){
        sp.settings = Object.assign({}, sp.settings, { lockMinutes:fields.lockMinutes });
        if (sp.id === cloud.space) cloud.settings = sp.settings;
      }
      toast('Сохранено');
      renderSpaceSheet(true);
    } catch(e){ spaceErr(e, 'Не получилось сохранить.'); if (input) renderSpaceSheet(true); }
  };
  const nameEl = adm ? h('input', { class:'input', value:sp.name || '', 'aria-label':'Название пространства', maxlength:'100', autocomplete:'off',
    onchange:e => {
      const v = normName(e.target.value);
      if (!v){ e.target.value = sp.name; return; }
      if (cloud.spaces.some(x => x.id !== sp.id && x.name.toLowerCase() === v.toLowerCase())){ toast('Пространство с таким названием уже есть'); e.target.value = sp.name; return; }
      if (v !== sp.name) saveSpace({ name:v }, e.target);
    } })
    : h('div', { class:'dfield fixed', 'aria-disabled':'true' }, sp.name || '');
  const minEl = adm ? h('input', { class:'input sp-num', type:'number', min:'1', max:'120', step:'1', value:String(mins), 'aria-label':'Минут без действий',
    onchange:e => { const v = Math.round(+e.target.value); if (!(v >= 1 && v <= 120)){ e.target.value = String(mins); toast('От 1 до 120 минут'); return; } if (v !== mins) saveSpace({ lockMinutes:v }, e.target); } })
    : h('span', { class:'dfield fixed sp-num', 'aria-disabled':'true' }, String(mins));
  return h('div', { class:'sp-body sp-general' },
    adm ? null : h('p', { class:'hint', text:'Эти настройки меняет админ.' }),
    field('Название', nameEl),
    h('div', { class:'field' }, h('span', { class:'lbl', text:'Правка без действий' }),
      h('div', { class:'sp-inline' }, h('span', { text:'завершается сама через' }), minEl, h('span', { text:'мин.' })),
      h('p', { class:'hint', text:'Форма сохраняет правки и отпускает конспект, чтобы его могли править другие.' })),
    adm ? deleteSpaceField(sp) : null);
}
/* Удалить пространство (этап 10.1.2): только админ и только пустое — ни конспектов, ни корзины */
const notEmptyMsg = n => 'В пространстве есть конспекты (' + n + '). Удалите их и очистите корзину, потом удалите пространство.';
function deleteSpaceField(sp){
  const err = h('p', { class:'sp-err', role:'alert' });
  const btn = h('button', { type:'button', class:'btn danger', onclick:async () => {
    err.textContent = ''; btn.disabled = true;
    try {
      const u = await cloud.api.spaceUsage(sp.id);
      if (u.sermons > 0){ err.textContent = notEmptyMsg(u.sermons); return; }
      if (!confirm('Удалить пространство «' + sp.name + '»? Вместе с ним удалятся люди, серии проповедей и настройки слайдов. Вернуть их будет нельзя.')) return;
      await cloud.api.deleteSpace(sp.id);
    } catch(e){ err.textContent = e && e.code === 'not-empty' ? notEmptyMsg(e.count || 1) : cloudExplain(e) || 'Не получилось удалить'; return; }
    finally { btn.disabled = false; }
    spaceGone(sp);
  } }, ic('trash'), 'Удалить пространство');
  return h('div', { class:'field sp-danger' }, h('span', { class:'lbl', text:'Удаление' }), h('div', { class:'chips' }, btn), err);
}
async function spaceGone(sp){
  toast('Пространство «' + sp.name + '» удалено');
  if (sp.id === cloud.space){   // удалили текущее: заново все пространства, текущим станет первое
    closeSettings(true);
    if (cloudOn()) endCloud();
    if (location.hash) navigate('');
    await cloudUser(cloud.user);
    return;
  }
  cloud.spaces = cloud.spaces.filter(x => x.id !== sp.id);
  renderTopbar();
  const next = setupSpaces().find(x => x.id === cloud.space) || setupSpaces()[0];
  if (next) spwSelect(next.id, 'general'); else closeSettings(true);
}

/* Новое пространство — только админ. Людей в нём сначала нет: окно «Пространства» откроется на нём, на вкладке «Люди».
   back — вернуться в окно «Пространства» (если открыли оттуда) */
function openNewSpace(back){
  if (!cloud.admin) return;
  const name = h('input', { class:'input', placeholder:'Например, «Słowo Wiary Poznań»', 'aria-label':'Название пространства', maxlength:'100', autocomplete:'off' });
  const err = h('p', { class:'sp-err', role:'alert' });
  const make = async () => {
    const v = normName(name.value);
    err.textContent = '';
    if (!v){ name.focus(); return; }
    if (cloud.spaces.some(x => x.name.toLowerCase() === v.toLowerCase())){ err.textContent = 'Пространство с таким названием уже есть'; return; }
    btn.disabled = true; btn.textContent = 'Создаю…';
    try {
      const sp = await cloud.api.createSpace(cloud.user, v);
      closeSettings(true);
      if (cloudOn()) endCloud();   // открытую правку — сохранить и отпустить
      LS.set('swp-space', sp.id);
      if (location.hash) navigate('');
      await cloudUser(cloud.user);   // заново: все пространства, новое — текущее
      toast('Пространство «' + v + '» создано');
      if (cloudOn()) openSpaces(sp.id, 'people');
    } catch(e){ err.textContent = cloudExplain(e) || 'Не получилось создать'; btn.disabled = false; btn.textContent = 'Создать'; }
  };
  const btn = h('button', { type:'button', class:'btn primary', onclick:make }, 'Создать');
  name.addEventListener('keydown', e => { if (e.key === 'Enter') make(); });
  const close = typeof back === 'function' && SPW ? back : closeSettings;
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet new-space-sheet', role:'dialog', 'aria-label':'Новое пространство' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Новое пространство' }), iconBtn('close', 'Закрыть', () => close())),
    h('p', { class:'hint', text:'У пространства свои конспекты, люди, серии и настройки слайдов. Сначала в нём никого нет: людей вы добавите сами.' }),
    h('div', { class:'set-grid' }, field('Название', name), err),
    h('div', { class:'sheet-foot' }, h('span'), btn)));
  settingsOverlay.classList.add('open');
  name.focus();
}
