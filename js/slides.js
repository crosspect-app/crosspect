'use strict';

/* ========= Вид «Слайды» =========
   Слева лента слайдов, в центре выбранный слайд и «Текст к слайду», справа настройки выбранного слайда.
   Поля настроек — те же `BODY[type]` из render.js. */
let filmEl = null, stageEl = null, sideEl = null;
let filmOnlyTodo = false;   // в ленте только слайды с отметкой «доработать» (для редактора)
let svFor = null;           // для какой проповеди построен экран «Слайды»: пока она та же, экран обновляется точечно (syncSlides)
const curBlock = () => (state && state.blocks.find(b => b.id === selId)) || null;
const blockById = id => (state && state.blocks.find(b => b.id === id)) || null;
const inSlides = () => screen === 'sermon' && view === 'slides' && !!filmEl && filmEl.isConnected;

/* Экран «Слайды» с нуля: открыли проповедь, пришли из «Текста», появился первый слайд.
   Дальше (правка, сохранение, отмена, перестановка, обновление из облака) — syncSlides: живые узлы, без пустых кадров (этап 7.7) */
function renderSlides(o){
  o = o || {};
  if (!state.blocks.length){ filmEl = stageEl = sideEl = null; svFor = null; mainEl.append(emptyState()); return; }
  if (!curBlock()) selId = state.blocks[0].id;
  filmEl = h('nav', { class:'film', 'aria-label':'Слайды проповеди' });
  stageEl = h('section', { class:'stage' });
  sideEl = h('aside', { class:'side', 'aria-label':'Настройки слайда' });
  mainEl.append(h('div', { class:'sv' + (speechOpen ? ' speech-open' : '') }, filmEl, stageEl, sideEl));
  svFor = state.id;
  applyLayout();   // ширина и порядок панелей (layout.js) — до раскладки слайдов: от ширины зависит масштаб
  renderFilm(); renderStage(); renderSide();
  applyLayout();
  filmReveal(selId, { instant:true, center:!!o.center });   // выбранный слайд виден в ленте (из «Текста» — ближе к середине)
  if (state.blocks.some(b => b.type === 'scripture')) loadBible(curLang());
}
/* Та же проповедь уже на экране: обновить только то, что изменилось. false — экрана нет, нужен renderSlides */
function syncSlides(){
  if (!filmEl || !filmEl.isConnected || svFor !== state.id || !state.blocks.length) return false;
  if (!curBlock()) selId = state.blocks[0].id;
  const sv = filmEl.closest('.sv'); if (sv) sv.classList.toggle('speech-open', speechOpen);
  syncFilm(); syncStage(); syncSide();
  applyLayout();
  if (state.blocks.some(b => b.type === 'scripture')) loadBible(curLang());
  return true;
}

function emptyState(){
  return h('div', { class:'home' }, h('div', { class:'empty' },
    h('div', { class:'empty-title', text:'Соберите конспект из слайдов' }),
    h('ol', null,
      h('li', null, 'Добавляйте слайды по ходу проповеди: места Писания, тезисы, цитаты, картинки.'),
      h('li', null, 'У каждого слайда есть «Текст к слайду»: что вы говорите, пока он на экране. На экран этот текст не выводится, его видит оператор.'),
      h('li', null, 'Если какое-то время говорите без слайда, добавьте «Заставку проповеди»: на экране будет название проповеди.'),
      h('li', null, '«Заметка оператору» — просьба к оператору: запустить видео, включить музыку.'),
      h('li', null, cloudOn() ? 'Правки сами уходят в облако церкви, их видят редакторы. Закончили — нажмите «Сохранить».' : 'Готово? Нажмите «Сохранить» и отправьте получившийся файл.')),
    readOnly() ? null : h('div', { class:'chips' },
      h('button', { type:'button', class:'btn primary', onclick:() => addBlock('splash', 0) }, ic('plus'), 'Добавить заставку'),
      h('button', { type:'button', class:'btn', onclick:() => openSheet(0) }, ic('plus'), 'Другой слайд'))));
}

/* ----- Что показывать вместо слайда у картинки, видео и свободного слайда ----- */
function mediaInfo(b, n){
  const name = cleanName(b.name), d = (b.desc || '').trim();
  if (b.type === 'image') return { icon:'image', name, title:b.mode === 'find' ? 'Найти картинку' : 'Файл пришлют отдельно («Слайд ' + n + '»)', lines:[d], short:b.mode === 'send' ? 'Пришлю отдельно' : (d || 'Найти картинку') };
  if (b.type === 'video'){
    const t = (b.from || b.to) ? (b.from || '0:00') + '–' + (b.to || 'до конца') : '';
    return { icon:'video', name, title:b.mode === 'link' ? 'Видео по ссылке' : 'Видео пришлют отдельно («Слайд ' + n + '»)',
      lines:[b.mode === 'link' ? (b.url || '').trim() : '', t && 'Показать: ' + t, d], short:'Видео' + (t ? ' · ' + t : '') };
  }
  return { icon:'free', name, title:'Свободный слайд', lines:[d || 'Описание не заполнено'], short:d || 'Свободный слайд' };
}
/* Подпись под миниатюрой: номер отдельно, а здесь — название без «[N] » */
function thumbName(b, n){
  if (!TYPES[b.type].slide) return 'Заметка';
  const nm = slideName(b, n).replace(/^\[\d+\]\s*/, '');
  return nm || TYPES[b.type].label;
}
const isMissing = b => !!(flagMissing && NAMED[b.type] && !cleanName(b.name));

/* ----- Лента -----
   Миниатюры живут, пока жив слайд: узел .st-box[data-box=id] создаётся один раз, при перестановке переезжает,
   перерисовывается только слайд, у которого изменилось содержимое (отпечаток thumbFp). Новая миниатюра раскладывается
   сразу, до показа: пустой рамки без текста не бывает. Обработчики ищут блок по id: после отмены и обновления из облака
   объекты блоков новые, а узлы те же */
function thumbBody(b, n){
  if (PREVIEW[b.type]){ const sl = slideEl(b); if (previewRO) previewRO.observe(sl); return sl; }
  if (b.type === 'note') return h('div', { class:'mini-note', text:(b.text || '').trim() || 'Заметка оператору' });
  return h('div', { class:'ph-thumb' }, h('span', { text:mediaInfo(b, n).short }));
}
/* Отпечаток того, что видно на слайде: содержимое без отметок и текста к слайду; у заставки — ещё название, автор, дата и размер.
   Настройки слайдов сюда не входят: их смену разносит refreshSlides (settings.js) */
function thumbFp(b){
  const c = Object.assign({}, b); delete c.todo; delete c.done; delete c.collapsed; delete c.speech; delete c.custom;
  if (b.type === 'splash'){ const m = state.meta; c.m = [m.title, m.firstName, m.lastName, m.date, state.settings && state.settings.splash, splashFootOn(b)]; }
  return JSON.stringify(c);
}
function filmActs(id){
  const B = fn => () => { const b = blockById(id); if (b) fn(b); };
  return h('div', { class:'st-acts' }, iconBtn('dup', 'Дублировать', B(duplicate)), iconBtn('trash', 'Удалить', B(removeBlock), 'danger'));
}
function filmItem(b, n){
  const id = b.id;
  const btn = h('button', { type:'button', 'data-id':id, style:'--tc:var(--c-' + b.type + ')', onclick:() => { if (!dragClick) selectBlock(id); },
    onkeydown:e => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && canArrange()){ e.preventDefault(); const x = blockById(id); if (x) move(x, e.key === 'ArrowUp' ? -1 : 1); } },   // Alt+↑/↓ — переставить с клавиатуры
    class:'st t-' + b.type },
    h('div', { class:'st-thumb' }, thumbBody(b, n), h('span', { class:'fl', text:'доработать' }), h('span', { class:'own', title:'Своя заставка: в PowerPoint будет чёрным слайдом', text:'своя' })),
    h('div', { class:'st-cap' },
      TYPES[b.type].slide ? h('span', { class:'st-n' }) : h('span', { class:'st-n' }, ic('note')),
      h('span', { class:'st-name' })));
  // «Дублировать» и «Удалить» (этап 7.4): значки на миниатюре — при наведении и при фокусе; на телефоне и планшете у выбранной видны всегда. Не вложены в кнопку слайда
  const box = h('div', { class:'st-box', 'data-box':id }, btn);
  box._fp = null;
  updateItem(box, b, n);
  return box;
}
/* Подпись, номер, отметки и значки миниатюры — без пересборки */
function updateItem(box, b, n){
  const btn = box.firstElementChild;
  btn.classList.toggle('on', b.id === selId);
  btn.classList.toggle('todo', todoOn(b));
  btn.classList.toggle('custom', isCustomSplash(b));
  btn.classList.toggle('missing', isMissing(b));
  const num = btn.querySelector('.st-n'); if (TYPES[b.type].slide && num.textContent !== String(n)) num.textContent = String(n);
  const nm = btn.querySelector('.st-name'), name = thumbName(b, n); if (nm.textContent !== name) nm.textContent = name;
  const ph = btn.querySelector('.ph-thumb span'); if (ph) ph.textContent = mediaInfo(b, n).short;
  const mn = btn.querySelector('.mini-note'); if (mn) mn.textContent = (b.text || '').trim() || 'Заметка оператору';
  const acts = box.querySelector('.st-acts');
  if (readOnly()){ if (acts) acts.remove(); }
  else if (!acts) box.append(filmActs(b.id));
}
function renderFilm(){
  filmEl.innerHTML = '';
  syncFilm();
}
function syncFilm(){
  const nums = slideNums();
  if (filmOnlyTodo && !state.blocks.some(todoOn)) filmOnlyTodo = false;   // отмеченных не осталось: показываем всё
  let head = filmEl.querySelector(':scope > .film-head');
  if (!head){ head = h('div', { class:'film-head', id:'film-count' }); filmEl.prepend(head); }
  const arrange = canArrange(), ro = readOnly();
  filmEl.classList.toggle('arrange', arrange);
  const old = new Map();
  filmEl.querySelectorAll(':scope > .st-box').forEach(x => old.set(x.dataset.box, x));
  const want = [];
  state.blocks.forEach((b, i) => {
    if (filmOnlyTodo && !todoOn(b)) return;
    let box = old.get(b.id);
    if (box){ old.delete(b.id); updateItem(box, b, nums[b.id]); }
    else box = filmItem(b, nums[b.id]);
    if (arrange){ const g = box._gap || (box._gap = filmGap()); g.dataset.at = String(i); g.classList.toggle('first', !want.length); want.push(g); }   // «+» между слайдами: вставить сюда; перед первым — виден всегда
    want.push(box);
  });
  if (!ro){
    // «+» после последнего слайда (этап 7.8, вместо кнопки «Добавить в конец»): виден всегда, не только при наведении
    let add = filmEl.querySelector(':scope > .film-end');
    if (!add){
      add = h('div', { class:'film-end' });
      add.append(h('button', { type:'button', class:'film-ins', title:'Добавить слайд в конец', 'aria-label':'Добавить слайд в конец', onclick:() => openSheet(state.blocks.length) }, ic('plus')));
    }
    add.dataset.at = String(state.blocks.length);
    want.push(add);
  }
  // расставить по порядку: узлы, что уже стоят на месте, не трогаем; лишнее (удалённые слайды, «+» в просмотре) — убрать
  const focus = filmEl.contains(document.activeElement) ? document.activeElement : null;
  let ref = head.nextSibling;
  want.forEach(n => { if (n === ref) ref = ref.nextSibling; else filmEl.insertBefore(n, ref); });
  while (ref){ const nx = ref.nextSibling; ref.remove(); ref = nx; }
  if (focus && focus.isConnected && document.activeElement !== focus) focus.focus({ preventScroll:true });
  if (arrange) armDrag(filmEl);
  // новые миниатюры — разложить сразу (шрифты и фон к этому времени готовы: slideAssetsReady в app.js); изменённые — на месте
  state.blocks.forEach(b => {
    if (!PREVIEW[b.type]) return;
    const box = filmEl.querySelector(':scope > .st-box[data-box="' + b.id + '"]'); if (!box) return;
    if (box._fp !== thumbFp(b)){ clearTimeout(previewTimers[b.id]); runPreview(b, box); }
  });
  updateStatus();
}
/* Переставлять и вставлять можно, когда проповедь правится и в ленте видны все слайды */
const canArrange = () => !readOnly() && !filmOnlyTodo;
function filmGap(){
  const g = h('div', { class:'film-gap' });
  g.append(h('button', { type:'button', class:'film-ins', title:'Добавить слайд сюда', 'aria-label':'Добавить слайд сюда', onclick:() => openSheet(+g.dataset.at) }, ic('plus')));
  return g;
}

/* Выбранный слайд целиком в видимой части ленты. Положение берём по раскладке (offsetTop), а не по экрану:
   во время плавного переезда миниатюры сдвинуты. o.center — ближе к середине (переход из «Текста»), o.with — второй слайд,
   который тоже должен быть виден, если оба помещаются (копия и исходный), o.instant — без плавной прокрутки */
function filmReveal(id, o){
  o = o || {};
  if (!inSlides() || !id) return;
  const box = filmEl.querySelector(':scope > .st-box[data-box="' + id + '"]'); if (!box) return;
  const row = getComputedStyle(filmEl).flexDirection === 'row';
  const pos = el => { let a = 0, e = el; while (e && e !== filmEl){ a += row ? e.offsetLeft : e.offsetTop; e = e.offsetParent; } return a; };
  const view = row ? filmEl.clientWidth : filmEl.clientHeight, cur = row ? filmEl.scrollLeft : filmEl.scrollTop, m = 10;
  let a = pos(box), z = a + (row ? box.offsetWidth : box.offsetHeight);
  const other = o.with && filmEl.querySelector(':scope > .st-box[data-box="' + o.with + '"]');
  if (other){ const oa = pos(other), oz = oa + (row ? other.offsetWidth : other.offsetHeight); if (Math.max(z, oz) - Math.min(a, oa) + 2 * m <= view){ a = Math.min(a, oa); z = Math.max(z, oz); } }
  let to = cur;
  if (o.center) to = (a + z) / 2 - view / 2;
  else if (a - m < cur) to = a - m;
  else if (z + m > cur + view) to = z + m - view;
  const max = (row ? filmEl.scrollWidth : filmEl.scrollHeight) - view;
  to = Math.max(0, Math.min(max, Math.round(to)));
  if (Math.abs(to - cur) < 1) return;
  filmEl.scrollTo({ [row ? 'left' : 'top']:to, behavior:o.instant || MOTION.off() ? 'auto' : 'smooth' });
}

/* ----- Перетаскивание слайдов в ленте -----
   Мышь: нажать и повести. Телефон: подержать палец на слайде, пока он не приподнимется, и вести.
   Слайд приподнимается (тень, чуть крупнее) и идёт за указателем; соседи плавно раздвигаются там, где он встанет.
   Отпустили — данные меняются, узлы переставляются, и слайд мягко доезжает на место (motionFilm). Номера и названия [N]
   пересчитываются сами. Узлы не пересоздаются, ничего не подгружается. У края ленты она прокручивается сама, плавно */
let drag = null, dragClick = false;
function armDrag(film){
  if (film.dataset.armed) return;
  film.dataset.armed = '1';
  film.addEventListener('pointerdown', e => {
    const it = e.target.closest('.st'); if (!it || e.button > 0 || !canArrange()) return;
    const d = drag = { id:it.dataset.id, it, box:it.closest('.st-box'), x0:e.clientX, y0:e.clientY, x:e.clientX, y:e.clientY, pid:e.pointerId, mouse:e.pointerType === 'mouse', on:false, at:-1, timer:0, raf:0 };
    if (!d.mouse) d.timer = setTimeout(() => { if (drag === d) startDrag(film, d); }, 380);
  });
  film.addEventListener('pointermove', e => {
    const d = drag; if (!d || e.pointerId !== d.pid) return;
    d.x = e.clientX; d.y = e.clientY;
    if (!d.on){
      const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
      if (d.mouse && dist > 6) startDrag(film, d);
      else if (!d.mouse && dist > 10){ clearTimeout(d.timer); drag = null; }   // палец повели сразу — это прокрутка ленты
      if (!d.on) return;
    }
    e.preventDefault();
    dragFollow(film, d);
  });
  const end = e => {
    const d = drag; if (!d || (e && e.pointerId !== d.pid)) return;
    clearTimeout(d.timer); cancelAnimationFrame(d.raf); drag = null;
    if (!d.on) return;
    dragClick = true; setTimeout(() => { dragClick = false; }, 0);   // отпускание после перетаскивания — не выбор слайда
    const b = state.blocks.find(x => x.id === d.id);
    const ok = e && e.type === 'pointerup' && b && d.at >= 0;
    const clear = () => dragClear(film, d);
    if (ok) moveTo(b, d.at, { prep:clear, lift:d.id });   // данные и узлы — на новое место, слайд доезжает из-под указателя
    else motionFilm(clear, { lift:d.id });                  // на своё же место: просто мягко вернуть
  };
  film.addEventListener('pointerup', end);
  film.addEventListener('pointercancel', end);
  film.addEventListener('touchmove', e => { if (drag && drag.on) e.preventDefault(); }, { passive:false });   // пока тянем — лента не прокручивается
  film.addEventListener('contextmenu', e => { if (drag) e.preventDefault(); });
}
function startDrag(film, d){
  d.on = true;
  d.row = getComputedStyle(film).flexDirection === 'row';
  const boxes = [...film.querySelectorAll(':scope > .st-box')];
  const fr = film.getBoundingClientRect(), sc = () => d.row ? film.scrollLeft : film.scrollTop;
  d.sc0 = sc(); d.sc = sc;
  // места в координатах содержимого ленты (не зависят от прокрутки): начало, середина, размер
  d.slots = boxes.map(x => { const r = x.getBoundingClientRect(); const a = (d.row ? r.left - fr.left : r.top - fr.top) + d.sc0; return { el:x, id:x.dataset.box, a, size:d.row ? r.width : r.height }; });
  d.from = d.slots.findIndex(s => s.el === d.box);
  const me = d.slots[d.from], next = d.slots[d.from + 1], prev = d.slots[d.from - 1];
  d.step = next ? next.a - me.a : prev ? me.a - prev.a : me.size;   // сколько места занимает слайд вместе с промежутком
  d.pos = d.from;
  film.classList.add('dragging'); d.it.classList.add('dragging'); d.box.classList.add('lifted');
  d.slots.forEach(s => { if (s.el !== d.box) s.el.classList.add('shifting'); });
  try { film.setPointerCapture(d.pid); } catch(err){}
  if (!d.mouse && navigator.vibrate) try { navigator.vibrate(12); } catch(err){}
  const loop = () => { if (drag !== d) return; dragEdge(film, d); d.raf = requestAnimationFrame(loop); };
  d.raf = requestAnimationFrame(loop);
  dragFollow(film, d);
}
/* Слайд — под указателем; соседи сдвигаются туда, где окажутся, если отпустить сейчас */
function dragFollow(film, d){
  const ds = d.sc() - d.sc0;
  const off = (d.row ? d.x - d.x0 : d.y - d.y0) + ds;
  d.box.style.transform = (d.row ? 'translateX(' : 'translateY(') + off + 'px) scale(1.04)';   // идёт вдоль ленты
  const me = d.slots[d.from], mid = me.a + off + me.size / 2;
  // куда встанет: сколько соседей (по их прежним местам) осталось выше середины перетаскиваемого
  let pos = 0;
  d.slots.forEach((s, k) => { if (k !== d.from && s.a + s.size / 2 < mid) pos++; });
  if (pos !== d.pos || !d.shown){
    d.pos = pos; d.shown = true;
    d.slots.forEach((s, k) => {
      if (k === d.from) return;
      const j = k < d.from ? k : k - 1;                       // место среди остальных
      const was = k, now = j < pos ? j : j + 1;                // где стоит сейчас и где будет
      const sh = (now - was) * d.step;
      s.el.style.transform = sh ? (d.row ? 'translateX(' + sh + 'px)' : 'translateY(' + sh + 'px)') : '';
    });
  }
  // в данных: вставить перед блоком, который окажется следующим; в конец — длина списка
  const others = d.slots.filter((s, k) => k !== d.from);
  const nextId = others[pos] ? others[pos].id : null;
  const at = nextId ? state.blocks.findIndex(b => b.id === nextId) : state.blocks.length;
  const from = state.blocks.findIndex(b => b.id === d.id);
  d.at = at === from || at === from + 1 ? -1 : at;   // на своё же место — ничего не меняется
}
/* У края ленты — прокрутка, тем быстрее, чем ближе к краю (каждый кадр, а не шагами) */
function dragEdge(film, d){
  const fr = film.getBoundingClientRect(), edge = 56;
  const p = d.row ? d.x : d.y, lo = d.row ? fr.left : fr.top, hi = d.row ? fr.right : fr.bottom;
  let v = 0;
  if (p < lo + edge) v = -Math.ceil(14 * Math.min(1, (lo + edge - p) / edge));
  else if (p > hi - edge) v = Math.ceil(14 * Math.min(1, (p - hi + edge) / edge));
  if (!v) return;
  const before = d.sc();
  if (d.row) film.scrollLeft += v; else film.scrollTop += v;
  if (d.sc() !== before) dragFollow(film, d);
}
/* Снять с узлов всё, что ставило перетаскивание (сдвиги без обратной анимации: дальше их ведёт motionFilm) */
function dragClear(film, d){
  film.classList.remove('dragging');
  d.it.classList.remove('dragging');
  d.slots.forEach(s => { s.el.classList.remove('lifted', 'shifting'); s.el.style.transform = ''; });
}
/* Счётчик «N доработать» над лентой: щелчок оставляет в ленте только отмеченные слайды и возвращает все */
function toggleOnlyTodo(){ filmOnlyTodo = !filmOnlyTodo; syncFilm(); }

/* Обновить подпись и отметки одной миниатюры, не пересобирая ленту */
function refreshThumb(b){
  if (!inSlides()) return;
  const box = filmEl.querySelector(':scope > .st-box[data-box="' + b.id + '"]'); if (!box) return;
  updateItem(box, b, slideNums()[b.id]);
  updateStatus();
}

function selectBlock(id){
  if (id === selId || !state.blocks.some(b => b.id === id)) return;
  selId = id; histSel(id);
  filmEl.querySelectorAll('.st.on').forEach(x => x.classList.remove('on'));
  const it = filmEl.querySelector('.st[data-id="' + id + '"]');
  if (it) it.classList.add('on');
  filmReveal(id);   // стрелки у сцены, щелчок у края: миниатюра докручивается в видимую часть
  closeTrPanel();
  renderStage(); renderSide();
}
function stepSel(d){
  const i = state.blocks.indexOf(curBlock()), j = i + d;
  if (j >= 0 && j < state.blocks.length) selectBlock(state.blocks[j].id);
}

/* ----- Сцена: слайд, панель над ним, «Текст к слайду» -----
   Собирается заново только при выборе другого слайда; слайд раскладывается сразу (без пустого кадра).
   Тот же слайд (правка, сохранение, вход в правку и выход) — syncStage: панель над слайдом, раскладка на месте, «Текст к слайду» — если изменился */
function renderStage(){
  const b = curBlock(); stageEl.innerHTML = ''; stageEl._id = null; if (!b) return;
  const n = slideNums()[b.id];
  stageEl.className = 'stage t-' + b.type;
  stageEl.style.setProperty('--tc', 'var(--c-' + b.type + ')');
  stageEl.append(stageBar(b, n),
    h('div', { class:'stage-view' }, stageVisual(b, n), h('div', { class:'stage-info' })),
    TYPES[b.type].slide ? speechBox(b) : null);
  stageEl._id = b.id; stageEl._fp = thumbFp(b);
  if (PREVIEW[b.type]){ clearTimeout(previewTimers[b.id]); runPreview(b); }
}
function syncStage(){
  const b = curBlock();
  if (!b || stageEl._id !== b.id){ renderStage(); return; }
  const n = slideNums()[b.id];
  const bar = stageEl.querySelector('.stage-bar'); if (bar) bar.replaceWith(stageBar(b, n));
  const fp = thumbFp(b);
  if (stageEl._fp !== fp){
    stageEl._fp = fp;
    if (PREVIEW[b.type]){ clearTimeout(previewTimers[b.id]); runPreview(b); }
    else { const v = stageEl.querySelector('.ph-big, .note-plate'); if (v) v.replaceWith(stageVisual(b, n)); }
  }
  const sp = stageEl.querySelector('.speech');
  if (sp && (sp._b !== b || sp._v !== b.speech)) sp.replaceWith(speechBox(b));   // другой объект (отмена, облако) или другой текст
  else if (sp){ const r = sp.querySelector('.rich'); if (r) r.inert = readOnly(); }   // вход в правку и выход: только доступность
}
function stageBar(b, n){
  const T = TYPES[b.type], i = state.blocks.indexOf(b), total = state.blocks.length;
  return h('div', { class:'stage-bar' },
    h('span', { class:'cap strong', text:(T.slide ? n + ' · ' : '') + T.label }),
    h('div', { class:'grow' }),
    T.slide && h('button', { type:'button', class:'btn', title:'Скопировать название слайда для Holyrics', onclick:() => copyText(slideName(b, n), 'Скопировано: ') }, ic('tag'), 'Название'),
    (PREVIEW[b.type] || BLANK_JPEG[b.type]) && h('button', { type:'button', class:'btn', title:BLANK_JPEG[b.type] ? 'Скачать пустой слайд в JPEG: рамка и фон без текста, основа для Canva' : 'Скачать слайд в JPEG', onclick:() => exportOne(b) }, ic('jpg'), 'JPEG'),
    T.slide && canFlag() && h('button', { type:'button', class:'btn todo' + (b.todo ? ' on' : ''), 'aria-pressed':String(!!b.todo),
      title:b.todo ? 'Снять отметку «доработать»' : 'Отметить «доработать»: слайд нужно сделать или поправить вручную.' + (cloudOn() ? ' Авторы эту отметку не видят.' : ''), onclick:() => toggleTodo(b) }, ic('flag'), 'Доработать'),
    h('div', { class:'stepper' },
      h('button', { type:'button', class:'icon-btn', 'aria-label':'Предыдущий слайд', title:'Предыдущий', disabled:i <= 0, onclick:() => stepSel(-1) }, ic('back')),
      h('span', { text:(i + 1) + ' / ' + total }),
      h('button', { type:'button', class:'icon-btn', 'aria-label':'Следующий слайд', title:'Следующий', disabled:i >= total - 1, onclick:() => stepSel(1) }, ic('next'))));
}
function stageVisual(b, n){
  if (PREVIEW[b.type]){ const sl = slideEl(b); if (previewRO) previewRO.observe(sl); return h('div', { class:'stage-slide' }, sl); }
  if (b.type === 'note') return h('div', { class:'note-plate' },
    h('div', { class:'note-tag' }, ic('note'), 'Оператору'),
    h('div', { class:'note-text' + ((b.text || '').trim() ? '' : ' empty'), text:(b.text || '').trim() || 'Текст заметки' }));
  const M = mediaInfo(b, n);
  return h('div', { class:'ph-big' }, ic(M.icon),
    h('div', null, h('div', { class:'ph-name' + (M.name ? '' : ' empty'), text:M.name || 'Без названия' }),
      h('div', { class:'ph-title', text:M.title }),
      M.lines.filter(Boolean).map(t => h('div', { class:'ph-line', text:t }))));
}
/* «Текст к слайду»: что проповедник говорит, пока слайд на экране. На экран не идёт; оператор видит его в виде «Текст» и в PDF */
function speechBox(b){
  const cnt = h('span', { class:'count' }), show = () => { cnt.textContent = speechInfo(wordCount(b.speech)); };
  show();
  const toggleBtn = h('button', { type:'button', class:'btn ghost small', onclick:() => {
    speechOpen = !speechOpen;
    const sv = stageEl.closest('.sv'); if (sv) sv.classList.toggle('speech-open', speechOpen);
    toggleBtn.textContent = speechOpen ? 'Свернуть ↓' : 'Развернуть ↑';
    if (PREVIEW[b.type]) schedulePreview(b);
  } }, speechOpen ? 'Свернуть ↓' : 'Развернуть ↑');
  const box = rich(b.speech, { key:b.id + ':speech', cls:'speech-text',
    ph:b.type === 'splash' ? 'Что вы говорите, пока на экране заставка: вступление, история, переход к следующей мысли' : 'Что вы говорите, пока этот слайд на экране. Оператор увидит этот текст у себя',
    onInput:v => { b.speech = v; sec._v = v; show(); change(); } });
  if (readOnly()) box.inert = true;   // просмотр: щелчок покажет подсказку про «Редактировать» (lock.js)
  const sec = h('section', { class:'speech', 'aria-label':'Текст к слайду' },
    h('div', { class:'speech-head' }, h('span', { class:'cap', text:'Текст к слайду' }), cnt, h('div', { class:'grow' }), toggleBtn), box);
  sec._b = b; sec._v = b.speech;   // syncStage: пересобрать, только если блок или текст поменялись не отсюда
  return sec;
}

/* ----- Настройки слайда справа -----
   Пересобираются, когда выбран другой слайд, поменялись его номер, объект (отмена, облако), режим правки или права;
   иначе syncSide их не трогает (прокрутка панели сохраняется) */
function sideKey(b){ return [b.id, slideNums()[b.id], readOnly(), canFlag(), canEditSlidesCfg(), authorWaits(), canEditCloud()].join('|'); }
function renderSide(){
  const b = curBlock(); sideEl.innerHTML = ''; sideEl._key = null; if (!b) return;
  const n = slideNums()[b.id], T = TYPES[b.type];
  sideEl.className = 'side t-' + b.type;
  sideEl.style.setProperty('--tc', 'var(--c-' + b.type + ')');
  const body = h('div', { class:'bbody' }), ro = readOnly();
  BODY[b.type](b, body, n);
  if (ro){
    const why = authorWaits() ? AT_EDITOR_MSG + '.' : !canEditCloud() ? 'Только просмотр: это конспект другого автора.' : 'Только просмотр. Чтобы менять слайды, нажмите «Редактировать».';
    body.inert = true; sideEl.append(h('p', { class:'ro-note', text:why }));
  }
  const capTip = b.type !== 'scripture' ? '' : canEditSlidesCfg()
    ? 'Как выглядят стихи (в строку или с новой строки, рамка, выравнивание), задано для всех слайдов: меню «⋯» → «Настройки слайдов»'
    : 'Как выглядят стихи, одинаково для всех слайдов: это задаёт редактор';
  sideEl.append(h('div', { class:'cap side-head', text:'Настройки · ' + T.label.toLowerCase(), title:capTip }), body);
  // «доработать» — кнопкой над слайдом (stageBar); переставляют, дублируют и удаляют слайды в ленте слева
  growAll(sideEl);   // «Дублировать» и «Удалить» — значками на миниатюре в ленте (этап 7.4)
  sideEl._key = sideKey(b); sideEl._b = b;
}
function syncSide(){
  const b = curBlock();
  if (b && sideEl._b === b && sideEl._key === sideKey(b)) return;
  const top = sideEl.scrollTop, same = b && sideEl._b && sideEl._b.id === b.id;
  renderSide();
  if (same) sideEl.scrollTop = top;
}

/* ----- Обновление после правки ----- */
/* Перерисовать настройки и панель выбранного слайда; миниатюра и предпросмотр обновляются сразу, без паузы */
function rerender(b, focusKey, offset){
  if (!inSlides()) return;
  if (b.id === selId){
    const bar = stageEl.querySelector('.stage-bar');
    if (bar) bar.replaceWith(stageBar(b, slideNums()[b.id]));
    renderSide();
    stageEl._fp = thumbFp(b);
  }
  refreshThumb(b);
  if (PREVIEW[b.type]){ clearTimeout(previewTimers[b.id]); runPreview(b); }
  else updateCounter(b);
  if (focusKey) focusRich(focusKey, offset);
}
/* Данные слайда изменились: пересчитать предпросмотр, подпись и заглушку */
function updateCounter(b){
  if (!inSlides()) return;
  if (PREVIEW[b.type]) schedulePreview(b);
  refreshThumb(b);
  if (!PREVIEW[b.type] && b.id === selId){
    const v = stageEl.querySelector('.ph-big, .note-plate');
    if (v) v.replaceWith(stageVisual(b, slideNums()[b.id]));
  }
}
