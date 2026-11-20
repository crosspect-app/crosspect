// Резервная копия всей базы Firestore в папку: один документ — один JSON-файл,
// путь файла повторяет путь документа: spaces/<id>.json, spaces/<id>/sermons/<id>.json …
// Папка сначала очищается, поэтому удалённые документы из копии тоже пропадают
// (история остаётся в git приватного репозитория).
// Большие картинки (поле Bytes от 64 КБ: картинки слайдов, этап 10.9.1, и фотобанка) — отдельным файлом рядом:
// <id>.<поле>.webp, а в JSON — {"$file": "<id>.<поле>.webp"}. Так копия в git не раздувается base64.
//
//   node scripts/backup.mjs <папка>
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, toJSON, args, fail } from './lib.mjs';

const { _: [outDir] } = args();
if (!outDir) fail('Укажите папку: node scripts/backup.mjs <папка>');

const db = connect();
const counts = {};
const BIG = 65536;   // байт: Bytes больше — отдельным файлом

async function dumpCollection(col, dir) {
  const refs = await col.listDocuments();   // в том числе «пустые» документы с подколлекциями
  for (let i = 0; i < refs.length; i += 100) {
    const part = refs.slice(i, i + 100);
    const snaps = await db.getAll(...part);
    for (const snap of snaps) {
      if (snap.exists) {
        mkdirSync(dir, { recursive: true });
        const data = snap.data(), files = {};
        for (const [k, v] of Object.entries(data)) {
          if (!(Buffer.isBuffer(v) || v instanceof Uint8Array) || v.length < BIG) continue;
          const buf = Buffer.from(v), webp = buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
          files[k] = `${snap.id}.${k}.${webp ? 'webp' : 'bin'}`;
          writeFileSync(join(dir, files[k]), buf);
          data[k] = null;
        }
        // ссылку на файл ставим после toJSON: иначе объект с ключом на «$» уйдёт в {"$map": …}
        const json = Object.keys(files).length ? JSON.parse(toJSON(data)) : null;
        if (json) Object.entries(files).forEach(([k, name]) => { json[k] = { $file: name }; });
        writeFileSync(join(dir, `${snap.id}.json`), json ? JSON.stringify(json, null, 2) + '\n' : toJSON(data));
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
