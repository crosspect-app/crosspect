// Тест кода формы для облака (js/cloud-api.mjs) в эмуляторе: настоящий вход (эмулятор Auth), настоящие правила.
// Проверяет то, чего не видят тесты правил: что запросы и записи формы эти правила проходят.
// Запуск: cd cloud && npm test (поднимает эмуляторы Firestore и Auth).
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import * as A from 'firebase/auth';
import * as F from 'firebase/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { createCloudAPI, explain, summaryOf } from '../../js/cloud-api.mjs';

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
    await db.doc('admins/admin@x.pl').set({ email: 'admin@x.pl' });   // админ всей формы (этап 8): в пространствах не участник
    for (const [sp, email, role, first, last] of [
      ['sp1', 'ivan@x.pl', 'preacher', 'Иван', 'Петров'], ['sp1', 'petr@x.pl', 'preacher', 'Пётр', 'Сидоров'],
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
  test('админ всей формы: isAdmin и все пространства; остальным — нет', async () => {
    const admin = await client('admin@x.pl'), ivan = await client('ivan@x.pl');
    assert.equal(await admin.isAdmin('Admin@X.pl'), true);
    assert.equal(await ivan.isAdmin('ivan@x.pl'), false);
    assert.equal(await ivan.isAdmin('admin@x.pl'), false, 'чужую запись не прочитать: считается «не админ»');
    const all = await admin.allSpaces();
    assert.deepEqual(all.map((x) => x.id).sort(), ['closed', 'sp1']);
    assert.equal(all.find((x) => x.id === 'closed').settings.preachersSeeAll, false);
    await assert.rejects(ivan.allSpaces(), (e) => /permission-denied/.test(e.code));
    assert.deepEqual(await admin.spacesOf('admin@x.pl'), []);
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
    // в списке — сводки: без слайдов, с их числом
    const one = items.find((x) => x.id === 'new1');
    assert.equal(one.summary, true);
    assert.equal(one.slides, 1);   // заставка не в счёт (этап 7.7)
    assert.equal(one.blocks, undefined);
    assert.equal(one.meta.title, 'Вера');
    assert.equal(one.cloudOwner, 'ivan@x.pl');
  });
  test('в закрытом пространстве проповедник спрашивает только свои; общий запрос база отклоняет', async () => {
    const ivan = await client('ivan@x.pl'), petr = await client('petr@x.pl');
    await ivan.save('closed', sermon('c-ivan', 'Иванова закрытая'), me('ivan@x.pl'));
    await petr.save('closed', sermon('c-petr', 'Петрова закрытая'), me('petr@x.pl'));
    const mine = await firstList(ivan, 'closed', 'ivan@x.pl');
    assert.ok(mine.some((x) => x.id === 'c-ivan'));
    assert.ok(mine.every((x) => x.cloudOwner === 'ivan@x.pl'), 'чужих проповедей в списке нет');
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

describe('сводки (этап 8)', () => {
  /* Сводка в обход правил (withSecurityRulesDisabled сам ничего не возвращает — результат через переменную) */
  const summary = async (id, space = 'sp1') => {
    let out = null;
    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await F.getDoc(F.doc(ctx.firestore(), 'spaces', space, 'summaries', id));
      out = snap.exists() ? snap.data() : null;
    });
    return out;
  };
  const withRef = (id, title, extra = {}) => sermon(id, title, {
    blocks: [{ id: 'b1', type: 'splash' }, { id: 'n', type: 'note', text: 'оператору' },
      { id: 'b2', type: 'scripture', items: [{ kind: 'scripture', ref: 'Ин. 3:16', verses: [] }, { kind: 'scripture', ref: 'Рим. 5:8', verses: [] }] }],
    ...extra,
  });
  test('summaryOf: число слайдов без заметок и заставок, места Писания, поля проповеди', () => {
    const d = summaryOf({ meta: { title: 'Т', date: '2026-11-15' }, blocks: withRef('x', 'Т').blocks, status: 'draft', owner: 'a@b.c', updatedAt: 5, updatedBy: 'a@b.c' });
    assert.deepEqual(d, { title: 'Т', date: '2026-11-15', firstName: '', lastName: '', status: 'draft', owner: 'a@b.c',
      updatedAt: 5, updatedBy: 'a@b.c', lock: null, slides: 1, refs: 'Ин. 3:16 · Рим. 5:8' });
    // этап 7.7: картинка, видео и свободный слайд (и «пришлю отдельно») считаются, заставка и заметка — нет
    const e = summaryOf({ meta: {}, blocks: [{ type: 'splash' }, { type: 'image', mode: 'send' }, { type: 'video' }, { type: 'free' }, { type: 'note' }, { type: 'thesis' }] });
    assert.equal(e.slides, 4);
  });
  test('сводка пишется с каждой записью и совпадает с проповедью; удаление убирает её', async () => {
    const ivan = await client('ivan@x.pl'), admin = await client('admin@x.pl');
    const a = await ivan.save('sp1', withRef('sm1', 'Сводка'), me('ivan@x.pl'));
    let s = await summary('sm1');
    assert.equal(s.title, 'Сводка');
    assert.equal(s.slides, 1);   // заставка и заметка — не в счёт (этап 7.7)
    assert.equal(s.refs, 'Ин. 3:16 · Рим. 5:8');
    assert.equal(s.updatedAt.toMillis(), a.cloudAt);
    // правка редактора меняет и сводку
    const b = await admin.save('sp1', withRef('sm1', 'Правка', { cloudAt: a.cloudAt }), me('admin@x.pl'), { status: 'work' });
    s = await summary('sm1');
    assert.equal(s.title, 'Правка');
    assert.equal(s.status, 'work');
    assert.equal(s.updatedBy, 'admin@x.pl');
    assert.equal(s.updatedAt.toMillis(), b.cloudAt);
    await admin.trash('sp1', 'sm1', me('admin@x.pl'));
    await admin.remove('sp1', 'sm1');
    assert.equal(await summary('sm1'), null);
  });
  test('замок попадает в сводку: взять, сигнал, отпустить; статус отдельно — тоже', async () => {
    const ivan = await client('ivan@x.pl');
    await ivan.save('sp1', sermon('sm2', 'Замок'), me('ivan@x.pl'));
    const r = await ivan.lock('sp1', 'sm2', me('ivan@x.pl'), 'Иван', { minutes: 10 });
    let s = await summary('sm2');
    assert.equal(s.lock.email, 'ivan@x.pl');
    assert.equal(s.lock.at.toMillis(), r.lock.at);
    const before = s.lock.beat.toMillis();
    await new Promise((res) => setTimeout(res, 20));
    await ivan.beat('sp1', 'sm2');
    s = await summary('sm2');
    assert.ok(s.lock.beat.toMillis() > before);
    assert.equal(s.lock.at.toMillis(), r.lock.at);
    await ivan.release('sp1', 'sm2', me('ivan@x.pl'), r.lock.at);
    s = await summary('sm2');
    assert.equal(s.lock, null);
    await ivan.setStatus('sp1', 'sm2', me('ivan@x.pl'), 'submitted');
    assert.equal((await summary('sm2')).status, 'submitted');
  });
  test('живой список видит замок чужой правки', async () => {
    const ivan = await client('ivan@x.pl'), petr = await client('petr@x.pl');
    await ivan.save('sp1', sermon('sm3', 'Живой замок'), me('ivan@x.pl'));
    const got = new Promise((res) => {
      const off = petr.listen('sp1', null, (items) => {
        const x = items.find((i) => i.id === 'sm3');
        if (x && x.lock && x.lock.email === 'ivan@x.pl') { off(); res(x); }
      }, () => {});
    });
    await ivan.lock('sp1', 'sm3', me('ivan@x.pl'), 'Иван', { minutes: 10 });
    const x = await got;
    assert.equal(x.lock.name, 'Иван');
  });
  test('автор в закрытом пространстве: новая проповедь со сводкой, список своих сводок', async () => {
    const ivan = await client('ivan@x.pl');
    await ivan.save('closed', sermon('sm4', 'Закрытая'), me('ivan@x.pl'));
    assert.equal((await summary('sm4', 'closed')).owner, 'ivan@x.pl');
  });
});

describe('корзина (этап 9.1)', () => {
  /* прочитать документ в обход правил (withSecurityRulesDisabled сам ничего не возвращает) */
  const raw = async (path) => {
    let out = null;
    await env.withSecurityRulesDisabled(async (ctx) => { const x = await F.getDoc(F.doc(ctx.firestore(), path)); out = x.exists() ? x.data() : null; });
    return out;
  };
  const summary = (id) => raw('spaces/sp1/summaries/' + id);
  test('в корзину и обратно: пометки в проповеди и сводке, список их видит', async () => {
    const ivan = await client('ivan@x.pl'), petr = await client('petr@x.pl');
    await ivan.save('sp1', sermon('tr1', 'В корзину'), me('ivan@x.pl'));
    const seen = new Promise((res) => {
      const off = petr.listen('sp1', null, (items) => { const x = items.find((i) => i.id === 'tr1'); if (x && x.deletedAt) { off(); res(x); } }, () => {});
    });
    const r = await ivan.trash('sp1', 'tr1', me('ivan@x.pl'));
    assert.equal(r.shareKey, '');
    const row = await seen;
    assert.equal(row.deletedBy, 'ivan@x.pl');
    assert.ok(row.deletedAt > 0);
    const got = await ivan.get('sp1', 'tr1');
    assert.ok(got.deletedAt > 0);
    assert.equal(got.deletedBy, 'ivan@x.pl');
    const s = await summary('tr1');
    assert.equal(s.deletedBy, 'ivan@x.pl');
    assert.equal(s.deletedAt.toMillis(), got.deletedAt);
    // в корзине не правится и не запирается
    await assert.rejects(ivan.save('sp1', Object.assign(sermon('tr1', 'Правка'), { cloudAt: got.cloudAt }), me('ivan@x.pl')), (e) => e.code === 'trashed');
    await assert.rejects(ivan.lock('sp1', 'tr1', me('ivan@x.pl'), 'Иван', { minutes: 10 }), (e) => e.code === 'trashed');
    await assert.rejects(ivan.save('sp1', sermon('tr1', 'Как новая'), me('ivan@x.pl')), (e) => e.code === 'trashed');
    // второй раз в корзину — ничего не делает
    await ivan.trash('sp1', 'tr1', me('ivan@x.pl'));
    const back = await ivan.restore('sp1', 'tr1');
    assert.equal(back.deletedAt, 0);
    assert.equal(back.cloudAt, got.cloudAt, 'время правки не меняется');
    const s2 = await summary('tr1');
    assert.equal(s2.deletedAt, undefined);
    assert.equal(s2.deletedBy, undefined);
    // снова правится
    await ivan.save('sp1', Object.assign(sermon('tr1', 'Снова'), { cloudAt: back.cloudAt }), me('ivan@x.pl'));
    assert.equal((await summary('tr1')).title, 'Снова');
  });
  test('свой замок снимается; под чужим живым — ошибка locked', async () => {
    const ivan = await client('ivan@x.pl'), admin = await client('admin@x.pl');
    await ivan.save('sp1', sermon('tr2', 'С замком'), me('ivan@x.pl'));
    await ivan.lock('sp1', 'tr2', me('ivan@x.pl'), 'Иван', { minutes: 10 });
    await assert.rejects(admin.trash('sp1', 'tr2', me('admin@x.pl'), { minutes: 10 }), (e) => e.code === 'locked' && e.lock.email === 'ivan@x.pl');
    assert.equal((await admin.get('sp1', 'tr2')).deletedAt, 0);
    await ivan.trash('sp1', 'tr2', me('ivan@x.pl'), { minutes: 10 });
    const d = await admin.get('sp1', 'tr2');
    assert.ok(d.deletedAt > 0);
    assert.equal(d.lock, null);
    assert.equal((await summary('tr2')).lock, null);
  });
  test('автор: в корзину и обратно только свой черновик; редактор — любой', async () => {
    const ivan = await client('ivan@x.pl'), admin = await client('admin@x.pl');
    await ivan.save('sp1', sermon('tr3', 'Готов'), me('ivan@x.pl'), { status: 'submitted' });
    await assert.rejects(ivan.trash('sp1', 'tr3', me('ivan@x.pl')), (e) => /permission-denied/.test(e.code));
    await admin.trash('sp1', 'tr3', me('admin@x.pl'));
    await assert.rejects(ivan.restore('sp1', 'tr3'), (e) => /permission-denied/.test(e.code));
    await assert.rejects(ivan.remove('sp1', 'tr3'), (e) => /permission-denied/.test(e.code));
    await admin.restore('sp1', 'tr3');
    assert.equal((await ivan.get('sp1', 'tr3')).deletedAt, 0);
  });
  test('ссылка для оператора: в корзине снимка нет, ключ остаётся; удалить насовсем — тоже без следа', async () => {
    const ivan = await client('ivan@x.pl');
    const key = 'tr'.repeat(12);
    await ivan.save('sp1', sermon('tr4', 'Со ссылкой'), me('ivan@x.pl'));
    await ivan.shareOn('sp1', 'tr4', me('ivan@x.pl'), key, { v: 1, title: 'Со ссылкой', blocks: [] });
    const r = await ivan.trash('sp1', 'tr4', me('ivan@x.pl'));
    assert.equal(r.shareKey, key);
    const share = async () => !!(await raw('shares/' + key));
    assert.equal(await share(), false);
    const back = await ivan.restore('sp1', 'tr4');
    assert.equal(back.cloudShare, key);
    // форма снова создаёт снимок под тем же ключом
    const on = await ivan.shareOn('sp1', 'tr4', me('ivan@x.pl'), 'zz'.repeat(12), { v: 1, title: 'Со ссылкой', blocks: [] });
    assert.equal(on.key, key);
    assert.equal(await share(), true);
    await ivan.trash('sp1', 'tr4', me('ivan@x.pl'));
    await ivan.remove('sp1', 'tr4');
    assert.equal(await share(), false);
    assert.equal(await ivan.get('sp1', 'tr4'), null);
    assert.equal(await summary('tr4'), null);
  });
  test('не из корзины насовсем не удаляется', async () => {
    const admin = await client('admin@x.pl');
    await admin.save('sp1', sermon('tr5', 'Живая'), me('admin@x.pl'));
    await assert.rejects(admin.remove('sp1', 'tr5'), (e) => /permission-denied/.test(e.code));
    assert.ok(await admin.get('sp1', 'tr5'));
  });
});

describe('удаление', () => {
  test('проповедник удаляет свой черновик, чужой — нет', async () => {
    const ivan = await client('ivan@x.pl'), petr = await client('petr@x.pl');
    await ivan.save('sp1', sermon('del1', 'Удаляемая'), me('ivan@x.pl'));
    await assert.rejects(petr.trash('sp1', 'del1', me('petr@x.pl')), (e) => /permission-denied/.test(e.code));
    await ivan.trash('sp1', 'del1', me('ivan@x.pl'));
    await assert.rejects(petr.remove('sp1', 'del1'), (e) => /permission-denied/.test(e.code));
    assert.ok(await ivan.get('sp1', 'del1'));
    await ivan.remove('sp1', 'del1');
    assert.equal(await ivan.get('sp1', 'del1'), null);
  });
  test('админ удаляет любую', async () => {
    const ivan = await client('ivan@x.pl'), admin = await client('admin@x.pl');
    await ivan.save('sp1', sermon('del2', 'Удаляемая 2'), me('ivan@x.pl'));
    await admin.trash('sp1', 'del2', me('admin@x.pl'));
    await admin.remove('sp1', 'del2');
    assert.equal(await admin.get('sp1', 'del2'), null);
  });
});

describe('замок и автосохранение (этап 6)', () => {
  const L = (at, extra = {}) => ({ name: 'Я', at, minutes: 10, ...extra });
  const ago = (min) => F.Timestamp.fromMillis(Date.now() - min * 60_000);
  /* Записать замок в обход правил: чужой, давний и т. п. */
  const putLock = (space, id, email, beatMinAgo) => env.withSecurityRulesDisabled((ctx) =>
    F.updateDoc(F.doc(ctx.firestore(), 'spaces', space, 'sermons', id), { lock: { email, name: email, at: ago(beatMinAgo + 1), beat: ago(beatMinAgo) } }));

  test('новая проповедь создаётся сразу с замком; запись под замком продлевает его, не меняя начала; release отпускает', async () => {
    const api = await client('ivan@x.pl');
    const a = await api.save('sp1', sermon('lk1', 'Раз'), me('ivan@x.pl'), { lock: L(0) });
    assert.equal(a.lock.email, 'ivan@x.pl');
    assert.ok(a.lock.at > 0 && a.lock.beat >= a.lock.at);
    await new Promise((r) => setTimeout(r, 20));
    const b = await api.save('sp1', sermon('lk1', 'Два', { cloudAt: a.cloudAt }), me('ivan@x.pl'), { lock: L(a.lock.at) });
    assert.equal(b.lock.at, a.lock.at, 'начало замка то же');
    assert.ok(b.lock.beat >= a.lock.beat);
    const c = await api.save('sp1', sermon('lk1', 'Три', { cloudAt: b.cloudAt }), me('ivan@x.pl'), { lock: L(a.lock.at, { release: true }) });
    assert.equal(c.lock, null);
    assert.equal(c.meta.title, 'Три');
  });

  test('взять, сигнал, отпустить; второй не берёт живой замок; редактор забирает; у первого — lost-lock, сигнал не проходит', async () => {
    const ivan = await client('ivan@x.pl'), petr = await client('petr@x.pl'), admin = await client('admin@x.pl');
    const a = await ivan.save('sp1', sermon('lk2', 'Иванова'), me('ivan@x.pl'));
    const l = await ivan.lock('sp1', 'lk2', me('ivan@x.pl'), 'Иван Петров', { minutes: 10 });
    assert.equal(l.lock.name, 'Иван Петров');
    await ivan.beat('sp1', 'lk2');
    // проповедник Пётр — не хозяин: база не пустит
    await assert.rejects(petr.lock('sp1', 'lk2', me('petr@x.pl'), 'Пётр', { minutes: 10 }));
    // админ без force — «занято», с force — забирает
    await assert.rejects(admin.lock('sp1', 'lk2', me('admin@x.pl'), 'Админ', { minutes: 10 }), (e) => e.code === 'locked' && e.lock.email === 'ivan@x.pl');
    const t = await admin.lock('sp1', 'lk2', me('admin@x.pl'), 'Админ', { minutes: 10, force: true });
    assert.equal(t.lock.email, 'admin@x.pl');
    assert.equal(t.cloudAt, a.cloudAt, 'забрать замок — не правка содержимого');
    await assert.rejects(ivan.save('sp1', sermon('lk2', 'Моё', { cloudAt: a.cloudAt }), me('ivan@x.pl'), { lock: L(l.lock.at) }),
      (e) => e.code === 'lost-lock' && e.lock.email === 'admin@x.pl' && e.remote.meta.title === 'Иванова');
    await assert.rejects(ivan.beat('sp1', 'lk2'), (e) => /permission-denied/.test(e.code));
    // отпустить чужой замок нельзя: release просто ничего не делает
    await ivan.release('sp1', 'lk2', me('ivan@x.pl'), l.lock.at);
    assert.equal((await ivan.get('sp1', 'lk2')).lock.email, 'admin@x.pl');
    await admin.release('sp1', 'lk2', me('admin@x.pl'), t.lock.at);
    assert.equal((await ivan.get('sp1', 'lk2')).lock, null);
  });

  test('та же почта из другой вкладки: без force — «занято», с force — новый замок; прежняя вкладка получает lost-lock', async () => {
    const tab1 = await client('ivan@x.pl'), tab2 = await client('ivan@x.pl');
    const a = await tab1.save('sp1', sermon('lk3', 'Вкладки'), me('ivan@x.pl'), { lock: L(0) });
    await assert.rejects(tab2.lock('sp1', 'lk3', me('ivan@x.pl'), 'Иван', { minutes: 10 }), (e) => e.code === 'locked');
    // перезагрузка той же вкладки (известен at): замок продолжается с тем же началом
    const same = await tab1.lock('sp1', 'lk3', me('ivan@x.pl'), 'Иван', { minutes: 10, at: a.lock.at });
    assert.equal(same.lock.at, a.lock.at);
    await new Promise((r) => setTimeout(r, 20));
    const b = await tab2.lock('sp1', 'lk3', me('ivan@x.pl'), 'Иван', { minutes: 10, force: true });
    assert.ok(b.lock.at > a.lock.at);
    await assert.rejects(tab1.save('sp1', sermon('lk3', 'Из первой', { cloudAt: a.cloudAt }), me('ivan@x.pl'), { lock: L(a.lock.at) }), (e) => e.code === 'lost-lock');
  });

  test('пока проповедь слушают, взятие замка и запись возвращают уже новую версию (не копию слушателя)', async () => {
    const api = await client('ivan@x.pl');
    const a = await api.save('sp1', sermon('lk9', 'Слушаю'), me('ivan@x.pl'), { lock: L(0) });
    await api.release('sp1', 'lk9', me('ivan@x.pl'), a.lock.at);
    const seen = [];
    const off = api.watch('sp1', 'lk9', (r) => seen.push(r));
    await new Promise((r) => setTimeout(r, 300));
    try {
      for (let i = 0; i < 5; i++) {
        const l = await api.lock('sp1', 'lk9', me('ivan@x.pl'), 'Иван', { minutes: 10, force: true });
        const db = (await api.get('sp1', 'lk9')).lock;
        assert.ok(l.lock && l.lock.at === db.at, 'замок из ответа — тот, что в базе');
        const s = await api.save('sp1', sermon('lk9', 'Слушаю ' + i, { cloudAt: (await api.get('sp1', 'lk9')).cloudAt }), me('ivan@x.pl'), { lock: L(l.lock.at) });
        assert.equal(s.meta.title, 'Слушаю ' + i, 'ответ на запись — с этой записью');
        await api.release('sp1', 'lk9', me('ivan@x.pl'), l.lock.at);
      }
    } finally { off(); }
  });

  test('своя запись, о которой форма не узнала (обрыв связи), — не конфликт, пока замок мой; чужая правка до замка — конфликт', async () => {
    const api = await client('ivan@x.pl');
    const a = await api.save('sp1', sermon('lk4', 'Раз'), me('ivan@x.pl'), { lock: L(0) });
    await api.save('sp1', sermon('lk4', 'Два', { cloudAt: a.cloudAt }), me('ivan@x.pl'), { lock: L(a.lock.at) });
    // форма не получила ответ на «Два» и шлёт «Три» со старой версией
    const c = await api.save('sp1', sermon('lk4', 'Три', { cloudAt: a.cloudAt }), me('ivan@x.pl'), { lock: L(a.lock.at) });
    assert.equal(c.meta.title, 'Три');
    // а правка, сделанная до того, как я взял замок, — конфликт
    const admin = await client('admin@x.pl');
    await api.release('sp1', 'lk4', me('ivan@x.pl'), a.lock.at);
    await admin.save('sp1', sermon('lk4', 'Админ', { cloudAt: c.cloudAt }), me('admin@x.pl'));
    const l = await api.lock('sp1', 'lk4', me('ivan@x.pl'), 'Иван', { minutes: 10 });
    await assert.rejects(api.save('sp1', sermon('lk4', 'Моё старое', { cloudAt: c.cloudAt }), me('ivan@x.pl'), { lock: L(l.lock.at) }),
      (e) => e.code === 'conflict' && e.remote.meta.title === 'Админ');
  });

  test('истёкший чужой замок: lock берёт его, save со свежей версией — тоже', async () => {
    const ivan = await client('ivan@x.pl'), admin = await client('admin@x.pl');
    const a = await ivan.save('sp1', sermon('lk5', 'Давно'), me('ivan@x.pl'));
    await putLock('sp1', 'lk5', 'admin@x.pl', 30);
    const l = await ivan.lock('sp1', 'lk5', me('ivan@x.pl'), 'Иван', { minutes: 10 });
    assert.equal(l.lock.email, 'ivan@x.pl');
    await putLock('sp1', 'lk5', 'admin@x.pl', 30);
    const b = await ivan.save('sp1', sermon('lk5', 'Под новым замком', { cloudAt: a.cloudAt }), me('ivan@x.pl'), { lock: L(l.lock.at) });
    assert.equal(b.lock.email, 'ivan@x.pl');
    assert.equal(b.meta.title, 'Под новым замком');
    await assert.rejects(admin.save('sp1', sermon('lk5', 'Админ', { cloudAt: b.cloudAt }), me('admin@x.pl'), { lock: L(0) }), (e) => e.code === 'lost-lock');
  });

  test('watch присылает правки и замок', async () => {
    const ivan = await client('ivan@x.pl'), admin = await client('admin@x.pl');
    const a = await ivan.save('sp1', sermon('lk6', 'Смотрим'), me('ivan@x.pl'));
    const seen = [];
    const done = new Promise((res, rej) => {
      const off = admin.watch('sp1', 'lk6', (d) => {
        seen.push(d);
        if (d && d.lock && d.lock.email === 'ivan@x.pl' && d.meta.title === 'Правка') { off(); res(); }
      }, rej);
    });
    await new Promise((r) => setTimeout(r, 300));
    const l = await ivan.lock('sp1', 'lk6', me('ivan@x.pl'), 'Иван', { minutes: 10 });
    await ivan.save('sp1', sermon('lk6', 'Правка', { cloudAt: a.cloudAt }), me('ivan@x.pl'), { lock: L(l.lock.at) });
    await done;
    assert.ok(seen.length >= 2);
  });
});

describe('работа редактора (этап 7)', () => {
  test('статус: спикер ставит «Готов» и «В работе» своей записью, чужая запись статус не трогает', async () => {
    const api = await client('ivan@x.pl');
    const a = await api.save('sp1', sermon('st1', 'Статус'), me('ivan@x.pl'), { status: 'draft' });
    assert.equal(a.cloudStatus, 'draft');
    const b = await api.save('sp1', sermon('st1', 'Статус', { cloudAt: a.cloudAt }), me('ivan@x.pl'), { status: 'submitted' });
    assert.equal(b.cloudStatus, 'submitted');
    const c = await api.save('sp1', sermon('st1', 'Статус 2', { cloudAt: b.cloudAt }), me('ivan@x.pl'), {});   // без status — прежний
    assert.equal(c.cloudStatus, 'submitted');
    const d = await api.save('sp1', sermon('st1', 'Статус 2', { cloudAt: c.cloudAt }), me('ivan@x.pl'), { status: 'draft' });
    assert.equal(d.cloudStatus, 'draft');
  });
  test('спикер не ставит «в работе» / «готово» старых статусов; редактор может любой из допустимых', async () => {
    const ivan = await client('ivan@x.pl');
    const a = await ivan.save('sp1', sermon('st2', 'Статус'), me('ivan@x.pl'), {});
    await assert.rejects(ivan.save('sp1', sermon('st2', 'Статус', { cloudAt: a.cloudAt }), me('ivan@x.pl'), { status: 'done' }), (e) => /permission-denied/.test(e.code));
    const admin = await client('admin@x.pl');
    const b = await admin.save('sp1', sermon('st2', 'Статус', { cloudAt: a.cloudAt }), me('admin@x.pl'), { status: 'submitted' });
    assert.equal(b.cloudStatus, 'submitted');
  });
  test('«доработать» и «готово» в документ проповеди не пишутся', async () => {
    const api = await client('admin@x.pl');
    const blocks = [{ id: 'b1', type: 'image', todo: true, done: false }, { id: 'b2', type: 'thesis', todo: false, done: true, text: 'x' }];
    const r = await api.save('sp1', sermon('st3', 'Без отметок', { blocks }), me('admin@x.pl'), {});
    const back = await api.get('sp1', 'st3');
    assert.equal(back.blocks.length, 2);
    assert.ok(back.blocks.every((b) => !('todo' in b) && !('done' in b)), JSON.stringify(back.blocks));
    assert.equal(r.blocks[1].text, 'x');
  });
  test('отметки редактора: пишет и читает редактор; спикер читает пустое, писать ему база не даёт; удаление проповеди убирает отметки', async () => {
    const admin = await client('admin@x.pl'), ivan = await client('ivan@x.pl');
    await admin.save('sp1', sermon('fl1', 'Отметки', { meta: { title: 'Отметки', firstName: 'Иван', lastName: 'Петров' } }), me('admin@x.pl'), {});
    assert.deepEqual(await admin.getFlags('sp1', 'fl1'), {});   // документа ещё нет
    const flags = { b1: { t: 1, s: 'abc' }, b2: { t: 0, s: 'xyz' } };
    await admin.setFlags('sp1', 'fl1', me('admin@x.pl'), flags);
    assert.deepEqual(await admin.getFlags('sp1', 'fl1'), flags);
    await admin.setFlags('sp1', 'fl1', me('admin@x.pl'), { b2: { t: 1, s: 'q' } });   // записывается набор целиком
    assert.deepEqual(await admin.getFlags('sp1', 'fl1'), { b2: { t: 1, s: 'q' } });
    assert.deepEqual(await ivan.getFlags('sp1', 'fl1'), {}, 'спикер отметок не читает');
    await assert.rejects(ivan.setFlags('sp1', 'fl1', me('ivan@x.pl'), { b1: { t: 1, s: 'z' } }), (e) => /permission-denied/.test(e.code));
    await admin.trash('sp1', 'fl1', me('admin@x.pl'));
    await admin.remove('sp1', 'fl1');
    assert.deepEqual(await admin.getFlags('sp1', 'fl1'), {});
  });
  test('отметки пишутся без замка, даже когда проповедь правит другой', async () => {
    const ivan = await client('ivan@x.pl'), admin = await client('admin@x.pl');
    const a = await ivan.save('sp1', sermon('fl2', 'Правит Иван'), me('ivan@x.pl'), { lock: { name: 'Иван', at: 0, minutes: 10 } });
    assert.equal(a.lock.email, 'ivan@x.pl');
    await admin.setFlags('sp1', 'fl2', me('admin@x.pl'), { b1: { t: 1, s: 's' } });
    assert.deepEqual(await admin.getFlags('sp1', 'fl2'), { b1: { t: 1, s: 's' } });
  });
});

describe('статус отдельно от содержимого (этап 7.2)', () => {
  test('спикер меняет статус своей без замка и под своим; под чужим живым — locked; содержимое не трогается', async () => {
    const ivan = await client('ivan@x.pl'), admin = await client('admin@x.pl');
    const a = await ivan.save('sp1', sermon('ss1', 'Статус'), me('ivan@x.pl'));
    const r = await ivan.setStatus('sp1', 'ss1', me('ivan@x.pl'), 'submitted');
    assert.equal(r.cloudStatus, 'submitted');
    assert.ok(r.cloudAt > a.cloudAt, 'новая версия');
    assert.equal(r.meta.title, 'Статус');
    assert.deepEqual(r.blocks, a.blocks);
    // под своим замком (правка открыта) — тоже можно, замок остаётся
    const l = await ivan.lock('sp1', 'ss1', me('ivan@x.pl'), 'Иван', { minutes: 10 });
    const r2 = await ivan.setStatus('sp1', 'ss1', me('ivan@x.pl'), 'draft', { minutes: 10 });
    assert.equal(r2.cloudStatus, 'draft');
    assert.equal(r2.lock.at, l.lock.at);
    // редактор под чужим живым замком статус не меняет
    await assert.rejects(admin.setStatus('sp1', 'ss1', me('admin@x.pl'), 'submitted', { minutes: 10 }), (e) => e.code === 'locked' && e.lock.email === 'ivan@x.pl');
    await ivan.release('sp1', 'ss1', me('ivan@x.pl'), l.lock.at);
    const r3 = await admin.setStatus('sp1', 'ss1', me('admin@x.pl'), 'submitted');
    assert.equal(r3.cloudStatus, 'submitted');
    assert.equal(r3.cloudBy, 'admin@x.pl');
  });
  test('чужую проповедь спикер не трогает, «done» спикеру нельзя', async () => {
    const ivan = await client('ivan@x.pl'), petr = await client('petr@x.pl');
    await ivan.save('sp1', sermon('ss2', 'Ивана'), me('ivan@x.pl'));
    await assert.rejects(petr.setStatus('sp1', 'ss2', me('petr@x.pl'), 'submitted'), (e) => /permission-denied/.test(e.code));
    await assert.rejects(ivan.setStatus('sp1', 'ss2', me('ivan@x.pl'), 'done'), (e) => /permission-denied/.test(e.code));
  });
});

describe('«У редактора» (этап 7.3)', () => {
  const L = (at, extra = {}) => ({ name: 'Я', at, minutes: 10, ...extra });
  test('редактор ставит «У редактора» правкой под замком; автор не берёт замок и не пишет; редактор вернул «Черновик» — автор правит', async () => {
    const ivan = await client('ivan@x.pl'), admin = await client('admin@x.pl');
    const a = await ivan.save('sp1', sermon('ue1', 'Автор'), me('ivan@x.pl'), { status: 'submitted' });
    // автор сам «У редактора» не ставит
    await assert.rejects(ivan.save('sp1', sermon('ue1', 'Автор', { cloudAt: a.cloudAt }), me('ivan@x.pl'), { status: 'work' }), (e) => /permission-denied/.test(e.code));
    const l = await admin.lock('sp1', 'ue1', me('admin@x.pl'), 'Админ', { minutes: 10 });
    const b = await admin.save('sp1', sermon('ue1', 'Правит редактор', { cloudAt: l.cloudAt }), me('admin@x.pl'), { status: 'work', lock: L(l.lock.at, { release: true }) });
    assert.equal(b.cloudStatus, 'work');
    assert.equal(b.lock, null);
    // замок свободен, но конспект у редактора: автору база не даёт ни замок, ни запись
    await assert.rejects(ivan.lock('sp1', 'ue1', me('ivan@x.pl'), 'Иван', { minutes: 10 }), (e) => /permission-denied/.test(e.code));
    await assert.rejects(ivan.save('sp1', sermon('ue1', 'Взлом', { cloudAt: b.cloudAt }), me('ivan@x.pl'), { status: 'draft', lock: L(0) }), (e) => /permission-denied/.test(e.code));
    assert.equal((await ivan.get('sp1', 'ue1')).meta.title, 'Правит редактор', 'смотреть автору можно');
    // редактор вернул «Черновик» — автор снова правит
    const c = await admin.save('sp1', sermon('ue1', 'Правит редактор', { cloudAt: b.cloudAt }), me('admin@x.pl'), { status: 'draft' });
    assert.equal(c.cloudStatus, 'draft');
    const l2 = await ivan.lock('sp1', 'ue1', me('ivan@x.pl'), 'Иван', { minutes: 10 });
    const d = await ivan.save('sp1', sermon('ue1', 'Снова автор', { cloudAt: l2.cloudAt }), me('ivan@x.pl'), { status: 'submitted', lock: L(l2.lock.at) });
    assert.equal(d.cloudStatus, 'submitted');
    assert.equal(d.meta.title, 'Снова автор');
  });
});

describe('настройки экрана человека (этап 7.2)', () => {
  test('пишет и читает сам человек, общие для всех пространств; чужие закрыты', async () => {
    const ivan = await client('Ivan@X.pl'), petr = await client('petr@x.pl');
    assert.equal(await ivan.getPrefs(me('ivan@x.pl')), null);
    const lay = { order: ['side', 'stage', 'film'], film: 240, side: 420 };
    await ivan.setPrefs(me('Ivan@X.pl'), lay);
    assert.deepEqual(await ivan.getPrefs(me('ivan@x.pl')), lay);
    await ivan.setPrefs(me('ivan@x.pl'), {});   // «Сбросить настройки экрана»
    assert.deepEqual(await ivan.getPrefs(me('ivan@x.pl')), {});
    await assert.rejects(petr.getPrefs(me('ivan@x.pl')), (e) => /permission-denied/.test(e.code));
    await assert.rejects(petr.setPrefs(me('ivan@x.pl'), lay), (e) => /permission-denied/.test(e.code));
  });
});

describe('настройки слайдов', () => {
  test('админ записывает, спикер читает и не может записать, изменения приходят вживую', async () => {
    const admin = await client('admin@x.pl'), ivan = await client('ivan@x.pl');
    assert.equal(await ivan.getSlides('sp1'), null);   // документа ещё нет
    const seen = [];
    const off = ivan.watchSlides('sp1', (c) => seen.push(c), (e) => seen.push('error ' + e.code));
    const cfg = { margins: { side: 70, top: 60, bottom: 60 }, kinds: { thesis: { size: 50.4, track: -0.04 } } };
    await admin.setSlides('sp1', me('admin@x.pl'), cfg);
    assert.deepEqual(await ivan.getSlides('sp1'), cfg);
    await assert.rejects(ivan.setSlides('sp1', me('ivan@x.pl'), { margins: { side: 0 } }), (e) => /permission-denied/.test(e.code));
    for (let i = 0; i < 40 && !seen.some((c) => c && c.margins && c.margins.side === 70); i++) await new Promise((r) => setTimeout(r, 100));
    off();
    assert.ok(seen.some((c) => c && c.margins && c.margins.side === 70), 'спикер получил новые настройки: ' + JSON.stringify(seen));
    assert.ok(!seen.some((c) => typeof c === 'string'), 'без ошибок');
  });
});

describe('форматы фона (этап 7.5)', () => {
  test('форматы лежат в настройках слайдов: пишут админ и редактор, автор только читает', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('spaces/sp1/members/red@x.pl').set({ email: 'red@x.pl', role: 'editor', firstName: 'Ред', lastName: 'Актор' });
    });
    const admin = await client('admin@x.pl'), red = await client('red@x.pl'), ivan = await client('ivan@x.pl');
    const bg = { stripesV: 100, stripesH: 0, spots: 0, shades: 3, color: '#2f6fd0', spread: 60, blur: 20, grain: 0, grainKind: 'fine', base: 10, vignette: 0, seed: 3 };
    // данные этапа 7.3 (фон bg) — форма переносит их в формат при чтении; в облаке лежат как есть
    await admin.setSlides('sp1', me('admin@x.pl'), { margins: { side: 60, top: 60, bottom: 60 }, bg });
    assert.deepEqual((await ivan.getSlides('sp1')).bg, bg);
    // редактор записывает форматы (в том числе формат с прежним фоном, bg: null) и формат по умолчанию
    const cfg = { margins: { side: 60, top: 60, bottom: 60 }, formats: { space: { name: 'Фон пространства', bg }, f1: { name: 'Копия', bg: null } }, defaultFormat: 'space' };
    await red.setSlides('sp1', me('red@x.pl'), cfg);
    const got = await ivan.getSlides('sp1');
    assert.deepEqual(got, cfg);
    assert.equal(got.bg, undefined, 'фон 7.3 после записи форматов больше не лежит');
    // автор форматы не меняет
    await assert.rejects(ivan.setSlides('sp1', me('ivan@x.pl'), Object.assign({}, cfg, { defaultFormat: 'system' })), (e) => /permission-denied/.test(e.code));
    // удалить формат по умолчанию — снова System Template
    await red.setSlides('sp1', me('red@x.pl'), { margins: cfg.margins, formats: { f1: cfg.formats.f1 }, defaultFormat: 'system' });
    assert.deepEqual(await admin.getSlides('sp1'), { margins: cfg.margins, formats: { f1: cfg.formats.f1 }, defaultFormat: 'system' });
  });
});

test('explain: понятные тексты для людей', () => {
  assert.match(explain({ code: 'resource-exhausted' }), /перегружено до 9:00/);
  assert.equal(explain({ code: 'conflict' }), 'conflict');
  assert.match(explain({ code: 'permission-denied' }), /Нет прав/);
  assert.match(explain({ code: 'unavailable' }), /Нет связи/);
  assert.equal(explain({ code: 'auth/popup-closed-by-user' }), '');
  assert.match(explain({ code: 'auth/popup-blocked' }), /заблокировал/);
});

describe('ссылка для оператора (этап 9)', () => {
  const KEY = (c) => c.repeat(24);
  const snap = (title) => ({ v: 1, title, date: '2026-11-15', author: 'Иван Петров', total: 1, blocks: [{ t: 'thesis', n: 1, html: 'Тезис' }] });
  /* прочитать документ в обход правил */
  const raw = async (path) => {
    let out = null;
    await env.withSecurityRulesDisabled(async (ctx) => { const s = await F.getDoc(F.doc(ctx.firestore(), path)); out = s.exists() ? s.data() : null; });
    return out;
  };
  const save = (api, who, id, title, opts) => api.save('sp1', sermon(id, title), me(who), opts);

  test('автор создаёт ссылку: снимок читает кто угодно без входа, ключ — в конспекте и в сводке время правки', async () => {
    const ivan = await client('ivan@x.pl'), anon = await client(null);
    const a = await save(ivan, 'ivan@x.pl', 'op1', 'Со ссылкой');
    const r = await ivan.shareOn('sp1', 'op1', me('ivan@x.pl'), KEY('a'), snap('Со ссылкой'));
    assert.equal(r.key, KEY('a'));
    assert.equal(r.remote.cloudShare, KEY('a'));
    assert.ok(r.remote.cloudAt > a.cloudAt, 'запись ключа — новая версия конспекта');
    const sh = await raw('shares/' + KEY('a'));
    assert.equal(sh.spaceId, 'sp1'); assert.equal(sh.sermonId, 'op1'); assert.equal(sh.createdBy, 'ivan@x.pl');
    assert.equal(sh.sermon.title, 'Со ссылкой');
    const s = await raw('spaces/sp1/summaries/op1');
    assert.equal(s.updatedAt.toMillis(), r.remote.cloudAt);   // сводка совпадает с конспектом, правила это проверяют
    // без входа снимок читается
    const got = await new Promise((res, rej) => { const off = anon.watchShare(KEY('a'), (d) => { off(); res(d); }, rej); });
    assert.equal(got.sermon.title, 'Со ссылкой'); assert.ok(got.updatedAt > 0);
    // и ничего другого без входа не прочитать
    await assert.rejects(anon.get('sp1', 'op1'), (e) => /permission-denied/.test(e.code));
  });
  test('повторное нажатие даёт ту же ссылку и не меняет конспект, а снимок обновляет', async () => {
    const ivan = await client('ivan@x.pl');
    await save(ivan, 'ivan@x.pl', 'op2', 'Повтор');
    const a = await ivan.shareOn('sp1', 'op2', me('ivan@x.pl'), KEY('b'), snap('Повтор'));
    const b = await ivan.shareOn('sp1', 'op2', me('ivan@x.pl'), KEY('z'), snap('Повтор 2'));
    assert.equal(b.key, KEY('b'));
    assert.equal(b.remote.cloudAt, a.remote.cloudAt, 'конспект при этом не записывается');
    assert.equal((await raw('shares/' + KEY('b'))).sermon.title, 'Повтор 2');
    assert.equal(await raw('shares/' + KEY('z')), null);
  });
  test('если снимок пропал, а ключ остался, повторное нажатие создаёт его заново под тем же ключом', async () => {
    const ivan = await client('ivan@x.pl');
    await save(ivan, 'ivan@x.pl', 'op3', 'Потерянный снимок');
    await ivan.shareOn('sp1', 'op3', me('ivan@x.pl'), KEY('c'), snap('Потерянный снимок'));
    await env.withSecurityRulesDisabled(async (ctx) => { await F.deleteDoc(F.doc(ctx.firestore(), 'shares/' + KEY('c'))); });
    const r = await ivan.shareOn('sp1', 'op3', me('ivan@x.pl'), KEY('y'), snap('Потерянный снимок'));
    assert.equal(r.key, KEY('c'));
    assert.equal((await raw('shares/' + KEY('c'))).sermon.title, 'Потерянный снимок');
  });
  test('чужой автор ссылку не делает, редактор и админ — любому конспекту', async () => {
    const ivan = await client('ivan@x.pl'), petr = await client('petr@x.pl'), admin = await client('admin@x.pl'), anon = await client(null);
    await save(ivan, 'ivan@x.pl', 'op4', 'Ивана');
    await assert.rejects(petr.shareOn('sp1', 'op4', me('petr@x.pl'), KEY('d'), snap('x')), (e) => /permission-denied/.test(e.code));
    await assert.rejects(anon.shareOn('sp1', 'op4', me('x@x.pl'), KEY('d'), snap('x')), (e) => /permission-denied/.test(e.code));
    assert.equal(await raw('shares/' + KEY('d')), null);
    const r = await admin.shareOn('sp1', 'op4', me('admin@x.pl'), KEY('e'), snap('Ивана'));
    assert.equal(r.key, KEY('e'));
    assert.equal((await raw('shares/' + KEY('e'))).createdBy, 'admin@x.pl');
  });
  test('«У редактора»: автор новую ссылку не делает и ссылку не отключает; редактор — да', async () => {
    const ivan = await client('ivan@x.pl'), admin = await client('admin@x.pl');
    await save(ivan, 'ivan@x.pl', 'op5', 'У редактора');
    await ivan.shareOn('sp1', 'op5', me('ivan@x.pl'), KEY('f'), snap('У редактора'));
    await save(ivan, 'ivan@x.pl', 'op5b', 'У редактора без ссылки');
    await admin.setStatus('sp1', 'op5', me('admin@x.pl'), 'work');
    await admin.setStatus('sp1', 'op5b', me('admin@x.pl'), 'work');
    // запись конспекта автору закрыта: новую ссылку он не сделает, и ключ у конспекта не сотрёт
    await assert.rejects(ivan.shareOn('sp1', 'op5b', me('ivan@x.pl'), KEY('g'), snap('x')), (e) => /permission-denied/.test(e.code));
    assert.equal(await raw('shares/' + KEY('g')), null, 'снимок без ссылки в конспекте не появляется');
    await assert.rejects(ivan.shareOff('sp1', 'op5', me('ivan@x.pl')), (e) => /permission-denied/.test(e.code));
    assert.equal((await raw('spaces/sp1/sermons/op5')).shareKey, KEY('f'));
    // (форма автору в этом случае кнопку не показывает) ключ остался, снимок успел уйти — редактор спокойно доводит отключение до конца
    await admin.shareOff('sp1', 'op5', me('admin@x.pl'));
    assert.equal(await raw('shares/' + KEY('f')), null);
    assert.equal((await raw('spaces/sp1/sermons/op5')).shareKey, undefined);
    const r = await admin.shareOn('sp1', 'op5b', me('admin@x.pl'), KEY('g'), snap('У редактора без ссылки'));
    assert.equal(r.key, KEY('g'));
  });
  test('под чужим живым замком ссылку не создать и не отключить (locked), под своим — можно, замок остаётся', async () => {
    const ivan = await client('ivan@x.pl'), admin = await client('admin@x.pl');
    await save(ivan, 'ivan@x.pl', 'op6', 'Замок');
    const l = await ivan.lock('sp1', 'op6', me('ivan@x.pl'), 'Иван', { minutes: 10 });
    await assert.rejects(admin.shareOn('sp1', 'op6', me('admin@x.pl'), KEY('h'), snap('x'), { minutes: 10 }), (e) => e.code === 'locked' && e.lock.email === 'ivan@x.pl');
    assert.equal(await raw('shares/' + KEY('h')), null);
    const r = await ivan.shareOn('sp1', 'op6', me('ivan@x.pl'), KEY('h'), snap('Замок'), { minutes: 10 });
    assert.equal(r.remote.lock.at, l.lock.at);
    // автор правит дальше: свою же запись ключа конспект-конфликтом не считает
    const next = await ivan.save('sp1', sermon('op6', 'Замок 2', { cloudAt: l.cloudAt }), me('ivan@x.pl'), { lock: { name: 'Иван', at: l.lock.at, minutes: 10 } });
    assert.equal(next.cloudShare, KEY('h'), 'ключ не стирается обычным сохранением');
    await assert.rejects(admin.shareOff('sp1', 'op6', me('admin@x.pl'), { minutes: 10 }), (e) => e.code === 'locked');
  });
  test('shareSync обновляет снимок: хозяин и редактор могут, чужой автор и аноним — нет', async () => {
    const ivan = await client('ivan@x.pl'), petr = await client('petr@x.pl'), admin = await client('admin@x.pl'), anon = await client(null);
    await save(ivan, 'ivan@x.pl', 'op7', 'Синхронизация');
    await ivan.shareOn('sp1', 'op7', me('ivan@x.pl'), KEY('i'), snap('Синхронизация'));
    const before = (await raw('shares/' + KEY('i'))).updatedAt.toMillis();
    await new Promise((res) => setTimeout(res, 20));
    await ivan.shareSync(KEY('i'), snap('Новое название'));
    const a = await raw('shares/' + KEY('i'));
    assert.equal(a.sermon.title, 'Новое название'); assert.ok(a.updatedAt.toMillis() > before);
    assert.equal(a.createdBy, 'ivan@x.pl');
    await admin.shareSync(KEY('i'), snap('От редактора'));
    assert.equal((await raw('shares/' + KEY('i'))).createdBy, 'ivan@x.pl', 'создатель не меняется');
    await assert.rejects(petr.shareSync(KEY('i'), snap('Чужое')), (e) => /permission-denied/.test(e.code));
    await assert.rejects(anon.shareSync(KEY('i'), snap('Чужое')), (e) => /permission-denied/.test(e.code));
    assert.equal((await raw('shares/' + KEY('i'))).sermon.title, 'От редактора');
    // снимка нет — запись не создаёт его «из воздуха»
    await assert.rejects(ivan.shareSync(KEY('q'), snap('x')));
  });
  test('отключить: снимок удаляется, ключ стирается, сводка совпадает; слушатель получает null; повторно — ничего не делает', async () => {
    const ivan = await client('ivan@x.pl'), anon = await client(null);
    await save(ivan, 'ivan@x.pl', 'op8', 'Отключение');
    await ivan.shareOn('sp1', 'op8', me('ivan@x.pl'), KEY('j'), snap('Отключение'));
    const seen = [];
    const gone = new Promise((res) => { const off = anon.watchShare(KEY('j'), (d) => { seen.push(d); if (!d) { off(); res(); } }, () => {}); });
    const r = await ivan.shareOff('sp1', 'op8', me('ivan@x.pl'));
    await gone;
    assert.equal(r.cloudShare, '');
    assert.equal(await raw('shares/' + KEY('j')), null);
    assert.equal((await raw('spaces/sp1/sermons/op8')).shareKey, undefined);
    assert.equal((await raw('spaces/sp1/summaries/op8')).updatedAt.toMillis(), r.cloudAt);
    assert.equal(seen[seen.length - 1], null);
    const again = await ivan.shareOff('sp1', 'op8', me('ivan@x.pl'));
    assert.equal(again.cloudAt, r.cloudAt);
    // потом можно сделать новую
    const n = await ivan.shareOn('sp1', 'op8', me('ivan@x.pl'), KEY('k'), snap('Отключение'));
    assert.equal(n.key, KEY('k'));
  });
  test('удаление конспекта убирает и ссылку; битый ключ удалению не мешает', async () => {
    const ivan = await client('ivan@x.pl');
    await save(ivan, 'ivan@x.pl', 'op9', 'Удаление');
    await ivan.shareOn('sp1', 'op9', me('ivan@x.pl'), KEY('l'), snap('Удаление'));
    await ivan.trash('sp1', 'op9', me('ivan@x.pl'));
    await ivan.remove('sp1', 'op9');
    assert.equal(await raw('shares/' + KEY('l')), null);
    assert.equal(await ivan.get('sp1', 'op9'), null);
    // ключ есть, снимка уже нет (его стёрли руками): конспект всё равно удаляется
    await save(ivan, 'ivan@x.pl', 'op10', 'Битый ключ');
    await ivan.shareOn('sp1', 'op10', me('ivan@x.pl'), KEY('m'), snap('Битый ключ'));
    await env.withSecurityRulesDisabled(async (ctx) => { await F.deleteDoc(F.doc(ctx.firestore(), 'shares/' + KEY('m'))); });
    await ivan.trash('sp1', 'op10', me('ivan@x.pl'));
    await ivan.remove('sp1', 'op10');
    assert.equal(await ivan.get('sp1', 'op10'), null);
  });
  test('конспект без ссылки удаляется, как раньше; чужой снимок при этом не трогается', async () => {
    const ivan = await client('ivan@x.pl'), admin = await client('admin@x.pl');
    await save(ivan, 'ivan@x.pl', 'op11', 'Без ссылки');
    await save(ivan, 'ivan@x.pl', 'op12', 'Другой');
    await ivan.shareOn('sp1', 'op12', me('ivan@x.pl'), KEY('n'), snap('Другой'));
    await ivan.trash('sp1', 'op11', me('ivan@x.pl'));
    await ivan.remove('sp1', 'op11');
    assert.ok(await raw('shares/' + KEY('n')));
    await admin.trash('sp1', 'op12', me('admin@x.pl'));
    await admin.remove('sp1', 'op12');
    assert.equal(await raw('shares/' + KEY('n')), null);
  });
});
