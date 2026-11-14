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
   • «Общее»: название, время правки (lockMinutes), «Выбирать формат фона в проповеди» (config/slides, pickFormat), удаление пустого
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
/* «Формат фона» — только если в пространстве включено «Выбирать формат фона в проповеди». «По умолчанию» — формат серии,
   а у серии с «По умолчанию» — формат по умолчанию пространства. Выбранного формата уже нет — тоже «По умолчанию» */
function formatField(m, upd){
  const cfg = slidesCfg();
  if (!cfg.pickFormat) return null;
  const own = () => { const f = m.format; return f && (f === SYSTEM_FORMAT || cfg.formats[f]) ? f : ''; };
  const dflt = () => { const x = m.series && SERIES[m.series], f = x && x.format && (x.format === SYSTEM_FORMAT || cfg.formats[x.format]) ? x.format : cfg.defaultFormat; return formatName(f, cfg); };
  const label = () => own() ? formatName(own(), cfg) : 'По умолчанию · ' + dflt();
  const text = h('span', { class:'dtext', text:label() });
  const pick = id => { if (id) m.format = id; else delete m.format; text.textContent = label(); upd(); };
  const trig = h('button', { type:'button', class:'dfield', 'aria-haspopup':'listbox', 'aria-label':'Формат фона', onclick:() => dropdown(trig,
    [{ label:'По умолчанию · ' + dflt(), on:!own(), pick:() => pick('') }, { sep:true }].concat(formatList(cfg).map(f => ({ label:f.name, on:own() === f.id, pick:() => pick(f.id) })))) },
    text, ic('down'));
  const box = h('div', { class:'field' }, h('span', { class:'lbl', text:'Формат фона' }), trig);
  box._refresh = () => { text.textContent = label(); };   // сменили серию — «По умолчанию» теперь другой
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
/* Настройки слайдов выбранного пространства (форматы фона, pickFormat) */
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
        onclick:() => { if (x.id !== SPW.id) spwSelect(x.id); } }, x.name || x.id))),
    cloud.admin ? h('button', { type:'button', class:'btn small spw-new', onclick:() => openNewSpace(() => drawSpace()) }, ic('plus'), 'Новое пространство') : null);
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet wide space-sheet', role:'dialog', 'aria-label':'Пространства',
    onfocusout:e => { if (spaceRedraw && !(e.relatedTarget && e.currentTarget.contains(e.relatedTarget))) setTimeout(() => renderSpaceSheet(), 0); } },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Пространства' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('div', { class:'spw' }, side,
      h('div', { class:'spw-main' },
        h('div', { class:'seg space-tabs', role:'tablist' }, tabs.map(([k, t]) => h('button', { type:'button', role:'tab', class:SPW.tab === k ? 'on' : '', 'aria-selected':String(SPW.tab === k),
          onclick:() => { SPW.tab = k; drawSpace(); } }, t))),
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

/* Люди: админ и редактор правят прямо в таблице, изменения уходят сразу */
function peopleTable(){
  const list = SPW.people;
  if (!list) return loadingBody();
  const sid = SPW.id, adm = spwAdmin();
  const self = p => !adm && !!p.email && p.email === myEmail();   // редактор себе почту и роль не меняет и себя не убирает
  const save = (p, fields) => cloud.api.updateMember(sid, p.key, fields).catch(e => { spaceErr(e, 'Не получилось сохранить.'); renderSpaceSheet(true); });
  const rows = list.map(p => {
    const err = h('span', { class:'sp-err', role:'alert' });
    const nameIn = (k, ph) => h('input', { class:'input', value:p[k] || '', placeholder:ph, 'aria-label':ph, maxlength:'100', autocomplete:'off',
      onchange:e => {
        const v = normName(e.target.value);
        const other = k === 'firstName' ? p.lastName : p.firstName;
        if (!v && !other && !p.email){ err.textContent = 'Укажите имя или фамилию'; e.target.value = p[k] || ''; return; }
        err.textContent = ''; e.target.value = v;
        if (v !== (p[k] || '')){ p[k] = v; save(p, { [k]:v }); }
      } });
    const mail = self(p) ? h('span', { class:'sp-mail', title:'Свою почту вам поменяет админ', text:p.email })
      : h('input', { class:'input', type:'email', value:p.email || '', placeholder:'Почта Google', 'aria-label':'Почта', autocomplete:'off', spellcheck:'false', autocapitalize:'off',
        onchange:e => changeMail(sid, p, e.target, err) });
    const tgIn = h('input', { class:'input', value:p.tg ? '@' + p.tg : '', placeholder:'@имя в Telegram', 'aria-label':'Telegram', autocomplete:'off', autocapitalize:'off', spellcheck:'false',
      onchange:e => changeTg(p, e.target, err, save) });
    const tg = h('span', { class:'sp-tg' }, tgIn,
      p.tg ? iconBtn('telegram', 'Проверить: откроется профиль в Telegram, посмотрите, тот ли это человек', () => openTgProfile(p.tg), 'sp-check') : null);
    const role = self(p) ? h('span', { class:'sp-role', title:'Свою роль вам поменяет админ', text:ROLE_LABEL[p.role] || p.role })
      : h('label', { class:'hf-sel' }, h('select', { 'aria-label':'Роль', onchange:e => save(p, { role:e.target.value }) },
        Object.keys(ROLE_LABEL).map(r => h('option', { value:r, text:ROLE_LABEL[r], selected:p.role === r }))), ic('down'));
    const seen = p.role === 'operator' ? h('span', { class:'sp-seen', title:'Оператор в форму не входит', text:'—' })
      : !p.email ? h('span', { class:'sp-seen', title:'Без почты в форму не войти', text:'—' })
      : p.seenAt ? h('span', { class:'sp-seen on', title:'Последний вход в форму', text:seenWhen(p.seenAt) })
      : h('span', { class:'sp-seen', title:'Ещё ни разу не входил под этой почтой', text:'не входил' });
    return h('div', { class:'sp-row', role:'row', 'data-key':p.key, 'data-email':p.email || null },
      nameIn('firstName', 'Имя'), nameIn('lastName', 'Фамилия'), mail, tg, role, seen,
      self(p) ? h('span') : iconBtn('trash', 'Убрать из пространства', () => removePerson(sid, p), 'danger'), err);
  });
  const head = h('div', { class:'sp-row sp-head', role:'row' },
    [['Имя'], ['Фамилия'], ['Почта', 'С почтой человек входит в форму'], ['Telegram', 'С Telegram ему можно отправить ссылку на конспект'], ['Роль'], ['Последний вход'], ['']]
      .map(([t, tip]) => h('span', { role:'columnheader', text:t, title:tip || null })));
  return h('div', { class:'sp-body' },
    h('div', { class:'sp-table sp-people', role:'table', 'aria-label':'Люди' }, head,
      list.length ? rows : h('p', { class:'hint sp-empty', text:'В пространстве пока никого нет' }),
      addPersonRow(sid)));
}
/* Почту добавили, сменили или стёрли: запись переезжает на новый ключ (cloud-api.mjs, setMemberEmail) */
async function changeMail(sid, p, input, err){
  const v = input.value.trim().toLowerCase();
  if (v === (p.email || '')){ input.value = p.email || ''; err.textContent = ''; return; }
  if (v && !EMAIL_RE.test(v)){ err.textContent = 'Проверьте почту'; return; }
  if (!v && !preacherKey(p)){ err.textContent = 'Укажите имя или фамилию, потом уберите почту'; input.value = p.email || ''; return; }
  if (v && (SPW.people || []).some(x => x.key !== p.key && x.email === v)){ err.textContent = 'Человек с такой почтой уже есть'; return; }
  err.textContent = '';
  try { await cloud.api.setMemberEmail(sid, cloud.user, p.key, v); }
  catch(e){ err.textContent = e && e.code === 'exists' ? 'Человек с такой почтой уже есть' : cloudExplain(e) || 'Не получилось сохранить'; input.value = p.email || ''; }
}
/* Telegram: пусто — убрать; иначе проверить и сохранить как имя пользователя без «@» */
function changeTg(p, input, err, save){
  const raw = input.value.trim();
  if (!raw || raw === '@'){ input.value = ''; err.textContent = ''; if (p.tg) save(p, { tg:'' }); return; }
  const r = tgCheck(raw);
  if (r.err){ err.textContent = r.err; return; }
  if (tgTaken(SPW.people, r.tg, p.key)){ err.textContent = 'Этот Telegram уже указан у другого человека'; return; }
  err.textContent = ''; input.value = '@' + r.tg;
  if (r.tg !== p.tg) save(p, { tg:r.tg });
}
function addPersonRow(sid){
  const f = h('input', { class:'input', placeholder:'Имя', maxlength:'100', 'aria-label':'Имя нового человека', autocomplete:'off' });
  const l = h('input', { class:'input', placeholder:'Фамилия', maxlength:'100', 'aria-label':'Фамилия нового человека', autocomplete:'off' });
  const m = h('input', { class:'input', type:'email', placeholder:'Почта Google', 'aria-label':'Почта нового человека', autocomplete:'off', spellcheck:'false', autocapitalize:'off' });
  const t = h('input', { class:'input', placeholder:'@имя в Telegram', 'aria-label':'Telegram нового человека', autocomplete:'off', spellcheck:'false', autocapitalize:'off' });
  const r = h('select', { 'aria-label':'Роль нового человека' }, Object.keys(ROLE_LABEL).map(k => h('option', { value:k, text:ROLE_LABEL[k], selected:k === 'preacher' })));
  const err = h('span', { class:'sp-err', role:'alert' });
  const add = async () => {
    const first = normName(f.value), last = normName(l.value), email = m.value.trim().toLowerCase(), people = SPW.people || [];
    let tg = '';
    err.textContent = '';
    if (!first && !last){ err.textContent = 'Укажите имя или фамилию'; f.focus(); return; }
    if (email && !EMAIL_RE.test(email)){ err.textContent = 'Проверьте почту'; m.focus(); return; }
    if (email && people.some(p => p.email === email)){ err.textContent = 'Человек с такой почтой уже есть'; m.focus(); return; }
    if (t.value.trim() && t.value.trim() !== '@'){
      const c = tgCheck(t.value);
      if (c.err){ err.textContent = c.err; t.focus(); return; }
      if (tgTaken(people, c.tg)){ err.textContent = 'Этот Telegram уже указан у другого человека'; t.focus(); return; }
      tg = c.tg;
    }
    btn.disabled = true;
    try {
      await cloud.api.addMember(sid, cloud.user, { email, role:r.value, firstName:first, lastName:last, tg });
      toast('Добавили: ' + preacherName({ firstName:first, lastName:last }));
      renderSpaceSheet(true);
    } catch(e){ err.textContent = e && e.code === 'exists' ? 'Человек с такой почтой уже есть' : cloudExplain(e) || 'Не получилось добавить'; btn.disabled = false; }
  };
  const btn = h('button', { type:'button', class:'btn primary small', onclick:add }, ic('plus'), 'Добавить');
  [f, l, m, t].forEach(x => x.addEventListener('keydown', e => { if (e.key === 'Enter') add(); }));
  return h('div', { class:'sp-row sp-add', role:'row' }, f, l, m, t, h('label', { class:'hf-sel' }, r, ic('down')), h('span', { class:'sp-add-act' }, btn), err);
}
async function removePerson(sid, p){
  const who = personLabel(p);
  const tail = p.email && p.role !== 'operator' ? ' Войти сюда этот человек больше не сможет, а его конспекты останутся.' : '';
  if (!confirm('Убрать из пространства: ' + who + '?' + tail)) return;
  try { await cloud.api.removeMember(sid, p.key); toast('Убрали из пространства: ' + who); }
  catch(e){ spaceErr(e, 'Не получилось убрать.'); }
}

/* Серии проповедей: админ и редактор. Название, «Активна» и формат меняются сразу; удалить — только серию, которой нет в конспектах */
function seriesTable(){
  const map = SPW.series;
  if (!map) return loadingBody();
  const sid = SPW.id, cfg = spwCfg(), list = seriesList(map), use = seriesUse();
  const fmtSel = (cur, on) => h('label', { class:'hf-sel' }, h('select', { 'aria-label':'Формат фона', onchange:e => on(e.target.value) },
    [['', 'По умолчанию']].concat(formatList(cfg).map(f => [f.id, f.name])).map(([v, t]) => h('option', { value:v, text:t, selected:v === (cur && (cur === SYSTEM_FORMAT || cfg.formats[cur]) ? cur : '') }))), ic('down'));
  const upd = (id, fields) => { const next = JSON.parse(JSON.stringify(map)); Object.assign(next[id], fields); return writeSeries(sid, next); };
  const delBtn = x => {
    const n = use ? use[x.id] || 0 : null;
    if (n === 0) return iconBtn('trash', 'Удалить серию', () => removeSeries(sid, x), 'danger');
    const tip = n == null ? 'Проверяю, выбрана ли серия в конспектах' : 'Выбрана в конспектах: ' + n;
    const b = iconBtn('trash', tip, null, 'danger'); b.disabled = true;
    return h('span', { class:'sp-del-off', title:tip }, b);
  };
  const rows = list.map(x => h('div', { class:'sp-row', role:'row', 'data-id':x.id },
    h('input', { class:'input', value:x.name, maxlength:'100', 'aria-label':'Название серии', autocomplete:'off', onchange:e => {
      const v = normName(e.target.value);
      if (!v || seriesNameTaken(map, v, x.id)){ toast(v ? 'Серия с таким названием уже есть' : 'У серии должно быть название'); e.target.value = x.name; return; }
      if (v !== x.name) upd(x.id, { name:v });
    } }),
    sw('Активна', x.active, on => upd(x.id, { active:on })),
    fmtSel(x.format, v => upd(x.id, { format:v })),
    delBtn(x)));
  const free = h('div', { class:'sp-row sp-fixed', role:'row', title:'Встроенная серия: у проповедей без серии. Её нельзя изменить' },
    h('span', { class:'sp-name', text:FREE_SERIES }), h('span', { class:'muted', text:'Всегда активна' }), h('span', { class:'muted', text:'По умолчанию' }), h('span'));
  const name = h('input', { class:'input', placeholder:'Название новой серии', maxlength:'100', 'aria-label':'Название новой серии', autocomplete:'off' });
  const err = h('span', { class:'sp-err', role:'alert' });
  const add = async () => {
    const v = normName(name.value);
    err.textContent = '';
    if (!v){ name.focus(); return; }
    if (seriesNameTaken(map, v)){ err.textContent = 'Серия с таким названием уже есть'; name.focus(); return; }
    const next = JSON.parse(JSON.stringify(map));
    next[newSeriesId(map)] = { name:v, active:true, format:'' };
    if (await writeSeries(sid, next)) toast('Серия добавлена: ' + v);
  };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  return h('div', { class:'sp-body' },
    h('p', { class:'hint', text:'Серию выбирают в «О проповеди». Фон слайдов проповеди — формат её серии. Выключенная серия остаётся в прошлых проповедях, но выбрать её больше нельзя.' }),
    h('div', { class:'sp-table sp-series', role:'table', 'aria-label':'Серии проповедей' },
      h('div', { class:'sp-row sp-head', role:'row' }, ['Название', 'Активна', 'Формат фона', ''].map(t => h('span', { role:'columnheader', text:t }))),
      free, rows,
      h('div', { class:'sp-row sp-add', role:'row' }, name, h('span', { class:'sp-add-act' }, h('button', { type:'button', class:'btn primary small', onclick:add }, ic('plus'), 'Добавить серию')), err)));
}
function removeSeries(sid, x){
  if (!confirm('Удалить серию «' + x.name + '»?')) return;
  const next = JSON.parse(JSON.stringify(SPW.series || {})); delete next[x.id];
  writeSeries(sid, next).then(ok => { if (ok) toast('Серия удалена: ' + x.name); });
}

/* Общее: правит админ, редактор только смотрит. Новое пространство — кнопка слева, под списком */
function spaceGeneral(){
  const sp = spwSpace(), adm = spwAdmin(), cfg = spwCfg(), mins = +(sp.settings || {}).lockMinutes || 10;
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
  const slidesReady = sp.id === cloud.space || SPW.slides !== undefined;   // настройки другого пространства ещё не пришли — не перезаписываем их
  const pick = sw('Выбирать формат фона в проповеди', cfg.pickFormat, async on => {
    try {
      const over = sp.id === cloud.space ? SLIDES_BASE : SPW.slides || {};
      const next = mergeSlides(SLIDES_DEFAULT, Object.assign(JSON.parse(JSON.stringify(over)), { pickFormat:on }));
      if (sp.id === cloud.space) await pushSlides(next);
      else { await cloud.api.setSlides(sp.id, cloud.user, next); SPW.slides = next; }
    } catch(e){ spaceErr(e, 'Не получилось сохранить.'); renderSpaceSheet(true); }
  });
  if (!adm || !slidesReady) pick.querySelector('input').disabled = true;
  return h('div', { class:'sp-body sp-general' },
    adm ? null : h('p', { class:'hint', text:'Эти настройки меняет админ.' }),
    field('Название', nameEl),
    h('div', { class:'field' }, h('span', { class:'lbl', text:'Правка без действий' }),
      h('div', { class:'sp-inline' }, h('span', { text:'завершается сама через' }), minEl, h('span', { text:'мин.' })),
      h('p', { class:'hint', text:'Форма сохраняет правки и отпускает конспект, чтобы его могли править другие.' })),
    h('div', { class:'field' }, pick,
      h('p', { class:'hint', text:'Включено — в «О проповеди» есть поле «Формат фона», и у каждой проповеди можно выбрать свой фон. Выключено — фон берётся из серии проповеди.' })),
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
