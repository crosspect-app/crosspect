'use strict';

/* ========= Вид «Текст» =========
   Светлый, как документ: слайды текстом (стихи, тезисы, цитаты), «Текст к слайду» и заметки оператору. Для проверки проповеди целиком.
   Текст к слайду здесь можно править; чтобы поменять сам слайд, нажмите на миниатюру — откроется вид «Слайды». */
function renderTextView(){
  const m = state.meta, nums = slideNums();
  const words = state.blocks.reduce((t, b) => t + (b.speech ? wordCount(b.speech) : 0), 0), min = words / WORDS_PER_MIN;
  const splashes = state.blocks.filter(b => b.type === 'splash').length, n = nums._total;
  const stats = [n + ' ' + plural(n, 'слайд', 'слайда', 'слайдов'), splashes ? splashes + ' ' + plural(splashes, 'заставка', 'заставки', 'заставок') : '',
    words ? (min < 0.75 ? 'текст меньше минуты' : 'текст около ' + Math.round(min) + ' мин') : ''].filter(Boolean).join(' · ');
  const doc = h('article', { class:'tv-doc', style:'--vs:' + viewOpts.size },
    h('header', { class:'tv-head' },
      h('h1', { class:m.title ? '' : 'empty', text:m.title || 'Без названия', title:'Изменить название', onclick:() => openMeta() }),
      h('div', { class:'tv-stats', text:[fmtDay(m.date), preacherName(m)].filter(Boolean).join(' · ') }),
      h('div', { class:'tv-stats', text:stats })));
  state.blocks.forEach(b => { const el = tvBlock(b, nums[b.id]); if (el) doc.append(el); });
  if (!state.blocks.length) doc.append(h('p', { class:'hint', text:'Пока нет ни одного слайда. Переключитесь на «Слайды» или откройте файл проповеди.' }));
  mainEl.append(h('div', { class:'tv' }, doc, tvSide()));
  state.blocks.forEach(b => { if (PREVIEW[b.type]) schedulePreview(b); });
}

function tvBlock(b, n){
  if (b.type === 'note'){
    if (!(b.text || '').trim()) return null;   // заметки видны всегда, даже в режиме «Только слайды»
    return h('div', { class:'blk' }, h('div', { class:'gut' }),
      h('div', { class:'vnote' }, h('div', { class:'vnote-tag' }, ic('note'), 'Оператору'), h('div', { class:'vnote-body', text:b.text.trim() })));
  }
  const T = TYPES[b.type], slideCard = b.type === 'splash' ? null : tvSlide(b, n);
  const sl = PREVIEW[b.type] ? slideEl(b) : null;
  if (sl && previewRO) previewRO.observe(sl);
  const open = () => { selId = b.id; navigate(sermonHash(state.id)); };
  const thumb = h('button', { type:'button', class:'tv-thumb' + (sl ? '' : ' none'), title:'Открыть в виде «Слайды»', onclick:open }, sl);
  const mark = todoOn(b) ? h('span', { class:'tv-todo', text:'доработать' }) : null;
  const gut = h('div', { class:'gut' }, h('span', { class:'num', text:String(n) }), b.type === 'splash' ? h('span', { class:'cap', text:TYPES.splash.label }) : null, thumb, mark);
  const cont = h('div', { class:'cont' });
  if (slideCard) cont.append(slideCard);
  if (viewOpts.showText){
    const pr = rich(b.speech, { key:b.id + ':tv', cls:'prose' + (b.type === 'splash' ? ' lead' : ''),
      ph:b.type === 'splash' ? 'Текст, пока на экране заставка' : 'Текст к слайду',
      onInput:v => { b.speech = v; change(); } });
    pr.title = 'Текст к слайду правится прямо здесь. Чтобы поменять сам слайд, нажмите на его миниатюру';
    if (readOnly()) pr.inert = true;
    cont.append(pr);
  } else if (b.type === 'splash') cont.append(h('div', { class:'vs-name', text:state.meta.title || 'Без названия' }));
  return h('div', { class:'blk t-' + b.type, style:'--tc:var(--c-' + b.type + ')' }, gut, cont);
}

/* Содержимое слайда текстом */
function tvSlide(b, n){
  const c = h('div', { class:'tv-card' });
  const desc = t => t && t.trim() ? h('div', { class:'vs-mdesc', text:t }) : null;
  switch (b.type){
    case 'scripture':
      b.items.forEach((it, i) => {
        if (i) c.append(h('div', { class:'vs-hr' }));
        if (it.kind === 'line') return;
        if (it.kind === 'text'){ c.append(h('div', { class:'vs-note', style:'text-align:' + it.align, html:sanitize(it.html) || '<span class="empty-v">Пусто</span>' })); return; }
        const verses = it.verses.filter(x => plain(x.text).trim())
          .map(x => '<span>' + (x.num ? '<sup>' + esc(x.num) + '</sup>' : '') + sanitize(x.text) + '</span>').join(' ');
        c.append(h('div', null,
          h('div', { class:'vs-ref' }, it.ref || 'Место не указано', it.translation && h('span', { class:'vs-tr', text:it.translation })),
          h('div', { class:'vs-verses', html:verses || '<span class="empty-v">Текст не вставлен</span>' })));
      });
      break;
    case 'thesis':
      (b.parts || []).forEach(p => {
        if (p.kind === 'line'){ c.append(h('div', { class:'vs-hr solid' })); return; }
        c.append(h('div', { class:'vs-thesis', style:'text-align:' + (p.align || 'center'), html:sanitize(p.html) || '<span class="empty-v">Пусто</span>' }));
      });
      if (!(b.parts || []).length) c.append(h('div', { class:'vs-thesis', html:'<span class="empty-v">Пусто</span>' }));
      break;
    case 'quote':
      c.append(h('blockquote', { class:'vs-quote', html:'«' + sanitize(b.text) + '»' }));
      if (b.author || b.caption) c.append(h('div', { class:'vs-author', text:'— ' + [b.author, b.caption].filter(Boolean).join(', ') }));
      break;
    default: {
      const M = mediaInfo(b, n);
      c.classList.add('media');
      c.append(h('div', { class:'vs-name' + (M.name ? '' : ' empty-v'), text:M.name || 'Без названия' }),
        h('div', { class:'vs-media' }, ic(M.icon), h('div', null, h('div', { class:'vs-mtitle', text:M.title }), M.lines.map(desc))));
    }
  }
  wrapScripts(c);
  return c;
}

/* ----- Справа: оператору, «Показать», проверка ----- */
function sermonChecks(){
  const out = [], nums = slideNums(), st = state.settings;
  const miss = missingNames();
  out.push(miss.length ? { ok:false, text:'Нет названия: ' + miss.map(b => 'слайд ' + nums[b.id]).join(', ') } : { ok:true, text:'У всех слайдов есть названия' });
  state.blocks.forEach(b => {
    const k = nums[b.id];
    if (b.type === 'thesis' || b.type === 'quote'){ const c = charCount(b), lim = limitFor(b); if (c > lim) out.push({ ok:false, text:'Слайд ' + k + ' — длинный текст: ' + c + ' знаков, лимит ' + lim }); }
    if (b.type === 'image' && b.mode === 'send') out.push({ ok:false, text:'Слайд ' + k + ' — картинку пришлют отдельно' });
    if (b.type === 'image' && b.mode === 'find' && !(b.desc || '').trim()) out.push({ ok:false, text:'Слайд ' + k + ' — не описано, какая нужна картинка' });
    if (b.type === 'video' && b.mode === 'link' && !(b.url || '').trim()) out.push({ ok:false, text:'Слайд ' + k + ' — нет ссылки на видео' });
    if (b.type === 'video' && b.mode === 'send') out.push({ ok:false, text:'Слайд ' + k + ' — видео пришлют отдельно' });
    if (b.type === 'scripture' && !b.items.some(it => it.kind === 'scripture' && (it.verses || []).some(v => plain(v.text).trim()))) out.push({ ok:false, text:'Слайд ' + k + ' — не выбрано место Писания' });
  });
  const todo = state.blocks.filter(todoOn).length;
  if (todo) out.push({ ok:false, text:'Отмечено «доработать»: ' + todo });
  if (out.every(x => x.ok)) out.push({ ok:true, text:'Замечаний нет' });
  return out;
}
function tvSide(){
  const setSize = d => { viewOpts.size = Math.max(0.8, Math.min(1.6, Math.round((viewOpts.size + d) * 10) / 10)); LS.set('swp-view', JSON.stringify(viewOpts)); renderMain(); };
  const card = (title, ...kids) => h('section', { class:'tv-card2' }, h('div', { class:'tv-h', text:title }), kids);
  return h('aside', { class:'tv-side', 'aria-label':'Для оператора и проверка' },
    card('Для оператора',
      h('button', { type:'button', class:'btn primary wide', title:'Узкие страницы под телефон: названия и номера слайдов, текст Писания, тезисы и цитаты, под каждым слайдом его текст, жёлтые заметки', onclick:() => operatorPDF() }, ic('save'), 'PDF для оператора')),
    card('Показать',
      toggle([['all', 'Всё'], ['slides', 'Только слайды']], viewOpts.showText ? 'all' : 'slides', val => { viewOpts.showText = val === 'all'; LS.set('swp-view', JSON.stringify(viewOpts)); renderMain(); }),
      h('div', { class:'size' }, h('button', { type:'button', title:'Мельче', onclick:() => setSize(-0.1) }, 'A−'), h('button', { type:'button', title:'Крупнее', onclick:() => setSize(0.1) }, 'A+'))),
    card('Проверка', sermonChecks().map(x => h('div', { class:'chk' }, h('span', { class:x.ok ? 'ok' : 'warn', text:x.ok ? '✓' : '!' }), h('span', { text:x.text })))));
}
