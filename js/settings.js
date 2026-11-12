'use strict';

/* settingsGuard — проверка перед закрытием окна (этап 7.5: «Настройки слайдов» спрашивают про несохранённый формат фона).
   Возвращает false, если закрывать окно пока нельзя; closeSettings(true) — закрыть без вопросов */
let settingsGuard = null;
function closeSettings(force){
  if (force !== true && settingsGuard && !settingsGuard()) return;
  settingsGuard = null;
  settingsOverlay.classList.remove('open'); if (metaOpen){ metaOpen = false; afterMeta(); }
}

/* ========= Настройки из репозитория (data/config.json): переводы Библии, список авторов, подпись перевода =========
   Форма всегда берёт файл по ссылке CONFIG_URL_DEFAULT; сменить её больше нельзя (этап 7.3: окно «Источник настроек» убрано).
   Свою ссылку, сохранённую раньше (swp-config-url), форма забывает */
const CONFIG = { url:'', version:'', loadedAt:0, error:'', source:'встроенные списки' };
const configUrl = () => CONFIG_URL_DEFAULT;
try { localStorage.removeItem('swp-config-url'); } catch(e){}
function applyConfig(cfg, url){
  if (!cfg || typeof cfg !== 'object' || (!Array.isArray(cfg.translations) && !Array.isArray(cfg.preachers))) return false;
  const abs = u => { try { return new URL(u, url).href; } catch(e){ return u; } };
  if (Array.isArray(cfg.translations) && cfg.translations.length){
    const next = {};
    cfg.translations.forEach(t => {
      if (!t || !t.id || !t.label) return;
      const e = { group:t.group || 'ru', label:t.label, abbr:t.abbr || '', tr:t.tr != null ? t.tr : t.label, slide:t.slide || '', books:t.books || t.group || 'ru', note:t.note || '', alias:t.alias || '' };
      if (t.file) e.file = t.file;
      if (t.url) e.url = abs(t.url);
      if (t.src) e.src = t.src;
      if (!e.file && !e.url) return;   // «Свой перевод» встроен в форму
      next[t.id] = e;
    });
    if (!next.ru && LANGS.ru) next.ru = LANGS.ru;   // Синодальный нужен как основа для «Своего перевода»
    Object.keys(LANGS).forEach(k => delete LANGS[k]);
    Object.assign(LANGS, next);
  }
  if (Array.isArray(cfg.groups) && cfg.groups.length){ TR_GROUPS.length = 0; cfg.groups.forEach(g => TR_GROUPS.push(g)); }
  if (cfg.bibleBase) BIBLE_SRC[0] = cfg.bibleBase;
  if (typeof cfg.scriptureFooter === 'string' && cfg.scriptureFooter.includes('{name}')) TR_FOOTER = cfg.scriptureFooter.replace(/^\s*\*\s*/, '· ');   // со звёздочкой — прежний вид: теперь точка (этап 7.2)
  if (Array.isArray(cfg.preachers) && cfg.preachers.length){
    PREACHERS.length = 0;
    cfg.preachers.map(String).sort((a, b) => a.localeCompare(b, 'ru')).forEach(x => PREACHERS.push(x));
  }
  // разделы "limits" и "slides" больше не действуют: лимиты и настройки слайдов — общие для пространства, в облаке
  CONFIG.version = cfg.version || '';
  return true;
}
function loadCachedConfig(){
  try {
    const c = JSON.parse(LS.get('swp-config-cache') || 'null');
    if (c && c.url === configUrl() && applyConfig(c.data, c.url)){ CONFIG.url = c.url; CONFIG.loadedAt = c.at; CONFIG.source = 'сохранённая копия'; }
  } catch(e){}
}
async function fetchConfig(url){
  url = url || configUrl();
  if (!url){ CONFIG.error = ''; return false; }
  try {
    const r = await fetch(url, { cache:'no-cache' });
    if (!r.ok) throw new Error('сервер ответил ' + r.status);
    const data = await r.json();
    if (!applyConfig(data, url)) throw new Error('это не файл настроек Crosspect');
    CONFIG.url = url; CONFIG.loadedAt = Date.now(); CONFIG.error = ''; CONFIG.source = 'репозиторий';
    LS.set('swp-config-cache', JSON.stringify({ url, at:CONFIG.loadedAt, data }));
    return true;
  } catch(e){ CONFIG.error = e && e.message ? e.message : 'не удалось загрузить'; return false; }
}
/* ========= Настройки слайдов пространства =========
   Общие для всех проповедей пространства, старых и новых; лежат в облаке (spaces/…/config/slides).
   Меняют админ и редактор, авторы окна не видят. Пример слайда слева раскладывается с ещё не применёнными значениями. */
const canEditSlidesCfg = () => cloudOn() && (cloud.role === 'admin' || cloud.role === 'editor');
/* Примеры для окна: заставка, Писание, тезис, цитата */
const CFG_SAMPLES = {
  splash:() => ({ id:'cfg-sample', type:'splash', meta:{ title:'Вера, которая действует', date:(state && state.meta.date) || nextSunday(), firstName:'Иван', lastName:'Петров' } }),
  scripture:() => ({ id:'cfg-sample', type:'scripture', items:[{ kind:'scripture', manual:true, ref:'Иакова 2:17-18', translation:'Синодальный перевод',
    verses:[{ num:'17', text:'Так и вера, если не имеет дел, мертва сама по себе.' }, { num:'18', text:'Но скажет кто-нибудь: ты имеешь веру, а я имею дела: покажи мне веру твою без дел твоих, а я покажу тебе веру мою из дел моих.' }] }] }),
  thesis:() => ({ id:'cfg-sample', type:'thesis', valign:'center', parts:[{ kind:'text', html:'Вера без дел мертва', align:'center', scale:100, caps:true, frame:false },
    { kind:'text', html:'• слышать слово<br>• исполнять слово', align:'center', scale:100, caps:false, frame:false }] }),
  quote:() => ({ id:'cfg-sample', type:'quote', text:'Вера — живое, смелое доверие к Божьей благодати', author:'Мартин Лютер', caption:'Предисловие к Посланию к Римлянам', scale:100, caps:false })
};
const CFG_KINDS = [
  ['splash', 'Заставка: название', 'splash'], ['foot', 'Заставка: имя и дата', 'splash'],
  ['scripture', 'Место Писания', 'scripture'], ['thesis', 'Тезис', 'thesis'], ['quote', 'Цитата', 'quote']
];
/* Объяснения — только во всплывающих подписях (решение 7.2: текстовых подсказок под полями нет) */
const CFG_TIPS = {
  size:'Размер текста в пикселях кадра 1920×1080. От него считаются проценты',
  minHead:'Насколько можно уменьшить текст, в % от размера',
  min:{ splash:'Предел кнопки «−» у заставки. До этого размера название уменьшается и само, чтобы уложиться в три строки; если и так не влезает, станет ещё мельче, и форма предупредит',
    scripture:'Если стихи пришлось уменьшить сильнее, форма советует разбить их на два слайда',
    thesis:'Самое маленькое значение кнопки «−» у размера текста в слайде', quote:'Самое маленькое значение кнопки «−» у размера текста в слайде' },
  max:'Самое большое значение кнопки «+» у размера текста в слайде',
  maxSplash:'Самое большое значение кнопки «+» у заставки. Размер один на всю проповедь: меняется на всех её заставках',
  track:'Расстояние между буквами в долях размера шрифта: −0,04 — плотнее, 0 — как задумано в шрифте',
  lead:'Высота строки относительно размера шрифта: 1 — строки почти вплотную, 1,25 — свободнее. 1,05 — как в Canva',
  foot:'Имя автора и дата внизу заставки. Размер не подбирается сам: какой задан, такой и будет',
  limit:'Если символов больше, слайд подсвечивается жёлтым. Это подсказка, а не запрет',
  margins:'Поля считаются от края цветной панели, в пикселях кадра 1920×1080. Пока курсор в поле, на примере видна область текста',
  name:'Сколько символов можно ввести в название слайда (имя файла для Holyrics). По нему же обрезается название заставки',
  verses:'Одинаково для всех слайдов Писания: авторы этого не меняют. Строка с местом Писания и подпись перевода выравниваются вместе со стихами',
  gap:'Расстояние между стихами, когда каждый стих с новой строки, в долях размера шрифта',
  refGap:'Расстояние между ссылкой (местом Писания) и текстом стихов, а также между частями слайда, в долях размера шрифта',
  titleOnly:'На всех заставках пространства — только название проповеди посередине слайда: без линии, имени автора и даты',
  footOff:'Сейчас заставки без имени и даты: включено «Заставка: только название»',
  apply:'Настройки общие для всего пространства: после «Применить» они сразу действуют во всех проповедях, старых и новых, у всех участников',
  applyOff:'Вы ещё ничего не изменили',
  bg:'Фон слайдов задают форматы. Формат по умолчанию стоит во всех проповедях пространства, старых и новых',
  stripesV:'Вертикальные цветные полосы. 0 — их нет. Полосы и пятна можно смешивать',
  stripesH:'Горизонтальные цветные полосы. 0 — их нет. Полосы и пятна можно смешивать',
  spots:'Размытые цветные пятна, как в прежнем фоне. 0 — их нет',
  shades:'Сколько цветных полос или пятен в узоре',
  color:'От этого цвета берутся все оттенки узора',
  spread:'Слева оттенки близки к основному цвету: светлее, темнее, насыщеннее. Чем правее, тем дальше они по цветовому кругу',
  blur:'Чем больше, тем мягче переходы и тем слабее видны полосы и пятна',
  grain:'Сила зерна поверх фона. 0 — без зерна',
  grainKind:'Мелкое — как в прежнем фоне, крупное — заметнее, цветное — с цветными точками',
  base:'Яркость тёмной основы под узором',
  vignette:'Насколько темнеют края слайда. 0 — не темнеют',
  seed:'Другое расположение пятен и полос при тех же настройках. У всех участников фон будет одинаковый',
  fmtSel:'Какой формат показать в примере и править. Проповеди получают формат по умолчанию, выбор здесь на них не влияет',
  fmtNew:'Новый формат: чёрный фон без узора, зерна и затемнения краёв',
  fmtCopy:'Копия формата с настройками, как сейчас на ползунках. Чтобы сохранить её, поменяйте название',
  fmtCopyOff:'Сначала сохраните этот формат или выберите другой',
  fmtName:'Название можно задать только новому формату и копии',
  fmtSave:'Сохранить формат под тем же названием с новыми настройками',
  fmtSaveNew:'Сохранить формат с этим названием',
  fmtSaveSame:'В формате ещё ничего не меняли',
  fmtSys:'System Template — прежний фон, его нельзя изменить. Чтобы сделать свой фон, нажмите «Копировать» или «Создать новый»',
  fmtDel:'Удалить формат. Если он стоит по умолчанию, во всех проповедях будет System Template',
  fmtDelSys:'System Template нельзя удалить: это запасной фон',
  fmtDelNew:'Формат ещё не сохранён',
  fmtDef:'Поставить этот формат во все проповеди пространства',
  fmtDefOn:'Этот формат уже стоит по умолчанию',
  fmtDefDirty:'Сначала сохраните изменения в формате',
  fmtDefNew:'Сначала сохраните формат',
  sample:'Пример меняется сразу, а проповеди — только после «Применить»',
  panels:'В каком порядке стоят панели экрана «Слайды» у тех, кто не переставлял их у себя. Каждый может переставить панели у себя, перетащив за заголовок; «⋯ → Сбросить настройки экрана» возвращает порядок, заданный здесь. На узком экране порядок не меняется',
  panelDrag:'Перетащите плашку мышью или пальцем. Можно и стрелками ← → на клавиатуре'
};
const PANEL_NAMES = { film:'Миниатюры', stage:'Слайд', side:'Редактор' };
const PANEL_TIPS = { film:'Лента слайдов с миниатюрами', stage:'Выбранный слайд и «Текст к слайду»', side:'Панель справа: настройки выбранного слайда' };
let slidesCfgHook = null;   // окно «Настройки слайдов» открыто: что сделать, когда пришли новые настройки
function openSlidesCfg(){
  if (!canEditSlidesCfg()){ toast('Настройки слайдов меняют админ и редактор'); return; }
  const tmp = JSON.parse(JSON.stringify(SLIDES_BASE));
  let sample = 'scripture', guide = false, raf = 0, apply = null, saving = false;
  /* Что уйдёт по «Применить»: всё из окна, кроме форматов фона. У форматов свои кнопки, они записываются сразу, поэтому
     форматы всегда берутся из действующих настроек (и не затираются, если их тем временем поменял другой редактор) */
  const tmpFull = () => mergeSlides(SLIDES_DEFAULT, Object.assign({}, tmp, { formats:SLIDES_BASE.formats, defaultFormat:SLIDES_BASE.defaultFormat }));
  /* «Применить» активна, только если в окне что-то изменили по сравнению с тем, что сейчас действует */
  const syncApply = () => {
    if (!apply) return;
    const same = JSON.stringify(tmpFull()) === JSON.stringify(SLIDES_BASE);
    apply.disabled = saving || same;
    apply.title = same ? CFG_TIPS.applyOff : CFG_TIPS.apply;
  };
  const host = h('div', { class:'scfg-slide', title:CFG_TIPS.sample }), info = h('div', { class:'scfg-info' });
  const tabs = h('div', { class:'toggle scfg-tabs' });
  const setSample = k => { if (k === sample) return; sample = k; drawTabs(); paint(); };
  const drawTabs = () => { tabs.replaceChildren(...[['splash', 'Заставка'], ['scripture', 'Писание'], ['thesis', 'Тезис'], ['quote', 'Цитата']].map(([k, l]) =>
    h('button', { type:'button', class:k === sample ? 'on' : '', onclick:() => setSample(k) }, l))); };
  /* Пример перерисовывается с текущими значениями окна; сами настройки не меняются, пока не нажали «Применить» */
  function paint(now){
    cancelAnimationFrame(raf);
    const draw = () => {
      SLIDES_TRY = mergeSlides(SLIDES_DEFAULT, tmp);
      BG_TRY = fe.bg ? normBg(fe.bg) : null;   // пример — с форматом, который выбран (и правится) в блоке «Фон»
      try {
        const b = CFG_SAMPLES[sample](), sl = slideEl(b);
        if (guide) sl.querySelector('.sl-stage').append(h('div', { class:'sl-guide', text:'Область текста' }));
        host.replaceChildren(sl);
        const r = fitSlide(sl, b);
        const c = SLIDES_TRY.kinds;
        info.textContent = r == null ? '' : sample === 'splash' ? 'название ' + Math.round(r * c.splash.size) + ' px'
          : 'текст ' + (Math.round(r * 100) >= 100 ? '100%' : 'уменьшен до ' + Math.round(r * 100) + '%') + ' · ' + Math.round(r * (sample === 'scripture' ? c.scripture.size : c[sample].size) * 10) / 10 + ' px';
      } finally { SLIDES_TRY = null; BG_TRY = undefined; }
      syncApply();
    };
    if (now) draw(); else raf = requestAnimationFrame(draw);
  }
  /* Поле с единицами внутри: «52,8 px», «70 %», «−0,04 em» */
  const num = (obj, key, o) => {
    const inp = h('input', { class:'input', type:'number', inputmode:'decimal', min:String(o.min), max:String(o.max), step:String(o.step || 1), value:String(obj[key]),
      'aria-label':o.label, title:o.tip || '', onfocus:() => { if (o.sample) setSample(o.sample); if (o.guide && !guide){ guide = true; paint(); } },
      onblur:() => { if (o.guide && guide){ guide = false; paint(); } },
      oninput:e => { const v = parseFloat(String(e.target.value).replace(',', '.')); if (isFinite(v)){ obj[key] = v; paint(); } } });
    if (o.disabled) inp.disabled = true;
    return h('div', { class:'unit' + (o.unit ? '' : ' nounit'), title:o.tip || '' }, inp, o.unit ? h('span', { text:o.unit }) : null);
  };
  const dash = tip => h('span', { class:'scfg-na', text:'—', title:tip });
  const tipField = (label, control, tip) => { const f = field(label, control); if (tip) f.title = tip; return f; };
  const fontSel = (key, label) => field(label, h('select', { class:'input', 'aria-label':label, onchange:e => { tmp.fonts[key] = e.target.value; paint(); } },
    Object.keys(SLIDE_FONTS[key]).map(k => h('option', { value:k, selected:tmp.fonts[key] === k }, SLIDE_FONTS[key][k].label))));

  /* Общие настройки: шрифты, длина названия, поля (лимиты тезиса и цитаты — в таблице видов слайдов) */
  const general = h('section', { class:'scfg-sec' },
    h('div', { class:'scfg-cap', text:'Общие настройки' }),
    h('div', { class:'scfg-g3' }, fontSel('main', 'Шрифт кириллицы и латиницы'), fontSel('greek', 'Шрифт для греческого'), fontSel('hebrew', 'Шрифт для иврита')),
    h('div', { class:'scfg-g4' },
      tipField('Название слайда, до', num(tmp.names, 'maxLength', { min:5, max:120, unit:'симв.', label:'Длина названия слайда', tip:CFG_TIPS.name }), CFG_TIPS.name),
      tipField('Поля по бокам', num(tmp.margins, 'side', { min:0, max:400, step:2, unit:'px', label:'Поля по бокам', guide:true, tip:CFG_TIPS.margins }), CFG_TIPS.margins),
      tipField('Поля сверху', num(tmp.margins, 'top', { min:0, max:400, step:2, unit:'px', label:'Поля сверху', guide:true, tip:CFG_TIPS.margins }), CFG_TIPS.margins),
      tipField('Поля снизу', num(tmp.margins, 'bottom', { min:0, max:400, step:2, unit:'px', label:'Поля снизу', guide:true, tip:CFG_TIPS.margins }), CFG_TIPS.margins)));

  /* Расположение панелей по умолчанию (этап 7.4): три плашки в ряд; перетащить мышью или пальцем, а с клавиатуры — стрелки ← → */
  const panelRow = h('div', { class:'scfg-panels', role:'list', 'aria-label':'Порядок панелей', title:CFG_TIPS.panelDrag });
  const setPanels = (order, focusKey) => {
    tmp.panels = order; drawPanels(); syncApply();
    if (focusKey){ const t = panelRow.querySelector('[data-k="' + focusKey + '"]'); if (t) t.focus(); }
  };
  const shiftPanel = (k, d) => {
    const o = normPanels(tmp.panels), i = o.indexOf(k), j = i + d;
    if (j < 0 || j >= o.length) return;
    o.splice(i, 1); o.splice(j, 0, k); setPanels(o, k);
  };
  function drawPanels(){
    const order = normPanels(tmp.panels);
    panelRow.replaceChildren(...order.map((k, i) => {
      const tile = h('div', { class:'scfg-panel', role:'listitem', tabindex:'0', 'data-k':k, title:PANEL_TIPS[k] + '. ' + CFG_TIPS.panelDrag,
        onkeydown:e => { if (e.target !== tile) return; if (e.key === 'ArrowLeft'){ e.preventDefault(); shiftPanel(k, -1); } else if (e.key === 'ArrowRight'){ e.preventDefault(); shiftPanel(k, 1); } },
        onpointerdown:e => startPanelDrag(e, tile, k) },
        h('button', { type:'button', class:'icon-btn', title:'Левее', 'aria-label':PANEL_NAMES[k] + ': левее', disabled:i === 0, onclick:() => shiftPanel(k, -1) }, ic('back')),
        h('span', { class:'scfg-pname', text:PANEL_NAMES[k] }),
        h('button', { type:'button', class:'icon-btn', title:'Правее', 'aria-label':PANEL_NAMES[k] + ': правее', disabled:i === order.length - 1, onclick:() => shiftPanel(k, 1) }, ic('next')));
      return tile;
    }));
  }
  function startPanelDrag(e, tile, k){
    if (e.button > 0 || e.target.closest('button')) return;
    const x0 = e.clientX; let on = false, to = null;
    const move = ev => {
      if (!on){ if (Math.abs(ev.clientX - x0) < 6) return; on = true; panelRow.classList.add('dragging'); tile.classList.add('drag'); }
      ev.preventDefault();
      to = null;
      panelRow.querySelectorAll('.scfg-panel').forEach(t => {
        t.classList.remove('drop');
        const r = t.getBoundingClientRect();
        if (t !== tile && ev.clientX >= r.left && ev.clientX <= r.right){ to = t.dataset.k; t.classList.add('drop'); }
      });
    };
    const up = () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
      panelRow.classList.remove('dragging'); tile.classList.remove('drag');
      panelRow.querySelectorAll('.drop').forEach(t => t.classList.remove('drop'));
      if (!on || !to) return;
      const o = normPanels(tmp.panels), i = o.indexOf(k), j = o.indexOf(to);
      o.splice(i, 1); o.splice(j, 0, k); setPanels(o);
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
  }
  drawPanels();
  const panelsSec = h('section', { class:'scfg-sec', title:CFG_TIPS.panels }, h('div', { class:'scfg-cap', text:'Расположение панелей' }), panelRow);

  /* Виды слайдов: размер, диапазон, расстояния, лимит символов */
  const K = tmp.kinds, footCells = [], grid = h('div', { class:'scfg-kinds', role:'table' },
    h('span', { class:'kh' }, ''),
    h('span', { class:'kh', text:'Размер 100%', title:CFG_TIPS.size }), h('span', { class:'kh', text:'Уменьшение до', title:CFG_TIPS.minHead }),
    h('span', { class:'kh', text:'Увеличение до', title:CFG_TIPS.max }), h('span', { class:'kh', text:'Между символами', title:CFG_TIPS.track }),
    h('span', { class:'kh', text:'Между строками', title:CFG_TIPS.lead }), h('span', { class:'kh', text:'Лимит, симв.', title:CFG_TIPS.limit }));
  CFG_KINDS.forEach(([row, label, smp]) => {
    const k = row === 'foot' ? 'splash' : row, z = K[k], o = (x) => Object.assign({ sample:smp }, x);
    grid.append(h('span', { class:'kl', text:label }));
    if (row === 'foot'){
      const cells = [num(z, 'foot', o({ min:10, max:200, step:1, unit:'px', label:label + ': размер', tip:CFG_TIPS.foot })),
        num(z, 'footTrack', o({ min:-0.2, max:0.3, step:0.01, unit:'em', label:label + ': между символами', tip:CFG_TIPS.track })),
        num(z, 'footLead', o({ min:0.8, max:2, step:0.05, label:label + ': между строками', tip:CFG_TIPS.lead }))];
      footCells.push(grid.lastChild, ...cells);
      grid.append(cells[0], dash('Размер имени и даты не подбирается сам'), dash('Размер имени и даты не подбирается сам'), cells[1], cells[2], dash('Лимита символов нет'));
      return;
    }
    grid.append(num(z, 'size', o({ min:10, max:400, step:k === 'splash' ? 2 : 0.1, unit:'px', label:label + ': размер 100%', tip:CFG_TIPS.size })),
      num(z, 'min', o({ min:20, max:100, step:5, unit:'%', label:label + ': уменьшение до', tip:CFG_TIPS.min[k] })),
      'max' in z ? num(z, 'max', o({ min:100, max:200, step:5, unit:'%', label:label + ': увеличение до', tip:k === 'splash' ? CFG_TIPS.maxSplash : CFG_TIPS.max })) : dash('Стихи не бывают крупнее заданного размера'),
      num(z, 'track', o({ min:-0.2, max:0.3, step:0.01, unit:'em', label:label + ': между символами', tip:CFG_TIPS.track })),
      num(z, 'lead', o({ min:0.8, max:2, step:0.05, label:label + ': между строками', tip:CFG_TIPS.lead })),
      k in tmp.limits ? num(tmp.limits, k, o({ min:20, max:3000, step:10, label:label + ': лимит символов', tip:CFG_TIPS.limit })) : dash('Лимита символов нет'));
  });
  /* Заставка «Только название»: строка «Заставка: имя и дата» в таблице при этом неактивна */
  const footOff = on => footCells.forEach(c => {
    c.classList.toggle('off', on);
    c.querySelectorAll('input').forEach(i => { i.disabled = on; });
    if (c.classList.contains('unit')) c.title = on ? CFG_TIPS.footOff : CFG_TIPS[c === footCells[1] ? 'foot' : c === footCells[2] ? 'track' : 'lead'];
  });
  footOff(K.splash.titleOnly);
  const titleOnly = h('div', { class:'opt-row', title:CFG_TIPS.titleOnly },
    sw('Заставка: только название', K.splash.titleOnly, v => { K.splash.titleOnly = v; footOff(v); if (sample !== 'splash'){ sample = 'splash'; drawTabs(); } paint(); }));
  const kinds = h('section', { class:'scfg-sec' }, h('div', { class:'scfg-cap', text:'Настройки для видов слайдов' }), grid, titleOnly);

  /* Фон (этапы 7.3 и 7.5): строка форматов и ползунки выбранного формата.
     fe — формат, который сейчас показан и правится: kind 'system' (System Template — ползунки серые, менять нельзя),
     'saved' (сохранённый формат пространства), 'new' («Создать новый») или 'copy' («Копировать») — эти два ещё не сохранены.
     Действия с форматами («Сохранить», «Удалить», «Сделать по умолчанию») записываются в облако сразу; «Применить» их не касается */
  let fe = null, fmtBusy = false, fmtErr = null, sheetEl = null, saveBtn = null, defBtn = null, nameInp = null;
  const BF = () => SLIDES_BASE;
  const bgJSON = b => JSON.stringify(b ? normBg(b) : null);
  const isDraft = () => fe.kind === 'new' || fe.kind === 'copy';
  function pickFormat(id){
    const f = id !== SYSTEM_FORMAT && BF().formats[id];
    fe = f ? { id, kind:'saved', name:f.name, bg:f.bg ? Object.assign({}, f.bg) : null, base:bgJSON(f.bg) }
      : { id:SYSTEM_FORMAT, kind:'system', name:SYSTEM_FORMAT_NAME, bg:null };
  }
  const startDraft = (kind, name, bg, from) => { fe = { id:null, kind, name, bg, from:from || '', start:bgJSON(bg), startName:cleanFormatName(name) }; };
  pickFormat(BF().defaultFormat);
  /* Есть ли в формате несохранённое: у сохранённого — ползунки не как в облаке; у нового и копии — что-то поменяли после создания */
  const fmtDirty = () => {
    if (!fe || fe.kind === 'system') return false;
    if (fe.kind === 'saved'){ const f = BF().formats[fe.id]; return !f || bgJSON(fe.bg) !== bgJSON(f.bg); }
    return bgJSON(fe.bg) !== fe.start || cleanFormatName(fe.name) !== fe.startName;
  };
  /* Почему новый формат или копию нельзя сохранить; '' — можно */
  const nameProblem = () => {
    const n = cleanFormatName(fe.name), k = formatKey(n);
    if (!n) return 'Напишите название формата';
    const twin = formatList(BF()).find(f => formatKey(f.name) === k);
    if (!twin) return '';
    return fe.kind === 'copy' && formatKey(fe.from) === k ? 'У копии то же название, что у «' + twin.name + '»: придумайте другое' : 'Формат «' + twin.name + '» уже есть: придумайте другое название';
  };
  const canSaveFmt = () => !fmtBusy && (fe.kind === 'saved' ? fmtDirty() : isDraft() && !nameProblem());

  /* Ползунки — значения выбранного формата; у прежнего фона (bg = null) — начальные BG_START */
  const bgBox = h('div', { class:'scfg-bg' }), fmtRow = h('div', { class:'scfg-fmt' }), fmtDone = h('span', { class:'scfg-fmtdone', role:'status' });
  const bgVal = () => fe.bg || BG_START;
  const bgSet = (k, v) => { if (fe.kind === 'system') return; if (!fe.bg) fe.bg = Object.assign({}, BG_START); fe.bg[k] = v; paint(); syncFmt(); };
  const rng = (label, key, min, max) => {
    const out = h('output', { class:'scfg-rv' }), show = v => { out.textContent = String(v); };
    const inp = h('input', { type:'range', min:String(min), max:String(max), step:'1', value:String(bgVal()[key]), 'aria-label':label,
      oninput:e => { const v = +e.target.value; show(v); bgSet(key, v); } });
    show(bgVal()[key]);
    return h('label', { class:'field scfg-rng', title:CFG_TIPS[key] }, h('span', { class:'lbl', text:label }), h('span', { class:'scfg-rrow' }, inp, out));
  };
  function drawBg(){
    const B = bgVal(), locked = fe.kind === 'system';
    bgBox.replaceChildren(
      h('div', { class:'scfg-g3' }, rng('Полосы по вертикали', 'stripesV', 0, 100), rng('Полосы по горизонтали', 'stripesH', 0, 100), rng('Пятна', 'spots', 0, 100)),
      h('div', { class:'scfg-g3' },
        rng('Оттенков', 'shades', 1, 20),
        tipField('Основной цвет', h('input', { class:'input scfg-color', type:'color', value:B.color, 'aria-label':'Основной цвет', oninput:e => bgSet('color', e.target.value) }), CFG_TIPS.color),
        rng('Разброс оттенков', 'spread', 0, 100)),
      h('div', { class:'scfg-g3' },
        rng('Размытие', 'blur', 0, 100), rng('Зернистость', 'grain', 0, 100),
        tipField('Зерно', toggle([['fine', 'мелкое'], ['coarse', 'крупное'], ['color', 'цветное']], B.grainKind, v => { bgSet('grainKind', v); drawBg(); }), CFG_TIPS.grainKind)),
      h('div', { class:'scfg-g3' },
        rng('Яркость основы', 'base', 0, 40), rng('Затемнение краёв', 'vignette', 0, 100),
        h('div', { class:'scfg-bgbtns' },
          h('button', { type:'button', class:'btn', title:CFG_TIPS.seed, onclick:() => bgSet('seed', bgVal().seed % 9999 + 1) }, 'Другой вариант'))));
    // System Template не меняется: всё серое, объяснение — во всплывающей подписи
    bgBox.classList.toggle('locked', locked);
    bgBox.title = locked ? CFG_TIPS.fmtSys : '';
    if (locked) bgBox.querySelectorAll('input, button').forEach(x => { x.disabled = true; });
  }

  /* Строка форматов: выбор, «Создать новый», «Копировать», «Удалить», «Сделать по умолчанию»; ниже — название и «Сохранить» */
  const fbtn = (label, tip, on, act) => h('button', { type:'button', class:'btn', title:tip, disabled:fmtBusy || !on, onclick:act }, label);
  function drawFmt(){
    const def = BF().defaultFormat, draft = isDraft(), isDef = !draft && fe.id === def;
    const sel = h('select', { class:'input', 'aria-label':'Формат фона', disabled:fmtBusy,
      onchange:e => { const id = e.target.value; drawFmt(); guardFmt(() => openFormat(id)); } },
      draft ? h('option', { value:'', selected:true }, fe.kind === 'new' ? 'Новый формат (не сохранён)' : 'Копия (не сохранена)') : null,
      formatList(BF()).map(f => h('option', { value:f.id, selected:!draft && f.id === fe.id }, f.name + (f.id === def ? ' · по умолчанию' : ''))));
    nameInp = h('input', { class:'input', 'aria-label':'Название формата', maxlength:String(FORMAT_NAME_MAX), value:fe.name, disabled:!draft || fmtBusy,
      title:draft ? '' : CFG_TIPS.fmtName, oninput:e => { fe.name = e.target.value; syncFmt(); } });
    saveBtn = h('button', { type:'button', class:'btn primary', onclick:() => saveFormat() }, 'Сохранить');
    defBtn = fbtn('Сделать по умолчанию', '', !draft && !isDef, () => makeDefault());
    fmtRow.replaceChildren(
      tipField('Формат', sel, CFG_TIPS.fmtSel),
      h('div', { class:'scfg-fmt-btns' },
        fbtn('Создать новый', CFG_TIPS.fmtNew, true, () => guardFmt(() => { startDraft('new', '', Object.assign({}, BG_BLANK)); refreshFmt(true); })),
        fbtn('Копировать', draft ? CFG_TIPS.fmtCopyOff : CFG_TIPS.fmtCopy, !draft, () => { startDraft('copy', fe.name, fe.bg ? Object.assign({}, fe.bg) : null, fe.name); refreshFmt(true); }),
        fbtn('Удалить', fe.kind === 'system' ? CFG_TIPS.fmtDelSys : draft ? CFG_TIPS.fmtDelNew : CFG_TIPS.fmtDel, fe.kind === 'saved', () => deleteFormat()),
        defBtn),
      h('div', { class:'scfg-fmt-name' }, tipField('Название формата', nameInp, draft ? '' : CFG_TIPS.fmtName), h('div', { class:'scfg-fmt-save' }, fmtDone, saveBtn)));
    syncFmt();
  }
  /* Кнопки, которые зависят от правок: «Сохранить» и «Сделать по умолчанию» (без перерисовки, чтобы не сбить набор названия) */
  function syncFmt(){
    if (!saveBtn) return;
    saveBtn.disabled = !canSaveFmt();
    saveBtn.title = fe.kind === 'system' ? CFG_TIPS.fmtSys : fe.kind === 'saved' ? (fmtDirty() ? CFG_TIPS.fmtSave : CFG_TIPS.fmtSaveSame) : (nameProblem() || CFG_TIPS.fmtSaveNew);
    const isDef = !isDraft() && fe.id === BF().defaultFormat, dirty = fmtDirty();
    defBtn.disabled = fmtBusy || isDraft() || isDef || dirty;
    defBtn.title = isDraft() ? CFG_TIPS.fmtDefNew : isDef ? CFG_TIPS.fmtDefOn : dirty ? CFG_TIPS.fmtDefDirty : CFG_TIPS.fmtDef;
  }
  function refreshFmt(focusName){
    drawFmt(); drawBg(); paint();
    if (focusName && nameInp){ nameInp.focus(); nameInp.select(); }
  }
  const openFormat = id => { pickFormat(id); refreshFmt(); };
  /* Уйти с формата (выбрать другой, создать новый, закрыть окно): если в нём есть несохранённое — сначала спросить */
  const guardFmt = next => { if (fmtDirty()) askUnsaved(next); else next(); };

  async function writeFormats(formats, def, doneText){
    fmtBusy = true; fmtErr.textContent = ''; drawFmt();
    try {
      const next = mergeSlides(SLIDES_DEFAULT, Object.assign(JSON.parse(JSON.stringify(BF())), { formats, defaultFormat:def }));
      if (await pushSlides(next) === 'ok') flashDone(fmtDone, doneText);
      return true;
    } catch(e){
      fmtErr.textContent = cloudExplain(e) || 'Не получилось сохранить формат.';
      return false;
    } finally { fmtBusy = false; drawFmt(); }
  }
  async function saveFormat(){
    if (!canSaveFmt()) return false;
    const formats = JSON.parse(JSON.stringify(BF().formats)), bg = fe.bg ? normBg(fe.bg) : null;
    let id = fe.id;
    if (fe.kind === 'saved') formats[id] = { name:formats[id].name, bg };
    else { id = newFormatId(formats); formats[id] = { name:cleanFormatName(fe.name), bg }; }
    const ok = await writeFormats(formats, BF().defaultFormat, '✓ Сохранено');
    if (ok) openFormat(id);
    return ok;
  }
  async function deleteFormat(){
    const id = fe.id, def = BF().defaultFormat;
    if (fe.kind !== 'saved' || !confirm('Удалить формат «' + fe.name + '»?' + (id === def ? ' Он стоит по умолчанию: во всех проповедях будет System Template.' : '') + ' Вернуть его не получится.')) return;
    const formats = JSON.parse(JSON.stringify(BF().formats));
    delete formats[id];
    if (await writeFormats(formats, id === def ? SYSTEM_FORMAT : def, '✓ Удалено')) openFormat(BF().defaultFormat);
  }
  async function makeDefault(){
    const id = fe.id;
    if (isDraft() || fmtDirty()) return;
    if (await writeFormats(JSON.parse(JSON.stringify(BF().formats)), id, '✓ Стоит по умолчанию')) openFormat(id);
  }

  /* Вопрос о несохранённом формате — внутри окна, поверх него */
  const askBox = h('div', { class:'scfg-ask', hidden:true });
  const hideAsk = () => { askBox.hidden = true; askBox.replaceChildren(); };
  function askUnsaved(next){
    const why = isDraft() ? nameProblem() : '';
    const what = fe.kind === 'new' ? 'Новый формат ещё не сохранён.' : fe.kind === 'copy' ? 'Копия формата ещё не сохранена.' : 'В формате «' + fe.name + '» есть несохранённые изменения.';
    const go = () => { hideAsk(); next(); };
    askBox.replaceChildren(h('div', { class:'scfg-ask-box', role:'alertdialog', 'aria-label':'Формат не сохранён' },
      h('p', { text:why ? what + ' ' + why + ', иначе изменения пропадут.' : what + ' Сохранить?' }),
      h('div', { class:'scfg-ask-btns' },
        h('button', { type:'button', class:'btn', onclick:hideAsk }, why ? 'Вернуться к формату' : 'Отмена'),
        h('button', { type:'button', class:'btn', onclick:go }, 'Не сохранять'),
        why ? null : h('button', { type:'button', class:'btn primary', onclick:async () => { hideAsk(); if (await saveFormat()) next(); } }, 'Сохранить'))));
    askBox.hidden = false;
    const f = askBox.querySelector('.btn.primary') || askBox.querySelector('.btn'); if (f) f.focus();
  }
  /* Настройки пришли из облака, пока окно открыто (в том числе после своей записи): обновить список форматов */
  slidesCfgHook = () => {
    if (!sheetEl || !sheetEl.isConnected){ slidesCfgHook = null; return; }
    if (fe.kind === 'saved'){
      const f = BF().formats[fe.id];
      if (!f){ startDraft('new', fe.name, fe.bg); fe.start = ''; drawBg(); paint(); }   // формат удалили в другом месте: правки не пропадают
      else if (bgJSON(fe.bg) === fe.base && fe.base !== bgJSON(f.bg)){ pickFormat(fe.id); drawBg(); paint(); }   // формат поменяли в другом месте, здесь его не трогали — показать новый
    }
    drawFmt(); syncApply();
  };
  drawFmt(); drawBg();
  const background = h('section', { class:'scfg-sec', title:CFG_TIPS.bg }, h('div', { class:'scfg-cap', text:'Фон' }), fmtRow, bgBox);

  /* Место Писания: вид стихов на всех слайдах Писания и расстояния */
  const V = tmp.verses, vbox = h('div', { class:'scfg-verses' });
  const drawVerses = () => {
    const set = (k, v) => { V[k] = v; if (sample !== 'scripture'){ sample = 'scripture'; drawTabs(); } drawVerses(); paint(); };
    vbox.replaceChildren(
      h('div', { class:'opt-row' }, h('span', { class:'lbl', style:'margin:0', text:'Стихи' }),
        toggle([['inline', 'В строку'], ['lines', 'С новой строки']], V.flow, v => set('flow', v)),
        sw('Рамка пунктиром', V.frame, v => set('frame', v))),
      h('div', { class:'opt-row' },
        sw('Стихи заглавными буквами', V.caps, v => set('caps', v)),
        sw('Показывать перевод на слайде', V.showTr, v => set('showTr', v))),
      h('div', { class:'opt-row' }, h('span', { class:'lbl', style:'margin:0', text:'Выравнивание' }),
        h('div', { class:'itools', title:'Выравнивание по горизонтали' },
          [['left', 'alignl', 'По левому краю'], ['center', 'alignc', 'По центру'], ['right', 'alignr', 'По правому краю']].map(([a, icn, t]) =>
            iconBtn(icn, t, () => set('align', a), V.align === a ? 'on' : ''))),
        h('div', { class:'itools', title:'Выравнивание по вертикали' },
          [['top', 'vtop', 'Прижать к верху'], ['center', 'vmid', 'По центру по вертикали'], ['bottom', 'vbot', 'Прижать к низу']].map(([a, icn, t]) =>
            iconBtn(icn, t, () => set('valign', a), V.valign === a ? 'on' : '')))),
      h('div', { class:'scfg-g3' },
        tipField('Между стихами', num(V, 'gap', { min:0, max:2, step:0.05, unit:'em', label:'Расстояние между стихами', sample:'scripture', disabled:V.flow !== 'lines',
          tip:V.flow === 'lines' ? CFG_TIPS.gap : 'Действует, когда стихи «С новой строки»: в строку они идут одним абзацем' }), CFG_TIPS.gap),
        tipField('Между ссылкой и текстом', num(V, 'refGap', { min:0, max:3, step:0.05, unit:'em', label:'Расстояние между ссылкой и текстом', sample:'scripture', tip:CFG_TIPS.refGap }), CFG_TIPS.refGap)));
  };
  drawVerses();
  const verses = h('section', { class:'scfg-sec', title:CFG_TIPS.verses }, h('div', { class:'scfg-cap', text:'Место Писания' }), vbox);

  const err = h('div', { class:'err', role:'alert' }), done = h('span', { class:'scfg-done', role:'status' });
  fmtErr = err;
  apply = h('button', { type:'button', class:'btn primary', onclick:() => { saving = true; syncApply(); saveSlidesCfg(tmpFull(), apply, err, done).then(() => { saving = false; syncApply(); }); } }, 'Применить');
  drawTabs();
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(sheetEl = h('div', { class:'sheet wide scfg', role:'dialog', 'aria-label':'Настройки слайдов' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Настройки слайдов' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('div', { class:'scfg-body' },
      h('div', { class:'scfg-preview' }, tabs, host, info),
      h('div', { class:'scfg-form' }, general, panelsSec, background, kinds, verses)),
    h('div', { class:'sheet-foot' },
      err,
      h('div', { style:'display:flex;gap:8px;align-items:center;margin-left:auto' }, done, apply)),   // закрыть — крестиком или Esc: неприменённое не применяется
    askBox));
  /* Закрыть окно с несохранённым форматом — сначала спросить (остальное неприменённое просто не применяется, как раньше) */
  settingsGuard = () => {
    if (!sheetEl.isConnected) return true;
    if (!askBox.hidden){ hideAsk(); return false; }   // Esc при открытом вопросе — отмена вопроса
    if (!fmtDirty()) return true;
    askUnsaved(() => closeSettings(true));
    return false;
  };
  settingsOverlay.classList.add('open');
  paint(true);   // пример — сразу, без кадра пустоты
}
/* Записать настройки слайдов в облако. Без сети запись ждёт связи; настройки уже действуют здесь (их сразу отдаёт и слушатель облака).
   'ok' — записано, 'slow' — нет связи, запись уйдёт позже; ошибка — исключение */
async function pushSlides(next){
  const slow = new Promise(res => setTimeout(() => res('slow'), 10000));
  const r = await Promise.race([cloud.api.setSlides(cloud.space, cloud.user, next), slow]);
  slidesFromCloud(next);
  if (r === 'slow') toast('Нет связи с облаком: настройки уйдут туда, когда сеть вернётся');
  return r === 'slow' ? 'slow' : 'ok';
}
function flashDone(done, text){
  if (!done) return;
  done.textContent = text; clearTimeout(done._t); done._t = setTimeout(() => { done.textContent = ''; }, 2500);
}
/* «Применить»: записать в облако; окно остаётся открытым, у кнопки — короткое «Применено» */
async function saveSlidesCfg(next, btn, err, done){
  next = mergeSlides(SLIDES_DEFAULT, next);
  btn.textContent = 'Сохраняю…'; err.textContent = ''; if (done) done.textContent = '';
  try {
    if (await pushSlides(next) === 'ok') flashDone(done, '✓ Применено');
  } catch(e){
    err.textContent = cloudExplain(e) || 'Не получилось сохранить настройки.';
  } finally { btn.textContent = 'Применить'; }   // активна ли кнопка дальше — решает окно (есть ли ещё неприменённые изменения)
}
/* Настройки пришли из облака (или их только что применили): запомнить в браузере и перерисовать слайды */
function slidesFromCloud(cfg){
  LS.set('swp-slides-cache', JSON.stringify(cfg || null));
  if (!setSlidesBase(cfg)) return;
  refreshSlides();
}
function loadSlidesCache(){
  try { setSlidesBase(JSON.parse(LS.get('swp-slides-cache') || 'null')); } catch(e){ applySlides(); }
}
/* Перерисовать уже показанные слайды с новыми настройками, не трогая поля, где человек сейчас печатает */
function refreshSlides(){
  const v = slideVars(slidesCfg());
  document.querySelectorAll('.sl-stage').forEach(st => { if (!st.closest('.scfg')) Object.keys(v).forEach(k => st.style.setProperty(k, v[k])); });
  if (slidesCfgHook) slidesCfgHook();   // открыто окно «Настройки слайдов»: обновить список форматов
  if (state && screen === 'sermon') state.blocks.forEach(b => { if (PREVIEW[b.type]) schedulePreview(b); });
  if (inSlides()){
    applyLayout();   // порядок панелей пространства мог измениться (этап 7.4)
    const cur = curBlock(); if (cur && cur.type === 'splash') renderSide();   // у заставки справа видно, показывается ли низ слайда
  }
}
