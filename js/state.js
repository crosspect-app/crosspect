'use strict';

/* ========= Состояние ========= */
let state, sheetAt = 0, toastTimer = null, draftTimer = null;
let mode = LS.get('swp-mode') === 'view' ? 'view' : 'edit';
let viewOpts = { showText:true, size:1 };
try { Object.assign(viewOpts, JSON.parse(LS.get('swp-view') || '{}')); } catch(e){}

function readDraft(id){
  const key = id || LS.get('swp-sermon:last');
  if (!key) return null;
  try { const d = JSON.parse(LS.get('swp-sermon:' + key) || 'null'); return d && Array.isArray(d.blocks) ? d : null; } catch(e){ return null; }
}
function persistDraft(){
  clearTimeout(draftTimer);
  LS.set('swp-sermon:' + state.id, JSON.stringify(state));
  LS.set('swp-sermon:last', state.id);
  updateStatus();
}
function change(){
  state.updatedAt = Date.now();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(persistDraft, 400);
  updateStatus();
}
const isDirty = () => state.updatedAt > (state.savedAt || 0) && (state.blocks.length > 0 || !!state.meta.title);

function slideNums(){
  const m = {}; let n = 0;
  state.blocks.forEach(b => { if (TYPES[b.type].slide) m[b.id] = ++n; });
  m._total = n;
  return m;
}
function partChars(p){ return p.verses.reduce((s, v) => s + plain(v.text).trim().length, 0); }
function limitFor(b){
  const st = state.settings;
  return { scripture:st.minScale, thesis:st.limitThesis, quote:st.limitQuote }[b.type] || 0;
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

