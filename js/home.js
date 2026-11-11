'use strict';

/* ========= Главная: список проповедей =========
   Пока облака нет, список — это черновики, которые хранит этот браузер (`swp-sermon:<id>`). */
let homeQuery = '';

/* Черновики из браузера. Пустые (ни слайдов, ни названия) — это брошенные «Новые проповеди»: убираем */
function draftList(){
  const out = [];
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    keys.forEach(k => {
      if (!k || k.indexOf('swp-sermon:') !== 0 || k === 'swp-sermon:last') return;
      let d = null;
      try { d = JSON.parse(localStorage.getItem(k)); } catch(e){}
      if (!d || !Array.isArray(d.blocks)) return;
      d = normalize(d);
      if (!d.blocks.length && !String(d.meta.title || '').trim()){
        if (!state || state.id !== d.id) { try { localStorage.removeItem(k); } catch(e){} }
        return;
      }
      out.push(d);
    });
  } catch(e){}
  return out;
}
const isoToday = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
function haystack(d){
  const refs = d.blocks.filter(b => b.type === 'scripture').map(b => b.items.map(it => it.ref || '').join(' ')).join(' ');
  return [d.meta.title, preacherName(d.meta), preacherKey(d.meta), refs].join(' ').toLowerCase().replace(/ё/g, 'е');
}
/* «только что», «сегодня», «вчера», «5 ноября» */
function fmtAgo(ts){
  if (!ts) return '';
  const d = new Date(ts), now = new Date(), day = 86400000;
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (now - d < 3600000) return 'только что';
  if (a === b) return 'сегодня';
  if (b - a === day) return 'вчера';
  return d.toLocaleDateString('ru-RU', { day:'numeric', month:'long' });
}

function renderHome(){
  mainEl.append(h('div', { class:'home' },
    h('div', { class:'home-top' },
      h('h1', { text:'Проповеди' }),
      h('div', { class:'grow' }),
      h('button', { type:'button', class:'btn hide-sm', onclick:() => fileInput.click() }, ic('open'), 'Открыть файл'),
      h('button', { type:'button', class:'btn primary big', onclick:() => newSermon() }, ic('plus'), 'Новая проповедь')),
    h('div', { id:'home-list' })));
  renderHomeList();
}

function renderHomeList(){
  const box = $('#home-list'); if (!box) return;
  box.innerHTML = '';
  const all = draftList(), q = homeQuery.trim().toLowerCase().replace(/ё/g, 'е');
  if (!all.length){
    box.append(h('div', { class:'empty' },
      h('div', { class:'empty-title', text:'Пока нет ни одной проповеди' }),
      h('p', { class:'hint', text:'Создайте новую или откройте файл, который вы сохраняли раньше. Старые файлы форма откроет сама.' }),
      h('div', { class:'chips' },
        h('button', { type:'button', class:'btn primary', onclick:() => newSermon() }, ic('plus'), 'Новая проповедь'),
        h('button', { type:'button', class:'btn', onclick:() => fileInput.click() }, ic('open'), 'Открыть файл'))));
    return;
  }
  const list = all.filter(d => !q || haystack(d).includes(q)), today = isoToday();
  const up = list.filter(d => !d.meta.date || d.meta.date >= today).sort((a, b) => String(a.meta.date || '9').localeCompare(String(b.meta.date || '9')));
  const past = list.filter(d => d.meta.date && d.meta.date < today).sort((a, b) => b.meta.date.localeCompare(a.meta.date));
  if (!list.length) box.append(h('p', { class:'hint', style:'padding:8px 2px', text:'По запросу «' + homeQuery.trim() + '» ничего не нашлось.' }));
  if (up.length) box.append(h('section', { class:'home-sec' },
    h('div', { class:'cap', text:'Ближайшие' }),
    h('div', { class:'cards' }, up.map(sermonCard))));
  if (past.length) box.append(h('section', { class:'home-sec' },
    h('div', { class:'cap-row' }, h('div', { class:'cap', text:'Прошедшие' }), h('span')),
    h('div', { class:'ptable' },
      h('div', { class:'prow phead' }, h('span', { text:'Дата' }), h('span', { text:'Название' }), h('span', { text:'Проповедник' }), h('span', { text:'Слайдов' }), h('span', { text:'Статус' }), h('span')),
      past.map(sermonRow))));
  box.append(h('p', { class:'hint home-note', text:'Проповеди хранятся в этом браузере. Чтобы отправить проповедь или перенести её на другой компьютер, нажмите «Сохранить» внутри проповеди и перешлите файл.' }));
}

const slideCount = d => d.blocks.filter(b => TYPES[b.type].slide).length;

function sermonCard(d){
  const m = d.meta, st = sermonStatus(d), slides = d.blocks.filter(b => TYPES[b.type].slide), done = slides.filter(b => b.done).length;
  const todo = slides.filter(b => b.todo).length;
  const seg = slides.slice(0, 24).map(b => h('span', { class:b.done ? 'on' : '' }));
  return h('div', { class:'card-wrap' },
    h('a', { class:'scard st-' + st.key, href:sermonHash(d.id) },
      h('div', { class:'mini' }, h('div', { class:'mini-fr' }, h('div', { class:'mini-pn' },
        h('span', { class:'mini-t', text:m.title || 'Без названия' })))),
      h('div', { class:'scard-body' },
        h('div', { class:'scard-top' }, h('span', { text:fmtDay(m.date) || 'Дата не указана' }), h('span', { class:'stchip st-' + st.key, text:st.label })),
        h('div', { class:'scard-title' + (m.title ? '' : ' empty'), text:m.title || 'Без названия' }),
        h('div', { class:'scard-by', text:preacherName(m) || 'Проповедник не указан' }),
        slides.length
          ? [h('div', { class:'prog', 'aria-label':'Готово ' + done + ' из ' + slides.length }, seg),
             h('div', { class:'scard-foot' },
               h('span', { text:'Готово ' + done + ' из ' + slides.length }),
               todo ? h('span', { class:'film-todo', text:todo + ' доработать' }) : h('span', { text:'изменено ' + fmtAgo(d.updatedAt) }))]
          : h('div', { class:'scard-foot' }, h('span', { text:'Слайдов пока нет · изменено ' + fmtAgo(d.updatedAt) })))),
    iconBtn('trash', 'Убрать из браузера', e => { e.stopPropagation(); deleteDraft(d); }, 'danger card-del'));
}
function sermonRow(d){
  const m = d.meta, st = sermonStatus(d);
  return h('div', { class:'card-wrap' },
    h('a', { class:'prow', href:sermonHash(d.id) },
      h('span', { class:'muted', text:fmtDay(m.date) }),
      h('span', { class:'pt', text:m.title || 'Без названия' }),
      h('span', { class:'muted2', text:preacherName(m) }),
      h('span', { text:String(slideCount(d)) }),
      h('span', null, h('span', { class:'stchip st-' + st.key, text:st.label })),
      h('span')),
    iconBtn('trash', 'Убрать из браузера', e => { e.stopPropagation(); deleteDraft(d); }, 'danger row-del'));
}

function deleteDraft(d){
  const t = d.meta.title ? '«' + d.meta.title + '»' : 'эту проповедь';
  if (!confirm('Убрать ' + t + ' из браузера? Если вы сохраняли файл, он останется на месте. Без файла проповедь пропадёт.')) return;
  try { localStorage.removeItem('swp-sermon:' + d.id); if (LS.get('swp-sermon:last') === d.id) localStorage.removeItem('swp-sermon:last'); } catch(e){}
  if (state && state.id === d.id) state = blank();
  renderHomeList();
  toast('Проповедь убрана из браузера');
}
