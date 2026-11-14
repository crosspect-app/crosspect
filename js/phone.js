'use strict';

/* ========= Правка с телефона (этап 10.1.1) =========
   Поле, в котором печатают, не должно прятаться под экранной клавиатурой и под липкой шапкой. Клавиатура уменьшает не окно (innerHeight),
   а видимую часть (visualViewport), поэтому браузер сам прокручивает страницу неточно: курсор приходится вести вручную.
   Только телефон (isPhone, util.js); на компьютере ничего не происходит. css: scroll-margin у полей — запас под шапку. */
const typingField = () => {
  const a = document.activeElement;
  return a && a.matches && a.matches('.rich, textarea, input:not([type=checkbox]):not([type=radio])') && !a.closest('.topbar, .overlay') ? a : null;
};
/* Прокрутить страницу так, чтобы курсор (у обычных полей — само поле) был ниже шапки и выше клавиатуры.
   vvH — высота видимой части; по умолчанию visualViewport.height (тест подставляет свою: клавиатуру в нём не нажать) */
function revealCaret(vvH){
  const f = typingField(); if (!f) return false;
  const vv = window.visualViewport, h0 = vvH || (vv ? vv.height : innerHeight), off = vvH ? 0 : (vv ? vv.offsetTop : 0);
  let r = null;
  if (f.isContentEditable){
    const sel = getSelection();
    if (sel && sel.rangeCount && f.contains(sel.anchorNode)){
      const rg = sel.getRangeAt(0).cloneRange(); rg.collapse(false);
      r = rg.getClientRects()[0] || (rg.startContainer.nodeType === 1 ? rg.startContainer.getBoundingClientRect() : null);
    }
  }
  if (!r || (!r.height && !r.width)) r = f.getBoundingClientRect();
  const topLimit = topbar.getBoundingClientRect().bottom + 8, bottomLimit = off + h0 - 12;
  const dy = r.bottom > bottomLimit ? r.bottom - bottomLimit : r.top < topLimit ? r.top - topLimit : 0;
  if (dy) window.scrollBy(0, dy);
  return !!dy;
}
const revealSoon = () => { if (isPhone()) requestAnimationFrame(() => revealCaret()); };
if (window.visualViewport) window.visualViewport.addEventListener('resize', revealSoon);   // клавиатура выехала или уехала
document.addEventListener('focusin', () => { if (isPhone()) setTimeout(() => revealCaret(), 300); });   // iOS поднимает клавиатуру с задержкой
document.addEventListener('input', revealSoon);   // текст вырос — курсор ушёл вниз
