'use strict';

/* ========= Каркас страницы =========
   Шапка (`topbar`) и тело (`mainEl`) перерисовываются в app.js; здесь — то, что создаётся один раз:
   меню «⋯», окно «Что добавить?», окно настроек, панель оформления, всплывающие сообщения. */
const app = $('#app');
const topbar = h('header', { class:'topbar' });
const mainEl = h('main', { class:'app-main', id:'main' });
const fileInput = $('#fileInput');

const menuItem = (icon, label, fn) => h('button', { type:'button', onclick:() => { closeMenu(); fn(); } }, ic(icon), label);
const menuEl = h('div', { class:'menu', id:'menu' });
/* Меню зависит от экрана: выгрузка — только внутри проповеди; «Настройки слайдов» — только админу и редактору */
function fillMenu(){
  menuEl.innerHTML = '';
  menuEl.append(
    menuItem('newdoc', 'Новая проповедь', () => newSermon()),
    menuItem('open', 'Открыть файл', () => fileInput.click()));
  if (cloudOn() && screen === 'sermon') menuEl.append(menuItem('save', 'Скачать файл', () => saveFile()));
  if (screen === 'sermon') menuEl.append(
    h('div', { class:'menu-sep' }),
    menuItem('zip', 'Скачать все слайды', () => exportMany()),
    menuItem('phone', 'PDF для оператора', () => operatorPDF()));
  if (screen === 'sermon' && wideScreen()) menuEl.append(menuItem('reset', 'Сбросить настройки экрана', () => resetLayout()));   // ширина и порядок панелей
  menuEl.append(h('div', { class:'menu-sep' }));
  if (canEditSlidesCfg()) menuEl.append(menuItem('frame', 'Настройки слайдов', () => openSlidesCfg()));   // общие для пространства: админ и редактор
  menuEl.append(menuItem('link', 'Источник настроек', () => openConfig()));
  if (cloudOn()) menuEl.append(h('div', { class:'menu-sep' }), h('div', { class:'menu-who', text:cloud.user.email }), menuItem('back', 'Выйти', () => cloudSignOut()));
  else if (localMode()) menuEl.append(h('div', { class:'menu-sep' }), menuItem('check', 'Войти в облако', () => leaveLocalMode()));
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
const toastEl = h('div', { class:'toast', role:'status' });

app.append(topbar, mainEl);
document.body.append(sheetOverlay, settingsOverlay, toastEl);   // панель оформления встаёт над полем, где печатают (render.js, dockFmt)
try { document.execCommand('styleWithCSS', false, false); } catch(e){}
