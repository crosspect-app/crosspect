'use strict';

/* ========= Главная: список проповедей =========
   Проповеди пространства из облака — по сводкам (cloud.list, строки без слайдов). Если в браузере есть несохранённые
   правки проповеди этого пространства (`swp-sermon:<id>`, в том числе новой, ещё не записанной), показывается она,
   с пометкой «Не сохранено в облако». Старые черновики без пространства (до облака) не показываются. */
let homeQuery = '';

/* Черновики из браузера. Пустые (ни слайдов, ни названия) — это брошенные «Новые проповеди»: убираем */
function draftList(){
  const out = [];
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    keys.forEach(k => {
      if (!k || k.indexOf('swp-sermon:') !== 0 || k === 'swp-sermon:last') return;
      let d = null;
      try { d = JSON.parse(localStorage.getItem(k)); } catch(e){}
      if (!d || !Array.isArray(d.blocks)) return;
      d = normalize(d);
      if (!d.blocks.length && !String(d.meta.title || '').trim()){
        if (!state || state.id !== d.id) { try { localStorage.removeItem(k); } catch(e){} }
        return;
      }
      out.push(d);
    });
  } catch(e){}
  return out;
}
/* Строка списка (сводка из облака) → то, что рисуют карточка и строка таблицы: как проповедь, но без слайдов */
function rowItem(r){
  return { id:r.id, meta:r.meta, blocks:null, slides:r.slides || 0, refs:r.refs || '', updatedAt:r.updatedAt, savedAt:r.updatedAt,
    cloudSpace:r.cloudSpace, cloudAt:r.cloudAt, cloudOwner:r.cloudOwner, cloudStatus:r.cloudStatus, cloudBy:r.cloudBy };
}
/* Что показать на главной: проповеди из облака; если в браузере есть несохранённые правки — их версию (и новые, ещё не записанные) */
function cloudItems(){
  const loc = new Map(draftList().filter(d => d.cloudSpace === cloud.space).map(d => [d.id, d]));
  const items = [];
  if (cloud.list) cloud.list.forEach((r, id) => {
    const l = loc.get(id);
    items.push(l && isUnsaved(l) ? l : rowItem(r));
  });
  loc.forEach((d, id) => { if (cloud.list && !cloud.list.has(id) && isUnsaved(d)) items.push(d); });
  // чистые копии облачных проповедей в браузере больше не нужны: откроются из облака
  loc.forEach((d, id) => {
    if (cloud.list && cloud.list.has(id) && !isUnsaved(d) && (!state || state.id !== id)){
      try { localStorage.removeItem('swp-sermon:' + id); } catch(e){}
    }
  });
  return items;
}
const isoToday = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
function haystack(d){
  const refs = d.blocks ? d.blocks.filter(b => b.type === 'scripture').map(b => b.items.map(it => it.ref || '').join(' ')).join(' ') : d.refs || '';
  return [d.meta.title, preacherName(d.meta), preacherKey(d.meta), refs].join(' ').toLowerCase().replace(/ё/g, 'е');
}
/* «только что», «сегодня», «вчера», «5 ноября» */
function fmtAgo(ts){
  if (!ts) return '';
  const d = new Date(ts), now = new Date(), day = 86400000;
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (now - d < 3600000) return 'только что';
  if (a === b) return 'сегодня';
  if (b - a === day) return 'вчера';
  return d.toLocaleDateString('ru-RU', { day:'numeric', month:'long' });
}

function renderHome(){
  mainEl.append(homeBg(), h('div', { class:'home' },
    h('div', { class:'home-top' },
      h('h1', { text:'Проповеди' }),
      h('div', { class:'grow' }),
      h('button', { type:'button', class:'btn primary big', onclick:() => newSermon() }, ic('plus'), 'Новая проповедь')),
    h('div', { id:'home-list' })));
  renderHomeList();
}

function renderHomeList(){
  const box = $('#home-list'); if (!box || !cloudOn()) return;
  box.innerHTML = '';
  if (cloud.listError) box.append(h('p', { class:'hint home-warn', text:cloud.listError }));
  // ждём список из облака — серые заготовки карточек; пришёл — карточки проявляются (этап 7.6). Пустой список — обычный пустой экран
  const waiting = !cloud.list && !cloud.listError;
  box.classList.remove('reveal');
  if (!waiting && MOTION.skel){ void box.offsetWidth; box.classList.add('reveal'); }
  MOTION.skel = waiting;
  if (waiting){ box.append(skeletonCards()); return; }
  const all = cloudItems(), q = homeQuery.trim().toLowerCase().replace(/ё/g, 'е');
  if (!all.length){
    box.append(h('div', { class:'empty' },
      h('div', { class:'empty-title', text:'Пока нет ни одной проповеди' }),
      h('p', { class:'hint', text:'Нажмите «Новая проповедь», чтобы начать первый конспект.' }),
      h('div', { class:'chips' },
        h('button', { type:'button', class:'btn primary', onclick:() => newSermon() }, ic('plus'), 'Новая проповедь'))));
    return;
  }
  const list = all.filter(d => !q || haystack(d).includes(q)), today = isoToday();
  const up = list.filter(d => !d.meta.date || d.meta.date >= today).sort((a, b) => String(a.meta.date || '9').localeCompare(String(b.meta.date || '9')));
  const past = list.filter(d => d.meta.date && d.meta.date < today).sort((a, b) => b.meta.date.localeCompare(a.meta.date));
  if (!list.length && all.length) box.append(h('p', { class:'hint', style:'padding:8px 2px', text:'По запросу «' + homeQuery.trim() + '» ничего не нашлось.' }));
  if (up.length) box.append(h('section', { class:'home-sec' },
    h('div', { class:'cap', text:'Ближайшие' }),
    h('div', { class:'cards' }, up.map(sermonCard))));
  if (past.length) box.append(h('section', { class:'home-sec' },
    h('div', { class:'cap-row' }, h('div', { class:'cap', text:'Прошедшие' }), h('span')),
    h('div', { class:'ptable' },
      h('div', { class:'prow phead' }, h('span', { text:'Дата' }), h('span', { text:'Название' }), h('span', { text:'Автор' }), h('span', { text:'Слайдов' }), h('span', { text:'Статус' }), h('span')),
      past.map(sermonRow))));
  box.append(h('p', { class:'hint home-note', text:'Проповеди хранятся в облаке и видны на любом устройстве после входа. Чтобы править проповедь, откройте её и нажмите «Редактировать»: пока вы правите, другие её только смотрят, а правки уходят в облако сами.' }));
}

const slideCount = d => (d.blocks ? d.blocks.filter(b => TYPES[b.type].slide).length : d.slides || 0);

/* Пометка у карточки: правки из этого браузера ещё не в облаке */
function cloudMark(d){
  return isUnsaved(d) ? h('span', { class:'cloud-mark', text:'Не сохранено в облако' }) : null;
}
function removeBtn(d, cls){
  const remote = cloud.list && cloud.list.has(d.id);
  return iconBtn('trash', remote ? 'Удалить из облака' : 'Удалить черновик', e => { e.stopPropagation(); remote ? deleteCloudSermon(d).then(() => renderHomeList()) : deleteDraft(d); }, 'danger ' + cls);
}
function sermonCard(d){
  const m = d.meta, st = sermonStatus(d), n = slideCount(d);
  return h('div', { class:'card-wrap' },
    h('a', { class:'scard st-' + st.key, href:sermonHash(d.id) },
      h('div', { class:'mini' }, h('div', { class:'mini-fr' }, h('div', { class:'mini-pn' },
        h('span', { class:'mini-t', text:m.title || 'Без названия' })))),
      h('div', { class:'scard-body' },
        h('div', { class:'scard-top' }, h('span', { text:fmtDay(m.date) || 'Дата не указана' }), h('span', { class:'stchip st-' + st.key, text:st.label })),
        h('div', { class:'scard-title' + (m.title ? '' : ' empty'), text:m.title || 'Без названия' }),
        h('div', { class:'scard-by', text:preacherName(m) || 'Автор не указан' }),
        cloudMark(d), lockMark(d),
        h('div', { class:'scard-foot' },
          h('span', { text:n ? n + ' ' + plural(n, 'слайд', 'слайда', 'слайдов') : 'Слайдов пока нет' }),
          h('span', { text:'изменено ' + fmtAgo(d.updatedAt) })))),
    removeBtn(d, 'card-del'));
}
function sermonRow(d){
  const m = d.meta, st = sermonStatus(d);
  return h('div', { class:'card-wrap' },
    h('a', { class:'prow', href:sermonHash(d.id) },
      h('span', { class:'muted', text:fmtDay(m.date) }),
      h('span', { class:'pt' }, m.title || 'Без названия', cloudMark(d), lockMark(d)),
      h('span', { class:'muted2', text:preacherName(m) }),
      h('span', { text:String(slideCount(d)) }),
      h('span', null, h('span', { class:'stchip st-' + st.key, text:st.label })),
      h('span')),
    removeBtn(d, 'row-del'));
}

/* Черновик, которого в облаке нет (новая проповедь, не успевшая сохраниться): лежит только в этом браузере */
function deleteDraft(d){
  const t = d.meta.title ? '«' + d.meta.title + '»' : 'эту проповедь';
  if (!confirm('Удалить черновик ' + t + '? В облаке его нет, он пропадёт совсем.')) return;
  try { localStorage.removeItem('swp-sermon:' + d.id); if (LS.get('swp-sermon:last') === d.id) localStorage.removeItem('swp-sermon:last'); } catch(e){}
  if (ed.id === d.id) resetCloud();
  if (state && state.id === d.id) state = blank();
  renderHomeList();
  toast('Черновик удалён');
}
