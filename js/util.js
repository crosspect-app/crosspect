'use strict';

/* ========= Утилиты ========= */
const $ = (s, r) => (r || document).querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const pad = n => (n < 10 ? '0' : '') + n;

function h(tag, props){
  const el = document.createElement(tag);
  if (props) for (const k in props){
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k.slice(0,2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
  return el;
}
function append(el, c){
  if (c == null || c === false) return;
  if (Array.isArray(c)) { c.forEach(x => append(el, x)); return; }
  el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
}
function ic(name){ return h('span', { class:'ic', html:'<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || '') + '</svg>' }); }
function iconBtn(name, title, fn, cls){ return h('button', { type:'button', class:'icon-btn ' + (cls || ''), title:title, 'aria-label':title, onclick:fn }, ic(name)); }
function chip(name, label, fn, cls){ return h('button', { type:'button', class:'chip ' + (cls || ''), onclick:fn }, ic(name), label); }

const LS = {
  get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } },
  set(k, v){ try { localStorage.setItem(k, v); } catch(e){} }
};

function nextSunday(){
  const d = new Date(); d.setDate(d.getDate() + (7 - d.getDay()) % 7);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function fmtDate(s){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return '';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('ru-RU', { day:'numeric', month:'long', year:'numeric' });
}
function fmtTime(ts){ return ts ? new Date(ts).toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' }) : ''; }
/* 1 слово, 2 слова, 5 слов */
const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
function nextNum(n){ n = String(n || '').trim(); return /^\d+$/.test(n) ? String(+n + 1) : ''; }

/* ========= Форматированный текст: только Ж, Ч и выделение ========= */
function cleanHTML(node){
  let out = '';
  node.childNodes.forEach(n => {
    if (n.nodeType === 3) { out += esc(n.nodeValue.replace(/\u00a0/g, ' ').replace(/\u00ad/g, '')).replace(/\r?\n/g, '<br>'); return; }   // перенос внутри текста (Enter в pre-wrap) = новая строка
    if (n.nodeType !== 1) return;
    const tag = n.tagName.toLowerCase();
    if (tag === 'br') { out += '<br>'; return; }
    const inner = cleanHTML(n);
    if (tag === 'b' || tag === 'strong') { if (inner) out += '<b>' + inner + '</b>'; return; }
    if (tag === 'u') { if (inner) out += '<u>' + inner + '</u>'; return; }
    if (tag === 'i' || tag === 'em') { if (inner) out += '<i>' + inner + '</i>'; return; }
    if (tag === 'mark') { if (inner) out += '<mark>' + inner + '</mark>'; return; }
    if (tag === 'div' || tag === 'p') { if (out && !/<br>$/.test(out)) out += '<br>'; out += inner; return; }
    if (tag === 'span' && n.classList.contains('up')) { if (inner) out += '<span class="up">' + inner + '</span>'; return; }
    if (tag === 'span' || tag === 'font') {
      const st = (n.getAttribute('style') || '').toLowerCase();
      let r = inner;
      if (r && /font-weight:\s*(bold|[6-9]00)/.test(st)) r = '<b>' + r + '</b>';
      if (r && /italic/.test(st)) r = '<i>' + r + '</i>';
      if (r && /underline/.test(st)) r = '<u>' + r + '</u>';
      out += r; return;
    }
    if (tag === 'script' || tag === 'style') return;
    out += inner;
  });
  return out;
}
function plain(html){
  if (!html) return '';
  const t = document.createElement('template');
  t.innerHTML = String(html).replace(/<br\s*\/?>/gi, '\n');
  return t.content.textContent;
}
function finalize(html){
  html = html.replace(/(<br>)+$/, '');
  return plain(html).trim() ? html : '';
}
function sanitize(html){
  if (!html) return '';
  const t = document.createElement('template');
  t.innerHTML = String(html);
  return finalize(cleanHTML(t.content));
}
const ltrimH = s => (s || '').replace(/^(\s|&nbsp;|<br>)+/, '');
const rtrimH = s => (s || '').replace(/(\s|&nbsp;|<br>)+$/, '');


