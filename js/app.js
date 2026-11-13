'use strict';

/* ========= Экраны, шапка, окно «О проповеди» =========
   Адрес: пусто — главная; #s=<id>&sp=<пространство> — проповедь в виде «Слайды»; …&v=text — в виде «Текст»; #op=<ключ> — страница оператора (этап 9).
   sp (этап 8) — в каком пространстве проповедь: ссылка открывает её, даже если человек сейчас в другом.
   Ссылка без sp (до этапа 8) открывает проповедь в текущем пространстве. */
function navigate(hash){
  if ((location.hash || '') === hash || (!hash && !location.hash)) route();   // тот же адрес: события hashchange не будет
  else location.hash = hash;
}
const sermonHash = (id, v) => '#s=' + encodeURIComponent(id) + (cloud.space ? '&sp=' + encodeURIComponent(cloud.space) : '') + (v === 'text' ? '&v=text' : '');

function route(){
  const seq = ++routeSeq;
  const p = new URLSearchParams(location.hash.slice(1)), id = p.get('s'), help = p.has('help');
  // инструкция открывается поверх работы: правка, замок и история отмены остаются, «Назад» возвращает в тот же конспект
  if (!help && (!id || !state || state.id !== id)) hist.id = null;   // ушли с проповеди: история отмены начнётся заново
  if (screen === 'sermon' && state) persistDraft();   // уходим с проповеди: черновик сохраняем сразу, не ждём паузы
  if (!help && ed.id && ed.id !== id) endCloud();   // ушли с облачной проповеди: сохранить и отпустить замок
  if (p.has('op')){ openOperator(p.get('op')); return; }   // страница оператора (этап 9, operator.js): открывается без входа
  if (screen === 'op') closeOperator();   // ушли со страницы оператора: дальше обычная форма
  if (cloudGate()){ screen = 'home'; renderAll(); return; }   // сначала вход; адрес остаётся, после входа откроется эта же проповедь
  const sp = p.get('sp');
  if (sp && sp !== cloud.space && !switchSpace(sp, true)){   // ссылка из другого пространства: переключаемся (cloud.js)
    screen = 'home'; renderAll(); navigate(''); toast('Эта ссылка — из пространства, куда у вас нет доступа'); return;
  }
  if (help){   // «Как пользоваться» (этап 7.8): своя страница, «Назад» возвращает туда, откуда пришли
    screen = 'help'; renderAll(); window.scrollTo(0, 0); return;
  }
  if (id){
    if (!state || state.id !== id || ed.id !== id){
      let d = readDraft(id);
      if (d && d.cloudSpace && d.cloudSpace !== cloud.space) d = null;   // черновик того же номера из другого пространства — не наш
      // данных нет дольше ~300 мс — заготовка экрана «Слайды» (серые миниатюры), а не пустые рамки (этап 7.7)
      const skel = setTimeout(() => { if (seq === routeSeq) showSkeleton(); }, 300);
      Promise.all([openCloudSermon(id, d, seq), slideAssetsReady()]).then(([r]) => {
        clearTimeout(skel);
        if (!r || seq !== routeSeq) return;
        if (r.missing){
          screen = 'home'; renderAll(); navigate('');
          if (r.trashed) toast('Этот конспект в корзине', canTrash(cloud.list && cloud.list.get(id) || {}) ? 'Корзина' : null, () => openTrash());
          else toast(r.failed ? 'Нет связи с облаком, конспект не открылся' : 'Этот конспект не найден');
          return;
        }
        state = r.state; selId = null;
        beginCloud(r.remote, r.local, r.offline);   // просмотр или правка (замок)
        persistDraft();   // в просмотре ничего не пишет
        bgReady().then(() => {   // картинка фона расшифрована — миниатюры появятся сразу с фоном
          if (seq !== routeSeq || !state || state.id !== id) return;
          showSermon(p);
          if (r.note) toast(r.note);
        });
      });
      return;
    }
    showSermon(p);
  } else {
    const from = screen === 'sermon' ? leaveSermon() : null;   // (со страницы инструкции — без анимации)   // «← Проповеди»: экран проповеди уезжает вправо (этап 7.7)
    if (from) wallHold = true;   // стена слайдов появится, когда конспект уедет (этап 9.2): её показ занимает главный поток, и движение вставало
    screen = 'home'; renderAll(); window.scrollTo(0, 0);
    if (from) enterHome();
  }
}
function showSermon(p){
  const was = screen === 'sermon' && state && hist.id === state.id ? view : '';   // с какого вида пришли (пусто — открыли проповедь заново)
  const fromHome = screen !== 'sermon' || !!document.querySelector('#app > .sk-sv');   // открыли из списка (или вместо заготовки)
  screen = 'sermon'; view = p.get('v') === 'text' ? 'text' : 'slides';
  if (hist.id !== state.id) histReset();   // «Слайды» ↔ «Текст» историю не сбрасывают
  LS.set('swp-sermon:last', state.id);
  if (was && was !== view){   // переход «Слайды» ↔ «Текст» (этап 7.6): растворение, выбранная миниатюра «перетекает» в свой блок и обратно
    const sel = selId, toText = view === 'text';
    const thumb = () => document.querySelector(toText ? '.film .st[data-id="' + sel + '"] .st-thumb' : '.tv-thumb[data-id="' + sel + '"]');
    const thumbNew = () => document.querySelector(toText ? '.tv-thumb[data-id="' + sel + '"]' : '.film .st[data-id="' + sel + '"] .st-thumb');
    // из «Текста» в «Слайды»: лента сразу прокручена к выбранному слайду, он ближе к середине (этап 7.7)
    viewTransition(() => { renderAll(); if (toText) tvReveal(sel); else { window.scrollTo(0, 0); filmReveal(sel, { center:true, instant:true }); } }, { from:thumb, to:thumbNew });
  } else {
    renderAll(); window.scrollTo(0, 0);
    if (fromHome) enterSermon();
  }
  if (editing() && isDirty()) scheduleSave(1000);
}
window.addEventListener('hashchange', route);

/* ----- Переходы между списком и проповедью (этап 7.7) ----- */
/* Шрифты слайда — до первого показа миниатюр: иначе слайд раскладывается запасным шрифтом и тут же перекладывается.
   Ждём не дольше 1,2 с: без сети шрифтов может и не быть */
let slideFontsP = null;
function slideAssetsReady(){
  if (!slideFontsP){
    const f = document.fonts && document.fonts.load
      ? Promise.all(['325 50px Unbounded', '700 50px Unbounded', '900 50px Unbounded', '400 50px Inter'].map(x => document.fonts.load(x, 'АБВabc').catch(() => null)))
      : Promise.resolve();
    slideFontsP = Promise.race([f, new Promise(r => setTimeout(r, 1200))]).then(() => { FM = null; });
  }
  return slideFontsP;
}
/* Картинка фона открытой проповеди (генератор 7.3/7.5) — расшифрована до показа, чтобы миниатюры не мигнули без фона */
const bgDecoded = new Set();
function bgReady(){
  let u = '';
  try { const bg = curBg(); if (bg) u = (/^url\((.*)\)$/.exec(bgImage(bg)) || [])[1] || ''; } catch(e){}
  if (!u || bgDecoded.has(u)) return Promise.resolve();
  const img = new Image(); img.src = u;
  const p = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
  return Promise.race([p, new Promise(r => setTimeout(r, 400))]).then(() => { bgDecoded.add(u); });
}
/* Заготовка экрана проповеди, пока данные идут дольше ~300 мс: серые миниатюры и слайд с бегущим бликом */
function showSkeleton(){
  if (screen === 'sermon' || cloudGate() || mainEl.querySelector(':scope > .gate')) return;   // заставка входа остаётся вместо заготовки
  const was = mainEl.querySelector('.home');
  mainEl.innerHTML = '';
  svFor = null; filmEl = stageEl = sideEl = null;
  mainEl.append(h('div', { class:'sv sk-sv', role:'status', 'aria-label':'Открываю конспект…', 'aria-busy':'true' },
    h('div', { class:'film' }, [0, 1, 2, 3, 4].map(() => h('div', { class:'sk-thumb' }, h('div', { class:'sk-img' }), h('div', { class:'sk-line w1' })))),
    h('div', { class:'stage' }, h('div', { class:'sk-stage' }, h('div', { class:'sk-img' }))),
    h('div', { class:'side' }, h('div', { class:'sk-line w2' }), h('div', { class:'sk-line w3' }), h('div', { class:'sk-line w1' }))));
  if (was) motionAnimate(mainEl.firstElementChild, [{ opacity:0 }, { opacity:1 }], MOTION.ms('--motion', 200));
}
/* Экран проповеди въезжает справа (~250 мс): сдвиг и проявление. К этому моменту миниатюры уже разложены */
function enterSermon(){
  if (MOTION.off() || document.querySelector('.gate-ghost')) return;   // открыли по ссылке сразу после заставки: она сама расплывается
  const d = MOTION.ms('--motion-slow', 250);
  motionAnimate(mainEl, [{ opacity:0, transform:'translateX(56px)' }, { opacity:1, transform:'none' }], d);
  topbar.querySelectorAll(':scope > *').forEach(x => motionAnimate(x, [{ opacity:0 }, { opacity:1 }], d));
}
/* «← Проповеди»: прежний экран проповеди уезжает вправо и гаснет поверх списка (сам узел, не копия: он уже разложен) */
function leaveSermon(){
  if (MOTION.off() || view !== 'slides') return null;
  const sv = mainEl.querySelector(':scope > .sv'); if (!sv) return null;
  const r = sv.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const wrap = h('div', { class:'leave-ghost', 'aria-hidden':'true' });
  wrap.style.cssText = 'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + Math.min(r.height, innerHeight - r.top) + 'px';
  sv.inert = true;
  wrap.append(sv); document.body.append(wrap);
  const a = motionAnimate(wrap, [{ opacity:1, transform:'none' }, { opacity:0, transform:'translateX(56px)' }], MOTION.ms('--motion-slow', 250), { fill:'forwards', easing:'cubic-bezier(.4,0,1,1)' });
  if (a) a.addEventListener('finish', () => wrap.remove()); else wrap.remove();
  setTimeout(() => wrap.remove(), 900);
  filmEl = stageEl = sideEl = null; svFor = null;
  return wrap;
}
/* Список лежит под уезжающей проповедью сразу, непрозрачный: гаснет только она, поэтому «провала» яркости посередине нет (раньше гасли оба).
   Сам список чуть подъезжает слева, шапка проявляется */
let wallHold = false;   // пока true, фон главной (стена) не показывается
function wallRelease(){
  wallHold = false;
  if (screen !== 'home' || cloudGate()) return;
  document.body.classList.add('wall-on');
  motionAnimate(WALL.root, [{ opacity:0 }, { opacity:1 }], 500, { easing:'ease-out' });
}
function enterHome(){
  const d = MOTION.ms('--motion-slow', 250);
  setTimeout(wallRelease, d + 40);
  const home = mainEl.querySelector('.home');
  if (home) motionAnimate(home, [{ transform:'translateX(-28px)' }, { transform:'none' }], d, { easing:'cubic-bezier(0,0,.2,1)' });
  topbar.querySelectorAll(':scope > *').forEach(x => motionAnimate(x, [{ opacity:0 }, { opacity:1 }], d, { easing:'ease-out' }));
}

function renderAll(){ renderTopbar(); renderMain(); }
function renderMain(){
  closeTrPanel();
  document.body.classList.toggle('light', screen === 'sermon' && view === 'text');   // «Текст» — светлый, остальное тёмное
  document.body.dataset.screen = screen;
  document.body.classList.toggle('wall-on', screen === 'home' && !cloudGate() && !wallHold);   // стена слайдов на фоне — только за списком (этап 9.2)
  document.body.classList.toggle('ro', readOnly());
  // «Слайды» той же проповеди уже на экране — обновить точечно: лента, сцена и панель не пересобираются (этап 7.7)
  if (screen === 'sermon' && view === 'slides' && state && syncSlides()){
    document.title = (state.meta.title || 'Проповедь') + ' · Crosspect';
    updateStatus();
    return;
  }
  svFor = null;
  const gate = !(screen === 'home' && cloudGate()) ? gateDissolve() : null;   // уходим с экрана входа: он расплывается (этап 7.7)
  mainEl.innerHTML = '';
  if (screen === 'home' && cloudGate()){ document.title = 'Вход · Crosspect'; renderGate(); }
  else if (screen === 'home'){ document.title = 'Конспекты · ' + (cloud.spaceName || 'Crosspect'); renderHome(); }
  else if (screen === 'help'){ document.title = 'Как пользоваться · Crosspect'; renderHelp(); }
  else if (screen === 'op') renderOperator();   // страница оператора: свой заголовок страницы
  else {
    document.title = (state.meta.title || 'Проповедь') + ' · Crosspect';
    if (view === 'text') renderTextView(); else renderSlides();
  }
  updateStatus();
  if (gate) gateReveal();
}

function setView(v){
  navigate(sermonHash(state.id, v));
}

/* ----- Шапка ----- */
function renderTopbar(){
  if (screen === 'op'){ topbar.className = 'topbar is-op'; topbar.innerHTML = ''; MOTION.ui.id = ''; return; }   // у страницы оператора шапки нет (этап 9)
  fillMenu();
  motionBeforeTopbar();   // запомнить, где стоял статус, чтобы подложка переехала (motion.js)
  topbar.innerHTML = '';
  const more = h('div', { class:'actions' },
    iconBtn('more', 'Ещё', e => { e.stopPropagation(); menuEl.classList.toggle('open'); }), menuEl);
  if (screen === 'home') MOTION.ui.id = '';   // на главной и экране входа анимации шапки проповеди забываются
  if (screen === 'home' && cloudGate()){
    topbar.className = 'topbar is-home' + (cloudGate() === 'wait' ? ' is-splash' : '');   // заставка — без шапки (этап 7.8)
    topbar.append(logoLockup('logo', { href:'#', title:'Crosspect' }), h('div', { class:'grow' }), more);
    return;
  }
  if (screen === 'help'){
    topbar.className = 'topbar is-home';
    topbar.append(logoLockup('logo', { href:'#', title:'Конспекты' }), h('span', { class:'vsep' }),
      h('button', { type:'button', class:'btn ghost', onclick:() => closeHelp() }, ic('back'), 'Назад'), h('div', { class:'grow' }), more);
    return;
  }
  if (screen === 'home'){
    topbar.className = 'topbar is-home';
    logoReset();   // на главной знак всегда обычный: незаконченная анимация сохранения относилась к проповеди
    const q = h('input', { type:'search', placeholder:'Название, автор, место Писания', 'aria-label':'Поиск', value:homeQuery,
      oninput:e => { homeQuery = e.target.value; renderHomeList(); } });
    topbar.append(
      logoLockup('logo', { href:'#', title:'Конспекты' }),
      spacePicker(),
      h('div', { class:'grow' }),
      h('label', { class:'search' }, ic('search'), q),
      h('button', { type:'button', class:'btn ghost hd-help', title:'Как пользоваться Crosspect', onclick:() => openHelp() }, ic('help'), h('span', { class:'hide-sm', text:'Как пользоваться' })),
      cloudOn() ? h('span', { class:'who hide-sm', title:cloud.user.email, text:(cloud.user.name || cloud.user.email) + ' · ' + (ROLE_NAMES[cloud.role] || '') }) : null,
      more);
    return;
  }
  topbar.className = 'topbar';
  const m = state.meta, st = sermonStatus(state);
  topbar.append(
    h('a', { class:'logo logo-only', href:'#', title:'Crosspect: к списку конспектов', 'aria-label':'Crosspect: к списку конспектов' }, logoMark()),   // здесь знак мигает при сохранении (logo.js)
    h('a', { class:'btn ghost', href:'#', title:'К списку конспектов' }, ic('back'), 'Конспекты'),
    h('span', { class:'vsep' }),
    h('button', { type:'button', class:'hd-title', title:'Изменить название, дату, автора', onclick:() => openMeta() },
      h('span', { class:'hd-name' + (m.title ? '' : ' empty'), text:m.title || 'Без названия' }),
      h('span', { id:'hd-sub', class:'hd-sub', 'data-meta':[fmtDay(m.date), preacherName(m)].filter(Boolean).join(' · ') || 'Дата и автор не указаны' })),   // в правке — ход сохранения (updateStatus)
    cloudSermon() ? statusSwitch() : h('span', { class:'stchip st-' + st.key, text:st.label }),   // переключатель статуса (editor.js)
    h('div', { class:'grow' }),
    h('div', { class:'seg', role:'group', 'aria-label':'Вид конспекта' },
      h('button', { type:'button', class:view === 'slides' ? 'on' : '', onclick:() => setView('slides') }, 'Слайды'),
      h('button', { type:'button', class:view === 'text' ? 'on' : '', onclick:() => setView('text') }, 'Текст')),
    h('div', { class:'grow' }),
    histTools() || '',   // ↶ ↷ — пока проповедь правится (history.js)
    checkEl(),   // галочка автосохранения (motion.js)
    h('span', { id:'hd-save', class:'hd-save' }),
    headAction(),   // «Редактировать» / «Готово» (закончить правку, lock.js, этап 9.8)
    more);
  updateStatus();
  motionAfterTopbar();   // подложка статуса, замок, вспышка клина, галочка (motion.js)
}

/* Пространство в шапке главной: название, а у кого их несколько (и у админа) — выбор. Смена — сразу на главную нового */
function spacePicker(){
  if (!multiSpace()) return h('span', { class:'org', text:cloud.spaceName });
  const sel = h('select', { class:'org-pick', 'aria-label':'Пространство', title:'Пространство: конспекты, люди и настройки слайдов у каждого свои',
    onchange:e => switchSpace(e.target.value) },
    cloud.spaces.map(sp => h('option', { value:sp.id, text:sp.name || sp.id })));
  sel.value = cloud.space;
  return h('label', { class:'org org-sel' }, sel, ic('down'));
}

/* Состояние сохранения в шапке и счётчики над лентой слайдов — обновляются на каждую правку */
function updateStatus(){
  if (!state || screen !== 'sermon') return;
  histButtons();
  syncStatusSwitch();   // пустой конспект: дальше «Черновика» нельзя (editor.js, этап 7.8)
  const sub = $('#hd-sub');
  if (sub){ const e = editing(); sub.textContent = e ? editSub() : sub.dataset.meta; sub.classList.toggle('editing', e); }   // «Правка · сохранено в 15:20» (этап 9.8)
  const s = $('#hd-save');
  if (s){
    if (cloudSermon()){
      const [cls, text, click] = cloudStatusLine();
      s.className = 'hd-save ' + cls; s.textContent = text; s.title = text; s.onclick = click || null;
    }
    else { s.className = 'hd-save'; s.textContent = ''; s.title = ''; s.onclick = null; }
  }
  const fc = $('#film-count');
  if (fc){
    const n = slideCount(state), sp = state.blocks.filter(b => b.type === 'splash').length, todo = state.blocks.filter(todoOn).length;   // слайды без заставок — как в списке (этап 7.7)
    const words = state.blocks.reduce((t, b) => t + (b.speech ? wordCount(b.speech) : 0), 0), min = words / WORDS_PER_MIN;
    fc.innerHTML = '';
    fc.append(...[h('span', { text:n + ' ' + plural(n, 'слайд', 'слайда', 'слайдов') + (sp ? ' + ' + sp + ' ' + plural(sp, 'заставка', 'заставки', 'заставок') : ''), title:'Как в списке проповедей: заставки считаются отдельно' }),
      todo || filmOnlyTodo ? h('button', { type:'button', class:'film-todo' + (filmOnlyTodo ? ' on' : ''), 'aria-pressed':String(filmOnlyTodo),
        title:filmOnlyTodo ? 'Показать все слайды' : 'Показать только слайды с отметкой «доработать»', onclick:() => toggleOnlyTodo(),
        text:filmOnlyTodo ? 'только доработать · все' : todo + ' доработать' }) : null,
      words ? h('span', { class:'film-time', text:'текст ' + (min < 0.75 ? 'меньше минуты' : '≈ ' + Math.round(min) + ' мин') }) : null].filter(Boolean));   // append(null) вывел бы «null»
  }
}

/* ----- Окно «О проповеди»: название, дата, автор (раскладка и выбор даты — этап 7.8), серия и формат фона (этап 10) -----
   Одна колонка: название; дата — три ближайших воскресенья кнопками и «Другая дата…» (свой календарь); автор — список
   (preacherField в render.js), «Имя» и «Фамилия» под ним только при «Ввести вручную»; серия проповедей и (если в пространстве
   включено «Выбирать формат фона в проповеди») формат фона — space.js. Серия и формат меняют фон слайдов сразу */
let metaOpen = false;
function openMeta(){
  if (readOnly()){ roHint(); return; }
  const m = state.meta;
  const upd = () => { change(); refreshSplash(); document.title = (m.title || 'Проповедь') + ' · Crosspect'; };
  const title = h('input', { class:'input', placeholder:'Название проповеди', value:m.title, autocomplete:'off', 'aria-label':'Название проповеди',
    oninput:e => { m.title = e.target.value; upd(); } });
  const fmt = formatField(m, () => { upd(); refreshSlides(); });
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet meta-sheet', role:'dialog', 'aria-label':'О проповеди' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'О проповеди' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('div', { class:'set-grid', title:'Название, автор и дата попадают на заставку' },
      field('Название', title),
      dateField(m, upd),
      preacherField(),
      seriesField(m, () => { upd(); refreshSlides(); if (fmt && fmt._refresh) fmt._refresh(); }),
      fmt),
    h('div', { class:'sheet-foot' }, h('span'), h('button', { type:'button', class:'btn primary', onclick:closeSettings }, 'Готово'))));
  metaOpen = true;
  settingsOverlay.classList.add('open');
  if (window.matchMedia('(pointer:fine)').matches) title.focus();
}

/* ----- Дата: ближайшие воскресенья и календарь ----- */
const isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const dateOf = s => { const x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return x ? new Date(+x[1], +x[2] - 1, +x[3]) : null; };
function sundaysAhead(n){
  const d = dateOf(nextSunday()), out = [];
  for (let i = 0; i < n; i++){ out.push(isoOf(d)); d.setDate(d.getDate() + 7); }
  return out;
}
/* Даты других конспектов этого пространства — точкой в календаре, чтобы не завести второй на то же воскресенье */
function takenDates(){
  const out = new Set();
  if (cloud.list) cloud.list.forEach((r, id) => { if (r.meta && r.meta.date && (!state || id !== state.id)) out.add(r.meta.date); });
  return out;
}
function dateField(m, upd){
  const wrap = h('div', { class:'field date-field' });
  const draw = () => {
    wrap.innerHTML = '';
    const suns = sundaysAhead(3), cur = m.date || '';
    const chip = (iso, label, small) => h('button', { type:'button', class:'chip date-chip' + (iso === cur ? ' on' : ''), 'aria-pressed':String(iso === cur),
      onclick:() => { m.date = iso; upd(); draw(); } }, label, small ? h('small', { text:small }) : null);
    const row = h('div', { class:'date-chips', role:'group', 'aria-label':'Дата' },
      suns.map((iso, i) => chip(iso, fmtDay(iso), i === 0 ? 'ближайшее' : '')),
      cur && !suns.includes(cur) ? chip(cur, rowDateLabel(cur)) : null);
    const other = h('button', { type:'button', class:'chip date-other', 'aria-haspopup':'dialog', onclick:() => calendarPop(other, m.date, iso => { m.date = iso; upd(); draw(); }) }, ic('calendar'), 'Другая дата…');
    row.append(other);
    wrap.append(h('span', { class:'lbl', text:'Дата' }), row);
  };
  draw();
  return wrap;
}
/* «Вс, 15 ноября», в другом году — с годом */
function rowDateLabel(iso){
  const t = fmtDay(iso); if (!t) return '';
  return iso.slice(0, 4) === String(new Date().getFullYear()) ? t : t + ' ' + iso.slice(0, 4);
}
/* Календарь в стиле формы: Unbounded в заголовке, воскресенья жёлтым, сегодня — в рамке, выбранный день — жёлтый,
   точка — на эту дату уже есть конспект. Внизу «Ближайшее воскресенье» и «Сегодня». Esc и щелчок мимо — закрыть */
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
let calEl = null;
function closeCalendar(){ if (calEl){ calEl.remove(); calEl = null; } }
function calendarPop(anchor, value, pick){
  if (calEl){ closeCalendar(); return; }
  const today = isoOf(new Date()), taken = takenDates();
  const sel = dateOf(value) || dateOf(nextSunday());
  let y = sel.getFullYear(), mo = sel.getMonth();
  const done = iso => { closeCalendar(); pick(iso); anchor.focus(); };
  calEl = h('div', { class:'cal', role:'dialog', 'aria-label':'Календарь' });
  const draw = () => {
    calEl.innerHTML = '';
    const first = new Date(y, mo, 1), start = new Date(y, mo, 1 - ((first.getDay() + 6) % 7));   // неделя с понедельника
    const days = [];
    for (let i = 0; i < 42; i++){
      const d = new Date(start); d.setDate(start.getDate() + i);
      if (i >= 35 && d.getMonth() !== mo) break;
      const iso = isoOf(d), out = d.getMonth() !== mo, sun = d.getDay() === 0;
      days.push(h('button', { type:'button', class:'d' + (out ? ' out' : '') + (sun ? ' sun' : '') + (iso === today ? ' today' : '') + (iso === value ? ' sel' : '') + (taken.has(iso) ? ' has' : ''),
        'aria-label':fmtDay(iso) + (taken.has(iso) ? ', уже есть конспект' : ''), 'aria-pressed':String(iso === value), onclick:() => done(iso) }, String(d.getDate())));
    }
    const shift = k => { mo += k; if (mo < 0){ mo = 11; y--; } if (mo > 11){ mo = 0; y++; } draw(); };
    calEl.append(
      h('div', { class:'cal-h' }, h('span', { text:MONTHS[mo] + ' ' + y }),
        h('span', { class:'cal-nav' }, iconBtn('back', 'Предыдущий месяц', () => shift(-1)), iconBtn('next', 'Следующий месяц', () => shift(1)))),
      h('div', { class:'cal-g' }, ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(w => h('span', { class:'wd' + (w === 'Вс' ? ' sun' : ''), text:w })), days),
      h('div', { class:'cal-f' },
        h('button', { type:'button', class:'chip', onclick:() => done(nextSunday()) }, 'Ближайшее воскресенье'),
        h('button', { type:'button', class:'chip', onclick:() => done(today) }, 'Сегодня')));
    if (taken.size) calEl.append(h('div', { class:'cal-legend' }, h('i'), 'уже есть конспект'));
  };
  draw();
  document.body.append(calEl);
  const r = anchor.getBoundingClientRect(), w = 300;
  const left = Math.max(8, Math.min(innerWidth - w - 8, r.left));
  calEl.style.left = left + 'px';
  const below = r.bottom + 8, hgt = calEl.offsetHeight;
  calEl.style.top = (below + hgt > innerHeight - 8 ? Math.max(8, r.top - hgt - 8) : below) + 'px';
  setTimeout(() => {
    const away = e => { if (!calEl){ document.removeEventListener('pointerdown', away, true); return; } if (!calEl.contains(e.target) && e.target !== anchor){ closeCalendar(); document.removeEventListener('pointerdown', away, true); } };
    document.addEventListener('pointerdown', away, true);
  }, 0);
  const sb = calEl.querySelector('.d.sel') || calEl.querySelector('.d.today') || calEl.querySelector('.d');
  if (sb) sb.focus({ preventScroll:true });
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && (calEl || ddEl)){ e.preventDefault(); e.stopImmediatePropagation(); closeCalendar(); closeDropdown(); } }, true);

/* Окно закрыли: шапка и заставка показывают новые название, дату и проповедника */
function afterMeta(){
  renderTopbar();
  if (screen === 'sermon' && view === 'slides'){ const b = curBlock(); if (b && b.type === 'splash') renderSide(); }
  if (screen === 'sermon' && view === 'text') renderMain();
}

/* ----- «Как пользоваться» (этап 7.8: кнопка и страница; сама инструкция — отдельным этапом) ----- */
let helpBack = null;   // откуда открыли: туда и возвращаемся
function openHelp(){
  if (location.hash.indexOf('help') >= 0) return;
  helpBack = location.hash || '';
  navigate('#help');
}
function closeHelp(){
  if (helpBack !== null){ helpBack = null; history.back(); }   // открыли из формы: на шаг назад, туда же, где были
  else navigate('');   // открыли ссылкой #help сразу — на главную
}
function renderHelp(){
  mainEl.append(h('div', { class:'home help' },
    h('div', { class:'home-top' }, h('h1', { text:'Как пользоваться' })),
    h('div', { class:'empty' },
      h('div', { class:'empty-title', text:'Инструкция скоро появится' }),
      h('p', { class:'hint', text:'Здесь будет короткий рассказ о том, как собрать конспект, добавить слайды и передать их на вёрстку.' }),
      h('div', { class:'chips' }, h('button', { type:'button', class:'btn primary', onclick:() => closeHelp() }, ic('back'), 'Вернуться')))));
}
