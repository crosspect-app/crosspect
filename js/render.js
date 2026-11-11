'use strict';

/* ========= Отрисовка ========= */
function renderAll(){ renderMain(); updateStatus(); }
function setMode(m){
  if (m === 'view' && !checkNames()) return;
  mode = m; LS.set('swp-mode', m); renderMain(); window.scrollTo(0, 0);
}

function renderMain(){
  segEl.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  foldBtns.forEach(b => { b.disabled = mode !== 'edit'; b.title = mode !== 'edit' ? 'Сворачивать блоки можно в режиме «Редактор»' : ''; });
  mainEl.innerHTML = '';
  document.title = (state.meta.title || 'Проповедь') + ' · Слово веры';
  if (mode === 'edit') renderEditor(); else renderView();
}

function updateStatus(){
  const n = slideNums()._total, done = state.blocks.filter(b => b.done).length;
  const left = h('span', null, 'Слайдов: ' + n + (done ? ' · готово: ' + done : '') + ' · черновик хранится в этом браузере');
  let right;
  if (isDirty()) right = h('span', { class:'warn' }, '● Не сохранено в файл');
  else if (state.savedAt) right = h('span', { class:'ok' }, '✓ Файл сохранён в ' + fmtTime(state.savedAt));
  else right = h('span');
  statusEl.innerHTML = '';
  statusEl.append(left, right);
}

/* ----- Редактор ----- */
function renderEditor(){
  const m = state.meta;
  const metaField = (key, label, ph, type) => h('label', { class:'field' },
    h('span', { class:'lbl', text:label }),
    h('input', { class:'input', type:type || 'text', placeholder:ph || '', value:m[key] || '', oninput:e => { m[key] = e.target.value; change(); } }));
  mainEl.append(h('section', { class:'card meta' },
    h('div', { class:'kicker', text:'Шапка проповеди' }),
    h('input', { class:'title-input', placeholder:'Название проповеди', value:m.title, 'aria-label':'Название проповеди',
      oninput:e => { m.title = e.target.value; document.title = (m.title || 'Проповедь') + ' · Слово веры'; change(); } }),
    h('div', { class:'meta-grid' },
      metaField('date', 'Дата', '', 'date'),
      preacherField())));
  if (state.blocks.some(b => b.type === 'scripture')) loadBible(curLang());

  const list = h('div', { class:'blocks', id:'blocks' });
  const nums = slideNums();
  state.blocks.forEach((b, i) => {
    list.append(insertLine(i));
    list.append(renderBlock(b, nums[b.id]));
  });
  mainEl.append(list);
  if (!state.blocks.length) mainEl.append(h('div', { class:'empty' },
    h('div', { class:'empty-title', text:'Соберите проповедь из блоков' }),
    h('ol', null,
      h('li', null, 'Добавляйте блоки по ходу проповеди: места Писания, тезисы, цитаты, картинки.'),
      h('li', null, '«Текст проповеди» и «Заметка оператору» на экран не выводятся: это подсказки оператору.'),
      h('li', null, 'Готовые блоки можно свернуть, чтобы не мешали.'),
      h('li', null, 'Готово? Нажмите «Сохранить» и отправьте получившийся файл.'))));
  mainEl.append(h('button', { type:'button', class:'add-big', onclick:() => openSheet(state.blocks.length) }, ic('plus'), 'Добавить блок'));
  state.blocks.forEach(updateCounter);
  growAll(mainEl);
}

function preacherField(){
  const m = state.meta, known = !m.preacher || PREACHERS.includes(m.preacher);
  const wrap = h('label', { class:'field' }, h('span', { class:'lbl', text:'Проповедник' }));
  const sel = h('select', { class:'input', onchange:e => {
    if (e.target.value === '__other'){ m.preacher = ''; other.style.display = ''; other.focus(); }
    else { m.preacher = e.target.value; other.style.display = 'none'; }
    change();
  } },
    h('option', { value:'' }, 'Выберите…'),
    PREACHERS.map(p => h('option', { value:p, selected:p === m.preacher }, p)),
    h('option', { value:'__other', selected:!known }, 'Другой — ввести вручную'));
  const other = h('input', { class:'input', placeholder:'Фамилия Имя', value:known ? '' : m.preacher, style:known ? 'display:none;margin-top:8px' : 'margin-top:8px',
    oninput:e => { m.preacher = e.target.value; change(); } });
  wrap.append(sel, other);
  return wrap;
}

function insertLine(at){
  return h('div', { class:'insert' }, h('button', { type:'button', title:'Вставить блок сюда', 'aria-label':'Вставить блок сюда', onclick:() => openSheet(at) }, ic('plus')));
}

function renderBlock(b, n){
  const T = TYPES[b.type];
  const miss = flagMissing && NAMED[b.type] && slidesCfg().names.required && !cleanName(b.name);
  const card = h('article', { class:'block t-' + b.type + (b.collapsed ? ' collapsed' : '') + (b.done ? ' done' : '') + (miss ? ' missing' : ''), 'data-id':b.id, style:'--tc:var(--c-' + b.type + ')' });
  let sub;
  if (b.collapsed){
    const s = blockSummary(b);
    sub = h('div', { class:'bsum' + (s ? '' : ' empty'), text:s || 'Пока пусто' });
  } else sub = h('div', { class:'bsub', text:T.slide ? 'Слайд ' + n + (b.done ? ' · готов' : '') : (b.type === 'note' ? 'Только для оператора' : 'На экран не выводится') });
  card.append(h('div', { class:'bhead' },
    h('div', { class:'btag', title:b.collapsed ? 'Развернуть' : 'Свернуть', onclick:() => toggleFold(b) },
      T.slide ? h('span', { class:'bnum', text:pad(n) }) : h('span', { class:'bnum off' }, ic(T.icon)),
      h('div', { style:'min-width:0' }, h('div', { class:'btype', text:T.label }), sub)),
    h('div', { class:'btools' },
      T.slide && iconBtn('tag', 'Скопировать название слайда', () => copyText(slideName(b, slideNums()[b.id]), 'Скопировано: ')),
      PREVIEW[b.type] && iconBtn('jpg', 'Скачать слайд в JPEG', () => exportOne(b)),
      T.slide && iconBtn('check', b.done ? 'Снять отметку «готово»' : 'Отметить как готовый', () => toggleDone(b), 'mark' + (b.done ? ' on' : '')),
      iconBtn(b.collapsed ? 'unfold' : 'fold', b.collapsed ? 'Развернуть' : 'Свернуть', () => toggleFold(b)),
      iconBtn('top', 'В самый верх', () => move(b, -Infinity)),
      iconBtn('up', 'Выше', () => move(b, -1)),
      iconBtn('down', 'Ниже', () => move(b, 1)),
      iconBtn('bottom', 'В самый низ', () => move(b, Infinity)),
      iconBtn('dup', 'Дублировать', () => duplicate(b)),
      iconBtn('trash', 'Удалить', () => removeBlock(b), 'danger'))));
  if (b.collapsed) return card;
  const body = h('div', { class:'bbody' });
  BODY[b.type](b, body, n);
  if (PREVIEW[b.type]){
    const sl = slideEl(b);
    card.append(h('div', { class:'bsplit' },
      h('div', { class:'bmain' }, body),
      h('div', { class:'bprev' },
        h('div', { class:'bprev-cap' }, h('span', null, 'Предпросмотр'), h('span', { class:'count' }, '')),
        sl)));
    if (previewRO) previewRO.observe(sl);
    return card;
  }
  card.append(body);
  return card;
}

function rerender(b, focusKey, offset){
  const old = document.querySelector('.block[data-id="' + b.id + '"]');
  const nb = renderBlock(b, slideNums()[b.id]);
  if (old) old.replaceWith(nb);
  if (PREVIEW[b.type] && !b.collapsed){ clearTimeout(previewTimers[b.id]); runPreview(b); }   // раскладываем сразу, без пустого кадра
  else updateCounter(b);
  growAll(nb);
  if (focusKey) focusRich(focusKey, offset);
}

function updateCounter(b){
  const card = document.querySelector('.block[data-id="' + b.id + '"]'); if (!card) return;
  if (card.querySelector('.sl')){ schedulePreview(b); return; }
  // свёрнутый блок: подсвечиваем только превышение лимита символов
  if (b.type === 'thesis' || b.type === 'quote') card.classList.toggle('over', charCount(b) > limitFor(b));
}

function toggleFold(b){
  b.collapsed = !b.collapsed;
  change(); rerender(b);
}
/* Свернуть или развернуть блоки, подходящие под условие: fold(b) — свернуть ли этот блок */
function foldWhere(pred, fold, msg){
  if (mode !== 'edit') return;
  state.blocks.forEach(b => { if (pred(b)) b.collapsed = !!fold(b); });
  change(); renderMain();
  toast(msg);
}
/* Отметка «готово»: слайд выгружен или сделан. Ставится вручную, а при выгрузке — сама, если её ещё нет */
function toggleDone(b){
  b.done = !b.done;
  change(); rerender(b);
}
function markDone(b){ if (!b.done){ b.done = true; return true; } return false; }

/* поля */
function field(label, control){ return h('label', { class:'field' }, h('span', { class:'lbl', text:label }), control); }
function grow(t){ t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }
function growAll(root){ requestAnimationFrame(() => root.querySelectorAll('textarea.input').forEach(grow)); }
function area(obj, key, ph, rows){
  const t = h('textarea', { class:'input', placeholder:ph, rows:String(rows || 3), oninput:e => { obj[key] = e.target.value; grow(e.target); change(); } });
  t.value = obj[key] || '';
  return t;
}
function input(obj, key, ph, extra){
  return h('input', Object.assign({ class:'input', placeholder:ph, value:obj[key] || '', oninput:e => { obj[key] = e.target.value; change(); } }, extra || {}));
}
function toggle(opts, cur, fn){
  return h('div', { class:'toggle' }, opts.map(o => h('button', { type:'button', class:o[0] === cur ? 'on' : '', onclick:() => { if (o[0] !== cur) fn(o[0]); } }, o[1])));
}

function rich(value, o){
  const el = h('div', { class:'rich ' + (o.cls || ''), contenteditable:'true', 'data-ph':o.ph || '', spellcheck:'true', role:'textbox' });
  if (o.key) el.dataset.key = o.key;
  if (o.lists) el.dataset.lists = '1';
  el.innerHTML = sanitize(value);
  el.addEventListener('input', e => {
    if (o.lists && e.inputType === 'insertText' && e.data === ' ') autoList(el);
    const v = finalize(cleanHTML(el));
    if (!v && el.innerHTML !== '') el.innerHTML = '';
    o.onInput(v);
  });
  el.addEventListener('paste', e => {
    e.preventDefault();
    let t = ((e.clipboardData && e.clipboardData.getData('text/plain')) || '').replace(/\u00ad/g, '');   // мягкие переносы с сайтов вроде azbyka.ru
    t = t.replace(/\r\n?/g, '\n');
    if (o.single) t = t.replace(/\s*\n\s*/g, ' ').replace(/[ \t\u00a0]+/g, ' ');
    if (o.lists){   // по строкам: переносы — это <br>, а «- » в начале строки становится «• »
      t.split('\n').forEach((ln, i) => {
        if (i) document.execCommand('insertLineBreak');
        if (ln) document.execCommand('insertText', false, ln.replace(/^\s*[-*•][ \t]+/, '• ').replace(/^\s*(\d{1,2})[.)][ \t]+/, '$1. '));
      });
    } else document.execCommand('insertText', false, t);
    if (o.onPasted) o.onPasted(el);
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing){
      if (o.onEnter){ e.preventDefault(); o.onEnter(el); }
      else if (o.single) e.preventDefault();
      return;
    }
    if (e.key === 'Backspace' && o.onBackStart && caretAtStart(el)) { if (o.onBackStart(el)) e.preventDefault(); }
  });
  el.addEventListener('beforeinput', e => {
    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak'){
      if (o.onEnter){ e.preventDefault(); o.onEnter(el); }
      else if (o.single) e.preventDefault();
    }
  });
  return el;
}
function caretAtStart(el){
  const s = getSelection(); if (!s.rangeCount) return false;
  const r = s.getRangeAt(0);
  if (!r.collapsed || !el.contains(r.startContainer)) return false;
  const pre = document.createRange(); pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length === 0;
}
function setCaret(el, off){
  const s = getSelection(), r = document.createRange();
  if (off == null || off === 'end'){ r.selectNodeContents(el); r.collapse(false); }
  else {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n, rem = off, placed = false;
    while ((n = w.nextNode())){ if (rem <= n.nodeValue.length){ r.setStart(n, rem); r.collapse(true); placed = true; break; } rem -= n.nodeValue.length; }
    if (!placed){ r.selectNodeContents(el); r.collapse(off === 0); }
  }
  s.removeAllRanges(); s.addRange(r);
}
function focusRich(key, off){
  const el = document.querySelector('[data-key="' + key + '"]'); if (!el) return;
  el.focus({ preventScroll:true }); setCaret(el, off);
  const rect = el.getBoundingClientRect();
  if (rect.top < 80 || rect.bottom > window.innerHeight - 90) el.scrollIntoView({ block:'center', behavior:'smooth' });
}

/* ----- Писание: «Свой перевод» — всё вручную, без подсказок ----- */
function partEditor(block, part, pi){
  const wrap = h('div', { class:'half' });
  if (part.mBook == null) splitManualRef(part);
  const upd = () => { part.ref = manualRef(part); change(); updateCounter(block); };
  const picker = trPicker(part, v => { if (v === OWN) return; fromManual(part, v); loadBible(v); syncVerses(part); change(); rerender(block); });
  const book = h('input', { class:'input', placeholder:'Например: Иакова', value:part.mBook || '', autocomplete:'off', 'aria-label':'Книга', oninput:e => { part.mBook = e.target.value; upd(); } });
  const chap = h('input', { class:'input', placeholder:'№', inputmode:'numeric', autocomplete:'off', value:part.mChapter || '', 'aria-label':'Глава', oninput:e => { part.mChapter = e.target.value.trim(); upd(); } });
  const vers = h('input', { class:'input', placeholder:'2-4, 8', autocomplete:'off', value:part.mVerses || '', 'aria-label':'Стихи',
    oninput:e => { part.mVerses = e.target.value; upd(); }, onchange:() => { syncManualVerses(part); change(); rerender(block); } });
  wrap.append(h('div', { class:'grid-3' }, h('div', { class:'field' }, h('span', { class:'lbl', text:'Перевод' }), picker), field('Книга', book), field('Глава', chap)));
  wrap.append(h('div', { class:'grid-2' }, field('Стихи', vers),
    field('Название перевода', input(part, 'translation', 'Например: перевод Десницкого', { autocomplete:'off', oninput:e => { part.translation = e.target.value; change(); updateCounter(block); } }))));
  const vs = h('div', { class:'verses' });
  part.verses.forEach((v, vi) => vs.append(verseRow(block, part, pi, vi)));
  wrap.append(h('div', null, h('span', { class:'lbl', text:'Текст стихов' }), vs));
  return wrap;
}

function verseRow(block, part, pi, vi){
  const v = part.verses[vi];
  if (!part.manual) return autoVerseRow(block, part, pi, vi);
  const num = h('input', { class:'input vnum', value:v.num, placeholder:'№', inputmode:'numeric', 'aria-label':'Номер стиха',
    oninput:e => { v.num = e.target.value.trim(); if (vi === 0) part.autoFirst = false; change(); updateCounter(block); } });
  const only = part.verses.length === 1;
  const txt = rich(v.text, {
    key:block.id + ':' + pi + ':' + vi, single:true, cls:'vtext',
    ph:only ? 'Вставьте текст. Enter перед номером стиха — новая строка' : 'Текст стиха',
    onInput:val => { v.text = val; change(); updateCounter(block); },
    onEnter:el => splitVerse(block, part, pi, vi, el),
    onBackStart:() => { if (vi > 0){ mergeVerse(block, part, pi, vi); return true; } return false; },
    onPasted:el => {
      if (v.num) return;
      const html = finalize(cleanHTML(el));
      const m = /^(\d{1,3})(?:\s|&nbsp;|[.:)])+/.exec(html);
      if (!m) return;
      v.num = m[1]; v.text = html.slice(m[0].length); num.value = v.num;
      if (vi === 0) part.autoFirst = false;
      el.innerHTML = v.text; setCaret(el, 'end'); change(); updateCounter(block);
    }
  });
  const del = only ? h('span') : iconBtn('close', 'Убрать стих', () => { part.verses.splice(vi, 1); change(); rerender(block); }, 'vdel');
  return h('div', { class:'verse' }, num, txt, del);
}

function splitVerse(block, part, pi, vi, el){
  const v = part.verses[vi];
  let head = v.text, tail = '';
  const s = getSelection();
  if (s.rangeCount && el.contains(s.getRangeAt(0).startContainer)){
    const r = s.getRangeAt(0); if (!r.collapsed) r.deleteContents();
    const t = document.createRange(); t.setStart(r.startContainer, r.startOffset); t.setEnd(el, el.childNodes.length);
    const tmp = document.createElement('div'); tmp.appendChild(t.extractContents());
    tail = finalize(cleanHTML(tmp)); head = finalize(cleanHTML(el));
  }
  head = rtrimH(head); tail = ltrimH(tail);
  let num = nextNum(v.num);
  const m = /^(\d{1,3})(?:\s|&nbsp;|[.:)])+/.exec(tail);
  if (m){ num = m[1]; tail = tail.slice(m[0].length); }
  v.text = head;
  part.verses.splice(vi + 1, 0, { num:num, text:tail });
  change();
  rerender(block, block.id + ':' + pi + ':' + (vi + 1), 0);
}
function mergeVerse(block, part, pi, vi){
  const prev = part.verses[vi - 1], cur = part.verses[vi];
  const a = rtrimH(prev.text), b = ltrimH(cur.text), sep = a && b ? ' ' : '';
  const off = plain(a).length + sep.length;
  prev.text = a + sep + b;
  part.verses.splice(vi, 1);
  change();
  rerender(block, block.id + ':' + pi + ':' + (vi - 1), off);
}
function addVerse(block, part, pi){
  const last = part.verses[part.verses.length - 1];
  part.verses.push({ num:nextNum(last.num), text:'' });
  change();
  rerender(block, block.id + ':' + pi + ':' + (part.verses.length - 1), 0);
}


/* ----- Место Писания из Библии: язык → книга → глава → стихи ----- */
const anchors = {};
/* Выбор перевода: кнопка + панель с поиском и группами по языкам */
let trPanel = null;
function closeTrPanel(){ if (trPanel){ trPanel.remove(); trPanel = null; } }
function trTitle(it){
  if (it.manual) return 'Свой перевод';
  const L = LANGS[it.lang]; return L ? L.label : (it.translation || 'Перевод');
}
function trPicker(it, onPick){
  const L = !it.manual && LANGS[it.lang];
  const btn = h('button', { type:'button', class:'input trp-btn', 'aria-label':'Перевод', 'aria-haspopup':'listbox' },
    L ? h('span', { class:'trp-lang-code', text:L.group.toUpperCase() }) : null, h('span', { class:'trp-cur', text:trTitle(it) }));
  const wrap = h('div', { class:'trp' }, btn);
  btn.addEventListener('click', e => { e.stopPropagation(); openTrPanel(wrap, it, onPick); });
  return wrap;
}
function openTrPanel(wrap, it, onPick){
  if (trPanel && trPanel.parentNode === wrap){ closeTrPanel(); return; }
  closeTrPanel();
  const norm = x => String(x || '').toLowerCase().replace(/ё/g, 'е').replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/[źż]/g, 'z');
  const curG = it.manual ? null : (LANGS[it.lang] || {}).group;
  const opened = new Set();   // сначала видны все языки и «Свой»; язык раскрывается по нажатию
  const shown = k => LANGS[k].file || LANGS[k].url;
  const q = h('input', { class:'input trp-q', type:'search', placeholder:'Поиск: язык или перевод (НРП, Турконяк, UBG…)', 'aria-label':'Поиск перевода' });
  const list = h('div', { class:'trp-list', role:'listbox' });
  const pick = k => { closeTrPanel(); if (k === OWN ? !it.manual : (it.manual || k !== it.lang)) onPick(k); };
  const draw = () => {
    const t = norm(q.value).trim(); list.innerHTML = '';
    let any = false;
    TR_GROUPS.forEach(([g, gl]) => {
      const all = Object.keys(LANGS).filter(k => LANGS[k].group === g && shown(k));
      if (!all.length) return;
      const byLang = t && norm(gl + ' ' + g).includes(t);
      const keys = !t || byLang ? all : all.filter(k => norm([LANGS[k].label, LANGS[k].abbr, LANGS[k].tr, LANGS[k].note, LANGS[k].alias].join(' ')).includes(t));
      if (!keys.length) return;
      any = true;
      const open = t ? true : opened.has(g);
      list.append(h('button', { type:'button', class:'trp-lang' + (open ? ' open' : '') + (g === curG ? ' cur' : ''), 'aria-expanded':String(open),
        onclick:() => { if (t) return; opened.has(g) ? opened.delete(g) : opened.add(g); draw(); } },
        h('span', { class:'trp-lname', text:gl }),
        h('span', { class:'trp-note', text:g === curG ? LANGS[it.lang].label : LANGS[all[0]].label }),
        h('span', { class:'trp-chev', html:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>' })));
      if (open) keys.forEach(k => {
        const L = LANGS[k], note = [k === all[0] ? 'по умолчанию' : '', L.note].filter(Boolean).join(' · ');
        list.append(h('button', { type:'button', class:'trp-it sub' + (!it.manual && k === it.lang ? ' on' : ''), role:'option', onclick:() => pick(k) },
          h('span', { class:'trp-name' }, L.abbr ? h('span', { class:'trp-abbr', text:L.abbr }) : null, L.label),
          note ? h('span', { class:'trp-note', text:note }) : null));
      });
    });
    if (!t || norm('свой перевод другой вручную').includes(t)){
      any = true;
      list.append(h('div', { class:'trp-sep' }), h('button', { type:'button', class:'trp-it trp-own' + (it.manual ? ' on' : ''), role:'option', onclick:() => pick(OWN) },
        h('span', { class:'trp-name', text:'Свой перевод' }), h('span', { class:'trp-note', text:'книга, глава, стихи и текст — вручную' })));
    }
    if (!any) list.append(h('div', { class:'trp-empty', text:'Ничего не нашлось. Если нужного перевода нет, выберите «Свой перевод».' }));
  };
  q.addEventListener('input', draw);
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ const f = list.querySelector('.trp-it'); if (f){ e.preventDefault(); f.click(); } }
    if (e.key === 'Escape'){ e.stopPropagation(); closeTrPanel(); }
  });
  trPanel = h('div', { class:'trp-panel', onclick:e => e.stopPropagation() }, q, list);
  wrap.append(trPanel);
  draw();
  const on = list.querySelector('.trp-it.on'); if (on) on.scrollIntoView({ block:'nearest' });
  if (window.matchMedia('(pointer:fine)').matches) q.focus();
}
document.addEventListener('click', closeTrPanel);
function scriptureEditor(block, it, pi){
  const wrap = h('div', { class:'half' });
  const rec = bibles[srcKey(it.lang)], data = bibleData(it.lang);
  if (!rec) loadBible(it.lang);
  const relayout = () => { syncVerses(it); change(); rerender(block); };

  const lang = trPicker(it, v => {
    if (v === OWN){ resetToOwn(it); change(); rerender(block); return; }
    it.lang = v; state.settings.lang = v;
    const d = bibleData(v);
    if (d && it.book && !d[it.book]) { it.book = 0; it.chapter = 0; it.sel = []; }   // этой книги в переводе нет
    else if (d && it.book && !d[it.book][it.chapter]) { it.chapter = 0; it.sel = []; }
    it.verses = [];
    loadBible(v); relayout();
  });
  const book = h('select', { class:'input', 'aria-label':'Книга', onchange:e => {
    it.book = +e.target.value; it.chapter = it.book ? 1 : 0; it.sel = []; it.verses = []; relayout();
  } },
    h('option', { value:'0' }, 'Книга…'),
    // показываем только книги, которые есть в выбранном переводе
    [['Ветхий Завет', BOOK_ORDER_OT], ['Новый Завет', BOOK_ORDER_NT]].map(([gl, order]) => {
      const ns = order.filter(n => !data || data[n]);
      return ns.length ? h('optgroup', { label:gl }, ns.map(n => h('option', { value:String(n), selected:n === it.book }, bookName(it.lang, n)))) : null;
    }));
  const chs = data && it.book ? Object.keys(data[it.book] || {}).map(Number).sort((a, b) => a - b) : [];
  const chapter = h('select', { class:'input', 'aria-label':'Глава', disabled:!chs.length, onchange:e => {
    it.chapter = +e.target.value; it.sel = []; it.verses = []; relayout();
  } }, chs.length ? chs.map(c => h('option', { value:String(c), selected:c === it.chapter }, String(c))) : h('option', null, 'Глава'));
  wrap.append(h('div', { class:'grid-3' }, h('div', { class:'field' }, h('span', { class:'lbl', text:'Перевод' }), lang), field('Книга', book), field('Глава', chapter)));
  if (it.lang === 'own') wrap.append(field('Название перевода', h('input', { class:'input', placeholder:'Например: перевод Десницкого', value:it.trName || '', autocomplete:'off',
    oninput:e => { it.trName = e.target.value; it.translation = trOf(it); change(); updateCounter(block); } })));

  if (!data){
    const sk = srcKey(it.lang), st = bibles[sk] ? bibles[sk].status : 'loading', nm = LANGS[sk].tr;
    wrap.append(st === 'error'
      ? h('div', { class:'loadnote err' }, 'Не удалось загрузить перевод «' + nm + '». Проверьте интернет.',
          h('button', { type:'button', class:'chip', onclick:() => { loadBible(it.lang); rerender(block); } }, 'Повторить'),
          h('button', { type:'button', class:'chip', onclick:() => { toManual(it); change(); rerender(block); } }, 'Ввести вручную'))
      : h('div', { class:'loadnote' }, it.lang === 'own' ? 'Загружаю список глав и стихов…' : 'Загружаю перевод «' + nm + '»…'));
    return wrap;
  }
  const cv = chapterVerses(it);
  if (cv){
    const nums = Object.keys(cv).map(Number).sort((a, b) => a - b), max = nums[nums.length - 1];
    let anchor = anchors[block.id + ':' + pi] != null ? anchors[block.id + ':' + pi] : null;
    const grid = h('div', { class:'vgrid' }, nums.map(n => h('button', { type:'button', class:'vchip' + (it.sel.includes(n) ? ' on' : ''), onclick:e => {
      if (e.shiftKey && anchor != null){
        const [a, b] = anchor < n ? [anchor, n] : [n, anchor];
        for (let x = a; x <= b; x++) if (cv[x] != null && !it.sel.includes(x)) it.sel.push(x);
      } else if (it.sel.includes(n)) it.sel = it.sel.filter(x => x !== n);
      else it.sel.push(n);
      it.sel.sort((a, b) => a - b); anchors[block.id + ':' + pi] = n;
      relayout();
    } }, String(n))));
    const quick = h('input', { class:'input', placeholder:'или введите: 1-3, 5', value:formatSel(it.sel), inputmode:'numeric', onchange:e => { it.sel = parseSel(e.target.value, max).filter(n => cv[n] != null); relayout(); } });
    wrap.append(h('div', { class:'vpick' },
      h('span', { class:'lbl', text:'Стихи' }), grid,
      h('div', { class:'vrow' }, quick,
        h('button', { type:'button', class:'chip', onclick:() => { it.sel = nums.slice(); relayout(); } }, 'Вся глава'),
        it.sel.length ? h('button', { type:'button', class:'chip', onclick:() => { it.sel = []; relayout(); } }, 'Сбросить') : null),
      h('p', { class:'hint', html:it.lang === 'own'
        ? 'Выберите номера стихов, а текст каждого стиха вставьте ниже. Shift + клик — выделить диапазон.'
        : 'Нажимайте на номера стихов. Shift + клик — выделить диапазон. Текст можно поправить ниже: выделить слово, сделать жирным.' })));
  }
  if (it.verses.length){
    const vs = h('div', { class:'verses' });
    it.verses.forEach((v, vi) => vs.append(autoVerseRow(block, it, pi, vi)));
    wrap.append(vs);
  }
  return wrap;
}
function autoVerseRow(block, it, pi, vi){
  const v = it.verses[vi];
  const own = it.lang === 'own';
  const edited = () => !own && plain(v.text).trim() !== (v.orig || '').trim();
  const resetBtn = iconBtn('reset', 'Вернуть текст из Библии', () => { v.text = esc(v.orig || ''); change(); rerender(block); }, 'vdel');
  resetBtn.style.visibility = edited() ? 'visible' : 'hidden';
  const txt = rich(v.text, { key:block.id + ':' + pi + ':' + vi, single:true, cls:'vtext', ph:own ? 'Вставьте текст стиха ' + v.num : (v.orig ? 'Текст стиха' : 'В этом переводе стих объединён с соседним'),
    onInput:val => { v.text = val; resetBtn.style.visibility = edited() ? 'visible' : 'hidden'; change(); updateCounter(block); } });
  return h('div', { class:'verse' }, h('div', { class:'vlabel', text:v.num }), txt, resetBtn);
}
function textItemEditor(block, it, pi){
  return h('div', { class:'half' },
    rich(it.html, { key:block.id + ':' + pi + ':t', ph:'Комментарий, пояснение слова, мысль — тем же шрифтом, что и стихи',
      onInput:v => { it.html = v; change(); updateCounter(block); } }),
    h('label', { class:'switch' },
      h('input', { type:'checkbox', checked:!!it.caps, onchange:e => { it.caps = e.target.checked; change(); updateCounter(block); } }),
      h('span', { class:'sw' }), 'Заглавными буквами'));
}
function itemHead(block, it, i){
  const n = block.items.length;
  const moveItem = d => { const j = i + d; if (j < 0 || j >= n) return; block.items.splice(i, 1); block.items.splice(j, 0, it); change(); rerender(block); };
  const tools = h('div', { class:'itools' });
  if (it.kind === 'text') [['left', 'alignl', 'По левому краю'], ['center', 'alignc', 'По центру'], ['right', 'alignr', 'По правому краю']].forEach(([a, icn, t]) =>
    tools.append(iconBtn(icn, t, () => { it.align = a; change(); rerender(block); }, it.align === a ? 'on' : '')));
  if (n > 1){
    tools.append(iconBtn('up', 'Выше на слайде', () => moveItem(-1)), iconBtn('down', 'Ниже на слайде', () => moveItem(1)),
      iconBtn('close', 'Убрать со слайда', () => { block.items.splice(i, 1); change(); rerender(block); }, 'danger'));
  }
  return h('div', { class:'item-head' }, h('span', { class:'half-tag', text:{ text:'Текст', line:'Линия' }[it.kind] || 'Место Писания' }), tools);
}

/* Размер текста: цитата — от 100% (= на 10% крупнее имени автора) до 85%, тезис — от 100% до 70%, шаг 1% */
const scaleRange = t => { const z = slidesCfg().sizes; return z[t] || null; };   // диапазон из общих настроек слайдов
const blkScale = b => { const R = scaleRange(b.type); return R ? Math.min(R.max, Math.max(R.min, Math.round(+b.scale || 100))) : 100; };
function scaleStepper(b){
  const R = scaleRange(b.type);
  const val = h('span'), minus = h('button', { type:'button', title:'Мельче на 1%', 'aria-label':'Мельче на 1%' }, '−'),
    plus = h('button', { type:'button', title:'Крупнее на 1%', 'aria-label':'Крупнее на 1%' }, '+');
  const show = () => { const v = blkScale(b); val.textContent = v + '%'; minus.disabled = v <= R.min; plus.disabled = v >= R.max; };
  const step = d => { b.scale = blkScale(b) + d; show(); change(); updateCounter(b); };
  minus.addEventListener('click', e => { e.preventDefault(); step(-1); });
  plus.addEventListener('click', e => { e.preventDefault(); step(1); });
  show();
  return h('div', { class:'step', title:'Размер текста' }, minus, val, plus);
}
function partStepper(b, p){
  const R = scaleRange('thesis'), cur = () => Math.min(R.max, Math.max(R.min, Math.round(+p.scale || 100)));
  const val = h('span'), minus = h('button', { type:'button', title:'Мельче на 1%', 'aria-label':'Мельче на 1%' }, '−'),
    plus = h('button', { type:'button', title:'Крупнее на 1%', 'aria-label':'Крупнее на 1%' }, '+');
  const show = () => { const v = cur(); val.textContent = v + '%'; minus.disabled = v <= R.min; plus.disabled = v >= R.max; };
  const step = d => { p.scale = cur() + d; show(); change(); updateCounter(b); };
  minus.addEventListener('click', e => { e.preventDefault(); step(-1); });
  plus.addEventListener('click', e => { e.preventDefault(); step(1); });
  show();
  return h('div', { class:'step', style:'margin:0', title:'Размер этого текста' }, minus, val, plus);
}
const isCaps = b => b.type === 'thesis' ? b.caps !== false : !!b.caps;
function capsSwitch(b){
  return h('label', { class:'switch' },
    h('input', { type:'checkbox', checked:isCaps(b), onchange:e => { b.caps = e.target.checked; change(); updateCounter(b); } }),
    h('span', { class:'sw' }), 'Заглавными буквами');
}
function alignTools(b){
  const cur = b.align || 'center';
  return h('div', { class:'itools', title:'Выравнивание текста' },
    [['left', 'alignl', 'По левому краю'], ['center', 'alignc', 'По центру'], ['right', 'alignr', 'По правому краю']].map(([a, icn, t]) =>
      iconBtn(icn, t, () => { b.align = a; change(); rerender(b); }, cur === a ? 'on' : '')));
}
function valignTools(b){
  const cur = b.valign || 'center';
  return h('div', { class:'itools', title:'Выравнивание по вертикали' },
    [['top', 'vtop', 'Прижать к верху'], ['center', 'vmid', 'По центру по вертикали'], ['bottom', 'vbot', 'Прижать к низу']].map(([a, icn, t]) =>
      iconBtn(icn, t, () => { b.valign = a; change(); rerender(b); }, cur === a ? 'on' : '')));
}
/* Название тезиса по умолчанию: первые слова текста (до 5), сколько целиком влезет в лимит длины.
   Пока название не правили руками, оно меняется вместе с текстом */
function autoName(html){
  const max = slidesCfg().names.maxLength;
  const words = plain(html || '').split('\n').map(l => l.replace(LIST_RE, '')).join(' ')
    .replace(BAD_CHARS, ' ').replace(/[«»"„“”]/g, '').split(/\s+/).filter(w => /[0-9A-Za-zА-Яа-яЁёІіЇїЄєҐґ]/.test(w));
  let out = '';
  const take = [];
  for (const w of words.slice(0, 5)){ if ((take.concat(w)).join(' ').length > max) break; take.push(w); }
  // не обрываем название на предлоге, союзе или частице: «…к Богу и» → «…к Богу»
  const weak = /^(.{1,2}|для|без|при|про|что|как|или|над|под|ибо|если|чем|это|тот|где|когда|чтобы)$/i;
  while (take.length > 1 && weak.test(take[take.length - 1].replace(/[^0-9A-Za-zА-Яа-яЁёІіЇїЄєҐґ]/g, ''))) take.pop();
  out = take.join(' ');
  out = out.replace(/[\s,.;:!?—–-]+$/, '');
  return cleanName(out ? out.charAt(0).toUpperCase() + out.slice(1) : '');
}
function syncAutoName(b){
  if (b.type !== 'thesis' || b.nameAuto === false) return;
  b.name = autoName(b.text);
  const inp = document.querySelector('.block[data-id="' + b.id + '"] .namebox input');
  if (inp && document.activeElement !== inp){ inp.value = b.name; inp.dispatchEvent(new Event('sync')); }
}

/* Название слайда: номер [N] стоит слева и не стирается; недопустимые для файлов символы не вводятся */
const NAME_PH = { thesis:'Сформируется само из первых слов текста', image:'Фото Десмонд Досс', video:'История Николаса Винтона', free:'Значения слова АГАПЕ' };
function nameField(b, n){
  const cfg = slidesCfg().names;
  const cnt = h('span', { class:'count' }), err = h('div', { class:'name-err' }), box = h('div', { class:'namebox' });
  const show = () => {
    const len = (b.name || '').length;
    cnt.textContent = len + ' / ' + cfg.maxLength;
    cnt.classList.toggle('warn', len > cfg.maxLength);
    const miss = cfg.required && !cleanName(b.name);
    box.classList.toggle('missing', flagMissing && miss);
    const card = box.closest('.block'); if (card) card.classList.toggle('missing', flagMissing && miss);
  };
  const inp = h('input', { class:'input', value:b.name || '', maxlength:String(cfg.maxLength), autocomplete:'off', spellcheck:'true',
    'aria-label':'Название слайда', placeholder:NAME_PH[b.type] || '',
    oninput:e => {
      const raw = e.target.value, clean = raw.replace(BAD_CHARS, '');
      if (clean !== raw){
        const p = Math.max(0, (e.target.selectionStart || clean.length) - (raw.length - clean.length));
        e.target.value = clean; e.target.setSelectionRange(p, p);
        err.textContent = 'В названии нельзя использовать символы \\ / : * ? " < > |';
      } else err.textContent = '';
      b.name = clean; if (b.type === 'thesis') b.nameAuto = !clean.trim(); show(); change();
    },
    onblur:e => {
      let c = cleanName(e.target.value);
      if (!c && b.type === 'thesis'){ b.nameAuto = true; c = autoName(b.text); }   // стёрли название — снова берём первые слова текста
      if (c !== e.target.value){ e.target.value = c; b.name = c; change(); }
      show();
    } });
  inp.addEventListener('sync', show);
  box.append(h('span', { class:'name-pre', text:'[' + n + ']', title:'Номер слайда ставится сам' }), inp);
  requestAnimationFrame(show);
  return h('div', null,
    h('div', { class:'lbl-row' }, h('span', { class:'lbl', text:'Название слайда' + (cfg.required ? '' : ' — по желанию') }), cnt),
    box, err);
}

/* ----- Списки в тезисе: строки, начинающиеся с «• » или «1. » -----
   Хранятся как обычный текст с переносами строк; на слайде такие строки становятся пунктами списка с висячим отступом */
const LIST_RE = /^(•|\d{1,2}[.)])[ \u00a0]/;
function richText(el){ return plain(cleanHTML(el)).replace(/\u00a0/g, ' '); }
function caretOffset(el){
  const s = getSelection(); if (!s.rangeCount || !el.contains(s.getRangeAt(0).startContainer)) return -1;
  const r = s.getRangeAt(0), pre = document.createRange(); pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset);
  const tmp = document.createElement('div'); tmp.appendChild(pre.cloneContents());
  return plain(cleanHTML(tmp)).length;
}
/* Точка в DOM по номеру символа (перенос строки = 1 символ) */
function pointAt(el, off){
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT); let n, pos = 0;
  while ((n = w.nextNode())){
    if (n.nodeType === 3){ const L = n.nodeValue.replace(/\u00ad/g, '').length; if (off <= pos + L) return [n, off - pos]; pos += L; }
    else if (n.tagName === 'BR'){ if (off <= pos) return [n.parentNode, Array.prototype.indexOf.call(n.parentNode.childNodes, n)]; pos += 1; }
  }
  return [el, el.childNodes.length];
}
function selectText(el, a, b){
  const r = document.createRange(), p = pointAt(el, a), q = pointAt(el, b);
  r.setStart(p[0], p[1]); r.setEnd(q[0], q[1]);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}
function lineAt(el){
  const t = richText(el), c = caretOffset(el); if (c < 0) return null;
  const start = t.lastIndexOf('\n', c - 1) + 1, e = t.indexOf('\n', c), end = e < 0 ? t.length : e;
  const prevStart = start > 0 ? t.lastIndexOf('\n', start - 2) + 1 : -1;
  return { t, c, start, end, line:t.slice(start, end), prev:prevStart >= 0 ? t.slice(prevStart, start - 1) : '' };
}
function nextMarker(prevLine, kind){
  if (kind === '•') return '• ';
  const m = /^(\d{1,2})[.)][ \u00a0]/.exec(prevLine || '');
  return (m ? +m[1] + 1 : 1) + '. ';
}
/* Кнопки «•» и «1.»: включить или выключить список на строке с курсором */
function toggleList(kind){
  const el = activeRich(); if (!el || !el.dataset.lists) return;
  const L = lineAt(el); if (!L) return;
  const m = LIST_RE.exec(L.line), same = m && ((kind === '•') === (m[1] === '•'));
  if (m){ selectText(el, L.start, L.start + m[0].length); document.execCommand('delete'); }
  if (same) return;
  selectText(el, L.start, L.start);
  document.execCommand('insertText', false, nextMarker(L.prev, kind));
  const L2 = lineAt(el); if (L2) selectText(el, L2.end, L2.end);
}
/* Enter в списке продолжает его; Enter на пустом пункте — выход из списка */
function listEnter(el){
  const L = lineAt(el), m = L && LIST_RE.exec(L.line);
  if (m && !L.line.slice(m[0].length).trim() && L.c >= L.end){ selectText(el, L.start, L.end); document.execCommand('delete'); return; }
  document.execCommand('insertLineBreak');
  if (m) document.execCommand('insertText', false, m[1] === '•' ? '• ' : nextMarker(L.line, '1'));
}
/* «- » или «* » в начале строки становятся «• »; «1. » остаётся нумерацией, Enter ставит следующий номер */
function autoList(el){
  const L = lineAt(el); if (!L) return;
  const head = L.t.slice(L.start, L.c);
  if (/^[-*][ \u00a0]$/.test(head)){ selectText(el, L.start, L.c); document.execCommand('insertText', false, '• '); }
}

const BODY = {
  scripture(b, body){
    b.items.forEach((it, i) => {
      if (i) body.append(h('div', { class:'divider', text:'на этом же слайде' }));
      const box = h('div', { class:'item k-' + it.kind }, itemHead(b, it, i));
      if (it.kind === 'line') box.append(h('div', { class:'line-demo', title:'Тонкая линия во всю ширину текста' }));
      else if (it.kind === 'text') box.append(textItemEditor(b, it, i));
      else if (it.manual){
        const part = partEditor(b, it, i);
        part.append(h('div', { class:'chips' }, chip('plus', 'Стих', () => addVerse(b, it, i))));
        box.append(part);
      }
      else box.append(scriptureEditor(b, it, i));
      body.append(box);
    });
    const hasScr = b.items.some(it => it.kind === 'scripture');
    body.append(h('div', { class:'chips' },
      chip('plus', 'Место Писания', () => addItem(b, newScripture())),
      chip('plus', 'Текст', () => addItem(b, newTextItem())),
      chip('plus', 'Линия', () => addItem(b, newLineItem())),
      hasScr && chip('arrow', 'Продолжить на новом слайде', () => continueScripture(b), 'accent')));
    if (hasScr) body.append(h('label', { class:'switch' },
      h('input', { type:'checkbox', checked:b.showTr !== false, onchange:e => { b.showTr = e.target.checked; change(); updateCounter(b); } }),
      h('span', { class:'sw' }), 'Показывать перевод на слайде'));
  },
  thesis(b, body, n){
    body.append(nameField(b, n));
    const parts = b.parts, cnt = parts.length;
    parts.forEach((p, i) => {
      const moveP = d => { const j = i + d; if (j < 0 || j >= cnt) return; parts.splice(i, 1); parts.splice(j, 0, p); syncThesisText(b); syncAutoName(b); change(); rerender(b); };
      const tools = h('div', { class:'itools' });
      if (p.kind === 'text') [['left', 'alignl', 'По левому краю'], ['center', 'alignc', 'По центру'], ['right', 'alignr', 'По правому краю']].forEach(([a, icn, t]) =>
        tools.append(iconBtn(icn, t, () => { p.align = a; change(); rerender(b); }, p.align === a ? 'on' : '')));
      if (cnt > 1) tools.append(iconBtn('up', 'Выше', () => moveP(-1)), iconBtn('down', 'Ниже', () => moveP(1)),
        iconBtn('close', 'Убрать', () => { parts.splice(i, 1); syncThesisText(b); syncAutoName(b); change(); rerender(b); }, 'danger'));
      const box = h('div', { class:'item k-' + p.kind },
        h('div', { class:'item-head' }, h('span', { class:'half-tag', text:p.kind === 'line' ? 'Линия' : 'Текст' }), tools));
      if (p.kind === 'line') box.append(h('div', { class:'line-demo', title:'Тонкая линия во всю ширину текста' }));
      else {
        box.append(rich(p.html, { key:b.id + ':p' + i, lists:true, ph:i ? 'Ещё текст на этом слайде' : 'Мысль, пункт плана или пояснение слова. Enter — новая строка, «- » или «1. » в начале строки — список',
          onInput:v => { p.html = v; syncThesisText(b); syncAutoName(b); change(); updateCounter(b); }, onEnter:listEnter }));
        box.append(h('div', { class:'opt-row' }, partStepper(b, p),
          h('label', { class:'switch' }, h('input', { type:'checkbox', checked:!!p.caps, onchange:e => { p.caps = e.target.checked; change(); updateCounter(b); } }),
            h('span', { class:'sw' }), 'Заглавными буквами')));
      }
      if (i) body.append(h('div', { class:'divider', text:'на этом же слайде' }));
      body.append(box);
    });
    body.append(h('div', { class:'chips' },
      chip('plus', 'Текст', () => { parts.push(newThesisPart()); change(); rerender(b); focusRich(b.id + ':p' + (parts.length - 1), 0); }),
      chip('plus', 'Линия', () => { parts.push(newLineItem()); change(); rerender(b); })));
    body.append(h('div', { class:'opt-row' }, h('span', { class:'lbl', style:'margin:0' , text:'Весь текст по вертикали' }), valignTools(b)));
  },
  quote(b, body){
    body.append(h('div', null, h('div', { class:'lbl-row' }, h('span', { class:'lbl', text:'Цитата' }), scaleStepper(b)),
      rich(b.text, { key:b.id + ':t', ph:'Текст цитаты, без кавычек. Enter — новая строка', onInput:v => { b.text = v; change(); updateCounter(b); } })));
    body.append(capsSwitch(b));
    body.append(field('Автор', input(b, 'author', 'Имя Фамилия, а через запятую, если нужно, источник', { oninput:e => { b.author = e.target.value; change(); updateCounter(b); } })));
  },
  image(b, body, n){
    body.append(nameField(b, n));
    body.append(toggle([['find', 'Найди сам'], ['send', 'Пришлю отдельно']], b.mode, v => { b.mode = v; change(); rerender(b); }));
    if (b.mode === 'find') body.append(field('Что должно быть на картинке', area(b, 'desc', 'Опишите изображение: что на нём, настроение. Можно добавить пример или ссылку')));
    else {
      body.append(h('div', { class:'callout' }, ic('image'), h('div', { html:'Отправьте файл отдельно с подписью <b>«Слайд ' + n + '»</b>, так он не потеряется.' })));
      body.append(field('Комментарий, если нужен', area(b, 'desc', 'Например: обрезать по центру, без текста', 2)));
    }
  },
  video(b, body, n){
    body.append(nameField(b, n));
    body.append(toggle([['link', 'Ссылка'], ['send', 'Пришлю отдельно']], b.mode, v => { b.mode = v; change(); rerender(b); }));
    if (b.mode === 'link') body.append(field('Ссылка на видео', input(b, 'url', 'https://…', { type:'url', inputmode:'url' })));
    else body.append(h('div', { class:'callout' }, ic('video'), h('div', { html:'Отправьте видео отдельно с подписью <b>«Слайд ' + n + '»</b>.' })));
    body.append(h('div', { class:'grid-2' }, field('Показать с', input(b, 'from', '0:00')), field('По', input(b, 'to', 'до конца'))));
    body.append(field('Комментарий', area(b, 'desc', 'Со звуком или без, что сказать перед видео…', 2)));
  },
  free(b, body, n){
    body.append(nameField(b, n));
    body.append(field('Что должно быть на слайде', area(b, 'desc', 'Опишите словами: три перевода рядом, схема, особая вёрстка… Можно вставить тексты и ссылки', 4)));
  },
  text(b, body){
    body.append(area(b, 'text', 'Вставьте кусок проповеди до следующего слайда. На экран не выводится, это подсказка оператору', 4));
    body.append(h('label', { class:'switch' },
      h('input', { type:'checkbox', checked:b.splash, onchange:e => { b.splash = e.target.checked; change(); } }),
      h('span', { class:'sw' }), 'Здесь вывести заставку проповеди'));
  },
  note(b, body){
    body.append(area(b, 'text', 'Например: после слов «…и Он сказал им» запустить видео', 2));
    body.append(h('p', { class:'hint', text:'Оператор увидит заметку крупно и заглавными буквами, даже если скроет текст проповеди.' }));
  }
};

/* ----- Действия с блоками ----- */
function openSheet(at){ sheetAt = at; sheetOverlay.classList.add('open'); }
function closeSheet(){ sheetOverlay.classList.remove('open'); }
function addBlock(type, at){
  const nb = newBlock(type);
  state.blocks.splice(at, 0, nb);
  closeSheet(); change(); renderMain(); updateStatus();
  const card = document.querySelector('.block[data-id="' + nb.id + '"]');
  if (card){
    card.scrollIntoView({ block:'center', behavior:'smooth' });
    flash(nb.id);
    // тезис и цитата: курсор сразу в текст (название тезиса сформируется из него само)
    const f = (type === 'thesis' || type === 'quote') ? card.querySelector('.bbody .rich') : card.querySelector('.bbody input, .bbody textarea, .bbody .rich');
    if (f && window.matchMedia('(pointer:fine)').matches) f.focus({ preventScroll:true });
  }
}
function addItem(b, it){
  b.items.push(it);
  change(); rerender(b);
  const i = b.items.length - 1;
  if (it.kind === 'text') focusRich(b.id + ':' + i + ':t', 0);
  else if (it.kind === 'line') return;
  else { if (!it.manual) loadBible(it.lang); const card = document.querySelector('.block[data-id="' + b.id + '"]'); const items = card && card.querySelectorAll('.item'); if (items && items[i]) items[i].scrollIntoView({ block:'center', behavior:'smooth' }); }
}
function continueScripture(b){
  const scr = b.items.filter(it => it.kind === 'scripture'), lp = scr[scr.length - 1];
  const nb = newBlock('scripture');
  nb.showTr = b.showTr !== false;   // настройка «Показывать перевод» переходит на новый слайд
  if (lp.manual){
    const last = lp.verses[lp.verses.length - 1];
    const nx = nextNum(last.num);
    const it = Object.assign(newPart(), { mBook:lp.mBook || '', mChapter:lp.mChapter || '', mVerses:nx, translation:lp.translation, verses:[{ num:nx, text:'' }] });
    it.ref = manualRef(it);
    nb.items = [it];
  } else {
    const it = Object.assign(newScripture(lp.lang), { book:lp.book, chapter:lp.chapter, trName:lp.trName || '' });
    const cv = chapterVerses(it), next = lp.sel.length ? lp.sel[lp.sel.length - 1] + 1 : 0;
    if (cv && cv[next] != null) it.sel = [next];
    syncVerses(it);
    nb.items = [it];
  }
  state.blocks.splice(state.blocks.indexOf(b) + 1, 0, nb);
  change(); renderMain();
  const card = document.querySelector('.block[data-id="' + nb.id + '"]');
  if (card) card.scrollIntoView({ block:'start', behavior:'smooth' });
  flash(nb.id);
  toast('Новый слайд с тем же местом');
}
function move(b, dir){
  const i = state.blocks.indexOf(b), last = state.blocks.length - 1;
  const j = dir === -Infinity ? 0 : dir === Infinity ? last : i + dir;   // ±Infinity — в самый верх или низ
  if (j < 0 || j > last || j === i) return;
  state.blocks.splice(i, 1); state.blocks.splice(j, 0, b);
  change(); renderMain();
  const card = document.querySelector('.block[data-id="' + b.id + '"]');
  if (card) card.scrollIntoView({ block:'center', behavior:'smooth' });
  flash(b.id);
}
function duplicate(b){
  const c = JSON.parse(JSON.stringify(b)); c.id = uid(); c.done = false;
  state.blocks.splice(state.blocks.indexOf(b) + 1, 0, c);
  change(); renderMain(); flash(c.id); toast('Блок скопирован');
}
function removeBlock(b){
  const i = state.blocks.indexOf(b);
  state.blocks.splice(i, 1);
  change(); renderMain();
  toast('Блок удалён', 'Вернуть', () => {
    state.blocks.splice(Math.min(i, state.blocks.length), 0, b);
    change(); renderMain(); flash(b.id);
  });
}
function flash(id){
  const c = document.querySelector('.block[data-id="' + id + '"]'); if (!c) return;
  c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash');
}

/* ----- Оформление текста ----- */
function activeRich(){ const a = document.activeElement; return a && a.classList && a.classList.contains('rich') ? a : null; }
function fmt(cmd){ if (!activeRich()) return; document.execCommand(cmd, false, null); syncFmt(); }
/* Кнопки Ж, К, Ч подсвечиваются, если оформление уже есть: Ж + К вместе = жирный курсив */
function syncFmt(){
  if (!activeRich()) return;
  [['b', 'bold'], ['i', 'italic'], ['u', 'underline']].forEach(([c, cmd]) => {
    const btn = fmtEl.querySelector('.fbtn.' + c); if (!btn) return;
    let on = false; try { on = document.queryCommandState(cmd); } catch(e){}
    btn.classList.toggle('on', on);
  });
  const s = getSelection(), ub = fmtEl.querySelector('.up-btn');
  if (ub && s.rangeCount){ let a = s.getRangeAt(0).commonAncestorContainer; if (a.nodeType === 3) a = a.parentNode; ub.classList.toggle('on', !!(a.closest && a.closest('span.up'))); }
}
document.addEventListener('selectionchange', syncFmt);
/* «Все прописные»: выделенный кусок показывается заглавными на слайде, в просмотре и PDF; повторное нажатие убирает */
function toggleUp(){
  const el = activeRich(); if (!el) return;
  const s = getSelection(); if (!s.rangeCount) return;
  const r = s.getRangeAt(0);
  let anc = r.commonAncestorContainer; if (anc.nodeType === 3) anc = anc.parentNode;
  const u = anc.closest ? anc.closest('span.up') : null;
  if (u && el.contains(u)){
    while (u.firstChild) u.parentNode.insertBefore(u.firstChild, u);
    u.remove();
  } else {
    if (r.collapsed){ toast('Сначала выделите текст'); return; }
    const sp = document.createElement('span'); sp.className = 'up';
    sp.appendChild(r.extractContents());
    sp.querySelectorAll('span.up').forEach(x => { while (x.firstChild) x.parentNode.insertBefore(x.firstChild, x); x.remove(); });
    r.insertNode(sp);
    const nr = document.createRange(); nr.selectNodeContents(sp); s.removeAllRanges(); s.addRange(nr);
  }
  el.dispatchEvent(new Event('input', { bubbles:true }));
  syncFmt();
}
function toggleMark(){
  const el = activeRich(); if (!el) return;
  const s = getSelection(); if (!s.rangeCount) return;
  const r = s.getRangeAt(0);
  let anc = r.commonAncestorContainer; if (anc.nodeType === 3) anc = anc.parentNode;
  const m = anc.closest ? anc.closest('mark') : null;
  if (m && el.contains(m)){
    while (m.firstChild) m.parentNode.insertBefore(m.firstChild, m);
    m.remove();
  } else {
    if (r.collapsed){ toast('Сначала выделите слово'); return; }
    const mk = document.createElement('mark');
    mk.appendChild(r.extractContents());
    mk.querySelectorAll('mark').forEach(x => { while (x.firstChild) x.parentNode.insertBefore(x.firstChild, x); x.remove(); });
    r.insertNode(mk);
    const nr = document.createRange(); nr.selectNodeContents(mk); s.removeAllRanges(); s.addRange(nr);
  }
  el.dispatchEvent(new Event('input', { bubbles:true }));
}
function clearFmt(){
  const el = activeRich(); if (!el) return;
  const s = getSelection();
  if (!s.rangeCount || s.isCollapsed){ toast('Выделите текст, с которого убрать оформление'); return; }
  const r = s.getRangeAt(0);
  if (!el.contains(r.commonAncestorContainer)) return;
  const tn = document.createTextNode(r.toString());
  r.deleteContents(); r.insertNode(tn);
  // выносим текст из всех оформляющих тегов: жирный, подчёркивание, маркер
  let p = tn.parentNode;
  while (p && p !== el && /^(B|STRONG|U|MARK|I|EM|SPAN|FONT)$/.test(p.tagName)){
    const right = p.cloneNode(false);
    while (tn.nextSibling) right.appendChild(tn.nextSibling);
    p.after(tn); tn.after(right);
    if (!right.textContent) right.remove();
    if (!p.textContent) p.remove();
    p = tn.parentNode;
  }
  el.querySelectorAll('b,strong,u,mark,i,em').forEach(x => { if (!x.textContent) x.remove(); });
  const nr = document.createRange(); nr.selectNodeContents(tn); s.removeAllRanges(); s.addRange(nr);
  el.dispatchEvent(new Event('input', { bubbles:true }));
}
function placeFmt(){
  const vv = window.visualViewport;
  if (!vv){ fmtEl.style.top = ''; fmtEl.style.bottom = ''; return; }
  fmtEl.style.bottom = 'auto';
  fmtEl.style.top = (vv.offsetTop + vv.height - fmtEl.offsetHeight - 14) + 'px';
}
document.addEventListener('focusin', e => {
  if (e.target.classList && e.target.classList.contains('rich')){
    fmtEl.classList.toggle('lists', !!e.target.dataset.lists);
    fmtEl.classList.add('show'); toastEl.classList.add('lift'); placeFmt();
  }
});
document.addEventListener('focusout', () => setTimeout(() => {
  if (!activeRich()){ fmtEl.classList.remove('show'); toastEl.classList.remove('lift'); }
}, 120));
if (window.visualViewport){ visualViewport.addEventListener('resize', placeFmt); visualViewport.addEventListener('scroll', placeFmt); }

/* ----- Просмотр для оператора ----- */
function renderView(){
  const m = state.meta, nums = slideNums();
  const v = h('div', { class:'view', style:'--vs:' + viewOpts.size });
  v.append(h('div', { class:'vhead' },
    h('h1', { class:'vtitle', text:m.title || 'Без названия' }),
    h('div', { class:'vmeta', text:[fmtDate(m.date), m.preacher].filter(Boolean).join(' · ') }),
    null));
  const setSize = d => { viewOpts.size = Math.max(0.8, Math.min(1.6, Math.round((viewOpts.size + d) * 10) / 10)); LS.set('swp-view', JSON.stringify(viewOpts)); renderMain(); };
  v.append(h('div', { class:'vctrl' },
    toggle([['all', 'Слайды + текст'], ['slides', 'Только слайды']], viewOpts.showText ? 'all' : 'slides', val => { viewOpts.showText = val === 'all'; LS.set('swp-view', JSON.stringify(viewOpts)); renderMain(); }),
    h('div', { class:'size' },
      h('button', { type:'button', title:'Мельче', onclick:() => setSize(-0.1) }, 'A−'),
      h('button', { type:'button', title:'Крупнее', onclick:() => setSize(0.1) }, 'A+'))));
  const list = h('div', { class:'vlist' });
  state.blocks.forEach(b => {
    if (b.type === 'text'){
      const showBody = viewOpts.showText && b.text.trim();
      if (!showBody && !b.splash) return;
      list.append(h('div', { class:'vtx' },
        b.splash && h('div', { class:'vsplash' }, ic('splash'), 'Заставка'),
        showBody && h('div', { class:'vtx-body', text:b.text })));
    } else if (b.type === 'note'){
      // заметки оператору видны всегда, даже в режиме «Только слайды»
      if (!(b.text || '').trim()) return;
      list.append(h('div', { class:'vnote' },
        h('div', { class:'vnote-tag' }, ic('note'), 'Оператору'),
        h('div', { class:'vnote-body', text:b.text.trim() })));
    } else list.append(viewSlide(b, nums[b.id]));
  });
  if (!state.blocks.length) list.append(h('p', { class:'hint', text:'Пока нет ни одного блока. Переключитесь в «Редактор» или откройте файл проповеди.' }));
  v.append(list);
  wrapScripts(v);
  mainEl.append(v);
}
function viewPart(p){
  const verses = p.verses.filter(x => plain(x.text).trim())
    .map(x => '<span>' + (x.num ? '<sup>' + esc(x.num) + '</sup>' : '') + sanitize(x.text) + '</span>').join(' ');
  return h('div', null,
    h('div', { class:'vs-ref' }, p.ref || 'Место не указано', p.translation && h('span', { class:'vs-tr', text:p.translation })),
    h('div', { class:'vs-verses', html:verses || '<span class="empty-v">Текст не вставлен</span>' }));
}
/* Картинка, видео, свободный слайд: сначала название, ниже подсказки для того, кто готовит слайды */
function nameView(b){
  const n = cleanName(b.name);
  return h('div', { class:'vs-name' + (n ? '' : ' empty-v'), text:n || 'Без названия' });
}
function mediaView(icon, title, lines){
  return h('div', { class:'vs-media' }, ic(icon), h('div', null, h('div', { class:'vs-mtitle', text:title }), lines));
}
function viewSlide(b, n){
  const card = h('article', { class:'vslide', style:'--tc:var(--c-' + b.type + ')' });
  card.append(h('div', { class:'vs-head' },
    h('span', { class:'vs-num', text:pad(n) }),
    h('span', { class:'vs-type', text:TYPES[b.type].label }),
    iconBtn('dup', 'Скопировать текст слайда', () => copyText(slideText(b)), 'vs-copy')));
  const c = h('div', { class:'vs-body' });
  const desc = t => t && t.trim() ? h('div', { class:'vs-mdesc', text:t }) : null;
  switch (b.type){
    case 'scripture':
      b.items.forEach((it, i) => {
        if (i) c.append(h('div', { class:'vs-hr' }));
        if (it.kind === 'line') return;
        c.append(it.kind === 'text' ? h('div', { class:'vs-note', style:'text-align:' + it.align, html:sanitize(it.html) || '<span class="empty-v">Пусто</span>' }) : viewPart(it));
      });
      break;
    case 'thesis':
      c.append(h('div', { class:'vs-thesis', html:sanitize(b.text) || '<span class="empty-v">Пусто</span>' }));
      break;
    case 'quote':
      c.append(h('blockquote', { class:'vs-quote', html:'«' + sanitize(b.text) + '»' }));
      if (b.author) c.append(h('div', { class:'vs-author', text:'— ' + b.author }));
      break;
    case 'image':
      c.append(nameView(b));
      c.append(mediaView('image', b.mode === 'find' ? 'Найти картинку' : 'Файл пришлют отдельно («Слайд ' + n + '»)', desc(b.desc)));
      break;
    case 'video': {
      const lines = [];
      if (b.mode === 'link' && b.url) lines.push(h('div', { class:'vs-mdesc' }, h('a', { href:b.url, target:'_blank', rel:'noopener', text:b.url })));
      if (b.from || b.to) lines.push(h('div', { class:'vs-mdesc', text:'Показать: ' + (b.from || '0:00') + ' – ' + (b.to || 'до конца') }));
      lines.push(desc(b.desc));
      c.append(nameView(b));
      c.append(mediaView('video', b.mode === 'link' ? 'Видео по ссылке' : 'Видео пришлют отдельно («Слайд ' + n + '»)', lines));
      break;
    }
    case 'free':
      c.append(nameView(b));
      c.append(mediaView('free', 'Свободный слайд', desc(b.desc) || h('div', { class:'vs-mdesc', text:'Описание не заполнено' })));
      break;
  }
  card.append(c);
  return card;
}
function slideText(b){
  const P = p => {
    const head = (p.ref || '') + (p.translation ? ' (' + p.translation + ')' : '');
    const body = p.verses.filter(v => plain(v.text).trim()).map(v => (v.num ? v.num + ' ' : '') + plain(v.text).trim()).join(' ');
    return [head, body].filter(Boolean).join('\n');
  };
  switch (b.type){
    case 'scripture':  return b.items.filter(it => it.kind !== 'line').map(it => it.kind === 'text' ? plain(it.html).trim() : P(it)).filter(Boolean).join('\n\n');
    case 'thesis':     return plain(b.text).trim();
    case 'quote':      return '«' + plain(b.text).trim() + '»' + (b.author ? '\n— ' + b.author : '');
    case 'video':      return [b.url, b.desc].filter(Boolean).join('\n');
    default:           return b.desc || '';
  }
}
function copyText(t, prefix){
  const done = () => toast(prefix ? prefix + t : 'Скопировано');
  const fallback = () => {
    const ta = h('textarea', { style:'position:fixed;opacity:0;top:0' }); ta.value = t; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch(e){ toast('Не удалось скопировать'); }
    ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback); else fallback();
}


