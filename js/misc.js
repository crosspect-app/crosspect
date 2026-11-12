'use strict';

/* ========= Мелочи ========= */
/* Уведомления (этап 7.6): все одного вида, выезжают снизу (сдвиг ~12 px и проявление) и уходят так же; несколько сразу — стопкой,
   новое снизу. У каждого тонкая полоска внизу: сколько осталось до скрытия; наведение мышью ставит отсчёт на паузу.
   То же сообщение, пока оно на экране, не множится, а начинает отсчёт заново */
function toast(msg, actionLabel, action){
  const total = actionLabel ? 6000 : 2400;
  const same = [...toastBox.children].find(x => !x._gone && x._msg === msg && !actionLabel && !x._act);
  if (same){ same._restart(); return; }
  const el = h('div', { class:'toast show', role:'status' }, h('span', { text:msg }));
  el._msg = msg; el._act = !!actionLabel;
  const bar = h('i', { class:'toast-bar' });
  let left = total, t0 = 0, timer = 0, anim = null;
  const hide = () => {
    if (el._gone) return;
    el._gone = true; clearTimeout(timer);
    const out = motionAnimate(el, [{ opacity:1, transform:'none' }, { opacity:0, transform:'translateY(12px)' }], MOTION.ms('--motion-fast', 120), { fill:'forwards' });
    if (out) out.addEventListener('finish', () => el.remove()); else el.remove();
  };
  const run = () => { t0 = Date.now(); clearTimeout(timer); timer = setTimeout(hide, Math.max(left, 0)); if (anim) anim.play(); };
  const stop = () => { clearTimeout(timer); left -= Date.now() - t0; if (anim) anim.pause(); };
  el._restart = () => { left = total; if (anim){ anim.cancel(); anim.play(); } run(); };
  if (actionLabel) el.append(h('button', { type:'button', onclick:() => { hide(); action(); } }, actionLabel));
  el.append(bar);
  el.addEventListener('mouseenter', stop);
  el.addEventListener('mouseleave', run);
  toastBox.append(el);
  while (toastBox.children.length > 4) toastBox.firstChild.remove();
  motionAnimate(el, [{ opacity:0, transform:'translateY(12px)' }, { opacity:1, transform:'none' }], MOTION.ms('--motion', 200));
  anim = motionAnimate(bar, [{ transform:'scaleX(1)' }, { transform:'scaleX(0)' }], total, { easing:'linear', fill:'forwards' });
  run();
}
function closeMenu(){ menuEl.classList.remove('open'); }
document.addEventListener('click', e => { if (!menuEl.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's'){ e.preventDefault(); if (screen === 'sermon') saveSermon(); }
  if (e.key === 'Escape'){ closeSheet(); closeSettings(); closeMenu(); closeTrPanel(); }
});

