'use strict';

/* ========= PDF для оператора =========
   Собирается отдельная страница только для печати и открывается окно печати Chrome: там нужно выбрать «Сохранить как PDF».
   Подсказки для того, кто готовит слайды (найти, пришлют, описания, ссылки), сюда не попадают. */
const printEl = h('div', { id:'print-op', 'aria-hidden':'true' });
document.body.append(printEl);
const OP_COLORS = { splash:'#8a6d45', scripture:'#c27a52', thesis:'#6b56d8', quote:'#1f8d73', image:'#c44579', video:'#c9532f', free:'#6c7486' };
function opSlide(b, n){
  const card = h('div', { class:'op-slide', style:'--tc:' + OP_COLORS[b.type] },
    h('div', { class:'op-row' }, h('span', { class:'op-num', text:pad(n) }), h('span', { class:'op-type', text:TYPES[b.type].label })));
  switch (b.type){
    case 'splash':
      card.classList.add('op-cover');
      break;
    case 'scripture':
      b.items.forEach(it => {
        if (it.kind === 'line') return;
        if (it.kind === 'text'){ const x = sanitize(it.html); if (plain(x).trim()) card.append(h('div', { class:'op-p op-verses', html:x })); return; }
        const vs = it.verses.filter(v => plain(v.text).trim()).map(v => (v.num ? '<sup>' + esc(v.num) + '</sup>' + NBSP : '') + sanitize(v.text)).join(' ');
        card.append(h('div', { class:'op-p' },
          h('div', { class:'op-ref' }, it.ref || 'Место не указано', it.translation ? h('span', { class:'op-tr', text:it.translation }) : null),
          vs ? h('div', { class:'op-verses', html:vs }) : null));
      });
      break;
    case 'thesis':
      card.append(h('div', { class:'op-thesis', html:sanitize(b.text) }));
      break;
    case 'quote':
      card.append(h('div', { class:'op-verses', html:'«' + sanitize(b.text) + '»' }));
      if (b.author || b.caption) card.append(h('div', { class:'op-author', text:'— ' + [b.author, b.caption].filter(Boolean).join(', ') }));
      break;
    case 'video':
      card.append(h('div', { class:'op-name', text:cleanName(b.name) || 'Видео' }));
      if (b.from || b.to) card.append(h('div', { class:'op-play', text:'▶ с ' + (b.from || '0:00') + ' до ' + (b.to || 'конца') }));
      break;
    default:   // картинка, свободный слайд
      card.append(h('div', { class:'op-name', text:cleanName(b.name) || TYPES[b.type].label }));
  }
  return card;
}
function buildOperatorPrint(){
  const m = state.meta, nums = slideNums();
  printEl.innerHTML = '';
  printEl.append(h('div', { class:'op-head' },
    h('div', { class:'op-kick', text:'Для оператора' }),
    h('h1', { class:'op-title', text:m.title || 'Без названия' }),
    h('div', { class:'op-meta', text:[fmtDate(m.date), preacherName(m), 'слайдов: ' + nums._total].filter(Boolean).join(' · ') })));
  state.blocks.forEach(b => {
    if (b.type === 'note'){
      if ((b.text || '').trim()) printEl.append(h('div', { class:'op-note' }, h('div', { class:'op-note-tag', text:'⚠ Оператору' }), h('div', { class:'op-note-body', text:b.text.trim() })));
      return;
    }
    printEl.append(opSlide(b, nums[b.id]));
    if (plain(b.speech).trim()) printEl.append(h('div', { class:'op-text', html:sanitize(b.speech) }));   // текст к слайду — тонким серым
  });
  wrapScripts(printEl);
}
function operatorPDF(){
  if (!state.blocks.length){ toast('В конспекте пока нет слайдов'); return; }
  if (!checkNames()) return;
  buildOperatorPrint();
  const title = document.title;
  document.title = folderName() + ' — оператор';   // Chrome предлагает это имя для PDF
  document.body.classList.add('op-print');
  const done = () => { document.body.classList.remove('op-print'); document.title = title; printEl.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  toast('В окне печати выберите «Сохранить как PDF»');
  const go = () => setTimeout(() => window.print(), 50);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(go); else go();
}
