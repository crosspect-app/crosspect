'use strict';

/* ========= Корзина (этап 9.1) =========
   «Удалить» на главной не стирает конспект, а убирает его в корзину (cloud-api.mjs: trash): в проповеди и сводке
   появляются пометки deletedAt / deletedBy, из списка конспект пропадает, править его нельзя. «Корзина» на главной
   (кнопка появляется, когда в ней что-то есть) — «Восстановить» и «Удалить навсегда». Через TRASH_DAYS дней
   корзину чистит служебный скрипт (admin.mjs purge-trash, ночью из crosspect-backup).
   Кто убирает, возвращает и стирает — как раньше удаление: редактор и админ — любой конспект, автор — свой черновик.
   Несохранённые правки из этого браузера (черновик swp-sermon:<id>) при этом не пропадают: пока конспект в корзине,
   их не видно, после «Восстановить» они снова на главной. Стираются вместе с конспектом. */
const TRASH_DAYS = 30;   // этап 10: срок — в настройках пространства
const DAY_MS = 86400000;

const inTrash = r => !!(r && r.deletedAt);
/* Может ли этот человек убрать конспект в корзину, вернуть его и стереть (так же отвечает база) */
function canTrash(d){
  if (!cloudOn()) return false;
  if (cloud.role !== 'preacher') return true;
  return (d.cloudOwner || '') === myEmail() && statusKey(d.cloudStatus) === 'draft';
}
/* Что лежит в корзине для этого человека: автор видит только то, что может вернуть (свои черновики) */
function trashList(){
  if (!cloud.list) return [];
  return [...cloud.list.values()].filter(r => inTrash(r) && canTrash(r)).sort((a, b) => b.deletedAt - a.deletedAt);
}

/* ----- Убрать в корзину (корзина в строке списка) ----- */
async function trashCloudSermon(d){
  const r = cloud.list && cloud.list.get(d.id), l = r && r.lock;
  if (l && lockLive(l) && !(ed.id === d.id && lockHere(l))){
    toast(l.email === myEmail() ? 'Вы правите его в другой вкладке или на другом устройстве. Закройте правку там и удалите ещё раз' : 'Сейчас его правит ' + lockWho(l) + '. Удалить можно, когда правка закончится');
    return;
  }
  if (cloud.role === 'preacher' && r && statusKey(r.cloudStatus) !== 'draft'){   // автор удаляет только свой черновик (так решает и база)
    toast(atEditor(r) ? AT_EDITOR_MSG : 'Удалить можно только черновик. Откройте конспект, нажмите «Редактировать» и переключите статус на «Черновик»');
    return;
  }
  try {
    await cloud.api.trash(cloud.space, d.id, cloud.user, { minutes:lockMins() });
    if (ed.id === d.id) resetCloud();
    if (state && state.id === d.id && screen !== 'sermon') state = blank();
    toast((d.meta.title ? '«' + d.meta.title + '»' : 'Конспект') + ' в корзине', 'Вернуть', () => restoreSermon(d.id));
  } catch(e){
    if (e && e.code === 'locked') toast('Сейчас его правит ' + lockWho(e.lock) + '. Удалить можно, когда правка закончится');
    else toast(cloudExplain(e) || 'Не получилось удалить');
  }
  renderHomeList();
}

/* ----- Вернуть ----- */
async function restoreSermon(id){
  try {
    const r = await cloud.api.restore(cloud.space, id, cloud.user);
    if (r && r.cloudShare) trashShareBack(r);   // ссылка для оператора снова работает (тем же адресом)
    const t = r && r.meta && r.meta.title;
    toast((t ? '«' + t + '»' : 'Конспект') + ' снова в списке', 'Открыть', () => { closeSettings(); navigate(sermonHash(id)); });
  } catch(e){ toast(cloudExplain(e) || 'Не получилось восстановить'); }
  renderTrash(); renderHomeList();
}
/* В корзине снимка для оператора нет (trash его стирает), а ключ остался в конспекте: собрать снимок заново под тем же ключом.
   Не вышло — не страшно: снимок пересоберётся при следующем «Ссылка для оператора» */
async function trashShareBack(r){
  try {
    const snap = opSnapshot(normalize(r));
    const res = await cloud.api.shareOn(cloud.space, r.id, cloud.user, r.cloudShare, snap, { minutes:lockMins() });
    opSent[res.key] = JSON.stringify(snap);
  } catch(e){}
}

/* ----- Стереть насовсем ----- */
async function purgeSermon(r){
  const t = r.meta.title ? '«' + r.meta.title + '»' : 'этот конспект';
  if (!confirm('Удалить ' + t + ' навсегда? Вернуть его уже не получится.')) return;
  try {
    await cloud.api.remove(cloud.space, r.id);
    try { localStorage.removeItem('swp-sermon:' + r.id); if (LS.get('swp-sermon:last') === r.id) localStorage.removeItem('swp-sermon:last'); } catch(e){}
    if (state && state.id === r.id) state = blank();
    toast('Конспект удалён насовсем');
  } catch(e){ toast(cloudExplain(e) || 'Не получилось удалить'); }
  renderTrash(); renderHomeList();
}

/* ----- Кнопка на главной и окно «Корзина» ----- */
/* Кнопка в шапке главной: только когда в корзине что-то есть */
function trashButton(){
  const n = trashList().length;
  if (!n) return null;
  return h('button', { type:'button', class:'btn ghost home-trash', title:'Удалённые конспекты: можно вернуть или удалить навсегда', onclick:() => openTrash() },
    ic('trash'), 'Корзина · ' + n);
}
/* «Удалён сегодня», «Удалён вчера», «Удалён 5 ноября» */
function trashWhen(ms){
  const a = fmtAgo(ms);
  return 'Удалён ' + (a === 'только что' ? 'только что' : a);
}
/* Через сколько дней сотрётся сам */
function trashLeft(ms){
  const days = Math.ceil((ms + TRASH_DAYS * DAY_MS - Date.now()) / DAY_MS);
  return days <= 0 ? 'Сотрётся этой ночью' : 'Сотрётся через ' + days + ' ' + plural(days, 'день', 'дня', 'дней');
}
function openTrash(){ drawTrash(); settingsOverlay.classList.add('open'); }
/* Окно открыто — перерисовать (список в облаке поменялся, конспект вернули или стёрли); закрыто или там другое окно — ничего */
function renderTrash(){
  if (settingsOverlay.classList.contains('open') && settingsOverlay.querySelector('.trash-sheet')) drawTrash();
}
function drawTrash(){
  const list = trashList();
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet trash-sheet', role:'dialog', 'aria-label':'Корзина' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Корзина' }), iconBtn('close', 'Закрыть', closeSettings)),
    list.length ? h('div', { class:'trash-list' }, list.map(trashRow)) : h('p', { class:'hint trash-empty', text:'Корзина пуста' })));
}
function trashRow(r){
  const who = r.deletedBy && r.deletedBy !== myEmail() ? ' · ' + r.deletedBy : '';
  const meta = [rowDate(r.meta.date) || 'Без даты', preacherName(r.meta)].filter(Boolean).join(' · ');
  return h('div', { class:'trash-row', 'data-id':r.id },
    h('div', { class:'trash-info' },
      h('div', { class:'trash-title' + (r.meta.title ? '' : ' empty'), text:r.meta.title || 'Без названия' }),
      h('div', { class:'trash-meta', text:meta }),
      h('div', { class:'trash-when', text:trashWhen(r.deletedAt) + who + ' · ' + trashLeft(r.deletedAt) })),
    h('div', { class:'trash-acts' },
      h('button', { type:'button', class:'btn small', onclick:() => restoreSermon(r.id) }, ic('undo'), 'Восстановить'),
      h('button', { type:'button', class:'btn small danger', onclick:() => purgeSermon(r) }, 'Удалить навсегда')));
}
