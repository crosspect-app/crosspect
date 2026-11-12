'use strict';

/* ========= Работа редактора (этапы 7, 7.2 и 7.3) =========
   1. Статус конспекта (этап 7.3) — три: «Черновик» (в облаке `draft`), «Готов к вёрстке» (`submitted`), «У редактора» (`work`).
      Переключатель — один, на экране проповеди (statusSwitch); в списке проповедей статус только виден.
      Статус меняется только в режиме правки, как обычная правка: уходит в облако вместе с содержимым (автосохранение или
      «Сохранить»), правку не закрывает и в отмену не входит. В просмотре щелчок по переключателю — подсказка «Редактировать».
      «Черновик» ↔ «Готов к вёрстке» — в любую сторону, без ограничений. «У редактора» ставит и снимает только редактор или админ;
      пока он стоит, автор (роль preacher) конспект не правит (canEditCloud в cloud.js, правило в cloud/firestore.rules).
   2. Отметка «доработать»: видят и ставят только редактор и админ, в любой момент (замок не нужен). Лежит не в проповеди,
      а в закрытом от авторов документе `editor/state`: { flags: { <id слайда>: { t: 1 | 0, s: подпись } } }.
      t — отметка стоит; s — подпись содержимого слайда на тот момент, когда редактор решил. Если редактор снял отметку, а автор
      потом изменил слайд, подпись не совпадёт и отметка вернётся сама (считается при показе, отдельной записи не нужно).
      Слайды без записи: картинка, видео и свободный слайд — «доработать» (TYPES[type].todo), остальные — нет.
      (До этапа 8 без входа отметка лежала в самой проповеди; ветки `!cloudOn()` ниже остались на этот случай.) */

/* ----- Статус ----- */
/* Можно ли этой роли ставить положение переключателя (облако проверит ещё раз) */
const canPickStatus = key => key !== 'work' || cloud.role !== 'preacher';
/* Щелчок по положению переключателя: в правке — обычная правка (уйдёт в облако с автосохранением), в просмотре — подсказка */
function setSermonStatus(key){
  if (!cloudSermon() || !STATUS_LABELS[key]) return;
  if (!editing()){ roHint(); return; }
  if (!statusOpt(key, statusKey(state.cloudStatus)).can || statusKey(state.cloudStatus) === key) return;
  state.cloudStatus = key;
  state.updatedAt = Math.max(Date.now(), state.updatedAt + 1);   // как change(), но без истории отмены: статус в неё не входит
  persistDraft();
  onEdit();
  MOTION.ui.flare = key === 'submitted';   // «Готов к вёрстке»: клин знака один раз вспыхивает — только когда человек сам переключил (7.6)
  renderTopbar();
}
const STATUS_TIPS = {
  draft:'Конспект ещё пишется',
  submitted:'Конспект закончен: редактор увидит, что пора делать слайды',
  work:'Конспект взял редактор. Пока стоит этот статус, автор конспект не правит',
  workAuthor:'Этот статус ставит и снимает редактор'
};
/* Переключатель статуса в шапке проповеди: три положения. Чужой конспект автору — просто метка */
function statusSwitch(){
  const cur = statusKey(state.cloudStatus);
  if (cloud.role === 'preacher' && !canEditCloud() && !atEditor(state)) return h('span', { class:'stchip st-' + cur, text:STATUS_LABELS[cur] });
  const live = editing();
  return h('div', { class:'stswitch st-' + cur + (live ? '' : ' view'), role:'radiogroup', 'aria-label':'Статус конспекта' },
    STATUS_KEYS.map(k => {
      const o = statusOpt(k, cur);
      return h('button', { type:'button', role:'radio', class:'sw-opt st-' + k + (k === cur ? ' on' : ''), 'aria-checked':String(k === cur),
        disabled:!o.can, title:o.tip, onclick:() => setSermonStatus(k) }, STATUS_LABELS[k]);
    }));
}
/* Можно ли выбрать статус и что написать во всплывающей подписи. Пока в конспекте нет ни одного слайда, дальше «Черновика»
   не уйти (этап 7.8): «Готов к вёрстке» и «У редактора» неактивны */
const noSlides = () => !state.blocks.some(b => TYPES[b.type] && TYPES[b.type].slide);
function statusOpt(k, cur){
  if (!canPickStatus(k)) return { can:false, tip:STATUS_TIPS.workAuthor };
  if (k !== cur && k !== 'draft' && noSlides()) return { can:false, tip:'Сначала добавьте слайды' };
  return { can:true, tip:STATUS_TIPS[k] };
}
/* Слайды добавили или удалили все: доступность положений переключателя — без перерисовки шапки (зовёт updateStatus) */
function syncStatusSwitch(){
  const sw = document.querySelector('.topbar .stswitch'); if (!sw || !state) return;
  const cur = statusKey(state.cloudStatus);
  sw.querySelectorAll('.sw-opt').forEach(b => { const k = STATUS_KEYS.find(x => b.classList.contains('st-' + x)), o = statusOpt(k, cur); b.disabled = !o.can; b.title = o.tip; });
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

/* Открыли проповедь: прочитать отметки редактора (автору они не нужны и недоступны) */
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
  if (filmOnlyTodo && inSlides()) syncFilm();
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
