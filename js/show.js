'use strict';

/* ========= Показ слайдов (этап 10.5.1) =========
   Как F5 в PowerPoint: слайды на весь экран (Fullscreen API; не дал браузер — на всё окно), чёрные поля, если экран не 16:9.
   Слайд тот же, что в ленте и в JPEG: slideEl + fitSlide (preview.js). Картинка, видео и «Своя заставка» — заглушкой, как в ленте.
   Следующий и предыдущий слайды раскладываются заранее (скрыты visibility), поэтому листание без задержки. Анимаций и переходов нет.
   F5 — с первого слайда, Shift+F5 и кнопка «Показ» в шапке — с выбранного. Выход (Esc) возвращает в ленту на слайд, где остановились. */

const SHOW = { el:null, view:null, count:null, list:[], i:0, cache:new Map(), w:0, fs:false, opening:false, idleT:0, touch:null };
const SHOW_NEXT = ['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'];
const SHOW_PREV = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];
const showSlides = () => units().filter(u => TYPES[u.type].slide);
const showOn = () => !!SHOW.el;

/* Слайд, с которого начинать: выбранный; выбрана заметка (слайдом не бывает) — ближайший слайд после неё */
function showStartIndex(list){
  const all = units(), cur = unitById(selId);
  if (!cur) return 0;
  const at = all.indexOf(cur);
  const i = list.findIndex(u => all.indexOf(u) >= at);
  return i < 0 ? list.length - 1 : i;
}

async function showOpen(fromSelected){
  if (showOn() || SHOW.opening || screen !== 'sermon' || !state) return;
  const list = showSlides();
  if (!list.length){ toast('В конспекте нет слайдов для показа'); return; }
  SHOW.opening = true;
  try {
    SHOW.list = list; SHOW.i = fromSelected ? showStartIndex(list) : 0; SHOW.cache = new Map(); SHOW.fs = false;
    SHOW.view = h('div', { class:'show-view' });
    SHOW.count = h('div', { class:'show-count', 'aria-hidden':'true' });
    SHOW.el = h('div', { class:'slideshow', role:'dialog', 'aria-label':'Показ слайдов', 'aria-modal':'true' }, SHOW.view, SHOW.count);
    SHOW.el.addEventListener('pointerdown', showPointerDown);
    SHOW.el.addEventListener('pointerup', showPointerUp);
    SHOW.el.addEventListener('pointercancel', () => { SHOW.touch = null; });
    SHOW.el.addEventListener('mousemove', showWake);
    SHOW.el.addEventListener('contextmenu', e => e.preventDefault());
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // пробел и Enter не должны нажимать кнопку под показом
    document.body.append(SHOW.el);
    const rq = SHOW.el.requestFullscreen || SHOW.el.webkitRequestFullscreen;   // сразу, пока действует нажатие: потом браузер откажет
    if (rq){ try { const p = rq.call(SHOW.el, { navigationUI:'hide' }); if (p && p.catch) p.catch(() => {}); } catch(e){} }
    await Promise.all([slideAssetsReady(), document.fonts && document.fonts.ready].filter(Boolean));
    if (!showOn()) return;   // закрыли, пока ждали шрифты
    showGo(SHOW.i);
    showWake();
  } finally { SHOW.opening = false; }
}

/* Слайд в обёртке нужного размера. Кадр раскладывается в 1920×1080 и масштабируется (fitSlide), заглушка — в 960×540 и увеличивается */
function showMake(u){
  const wrap = h('div', { class:'show-slide' });
  wrap._u = u;
  if (PREVIEW[u.type]){ wrap._sl = slideEl(u); wrap.append(wrap._sl); }
  else wrap.append(stageVisual(u, slideNums()[u.id]));
  SHOW.view.append(wrap);
  showSize(wrap);
  return wrap;
}
function showSize(wr){
  const w = SHOW.w, ph = wr.querySelector('.ph-big');
  wr.style.width = w + 'px'; wr.style.height = Math.round(w * 9 / 16) + 'px';
  if (ph) wr.style.setProperty('--k', w / 960);
  if (wr._sl) fitSlide(wr._sl, wr._u);
}
function showMeasure(){
  const cw = SHOW.view.clientWidth, ch = SHOW.view.clientHeight;
  SHOW.w = Math.max(1, Math.floor(Math.min(cw, ch * 16 / 9)));
}
function showRefit(){
  if (!showOn()) return;
  showMeasure();
  SHOW.cache.forEach(wr => showSize(wr));
}

/* Перейти на слайд i; i === число слайдов — экран «Конец показа» */
function showGo(i){
  if (!showOn()) return;
  showMeasure();
  const n = SHOW.list.length;
  i = Math.max(0, Math.min(n, i)); SHOW.i = i;
  const want = new Set([i - 1, i, i + 1].filter(k => k >= 0 && k < n));   // этот, соседние — готовы заранее
  SHOW.cache.forEach((wr, k) => { if (!want.has(k)){ wr.remove(); SHOW.cache.delete(k); } });
  want.forEach(k => { if (!SHOW.cache.has(k)) SHOW.cache.set(k, showMake(SHOW.list[k])); });
  SHOW.cache.forEach((wr, k) => wr.classList.toggle('on', k === i));
  let end = SHOW.view.querySelector('.show-end');
  if (i === n && !end) SHOW.view.append(h('div', { class:'show-end', text:'Конец показа' }));
  else if (i < n && end) end.remove();
  SHOW.count.textContent = i < n ? (i + 1) + ' / ' + n : '';
  SHOW.el.dataset.i = String(i);
}
function showStep(d){
  if (!showOn() || SHOW.opening) return;
  if (d > 0 && SHOW.i >= SHOW.list.length){ showClose(); return; }   // после «Конца показа» ещё раз вперёд — выход, как в PowerPoint
  showGo(SHOW.i + d);
}

/* Выход: в ленте выбран слайд, на котором остановились */
function showClose(opt){
  if (!showOn()) return;
  const u = SHOW.list[Math.min(SHOW.i, SHOW.list.length - 1)];
  clearTimeout(SHOW.idleT);
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  SHOW.el.remove();
  SHOW.el = SHOW.view = SHOW.count = null; SHOW.cache = new Map(); SHOW.fs = false; SHOW.touch = null;
  if (fsEl){ const ex = document.exitFullscreen || document.webkitExitFullscreen; try { const p = ex.call(document); if (p && p.catch) p.catch(() => {}); } catch(e){} }
  if (opt && opt.keepSel) return;
  const cur = u && unitById(u.id);
  if (!cur || screen !== 'sermon') return;
  if (inSlides()) selectBlock(cur.id);
  else { selId = cur.id; histSel(cur.id); }
}

/* Счётчик и курсор прячутся через 2 с без движения мыши */
function showWake(){
  if (!showOn()) return;
  SHOW.el.classList.remove('idle');
  clearTimeout(SHOW.idleT);
  SHOW.idleT = setTimeout(() => { if (showOn()) SHOW.el.classList.add('idle'); }, 2000);
}

/* Мышь: щелчок — вперёд. Телефон: правая половина — вперёд, левая — назад, свайп влево / вправо */
function showPointerDown(e){ SHOW.touch = { x:e.clientX, y:e.clientY, type:e.pointerType, btn:e.button }; }
function showPointerUp(e){
  const t = SHOW.touch; SHOW.touch = null;
  if (!t || e.button !== t.btn) return;
  const dx = e.clientX - t.x, dy = e.clientY - t.y;
  if (t.type === 'mouse'){ if (t.btn === 0) showStep(1); return; }
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5){ showStep(dx < 0 ? 1 : -1); return; }   // свайп
  if (Math.abs(dx) > 12 || Math.abs(dy) > 12) return;   // не нажатие и не свайп: прокрутка пальцем
  showStep(e.clientX < SHOW.el.clientWidth / 2 ? -1 : 1);
}

/* Клавиши — до всех остальных обработчиков страницы (capture) */
document.addEventListener('keydown', e => {
  if (!showOn()){
    if (e.key === 'F5' && !e.ctrlKey && !e.metaKey && !e.altKey && screen === 'sermon' && state){
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) showOpen(e.shiftKey);
    }
    return;
  }
  const k = e.key;
  if (e.ctrlKey || e.metaKey || e.altKey){ e.stopImmediatePropagation(); return; }   // сочетания браузера работают, а формы (Ctrl+S, Ctrl+Z) под показом — нет
  e.stopImmediatePropagation();
  if (k === 'F5'){ e.preventDefault(); return; }
  if (k === 'Escape'){ e.preventDefault(); showClose(); return; }
  if (SHOW.opening) { e.preventDefault(); return; }
  if (SHOW_NEXT.includes(k)){ e.preventDefault(); showStep(1); }
  else if (SHOW_PREV.includes(k)){ e.preventDefault(); showStep(-1); }
  else if (k === 'Home'){ e.preventDefault(); showGo(0); }
  else if (k === 'End'){ e.preventDefault(); showGo(SHOW.list.length - 1); }
}, true);
document.addEventListener('keyup', e => { if (showOn()) e.stopImmediatePropagation(); }, true);

/* Esc в полноэкранном режиме браузер забирает себе: выход из показа — по смене режима */
function showFsChange(){
  if (!showOn()) return;
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl === SHOW.el) SHOW.fs = true;
  else if (SHOW.fs){ showClose(); return; }
  showRefit();
}
document.addEventListener('fullscreenchange', showFsChange);
document.addEventListener('webkitfullscreenchange', showFsChange);
window.addEventListener('resize', () => showRefit());
window.addEventListener('hashchange', () => { if (showOn()) showClose({ keepSel:true }); });   // ушли на другую страницу

/* Кнопка в шапке конспекта */
function showButton(){
  return h('button', { type:'button', class:'btn hd-show', title:'Показ слайдов с выбранного. F5 — с первого, Shift+F5 — с выбранного', 'aria-label':'Показ слайдов', onclick:() => showOpen(true) },
    ic('play'), h('span', { text:'Показ' }));
}
