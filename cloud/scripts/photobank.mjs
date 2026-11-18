// Фотобанк (этап 10.5.2): фото из папки репозитория в базу — в обход правил, ключом сервисного аккаунта.
// Папка — img/authors/ (готовит tools/author_photo.py): authors.json и для каждого фото <id>.webp и <id>.thumb.webp.
// Запускается из приватного crosspect-backup (Actions → «Фотобанк»): перенос фото этапа 10.5 и пачки фото из беседы «Фотобанк».
//
//   node scripts/photobank.mjs upload [--dir ../img/authors] [--replace] [--dry-run]
//       Человек (bankPeople/{person}) создаётся, если его ещё нет; есть — описание не трогаем (его правят в форме).
//       Фото (bankPhotos/{id} + картинка bankFiles/{id}) создаётся, если его ещё нет; --replace — заменить картинку и данные
//       (порядок и вид по умолчанию остаются). id фото = id из authors.json, поэтому старые photo.id в конспектах работают.
//       Правки этапа 10.5 из authors/{id} (описание человека, вид фото по умолчанию) переносятся при создании.
//       Можно запускать сколько угодно раз.
//   node scripts/photobank.mjs list
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FieldValue } from 'firebase-admin/firestore';
import { connect, args, fail } from './lib.mjs';

export const MAX_IMG = 900 * 1024, MAX_THUMB = 40 * 1024;
const PRESET_KEYS = ['x', 'y', 'h', 'side', 'filter', 'mirror'];

/* Записи authors.json → { people: { id: {first,last,caption,aliases} }, photos: [ { id, person, kind, faces, w, h, source, file, thumb } ] } */
export function readBankDir(dir) {
  const list = JSON.parse(readFileSync(join(dir, 'authors.json'), 'utf8'));
  if (!Array.isArray(list)) fail('authors.json: нужен список');
  const people = {}, photos = [];
  for (const a of list) {
    if (!a || !/^[a-z0-9-]{1,60}$/.test(a.id || '')) fail(`authors.json: неверный id «${a && a.id}»`);
    const person = a.person || a.id;
    if (!/^[a-z0-9-]{1,60}$/.test(person)) fail(`${a.id}: неверный person «${person}»`);
    if (!(a.first || a.last)) fail(`${a.id}: нужно имя или фамилия`);
    people[person] ??= { first: String(a.first || ''), last: String(a.last || ''), caption: String(a.caption || ''),
      aliases: (a.aliases || []).map(String).slice(0, 20) };
    const kind = a.kind === 'bg' ? 'bg' : 'cut';
    const img = readFileSync(join(dir, a.file)), thumb = readFileSync(join(dir, a.thumb || a.id + '.thumb.webp'));
    if (img.length > MAX_IMG) fail(`${a.id}: картинка ${Math.round(img.length / 1024)} КБ, можно до 900 КБ`);
    if (thumb.length > MAX_THUMB) fail(`${a.id}: миниатюра ${Math.round(thumb.length / 1024)} КБ, можно до 40 КБ`);
    if (!(a.w > 0 && a.h > 0)) fail(`${a.id}: нет размеров`);
    photos.push({ id: a.id, person, kind, faces: kind === 'cut' ? (a.faces === 'front' ? 'front' : 'right') : null,
      w: a.w, h: a.h, source: String(a.source || '').slice(0, 300), img, thumb });
  }
  return { people, photos };
}

const validPreset = (p) => p && typeof p === 'object' && PRESET_KEYS.every((k) => k in p);

/* Загрузить папку в базу. → { people: созданные, photos: созданные, replaced, skipped } */
export async function upload(db, dir, { replace = false, dryRun = false, log = console.log } = {}) {
  const { people, photos } = readBankDir(dir);
  const stamp = () => ({ updatedAt: FieldValue.serverTimestamp(), updatedBy: 'script' });
  const out = { people: 0, photos: 0, replaced: 0, skipped: 0 };
  const legacy = async (id) => { const s = await db.collection('authors').doc(id).get(); return s.exists ? s.data() : {}; };
  for (const [id, p] of Object.entries(people)) {
    const ref = db.collection('bankPeople').doc(id);
    if ((await ref.get()).exists) continue;
    const e = await legacy(id), pick = (k) => (typeof e[k] === 'string' ? e[k] : p[k]);
    const doc = { first: pick('first'), last: pick('last'), caption: pick('caption'),
      aliases: Array.isArray(e.aliases) ? e.aliases.map(String).slice(0, 20) : p.aliases, ...stamp() };
    log(`человек ${id}: ${[doc.first, doc.last].filter(Boolean).join(' ')}`);
    if (!dryRun) await ref.set(doc);
    out.people++;
  }
  for (const ph of photos) {
    const ref = db.collection('bankPhotos').doc(ph.id), old = await ref.get();
    if (old.exists && !replace) { out.skipped++; continue; }
    let order, preset = null;
    if (old.exists) { order = old.data().order ?? 0; preset = old.data().preset || null; }
    else {
      const same = await db.collection('bankPhotos').where('person', '==', ph.person).get();
      order = same.docs.reduce((m, d) => Math.max(m, (d.data().order ?? 0) + 1), 0);
      const e = await legacy(ph.id);
      if (validPreset(e.preset)) preset = Object.fromEntries(PRESET_KEYS.map((k) => [k, e.preset[k]]));
    }
    const meta = { person: ph.person, kind: ph.kind, w: ph.w, h: ph.h, order, source: ph.source, thumb: ph.thumb, ...stamp() };
    if (ph.faces) meta.faces = ph.faces;
    if (preset) meta.preset = preset;
    log(`фото ${ph.id} (${ph.person}): ${ph.kind === 'bg' ? 'с фоном' : 'без фона'}, ${ph.w}×${ph.h}, ${Math.round(ph.img.length / 1024)} КБ${old.exists ? ' — заменено' : ''}`);
    if (!dryRun) {
      const b = db.batch();
      b.set(ref, meta);
      b.set(db.collection('bankFiles').doc(ph.id), { img: ph.img, ...stamp() });
      await b.commit();
    }
    if (old.exists) out.replaced++; else out.photos++;
  }
  return out;
}

async function list(db) {
  const [pp, ph] = await Promise.all([db.collection('bankPeople').get(), db.collection('bankPhotos').get()]);
  const by = {};
  ph.docs.forEach((d) => { (by[d.data().person] ??= []).push(d); });
  for (const p of pp.docs.sort((a, b) => String(a.data().last).localeCompare(String(b.data().last), 'ru'))) {
    const x = p.data(), mine = (by[p.id] || []).sort((a, b) => (a.data().order ?? 0) - (b.data().order ?? 0));
    console.log(`${p.id}: ${[x.first, x.last].filter(Boolean).join(' ')} — ${mine.map((d) => d.id + (d.data().kind === 'bg' ? ' (с фоном)' : '')).join(', ') || 'нет фото'}`);
  }
  console.log(`Людей: ${pp.size}, фото: ${ph.size}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = args(), cmd = a._[0];
  const dir = typeof a.dir === 'string' ? a.dir : fileURLToPath(new URL('../../img/authors/', import.meta.url));
  const db = connect();
  if (cmd === 'upload') {
    if (!existsSync(join(dir, 'authors.json'))) fail(`Нет ${join(dir, 'authors.json')}`);
    const r = await upload(db, dir, { replace: !!a.replace, dryRun: !!a['dry-run'] });
    console.log(`${a['dry-run'] ? 'Проверка без записи. ' : ''}Новых людей: ${r.people}, новых фото: ${r.photos}, заменено: ${r.replaced}, уже были: ${r.skipped}`);
  } else if (cmd === 'list') {
    await list(db);
  } else {
    fail('Команда: upload [--dir папка] [--replace] [--dry-run] | list');
  }
}
