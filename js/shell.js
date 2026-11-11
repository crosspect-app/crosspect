'use strict';

/* ========= Каркас страницы ========= */
const app = $('#app');
const statusEl = h('div', { class:'statusbar', id:'status' });
const mainEl = h('main', { class:'wrap', id:'main' });
/* Пункты сворачивания работают только в редакторе: в просмотре блоки не сворачиваются */
const foldBtns = [];
const menuItem = (icon, label, fn, fold) => {
  const b = h('button', { type:'button', onclick:() => { closeMenu(); fn(); } }, ic(icon), label);
  if (fold) foldBtns.push(b);
  return b;
};
const isSlide = b => TYPES[b.type].slide;
const menuEl = h('div', { class:'menu', id:'menu' },
  menuItem('newdoc', 'Новая проповедь', () => newSermon()),
  menuItem('open', 'Открыть файл', () => fileInput.click()),
  h('div', { class:'menu-sep' }),
  menuItem('fold', 'Свернуть все блоки', () => foldWhere(() => true, () => true, 'Все блоки свёрнуты'), true),
  menuItem('unfold', 'Развернуть все блоки', () => foldWhere(() => true, () => false, 'Все блоки развёрнуты'), true),
  menuItem('check', 'Свернуть готовые слайды', () => foldWhere(isSlide, b => !!b.done, 'Готовые свёрнуты, остальные слайды открыты'), true),
  menuItem('fold', 'Свернуть неготовые слайды', () => foldWhere(isSlide, b => !b.done, 'Неготовые свёрнуты, готовые открыты'), true),
  menuItem('note', 'Свернуть заметки оператору', () => foldWhere(b => !isSlide(b), () => true, 'Заметки оператору свёрнуты'), true),
  h('div', { class:'menu-sep' }),
  menuItem('zip', 'Скачать все слайды', () => exportMany(false)),
  menuItem('zip', 'Скачать неотмеченные слайды', () => exportMany(true)),
  menuItem('phone', 'PDF для оператора', () => operatorPDF()),
  h('div', { class:'menu-sep' }),
  menuItem('frame', 'Настройки слайдов', () => openSlidesCfg()),
  menuItem('settings', 'Лимиты', () => openSettings()),
  menuItem('link', 'Источник настроек', () => openConfig())
);
const segEl = h('div', { class:'seg', role:'tablist' },
  h('button', { type:'button', 'data-mode':'edit', onclick:() => setMode('edit') }, 'Редактор'),
  h('button', { type:'button', 'data-mode':'view', onclick:() => setMode('view') }, 'Просмотр')
);
const topbar = h('header', { class:'topbar' },
  h('div', { class:'brand' }, h('span', { class:'brand-bar' }),
    h('div', null, h('div', { class:'brand-kicker', text:'Слово веры · Познань' }), h('div', { class:'brand-title', text:'Проповедь' }))),
  segEl,
  h('div', { class:'actions' },
    h('button', { type:'button', class:'btn hide-sm', onclick:() => fileInput.click() }, ic('open'), 'Открыть'),
    h('button', { type:'button', class:'btn primary', onclick:() => saveFile(), title:'Ctrl+S' }, ic('save'), 'Сохранить'),
    iconBtn('more', 'Ещё', e => { e.stopPropagation(); menuEl.classList.toggle('open'); }),
    menuEl)
);
const fileInput = $('#fileInput');

/* выбор типа блока: сверху «Заставка» (шире) и «Заметка оператору», ниже остальные парами */
const typesTop = h('div', { class:'types types-top' });
const typesGrid = h('div', { class:'types' });
Object.keys(TYPES).forEach(t => {
  const T = TYPES[t];
  (T.top ? typesTop : typesGrid).append(h('button', { type:'button', class:'type t-' + t, style:'--tc:var(--c-' + t + ')', onclick:() => addBlock(t, sheetAt) },
    h('span', { class:'type-ic' }, ic(T.icon)),
    h('span', null, h('div', { class:'type-name', text:T.label }), h('div', { class:'type-desc', text:T.desc }))));
});
const sheetOverlay = h('div', { class:'overlay', onclick:e => { if (e.target === sheetOverlay) closeSheet(); } },
  h('div', { class:'sheet', role:'dialog', 'aria-label':'Новый блок' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Что добавить?' }), iconBtn('close', 'Закрыть', () => closeSheet())),
    typesTop, typesGrid));
const settingsOverlay = h('div', { class:'overlay', onclick:e => { if (e.target === settingsOverlay) closeSettings(); } });

/* панель оформления */
function fbtn(content, title, act, cls){
  const b = h('button', { type:'button', class:'fbtn ' + (cls || ''), title:title, 'aria-label':title }, content);
  b.addEventListener('mousedown', e => e.preventDefault());
  b.addEventListener('touchstart', e => { e.preventDefault(); act(); }, { passive:false });
  b.addEventListener('click', act);
  return b;
}
const fmtEl = h('div', { class:'fmtbar', id:'fmtbar' },
  fbtn('Ж', 'Жирный', () => fmt('bold'), 'b'),
  fbtn('К', 'Курсив', () => fmt('italic'), 'i'),
  fbtn('Ч', 'Подчеркнуть', () => fmt('underline'), 'u'),
  fbtn(ic('marker'), 'Выделить цветом', () => toggleMark()),
  fbtn('АА', 'Все прописные', () => toggleUp(), 'up-btn'),
  h('span', { class:'fsep lst' }),
  fbtn('•', 'Список с точками', () => toggleList('•'), 'lst'),
  fbtn('1.', 'Нумерованный список', () => toggleList('1'), 'lst'),
  h('span', { class:'fsep' }),
  fbtn(ic('clear'), 'Убрать оформление', () => clearFmt()));
const toastEl = h('div', { class:'toast', role:'status' });

app.append(topbar, statusEl, mainEl);
document.body.append(sheetOverlay, settingsOverlay, fmtEl, toastEl);
try { document.execCommand('styleWithCSS', false, false); } catch(e){}

