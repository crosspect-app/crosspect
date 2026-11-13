'use strict';

/* ========= Главная: список проповедей =========
   Проповеди пространства из облака — по сводкам (cloud.list, строки без слайдов). Если в браузере есть несохранённые
   правки проповеди этого пространства (`swp-sermon:<id>`, в том числе новой, ещё не записанной), показывается она,
   с пометкой «Не сохранено в облако». Старые черновики без пространства (до облака) не показываются.
   Конспекты в корзине (этап 9.1, trash.js) в список не попадают; их несохранённые черновики ждут в браузере. */
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
    if (inTrash(r)) return;   // в корзине (этап 9.1): только в окне «Корзина»
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
  homeBg();   // фон — постоянный узел в body (motion.js)
  mainEl.append(h('div', { class:'home' },
    h('div', { class:'home-top' },
      h('h1', { text:'Конспекты' }),
      h('div', { class:'grow' }),
      h('span', { id:'home-trash' }),   // «Корзина · N» (этап 9.1): только когда в ней что-то есть
      h('button', { type:'button', class:'btn primary big', onclick:() => newSermon() }, ic('plus'), 'Новый конспект')),
    h('div', { id:'home-list' })));
  layoutWall();   // стена слайдов на фоне — разложить, когда она уже на странице (motion.js)
  renderHomeList();
}

/* ----- Список: одна таблица и фильтры (этап 7.7; сортировка по заголовкам убрана на этапе 7.8 — порядок всегда по дате) -----
   Колонки и фильтры описаны таблицами HOME_COLS и homeFilters: колонку «Серия» и фильтр по серии (этап 10) добавить
   одной записью в каждую. Выбор фильтров хранится в этом браузере (swp-home-view), без облака. */
const STATUS_ORDER = { draft:0, submitted:1, work:2 };   // «Черновик → Готов к вёрстке → У редактора»
const HOME_VIEW_DEFAULT = { f:{ date:'all', from:'', to:'', author:'', status:[] } };
let homeView = (() => {
  let v = null; try { v = JSON.parse(LS.get('swp-home-view') || 'null'); } catch(e){}
  const D = JSON.parse(JSON.stringify(HOME_VIEW_DEFAULT));
  if (!v || typeof v !== 'object') return D;
  const f = v.f || {};
  return { f:{ date:['all', 'up', 'past', 'range'].includes(f.date) ? f.date : 'all', from:/^\d{4}-\d{2}-\d{2}$/.test(f.from) ? f.from : '', to:/^\d{4}-\d{2}-\d{2}$/.test(f.to) ? f.to : '',
      author:typeof f.author === 'string' ? f.author : '', status:Array.isArray(f.status) ? f.status.filter(k => STATUS_KEYS.includes(k)) : [] } };
})();
let homeFiltersOpen = false;   // узкий экран: фильтры под кнопкой «Фильтры»
function saveHomeView(){ LS.set('swp-home-view', JSON.stringify(homeView)); }
const authorKey = d => preacherKey(d.meta) || '';
const filtersOn = () => { const f = homeView.f; return f.date !== 'all' || !!f.author || f.status.length > 0; };

/* Дата в таблице: «Вс, 15 ноября», в другом году — с годом */
function rowDate(s){
  const t = fmtDay(s); if (!t) return '';
  return s.slice(0, 4) === String(new Date().getFullYear()) ? t : t + ' ' + s.slice(0, 4);
}
/* Колонки: cell — содержимое ячейки */
const HOME_COLS = [
  { key:'date', label:'Дата', cls:'c-date', cell:d => h('span', { class:'muted', text:rowDate(d.meta.date) || 'Без даты' }) },
  { key:'title', label:'Название', cls:'c-title', cell:d => h('span', { class:'pt' },
    h('span', { class:'scard-title' + (d.meta.title ? '' : ' empty'), text:d.meta.title || 'Без названия' }), cloudMark(d), lockMark(d)) },
  { key:'author', label:'Автор', cls:'c-author', cell:d => h('span', { class:'muted2', text:preacherName(d.meta) || '—' }) },
  { key:'slides', label:'Слайдов', cls:'c-slides', title:'Сколько слайдов, без заставок', cell:d => { const n = slideCount(d); return h('span', null, h('span', { class:'c-n', text:String(n) }), h('span', { class:'c-lbl', text:' ' + plural(n, 'слайд', 'слайда', 'слайдов') })); } },
  { key:'status', label:'Статус', cls:'c-status', cell:d => { const st = sermonStatus(d); return h('span', null, h('span', { class:'stchip st-' + st.key, text:st.label })); } }
];
/* Порядок всегда по дате: проповеди без даты — сверху (обычно это свежие черновики), дальше от новых к старым */
function homeOrder(a, b){
  const x = a.meta.date || '', y = b.meta.date || '';
  if (!x !== !y) return x ? 1 : -1;
  return (x < y ? 1 : x > y ? -1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0);
}
function homeFilter(d, today){
  const f = homeView.f, dt = d.meta.date || '';
  if (f.date === 'up' && !(dt && dt >= today)) return false;
  if (f.date === 'past' && !(dt && dt < today)) return false;
  if (f.date === 'range' && ((f.from && !(dt && dt >= f.from)) || (f.to && !(dt && dt <= f.to)))) return false;
  if (f.author && authorKey(d) !== f.author) return false;
  if (f.status.length && !f.status.includes(statusKey(d.cloudStatus))) return false;
  return true;
}

function renderHomeList(){
  const box = $('#home-list'); if (!box || !cloudOn()) return;
  const tb = $('#home-trash'); if (tb){ tb.innerHTML = ''; const b = trashButton(); if (b) tb.append(b); }
  box.innerHTML = '';
  if (cloud.listError) box.append(h('p', { class:'hint home-warn', text:cloud.listError }));
  // ждём список из облака — серые заготовки строк; пришёл — таблица проявляется (этап 7.6). Пустой список — обычный пустой экран
  const waiting = !cloud.list && !cloud.listError;
  box.classList.remove('reveal');
  if (!waiting && MOTION.skel){ void box.offsetWidth; box.classList.add('reveal'); }
  MOTION.skel = waiting;
  if (waiting){ box.append(skeletonCards()); return; }
  const all = cloudItems(), q = homeQuery.trim().toLowerCase().replace(/ё/g, 'е');
  if (!all.length){
    box.append(h('div', { class:'empty' },
      h('div', { class:'empty-title', text:'Пока нет ни одного конспекта' }),
      h('p', { class:'hint', text:'Нажмите «Новый конспект», чтобы начать первый.' }),
      h('div', { class:'chips' },
        h('button', { type:'button', class:'btn primary', onclick:() => newSermon() }, ic('plus'), 'Новый конспект'))));
    return;
  }
  const today = isoToday();
  const list = all.filter(d => (!q || haystack(d).includes(q)) && homeFilter(d, today)).sort(homeOrder);
  box.append(homeFilters(all));
  if (!list.length){
    const why = q && filtersOn() ? 'По запросу «' + homeQuery.trim() + '» с выбранными фильтрами ничего не нашлось.'
      : q ? 'По запросу «' + homeQuery.trim() + '» ничего не нашлось.' : 'С такими фильтрами ничего не нашлось.';
    box.append(h('div', { class:'empty home-none' },
      h('p', { class:'hint', text:why + (filtersOn() ? ' Попробуйте сбросить фильтры.' : ' Проверьте, как написано, или поищите по автору и месту Писания.') }),
      filtersOn() ? h('div', { class:'chips' }, h('button', { type:'button', class:'btn', onclick:() => resetHomeFilters() }, 'Сбросить фильтры')) : null));
  } else {
    box.append(h('div', { class:'ptable', role:'table', 'aria-label':'Конспекты' },
      h('div', { class:'srow shead', role:'row' }, HOME_COLS.map(c => homeHead(c)), h('span', { role:'columnheader', 'aria-label':'Действия' })),
      list.map(sermonRow)));
  }
}
function homeHead(c){ return h('span', { class:c.cls, role:'columnheader', title:c.title || null, text:c.label }); }
/* Фильтры над таблицей: дата, автор, статус; «Сбросить», когда что-то выбрано. Работают вместе с поиском в шапке */
function homeFilters(all){
  const f = homeView.f;
  const set = (k, v) => { f[k] = v; saveHomeView(); renderHomeList(); };
  const authors = new Map();
  all.forEach(d => { const k = authorKey(d); if (k && !authors.has(k)) authors.set(k, preacherName(d.meta)); });
  if (f.author && !authors.has(f.author)) authors.set(f.author, f.author);
  const sel = (label, value, opts, onchange, extra) => h('label', Object.assign({ class:'hf-sel' + (value && value !== 'all' ? ' on' : '') }, extra || {}),
    h('select', { 'aria-label':label, onchange:e => onchange(e.target.value) }, opts.map(([v, t]) => h('option', { value:v, text:t, selected:v === value }))), ic('down'));
  const dateSel = sel('Дата', f.date, [['all', 'Все даты'], ['up', 'Предстоящие'], ['past', 'Прошлые'], ['range', 'Период…']], v => set('date', v),
    { title:'Предстоящие — сегодня и позже, прошлые — раньше сегодняшнего дня' });
  const range = f.date === 'range' ? h('div', { class:'hf-range' },
    h('span', { text:'с' }), h('input', { type:'date', class:'input', value:f.from, 'aria-label':'С даты', onchange:e => set('from', e.target.value) }),
    h('span', { text:'по' }), h('input', { type:'date', class:'input', value:f.to, 'aria-label':'По дату', onchange:e => set('to', e.target.value) })) : null;
  const authorSel = sel('Автор', f.author, [['', 'Все авторы']].concat([...authors].sort((a, b) => a[0].localeCompare(b[0], 'ru')).map(([k, n]) => [k, n])), v => set('author', v));
  const stat = h('div', { class:'hf-status', role:'group', 'aria-label':'Статус' }, STATUS_KEYS.map(k => {
    const on = f.status.includes(k);
    return h('button', { type:'button', class:'hf-chip st-' + k + (on ? ' on' : ''), 'aria-pressed':String(on), title:on ? 'Убрать из фильтра' : 'Показать конспекты с этим статусом (можно выбрать несколько)',
      onclick:() => set('status', on ? f.status.filter(x => x !== k) : STATUS_KEYS.filter(x => x === k || f.status.includes(x))) }, STATUS_LABELS[k]);
  }));
  const reset = filtersOn() ? h('button', { type:'button', class:'btn ghost small hf-reset', onclick:() => resetHomeFilters() }, ic('close'), 'Сбросить') : null;
  const n = (f.date !== 'all' ? 1 : 0) + (f.author ? 1 : 0) + (f.status.length ? 1 : 0);
  const toggle = h('button', { type:'button', class:'btn small hf-toggle' + (homeFiltersOpen ? ' on' : ''), 'aria-expanded':String(homeFiltersOpen),
    onclick:() => { homeFiltersOpen = !homeFiltersOpen; renderHomeList(); } }, ic('filter'), n ? 'Фильтры · ' + n : 'Фильтры');
  return h('div', { class:'home-filters' + (homeFiltersOpen ? ' open' : '') }, toggle,
    h('div', { class:'hf-body' }, dateSel, range, authorSel, stat, reset));
}
function resetHomeFilters(){ homeView.f = JSON.parse(JSON.stringify(HOME_VIEW_DEFAULT.f)); saveHomeView(); renderHomeList(); }

/* Число слайдов в списке и в проповеди — без заставок (этап 7.7). Заметки оператору — не слайды. Картинки, видео и свободные
   слайды, в том числе «пришлю отдельно», считаются: на экране они будут */
const slideCount = d => (d.blocks ? d.blocks.filter(b => TYPES[b.type].slide && b.type !== 'splash').length : d.slides || 0);

/* Пометка у строки: правки из этого браузера ещё не в облаке */
function cloudMark(d){
  return isUnsaved(d) ? h('span', { class:'cloud-mark', text:'Не сохранено в облако' }) : null;
}
function removeBtn(d, cls){
  const remote = cloud.list && cloud.list.has(d.id);
  return iconBtn('trash', remote ? 'Удалить (в корзину)' : 'Удалить черновик', e => { e.stopPropagation(); remote ? trashCloudSermon(d) : deleteDraft(d); }, 'danger ' + cls);
}
/* Строка таблицы; на узком экране — компактная карточка (CSS) */
function sermonRow(d){
  const st = sermonStatus(d);
  return h('div', { class:'card-wrap', role:'row' },
    h('a', { class:'scard srow st-' + st.key, href:sermonHash(d.id) }, HOME_COLS.map(c => { const el = c.cell(d); el.classList.add(c.cls); el.setAttribute('role', 'cell'); return el; })),
    removeBtn(d, 'card-del'));
}

/* Черновик, которого в облаке нет (новая проповедь, не успевшая сохраниться): лежит только в этом браузере */
function deleteDraft(d){
  const t = d.meta.title ? '«' + d.meta.title + '»' : 'этот конспект';
  if (!confirm('Удалить черновик ' + t + '? В облаке его нет, он пропадёт совсем.')) return;
  try { localStorage.removeItem('swp-sermon:' + d.id); if (LS.get('swp-sermon:last') === d.id) localStorage.removeItem('swp-sermon:last'); } catch(e){}
  if (ed.id === d.id) resetCloud();
  if (state && state.id === d.id) state = blank();
  renderHomeList();
  toast('Черновик удалён');
}
