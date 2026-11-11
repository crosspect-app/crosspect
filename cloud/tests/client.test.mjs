// Тест кода формы для облака (js/cloud-api.mjs) в эмуляторе: настоящий вход (эмулятор Auth), настоящие правила.
// Проверяет то, чего не видят тесты правил: что запросы и записи формы эти правила проходят.
// Запуск: cd cloud && npm test (поднимает эмуляторы Firestore и Auth).
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import * as A from 'firebase/auth';
import * as F from 'firebase/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { createCloudAPI, explain } from '../../js/cloud-api.mjs';

const PROJECT = 'demo-crosspect';
const [fsHost, fsPort] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const authUrl = 'http://' + (process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099');
let env;
const apps = [];

before(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host: fsHost, port: +fsPort } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('spaces/sp1').set({ name: 'Тест', settings: { lockMinutes: 10 } });
    await db.doc('spaces/closed').set({ name: 'Закрытое', settings: { preachersSeeAll: false } });
    for (const [sp, email, role, first, last] of [
      ['sp1', 'admin@x.pl', 'admin', 'Ад', 'Мин'], ['sp1', 'ivan@x.pl', 'preacher', 'Иван', 'Петров'], ['sp1', 'petr@x.pl', 'preacher', 'Пётр', 'Сидоров'],
      ['closed', 'ivan@x.pl', 'preacher', 'Иван', 'Петров'], ['closed', 'petr@x.pl', 'preacher', 'Пётр', 'Сидоров']])
      await db.doc(`spaces/${sp}/members/${email}`).set({ email, role, firstName: first, lastName: last });
  });
});
after(async () => { await env.cleanup(); await Promise.all(apps.map(deleteApp)); });

let n = 0;
/* Как форма: приложение Firebase, вход Google (в эмуляторе — выдуманная учётка), API формы поверх */
async function client(email) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'fake-key' }, 'c' + (++n));
  apps.push(app);
  const auth = A.getAuth(app); A.connectAuthEmulator(auth, authUrl, { disableWarnings: true });
  const db = F.getFirestore(app); F.connectFirestoreEmulator(db, fsHost, +fsPort);
  if (email) await A.signInWithCredential(auth, A.GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true, name: email.split('@')[0] })));
  return createCloudAPI({ auth, db, A, F });
}

const sermon = (id, title, extra = {}) => ({
  app: 'swp-sermon', v: 2, id, createdAt: 1, updatedAt: 2, savedAt: 0, cloudAt: 0,
  meta: { title, date: '2026-11-15', firstName: 'Иван', lastName: 'Петров' }, settings: { lang: 'syn', undefinedField: undefined },
  blocks: [{ id: 'b1', type: 'splash', speech: '<b>привет</b>', collapsed: false },
    { id: 'b2', type: 'scripture', items: [{ kind: 'scripture', verses: [{ num: '1', text: 'В начале' }], sel: [1] }] }],
  ...extra,
});
const me = (email) => ({ email });

describe('вход', () => {
  test('onUser отдаёт почту строчными и имя', async () => {
    const api = await client('Admin@X.pl');
    const u = await new Promise((res) => { const off = api.onUser((x) => { off(); res(x); }); });
    assert.equal(u.email, 'admin@x.pl');
    assert.equal(u.name, 'Admin');   // имя берётся из учётки Google как есть
  });
  test('spacesOf находит пространства по почте, чужой почте — пусто', async () => {
    const api = await client('ivan@x.pl');
    const mine = await api.spacesOf('ivan@x.pl');
    assert.deepEqual(mine.map((m) => m.spaceId).sort(), ['closed', 'sp1']);
    assert.equal(mine.find((m) => m.spaceId === 'sp1').role, 'preacher');
    assert.equal(mine.find((m) => m.spaceId === 'sp1').firstName, 'Иван');
    const stranger = await client('stranger@x.pl');
    assert.deepEqual(await stranger.spacesOf('stranger@x.pl'), []);
  });
  test('getSpace отдаёт название и настройки', async () => {
    const api = await client('admin@x.pl');
    const sp = await api.getSpace('sp1');
    assert.equal(sp.name, 'Тест');
    assert.equal(sp.settings.lockMinutes, 10);
  });
});

describe('сохранение', () => {
  test('новая проповедь создаётся: владелец — автор, статус «черновик», время от сервера', async () => {
    const api = await client('ivan@x.pl');
    const r = await api.save('sp1', sermon('new1', 'Вера'), me('ivan@x.pl'));
    assert.equal(r.cloudOwner, 'ivan@x.pl');
    assert.equal(r.cloudStatus, 'draft');
    assert.ok(r.cloudAt > Date.now() - 60_000);
    assert.equal(r.meta.title, 'Вера');
    assert.equal(r.blocks.length, 2);
    assert.ok(!('undefinedField' in r.settings));
    const back = await api.get('sp1', 'new1');
    assert.equal(back.cloudAt, r.cloudAt);
    assert.equal(back.blocks[1].items[0].verses[0].text, 'В начале');
  });
  test('вторая запись с верной версией проходит, версия растёт, владелец и статус не меняются', async () => {
    const api = await client('ivan@x.pl');
    const a = await api.save('sp1', sermon('upd1', 'Раз'), me('ivan@x.pl'));
    const b = await api.save('sp1', sermon('upd1', 'Два', { cloudAt: a.cloudAt }), me('ivan@x.pl'));
    assert.ok(b.cloudAt > a.cloudAt);
    assert.equal(b.meta.title, 'Два');
    assert.equal(b.cloudOwner, 'ivan@x.pl');
    assert.equal(b.cloudStatus, 'draft');
  });
  test('устаревшая версия — конфликт с облачной версией; force заменяет', async () => {
    const api = await client('ivan@x.pl');
    const a = await api.save('sp1', sermon('conf1', 'Раз'), me('ivan@x.pl'));
    await api.save('sp1', sermon('conf1', 'Чужое', { cloudAt: a.cloudAt }), me('ivan@x.pl'));
    await assert.rejects(api.save('sp1', sermon('conf1', 'Моё', { cloudAt: a.cloudAt }), me('ivan@x.pl')),
      (e) => e.code === 'conflict' && e.remote.meta.title === 'Чужое');
    assert.equal((await api.get('sp1', 'conf1')).meta.title, 'Чужое');
    const f = await api.save('sp1', sermon('conf1', 'Моё', { cloudAt: a.cloudAt }), me('ivan@x.pl'), { force: true });
    assert.equal(f.meta.title, 'Моё');
  });
  test('файл поверх уже существующей проповеди (cloudAt 0) — конфликт, а не молчаливая замена', async () => {
    const api = await client('ivan@x.pl');
    await api.save('sp1', sermon('exist1', 'Было'), me('ivan@x.pl'));
    await assert.rejects(api.save('sp1', sermon('exist1', 'Файл'), me('ivan@x.pl')), (e) => e.code === 'conflict');
  });
  test('проповедник не сохраняет в чужую проповедь, админ — может', async () => {
    const ivan = await client('ivan@x.pl'), petr = await client('petr@x.pl'), admin = await client('admin@x.pl');
    const a = await ivan.save('sp1', sermon('own1', 'Иванова'), me('ivan@x.pl'));
    await assert.rejects(petr.save('sp1', sermon('own1', 'Взлом', { cloudAt: a.cloudAt }), me('petr@x.pl')), (e) => /permission-denied/.test(e.code));
    assert.equal((await ivan.get('sp1', 'own1')).meta.title, 'Иванова');
    const r = await admin.save('sp1', sermon('own1', 'Правка редактора', { cloudAt: a.cloudAt }), me('admin@x.pl'));
    assert.equal(r.cloudOwner, 'ivan@x.pl', 'владелец остаётся прежним');
    assert.equal(r.cloudBy, 'admin@x.pl');
  });
  test('проповедник в закрытом пространстве создаёт свою; файл поверх своей существующей — конфликт; поверх чужой — отказ базы', async () => {
    const ivan = await client('ivan@x.pl'), petr = await client('petr@x.pl');
    const a = await ivan.save('closed', sermon('cl1', 'Закрытая'), me('ivan@x.pl'));
    assert.equal(a.cloudOwner, 'ivan@x.pl');
    await assert.rejects(ivan.save('closed', sermon('cl1', 'Файл'), me('ivan@x.pl')), (e) => e.code === 'conflict');
    await assert.rejects(petr.save('closed', sermon('cl1', 'Взлом'), me('petr@x.pl')), (e) => /permission-denied/.test(e.code));
    assert.equal((await ivan.get('closed', 'cl1')).meta.title, 'Закрытая');
  });
  test('слишком большая проповедь не уходит', async () => {
    const api = await client('ivan@x.pl');
    const big = sermon('big1', 'Большая');
    big.blocks.push({ id: 'z', type: 'free', desc: 'я'.repeat(1_000_000) });
    await assert.rejects(api.save('sp1', big, me('ivan@x.pl')), (e) => e.code === 'too-big');
  });
});

describe('список', () => {
  const firstList = (api, space, restrict) => new Promise((res, rej) => {
    // первый ответ может прийти из местного кеша (записанное этим же клиентом): ждём ответ сервера или отказ
    const off = api.listen(space, restrict, (items, fromCache) => { if (fromCache) return; off(); res(items); }, rej);
  });
  test('видны проповеди пространства, свежие сверху', async () => {
    const api = await client('petr@x.pl');
    const items = await firstList(api, 'sp1', null);
    const ids = items.map((x) => x.id);
    assert.ok(ids.includes('new1') && ids.includes('upd1'));
    for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].updatedAt >= items[i].updatedAt);
    assert.ok(items.every((x) => x.cloudSpace === 'sp1' && x.cloudAt === x.updatedAt));
  });
  test('в закрытом пространстве проповедник спрашивает только свои; общий запрос база отклоняет', async () => {
    const ivan = await client('ivan@x.pl'), petr = await client('petr@x.pl');
    await ivan.save('closed', sermon('c-ivan', 'Иванова закрытая'), me('ivan@x.pl'));
    await petr.save('closed', sermon('c-petr', 'Петрова закрытая'), me('petr@x.pl'));
    const mine = await firstList(ivan, 'closed', 'ivan@x.pl');
    assert.deepEqual(mine.map((x) => x.id), ['c-ivan']);
    await assert.rejects(firstList(ivan, 'closed', null), (e) => /permission-denied/.test(e.code));
  });
  test('новая запись приходит в живой список', async () => {
    const api = await client('admin@x.pl'), ivan = await client('ivan@x.pl');
    const seen = [];
    const got = new Promise((res) => {
      const off = api.listen('sp1', null, (items) => { seen.push(items.map((x) => x.id)); if (items.some((x) => x.id === 'live1')) { off(); res(); } }, () => {});
    });
    await new Promise((r) => setTimeout(r, 300));
    await ivan.save('sp1', sermon('live1', 'Живая'), me('ivan@x.pl'));
    await got;
    assert.ok(seen.length >= 1);
  });
});

describe('удаление', () => {
  test('проповедник удаляет свой черновик, чужой — нет', async () => {
    const ivan = await client('ivan@x.pl'), petr = await client('petr@x.pl');
    await ivan.save('sp1', sermon('del1', 'Удаляемая'), me('ivan@x.pl'));
    await assert.rejects(petr.remove('sp1', 'del1'), (e) => /permission-denied/.test(e.code));
    assert.ok(await ivan.get('sp1', 'del1'));
    await ivan.remove('sp1', 'del1');
    assert.equal(await ivan.get('sp1', 'del1'), null);
  });
  test('админ удаляет любую', async () => {
    const ivan = await client('ivan@x.pl'), admin = await client('admin@x.pl');
    await ivan.save('sp1', sermon('del2', 'Удаляемая 2'), me('ivan@x.pl'));
    await admin.remove('sp1', 'del2');
    assert.equal(await admin.get('sp1', 'del2'), null);
  });
});

test('explain: понятные тексты для людей', () => {
  assert.equal(explain({ code: 'conflict' }), 'conflict');
  assert.match(explain({ code: 'permission-denied' }), /Нет прав/);
  assert.match(explain({ code: 'unavailable' }), /Нет связи/);
  assert.equal(explain({ code: 'auth/popup-closed-by-user' }), '');
  assert.match(explain({ code: 'auth/popup-blocked' }), /заблокировал/);
});
