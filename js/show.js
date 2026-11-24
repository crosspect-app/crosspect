'use strict';

/* ========= Показ слайдов (этапы 10.5.1 и 10.9.5) =========
   Как F5 в PowerPoint: слайды на весь экран (Fullscreen API; не дал браузер — на всё окно), чёрные поля, если экран не 16:9.
   Слайд тот же, что в ленте и в JPEG: slideEl + fitSlide (preview.js). Картинка, видео и «Своя заставка» — заглушкой, как в ленте.
   Следующий и предыдущий слайды раскладываются заранее (скрыты visibility), поэтому листание без задержки. Анимаций и переходов нет.
   F5 — с первого слайда, Shift+F5 и кнопка «Показ» в шапке — с выбранного. На «Тексте» кнопки нет (решение Виталия 19 ноября 2026), F5 работает. Выход (Esc) возвращает в ленту на слайд, где остановились.

   Три режима (SHOW.mode, этап 10.9.5):
   - 'here' — один экран, как в 10.5.1;
   - 'ext' — два экрана в режиме «Расширить» (Window Management API, Chrome и Edge): окно формы уходит во весь экран на второй экран
     (requestFullscreen({ screen })), на этом экране открывается окно-пульт (SHOW.pop): текущий и следующий слайд, счётчик, время;
   - 'win' — «⋯ → Показ в отдельном окне» (Safari, Firefox, нет разрешения): слайды в отдельном окне (SHOW.pop), его перетаскивают на проектор и жмут F;
     пульт — во вкладке формы.
   Окна одного источника, поэтому второе окно ведёт этот же код: слайды раскладываются здесь (SHOW.view), в окна идут копии (showClone),
   листание из любого окна — одна и та же showGo. BroadcastChannel не нужен. */

const SHOW = { el:null, view:null, count:null, list:[], i:0, cache:new Map(), w:0, fs:false, opening:false, idleT:0, touch:null,
  mode:'here', pop:null, con:null, conWin:null, t0:0, tick:0, popIdleT:0 };
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

/* Второй экран: { show, con } — куда показ и куда пульт; null — один экран, нет API или разрешения.
   Ждём только там, где API есть и экранов несколько: в остальных браузерах полный экран просится сразу, пока действует нажатие */
const showMulti = () => !!window.getScreenDetails && window.screen && window.screen.isExtended === true && !isPhone();
async function showScreens(){
  let st = 'prompt';
  for (const name of ['window-management', 'window-placement']){   // window-placement — прежнее имя разрешения (Chrome до 111)
    try { st = (await navigator.permissions.query({ name })).state; break; } catch(e){}
  }
  if (st === 'denied') return null;
  let d; try { d = await window.getScreenDetails(); } catch(e){ return null; }   // отказали в разрешении
  const cur = d.currentScreen, other = (d.screens || []).filter(s => s !== cur);
  if (!cur || !other.length) return null;
  return { show:other.find(s => !s.isPrimary) || other[0], con:cur, asked:st !== 'granted' };
}

async function showOpen(fromSelected, how){
  if (showOn() || SHOW.opening || screen !== 'sermon' || !state) return;
  const list = showSlides();
  if (!list.length){ toast('В конспекте нет слайдов для показа'); return; }
  let pop = null;
  if (how === 'win'){   // окно — сразу, пока действует нажатие
    pop = window.open('', 'crosspect-show', 'popup,width=960,height=540');
    if (!pop){ toast('Браузер не открыл окно. Разрешите всплывающие окна для этого сайта'); return; }
  }
  SHOW.opening = true;
  try {
    const scr = !pop && showMulti() ? await showScreens() : null;
    if (!state || screen !== 'sermon'){ if (pop) pop.close(); return; }
    SHOW.list = list; SHOW.i = fromSelected ? showStartIndex(list) : 0; SHOW.cache = new Map(); SHOW.fs = false;
    SHOW.mode = pop ? 'win' : 'here'; SHOW.t0 = Date.now();
    SHOW.view = h('div', { class:'show-view' });
    SHOW.count = h('div', { class:'show-count', 'aria-hidden':'true' });
    SHOW.el = h('div', { class:'slideshow' + (pop ? ' show-con' : ''), role:'dialog', 'aria-label':pop ? 'Пульт показа' : 'Показ слайдов', 'aria-modal':'true' }, SHOW.view, SHOW.count);
    SHOW.el.addEventListener('pointerdown', showPointerDown);
    SHOW.el.addEventListener('pointerup', showPointerUp);
    SHOW.el.addEventListener('pointercancel', () => { SHOW.touch = null; });
    SHOW.el.addEventListener('mousemove', showWake);
    SHOW.el.addEventListener('contextmenu', e => { if (SHOW.mode !== 'win') e.preventDefault(); });
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // пробел и Enter не должны нажимать кнопку под показом
    document.body.append(SHOW.el);
    if (pop){ showPopShow(pop); showConMount(window, SHOW.el); }
    else if (scr){
      if (await showFull(scr.show)) showConOpen(scr.con);
      else if (scr.asked && showOn()) showAsk(scr);   // разрешение дали только что, а нажатие уже истекло: ещё одно нажатие
    }
    else showFull(null);
    SHOW.tick = setInterval(showTick, 1000);
    await Promise.all([slideAssetsReady(), document.fonts && document.fonts.ready].filter(Boolean));
    if (!showOn()) return;   // закрыли, пока ждали шрифты
    showGo(SHOW.i);
    showWake();
  } finally { SHOW.opening = false; }
}

/* Полный экран у показа; screen — на каком экране (Window Management API). true — получилось */
function showFull(scr){
  const el = SHOW.el, rq = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!rq) return Promise.resolve(false);
  try {
    const p = rq.call(el, scr ? { navigationUI:'hide', screen:scr } : { navigationUI:'hide' });
    return p && p.then ? p.then(() => true, () => false) : Promise.resolve(true);
  } catch(e){ return Promise.resolve(false); }
}

/* Нажатие истекло, пока браузер спрашивал разрешение: карточка с кнопками поверх показа */
function showAsk(scr){
  const card = h('div', { class:'show-ask', role:'group', 'aria-label':'Второй экран' },
    h('div', { class:'show-ask-t', text:'Показать слайды на втором экране?' }),
    h('div', { class:'show-ask-b' },
      h('button', { type:'button', class:'btn primary', text:'На втором экране', onclick:async () => { card.remove(); if (await showFull(scr.show)) showConOpen(scr.con); } }),
      h('button', { type:'button', class:'btn', text:'На этом экране', onclick:() => { card.remove(); showFull(null); } })));
  card.addEventListener('pointerdown', e => e.stopPropagation());
  card.addEventListener('pointerup', e => e.stopPropagation());
  SHOW.el.append(card);
  card.querySelector('button').focus();
}

/* ----- Второе окно ----- */
/* Пустое окно того же сайта: стили, шрифты и переменные слайдов — как у формы */
function showPopInit(w, title, cls){
  const d = w.document;
  d.documentElement.lang = 'ru';
  d.head.innerHTML = '';
  const base = d.createElement('base'); base.href = location.href; d.head.append(base);
  const meta = d.createElement('meta'); meta.setAttribute('charset', 'utf-8'); d.head.append(meta);
  document.querySelectorAll('link[rel="stylesheet"], style').forEach(x => {
    if (x.tagName === 'LINK'){ const l = d.createElement('link'); l.rel = 'stylesheet'; l.href = x.href; d.head.append(l); }
    else d.head.append(d.importNode(x, true));
  });
  const t = d.createElement('title'); t.textContent = title; d.head.append(t);
  showPopVars(w);
  d.body.innerHTML = ''; d.body.className = cls;
  w.addEventListener('keydown', e => showKey(e, w), true);
  w.addEventListener('keyup', e => e.stopImmediatePropagation(), true);
  w.addEventListener('resize', () => showSync());
  if (d.fonts && d.fonts.ready) d.fonts.ready.then(() => showSync());
  return d;
}
function showPopVars(w){
  try { w.document.documentElement.style.cssText = document.documentElement.style.cssText; w.document.documentElement.className = document.documentElement.className; } catch(e){}
}
const showPopOpen = () => !!(SHOW.pop && !SHOW.pop.closed);

/* 'win': окно со слайдами. Щелчок — вперёд, F — во весь экран (на том мониторе, где окно) */
function showPopShow(w){
  SHOW.pop = w;
  const d = showPopInit(w, 'Crosspect — показ', 'show-pop');
  const root = h('div', { class:'slideshow show-out' }, h('div', { class:'show-view' }),
    h('div', { class:'show-hint', text:'Перетащите это окно на проектор и нажмите F — слайды во весь экран' }));
  root.addEventListener('pointerup', e => { if (e.button === 0) showStep(1); });
  root.addEventListener('contextmenu', e => e.preventDefault());
  root.addEventListener('mousemove', () => showPopWake());
  d.body.append(root);
  d.addEventListener('fullscreenchange', () => { root.classList.toggle('fs', !!d.fullscreenElement); showSync(); });
  try { w.focus(); } catch(e){}
}
function showPopWake(){
  const root = showPopOpen() && SHOW.pop.document.querySelector('.show-out'); if (!root) return;
  root.classList.remove('idle'); clearTimeout(SHOW.popIdleT);
  SHOW.popIdleT = setTimeout(() => { if (root.isConnected) root.classList.add('idle'); }, 2000);
}
function showPopFull(){
  if (!showPopOpen()) return;
  const d = SHOW.pop.document;
  try {
    if (d.fullscreenElement){ const p = d.exitFullscreen(); if (p && p.catch) p.catch(() => {}); }
    else { const p = d.documentElement.requestFullscreen({ navigationUI:'hide' }); if (p && p.catch) p.catch(() => {}); }
  } catch(e){}
}

/* 'ext': окно-пульт на этом экране, во весь его размер */
function showConOpen(scr){
  if (!showOn()) return;
  SHOW.mode = 'ext';
  const f = scr && scr.availWidth ? ',left=' + scr.availLeft + ',top=' + scr.availTop + ',width=' + scr.availWidth + ',height=' + scr.availHeight : '';
  let w = null; try { w = window.open('', 'crosspect-console', 'popup' + f); } catch(e){}
  if (!w){ toast('Пульт не открылся: браузер не разрешил окно. Слайды на втором экране, листайте там'); return; }
  SHOW.pop = w;
  const d = showPopInit(w, 'Crosspect — пульт', 'show-pop');
  const root = h('div', { class:'slideshow show-con' });
  d.body.append(root);
  showConMount(w, root);
  try { w.focus(); } catch(e){}
  showSync();
}

/* ----- Пульт: текущий и следующий слайд, счётчик, время, листание ----- */
function showConMount(w, root){
  SHOW.conWin = w;
  const nav = (name, title, d) => h('button', { type:'button', class:'btn con-nav', title:title, 'aria-label':title, onclick:() => showStep(d) }, ic(name));
  SHOW.con = h('div', { class:'con' },
    h('div', { class:'con-top' },
      h('span', { class:'con-count' }),
      h('span', { class:'con-time', title:'Сколько идёт показ' }, ic('clock'), h('span', { class:'con-timer', text:'0:00' })),
      h('span', { class:'con-clock', title:'Сейчас' }),
      h('span', { class:'grow' }),
      h('button', { type:'button', class:'btn', text:'Закончить показ', title:'Esc', onclick:() => showClose() })),
    h('div', { class:'con-main' },
      h('div', { class:'con-cur' }, h('div', { class:'con-lbl', text:'Сейчас на экране' }), h('div', { class:'con-box con-box-cur' })),
      h('div', { class:'con-side' },
        h('div', { class:'con-lbl', text:'Дальше' }), h('div', { class:'con-box con-box-next' }),
        h('div', { class:'con-btns' }, nav('back', 'Назад', -1), nav('next', 'Вперёд', 1)))),
    SHOW.mode === 'win' ? h('div', { class:'con-hint', text:'Окно со слайдами перетащите на проектор и нажмите в нём F — слайды во весь экран. В Windows второй экран должен быть в режиме «Расширить» (Win+P).' }) : null);
  root.append(SHOW.con);
  showTick();
}

/* Копия разложенного слайда k шириной w: текст и картинки те же, что в показе, масштаб — transform */
function showClone(k, w){
  const box = h('div', { class:'show-mini' });
  box.style.width = w + 'px'; box.style.height = Math.round(w * 9 / 16) + 'px';
  const wr = SHOW.cache.get(k);
  if (wr && SHOW.w){
    const c = wr.cloneNode(true);
    c.classList.add('on');
    c.style.left = c.style.top = '0';
    c.style.transform = 'scale(' + (w / SHOW.w) + ')';
    box.append(c);
  }
  else if (k >= SHOW.list.length) box.append(h('div', { class:'show-end', text:'Конец показа' }));
  return box;
}
function showConSync(){
  if (!SHOW.con) return;
  const n = SHOW.list.length, i = SHOW.i, w = SHOW.conWin, q = s => SHOW.con.querySelector(s);
  if (!SHOW.con.isConnected) return;
  q('.con-count').textContent = i < n ? 'Слайд ' + (i + 1) + ' из ' + n : 'Конец показа';
  const W = w.innerWidth, H = w.innerHeight;
  const cw = Math.max(160, Math.floor(Math.min((W - 72) * 0.64, (H - 170) * 16 / 9)));
  const nw = Math.max(120, Math.floor(Math.min(W - 72 - cw - 24, cw * 0.6)));
  q('.con-box-cur').replaceChildren(showClone(i, cw));
  q('.con-box-next').replaceChildren(i < n ? showClone(i + 1, nw) : h('div', { class:'show-mini con-none', style:'width:' + nw + 'px;height:' + Math.round(nw * 9 / 16) + 'px' }));
  q('.con-nav[aria-label="Назад"]').disabled = i <= 0;
}
/* 'win': текущий слайд в окне показа — по размеру окна, с чёрными полями */
function showOutSync(){
  if (SHOW.mode !== 'win' || !showPopOpen()) return;
  const d = SHOW.pop.document, v = d.querySelector('.show-out .show-view'); if (!v) return;
  const w = Math.max(1, Math.floor(Math.min(SHOW.pop.innerWidth, SHOW.pop.innerHeight * 16 / 9)));
  const i = SHOW.i;
  v.replaceChildren(i < SHOW.list.length ? showClone(i, w) : h('div', { class:'show-end', text:'Конец показа' }));
  d.querySelector('.show-out').dataset.i = String(i);
}
function showSync(){
  if (!showOn()) return;
  if (showPopOpen()) showPopVars(SHOW.pop);
  showConSync(); showOutSync();
}

/* Раз в секунду: время показа, часы; закрыли окно показа ('win') — показ окончен */
function showTick(){
  if (!showOn()) return;
  if (SHOW.mode === 'win' && !showPopOpen()){ showClose(); return; }
  if (!SHOW.con) return;
  const s = Math.floor((Date.now() - SHOW.t0) / 1000), hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60;
  const t = SHOW.con.querySelector('.con-timer'), c = SHOW.con.querySelector('.con-clock'), now = new Date();
  if (t) t.textContent = (hh ? hh + ':' + pad(mm) : mm) + ':' + pad(s % 60);
  if (c) c.textContent = pad(now.getHours()) + ':' + pad(now.getMinutes());
}

/* ----- Слайды ----- */
/* Слайд в обёртке нужного размера. Кадр раскладывается в 1920×1080 и масштабируется (fitSlide), заглушка — в 960×540 и увеличивается */
function showMake(u){
  const wrap = h('div', { class:'show-slide' });
  wrap._u = u;
  if (slideDrawn(u)){ wrap._sl = slideEl(u); wrap.append(wrap._sl); }   // и слайд с загруженной картинкой (этап 10.9.1)
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
  const w = SHOW.w;
  showMeasure();
  if (SHOW.w !== w) SHOW.cache.forEach(wr => { showSize(wr); wr._w = SHOW.w; });
  showSync();
}

/* Перейти на слайд i; i === число слайдов — экран «Конец показа» */
function showGo(i){
  if (!showOn()) return;
  showMeasure();
  const n = SHOW.list.length;
  i = Math.max(0, Math.min(n, i)); SHOW.i = i;
  const want = new Set([i - 1, i, i + 1].filter(k => k >= 0 && k < n));   // этот, соседние — готовы заранее
  SHOW.cache.forEach((wr, k) => { if (!want.has(k) || wr._w !== SHOW.w){ wr.remove(); SHOW.cache.delete(k); } });
  want.forEach(k => { if (!SHOW.cache.has(k)){ const wr = showMake(SHOW.list[k]); wr._w = SHOW.w; SHOW.cache.set(k, wr); } });
  SHOW.cache.forEach((wr, k) => wr.classList.toggle('on', k === i));
  let end = SHOW.view.querySelector('.show-end');
  if (i === n && !end) SHOW.view.append(h('div', { class:'show-end', text:'Конец показа' }));
  else if (i < n && end) end.remove();
  SHOW.count.textContent = i < n ? (i + 1) + ' / ' + n : '';
  SHOW.el.dataset.i = String(i);
  showSync();
}
function showStep(d){
  if (!showOn() || SHOW.opening) return;
  if (d > 0 && SHOW.i >= SHOW.list.length){ showClose(); return; }   // после «Конца показа» ещё раз вперёд — выход, как в PowerPoint
  showGo(SHOW.i + d);
}

/* Выход: в ленте выбран слайд, на котором остановились. Второе окно закрывается */
function showClose(opt){
  if (!showOn()) return;
  const u = SHOW.list[Math.min(SHOW.i, SHOW.list.length - 1)];
  clearTimeout(SHOW.idleT); clearTimeout(SHOW.popIdleT); clearInterval(SHOW.tick);
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  const pop = SHOW.pop;
  SHOW.el.remove();
  SHOW.el = SHOW.view = SHOW.count = SHOW.con = SHOW.conWin = SHOW.pop = null; SHOW.cache = new Map(); SHOW.fs = false; SHOW.touch = null; SHOW.mode = 'here';
  if (pop && !pop.closed) try { pop.close(); } catch(e){}
  if (fsEl){ const ex = document.exitFullscreen || document.webkitExitFullscreen; try { const p = ex.call(document); if (p && p.catch) p.catch(() => {}); } catch(e){} }
  try { window.focus(); } catch(e){}
  if (opt && opt.keepSel) return;
  const cur = u && unitById(u.id);
  if (!cur || screen !== 'sermon') return;
  if (inSlides()) selectBlock(cur.id);
  else { selId = cur.id; histSel(cur.id); }
}

/* Счётчик и курсор прячутся через 2 с без движения мыши (на пульте — нет) */
function showWake(){
  if (!showOn()) return;
  SHOW.el.classList.remove('idle');
  clearTimeout(SHOW.idleT);
  if (SHOW.mode === 'win') return;
  SHOW.idleT = setTimeout(() => { if (showOn()) SHOW.el.classList.add('idle'); }, 2000);
}

/* Мышь: щелчок — вперёд. Телефон: правая половина — вперёд, левая — назад, свайп влево / вправо. На пульте ('win') — только кнопки */
function showPointerDown(e){ SHOW.touch = { x:e.clientX, y:e.clientY, type:e.pointerType, btn:e.button }; }
function showPointerUp(e){
  const t = SHOW.touch; SHOW.touch = null;
  if (!t || e.button !== t.btn || SHOW.mode === 'win') return;
  const dx = e.clientX - t.x, dy = e.clientY - t.y;
  if (t.type === 'mouse'){ if (t.btn === 0) showStep(1); return; }
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5){ showStep(dx < 0 ? 1 : -1); return; }   // свайп
  if (Math.abs(dx) > 12 || Math.abs(dy) > 12) return;   // не нажатие и не свайп: прокрутка пальцем
  showStep(e.clientX < SHOW.el.clientWidth / 2 ? -1 : 1);
}

/* Клавиши во время показа — в любом окне (w — где нажали). F в окне показа ('win') — во весь экран */
function showKey(e, w){
  const k = e.key;
  if ((k === 'Enter' || k === ' ') && e.target && e.target.closest && e.target.closest('.con button, .show-ask button')){ e.stopImmediatePropagation(); return; }   // кнопка пульта нажимается сама
  if (k === 'F5' || (k.toLowerCase() === 'r' && (e.ctrlKey || e.metaKey) && w !== window)){ e.preventDefault(); e.stopImmediatePropagation(); return; }   // второе окно перезагрузкой не стереть
  if (e.ctrlKey || e.metaKey || e.altKey){ e.stopImmediatePropagation(); return; }   // сочетания браузера работают, а формы (Ctrl+S, Ctrl+Z) под показом — нет
  e.stopImmediatePropagation();
  if (!showOn()) return;
  const popFs = w !== window && w.document.fullscreenElement;
  if (k === 'Escape'){ e.preventDefault(); if (!popFs) showClose(); return; }   // в полном экране окна показа Esc только выходит из него
  if (SHOW.opening) { e.preventDefault(); return; }
  if (e.code === 'KeyF' && SHOW.mode === 'win' && w === SHOW.pop){ e.preventDefault(); showPopFull(); return; }
  if (SHOW_NEXT.includes(k)){ e.preventDefault(); showStep(1); }
  else if (SHOW_PREV.includes(k)){ e.preventDefault(); showStep(-1); }
  else if (k === 'Home'){ e.preventDefault(); showGo(0); }
  else if (k === 'End'){ e.preventDefault(); showGo(SHOW.list.length - 1); }
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
  showKey(e, window);
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
window.addEventListener('pagehide', () => { if (showPopOpen()) try { SHOW.pop.close(); } catch(e){} });   // форму закрыли — второе окно тоже

/* Кнопка в шапке конспекта */
function showButton(){
  return h('button', { type:'button', class:'btn hd-show', title:'Показ слайдов с выбранного. F5 — с первого, Shift+F5 — с выбранного. При двух экранах слайды — на втором, пульт — здесь', 'aria-label':'Показ слайдов', onclick:() => showOpen(true) },
    ic('play'), h('span', { text:'Показ' }));
}
