// Тесты правил Firestore (cloud/firestore.rules) в эмуляторе.
// Запуск: cd cloud && npm test (нужны Node 22 и Java 21; в CI — job «Правила Firestore»).
import { test, before, after, beforeEach, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, collectionGroup,
  query, where, serverTimestamp, writeBatch, Timestamp, runTransaction, deleteField,
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
  test('новое пространство заводит только админ, со временем сервера (этап 10); удалить из браузера нельзя', async () => {
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
    await assertFails(deleteDoc(doc(as('admin'), 'spaces', 'sw')));
    await assertFails(deleteDoc(doc(as('admin'), 'spaces', 'new')));
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
  test('добавляет участников только админ', async () => {
    const add = (who, email = 'new@example.com', extra = {}) =>
      setDoc(doc(as(who), 'spaces', 'sw', 'members', email), {
        email, role: 'preacher', firstName: 'Новый', lastName: 'Человек',
        addedBy: PEOPLE[who], addedAt: serverTimestamp(), ...extra,
      });
    await assertFails(add('ed'));
    await assertFails(add('ivan'));
    await assertFails(add('admin', 'New@example.com'));
    await assertFails(add('admin', 'new@example.com', { email: 'other@example.com' }));
    await assertFails(add('admin', 'new@example.com', { role: 'owner' }));
    await assertFails(add('admin', 'new@example.com', { extra: 1 }));
    await assertFails(add('admin', 'not-an-email'));
    await assertFails(add('admin', 'new@example.com', { role: 'admin' }));   // роли admin у участника больше нет
    await assertSucceeds(add('admin'));
    await assertSucceeds(setDoc(doc(as('admin'), 'spaces', 'other', 'members', 'new@example.com'), {
      email: 'new@example.com', role: 'editor', addedBy: PEOPLE.admin, addedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(as('stranger'), 'spaces', 'other', 'members', 'x@example.com'), {
      email: 'x@example.com', role: 'preacher', addedBy: PEOPLE.stranger, addedAt: serverTimestamp(),
    }));
  });
  test('админ меняет роли и удаляет участников в любом пространстве', async () => {
    const db = as('admin');
    await assertSucceeds(updateDoc(doc(db, 'spaces', 'sw', 'members', PEOPLE.ivan), { role: 'editor' }));
    await assertFails(updateDoc(doc(db, 'spaces', 'sw', 'members', PEOPLE.ivan), { role: 'admin' }));
    await assertSucceeds(deleteDoc(doc(db, 'spaces', 'sw', 'members', PEOPLE.petr)));
    await assertSucceeds(updateDoc(doc(db, 'spaces', 'other', 'members', PEOPLE.stranger), { role: 'editor' }));
    await assertFails(updateDoc(doc(as('ed'), 'spaces', 'sw', 'members', PEOPLE.ivan), { role: 'editor' }));
    await assertFails(deleteDoc(doc(as('ed'), 'spaces', 'sw', 'members', PEOPLE.ivan)));
  });
  test('со старой ролью admin своё имя поправить можно, роль — нет', async () => {
    const me = doc(as('stranger'), 'spaces', 'other', 'members', PEOPLE.stranger);
    await assertSucceeds(updateDoc(me, { firstName: 'Новое' }));
    await assertFails(updateDoc(me, { role: 'editor' }));
    await assertFails(deleteDoc(me));
  });
  test('«входил» (seenAt, этап 10): ставит сам человек, время сервера; админ не подделывает', async () => {
    const mine = doc(as('ivan'), 'spaces', 'sw', 'members', PEOPLE.ivan);
    await assertFails(updateDoc(mine, { seenAt: minutesAgo(1) }));
    await assertFails(updateDoc(doc(as('ivan'), 'spaces', 'sw', 'members', PEOPLE.petr), { seenAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(mine, { seenAt: serverTimestamp() }));
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
  test('другие документы рядом не заводятся, удалить нельзя, список закрыт', async () => {
    const db = as('admin');
    await assertSucceeds(setDoc(cfg(db), body('admin')));
    await assertFails(setDoc(cfg(db, 'sw', 'other'), body('admin')));
    await assertFails(deleteDoc(cfg(db)));
    await assertFails(getDocs(collection(db, 'spaces', 'sw', 'config')));
  });
  test('чужое пространство закрыто', async () => {
    await assertFails(setDoc(cfg(as('stranger'), 'sw'), body('stranger')));
    await assertFails(setDoc(cfg(as('ed'), 'other'), body('ed')));
    await assertFails(getDoc(cfg(as('ed'), 'other')));
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
  test('только нужные поля, время сервера; удалить нельзя', async () => {
    const db = as('ed');
    await assertFails(setDoc(ser(db), body('ed', { series: 'текст' })));
    await assertFails(setDoc(ser(db), body('ed', { slides: {} })));
    await assertFails(setDoc(ser(db), body('ed', { updatedAt: minutesAgo(1) })));
    await assertFails(setDoc(ser(db), { slides: {}, updatedAt: serverTimestamp(), updatedBy: PEOPLE.ed }));
    await assertSucceeds(setDoc(ser(db), body('ed')));
    await assertFails(deleteDoc(ser(db)));
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
