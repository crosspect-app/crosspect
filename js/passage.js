'use strict';

/* ========= Отрывок по слайдам (этап 10.4) =========
   Один блок «Место Писания» в данных, форма показывает его как несколько слайдов — «части отрывка».
   В блоке: split = { mode:'whole'|'verses'|'manual', per, breaks:[номер стиха, с которого начинается часть], speech:['', текст к части 2, …], starts:[…] }.
   Перевод, книга, глава, стихи и правка текста стиха — общие, в самом блоке. У части — свой «Текст к слайду» (часть 1 — b.speech,
   остальные — split.speech[k]) и своя отметка «доработать» (часть 1 — b.todo, остальные — PTODO, как отметки редактора, в документ не пишутся).
   Часть в форме — «единица» (unit): копия блока со стихами только этой части, id части 1 = id блока, остальных — «id~k».
   Разрыв «Вручную» привязан к стиху после линии: стих сняли — линия у следующего выбранного; после или перед линией стихов нет — линии нет.
   starts — начала частей при последней правке: по ним passageTidy переносит «Текст к слайду», когда части сдвинулись или пропали */
const SPLIT_MODES = ['whole', 'verses', 'manual'];
const PART_SEP = '~';
const PTODO = {};   // «доработать» у частей 2, 3…: id части → true

function normSplit(sp){
  if (!sp || typeof sp !== 'object') return undefined;
  const mode = SPLIT_MODES.includes(sp.mode) ? sp.mode : 'whole';
  const nums = a => (Array.isArray(a) ? a : []).map(Number).filter(n => Number.isFinite(n) && n > 0);
  const out = { mode, per:Math.max(1, Math.min(99, Math.round(+sp.per) || 2)), breaks:Array.from(new Set(nums(sp.breaks))).sort((a, b) => a - b) };
  const speech = (Array.isArray(sp.speech) ? sp.speech : []).map(x => x ? sanitize(x) : '');
  if (speech.some(Boolean)) out.speech = speech;
  if (Array.isArray(sp.starts) && sp.starts.length) out.starts = nums(sp.starts);
  return out;
}
/* Место Писания, которое можно разбить: одно на слайде, из Библии (не «вручную»), без «Текста» и «Линии». Иначе null */
function splitItem(b){
  if (!b || b.type !== 'scripture' || !Array.isArray(b.items) || b.items.length !== 1) return null;
  const it = b.items[0];
  return it && it.kind === 'scripture' && !it.manual && it.book && it.chapter ? it : null;
}
const SPLIT_OFF_TIP = 'Разбить на слайды можно, когда на слайде одно место Писания из Библии и нет карточек «Текст» и «Линия»';

/* С каких стихов (по порядку в it.verses) начинаются части: [0] — слайд целиком */
function partStarts(b){
  const it = splitItem(b), sp = b && b.split;
  if (!it || !sp || sp.mode === 'whole') return [0];
  const N = (it.verses || []).length;
  if (N < 2) return [0];
  if (sp.mode === 'verses'){ const out = []; for (let i = 0; i < N; i += Math.max(1, sp.per)) out.push(i); return out; }
  const nums = it.verses.map(v => +v.num), out = [0];
  (sp.breaks || []).forEach(br => {
    const i = nums.findIndex(n => n >= br);   // стих после линии сняли — линия у следующего выбранного
    if (i > 0 && !out.includes(i)) out.push(i);
  });
  return out.sort((a, b) => a - b);
}
/* Части блока: null — не разбит (одна часть) */
function passageParts(b){
  const st = partStarts(b); if (st.length < 2) return null;
  const it = splitItem(b), n = st.length;
  return st.map((s, k) => {
    const verses = it.verses.slice(s, k + 1 < n ? st[k + 1] : it.verses.length);
    return { k, n, verses, sel:verses.map(v => +v.num) };
  });
}
const partId = (b, k) => k ? b.id + PART_SEP + k : b.id;
const srcId = id => String(id || '').split(PART_SEP)[0];
const partRef = (it, sel) => refString(Object.assign({}, it, { sel }));
/* «4:3–6» — какие стихи части на экране */
function partVerses(it, sel){ return (it.chapter ? it.chapter + ':' : '') + formatSel(sel); }

/* Данные части: блок со стихами только этой части, без split. Текст к слайду и «доработать» — свои */
function unitData(b, p){
  const it = splitItem(b), c = {};
  Object.keys(b).forEach(k => { if (k !== 'split' && k !== 'items' && k !== 'speech' && k !== 'todo') c[k] = b[k]; });
  c.id = partId(b, p.k);
  c.items = [Object.assign({}, it, { sel:p.sel, verses:p.verses, ref:partRef(it, p.sel) })];
  return c;
}
function partSpeech(b, k){ return k ? ((b.split && b.split.speech) || [])[k] || '' : b.speech || ''; }
function partTodo(b, k){ return k ? !!PTODO[partId(b, k)] : !!b.todo; }
function setPartTodo(b, k, v){ if (k) { if (v) PTODO[partId(b, k)] = true; else delete PTODO[partId(b, k)]; } else b.todo = !!v; }
function partMeta(u, b, p){
  const it = splitItem(b);
  Object.defineProperties(u, {
    _src:{ value:b, configurable:true }, _k:{ value:p.k, configurable:true },
    _part:{ value:{ k:p.k, n:p.n, full:it.ref || refString(it), on:partVerses(it, p.sel), count:p.verses.length, translation:it.translation || '' }, configurable:true }
  });
  return u;
}
/* Единицы любого конспекта (для снимка оператору, отметок, сводок): обычные объекты, без связи с правкой */
function allUnits(blocks){
  const out = [];
  (blocks || []).forEach(b => {
    const ps = b && passageParts(b);
    if (!ps){ out.push(b); return; }
    ps.forEach(p => out.push(partMeta(Object.assign(unitData(b, p), { speech:partSpeech(b, p.k), todo:partTodo(b, p.k) }), b, p)));
  });
  return out;
}

/* Единицы открытого конспекта — живые: объект части тот же, пока тот же блок, а «Текст к слайду» и «доработать» пишутся в блок */
const UNITS = new Map();   // id части → { b, u }
function liveUnit(b, p){
  const id = partId(b, p.k);
  let e = UNITS.get(id);
  if (!e || e.b !== b){
    const u = {};
    Object.defineProperty(u, 'speech', { enumerable:true, configurable:true,
      get:() => partSpeech(b, p.k),
      set:v => { if (!p.k){ b.speech = v; return; } const sp = b.split || (b.split = normSplit({})); const a = sp.speech || (sp.speech = []); while (a.length <= p.k) a.push(''); a[p.k] = v; } });
    Object.defineProperty(u, 'todo', { enumerable:true, configurable:true, get:() => partTodo(b, p.k), set:v => setPartTodo(b, p.k, v) });
    e = { b, u }; UNITS.set(id, e);
  }
  const u = e.u, d = unitData(b, p);
  Object.keys(u).forEach(k => { if (k !== 'speech' && k !== 'todo' && !(k in d)) delete u[k]; });
  Object.assign(u, d);
  return partMeta(u, b, p);
}
function units(){
  if (!state) return [];
  const out = [];
  state.blocks.forEach(b => { const ps = passageParts(b); if (!ps) out.push(b); else ps.forEach(p => out.push(liveUnit(b, p))); });
  return out;
}
/* Части блока в открытом конспекте ([сам блок], если не разбит) */
function unitsOf(b){ const ps = b && passageParts(b); return ps ? ps.map(p => liveUnit(b, p)) : b ? [b] : []; }
const srcOf = u => (u && u._src) || u;
const isPart = u => !!(u && u._part);
/* Единица по id; если такой части уже нет — последняя часть того же блока */
function unitById(id){
  if (!state || !id) return null;
  const b = state.blocks.find(x => x.id === srcId(id)); if (!b) return null;
  const us = unitsOf(b);
  return us.find(u => u.id === id) || us[us.length - 1];
}

/* Подписи */
const slidesWord = n => n + ' ' + plural(n, 'слайд', 'слайда', 'слайдов');
const versesWord = n => n + ' ' + plural(n, 'стих', 'стиха', 'стихов');
const partPlate = P => 'Слайд ' + (P.k + 1) + ' из ' + P.n + ' · на экране ' + P.on;
function passageLabel(b){ const it = splitItem(b), n = partStarts(b).length; return (it ? it.ref || refString(it) : '') + ' · отрывок · ' + slidesWord(n); }

/* После правки: начала частей, линии «Вручную» и «Текст к слайду» — в порядок.
   Линия у снятого стиха переезжает к следующему, лишние исчезают; текст к пропавшей части дописывается к предыдущей */
function passageTidy(b){
  const sp = b && b.type === 'scripture' && b.split; if (!sp) return;
  const it = splitItem(b), st = partStarts(b);
  const nums = it ? it.verses.map(v => +v.num) : [];
  const starts = st.map(i => nums[i] || 0);
  if (it && sp.mode === 'manual') sp.breaks = starts.slice(1);
  const old = sp.starts;
  if (!old || !old.length){ sp.starts = starts; return; }
  if (old.length === starts.length && old.every((x, i) => x === starts[i])) return;
  const prev = [b.speech || ''].concat(old.slice(1).map((_, i) => (sp.speech || [])[i + 1] || ''));
  const next = starts.map(() => '');
  old.forEach((s, i) => {
    if (!prev[i]) return;
    let j = 0;
    if (i && starts.length > 1){
      const v = nums.find(n => n >= s);   // первый выбранный стих не раньше начала прежней части
      j = v == null ? starts.length - 1 : starts.reduce((m, x, q) => x <= v ? q : m, 0);
    }
    next[j] = joinSpeech(next[j], prev[i]);
  });
  b.speech = next[0];
  const rest = next.slice(1);
  if (rest.some(Boolean)) sp.speech = [''].concat(rest); else delete sp.speech;
  // «доработать» у частей 2, 3… — по началу части, как текст
  const was = {}; old.forEach((s, i) => { if (i && PTODO[partId(b, i)]) was[s] = true; delete PTODO[partId(b, i)]; });
  starts.forEach((s, j) => { if (j && was[s]) PTODO[partId(b, j)] = true; });
  sp.starts = starts;
}
function passageTidyAll(){ if (state) state.blocks.forEach(passageTidy); }

/* Сколько стихов на слайде предложить, когда «Текст сжат до N %» (кнопка «Разбить»): примерно столько, сколько помещается */
function suggestPer(b, pct){
  const it = splitItem(b), N = it ? it.verses.length : 0;
  if (N < 2) return 1;
  const fit = pct ? Math.floor(N * pct / 100) : 3;
  return Math.max(1, Math.min(N - 1, fit || 1));
}
function setSplitMode(b, mode, per){
  const sp = b.split || (b.split = normSplit({}));
  if (mode === 'manual' && sp.mode !== 'manual'){
    const it = splitItem(b), st = partStarts(b);
    sp.breaks = it ? st.slice(1).map(i => +it.verses[i].num) : [];   // «По стихам» → «Вручную»: линии там, где были разрывы
  }
  if (per) sp.per = per;
  sp.mode = mode;
}
/* «Вручную»: линия перед стихом num — поставить или убрать */
function toggleBreak(b, num){
  const sp = b.split; if (!sp) return;
  const a = sp.breaks || (sp.breaks = []), i = a.indexOf(num);
  if (i >= 0) a.splice(i, 1); else { a.push(num); a.sort((x, y) => x - y); }
}
