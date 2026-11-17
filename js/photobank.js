'use strict';

/* ========= Окно «Фотобанк» (этап 10.5): только у админа всей формы =========
   Открывается из списка пространств в шапке главной («Фотобанк…», app.js). Список авторов с фото и поиск; у каждого — имя,
   фамилия, подпись и другие написания (через «;», по ним работает поиск). «Сохранить» у строки пишет правку в облако
   (authors/{id}, photos.js показывает её поверх img/authors/authors.json) — у всех сразу. Уже выбранные в конспектах
   имена и подписи не меняются. Добавить или удалить фото здесь нельзя: картинки — через беседу «Фотобанк» */
let PBW = null;   // { q, drafts: { id: { first, last, caption, aliases } }, saving: Set(id), err: { id: текст } }
const PB_FIELDS = [['first', 'Имя', 100], ['last', 'Фамилия', 100], ['caption', 'Подпись', 200], ['aliases', 'Другие написания', 400]];
const pbValue = (a, k) => k === 'aliases' ? (a.aliases || []).join('; ') : String(a[k] || '');
const pbDraft = a => PBW.drafts[a.id] || null;
const pbChanged = a => { const d = pbDraft(a); return !!d && PB_FIELDS.some(([k]) => d[k].trim() !== pbValue(a, k)); };
const pbDirty = () => !!PBW && photoBank.list.some(pbChanged);

function openPhotoBank(){
  if (!cloud.admin || !cloudOn()) return;
  PBW = { q:'', drafts:{}, saving:new Set(), err:{} };
  settingsGuard = () => !pbDirty() || confirm('Изменения в фотобанке не сохранены. Закрыть без сохранения?');
  settingsOverlay.classList.add('open');
  drawPhotoBank();
  loadPhotoBank().then(() => drawPhotoBank());
  const q = settingsOverlay.querySelector('.pb-q'); if (q) q.focus();
}
function pbStop(){ PBW = null; }
/* Пришли правки из облака: перерисовать, сохранив поле с курсором */
function photoBankChanged(){ if (PBW && settingsOverlay.querySelector('.pb-sheet')) drawPhotoBank(); }

async function pbSave(a){
  const d = pbDraft(a); if (!d) return;
  const f = { first:d.first.trim(), last:d.last.trim(), caption:d.caption.trim(), aliases:d.aliases.split(';').map(x => x.trim()).filter(Boolean) };
  if (!f.first && !f.last){ PBW.err[a.id] = 'Нужно имя или фамилия'; drawPhotoBank(); return; }
  PBW.saving.add(a.id); delete PBW.err[a.id]; drawPhotoBank();
  try {
    await cloud.api.setAuthor(cloud.user, a.id, f);
    if (!PBW) return;
    delete PBW.drafts[a.id];
  } catch(e){ if (PBW) PBW.err[a.id] = cloudExplain(e) || 'Не удалось сохранить.'; }
  if (!PBW) return;
  PBW.saving.delete(a.id); drawPhotoBank();
}

function pbRow(a){
  const d = pbDraft(a), changed = pbChanged(a), busy = PBW.saving.has(a.id);
  const val = k => d ? d[k] : pbValue(a, k);
  const inp = ([k, t, max]) => h('input', { class:'input', 'aria-label':t + ': ' + bankName(a), placeholder:t, value:val(k), maxlength:String(max),
    autocomplete:'off', spellcheck:'false', 'data-pb':a.id + ':' + k, disabled:busy ? true : null,
    oninput:e => {
      const x = PBW.drafts[a.id] || (PBW.drafts[a.id] = Object.fromEntries(PB_FIELDS.map(([f]) => [f, pbValue(a, f)])));
      x[k] = e.target.value;
      const row = e.target.closest('.pb-row'), btn = row && row.querySelector('.pb-save');
      if (btn) btn.disabled = !pbChanged(a);
    } });
  return h('div', { class:'pb-row' + (changed ? ' changed' : '') },
    h('img', { class:'pb-img', src:PHOTO_DIR + a.file, alt:'', loading:'lazy' }),
    h('div', { class:'pb-fields' }, PB_FIELDS.map(inp)),
    h('div', { class:'pb-acts' },
      h('button', { type:'button', class:'btn primary small pb-save', disabled:changed && !busy ? null : true, onclick:() => pbSave(a) }, busy ? 'Сохраняю…' : 'Сохранить'),
      a.preset ? h('span', { class:'hint pb-preset', text:'Вид по умолчанию задан' }) : null,
      PBW.err[a.id] ? h('span', { class:'sp-err', role:'alert', text:PBW.err[a.id] }) : null));
}

function drawPhotoBank(){
  if (!PBW) return;
  const a = document.activeElement, focus = a && a.dataset && (a.dataset.pb || (a.classList.contains('pb-q') ? 'q' : '')),
    caret = focus && a.selectionStart;
  const found = photoSearch(PBW.q, null).sort((x, y) => x.last.localeCompare(y.last, 'ru') || x.first.localeCompare(y.first, 'ru'));
  const list = !photoBank.loaded ? h('p', { class:'hint sp-empty', text:'Загружаю фотобанк…' })
    : !photoBank.list.length ? h('p', { class:'hint sp-empty', text:'В фотобанке пока нет фото.' })
    : !found.length ? h('p', { class:'hint sp-empty', text:'Никого не нашлось.' })
    : h('div', { class:'pb-list' }, h('div', { class:'pb-head', 'aria-hidden':'true' }, h('span'), h('div', { class:'pb-fields' }, PB_FIELDS.map(([, t]) => h('span', { text:t }))), h('span')),
      found.map(pbRow));
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet wide pb-sheet', role:'dialog', 'aria-label':'Фотобанк' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Фотобанк' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('div', { class:'pb-top' },
      h('input', { class:'input pb-q', type:'search', placeholder:'Поиск по имени', 'aria-label':'Поиск по имени', value:PBW.q, autocomplete:'off', spellcheck:'false',
        oninput:e => { PBW.q = e.target.value; drawPhotoBank(); } })),
    list));
  if (focus){
    const el = focus === 'q' ? settingsOverlay.querySelector('.pb-q') : settingsOverlay.querySelector('[data-pb="' + focus + '"]');
    if (el){ el.focus(); if (caret != null) try { el.setSelectionRange(caret, caret); } catch(e){} }
  }
}
