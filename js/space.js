'use strict';

/* ========= Пространство (этап 10): люди, серии проповедей, название и настройки =========
   Окно «Пространство» (меню «⋯», админу и редактору):
   • «Общее» — название и время, через которое правка без действий завершается сама (lockMinutes), меняет админ;
     «Выбирать формат фона в проповеди» (config/slides, pickFormat) — админ и редактор; админ ещё заводит новое пространство;
   • «Люди» — таблица участников (spaces/{s}/members): имя, фамилия, почта, роль, входил ли. Добавляет, меняет и удаляет
     только админ, редактор видит таблицу без правки. Из неё же — список авторов в «О проповеди» (PREACHERS);
   • «Серии проповедей» (config/series): название, «Активна», формат фона. «Свободная тема» встроена (у проповеди без серии),
     не меняется и не хранится. Серий не удаляют: выключенная остаётся в старых проповедях, но в выборе её больше нет.
   Данные приходят слушателями из cloud.js (watchMembers, watchSeries): setPeople, setSeriesData. */

const FREE_SERIES = 'Свободная тема';
const ROLE_LABEL = { editor:'Редактор', preacher:'Автор' };
const canSpace = () => cloudOn() && (cloud.role === 'admin' || cloud.role === 'editor');
const spaceAdmin = () => cloudOn() && cloud.role === 'admin';
const normName = s => String(s || '').trim().replace(/\s+/g, ' ');

/* ----- Люди ----- */
/* Пришёл список людей пространства: таблица в окне и список авторов (все люди с именем или фамилией) */
function setPeople(list){
  cloud.people = (list || []).slice().sort((a, b) => (preacherKey(a) || a.email).localeCompare(preacherKey(b) || b.email, 'ru'));
  const keys = new Set();
  cloud.people.forEach(p => { const k = preacherKey(p); if (k) keys.add(k); });
  PREACHERS.length = 0;
  [...keys].sort((a, b) => a.localeCompare(b, 'ru')).forEach(k => PREACHERS.push(k));
  renderSpaceSheet();
}

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
  renderSpaceSheet();
}
function loadSeriesCache(sp){
  let m = null; try { m = JSON.parse(LS.get(seriesCacheKey(sp)) || 'null'); } catch(e){}
  SERIES = normSeries(m);
}
/* Название серии проповеди: пусто — «Свободная тема»; серии нет в таблице (ещё не пришла) — пусто */
const seriesName = id => !id ? FREE_SERIES : SERIES[id] ? SERIES[id].name : '';
const seriesList = () => Object.keys(SERIES).map(id => Object.assign({ id }, SERIES[id])).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
const activeSeries = () => seriesList().filter(x => x.active);
const hasSeries = () => Object.keys(SERIES).length > 0;
function newSeriesId(){ let id; do { id = 's' + Math.random().toString(36).slice(2, 10); } while (SERIES[id]); return id; }
const seriesNameTaken = (name, except) => Object.keys(SERIES).some(id => id !== except && SERIES[id].name.toLowerCase() === normName(name).toLowerCase())
  || normName(name).toLowerCase() === FREE_SERIES.toLowerCase();
async function writeSeries(next){
  try {
    await cloud.api.setSeries(cloud.space, cloud.user, next);
    setSeriesData(next);
    return true;
  } catch(e){ toast(cloudExplain(e) || 'Не получилось сохранить серии.'); renderSpaceSheet(true); return false; }
}
/* Удалили формат фона (settings.js): у серий с ним — «По умолчанию» */
async function seriesFormatGone(fid){
  if (!canSpace() || !Object.keys(SERIES).some(id => SERIES[id].format === fid)) return;
  const next = JSON.parse(JSON.stringify(SERIES));
  Object.keys(next).forEach(id => { if (next[id].format === fid) next[id].format = ''; });
  await writeSeries(next);
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

/* ----- Окно «Пространство» ----- */
let spaceTab = 'people';
function openSpace(){
  if (!canSpace()) return;
  drawSpace();
  settingsOverlay.classList.add('open');
}
/* Пришли новые данные: окно открыто — перерисовать. Пока человек печатает в поле, не мешаем: перерисуем, когда уйдёт из поля */
let spaceRedraw = false;
function renderSpaceSheet(force){
  const sh = settingsOverlay.querySelector('.space-sheet');
  if (!sh || !settingsOverlay.classList.contains('open')) return;
  const a = document.activeElement;
  if (!force && a && sh.contains(a) && /^(INPUT|SELECT)$/.test(a.tagName)){ spaceRedraw = true; return; }
  drawSpace();
}
function drawSpace(){
  spaceRedraw = false;
  const tabs = [['people', 'Люди'], ['series', 'Серии проповедей'], ['general', 'Общее']];
  const body = spaceTab === 'series' ? seriesTable() : spaceTab === 'general' ? spaceGeneral() : peopleTable();
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet wide space-sheet', role:'dialog', 'aria-label':'Пространство',
    onfocusout:e => { if (spaceRedraw && !(e.relatedTarget && e.currentTarget.contains(e.relatedTarget))) setTimeout(() => renderSpaceSheet(), 0); } },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Пространство «' + (cloud.spaceName || '') + '»' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('div', { class:'seg space-tabs', role:'tablist' }, tabs.map(([k, t]) => h('button', { type:'button', role:'tab', class:spaceTab === k ? 'on' : '', 'aria-selected':String(spaceTab === k),
      onclick:() => { spaceTab = k; drawSpace(); } }, t))),
    body));
}
const spaceErr = (e, fallback) => toast(cloudExplain(e) || fallback);

/* Люди: админ правит прямо в таблице (изменения уходят сразу), редактор только смотрит */
function peopleTable(){
  const adm = spaceAdmin(), list = cloud.people || [];
  const save = (p, fields) => cloud.api.updateMember(cloud.space, p.email, fields).catch(e => { spaceErr(e, 'Не получилось сохранить.'); renderSpaceSheet(true); });
  const nameIn = (p, k, ph) => adm ? h('input', { class:'input', value:p[k] || '', placeholder:ph, 'aria-label':ph, autocomplete:'off',
    onchange:e => { const v = normName(e.target.value); e.target.value = v; if (v !== (p[k] || '')){ p[k] = v; save(p, { [k]:v }); } } }) : h('span', { text:p[k] || '—' });
  const roleSel = (p) => adm ? h('label', { class:'hf-sel' }, h('select', { 'aria-label':'Роль', onchange:e => save(p, { role:e.target.value }) },
    Object.keys(ROLE_LABEL).map(r => h('option', { value:r, text:ROLE_LABEL[r], selected:p.role === r }))), ic('down')) : h('span', { text:ROLE_LABEL[p.role] || p.role });
  const rows = list.map(p => h('div', { class:'sp-row', role:'row', 'data-email':p.email },
    nameIn(p, 'firstName', 'Имя'), nameIn(p, 'lastName', 'Фамилия'),
    h('span', { class:'sp-mail', title:p.email, text:p.email }),
    roleSel(p),
    h('span', { class:'sp-seen' + (p.seen ? ' on' : ''), title:p.seen ? 'Входил в форму под этой почтой: почта настоящая' : 'Ещё ни разу не входил под этой почтой',
      text:p.seen ? 'входил' : 'ещё не входил' }),
    adm ? iconBtn('trash', 'Убрать из пространства', () => removePerson(p), 'danger') : h('span')));
  const head = h('div', { class:'sp-row sp-head', role:'row' }, ['Имя', 'Фамилия', 'Почта', 'Роль', 'Вход', ''].map(t => h('span', { role:'columnheader', text:t })));
  return h('div', { class:'sp-body' },
    h('p', { class:'hint', text:adm ? 'Кого добавили, тот входит через Google под этой почтой. Имя и фамилия попадают в список авторов в «О проповеди».'
      : 'Добавлять и убирать людей может только админ. Имя и фамилия попадают в список авторов в «О проповеди».' }),
    h('div', { class:'sp-table sp-people', role:'table', 'aria-label':'Люди' }, head,
      list.length ? rows : h('p', { class:'hint sp-empty', text:'В пространстве пока никого нет' }),
      adm ? addPersonRow() : null));
}
function addPersonRow(){
  const f = h('input', { class:'input', placeholder:'Имя', 'aria-label':'Имя нового человека', autocomplete:'off' });
  const l = h('input', { class:'input', placeholder:'Фамилия', 'aria-label':'Фамилия нового человека', autocomplete:'off' });
  const m = h('input', { class:'input', type:'email', placeholder:'Почта Google', 'aria-label':'Почта нового человека', autocomplete:'off' });
  const r = h('select', { 'aria-label':'Роль нового человека' }, Object.keys(ROLE_LABEL).map(k => h('option', { value:k, text:ROLE_LABEL[k], selected:k === 'preacher' })));
  const err = h('span', { class:'sp-err', role:'alert' });
  const add = async () => {
    const email = m.value.trim().toLowerCase();
    err.textContent = '';
    if (!/^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(email)){ err.textContent = 'Проверьте почту'; m.focus(); return; }
    if ((cloud.people || []).some(p => p.email === email)){ err.textContent = 'Этот человек уже есть'; m.focus(); return; }
    btn.disabled = true;
    try {
      await cloud.api.addMember(cloud.space, cloud.user, { email, role:r.value, firstName:normName(f.value), lastName:normName(l.value) });
      toast('Добавлен: ' + (preacherName({ firstName:f.value, lastName:l.value }) || email));
      renderSpaceSheet(true);
    } catch(e){ err.textContent = e && e.code === 'exists' ? 'Этот человек уже есть' : cloudExplain(e) || 'Не получилось добавить'; btn.disabled = false; }
  };
  const btn = h('button', { type:'button', class:'btn primary small', onclick:add }, ic('plus'), 'Добавить');
  [f, l, m].forEach(x => x.addEventListener('keydown', e => { if (e.key === 'Enter') add(); }));
  return h('div', { class:'sp-row sp-add', role:'row' }, f, l, m, h('label', { class:'hf-sel' }, r, ic('down')), h('span', { class:'sp-add-act' }, btn), err);
}
async function removePerson(p){
  const who = preacherName(p) || p.email;
  if (!confirm('Убрать ' + who + ' из пространства? Войти сюда он больше не сможет. Его конспекты останутся.')) return;
  try { await cloud.api.removeMember(cloud.space, p.email); toast('Убран: ' + who); }
  catch(e){ spaceErr(e, 'Не получилось убрать.'); }
}

/* Серии проповедей: админ и редактор. Название, «Активна» и формат меняются сразу */
function seriesTable(){
  const cfg = slidesCfg(), list = seriesList();
  const fmtSel = (cur, on) => h('label', { class:'hf-sel' }, h('select', { 'aria-label':'Формат фона', onchange:e => on(e.target.value) },
    [['', 'По умолчанию']].concat(formatList(cfg).map(f => [f.id, f.name])).map(([v, t]) => h('option', { value:v, text:t, selected:v === (cur && (cur === SYSTEM_FORMAT || cfg.formats[cur]) ? cur : '') }))), ic('down'));
  const upd = (id, fields) => { const next = JSON.parse(JSON.stringify(SERIES)); Object.assign(next[id], fields); return writeSeries(next); };
  const rows = list.map(x => h('div', { class:'sp-row', role:'row', 'data-id':x.id },
    h('input', { class:'input', value:x.name, 'aria-label':'Название серии', autocomplete:'off', onchange:e => {
      const v = normName(e.target.value);
      if (!v || seriesNameTaken(v, x.id)){ toast(v ? 'Серия с таким названием уже есть' : 'У серии должно быть название'); e.target.value = x.name; return; }
      if (v !== x.name) upd(x.id, { name:v });
    } }),
    sw('Активна', x.active, on => upd(x.id, { active:on })),
    fmtSel(x.format, v => upd(x.id, { format:v }))));
  const free = h('div', { class:'sp-row sp-fixed', role:'row', title:'Встроенная серия: у проповедей без серии. Её нельзя изменить' },
    h('span', { class:'sp-name', text:FREE_SERIES }), h('span', { class:'muted', text:'Всегда активна' }), h('span', { class:'muted', text:'По умолчанию' }));
  const name = h('input', { class:'input', placeholder:'Название новой серии', 'aria-label':'Название новой серии', autocomplete:'off' });
  const err = h('span', { class:'sp-err', role:'alert' });
  const add = async () => {
    const v = normName(name.value);
    err.textContent = '';
    if (!v){ name.focus(); return; }
    if (seriesNameTaken(v)){ err.textContent = 'Серия с таким названием уже есть'; name.focus(); return; }
    const next = JSON.parse(JSON.stringify(SERIES));
    next[newSeriesId()] = { name:v, active:true, format:'' };
    if (await writeSeries(next)) toast('Серия добавлена: ' + v);
  };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  return h('div', { class:'sp-body' },
    h('p', { class:'hint', text:'Серию выбирают в «О проповеди». Фон слайдов проповеди — формат её серии. Выключенная серия остаётся в прошлых проповедях, но выбрать её больше нельзя.' }),
    h('div', { class:'sp-table sp-series', role:'table', 'aria-label':'Серии проповедей' },
      h('div', { class:'sp-row sp-head', role:'row' }, ['Название', 'Активна', 'Формат фона'].map(t => h('span', { role:'columnheader', text:t }))),
      free, rows,
      h('div', { class:'sp-row sp-add', role:'row' }, name, h('span', { class:'sp-add-act' }, h('button', { type:'button', class:'btn primary small', onclick:add }, ic('plus'), 'Добавить серию')), err)));
}

/* Общее: название и время правки — админ; «Выбирать формат фона в проповеди» — админ и редактор; новое пространство — админ */
function spaceGeneral(){
  const adm = spaceAdmin(), cfg = slidesCfg(), mins = +cloud.settings.lockMinutes || 10;
  const saveSpace = async (fields, input) => {
    try {
      await cloud.api.updateSpace(cloud.space, cloud.user, fields);
      const sp = cloud.spaces.find(x => x.id === cloud.space);
      if (fields.name != null){ cloud.spaceName = fields.name; if (sp) sp.name = fields.name; cloud.spaces.sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id)); renderTopbar(); }
      if (fields.lockMinutes != null){ cloud.settings = Object.assign({}, cloud.settings, { lockMinutes:fields.lockMinutes }); if (sp) sp.settings = cloud.settings; }
      toast('Сохранено');
      renderSpaceSheet(true);
    } catch(e){ spaceErr(e, 'Не получилось сохранить.'); if (input) renderSpaceSheet(true); }
  };
  const nameEl = adm ? h('input', { class:'input', value:cloud.spaceName || '', 'aria-label':'Название пространства', maxlength:'100', autocomplete:'off',
    onchange:e => { const v = normName(e.target.value); if (!v){ e.target.value = cloud.spaceName; return; } if (v !== cloud.spaceName) saveSpace({ name:v }, e.target); } })
    : h('div', { class:'dfield fixed', 'aria-disabled':'true', title:'Название меняет админ' }, cloud.spaceName || '');
  const minEl = adm ? h('input', { class:'input sp-num', type:'number', min:'1', max:'120', step:'1', value:String(mins), 'aria-label':'Минут без действий',
    onchange:e => { const v = Math.round(+e.target.value); if (!(v >= 1 && v <= 120)){ e.target.value = String(mins); toast('От 1 до 120 минут'); return; } if (v !== mins) saveSpace({ lockMinutes:v }, e.target); } })
    : h('span', { class:'dfield fixed sp-num', 'aria-disabled':'true', title:'Меняет админ' }, String(mins));
  const pick = sw('Выбирать формат фона в проповеди', cfg.pickFormat, async on => {
    try { await pushSlides(mergeSlides(SLIDES_DEFAULT, Object.assign(JSON.parse(JSON.stringify(SLIDES_BASE)), { pickFormat:on }))); }
    catch(e){ spaceErr(e, 'Не получилось сохранить.'); renderSpaceSheet(true); }
  });
  return h('div', { class:'sp-body sp-general' },
    field('Название', nameEl),
    h('div', { class:'field' }, h('span', { class:'lbl', text:'Правка без действий' }),
      h('div', { class:'sp-inline' }, h('span', { text:'завершается сама через' }), minEl, h('span', { text:'мин.' })),
      h('p', { class:'hint', text:'Форма сохраняет правки и отпускает конспект, чтобы его могли править другие.' })),
    h('div', { class:'field' }, pick,
      h('p', { class:'hint', text:'Включено — в «О проповеди» есть поле «Формат фона», и у каждой проповеди можно выбрать свой фон. Выключено — фон берётся из серии проповеди.' })),
    adm ? h('div', { class:'field sp-new' }, h('span', { class:'lbl', text:'Другие пространства' }),
      h('div', { class:'chips' }, h('button', { type:'button', class:'btn', onclick:() => openNewSpace() }, ic('plus'), 'Новое пространство'))) : null);
}

/* Новое пространство — только админ. Людей в нём сначала нет: админ добавляет их в «Пространство» → «Люди» */
function openNewSpace(){
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
      toast('Пространство «' + v + '» создано. Добавьте людей: меню «⋯» → «Пространство»');
    } catch(e){ err.textContent = cloudExplain(e) || 'Не получилось создать'; btn.disabled = false; btn.textContent = 'Создать'; }
  };
  const btn = h('button', { type:'button', class:'btn primary', onclick:make }, 'Создать');
  name.addEventListener('keydown', e => { if (e.key === 'Enter') make(); });
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet new-space-sheet', role:'dialog', 'aria-label':'Новое пространство' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Новое пространство' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('p', { class:'hint', text:'У пространства свои конспекты, люди, серии и настройки слайдов. Сначала в нём никого нет: людей вы добавите сами.' }),
    h('div', { class:'set-grid' }, field('Название', name), err),
    h('div', { class:'sheet-foot' }, h('span'), btn)));
  settingsOverlay.classList.add('open');
  name.focus();
}
