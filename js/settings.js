'use strict';

/* ========= Лимиты ========= */
function openSettings(){
  const st = state.settings, tmp = Object.assign({}, st);
  const row = (key, label, min, max, step) => h('label', { class:'set-row' }, h('span', null, label),
    h('input', { class:'input', type:'number', min:String(min || 50), max:String(max || 3000), step:String(step || 10), value:String(tmp[key]), oninput:e => { tmp[key] = +e.target.value || DEFAULT_SETTINGS[key]; } }));
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet', role:'dialog', 'aria-label':'Лимиты символов' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Лимиты' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('p', { class:'hint', text:'Если текст выходит за лимит, блок подсвечивается жёлтым. Это подсказка, а не запрет. Лимиты сохраняются вместе с проповедью.' }),
    h('div', { class:'set-grid' },
      row('minScale', 'Место Писания: текст можно уменьшать до, %', 40, 100, 5),
      row('limitThesis', 'Тезис, символов'),
      row('limitQuote', 'Цитата, символов')),
    h('div', { class:'sheet-foot' },
      h('button', { type:'button', class:'btn', onclick:() => { state.settings = Object.assign({}, DEFAULT_SETTINGS); change(); closeSettings(); renderMain(); toast('Лимиты сброшены'); } }, 'По умолчанию'),
      h('button', { type:'button', class:'btn primary', onclick:() => { state.settings = tmp; change(); closeSettings(); renderMain(); toast('Лимиты сохранены'); } }, 'Сохранить'))));
  settingsOverlay.classList.add('open');
}
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
  if (cfg.limits && typeof cfg.limits === 'object') Object.assign(DEFAULT_SETTINGS, cfg.limits);
  if (cfg.slides && typeof cfg.slides === 'object'){ SLIDES_BASE = mergeSlides(SLIDES_DEFAULT, cfg.slides); applySlides(); }
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

/* ========= Поля и названия слайдов: макет с областью текста ========= */
function openSlidesCfg(){
  const base = mergeSlides(SLIDES_BASE, null), tmp = slidesCfg();
  const stage = h('div', { class:'sl-stage' }, h('div', { class:'sl-frame' }),
    h('div', { class:'sl-panel' }, h('div', { class:'sl-glow' }), h('div', { class:'sl-grain' }), h('div', { class:'sl-vig' })),
    h('div', { class:'sl-guide', text:'Область текста' }));
  const mock = h('div', { class:'sl', 'aria-label':'Макет слайда с полями' }, stage);
  const paint = () => { const v = marginVars(tmp.margins); Object.keys(v).forEach(k => stage.style.setProperty(k, v[k])); };
  const num = (obj, key, min, max) => h('input', { class:'input', type:'number', min:String(min), max:String(max), step:'2', value:String(obj[key]),
    oninput:e => { obj[key] = clampN(e.target.value, min, max, obj[key]); paint(); } });
  const sameAsBase = () => JSON.stringify(tmp) === JSON.stringify(base);
  const note = h('div', { class:'cfg-note' });
  const showNote = () => {
    const local = !!slidesLocal();
    note.className = 'cfg-note' + (local ? ' local' : '');
    note.textContent = local
      ? 'Сейчас действуют ваши значения, и только в этом браузере. Чтобы они стали общими для всех, нажмите «Скопировать для config.json» и замените в файле настроек раздел "slides".'
      : 'Сейчас действуют общие значения из файла настроек. Поля считаются от края цветной панели, в пикселях кадра 1920×1080.';
  };
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet', role:'dialog', 'aria-label':'Настройки слайдов' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Настройки слайдов' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('div', { class:'mock' }, mock,
      h('div', { class:'mock-grid' }, field('По бокам', num(tmp.margins, 'side', 0, 400)), field('Сверху', num(tmp.margins, 'top', 0, 400)), field('Снизу', num(tmp.margins, 'bottom', 0, 400)))),
    h('div', { class:'set-grid' },
      h('label', { class:'switch' }, h('input', { type:'checkbox', checked:tmp.names.required, onchange:e => { tmp.names.required = e.target.checked; } }),
        h('span', { class:'sw' }), 'Название слайда обязательно (тезис, картинка, видео, свободный)'),
      h('label', { class:'set-row' }, h('span', null, 'Длина названия, символов'),
        h('input', { class:'input', type:'number', min:'5', max:'120', step:'1', value:String(tmp.names.maxLength), oninput:e => { tmp.names.maxLength = clampN(e.target.value, 5, 120, 35); } })),
      
      h('label', { class:'set-row' }, h('span', null, 'Место Писания: размер текста, % (100% = 48 px)'),
        h('input', { class:'input', type:'number', min:'50', max:'200', step:'5', value:String(tmp.sizes.scripture.size), oninput:e => { tmp.sizes.scripture.size = clampN(e.target.value, 50, 200, 110); } })),
      h('div', { class:'mock-grid', style:'grid-template-columns:repeat(4,1fr)' },
        field('Тезис: мельче до, %', h('input', { class:'input', type:'number', min:'30', max:'100', step:'5', value:String(tmp.sizes.thesis.min), oninput:e => { tmp.sizes.thesis.min = clampN(e.target.value, 30, 100, 70); } })),
        field('Тезис: крупнее до, %', h('input', { class:'input', type:'number', min:'100', max:'200', step:'5', value:String(tmp.sizes.thesis.max), oninput:e => { tmp.sizes.thesis.max = clampN(e.target.value, 100, 200, 130); } })),
        field('Цитата: мельче до, %', h('input', { class:'input', type:'number', min:'30', max:'100', step:'5', value:String(tmp.sizes.quote.min), oninput:e => { tmp.sizes.quote.min = clampN(e.target.value, 30, 100, 70); } })),
        field('Цитата: крупнее до, %', h('input', { class:'input', type:'number', min:'100', max:'200', step:'5', value:String(tmp.sizes.quote.max), oninput:e => { tmp.sizes.quote.max = clampN(e.target.value, 100, 200, 110); } }))),
      h('details', { class:'tmp-set' },
        h('summary', null, 'Плотность шрифта — до проверки на проекторе'),
        h('div', { class:'radios' },
          [['all', 'Как в Canva, весь текст на слайдах (основной)'], ['verses', 'Как в Canva только стихи Писания'], ['off', 'Прежний: толщина 400, строки 1,25']].map(([v, l]) =>
            h('label', null, h('input', { type:'radio', name:'cv-font', value:v, checked:tmp.font.canva === v, onchange:() => { tmp.font.canva = v; } }), l)),
          h('p', { class:'hint', text:'«Как в Canva»: тоньше (325 вместо 400), буквы плотнее, строки ближе (1,05 вместо 1,25). Размер не меняется: его задают проценты выше. С этим шрифтом Месту Писания нужно 110%, чтобы буквы были как в Canva (это значение по умолчанию).' }))),
      note),
    h('div', { class:'sheet-foot' },
      h('div', { style:'display:flex;gap:8px;flex-wrap:wrap' },
        h('button', { type:'button', class:'btn', onclick:() => {
          try { localStorage.removeItem('swp-slides-local'); } catch(e){}
          applySlides(); closeSettings(); renderMain(); toast('Вернулись общие настройки слайдов');
        } }, 'Общие (по умолчанию)'),
        h('button', { type:'button', class:'btn', onclick:() => copyText('"slides": ' + JSON.stringify(tmp)) }, 'Скопировать для config.json')),
      h('button', { type:'button', class:'btn primary', onclick:() => {
        if (sameAsBase()){ try { localStorage.removeItem('swp-slides-local'); } catch(e){} }
        else LS.set('swp-slides-local', JSON.stringify(tmp));
        applySlides(); closeSettings(); renderMain(); toast('Настройки слайдов применены');
      } }, 'Применить'))));
  settingsOverlay.classList.add('open');
  paint(); showNote();
  requestAnimationFrame(() => mock.style.setProperty('--s', mock.clientWidth / SL.W));
}

