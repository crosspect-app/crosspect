'use strict';

/* ========= Экраны, шапка, окно «О проповеди» =========
   Адрес: пусто — главная; #s=<id> — проповедь в виде «Слайды»; #s=<id>&v=text — в виде «Текст». */
function navigate(hash){
  if ((location.hash || '') === hash || (!hash && !location.hash)) route();   // тот же адрес: события hashchange не будет
  else location.hash = hash;
}
const sermonHash = (id, v) => '#s=' + encodeURIComponent(id) + (v === 'text' ? '&v=text' : '');

function route(){
  const seq = ++routeSeq;
  const p = new URLSearchParams(location.hash.slice(1)), id = p.get('s');
  if (!id || !state || state.id !== id) hist.id = null;   // ушли с проповеди: история отмены начнётся заново
  if (screen === 'sermon' && state) persistDraft();   // уходим с проповеди: черновик сохраняем сразу, не ждём паузы
  if (ed.id && ed.id !== id) endCloud();   // ушли с облачной проповеди: сохранить и отпустить замок
  if (cloudGate()){ screen = 'home'; renderAll(); return; }   // сначала вход; адрес остаётся, после входа откроется эта же проповедь
  if (id){
    if (!state || state.id !== id || (cloudOn() && ed.id !== id)){
      const d = readDraft(id);
      if (cloudOn()){
        openCloudSermon(id, d, seq).then(r => {
          if (!r) return;
          if (r.missing){ screen = 'home'; renderAll(); navigate(''); toast(r.failed ? 'Нет связи с облаком, проповедь не открылась' : 'Эта проповедь не найдена'); return; }
          state = r.state; selId = null;
          beginCloud(r.remote, r.local, r.offline);   // просмотр или правка (замок)
          persistDraft();   // в просмотре ничего не пишет
          showSermon(p);
          if (r.note) toast(r.note);
        });
        return;
      }
      if (!d){ screen = 'home'; renderAll(); navigate(''); toast('Эта проповедь не найдена в браузере. Откройте её файл'); return; }
      state = normalize(d);
    }
    showSermon(p);
  } else { screen = 'home'; renderAll(); window.scrollTo(0, 0); }
}
function showSermon(p){
  screen = 'sermon'; view = p.get('v') === 'text' ? 'text' : 'slides';
  if (hist.id !== state.id) histReset();   // «Слайды» ↔ «Текст» историю не сбрасывают
  LS.set('swp-sermon:last', state.id);
  renderAll();
  window.scrollTo(0, 0);
  if (editing() && isDirty()) scheduleSave(1000);
}
window.addEventListener('hashchange', route);

function renderAll(){ renderTopbar(); renderMain(); }
function renderMain(){
  closeTrPanel();
  mainEl.innerHTML = '';
  document.body.classList.toggle('light', screen === 'sermon' && view === 'text');   // «Текст» — светлый, остальное тёмное
  document.body.dataset.screen = screen;
  document.body.classList.toggle('ro', readOnly());
  if (screen === 'home' && cloudGate()){ document.title = 'Вход · Crosspect'; renderGate(); }
  else if (screen === 'home'){ document.title = 'Проповеди · Слово веры'; renderHome(); }
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
  if (screen === 'home' && cloudGate()){
    topbar.className = 'topbar is-home';
    topbar.append(h('a', { class:'logo', href:'#', title:'Crosspect' }, 'Crosspect'), h('div', { class:'grow' }), more);
    return;
  }
  if (screen === 'home'){
    topbar.className = 'topbar is-home';
    const q = h('input', { type:'search', placeholder:'Название, автор, место Писания', 'aria-label':'Поиск', value:homeQuery,
      oninput:e => { homeQuery = e.target.value; renderHomeList(); } });
    topbar.append(
      h('a', { class:'logo', href:'#', title:'Проповеди' }, 'Crosspect'),
      h('span', { class:'org', text:cloudOn() && cloud.spaceName ? cloud.spaceName : 'Слово веры · Познань' }),
      h('div', { class:'grow' }),
      h('label', { class:'search' }, ic('search'), q),
      cloudOn() ? h('span', { class:'who hide-sm', title:cloud.user.email, text:(cloud.user.name || cloud.user.email) + ' · ' + (ROLE_NAMES[cloud.role] || '') }) : null,
      more);
    return;
  }
  topbar.className = 'topbar';
  const m = state.meta, st = sermonStatus(state);
  topbar.append(
    h('a', { class:'btn ghost', href:'#', title:'К списку проповедей' }, ic('back'), 'Проповеди'),
    h('span', { class:'vsep' }),
    h('button', { type:'button', class:'hd-title', title:'Изменить название, дату, автора', onclick:() => openMeta() },
      h('span', { class:'hd-name' + (m.title ? '' : ' empty'), text:m.title || 'Без названия' }),
      h('span', { class:'hd-sub', text:[fmtDay(m.date), preacherName(m)].filter(Boolean).join(' · ') || 'Дата и автор не указаны' })),
    cloudSermon() ? statusSwitch() : h('span', { class:'stchip st-' + st.key, text:st.label }),   // переключатель статуса (editor.js)
    h('div', { class:'grow' }),
    h('div', { class:'seg', role:'group', 'aria-label':'Вид проповеди' },
      h('button', { type:'button', class:view === 'slides' ? 'on' : '', onclick:() => setView('slides') }, 'Слайды'),
      h('button', { type:'button', class:view === 'text' ? 'on' : '', onclick:() => setView('text') }, 'Текст')),
    h('div', { class:'grow' }),
    histTools() || '',   // ↶ ↷ — пока проповедь правится (history.js)
    h('span', { id:'hd-save', class:'hd-save' }),
    headAction(),   // «Сохранить»; в облаке — «Редактировать» / «Сохранить» (закончить правку, lock.js)
    more);
  updateStatus();
}

/* Состояние сохранения в шапке и счётчики над лентой слайдов — обновляются на каждую правку */
function updateStatus(){
  if (!state || screen !== 'sermon') return;
  histButtons();
  const s = $('#hd-save');
  if (s){
    if (cloudSermon()){
      const [cls, text, click] = cloudStatusLine();
      s.className = 'hd-save ' + cls; s.textContent = text; s.onclick = click || null;
    }
    else if (isDirty()){ s.className = 'hd-save warn'; s.textContent = '● Не сохранено в файл'; }
    else if (state.savedAt){ s.className = 'hd-save ok'; s.textContent = '✓ Файл сохранён в ' + fmtTime(state.savedAt); }
    else { s.className = 'hd-save'; s.textContent = 'Черновик хранится в этом браузере'; }
  }
  const fc = $('#film-count');
  if (fc){
    const n = slideNums()._total, todo = state.blocks.filter(todoOn).length;
    const words = state.blocks.reduce((t, b) => t + (b.speech ? wordCount(b.speech) : 0), 0), min = words / WORDS_PER_MIN;
    fc.innerHTML = '';
    fc.append(...[h('span', { text:n + ' ' + plural(n, 'слайд', 'слайда', 'слайдов') }),
      todo || filmOnlyTodo ? h('button', { type:'button', class:'film-todo' + (filmOnlyTodo ? ' on' : ''), 'aria-pressed':String(filmOnlyTodo),
        title:filmOnlyTodo ? 'Показать все слайды' : 'Показать только слайды с отметкой «доработать»', onclick:() => toggleOnlyTodo(),
        text:filmOnlyTodo ? 'только доработать · все' : todo + ' доработать' }) : null,
      words ? h('span', { class:'film-time', text:'текст ' + (min < 0.75 ? 'меньше минуты' : '≈ ' + Math.round(min) + ' мин') }) : null].filter(Boolean));   // append(null) вывел бы «null»
  }
}

/* ----- Окно «О проповеди»: название, дата, автор ----- */
let metaOpen = false;
function openMeta(){
  if (readOnly()){ roHint(); return; }
  const m = state.meta;
  const upd = () => { change(); refreshSplash(); document.title = (m.title || 'Проповедь') + ' · Слово веры'; };
  const title = h('input', { class:'input', placeholder:'Название проповеди', value:m.title, autocomplete:'off', 'aria-label':'Название проповеди',
    oninput:e => { m.title = e.target.value; upd(); } });
  const date = h('input', { class:'input', type:'date', value:m.date || '', 'aria-label':'Дата', oninput:e => { m.date = e.target.value; upd(); } });
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet', role:'dialog', 'aria-label':'О проповеди' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'О проповеди' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('div', { class:'set-grid', title:'Название, автор и дата попадают на заставку' },
      field('Название', title),
      h('div', { class:'grid-2' }, field('Дата', date), preacherField())),
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
