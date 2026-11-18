'use strict';

/* ========= Окно выбора фото у цитаты (этап 10.5.2): «Из фотобанка» у полей «Имя / Фамилия» и «Сменить фото» в блоке «Фото» =========
   Только выбор, править банк здесь нельзя. Сверху поиск (имя, фамилия, другие написания), ниже — люди банка по алфавиту фамилии:
   миниатюра, имя, подпись, число фото. Человек → его фото сеткой с пометкой «без фона» / «с фоном». Фото → имя, фамилия и подпись
   заменяются банковскими, фото ставится по его виду по умолчанию (pickAuthor, photos.js); вернуть прежнее — ↶.
   «Сменить фото» открывает сразу сетку фото текущего человека, со стрелкой «Все люди». На телефоне окно — на весь экран */
let PKW = null;   // { id — блок цитаты, person — открытый человек или '', q — поиск }

function openPhotoPick(b, onPerson){
  if (!b || readOnly()) return;
  const cur = onPerson && b.photo && bankEntry(b.photo.id);
  PKW = { id:b.id, person:cur ? cur.person : '', q:'' };
  settingsOverlay.classList.add('open');
  drawPhotoPick();
  loadPhotoBank().then(() => {
    if (!PKW) return;
    if (onPerson && !PKW.person){ const a = b.photo && bankEntry(b.photo.id); if (a) PKW.person = a.person; }
    drawPhotoPick();
  });
  const q = settingsOverlay.querySelector('.pk-q'); if (q) q.focus();
}
function pickStop(){ PKW = null; }
/* Банк изменился (photos.js, bankRebuild): перерисовать, сохранив курсор в поиске */
function pickChanged(){ if (PKW && settingsOverlay.querySelector('.pk-sheet')) drawPhotoPick(); }

function pickPhoto(person, photo){
  const b = PKW && blockById(PKW.id);
  if (!b || readOnly()) return closeSettings();
  closeSettings();
  pickAuthor(b, person, photo);
}

function pkPeople(){
  const found = photoSearch(PKW.q, null).sort(byLastName);
  if (!found.length) return h('p', { class:'hint sp-empty', text:'Никого не нашлось.' });
  return h('div', { class:'pk-people', role:'list' }, found.map(p => h('button', { type:'button', class:'pk-person', role:'listitem',
    onclick:() => { PKW.person = p.id; drawPhotoPick(); } },
    personThumb(p) ? h('img', { class:'pk-thumb', src:personThumb(p), alt:'' }) : h('span', { class:'pk-thumb pk-none' }),
    h('span', { class:'pk-text' }, h('span', { class:'pk-name', text:bankName(p) }), p.caption ? h('span', { class:'pk-cap', text:p.caption }) : null),
    h('span', { class:'pk-count', text:photoCount(p.photos.length) }))));
}
const photoCount = n => n + ' фото';

function pkPerson(p){
  const b = blockById(PKW.id), cur = b && b.photo && b.photo.id;
  return h('div', { class:'pk-one' },
    h('div', { class:'pk-who' },
      h('button', { type:'button', class:'btn small pk-back', onclick:() => { PKW.person = ''; drawPhotoPick(); } }, '← Все люди'),
      h('span', { class:'pk-name', text:bankName(p) }), p.caption ? h('span', { class:'pk-cap', text:p.caption }) : null),
    !p.photos.length ? h('p', { class:'hint sp-empty', text:'У этого человека пока нет фото.' })
      : h('div', { class:'pk-grid' }, p.photos.map(ph => h('button', { type:'button', class:'pk-photo' + (ph.id === cur ? ' on' : ''),
        'aria-label':bankName(p) + ', ' + PHOTO_KINDS[ph.kind], onclick:() => pickPhoto(p, ph) },
        h('img', { src:ph.thumb, alt:'' }), h('span', { class:'pk-kind k-' + ph.kind, text:PHOTO_KINDS[ph.kind] })))));
}

function drawPhotoPick(){
  if (!PKW) return;
  const a = document.activeElement, focusQ = a && a.classList && a.classList.contains('pk-q'), caret = focusQ && a.selectionStart;
  const p = PKW.person && bankPerson(PKW.person);
  if (PKW.person && photoBank.loaded && !p) PKW.person = '';
  const body = !photoBank.loaded ? h('p', { class:'hint sp-empty', text:'Загружаю фотобанк…' })
    : photoBank.error && !photoBank.list.length ? h('p', { class:'sp-err', role:'alert', text:photoBank.error })
    : !photoBank.list.length ? h('p', { class:'hint sp-empty', text:'В фотобанке пока никого нет.' })
    : p ? pkPerson(p) : pkPeople();
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet pk-sheet', role:'dialog', 'aria-label':'Фото из фотобанка' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Фото из фотобанка' }), iconBtn('close', 'Закрыть', closeSettings)),
    p ? null : h('div', { class:'pk-top' },
      h('input', { class:'input pk-q', type:'search', placeholder:'Поиск: имя, фамилия', 'aria-label':'Поиск в фотобанке', value:PKW.q,
        autocomplete:'off', spellcheck:'false', oninput:e => { PKW.q = e.target.value; drawPhotoPick(); } })),
    body));
  if (focusQ){ const el = settingsOverlay.querySelector('.pk-q'); if (el){ el.focus(); try { el.setSelectionRange(caret, caret); } catch(e){} } }
}
