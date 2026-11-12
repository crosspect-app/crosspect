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

/* ----- Заставка при открытии формы (этап 7.7) -----
   Знак собирается, шевелится зерно; заставка держится не меньше ~1,5 с от открытия страницы при любой скорости связи,
   потом расплывается (размытие и проявление, ~500 мс) в список. Только при открытии формы: на главную из проповеди — без неё.
   «Уменьшить движение» — без задержки и без размытия */
const INTRO = { ms:1500, done:false, timer:0 };
function introHold(){
  if (INTRO.done) return false;
  if (MOTION.reduced() || performance.now() >= INTRO.ms){ INTRO.done = true; return false; }
  if (!INTRO.timer) INTRO.timer = setTimeout(() => { INTRO.done = true; if (typeof route === 'function') route(); }, Math.max(0, INTRO.ms - performance.now()) + 20);
  return true;
}
/* Экран входа уходит: его узлы — поверх, расплываются и гаснут, новый экран проявляется из лёгкого размытия */
function gateDissolve(){
  if (MOTION.off()) return null;
  const nodes = [...mainEl.querySelectorAll(':scope > .gate, :scope > .gate-fx')];
  if (!nodes.some(n => n.classList.contains('gate'))) return null;
  const wrap = h('div', { class:'gate-ghost', 'aria-hidden':'true' });
  nodes.forEach(n => wrap.append(n));
  document.body.append(wrap);
  const a = motionAnimate(wrap, [{ opacity:1, filter:'blur(0px)' }, { opacity:0, filter:'blur(18px)' }], 520, { fill:'forwards', easing:'ease-in' });
  if (a) a.addEventListener('finish', () => wrap.remove()); else wrap.remove();
  setTimeout(() => wrap.remove(), 1200);
  return wrap;
}
function gateReveal(){
  if (MOTION.off()) return;
  [...mainEl.children].forEach(el => { if (!el.classList.contains('home-bg')) motionAnimate(el, [{ opacity:0, filter:'blur(8px)' }, { opacity:1, filter:'blur(0px)' }], 520, { easing:'ease-out' }); });
  const bg = mainEl.querySelector(':scope > .home-bg'); if (bg) motionAnimate(bg, [{ opacity:0 }, { opacity:getComputedStyle(bg).opacity }], 700, { easing:'ease-out' });
  topbar.querySelectorAll(':scope > *').forEach(x => motionAnimate(x, [{ opacity:0 }, { opacity:1 }], 520));
}

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
   run() меняет данные и обновляет ленту (с этапа 7.7 — те же узлы, syncSlides). До этого запоминаем, где стояли миниатюры
   (как их видно на экране, со сдвигами перетаскивания), после — двигаем только те, что сдвинулись: они «доезжают» от старого
   места к новому. Фон при этом не перерисовывается (картинка из кеша 7.3/7.5).
   o.add — id нового слайда (вырастает 0,85 → 1 и проявляется), o.remove — id удалённого (гаснет и схлопывается, остальные подъезжают),
   o.hl — id слайда для жёлтой рамки, o.lift — id слайда, который отпустили после перетаскивания (опускается из-под указателя),
   o.done — после запуска движения (прокрутить ленту к выбранному: положение берётся по раскладке, сдвиги не мешают) */
function motionFilm(run, o){
  o = o || {};
  const film = typeof inSlides === 'function' && inSlides() ? filmEl : null;
  const done = () => { if (o.hl) hlThumb(o.hl); if (o.done) o.done(); };
  if (!film || MOTION.off()){ run(); done(); return; }
  const before = new Map();
  film.querySelectorAll('.st-box[data-box]').forEach(b => before.set(b.dataset.box, b.getBoundingClientRect()));
  let ghost = null;
  if (o.remove && before.has(o.remove)){
    const bx = film.querySelector('.st-box[data-box="' + o.remove + '"]');
    if (bx) ghost = { node:bx.cloneNode(true), r:before.get(o.remove) };
  }
  // бегущие сдвиги прошлого действия — довести до конца, иначе новый снимок возьмёт их середину как «прежнее место»
  film.querySelectorAll('.st-box[data-box]').forEach(b => { if (b._flip){ try { b._flip.cancel(); } catch(e){} b._flip = null; } });
  run();
  const nf = typeof filmEl !== 'undefined' ? filmEl : null;
  if (!nf || !nf.isConnected){ done(); return; }
  const d = MOTION.ms('--motion-slow', 250);
  nf.querySelectorAll('.st-box[data-box]').forEach(b => {
    const id = b.dataset.box, was = before.get(id);
    if (!was){
      if (id === o.add) b._flip = motionAnimate(b, [{ opacity:0, transform:'scale(.85)' }, { opacity:1, transform:'none' }], d);
      return;
    }
    const now = b.getBoundingClientRect();
    const dx = (was.left + was.width / 2) - (now.left + now.width / 2), dy = (was.top + was.height / 2) - (now.top + now.height / 2);   // по центрам: у приподнятого слайда другой масштаб
    if (id === o.lift){
      const sc = was.width / (now.width || 1);
      b._flip = motionAnimate(b, [{ transform:'translate(' + dx + 'px,' + dy + 'px) scale(' + sc + ')', boxShadow:'0 14px 34px rgba(0,0,0,.55)', zIndex:5 },
        { transform:'none', boxShadow:'0 0 0 rgba(0,0,0,0)', zIndex:5 }], d);
      return;
    }
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    b._flip = motionAnimate(b, [{ transform:'translate(' + dx + 'px,' + dy + 'px)' }, { transform:'none' }], d);
  });
  if (ghost){
    const g = ghost.node, wrap = document.createElement('div');
    wrap.className = 'film-ghost';
    wrap.style.cssText = 'left:' + ghost.r.left + 'px;top:' + ghost.r.top + 'px;width:' + ghost.r.width + 'px;height:' + ghost.r.height + 'px';
    g.removeAttribute('data-box'); g.querySelectorAll('[data-id]').forEach(x => x.removeAttribute('data-id'));
    wrap.append(g); document.body.append(wrap);
    const a = motionAnimate(wrap, [{ opacity:1, transform:'none' }, { opacity:0, transform:'scale(.85)' }], d, { fill:'forwards' });
    if (a) a.addEventListener('finish', () => wrap.remove()); else wrap.remove();
    setTimeout(() => wrap.remove(), d + 200);
  }
  done();
}
function hlThumb(id){
  const c = typeof filmEl !== 'undefined' && filmEl && filmEl.querySelector('.st[data-id="' + id + '"]');
  if (c) motionHL(c, 1000);
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
function skeletonCards(){   // с этапа 7.7 — строки таблицы
  return h('div', { class:'ptable sk-table', role:'status', 'aria-label':'Загружаю конспекты…', 'aria-busy':'true' },
    [0, 1, 2, 3].map(() => h('div', { class:'sk-card sk-row' }, h('div', { class:'sk-line w1' }), h('div', { class:'sk-line w2' }), h('div', { class:'sk-line w3' }))));
}
/* Фон главной (этап 7.8): стена из слайдов-заставок с библейскими названиями на русском, украинском, польском и английском —
   в цветах формата по умолчанию, затемнённая, с зерном. Поверх — тёмная дымка с одним «окном», которое очень медленно
   плывёт по экрану и открывает разные части стены. Стена собирается один раз (кеш по формату), дальше узел переиспользуется.
   «Уменьшить движение» — дымка стоит */
const WALL_TITLES = ['Если я не имею любви', 'Вера без дел мертва', 'Свет миру', 'Хлеб жизни', 'Не бойся, только веруй', 'Любовь долготерпит',
  'Сила в немощи', 'Плоды Духа', 'Мир оставляю вам', 'Добрый пастырь', 'Соль земли', 'Новое творение', 'Благодать и истина', 'Да будет свет',
  'Встань и иди', 'Я есмь путь', 'Світло світу', 'Хліб життя', 'Не бійся, тільки віруй', 'Добрий пастир', 'Сіль землі', 'Віра без діл мертва',
  'Любов довготерпить', 'Światło świata', 'Chleb życia', 'Miłość cierpliwa jest', 'Dobry pasterz', 'Nie lękaj się', 'Sól ziemi', 'Nowe stworzenie',
  'Łaska i prawda', 'Light of the World', 'Bread of Life', 'Love Is Patient', 'The Good Shepherd', 'Do Not Be Afraid', 'Salt of the Earth',
  'Grace and Truth', 'Let There Be Light'];
const WALL = { key:'', el:null, cols:8, rows:6 };
function homeBg(){
  const el = h('div', { class:'home-bg', 'aria-hidden':'true' }, h('div', { class:'hb-grain' }), h('div', { class:'hb-haze' }));
  let cfg = null, bg = null;
  try { cfg = slidesCfg(); bg = formatBg(cfg.defaultFormat, cfg); } catch(e){}
  const key = JSON.stringify(bg);
  if (!WALL.el || WALL.key !== key){ WALL.key = key; WALL.el = null; WALL.fresh = true; }
  if (!WALL.el){
    WALL.el = h('div', { class:'hb-wall' });
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;   // повторяемо: у всех одна и та же стена
    const list = WALL_TITLES.slice().sort(() => rnd() - .5), vars = bgVars(bg);
    for (let i = 0; i < WALL.cols * WALL.rows; i++){
      const b = { id:'wall' + i, type:'splash', meta:{ title:list[i % list.length], date:'', firstName:'', lastName:'' } };
      const sl = slideEl(b); sl.removeAttribute('data-id');   // не слайд проповеди: раскладка проповеди его не трогает
      const st = sl.querySelector('.sl-stage'); Object.keys(vars).forEach(k => st.style.setProperty(k, vars[k]));
      sl._b = b;
      WALL.el.append(h('div', { class:'hb-cell' }, sl));
    }
  }
  el.prepend(WALL.el);
  return el;
}
/* Разложить стену (один раз, когда она уже на странице): только название посередине, как «Заставка: только название» */
function layoutWall(){
  if (!WALL.el) return;
  if (!WALL.fresh){ WALL.el.classList.add('ready'); return; }
  setTimeout(() => {   // после списка: главная показывается сразу, стена (~0,1 с работы) проявляется следом
    if (!WALL.fresh || !WALL.el || !WALL.el.isConnected) return;
    WALL.fresh = false;
    const keep = SLIDES_TRY;
    SLIDES_TRY = mergeSlides(slidesCfg(), { kinds:{ splash:{ titleOnly:true } } });
    try { WALL.el.querySelectorAll('.sl').forEach(sl => fitSlide(sl, sl._b)); }
    finally { SLIDES_TRY = keep; }
    WALL.el.classList.add('ready');
  }, 0);
}
