'use strict';

/* ========= Экраны, шапка, окно «О проповеди» =========
   Адрес: пусто — главная; #s=<id> — проповедь в виде «Слайды»; #s=<id>&v=text — в виде «Текст». */
function navigate(hash){
  if ((location.hash || '') === hash || (!hash && !location.hash)) route();   // тот же адрес: события hashchange не будет
  else location.hash = hash;
}
const sermonHash = (id, v) => '#s=' + encodeURIComponent(id) + (v === 'text' ? '&v=text' : '');

function route(){
  const p = new URLSearchParams(location.hash.slice(1)), id = p.get('s');
  if (screen === 'sermon' && state) persistDraft();   // уходим с проповеди: черновик сохраняем сразу, не ждём паузы
  if (id){
    if (!state || state.id !== id){
      const d = readDraft(id);
      if (!d){ screen = 'home'; renderAll(); navigate(''); toast('Эта проповедь не найдена в браузере. Откройте её файл'); return; }
      state = normalize(d);
    }
    screen = 'sermon'; view = p.get('v') === 'text' ? 'text' : 'slides';
    LS.set('swp-sermon:last', state.id);
  } else screen = 'home';
  renderAll();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

function renderAll(){ renderTopbar(); renderMain(); }
function renderMain(){
  closeTrPanel();
  mainEl.innerHTML = '';
  document.body.classList.toggle('light', screen === 'sermon' && view === 'text');   // «Текст» — светлый, остальное тёмное
  document.body.dataset.screen = screen;
  if (screen === 'home'){ document.title = 'Проповеди · Слово веры'; renderHome(); }
  else {
    document.title = (state.meta.title || 'Проповедь') + ' · Слово веры';
    if (view === 'text') renderTextView(); else renderSlides();
  }
  updateStatus();
}

function setView(v){
  if (v === 'text' && !checkNames()) return;
  navigate(sermonHash(state.id, v));
}

/* ----- Шапка ----- */
function renderTopbar(){
  fillMenu();
  topbar.innerHTML = '';
  const more = h('div', { class:'actions' },
    iconBtn('more', 'Ещё', e => { e.stopPropagation(); menuEl.classList.toggle('open'); }), menuEl);
  if (screen === 'home'){
    topbar.className = 'topbar is-home';
    const q = h('input', { type:'search', placeholder:'Название, проповедник, место Писания', 'aria-label':'Поиск', value:homeQuery,
      oninput:e => { homeQuery = e.target.value; renderHomeList(); } });
    topbar.append(
      h('a', { class:'logo', href:'#', title:'Проповеди' }, 'Crosspect'),
      h('span', { class:'org', text:'Слово веры · Познань' }),
      h('div', { class:'grow' }),
      h('label', { class:'search' }, ic('search'), q),
      more);
    return;
  }
  topbar.className = 'topbar';
  const m = state.meta, st = sermonStatus(state);
  topbar.append(
    h('a', { class:'btn ghost', href:'#', title:'К списку проповедей' }, ic('back'), 'Проповеди'),
    h('span', { class:'vsep' }),
    h('button', { type:'button', class:'hd-title', title:'Изменить название, дату, проповедника', onclick:() => openMeta() },
      h('span', { class:'hd-name' + (m.title ? '' : ' empty'), text:m.title || 'Без названия' }),
      h('span', { class:'hd-sub', text:[fmtDay(m.date), preacherName(m)].filter(Boolean).join(' · ') || 'Дата и проповедник не указаны' })),
    h('span', { class:'stchip st-' + st.key, text:st.label }),
    h('div', { class:'grow' }),
    h('div', { class:'seg', role:'group', 'aria-label':'Вид проповеди' },
      h('button', { type:'button', class:view === 'slides' ? 'on' : '', onclick:() => setView('slides') }, 'Слайды'),
      h('button', { type:'button', class:view === 'text' ? 'on' : '', onclick:() => setView('text') }, 'Текст')),
    h('div', { class:'grow' }),
    h('span', { id:'hd-save', class:'hd-save' }),
    h('button', { type:'button', class:'btn primary', onclick:() => saveFile(), title:'Ctrl+S' }, ic('save'), 'Сохранить'),
    more);
  updateStatus();
}

/* Состояние сохранения в шапке и счётчики над лентой слайдов — обновляются на каждую правку */
function updateStatus(){
  if (!state || screen !== 'sermon') return;
  const s = $('#hd-save');
  if (s){
    if (isDirty()){ s.className = 'hd-save warn'; s.textContent = '● Не сохранено в файл'; }
    else if (state.savedAt){ s.className = 'hd-save ok'; s.textContent = '✓ Файл сохранён в ' + fmtTime(state.savedAt); }
    else { s.className = 'hd-save'; s.textContent = 'Черновик хранится в этом браузере'; }
  }
  const fc = $('#film-count');
  if (fc){
    const n = slideNums()._total, todo = state.blocks.filter(b => b.todo).length, done = state.blocks.filter(b => b.done).length;
    const words = state.blocks.reduce((t, b) => t + (b.speech ? wordCount(b.speech) : 0), 0), min = words / WORDS_PER_MIN;
    fc.innerHTML = '';
    fc.append(h('span', { text:n + ' ' + plural(n, 'слайд', 'слайда', 'слайдов') + (done ? ' · готово ' + done : '') }),
      todo ? h('span', { class:'film-todo', text:todo + ' доработать' }) : null,
      words ? h('span', { class:'film-time', text:'текст ' + (min < 0.75 ? 'меньше минуты' : '≈ ' + Math.round(min) + ' мин') }) : null);
  }
}

/* ----- Окно «О проповеди»: название, дата, проповедник ----- */
let metaOpen = false;
function openMeta(){
  const m = state.meta;
  const upd = () => { change(); refreshSplash(); document.title = (m.title || 'Проповедь') + ' · Слово веры'; };
  const title = h('input', { class:'input', placeholder:'Название проповеди', value:m.title, autocomplete:'off', 'aria-label':'Название проповеди',
    oninput:e => { m.title = e.target.value; upd(); } });
  const date = h('input', { class:'input', type:'date', value:m.date || '', 'aria-label':'Дата', oninput:e => { m.date = e.target.value; upd(); } });
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet', role:'dialog', 'aria-label':'О проповеди' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'О проповеди' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('div', { class:'set-grid' },
      field('Название', title),
      h('div', { class:'grid-2' }, field('Дата', date), preacherField())),
    h('p', { class:'hint', style:'margin-bottom:16px', text:'Название, проповедник и дата попадают на заставку.' }),
    h('div', { class:'sheet-foot' }, h('span'), h('button', { type:'button', class:'btn primary', onclick:closeSettings }, 'Готово'))));
  metaOpen = true;
  settingsOverlay.classList.add('open');
  if (window.matchMedia('(pointer:fine)').matches) title.focus();
}
/* Окно закрыли: шапка и заставка показывают новые название, дату и проповедника */
function afterMeta(){
  renderTopbar();
  if (screen === 'sermon' && view === 'slides'){ const b = curBlock(); if (b && b.type === 'splash') renderSide(); }
  if (screen === 'sermon' && view === 'text') renderMain();
}
