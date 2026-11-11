'use strict';

/* ========= Работа редактора (этап 7) =========
   1. Статус проповеди: «В работе» (в облаке `draft`) и «Готов» (`submitted`). Новая проповедь — «В работе».
      Спикер или редактор отмечает «Готов», когда конспект закончен. Если спикер правит готовую проповедь,
      она сама возвращается «В работе»; правка редактора статус не сбрасывает.
   2. Отметка «доработать»: видят и ставят только редактор и админ, в любой момент (замок не нужен). Лежит не в проповеди,
      а в закрытом от спикеров документе `editor/state`: { flags: { <id слайда>: { t: 1 | 0, s: подпись } } }.
      t — отметка стоит; s — подпись содержимого слайда на тот момент, когда редактор решил. Если редактор снял отметку, а спикер
      потом изменил слайд, подпись не совпадёт и отметка вернётся сама (считается при показе, отдельной записи не нужно).
      Слайды без записи: картинка, видео и свободный слайд — «доработать» (TYPES[type].todo), остальные — нет.
      Без входа (старый режим) отметка лежит в самой проповеди, как раньше. */

/* ----- Статус ----- */
let statusTouch = false;   // статус меняет сама кнопка: change() не должен считать это правкой спикера
/* Вызывается из change(): спикер изменил готовую проповедь — снова «В работе» */
function statusOnEdit(){
  if (statusTouch || !cloudOn() || cloud.role !== 'preacher' || !state || !isReady(state.cloudStatus)) return;
  state.cloudStatus = 'draft';
  renderTopbar();
  toast('Проповедь снова «В работе»: вы изменили её после отметки «Готов»');
}
function setSermonStatus(key){
  if (!cloudSermon()) return;
  if (readOnly()){ roHint(); return; }
  if ((key === 'submitted') === isReady(state.cloudStatus)) return;
  statusTouch = true;
  try { state.cloudStatus = key; change(); } finally { statusTouch = false; }
  renderTopbar();
  toast(key === 'submitted' ? 'Отмечено «Готов»: редактор увидит это в списке' : 'Проповедь снова «В работе»');
}
/* Кнопка в шапке рядом со статусом: только пока проповедь правится */
function statusAction(){
  if (!editing()) return null;
  const ready = isReady(state.cloudStatus);
  return h('button', { type:'button', class:'btn',
    title:ready ? 'Вернуть статус «В работе»' : 'Закончили конспект? Отметьте «Готов»: редактор увидит, что пора делать слайды',
    onclick:() => setSermonStatus(ready ? 'draft' : 'submitted') }, ready ? 'Вернуть в работу' : 'Отметить «Готов»');
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
