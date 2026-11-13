'use strict';

/* ========= Каркас страницы =========
   Шапка (`topbar`) и тело (`mainEl`) перерисовываются в app.js; здесь — то, что создаётся один раз:
   меню «⋯», окно «Что добавить?», окно настроек, панель оформления, всплывающие сообщения. */
const app = $('#app');
const topbar = h('header', { class:'topbar' });
const mainEl = h('main', { class:'app-main', id:'main' });

const menuItem = (icon, label, fn, off) => h('button', { type:'button', disabled:!!off, title:off || null, onclick:() => { closeMenu(); fn(); } }, ic(icon), label);   // off — почему пункт неактивен
const menuEl = h('div', { class:'menu', id:'menu' });
/* Меню зависит от экрана: выгрузка — только внутри проповеди; «Настройки слайдов» — только админу и редактору.
   Открыть файл в форме нельзя (с этапа 8 проповеди только в облаке). «Новый конспект» и «Скачать файл» из меню убраны (этап 9.2):
   новый конспект делает кнопка на списке, копии базы — ночной бэкап */
function fillMenu(){
  menuEl.innerHTML = '';
  if (!cloudOn()){   // экран входа: из меню — только выйти, если вошли не той почтой
    if (cloud.user) menuEl.append(h('div', { class:'menu-who', text:cloud.user.email }), menuItem('back', 'Выйти', () => cloudSignOut()));
    return;
  }
  if (screen === 'sermon' && state){   // этап 9.7: копии — всем, кто видит конспект; история — тем, кто может его править
    menuEl.append(menuItem('dup', 'Сделать копию', () => saveAsCopy({ keep:true })),
      menuItem('dup', 'Копировать в пространство…', () => openCopyToSpace(), multiSpace() ? '' : 'У вас одно пространство'));
    if (canHistory()) menuEl.append(menuItem('undo', 'История', () => openHistory()));
  }
  if (screen === 'sermon' && view === 'slides' && state && state.blocks.length) menuEl.append(h('div', { class:'menu-sep' }), menuItem('search', 'Найти и заменить', () => findOpen()));   // этап 9.6; то же — Ctrl+F
  if (screen === 'sermon') menuEl.append(
    h('div', { class:'menu-sep' }),
    menuItem('zip', 'Скачать слайды', () => openDownload()),   // этап 9.3: выбор — JPEG в архиве или PowerPoint
    menuItem('phone', 'PDF для оператора', () => operatorPDF()));
  if (screen === 'sermon' && canEditCloud()) menuEl.append(menuItem('link', 'Ссылка для оператора', () => openOpLink()));   // этап 9: тому, кто может править конспект
  const resetItem = screen === 'sermon' && wideScreen();   // «Сбросить настройки экрана» — ширина и порядок панелей; стоит сразу под «Настройки слайдов»
  if (canEditSlidesCfg()) menuEl.append(h('div', { class:'menu-sep' }),
    menuItem('people', 'Пространство', () => openSpace()),   // люди, серии, название и настройки (этап 10, space.js)
    menuItem('frame', 'Настройки слайдов', () => openSlidesCfg()));   // общие для пространства: админ и редактор
  if (resetItem){
    if (!canEditSlidesCfg()) menuEl.append(h('div', { class:'menu-sep' }));   // у автора «Настроек слайдов» нет: пункт стоит один
    menuEl.append(menuItem('reset', 'Сбросить настройки экрана', () => resetLayout()));
  }
  if (screen !== 'help') menuEl.append(h('div', { class:'menu-sep' }), menuItem('help', 'Как пользоваться', () => openHelp()));   // инструкция (этап 7.8 — пока пустая страница)
  menuEl.append(h('div', { class:'menu-sep' }), h('div', { class:'menu-who', text:cloud.user.email }), menuItem('back', 'Выйти', () => cloudSignOut()));
}

/* выбор типа слайда: плитки парами одинакового размера, порядок — как в TYPES */
const typesGrid = h('div', { class:'types' });
Object.keys(TYPES).forEach(t => {
  const T = TYPES[t];
  typesGrid.append(h('button', { type:'button', class:'type t-' + t, style:'--tc:var(--c-' + t + ')', onclick:() => addBlock(t, sheetAt) },
    h('span', { class:'type-ic' }, ic(T.icon)),
    h('span', null, h('div', { class:'type-name', text:T.label }), h('div', { class:'type-desc', text:T.desc }))));
});
const sheetTitle = h('div', { class:'sheet-title', text:'Что добавить?' });
const sheetOverlay = h('div', { class:'overlay', onclick:e => { if (e.target === sheetOverlay) closeSheet(); } },
  h('div', { class:'sheet', role:'dialog', 'aria-label':'Новый блок' },
    h('div', { class:'sheet-head' }, sheetTitle, iconBtn('close', 'Закрыть', () => closeSheet())),
    typesGrid));
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
const toastBox = h('div', { class:'toasts', 'aria-live':'polite' });   // стопка уведомлений (misc.js, toast)

app.append(topbar, mainEl);
document.body.append(sheetOverlay, settingsOverlay, toastBox);   // панель оформления встаёт над полем, где печатают (render.js, dockFmt)
try { document.execCommand('styleWithCSS', false, false); } catch(e){}
