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

    run('restore.mjs', dir1, '--wipe');
    run('backup.mjs', dir2);
    assert.deepEqual(tree(dir2), first);

    const s = (await db.doc('spaces/b1/sermons/s1').get()).data();
    assert.ok(s.createdAt instanceof Timestamp);
    assert.deepEqual(s.weird, { $timestamp: 'не время' }, 'обычный объект с «$» не путается со временем');
    assert.equal(s.f, 2.5);
    assert.equal(s.blocks[0].parts[0].html, '<b>Ж</b>');
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
