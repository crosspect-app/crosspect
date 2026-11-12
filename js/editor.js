'use strict';

/* ========= Работа редактора (этапы 7 и 7.2) =========
   1. Статус конспекта: «В работе» (в облаке `draft`) и «Готов к вёрстке» (`submitted`). Новый конспект — «В работе».
      Переключатель — один, на экране проповеди (statusSwitch); в списке проповедей статус только виден.
      Спикер: «Готов к вёрстке» — конспект сохраняется и правка закрывается (как «Сохранить»); не вышло (нет связи) — статус
      не меняется. Потом любая правка спикера сама возвращает «В работе». Редактор и админ меняют статус в любую сторону
      отдельной записью (setStatus), без выхода из правки; их правки статус не сбрасывают.
      Статус не меняется, пока проповедь правит другой (так и в правилах облака: замок свободен или свой).
   2. Отметка «доработать»: видят и ставят только редактор и админ, в любой момент (замок не нужен). Лежит не в проповеди,
      а в закрытом от спикеров документе `editor/state`: { flags: { <id слайда>: { t: 1 | 0, s: подпись } } }.
      t — отметка стоит; s — подпись содержимого слайда на тот момент, когда редактор решил. Если редактор снял отметку, а спикер
      потом изменил слайд, подпись не совпадёт и отметка вернётся сама (считается при показе, отдельной записи не нужно).
      Слайды без записи: картинка, видео и свободный слайд — «доработать» (TYPES[type].todo), остальные — нет.
      Без входа (старый режим) отметка лежит в самой проповеди, как раньше. */

/* ----- Статус ----- */
/* Тексты уведомлений — короткие и по делу (проверены по humanizer и ru-product-texts) */
const STATUS_MSG = {
  reset:'Конспект снова «В работе»: вы его изменили',
  readyPreacher:'Готов к вёрстке: конспект сохранён, правка закрыта. Редактор увидит это в списке',
  ready:'Статус: «Готов к вёрстке»',
  work:'Статус: «В работе»',
  offline:'Нет связи с облаком, статус не изменился. Правки сохранятся сами, когда появится сеть',
  offlineView:'Нет связи с облаком, статус не изменился',
  quota:'Облако перегружено до 9:00, статус не изменился',
  locked:who => 'Сейчас конспект правит ' + who + '. Статус можно поменять, когда правка закончится',
  fail:'Статус не изменился'
};
let statusTouch = false, statusBusy = false;   // статус меняет сам переключатель: change() не должен считать это правкой спикера
/* Вызывается из change(): спикер изменил готовый конспект — снова «В работе» */
function statusOnEdit(){
  if (statusTouch || !cloudOn() || cloud.role !== 'preacher' || !state || !isReady(state.cloudStatus)) return;
  state.cloudStatus = 'draft';
  renderTopbar();
  toast(STATUS_MSG.reset);
}
/* Можно ли менять статус этого конспекта (сам переключатель; облако проверит ещё раз) */
const canSetStatus = () => cloudSermon() && canEditCloud();
async function setSermonStatus(key){
  if (!canSetStatus() || statusBusy) return;
  if ((key === 'submitted') === isReady(state.cloudStatus)) return;
  const l = otherLock();
  if (l && l.email !== myEmail()){ toast(STATUS_MSG.locked(lockWho(l))); return; }
  const s = state, prev = s.cloudStatus || 'draft';
  statusBusy = true; renderTopbar();
  try {
    // спикер отправляет конспект на вёрстку: сохранить и закрыть правку
    if (cloud.role === 'preacher' && key === 'submitted' && editing()){
      s.cloudStatus = key;
      const res = await closeEdit('status');
      if (res === 'ok'){ toast(STATUS_MSG.readyPreacher); return; }
      if (state === s) s.cloudStatus = prev;
      if (res === 'offline') toast(STATUS_MSG.offline);
      else if (res === 'quota') toast(STATUS_MSG.quota);
      else if (res !== 'conflict' && res !== 'lost' && res !== 'none') toast(STATUS_MSG.fail);
      return;
    }
    // конспекта в облаке ещё нет: статус уйдёт с первым сохранением
    if (!s.cloudAt){ statusTouch = true; try { s.cloudStatus = key; change(); } finally { statusTouch = false; } toast(STATUS_MSG[key === 'submitted' ? 'ready' : 'work']); return; }
    const r = await cloud.api.setStatus(cloud.space, s.id, cloud.user, key, { minutes:lockMins() });
    if (state !== s) return;
    s.cloudStatus = r.cloudStatus;
    if (editing()){ s.cloudAt = r.cloudAt; s.cloudBy = r.cloudBy; ed.remote = Object.assign({}, ed.remote || {}, { cloudAt:r.cloudAt, cloudStatus:r.cloudStatus, lock:r.lock }); persistDraft(); }   // замок мой: содержимое уйдёт со следующим сохранением
    else { ed.remote = r; setRemoteState(r); }
    toast(STATUS_MSG[key === 'submitted' ? 'ready' : 'work']);
  } catch(e){
    if (state === s) s.cloudStatus = prev;
    const code = (e && e.code) || '';
    if (code === 'locked') toast(STATUS_MSG.locked(lockWho(e.lock)));
    else if (/resource-exhausted/.test(code)) toast(STATUS_MSG.quota);
    else if (netErr(e)) toast(STATUS_MSG.offlineView);
    else toast(cloudExplain(e) || STATUS_MSG.fail);
  } finally {
    statusBusy = false;
    if (state === s) rerenderKeep();
  }
}
/* Переключатель статуса в шапке проповеди: два положения, щелчок переключает. Нельзя менять — просто метка */
function statusSwitch(){
  const st = sermonStatus(state);
  if (!canSetStatus()) return h('span', { class:'stchip st-' + st.key, text:st.label });
  const ready = isReady(state.cloudStatus), preacher = cloud.role === 'preacher';
  const tip = ready ? 'Вернуть статус «В работе»'
    : preacher && editing() ? 'Конспект закончен? Переключите: он сохранится, правка закроется, и редактор увидит, что пора делать слайды'
      : 'Отметить «Готов к вёрстке»: редактор увидит, что пора делать слайды';
  return h('button', { type:'button', class:'stswitch' + (ready ? ' ready' : ''), role:'switch', 'aria-checked':String(ready), 'aria-label':'Статус конспекта',
    title:tip, disabled:statusBusy, onclick:() => setSermonStatus(ready ? 'draft' : 'submitted') },
    h('span', { class:'sw-opt' + (ready ? '' : ' on'), text:STATUS_LABELS.work }), h('span', { class:'sw-opt' + (ready ? ' on' : ''), text:STATUS_LABELS.done }));
}

/* ----- Доработать ----- */
/* Отметки видит и ставит редактор (и админ); без входа — как раньше, все */
const canFlag = () => !cloudOn() || cloud.role !== 'preacher';
const todoOn = b => !!b.todo && canFlag();
const defaultTodo = b => !!(TYPES[b.type] && TYPES[b.type].todo);
const fl = { id:'', map:{}, loaded:false, dirty:false, busy:false, timer:null };

/* Подпись содержимого слайда: те же данные дают ту же подпись, в каком бы порядке ни пришли ключи */
function canon(v){
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
function blockSig(b){
  const c = Object.assign({}, b); delete c.todo; delete c.done; delete c.collapsed;
  const s = canon(c); let x = 5381;
  for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0;
  return (x >>> 0).toString(36);
}

/* Открыли проповедь: прочитать отметки редактора (спикеру они не нужны и недоступны) */
async function loadFlags(id){
  flushFlags();
  Object.assign(fl, { id, map:{}, loaded:false, dirty:false });
  if (!cloudOn() || !canFlag()) return;
  try { fl.map = (await cloud.api.getFlags(cloud.space, id)) || {}; fl.loaded = true; }
  catch(e){ fl.map = {}; }   // нет связи: догрузим перед первой записью
}
/* Наложить отметки на проповедь, пришедшую из облака */
function applyFlags(s){
  if (!s || !cloudOn() || !canFlag() || fl.id !== s.id) return s;
  s.blocks.forEach(b => {
    const e = fl.map[b.id];
    if (!e || !TYPES[b.type] || !TYPES[b.type].slide) return;
    b.todo = !!e.t || (!!e.s && e.s !== blockSig(b));
  });
  return s;
}
/* Кнопка «Доработать»: в облаке — запись отметки, вне замка; без входа — правка проповеди */
function toggleTodo(b){
  b.todo = !b.todo;
  if (cloudOn()) setFlag(b); else change();
  if (filmOnlyTodo && inSlides()) renderFilm();
  rerender(b);
}
function setFlag(b){
  if (fl.id !== state.id) Object.assign(fl, { id:state.id, map:{}, loaded:true });   // проповедь новая: прежних отметок нет
  fl.map[b.id] = { t:b.todo ? 1 : 0, s:blockSig(b) };
  scheduleFlags();
}
/* Проповедь сохранена: у слайдов, с которых редактор снял отметку, подпись обновляется — его собственные правки отметку не возвращают.
   Отметки, которые поставил или оставил по умолчанию автор слайда, не трогаем */
function resyncFlags(s){
  if (!cloudOn() || !canFlag()) return;
  if (fl.id !== s.id) Object.assign(fl, { id:s.id, map:{}, loaded:true });
  let changed = false;
  s.blocks.forEach(b => {
    if (!TYPES[b.type] || !TYPES[b.type].slide) return;
    const e = fl.map[b.id];
    if (!e){ if (!!b.todo !== defaultTodo(b)){ fl.map[b.id] = { t:b.todo ? 1 : 0, s:blockSig(b) }; changed = true; } }   // отметка из старого формата
    else if (!e.t && !b.todo){ const g = blockSig(b); if (e.s !== g){ e.s = g; changed = true; } }
  });
  if (changed) scheduleFlags();
}
function scheduleFlags(){ fl.dirty = true; clearTimeout(fl.timer); fl.timer = setTimeout(flushFlags, 1500); }
async function flushFlags(){
  clearTimeout(fl.timer); fl.timer = null;
  if (!fl.dirty || fl.busy || !fl.id || !cloudOn() || !canFlag()) return;
  const id = fl.id;
  if (state && state.id === id && !state.cloudAt){ fl.timer = setTimeout(flushFlags, 5000); return; }   // самой проповеди в облаке ещё нет
  fl.busy = true; fl.dirty = false;
  try {
    if (!fl.loaded){ fl.map = Object.assign({}, await cloud.api.getFlags(cloud.space, id), fl.map); fl.loaded = true; }   // не затираем чужие отметки
    if (state && state.id === id) Object.keys(fl.map).forEach(k => { if (!state.blocks.some(b => b.id === k)) delete fl.map[k]; });
    await cloud.api.setFlags(cloud.space, id, cloud.user, fl.map);
  } catch(e){
    fl.dirty = true;
    if (!netErr(e)) toast(cloudExplain(e) || 'Не удалось сохранить отметки «доработать»');
    fl.timer = setTimeout(flushFlags, 15000);
  } finally {
    fl.busy = false;
    if (fl.dirty && !fl.timer) fl.timer = setTimeout(flushFlags, 1500);
  }
}
window.addEventListener('online', () => { if (fl.dirty) flushFlags(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushFlags(); });
