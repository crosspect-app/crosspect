'use strict';

/* ========= Облако: вход Google и сохранение проповедей =========
   Связь с Firebase — в cloud-api.mjs (подключается по требованию). Здесь — состояние входа, экран входа,
   пространства, список проповедей из облака и сохранение. С этапа 8 без входа форма не работает:
   все проповеди — в облаке, в браузере лежат только черновики несохранённых правок.
   Админ всей формы (admins/{почта} в базе) видит все пространства; остальные — те, куда их добавили.
   Кто состоит в нескольких пространствах (и админ), переключается между ними в шапке главной.
   Замок, правка и автосохранение — в lock.js. */
const BUILD_ID = (document.currentScript && /[?&]v=([^&]+)/.exec(document.currentScript.src || '') || [])[1] || 'dev';
const FIREBASE_VERSION = '13.1.0';
const ROLE_NAMES = { admin:'админ', editor:'редактор', preacher:'автор' };   // в данных и правилах роль автора — preacher

/* mode: wait — подключаемся, out — не вошли, noaccess — почты нет ни в одном пространстве, nospaces — админ, но пространств
   ещё нет, error — не вышло, in — всё есть.
   spaces — куда можно войти: [{ id, name, settings, role, member }]; role — admin (админ всей формы), editor или preacher (автор).
   list — живой список проповедей текущего пространства: Map id → строка-сводка (cloud-api.mjs, fromSummary) */
const cloud = { mode:'wait', api:null, user:null, admin:false, spaces:[], space:'', spaceName:'', role:'', member:null, settings:{},
  list:null, fromCache:false, listError:'', error:'', unsub:null, started:false, authOn:false };
const cloudOn = () => cloud.mode === 'in';
/* Что показывать вместо главной и проповеди: null — ничего, можно работать */
const cloudGate = () => cloudOn() ? (introHold() ? 'wait' : null) : cloud.mode;   // при открытии формы заставка держится ~1,5 с (motion.js)
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
  if (opMode()){ route(); return; }   // страница оператора (этап 9): вход не нужен, лишнего не читаем; вход начнётся, когда уйдут со страницы (closeOperator)
  startAuth();
}
/* Следить за входом. Один раз за страницу */
function startAuth(){
  if (cloud.authOn || !cloud.api) return;
  cloud.authOn = true;
  cloud.api.onUser(u => cloudUser(u));
}

async function cloudUser(user){
  stopListen(); resetCloud();
  Object.assign(cloud, { user, admin:false, spaces:[], list:null, space:'', spaceName:'', role:'', member:null, settings:{}, error:'' });
  if (!user){ cloud.mode = 'out'; cloudChanged(); return; }
  cloud.mode = 'wait'; cloudChanged();
  try {
    cloud.spaces = await spacesFor(user.email);
    if (cloud.user !== user) return;   // пока ждали, вошли под другой почтой или вышли
    if (!cloud.spaces.length){ cloud.mode = cloud.admin ? 'nospaces' : 'noaccess'; cloudChanged(); return; }
    // пространство: из ссылки (#…&sp=…), иначе то, где человек был в прошлый раз, иначе первое по алфавиту
    const want = new URLSearchParams(location.hash.slice(1)).get('sp') || LS.get('swp-space');
    useSpace(cloud.spaces.find(x => x.id === want) || cloud.spaces[0]);
    cloud.mode = 'in';
    startListen();
    loadLayoutPrefs();   // раскладка экрана у человека (layout.js)
  } catch(e){
    cloud.mode = 'error'; cloud.error = cloudExplain(e) || 'Не удалось получить доступ к облаку.';
  }
  cloudChanged();
}
/* Куда можно войти. Админ всей формы — во все пространства (роль admin), остальные — туда, где они участники.
   Старая роль admin у участника (до этапа 8) — это редактор */
async function spacesFor(email){
  cloud.admin = cloud.api.isAdmin ? await cloud.api.isAdmin(email) : false;
  const mine = await cloud.api.spacesOf(email);
  let list;
  if (cloud.admin){
    const all = await cloud.api.allSpaces();
    list = all.map(sp => ({ id:sp.id, name:sp.name || '', settings:sp.settings || {}, role:'admin', member:mine.find(m => m.spaceId === sp.id) || null }));
  } else {
    list = (await Promise.all(mine.map(async m => {
      let sp = null;
      try { sp = await cloud.api.getSpace(m.spaceId); } catch(e){ if (!/permission-denied/.test((e && e.code) || '')) throw e; }
      return sp ? { id:m.spaceId, name:sp.name || '', settings:sp.settings || {}, role:m.role === 'admin' ? 'editor' : m.role, member:m } : null;
    }))).filter(Boolean);
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id));
}
/* Сделать пространство текущим (слушатели запускает и останавливает вызывающий) */
function useSpace(sp){
  Object.assign(cloud, { space:sp.id, spaceName:sp.name, settings:sp.settings || {}, role:sp.role, member:sp.member, list:null, listError:'', fromCache:false });
  LS.set('swp-space', sp.id);
  loadSlidesCache(sp.id);   // настройки слайдов этого пространства — последняя копия, пока не пришли из облака
}
/* Переключатель пространств в шапке главной. Правку (если была) сохраняем и отпускаем, потом — на главную нового пространства */
function switchSpace(id, keepRoute){
  const sp = cloud.spaces.find(x => x.id === id);
  if (!sp || !cloudOn() || id === cloud.space) return !!sp;
  endCloud();
  stopListen();
  useSpace(sp);
  startListen();
  if (!keepRoute){ if (location.hash) navigate(''); else renderAll(); }
  return true;
}
const multiSpace = () => cloudOn() && cloud.spaces.length > 1;
function cloudExplain(e){ return cloud.api && cloud.api.explain ? cloud.api.explain(e) : String((e && e.message) || e); }

/* Вход или выход сменили экран: перерисовать то, что показано (и открыть проповедь по ссылке, если вошли) */
function cloudChanged(){ if (typeof route === 'function') route(); }

function startListen(){
  const restrict = cloud.role === 'preacher' && cloud.settings.preachersSeeAll === false ? cloud.user.email : null;
  cloud.unsub = cloud.api.listen(cloud.space, restrict, (items, fromCache) => {
    cloud.list = new Map(items.map(r => [r.id, r])); cloud.fromCache = !!fromCache; cloud.listError = '';
    if (screen === 'home' && cloudOn()) renderHomeList();
  }, e => {
    cloud.listError = cloudExplain(e) || 'Не удалось загрузить список конспектов.';
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

/* ----- Экран входа ----- */
function renderGate(){
  const mode = cloudGate();
  const other = () => h('button', { type:'button', class:'btn primary', onclick:() => cloudSignOut().then(() => cloudSignIn()) }, 'Войти другой почтой');
  let body;
  // заставка при открытии (этап 7.7): только знак и зерно; если облако отвечает дольше ~1,5 с — тихая строка «Подключаюсь к облаку…»
  if (mode === 'wait') body = [h('p', { class:'gate-text gate-wait', role:'status', text:'Подключаюсь к облаку…' })];
  else if (mode === 'noaccess') body = [
    h('h1', { text:'Вас нет в списке' }),
    h('p', { class:'gate-text' }, 'Вы вошли как ' + (cloud.user ? cloud.user.email : '') + ', но этой почты нет среди участников. Чтобы получить доступ, напишите на\u00a0',
      h('a', { class:'gate-mail', href:'mailto:' + CONTACT_EMAIL, text:CONTACT_EMAIL }), ' или войдите другой почтой.'),
    h('div', { class:'chips' }, other())];
  else if (mode === 'nospaces') body = [
    h('h1', { text:'Пространств пока нет' }),
    h('p', { class:'gate-text', text:'Вы админ, но в облаке ещё нет ни одного пространства. Заведите первое: crosspect-backup → Actions → «Пространства» → create-space.' }),
    h('div', { class:'chips' },
      h('button', { type:'button', class:'btn primary', onclick:() => cloudUser(cloud.user) }, 'Обновить'), other())];
  else if (mode === 'error') body = [
    h('h1', { text:'Облако недоступно' }),
    h('p', { class:'gate-text', text:cloud.error }),
    h('div', { class:'chips' },
      h('button', { type:'button', class:'btn primary', onclick:() => { if (cloud.user) cloudUser(cloud.user); else { cloud.started = false; initCloud(); } } }, 'Повторить'))];
  else body = [
    h('h1', { text:'Конспекты проповедей' }),
    h('p', { class:'gate-text', text:'Войдите через Google. Нужна та почта, которую вам добавил админ церкви.' }),
    h('div', { class:'chips' }, h('button', { type:'button', class:'btn primary big', onclick:() => cloudSignIn() }, 'Войти через Google')),
    inAppBrowser() ? h('p', { class:'gate-warn', text:'Похоже, страница открыта внутри Telegram или другого приложения. Google не даёт войти отсюда: откройте ссылку в Chrome или Safari.' }) : null];
  // этап 7.6: логотип собирается (~900 мс, один раз при открытии экрана; перерисовка в первую секунду продолжает, а не начинает заново), на фоне живое зерно
  const lg = logoLockup('gate-logo'), el = Date.now() - (MOTION.gateAt || (MOTION.gateAt = Date.now()));
  if (el < 1000){ lg.classList.add('intro'); lg.style.setProperty('--el', el + 'ms'); }
  mainEl.append(h('div', { class:'gate-fx', 'aria-hidden':'true' }, h('div', { class:'gate-grain' })),
    h('div', { class:'gate' + (mode === 'wait' ? ' full' : '') }, h('div', { class:'gate-card' + (mode === 'wait' ? ' splash' : '') }, lg, body)));
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
/* Проповедь сохраняется в облако сама (lock.js): Ctrl+S и кнопка — «сохранить сейчас» */
function saveSermon(){
  if (!cloudOn() || screen !== 'sermon') return;
  if (!cloudSermon()) beginCloud(null);
  saveNow();
}

/* Пока проповедь правили здесь, её же сохранили в облаке: человек решает, чья версия главнее */
function conflictSheet(remote){
  const when = remote && remote.cloudAt ? fmtTime(remote.cloudAt) : '', by = remote && remote.cloudBy ? ' (' + remote.cloudBy + ')' : '';
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet', role:'dialog', 'aria-label':'Конспект уже изменили' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Конспект уже изменили' }), iconBtn('close', 'Закрыть', closeSettings)),
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
  state.cloudSpace = cloud.space;
  state.savedAt = 0; state.updatedAt = Date.now();
  try { localStorage.removeItem('swp-sermon:' + old); } catch(e){}
  if (cloudOn()) beginCloud(null);
  histReset();
  persistDraft();
  history.replaceState(null, '', sermonHash(state.id) + (view === 'text' ? '&v=text' : ''));
  renderAll();
  if (cloudOn()) saveNow();
}

/* ----- Удаление ----- */
async function deleteCloudSermon(d){
  const t = d.meta.title ? '«' + d.meta.title + '»' : 'этот конспект';
  const r = cloud.list && cloud.list.get(d.id), l = r && r.lock;
  if (l && lockLive(l) && !(ed.id === d.id && lockHere(l))){
    toast(l.email === myEmail() ? 'Вы правите его в другой вкладке или на другом устройстве. Закройте правку там и удалите ещё раз' : 'Сейчас его правит ' + lockWho(l) + '. Удалить можно, когда правка закончится');
    return;
  }
  if (cloud.role === 'preacher' && r && statusKey(r.cloudStatus) !== 'draft'){   // автор удаляет только свой черновик (так решает и база)
    toast(atEditor(r) ? AT_EDITOR_MSG : 'Удалить можно только черновик. Откройте конспект, нажмите «Редактировать» и переключите статус на «Черновик»');
    return;
  }
  if (!confirm('Удалить ' + t + ' из облака? Конспект пропадёт у всех, вернуть его нельзя.')) return;
  try {
    await cloud.api.remove(cloud.space, d.id);
    if (ed.id === d.id) resetCloud();
    try { localStorage.removeItem('swp-sermon:' + d.id); if (LS.get('swp-sermon:last') === d.id) localStorage.removeItem('swp-sermon:last'); } catch(e){}
    if (state && state.id === d.id) state = blank();
    toast('Конспект удалён');
  } catch(e){ toast(cloudExplain(e) || 'Не удалось удалить'); }
}

/* ----- Открыть проповедь из облака (адрес #s=<id>) ----- */
let routeSeq = 0;
async function openCloudSermon(id, local, seq){
  // этап 7.7: прежний экран остаётся, пока проповедь не готова; дольше ~300 мс — заготовка (showSkeleton в app.js)
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
    else pick = confirm('В браузере остались несохранённые правки этого конспекта, а в облаке он уже новее. Оставить ваши правки? («Отмена» откроет облачную версию.)') ? local : remote;
  } else if (local){ pick = local; if (failed) note = 'Нет связи с облаком: открыта копия из браузера'; }
  if (!pick) return { missing:true, failed };
  const s = applyFlags(normalize(pick));
  if (pick === remote) s.savedAt = s.updatedAt;
  return { state:s, note, remote, local:pick === local, offline:failed };
}
