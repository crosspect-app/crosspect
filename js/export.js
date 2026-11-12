'use strict';

/* ========= Выгрузка слайдов в JPEG =========
   Слайд раскладывается тем же кодом, что и предпросмотр, в полном кадре 1920×1080, затем вместе со стилями
   и встроенными шрифтами рисуется браузером на холст (SVG foreignObject) и сохраняется в JPEG.
   Один слайд — обычным файлом; несколько — ZIP-архивом с папкой «дата название». */
const EXPORT_FONTS = 'https://fonts.googleapis.com/css2?family=Unbounded:wght@200..900&family=Inter:wght@400;700&family=Noto+Sans+Hebrew:wght@400;700&display=block';
let fontCssP = null;
function toBase64(buf){
  const u8 = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
/* Шрифты для картинки: CSS Google Fonts, в котором ссылки на файлы заменены самими файлами */
function exportFonts(){
  if (fontCssP) return fontCssP;
  fontCssP = (async () => {
    const r = await fetch(EXPORT_FONTS); if (!r.ok) throw new Error('шрифты не загрузились');
    const css = await r.text();
    const urls = Array.from(new Set((css.match(/url\((https:[^)]+)\)/g) || []).map(u => u.slice(4, -1))));
    const map = {};
    await Promise.all(urls.map(async u => { const f = await fetch(u); if (!f.ok) throw new Error('шрифт не загрузился'); map[u] = 'data:font/woff2;base64,' + toBase64(await f.arrayBuffer()); }));
    return css.replace(/url\((https:[^)]+)\)/g, (m, u) => 'url(' + map[u] + ')');
  })();
  fontCssP.catch(() => { fontCssP = null; });
  return fontCssP;
}
/* Правила оформления слайда из этой страницы */
let SLIDE_CSS = null;
function slideCSS(){
  if (SLIDE_CSS) return SLIDE_CSS;
  let out = '';
  Array.from(document.styleSheets).forEach(sh => {
    let rules; try { rules = sh.cssRules; } catch(e){ return; }
    Array.from(rules).forEach(r => { if (r.selectorText && /\.sl(\b|-)/.test(r.selectorText)) out += r.cssText + '\n'; });
  });
  return (SLIDE_CSS = out);
}
async function renderJPEG(b){
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const fontCss = await exportFonts();
  const host = h('div', { style:'position:fixed;left:-40000px;top:0;width:1920px;height:1080px;overflow:hidden;pointer-events:none', 'aria-hidden':'true' });
  const sl = slideEl(b); sl.style.width = '1920px';
  host.append(sl); document.body.append(host);
  try {
    if (fitSlide(sl, b) == null) throw new Error('не удалось разложить слайд');
    const stage = sl.querySelector('.sl-stage').cloneNode(true);
    const root = getComputedStyle(document.documentElement);
    stage.style.setProperty('--noise', root.getPropertyValue('--noise').trim());   // поля и расстояния уже стоят на самом слайде (slideEl)
    stage.style.transform = 'none'; stage.style.boxShadow = 'none';
    const wrap = document.createElement('div');
    wrap.className = 'sl';
    wrap.setAttribute('style', 'width:1920px;height:1080px;aspect-ratio:auto;border-radius:0;position:relative;overflow:hidden;background:#000');
    const st = document.createElement('style'); st.textContent = fontCss + '\n' + slideCSS();
    wrap.append(st, stage);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><foreignObject x="0" y="0" width="1920" height="1080">' +
      new XMLSerializer().serializeToString(wrap) + '</foreignObject></svg>';
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    await new Promise(r => setTimeout(r, 60));   // шрифты внутри картинки успевают подключиться
    const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1920, 1080);
    ctx.drawImage(img, 0, 0, 1920, 1080);
    return await new Promise((res, rej) => cv.toBlob(x => x ? res(x) : rej(new Error('браузер не отдал картинку')), 'image/jpeg', 0.93));
  } finally { host.remove(); }
}
function download(blob, name){
  const a = h('a', { href:URL.createObjectURL(blob), download:name });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
const folderName = () => cleanName((state.meta.date ? state.meta.date + ' ' : '') + (state.meta.title || 'Проповедь')).slice(0, 80) || 'Проповедь';
/* ZIP без сжатия (JPEG и так сжат); имена в UTF-8, кириллица в Windows открывается нормально */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8){ let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files){
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const d = new Date(), tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  files.forEach(f => {
    const nm = enc.encode(f.name), data = f.data || new Uint8Array(0), crc = crc32(data), sz = data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, tm, true); lh.setUint16(12, dt, true); lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true);
    lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
    parts.push(lh, nm, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, tm, true); ch.setUint16(14, dt, true); ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true);
    ch.setUint16(28, nm.length, true); ch.setUint32(38, f.dir ? 0x10 : 0, true); ch.setUint32(42, off, true);
    central.push(ch, nm);
    off += 30 + nm.length + sz;
  });
  const size = central.reduce((s, x) => s + x.byteLength, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, off, true);
  return new Blob(parts.concat(central, [end]), { type:'application/zip' });
}
let exporting = false;
async function exportOne(b){
  if (exporting) return;
  if (NAMED[b.type] && !cleanName(b.name)){
    flagMissing = true; selectBlock(b.id); rerender(b);
    const f = sideEl && sideEl.querySelector('.namebox input'); if (f) f.focus();
    toast('Сначала напишите название слайда'); return;
  }
  exporting = true; motionPause(); toast('Готовлю JPEG…');   // на время снятия JPEG движение выключено: снимок всегда со статичного слайда (motion.js)
  try {
    const name = slideName(b, slideNums()[b.id]) + '.jpg';
    download(await renderJPEG(b), name);
    toast('Скачано: ' + name);
  } catch(e){ toast('Не получилось собрать JPEG: ' + (e && e.message ? e.message : 'ошибка') + '. Проверьте интернет.'); }
  finally { exporting = false; motionResume(); }
}
async function exportMany(){
  if (exporting) return;
  const list = state.blocks.filter(b => PREVIEW[b.type]);
  if (!list.length){ toast('В проповеди нет слайдов, которые форма собирает сама'); return; }
  if (!checkNames()) return;
  if (list.length === 1){ exportOne(list[0]); return; }
  exporting = true; motionPause();
  const nums = slideNums(), folder = folderName(), files = [{ name:folder + '/', dir:true }], used = {};
  try {
    for (let i = 0; i < list.length; i++){
      toast('Готовлю слайды: ' + (i + 1) + ' из ' + list.length + '…');
      const b = list[i];
      let name = slideName(b, nums[b.id]);
      if (used[name]){ used[name]++; name += ' (' + used[name] + ')'; } else used[name] = 1;
      files.push({ name:folder + '/' + name + '.jpg', data:new Uint8Array(await (await renderJPEG(b)).arrayBuffer()) });
    }
    download(makeZip(files), folder + '.zip');
    const rest = state.blocks.filter(b => b.type === 'image' || b.type === 'video' || b.type === 'free').length;
    toast('Скачан архив: ' + list.length + ' ' + plural(list.length, 'слайд', 'слайда', 'слайдов') + (rest ? '. Картинки, видео и свободные слайды делаются вручную' : ''));
  } catch(e){ toast('Не получилось собрать слайды: ' + (e && e.message ? e.message : 'ошибка') + '. Проверьте интернет.'); }
  finally { exporting = false; motionResume(); }
}

