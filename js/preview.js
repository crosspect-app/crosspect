'use strict';

/* ========= Предпросмотр слайдов =========
   Кадр 1920×1080, раскладывается в полном размере и только масштабируется.
   Писание: место Писания стоит на фиксированной высоте; отступ от базовой линии нижней строки до низа фона
   не меньше, чем от верха букв места Писания до верха фона, иначе всё содержимое пропорционально уменьшается.
   Тезис и цитата: текст по центру своей области (тезис можно выровнять влево или вправо); если не помещается, уменьшается. */
const SL = { W:1920, H:1080, min:16, trGap:48 };
/* Заставка: название от size × размер проповеди (короткое) до size × min% (три строки), слова не переносятся; длиннее — мельче,
   лишь бы влезло. Размеры — в настройках слайдов (kinds.splash); размер −/+ — один на всю проповедь (settings.splash, %) */
const SPLASH = { gap:56 };
const splashMax = () => slidesCfg().kinds.splash.size;
const splashMin3 = () => Math.round(splashMax() * slidesCfg().kinds.splash.min / 100);
function splashScale(b){
  const R = scaleRange('splash'), v = b && b.meta ? 100 : +((state && state.settings && state.settings.splash) || 100);   // b.meta — пример в окне настроек
  return Math.min(R.max, Math.max(R.min, Math.round(v)));
}
const splashBase = b => splashMax() * splashScale(b) / 100;
let lastScale = 0;   // масштаб последнего предпросмотра в редакторе   // trGap — запас между текстом и подписью перевода
/* Размеры 100% в px — в настройках слайдов (kinds): Писание 52,8 (= 48 × 110%), тезис 50,4, цитата 51,48; имя автора цитаты — 52 */
const basePx = t => slidesCfg().kinds[t].size;
const scrPx = () => basePx('scripture');
const NBSP = '\u00a0';
const SHORT_RE = /(?<=^|[\s(«"„])([А-Яа-яЁёA-Za-zІіЇїЄєҐґ]{1,2}|[БбДдНнПпЧчКкИиОо](?:ез|ля|ад|од|ри|ро|то|ак|ли|бо|зо|ем)) (?=\S|$)/g;
function typoText(s){
  return String(s).replace(/[\t\r\n]+/g, ' ')
    .replace(/ {2,}/g, m => NBSP.repeat(m.length - 1) + ' ')   // несколько пробелов подряд остаются на слайде
    .replace(/(\d)\s*[-–]\s*(\d)/g, '$1–$2')
    .replace(/ - /g, ' — ').replace(/ —/g, NBSP + '—')
    .replace(SHORT_RE, '$1' + NBSP)
    .replace(/ (же|ли|ль|бы|б|ж)(?=[\s,.!?;:]|$)/gi, NBSP + '$1');
}
function typoDom(root){
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), ns = []; let n;
  while ((n = w.nextNode())) ns.push(n);
  ns.forEach(t => { t.nodeValue = typoText(t.nodeValue); });
}
/* Греческие и еврейские слова (с диакритикой) оборачиваются в <span class="xl"> — шрифт Inter / Noto Sans Hebrew */
const XL_RE = /[\u0370-\u03FF\u1F00-\u1FFF\u0590-\u05FF\uFB1D-\uFB4F][\u0300-\u036F\u0370-\u03FF\u1F00-\u1FFF\u0590-\u05FF\uFB1D-\uFB4F]*/g;
function wrapScripts(root){
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), ns = []; let n;
  while ((n = w.nextNode())) if (!(n.parentNode && n.parentNode.classList && n.parentNode.classList.contains('xl'))) { XL_RE.lastIndex = 0; if (XL_RE.test(n.nodeValue)) ns.push(n); }
  ns.forEach(t => {
    const frag = document.createDocumentFragment(), v = t.nodeValue; let last = 0, m;
    XL_RE.lastIndex = 0;
    while ((m = XL_RE.exec(v))){
      if (m.index > last) frag.append(v.slice(last, m.index));
      const sp = document.createElement('span'); sp.className = 'xl'; sp.textContent = m[0]; frag.append(sp);
      last = m.index + m[0].length;
    }
    if (last < v.length) frag.append(v.slice(last));
    t.parentNode.replaceChild(frag, t);
  });
}
/* Если на последней строке одно слово — переносим перед последней группой слов предпоследней строки */
function fixOrphan(p){
  const sps = [], tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let n;
  while ((n = tw.nextNode())) for (let i = 0; i < n.nodeValue.length; i++) if (n.nodeValue[i] === ' ') sps.push({ n, i });
  if (!sps.length) return;
  const rectAt = (node, i) => { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); return r.getClientRects()[0]; };
  const topAfter = sp => {
    let node = sp.n, i = sp.i + 1;
    if (i >= node.nodeValue.length){
      const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); w.currentNode = node; node = w.nextNode();
      while (node && !node.nodeValue.length) node = w.nextNode();
      if (!node) return null; i = 0;
    }
    const rc = rectAt(node, i); return rc ? rc.top : null;
  };
  const fw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let fn = fw.nextNode();
  while (fn && !fn.nodeValue.trim()) fn = fw.nextNode();
  if (!fn) return;
  const f = rectAt(fn, 0); let lastTop = f ? f.top : -Infinity;
  const tol = (f ? f.height : 10) * 0.4;
  const starts = [];
  sps.forEach((sp, k) => { const t = topAfter(sp); if (t != null && t > lastTop + tol){ starts.push(k); lastTop = t; } });
  if (!starts.length) return;
  const ls = starts[starts.length - 1];
  if (ls !== sps.length - 1) return;
  const txt = p.textContent, tail = txt.slice(txt.lastIndexOf(' ') + 1);
  if (tail.split(/[\s\u00a0]+/).filter(Boolean).length > 1) return;
  const prev = starts.length > 1 ? starts[starts.length - 2] : -1, cand = ls - 1;
  if (cand <= prev) return;
  const sp = sps[cand], after = sp.n.splitText(sp.i);
  after.nodeValue = after.nodeValue.slice(1);
  sp.n.parentNode.insertBefore(document.createElement('br'), after);
}

/* Шум зерна (NOISE, --noise) — в background.js: теперь он одинаковый при каждом открытии */

let FM = null;
function fontMetrics(){
  if (FM) return FM;
  const c = document.createElement('canvas').getContext('2d');
  const get = wt => {
    c.font = wt + ' 100px Unbounded';
    const m = c.measureText('НЕБ');
    return { asc:(m.fontBoundingBoxAscent || 96) / 100, cap:(m.actualBoundingBoxAscent || 72) / 100 };
  };
  FM = { 700:get('700'), 400:get('400') };
  return FM;
}

function slideEl(b){
  // слайд всегда раскладывается в полном кадре 1920×1080 и только масштабируется — переносы как в итоговом JPEG
  // фон: прежние пятна (.sl-glow) или картинка генератора (.sl-bg) — выбирают переменные из slideVars (background.js, bgVars)
  const kids = [h('div', { class:'sl-frame' }),
    h('div', { class:'sl-panel' }, h('div', { class:'sl-glow' }), h('div', { class:'sl-bg' }), h('div', { class:'sl-grain' }), h('div', { class:'sl-vig' }))];
  if (!PREVIEW[b.type]){}   // картинка, видео, свободный: пустой слайд (рамка и фон) для JPEG
  else if (b.type === 'scripture') kids.push(h('div', { class:'sl-content' }), h('div', { class:'sl-tr' }));
  else if (b.type === 'splash') kids.push(
    h('div', { class:'sl-sp-box' }, h('div', { class:'sl-sp-title' })),
    h('div', { class:'sl-sp-foot' }, h('div', { class:'sl-hr' }), h('div', { class:'sl-sp-row' }, h('span', { class:'sl-sp-name' }), h('span', { class:'sl-sp-date' }))));
  else {
    kids.push(h('div', { class:'sl-box sl-box-' + b.type }, h('div', { class:'sl-inner' })));
    if (b.type === 'quote') kids.push(h('div', { class:'sl-author' }));
  }
  // масштаб берём от последнего разложенного слайда: иначе новый предпросмотр на миг рисуется мелким и сбоку виден чёрный фон
  // поля, шрифты и расстояния — переменными на самом слайде: так они попадают и в JPEG, и в пример в окне настроек
  const v = slideVars(slidesCfg()), st = h('div', { class:'sl-stage' }, kids);
  Object.keys(v).forEach(k => st.style.setProperty(k, v[k]));
  return h('div', { class:'sl', 'data-id':b.id, 'aria-label':'Предпросмотр слайда', style:lastScale ? '--s:' + lastScale : null }, st);
}
/* Убрать первые n букв текста из HTML (маркер списка), не трогая оформление */
function dropChars(html, n){
  const t = document.createElement('template'); t.innerHTML = html;
  const w = document.createTreeWalker(t.content, NodeFilter.SHOW_TEXT); let node;
  while (n > 0 && (node = w.nextNode())){ const k = Math.min(n, node.nodeValue.length); node.nodeValue = node.nodeValue.slice(k); n -= k; }
  return t.innerHTML;
}
/* Строки текста → абзацы; с lists строки «• …» и «1. …» собираются в список */
function paraHTML(html, lists){
  let out = '', list = '';
  const flush = () => { if (list){ out += '<div class="sl-list">' + list + '</div>'; list = ''; } };
  html.split('<br>').forEach(x => {
    const m = lists && LIST_RE.exec(plain(x).replace(/^\s+/, ''));
    if (m){
      const lead = plain(x).length - plain(x).replace(/^\s+/, '').length;
      const mk = m[1] === '•' ? '<span class="sl-mk"><span class="sl-dot"></span></span>' : '<span class="sl-mk num">' + esc(m[1].replace(')', '.')) + '</span>';
      list += '<p class="sl-tp sl-li">' + mk + '<span class="sl-lt">' + dropChars(x, lead + m[0].length) + '</span></p>';
    } else { flush(); out += '<p class="sl-tp">' + (x || '<br>') + '</p>'; }
  });
  flush();
  return out;
}
/* Вид стихов — общий для всех слайдов Писания (настройки слайдов, verses) */
const versesCfg = () => slidesCfg().verses;
function slideHTML(b){
  const out = [], V = versesCfg();
  b.items.forEach(it => {
    if (it.kind === 'text'){
      const html = sanitize(it.html);
      if (!plain(html).trim()) return;
      out.push('<div class="sl-text' + (it.caps ? ' caps' : '') + '" style="text-align:' + it.align + '">' + paraHTML(html) + '</div>');
      return;
    }
    if (it.kind === 'line'){ out.push('<div class="sl-hr"></div>'); return; }   // линия там, где стоит в слайде: и сверху, и снизу
    const vs = it.verses.filter(v => plain(v.text).trim());
    const ref = (it.ref || '').trim();
    const hasText = out.some(x => x !== '<div class="sl-hr"></div>');
    if (!ref && !vs.length && hasText) return;
    out.push(ref ? '<div class="sl-ref">' + esc(typoText(ref)) + '</div>' : '<div class="sl-ref ph">Место Писания</div>');
    const fr = V.frame ? ' framed' : '';
    const sup = v => v.num ? '<sup>' + esc(v.num) + '</sup>' + NBSP : '';
    if (vs.length && V.flow === 'lines' && V.align === 'left')   // с новой строки, номера колонкой слева
      out.push('<div class="sl-vlist' + fr + '">' + vs.map(v => '<span class="sl-vn">' + esc(v.num) + '</span><p class="sl-verse sl-vt">' + sanitize(v.text) + '</p>').join('') + '</div>');
    else if (vs.length && V.flow === 'lines')   // с новой строки по центру или справа: номер перед стихом, весь текст выровнен
      out.push('<div class="sl-vstack' + fr + '">' + vs.map(v => '<p class="sl-verse">' + sup(v) + sanitize(v.text) + '</p>').join('') + '</div>');
    else if (vs.length)                          // все стихи в строку
      out.push('<p class="sl-verse' + fr + '">' + vs.map(v => sup(v) + sanitize(v.text)).join(' ') + '</p>');
    if (!vs.length && !hasText) out.push('<p class="sl-verse sl-empty">Здесь появится текст стихов</p>');
  });
  if (!out.length) out.push('<div class="sl-ref ph">Место Писания</div>');
  return out.join('');
}
function boxHTML(b){
  if (b.type === 'thesis' && Array.isArray(b.parts)){
    const R = scaleRange('thesis'), out = [];
    b.parts.forEach(p => {
      if (p.kind === 'line'){ out.push('<div class="sl-hr"></div>'); return; }
      const html = sanitize(p.html); if (!plain(html).trim()) return;
      const sc = Math.min(R.max, Math.max(R.min, Math.round(+p.scale || 100))) / 100;
      out.push('<div class="sl-part' + (p.caps ? ' caps' : '') + (p.frame ? ' framed' : '') + '" data-align="' + p.align + '" style="text-align:' + p.align + ';font-size:' + sc + 'em">' + paraHTML(html, true) + '</div>');
    });
    // линия остаётся там, где стоит, и сверху, и снизу текста; без текста — заглушка вместе с линиями
    if (!out.some(x => x !== '<div class="sl-hr"></div>')) out.splice(out.length ? 1 : 0, 0, '<p class="sl-tp sl-empty">Текст тезиса</p>');
    return out.join('');
  }
  const html = sanitize(b.text);
  if (plain(html).trim()) return paraHTML(html, b.type === 'thesis');
  return '<p class="sl-tp sl-empty">' + (b.type === 'quote' ? 'Текст цитаты' : 'Текст тезиса') + '</p>';
}
/* Автор «Жан Кальвин» → ЖАН **КАЛЬВИН**; подпись («Наставление») — мелко второй строкой */
function authorHTML(b){
  const name = String(b.author || '').trim(), src = String(b.caption || '').trim();
  const w = name.split(/\s+/).filter(Boolean), last = w.pop() || '';
  const nm = last ? (w.length ? esc(typoText(w.join(' '))) + ' ' : '') + '<b>' + esc(last) + '</b>' : '';
  return nm + (src ? '<span class="src">' + esc(typoText(src)) + '</span>' : '');
}
/* Заставка: «Имя ФАМИЛИЯ» (фамилия жирным) и дата «дд/мм» */
function splashNameHTML(m){
  const f = String(m.firstName || '').trim(), l = String(m.lastName || '').trim();
  return (f ? esc(typoText(f)) + (l ? ' ' : '') : '') + (l ? '<b>' + esc(l) + '</b>' : '');
}
function splashDate(s){ const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? m[3] + '/' + m[2] : ''; }
function layoutSplash(sl, b, px){
  const m = b.meta || state.meta, box = sl.querySelector('.sl-sp-box'), t = sl.querySelector('.sl-sp-title'), foot = sl.querySelector('.sl-sp-foot');
  sl.querySelector('.sl-sp-name').innerHTML = splashNameHTML(m);
  sl.querySelector('.sl-sp-date').textContent = splashDate(m.date);
  // «Только название» (настройка слайдов, этап 7.3): линии, имени и даты нет, название — посередине всей области текста
  const only = !splashFootOn(b);   // этап 9.5: у проповеди своя «нижняя строка», по умолчанию — из настроек слайдов
  foot.style.display = only ? 'none' : '';
  box.style.bottom = only ? 'var(--sl-b)' : (SL.H - foot.offsetTop + SPLASH.gap) + 'px';   // иначе — посередине над линией с именем и датой
  const title = String(m.title || '').trim();
  t.classList.toggle('sl-empty', !title);
  t.textContent = typoText(title || 'Название проповеди');
  wrapScripts(t);
  t.style.fontSize = px + 'px';
  const lines = Math.round(t.offsetHeight / (px * slidesCfg().kinds.splash.lead));
  return t.scrollWidth <= t.clientWidth + 1 && t.offsetHeight <= box.clientHeight && (lines <= 3 || px <= splashMin3());
}
function firstTextRect(root){
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode()) && !n.nodeValue.replace(/\s/g, ''));
  if (!n) return null;
  let i = 0; while (i < n.nodeValue.length - 1 && /\s/.test(n.nodeValue[i])) i++;
  const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
  const rc = r.getClientRects()[0], cs = getComputedStyle(n.parentNode);
  return rc ? { top:rc.top, fs:parseFloat(cs.fontSize), wt:parseInt(cs.fontWeight, 10) >= 600 ? 700 : 400 } : null;
}
function lastTextRect(root){
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n, last = null;
  while ((n = w.nextNode())) if (n.nodeValue.replace(/\s/g, '')) last = n;
  if (!last) return null;
  let i = last.nodeValue.length - 1; while (i > 0 && /\s/.test(last.nodeValue[i])) i--;
  const r = document.createRange(); r.setStart(last, i); r.setEnd(last, i + 1);
  const rc = r.getClientRects()[0], cs = getComputedStyle(last.parentNode);
  return rc ? { top:rc.top, fs:parseFloat(cs.fontSize), wt:parseInt(cs.fontWeight, 10) >= 600 ? 700 : 400 } : null;
}
/* Подпись перевода внизу слайда: «· Синодальный перевод»; несколько разных переводов — через точку */
function slideTrName(it){
  if (it.manual) return (it.translation || '').trim();
  const L = LANGS[it.lang]; return L ? (L.slide || L.tr || '') : (it.translation || '');
}
function trFooterText(b){
  if (!versesCfg().showTr) return '';
  const names = [];
  b.items.forEach(it => {
    if (it.kind !== 'scripture' || !(it.verses || []).some(v => plain(v.text).trim())) return;
    const n = slideTrName(it); if (n && !names.includes(n)) names.push(n);
  });
  return names.length ? TR_FOOTER.replace('{name}', names.join(' · ')) : '';
}
function layoutAt(sl, b, px){
  const content = sl.querySelector('.sl-content'), V = versesCfg();
  content.style.fontSize = px + 'px';
  content.style.transform = '';
  content.style.textAlign = V.align;
  content.classList.toggle('al-left', V.align === 'left');
  content.classList.toggle('al-right', V.align === 'right');
  content.classList.toggle('caps', V.caps);
  content.innerHTML = slideHTML(b);
  content.querySelectorAll('.sl-verse, .sl-tp').forEach(typoDom);
  wrapScripts(content);
  content.querySelectorAll('.sl-verse, .sl-tp').forEach(fixOrphan);
  const fm = fontMetrics(), panel = sl.querySelector('.sl-panel').getBoundingClientRect();
  const k = sl.getBoundingClientRect().width / SL.W;   // масштаб предпросмотра: размеры шрифта в кадре, прямоугольники — на экране
  const ft = firstTextRect(content);
  if (!ft) return true;
  const topGap = ft.top + (fm[ft.wt].asc - fm[ft.wt].cap) * ft.fs * k - panel.top;   // верх заглавных букв первой строки → верх фона
  const lt = lastTextRect(content);
  if (!lt) return true;
  let baseline = lt.top + fm[lt.wt].asc * lt.fs * k;
  content.querySelectorAll('.framed, .sl-hr').forEach(f => { baseline = Math.max(baseline, f.getBoundingClientRect().bottom); });   // рамка пунктиром и линия ниже текста
  const foot = sl.querySelector('.sl-tr'), ftxt = trFooterText(b);
  if (foot){ foot.textContent = ftxt ? typoText(ftxt) : ''; foot.classList.toggle('on', !!ftxt); foot.style.fontSize = (scrPx() * 0.9) + 'px'; foot.style.textAlign = content.style.textAlign; }   // подпись перевода — 90% от размера стихов
  // свободное место снизу: до подписи перевода (с запасом) или столько же, сколько сверху
  const free = foot && ftxt ? (foot.getBoundingClientRect().top - baseline) - SL.trGap * k : (panel.bottom - baseline) - (topGap - 0.5 * k);
  if (free < 0) return false;
  if (V.valign === 'center' || V.valign === 'bottom') content.style.transform = 'translateY(' + ((V.valign === 'bottom' ? free : free / 2) / k) + 'px)';
  return true;
}
function layoutBox(sl, b, px){
  const box = sl.querySelector('.sl-box'), inner = sl.querySelector('.sl-inner');
  const au = sl.querySelector('.sl-author');
  if (au) au.innerHTML = authorHTML(b);
  const half = b.type === 'quote' && (b.half === 'left' || b.half === 'right') ? b.half : 'full';   // этап 9.3: текст цитаты на половине слайда
  box.dataset.half = half; if (au) au.dataset.half = half;
  const hw = clampHalfW(b.halfW) + '%';   // этап 9.5: ширина области текста; на «Во всю ширину» не используется
  box.style.setProperty('--hw', hw); if (au) au.style.setProperty('--hw', hw);
  inner.style.fontSize = px + 'px';
  const align = b.type === 'thesis' ? (b.align || 'center') : 'center';
  inner.style.textAlign = align; inner.dataset.align = align;
  box.style.justifyContent = b.type === 'thesis' ? ({ top:'flex-start', bottom:'flex-end' }[b.valign] || 'center') : 'center';
  inner.classList.toggle('caps', b.type !== 'thesis' && isCaps(b));
  inner.classList.toggle('framed', b.type === 'quote' && !!b.frame);   // обводка пунктиром (этап 9.5), как у части тезиса
  inner.classList.toggle('parts', b.type === 'thesis');
  inner.innerHTML = boxHTML(b);
  inner.querySelectorAll('.sl-tp').forEach(typoDom);
  wrapScripts(inner);
  inner.querySelectorAll('.sl-tp:not(.sl-li), .sl-lt').forEach(fixOrphan);
  return inner.offsetHeight <= box.clientHeight;   // размеры в пикселях кадра: масштаб на них не влияет
}
function fitSlide(sl, b){
  const w = sl.clientWidth; if (!w) return null;
  sl.style.setProperty('--s', w / SL.W);
  if (w < SL.W && !sl.closest('.film, .scfg, .hb-wall')) lastScale = w / SL.W;   // масштаб берём с крупных слайдов, не с миниатюр
  const fit = b.type === 'scripture' ? layoutAt : b.type === 'splash' ? layoutSplash : layoutBox;
  if (!PREVIEW[b.type]) return 1;   // пустой слайд (картинка, видео, свободный): только рамка и фон
  const base = b.type === 'scripture' ? scrPx() : b.type === 'splash' ? splashBase(b) : basePx(b.type) * blkScale(b) / 100;
  if (fit(sl, b, base)) return 1;
  let lo = SL.min, hi = base;
  if (!fit(sl, b, lo)) return lo / base;
  for (let k = 0; k < 10; k++){ const mid = (lo + hi) / 2; if (fit(sl, b, mid)) lo = mid; else hi = mid; }
  fit(sl, b, lo);
  return lo / base;
}
const previewTimers = {};
function schedulePreview(b){
  clearTimeout(previewTimers[b.id]);
  previewTimers[b.id] = setTimeout(() => runPreview(b), 90);
}
/* Слайд может стоять в нескольких местах сразу (лента, сцена, вид «Текст»): раскладываем каждый,
   а подпись под сценой и пометку «длинный текст» считаем по большому слайду, если он есть */
function runPreview(b){
  const sls = mainEl.querySelectorAll('.sl[data-id="' + b.id + '"]'); if (!sls.length) return;
  let ratio = null, main = null;
  sls.forEach(sl => {
    const r = fitSlide(sl, b);
    if (r != null && (ratio == null || sl.closest('.stage'))){ ratio = r; if (sl.closest('.stage')) main = sl; }
  });
  if (ratio == null) return;
  const pct = Math.round(ratio * 100);
  let over, msg;
  if (b.type === 'splash'){
    const px = Math.round(ratio * splashBase(b));
    over = px < splashMin3();
    msg = 'название ' + px + ' px' + (over ? ' — длинное, лучше короче' : '');
  } else if (b.type === 'scripture'){
    const min = slidesCfg().kinds.scripture.min;
    over = pct < min;
    msg = pct >= 100 ? 'текст 100%' : (over ? 'текст ' + pct + '% — лучше разбить на два слайда' : 'текст уменьшен до ' + pct + '%');
  } else {
    const lim = limitFor(b), c = charCount(b);
    over = c > lim;
    const real = Math.round(ratio * blkScale(b));
    msg = c + ' / ' + lim + ' символов · текст ' + real + '%' + (pct < 100 ? ' (не поместился, уменьшен)' : '');
    if (over) msg += ' — многовато, лучше разбить';
  }
  const th = filmEl && filmEl.isConnected ? filmEl.querySelector('.st[data-id="' + b.id + '"]') : null;
  if (th) th.classList.toggle('over', over);
  // этап 7.7: запомнить, по какому содержимому разложено, — syncSlides не будет раскладывать то же самое ещё раз
  const fp = thumbFp(b);
  if (th) th.parentNode._fp = fp;
  if (stageEl && stageEl._id === b.id) stageEl._fp = fp;
  if (main){
    const info = main.closest('.stage-view') && main.closest('.stage-view').querySelector('.stage-info');
    if (info){ info.textContent = msg; info.classList.toggle('over', over); }
  }
}
const previewRO = window.ResizeObserver ? new ResizeObserver(es => es.forEach(e => {
  const b = state && state.blocks.find(x => x.id === e.target.dataset.id); if (b) schedulePreview(b);
})) : null;
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
  FM = null;
  if (state) state.blocks.forEach(b => { if (PREVIEW[b.type]) schedulePreview(b); });
});

