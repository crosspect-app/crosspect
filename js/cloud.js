'use strict';

/* ========= Облако: вход Google и сохранение проповедей =========
   Связь с Firebase — в cloud-api.mjs (подключается по требованию). Здесь — состояние входа, экран входа,
   список проповедей из облака и сохранение. Если человек выбрал «Продолжить без входа» (или облако недоступно),
   форма работает как раньше: проповеди в этом браузере и в файлах.
   Замок, правка и автосохранение — в lock.js. */
const BUILD_ID = (document.currentScript && /[?&]v=([^&]+)/.exec(document.currentScript.src || '') || [])[1] || 'dev';
const FIREBASE_VERSION = '13.1.0';
const ROLE_NAMES = { admin:'админ', editor:'редактор', preacher:'автор' };   // в данных и правилах роль автора — preacher

/* mode: wait — подключаемся, out — не вошли, noaccess — почты нет в пространстве, error — не вышло, in — всё есть */
const cloud = { mode:'wait', api:null, user:null, space:'', spaceName:'', role:'', member:null, settings:{}, list:null, fromCache:false,
  listError:'', error:'', unsub:null, norm:new Map(), started:false };
const cloudOn = () => cloud.mode === 'in';
const localMode = () => { try { return sessionStorage.getItem('swp-local') === '1'; } catch(e){ return false; } };
const setLocalMode = on => { try { if (on) sessionStorage.setItem('swp-local', '1'); else sessionStorage.removeItem('swp-local'); } catch(e){} };
/* Что показывать вместо главной и проповеди: null — ничего, можно работать */
const cloudGate = () => (localMode() || cloudOn()) ? null : cloud.mode;
const inAppBrowser = () => /Telegram|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent || '');

async function loadFirebaseAPI(){
  const G = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/';
  const [app, A, F, mod] = await Promise.all([
    import(G + 'firebase-app.js'), import(G + 'firebase-auth.js'), import(G + 'firebase-firestore.js'),
    import(new URL('js/cloud-api.mjs?v=' + BUILD_ID, document.baseURI).href)]);
  const fbApp = app.initializeApp(FIREBASE_CONFIG);
  let db;
  try { db = F.initializeFirestore(fbApp, { localCache:F.persistentLocalCache({ tabManager:F.persistentMultipleTabManager() }) }); }   // свой кеш в браузере: список и офлайн
  catch(e){ db = F.getFirestore(fbApp); }
  const api = mod.createCloudAPI({ auth:A.getAuth(fbApp), db, A, F });
  api.explain = mod.explain;
  return api;
}

async function initCloud(){
  if (cloud.started) return;
  cloud.started = true; cloud.mode = 'wait';
  try {
    cloud.api = window.CROSSPECT_FAKE_API || await loadFirebaseAPI();   // подмена нужна только тестам
  } catch(e){
    cloud.mode = 'error'; cloud.error = 'Не удалось подключиться к облаку. Проверьте интернет.'; cloud.started = false;
    cloudChanged(); return;
  }
  cloud.api.onUser(u => cloudUser(u));
}

async function cloudUser(user){
  stopListen(); resetCloud();
  cloud.user = user; cloud.list = null; cloud.space = ''; cloud.role = ''; cloud.member = null; cloud.error = '';
  if (!user){ cloud.mode = 'out'; cloudChanged(); return; }
  setLocalMode(false);   // вошли — значит, работаем с облаком
  cloud.mode = 'wait'; cloudChanged();
  try {
    const mine = await cloud.api.spacesOf(user.email);
    if (!mine.length){ cloud.mode = 'noaccess'; cloudChanged(); return; }
    const m = mine[0];   // несколько пространств у одной почты пока не различаем: берём первое (выбор — этап 9)
    const sp = await cloud.api.getSpace(m.spaceId);
    cloud.space = m.spaceId; cloud.member = m; cloud.role = m.role;
    cloud.spaceName = (sp && sp.name) || ''; cloud.settings = (sp && sp.settings) || {};
    cloud.mode = 'in';
    startListen();
    loadLayoutPrefs();   // раскладка экрана у человека (layout.js)
  } catch(e){
    cloud.mode = 'error'; cloud.error = cloudExplain(e) || 'Не удалось получить доступ к облаку.';
  }
  cloudChanged();
}
function cloudExplain(e){ return cloud.api && cloud.api.explain ? cloud.api.explain(e) : String((e && e.message) || e); }

/* Вход или выход сменили экран: перерисовать то, что показано (и открыть проповедь по ссылке, если вошли) */
function cloudChanged(){ if (typeof route === 'function') route(); }

function startListen(){
  const restrict = cloud.role === 'preacher' && cloud.settings.preachersSeeAll === false ? cloud.user.email : null;
  cloud.unsub = cloud.api.listen(cloud.space, restrict, (items, fromCache) => {
    cloud.list = new Map(items.map(r => [r.id, r])); cloud.fromCache = !!fromCache; cloud.listError = '';
    if (screen === 'home' && cloudOn()) renderHomeList();
  }, e => {
    cloud.listError = cloudExplain(e) || 'Не удалось загрузить список проповедей.';
    if (screen === 'home' && cloudOn()) renderHomeList();
  });
  // настройки слайдов пространства (этап 7.1): приходят сразу и при каждом изменении, у всех участников
  if (cloud.api.watchSlides) cloud.slidesUnsub = cloud.api.watchSlides(cloud.space, cfg => slidesFromCloud(cfg), () => {});
}
function stopListen(){
  if (cloud.unsub){ try { cloud.unsub(); } catch(e){} cloud.unsub = null; }
  if (cloud.slidesUnsub){ try { cloud.slidesUnsub(); } catch(e){} cloud.slidesUnsub = null; }
}

async function cloudSignIn(){
  setLocalMode(false);
  if (!cloud.started) await initCloud();
  if (!cloud.api) return;
  try { await cloud.api.signIn(); }
  catch(e){ const m = cloudExplain(e); if (m) toast(m); }
}
async function cloudSignOut(){
  try { await endCloud(); } catch(e){}   // правили — сохранить и отпустить, пока ещё есть вход
  try { await cloud.api.signOut(); } catch(e){}
  stopListen();
}
function useLocalOnly(){ setLocalMode(true); stopListen(); renderAll(); }
function leaveLocalMode(){ setLocalMode(false); if (!cloud.started) initCloud(); cloudChanged(); }

/* ----- Экран входа ----- */
function renderGate(){
  const mode = cloudGate();
  const local = h('button', { type:'button', class:'btn ghost', onclick:() => useLocalOnly() }, 'Продолжить без входа');
  const note = h('p', { class:'hint gate-note', text:'Без входа проповеди хранятся только в этом браузере и пересылаются файлами.' });
  let body;
  if (mode === 'wait') body = [h('h1', { text:'Подключаюсь к облаку…' }), h('p', { class:'gate-text', text:'Это занимает несколько секунд.' }), local];
  else if (mode === 'noaccess') body = [
    h('h1', { text:'Вас нет в списке' }),
    h('p', { class:'gate-text' }, 'Вы вошли как ' + (cloud.user ? cloud.user.email : '') + ', но этой почты нет среди участников. Чтобы получить доступ, напишите на\u00a0',
      h('a', { class:'gate-mail', href:'mailto:' + CONTACT_EMAIL, text:CONTACT_EMAIL }), ' или войдите другой почтой.'),
    h('div', { class:'chips' },
      h('button', { type:'button', class:'btn primary', onclick:() => cloudSignOut().then(() => cloudSignIn()) }, 'Войти другой почтой'),
      local)];
  else if (mode === 'error') body = [
    h('h1', { text:'Облако недоступно' }),
    h('p', { class:'gate-text', text:cloud.error }),
    h('div', { class:'chips' },
      h('button', { type:'button', class:'btn primary', onclick:() => { if (cloud.user) cloudUser(cloud.user); else { cloud.started = false; initCloud(); } } }, 'Повторить'),
      local)];
  else body = [
    h('h1', { text:'Проповеди церкви' }),
    h('p', { class:'gate-text', text:'Войдите через Google. Нужна та почта, которую вам добавил админ церкви.' }),
    h('div', { class:'chips' }, h('button', { type:'button', class:'btn primary big', onclick:() => cloudSignIn() }, 'Войти через Google'), local),
    inAppBrowser() ? h('p', { class:'gate-warn', text:'Похоже, страница открыта внутри Telegram или другого приложения. Google не даёт войти отсюда: откройте ссылку в Chrome или Safari.' }) : null,
    note];
  mainEl.append(h('div', { class:'gate' }, h('div', { class:'gate-card' }, h('div', { class:'gate-logo', text:'Crosspect' }), body)));
}

/* ----- Права ----- */
const myEmail = () => (cloud.user ? cloud.user.email : '');
/* Редактор и админ правят всё, автор — только свои и только пока конспект не «У редактора» (так же отвечает и база) */
const ownSermon = d => { d = d || state; return d.cloudOwner == null || d.cloudOwner === myEmail(); };
function canEditCloud(d){
  if (!cloudOn()) return true;
  if (cloud.role !== 'preacher') return true;
  d = d || state;
  return ownSermon(d) && !atEditor(d);
}
/* Свой конспект автора, который сейчас «У редактора»: смотреть можно, править — нет */
const authorWaits = d => cloudOn() && cloud.role === 'preacher' && ownSermon(d) && atEditor(d || state);
const AT_EDITOR_MSG = 'Конспект у редактора: если нужны правки, напишите ему';
const isUnsaved = d => d.updatedAt > (d.savedAt || 0) && (d.blocks.length > 0 || !!d.meta.title);

/* ----- Сохранение ----- */
/* Облачная проповедь сохраняется сама (lock.js): Ctrl+S и кнопка — «сохранить сейчас». Без входа — файл */
function saveSermon(){
  if (!cloudOn()){ saveFile(); return; }
  if (!cloudSermon()) beginCloud(null);
  saveNow();
}

/* Пока проповедь правили здесь, её же сохранили в облаке: человек решает, чья версия главнее */
function conflictSheet(remote){
  const when = remote && remote.cloudAt ? fmtTime(remote.cloudAt) : '', by = remote && remote.cloudBy ? ' (' + remote.cloudBy + ')' : '';
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet', role:'dialog', 'aria-label':'Проповедь уже изменили' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Проповедь уже изменили' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('p', { class:'hint', style:'font-size:12px;margin-bottom:16px', text:'В облаке есть версия' + (when ? ' от ' + when : '') + by + ', которой нет у вас. Если заменить её вашей, те правки пропадут. Можно сохранить вашу версию отдельной копией или взять облачную, тогда пропадут ваши несохранённые правки. Пока вы не выберете, ваши правки в облако не уходят.' }),
    h('div', { class:'sheet-foot wrap' },
      h('button', { type:'button', class:'btn', onclick:() => { closeSettings(); takeRemote(remote); } }, 'Взять облачную'),
      h('button', { type:'button', class:'btn', onclick:() => { closeSettings(); saveAsCopy(); } }, 'Сохранить копией'),
      h('button', { type:'button', class:'btn primary', onclick:() => { closeSettings(); forceSave(); } }, 'Заменить облачную'))));
  settingsOverlay.classList.add('open');
}
function takeRemote(remote){
  ed.conflict = null;
  state = applyFlags(normalize(remote)); state.savedAt = state.updatedAt; selId = null;
  if (!ed.myAt) beginCloud(remote);   // замка у нас нет — дальше просмотр; если есть, правка продолжается с облачной версии
  histReset();
  persistDraft(); renderAll(); toast('Открыта версия из облака');
}
/* Копия получает новый номер и уходит в облако как отдельная проповедь (её хозяин — вы). Оригинал не сохраняется */
function saveAsCopy(){
  const old = state.id;
  endCloud({ discard:true });   // замок оригинала отпускаем, его несохранённые правки уходят в копию
  state.id = uid(); state.meta.title = (state.meta.title || 'Проповедь') + ' (копия)';
  CLOUD_FIELDS.forEach(k => delete state[k]);
  state.savedAt = 0; state.updatedAt = Date.now();
  try { localStorage.removeItem('swp-sermon:' + old); } catch(e){}
  if (cloudOn()) beginCloud(null);
  histReset();
  persistDraft();
  history.replaceState(null, '', sermonHash(state.id) + (view === 'text' ? '&v=text' : ''));
  renderAll();
  if (cloudOn()) saveNow();
}

/* ----- Удаление и перенос ----- */
async function deleteCloudSermon(d){
  const t = d.meta.title ? '«' + d.meta.title + '»' : 'эту проповедь';
  const r = cloud.list && cloud.list.get(d.id), l = r && r.lock;
  if (l && lockLive(l) && !(ed.id === d.id && lockHere(l))){
    toast(l.email === myEmail() ? 'Вы правите её в другой вкладке или на другом устройстве. Закройте правку там и удалите ещё раз' : 'Сейчас её правит ' + lockWho(l) + '. Удалить можно, когда правка закончится');
    return;
  }
  if (cloud.role === 'preacher' && r && statusKey(r.cloudStatus) !== 'draft'){   // автор удаляет только свой черновик (так решает и база)
    toast(atEditor(r) ? AT_EDITOR_MSG : 'Удалить можно только черновик. Откройте конспект, нажмите «Редактировать» и переключите статус на «Черновик»');
    return;
  }
  if (!confirm('Удалить ' + t + ' из облака? Она пропадёт у всех, вернуть её нельзя.')) return;
  try {
    await cloud.api.remove(cloud.space, d.id);
    if (ed.id === d.id) resetCloud();
    try { localStorage.removeItem('swp-sermon:' + d.id); if (LS.get('swp-sermon:last') === d.id) localStorage.removeItem('swp-sermon:last'); } catch(e){}
    if (state && state.id === d.id) state = blank();
    toast('Проповедь удалена');
  } catch(e){ toast(cloudExplain(e) || 'Не удалось удалить'); }
}
/* Проповедь из браузера или файла — в облако, не открывая её */
async function uploadToCloud(d){
  try {
    const r = await cloud.api.save(cloud.space, Object.assign({}, d, { cloudAt:0 }), cloud.user, {});
    const s = Object.assign({}, d, { cloudSpace:r.cloudSpace, cloudAt:r.cloudAt, cloudOwner:r.cloudOwner, cloudStatus:r.cloudStatus, cloudBy:r.cloudBy, savedAt:d.updatedAt });
    LS.set('swp-sermon:' + s.id, JSON.stringify(s));
    if (state && state.id === s.id) state = normalize(s);
    return true;
  } catch(e){
    if (e && e.code === 'conflict') return 'exists';
    throw e;
  }
}
async function uploadOne(d){
  try {
    const ok = await uploadToCloud(d);
    if (ok === 'exists') toast('Такая проповедь уже есть в облаке. Откройте её и сохраните: форма спросит, чью версию оставить.');
    else toast('Проповедь теперь в облаке');
  } catch(e){ toast(cloudExplain(e) || 'Не удалось перенести'); }
  if (screen === 'home') renderHomeList();
}

/* ----- Открыть проповедь из облака (адрес #s=<id>) ----- */
let routeSeq = 0;
async function openCloudSermon(id, local, seq){
  mainEl.innerHTML = '';
  mainEl.append(h('div', { class:'gate' }, h('p', { class:'gate-text', text:'Открываю проповедь…' })));
  let remote = null, failed = false;
  try { remote = await cloud.api.get(cloud.space, id); } catch(e){ failed = !/permission-denied/.test((e && e.code) || ''); }
  if (remote && canFlag()) await loadFlags(id);   // отметки «доработать» — только редактору   // «нет прав» — это «нет такой для вас», а не обрыв связи
  if (seq !== routeSeq) return null;   // пока грузили, человек ушёл на другой экран
  const unsaved = local && isUnsaved(local);
  let pick = null, note = '';
  if (remote){
    if (!local || !unsaved) pick = remote;
    else if (local.cloudAt === remote.cloudAt) pick = local;
    else if (remote.lock && remote.lock.email === myEmail() && remote.lock.at === recallAt(id) && remote.cloudBy === myEmail()) pick = local;   // облачная новее из-за нашей же записи (перезагрузили посреди правки)
    else pick = confirm('В браузере остались несохранённые правки этой проповеди, а в облаке она уже новее. Оставить ваши правки? («Отмена» откроет облачную версию.)') ? local : remote;
  } else if (local){ pick = local; if (failed) note = 'Нет связи с облаком: открыта копия из браузера'; }
  if (!pick) return { missing:true, failed };
  const s = applyFlags(normalize(pick));
  if (pick === remote) s.savedAt = s.updatedAt;
  return { state:s, note, remote, local:pick === local, offline:failed };
}
