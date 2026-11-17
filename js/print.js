'use strict';

/* ========= PDF для оператора: содержимое страниц =========
   buildOperatorPrint собирает в #print-op то, что нужно оператору; pdf.js (этап 10.1.3) раскладывает это в узкие страницы
   и складывает из них PDF-файл (раньше — окно печати Chrome). Подсказки для того, кто готовит слайды (найти, пришлют,
   описания, ссылки), сюда не попадают. */
const printEl = h('div', { id:'print-op', 'aria-hidden':'true' });
document.body.append(printEl);
const OP_COLORS = { splash:'#8a6d45', scripture:'#c27a52', thesis:'#6b56d8', quote:'#1f8d73', image:'#c44579', video:'#c9532f', free:'#6c7486' };
function opSlide(b, n){
  const card = h('div', { class:'op-slide op-atom', style:'--tc:' + OP_COLORS[b.type] },
    h('div', { class:'op-row' }, h('span', { class:'op-num', text:pad(n) }), h('span', { class:'op-type', text:TYPES[b.type].label })));
  switch (b.type){
    case 'splash':
      card.classList.add('op-cover');
      break;
    case 'scripture':
      b.items.forEach(it => {
        if (it.kind === 'line') return;
        if (it.kind === 'text'){ const x = sanitize(it.html); if (plain(x).trim()) card.append(h('div', { class:'op-p op-verses', html:x })); return; }
        // этап 10.4: каждый стих с новой строки — страница PDF переходит только между стихами (pdf.js, pdfCuts)
        const vs = it.verses.filter(v => plain(v.text).trim()).map(v => h('div', { class:'op-v', html:(v.num ? '<sup>' + esc(v.num) + '</sup>' + NBSP : '') + sanitize(v.text) }));
        card.append(h('div', { class:'op-p' },
          h('div', { class:'op-ref' }, (b._part ? b._part.full : it.ref) || 'Место не указано', it.translation ? h('span', { class:'op-tr', text:it.translation }) : null),
          b._part ? h('div', { class:'op-part', text:partPlate(b._part) }) : null,
          vs.length ? h('div', { class:'op-verses' }, vs) : null));
      });
      break;
    case 'thesis':
      card.append(h('div', { class:'op-thesis', html:sanitize(b.text) }));
      break;
    case 'quote':
      card.append(h('div', { class:'op-verses', html:'«' + sanitize(b.text) + '»' }));
      { const a = b.author != null ? b.author : quoteAuthor(b); if (a || b.caption) card.append(h('div', { class:'op-author', text:'— ' + [a, b.caption].filter(Boolean).join(', ') })); }
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
  let to = printEl, grp = null;   // части отрывка (этап 10.4) — в обёртке с полосой слева и подписью
  units().forEach(b => {
    if (!isPart(b)) to = printEl, grp = null;
    else if (!grp || grp._src !== b._src){
      grp = h('div', { class:'op-passage' }, h('div', { class:'op-pcap', text:'Отрывок · ' + b._part.full + ' · ' + slidesWord(b._part.n) }));
      grp._src = b._src; printEl.append(grp); to = grp;
    }
    if (b.type === 'note'){
      if ((b.text || '').trim()) to.append(h('div', { class:'op-note op-atom' }, h('div', { class:'op-note-tag', text:'⚠ Оператору' }), h('div', { class:'op-note-body', text:b.text.trim() })));
      return;
    }
    const card = opSlide(b, nums[b.id]);
    if (to === grp && b._part.k === 0) card.dataset.glue = '1';   // подпись отрывка не остаётся одна внизу страницы
    to.append(card);
    if (plain(b.speech).trim()) to.append(h('div', { class:'op-text op-atom', html:sanitize(b.speech) }));   // текст к слайду — тонким серым
  });
  wrapScripts(printEl);
}
