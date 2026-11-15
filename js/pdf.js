'use strict';

/* ========= PDF-файл для оператора (этап 10.1.3) =========
   Раньше PDF получался через окно печати Chrome («Сохранить как PDF»), а файл для «Поделиться» так не получить.
   Теперь форма собирает PDF сама: страница оператора (print.js, buildOperatorPrint) раскладывается браузером в скрытом
   блоке шириной как страница 80 × 170 мм, затем каждая страница рисуется на холсте — рамки, заливки и каждый знак ровно
   там, где его поставил браузер (Range.getClientRects), — и сохраняется в JPEG. JPEG-страницы складываются в PDF.
   Через SVG foreignObject (как слайды в export.js) нельзя: Safari на iPhone после такой картинки не отдаёт холст,
   а PDF нужнее всего именно с телефона. Текст в PDF — картинкой: искать и выделять его нельзя, читать — как в печати.
   Страница — где можно, между карточками слайдов и заметками (как break-inside:avoid при печати), строки не режутся. */
const PDF_MM = 96 / 25.4;   // CSS-пикселей в миллиметре
const PDF_PAGE = { w:80, h:170, top:6, side:5, bottom:7 };   // мм, как @page op в style.css
const PDF_SCALE = 3;   // точек холста на CSS-пиксель: страница 907 × 2008, мелкий текст читается при увеличении

/* Что нарисовать: прямоугольники (рамки и заливки) и знаки — в координатах блока printEl */
function pdfCollect(root){
  const base = root.getBoundingClientRect(), bx = base.left, by = base.top;
  const boxes = [], glyphs = [], lines = [], avoid = [];
  const px = v => parseFloat(v) || 0;
  const clear = c => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
  [root, ...root.querySelectorAll('*')].forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const side = s => ({ w:cs['border' + s + 'Style'] === 'none' ? 0 : px(cs['border' + s + 'Width']), c:cs['border' + s + 'Color'], dash:/dash|dot/.test(cs['border' + s + 'Style']) });
    const b = { bg:clear(cs.backgroundColor) ? '' : cs.backgroundColor, r:px(cs.borderTopLeftRadius), t:side('Top'), rt:side('Right'), bt:side('Bottom'), l:side('Left') };
    if (!b.bg && !b.t.w && !b.rt.w && !b.bt.w && !b.l.w) { /* нечего рисовать */ }
    else (cs.display === 'inline' ? [...el.getClientRects()] : [el.getBoundingClientRect()]).forEach(r =>
      boxes.push(Object.assign({ x:r.left - bx, y:r.top - by, w:r.width, h:r.height }, b)));
    if (cs.breakInside === 'avoid' || cs.pageBreakInside === 'avoid' || el.classList.contains('op-head')){
      const r = el.getBoundingClientRect(); avoid.push({ y:r.top - by, h:r.height });
    }
  });
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), range = document.createRange();
  let n;
  while ((n = w.nextNode())){
    const el = n.parentElement, cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const font = [cs.fontStyle, cs.fontWeight, cs.fontSize, cs.fontFamily].join(' ');
    const up = cs.textTransform === 'uppercase', low = cs.textTransform === 'lowercase';
    let deco = '';   // подчёркнутое (u) и зачёркнутое: text-decoration не наследуется — ищем у предков
    for (let a = el; a && a !== root.parentElement; a = a.parentElement){ const d = getComputedStyle(a).textDecorationLine || ''; if (/underline|line-through/.test(d)){ deco = d; break; } }
    const v = n.nodeValue;
    for (let i = 0; i < v.length;){
      const cp = v.codePointAt(i), len = cp > 0xffff ? 2 : 1, ch = v.slice(i, i + len);
      if (!/\s/.test(ch)){
        range.setStart(n, i); range.setEnd(n, i + len);
        const r = range.getClientRects()[0];
        if (r && r.width > 0){
          const g = { ch:up ? ch.toUpperCase() : low ? ch.toLowerCase() : ch, x:r.left - bx, y:r.top - by, w:r.width, h:r.height, font, color:cs.color };
          glyphs.push(g);
          if (deco) lines.push({ x:g.x, y:g.y, w:g.w, h:g.h, deco, color:cs.color, size:px(cs.fontSize) });
        }
      }
      i += len;
    }
  }
  return { boxes, glyphs, lines, avoid, height:root.scrollHeight };
}

/* Где резать страницы: по возможности перед карточкой (заметкой, шапкой), иначе — между строками */
function pdfBreaks(d, pageH){
  const pages = [], starts = d.boxes.map(b => b.y).concat(d.glyphs.map(g => g.y));
  let top = 0;
  while (top < d.height - 0.5){
    let cut = top + pageH;
    if (cut >= d.height){ pages.push([top, d.height]); break; }
    const blk = d.avoid.filter(b => b.y > top + 1 && b.y < cut && b.y + b.h > cut).sort((a, b) => a.y - b.y)[0];
    if (blk) cut = blk.y;
    else for (let moved = true; moved;){
      moved = false;
      for (const g of d.glyphs) if (g.y > top + 1 && g.y < cut && g.y + g.h > cut){ cut = g.y; moved = true; }
    }
    pages.push([top, cut]);
    const next = starts.filter(y => y >= cut - 0.01).reduce((m, y) => Math.min(m, y), Infinity);   // пустое место между карточками — не в начало страницы
    top = Number.isFinite(next) ? Math.max(cut, next - 1) : cut;
  }
  return pages.length ? pages : [[0, Math.max(1, d.height)]];
}

function pdfRoundRect(ctx, x, y, w, h, r){
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
function pdfPaintBox(ctx, b){
  const { x, y, w, h } = b, solid = s => s.w && !s.dash;
  ctx.save();
  pdfRoundRect(ctx, x, y, w, h, b.r); ctx.clip();
  if (solid(b.t)){ ctx.fillStyle = b.t.c; ctx.fillRect(x, y, w, b.t.w); }
  if (solid(b.bt)){ ctx.fillStyle = b.bt.c; ctx.fillRect(x, y + h - b.bt.w, w, b.bt.w); }
  if (solid(b.rt)){ ctx.fillStyle = b.rt.c; ctx.fillRect(x + w - b.rt.w, y, b.rt.w, h); }
  if (solid(b.l)){ ctx.fillStyle = b.l.c; ctx.fillRect(x, y, b.l.w, h); }
  const dash = (s, x1, y1, x2, y2) => {
    if (!s.w || !s.dash) return;
    ctx.save(); ctx.strokeStyle = s.c; ctx.lineWidth = s.w; ctx.setLineDash([s.w * 3, s.w * 2]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
  };
  dash(b.t, x, y + b.t.w / 2, x + w, y + b.t.w / 2); dash(b.bt, x, y + h - b.bt.w / 2, x + w, y + h - b.bt.w / 2);
  dash(b.l, x + b.l.w / 2, y, x + b.l.w / 2, y + h); dash(b.rt, x + w - b.rt.w / 2, y, x + w - b.rt.w / 2, y + h);
  if (b.bg){
    const bl = solid(b.l) ? b.l.w : 0, bt = solid(b.t) ? b.t.w : 0, br = solid(b.rt) ? b.rt.w : 0, bb = solid(b.bt) ? b.bt.w : 0;
    ctx.fillStyle = b.bg; pdfRoundRect(ctx, x + bl, y + bt, w - bl - br, h - bt - bb, b.r - Math.min(bl, bt)); ctx.fill();
  }
  ctx.restore();
}

/* Одна страница: холст с полями, на нём кусок блока от top до cut */
function pdfPage(d, top, cut){
  const k = PDF_SCALE, cv = document.createElement('canvas');
  cv.width = Math.round(PDF_PAGE.w * PDF_MM * k); cv.height = Math.round(PDF_PAGE.h * PDF_MM * k);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.scale(k, k);
  ctx.translate(PDF_PAGE.side * PDF_MM, PDF_PAGE.top * PDF_MM - top);
  ctx.beginPath(); ctx.rect(-PDF_PAGE.side * PDF_MM, top, PDF_PAGE.w * PDF_MM, cut - top); ctx.clip();
  const inPage = o => o.y < cut && o.y + o.h > top;
  d.boxes.filter(inPage).forEach(b => pdfPaintBox(ctx, b));
  const asc = {};   // верх знака от верха его строки: у каждого шрифта свой
  d.glyphs.filter(inPage).forEach(g => {
    ctx.font = g.font; ctx.fillStyle = g.color;
    let a = asc[g.font];
    if (a === undefined){
      const m = ctx.measureText('Hg');
      a = asc[g.font] = m.fontBoundingBoxAscent != null ? [m.fontBoundingBoxAscent, m.fontBoundingBoxDescent] : null;
    }
    const base = a ? g.y + (g.h - a[0] - a[1]) / 2 + a[0] : g.y + g.h * 0.8;
    ctx.fillText(g.ch, g.x, base);
  });
  d.lines.filter(inPage).forEach(l => {
    ctx.fillStyle = l.color;
    const t = Math.max(0.6, l.size * 0.07), y = /underline/.test(l.deco) ? l.y + l.h * 0.86 : l.y + l.h * 0.55;
    ctx.fillRect(l.x, y, l.w, t);
  });
  return cv;
}

/* PDF из JPEG-страниц: каталог, список страниц, сведения (название), у каждой страницы — содержимое и картинка */
function pdfFromJpegs(imgs, title){
  const enc = new TextEncoder(), parts = [], offs = [];
  let pos = 0;
  const put = x => { const u = typeof x === 'string' ? enc.encode(x) : x; parts.push(u); pos += u.length; };
  const obj = (n, body) => { offs[n] = pos; put(n + ' 0 obj\n'); body(); put('\nendobj\n'); };
  const W = (PDF_PAGE.w * 72 / 25.4).toFixed(2), H = (PDF_PAGE.h * 72 / 25.4).toFixed(2);
  const hex = s => 'FEFF' + Array.from(String(s)).map(c => { const v = c.codePointAt(0); return v > 0xffff
    ? [0xd800 + ((v - 0x10000) >> 10), 0xdc00 + ((v - 0x10000) & 0x3ff)].map(u => u.toString(16).padStart(4, '0')).join('')
    : v.toString(16).padStart(4, '0'); }).join('').toUpperCase();
  put('%PDF-1.4\n%âãÏÓ\n');
  obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => put('<< /Type /Pages /Kids [' + imgs.map((_, i) => (4 + 3 * i) + ' 0 R').join(' ') + '] /Count ' + imgs.length + ' >>'));
  obj(3, () => put('<< /Title <' + hex(title) + '> /Producer (Crosspect) >>'));
  imgs.forEach((im, i) => {
    const p = 4 + 3 * i, cs = 'q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im' + i + ' Do Q';
    obj(p, () => put('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im' + i + ' ' + (p + 2) + ' 0 R >> >> /Contents ' + (p + 1) + ' 0 R >>'));
    obj(p + 1, () => put('<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream'));
    obj(p + 2, () => { put('<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.data.length + ' >>\nstream\n'); put(im.data); put('\nendstream'); });
  });
  const size = 4 + 3 * imgs.length, xref = pos;
  put('xref\n0 ' + size + '\n0000000000 65535 f \n' + offs.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
  put('trailer\n<< /Size ' + size + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return new Blob(parts, { type:'application/pdf' });
}

const pdfName = () => folderName() + ' — оператор.pdf';
/* Файл PDF для оператора (File: у navigator.share нужен файл с именем). onStep(i, n) — ход по страницам */
async function operatorPdfFile(onStep){
  buildOperatorPrint();
  const W = (PDF_PAGE.w - 2 * PDF_PAGE.side) * PDF_MM;
  printEl.setAttribute('style', 'display:block;position:absolute;left:-10000px;top:0;width:' + W + 'px;background:#fff');
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;   // шрифты блока подгрузились — раскладка окончательная
    const d = pdfCollect(printEl);
    const pages = pdfBreaks(d, (PDF_PAGE.h - PDF_PAGE.top - PDF_PAGE.bottom) * PDF_MM), imgs = [];
    for (let i = 0; i < pages.length; i++){
      if (onStep) onStep(i + 1, pages.length);
      const cv = pdfPage(d, pages[i][0], pages[i][1]);
      const blob = await new Promise((res, rej) => cv.toBlob(x => x ? res(x) : rej(new Error('браузер не отдал страницу')), 'image/jpeg', 0.9));
      imgs.push({ w:cv.width, h:cv.height, data:new Uint8Array(await blob.arrayBuffer()) });
      cv.width = cv.height = 0;   // память телефона: холст больше не нужен
    }
    return new File([pdfFromJpegs(imgs, (state.meta.title || 'Без названия') + ' — оператор')], pdfName(), { type:'application/pdf' });
  } finally { printEl.removeAttribute('style'); printEl.innerHTML = ''; }
}
/* «Экспорт → PDF»: собрать и скачать */
async function exportPDF(){
  if (exporting) return;
  if (!state.blocks.length){ toast('В конспекте пока нет слайдов'); return; }
  if (!checkNames()) return;
  exporting = true; motionPause();
  const pr = exportProgress('Готовлю PDF');
  try {
    const f = await operatorPdfFile();
    download(f, f.name);
    pr.end(); toast('Скачан PDF: ' + f.name);
  } catch(e){ pr.fail(); toast('Не получилось собрать PDF: ' + (e && e.message ? e.message : 'ошибка')); }
  finally { exporting = false; motionResume(); }
}
