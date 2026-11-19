// Лимиты базы (этап 10.5.4): счётчики Cloud Monitoring → Firestore usage/current.
// Форма сама счётчики Google не видит: их отдаёт Cloud Monitoring только служебному аккаунту (роль Monitoring Viewer).
// Запуск — workflow «Лимиты базы» в crosspect-backup, раз в 3 часа. Форма читает usage/current только у админа (cloud/firestore.rules).
//
//   node usage.mjs            посчитать и записать usage/current
//   node usage.mjs --dry-run  только посчитать и вывести
//   node usage.mjs list       какие метрики Firestore видит Monitoring (чтобы выбрать данные и трафик, см. ниже)
//
// Счётчики: чтения и записи — с полуночи по тихоокеанскому времени (так Google считает сутки; в Варшаве это около 9:00).
// Объём данных — storage/data_and_index_storage_bytes (последнее значение за сутки). Исходящего трафика среди метрик Firestore нет (проверено списком
// `list` 19 ноября 2026): USAGE_EGRESS_METRIC (сумма с 1-го числа по тихоокеанскому времени) можно задать, если найдётся подходящая; пока не задана — null,
// панель покажет «нет данных». Свои имена: USAGE_READS_METRIC, USAGE_WRITES_METRIC, USAGE_DATA_METRIC.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { cert } from 'firebase-admin/app';
import { FieldValue } from 'firebase-admin/firestore';
import { connect } from './lib.mjs';

export const DEFAULT_METRICS = {
  reads: 'firestore.googleapis.com/document/read_count',
  writes: 'firestore.googleapis.com/document/write_count',
  data: 'firestore.googleapis.com/storage/data_and_index_storage_bytes',   // GAUGE, байты (метрика есть в списке `usage.mjs list`)
};

/* ----- Время: тихоокеанские сутки и месяц ----- */
export function pacific(ms) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return {
    day: `${p.year}-${p.month}-${p.day}`, month: `${p.year}-${p.month}`, dom: +p.day,
    secs: (+p.hour) * 3600 + (+p.minute) * 60 + (+p.second),
  };
}
/* Последняя полночь по Тихому океану, мс. В сутки перехода на зимнее и летнее время часов 25 или 23, поэтому после вычитания секунд проверяем соседние часы */
export function dayStart(ms) {
  const now = pacific(ms), base = ms - now.secs * 1000 - (((ms % 1000) + 1000) % 1000);
  for (const k of [0, -1, 1]) {
    const c = base + k * 3600000, p = pacific(c);
    if (p.secs === 0 && p.day === now.day) return c;
  }
  return base;
}
/* Полночь 1-го числа по Тихому океану. Сдвиг на сутки назад может сбиться на час (переход на летнее время): прибавляем 12 часов и снова берём полночь */
export function monthStart(ms) {
  const first = dayStart(ms) - (pacific(ms).dom - 1) * 86400000;
  return dayStart(first + 12 * 3600 * 1000);
}

/* ----- Разбор ответа Monitoring (timeSeries.list) ----- */
const pointValue = (p) => {
  const v = p && p.value;
  if (!v) return 0;
  const n = v.int64Value != null ? Number(v.int64Value) : v.doubleValue != null ? Number(v.doubleValue) : 0;
  return Number.isFinite(n) ? n : 0;
};
/* Сумма всех точек всех рядов: для счётчиков-приращений (DELTA) за период */
export function sumSeries(body) {
  let total = 0, any = false;
  for (const ts of (body && body.timeSeries) || []) for (const p of ts.points || []) { total += pointValue(p); any = true; }
  return any ? total : 0;
}
/* Последнее значение каждого ряда, сложенные: для «текущего» значения (GAUGE), например объёма данных. Нет рядов — null */
export function latestSeries(body) {
  const series = (body && body.timeSeries) || [];
  let total = 0, any = false;
  for (const ts of series) {
    const pts = (ts.points || []).slice().sort((a, b) => String(b.interval && b.interval.endTime).localeCompare(String(a.interval && a.interval.endTime)));
    if (pts.length) { total += pointValue(pts[0]); any = true; }
  }
  return any ? total : null;
}

/* Что кладём в usage/current. null — счётчик не получили; форма покажет «нет данных» */
export function buildUsage({ reads = null, writes = null, dataBytes = null, egressBytes = null } = {}, now = Date.now()) {
  const pt = pacific(now);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
  return { day: pt.day, month: pt.month, reads: num(reads), writes: num(writes), dataBytes: num(dataBytes), egressBytes: num(egressBytes) };
}
export async function writeUsage(db, usage) {
  await db.doc('usage/current').set({ ...usage, updatedAt: FieldValue.serverTimestamp() });   // set без merge: старых полей не остаётся
}

/* ----- Запросы к Monitoring ----- */
const API = 'https://monitoring.googleapis.com/v3/projects/';
async function monitoring(token, project, path, params) {
  const url = `${API}${project}/${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Monitoring ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
/* Один ряд за период [start, end]: kind 'sum' — приращения складываются, 'last' — последнее значение */
export async function readMetric(token, project, metric, start, end, kind) {
  const secs = Math.max(60, Math.ceil((end - start) / 1000));
  const params = {
    filter: `metric.type="${metric}"`,
    'interval.startTime': new Date(start).toISOString(),
    'interval.endTime': new Date(end).toISOString(),
    'aggregation.alignmentPeriod': `${secs}s`,
    'aggregation.perSeriesAligner': kind === 'sum' ? 'ALIGN_SUM' : 'ALIGN_MAX',
    'aggregation.crossSeriesReducer': kind === 'sum' ? 'REDUCE_SUM' : 'REDUCE_MAX',
  };
  const body = await monitoring(token, project, 'timeSeries', params);
  return kind === 'sum' ? sumSeries(body) : latestSeries(body);
}
export async function collect(token, project, env = process.env, now = Date.now()) {
  const day = dayStart(now), month = monthStart(now);
  const reads = await readMetric(token, project, env.USAGE_READS_METRIC || DEFAULT_METRICS.reads, day, now, 'sum');
  const writes = await readMetric(token, project, env.USAGE_WRITES_METRIC || DEFAULT_METRICS.writes, day, now, 'sum');
  // данные — за последние сутки (Google обновляет объём несколько раз в сутки), трафик — с 1-го числа
  const dataBytes = await readMetric(token, project, env.USAGE_DATA_METRIC || DEFAULT_METRICS.data, now - 86400000, now, 'last');
  const egressBytes = env.USAGE_EGRESS_METRIC ? await readMetric(token, project, env.USAGE_EGRESS_METRIC, month, now, 'sum') : null;
  return buildUsage({ reads, writes, dataBytes, egressBytes }, now);
}

async function main() {
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyFile) throw new Error('Нет ключа: задайте GOOGLE_APPLICATION_CREDENTIALS (путь к JSON-ключу)');
  const key = JSON.parse(readFileSync(keyFile, 'utf8'));
  const token = (await cert(key).getAccessToken()).access_token;
  if (process.argv[2] === 'list') {
    const body = await monitoring(token, key.project_id, 'metricDescriptors', { filter: 'metric.type = starts_with("firestore.googleapis.com/")' });
    for (const d of body.metricDescriptors || []) console.log(`${d.type}\t${d.metricKind}\t${d.valueType}\t${d.unit || ''}\t${d.displayName || ''}`);
    return;
  }
  const usage = await collect(token, key.project_id);
  console.log(JSON.stringify(usage));
  if (!process.argv.includes('--dry-run')) {
    await writeUsage(connect(), usage);
    console.log('usage/current записан');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
}
