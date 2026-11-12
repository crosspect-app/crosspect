'use strict';

/* ========= Файл проповеди и новая проповедь =========
   С этапа 8 проповеди живут только в облаке. Файл .json — копия на компьютер («⋯ → Скачать файл»);
   открыть файл в форме больше нельзя. */
function fileName(){
  const t = (state.meta.title || 'Проповедь').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return (state.meta.date ? state.meta.date + ' ' : '') + t + '.json';
}
/* «Скачать файл»: если у слайдов нет обязательных названий — спросить: дописать или скачать файл без этих слайдов */
function saveFile(){
  const miss = missingNames();
  if (!miss.length){ writeFile(state); return; }
  const nums = slideNums(), list = miss.map(b => nums[b.id]).join(', ');
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet', role:'dialog', 'aria-label':'Не у всех слайдов есть название' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Не у всех слайдов есть название' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('p', { class:'hint', style:'font-size:12px;margin-bottom:16px', text:'Без названия: ' + (miss.length > 1 ? 'слайды ' : 'слайд ') + list + '. Если скачать файл сейчас, ' +
      (miss.length > 1 ? 'этих слайдов' : 'этого слайда') + ' в файле не будет. В проповеди они останутся: можно дописать названия и скачать файл ещё раз.' }),
    h('div', { class:'sheet-foot' },
      h('button', { type:'button', class:'btn', onclick:() => {
        closeSettings();
        writeFile(Object.assign({}, state, { blocks:state.blocks.filter(b => !miss.includes(b)) }));
      } }, 'Скачать без них'),
      h('button', { type:'button', class:'btn primary', onclick:() => { closeSettings(); checkNames(); } }, 'Дописать названия'))));
  settingsOverlay.classList.add('open');
}
const CLOUD_FIELDS = ['cloudSpace', 'cloudAt', 'cloudOwner', 'cloudStatus', 'cloudBy'];
function stripCloud(d){ d = Object.assign({}, d); CLOUD_FIELDS.forEach(k => delete d[k]); return d; }
/* Файл — только копия: отметку «сохранено» у проповеди он не ставит, несохранённое по-прежнему уйдёт в облако */
function writeFile(data){
  data = stripCloud(Object.assign({}, data));   // метки облака в файл не идут
  delete data.lock;
  const blob = new Blob([JSON.stringify(data)], { type:'application/json;charset=utf-8' });
  const a = h('a', { href:URL.createObjectURL(blob), download:fileName() });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast('Файл скачан: ' + fileName());
}
function newSermon(){
  if (!cloudOn()) return;
  endCloud();   // прежнюю проповедь — сохранить и отпустить
  state = blank(); selId = null;
  state.cloudSpace = cloud.space;   // черновик принадлежит пространству: до первой записи он виден только на его главной
  // автором по умолчанию ставим себя (для любой роли), в «О проповеди» его можно сменить: редактор часто делает проповедь за другого.
  // Имя берём из записи среди участников, а если там пусто — из аккаунта Google («Имя Фамилия»)
  const m = cloud.member || {}, g = String((cloud.user && cloud.user.name) || '').trim().split(/\s+/).filter(Boolean);
  const first = m.firstName || m.lastName ? m.firstName || '' : g[0] || '', last = m.firstName || m.lastName ? m.lastName || '' : g.slice(1).join(' ');
  Object.assign(state.meta, { firstName:first, lastName:last });
  beginCloud(null);   // новая: сразу правка, замок появится с первым сохранением
  persistDraft();   // прежняя проповедь остаётся в списке: у каждой свой черновик
  navigate(sermonHash(state.id));
  openMeta();
}
