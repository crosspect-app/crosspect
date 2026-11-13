'use strict';

/* ========= Логотип Crosspect (этап 7.4, решения — crosspect/logo.md в проекте claude.ai) =========
   Знак — речевой пузырь с хвостиком слева внизу; пустота между тремя частями — латинский крест. Левая часть и верхняя правая — кремовые,
   нижний правый клин — жёлтый. В светлом виде («Текст») знак одноцветный тёмный, клин — тёмно-жёлтый (цвета — в CSS, `.logo-mark`).
   Рядом с надписью CROSSPECT (Unbounded Bold, текст «Crosspect» + CSS) знак стоит в шапке главной, на экране входа и в шапке проповеди
   (там — один знак без надписи).

   Анимация сохранения (~1,9 с): все части гаснут (#2e2e2e), потом по очереди загораются зелёным (#5ad17a): левая, верхняя правая, клин —
   и цвета возвращаются. Части привязаны к настоящим стадиям: левая — «записано в браузере» (черновик), верхняя правая — «отправлено»
   (запрос в облако ушёл), клин — «подтверждено сервером». Если облако не приняло, нужная часть остаётся серой до следующего сохранения
   (нет сети — горит только левая; конфликт, замок, ошибка — левая и верхняя правая). Без входа (файл) проходят все части подряд.
   Проигрывается всегда, настройка системы «уменьшить анимацию» (`prefers-reduced-motion`) не учитывается: решение Виталия 12 ноября 2026
   (в Windows она часто выключена, а знак — единственный индикатор сохранения без текста). Без библиотек: SVG + CSS (`transition: fill .3s`).
   Состояние `LG.level`: 0 — обычные цвета; 1 — всё погасло; 2 — горит левая; 3 — ещё верхняя правая; 4 — ещё клин (потом снова 0). */
const LOGO_VIEW = '68 112 484 448';
const LOGO_PATHS = [
  ['lg-a', 'M276.5 150 L279 241 Q279 255 265 255 H192 L160 265 A29.5 29.5 0 0 0 160 324 H265 Q279 324 279 338 V480 Q279 494 265 494 H232 L118 546 Q104 553 108 538 L146 494 H140 Q74 494 74 420 V352 Q74 318 102 290 Q180 202 256 141 Q276 125 276.5 150 Z'],
  ['lg-b', 'M359 125 L478 118 A68 68 0 0 1 546 186 V242 Q546 256 532 256 H359 Q345 256 345 242 V139 Q345 125 359 125 Z'],
  ['lg-c', 'M359 322 H508 Q530 322 512 337 L361 482.5 Q345 497.7 345 476 V336 Q345 322 359 322 Z']
];
const LG = { level:0, want:0, timer:0, STEP:350, HOLD:600 };

const logoSVG = () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + LOGO_VIEW + '" aria-hidden="true" focusable="false">' +
  LOGO_PATHS.map(([c, d]) => '<path class="' + c + '" d="' + d + '"/>').join('') + '</svg>';
/* Знак; цвета и анимация — по `data-lg`, как у остальных знаков на странице (шапка перерисовывается, а анимация не обрывается) */
function logoMark(){ return h('span', { class:'logo-mark', 'data-lg':String(LG.level), html:logoSVG() }); }
/* Знак с надписью: надпись в тексте «Crosspect», заглавными её делает CSS */
function logoLockup(cls, props){
  return h(cls === 'gate-logo' ? 'div' : 'a', Object.assign({ class:cls }, props || {}), logoMark(), h('span', { class:'logo-t', text:'Crosspect' }));
}

function logoPaint(){ document.querySelectorAll('.logo-mark:not(.exp-mark)').forEach(m => m.setAttribute('data-lg', String(LG.level))); }
/* Дойти до стадии `want` (2 — записано в браузере, 3 — отправлено, 4 — подтверждено сервером): по одной части за STEP, чтобы быструю запись было видно */
function logoTo(want){
  LG.want = want;
  if (want < LG.level){ clearTimeout(LG.timer); LG.timer = 0; LG.level = want; logoPaint(); }   // не приняли: часть снова серая
  logoTick();
}
function logoTick(){
  if (LG.timer) return;
  if (LG.level < LG.want){
    LG.level++; logoPaint();
    LG.timer = setTimeout(() => { LG.timer = 0; logoTick(); }, LG.STEP);
  } else if (LG.level === 4){   // всё горит зелёным: подержать и вернуть обычные цвета
    LG.timer = setTimeout(() => { LG.timer = 0; LG.level = LG.want = 0; logoPaint(); }, LG.HOLD);
  }
}
function logoReset(){ clearTimeout(LG.timer); LG.timer = 0; LG.level = LG.want = 0; logoPaint(); }
