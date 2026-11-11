// Восстановление базы из папки, сделанной scripts/backup.mjs.
// Документы из копии записываются целиком (поверх текущих).
// С --wipe база сначала полностью очищается — тогда она станет ровно как в копии.
//
//   node scripts/restore.mjs <папка> [--wipe]
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { connect, decode, args, fail } from './lib.mjs';

const a = args();
const [inDir] = a._;
if (!inDir || !existsSync(inDir)) fail('Укажите папку с копией: node scripts/restore.mjs <папка> [--wipe]');

const db = connect();

if (a.wipe) {
  for (const col of await db.listCollections()) await db.recursiveDelete(col);
  console.log('База очищена');
}

const writer = db.bulkWriter();
let count = 0;

// dir — папка коллекции, path — путь коллекции в базе
function load(dir, path) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      // папка документа: внутри — его подколлекции
      for (const sub of readdirSync(full).sort()) {
        const subDir = join(full, sub);
        if (statSync(subDir).isDirectory()) load(subDir, `${path}/${name}/${sub}`);
      }
    } else if (name.endsWith('.json')) {
      const id = name.slice(0, -'.json'.length);
      const data = decode(JSON.parse(readFileSync(full, 'utf8')), db);
      writer.set(db.doc(`${path}/${id}`), data);
      count++;
    }
  }
}

for (const col of readdirSync(inDir).sort()) {
  const dir = join(inDir, col);
  if (statSync(dir).isDirectory() && !col.startsWith('.')) load(dir, col);
}
await writer.close();
console.log(`Восстановлено документов: ${count}`);
