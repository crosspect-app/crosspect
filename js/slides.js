'use strict';

/* ========= Вид «Слайды» =========
   Слева лента слайдов, в центре выбранный слайд и «Текст к слайду», справа настройки выбранного слайда.
   Поля настроек — те же `BODY[type]` из render.js. */
let filmEl = null, stageEl = null, sideEl = null;
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
  filmEl.scrollTop = keepScroll;
  if (state.blocks.some(b => b.type === 'scripture')) loadBible(curLang());
}

function emptyState(){
  return h('div', { class:'home' }, h('div', { class:'empty' },
    h('div', { class:'empty-title', text:'Соберите проповедь из слайдов' }),
    h('ol', null,
      h('li', null, 'Добавляйте слайды по ходу проповеди: места Писания, тезисы, цитаты, картинки.'),
      h('li', null, 'У каждого слайда есть «Текст к слайду»: что вы говорите, пока он на экране. На экран этот текст не выводится, его видит оператор.'),
      h('li', null, 'Если какое-то время говорите без слайда, добавьте «Заставку»: на экране будет название проповеди.'),
      h('li', null, '«Заметка оператору» — просьба к оператору: запустить видео, включить музыку.'),
      h('li', null, cloudOn() ? 'Готово? Нажмите «Сохранить»: проповедь окажется в облаке церкви, и её увидят редакторы.' : 'Готово? Нажмите «Сохранить» и отправьте получившийся файл.')),
    h('div', { class:'chips' },
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
const isMissing = b => !!(flagMissing && NAMED[b.type] && slidesCfg().names.required && !cleanName(b.name));

/* ----- Лента ----- */
function thumbBody(b, n){
  if (PREVIEW[b.type]){ const sl = slideEl(b); if (previewRO) previewRO.observe(sl); return sl; }
  if (b.type === 'note') return h('div', { class:'mini-note', text:(b.text || '').trim() || 'Заметка оператору' });
  return h('div', { class:'ph-thumb' }, h('span', { text:mediaInfo(b, n).short }));
}
function filmItem(b, n){
  const T = TYPES[b.type];
  return h('button', { type:'button', 'data-id':b.id, style:'--tc:var(--c-' + b.type + ')', onclick:() => selectBlock(b.id),
    class:'st t-' + b.type + (b.id === selId ? ' on' : '') + (b.done ? ' done' : '') + (b.todo ? ' todo' : '') + (isMissing(b) ? ' missing' : '') },
    h('div', { class:'st-thumb' }, thumbBody(b, n), h('span', { class:'fl', text:'доработать' })),
    h('div', { class:'st-cap' },
      T.slide ? h('span', { class:'st-n', text:String(n) }) : h('span', { class:'st-n' }, ic('note')),
      h('span', { class:'st-name', text:thumbName(b, n) }),
      h('span', { class:'st-ok', 'aria-label':'готово', text:'✓' })));
}
function renderFilm(){
  filmEl.innerHTML = '';
  const nums = slideNums();
  filmEl.append(h('div', { class:'film-head', id:'film-count' }));
  state.blocks.forEach(b => filmEl.append(filmItem(b, nums[b.id])));
  filmEl.append(h('button', { type:'button', class:'film-add', onclick:() => openSheet(addAt()) }, ic('plus'), 'Добавить'));
  state.blocks.forEach(b => { if (PREVIEW[b.type]) schedulePreview(b); });
  updateStatus();
}
/* Новый слайд встаёт после выбранного */
function addAt(){ const b = curBlock(); return b ? state.blocks.indexOf(b) + 1 : state.blocks.length; }

/* Обновить подпись и отметки одной миниатюры, не пересобирая ленту */
function refreshThumb(b){
  if (!inSlides()) return;
  const el = filmEl.querySelector('.st[data-id="' + b.id + '"]'); if (!el) return;
  const n = slideNums()[b.id];
  el.classList.toggle('done', !!b.done);
  el.classList.toggle('todo', !!b.todo);
  el.classList.toggle('missing', isMissing(b));
  const nm = el.querySelector('.st-name'); if (nm) nm.textContent = thumbName(b, n);
  const ph = el.querySelector('.ph-thumb span'); if (ph) ph.textContent = mediaInfo(b, n).short;
  const mn = el.querySelector('.mini-note'); if (mn) mn.textContent = (b.text || '').trim() || 'Заметка оператору';
  updateStatus();
}

function selectBlock(id){
  if (id === selId || !state.blocks.some(b => b.id === id)) return;
  selId = id;
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
    PREVIEW[b.type] && h('button', { type:'button', class:'btn', title:'Скачать слайд в JPEG', onclick:() => exportOne(b) }, ic('jpg'), 'JPEG'),
    T.slide && h('button', { type:'button', class:'btn todo' + (b.todo ? ' on' : ''), 'aria-pressed':String(!!b.todo),
      title:b.todo ? 'Снять отметку «доработать»' : 'Отметить «доработать»: слайд нужно сделать или поправить вручную', onclick:() => toggleTodo(b) }, ic('flag'), 'Доработать'),
    T.slide && h('button', { type:'button', class:'btn ok' + (b.done ? ' on' : ''), 'aria-pressed':String(!!b.done),
      title:b.done ? 'Снять отметку «готово»' : 'Отметить как готовый', onclick:() => toggleDone(b) }, ic('check'), 'Готово'),
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
  return h('section', { class:'speech', 'aria-label':'Текст к слайду' },
    h('div', { class:'speech-head' }, h('span', { class:'cap', text:'Текст к слайду' }), cnt, h('div', { class:'grow' }), toggleBtn),
    rich(b.speech, { key:b.id + ':speech', cls:'speech-text',
      ph:b.type === 'splash' ? 'Что вы говорите, пока на экране заставка: вступление, история, переход к следующей мысли' : 'Что вы говорите, пока этот слайд на экране. Оператор увидит этот текст у себя',
      onInput:v => { b.speech = v; show(); change(); } }));
}

/* ----- Настройки слайда справа ----- */
function renderSide(){
  const b = curBlock(); sideEl.innerHTML = ''; if (!b) return;
  const n = slideNums()[b.id], T = TYPES[b.type];
  sideEl.className = 'side t-' + b.type;
  sideEl.style.setProperty('--tc', 'var(--c-' + b.type + ')');
  const body = h('div', { class:'bbody' });
  BODY[b.type](b, body, n);
  sideEl.append(h('div', { class:'cap', text:'Настройки · ' + T.label.toLowerCase() }), body);
  if (T.slide) sideEl.append(h('div', { class:'editor-box' },
    h('div', { class:'eb-head' }, h('b', { text:'Для редактора' }), h('span', { text:'сейчас отметку видят все, у кого открыт файл' })),
    sw('Доработать', b.todo, () => toggleTodo(b)),
    h('p', { class:'hint', text:'Картинки, видео и свободные слайды получают отметку сами при создании.' })));
  const i = state.blocks.indexOf(b);
  sideEl.append(h('div', { class:'side-actions' },
    h('button', { type:'button', class:'btn', disabled:i === 0, onclick:() => move(b, -1) }, ic('up'), 'Выше'),
    h('button', { type:'button', class:'btn', disabled:i === state.blocks.length - 1, onclick:() => move(b, 1) }, ic('down'), 'Ниже'),
    h('button', { type:'button', class:'btn', onclick:() => duplicate(b) }, ic('dup'), 'Дублировать'),
    h('button', { type:'button', class:'btn danger', onclick:() => removeBlock(b) }, ic('trash'), 'Удалить')));
  growAll(sideEl);
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
