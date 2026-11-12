'use strict';

/* ========= Движение (этап 7.6, решения — crosspect/motion-7.6.md в проекте claude.ai) =========
   Анимации нужны, чтобы человек видел, что произошло: сохранилось, слайд переехал, конспект закрыт для правки.
   Сами слайды (`.sl-*`: сцена, миниатюры, JPEG) не анимируются никогда.
   Правила:
   • длительности — CSS-переменные `--motion-fast` (120 мс), `--motion` (200 мс), `--motion-slow` (250 мс), кривая `--ease-out`;
   • анимируем только transform и opacity (у переключателя статуса ещё цвет); без библиотек: CSS и Web Animations API;
   • «Уменьшить движение» (`prefers-reduced-motion: reduce`): переменные обнуляются, JS ничего не запускает (`MOTION.off()`);
     подсветки остаются, но без увеличения и сдвигов. Исключение — анимация сохранения знака (logo.js): решение Виталия 12 ноября;
   • на время снятия JPEG и ZIP (`motionPause` / `motionResume`) движение выключено: класс `no-motion` на <html>, бегущие анимации
     доводятся до конца, новые не запускаются;
   • постоянных анимаций на миниатюрах нет; в фоновой вкладке (`document.hidden`) бесконечные анимации стоят (класс `page-hidden`). */
const MOTION = {
  paused:0,
  live:new Set(),   // бегущие анимации (чтобы довести их до конца на время экспорта)
  mq:window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null,
  reduced(){ return !!(this.mq && this.mq.matches); },
  off(){ return this.paused > 0 || this.reduced(); },
  /* Длительность из CSS-переменной, мс */
  ms(name, dflt){
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return isNaN(v) ? dflt : v;
  },
  ease:'cubic-bezier(.22,.61,.36,1)',
  checkUntil:0,   // галочка автосохранения горит до этого времени
  ui:{ id:'', lock:false, swPrev:null, flare:false }   // шапка проповеди: что было на прошлой отрисовке
};

/* Запустить анимацию элемента; выключено — ничего не делает (возвращает null) */
function motionAnimate(el, keyframes, ms, opts){
  if (!el || !el.animate || MOTION.off() || ms <= 0) return null;
  const a = el.animate(keyframes, Object.assign({ duration:ms, easing:MOTION.ease }, opts || {}));
  MOTION.live.add(a);
  const done = () => MOTION.live.delete(a);
  a.addEventListener('finish', done); a.addEventListener('cancel', done);
  return a;
}
function motionPause(){
  MOTION.paused++;
  document.documentElement.classList.add('no-motion');
  MOTION.live.forEach(a => { try { a.finish(); } catch(e){} });
  MOTION.live.clear();
}
function motionResume(){
  MOTION.paused = Math.max(0, MOTION.paused - 1);
  if (!MOTION.paused) document.documentElement.classList.remove('no-motion');
}
document.addEventListener('visibilitychange', () => document.documentElement.classList.toggle('page-hidden', document.hidden));

/* Подсветка жёлтой рамкой (#ffde59) на `ms` (по умолчанию ~0,6 с): класс `hl`, дальше решает CSS. Остаётся и при «Уменьшить движение» */
function motionHL(el, ms){
  if (!el) return;
  ms = ms || 600;
  el.style.setProperty('--hl-ms', ms + 'ms');
  el.classList.remove('hl'); void el.offsetWidth; el.classList.add('hl');
  clearTimeout(el._hlT);
  el._hlT = setTimeout(() => { el.classList.remove('hl'); el.style.removeProperty('--hl-ms'); }, ms);
}

/* ----- Лента: FLIP -----
   run() меняет данные и перерисовывает экран. До этого запоминаем, где стояли миниатюры, после — двигаем только те, что сдвинулись:
   они «доезжают» от старого места к новому. Фон при этом не перерисовывается (картинка из кеша 7.3/7.5).
   o.add — id нового слайда (проявляется с увеличением 0,96 → 1), o.remove — id удалённого (гаснет и схлопывается, остальные подъезжают),
   o.hl — id слайда для жёлтой рамки */
function motionFilm(run, o){
  o = o || {};
  const film = typeof inSlides === 'function' && inSlides() ? filmEl : null;
  if (!film || MOTION.off()){ run(); if (o.hl) hlThumb(o.hl); return; }
  const before = new Map();
  film.querySelectorAll('.st-box[data-box]').forEach(b => before.set(b.dataset.box, b.getBoundingClientRect()));
  let ghost = null;
  if (o.remove && before.has(o.remove)){
    const bx = film.querySelector('.st-box[data-box="' + o.remove + '"]');
    if (bx) ghost = { node:bx.cloneNode(true), r:before.get(o.remove) };
  }
  run();
  const nf = typeof filmEl !== 'undefined' ? filmEl : null;
  if (o.hl) hlThumb(o.hl);
  if (!nf || !nf.isConnected) return;
  const d = MOTION.ms('--motion', 200);
  nf.querySelectorAll('.st-box[data-box]').forEach(b => {
    const id = b.dataset.box, was = before.get(id);
    if (!was){ if (id === o.add) motionAnimate(b, [{ opacity:0, transform:'scale(.96)' }, { opacity:1, transform:'none' }], d); return; }
    const now = b.getBoundingClientRect(), dx = was.left - now.left, dy = was.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    motionAnimate(b, [{ transform:'translate(' + dx + 'px,' + dy + 'px)' }, { transform:'none' }], d);
  });
  if (ghost){
    const g = ghost.node, wrap = document.createElement('div');
    wrap.className = 'film-ghost';
    wrap.style.cssText = 'left:' + ghost.r.left + 'px;top:' + ghost.r.top + 'px;width:' + ghost.r.width + 'px;height:' + ghost.r.height + 'px';
    g.removeAttribute('data-box'); g.querySelectorAll('[data-id]').forEach(x => x.removeAttribute('data-id'));
    wrap.append(g); document.body.append(wrap);
    const a = motionAnimate(wrap, [{ opacity:1, transform:'none' }, { opacity:0, transform:'scale(.92)' }], d, { fill:'forwards' });
    if (a) a.addEventListener('finish', () => wrap.remove()); else wrap.remove();
    setTimeout(() => wrap.remove(), d + 200);
  }
}
function hlThumb(id){
  const c = typeof filmEl !== 'undefined' && filmEl && filmEl.querySelector('.st[data-id="' + id + '"]');
  if (c) motionHL(c, 600);
}

/* ----- Переход «Слайды ↔ Текст» -----
   View Transitions: общее растворение, выбранная миниатюра «перетекает» в свой блок и обратно (`view-transition-name` — только у выбранного
   слайда). Браузер не умеет — обычное мгновенное переключение. run() должен перерисовать экран синхронно */
function viewTransition(run, o){
  o = o || {};
  if (MOTION.off() || typeof document.startViewTransition !== 'function'){ run(); return false; }
  const named = [];
  const name = el => { if (el){ el.style.viewTransitionName = 'sel-slide'; named.push(el); } };
  if (o.from) name(o.from());
  let t;
  try {
    t = document.startViewTransition(() => { named.forEach(el => { el.style.viewTransitionName = ''; }); named.length = 0; run(); if (o.to) name(o.to()); });
  } catch(e){ run(); return false; }
  const clear = () => { named.forEach(el => { el.style.viewTransitionName = ''; }); };
  t.finished.then(clear, clear);
  return true;
}

/* ----- Галочка автосохранения: рядом со статусом в шапке, прорисовывается и гаснет через ~1,5 с ----- */
const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ck" pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
function checkEl(){ return h('span', { id:'hd-check', class:'hd-check', html:CHECK_SVG, title:'Сохранено в облаке' }); }
function motionCheck(){
  const el = $('#hd-check'); if (!el) return;
  MOTION.checkUntil = Date.now() + 1500;
  el.classList.remove('gone'); el.classList.add('on');
  const p = el.querySelector('.ck');
  if (p && p.getAnimations) p.getAnimations().forEach(a => a.cancel());
  const d = MOTION.ms('--motion-slow', 250);
  motionAnimate(p, [{ strokeDashoffset:1 }, { strokeDashoffset:0 }], Math.max(d, 280));
  clearTimeout(el._ckT);
  el._ckT = setTimeout(() => {
    const out = motionAnimate(el, [{ opacity:1 }, { opacity:0 }], MOTION.ms('--motion', 200), { fill:'forwards' });
    const end = () => { el.classList.remove('on'); el.classList.add('gone'); };
    if (out) out.addEventListener('finish', end); else end();
  }, 1500);
}

/* ----- Шапка проповеди: переезд подложки статуса, замок, вспышка клина -----
   Шапка перерисовывается целиком, поэтому до перерисовки запоминаем положение выбранного статуса (`motionBeforeTopbar`),
   а после неё (`motionAfterTopbar`) рисуем подложку, которая переезжает на новое место. */
function motionBeforeTopbar(){
  const on = document.querySelector('.stswitch .sw-opt.on');
  MOTION.ui.swPrev = on ? { r:on.getBoundingClientRect(), bg:getComputedStyle(on).backgroundColor, key:on.className } : null;
}
function motionAfterTopbar(){
  const ui = MOTION.ui, same = typeof state !== 'undefined' && state && ui.id === state.id;
  const lock = document.querySelector('.lockbadge'), had = ui.lock;
  ui.id = typeof state !== 'undefined' && state ? state.id : '';
  ui.lock = !!lock;
  if (same && !MOTION.off()){
    if (lock && !had) motionAnimate(lock, [{ opacity:0, transform:'scale(.4)' }, { opacity:1, transform:'none' }], MOTION.ms('--motion', 200));
    else if (!lock && had){
      const btn = document.querySelector('.topbar .hd-edit');
      if (btn){
        const g = h('span', { class:'lockbadge gone', html:'' }); g.append(ic('lock')); btn.append(g);
        const a = motionAnimate(g, [{ opacity:1, transform:'none' }, { opacity:0, transform:'scale(.4)' }], MOTION.ms('--motion', 200), { fill:'forwards' });
        if (a) a.addEventListener('finish', () => g.remove()); else g.remove();
        setTimeout(() => g.remove(), 500);
      }
    }
  }
  // подложка статуса
  const prev = ui.swPrev; ui.swPrev = null;
  const sw = document.querySelector('.stswitch'), on = sw && sw.querySelector('.sw-opt.on');
  if (prev && on && same && !MOTION.off() && prev.key !== on.className){
    const cs = getComputedStyle(on), nr = on.getBoundingClientRect(), sr = sw.getBoundingClientRect();
    const bgNew = cs.backgroundColor;
    const pill = h('span', { class:'sw-pill' });
    pill.style.cssText = 'left:' + (nr.left - sr.left - sw.clientLeft) + 'px;top:' + (nr.top - sr.top - sw.clientTop) + 'px;width:' + nr.width + 'px;height:' + nr.height + 'px';
    sw.prepend(pill);
    on.classList.add('pill-wait');
    const dx = prev.r.left - nr.left, sx = prev.r.width / nr.width;
    const a = motionAnimate(pill, [
      { transform:'translateX(' + dx + 'px) scaleX(' + sx + ')', backgroundColor:prev.bg },
      { transform:'none', backgroundColor:bgNew }], MOTION.ms('--motion', 200));
    const end = () => { pill.remove(); on.classList.remove('pill-wait'); };
    if (a) a.addEventListener('finish', end); else end();
    setTimeout(end, 500);
  }
  // вспышка клина: только когда человек сам переключил на «Готов к вёрстке»
  if (ui.flare){ ui.flare = false; motionFlare(); }
  // галочка не пропадает, если шапку перерисовали, пока она горит
  const ck = $('#hd-check');
  if (ck && Date.now() < MOTION.checkUntil) ck.classList.add('on');
}
/* Жёлтый клин знака в шапке один раз коротко вспыхивает (~400 мс) */
function motionFlare(){
  if (MOTION.off()) return;
  document.querySelectorAll('.topbar .logo-mark .lg-c').forEach(p => {
    const base = getComputedStyle(p).fill;
    motionAnimate(p, [{ fill:base }, { fill:'#fffbe3', offset:.4 }, { fill:base }], 400, { easing:'ease-out' });
  });
}

/* ----- Главная: заготовки карточек и плывущий фон ----- */
function skeletonCards(){
  return h('div', { class:'cards', role:'status', 'aria-label':'Загружаю проповеди…', 'aria-busy':'true' },
    [0, 1, 2, 3].map(() => h('div', { class:'sk-card' }, h('div', { class:'sk-img' }), h('div', { class:'sk-line w1' }), h('div', { class:'sk-line w2' }), h('div', { class:'sk-line w3' }))));
}
/* Размытая картинка из генератора фона (7.3/7.5) в цветах формата по умолчанию; у System Template — ползунки прежнего фона. Одна картинка, анимируется только transform */
function homeBg(){
  const el = h('div', { class:'home-bg', 'aria-hidden':'true' });
  try { const cfg = slidesCfg(); el.style.backgroundImage = bgImage(formatBg(cfg.defaultFormat, cfg) || BG_START); } catch(e){}
  return el;
}
