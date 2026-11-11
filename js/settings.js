'use strict';

function closeSettings(){ settingsOverlay.classList.remove('open'); if (metaOpen){ metaOpen = false; afterMeta(); } }

/* ========= Источник настроек (config.json в репозитории) ========= */
const CONFIG = { url:'', version:'', loadedAt:0, error:'', source:'встроенные списки' };
const configUrl = () => LS.get('swp-config-url') || CONFIG_URL_DEFAULT;
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
  if (typeof cfg.scriptureFooter === 'string' && cfg.scriptureFooter.includes('{name}')) TR_FOOTER = cfg.scriptureFooter;
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
function configStatus(){
  const n = Object.keys(LANGS).length;
  return h('div', { class:'cfg-status' },
    h('div', null, CONFIG.version ? 'Загружена версия ' + CONFIG.version + ' (' + CONFIG.source + (CONFIG.loadedAt ? ', ' + fmtTime(CONFIG.loadedAt) : '') + ')' : 'Сейчас используются встроенные списки.'),
    h('div', null, 'Переводов: ' + n + ' · спикеров: ' + PREACHERS.length),
    CONFIG.error ? h('div', { class:'err', text:'Не получилось загрузить настройки: ' + CONFIG.error }) : null);
}
function openConfig(){
  const url = h('input', { class:'input', type:'url', inputmode:'url', placeholder:CONFIG_URL_DEFAULT || 'https://raw.githubusercontent.com/…/config.json', value:LS.get('swp-config-url') || CONFIG_URL_DEFAULT });
  const status = h('div', null, configStatus());
  const redraw = () => { status.innerHTML = ''; status.append(configStatus()); };
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet', role:'dialog', 'aria-label':'Источник настроек' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Источник настроек' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('p', { class:'hint', text:'Отсюда форма берёт списки переводов и спикеров. Спикерам здесь ничего менять не нужно.' }),
    h('div', { class:'set-grid' }, field('Ссылка на файл настроек', url), status),
    h('div', { class:'sheet-foot' },
      h('button', { type:'button', class:'btn', onclick:() => {
        try { localStorage.removeItem('swp-config-url'); localStorage.removeItem('swp-config-cache'); } catch(e){}
        location.reload();
      } }, 'По умолчанию'),
      h('button', { type:'button', class:'btn primary', onclick:async e => {
        const b = e.currentTarget, u = url.value.trim();
        b.disabled = true; b.textContent = 'Проверяю…';
        const ok = await fetchConfig(u);
        b.disabled = false; b.textContent = 'Проверить и применить';
        if (ok){ if (u && u !== CONFIG_URL_DEFAULT) LS.set('swp-config-url', u); else try { localStorage.removeItem('swp-config-url'); } catch(err){} renderMain(); toast('Настройки загружены'); }
        redraw();
      } }, 'Проверить и применить'))));
  settingsOverlay.classList.add('open');
}

/* ========= Настройки слайдов пространства =========
   Общие для всех проповедей пространства, старых и новых; лежат в облаке (spaces/…/config/slides).
   Меняют админ и редактор, спикеры окна не видят. Пример слайда слева раскладывается с ещё не применёнными значениями. */
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
const CFG_TIPS = {
  size:'Размер текста в пикселях кадра 1920×1080. От него считаются проценты.',
  min:{ splash:'До какого размера название может уменьшиться, чтобы уложиться в три строки. Если и так не влезает, оно станет ещё мельче, и форма предупредит.',
    scripture:'Если стихи пришлось уменьшить сильнее, форма советует разбить их на два слайда.',
    thesis:'Самое маленькое значение кнопки «−» у размера текста в слайде.', quote:'Самое маленькое значение кнопки «−» у размера текста в слайде.' },
  max:'Самое большое значение кнопки «+» у размера текста в слайде.',
  track:'Расстояние между буквами в долях размера шрифта: −0,04 — плотнее, 0 — как задумано в шрифте.',
  lead:'Высота строки относительно размера шрифта: 1 — строки почти вплотную, 1,25 — свободнее.',
  foot:'Имя спикера и дата внизу заставки. Размер не подбирается сам: какой задан, такой и будет.'
};
function openSlidesCfg(){
  if (!canEditSlidesCfg()){ toast('Настройки слайдов меняют админ и редактор'); return; }
  const tmp = JSON.parse(JSON.stringify(SLIDES_BASE));
  let sample = 'scripture', guide = false, raf = 0;
  const host = h('div', { class:'scfg-slide' }), info = h('div', { class:'scfg-info' });
  const tabs = h('div', { class:'toggle scfg-tabs' });
  const setSample = k => { if (k === sample) return; sample = k; drawTabs(); paint(); };
  const drawTabs = () => { tabs.replaceChildren(...[['splash', 'Заставка'], ['scripture', 'Писание'], ['thesis', 'Тезис'], ['quote', 'Цитата']].map(([k, l]) =>
    h('button', { type:'button', class:k === sample ? 'on' : '', onclick:() => setSample(k) }, l))); };
  /* Пример перерисовывается с текущими значениями окна; сами настройки не меняются, пока не нажали «Применить» */
  function paint(){
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      SLIDES_TRY = mergeSlides(SLIDES_DEFAULT, tmp);
      try {
        const b = CFG_SAMPLES[sample](), sl = slideEl(b);
        if (guide) sl.querySelector('.sl-stage').append(h('div', { class:'sl-guide', text:'Область текста' }));
        host.replaceChildren(sl);
        const r = fitSlide(sl, b);
        const c = SLIDES_TRY.kinds;
        info.textContent = r == null ? '' : sample === 'splash' ? 'название ' + Math.round(r * c.splash.size) + ' px'
          : 'текст ' + (Math.round(r * 100) >= 100 ? '100%' : 'уменьшен до ' + Math.round(r * 100) + '%') + ' · ' + Math.round(r * (sample === 'scripture' ? c.scripture.size : c[sample].size) * 10) / 10 + ' px';
      } finally { SLIDES_TRY = null; }
    });
  }
  /* Поле с единицами внутри: «52,8 px», «70 %», «−0,04 em» */
  const num = (obj, key, o) => {
    const inp = h('input', { class:'input', type:'number', inputmode:'decimal', min:String(o.min), max:String(o.max), step:String(o.step || 1), value:String(obj[key]),
      'aria-label':o.label, title:o.tip || '', onfocus:() => { if (o.sample) setSample(o.sample); if (o.guide && !guide){ guide = true; paint(); } },
      onblur:() => { if (o.guide && guide){ guide = false; paint(); } },
      oninput:e => { const v = parseFloat(String(e.target.value).replace(',', '.')); if (isFinite(v)){ obj[key] = v; paint(); } } });
    return h('div', { class:'unit' + (o.unit ? '' : ' nounit'), title:o.tip || '' }, inp, o.unit ? h('span', { text:o.unit }) : null);
  };
  const dash = tip => h('span', { class:'scfg-na', text:'—', title:tip });
  const fontSel = (key, label) => field(label, h('select', { class:'input', 'aria-label':label, onchange:e => { tmp.fonts[key] = e.target.value; paint(); } },
    Object.keys(SLIDE_FONTS[key]).map(k => h('option', { value:k, selected:tmp.fonts[key] === k }, SLIDE_FONTS[key][k].label))));

  /* Общие настройки */
  const general = h('section', { class:'scfg-sec' },
    h('div', { class:'scfg-cap', text:'Общие настройки' }),
    h('div', { class:'scfg-g3' }, fontSel('main', 'Шрифт кириллицы и латиницы'), fontSel('greek', 'Шрифт для греческого'), fontSel('hebrew', 'Шрифт для иврита')),
    h('div', { class:'scfg-g3' },
      field('Название слайда, до', num(tmp.names, 'maxLength', { min:5, max:120, unit:'симв.', label:'Длина названия слайда', tip:'Сколько символов можно ввести в название слайда (имя файла для Holyrics).' })),
      field('Тезис, до', num(tmp.limits, 'thesis', { min:20, max:3000, step:10, unit:'симв.', label:'Лимит тезиса', sample:'thesis', tip:'Если символов больше, слайд подсвечивается жёлтым.' })),
      field('Цитата, до', num(tmp.limits, 'quote', { min:20, max:3000, step:10, unit:'симв.', label:'Лимит цитаты', sample:'quote', tip:'Если символов больше, слайд подсвечивается жёлтым.' }))),
    h('p', { class:'hint', text:'Если в тезисе или цитате больше символов, слайд подсвечивается жёлтым. Это подсказка, а не запрет.' }),
    h('div', { class:'scfg-g3' },
      field('Поля по бокам', num(tmp.margins, 'side', { min:0, max:400, step:2, unit:'px', label:'Поля по бокам', guide:true })),
      field('Поля сверху', num(tmp.margins, 'top', { min:0, max:400, step:2, unit:'px', label:'Поля сверху', guide:true })),
      field('Поля снизу', num(tmp.margins, 'bottom', { min:0, max:400, step:2, unit:'px', label:'Поля снизу', guide:true }))),
    h('p', { class:'hint', text:'Поля считаются от края цветной панели, в пикселях кадра 1920×1080. Пока курсор в поле, на примере видна область текста.' }));

  /* Виды слайдов: размер, диапазон, расстояния */
  const K = tmp.kinds, grid = h('div', { class:'scfg-kinds', role:'table' },
    h('span', { class:'kh' }, ''),
    h('span', { class:'kh', text:'Размер 100%', title:CFG_TIPS.size }), h('span', { class:'kh', text:'Мельче до', title:'Насколько форма может уменьшить текст, в % от размера' }),
    h('span', { class:'kh', text:'Крупнее до', title:CFG_TIPS.max }), h('span', { class:'kh', text:'Между символами', title:CFG_TIPS.track }), h('span', { class:'kh', text:'Между строками', title:CFG_TIPS.lead }));
  CFG_KINDS.forEach(([row, label, smp]) => {
    const k = row === 'foot' ? 'splash' : row, z = K[k], o = (x) => Object.assign({ sample:smp }, x);
    grid.append(h('span', { class:'kl', text:label }));
    if (row === 'foot'){
      grid.append(num(z, 'foot', o({ min:10, max:200, step:1, unit:'px', label:label + ': размер', tip:CFG_TIPS.foot })),
        dash('Размер имени и даты не подбирается сам'), dash(''), dash('Расстояния у имени и даты свои, в коде'), dash(''));
      return;
    }
    grid.append(num(z, 'size', o({ min:10, max:400, step:k === 'splash' ? 2 : 0.1, unit:'px', label:label + ': размер 100%', tip:CFG_TIPS.size })),
      num(z, 'min', o({ min:20, max:100, step:5, unit:'%', label:label + ': мельче до', tip:CFG_TIPS.min[k] })),
      'max' in z ? num(z, 'max', o({ min:100, max:200, step:5, unit:'%', label:label + ': крупнее до', tip:CFG_TIPS.max })) : dash(k === 'splash' ? 'Название не бывает крупнее заданного размера' : 'Стихи не бывают крупнее заданного размера'),
      'track' in z ? num(z, 'track', o({ min:-0.2, max:0.3, step:0.01, unit:'em', label:label + ': между символами', tip:CFG_TIPS.track })) : dash('У названия заставки расстояния свои, в коде'),
      'lead' in z ? num(z, 'lead', o({ min:0.8, max:2, step:0.05, label:label + ': между строками', tip:CFG_TIPS.lead })) : dash('У названия заставки расстояния свои, в коде'));
  });
  const kinds = h('section', { class:'scfg-sec' },
    h('div', { class:'scfg-cap', text:'Настройки для видов слайдов' }),
    grid,
    h('p', { class:'hint', text:'«Мельче до»: заставка — до какого размера уменьшается название, чтобы уложиться в три строки; Писание — если стихи уменьшены сильнее, форма советует разбить слайд; тезис и цитата — пределы кнопок «−» и «+» у размера текста. «Между символами» — в долях размера шрифта, «Между строками» — высота строки (1,05 — как в Canva). Строка с местом Писания не меняется.' }));

  /* Стихи на всех слайдах Писания */
  const V = tmp.verses, vbox = h('div');
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
            iconBtn(icn, t, () => set('valign', a), V.valign === a ? 'on' : '')))));
  };
  drawVerses();
  const verses = h('section', { class:'scfg-sec' },
    h('div', { class:'scfg-cap', text:'Стихи на слайдах Писания' }), vbox,
    h('p', { class:'hint', text:'Одинаково для всех слайдов Писания: спикеры этого не меняют. Строка с местом Писания и подпись перевода выравниваются вместе со стихами.' }));

  const err = h('div', { class:'err', role:'alert' });
  const apply = h('button', { type:'button', class:'btn primary', onclick:() => saveSlidesCfg(tmp, apply, err) }, 'Применить');
  drawTabs();
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet wide scfg', role:'dialog', 'aria-label':'Настройки слайдов' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Настройки слайдов' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('div', { class:'scfg-body' },
      h('div', { class:'scfg-preview' }, tabs, host, info, h('p', { class:'hint', text:'Пример меняется сразу, а проповеди — только после «Применить».' })),
      h('div', { class:'scfg-form' }, general, kinds, verses)),
    h('div', { class:'sheet-foot' },
      h('p', { class:'hint', style:'flex:1;min-width:220px', text:'Настройки общие для всего пространства: после «Применить» они сразу действуют во всех проповедях, старых и новых, у всех участников.' }),
      err,
      h('div', { style:'display:flex;gap:8px' }, h('button', { type:'button', class:'btn', onclick:closeSettings }, 'Отмена'), apply))));
  settingsOverlay.classList.add('open');
  paint();
}
async function saveSlidesCfg(tmp, btn, err){
  const next = mergeSlides(SLIDES_DEFAULT, tmp);
  btn.disabled = true; btn.textContent = 'Сохраняю…'; err.textContent = '';
  // без сети запись ждёт связи; настройки уже действуют здесь (их сразу отдаёт и слушатель облака)
  const slow = new Promise(res => setTimeout(() => res('slow'), 10000));
  try {
    const r = await Promise.race([cloud.api.setSlides(cloud.space, cloud.user, next), slow]);
    slidesFromCloud(next);
    closeSettings();
    toast(r === 'slow' ? 'Нет связи с облаком: настройки уйдут туда, когда сеть вернётся' : 'Настройки слайдов применены ко всем проповедям');
  } catch(e){
    btn.disabled = false; btn.textContent = 'Применить';
    err.textContent = cloudExplain(e) || 'Не получилось сохранить настройки.';
  }
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
  if (state && screen === 'sermon') state.blocks.forEach(b => { if (PREVIEW[b.type]) schedulePreview(b); });
}
