// Служебные скрипты в эмуляторе: пространства, бэкап и восстановление.
// Заодно проверяет, что записи скрипта проходят правила (админ может править пространство).
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { readFileSync as read } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';

const PROJECT = 'demo-crosspect';
const SCRIPTS = new URL('../scripts/', import.meta.url).pathname;
process.env.METADATA_SERVER_DETECTION = 'none';   // эмулятор: не искать облачные ключи
const run = (script, ...argv) => execFileSync('node', [join(SCRIPTS, script), ...argv], {
  encoding: 'utf8', env: { ...process.env, GCLOUD_PROJECT: PROJECT },
});

let env, db;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: read(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  await env.clearFirestore();
  db = getFirestore(initializeApp({ projectId: PROJECT }, 'scripts-test'));
});
after(async () => { await env?.cleanup(); });

// Все файлы папки: { 'spaces/x.json': '…' }
function tree(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[relative(dir, full)] = readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return out;
}

describe('пространства', () => {
  let spaceId;
  test('create-space заводит пространство (и редактора, если указана почта)', async () => {
    const out = run('admin.mjs', 'create-space', '--name', 'Słowo Wiary Poznań',
      '--email', 'Ed0@Example.com', '--first', 'Ред', '--last', 'Тестов');
    spaceId = /создано: (\S+)\./.exec(out)[1];
    assert.ok(spaceId.length >= 10, 'id пространства выдаёт база');
    const m = (await db.doc(`spaces/${spaceId}/members/ed0@example.com`).get()).data();
    assert.equal(m.role, 'editor');
    const bare = /создано: (\S+)\./.exec(run('admin.mjs', 'create-space', '--name', 'Без людей'))[1];
    assert.equal((await db.collection(`spaces/${bare}/members`).get()).size, 0);
  });
  test('set-admin: админ всей формы проходит правила, remove-admin снимает', async () => {
    run('admin.mjs', 'set-admin', '--email', 'Vitaly@Example.com');
    assert.ok((await db.doc('admins/vitaly@example.com').get()).exists);
    const fs = env.authenticatedContext('v', { email: 'vitaly@example.com', email_verified: true }).firestore();
    await assertSucceeds(getDoc(doc(fs, 'spaces', spaceId)));
    await assertSucceeds(updateDoc(doc(fs, 'spaces', spaceId), {
      'settings.lockMinutes': 15, updatedAt: serverTimestamp(), updatedBy: 'vitaly@example.com',
    }));
    // и может добавить участника сам
    await assertSucceeds(setDoc(doc(fs, 'spaces', spaceId, 'members', 'ivan@example.com'), {
      email: 'ivan@example.com', role: 'preacher', addedBy: 'vitaly@example.com', addedAt: serverTimestamp(),
    }));
    run('admin.mjs', 'set-admin', '--email', 'tmp@example.com');
    run('admin.mjs', 'remove-admin', '--email', 'tmp@example.com');
    assert.ok(!(await db.doc('admins/tmp@example.com').get()).exists);
    assert.throws(() => run('admin.mjs', 'remove-admin', '--email', 'tmp@example.com'));
  });
  test('set-member добавляет и меняет роль, remove-member удаляет', async () => {
    run('admin.mjs', 'set-member', '--space', spaceId, '--email', 'ed@example.com', '--role', 'editor', '--first', 'Ред');
    let m = (await db.doc(`spaces/${spaceId}/members/ed@example.com`).get()).data();
    assert.equal(m.role, 'editor');
    assert.equal(m.firstName, 'Ред');
    run('admin.mjs', 'set-member', '--space', spaceId, '--email', 'ed@example.com', '--role', 'preacher');
    m = (await db.doc(`spaces/${spaceId}/members/ed@example.com`).get()).data();
    assert.equal(m.role, 'preacher');
    assert.equal(m.firstName, 'Ред', 'имя не стирается');
    const fs = env.authenticatedContext('e', { email: 'ed@example.com', email_verified: true }).firestore();
    await assertSucceeds(getDoc(doc(fs, 'spaces', spaceId)));
    run('admin.mjs', 'remove-member', '--space', spaceId, '--email', 'ed@example.com');
    await assertFails(getDoc(doc(fs, 'spaces', spaceId)));
  });
  test('ошибки ввода не пишут в базу', () => {
    assert.throws(() => run('admin.mjs', 'set-member', '--space', spaceId, '--email', 'x@y.z', '--role', 'owner'));
    assert.throws(() => run('admin.mjs', 'set-member', '--space', spaceId, '--email', 'x@y.z', '--role', 'admin'));
    assert.throws(() => run('admin.mjs', 'set-member', '--space', 'nope', '--email', 'x@y.z', '--role', 'editor'));
    assert.throws(() => run('admin.mjs', 'create-space'));
    assert.throws(() => run('admin.mjs', 'set-admin', '--email', 'не почта'));
  });
  test('list показывает админов, пространства и участников', () => {
    const out = run('admin.mjs', 'list');
    assert.match(out, /Админы всей формы: vitaly@example\.com/);
    assert.match(out, /Słowo Wiary Poznań/);
    assert.match(out, /editor\s+ed0@example\.com/);
  });
  test('migrate-8: роль admin → editor, сводки проповедей, лишние сводки убраны; повтор ничего не ломает', async () => {
    await db.doc('spaces/m1').set({ name: 'Перенос', settings: {} });
    await db.doc('spaces/m1/members/old@example.com').set({ email: 'old@example.com', role: 'admin', firstName: 'Старый' });
    await db.doc('spaces/m1/members/pr@example.com').set({ email: 'pr@example.com', role: 'preacher' });
    await db.doc('spaces/m1/sermons/s1').set({
      v: 2, meta: { title: 'Вера', date: '2026-11-15', firstName: 'Иван', lastName: 'Петров' }, settings: {},
      blocks: [{ id: 'a', type: 'splash' }, { id: 'n', type: 'note' }, { id: 'b', type: 'scripture', items: [{ kind: 'scripture', ref: 'Ин. 3:16' }] }],
      status: 'submitted', owner: 'pr@example.com', createdBy: 'pr@example.com', createdAt: Timestamp.fromMillis(1000),
      updatedAt: Timestamp.fromMillis(2000), updatedBy: 'pr@example.com', lock: null,
    });
    await db.doc('spaces/m1/summaries/gone').set({ title: 'Удалённая' });
    for (let i = 0; i < 2; i++) {
      const out = run('admin.mjs', 'migrate-8', '--email', 'boss@example.com');
      assert.match(out, /Готово/);
    }
    assert.equal((await db.doc('spaces/m1/members/old@example.com').get()).data().role, 'editor');
    assert.equal((await db.doc('spaces/m1/members/old@example.com').get()).data().firstName, 'Старый');
    assert.equal((await db.doc('spaces/m1/members/pr@example.com').get()).data().role, 'preacher');
    assert.ok((await db.doc('admins/boss@example.com').get()).exists);
    const sm = (await db.doc('spaces/m1/summaries/s1').get()).data();
    assert.equal(sm.title, 'Вера');
    assert.equal(sm.slides, 1);   // заставка и заметка — не в счёт (этап 7.7): migrate-8 пересчитывает старые сводки
    assert.equal(sm.refs, 'Ин. 3:16');
    assert.equal(sm.updatedAt.toMillis(), 2000);
    assert.equal(sm.lock, null);
    assert.ok(!(await db.doc('spaces/m1/summaries/gone').get()).exists);
    // сводка из скрипта читается по правилам и обновляется формой вместе с проповедью
    const fs = env.authenticatedContext('p', { email: 'pr@example.com', email_verified: true }).firestore();
    await assertSucceeds(getDoc(doc(fs, 'spaces', 'm1', 'summaries', 's1')));
  });
});

describe('корзина (этап 9.1)', () => {
  test('purge-trash стирает то, что в корзине дольше срока, со сводкой, отметками, историей и снимком; остальное не трогает', async () => {
    const ago = (d) => Timestamp.fromMillis(Date.now() - d * 86400000);
    const sermon = (extra) => ({ v: 2, meta: { title: 'К' }, blocks: [], status: 'draft', owner: '', createdBy: 'x@y.z',
      createdAt: ago(60), updatedAt: ago(60), updatedBy: 'x@y.z', lock: null, ...extra });
    await db.doc('spaces/tp').set({ name: 'Корзина', settings: {} });
    await db.doc('spaces/tp/sermons/old').set(sermon({ deletedAt: ago(31), deletedBy: 'x@y.z', shareKey: 'q'.repeat(24) }));
    await db.doc('spaces/tp/summaries/old').set({ title: 'К' });
    await db.doc('spaces/tp/sermons/old/editor/state').set({ flags: {} });
    await db.doc('spaces/tp/sermons/old/versions/v1').set({ v: 2, meta: {}, blocks: [] });   // история сохранений (этап 9.7)
    const pic = (hours) => ({ img: Buffer.alloc(100, 1), w: 10, h: 10, updatedAt: Timestamp.fromMillis(Date.now() - hours * 3600000), updatedBy: 'x@y.z' });
    await db.doc('spaces/tp/sermons/old/slideImages/i1').set(pic(48));   // картинка слайда (этап 10.9.1) — уходит с конспектом
    await db.doc('shares/' + 'q'.repeat(24)).set({ spaceId: 'tp', sermonId: 'old', sermon: {} });
    await db.doc('spaces/tp/sermons/fresh').set(sermon({ deletedAt: ago(29), deletedBy: 'x@y.z' }));
    await db.doc('spaces/tp/sermons/live').set(sermon({ blocks: [{ id: 'b', type: 'image', mode: 'upload', imageId: 'used' },
      { id: 'c', type: 'image', mode: 'upload', layers: [{ kind: 'text', id: 't' }, { kind: 'pic', id: 'l1', imageId: 'inlayer1' }, { kind: 'pic', id: 'l2', imageId: 'inlayer2' }] }],   // этап 10.9.2: картинки списком
      settings: { customSplash: true, customSplashImage: { imageId: 'splashused', imgW: 10, imgH: 10 } } }));   // картинка своей заставки (этап 10.9.1.1) — в настройках конспекта
    await db.doc('spaces/tp/sermons/live/versions/v1').set({ v: 2, meta: {}, blocks: [{ id: 'b', type: 'image', imageId: 'inhistory' }] });
    await db.doc('spaces/tp/sermons/live/versions/v2').set({ v: 2, meta: {}, blocks: [], settings: { customSplashImage: { imageId: 'splashhist', imgW: 10, imgH: 10 } } });
    for (const id of ['used', 'inlayer1', 'inlayer2', 'inhistory', 'splashused', 'splashhist', 'orphan']) await db.doc('spaces/tp/sermons/live/slideImages/' + id).set(pic(48));
    await db.doc('spaces/tp/sermons/live/slideImages/justnow').set(pic(1));   // свежая: блок со ссылкой мог ещё не сохраниться
    await db.doc('spaces/tp/sermons/gone/slideImages/left').set(pic(48));     // конспекта уже нет, картинка осталась
    // проверка без удаления
    const dry = run('admin.mjs', 'purge-trash', '--dry-run');
    assert.match(dry, /tp\/old/);
    assert.doesNotMatch(dry, /fresh — |live — /);
    assert.match(dry, /Картинок без слайда: 3/);   // в проверке и картинка конспекта из корзины: сам конспект ещё не стёрт
    assert.ok((await db.doc('spaces/tp/sermons/old').get()).exists);
    assert.ok((await db.doc('spaces/tp/sermons/live/slideImages/orphan').get()).exists);
    const out = run('admin.mjs', 'purge-trash');
    assert.match(out, /удалено насовсем 1/);
    assert.match(out, /Картинок без слайда удалено: 2/);
    for (const p of ['spaces/tp/sermons/old', 'spaces/tp/summaries/old', 'spaces/tp/sermons/old/editor/state', 'spaces/tp/sermons/old/versions/v1',
      'spaces/tp/sermons/old/slideImages/i1', 'shares/' + 'q'.repeat(24), 'spaces/tp/sermons/live/slideImages/orphan', 'spaces/tp/sermons/gone/slideImages/left'])
      assert.equal((await db.doc(p).get()).exists, false, p);
    for (const id of ['used', 'inlayer1', 'inlayer2', 'inhistory', 'splashused', 'splashhist', 'justnow'])
      assert.ok((await db.doc('spaces/tp/sermons/live/slideImages/' + id).get()).exists, id);
    assert.ok((await db.doc('spaces/tp/sermons/fresh').get()).exists);
    assert.ok((await db.doc('spaces/tp/sermons/live').get()).exists);
    // свой срок
    run('admin.mjs', 'purge-trash', '--days', '28');
    assert.equal((await db.doc('spaces/tp/sermons/fresh').get()).exists, false);
    assert.throws(() => run('admin.mjs', 'purge-trash', '--days', '0'));
  });
  test('purge-trash стирает картинки фона заставки, на которые не ссылается ни одна серия (этап 10.9.3)', async () => {
    const pic = (hours) => ({ img: Buffer.alloc(100, 1), w: 10, h: 10, updatedAt: Timestamp.fromMillis(Date.now() - hours * 3600000), updatedBy: 'x@y.z' });
    await db.doc('spaces/ts').set({ name: 'Серии', settings: {} });
    await db.doc('spaces/ts/config/series').set({ series: {
      a: { name: 'А', active: true, format: '', splash: { mode: 'bg', imageId: 'sused', imgW: 10, imgH: 10, dim: 30 } },
      b: { name: 'Б', active: true, format: '' } }, updatedAt: Timestamp.now(), updatedBy: 'x@y.z' });
    for (const id of ['sused', 'sold']) await db.doc('spaces/ts/seriesImages/' + id).set(pic(48));
    await db.doc('spaces/ts/seriesImages/snow').set(pic(1));         // свежая: серию с ней ещё не сохранили
    await db.doc('spaces/tgone/seriesImages/sleft').set(pic(48));    // пространства уже нет, картинка осталась
    const dry = run('admin.mjs', 'purge-trash', '--dry-run');
    assert.match(dry, /Картинок фона без серии: 2/);
    assert.ok((await db.doc('spaces/ts/seriesImages/sold').get()).exists);
    const out = run('admin.mjs', 'purge-trash');
    assert.match(out, /Картинок фона без серии удалено: 2/);
    for (const p of ['spaces/ts/seriesImages/sold', 'spaces/tgone/seriesImages/sleft']) assert.equal((await db.doc(p).get()).exists, false, p);
    for (const p of ['spaces/ts/seriesImages/sused', 'spaces/ts/seriesImages/snow']) assert.ok((await db.doc(p).get()).exists, p);
  });
});

describe('бэкап и восстановление', () => {
  test('копия → очистка → восстановление → та же копия', async () => {
    // данные с особыми типами и вложенностью
    await db.doc('spaces/b1').set({ name: 'Копия', settings: { lockMinutes: 10 }, createdAt: new Timestamp(1700000000, 123456789) });
    await db.doc('spaces/b1/members/a@example.com').set({ email: 'a@example.com', role: 'admin' });
    await db.doc('spaces/b1/sermons/s1').set({
      v: 2, meta: { title: 'Вера «и» дела', date: '2026-11-15' }, status: 'draft', owner: '',
      blocks: [{ id: 'x', type: 'thesis', parts: [{ kind: 'text', html: '<b>Ж</b>', scale: 1.1 }] }, { id: 'y', type: 'splash' }],
      createdAt: FieldValue.serverTimestamp(), lock: null, weird: { $timestamp: 'не время' }, n: 3, f: 2.5,
    });
    await db.doc('spaces/b1/sermons/s1/editor/state').set({ flags: { x: { on: true } } });
    // картинка слайда (этап 10.9.1): большая — отдельным файлом, маленькие Bytes — в JSON, как прежде
    const webp = Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP', 'latin1'), Buffer.alloc(70000, 5)]);
    await db.doc('spaces/b1/sermons/s1/slideImages/p1').set({ img: webp, small: Buffer.alloc(10, 3), w: 10, h: 10 });
    // документ без полей, но с подколлекцией
    await db.doc('spaces/ghost/members/g@example.com').set({ email: 'g@example.com', role: 'admin' });
    await db.doc('shares/' + 'k'.repeat(24)).set({ spaceId: 'b1', sermonId: 's1', sermon: {} });

    const dir1 = mkdtempSync(join(tmpdir(), 'bk1-'));
    const dir2 = mkdtempSync(join(tmpdir(), 'bk2-'));
    run('backup.mjs', dir1);
    const first = tree(dir1);
    assert.ok(first['spaces/b1/sermons/s1.json'].includes('Вера «и» дела'));
    // Firestore хранит время до микросекунд
    assert.ok(first['spaces/b1.json'].includes('"$timestamp": "2023-11-14T22:13:20.123456000Z"'));
    assert.ok(existsSync(join(dir1, 'spaces/ghost/members/g@example.com.json')));
    assert.ok(!existsSync(join(dir1, 'spaces/ghost.json')), 'пустой документ не сохраняется');
    assert.deepEqual(readFileSync(join(dir1, 'spaces/b1/sermons/s1/slideImages/p1.img.webp')), webp);
    assert.ok(first['spaces/b1/sermons/s1/slideImages/p1.json'].includes('"img": {\n    "$file": "p1.img.webp"'));
    assert.ok(first['spaces/b1/sermons/s1/slideImages/p1.json'].includes('"$bytes"'));

    run('restore.mjs', dir1, '--wipe');
    run('backup.mjs', dir2);
    assert.deepEqual(tree(dir2), first);

    const s = (await db.doc('spaces/b1/sermons/s1').get()).data();
    assert.ok(s.createdAt instanceof Timestamp);
    assert.deepEqual(s.weird, { $timestamp: 'не время' }, 'обычный объект с «$» не путается со временем');
    assert.equal(s.f, 2.5);
    assert.equal(s.blocks[0].parts[0].html, '<b>Ж</b>');
    const p = (await db.doc('spaces/b1/sermons/s1/slideImages/p1').get()).data();
    assert.deepEqual(Buffer.from(p.img), webp);
    assert.deepEqual(Buffer.from(p.small), Buffer.alloc(10, 3));
  });
  test('без --wipe лишние документы остаются, удалённые возвращаются', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bk3-'));
    run('backup.mjs', dir);
    await db.doc('spaces/b1/sermons/s1').delete();
    await db.doc('spaces/b1/sermons/new').set({ v: 2 });
    run('restore.mjs', dir);
    assert.ok((await db.doc('spaces/b1/sermons/s1').get()).exists);
    assert.ok((await db.doc('spaces/b1/sermons/new').get()).exists);
  });
  test('удалённое из базы пропадает и из новой копии', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bk4-'));
    run('backup.mjs', dir);
    assert.ok(existsSync(join(dir, 'spaces/b1/sermons/new.json')));
    await db.doc('spaces/b1/sermons/new').delete();
    run('backup.mjs', dir);
    assert.ok(!existsSync(join(dir, 'spaces/b1/sermons/new.json')));
  });
});

describe('фотобанк: перенос из папки (этап 10.5.2)', () => {
  const REPO_BANK = new URL('../../img/authors/', import.meta.url).pathname;
  test('upload: фото этапа 10.5 из репозитория, правки authors/{id} переносятся, повторный запуск ничего не меняет', async () => {
    await db.doc('authors/calvin').set({ caption: 'реформатор · 1509–1564 (правка)', preset: { x: 0.3, y: 1, h: 0.9, side: 'left', filter: 'bw', mirror: true } });
    const out = run('photobank.mjs', 'upload', '--dir', REPO_BANK);
    assert.match(out, /Новых людей: 2, новых фото: 2/);
    const p = (await db.doc('bankPeople/calvin').get()).data();
    assert.equal(p.last, 'Кальвин'); assert.equal(p.caption, 'реформатор · 1509–1564 (правка)');
    const f = (await db.doc('bankPhotos/calvin').get()).data();
    assert.equal(f.person, 'calvin'); assert.equal(f.kind, 'cut'); assert.equal(f.faces, 'right'); assert.equal(f.order, 0);
    assert.deepEqual(f.preset, { x: 0.3, y: 1, h: 0.9, side: 'left', filter: 'bw', mirror: true });
    assert.ok(f.thumb.length > 1000 && f.thumb.length <= 40960);
    const img = (await db.doc('bankFiles/calvin').get()).data().img;
    assert.deepEqual(Buffer.from(img), readFileSync(join(REPO_BANK, 'calvin.webp')));   // картинка та же, id фото = старый id
    assert.ok(!(await db.doc('bankPhotos/luther').get()).data().preset);
    assert.match(run('photobank.mjs', 'upload', '--dir', REPO_BANK), /Новых людей: 0, новых фото: 0, заменено: 0, уже были: 2/);
    assert.match(run('photobank.mjs', 'list'), /Людей: 2, фото: 2/);
  });
});
