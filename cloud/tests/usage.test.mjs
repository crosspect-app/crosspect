// Лимиты базы (этап 10.5.4): разбор ответов Monitoring, тихоокеанские сутки и месяц, запись usage/current (эмулятор).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { pacific, dayStart, monthStart, sumSeries, latestSeries, buildUsage, writeUsage, collect } from '../scripts/usage.mjs';

process.env.METADATA_SERVER_DETECTION = 'none';

const iso = (s) => Date.parse(s);

describe('время', () => {
  test('сутки считаются по тихоокеанскому времени', () => {
    const now = iso('2026-11-18T22:02:00Z');   // 23:02 в Варшаве, 14:02 в Лос-Анджелесе
    assert.equal(pacific(now).day, '2026-11-18');
    assert.equal(dayStart(now), iso('2026-11-18T08:00:00Z'));   // полночь по Тихому океану = 9:00 в Варшаве
    assert.equal(dayStart(iso('2026-11-18T08:00:00Z') - 1), iso('2026-11-17T08:00:00Z'));
  });
  test('начало месяца: переход на зимнее время 1 ноября не сбивает час', () => {
    assert.equal(monthStart(iso('2026-11-18T22:02:00Z')), iso('2026-11-01T07:00:00Z'));   // 1 ноября ещё летнее время (UTC−7)
    assert.equal(monthStart(iso('2026-12-05T10:00:00Z')), iso('2026-12-01T08:00:00Z'));   // зимнее (UTC−8)
    assert.equal(monthStart(iso('2026-12-01T07:59:00Z')), iso('2026-11-01T07:00:00Z'));   // ещё 30 ноября по Тихому океану
  });
});

describe('ответ Monitoring', () => {
  test('приращения складываются по всем рядам и точкам; int64 приходит строкой', () => {
    const body = { timeSeries: [
      { points: [{ value: { int64Value: '4100' } }, { value: { int64Value: '20' } }] },
      { points: [{ value: { doubleValue: 5.5 } }] },
    ] };
    assert.equal(sumSeries(body), 4125.5);
  });
  test('пустой ответ — ноль, а не ошибка (за сутки ничего не читали)', () => {
    assert.equal(sumSeries({}), 0);
    assert.equal(sumSeries({ timeSeries: [] }), 0);
  });
  test('текущее значение: последняя точка каждого ряда; рядов нет — null', () => {
    const body = { timeSeries: [{ points: [
      { interval: { endTime: '2026-11-18T10:00:00Z' }, value: { int64Value: '300' } },
      { interval: { endTime: '2026-11-18T13:00:00Z' }, value: { int64Value: '312' } },
    ] }] };
    assert.equal(latestSeries(body), 312);
    assert.equal(latestSeries({}), null);
  });
});

describe('итог', () => {
  test('день, месяц и числа; чего не получили — null', () => {
    const u = buildUsage({ reads: 4120, writes: 860.4, dataBytes: null }, iso('2026-11-18T22:02:00Z'));
    assert.deepEqual(u, { day: '2026-11-18', month: '2026-11', reads: 4120, writes: 860, dataBytes: null, egressBytes: null });
  });
  test('collect: данные и трафик без заданных метрик — null; запросы идут за тихоокеанские сутки', async () => {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const q = new URL(url).searchParams;
      calls.push({ metric: q.get('filter'), start: q.get('interval.startTime'), end: q.get('interval.endTime') });
      return { ok: true, json: async () => ({ timeSeries: [{ points: [{ value: { int64Value: '7' } }] }] }) };
    };
    try {
      const u = await collect('tok', 'proj', {}, iso('2026-11-18T22:02:00Z'));
      assert.equal(u.reads, 7); assert.equal(u.writes, 7);
      assert.equal(u.dataBytes, null); assert.equal(u.egressBytes, null);
      assert.equal(calls.length, 2);
      assert.match(calls[0].metric, /document\/read_count/); assert.match(calls[1].metric, /document\/write_count/);
      assert.equal(calls[0].start, '2026-11-18T08:00:00.000Z');
      const w = await collect('tok', 'proj', { USAGE_EGRESS_METRIC: 'x/egress', USAGE_DATA_METRIC: 'x/data' }, iso('2026-11-18T22:02:00Z'));
      assert.equal(w.dataBytes, 7); assert.equal(w.egressBytes, 7);
      assert.equal(calls.find((c) => c.metric.includes('x/egress')).start, '2026-11-01T07:00:00.000Z');
    } finally { globalThis.fetch = real; }
  });
  test('ошибка Monitoring не прячется: скрипт упадёт, и Actions покажет красный запуск', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => 'permission denied' });
    try { await assert.rejects(() => collect('tok', 'proj', {}, Date.now()), /Monitoring 403/); } finally { globalThis.fetch = real; }
  });
});

test('writeUsage: usage/current записан целиком со временем сервера, старых полей не остаётся', async () => {
  const db = getFirestore(initializeApp({ projectId: 'demo-crosspect' }, 'usage-test'));
  await db.doc('usage/current').set({ old: 1 });
  await writeUsage(db, buildUsage({ reads: 10, writes: 2, dataBytes: 5, egressBytes: 6 }));
  const d = (await db.doc('usage/current').get()).data();
  assert.equal(d.reads, 10); assert.equal(d.writes, 2); assert.equal(d.dataBytes, 5); assert.equal(d.egressBytes, 6);
  assert.equal(d.old, undefined);
  assert.ok(d.updatedAt && typeof d.updatedAt.toMillis === 'function');
  assert.match(d.day, /^\d{4}-\d{2}-\d{2}$/); assert.match(d.month, /^\d{4}-\d{2}$/);
});
