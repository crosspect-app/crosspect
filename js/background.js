'use strict';

/* ========= Фон слайдов (этап 7.3) =========
   Фон — общая настройка пространства: slidesCfg().bg (лежит в облаке вместе с остальными настройками слайдов, раздел `bg`).
   bg = null — прежний фон «Ember», один в один: четыре размытых пятна (.sl-glow), зерно, затемнение краёв (css/style.css).
   bg = { … } — фон из генератора: узор (полосы по вертикали, по горизонтали, пятна — их можно смешивать), оттенки от основного
   цвета, размытие, зерно, яркость основы, затемнение краёв, номер варианта (seed).
   Генератор рисует узор один раз в картинку (960×520, JPEG) и кладёт её в CSS-переменную слайда: так лента с десятками
   миниатюр не размывает ничего заново, а JPEG получает ту же картинку, что и предпросмотр.
   Случайность — только от номера варианта: у всех и при каждом открытии фон одинаковый. Зерно тоже повторяемое. */

/* Начальные значения ползунков, пока фон не трогали (bg = null). Подобраны близко к прежнему фону */
const BG_START = { stripesV:0, stripesH:0, spots:100, shades:4, color:'#c9702a', spread:30, blur:60, grain:60, grainKind:'fine', base:8, vignette:35, seed:1 };
const BG_GRAIN_KINDS = ['fine', 'coarse', 'color'];

/* Повторяемый генератор случайных чисел (mulberry32): одно и то же зерно — одна и та же последовательность */
function seededRandom(seed){
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Проверка и пределы: всё неизвестное и неправильное заменяется начальным значением. Не объект — прежний фон (null) */
function normBg(b){
  if (!b || typeof b !== 'object') return null;
  const S = BG_START, n = (k, a, z) => clampN(b[k], a, z, S[k]);
  const color = /^#[0-9a-f]{6}$/i.test(String(b.color || '')) ? String(b.color).toLowerCase() : S.color;
  return { stripesV:n('stripesV', 0, 100), stripesH:n('stripesH', 0, 100), spots:n('spots', 0, 100), shades:n('shades', 1, 20),
    color, spread:n('spread', 0, 100), blur:n('blur', 0, 100), grain:n('grain', 0, 100), grainKind:oneOf(b.grainKind, BG_GRAIN_KINDS, S.grainKind),
    base:n('base', 0, 40), vignette:n('vignette', 0, 100), seed:n('seed', 1, 9999) };
}

/* ----- Цвета ----- */
function hexToHsl(hex){
  const v = parseInt(hex.slice(1), 16), r = (v >> 16 & 255) / 255, g = (v >> 8 & 255) / 255, b = (v & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d){
    s = d / (1 - Math.abs(2 * l - 1));
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, s * 100, l * 100];
}
const hslCss = (c, a) => 'hsla(' + c[0].toFixed(1) + ',' + c[1].toFixed(1) + '%,' + c[2].toFixed(1) + '%,' + (a == null ? 1 : a) + ')';
const clamp01 = (v, a, b) => Math.min(b, Math.max(a, v));
/* Оттенки узора: первый — сам основной цвет. При малом разбросе остальные — он же светлее, темнее, насыщеннее;
   чем больше разброс, тем дальше они уходят по цветовому кругу (до противоположного цвета) */
function bgPalette(bg, rnd){
  const base = hexToHsl(bg.color), k = bg.spread / 100, out = [base];
  for (let i = 1; i < bg.shades; i++){
    const dh = (rnd() * 2 - 1) * 180 * k * k + (rnd() * 2 - 1) * 12 * k;
    const dl = (rnd() * 2 - 1) * (12 + 14 * k), ds = (rnd() * 2 - 1) * (15 + 15 * k) + 8 * (1 - k);
    out.push([(base[0] + dh + 360) % 360, clamp01(base[1] + ds, 4, 100), clamp01(base[2] + dl, 5, 85)]);
  }
  return out;
}

/* ----- Картинка фона ----- */
const BG_W = 960, BG_H = 520;   // панель слайда 1832×992 — те же пропорции; узор размыт, поэтому картинке хватает половины размера
const bgCache = new Map();
function canvasOf(w, hh){ const c = document.createElement('canvas'); c.width = w; c.height = hh; return c; }
/* Размыть слой L и положить на холст x. Где браузер не умеет фильтр холста, размытие — уменьшением и обратным увеличением */
function blurInto(x, L, px, m){
  if (px < 0.5){ x.drawImage(L, -m, -m); return; }
  if ('filter' in x){ x.filter = 'blur(' + px.toFixed(1) + 'px)'; x.drawImage(L, -m, -m); x.filter = 'none'; return; }
  const f = Math.max(1, px / 3), s = canvasOf(Math.max(2, Math.round(L.width / f)), Math.max(2, Math.round(L.height / f))), y = s.getContext('2d');
  y.imageSmoothingQuality = 'high'; y.drawImage(L, 0, 0, s.width, s.height);
  x.imageSmoothingQuality = 'high'; x.drawImage(s, -m, -m, L.width, L.height);
}
function paintBg(bg){
  const rnd = seededRandom(bg.seed * 7919 + 13), pal = bgPalette(bg, rnd);
  const order = pal.map((c, i) => i);
  for (let i = order.length - 1; i > 0; i--){ const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const cv = canvasOf(BG_W, BG_H), x = cv.getContext('2d');
  // основа — тёмная панель с лёгким оттенком основного цвета
  const h0 = hexToHsl(bg.color);
  x.fillStyle = hslCss([h0[0], 12, bg.base]); x.fillRect(0, 0, BG_W, BG_H);
  // узор — на отдельном слое с запасом по краям, чтобы размытие не темнило края
  const px = bg.blur * 0.6, m = Math.ceil(px * 2) + 4, W = BG_W + 2 * m, H = BG_H + 2 * m;
  const L = canvasOf(W, H), y = L.getContext('2d');
  const weights = () => { const w = pal.map(() => 0.55 + rnd() * 0.9), t = w.reduce((a, b) => a + b, 0); return w.map(v => v / t); };
  const stripes = (alpha, vertical) => {
    if (!alpha) return;
    const w = weights(), len = vertical ? W : H;
    let at = 0;
    y.globalAlpha = alpha / 100;
    order.forEach((ci, i) => {
      const sz = w[i] * len;
      y.fillStyle = hslCss(pal[ci]);
      if (vertical) y.fillRect(Math.floor(at), 0, Math.ceil(sz) + 1, H); else y.fillRect(0, Math.floor(at), W, Math.ceil(sz) + 1);
      at += sz;
    });
    y.globalAlpha = 1;
  };
  stripes(bg.stripesV, true);
  stripes(bg.stripesH, false);
  if (bg.spots){
    const a = bg.spots / 100;
    order.forEach(ci => {
      // пятна — ближе к краям, как в прежнем фоне: середина под текстом остаётся темнее
      const ang = rnd() * Math.PI * 2, rr = 0.55 + rnd() * 0.5;
      const cx = m + (0.5 + Math.cos(ang) * rr / 2) * BG_W, cy = m + (0.5 + Math.sin(ang) * rr / 2) * BG_H, r = (0.12 + rnd() * 0.22) * BG_W;
      const g = y.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, hslCss(pal[ci], a)); g.addColorStop(0.5, hslCss(pal[ci], a * 0.45)); g.addColorStop(1, hslCss(pal[ci], 0));
      y.fillStyle = g; y.fillRect(0, 0, W, H);
    });
  }
  blurInto(x, L, px, m);
  return cv.toDataURL('image/jpeg', 0.92);
}
function bgImage(bg){
  const key = JSON.stringify(bg);
  let u = bgCache.get(key);
  if (!u){
    try { u = 'url(' + paintBg(bg) + ')'; } catch(e){ u = 'none'; }
    if (bgCache.size > 8) bgCache.delete(bgCache.keys().next().value);
    bgCache.set(key, u);
  }
  return u;
}

/* ----- Зерно ----- */
/* Плитка шума: мелкое — точка в пиксель (как прежнее зерно), крупное — в 3 пикселя, цветное — каналы независимо. Повторяемо */
const grainCache = {};
function grainTile(kind){
  if (grainCache[kind]) return grainCache[kind];
  let out = { url:'none', size:128 };
  try {
    const cell = kind === 'coarse' ? 3 : 1, n = kind === 'coarse' ? 64 : 128, rnd = seededRandom(kind === 'fine' ? 1729 : kind === 'coarse' ? 4104 : 13832);
    const c = canvasOf(n, n), x = c.getContext('2d'), d = x.createImageData(n, n);
    for (let i = 0; i < d.data.length; i += 4){
      const v = rnd() * 255;
      if (kind === 'color'){ d.data[i] = rnd() * 255; d.data[i + 1] = rnd() * 255; d.data[i + 2] = rnd() * 255; }
      else { d.data[i] = Math.min(255, v + (rnd() - .5) * 40); d.data[i + 1] = v; d.data[i + 2] = Math.min(255, v + (rnd() - .5) * 40); }
      d.data[i + 3] = 255;
    }
    x.putImageData(d, 0, 0);
    let src = c;
    if (cell > 1){ src = canvasOf(n * cell, n * cell); const y = src.getContext('2d'); y.imageSmoothingEnabled = false; y.drawImage(c, 0, 0, n * cell, n * cell); }
    out = { url:'url(' + src.toDataURL('image/png') + ')', size:n * cell };
  } catch(e){}
  return (grainCache[kind] = out);
}
/* Прежний шум (рамка и зерно прежнего фона) — теперь тоже одинаковый при каждом открытии */
const NOISE = grainTile('fine').url;
document.documentElement.style.setProperty('--noise', NOISE);

/* CSS-переменные фона для slideVars (model.js): ставятся на сам слайд, поэтому попадают и в JPEG */
function bgVars(bg){
  if (!bg) return { '--sl-bg':'none', '--sl-glow':'block', '--sl-grain':NOISE, '--sl-gsz':'128px', '--sl-go':'0.6', '--sl-va':'0.35' };
  const g = grainTile(bg.grainKind);
  return { '--sl-bg':bgImage(bg), '--sl-glow':'none', '--sl-grain':g.url, '--sl-gsz':g.size + 'px', '--sl-go':String(bg.grain / 100), '--sl-va':String(bg.vignette / 100) };
}
