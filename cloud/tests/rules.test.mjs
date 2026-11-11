// Тесты правил Firestore (cloud/firestore.rules) в эмуляторе.
// Запуск: cd cloud && npm test (нужны Node 22 и Java 21; в CI — job «Правила Firestore»).
import { test, before, after, beforeEach, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, collectionGroup,
  query, where, serverTimestamp, writeBatch, Timestamp,
} from 'firebase/firestore';

const PROJECT = 'demo-crosspect';
let env;

// Пространство «sw»: проповедники видят всё. «closed»: только свои. «fast»: замок 1 минута.
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
    for (const s of ['sw', 'closed', 'fast']) {
      await member(s, 'admin', 'admin');
      await member(s, 'ed', 'editor');
      await member(s, 'ivan', 'preacher');
      await member(s, 'petr', 'preacher');
    }
    await member('other', 'stranger', 'admin');

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
  test('участник читает, список всех пространств закрыт', async () => {
    await assertSucceeds(getDoc(doc(as('ivan'), 'spaces', 'sw')));
    await assertFails(getDocs(collection(as('admin'), 'spaces')));
  });
  test('правит только админ', async () => {
    const upd = (who) => updateDoc(doc(as(who), 'spaces', 'sw'), {
      name: 'Słowo Wiary Poznań', 'settings.lockMinutes': 15, updatedAt: serverTimestamp(), updatedBy: PEOPLE[who],
    });
    await assertSucceeds(upd('admin'));
    await assertFails(upd('ed'));
    await assertFails(upd('ivan'));
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
  test('создать и удалить пространство из браузера нельзя', async () => {
    await assertFails(setDoc(doc(as('admin'), 'spaces', 'new'), { name: 'Новая', settings: {} }));
    await assertFails(deleteDoc(doc(as('admin'), 'spaces', 'sw')));
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
    await assertSucceeds(add('admin'));
  });
  test('админ меняет роли других, себе — нет', async () => {
    const db = as('admin');
    await assertSucceeds(updateDoc(doc(db, 'spaces', 'sw', 'members', PEOPLE.ivan), { role: 'editor' }));
    await assertFails(updateDoc(doc(db, 'spaces', 'sw', 'members', PEOPLE.admin), { role: 'preacher' }));
    await assertFails(deleteDoc(doc(db, 'spaces', 'sw', 'members', PEOPLE.admin)));
    await assertSucceeds(deleteDoc(doc(db, 'spaces', 'sw', 'members', PEOPLE.petr)));
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
    await assertFails(setDoc(sermon(db, 'sw', 'n1'), newSermon('ivan', { shareKey: 'short' })));
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

describe('проповеди: удаление', () => {
  test('проповедник удаляет только свой черновик', async () => {
    await assertFails(deleteDoc(sermon(as('ivan'), 'sw', 'ivan1')));   // подана
    await assertFails(deleteDoc(sermon(as('ivan'), 'sw', 'petr1')));   // чужая
    await assertSucceeds(deleteDoc(sermon(as('petr'), 'sw', 'petr1')));
  });
  test('редактор удаляет любую, но не под чужим живым замком', async () => {
    await assertSucceeds(deleteDoc(sermon(as('ed'), 'sw', 'guest')));
    await setLock('sw', 'ivan1', 'ivan', 1);
    await assertFails(deleteDoc(sermon(as('ed'), 'sw', 'ivan1')));
  });
  test('вместе с черновиком проповедник удаляет и отметки редактора', async () => {
    const db = as('petr');
    const batch = writeBatch(db);
    batch.delete(sermon(db, 'sw', 'petr1'));
    batch.delete(doc(db, 'spaces', 'sw', 'sermons', 'petr1', 'editor', 'state'));
    await assertSucceeds(batch.commit());
    // а у живой проповеди — нет
    await assertFails(deleteDoc(doc(db, 'spaces', 'sw', 'sermons', 'ivan1', 'editor', 'state')));
  });
});

describe('отметки редактора', () => {
  const state = (db) => doc(db, 'spaces', 'sw', 'sermons', 'ivan1', 'editor', 'state');
  test('редактор читает и пишет', async () => {
    const db = as('ed');
    await assertSucceeds(getDoc(state(db)));
    await assertSucceeds(setDoc(state(db), { flags: { b1: { on: false } }, updatedAt: serverTimestamp(), updatedBy: PEOPLE.ed }));
  });
  test('проповедник не видит и не пишет, даже у своей проповеди', async () => {
    const db = as('ivan');
    await assertFails(getDoc(state(db)));
    await assertFails(setDoc(state(db), { flags: {}, updatedAt: serverTimestamp(), updatedBy: PEOPLE.ivan }));
  });
  test('другие документы рядом не заводятся', async () => {
    const db = as('ed');
    await assertFails(setDoc(doc(db, 'spaces', 'sw', 'sermons', 'ivan1', 'editor', 'other'), { flags: {}, updatedAt: serverTimestamp(), updatedBy: PEOPLE.ed }));
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
