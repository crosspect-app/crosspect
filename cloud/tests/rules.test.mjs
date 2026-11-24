// Тесты правил Firestore (cloud/firestore.rules) в эмуляторе.
// Запуск: cd cloud && npm test (нужны Node 22 и Java 21; в CI — job «Правила Firestore»).
import { test, before, after, beforeEach, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, collectionGroup,
  query, where, serverTimestamp, writeBatch, Timestamp, runTransaction, deleteField, Bytes,
} from 'firebase/firestore';

const PROJECT = 'demo-crosspect';
let env;

// Пространство «sw»: проповедники видят всё. «closed»: только свои. «fast»: замок 1 минута.
// admin — админ всей формы (admins/{почта}, этап 8), ни в одном пространстве не участник.
// stranger — участник «other» со старой ролью admin: с этапа 8 это просто редактор «other».
const PEOPLE = {
  admin: 'admin@example.com',
  ed: 'ed@example.com',
  ivan: 'ivan@example.com',
  petr: 'petr@example.com',
  stranger: 'stranger@example.com',
};

const as = (who, extra = {}) =>
  env.authenticatedContext(who, { email: PEOPLE[who], email_verified: true, ...extra }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

const minutesAgo = (m) => Timestamp.fromMillis(Date.now() - m * 60_000);

function sermonData(owner, extra = {}) {
  return {
    v: 2,
    meta: { title: 'Вера', date: '2026-11-15', firstName: 'Иван', lastName: 'Петров' },
    settings: { lang: 'syn' },
    blocks: [{ id: 'b1', type: 'splash', speech: '' }],
    status: 'submitted',
    owner,
    createdBy: owner || PEOPLE.ed,
    createdAt: minutesAgo(60),
    updatedAt: minutesAgo(60),
    updatedBy: owner || PEOPLE.ed,
    lock: null,
    shareKey: null,
    ...extra,
  };
}

// Новая проповедь от имени who (как её будет писать форма)
function newSermon(who, extra = {}) {
  return {
    v: 2,
    meta: { title: 'Новая', date: '2026-11-22' },
    blocks: [],
    status: 'draft',
    owner: PEOPLE[who],
    createdBy: PEOPLE[who],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: PEOPLE[who],
    lock: null,
    ...extra,
  };
}

// Правка содержимого от имени who
const edit = (who, fields = {}) => ({
  'meta.title': 'Исправлено',
  updatedAt: serverTimestamp(),
  updatedBy: PEOPLE[who],
  ...fields,
});

const takeLock = (who, name = 'Кто-то') => ({
  lock: { email: PEOPLE[who], name, at: serverTimestamp(), beat: serverTimestamp() },
});

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const space = (id, settings) => setDoc(doc(db, 'spaces', id), {
      name: id, settings, createdAt: minutesAgo(1000), createdBy: 'script',
    });
    await space('sw', { lockMinutes: 10, preachersSeeAll: true });
    await space('closed', { lockMinutes: 10, preachersSeeAll: false });
    await space('fast', { lockMinutes: 1 });
    await space('other', {});

    const member = (s, who, role) => setDoc(doc(db, 'spaces', s, 'members', PEOPLE[who]), {
      email: PEOPLE[who], role, firstName: who, lastName: 'Тестов',
    });
    await setDoc(doc(db, 'admins', PEOPLE.admin), { email: PEOPLE.admin, addedAt: minutesAgo(1000) });
    for (const s of ['sw', 'closed', 'fast']) {
      await member(s, 'ed', 'editor');
      await member(s, 'ivan', 'preacher');
      await member(s, 'petr', 'preacher');
    }
    await member('other', 'stranger', 'admin');
    await setDoc(doc(db, 'spaces', 'other', 'sermons', 'o1'), sermonData(''));

    for (const s of ['sw', 'closed', 'fast']) {
      await setDoc(doc(db, 'spaces', s, 'sermons', 'ivan1'), sermonData(PEOPLE.ivan));
      await setDoc(doc(db, 'spaces', s, 'sermons', 'petr1'), sermonData(PEOPLE.petr, { status: 'draft' }));
      await setDoc(doc(db, 'spaces', s, 'sermons', 'guest'), sermonData(''));
      await setDoc(doc(db, 'spaces', s, 'sermons', 'ivan1', 'editor', 'state'), {
        flags: { b1: { on: true } }, updatedAt: minutesAgo(5), updatedBy: PEOPLE.ed,
      });
    }
    await setDoc(doc(db, 'shares', 'k'.repeat(24)), {
      spaceId: 'sw', sermonId: 'ivan1', sermon: { meta: {} }, createdBy: PEOPLE.ivan, updatedAt: minutesAgo(5),
    });
  });
}

// Поставить замок на проповедь в обход правил
async function setLock(s, id, who, beatMinutesAgo) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), 'spaces', s, 'sermons', id), {
      lock: { email: PEOPLE[who], name: who, at: minutesAgo(beatMinutesAgo + 1), beat: minutesAgo(beatMinutesAgo) },
    });
  });
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(process.env.RULES_FILE || new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seed(); });

const sermon = (db, s, id) => doc(db, 'spaces', s, 'sermons', id);

describe('вход', () => {
  test('без входа ничего не видно', async () => {
    const db = anon();
    await assertFails(getDoc(doc(db, 'spaces', 'sw')));
    await assertFails(getDoc(sermon(db, 'sw', 'ivan1')));
    await assertFails(getDocs(collection(db, 'spaces', 'sw', 'members')));
  });
  test('почта не подтверждена — как без входа', async () => {
    const db = as('ivan', { email_verified: false });
    await assertFails(getDoc(doc(db, 'spaces', 'sw')));
    await assertFails(getDoc(sermon(db, 'sw', 'ivan1')));
  });
  test('почта с заглавными буквами считается той же', async () => {
    const db = as('ivan', { email: 'Ivan@Example.com' });
    await assertSucceeds(getDoc(sermon(db, 'sw', 'ivan1')));
  });
  test('чужое пространство закрыто', async () => {
    const db = as('stranger');
    await assertFails(getDoc(doc(db, 'spaces', 'sw')));
    await assertFails(getDoc(sermon(db, 'sw', 'ivan1')));
    await assertFails(getDocs(collection(db, 'spaces', 'sw', 'sermons')));
    await assertFails(getDocs(collection(db, 'spaces', 'sw', 'members')));
    await assertFails(setDoc(sermon(db, 'sw', 'x'), newSermon('stranger')));
  });
});

describe('пространство', () => {
  test('участник читает; список всех пространств — только админу', async () => {
    await assertSucceeds(getDoc(doc(as('ivan'), 'spaces', 'sw')));
    const all = await assertSucceeds(getDocs(collection(as('admin'), 'spaces')));
    assertEqual(all.size, 4);
    await assertFails(getDocs(collection(as('ed'), 'spaces')));
    await assertFails(getDocs(collection(as('stranger'), 'spaces')));
  });
  test('правит только админ', async () => {
    const upd = (who, s = 'sw') => updateDoc(doc(as(who), 'spaces', s), {
      name: 'Słowo Wiary Poznań', 'settings.lockMinutes': 15, updatedAt: serverTimestamp(), updatedBy: PEOPLE[who],
    });
    await assertSucceeds(upd('admin'));
    await assertSucceeds(upd('admin', 'other'));
    await assertFails(upd('ed'));
    await assertFails(upd('ivan'));
    await assertFails(upd('stranger', 'other'));   // старая роль admin участника — уже не админ
  });
  test('неправильные настройки не записываются', async () => {
    const db = as('admin');
    const upd = (settings) => updateDoc(doc(db, 'spaces', 'sw'), {
      ...settings, updatedAt: serverTimestamp(), updatedBy: PEOPLE.admin,
    });
    await assertFails(upd({ 'settings.lockMinutes': 0 }));
    await assertFails(upd({ 'settings.lockMinutes': '10' }));
    await assertFails(upd({ 'settings.preachersSeeAll': 'yes' }));
    await assertFails(upd({ name: '' }));
    await assertFails(upd({ owner: 'x' }));
    await assertFails(updateDoc(doc(db, 'spaces', 'sw'), { name: 'Без отметки времени' }));
  });
  test('новое пространство заводит только админ, со временем сервера (этап 10)', async () => {
    const make = (who, extra = {}) => setDoc(doc(as(who), 'spaces', 'new'), {
      name: 'Новая', settings: { lockMinutes: 10 },
      createdAt: serverTimestamp(), createdBy: PEOPLE[who], updatedAt: serverTimestamp(), updatedBy: PEOPLE[who], ...extra,
    });
    await assertFails(setDoc(doc(as('admin'), 'spaces', 'new'), { name: 'Новая', settings: {} }));   // без отметок
    await assertFails(make('ed'));
    await assertFails(make('ivan'));
    await assertFails(make('stranger'));
    await assertFails(make('admin', { createdBy: PEOPLE.ed }));
    await assertFails(make('admin', { createdAt: minutesAgo(5) }));
    await assertFails(make('admin', { name: '' }));
    await assertFails(make('admin', { settings: { lockMinutes: 500 } }));
    await assertFails(make('admin', { owner: 'x' }));
    await assertSucceeds(make('admin'));
    // заведённое пространство админ видит и правит как остальные; участников в нём пока нет
    await assertSucceeds(getDoc(doc(as('admin'), 'spaces', 'new')));
    await assertFails(getDoc(doc(as('ed'), 'spaces', 'new')));
  });
  test('удаляет только админ — вместе с людьми, настройками и сводками (этап 10.1.2)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'spaces', 'empty'), { name: 'Пустое', settings: {} });
      await setDoc(doc(db, 'spaces', 'empty', 'members', PEOPLE.ed), { email: PEOPLE.ed, role: 'editor' });
      await setDoc(doc(db, 'spaces', 'empty', 'members', 'p-abc123'), { role: 'operator', firstName: 'Пётр', tg: 'petr_op' });
      await setDoc(doc(db, 'spaces', 'empty', 'config', 'series'), { series: {}, updatedAt: minutesAgo(1), updatedBy: PEOPLE.ed });
      await setDoc(doc(db, 'spaces', 'empty', 'config', 'operators'), { operators: {}, updatedAt: minutesAgo(1), updatedBy: PEOPLE.ed });
      await setDoc(doc(db, 'spaces', 'empty', 'summaries', 'gone'), { title: 'Старое' });
    });
    await assertFails(deleteDoc(doc(as('ed'), 'spaces', 'empty')));
    await assertFails(deleteDoc(doc(as('ed'), 'spaces', 'empty', 'config', 'series')));
    await assertFails(deleteDoc(doc(as('stranger'), 'spaces', 'other')));
    const db = as('admin'), b = writeBatch(db);
    b.delete(doc(db, 'spaces', 'empty', 'members', PEOPLE.ed));
    b.delete(doc(db, 'spaces', 'empty', 'members', 'p-abc123'));
    for (const c of ['slides', 'series', 'operators']) b.delete(doc(db, 'spaces', 'empty', 'config', c));
    b.delete(doc(db, 'spaces', 'empty', 'summaries', 'gone'));
    b.delete(doc(db, 'spaces', 'empty'));
    await assertSucceeds(b.commit());
  });
});

describe('участники', () => {
  test('участники видят список своего пространства', async () => {
    await assertSucceeds(getDocs(collection(as('ivan'), 'spaces', 'sw', 'members')));
  });
  test('свои пространства находятся по почте', async () => {
    const db = as('ivan');
    const snap = await assertSucceeds(getDocs(query(collectionGroup(db, 'members'), where('email', '==', PEOPLE.ivan))));
    assertEqual(snap.size, 3);
    await assertFails(getDocs(collectionGroup(db, 'members')));
    await assertFails(getDocs(query(collectionGroup(db, 'members'), where('email', '==', PEOPLE.petr))));
  });
  test('человек без пространства видит свою запись, когда его добавят', async () => {
    const db = as('stranger');
    await assertSucceeds(getDoc(doc(db, 'spaces', 'sw', 'members', PEOPLE.stranger)));
    await assertFails(getDoc(doc(db, 'spaces', 'sw', 'members', PEOPLE.ivan)));
  });
  test('добавляют админ и редактор (этап 10.1.2), автор — нет', async () => {
    const add = (who, email = 'new@example.com', extra = {}, s = 'sw') =>
      setDoc(doc(as(who), 'spaces', s, 'members', email), {
        email, role: 'preacher', firstName: 'Новый', lastName: 'Человек',
        addedBy: PEOPLE[who], addedAt: serverTimestamp(), ...extra,
      });
    await assertFails(add('ivan'));
    await assertFails(add('ed', 'x@example.com', {}, 'other'));   // редактор — только в своём пространстве
    await assertFails(add('admin', 'New@example.com'));
    await assertFails(add('admin', 'new@example.com', { email: 'other@example.com' }));
    await assertFails(add('admin', 'new@example.com', { role: 'owner' }));
    await assertFails(add('admin', 'new@example.com', { extra: 1 }));
    await assertFails(add('admin', 'not-an-email'));
    await assertFails(add('admin', 'new@example.com', { role: 'admin' }));   // роли admin у участника больше нет
    await assertFails(add('ed', 'new@example.com', { role: 'admin' }));      // и редактор админом не сделает
    await assertFails(add('ed', 'new@example.com', { addedBy: PEOPLE.admin }));
    await assertSucceeds(add('ed'));
    await assertSucceeds(add('admin', 'new2@example.com'));
    await assertSucceeds(setDoc(doc(as('admin'), 'spaces', 'other', 'members', 'new@example.com'), {
      email: 'new@example.com', role: 'editor', addedBy: PEOPLE.admin, addedAt: serverTimestamp(),
    }));
    // старая роль admin участника — это редактор: в своём пространстве добавляет
    await assertSucceeds(setDoc(doc(as('stranger'), 'spaces', 'other', 'members', 'x@example.com'), {
      email: 'x@example.com', role: 'preacher', addedBy: PEOPLE.stranger, addedAt: serverTimestamp(),
    }));
  });
  test('человек без почты (p-ключ) и оператор с Telegram (этап 10.1.2)', async () => {
    const put = (key, data, who = 'ed') => setDoc(doc(as(who), 'spaces', 'sw', 'members', key),
      { addedBy: PEOPLE[who], addedAt: serverTimestamp(), ...data });
    await assertSucceeds(put('p-abc123', { role: 'operator', firstName: 'Пётр', tg: 'petr_op' }));
    await assertSucceeds(put('p-guest42x', { role: 'preacher', firstName: 'Гость', lastName: 'Гостев' }));
    await assertSucceeds(put('tg@example.com', { email: 'tg@example.com', role: 'editor', tg: 'Ed_Tg1' }));
    await assertFails(put('p-abc124', { email: 'a@example.com', role: 'operator' }));   // с почтой ключ — почта
    await assertFails(put('P-ABC125', { role: 'operator' }));
    await assertFails(put('p-a', { role: 'operator' }));
    await assertFails(put('guest', { role: 'preacher' }));
    await assertFails(put('a@example.com', { role: 'preacher' }));   // ключ-почта без поля email
    for (const tg of ['@petr_op', 'abc', '1petr', 'petr op', 'x'.repeat(33), 5]) {
      await assertFails(put('p-tgbad1', { role: 'operator', tg }));
    }
    await assertFails(put('p-abc126', { role: 'operator' }, 'ivan'));
    // поправить, убрать Telegram, удалить
    const mine = doc(as('ed'), 'spaces', 'sw', 'members', 'p-abc123');
    await assertSucceeds(updateDoc(mine, { tg: 'petr_op2', lastName: 'Оператор' }));
    await assertSucceeds(updateDoc(mine, { tg: deleteField() }));
    await assertFails(updateDoc(mine, { tg: '@petr' }));
    await assertFails(updateDoc(mine, { email: 'p@example.com' }));   // почту не дописать: запись переносится на ключ-почту
    await assertSucceeds(deleteDoc(mine));
  });
  test('оператор с почтой в форму не входит', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'spaces', 'other', 'members', PEOPLE.petr), { email: PEOPLE.petr, role: 'operator' });
    });
    const db = as('petr');
    await assertSucceeds(getDoc(doc(db, 'spaces', 'other', 'members', PEOPLE.petr)));   // свою запись видит (так форма узнаёт, что доступа нет)
    await assertFails(getDoc(doc(db, 'spaces', 'other')));
    await assertFails(getDocs(collection(db, 'spaces', 'other', 'members')));
    await assertFails(getDoc(doc(db, 'spaces', 'other', 'sermons', 'o1')));
    await assertFails(updateDoc(doc(db, 'spaces', 'other', 'members', PEOPLE.petr), { seenAt: serverTimestamp() }));
  });
  test('роли «Claude User» больше нет (этап 10.5): записать её нельзя', async () => {
    const put = (key, data) => setDoc(doc(as('ed'), 'spaces', 'sw', 'members', key),
      { addedBy: PEOPLE.ed, addedAt: serverTimestamp(), ...data });
    await assertFails(put('p-claude1', { role: 'claude', firstName: 'Виталий', tg: 'vitaliy_b' }));
    await assertFails(updateDoc(doc(as('ed'), 'spaces', 'sw', 'members', PEOPLE.ivan), { role: 'claude' }));
    await assertSucceeds(put('p-oper01', { role: 'operator', firstName: 'Виталий', tg: 'vitaliy_b' }));
  });
  test('админ и редактор меняют роли и убирают людей; автор — нет', async () => {
    const db = as('admin');
    await assertSucceeds(updateDoc(doc(db, 'spaces', 'sw', 'members', PEOPLE.ivan), { role: 'editor' }));
    await assertFails(updateDoc(doc(db, 'spaces', 'sw', 'members', PEOPLE.ivan), { role: 'admin' }));
    await assertSucceeds(deleteDoc(doc(db, 'spaces', 'sw', 'members', PEOPLE.petr)));
    await assertSucceeds(updateDoc(doc(db, 'spaces', 'other', 'members', PEOPLE.stranger), { role: 'editor' }));
    const ed = as('ed');
    await assertSucceeds(updateDoc(doc(ed, 'spaces', 'closed', 'members', PEOPLE.ivan), { role: 'operator' }));
    await assertFails(updateDoc(doc(ed, 'spaces', 'closed', 'members', PEOPLE.ivan), { role: 'admin' }));
    await assertFails(updateDoc(doc(ed, 'spaces', 'closed', 'members', PEOPLE.ivan), { email: 'x@example.com' }));
    await assertSucceeds(deleteDoc(doc(ed, 'spaces', 'closed', 'members', PEOPLE.petr)));
    await assertFails(updateDoc(doc(ed, 'spaces', 'other', 'members', PEOPLE.stranger), { role: 'preacher' }));
    await assertFails(updateDoc(doc(as('ivan'), 'spaces', 'fast', 'members', PEOPLE.petr), { role: 'editor' }));
    await assertFails(deleteDoc(doc(as('ivan'), 'spaces', 'fast', 'members', PEOPLE.petr)));
  });
  test('старая роль admin участника — это редактор (этап 10.1.2): правит людей, админом себя не делает', async () => {
    const me = doc(as('stranger'), 'spaces', 'other', 'members', PEOPLE.stranger);
    await assertSucceeds(updateDoc(me, { firstName: 'Новое' }));
    await assertSucceeds(updateDoc(me, { role: 'editor' }));   // старую роль меняет на новую
    await assertFails(updateDoc(me, { role: 'admin' }));
  });
  test('последний вход (seenAt): ставит сам человек при каждом входе, время сервера; админ и редактор не подделывают', async () => {
    const mine = doc(as('ivan'), 'spaces', 'sw', 'members', PEOPLE.ivan);
    await assertFails(updateDoc(mine, { seenAt: minutesAgo(1) }));
    await assertFails(updateDoc(doc(as('ivan'), 'spaces', 'sw', 'members', PEOPLE.petr), { seenAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(mine, { seenAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(mine, { seenAt: serverTimestamp() }));   // и при следующем входе
    await assertSucceeds(updateDoc(doc(as('ed'), 'spaces', 'sw', 'members', PEOPLE.ed), { seenAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(as('stranger'), 'spaces', 'other', 'members', PEOPLE.stranger), { seenAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as('ed'), 'spaces', 'sw', 'members', PEOPLE.ivan), { seenAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(as('ed'), 'spaces', 'sw', 'members', PEOPLE.ivan), { firstName: 'Иоанн' }));
    await assertFails(updateDoc(mine, { seenAt: serverTimestamp(), role: 'editor' }));
    const adm = doc(as('admin'), 'spaces', 'sw', 'members', PEOPLE.ivan);
    await assertFails(updateDoc(adm, { seenAt: serverTimestamp() }));
    await assertFails(updateDoc(adm, { seenAt: deleteField() }));
    await assertSucceeds(updateDoc(adm, { firstName: 'Иоанн' }));   // seenAt остаётся как было
    // при добавлении «входил» не ставится
    await assertFails(setDoc(doc(as('admin'), 'spaces', 'sw', 'members', 'new@example.com'), {
      email: 'new@example.com', role: 'preacher', addedBy: PEOPLE.admin, addedAt: serverTimestamp(), seenAt: serverTimestamp(),
    }));
  });
  test('каждый правит своё имя, но не роль', async () => {
    const db = as('ivan');
    const me = doc(db, 'spaces', 'sw', 'members', PEOPLE.ivan);
    await assertSucceeds(updateDoc(me, { firstName: 'Иван', lastName: 'Иванов' }));
    await assertFails(updateDoc(me, { role: 'admin' }));
    await assertFails(updateDoc(doc(db, 'spaces', 'sw', 'members', PEOPLE.petr), { firstName: 'Пётр' }));
  });
});

describe('проповеди: чтение', () => {
  test('редактор и админ видят всё', async () => {
    for (const who of ['ed', 'admin']) {
      const db = as(who);
      await assertSucceeds(getDocs(collection(db, 'spaces', 'closed', 'sermons')));
      await assertSucceeds(getDoc(sermon(db, 'closed', 'petr1')));
    }
  });
  test('проповедник видит все проповеди, если пространство разрешает', async () => {
    const db = as('ivan');
    await assertSucceeds(getDoc(sermon(db, 'sw', 'petr1')));
    await assertSucceeds(getDocs(collection(db, 'spaces', 'sw', 'sermons')));
  });
  test('иначе — только свои', async () => {
    const db = as('ivan');
    await assertSucceeds(getDoc(sermon(db, 'closed', 'ivan1')));
    await assertFails(getDoc(sermon(db, 'closed', 'petr1')));
    await assertFails(getDocs(collection(db, 'spaces', 'closed', 'sermons')));
    await assertSucceeds(getDocs(query(collection(db, 'spaces', 'closed', 'sermons'), where('owner', '==', PEOPLE.ivan))));
  });
});

describe('проповеди: создание', () => {
  test('проповедник заводит свою', async () => {
    await assertSucceeds(setDoc(sermon(as('ivan'), 'sw', 'n1'), newSermon('ivan')));
    await assertSucceeds(setDoc(sermon(as('ivan'), 'sw', 'n2'), newSermon('ivan', { status: 'submitted' })));
  });
  test('проповедник не заводит чужую и не ставит «готово»', async () => {
    const db = as('ivan');
    await assertFails(setDoc(sermon(db, 'sw', 'n1'), newSermon('ivan', { owner: PEOPLE.petr })));
    await assertFails(setDoc(sermon(db, 'sw', 'n1'), newSermon('ivan', { status: 'done' })));
    await assertFails(setDoc(sermon(db, 'sw', 'n1'), newSermon('ivan', { status: 'work' })));
  });
  test('редактор заводит для кого угодно, в том числе для гостя', async () => {
    const db = as('ed');
    await assertSucceeds(setDoc(sermon(db, 'sw', 'n1'), newSermon('ed', { owner: PEOPLE.petr, status: 'work' })));
    await assertSucceeds(setDoc(sermon(db, 'sw', 'n2'), newSermon('ed', { owner: '' })));
  });
  test('время ставит сервер, лишние и пропущенные поля не проходят', async () => {
    const db = as('ivan');
    await assertFails(setDoc(sermon(db, 'sw', 'n1'), newSermon('ivan', { createdAt: minutesAgo(5) })));
    await assertFails(setDoc(sermon(db, 'sw', 'n1'), newSermon('ivan', { updatedAt: minutesAgo(5) })));
    await assertFails(setDoc(sermon(db, 'sw', 'n1'), newSermon('ivan', { createdBy: PEOPLE.petr })));
    await assertFails(setDoc(sermon(db, 'sw', 'n1'), newSermon('ivan', { hacked: true })));
    const { blocks, ...noBlocks } = newSermon('ivan');
    await assertFails(setDoc(sermon(db, 'sw', 'n1'), noBlocks));
    await assertFails(setDoc(sermon(db, 'sw', 'n1'), newSermon('ivan', { status: 'lost' })));
    await assertFails(setDoc(sermon(db, 'sw', 'n1'), newSermon('ivan', { shareKey: 12345 })));
    await assertFails(setDoc(sermon(db, 'sw', 'n1'), newSermon('ivan', { shareKey: 'k'.repeat(65) })));
    await assertSucceeds(setDoc(sermon(db, 'sw', 'n1'), newSermon('ivan', { shareKey: 'k'.repeat(24) })));
  });
  test('можно сразу взять замок на себя, но не на другого', async () => {
    const db = as('ivan');
    await assertSucceeds(setDoc(sermon(db, 'sw', 'n1'), newSermon('ivan', takeLock('ivan'))));
    await assertFails(setDoc(sermon(db, 'sw', 'n2'), newSermon('ivan', takeLock('petr'))));
  });
});

describe('проповеди: правка', () => {
  test('проповедник правит свою, но не чужую', async () => {
    const db = as('ivan');
    await assertSucceeds(updateDoc(sermon(db, 'sw', 'ivan1'), edit('ivan')));
    await assertFails(updateDoc(sermon(db, 'sw', 'petr1'), edit('ivan')));
    await assertFails(updateDoc(sermon(db, 'sw', 'guest'), edit('ivan')));
  });
  test('проповедник: подать можно, «в работе» и «готово» — нет, отдать другому — нет', async () => {
    const db = as('petr');
    await assertSucceeds(updateDoc(sermon(db, 'sw', 'petr1'), edit('petr', { status: 'submitted' })));
    await assertSucceeds(updateDoc(sermon(db, 'sw', 'petr1'), edit('petr', { status: 'draft' })));
    await assertFails(updateDoc(sermon(db, 'sw', 'petr1'), edit('petr', { status: 'done' })));
    await assertFails(updateDoc(sermon(db, 'sw', 'petr1'), edit('petr', { owner: PEOPLE.ivan })));
  });
  test('редактор правит любую, меняет статус и проповедника', async () => {
    const db = as('ed');
    await assertSucceeds(updateDoc(sermon(db, 'sw', 'ivan1'), edit('ed', { status: 'work' })));
    await assertSucceeds(updateDoc(sermon(db, 'sw', 'guest'), edit('ed', { owner: PEOPLE.petr })));
  });
  test('у правки отмечены время сервера и автор', async () => {
    const db = as('ivan');
    await assertFails(updateDoc(sermon(db, 'sw', 'ivan1'), { 'meta.title': 'Без отметок' }));
    await assertFails(updateDoc(sermon(db, 'sw', 'ivan1'), edit('ivan', { updatedAt: minutesAgo(1) })));
    await assertFails(updateDoc(sermon(db, 'sw', 'ivan1'), edit('ivan', { updatedBy: PEOPLE.petr })));
  });
  test('кто и когда создал — не меняется', async () => {
    const db = as('ed');
    await assertFails(updateDoc(sermon(db, 'sw', 'ivan1'), edit('ed', { createdBy: PEOPLE.ed })));
    await assertFails(updateDoc(sermon(db, 'sw', 'ivan1'), edit('ed', { createdAt: serverTimestamp() })));
  });
  test('бывший проповедник после смены роли теряет доступ к чужим', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'spaces', 'sw', 'members', PEOPLE.ivan));
    });
    await assertFails(getDoc(sermon(as('ivan'), 'sw', 'ivan1')));
    await assertFails(updateDoc(sermon(as('ivan'), 'sw', 'ivan1'), edit('ivan')));
  });
});

describe('статус отдельно от содержимого (этап 7.2)', () => {
  const st = (who, status, extra = {}) => ({ status, updatedAt: serverTimestamp(), updatedBy: PEOPLE[who], ...extra });
  test('спикер меняет статус своей проповеди, пока замок свободен или свой', async () => {
    const ref = sermon(as('petr'), 'sw', 'petr1');
    await assertSucceeds(updateDoc(ref, st('petr', 'submitted')));
    await assertSucceeds(updateDoc(ref, st('petr', 'draft')));
    await setLock('sw', 'petr1', 'petr', 1);
    await assertSucceeds(updateDoc(ref, st('petr', 'submitted')));
  });
  test('редактор меняет статус в любую сторону, под своим замком тоже', async () => {
    const ref = sermon(as('ed'), 'sw', 'ivan1');
    await assertSucceeds(updateDoc(ref, st('ed', 'draft')));
    await setLock('sw', 'ivan1', 'ed', 1);
    await assertSucceeds(updateDoc(ref, st('ed', 'submitted')));
  });
  test('под чужим живым замком статус не меняет никто; истёкший замок снимается вместе со статусом', async () => {
    await setLock('sw', 'petr1', 'ed', 2);
    await assertFails(updateDoc(sermon(as('petr'), 'sw', 'petr1'), st('petr', 'submitted')));
    await setLock('sw', 'ivan1', 'ivan', 2);
    await assertFails(updateDoc(sermon(as('ed'), 'sw', 'ivan1'), st('ed', 'draft')));
    await setLock('sw', 'petr1', 'ed', 11);
    await assertFails(updateDoc(sermon(as('petr'), 'sw', 'petr1'), st('petr', 'submitted')));
    await assertSucceeds(updateDoc(sermon(as('petr'), 'sw', 'petr1'), st('petr', 'submitted', { lock: null })));
  });
  test('без отметки времени и автора статус не меняется', async () => {
    await assertFails(updateDoc(sermon(as('petr'), 'sw', 'petr1'), { status: 'submitted' }));
  });
});

describe('«У редактора» (этап 7.3)', () => {
  const st = (who, status, extra = {}) => ({ status, updatedAt: serverTimestamp(), updatedBy: PEOPLE[who], ...extra });
  // поставить статус в обход правил
  async function setStatus(s, id, status) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'spaces', s, 'sermons', id), { status });
    });
  }
  test('автор сам «У редактора» не ставит — ни правкой, ни отдельно', async () => {
    const ref = sermon(as('petr'), 'sw', 'petr1');
    await assertFails(updateDoc(ref, st('petr', 'work')));
    await assertFails(updateDoc(ref, edit('petr', { status: 'work' })));
    await assertFails(setDoc(sermon(as('petr'), 'sw', 'new1'), newSermon('petr', { status: 'work' })));
  });
  test('пока конспект у редактора, автор его не правит, не берёт замок, не меняет статус и не удаляет', async () => {
    await setStatus('sw', 'petr1', 'work');
    const ref = sermon(as('petr'), 'sw', 'petr1');
    await assertSucceeds(getDoc(ref));   // смотреть можно
    await assertFails(updateDoc(ref, edit('petr')));
    await assertFails(updateDoc(ref, takeLock('petr')));
    await assertFails(updateDoc(ref, st('petr', 'draft')));
    await assertFails(updateDoc(ref, st('petr', 'submitted')));
    await assertFails(deleteDoc(ref));
  });
  test('старое «done» для автора — так же закрыто', async () => {
    await setStatus('sw', 'petr1', 'done');
    const ref = sermon(as('petr'), 'sw', 'petr1');
    await assertFails(updateDoc(ref, edit('petr')));
    await assertFails(updateDoc(ref, takeLock('petr')));
    await assertFails(updateDoc(ref, st('petr', 'draft')));
  });
  test('свой замок, взятый до «У редактора», автору тоже не помогает', async () => {
    await setLock('sw', 'petr1', 'petr', 1);
    await setStatus('sw', 'petr1', 'work');
    const ref = sermon(as('petr'), 'sw', 'petr1');
    await assertFails(updateDoc(ref, edit('petr')));
    await assertFails(updateDoc(ref, { 'lock.beat': serverTimestamp() }));
  });
  test('редактор ставит «У редактора» и правит; вернул «Черновик» — автор снова правит', async () => {
    const edRef = sermon(as('ed'), 'sw', 'petr1');
    await assertSucceeds(updateDoc(edRef, takeLock('ed', 'Редактор')));
    await assertSucceeds(updateDoc(edRef, edit('ed', { status: 'work' })));
    await assertSucceeds(updateDoc(edRef, edit('ed', { 'meta.title': 'Правит редактор' })));
    await assertSucceeds(updateDoc(edRef, edit('ed', { status: 'draft', lock: null })));
    const ref = sermon(as('petr'), 'sw', 'petr1');
    await assertSucceeds(updateDoc(ref, takeLock('petr')));
    await assertSucceeds(updateDoc(ref, edit('petr', { status: 'submitted' })));
  });
  test('админ тоже ставит и снимает «У редактора»', async () => {
    const ref = sermon(as('admin'), 'sw', 'ivan1');
    await assertSucceeds(updateDoc(ref, st('admin', 'work')));
    await assertSucceeds(updateDoc(ref, st('admin', 'draft')));
  });
});

describe('«Презентация готова» (этап 9.7)', () => {
  const st = (who, status, extra = {}) => ({ status, updatedAt: serverTimestamp(), updatedBy: PEOPLE[who], ...extra });
  async function setStatus(s, id, status) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'spaces', s, 'sermons', id), { status });
    });
  }
  test('автор сам не ставит — ни правкой, ни отдельно, ни при создании', async () => {
    const ref = sermon(as('petr'), 'sw', 'petr1');
    await assertFails(updateDoc(ref, st('petr', 'ready')));
    await assertFails(updateDoc(ref, edit('petr', { status: 'ready' })));
    await assertFails(setDoc(sermon(as('petr'), 'sw', 'new1'), newSermon('petr', { status: 'ready' })));
  });
  test('пока стоит, автор конспект не правит, не берёт замок, не меняет статус и не удаляет', async () => {
    await setStatus('sw', 'petr1', 'ready');
    const ref = sermon(as('petr'), 'sw', 'petr1');
    await assertSucceeds(getDoc(ref));
    await assertFails(updateDoc(ref, edit('petr')));
    await assertFails(updateDoc(ref, takeLock('petr')));
    await assertFails(updateDoc(ref, st('petr', 'draft')));
    await assertFails(updateDoc(ref, toTrash('petr')));
  });
  test('редактор и админ ставят и снимают', async () => {
    const edRef = sermon(as('ed'), 'sw', 'petr1');
    await assertSucceeds(updateDoc(edRef, st('ed', 'work')));
    await assertSucceeds(updateDoc(edRef, st('ed', 'ready')));
    await assertSucceeds(updateDoc(edRef, edit('ed', { 'meta.title': 'Слайды готовы' })));
    await assertSucceeds(updateDoc(edRef, st('ed', 'submitted')));
    const ref = sermon(as('admin'), 'sw', 'ivan1');
    await assertSucceeds(updateDoc(ref, st('admin', 'ready')));
    await assertSucceeds(updateDoc(ref, st('admin', 'work')));
    await assertSucceeds(setDoc(sermon(as('ed'), 'sw', 'new2'), newSermon('ed', { status: 'ready' })));
  });
  test('неизвестный статус не проходит', async () => {
    await assertFails(updateDoc(sermon(as('ed'), 'sw', 'petr1'), st('ed', 'shown')));
  });
});

describe('замок', () => {
  test('взять свободный, продлить сигналом, править, отпустить', async () => {
    const db = as('ivan');
    const ref = sermon(db, 'sw', 'ivan1');
    await assertSucceeds(updateDoc(ref, takeLock('ivan', 'Иван')));
    // сигнал «я здесь»: меняется только beat, отметка правки не нужна
    await assertSucceeds(updateDoc(ref, { 'lock.beat': serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, edit('ivan')));
    await assertSucceeds(updateDoc(ref, edit('ivan', { 'lock.beat': serverTimestamp() })));
    await assertSucceeds(updateDoc(ref, edit('ivan', { lock: null })));
  });
  test('у конспекта со ссылкой для оператора обычная правка под своим замком проходит (предел выражений)', async () => {
    const ref = sermon(as('ivan'), 'sw', 'ivan1');
    await assertSucceeds(updateDoc(ref, takeLock('ivan', 'Иван')));
    await assertSucceeds(updateDoc(ref, edit('ivan', { shareKey: 'k'.repeat(24) })));
    await assertSucceeds(updateDoc(ref, edit('ivan', { 'lock.beat': serverTimestamp() })));
    await assertSucceeds(updateDoc(ref, edit('ivan', { lock: null })));
  });
  test('под чужим живым замком не правит и не забирает никто, кроме редактора', async () => {
    await setLock('sw', 'ivan1', 'ivan', 2);
    const ed = sermon(as('ed'), 'sw', 'ivan1');
    const admin = sermon(as('admin'), 'sw', 'ivan1');
    await assertFails(updateDoc(ed, edit('ed')));
    await assertFails(updateDoc(admin, edit('admin', { lock: null })));
    // проповедник с правом на проповедь — тоже нет (замок у редактора)
    await setLock('sw', 'petr1', 'ed', 2);
    const petr = sermon(as('petr'), 'sw', 'petr1');
    await assertFails(updateDoc(petr, edit('petr')));
    await assertFails(updateDoc(petr, takeLock('petr')));
  });
  test('редактор забирает замок отдельной записью, без правок', async () => {
    await setLock('sw', 'ivan1', 'ivan', 2);
    const ed = sermon(as('ed'), 'sw', 'ivan1');
    await assertFails(updateDoc(ed, { ...takeLock('ed'), 'meta.title': 'Сразу правлю', updatedAt: serverTimestamp(), updatedBy: PEOPLE.ed }));
    await assertSucceeds(updateDoc(ed, takeLock('ed', 'Редактор')));
    await assertSucceeds(updateDoc(ed, edit('ed')));
    // у Ивана замок забрали — его правки не проходят
    await assertFails(updateDoc(sermon(as('ivan'), 'sw', 'ivan1'), edit('ivan')));
  });
  test('истёкший замок можно забрать или снять; править под ним, не трогая, нельзя', async () => {
    await setLock('sw', 'petr1', 'ed', 11);
    const petr = sermon(as('petr'), 'sw', 'petr1');
    await assertFails(updateDoc(petr, edit('petr')));
    await assertSucceeds(updateDoc(petr, edit('petr', { lock: null })));
    await setLock('sw', 'petr1', 'ed', 11);
    await assertSucceeds(updateDoc(petr, takeLock('petr')));
  });
  test('свой истёкший замок можно продолжать', async () => {
    await setLock('sw', 'ivan1', 'ivan', 30);
    await assertSucceeds(updateDoc(sermon(as('ivan'), 'sw', 'ivan1'), edit('ivan')));
  });
  test('время жизни замка берётся из настроек пространства', async () => {
    await setLock('fast', 'ivan1', 'ivan', 2);   // в «fast» замок живёт минуту
    await assertSucceeds(updateDoc(sermon(as('ed'), 'fast', 'ivan1'), edit('ed', takeLock('ed'))));
    await setLock('sw', 'petr1', 'ivan', 2);     // в «sw» — 10 минут
    await assertFails(updateDoc(sermon(as('ed'), 'sw', 'petr1'), edit('ed', takeLock('ed'))));
  });
  test('замок нельзя записать на другого или со своим временем', async () => {
    const ref = sermon(as('ivan'), 'sw', 'ivan1');
    await assertFails(updateDoc(ref, takeLock('petr')));
    await assertFails(updateDoc(ref, { lock: { email: PEOPLE.ivan, name: 'Иван', at: serverTimestamp(), beat: Timestamp.fromMillis(Date.now() + 3_600_000) } }));
    await assertFails(updateDoc(ref, { lock: { email: PEOPLE.ivan, name: 'Иван', at: minutesAgo(100), beat: serverTimestamp() } }));
    await assertFails(updateDoc(ref, { lock: { email: PEOPLE.ivan, at: serverTimestamp(), beat: serverTimestamp() } }));
  });
  test('при продлении нельзя сдвинуть начало замка', async () => {
    await setLock('sw', 'ivan1', 'ivan', 1);
    const ref = sermon(as('ivan'), 'sw', 'ivan1');
    await assertFails(updateDoc(ref, { 'lock.beat': serverTimestamp(), 'lock.at': minutesAgo(500) }));
  });
});

// Пометить проповедь «в корзине» в обход правил (как будто её туда уже убрали)
async function putInTrash(s, id, who = 'ed') {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), 'spaces', s, 'sermons', id), { deletedAt: minutesAgo(5), deletedBy: PEOPLE[who], lock: null });
  });
}
const toTrash = (who) => ({ deletedAt: serverTimestamp(), deletedBy: PEOPLE[who] });
const fromTrash = () => ({ deletedAt: deleteField(), deletedBy: deleteField() });

describe('проповеди: удаление насовсем (с этапа 9.1 — только из корзины)', () => {
  test('не из корзины не удаляет никто, даже админ', async () => {
    await assertFails(deleteDoc(sermon(as('petr'), 'sw', 'petr1')));
    await assertFails(deleteDoc(sermon(as('ed'), 'sw', 'guest')));
    await assertFails(deleteDoc(sermon(as('admin'), 'sw', 'ivan1')));
  });
  test('из корзины: проповедник — только свой черновик, редактор и админ — любую', async () => {
    for (const id of ['ivan1', 'petr1', 'guest']) await putInTrash('sw', id);
    await assertFails(deleteDoc(sermon(as('ivan'), 'sw', 'ivan1')));   // подана
    await assertFails(deleteDoc(sermon(as('ivan'), 'sw', 'petr1')));   // чужая
    await assertSucceeds(deleteDoc(sermon(as('petr'), 'sw', 'petr1')));
    await assertSucceeds(deleteDoc(sermon(as('ed'), 'sw', 'guest')));
    await assertSucceeds(deleteDoc(sermon(as('admin'), 'sw', 'ivan1')));
    await assertFails(deleteDoc(sermon(as('stranger'), 'other', 'o1')));   // не в корзине
  });
  test('вместе с черновиком проповедник удаляет и отметки редактора', async () => {
    await putInTrash('sw', 'petr1', 'petr');
    const db = as('petr');
    const batch = writeBatch(db);
    batch.delete(sermon(db, 'sw', 'petr1'));
    batch.delete(doc(db, 'spaces', 'sw', 'sermons', 'petr1', 'editor', 'state'));
    await assertSucceeds(batch.commit());
    // а у живой проповеди — нет
    await assertFails(deleteDoc(doc(db, 'spaces', 'sw', 'sermons', 'ivan1', 'editor', 'state')));
  });
});

describe('корзина (этап 9.1)', () => {
  test('автор убирает в корзину только свой черновик; редактор и админ — любую', async () => {
    await assertFails(updateDoc(sermon(as('ivan'), 'sw', 'ivan1'), toTrash('ivan')));   // подана
    await assertFails(updateDoc(sermon(as('ivan'), 'sw', 'petr1'), toTrash('ivan')));   // чужая
    await assertSucceeds(updateDoc(sermon(as('petr'), 'sw', 'petr1'), toTrash('petr')));
    await assertSucceeds(updateDoc(sermon(as('ed'), 'sw', 'ivan1'), toTrash('ed')));
    await assertSucceeds(updateDoc(sermon(as('admin'), 'sw', 'guest'), toTrash('admin')));
    await assertFails(updateDoc(sermon(as('stranger'), 'sw', 'guest'), toTrash('stranger')));
    await assertFails(updateDoc(sermon(anon(), 'fast', 'guest'), { deletedAt: serverTimestamp(), deletedBy: 'x@y.z' }));
  });
  test('в корзину: время только сервера, кто — только я, больше ничего не меняется', async () => {
    const ref = sermon(as('ed'), 'sw', 'ivan1');
    await assertFails(updateDoc(ref, { deletedAt: minutesAgo(100), deletedBy: PEOPLE.ed }));
    await assertFails(updateDoc(ref, { deletedAt: serverTimestamp(), deletedBy: PEOPLE.ivan }));
    await assertFails(updateDoc(ref, { deletedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { ...toTrash('ed'), 'meta.title': 'Тайком' }));
    await assertFails(updateDoc(ref, { ...toTrash('ed'), status: 'draft' }));
    await assertFails(updateDoc(ref, { ...toTrash('ed'), ...takeLock('ed') }));
    await assertSucceeds(updateDoc(ref, toTrash('ed')));
  });
  test('под чужим живым замком в корзину нельзя; под своим и истёкшим — можно, замок снимается', async () => {
    await setLock('sw', 'ivan1', 'ivan', 1);
    await assertFails(updateDoc(sermon(as('ed'), 'sw', 'ivan1'), { ...toTrash('ed'), lock: null }));
    await setLock('sw', 'petr1', 'petr', 1);
    await assertFails(updateDoc(sermon(as('petr'), 'sw', 'petr1'), toTrash('petr')));   // замок должен уйти
    await assertSucceeds(updateDoc(sermon(as('petr'), 'sw', 'petr1'), { ...toTrash('petr'), lock: null }));
    await setLock('sw', 'guest', 'ivan', 30);
    await assertSucceeds(updateDoc(sermon(as('ed'), 'sw', 'guest'), { ...toTrash('ed'), lock: null }));
  });
  test('из корзины возвращает тот же, кто может убрать: автор — свой черновик, редактор — любую', async () => {
    for (const id of ['ivan1', 'petr1', 'guest']) await putInTrash('sw', id);
    await assertFails(updateDoc(sermon(as('ivan'), 'sw', 'ivan1'), fromTrash()));   // подана, её убрал редактор
    await assertFails(updateDoc(sermon(as('ivan'), 'sw', 'petr1'), fromTrash()));   // чужая
    await assertSucceeds(updateDoc(sermon(as('petr'), 'sw', 'petr1'), fromTrash()));
    await assertSucceeds(updateDoc(sermon(as('ed'), 'sw', 'ivan1'), fromTrash()));
    await assertSucceeds(updateDoc(sermon(as('admin'), 'sw', 'guest'), fromTrash()));
  });
  test('возврат — только снять пометки: без правок, без замка, без половины пометки', async () => {
    await putInTrash('sw', 'guest');
    const ref = sermon(as('ed'), 'sw', 'guest');
    await assertFails(updateDoc(ref, { deletedAt: deleteField() }));
    await assertFails(updateDoc(ref, { ...fromTrash(), 'meta.title': 'Заодно' }));
    await assertFails(updateDoc(ref, { ...fromTrash(), ...takeLock('ed') }));
    await assertFails(updateDoc(ref, { deletedAt: serverTimestamp(), deletedBy: PEOPLE.ed }));   // пометку не переписать
    await assertSucceeds(updateDoc(ref, fromTrash()));
  });
  test('проповедь в корзине никто не правит, замок не берёт и не забирает', async () => {
    await putInTrash('sw', 'petr1', 'petr');
    const p = sermon(as('petr'), 'sw', 'petr1'), e = sermon(as('ed'), 'sw', 'petr1');
    await assertSucceeds(getDoc(p));   // смотреть можно
    await assertFails(updateDoc(p, edit('petr')));
    await assertFails(updateDoc(p, takeLock('petr')));
    await assertFails(updateDoc(e, edit('ed')));
    await assertFails(updateDoc(e, takeLock('ed')));
    await assertFails(updateDoc(e, { status: 'work', updatedAt: serverTimestamp(), updatedBy: PEOPLE.ed }));
    // и снять пометку обычной правкой автор не может (обход «Восстановить» для чужого решения редактора)
    await putInTrash('sw', 'ivan1');
    await assertFails(updateDoc(sermon(as('ivan'), 'sw', 'ivan1'), edit('ivan', fromTrash())));
    await assertFails(updateDoc(sermon(as('ivan'), 'sw', 'ivan1'), edit('ivan', { deletedAt: deleteField() })));
  });
  test('пометку корзины не поставить обычной правкой и при создании', async () => {
    await assertFails(updateDoc(sermon(as('ed'), 'sw', 'ivan1'), edit('ed', toTrash('ed'))));
    await assertFails(setDoc(sermon(as('ivan'), 'sw', 'n1'), newSermon('ivan', toTrash('ivan'))));
  });
  test('сигнал и отпускание своего замка по-прежнему проходят', async () => {
    await setLock('sw', 'ivan1', 'ivan', 1);
    const ref = sermon(as('ivan'), 'sw', 'ivan1');
    await assertSucceeds(updateDoc(ref, { 'lock.beat': serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { lock: null }));
  });
});

describe('отметки редактора', () => {
  const state = (db) => doc(db, 'spaces', 'sw', 'sermons', 'ivan1', 'editor', 'state');
  test('редактор читает и пишет', async () => {
    const db = as('ed');
    await assertSucceeds(getDoc(state(db)));
    await assertSucceeds(setDoc(state(db), { flags: { b1: { on: false } }, updatedAt: serverTimestamp(), updatedBy: PEOPLE.ed }));
  });
  test('автор видит (этап 9.7), но не пишет, даже у своей проповеди', async () => {
    const db = as('ivan');
    await assertSucceeds(getDoc(state(db)));
    await assertSucceeds(getDoc(doc(as('petr'), 'spaces', 'sw', 'sermons', 'ivan1', 'editor', 'state')));   // пространство открывает чужие
    await assertFails(setDoc(state(db), { flags: {}, updatedAt: serverTimestamp(), updatedBy: PEOPLE.ivan }));
  });
  test('чужие отметки — только там, где автору видна сама проповедь', async () => {
    await assertSucceeds(getDoc(doc(as('ivan'), 'spaces', 'closed', 'sermons', 'ivan1', 'editor', 'state')));
    await assertFails(getDoc(doc(as('petr'), 'spaces', 'closed', 'sermons', 'ivan1', 'editor', 'state')));
    await assertFails(getDoc(doc(as('stranger'), 'spaces', 'sw', 'sermons', 'ivan1', 'editor', 'state')));
    await assertFails(getDoc(doc(anon(), 'spaces', 'sw', 'sermons', 'ivan1', 'editor', 'state')));
  });
  test('другие документы рядом не заводятся', async () => {
    const db = as('ed');
    await assertFails(setDoc(doc(db, 'spaces', 'sw', 'sermons', 'ivan1', 'editor', 'other'), { flags: {}, updatedAt: serverTimestamp(), updatedBy: PEOPLE.ed }));
  });
});

describe('история сохранений (этап 9.7)', () => {
  const ver = (db, s, id, v = 'v1') => doc(db, 'spaces', s, 'sermons', id, 'versions', v);
  const copy = (who, extra = {}) => ({
    v: 2, meta: { title: 'Вера' }, settings: { lang: 'syn' }, blocks: [{ id: 'b1', type: 'splash', speech: '' }],
    status: 'draft', savedAt: serverTimestamp(), savedBy: PEOPLE[who], name: who, ...extra,
  });
  async function putVersion(s, id, v) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(ver(ctx.firestore(), s, id, v), { ...copy('ed'), savedAt: minutesAgo(5) });
    });
  }
  async function setStatus(s, id, status) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'spaces', s, 'sermons', id), { status });
    });
  }
  test('автор пишет и читает историю своего конспекта, удаляет лишние копии', async () => {
    const db = as('petr');
    await assertSucceeds(setDoc(ver(db, 'sw', 'petr1'), copy('petr')));
    await assertSucceeds(getDoc(ver(db, 'sw', 'petr1')));
    await assertSucceeds(getDocs(collection(db, 'spaces', 'sw', 'sermons', 'petr1', 'versions')));
    await assertSucceeds(deleteDoc(ver(db, 'sw', 'petr1')));
  });
  test('чужую историю автор не видит и не пишет, даже если конспекты пространства ему открыты', async () => {
    await putVersion('sw', 'ivan1', 'v1');
    const db = as('petr');
    await assertFails(getDoc(ver(db, 'sw', 'ivan1')));
    await assertFails(getDocs(collection(db, 'spaces', 'sw', 'sermons', 'ivan1', 'versions')));
    await assertFails(setDoc(ver(db, 'sw', 'ivan1', 'v2'), copy('petr')));
    await assertFails(deleteDoc(ver(db, 'sw', 'ivan1')));
    await assertFails(getDoc(ver(as('stranger'), 'sw', 'ivan1')));
    await assertFails(getDoc(ver(anon(), 'sw', 'ivan1')));
  });
  test('пока конспект у редактора или презентация готова, автор историю не пишет и не читает', async () => {
    await putVersion('sw', 'petr1', 'v1');
    for (const status of ['work', 'ready']) {
      await setStatus('sw', 'petr1', status);
      const db = as('petr');
      await assertFails(setDoc(ver(db, 'sw', 'petr1', 'v2'), copy('petr')));
      await assertFails(getDoc(ver(db, 'sw', 'petr1')));
    }
  });
  test('редактор и админ — у любого конспекта', async () => {
    await assertSucceeds(setDoc(ver(as('ed'), 'sw', 'ivan1'), copy('ed')));
    await assertSucceeds(getDoc(ver(as('admin'), 'sw', 'ivan1')));
    await assertSucceeds(setDoc(ver(as('admin'), 'sw', 'guest'), copy('admin')));
    await assertSucceeds(deleteDoc(ver(as('admin'), 'sw', 'ivan1')));
  });
  test('время сервера, своя почта, только нужные поля; поменять копию нельзя', async () => {
    const db = as('ed');
    await assertFails(setDoc(ver(db, 'sw', 'ivan1'), copy('ed', { savedAt: minutesAgo(1) })));
    await assertFails(setDoc(ver(db, 'sw', 'ivan1'), copy('ed', { savedBy: PEOPLE.ivan })));
    await assertFails(setDoc(ver(db, 'sw', 'ivan1'), copy('ed', { extra: 1 })));
    const { blocks, ...noBlocks } = copy('ed');
    await assertFails(setDoc(ver(db, 'sw', 'ivan1'), noBlocks));
    await assertSucceeds(setDoc(ver(db, 'sw', 'ivan1'), copy('ed')));
    await assertFails(updateDoc(ver(db, 'sw', 'ivan1'), { 'meta.title': 'Иначе' }));
    await assertFails(setDoc(ver(db, 'sw', 'ivan1'), copy('ed')));   // перезаписать — тоже правка
  });
  test('у несуществующего конспекта истории нет', async () => {
    await assertFails(setDoc(ver(as('ed'), 'sw', 'nope'), copy('ed')));
  });
  test('из корзины автор стирает свой черновик вместе с историей', async () => {
    await putVersion('sw', 'petr1', 'v1');
    await putInTrash('sw', 'petr1', 'petr');
    const db = as('petr');
    await assertSucceeds(getDocs(collection(db, 'spaces', 'sw', 'sermons', 'petr1', 'versions')));
    await assertFails(setDoc(ver(db, 'sw', 'petr1', 'v2'), copy('petr')));   // в корзине не правится
    const batch = writeBatch(db);
    batch.delete(ver(db, 'sw', 'petr1'));
    batch.delete(doc(db, 'spaces', 'sw', 'summaries', 'petr1'));
    batch.delete(sermon(db, 'sw', 'petr1'));
    await assertSucceeds(batch.commit());
  });
});

describe('настройки слайдов', () => {
  const cfg = (db, s = 'sw', id = 'slides') => doc(db, 'spaces', s, 'config', id);
  const body = (who, extra = {}) => ({ slides: { margins: { side: 60 } }, updatedAt: serverTimestamp(), updatedBy: PEOPLE[who], ...extra });
  test('редактор и админ записывают, все участники читают', async () => {
    await assertSucceeds(setDoc(cfg(as('ed')), body('ed')));
    await assertSucceeds(setDoc(cfg(as('admin')), body('admin')));
    await assertSucceeds(getDoc(cfg(as('ivan'))));
    await assertSucceeds(getDoc(cfg(as('ed'))));
  });
  test('спикер, посторонний и гость не записывают; посторонний и гость не читают', async () => {
    await assertFails(setDoc(cfg(as('ivan')), body('ivan')));
    await assertFails(setDoc(cfg(as('stranger')), body('stranger')));
    await assertFails(setDoc(cfg(anon()), body('ed')));
    await assertFails(getDoc(cfg(as('stranger'))));
    await assertFails(getDoc(cfg(anon())));
  });
  test('время сервера, своя почта, только нужные поля', async () => {
    const db = as('ed');
    await assertFails(setDoc(cfg(db), body('ed', { updatedAt: minutesAgo(1) })));
    await assertFails(setDoc(cfg(db), body('ed', { updatedBy: PEOPLE.admin })));
    await assertFails(setDoc(cfg(db), body('ed', { extra: 1 })));
    await assertFails(setDoc(cfg(db), body('ed', { slides: 'текст' })));
    await assertFails(setDoc(cfg(db), { updatedAt: serverTimestamp(), updatedBy: PEOPLE.ed }));
  });
  test('другие документы рядом не заводятся, редактор не удаляет (админ — вместе с пространством), список закрыт', async () => {
    const db = as('admin');
    await assertSucceeds(setDoc(cfg(db), body('admin')));
    await assertFails(setDoc(cfg(db, 'sw', 'other'), body('admin')));
    await assertFails(setDoc(cfg(db, 'sw', 'operators'), { operators: {}, updatedAt: serverTimestamp(), updatedBy: PEOPLE.admin }));
    await assertFails(deleteDoc(cfg(as('ed'))));
    await assertFails(getDocs(collection(db, 'spaces', 'sw', 'config')));
  });
  test('чужое пространство закрыто', async () => {
    await assertFails(setDoc(cfg(as('stranger'), 'sw'), body('stranger')));
    await assertFails(setDoc(cfg(as('ed'), 'other'), body('ed')));
    await assertFails(getDoc(cfg(as('ed'), 'other')));
  });
});

describe('операторы этапа 10.1: только перенос в людей (этап 10.1.2)', () => {
  const opr = (db, s = 'sw') => doc(db, 'spaces', s, 'config', 'operators');
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(opr(ctx.firestore()), { operators: { o1: { name: 'Пётр Оператор', tg: 'petr_op' } }, updatedAt: minutesAgo(5), updatedBy: PEOPLE.ed });
    });
  });
  test('участники читают, записать нельзя никому', async () => {
    await assertSucceeds(getDoc(opr(as('ivan'))));
    await assertSucceeds(getDoc(opr(as('ed'))));
    await assertFails(getDoc(opr(as('stranger'))));
    const body = (who) => ({ operators: {}, updatedAt: serverTimestamp(), updatedBy: PEOPLE[who] });
    await assertFails(setDoc(opr(as('ed')), body('ed')));
    await assertFails(setDoc(opr(as('admin')), body('admin')));
  });
  test('удаляют редактор и админ; автор — нет', async () => {
    await assertFails(deleteDoc(opr(as('ivan'))));
    await assertFails(deleteDoc(opr(as('ed'), 'other')));
    await assertSucceeds(deleteDoc(opr(as('ed'))));
    await assertSucceeds(deleteDoc(opr(as('admin'), 'closed')));
  });
  test('перенос одной пачкой: люди с ролью operator и удаление документа', async () => {
    const db = as('ed'), b = writeBatch(db);
    b.set(doc(db, 'spaces', 'sw', 'members', 'p-mig001'), { role: 'operator', firstName: 'Пётр', lastName: 'Оператор', tg: 'petr_op', addedBy: PEOPLE.ed, addedAt: serverTimestamp() });
    b.delete(opr(db));
    await assertSucceeds(b.commit());
  });
});

describe('серии проповедей (этап 10)', () => {
  const ser = (db, s = 'sw') => doc(db, 'spaces', s, 'config', 'series');
  const body = (who, extra = {}) => ({
    series: { s1: { name: 'Нагорная проповедь', active: true, format: 'default' } },
    updatedAt: serverTimestamp(), updatedBy: PEOPLE[who], ...extra,
  });
  test('редактор и админ записывают, автор только читает', async () => {
    await assertSucceeds(setDoc(ser(as('ed')), body('ed')));
    await assertSucceeds(setDoc(ser(as('admin')), body('admin')));
    await assertSucceeds(getDoc(ser(as('ivan'))));
    await assertFails(setDoc(ser(as('ivan')), body('ivan')));
    await assertFails(getDoc(ser(as('stranger'))));
    await assertFails(setDoc(ser(as('ed'), 'other'), body('ed')));
  });
  test('только нужные поля, время сервера; удаляет только админ (вместе с пространством)', async () => {
    const db = as('ed');
    await assertFails(setDoc(ser(db), body('ed', { series: 'текст' })));
    await assertFails(setDoc(ser(db), body('ed', { slides: {} })));
    await assertFails(setDoc(ser(db), body('ed', { updatedAt: minutesAgo(1) })));
    await assertFails(setDoc(ser(db), { slides: {}, updatedAt: serverTimestamp(), updatedBy: PEOPLE.ed }));
    await assertSucceeds(setDoc(ser(db), body('ed')));
    await assertFails(deleteDoc(ser(db)));
    await assertSucceeds(deleteDoc(ser(as('admin'))));
  });
  test('автор ставит серию и свой формат фона в свою проповедь, но не в чужую', async () => {
    const db = as('ivan');
    await assertSucceeds(updateDoc(sermon(db, 'sw', 'ivan1'), edit('ivan', { 'meta.series': 's1', 'meta.format': 'f1' })));
    await assertSucceeds(setDoc(sermon(db, 'sw', 'n1'), newSermon('ivan', { meta: { title: 'Новая', series: 's1' } })));
    await assertFails(updateDoc(sermon(db, 'sw', 'petr1'), edit('ivan', { 'meta.series': 's1' })));
    await assertFails(updateDoc(sermon(db, 'sw', 'ivan1'), edit('ivan', { 'meta.series': 5 })));
    await assertFails(updateDoc(sermon(db, 'sw', 'ivan1'), edit('ivan', { 'meta.format': 'x'.repeat(65) })));
  });
});

describe('настройки экрана человека (этап 7.2)', () => {
  const prefs = (db, email, id = 'screen') => doc(db, 'people', email, 'prefs', id);
  const body = (extra = {}) => ({ layout: { order: ['film', 'stage', 'side'], film: 214, side: 400 }, updatedAt: serverTimestamp(), ...extra });
  test('человек пишет и читает свои', async () => {
    const db = as('ivan');
    await assertSucceeds(setDoc(prefs(db, PEOPLE.ivan), body()));
    await assertSucceeds(getDoc(prefs(db, PEOPLE.ivan)));
    await assertSucceeds(setDoc(prefs(db, PEOPLE.ivan), body({ layout: {} })));
  });
  test('посторонний со входом — тоже свои (раскладка общая для всех пространств)', async () => {
    await assertSucceeds(setDoc(prefs(as('stranger'), PEOPLE.stranger), body()));
  });
  test('чужие не читаются и не пишутся, без входа — ничего', async () => {
    await assertSucceeds(setDoc(prefs(as('ivan'), PEOPLE.ivan), body()));
    await assertFails(getDoc(prefs(as('ed'), PEOPLE.ivan)));
    await assertFails(getDoc(prefs(as('admin'), PEOPLE.ivan)));
    await assertFails(setDoc(prefs(as('ed'), PEOPLE.ivan), body()));
    await assertFails(getDoc(prefs(anon(), PEOPLE.ivan)));
    await assertFails(setDoc(prefs(anon(), PEOPLE.ivan), body()));
  });
  test('почта с заглавными буквами в токене — та же запись', async () => {
    const db = env.authenticatedContext('ivan2', { email: 'Ivan@Example.com', email_verified: true }).firestore();
    await assertSucceeds(setDoc(prefs(db, PEOPLE.ivan), body()));
  });
  test('только документ screen, нужные поля, время сервера', async () => {
    const db = as('ivan');
    await assertFails(setDoc(prefs(db, PEOPLE.ivan, 'other'), body()));
    await assertFails(setDoc(prefs(db, PEOPLE.ivan), body({ extra: 1 })));
    await assertFails(setDoc(prefs(db, PEOPLE.ivan), body({ layout: 'текст' })));
    await assertFails(setDoc(prefs(db, PEOPLE.ivan), body({ updatedAt: minutesAgo(1) })));
    await assertFails(setDoc(prefs(db, PEOPLE.ivan), { layout: {} }));
    const big = {}; for (let i = 0; i < 21; i++) big['k' + i] = i;
    await assertFails(setDoc(prefs(db, PEOPLE.ivan), body({ layout: big })));
  });
  test('удалить и перебрать нельзя', async () => {
    const db = as('ivan');
    await assertSucceeds(setDoc(prefs(db, PEOPLE.ivan), body()));
    await assertFails(deleteDoc(prefs(db, PEOPLE.ivan)));
    await assertFails(getDocs(collection(db, 'people', PEOPLE.ivan, 'prefs')));
  });
});

describe('ссылка для оператора', () => {
  const KEY = 'k'.repeat(24);
  const share = (who, extra = {}) => ({
    spaceId: 'sw', sermonId: 'ivan1', sermon: { meta: { title: 'Вера' }, blocks: [] },
    createdBy: PEOPLE[who], updatedAt: serverTimestamp(), ...extra,
  });
  test('по ключу читается без входа, список закрыт', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'shares', KEY)));
    await assertFails(getDocs(collection(anon(), 'shares')));
    await assertFails(getDocs(collection(as('admin'), 'shares')));
  });
  test('делится тот, кто может править проповедь', async () => {
    const key = 'a'.repeat(22);
    await assertFails(setDoc(doc(as('petr'), 'shares', key), share('petr')));
    await assertFails(setDoc(doc(as('stranger'), 'shares', key), share('stranger')));
    await assertFails(setDoc(doc(as('ivan'), 'shares', 'short'), share('ivan')));
    await assertSucceeds(setDoc(doc(as('ivan'), 'shares', key), share('ivan')));
    await assertSucceeds(setDoc(doc(as('ed'), 'shares', 'b'.repeat(22)), share('ed')));
  });
  test('обновить можно, перенести на другую проповедь — нет', async () => {
    const ref = doc(as('ivan'), 'shares', KEY);
    await assertSucceeds(setDoc(ref, share('ivan')));
    await assertFails(setDoc(ref, share('ivan', { sermonId: 'petr1' })));
    await assertFails(setDoc(doc(as('petr'), 'shares', KEY), share('ivan')));
  });
  test('удалить может тот, кто может править', async () => {
    await assertFails(deleteDoc(doc(as('petr'), 'shares', KEY)));
    await assertSucceeds(deleteDoc(doc(as('ivan'), 'shares', KEY)));
  });
});

describe('админ всей формы (этап 8)', () => {
  test('свою запись в admins видит только сам человек; записать её из браузера нельзя', async () => {
    await assertSucceeds(getDoc(doc(as('admin'), 'admins', PEOPLE.admin)));
    await assertSucceeds(getDoc(doc(as('ivan'), 'admins', PEOPLE.ivan)));   // записи нет — но спросить про себя можно
    await assertFails(getDoc(doc(as('ivan'), 'admins', PEOPLE.admin)));
    await assertFails(getDocs(collection(as('admin'), 'admins')));
    await assertFails(getDoc(doc(anon(), 'admins', PEOPLE.admin)));
    await assertFails(setDoc(doc(as('ivan'), 'admins', PEOPLE.ivan), { email: PEOPLE.ivan }));
    await assertFails(setDoc(doc(as('admin'), 'admins', PEOPLE.ivan), { email: PEOPLE.ivan }));
    await assertFails(deleteDoc(doc(as('admin'), 'admins', PEOPLE.admin)));
  });
  test('почта с заглавными буквами — тот же админ', async () => {
    await assertSucceeds(getDocs(collection(as('admin', { email: 'Admin@Example.com' }), 'spaces')));
  });
  test('админ без участия в пространстве видит и правит всё, как редактор', async () => {
    const db = as('admin');
    for (const s of ['sw', 'closed', 'other']) {
      await assertSucceeds(getDoc(doc(db, 'spaces', s)));
      await assertSucceeds(getDocs(collection(db, 'spaces', s, 'members')));
      await assertSucceeds(getDocs(collection(db, 'spaces', s, 'sermons')));
    }
    await assertSucceeds(getDoc(doc(db, 'spaces', 'sw', 'sermons', 'ivan1', 'editor', 'state')));
    await assertSucceeds(updateDoc(sermon(db, 'other', 'o1'), edit('admin', { status: 'work' })));
    await assertSucceeds(setDoc(sermon(db, 'closed', 'n1'), newSermon('admin', { owner: PEOPLE.ivan })));
    await assertSucceeds(setDoc(doc(db, 'spaces', 'other', 'config', 'slides'),
      { slides: {}, updatedAt: serverTimestamp(), updatedBy: PEOPLE.admin }));
    await setLock('sw', 'ivan1', 'ivan', 1);
    await assertSucceeds(updateDoc(sermon(db, 'sw', 'ivan1'), takeLock('admin')));   // забрать правку, как редактор
    // своих пространств через участников у него нет: их он видит списком всех
    const mine = await assertSucceeds(getDocs(query(collectionGroup(db, 'members'), where('email', '==', PEOPLE.admin))));
    assertEqual(mine.size, 0);
  });
  test('старая роль admin участника — это редактор своего пространства', async () => {
    const db = as('stranger');
    await assertSucceeds(getDocs(collection(db, 'spaces', 'other', 'sermons')));
    await assertSucceeds(updateDoc(sermon(db, 'other', 'o1'), edit('stranger', { status: 'work' })));
    await assertSucceeds(setDoc(doc(db, 'spaces', 'other', 'config', 'slides'),
      { slides: {}, updatedAt: serverTimestamp(), updatedBy: PEOPLE.stranger }));
    await assertFails(getDoc(doc(db, 'spaces', 'sw')));
  });
});

describe('сводки для списка (этап 8)', () => {
  const sum = (s, id) => (db) => doc(db, 'spaces', s, 'summaries', id);
  // сводка так, как её пишет форма (cloud-api.mjs, summaryOf): поля проповеди после записи
  const summary = (d, extra = {}) => ({
    title: d.meta.title || '', date: d.meta.date || '', firstName: d.meta.firstName || '', lastName: d.meta.lastName || '',
    status: d.status, owner: d.owner, updatedAt: d.updatedAt, updatedBy: d.updatedBy, lock: d.lock ?? null,
    slides: 0, refs: '', ...extra,
  });
  const edited = (who, base, title = 'Исправлено') => summary({
    ...base, meta: { ...base.meta, title }, updatedAt: serverTimestamp(), updatedBy: PEOPLE[who],
  }, { slides: 1, refs: 'Ин. 3:16' });

  test('новая проповедь вместе со сводкой', async () => {
    const db = as('ivan'), b = writeBatch(db), d = newSermon('ivan');
    b.set(sermon(db, 'sw', 'n1'), d);
    b.set(sum('sw', 'n1')(db), summary(d));
    await assertSucceeds(b.commit());
  });
  test('правка проповеди вместе со сводкой; сводка без правки проповеди — нет', async () => {
    const db = as('ivan');
    const b = writeBatch(db);
    b.update(sermon(db, 'sw', 'ivan1'), edit('ivan'));
    b.set(sum('sw', 'ivan1')(db), edited('ivan', sermonData(PEOPLE.ivan)));
    await assertSucceeds(b.commit());
    // сама по себе, даже совпадающая с проповедью, сводка не пишется
    const cur = (await getDoc(sermon(db, 'sw', 'ivan1'))).data();
    await assertFails(setDoc(sum('sw', 'ivan1')(db), summary(cur, { slides: 99 })));
  });
  test('сводка должна совпадать с проповедью', async () => {
    const db = as('ed'), base = sermonData(PEOPLE.ivan);
    const tryWith = (extra) => {
      const b = writeBatch(db);
      b.update(sermon(db, 'sw', 'ivan1'), edit('ed'));
      b.set(sum('sw', 'ivan1')(db), { ...edited('ed', base), ...extra });
      return b.commit();
    };
    await assertFails(tryWith({ title: 'Другое' }));
    await assertFails(tryWith({ status: 'draft' }));
    await assertFails(tryWith({ owner: PEOPLE.petr }));
    await assertFails(tryWith({ updatedBy: PEOPLE.ivan }));
    await assertFails(tryWith({ slides: 501 }));
    await assertFails(tryWith({ refs: 'x'.repeat(2001) }));
    await assertFails(tryWith({ extra: 1 }));
    await assertSucceeds(tryWith({}));
  });
  test('серия в сводке (этап 10) — как в проповеди', async () => {
    const db = as('ivan'), base = sermonData(PEOPLE.ivan);
    const tryWith = (series, sumExtra) => {
      const b = writeBatch(db);
      b.update(sermon(db, 'sw', 'ivan1'), edit('ivan', series === undefined ? {} : { 'meta.series': series }));
      b.set(sum('sw', 'ivan1')(db), { ...edited('ivan', base), ...sumExtra });
      return b.commit();
    };
    await assertFails(tryWith('s1', {}));
    await assertFails(tryWith('s1', { series: 's2' }));
    await assertFails(tryWith(undefined, { series: 's1' }));
    await assertSucceeds(tryWith('s1', { series: 's1' }));
    await assertSucceeds(tryWith(undefined, { series: 's1' }));   // серия уже стоит в проповеди с прошлой записи
    await assertSucceeds(tryWith('', { series: '' }));
    await assertSucceeds(tryWith('', {}));
  });
  test('сигнал замка обновляет замок и в сводке', async () => {
    await setLock('sw', 'ivan1', 'ivan', 1);
    const db = as('ivan');
    await assertSucceeds(runTransaction(db, async (tx) => {
      const cur = (await tx.get(sermon(db, 'sw', 'ivan1'))).data();
      tx.update(sermon(db, 'sw', 'ivan1'), { 'lock.beat': serverTimestamp() });
      tx.set(sum('sw', 'ivan1')(db), summary(cur, { lock: { ...cur.lock, beat: serverTimestamp() } }));
    }));
    // замок в сводке — чужой или не тот: не проходит
    await assertFails(runTransaction(db, async (tx) => {
      const cur = (await tx.get(sermon(db, 'sw', 'ivan1'))).data();
      tx.update(sermon(db, 'sw', 'ivan1'), { 'lock.beat': serverTimestamp() });
      tx.set(sum('sw', 'ivan1')(db), summary(cur, { lock: null }));
    }));
  });
  test('чужую сводку не записать: проповедь не пускает', async () => {
    const db = as('ivan'), b = writeBatch(db);
    b.update(sermon(db, 'sw', 'petr1'), edit('ivan'));
    b.set(sum('sw', 'petr1')(db), edited('ivan', sermonData(PEOPLE.petr, { status: 'draft' })));
    await assertFails(b.commit());
    const s = as('stranger'), d = newSermon('stranger'), b2 = writeBatch(s);
    b2.set(sum('sw', 'x')(s), summary(d));
    await assertFails(b2.commit());
  });
  test('читают те же, кто видит проповедь', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      for (const sp of ['sw', 'closed']) {
        await setDoc(doc(db, 'spaces', sp, 'summaries', 'ivan1'), summary(sermonData(PEOPLE.ivan)));
        await setDoc(doc(db, 'spaces', sp, 'summaries', 'petr1'), summary(sermonData(PEOPLE.petr, { status: 'draft' })));
      }
    });
    const ivan = as('ivan');
    await assertSucceeds(getDocs(collection(ivan, 'spaces', 'sw', 'summaries')));
    await assertSucceeds(getDoc(sum('closed', 'ivan1')(ivan)));
    await assertFails(getDoc(sum('closed', 'petr1')(ivan)));
    await assertFails(getDocs(collection(ivan, 'spaces', 'closed', 'summaries')));
    await assertSucceeds(getDocs(query(collection(ivan, 'spaces', 'closed', 'summaries'), where('owner', '==', PEOPLE.ivan))));
    await assertSucceeds(getDocs(collection(as('ed'), 'spaces', 'closed', 'summaries')));
    await assertSucceeds(getDocs(collection(as('admin'), 'spaces', 'closed', 'summaries')));
    await assertFails(getDocs(collection(as('stranger'), 'spaces', 'sw', 'summaries')));
    await assertFails(getDoc(sum('sw', 'ivan1')(anon())));
  });
  test('корзина (этап 9.1): пометки в сводке — вместе с проповедью и такие же', async () => {
    const db = as('ed');
    const move = (sumExtra, sermonUpd = toTrash('ed')) => runTransaction(db, async (tx) => {
      const cur = (await tx.get(sermon(db, 'sw', 'ivan1'))).data();
      tx.update(sermon(db, 'sw', 'ivan1'), sermonUpd);
      tx.set(sum('sw', 'ivan1')(db), summary(cur, sumExtra));
    });
    await assertFails(move({}));   // пометки в сводке нет
    await assertFails(move({ deletedAt: serverTimestamp(), deletedBy: PEOPLE.ivan }));
    await assertSucceeds(move({ deletedAt: serverTimestamp(), deletedBy: PEOPLE.ed }));
    // обратно: в сводке пометки тоже нет
    await assertFails(move({ deletedAt: minutesAgo(1), deletedBy: PEOPLE.ed }, fromTrash()));
    await assertSucceeds(move({}, fromTrash()));
  });
  test('удаляется вместе с проповедью, отдельно — нет', async () => {
    await putInTrash('sw', 'petr1', 'petr');
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'spaces', 'sw', 'summaries', 'petr1'), summary(sermonData(PEOPLE.petr, { status: 'draft' })));
    });
    const db = as('petr');
    await assertFails(deleteDoc(sum('sw', 'petr1')(db)));
    const b = writeBatch(db);
    b.delete(sermon(db, 'sw', 'petr1'));
    b.delete(sum('sw', 'petr1')(db));
    await assertSucceeds(b.commit());
  });
});

describe('фотобанк (этап 10.5)', () => {
  const author = (db, id = 'lewis-cs') => doc(db, 'authors', id);
  const preset = (extra = {}) => ({ x: 0.25, y: 1, h: 0.9, side: 'left', filter: 'bw', mirror: true, ...extra });
  const body = (who, extra = {}) => ({ first: 'Клайв', last: 'Льюис', caption: 'писатель · 1898–1963', aliases: ['К. С. Льюис'],
    updatedAt: serverTimestamp(), updatedBy: PEOPLE[who], ...extra });
  test('админ пишет описание и вид по умолчанию, дописывает и удаляет', async () => {
    const db = as('admin');
    await assertSucceeds(setDoc(author(db), body('admin')));
    await assertSucceeds(setDoc(author(db), { preset: preset(), updatedAt: serverTimestamp(), updatedBy: PEOPLE.admin }, { merge: true }));
    await assertSucceeds(setDoc(author(db, 'ten-boom'), { preset: preset({ side: 'right', x: 0.8, y: 1.1, h: 1.2, filter: 'none', mirror: false }),
      updatedAt: serverTimestamp(), updatedBy: PEOPLE.admin }));
    await assertSucceeds(deleteDoc(author(db, 'ten-boom')));
  });
  test('читает любой, кто вошёл; без входа — нет', async () => {
    await assertSucceeds(setDoc(author(as('admin')), body('admin')));
    for (const who of ['ed', 'ivan', 'stranger']) {
      await assertSucceeds(getDoc(author(as(who))));
      await assertSucceeds(getDocs(collection(as(who), 'authors')));
    }
    await assertFails(getDoc(author(anon())));
  });
  test('редактор и автор не пишут и не удаляют', async () => {
    await assertSucceeds(setDoc(author(as('admin')), body('admin')));
    await assertFails(setDoc(author(as('ed')), body('ed')));
    await assertFails(setDoc(author(as('ed')), { preset: preset(), updatedAt: serverTimestamp(), updatedBy: PEOPLE.ed }, { merge: true }));
    await assertFails(setDoc(author(as('ivan')), body('ivan')));
    await assertFails(deleteDoc(author(as('ed'))));
  });
  test('неверные поля, вид по умолчанию и id не проходят', async () => {
    const db = as('admin');
    await assertFails(setDoc(author(db), body('admin', { extra: 1 })));
    await assertFails(setDoc(author(db), body('admin', { updatedBy: PEOPLE.ed })));
    await assertFails(setDoc(author(db), body('admin', { caption: 'x'.repeat(201) })));
    await assertFails(setDoc(author(db), body('admin', { aliases: 'К. С. Льюис' })));
    await assertFails(setDoc(author(db), body('admin', { preset: preset({ side: 'top' }) })));
    await assertFails(setDoc(author(db), body('admin', { preset: preset({ filter: 'neon' }) })));
    await assertFails(setDoc(author(db), body('admin', { preset: preset({ h: 5 }) })));
    await assertFails(setDoc(author(db), body('admin', { preset: { x: 0.2, y: 1, h: 0.9 } })));
  });
  test('вид по умолчанию с обрезкой, поворотом, обводкой и углами (этап 10.5.3)', async () => {
    const db = as('admin');
    const fx = { crop: { l: 0.1, t: 0, r: 0.2, b: 0 }, rot: -35.5, outline: { w: 12, color: '#F2C14E' }, round: 0.25 };
    await assertSucceeds(setDoc(author(db), body('admin', { preset: preset(fx) }), { merge: true }));
    await assertSucceeds(setDoc(author(db), body('admin', { preset: preset({ rot: 180, round: 0, outline: { w: 0, color: '#ffffff' } }) }), { merge: true }));
    await assertFails(setDoc(author(db), body('admin', { preset: preset({ crop: { l: 0.6, t: 0, r: 0.5, b: 0 } }) })));   // остаётся меньше 10 %
    await assertFails(setDoc(author(db), body('admin', { preset: preset({ crop: { l: 0.1 } }) })));
    await assertFails(setDoc(author(db), body('admin', { preset: preset({ rot: 200 }) })));
    await assertFails(setDoc(author(db), body('admin', { preset: preset({ outline: { w: 31, color: '#ffffff' } }) })));
    await assertFails(setDoc(author(db), body('admin', { preset: preset({ outline: { w: 5, color: 'red' } }) })));
    await assertFails(setDoc(author(db), body('admin', { preset: preset({ round: 0.6 }) })));
    await assertFails(setDoc(author(db), body('admin', { preset: preset({ off: true }) })));
    // этап 10.5.7: отражение по двум осям
    await assertSucceeds(setDoc(author(db), body('admin', { preset: preset({ flipH: true, flipV: false }) }), { merge: true }));
    await assertFails(setDoc(author(db), body('admin', { preset: preset({ flipV: 'yes' }) })));
    await assertFails(setDoc(author(db), body('admin', { preset: preset({ flipH: 1 }) })));   // видимость в вид по умолчанию не входит
    await assertFails(setDoc(author(db, 'Lewis CS'), body('admin')));
  });
});

describe('фотобанк: люди и фото (этап 10.5.2)', () => {
  const by = (who) => ({ updatedAt: serverTimestamp(), updatedBy: PEOPLE[who] });
  const bytes = (n) => Bytes.fromUint8Array(new Uint8Array(n).fill(7));
  const person = (who, extra = {}) => ({ first: 'Клайв', last: 'Льюис', caption: 'писатель · 1898–1963', aliases: ['К. С. Льюис'], ...by(who), ...extra });
  const photo = (who, extra = {}) => Object.fromEntries(Object.entries({ person: 'lewis-cs', kind: 'cut', faces: 'right', w: 800, h: 1600, order: 0, source: 'тест',
    thumb: bytes(5000), ...by(who), ...extra }).filter(([, v]) => v !== undefined));   // faces: undefined — без поля
  const file = (who, n = 300000) => ({ img: bytes(n), ...by(who) });
  const P = (db, id = 'lewis-cs') => doc(db, 'bankPeople', id), F = (db, id = 'f1') => doc(db, 'bankPhotos', id), I = (db, id = 'f1') => doc(db, 'bankFiles', id);
  /* фото и картинка — одной записью, как в форме */
  const addPhoto = (db, who, id = 'f1', meta = {}, n = 300000) => { const b = writeBatch(db); b.set(F(db, id), photo(who, meta)); b.set(I(db, id), file(who, n)); return b.commit(); };
  const seedPerson = () => env.withSecurityRulesDisabled(async (ctx) => { await setDoc(P(ctx.firestore()), { first: 'Клайв', last: 'Льюис' }); });

  test('админ: человек, фото с картинкой, порядок, вид по умолчанию, удаление', async () => {
    const db = as('admin');
    await assertSucceeds(setDoc(P(db), person('admin')));
    await assertSucceeds(addPhoto(db, 'admin'));
    await assertSucceeds(addPhoto(db, 'admin', 'f2', { kind: 'bg', faces: undefined, order: 1, w: 2400, h: 1600 }));
    await assertSucceeds(setDoc(F(db), { order: 3, preset: { x: 0.25, y: 1, h: 0.9, side: 'left', filter: 'bw', mirror: true }, ...by('admin') }, { merge: true }));
    await assertSucceeds(setDoc(F(db), { source: 'другой', ...by('admin') }, { merge: true }));
    const b = writeBatch(db);
    b.delete(F(db)); b.delete(I(db)); b.delete(F(db, 'f2')); b.delete(I(db, 'f2')); b.delete(P(db));
    await assertSucceeds(b.commit());
  });
  test('читают все вошедшие; без входа — нет; список картинок не читается', async () => {
    await seedPerson();
    await assertSucceeds(addPhoto(as('admin'), 'admin'));
    for (const who of ['ed', 'ivan', 'stranger']) {
      await assertSucceeds(getDoc(P(as(who)))); await assertSucceeds(getDocs(collection(as(who), 'bankPeople')));
      await assertSucceeds(getDocs(collection(as(who), 'bankPhotos'))); await assertSucceeds(getDoc(I(as(who))));
      await assertFails(getDocs(collection(as(who), 'bankFiles')));
    }
    await assertFails(getDoc(P(anon()))); await assertFails(getDoc(F(anon()))); await assertFails(getDoc(I(anon())));
  });
  test('редактор и автор не пишут и не удаляют', async () => {
    await seedPerson();
    await assertSucceeds(addPhoto(as('admin'), 'admin'));
    for (const who of ['ed', 'ivan']) {
      await assertFails(setDoc(P(as(who), 'x'), person(who)));
      await assertFails(addPhoto(as(who), who, 'f9'));
      await assertFails(setDoc(F(as(who)), { order: 5, ...by(who) }, { merge: true }));
      await assertFails(deleteDoc(F(as(who)))); await assertFails(deleteDoc(I(as(who)))); await assertFails(deleteDoc(P(as(who))));
    }
  });
  test('размеры картинки и миниатюры, поля, тип, человек', async () => {
    await seedPerson();
    const db = as('admin');
    await assertFails(addPhoto(db, 'admin', 'big', {}, 921601));                       // больше 900 КБ
    await assertSucceeds(addPhoto(db, 'admin', 'max', {}, 921600));
    await assertFails(addPhoto(db, 'admin', 't', { thumb: bytes(41000) }));            // миниатюра больше 40 КБ
    await assertFails(addPhoto(db, 'admin', 'k', { kind: 'png' }));
    await assertFails(addPhoto(db, 'admin', 'nf', { faces: 'left' }));                  // в банке «влево» не бывает: отражено при загрузке
    await assertFails(addPhoto(db, 'admin', 'bgf', { kind: 'bg' }));                   // у «с фоном» нет «куда смотрит»
    await assertFails(addPhoto(db, 'admin', 'np', { person: 'nobody' }));              // человека нет
    await assertFails(addPhoto(db, 'admin', 'x1', { extra: 1 }));
    await assertFails(addPhoto(db, 'admin', 'x2', { w: 1.5 }));
    await assertFails(addPhoto(db, 'admin', 'x3', { updatedBy: PEOPLE.ed }));
    await assertFails(addPhoto(db, 'admin', 'Bad Id'));
    await assertFails(setDoc(F(db, 'alone'), photo('admin')));                          // фото без картинки
    await assertFails(setDoc(I(db, 'alone'), file('admin')));                           // картинка без фото
    await assertFails(setDoc(P(db, 'y'), person('admin', { caption: 'x'.repeat(201) })));
    await assertFails(setDoc(P(db, 'y'), person('admin', { aliases: 'К. С. Льюис' })));
  });
  test('после загрузки картинка, человек и размеры не меняются', async () => {
    await seedPerson();
    const db = as('admin');
    await assertSucceeds(addPhoto(db, 'admin'));
    await assertFails(setDoc(I(db), file('admin', 1000)));
    await assertFails(setDoc(F(db), { w: 10, ...by('admin') }, { merge: true }));
    await assertFails(setDoc(F(db), { person: 'other', ...by('admin') }, { merge: true }));
    await assertFails(setDoc(F(db), { thumb: bytes(10), ...by('admin') }, { merge: true }));
    await assertFails(setDoc(F(db), { preset: { x: 0.2 }, ...by('admin') }, { merge: true }));
  });
});

describe('картинки конспекта (этап 10.9.1)', () => {
  const bytes = (n) => Bytes.fromUint8Array(new Uint8Array(n).fill(7));
  const SI = (db, s, id, img = 'i1') => doc(db, 'spaces', s, 'sermons', id, 'slideImages', img);
  const pic = (who, extra = {}) => ({
    img: bytes(1000), w: 1200, h: 800, updatedAt: serverTimestamp(), updatedBy: PEOPLE[who], ...extra,
  });
  async function putImage(s, id, img = 'i1') {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(SI(ctx.firestore(), s, id, img), { img: bytes(500), w: 10, h: 10, updatedAt: minutesAgo(5), updatedBy: PEOPLE.ed });
    });
  }
  async function setStatus(s, id, status) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'spaces', s, 'sermons', id), { status });
    });
  }
  test('автор загружает и читает картинку своего конспекта, стирает её', async () => {
    const db = as('petr');
    await assertSucceeds(setDoc(SI(db, 'sw', 'petr1'), pic('petr')));
    await assertSucceeds(getDoc(SI(db, 'sw', 'petr1')));
    await assertSucceeds(deleteDoc(SI(db, 'sw', 'petr1')));
  });
  test('чужой конспект: автор не пишет, не стирает; читает, только если конспект ему открыт', async () => {
    await putImage('sw', 'ivan1');
    const db = as('petr');
    await assertFails(setDoc(SI(db, 'sw', 'ivan1', 'i2'), pic('petr')));
    await assertFails(deleteDoc(SI(db, 'sw', 'ivan1')));
    await assertSucceeds(getDoc(SI(db, 'sw', 'ivan1')));                       // пространство открывает чужие конспекты
    await putImage('closed', 'ivan1');
    await assertFails(getDoc(SI(as('petr'), 'closed', 'ivan1')));              // закрытое пространство — только свои
    await assertSucceeds(getDoc(SI(as('ivan'), 'closed', 'ivan1')));
  });
  test('посторонний и гость не читают и не пишут', async () => {
    await putImage('sw', 'ivan1');
    for (const db of [as('stranger'), anon()]) {
      await assertFails(getDoc(SI(db, 'sw', 'ivan1')));
      await assertFails(setDoc(SI(db, 'sw', 'ivan1', 'i2'), pic('stranger')));
      await assertFails(deleteDoc(SI(db, 'sw', 'ivan1')));
    }
  });
  test('редактор и админ — у любого конспекта', async () => {
    await assertSucceeds(setDoc(SI(as('ed'), 'sw', 'ivan1'), pic('ed')));
    await assertSucceeds(getDoc(SI(as('admin'), 'sw', 'ivan1')));
    await assertSucceeds(setDoc(SI(as('admin'), 'sw', 'guest'), pic('admin')));
    await assertSucceeds(deleteDoc(SI(as('admin'), 'sw', 'ivan1')));
  });
  test('пока конспект у редактора или презентация готова, автор не загружает', async () => {
    for (const status of ['work', 'ready']) {
      await setStatus('sw', 'petr1', status);
      await assertFails(setDoc(SI(as('petr'), 'sw', 'petr1'), pic('petr')));
    }
  });
  test('размер, поля, время сервера, своя почта, имя', async () => {
    const db = as('ed');
    await assertFails(setDoc(SI(db, 'sw', 'ivan1'), pic('ed', { img: bytes(921601) })));
    await assertFails(setDoc(SI(db, 'sw', 'ivan1'), pic('ed', { img: bytes(0) })));
    await assertFails(setDoc(SI(db, 'sw', 'ivan1'), pic('ed', { img: 'текст' })));
    await assertFails(setDoc(SI(db, 'sw', 'ivan1'), pic('ed', { w: 0 })));
    await assertFails(setDoc(SI(db, 'sw', 'ivan1'), pic('ed', { h: 4001 })));
    await assertFails(setDoc(SI(db, 'sw', 'ivan1'), pic('ed', { w: 1.5 })));
    await assertFails(setDoc(SI(db, 'sw', 'ivan1'), pic('ed', { updatedAt: minutesAgo(1) })));
    await assertFails(setDoc(SI(db, 'sw', 'ivan1'), pic('ed', { updatedBy: PEOPLE.admin })));
    await assertFails(setDoc(SI(db, 'sw', 'ivan1'), pic('ed', { extra: 1 })));
    const { w, ...noW } = pic('ed');
    await assertFails(setDoc(SI(db, 'sw', 'ivan1'), noW));
    await assertFails(setDoc(SI(db, 'sw', 'ivan1', 'Bad Id'), pic('ed')));
    await assertSucceeds(setDoc(SI(db, 'sw', 'ivan1', 'a1b2-c3'), pic('ed', { img: bytes(921600) })));
  });
  test('картинка не меняется: ни правка, ни перезапись', async () => {
    await putImage('sw', 'ivan1');
    const db = as('ed');
    await assertFails(updateDoc(SI(db, 'sw', 'ivan1'), { w: 20, updatedAt: serverTimestamp(), updatedBy: PEOPLE.ed }));
    await assertFails(setDoc(SI(db, 'sw', 'ivan1'), pic('ed')));
  });
  test('списка нет: картинки читаются только по id', async () => {
    await putImage('sw', 'ivan1');
    await assertFails(getDocs(collection(as('ed'), 'spaces', 'sw', 'sermons', 'ivan1', 'slideImages')));
    await assertFails(getDocs(collection(as('admin'), 'spaces', 'sw', 'sermons', 'ivan1', 'slideImages')));
  });
  test('у несуществующего конспекта картинок нет', async () => {
    await assertFails(setDoc(SI(as('ed'), 'sw', 'nope'), pic('ed')));
    await assertFails(getDoc(SI(as('ed'), 'sw', 'nope')));
  });
  test('в корзине не загружают; автор стирает свой черновик вместе с картинками', async () => {
    const ids = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6'];
    for (const i of ids) await putImage('sw', 'petr1', i);
    await env.withSecurityRulesDisabled(async (ctx) => {
      for (const v of ['v1', 'v2', 'v3']) {
        await setDoc(doc(ctx.firestore(), 'spaces', 'sw', 'sermons', 'petr1', 'versions', v), {
          v: 2, meta: { title: 'Вера' }, blocks: [], status: 'draft', savedAt: minutesAgo(5), savedBy: PEOPLE.ed,
        });
      }
    });
    await putInTrash('sw', 'petr1', 'petr');
    const db = as('petr');
    await assertFails(setDoc(SI(db, 'sw', 'petr1', 'i9'), pic('petr')));
    await assertFails(setDoc(SI(as('ed'), 'sw', 'petr1', 'i9'), pic('ed')));
    // как форма: конспект, сводка, история и все картинки — одной записью (в ней меньше 20 обращений к базе из правил)
    const batch = writeBatch(db);
    ids.forEach((i) => batch.delete(SI(db, 'sw', 'petr1', i)));
    ['v1', 'v2', 'v3'].forEach((v) => batch.delete(doc(db, 'spaces', 'sw', 'sermons', 'petr1', 'versions', v)));
    batch.delete(doc(db, 'spaces', 'sw', 'summaries', 'petr1'));
    batch.delete(sermon(db, 'sw', 'petr1'));
    await assertSucceeds(batch.commit());
  });
  test('из корзины картинку отдельно стирает тот, кто может стереть конспект; чужой — нет', async () => {
    await putImage('sw', 'ivan1');
    await putInTrash('sw', 'ivan1');
    await assertFails(deleteDoc(SI(as('ivan'), 'sw', 'ivan1')));    // чужой статус «submitted» из корзины автор не стирает
    await assertSucceeds(deleteDoc(SI(as('ed'), 'sw', 'ivan1')));
  });
  test('картинки без конспекта (стёрт насовсем) может убрать любой участник пространства', async () => {
    await putImage('sw', 'guest');
    await env.withSecurityRulesDisabled(async (ctx) => { await deleteDoc(sermon(ctx.firestore(), 'sw', 'guest')); });
    await assertSucceeds(deleteDoc(SI(as('ivan'), 'sw', 'guest')));
    await assertFails(deleteDoc(SI(as('stranger'), 'sw', 'guest')));
  });
});

describe('фон заставки серий (этап 10.9.3)', () => {
  const bytes = (n) => Bytes.fromUint8Array(new Uint8Array(n).fill(7));
  const SG = (db, s, img = 's1') => doc(db, 'spaces', s, 'seriesImages', img);
  const pic = (who, extra = {}) => ({
    img: bytes(1000), w: 1600, h: 900, updatedAt: serverTimestamp(), updatedBy: PEOPLE[who], ...extra,
  });
  async function putImage(s, img = 's1') {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(SG(ctx.firestore(), s, img), { img: bytes(500), w: 10, h: 10, updatedAt: minutesAgo(5), updatedBy: PEOPLE.ed });
    });
  }
  test('редактор и админ кладут, читают и стирают', async () => {
    await assertSucceeds(setDoc(SG(as('ed'), 'sw'), pic('ed')));
    await assertSucceeds(getDoc(SG(as('ed'), 'sw')));
    await assertSucceeds(setDoc(SG(as('admin'), 'closed', 's2'), pic('admin')));   // админ — в любом пространстве
    await assertSucceeds(deleteDoc(SG(as('admin'), 'sw')));
    await assertSucceeds(deleteDoc(SG(as('ed'), 'closed', 's2')));
  });
  test('автор читает (заставку рисует и он), но не кладёт и не стирает; в закрытом пространстве — тоже читает', async () => {
    await putImage('sw');
    await putImage('closed');
    await assertSucceeds(getDoc(SG(as('ivan'), 'sw')));
    await assertSucceeds(getDoc(SG(as('petr'), 'closed')));
    await assertFails(setDoc(SG(as('ivan'), 'sw', 's9'), pic('ivan')));
    await assertFails(deleteDoc(SG(as('ivan'), 'sw')));
  });
  test('посторонний, оператор и гость не читают и не пишут', async () => {
    await putImage('sw');
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'spaces', 'sw', 'members', 'op@example.com'), { email: 'op@example.com', role: 'operator' });
    });
    const op = env.authenticatedContext('op', { email: 'op@example.com', email_verified: true }).firestore();
    for (const db of [as('stranger'), op, anon()]) {
      await assertFails(getDoc(SG(db, 'sw')));
      await assertFails(setDoc(SG(db, 'sw', 's9'), pic('stranger')));
      await assertFails(deleteDoc(SG(db, 'sw')));
    }
  });
  test('размер, поля, время сервера, своя почта, имя', async () => {
    const db = as('ed');
    await assertFails(setDoc(SG(db, 'sw'), pic('ed', { img: bytes(921601) })));
    await assertFails(setDoc(SG(db, 'sw'), pic('ed', { img: bytes(0) })));
    await assertFails(setDoc(SG(db, 'sw'), pic('ed', { img: 'текст' })));
    await assertFails(setDoc(SG(db, 'sw'), pic('ed', { w: 0 })));
    await assertFails(setDoc(SG(db, 'sw'), pic('ed', { h: 4001 })));
    await assertFails(setDoc(SG(db, 'sw'), pic('ed', { w: 1.5 })));
    await assertFails(setDoc(SG(db, 'sw'), pic('ed', { updatedAt: minutesAgo(1) })));
    await assertFails(setDoc(SG(db, 'sw'), pic('ed', { updatedBy: PEOPLE.admin })));
    await assertFails(setDoc(SG(db, 'sw'), pic('ed', { extra: 1 })));
    const { h, ...noH } = pic('ed');
    await assertFails(setDoc(SG(db, 'sw'), noH));
    await assertFails(setDoc(SG(db, 'sw', 'Bad Id'), pic('ed')));
    await assertSucceeds(setDoc(SG(db, 'sw', 'sa1b2-c3'), pic('ed', { img: bytes(921600) })));
  });
  test('картинка не меняется; списка нет', async () => {
    await putImage('sw');
    const db = as('ed');
    await assertFails(updateDoc(SG(db, 'sw'), { w: 20, updatedAt: serverTimestamp(), updatedBy: PEOPLE.ed }));
    await assertFails(setDoc(SG(db, 'sw'), pic('ed')));
    await assertFails(getDocs(collection(db, 'spaces', 'sw', 'seriesImages')));
    await assertFails(getDocs(collection(as('admin'), 'spaces', 'sw', 'seriesImages')));
  });
  test('серия ссылается на картинку: config/series со splash пишет редактор, автор — нет', async () => {
    const series = { s1: { name: 'Псалмы', active: true, format: '', splash: { mode: 'bg', imageId: 's1', imgW: 1600, imgH: 900, dim: 30 } } };
    const data = (who) => ({ series, updatedAt: serverTimestamp(), updatedBy: PEOPLE[who] });
    await assertSucceeds(setDoc(doc(as('ed'), 'spaces', 'sw', 'config', 'series'), data('ed')));
    await assertFails(setDoc(doc(as('ivan'), 'spaces', 'sw', 'config', 'series'), data('ivan')));
  });
});

describe('всё остальное закрыто', () => {
  test('посторонние коллекции', async () => {
    await assertFails(setDoc(doc(as('admin'), 'anything', 'x'), { a: 1 }));
    await assertFails(getDoc(doc(as('admin'), 'anything', 'x')));
    await assertFails(setDoc(doc(as('admin'), 'spaces', 'sw', 'other', 'x'), { a: 1 }));
  });
});

function assertEqual(a, b) {
  if (a !== b) throw new Error(`ожидалось ${b}, получено ${a}`);
}
