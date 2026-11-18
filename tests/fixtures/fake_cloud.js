// Подмена облака для тестов формы: та же форма ответов, что у js/cloud-api.mjs, но «база» — в localStorage страницы.
// Состояние: localStorage['fake-cloud'] = { members:{email:{role,firstName,lastName}}, space:{id,name,settings}, sermons:{id:{...}}, clock,
//   admins:[почта] — админы всей формы (этап 8), spaces:{ id: { space:{id,name,settings}, members, sermons, slides, flags } } — другие пространства }.
// Первое пространство лежит прямо в корне (так его правят старые тесты: fakeCloud.db().sermons.s1), остальные — в spaces.
// Список на главной (listen) отдаёт строки-сводки, как cloud-api.mjs (fromSummary): без слайдов, с их числом.
// Замок (этап 6) — как в правилах: чужой живой замок не взять (редактор — с force), запись под чужим — 'lost-lock'.
// localStorage['fake-offline'] = '1' — «нет сети»: запись и замок отвечают ошибкой unavailable.
// Корзина (этап 9.1): у проповеди в корзине deletedAt (мс) и deletedBy; save и lock — ошибка 'trashed'; remove — только из корзины.
(function(){
  const KEY = 'fake-cloud';
  const load = () => (rootDb = JSON.parse(localStorage.getItem(KEY) || '{"members":{},"space":{"id":"sp1","name":"Тест","settings":{}},"sermons":{},"clock":1000}'));
  const store = db => localStorage.setItem(KEY, JSON.stringify(db));
  const listeners = new Set();
  let cb = null;
  const tick = db => { db.clock += 1000; return Date.now() + db.clock; };
  /* Пространство по id: первое — сам корень, остальные — db.spaces[id] (у них те же поля: space, members, sermons, slides, flags) */
  const S = (db, space) => {
    if (db.space && (!space || space === db.space.id)) return db;
    const x = (db.spaces || {})[space];
    if (!x) throw fail('permission-denied', 'Missing or insufficient permissions');
    x.members = x.members || {}; x.sermons = x.sermons || {};
    return x;
  };
  const allSp = db => (db.space ? [db] : []).concat(Object.values(db.spaces || {}));   // space: null — пространств нет совсем
  const view = (db, r) => ({ app:'swp-sermon', v:r.v, id:r.id, meta:r.meta, settings:r.settings, blocks:r.blocks, createdAt:r.createdAt, updatedAt:r.updatedAt,
    cloudSpace:db.space.id, cloudAt:r.updatedAt, cloudOwner:r.owner, cloudStatus:r.status, cloudBy:r.updatedBy, cloudShare:r.shareKey || '', lock:r.lock || null,
    deletedAt:r.deletedAt || 0, deletedBy:r.deletedBy || '' });
  /* Сводка, как summaryOf + fromSummary в cloud-api.mjs */
  const row = (db, r) => {
    const m = r.meta || {}, blocks = r.blocks || [], refs = [];
    blocks.forEach(b => { if (b && b.type === 'scripture') (b.items || []).forEach(it => { if (it && it.ref) refs.push(it.ref); }); });
    return { id:r.id, summary:true, meta:{ title:m.title || '', date:m.date || '', firstName:m.firstName || '', lastName:m.lastName || '', ...(m.series ? { series:m.series } : {}) },
      updatedAt:r.updatedAt, cloudSpace:db.space.id, cloudAt:r.updatedAt, cloudOwner:r.owner, cloudStatus:r.status, cloudBy:r.updatedBy,
      lock:r.lock || null, deletedAt:r.deletedAt || 0, deletedBy:r.deletedBy || '', slides:blocks.filter(b => b && b.type !== 'note' && b.type !== 'splash').length, refs:refs.join(' · ') };
  };
  const live = (db, l) => !!l && Date.now() < l.beat + ((db.space.settings || {}).lockMinutes || 10) * 60000;
  const fail = (code, message, extra) => Object.assign(new Error(message || code), { code }, extra);
  const offline = () => { if (localStorage.getItem('fake-offline') === '1') throw fail('unavailable', 'offline'); };
  const me = () => JSON.parse(localStorage.getItem('fake-user') || 'null');
  let rootDb = null;   // корень базы для проверки админа, пока функция работает с одним пространством
  const isAdmin = email => !!rootDb && (rootDb.admins || []).includes(email);
  const isEditor = (db, email) => { if (isAdmin(email)) return true; const m = db.members[email]; return !!m && (m.role === 'editor' || m.role === 'admin'); };   // оператор (этап 10.1.2) — не участник
  // «У редактора» (этап 7.3), как в правилах: автор не правит, не берёт замок, не меняет статус и не удаляет; сам ставит только draft / submitted
  const denied = () => fail('permission-denied', 'Missing or insufficient permissions');
  const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const atEditor = r => !!r && (r.status === 'work' || r.status === 'done' || r.status === 'ready');   // ready — «Презентация готова» (этап 9.7)
  const authorBlocked = (db, email, r, status) => !isEditor(db, email) && (atEditor(r) || (status != null && !['draft', 'submitted'].includes(status)));
  function notify(){ listeners.forEach(f => { try { f(); } catch(e){} }); }   // слушатель удалённого пространства молчит, как в Firestore
  window.addEventListener('storage', e => { if (e.key === KEY) notify(); });   // «база» общая у всех вкладок этого браузера: чужая запись доходит и сюда
  window.fakeCloud = {   // для тестов: «другой человек» правит базу напрямую
    db: load, put(db){ store(db); notify(); },
    calls: { save:0, lock:0, beat:0, release:0, flags:0, list:0 },
  };
  const calls = window.fakeCloud.calls;
  window.CROSSPECT_AUTOSAVE_MS = 3000;   // в форме автосохранение раз в 30 секунд, тестам столько ждать незачем
  window.CROSSPECT_FAKE_API = {
    explain: e => (e && e.message) || String(e),
    onUser(f){ cb = f; setTimeout(() => f(me()), 0); return () => {}; },
    async signIn(){ const u = JSON.parse(localStorage.getItem('fake-next-user') || '{"email":"admin@x.pl","name":"Админ"}'); localStorage.setItem('fake-user', JSON.stringify(u)); cb(u); },
    async signOut(){ localStorage.removeItem('fake-user'); cb(null); },
    async spacesOf(email){
      const out = [];
      allSp(load()).forEach(x => { const m = x.members && x.members[email]; if (m) out.push(Object.assign({ spaceId:x.space.id, email }, m)); });
      return out;
    },
    async getSpace(space){ const x = S(load(), space); return { name:x.space.name, settings:x.space.settings }; },
    async isAdmin(email){ load(); return isAdmin(email); },
    async allSpaces(){
      const db = load(), u = me();
      if (!u || !isAdmin(u.email)) throw fail('permission-denied', 'Missing or insufficient permissions');
      return allSp(db).map(x => ({ id:x.space.id, name:x.space.name, settings:x.space.settings || {} }));
    },
    listen(space, restrict, onList){
      calls.list++;
      const f = () => { const x = S(load(), space); onList(Object.values(x.sermons).filter(r => !restrict || r.owner === restrict).sort((a, b) => b.updatedAt - a.updatedAt).map(r => row(x, r)), false); };
      listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f);
    },
    watch(space, id, onDoc){
      const f = () => { const x = S(load(), space), r = x.sermons[id]; onDoc(r ? view(x, r) : null, { fromCache:false }); };
      listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f);
    },
    async get(space, id){ const x = S(load(), space), r = x.sermons[id]; return r ? view(x, r) : null; },
    async save(space, s, who, opts){
      calls.save++; offline();
      if (localStorage.getItem('fake-quota') === '1') throw fail('resource-exhausted', 'Облако перегружено до 9:00');   // дневной запас базы исчерпан
      opts = opts || {};
      const db = load(), x = S(db, space), cur = x.sermons[s.id], L = opts.lock || null, my = who.email;
      if (authorBlocked(x, my, cur && (s.cloudAt || opts.force) ? cur : null, opts.status)) throw denied();
      if (cur && cur.deletedAt) throw fail('trashed', 'Конспект в корзине', { remote:view(x, cur) });
      const body = JSON.parse(JSON.stringify({ v:s.v, meta:s.meta, settings:s.settings, blocks:(s.blocks || []).map(b => { const c = Object.assign({}, b); delete c.todo; delete c.done; return c; }) }));   // как content() в cloud-api.mjs
      if (cur && (s.cloudAt || opts.force)){
        const l = cur.lock || null, held = !!(L && L.at && l && l.email === my && l.at === L.at);
        if (L && l && !held && live(x, l)) throw fail('lost-lock', 'Проповедь сейчас правит другой', { lock:l, remote:view(x, cur) });
        const ownLater = held && cur.updatedAt >= l.at && cur.updatedBy === my;
        if (!opts.force && cur.updatedAt !== s.cloudAt && !ownLater) throw fail('conflict', 'В облаке проповедь успели изменить', { remote:view(x, cur) });
        const at = tick(db);
        Object.assign(cur, body, { updatedAt:at, updatedBy:my });
        if (opts.status) cur.status = opts.status;
        if (L) cur.lock = L.release ? null : held ? Object.assign({}, l, { beat:at }) : { email:my, name:L.name || my, at, beat:at };
      } else if (cur){
        throw fail('conflict', 'В облаке уже есть такая проповедь', { remote:view(x, cur) });
      } else {
        const at = tick(db);
        x.sermons[s.id] = Object.assign(body, { id:s.id, status:opts.status || 'draft', owner:opts.owner != null ? opts.owner : my, createdBy:my, createdAt:at, updatedAt:at, updatedBy:my,
          lock:L && !L.release ? { email:my, name:L.name || my, at, beat:at } : null });
      }
      store(db); notify(); return view(x, x.sermons[s.id]);
    },
    async lock(space, id, who, name, opts){
      calls.lock++; offline();
      opts = opts || {};
      const db = load(), x = S(db, space), cur = x.sermons[id], my = who.email;
      if (!cur) throw fail('missing', 'Этой проповеди уже нет в облаке');
      if (cur.deletedAt) throw fail('trashed', 'Конспект в корзине');
      if (authorBlocked(x, my, cur)) throw denied();
      const l = cur.lock || null, same = !!(l && l.email === my && opts.at && l.at === opts.at);
      if (l && !same && live(x, l)){
        if (!opts.force) throw fail('locked', 'Проповедь сейчас правят', { lock:l });
        if (l.email !== my && !isEditor(x, my)) throw fail('locked', 'Проповедь сейчас правят', { lock:l });
      }
      const at = tick(db), before = view(x, cur);
      cur.lock = { email:my, name:name || my, at:same ? l.at : at, beat:at };
      store(db);
      // как Firestore при открытом слушателе: перечитанная версия — ещё без нового замка, он приходит слушателю позже
      if (localStorage.getItem('fake-stale-lock') === '1'){ setTimeout(notify, 300); return before; }
      notify(); return view(x, cur);
    },
    async beat(space, id){
      calls.beat++; offline();
      const db = load(), x = S(db, space), cur = x.sermons[id], u = me();
      if (!cur || !cur.lock || !u || cur.lock.email !== u.email) throw fail('permission-denied', 'Missing or insufficient permissions');
      cur.lock.beat = tick(db);
      store(db); notify();
    },
    async release(space, id, who, at){
      calls.release++; offline();
      const db = load(), x = S(db, space), cur = x.sermons[id];
      if (cur && cur.lock && cur.lock.email === who.email && (!at || cur.lock.at === at)){ cur.lock = null; store(db); notify(); }
    },
    /* Отметки редактора: пишут только редактор и админ, читают все участники (этап 9.7), как в правилах */
    async getFlags(space, id){
      const db = load(), x = S(db, space), u = me();
      if (!u || (!isEditor(x, u.email) && !x.members[u.email])) return {};
      return JSON.parse(JSON.stringify((x.flags || {})[id] || {}));
    },
    async setFlags(space, id, who, flags){
      calls.flags++; offline();
      const db = load(), x = S(db, space);
      if (!isEditor(x, who.email)) throw fail('permission-denied', 'Missing or insufficient permissions');
      x.flags = x.flags || {}; x.flags[id] = JSON.parse(JSON.stringify(flags || {}));
      store(db);
    },
    /* Пространства, люди и серии (этап 10): заводит пространства и правит людей админ, серии — редактор и админ */
    async createSpace(who, name){
      calls.space = (calls.space || 0) + 1; offline();
      const db = load();
      if (!isAdmin(who.email)) throw denied();
      const id = 'sp' + (Object.keys(db.spaces || {}).length + 2) + 'n';
      db.spaces = db.spaces || {};
      db.spaces[id] = { space:{ id, name, settings:{ lockMinutes:10, preachersSeeAll:true } }, members:{}, sermons:{} };
      store(db); notify();
      return { id, name, settings:{ lockMinutes:10, preachersSeeAll:true } };
    },
    async updateSpace(space, who, fields){
      offline();
      const db = load(), x = S(db, space);
      if (!isAdmin(who.email)) throw denied();
      if (fields.name != null) x.space.name = fields.name;
      if (fields.lockMinutes != null) x.space.settings = Object.assign({}, x.space.settings, { lockMinutes:fields.lockMinutes });
      store(db); notify();
    },
    /* Люди (этапы 10 и 10.1.2): ключ — почта или p-<случайный> (без почты); правят админ и редактор; оператор — не участник */
    watchMembers(space, onList){
      const f = () => { const x = S(load(), space); onList(Object.keys(x.members).map(key => { const m = x.members[key];
        return { key, email:m.email || (key.includes('@') ? key : ''), role:m.role === 'admin' ? 'editor' : m.role === 'claude' ? 'operator' : m.role, firstName:m.firstName || '', lastName:m.lastName || '',
          tg:m.tg || '', seenAt:m.seenAt || 0, seen:!!m.seenAt }; })); };
      listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f);
    },
    async addMember(space, who, p){
      offline();
      const db = load(), x = S(db, space);
      if (!isEditor(x, who.email)) throw denied();
      const email = String(p.email || '').trim().toLowerCase(), key = email || 'p-' + Math.random().toString(36).slice(2, 14).padEnd(12, '0');
      if (x.members[key]) throw fail('exists', 'Человек с такой почтой уже есть');
      x.members[key] = Object.assign({ role:p.role, firstName:p.firstName || '', lastName:p.lastName || '' }, email ? { email } : {}, p.tg ? { tg:p.tg } : {});
      store(db); notify();
      return key;
    },
    async updateMember(space, key, fields){
      offline();
      const db = load(), x = S(db, space), u = me();
      if (!u || !isEditor(x, u.email) || !x.members[key]) throw denied();
      Object.assign(x.members[key], fields);
      if (fields.tg === '') delete x.members[key].tg;
      store(db); notify();
    },
    async setMemberEmail(space, who, key, email){
      calls.move = (calls.move || 0) + 1; offline();
      const db = load(), x = S(db, space);
      if (!isEditor(x, who.email) || !x.members[key]) throw denied();
      email = String(email || '').trim().toLowerCase();
      const next = email || 'p-' + Math.random().toString(36).slice(2, 14).padEnd(12, '0');
      if (next === key) return key;
      if (x.members[next]) throw fail('exists', 'Человек с такой почтой уже есть');
      const m = Object.assign({}, x.members[key]);
      delete m.seenAt; delete m.email;
      if (email) m.email = email;
      delete x.members[key]; x.members[next] = m;
      store(db); notify();
      return next;
    },
    async removeMember(space, key){
      offline();
      const db = load(), x = S(db, space), u = me();
      if (!u || !isEditor(x, u.email)) throw denied();
      delete x.members[key];
      store(db); notify();
    },
    /* Последний вход (этап 10.1.2) — при каждом входе */
    async markSeen(space, email){
      calls.seen = (calls.seen || 0) + 1;
      const db = load(), x = S(db, space);
      if (x.members[email]){ x.members[email].seenAt = Date.now(); store(db); notify(); }
    },
    /* Операторы этапа 10.1 (x.operators) → люди с ролью operator; запись операторов удаляется */
    async migrateOperators(space, who){
      calls.migrate = (calls.migrate || 0) + 1;
      const db = load(), x = S(db, space);
      if (x.operators === undefined) return 0;
      if (!isEditor(x, who.email)) throw denied();
      const have = new Set(Object.values(x.members).map(m => (m.tg || '').toLowerCase()).filter(Boolean));
      let n = 0;
      Object.keys(x.operators).sort().forEach(id => {
        const o = x.operators[id], name = String(o.name || '').trim(), sp = name.indexOf(' ');
        if (!o.tg || have.has(o.tg.toLowerCase())) return;
        x.members['p-mig' + id.toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(6, '0')] = { role:'operator', firstName:sp < 0 ? name : name.slice(0, sp), lastName:sp < 0 ? '' : name.slice(sp + 1), tg:o.tg };
        have.add(o.tg.toLowerCase()); n++;
      });
      delete x.operators;
      store(db); notify();
      return n;
    },
    async spaceUsage(space){
      const x = S(load(), space), series = {};
      Object.values(x.sermons).forEach(r => { const id = r.meta && r.meta.series; if (id) series[id] = (series[id] || 0) + 1; });
      return { sermons:Object.keys(x.sermons).length, series };
    },
    async deleteSpace(space){
      calls.delSpace = (calls.delSpace || 0) + 1; offline();
      const db = load(), x = S(db, space), u = me();
      if (!u || !isAdmin(u.email)) throw denied();
      const n = Object.keys(x.sermons).length;
      if (n) throw fail('not-empty', 'В пространстве есть конспекты', { count:n });
      if (x === db){ db.space = null; db.members = {}; db.series = {}; delete db.slides; }   // первое пространство лежит в корне
      else delete db.spaces[space];
      store(db); notify();
    },
    watchSeries(space, onSeries){
      const f = () => { const x = S(load(), space); onSeries(JSON.parse(JSON.stringify(x.series || {}))); };
      listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f);
    },
    async setSeries(space, who, series){
      calls.series = (calls.series || 0) + 1; offline();
      const db = load(), x = S(db, space);
      if (!isEditor(x, who.email)) throw denied();
      x.series = JSON.parse(JSON.stringify(series || {}));
      store(db); notify();
    },
    /* Настройки слайдов пространства: читают все, пишут редактор и админ */
    watchSlides(space, onCfg){
      const f = () => { const db = load(), x = S(db, space); onCfg(x.slides ? JSON.parse(JSON.stringify(x.slides)) : null); };
      listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f);
    },
    async getSlides(space){ const db = load(), x = S(db, space); return x.slides ? JSON.parse(JSON.stringify(x.slides)) : null; },
    async setSlides(space, who, slides){
      calls.slides = (calls.slides || 0) + 1; offline();
      const db = load(), x = S(db, space);
      if (!isEditor(x, who.email)) throw fail('permission-denied', 'Missing or insufficient permissions');
      x.slides = JSON.parse(JSON.stringify(slides || {}));
      store(db); notify();
    },
    /* Статус отдельно от содержимого (этап 7.2): замок свободен или мой; чужой истёкший — снимается */
    async setStatus(space, id, who, status){
      calls.status = (calls.status || 0) + 1; offline();
      const db = load(), x = S(db, space), cur = x.sermons[id], my = who.email;
      if (!cur) throw fail('missing', 'Этой проповеди уже нет в облаке');
      const l = cur.lock || null;
      if (l && l.email !== my && live(x, l)) throw fail('locked', 'Проповедь сейчас правят', { lock:l });
      if (!isEditor(x, my) && (cur.owner !== my || atEditor(cur) || !['draft', 'submitted'].includes(status))) throw fail('permission-denied', 'Missing or insufficient permissions');
      if (l && l.email !== my) cur.lock = null;
      Object.assign(cur, { status, updatedAt:tick(db), updatedBy:my });
      store(db); notify(); return view(x, cur);
    },
    /* Фотобанк (этап 10.5.2): db.bankPeople[id], db.bankPhotos[id] (thumb — base64), db.bankFiles[id] (base64);
       читают все вошедшие, пишет только админ. calls.bankFile — сколько раз картинку качали из «базы» */
    watchBank(onData){
      const f = () => {
        const db = load(), ph = {};
        Object.entries(db.bankPhotos || {}).forEach(([id, x]) => { ph[id] = Object.assign({}, x, { thumb:x.thumb ? fromB64(x.thumb) : null }); });
        onData('people', JSON.parse(JSON.stringify(db.bankPeople || {}))); onData('photos', ph);
      };
      listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f);
    },
    async bankFile(id){ calls.bankFile = (calls.bankFile || 0) + 1; offline(); const x = (load().bankFiles || {})[id]; return x ? fromB64(x) : null; },
    async setBankPerson(who, id, fields){
      calls.bank = (calls.bank || 0) + 1; offline();
      const db = load(); if (!isAdmin(who.email)) throw denied();
      db.bankPeople = db.bankPeople || {}; db.bankPeople[id] = Object.assign(db.bankPeople[id] || {}, JSON.parse(JSON.stringify(fields)), { updatedBy:who.email });
      store(db); notify();
    },
    async addBankPhoto(who, id, meta, img, thumb){
      calls.bank = (calls.bank || 0) + 1; offline();
      const db = load(); if (!isAdmin(who.email)) throw denied();
      if (img.length > 900 * 1024) throw fail('invalid-argument', 'too big');
      db.bankPhotos = db.bankPhotos || {}; db.bankFiles = db.bankFiles || {};
      db.bankPhotos[id] = Object.assign(JSON.parse(JSON.stringify(meta)), { thumb:toB64(thumb), updatedBy:who.email });
      if (meta.kind !== 'cut') delete db.bankPhotos[id].faces;
      db.bankFiles[id] = toB64(img);
      store(db); notify();
    },
    async setBankPhotos(who, changes){
      calls.bank = (calls.bank || 0) + 1; offline();
      const db = load(); if (!isAdmin(who.email)) throw denied();
      Object.entries(changes).forEach(([id, f]) => { if (db.bankPhotos && db.bankPhotos[id]) Object.assign(db.bankPhotos[id], JSON.parse(JSON.stringify(f))); });
      store(db); notify();
    },
    async removeBank(who, ids, person){
      calls.bank = (calls.bank || 0) + 1; offline();
      const db = load(); if (!isAdmin(who.email)) throw denied();
      ids.forEach(id => { delete (db.bankPhotos || {})[id]; delete (db.bankFiles || {})[id]; });
      if (person) delete (db.bankPeople || {})[person];
      store(db); notify();
    },
    /* Настройки экрана человека (этап 7.2): у каждой почты своя запись */
    async getPrefs(who){ offline(); const db = load(); const p = (db.prefs || {})[who.email]; return p ? JSON.parse(JSON.stringify(p)) : null; },
    async setPrefs(who, layout){
      calls.prefs = (calls.prefs || 0) + 1; offline();
      const db = load(); db.prefs = db.prefs || {}; db.prefs[who.email] = JSON.parse(JSON.stringify(layout || {}));
      store(db);
    },
    /* Ссылка для оператора (этап 9): снимок — в корне базы, db.shares[ключ] = { spaceId, sermonId, sermon, createdBy, updatedAt };
       читает кто угодно (в том числе без входа). Создать и отключить — запись проповеди, как смена статуса (замок свободен или мой). */
    watchShare(key, onShare){
      const f = () => { const sh = (load().shares || {})[key]; onShare(sh ? { sermon:JSON.parse(JSON.stringify(sh.sermon)), updatedAt:sh.updatedAt } : null, { fromCache:false }); };
      listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f);
    },
    async shareOn(space, id, who, key, snapshot){
      calls.shareOn = (calls.shareOn || 0) + 1; offline();
      const db = load(), x = S(db, space), cur = x.sermons[id], my = who.email;
      if (!cur) throw fail('missing', 'Этого конспекта уже нет в облаке');
      const l = cur.lock || null;
      if (l && l.email !== my && live(x, l)) throw fail('locked', 'Конспект сейчас правят', { lock:l });
      if (!isEditor(x, my) && (cur.owner !== my || atEditor(cur))) throw denied();
      db.shares = db.shares || {};
      const at = tick(db), used = cur.shareKey || key;
      const sh = db.shares[used];
      db.shares[used] = { spaceId:space, sermonId:id, sermon:JSON.parse(JSON.stringify(snapshot)), createdBy:sh ? sh.createdBy : my, updatedAt:at };
      if (!cur.shareKey){ Object.assign(cur, { shareKey:used, updatedAt:at, updatedBy:my }); if (l && l.email !== my) cur.lock = null; }
      store(db); notify(); return { key:used, remote:view(x, cur) };
    },
    async shareOff(space, id, who){
      calls.shareOff = (calls.shareOff || 0) + 1; offline();
      const db = load(), x = S(db, space), cur = x.sermons[id], my = who.email;
      if (!cur) throw fail('missing', 'Этого конспекта уже нет в облаке');
      if (!cur.shareKey) return view(x, cur);
      const l = cur.lock || null;
      if (l && l.email !== my && live(x, l)) throw fail('locked', 'Конспект сейчас правят', { lock:l });
      if (!isEditor(x, my) && (cur.owner !== my || atEditor(cur))) throw denied();
      if (db.shares) delete db.shares[cur.shareKey];
      delete cur.shareKey; Object.assign(cur, { updatedAt:tick(db), updatedBy:my });
      if (l && l.email !== my) cur.lock = null;
      store(db); notify(); return view(x, cur);
    },
    async shareSync(key, snapshot){
      calls.shareSync = (calls.shareSync || 0) + 1; offline();
      const db = load(); const sh = (db.shares || {})[key];
      if (!sh) throw fail('not-found', 'No document to update');
      sh.sermon = JSON.parse(JSON.stringify(snapshot)); sh.updatedAt = tick(db);
      store(db); notify();
    },
    /* Корзина (этап 9.1), как в правилах: автор — только свой черновик, редактор и админ — любую; под чужим живым замком — нельзя */
    async trash(space, id, who){
      calls.trash = (calls.trash || 0) + 1; offline();
      const db = load(), x = S(db, space), cur = x.sermons[id], my = who.email;
      if (!cur) throw fail('missing', 'Этого конспекта уже нет в облаке');
      if (cur.deletedAt) return { shareKey:cur.shareKey || '' };
      if (!isEditor(x, my) && (cur.owner !== my || cur.status !== 'draft')) throw denied();
      const l = cur.lock || null;
      if (l && l.email !== my && live(x, l)) throw fail('locked', 'Конспект сейчас правят', { lock:l });
      if (cur.shareKey && db.shares) delete db.shares[cur.shareKey];   // снимок уходит, ключ остаётся
      Object.assign(cur, { deletedAt:Date.now(), deletedBy:my, lock:null });
      store(db); notify(); return { shareKey:cur.shareKey || '' };
    },
    async restore(space, id){
      calls.restore = (calls.restore || 0) + 1; offline();
      const db = load(), x = S(db, space), cur = x.sermons[id], u = me();
      if (!cur) throw fail('missing', 'Этого конспекта уже нет в облаке');
      if (!cur.deletedAt) return view(x, cur);
      if (!u || (!isEditor(x, u.email) && (cur.owner !== u.email || cur.status !== 'draft'))) throw denied();
      delete cur.deletedAt; delete cur.deletedBy;
      store(db); notify(); return view(x, cur);
    },
    async remove(space, id){
      calls.remove = (calls.remove || 0) + 1; offline();
      const db = load(), x = S(db, space), u = me(), cur = x.sermons[id];
      if (cur && !cur.deletedAt) throw denied();   // насовсем — только из корзины (этап 9.1)
      if (u && cur && !isEditor(x, u.email) && (cur.owner !== u.email || cur.status !== 'draft')) throw denied();   // автор удаляет только свой черновик
      const key = cur && cur.shareKey;
      if (key && db.shares) delete db.shares[key];   // ссылка для оператора уходит вместе с конспектом
      delete x.sermons[id]; if (x.flags) delete x.flags[id]; if (x.versions) delete x.versions[id]; store(db); notify(); },
    /* История сохранений (этап 9.7): x.versions[id] = [копии, новые сверху]; видят и пишут те, кто может править */
    async addVersion(space, s, who, opts){
      calls.versions = (calls.versions || 0) + 1; offline();
      const db = load(), x = S(db, space), cur = x.sermons[s.id], my = who.email;
      if (!cur || (!isEditor(x, my) && (cur.owner !== my || atEditor(cur) || cur.deletedAt))) throw denied();
      const body = JSON.parse(JSON.stringify({ v:s.v || 2, meta:s.meta, settings:s.settings || {}, blocks:(s.blocks || []).map(b => { const c = Object.assign({}, b); delete c.todo; delete c.done; return c; }) }));
      x.versions = x.versions || {}; const list = x.versions[s.id] = x.versions[s.id] || [];
      const key = v => JSON.stringify({ meta:v.meta, settings:v.settings, blocks:v.blocks });
      if (list.length && key(list[0]) === key(body)) return null;
      list.unshift(Object.assign(body, { id:'v' + tick(db), status:s.cloudStatus || 'draft', savedAt:Date.now() + db.clock, savedBy:my, name:(opts && opts.name) || '' }));
      list.splice((opts && opts.keep) || 10);
      store(db); return JSON.parse(JSON.stringify(list));
    },
    async versions(space, id){
      const db = load(), x = S(db, space), cur = x.sermons[id], u = me();
      if (!cur || !u || (!isEditor(x, u.email) && cur.owner !== u.email)) throw denied();
      return JSON.parse(JSON.stringify((x.versions || {})[id] || []));
    },
  };
})();
