'use strict';

/* ========= Мелочи ========= */
function toast(msg, actionLabel, action){
  clearTimeout(toastTimer);
  toastEl.innerHTML = '';
  toastEl.append(h('span', { text:msg }));
  if (actionLabel) toastEl.append(h('button', { type:'button', onclick:() => { toastEl.classList.remove('show'); action(); } }, actionLabel));
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), actionLabel ? 6000 : 2400);
}
function closeMenu(){ menuEl.classList.remove('open'); }
document.addEventListener('click', e => { if (!menuEl.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's'){ e.preventDefault(); if (screen === 'sermon') saveFile(); }
  if (e.key === 'Escape'){ closeSheet(); closeSettings(); closeMenu(); closeTrPanel(); }
});

