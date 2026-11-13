'use strict';

/* ========= Замок и автосохранение (этап 6) =========
   Проповедь из облака открывается для просмотра. «Редактировать» берёт замок (транзакция в cloud-api.mjs):
   пока он мой, другие видят «Сейчас правит …» и проповедь только для чтения, обновляемую вживую.
   Пока правлю: правка уходит в облако через несколько секунд, сигнал «я здесь» — раз в минуту.
   «Сохранить», уход с проповеди или простой дольше lockMinutes — сохранить и отпустить.
   Замок забрали (редактор или я сам в другой вкладке) — то, что не успело сохраниться, уходит отдельной копией.
   Без сети правки копятся в черновике браузера и уходят, когда связь вернётся.
   «Свой» замок — почта + время начала (`at`): другая вкладка той же почты берёт замок заново, и `at` меняется. */
/* Автосохранение — раз в 30 секунд, пока есть несохранённые правки (бесплатный запас базы общий на всех). Сразу — при
   «Сохранить», уходе с проповеди, скрытии вкладки и Ctrl+S. Тесты могут сократить паузу: window.CROSSPECT_AUTOSAVE_MS */
const AUTOSAVE_MS = +window.CROSSPECT_AUTOSAVE_MS || 30000, BEAT_MS = 60000, TICK_MS = 15000, SLOW_MS = 8000, RETRY_MS = 15000, QUOTA_RETRY_MS = 300000, ADOPT_MS = 15000;   // ADOPT_MS — сколько после взятия замка новый замок с моей почтой считается моим
/* mode: view — просмотр, edit — правлю я. remote — последняя версия из облака (с замком), myAt — начало моего замка */
const ed = { id:null, mode:'view', remote:null, myAt:0, unsub:null, saveT:null, tickT:null, retryT:null, pending:null,
  lastAct:0, lastBeat:0, saving:false, beating:false, slow:false, offline:false, denied:false, conflict:null, busy:false,
  autoEdit:null, headKey:'', hintAt:0, quota:false, quotaAt:0, adoptUntil:0 };   // quota — дневной запас базы исчерпан: правки ждут в браузере

const lockMins = () => { const m = +(cloud.settings && cloud.settings.lockMinutes); return m >= 1 ? m : 10; };
const lockLive = l => !!l && Date.now() < l.beat + lockMins() * 60000;
const curLock = () => (ed.remote && ed.remote.lock) || null;
const lockHere = l => !!l && l.email === myEmail() && !!ed.myAt && l.at === ed.myAt;
/* Замок, который мешает править здесь: живой и не этой вкладки (может быть и мой — из другой вкладки) */
function otherLock(l){ l = l === undefined ? curLock() : l; return l && lockLive(l) && !lockHere(l) ? l : null; }
const cloudSermon = () => cloudOn() && screen === 'sermon' && !!state && ed.id === state.id;
const editing = () => cloudSermon() && ed.mode === 'edit';
const readOnly = () => cloudOn() && !!state && ed.id === state.id && ed.mode !== 'edit';   // не зависит от экрана: важно и до того, как проповедь нарисована
function myLockName(){
  const m = cloud.member || {};
  return [m.firstName, m.lastName].filter(Boolean).join(' ') || (cloud.user && cloud.user.name) || myEmail();
}
const lockWho = l => l.name || l.email;
const netErr = e => !navigator.onLine || /unavailable|deadline|network|offline/i.test(((e && e.code) || '') + ' ' + ((e && e.message) || ''));
const deniedErr = e => /permission-denied/.test((e && e.code) || '');
/* Начало моего замка помним на вкладку: после перезагрузки страницы правка продолжается */
function rememberAt(id, at){ try { if (at) sessionStorage.setItem('swp-lock:' + id, String(at)); else sessionStorage.removeItem('swp-lock:' + id); } catch(e){} }
function recallAt(id){ try { return +sessionStorage.getItem('swp-lock:' + id) || 0; } catch(e){ return 0; } }
const cloudMarks = r => ({ cloudSpace:r.cloudSpace, cloudAt:r.cloudAt, cloudOwner:r.cloudOwner, cloudStatus:r.cloudStatus, cloudBy:r.cloudBy, cloudShare:r.cloudShare || '' });

/* ----- Открыть и закрыть ----- */
/* Открыли проповедь после входа: решить, просмотр или правка. remote — версия из облака (null — её там нет или нет связи),
   pickedLocal — открыт черновик из браузера, offline — облако не ответило. Рисует экран вызывающий. */
function beginCloud(remote, pickedLocal, offline){
  endCloud();
  Object.assign(ed, { id:state.id, remote:remote || null, myAt:0, conflict:null, offline:false, denied:false, slow:false, quota:false, lastAct:Date.now(), headKey:'' });
  const auto = ed.autoEdit === state.id; ed.autoEdit = null;
  startTimers();
  if (!remote){
    if (offline && state.cloudAt && !isUnsaved(state)){ ed.mode = 'view'; ed.remote = JSON.parse(JSON.stringify(state)); startWatch(); return; }
    ed.mode = 'edit';   // новая или только в браузере: замок появится с первым сохранением
    if (state.cloudAt) startWatch();
    if (isDirty()) scheduleSave(offline ? RETRY_MS : 0);
    return;
  }
  ed.mode = 'view';
  startWatch();
  const unsaved = pickedLocal && isUnsaved(state);
  if (!canEditCloud(remote)){ if (unsaved) rescueAndShow(state, null); return; }   // права — по облачной версии: там может стоять «У редактора»
  const l = remote.lock, mine = recallAt(state.id);
  const resume = !!(l && l.email === myEmail() && mine && l.at === mine);   // перезагрузили страницу посреди правки
  if (!resume && l && l.email === myEmail() && lockLive(l)){   // правка открыта в другой вкладке: черновик в браузере — её, не трогаем
    if (pickedLocal) setRemoteState(remote);
    return;
  }
  // перезагрузка: замок берём заново (новое начало) — так копия вкладки не будет считать замок своим
  if (resume || unsaved || auto) startEdit({ force:resume, auto:true, ownSince:resume ? l.at : 0 });
}
/* Ушли с проповеди (на главную, в другую, вышли): правили — сохранить и отпустить. discard — не сохранять */
function endCloud(o){
  o = o || {};
  if (!ed.id) return Promise.resolve();
  const s = state && state.id === ed.id ? state : null, wasEdit = ed.mode === 'edit', at = ed.myAt, id = ed.id, conflict = ed.conflict;
  stopWatch(); stopTimers(); flushFlags();
  if (s && wasEdit && !o.discard) LS.set('swp-sermon:' + s.id, JSON.stringify(s));   // черновик — сразу, не ждём паузы
  Object.assign(ed, { id:null, mode:'view', remote:null, myAt:0, conflict:null, saving:false, slow:false, offline:false, denied:false, busy:false, pending:null });
  rememberAt(id, 0);
  if (!wasEdit || !s || !cloudOn()) return Promise.resolve();
  if (!o.discard && !conflict && isUnsaved(s)) return cloudWrite(s, { release:true, at });
  if (at) return cloud.api.release(cloud.space, id, cloud.user, at).catch(() => {});
  return Promise.resolve();
}
/* Вышли из облака или проповедь удалили: просто забыть, без записей */
function resetCloud(){ stopWatch(); stopTimers(); Object.assign(ed, { id:null, mode:'view', remote:null, myAt:0, conflict:null, saving:false, busy:false, pending:null }); }

function startWatch(){
  stopWatch();
  const id = ed.id;
  ed.unsub = cloud.api.watch(cloud.space, id, (r, meta) => onRemote(id, r, meta || {}), () => {});
}
function stopWatch(){ if (ed.unsub){ try { ed.unsub(); } catch(e){} ed.unsub = null; } }
function startTimers(){ stopTimers(); ed.tickT = setInterval(tick, TICK_MS); }
function stopTimers(){
  clearInterval(ed.tickT); clearTimeout(ed.saveT); clearTimeout(ed.retryT);
  ed.tickT = ed.saveT = ed.retryT = null;
}

/* Пришла новая версия из облака (или изменился замок) */
function onRemote(id, r, meta){
  if (ed.id !== id || !cloudOn()) return;
  if (r && r.deletedAt && !meta.fromCache){ trashedAway(id); return; }   // конспект убрали в корзину (этап 9.1)
  if (!r){
    if (meta.fromCache || ed.mode === 'edit') return;   // правлю: следующее сохранение создаст её заново
    resetCloud();
    if (screen === 'sermon' && state && state.id === id){ state = blank(); navigate(''); toast('Этот конспект удалили из облака'); }
    return;
  }
  ed.remote = r;
  if (ed.mode === 'edit'){
    const l = r.lock;
    if (!meta.fromCache && l && ed.myAt && !lockHere(l) && l.at > ed.myAt){
      // только что взяли замок сами, а перечитали старую версию: новый замок с моей почтой — мой
      if (l.email === myEmail() && Date.now() < ed.adoptUntil){ ed.myAt = l.at; rememberAt(id, l.at); refreshHead(); }
      else lostLock(l, r);   // замок взяли после меня
    }
    else refreshHead();
    return;
  }
  if (ed.busy){ refreshHead(); return; }
  if (state && state.id === id && r.cloudAt !== state.cloudAt){ setRemoteState(r); rerenderKeep(); }
  else refreshHead();
}
function setRemoteState(r){
  const keep = selId;
  state = applyFlags(normalize(r)); state.savedAt = state.updatedAt;   // отметки редактора — поверх проповеди
  selId = state.blocks.some(b => b.id === keep) ? keep : null;
  histReset();   // другая версия: прежняя история отмены к ней не относится
}
/* Перерисовать проповедь, не теряя прокрутку ленты и страницы */
function rerenderKeep(){
  if (screen !== 'sermon'){ renderTopbar(); return; }
  const fs = filmEl && filmEl.isConnected ? filmEl.scrollTop : 0, ss = sideEl && sideEl.isConnected ? sideEl.scrollTop : 0, ws = window.scrollY;
  renderAll();
  if (filmEl && filmEl.isConnected) filmEl.scrollTop = fs;
  if (sideEl && sideEl.isConnected) sideEl.scrollTop = ss;
  window.scrollTo(0, ws);
}
/* Шапка зависит от режима и чужого замка: перерисовать её только когда это поменялось */
function refreshHead(){
  if (screen !== 'sermon') return;
  const l = otherLock();
  const key = [ed.mode, ed.busy, l ? l.email + l.at : '', canEditCloud()].join('|');
  if (key !== ed.headKey){ ed.headKey = key; renderTopbar(); }
  else updateStatus();
}

/* ----- Начать правку ----- */
async function startEdit(o){
  o = o || {};
  if (!cloudOn() || !state || ed.id !== state.id || ed.mode === 'edit' || ed.busy) return;   // экран может быть ещё не нарисован
  const s = state, id = s.id;
  if (!s.cloudAt){ ed.mode = 'edit'; rerenderKeep(); return; }
  ed.busy = true; refreshHead();
  try {
    const r = await cloud.api.lock(cloud.space, id, cloud.user, myLockName(), { at:o.resumeAt || 0, force:!!o.force, minutes:lockMins() });
    if (ed.id !== id || !cloudOn()){ cloud.api.release(cloud.space, id, cloud.user, r.lock && r.lock.at).catch(() => {}); return; }
    ed.remote = r; ed.myAt = r.lock ? r.lock.at : 0; rememberAt(id, ed.myAt); ed.adoptUntil = Date.now() + ADOPT_MS;
    ed.mode = 'edit'; ed.lastAct = ed.lastBeat = Date.now(); ed.denied = false;
    if (state === s && !isDirty() && r.cloudAt !== state.cloudAt) setRemoteState(r);   // править будем самую свежую версию
    // после перезагрузки облачная версия бывает новее черновика только из-за наших же записей: черновик их уже содержит
    else if (state === s && o.ownSince && r.cloudBy === myEmail() && r.cloudAt >= o.ownSince) state.cloudAt = r.cloudAt;
    if (state === s || state.id === id) histReset();   // отмена — в пределах этой правки
    if (isDirty()) scheduleSave(0);
  } catch(e){
    if (ed.id !== id) return;
    if (e && e.code === 'locked'){
      ed.remote = Object.assign({}, ed.remote, { lock:e.lock });
      if (state === s && isUnsaved(s)){ ed.busy = false; await rescueAndShow(s, e.lock); return; }   // открыли с несохранёнными правками
      if (!o.auto) toast('Сейчас его правит ' + lockWho(e.lock) + '. Править можно, когда правка закончится');
    } else if (e && e.code === 'missing') toast('Этого конспекта уже нет в облаке');
    else if (e && e.code === 'trashed'){ ed.busy = false; await trashedAway(id); return; }
    else if (netErr(e)) toast('Нет связи с облаком: править можно, когда появится сеть');
    else toast(cloudExplain(e) || 'Не удалось начать правку');
  } finally {
    if (ed.id === id){ ed.busy = false; ed.headKey = ''; rerenderKeep(); }
  }
}
/* Редактор забирает правку у другого человека */
function takeOver(l){
  const who = l.email === myEmail() ? 'Вы сами правите этот конспект в другой вкладке или на другом устройстве' : 'Сейчас этот конспект правит ' + lockWho(l);
  if (!confirm(who + ' (с ' + fmtTime(l.at) + '). Забрать правку сюда? Что не успело сохраниться там, форма сохранит отдельной копией.')) return;
  startEdit({ force:true });
}

/* ----- Сохранение ----- */
function onEdit(){ ed.lastAct = Date.now(); if (editing()) scheduleSave(); }
function scheduleSave(ms){
  if (ed.saveT || ed.conflict) return;
  ed.saveT = setTimeout(autoSave, ms == null ? AUTOSAVE_MS : ms);
}
function autoSave(manual){
  ed.saveT = null;
  if (!editing() || ed.conflict || ed.denied || !isDirty()) return;
  if (ed.saving) return;   // по окончании текущей записи проверим ещё раз
  if (ed.quota && Date.now() - ed.quotaAt < QUOTA_RETRY_MS){ retryLater(QUOTA_RETRY_MS - (Date.now() - ed.quotaAt)); return; }   // запас базы исчерпан: пробуем раз в несколько минут
  ed.pending = cloudWrite(state, { at:ed.myAt, manual:manual === true });   // manual — «Сохранить» / Ctrl+S: знак играет анимацию; автосохранение — тихая галочка (motion.js)
}
/* «Заменить облачную» в окне конфликта */
function forceSave(){
  ed.conflict = null; clearTimeout(ed.saveT); ed.saveT = null;
  ed.pending = cloudWrite(state, { at:ed.myAt, force:true, manual:true });
}
/* Ctrl+S и «Сохранить» во время правки: сразу, не дожидаясь паузы */
function saveNow(){
  if (readOnly()){ roHint(); return; }
  clearTimeout(ed.saveT); ed.saveT = null;
  if (ed.conflict){ conflictSheet(ed.conflict); return; }
  ed.denied = false; ed.quotaAt = 0;   // Ctrl+S — попробовать сразу, даже если запас был исчерпан
  if (isDirty()) autoSave(true);
  else updateStatus();
}
function retryLater(ms){
  if (ed.retryT) return;
  ed.retryT = setTimeout(() => { ed.retryT = null; if (editing() && isDirty()) scheduleSave(0); }, ms || RETRY_MS);
}

/* Записать проповедь s в облако. o: { at — мой замок, release — отпустить, force — заменить облачную }.
   s может быть уже не открыта (ушли с неё): тогда пишем молча и обновляем только её черновик */
async function cloudWrite(s, o){
  o = o || {};
  const here = () => state === s && ed.id === s.id;
  const sent = s.updatedAt;
  // Анимация знака — при «Сохранить» (7.6) и пока знак застрял на полпути после неудачного сохранения (запись дойдёт — он доиграет);
  // обычное автосохранение — тихая галочка у статуса
  const useLogo = !!o.manual || LG.level > 0 || LG.want > 0;
  const lg = n => { if (useLogo && here()) logoTo(n); };
  if (here()){ ed.saving = true; persistDraft(); lg(2); }   // левая часть знака: черновик записан в браузере (persistDraft обновляет и шапку)
  const slow = setTimeout(() => { if (here()){ ed.slow = true; updateStatus(); } }, SLOW_MS);
  let res = 'ok';
  const shareWas = s.cloudShare || (ed.remote && ed.remote.id === s.id ? ed.remote.cloudShare : '');   // ссылка для оператора есть: снимок обновится вместе с сохранением (этап 9)
  const shareSnap = shareWas ? opSnapshot(s) : null;
  try {
    const sending = cloud.api.save(cloud.space, s, cloud.user, { force:!!o.force, status:s.cloudStatus || 'draft', lock:{ name:myLockName(), at:o.at || 0, release:!!o.release, minutes:lockMins() } });
    lg(3);   // верхняя правая часть: запрос ушёл
    const r = await sending;
    Object.assign(s, cloudMarks(r)); s.savedAt = Math.max(sent, s.savedAt || 0);
    if (shareSnap && r.cloudShare) opSync(r.cloudShare, shareSnap);   // отдельная запись; без ожидания и без влияния на сохранение
    resyncFlags(s);   // у слайдов без отметки редактора подпись содержимого — по сохранённому
    if (here()){
      ed.remote = r; ed.offline = false; ed.quota = false; ed.lastBeat = Date.now();
      lg(4);   // клин: сервер подтвердил
      if (!useLogo && !o.release) motionCheck();   // автосохранение: тихая галочка рядом со статусом (ошибка — без галочки)
      if (!o.release && r.lock && r.lock.email === myEmail()){ if (!o.at) ed.adoptUntil = Date.now() + ADOPT_MS; ed.myAt = r.lock.at; rememberAt(s.id, ed.myAt); }
      persistDraft();
      if (!ed.unsub) startWatch();
    } else LS.set('swp-sermon:' + s.id, JSON.stringify(s));
    if (o.manual) snapVersion(s);   // «Сохранить» и Ctrl+S: копия в историю (этап 9.7; автосохранение копий не делает)
  } catch(e){
    const code = (e && e.code) || '';
    if (code === 'lost-lock'){
      res = 'lost';
      if (here()){ if (ed.mode === 'edit') await lostLock(e.lock, e.remote); }   // уже в просмотре — копию сделал lostLock
      else {   // ушли с проповеди, а сохранить последние правки не дали: они — в копии
        const c = await rescueCopy(s);
        toast('«' + (s.meta.title || 'Конспект') + '» сейчас правит ' + lockWho(e.lock) + '. Ваши последние правки сохранены копией «' + c.title + '»');
        if (screen === 'home') renderHomeList();
      }
    } else if (code === 'trashed'){   // конспект убрали в корзину, пока правки ждали отправки (этап 9.1): они — в копии
      res = 'trashed';
      if (here()) await trashedAway(s.id, s);
      else {
        const c = await rescueCopy(s);
        toast('«' + (s.meta.title || 'Конспект') + '» убрали в корзину. Ваши последние правки сохранены копией «' + c.title + '»');
        if (screen === 'home') renderHomeList();
      }
    } else if (code === 'conflict'){
      res = 'conflict';
      if (here()){ ed.conflict = e.remote; conflictSheet(e.remote); }
    } else if (/resource-exhausted/.test(code)){
      res = 'quota';   // дневной запас бесплатной базы закончился (обновится в 9:00): правки ждут в браузере
      if (here()){ lg(2); const first = !ed.quota; ed.quota = true; ed.quotaAt = Date.now(); persistDraft(); retryLater(QUOTA_RETRY_MS); if (first) toast(cloudExplain(e)); }
    } else if (netErr(e)){
      res = 'offline';
      if (here()){ ed.offline = true; persistDraft(); retryLater(); lg(2); }   // правки ждут в черновике браузера
    } else if (deniedErr(e) && here() && ed.mode === 'edit'){
      res = 'denied';
      await checkLock(true);
    } else {
      res = 'error';
      if (here()){ ed.denied = true; toast(cloudExplain(e) || 'Не удалось сохранить'); }
    }
  } finally {
    clearTimeout(slow);
    if (here()){
      ed.saving = false; ed.slow = false; ed.pending = null; updateStatus();
      if (res === 'ok' && editing() && isDirty()) scheduleSave();
    }
  }
  return res;
}

/* База отказала (сигнал или запись): замок забрали или он пропал. Посмотреть, что в облаке */
async function checkLock(fromSave){
  const id = state.id;
  let r = null;
  try { r = await cloud.api.get(cloud.space, id); } catch(e){ return; }
  if (ed.id !== id || ed.mode !== 'edit') return;
  if (r && r.lock && !lockHere(r.lock) && lockLive(r.lock)){ await lostLock(r.lock, r); return; }
  if (fromSave){ ed.denied = true; updateStatus(); toast('Облако не приняло правку: нет прав. Проверьте, что вы вошли под своей почтой'); }
}

/* ----- Сигнал «я здесь» и простой ----- */
function tick(){
  if (!cloudSermon()) return;
  const now = Date.now();
  if (ed.mode === 'edit'){
    if (now - ed.lastAct >= lockMins() * 60000 && !ed.saving){ closeEdit('idle'); return; }
    if (ed.myAt && !ed.beating && !ed.saving && now - ed.lastBeat >= BEAT_MS - TICK_MS / 2) beat();
  }
  refreshHead();   // чужой замок мог истечь
}
async function beat(){
  const id = state.id, at = ed.myAt;
  ed.beating = true;
  try {
    await cloud.api.beat(cloud.space, id);
    if (ed.id === id && ed.myAt === at) ed.lastBeat = Date.now();
  } catch(e){
    if (deniedErr(e) && ed.id === id && ed.mode === 'edit') await checkLock(false);
  } finally { ed.beating = false; }
}

/* ----- Закончить правку ----- */
/* «Сохранить» (reason 'button') или простой ('idle'):
   сохранить, отпустить замок, остаться в просмотре. Возвращает 'ok' или причину, почему не вышло */
async function closeEdit(reason){
  if (!editing()) return 'none';
  const s = state;
  if (ed.pending) await ed.pending;
  if (!editing() || state !== s) return 'none';
  if (ed.conflict){ conflictSheet(ed.conflict); return 'conflict'; }
  if (!s.cloudAt && !isUnsaved(s)){ if (reason !== 'idle') toast('Конспект пустой: сохранять пока нечего'); else ed.lastAct = Date.now(); return 'empty'; }
  clearTimeout(ed.saveT); ed.saveT = null;
  const at = ed.myAt;
  let res = 'ok';
  if (isUnsaved(s) || !s.cloudAt) res = await (ed.pending = cloudWrite(s, { release:true, at, manual:reason === 'button' }));
  else if (at){
    try { await cloud.api.release(cloud.space, s.id, cloud.user, at); } catch(e){ res = netErr(e) ? 'offline' : 'error'; }
    if (res === 'ok' && reason === 'button') snapVersion(s);   // правки ушли автосохранением: копия в историю — всё равно по «Сохранить» (этап 9.7)
  }
  if (state !== s || ed.mode !== 'edit') return res === 'ok' ? 'none' : res;
  if (res !== 'ok'){
    if (reason === 'button'){
      if (res === 'offline') toast('Нет связи с облаком. Правки остаются в этом браузере и уйдут в облако, когда появится сеть');
      if (res === 'quota') toast('Облако перегружено до 9:00. Правки остаются в этом браузере и уйдут в облако, когда запас обновится');
    }
    if (reason === 'idle') ed.lastAct = Date.now();
    return res;
  }
  ed.mode = 'view'; ed.myAt = 0; rememberAt(s.id, 0);
  if (!ed.remote || !ed.remote.blocks || ed.remote.cloudAt !== s.cloudAt) ed.remote = JSON.parse(JSON.stringify(s));
  ed.remote = Object.assign({}, ed.remote, { lock:null });
  ed.headKey = '';
  histReset();   // правка закончена: отменять больше нечего
  rerenderKeep();
  if (reason === 'idle') idleSheet();
  else if (reason === 'button') toast('Сохранено. Теперь конспект могут править другие');
  return 'ok';
}

/* ----- Замок забрали ----- */
async function lostLock(l, remote){
  if (ed.mode !== 'edit') return;
  const s = state, dirty = isDirty();
  clearTimeout(ed.saveT); ed.saveT = null;
  Object.assign(ed, { mode:'view', myAt:0, conflict:null, offline:false, headKey:'' });
  rememberAt(s.id, 0);
  const copy = dirty ? await rescueCopy(s) : null;
  if (remote) ed.remote = remote;
  if (state === s && ed.remote && ed.remote.blocks) setRemoteState(ed.remote);
  rerenderKeep();
  lostSheet(l, copy);
}
/* Открытый конспект убрали в корзину (другой человек или я сам в другой вкладке): на главную. Несохранённое — отдельной копией.
   s — конспект, запись которого база не приняла (по умолчанию — открытый) */
async function trashedAway(id, s){
  s = s || (state && state.id === id ? state : null);
  const dirty = !!s && ed.mode === 'edit' && isUnsaved(s);
  resetCloud(); rememberAt(id, 0);
  const copy = dirty ? await rescueCopy(s) : null;
  if (state && state.id === id){ state = blank(); if (screen === 'sermon') navigate(''); }
  const title = s && s.meta && s.meta.title ? '«' + s.meta.title + '»' : 'Этот конспект';
  toast(title + ' убрали в корзину' + (copy ? '. Ваши несохранённые правки — в копии «' + copy.title + '»' : ''));
}
/* Несохранённое, что нельзя записать поверх (правит другой), — отдельной копией: в облако, а без сети — в браузер */
async function rescueCopy(s){
  const c = JSON.parse(JSON.stringify(s));
  c.id = uid(); c.meta.title = (c.meta.title || 'Проповедь') + ' (копия)';
  CLOUD_FIELDS.forEach(k => delete c[k]);
  c.cloudSpace = cloud.space;   // копия того же пространства: без сети она видна на его главной
  c.savedAt = 0; c.updatedAt = Date.now();
  LS.set('swp-sermon:' + c.id, JSON.stringify(c));
  try { localStorage.removeItem('swp-sermon:' + s.id); } catch(e){}   // правки теперь в копии: оригинал откроется из облака
  try {
    const r = await cloud.api.save(cloud.space, c, cloud.user, {});
    Object.assign(c, cloudMarks(r)); c.savedAt = c.updatedAt;
    LS.set('swp-sermon:' + c.id, JSON.stringify(c));
    return { id:c.id, title:c.meta.title, cloud:true };
  } catch(e){ return { id:c.id, title:c.meta.title, cloud:false }; }
}
/* Открыли черновик с несохранёнными правками, а проповедь сейчас правит другой (или она не ваша): правки — копией */
async function rescueAndShow(s, l){
  const copy = await rescueCopy(s);
  if (state === s && ed.remote && ed.remote.blocks) setRemoteState(ed.remote);
  ed.headKey = '';
  rerenderKeep();
  lostSheet(l, copy, true);
}
function lostSheet(l, copy, onOpen){
  const mine = l && l.email === myEmail();
  const head = !l ? (authorWaits(state) ? atEditorMsg() + '.' : 'Этот конспект вам править нельзя.') : mine ? 'Этот конспект вы правите в другой вкладке или на другом устройстве.' : lockWho(l) + ' сейчас правит эту проповедь.';
  const what = onOpen ? 'В браузере оставались несохранённые правки: ' : 'То, что не успело сохраниться, ';
  const tail = copy
    ? (copy.cloud ? what + (onOpen ? 'они ' : '') + 'сохранены отдельной копией «' + copy.title + '».'
      : what + (onOpen ? 'они ' : '') + 'лежат отдельной копией «' + copy.title + '» в этом браузере. В облако копия уйдёт, когда появится сеть: откройте её на главной, и она сохранится сама.')
    : 'Все ваши правки успели сохраниться.';
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet', role:'dialog', 'aria-label':'Правку забрали' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:!l && authorWaits(state) ? 'Конспект у редактора' : onOpen ? 'Конспект сейчас правят' : mine ? 'Правка открыта в другом месте' : 'Правку забрали' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('p', { class:'hint', style:'font-size:12px;margin-bottom:16px', text:head + ' ' + tail + ' Здесь конспект пока только для просмотра.' }),
    h('div', { class:'sheet-foot wrap' },
      copy ? h('button', { type:'button', class:'btn', onclick:() => { closeSettings(); ed.autoEdit = copy.id; navigate(sermonHash(copy.id)); } }, 'Открыть копию') : h('span'),
      h('button', { type:'button', class:'btn primary', onclick:closeSettings }, 'Понятно'))));
  settingsOverlay.classList.add('open');
}
function idleSheet(){
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet', role:'dialog', 'aria-label':'Правка закрыта' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Правка закрыта' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('p', { class:'hint', style:'font-size:12px;margin-bottom:16px', text:'Вы ничего не меняли ' + lockMins() + ' ' + plural(lockMins(), 'минуту', 'минуты', 'минут') +
      ', поэтому форма сохранила конспект и отпустила его: теперь его могут править другие. Чтобы продолжить, нажмите «Править дальше».' }),
    h('div', { class:'sheet-foot' },
      h('button', { type:'button', class:'btn', onclick:closeSettings }, 'Понятно'),
      h('button', { type:'button', class:'btn primary', onclick:() => { closeSettings(); startEdit(); } }, 'Править дальше'))));
  settingsOverlay.classList.add('open');
}

/* ----- Только просмотр ----- */
/* Правка в режиме просмотра: вернуть как было и подсказать про «Редактировать». Вызывается из change() */
function roBlock(){
  if (!readOnly()) return false;
  if (ed.remote && ed.remote.blocks) setRemoteState(ed.remote);
  rerenderKeep();
  roHint();
  return true;
}
function roHint(){
  if (Date.now() - ed.hintAt < 1500) return;
  ed.hintAt = Date.now();
  if (authorWaits()){ toast(atEditorMsg()); return; }
  if (!canEditCloud()){ toast('Это конспект другого автора: его можно только смотреть. Чтобы взять за основу, нажмите «Сделать копию»'); return; }
  const l = otherLock();
  if (l && l.email !== myEmail() && cloud.role === 'preacher'){ toast('Сейчас его правит ' + lockWho(l) + '. Править можно, когда правка закончится'); return; }
  toast('Сейчас только просмотр', l ? 'Забрать правку' : 'Редактировать', () => l ? takeOver(l) : startEdit());
}

/* Кнопка в шапке вместо «Сохранить» */
function headAction(){
  const b = (cls, icon, label, fn, extra) => h('button', Object.assign({ type:'button', class:'btn ' + cls, onclick:fn }, extra || {}), icon ? ic(icon) : null, label);
  if (!cloudSermon()) return b('primary', 'save', 'Сохранить', () => saveSermon(), { title:'Ctrl+S' });
  if (ed.busy) return b('primary', null, 'Открываю правку…', null, { disabled:true });
  if (ed.mode === 'edit') return b('primary', 'done', 'Сохранить', () => closeEdit('button'), { title:'Сохранить и закончить правку: тогда конспект смогут править другие (Ctrl+S — сохранить и продолжить)' });
  if (authorWaits()){   // конспект у редактора: на кнопке проявляется значок замка (motion.js); у редактора и админа замка нет — кнопка работает
    const btn = b('primary hd-edit', 'edit', 'Редактировать', null, { disabled:true, title:atEditorMsg() + '. Чтобы взять конспект за основу, сделайте копию: «⋯ → Сделать копию»' });
    btn.append(h('span', { class:'lockbadge', 'aria-hidden':'true' }, ic('lock')));
    return btn;
  }
  if (!canEditCloud()) return b('', 'dup', 'Сделать копию', () => saveAsCopy({ keep:true }), { title:'Копия станет вашим конспектом, его можно править' });
  const l = otherLock();
  if (l && l.email === myEmail()) return b('primary', 'edit', 'Править здесь', () => takeOver(l));
  if (l && cloud.role !== 'preacher') return b('', 'edit', 'Забрать правку', () => takeOver(l), { title:'Сейчас правит ' + lockWho(l) });
  if (l) return b('primary hd-edit', 'edit', 'Редактировать', null, { disabled:true, title:'Сейчас правит ' + lockWho(l) + '. Когда правка закончится, кнопка заработает' });
  return b('primary hd-edit', 'edit', 'Редактировать', () => startEdit());
}
/* Строка состояния в шапке: [класс, текст, по щелчку] */
function cloudStatusLine(){
  if (ed.mode === 'edit'){
    if (ed.conflict) return ['warn pick', 'Не сохранено: в облаке другая версия. Выбрать', () => conflictSheet(ed.conflict)];
    if (ed.denied) return ['warn', 'Облако не приняло правку'];
    if (ed.quota) return ['warn', 'Облако перегружено до 9:00: правки в этом браузере, уйдут в облако сами'];
    if (ed.offline || ed.slow) return ['warn', 'Нет связи: правки в этом браузере, уйдут в облако, когда появится сеть'];
    if (ed.saving) return ['', 'Сохраняю…'];
    if (isDirty()) return ['', 'Не сохранено: уйдёт в облако само'];
    if (state.cloudAt) return ['ok', '✓ Сохранено в облаке в ' + fmtTime(state.savedAt || state.cloudAt)];
    return ['', 'Правки сохранятся сами'];
  }
  if (ed.busy) return ['', 'Открываю правку…'];
  if (authorWaits()) return ['warn', atEditorMsg()];
  if (!canEditCloud()) return ['warn', 'Только чтение: конспект другого автора'];
  const l = otherLock();
  if (l && l.email === myEmail()) return ['warn', 'Вы правите её в другой вкладке или на другом устройстве (с ' + fmtTime(l.at) + ')'];
  if (l) return ['warn', 'Сейчас правит ' + lockWho(l) + ' (с ' + fmtTime(l.at) + ')'];
  return ['', 'Только просмотр'];
}
/* Пометка на карточке главной: кто сейчас правит */
function lockMark(d){
  if (!cloudOn() || !cloud.list) return null;
  const r = cloud.list.get(d.id), l = r && r.lock;
  if (!l || !lockLive(l)) return null;
  return h('span', { class:'lock-mark', title:'с ' + fmtTime(l.at), text:l.email === myEmail() ? 'Правите вы' : 'Правит ' + lockWho(l) });
}

/* ----- События страницы ----- */
['pointerdown', 'keydown', 'wheel'].forEach(t => document.addEventListener(t, () => { if (ed.mode === 'edit') ed.lastAct = Date.now(); }, { passive:true, capture:true }));
/* В просмотре щелчок по настройкам слайда или тексту — подсказка про «Редактировать» */
mainEl.addEventListener('pointerdown', e => { if (readOnly() && e.target.closest && e.target.closest('.side, .speech, .tv .cont')) roHint(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && editing() && isDirty() && !ed.saving){ clearTimeout(ed.saveT); ed.saveT = null; autoSave(); } });
window.addEventListener('online', () => { if (editing() && isDirty()){ ed.offline = false; scheduleSave(0); } });
window.addEventListener('pagehide', () => { if (editing()) LS.set('swp-sermon:' + state.id, JSON.stringify(state)); });
window.addEventListener('beforeunload', e => { if (editing() && (isDirty() || ed.saving)){ e.preventDefault(); e.returnValue = ''; } });
