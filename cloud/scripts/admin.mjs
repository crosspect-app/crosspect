// Служебные действия с пространствами — в обход правил, ключом сервисного аккаунта.
// Нужны, пока в форме нет настроек пространства (этап 9), и на случай, если
// в пространстве не осталось админа. Запускаются из приватного репозитория
// (workflow «Пространства»), чтобы почты не попадали в публичные логи.
//
//   node scripts/admin.mjs create-space --name "Słowo Wiary Poznań" --email a@b.c [--first Имя] [--last Фамилия] [--id свой-id]
//   node scripts/admin.mjs set-member --space <id> --email a@b.c --role admin|editor|preacher [--first Имя] [--last Фамилия]
//   node scripts/admin.mjs remove-member --space <id> --email a@b.c
//   node scripts/admin.mjs list
import { FieldValue } from 'firebase-admin/firestore';
import { connect, args, fail } from './lib.mjs';

const ROLES = ['admin', 'editor', 'preacher'];
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

if (cmd === 'create-space') {
  const name = opt('name');
  if (!name || name.length > 100) fail('Укажите --name (до 100 знаков)');
  const admin = email();
  const ref = opt('id') ? db.collection('spaces').doc(opt('id')) : db.collection('spaces').doc();
  const batch = db.batch();
  batch.create(ref, {
    name, settings: SPACE_DEFAULTS,
    createdAt: FieldValue.serverTimestamp(), createdBy: admin,
  });
  batch.create(ref.collection('members').doc(admin), {
    email: admin, role: 'admin', ...names(),
    addedBy: 'admin-script', addedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  console.log(`Пространство «${name}» создано: ${ref.id}. Админ: ${admin}`);
} else if (cmd === 'set-member') {
  const ref = await spaceRef();
  const e = email();
  const role = opt('role');
  if (!ROLES.includes(role)) fail(`Роль — одна из: ${ROLES.join(', ')}`);
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
} else if (cmd === 'list') {
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
  fail('Команда: create-space | set-member | remove-member | list (подробности в начале файла)');
}
