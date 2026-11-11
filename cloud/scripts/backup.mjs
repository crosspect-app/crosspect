// Резервная копия всей базы Firestore в папку: один документ — один JSON-файл,
// путь файла повторяет путь документа: spaces/<id>.json, spaces/<id>/sermons/<id>.json …
// Папка сначала очищается, поэтому удалённые документы из копии тоже пропадают
// (история остаётся в git приватного репозитория).
//
//   node scripts/backup.mjs <папка>
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, toJSON, args, fail } from './lib.mjs';

const { _: [outDir] } = args();
if (!outDir) fail('Укажите папку: node scripts/backup.mjs <папка>');

const db = connect();
const counts = {};

async function dumpCollection(col, dir) {
  const refs = await col.listDocuments();   // в том числе «пустые» документы с подколлекциями
  for (let i = 0; i < refs.length; i += 100) {
    const part = refs.slice(i, i + 100);
    const snaps = await db.getAll(...part);
    for (const snap of snaps) {
      if (snap.exists) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${snap.id}.json`), toJSON(snap.data()));
        counts[col.id] = (counts[col.id] || 0) + 1;
      }
    }
    for (const ref of part) {
      for (const sub of await ref.listCollections()) {
        await dumpCollection(sub, join(dir, ref.id, sub.id));
      }
    }
  }
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const col of await db.listCollections()) {
  await dumpCollection(col, join(outDir, col.id));
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`Сохранено документов: ${total}`, counts);
