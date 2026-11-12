// Служебные действия с пространствами — в обход правил, ключом сервисного аккаунта.
// Нужны, пока в форме нет настроек пространства (этап 10). Запускаются из приватного
// репозитория (workflow «Пространства»), чтобы почты не попадали в публичные логи.
//
//   node scripts/admin.mjs create-space --name "Słowo Wiary Poznań" [--email редактор@почта] [--first Имя] [--last Фамилия] [--id свой-id]
//   node scripts/admin.mjs set-member --space <id> --email a@b.c --role editor|preacher [--first Имя] [--last Фамилия]
//   node scripts/admin.mjs remove-member --space <id> --email a@b.c
//   node scripts/admin.mjs set-admin --email a@b.c        админ всей формы (этап 8): видит все пространства
//   node scripts/admin.mjs remove-admin --email a@b.c
//   node scripts/admin.mjs migrate-8 [--email a@b.c]      перенос данных этапа 8 (можно запускать сколько угодно раз):
//                                                         роль admin у участников → editor, сводки для списка,
//                                                         --email — сразу сделать эту почту админом всей формы
//   node scripts/admin.mjs purge-trash [--days 30] [--dry-run]
//                                                         корзина (этап 9.1): стереть насовсем конспекты, которые лежат
//                                                         в корзине дольше --days дней (со сводкой, отметками редактора
//                                                         и снимком для оператора). Ночью — из crosspect-backup после копии
//   node scripts/admin.mjs list
import { FieldValue } from 'firebase-admin/firestore';
import { connect, args, fail } from './lib.mjs';
import { summaryOf } from '../../js/cloud-api.mjs';

const ROLES = ['editor', 'preacher'];   // роль admin у участника пространства убрана на этапе 8
const SPACE_DEFAULTS = { lockMinutes: 10, preachersSeeAll: true };

const a = args();
const cmd = a._[0];
const opt = (k) => (typeof a[k] === 'string' ? a[k].trim() : '');

function email() {
  const e = opt('email').toLowerCase();
  if (!/^[^@/ ]+@[^@/ ]+$/.test(e)) fail(`Неверная почта: «${opt('email')}»`);
  return e;
}
function names() {
  const out = {};
  if (opt('first')) out.firstName = opt('first');
  if (opt('last')) out.lastName = opt('last');
  return out;
}

const db = connect();

async function spaceRef() {
  const id = opt('space');
  if (!id) fail('Укажите --space <id пространства> (список: node scripts/admin.mjs list)');
  const ref = db.collection('spaces').doc(id);
  if (!(await ref.get()).exists) fail(`Пространства «${id}» нет`);
  return ref;
}
async function setAdmin(e) {
  const ref = db.collection('admins').doc(e);
  const old = await ref.get();
  if (!old.exists) await ref.set({ email: e, addedAt: FieldValue.serverTimestamp() });
  return !old.exists;
}

if (cmd === 'create-space') {
  const name = opt('name');
  if (!name || name.length > 100) fail('Укажите --name (до 100 знаков)');
  const ed = opt('email') ? email() : '';
  const ref = opt('id') ? db.collection('spaces').doc(opt('id')) : db.collection('spaces').doc();
  const batch = db.batch();
  batch.create(ref, {
    name, settings: SPACE_DEFAULTS,
    createdAt: FieldValue.serverTimestamp(), createdBy: 'admin-script',
  });
  if (ed) batch.create(ref.collection('members').doc(ed), {
    email: ed, role: 'editor', ...names(),
    addedBy: 'admin-script', addedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  console.log(`Пространство «${name}» создано: ${ref.id}.` + (ed ? ` Редактор: ${ed}` : ''));
} else if (cmd === 'set-member') {
  const ref = await spaceRef();
  const e = email();
  const role = opt('role');
  if (!ROLES.includes(role)) fail(`Роль — одна из: ${ROLES.join(', ')} (админ всей формы — команда set-admin)`);
  const m = ref.collection('members').doc(e);
  const old = await m.get();
  await m.set({
    email: e, role, ...names(),
    ...(old.exists ? {} : { addedBy: 'admin-script', addedAt: FieldValue.serverTimestamp() }),
  }, { merge: true });
  console.log(`${old.exists ? 'Изменён' : 'Добавлен'} участник ${e}: ${role}`);
} else if (cmd === 'remove-member') {
  const ref = await spaceRef();
  const e = email();
  const m = ref.collection('members').doc(e);
  if (!(await m.get()).exists) fail(`Участника ${e} нет`);
  await m.delete();
  console.log(`Участник ${e} удалён`);
} else if (cmd === 'set-admin') {
  const e = email();
  console.log((await setAdmin(e)) ? `${e} теперь админ всей формы` : `${e} уже админ`);
} else if (cmd === 'remove-admin') {
  const e = email();
  const ref = db.collection('admins').doc(e);
  if (!(await ref.get()).exists) fail(`${e} не админ`);
  await ref.delete();
  console.log(`${e} больше не админ`);
} else if (cmd === 'migrate-8') {
  if (opt('email')) {
    const e = email();
    console.log((await setAdmin(e)) ? `Админ всей формы: ${e}` : `Админ всей формы: ${e} (уже был)`);
  }
  let roles = 0, sums = 0, orphans = 0;
  for (const s of (await db.collection('spaces').get()).docs) {
    for (const m of (await s.ref.collection('members').where('role', '==', 'admin').get()).docs) {
      await m.ref.update({ role: 'editor' });
      roles++;
      console.log(`${s.id}: ${m.id} — роль admin → editor`);
    }
    const sermons = await s.ref.collection('sermons').get();
    const ids = new Set();
    let batch = db.batch(), n = 0;
    for (const d of sermons.docs) {
      ids.add(d.id);
      batch.set(s.ref.collection('summaries').doc(d.id), summaryOf(d.data()));
      sums++;
      if (++n === 400) { await batch.commit(); batch = db.batch(); n = 0; }
    }
    for (const d of (await s.ref.collection('summaries').get()).docs) {
      if (!ids.has(d.id)) { batch.delete(d.ref); orphans++; if (++n === 400) { await batch.commit(); batch = db.batch(); n = 0; } }
    }
    if (n) await batch.commit();
  }
  console.log(`Готово. Роль admin → editor: ${roles}; сводок записано: ${sums}; лишних сводок удалено: ${orphans}`);
} else if (cmd === 'purge-trash') {
  const days = opt('days') ? Number(opt('days')) : 30;
  if (!Number.isFinite(days) || days < 1 || days > 3650) fail('--days — число дней от 1 до 3650');
  const dry = !!a['dry-run'];
  const cutoff = new Date(Date.now() - days * 86400000);
  let gone = 0;
  for (const s of (await db.collection('spaces').get()).docs) {
    const old = await s.ref.collection('sermons').where('deletedAt', '<', cutoff).get();
    for (const d of old.docs) {
      const x = d.data(), when = x.deletedAt.toDate().toISOString().slice(0, 10);
      console.log(`${s.id}/${d.id} — в корзине с ${when}` + (dry ? ' (только проверка, не удалён)' : ''));
      if (dry) continue;
      if (typeof x.shareKey === 'string' && x.shareKey) await db.collection('shares').doc(x.shareKey).delete();   // нет снимка — delete и так ничего не делает
      const batch = db.batch();
      batch.delete(d.ref.collection('editor').doc('state'));
      batch.delete(s.ref.collection('summaries').doc(d.id));
      batch.delete(d.ref);
      await batch.commit();
      gone++;
    }
  }
  console.log(dry ? 'Проверка закончена, ничего не удалено' : `Корзина: удалено насовсем ${gone} (дольше ${days} дн.)`);
} else if (cmd === 'list') {
  const admins = await db.collection('admins').get();
  console.log('Админы всей формы: ' + (admins.empty ? 'нет' : admins.docs.map((d) => d.id).join(', ')));
  const spaces = await db.collection('spaces').get();
  if (spaces.empty) console.log('Пространств пока нет');
  for (const s of spaces.docs) {
    const members = await s.ref.collection('members').get();
    const sermons = await s.ref.collection('sermons').count().get();
    console.log(`\n${s.id} — ${s.get('name')} (проповедей: ${sermons.data().count})`);
    for (const m of members.docs) {
      const d = m.data();
      console.log(`  ${d.role.padEnd(8)} ${d.email}  ${[d.firstName, d.lastName].filter(Boolean).join(' ')}`);
    }
  }
} else {
  fail('Команда: create-space | set-member | remove-member | set-admin | remove-admin | migrate-8 | purge-trash | list (подробности в начале файла)');
}
