'use strict';

/* ========= Файлы ========= */
function fileName(){
  const t = (state.meta.title || 'Проповедь').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return (state.meta.date ? state.meta.date + ' ' : '') + t + '.json';
}
/* Сохранение: если у слайдов нет обязательных названий — спросить: дописать или сохранить файл без этих слайдов */
function saveFile(){
  const miss = missingNames();
  if (!miss.length){ writeFile(state); return; }
  const nums = slideNums(), list = miss.map(b => nums[b.id]).join(', ');
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet', role:'dialog', 'aria-label':'Не у всех слайдов есть название' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Не у всех слайдов есть название' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('p', { class:'hint', style:'font-size:12px;margin-bottom:16px', text:'Без названия: ' + (miss.length > 1 ? 'слайды ' : 'слайд ') + list + '. Если сохранить сейчас, ' +
      (miss.length > 1 ? 'этих слайдов' : 'этого слайда') + ' в файле не будет. В редакторе они останутся: можно дописать названия и сохранить ещё раз.' }),
    h('div', { class:'sheet-foot' },
      h('button', { type:'button', class:'btn', onclick:() => {
        closeSettings();
        writeFile(Object.assign({}, state, { blocks:state.blocks.filter(b => !miss.includes(b)) }));
      } }, 'Сохранить без них'),
      h('button', { type:'button', class:'btn primary', onclick:() => { closeSettings(); checkNames(); } }, 'Дописать названия'))));
  settingsOverlay.classList.add('open');
}
function writeFile(data){
  const now = Date.now();
  state.updatedAt = Math.max(state.updatedAt, now); state.savedAt = state.updatedAt;
  data = Object.assign({}, data, { updatedAt:state.updatedAt, savedAt:state.savedAt });
  const blob = new Blob([JSON.stringify(data)], { type:'application/json;charset=utf-8' });
  const a = h('a', { href:URL.createObjectURL(blob), download:fileName() });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  persistDraft();
  toast('Файл сохранён: ' + fileName());
}
/* Достаёт проповедь из текста файла: .json или старый HTML, в котором данные лежат в <script id="sermon-data"> */
function parseSermonFile(txt){
  try {
    let data = null;
    if (txt.replace(/^\uFEFF/, '').trimStart().startsWith('{')) data = JSON.parse(txt);
    else {
      const s = new DOMParser().parseFromString(txt, 'text/html').getElementById('sermon-data');
      if (s) data = JSON.parse(s.textContent || 'null');
    }
    return data && Array.isArray(data.blocks) ? data : null;
  } catch(e){ return null; }
}

fileInput.addEventListener('change', async () => {
  const f = fileInput.files[0]; fileInput.value = '';
  if (!f) return;
  const data = parseSermonFile(await f.text());
  if (!data || !Array.isArray(data.blocks)){ toast('В этом файле нет проповеди'); return; }
  // в браузере уже есть эта же проповедь и она новее файла: не затираем её молча
  const have = readDraft(data.id);
  if (have && (have.updatedAt || 0) > (data.updatedAt || 0) && !confirm('В браузере есть более новая версия этой проповеди. Заменить её файлом?')) return;
  state = normalize(data);
  persistDraft();
  navigate(sermonHash(state.id));
  toast('Открыто: ' + (state.meta.title || f.name));
});
function newSermon(){
  state = blank(); selId = null; persistDraft();   // прежняя проповедь остаётся в списке: у каждой свой черновик
  navigate(sermonHash(state.id));
  openMeta();
}
