'use strict';

/* ========= Лимиты базы (этап 10.5.4): панель и подсветка — только у админа всей формы =========
   Форма сама не видит счётчики Google. Их читает скрипт из приватного crosspect-backup (cloud/scripts/usage.mjs, раз в 3 часа) и кладёт
   в usage/current; читает документ только админ, клиент не пишет (cloud/firestore.rules). Здесь — слежение за документом (cloud.api.watchUsage),
   окно «Лимиты базы» (пункт списка пространств в шапке главной) и подсветка: от 80 % — жёлтая точка на кнопке списка и жёлтый пункт,
   от 90 % — красные. Подсветка сама пропадает, когда лимит сбросится: суточные счётчики сбрасываются в полночь по тихоокеанскому
   времени (около 9:00 по Варшаве), трафик — 1-го числа. Старые числа прошлых суток или месяца не считаются. */

const GIB = 1024 ** 3, MIB = 1024 ** 2;
const USAGE_WARN = 0.8, USAGE_CRIT = 0.9, USAGE_BAR_WARN = 0.7;
/* Бесплатный тариф Firestore: чтения и записи в сутки, данные, исходящий трафик в месяц */
const USAGE_ROWS = [
  { key:'reads',  field:'reads',       reset:'day',   max:50000,   tip:'Чтения базы на сегодня' },
  { key:'writes', field:'writes',      reset:'day',   max:20000,   tip:'Записи базы на сегодня' },
  { key:'data',   field:'dataBytes',   reset:'none',  max:1 * GIB, tip:'Данные базы' },
  { key:'egress', field:'egressBytes', reset:'month', max:10 * GIB, tip:'Трафик базы за месяц' },
];
const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

let usageData = null;      // как пришло из облака: null — документа ещё нет; undefined — слежение не запущено или нет ответа
let usageUnsub = null, usageOpen = false, usageErr = '';

/* ----- Время: сутки Google считает по тихоокеанскому времени ----- */
function usagePT(ms){
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone:'America/Los_Angeles', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' })
    .formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return { day:p.year + '-' + p.month + '-' + p.day, month:p.year + '-' + p.month, secs:(+p.hour) * 3600 + (+p.minute) * 60 + (+p.second), m:+p.month - 1 };
}
const usageWarsaw = ms => {
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Warsaw', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' })
    .formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return { day:p.year + '-' + p.month + '-' + p.day, hm:(+p.hour) + ':' + p.minute };
};
/* Когда сбросятся суточные лимиты: ближайшая полночь по Тихому океану, в часах Варшавы */
function usageDayReset(now){
  const at = now + (86400 - usagePT(now).secs) * 1000, w = usageWarsaw(at);
  return (w.day === usageWarsaw(now).day ? 'сегодня' : 'завтра') + ' в ' + w.hm;
}
function usageMonthReset(now){ const m = (usagePT(now).m + 1) % 12; return '1 ' + MONTHS_GEN[m]; }

/* ----- Строки панели: значение, доля, цвет. Данные прошлых суток или месяца — «ещё не обновлено» ----- */
function usageRows(u, now){
  now = now || Date.now();
  const pt = usagePT(now);
  return USAGE_ROWS.map(r => {
    const raw = u ? u[r.field] : null;
    const stale = !u || (r.reset === 'day' && u.day !== pt.day) || (r.reset === 'month' && u.month !== pt.month);
    const value = stale || raw == null ? null : raw, pct = value == null ? null : value / r.max;
    return { key:r.key, tip:r.tip, max:r.max, value, pct, stale, reset:r.reset };
  });
}
/* Самый заполненный лимит: { row, pct } или null, если данных нет */
function usageWorst(u, now){
  let best = null;
  usageRows(u, now).forEach(r => { if (r.pct != null && (!best || r.pct > best.pct)) best = { row:r, pct:r.pct }; });
  return best;
}
/* 'none' | 'warn' (от 80 %) | 'crit' (от 90 %) — только у админа */
function usageLevel(u, now){
  if (!cloud.admin) return 'none';
  const w = usageWorst(u === undefined ? usageData : u, now);
  return !w ? 'none' : w.pct >= USAGE_CRIT ? 'crit' : w.pct >= USAGE_WARN ? 'warn' : 'none';
}
const usagePctText = p => Math.min(999, Math.floor(p * 100)) + ' %';
/* «Чтения базы на сегодня — 84 %» — подсказка у точки и пункта */
function usageHint(){
  const w = usageWorst(usageData);
  return w ? w.row.tip + ' — ' + usagePctText(w.pct) : '';
}

/* ----- Числа ----- */
const usageNum = n => Math.round(n).toLocaleString('ru-RU').replace(/\u00a0/g, '\u202f');
function usageBytes(n){
  if (n >= GIB) return (n / GIB).toLocaleString('ru-RU', { maximumFractionDigits:1 }) + '\u00a0ГБ';
  return Math.round(n / MIB).toLocaleString('ru-RU') + '\u00a0МБ';
}
function usageLine(r){
  const money = r.key === 'data' || r.key === 'egress' ? usageBytes : usageNum;
  return money(r.value) + ' из ' + money(r.max);
}
function usageLabel(r, now){
  if (r.key === 'reads') return 'Чтения сегодня';
  if (r.key === 'writes') return 'Записи сегодня';
  if (r.key === 'data') return 'Данные';
  return 'Трафик за ' + MONTHS_NOM[usagePT(now || Date.now()).m];
}
function usageResetText(r, now){
  return r.reset === 'day' ? 'сбросится ' + usageDayReset(now) : r.reset === 'month' ? 'сбросится ' + usageMonthReset(now) : 'не сбрасывается';
}

/* ----- Слежение ----- */
function usageStart(){
  if (usageUnsub || !cloud.admin || !cloud.api || !cloud.api.watchUsage) return;
  usageUnsub = cloud.api.watchUsage(u => { usageData = u; usageErr = ''; usageChanged(); },
    e => { usageData = undefined; usageErr = cloudExplain(e) || 'Не удалось прочитать лимиты.'; usageChanged(); });
}
function usageStop(){
  if (usageUnsub){ try { usageUnsub(); } catch(e){} usageUnsub = null; }
  usageData = undefined; usageErr = '';
  usageChanged();
}

/* ----- Подсветка: точка на кнопке списка пространств, пункт в списке ----- */
function usageDot(){
  const lv = usageLevel();
  return h('span', { class:'usage-dot' + (lv === 'none' ? '' : ' ' + lv), hidden:lv === 'none' ? true : null, title:lv === 'none' ? null : usageHint(), 'aria-hidden':'true' });
}
function usageItemCls(){ const lv = usageLevel(); return lv === 'none' ? '' : ' usage-' + lv; }
function usageChanged(){
  document.querySelectorAll('.usage-dot').forEach(d => {
    const lv = usageLevel();
    d.className = 'usage-dot' + (lv === 'none' ? '' : ' ' + lv); d.hidden = lv === 'none'; d.title = lv === 'none' ? '' : usageHint();
  });
  if (usageOpen) drawUsage();
}

/* ----- Окно ----- */
function openUsage(){
  if (!cloud.admin || !cloudOn()) return;
  usageStart();
  usageOpen = true; settingsGuard = null;
  settingsOverlay.classList.add('open');
  drawUsage();
}
function usageClose(){ usageOpen = false; }
function usageStamp(at){
  const w = usageWarsaw(at), today = usageWarsaw(Date.now()).day;
  return 'Обновлено ' + (w.day === today ? '' : w.day.split('-').reverse().slice(0, 2).join('.') + ' ') + 'в ' + w.hm;
}
function drawUsage(){
  if (!usageOpen) return;
  const now = Date.now(), rows = usageRows(usageData, now);
  const body = usageErr ? h('p', { class:'sp-err', role:'alert', text:usageErr })
    : usageData === undefined ? h('p', { class:'hint', text:'Загружаю…' })
    : usageData === null ? h('p', { class:'hint', text:'Данных пока нет: скрипт в crosspect-backup ещё не запускался.' })
    : h('div', { class:'usage-list' }, rows.map(r => {
      const lv = r.pct == null ? '' : r.pct >= USAGE_CRIT ? ' crit' : r.pct >= USAGE_BAR_WARN ? ' warn' : '';
      return h('div', { class:'usage-row', 'data-usage':r.key },
        h('div', { class:'usage-top' }, h('span', { class:'usage-name', text:usageLabel(r, now) }),
          h('span', { class:'usage-val', text:r.value == null ? (r.stale && usageData ? 'ещё не обновлено' : 'нет данных') : usageLine(r) })),
        h('div', { class:'usage-bar' + lv, role:'progressbar', 'aria-label':usageLabel(r, now), 'aria-valuemin':'0', 'aria-valuemax':'100',
          'aria-valuenow':r.pct == null ? null : String(Math.min(100, Math.round(r.pct * 100))) },
          h('span', { style:'width:' + (r.pct == null ? 0 : Math.min(100, r.pct * 100)) + '%' })),
        h('div', { class:'usage-reset hint', text:usageResetText(r, now) }));
    }));
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet usage-sheet', role:'dialog', 'aria-label':'Лимиты базы' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Лимиты базы' }), iconBtn('close', 'Закрыть', closeSettings)),
    body,
    h('div', { class:'usage-foot' },
      h('span', { class:'hint usage-at', text:usageData && usageData.at ? usageStamp(usageData.at) : '' }),
      h('a', { class:'usage-link', href:'https://console.firebase.google.com/project/' + FIREBASE_CONFIG.projectId + '/firestore', target:'_blank', rel:'noopener', text:'Открыть в консоли Firebase' }))));
}
