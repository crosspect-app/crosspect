'use strict';

/* ========= История сохранений (этап 9.7) =========
   При «Готово», Ctrl+S, уходе с правки и раз в 10 минут правки (этап 9.8, решает lock.js) форма откладывает копию конспекта в облако:
   spaces/{s}/sermons/{id}/versions/{v} (cloud-api.mjs: addVersion). Хранятся последние 10 (VERSIONS_KEEP); копия с тем же
   содержимым, что у последней, не пишется. Окно «История» (меню «⋯») — список копий и просмотр выбранной текстом;
   «Вернуть эту версию» — только в правке, как обычная правка: попадает в отмену (↶, Ctrl+Z) и уходит в облако
   с автосохранением. Видят и пишут историю те, кто может править конспект (так решает и база).
*/

const VER_KEEP = 10;   // столько копий хранит облако (VERSIONS_KEEP в cloud-api.mjs)
const ver = { busy:{}, again:{}, list:null, id:'', pick:0, loading:false, error:'' };

/* Кто видит историю этого конспекта: тот, кто может его править, и только если он уже в облаке */
const canHistory = () => cloudSermon() && canEditCloud() && !!state.cloudAt;

/* Отложить копию (когда — решает lock.js). Не мешает работе: без ожидания, ошибки — молча (копия — страховка) */
async function snapVersion(s){
  if (!cloudOn() || !s || !s.cloudAt || !s.cloudSpace || !canEditCloud(s)) return;
  const id = s.id;
  if (ver.busy[id]){ ver.again[id] = s; return; }   // прежняя копия ещё пишется: эту — следом
  ver.busy[id] = true;
  try {
    const list = await cloud.api.addVersion(s.cloudSpace, s, cloud.user, { name:myLockName() });
    if (list && ver.id === id) ver.list = list;
    if (list && historyOpen()) drawHistory();
  } catch(e){ /* нет связи или прав — копия не нужна этой ценой */ }
  finally {
    ver.busy[id] = false;
    const next = ver.again[id]; delete ver.again[id];
    if (next) snapVersion(next);
  }
}

/* ----- Окно «История» ----- */
const historyOpen = () => settingsOverlay.classList.contains('open') && !!settingsOverlay.querySelector('.ver-sheet');
async function openHistory(){
  if (!canHistory()){ toast('Историю видят те, кто может править конспект'); return; }
  const id = state.id;
  Object.assign(ver, { id, list:null, pick:0, loading:true, error:'' });
  drawHistory();
  settingsOverlay.classList.add('open');
  try { ver.list = await cloud.api.versions(cloud.space, id); }
  catch(e){ ver.error = netErr(e) ? 'Нет связи с облаком. Историю можно посмотреть, когда появится сеть' : (cloudExplain(e) || 'Не получилось открыть историю'); }
  ver.loading = false;
  if (ver.id === id && historyOpen()) drawHistory();
}
/* «Сегодня, 15:20», «Вчера, 15:20», «12 ноября, 15:20» */
function verWhen(ms){
  const d = fmtAgo(ms), day = d === 'только что' || d === 'сегодня' ? 'Сегодня' : d === 'вчера' ? 'Вчера' : d;
  return day + ', ' + fmtTime(ms);
}
function verSlides(v){ const n = (v.blocks || []).filter(b => b && b.type !== 'note' && b.type !== 'splash').length; return n + ' ' + plural(n, 'слайд', 'слайда', 'слайдов'); }
/* Содержимое копии совпадает с тем, что сейчас на экране */
const verStrip = b => { const c = Object.assign({}, b); delete c.todo; delete c.done; return c; };
const verSame = v => canon({ meta:v.meta, settings:v.settings, blocks:(v.blocks || []).map(verStrip) }) === canon({ meta:state.meta, settings:state.settings, blocks:state.blocks.map(verStrip) });

function drawHistory(){
  if (!state || ver.id !== state.id) return;
  const list = ver.list || [];
  settingsOverlay.innerHTML = '';
  let body;
  if (ver.loading) body = h('p', { class:'hint ver-empty', text:'Открываю историю…' });
  else if (ver.error) body = h('p', { class:'hint ver-empty', text:ver.error });
  else if (!list.length) body = h('p', { class:'hint ver-empty', text:'Копий пока нет. Форма откладывает копию, когда вы нажимаете «Готово» или Ctrl+S, а во время долгой правки — раз в 10 минут. Хранятся последние ' + VER_KEEP + '.' });
  else {
    const i = Math.min(ver.pick, list.length - 1), v = list[i];
    body = h('div', { class:'ver-body' },
      h('div', { class:'ver-list', role:'listbox', 'aria-label':'Сохранённые версии' }, list.map((x, k) =>
        h('button', { type:'button', role:'option', class:'ver-row' + (k === i ? ' on' : ''), 'aria-selected':String(k === i), onclick:() => { ver.pick = k; drawHistory(); } },
          h('span', { class:'ver-when', text:verWhen(x.savedAt) }),
          h('span', { class:'ver-who', text:[x.name || x.savedBy, verSlides(x)].filter(Boolean).join(' · ') })))),
      h('div', { class:'ver-view' }, verPreview(v)));
  }
  const v = !ver.loading && !ver.error && list.length ? list[Math.min(ver.pick, list.length - 1)] : null;
  const same = v && verSame(v), live = editing();
  const back = v && h('button', { type:'button', class:'btn primary', disabled:!live || same,
    title:same ? 'Сейчас конспект точно такой же' : live ? 'Конспект станет таким, как в этой копии. Передумаете — ↶ или Ctrl+Z' : 'Сначала нажмите «Редактировать»',
    onclick:() => restoreVersion(v) }, ic('undo'), 'Вернуть эту версию');
  settingsOverlay.append(h('div', { class:'sheet ver-sheet', role:'dialog', 'aria-label':'История' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'История' }), iconBtn('close', 'Закрыть', closeSettings)),
    body,
    v && h('div', { class:'sheet-foot' },
      h('span', { class:'hint ver-note', text:same ? 'Сейчас конспект точно такой же' : live ? 'Передумаете — ↶ или Ctrl+Z' : 'Вернуть версию можно в правке: сначала нажмите «Редактировать»' }),
      back)));
}

/* Копия текстом: название, дата и автор, слайды по порядку и «Текст к слайду» */
function verPreview(v){
  const s = normalize({ id:state.id, v:v.v, meta:v.meta, settings:v.settings, blocks:v.blocks });
  const m = s.meta, out = h('div', { class:'ver-doc' },
    h('div', { class:'ver-title' + (m.title ? '' : ' empty'), text:m.title || 'Без названия' }),
    h('div', { class:'ver-meta', text:[fmtDay(m.date), preacherName(m)].filter(Boolean).join(' · ') || ' ' }));
  let n = 0, sp = 0;
  s.blocks.forEach(b => {
    const T = TYPES[b.type]; if (!T) return;
    if (b.type === 'note'){ if ((b.text || '').trim()) out.append(h('div', { class:'ver-note-op' }, h('b', { text:'Оператору: ' }), b.text.trim())); return; }
    const k = b.type === 'splash' ? (sp || (sp = ++n)) : ++n;
    const card = h('div', { class:'ver-slide' }, h('div', { class:'ver-cap', text:k + ' · ' + T.label }));
    if (b.type === 'splash') card.append(h('div', { class:'vs-name', text:m.title || 'Без названия' }));
    else card.append(tvSlide(b, k));
    const sp2 = plain(b.speech || '').trim();
    if (sp2) card.append(h('div', { class:'ver-speech', text:sp2 }));
    out.append(card);
  });
  if (!s.blocks.length) out.append(h('p', { class:'hint', text:'В этой копии нет ни одного слайда' }));
  return out;
}

/* Вернуть копию: как обычная правка (в отмену и в облако с автосохранением). Отметки «доработать» — текущие */
function restoreVersion(v){
  if (!editing()){ roHint(); return; }
  const src = normalize({ id:state.id, v:v.v, meta:v.meta, settings:v.settings, blocks:v.blocks }), todo = {};
  state.blocks.forEach(b => { todo[b.id] = b.todo; });
  state.meta = src.meta; state.settings = src.settings;
  state.blocks = src.blocks.map(b => { if (TYPES[b.type] && TYPES[b.type].slide) b.todo = b.id in todo ? !!todo[b.id] : defaultTodo(b); return b; });
  applyFlags(state);
  if (!state.blocks.some(b => b.id === selId)) selId = state.blocks[0] ? state.blocks[0].id : null;
  change();
  closeSettings();
  renderAll();
  toast('Конспект как в версии «' + verWhen(v.savedAt) + '»', 'Отменить', () => undo());
}
