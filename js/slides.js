'use strict';

/* ========= Вид «Слайды» =========
   Слева лента слайдов, в центре выбранный слайд и «Текст к слайду», справа настройки выбранного слайда.
   Поля настроек — те же `BODY[type]` из render.js. */
let filmEl = null, stageEl = null, sideEl = null;
let filmOnlyTodo = false;   // в ленте только слайды с отметкой «доработать» (для редактора)
const curBlock = () => (state && state.blocks.find(b => b.id === selId)) || null;
const inSlides = () => screen === 'sermon' && view === 'slides' && !!filmEl && filmEl.isConnected;

function renderSlides(){
  const keepScroll = filmEl && filmEl.isConnected ? filmEl.scrollTop : 0;
  if (!state.blocks.length){ filmEl = stageEl = sideEl = null; mainEl.append(emptyState()); return; }
  if (!curBlock()) selId = state.blocks[0].id;
  filmEl = h('nav', { class:'film', 'aria-label':'Слайды проповеди' });
  stageEl = h('section', { class:'stage' });
  sideEl = h('aside', { class:'side', 'aria-label':'Настройки слайда' });
  mainEl.append(h('div', { class:'sv' + (speechOpen ? ' speech-open' : '') }, filmEl, stageEl, sideEl));
  renderFilm(); renderStage(); renderSide();
  applyLayout();   // ширина и порядок панелей (layout.js)
  filmEl.scrollTop = keepScroll;
  if (state.blocks.some(b => b.type === 'scripture')) loadBible(curLang());
}

function emptyState(){
  return h('div', { class:'home' }, h('div', { class:'empty' },
    h('div', { class:'empty-title', text:'Соберите проповедь из слайдов' }),
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

/* ----- Лента ----- */
function thumbBody(b, n){
  if (PREVIEW[b.type]){ const sl = slideEl(b); if (previewRO) previewRO.observe(sl); return sl; }
  if (b.type === 'note') return h('div', { class:'mini-note', text:(b.text || '').trim() || 'Заметка оператору' });
  return h('div', { class:'ph-thumb' }, h('span', { text:mediaInfo(b, n).short }));
}
function filmItem(b, n){
  const T = TYPES[b.type];
  const btn = h('button', { type:'button', 'data-id':b.id, style:'--tc:var(--c-' + b.type + ')', onclick:() => { if (!dragClick) selectBlock(b.id); },
    onkeydown:e => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && canArrange()){ e.preventDefault(); move(b, e.key === 'ArrowUp' ? -1 : 1); } },   // Alt+↑/↓ — переставить с клавиатуры
    class:'st t-' + b.type + (b.id === selId ? ' on' : '') + (todoOn(b) ? ' todo' : '') + (isMissing(b) ? ' missing' : '') },
    h('div', { class:'st-thumb' }, thumbBody(b, n), h('span', { class:'fl', text:'доработать' })),
    h('div', { class:'st-cap' },
      T.slide ? h('span', { class:'st-n', text:String(n) }) : h('span', { class:'st-n' }, ic('note')),
      h('span', { class:'st-name', text:thumbName(b, n) })));
  // «Дублировать» и «Удалить» (этап 7.4): значки на миниатюре — при наведении и при фокусе; на телефоне и планшете у выбранной видны всегда. Не вложены в кнопку слайда
  return h('div', { class:'st-box', 'data-box':b.id }, btn, readOnly() ? null : h('div', { class:'st-acts' },
    iconBtn('dup', 'Дублировать', () => duplicate(b)),
    iconBtn('trash', 'Удалить', () => removeBlock(b), 'danger')));
}
function renderFilm(){
  filmEl.innerHTML = '';
  const nums = slideNums();
  if (filmOnlyTodo && !state.blocks.some(todoOn)) filmOnlyTodo = false;   // отмеченных не осталось: показываем всё
  filmEl.append(h('div', { class:'film-head', id:'film-count' }));
  const arrange = canArrange();
  filmEl.classList.toggle('arrange', arrange);
  state.blocks.forEach((b, i) => {
    if (filmOnlyTodo && !todoOn(b)) return;
    if (arrange) filmEl.append(filmGap(i));   // «+» между слайдами: вставить сюда
    filmEl.append(filmItem(b, nums[b.id]));
  });
  if (!readOnly()) filmEl.append(h('button', { type:'button', class:'film-add', 'data-at':String(state.blocks.length), onclick:() => openSheet(state.blocks.length) }, ic('plus'), 'Добавить в конец'));
  if (arrange) armDrag(filmEl);
  state.blocks.forEach(b => { if (PREVIEW[b.type]) schedulePreview(b); });
  updateStatus();
}
/* Переставлять и вставлять можно, когда проповедь правится и в ленте видны все слайды */
const canArrange = () => !readOnly() && !filmOnlyTodo;
function filmGap(at){
  return h('div', { class:'film-gap', 'data-at':String(at) },
    h('button', { type:'button', class:'film-ins', title:'Добавить слайд сюда', 'aria-label':'Добавить слайд сюда', onclick:() => openSheet(at) }, ic('plus')));
}

/* ----- Перетаскивание слайдов в ленте -----
   Мышь: нажать и повести. Телефон: подержать палец на слайде, пока он не приподнимется, и вести. Отпустили — слайд встаёт
   на отмеченное место; номера и названия [N] пересчитываются сами (они считаются по порядку) */
let drag = null, dragClick = false;
function armDrag(film){
  if (film.dataset.armed) return;
  film.dataset.armed = '1';
  film.addEventListener('pointerdown', e => {
    const it = e.target.closest('.st'); if (!it || e.button > 0 || !canArrange()) return;
    const d = drag = { id:it.dataset.id, it, x0:e.clientX, y0:e.clientY, pid:e.pointerId, mouse:e.pointerType === 'mouse', on:false, at:-1, timer:0 };
    if (!d.mouse) d.timer = setTimeout(() => { if (drag === d) startDrag(film, d, e.clientX, e.clientY); }, 380);
  });
  film.addEventListener('pointermove', e => {
    const d = drag; if (!d || e.pointerId !== d.pid) return;
    if (!d.on){
      const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
      if (d.mouse && dist > 6) startDrag(film, d, e.clientX, e.clientY);
      else if (!d.mouse && dist > 10){ clearTimeout(d.timer); drag = null; }   // палец повели сразу — это прокрутка ленты
      if (!d.on) return;
    }
    e.preventDefault();
    dropMark(film, d, e.clientX, e.clientY);
  });
  const end = e => {
    const d = drag; if (!d || (e && e.pointerId !== d.pid)) return;
    clearTimeout(d.timer); drag = null;
    if (!d.on) return;
    film.classList.remove('dragging'); d.it.classList.remove('dragging');
    film.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
    dragClick = true; setTimeout(() => { dragClick = false; }, 0);   // отпускание после перетаскивания — не выбор слайда
    if (e && e.type === 'pointerup' && d.at >= 0){ const b = state.blocks.find(x => x.id === d.id); if (b) moveTo(b, d.at); }
  };
  film.addEventListener('pointerup', end);
  film.addEventListener('pointercancel', end);
  film.addEventListener('touchmove', e => { if (drag && drag.on) e.preventDefault(); }, { passive:false });   // пока тянем — лента не прокручивается
  film.addEventListener('contextmenu', e => { if (drag) e.preventDefault(); });
}
function startDrag(film, d, x, y){
  d.on = true;
  film.classList.add('dragging'); d.it.classList.add('dragging');
  try { film.setPointerCapture(d.pid); } catch(err){}
  if (!d.mouse && navigator.vibrate) try { navigator.vibrate(12); } catch(err){}
  dropMark(film, d, x, y);
}
/* Куда встанет слайд: перед первым слайдом, середину которого ещё не прошли; отметка — на промежутке */
function dropMark(film, d, x, y){
  const row = getComputedStyle(film).flexDirection === 'row';
  const fr = film.getBoundingClientRect(), edge = 36;
  if (row){ if (x < fr.left + edge) film.scrollLeft -= 14; else if (x > fr.right - edge) film.scrollLeft += 14; }
  else { if (y < fr.top + edge) film.scrollTop -= 14; else if (y > fr.bottom - edge) film.scrollTop += 14; }
  let at = state.blocks.length;
  for (const el of film.querySelectorAll('.st')){
    if (el === d.it) continue;
    const r = el.getBoundingClientRect();
    if (row ? x < r.left + r.width / 2 : y < r.top + r.height / 2){ at = state.blocks.findIndex(b => b.id === el.dataset.id); break; }
  }
  const from = state.blocks.findIndex(b => b.id === d.id);
  d.at = at === from || at === from + 1 ? -1 : at;   // на своё же место — ничего не меняется
  film.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
  if (d.at >= 0){ const g = film.querySelector('[data-at="' + d.at + '"]'); if (g) g.classList.add('drop'); }
}
/* Счётчик «N доработать» над лентой: щелчок оставляет в ленте только отмеченные слайды и возвращает все */
function toggleOnlyTodo(){ filmOnlyTodo = !filmOnlyTodo; renderFilm(); }

/* Обновить подпись и отметки одной миниатюры, не пересобирая ленту */
function refreshThumb(b){
  if (!inSlides()) return;
  const el = filmEl.querySelector('.st[data-id="' + b.id + '"]'); if (!el) return;
  const n = slideNums()[b.id];
  el.classList.toggle('todo', todoOn(b));
  el.classList.toggle('missing', isMissing(b));
  const nm = el.querySelector('.st-name'); if (nm) nm.textContent = thumbName(b, n);
  const ph = el.querySelector('.ph-thumb span'); if (ph) ph.textContent = mediaInfo(b, n).short;
  const mn = el.querySelector('.mini-note'); if (mn) mn.textContent = (b.text || '').trim() || 'Заметка оператору';
  updateStatus();
}

function selectBlock(id){
  if (id === selId || !state.blocks.some(b => b.id === id)) return;
  selId = id; histSel(id);
  filmEl.querySelectorAll('.st.on').forEach(x => x.classList.remove('on'));
  const it = filmEl.querySelector('.st[data-id="' + id + '"]');
  if (it){ it.classList.add('on'); it.scrollIntoView({ block:'nearest', inline:'nearest' }); }
  closeTrPanel();
  renderStage(); renderSide();
}
function stepSel(d){
  const i = state.blocks.indexOf(curBlock()), j = i + d;
  if (j >= 0 && j < state.blocks.length) selectBlock(state.blocks[j].id);
}

/* ----- Сцена: слайд, панель над ним, «Текст к слайду» ----- */
function renderStage(){
  const b = curBlock(); stageEl.innerHTML = ''; if (!b) return;
  const n = slideNums()[b.id];
  stageEl.className = 'stage t-' + b.type;
  stageEl.style.setProperty('--tc', 'var(--c-' + b.type + ')');
  stageEl.append(stageBar(b, n),
    h('div', { class:'stage-view' }, stageVisual(b, n), h('div', { class:'stage-info' })),
    TYPES[b.type].slide ? speechBox(b) : null);
  if (PREVIEW[b.type]) schedulePreview(b);
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
    onInput:v => { b.speech = v; show(); change(); } });
  if (readOnly()) box.inert = true;   // просмотр: щелчок покажет подсказку про «Редактировать» (lock.js)
  return h('section', { class:'speech', 'aria-label':'Текст к слайду' },
    h('div', { class:'speech-head' }, h('span', { class:'cap', text:'Текст к слайду' }), cnt, h('div', { class:'grow' }), toggleBtn), box);
}

/* ----- Настройки слайда справа ----- */
function renderSide(){
  const b = curBlock(); sideEl.innerHTML = ''; if (!b) return;
  const n = slideNums()[b.id], T = TYPES[b.type];
  sideEl.className = 'side t-' + b.type;
  sideEl.style.setProperty('--tc', 'var(--c-' + b.type + ')');
  const body = h('div', { class:'bbody' }), ro = readOnly();
  BODY[b.type](b, body, n);
  if (ro){
    const why = authorWaits() ? AT_EDITOR_MSG + '.' : !canEditCloud() ? 'Только просмотр: это проповедь другого автора.' : 'Только просмотр. Чтобы менять слайды, нажмите «Редактировать».';
    body.inert = true; sideEl.append(h('p', { class:'ro-note', text:why }));
  }
  const capTip = b.type !== 'scripture' ? '' : canEditSlidesCfg()
    ? 'Как выглядят стихи (в строку или с новой строки, рамка, выравнивание), задано для всех слайдов: меню «⋯» → «Настройки слайдов»'
    : 'Как выглядят стихи, одинаково для всех слайдов: это задаёт редактор';
  sideEl.append(h('div', { class:'cap side-head', text:'Настройки · ' + T.label.toLowerCase(), title:capTip }), body);
  // «доработать» — кнопкой над слайдом (stageBar); переставляют, дублируют и удаляют слайды в ленте слева
  growAll(sideEl);   // «Дублировать» и «Удалить» — значками на миниатюре в ленте (этап 7.4)
}

/* ----- Обновление после правки ----- */
/* Перерисовать настройки и панель выбранного слайда; миниатюра и предпросмотр обновляются сразу, без паузы */
function rerender(b, focusKey, offset){
  if (!inSlides()) return;
  if (b.id === selId){
    const bar = stageEl.querySelector('.stage-bar');
    if (bar) bar.replaceWith(stageBar(b, slideNums()[b.id]));
    renderSide();
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
