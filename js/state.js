'use strict';

/* ========= Состояние ========= */
let state, sheetAt = 0, toastTimer = null, draftTimer = null;
/* Экран: главная со списком проповедей или сама проповедь (вид «Слайды» или «Текст»). Адрес: #s=<id>&v=text */
let screen = 'home', view = 'slides';
let selId = null, speechOpen = false;   // выбранный слайд в ленте; «Текст к слайду» развёрнут во всю высоту
let viewOpts = { showText:true, size:1 };
try { Object.assign(viewOpts, JSON.parse(LS.get('swp-view') || '{}')); } catch(e){}

function readDraft(id){
  const key = id || LS.get('swp-sermon:last');
  if (!key) return null;
  try { const d = JSON.parse(LS.get('swp-sermon:' + key) || 'null'); return d && Array.isArray(d.blocks) ? d : null; } catch(e){ return null; }
}
function persistDraft(){
  clearTimeout(draftTimer);
  if (readOnly()){ updateStatus(); return; }   // просмотр облачной проповеди: черновик не нужен, а чужой (из другой вкладки) не затираем
  LS.set('swp-sermon:' + state.id, JSON.stringify(state));
  LS.set('swp-sermon:last', state.id);
  updateStatus();
}
function change(){
  if (roBlock()) return;   // только просмотр: правка отменяется, подсказка про «Редактировать»
  state.updatedAt = Math.max(Date.now(), state.updatedAt + 1);   // только вперёд: иначе при отстающих часах правка выглядела бы сохранённой
  histRecord();   // отмена и возврат (history.js): запомнить, как было до правки
  clearTimeout(draftTimer);
  draftTimer = setTimeout(persistDraft, 400);
  updateStatus();
  onEdit();   // облако: автосохранение через несколько секунд
}
const isDirty = () => state.updatedAt > (state.savedAt || 0) && (state.blocks.length > 0 || !!state.meta.title);

function slideNums(){
  const m = {}; let n = 0;
  state.blocks.forEach(b => { if (TYPES[b.type].slide) m[b.id] = ++n; });
  m._total = n;
  return m;
}
function partChars(p){ return p.verses.reduce((s, v) => s + plain(v.text).trim().length, 0); }
function limitFor(b){   // лимиты символов — общие, в настройках слайдов
  const c = slidesCfg();
  return { scripture:c.kinds.scripture.min, thesis:c.limits.thesis, quote:c.limits.quote }[b.type] || 0;
}
function charCount(b){
  switch (b.type){
    case 'scripture':  return b.items.reduce((s, it) => s + (it.kind === 'text' ? plain(it.html).trim().length : it.kind === 'line' ? 0 : partChars(it)), 0);
    case 'thesis':     return plain(b.text).trim().length;
    case 'quote':      return plain(b.text).trim().length + (b.author || '').trim().length + (b.caption || '').trim().length;
  }
  return 0;
}
/* Одна строка о содержимом блока — видна, когда блок свёрнут */
function blockSummary(b){
  let t = '';
  switch (b.type){
    case 'scripture':
      t = b.items.map(it => it.kind === 'text' ? plain(it.html) : (it.ref || refString(it))).map(x => String(x || '').trim()).filter(Boolean).join(' · ');
      break;
    case 'thesis': t = plain(b.text); break;
    case 'splash': t = state.meta.title ? 'Заставка «' + state.meta.title + '»' : 'Заставка'; break;
    case 'quote':  t = plain(b.text).trim() ? '«' + plain(b.text).trim() + '»' + (b.author ? ' — ' + b.author : '') : ''; break;
    case 'image':  t = b.desc || (b.mode === 'send' ? 'Файл пришлют отдельно' : ''); break;
    case 'video':  t = b.url || b.desc || (b.mode === 'send' ? 'Видео пришлют отдельно' : ''); break;
    case 'free':   t = b.desc; break;
    case 'note':   t = b.text; break;
  }
  t = String(t || '').replace(/\s+/g, ' ').trim();
  return t.length > 120 ? t.slice(0, 120) + '…' : t;
}


/* Статус конспекта (этап 7.3) — три: «Черновик» (в облаке `draft`, новый конспект), «Готов к вёрстке» (`submitted`, автор закончил)
   и «У редактора» (`work`, конспект взял редактор; старое `done` считается так же). Переключатель — на экране проповеди (editor.js) */
const STATUS_KEYS = ['draft', 'submitted', 'work'];
const STATUS_LABELS = { draft:'Черновик', submitted:'Готов к вёрстке', work:'У редактора' };
const statusKey = st => st === 'submitted' ? 'submitted' : st === 'work' || st === 'done' ? 'work' : 'draft';
const atEditor = d => !!d && statusKey(d.cloudStatus) === 'work';
function sermonStatus(d){ const k = statusKey(d.cloudStatus); return { key:k, label:STATUS_LABELS[k] }; }
/* «Вс, 15 ноября» */
function fmtDay(s){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return '';
  const t = new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('ru-RU', { weekday:'short', day:'numeric', month:'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
