// Общее для служебных скриптов: подключение к Firestore и перевод документов в JSON и обратно.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp, GeoPoint, DocumentReference } from 'firebase-admin/firestore';

// Куда подключаться:
//   FIRESTORE_EMULATOR_HOST — эмулятор (тесты), проект из GCLOUD_PROJECT или demo-crosspect;
//   GOOGLE_APPLICATION_CREDENTIALS — путь к JSON-ключу сервисного аккаунта (боевая база).
export function connect() {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const projectId = process.env.GCLOUD_PROJECT || 'demo-crosspect';
    return getFirestore(initializeApp({ projectId }));
  }
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyFile) {
    throw new Error('Нет ключа: задайте GOOGLE_APPLICATION_CREDENTIALS (путь к JSON-ключу) или FIRESTORE_EMULATOR_HOST');
  }
  const key = JSON.parse(readFileSync(keyFile, 'utf8'));
  return getFirestore(initializeApp({ credential: cert(key), projectId: key.project_id }));
}

// ---------- JSON ----------
// Особые типы Firestore записываются объектом с одним ключом на «$»:
//   {"$timestamp": "2026-11-11T05:00:00.123456789Z"}, {"$ref": "spaces/x"},
//   {"$geo": [lat, lng]}, {"$bytes": "base64"}; обычный объект с ключами на «$» — {"$map": {...}}.

function tsToString(t) {
  const iso = new Date(t.seconds * 1000).toISOString();          // …T05:00:00.000Z
  return iso.slice(0, 19) + '.' + String(t.nanoseconds).padStart(9, '0') + 'Z';
}
function tsFromString(s) {
  const m = /^(.{19})(?:\.(\d{1,9}))?Z$/.exec(s);
  if (!m) throw new Error(`Неверное время: ${s}`);
  const seconds = Math.floor(Date.parse(m[1] + 'Z') / 1000);
  const nanoseconds = Number((m[2] || '0').padEnd(9, '0'));
  return new Timestamp(seconds, nanoseconds);
}

export function encode(v) {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Timestamp) return { $timestamp: tsToString(v) };
  if (v instanceof DocumentReference) return { $ref: v.path };
  if (v instanceof GeoPoint) return { $geo: [v.latitude, v.longitude] };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { $bytes: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(encode);
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = encode(v[k]);
  return Object.keys(out).some((k) => k.startsWith('$')) ? { $map: out } : out;
}

export function decode(v, db) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => decode(x, db));
  const keys = Object.keys(v);
  if (keys.length === 1 && keys[0].startsWith('$')) {
    const [k] = keys;
    const x = v[k];
    if (k === '$timestamp') return tsFromString(x);
    if (k === '$ref') return db.doc(x);
    if (k === '$geo') return new GeoPoint(x[0], x[1]);
    if (k === '$bytes') return Buffer.from(x, 'base64');
    if (k === '$map') return Object.fromEntries(Object.entries(x).map(([kk, vv]) => [kk, decode(vv, db)]));
  }
  return Object.fromEntries(keys.map((k) => [k, decode(v[k], db)]));
}

export const toJSON = (data) => JSON.stringify(encode(data), null, 2) + '\n';

// Разбор аргументов: --name value, --flag
export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[k] = true;
      else { out[k] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

export function fail(msg) {
  console.error(msg);
  process.exit(1);
}
