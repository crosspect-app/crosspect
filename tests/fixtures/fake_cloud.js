// Подмена облака для тестов формы: та же форма ответов, что у js/cloud-api.mjs, но «база» — в localStorage страницы.
// Состояние: localStorage['fake-cloud'] = { members:{email:{spaceId,role,firstName,lastName}}, space:{id,name,settings}, sermons:{id:{...}}, clock }.
// Замок (этап 6) — как в правилах: чужой живой замок не взять (редактор — с force), запись под чужим — 'lost-lock'.
// localStorage['fake-offline'] = '1' — «нет сети»: запись и замок отвечают ошибкой unavailable.
(function(){
  const KEY = 'fake-cloud';
  const load = () => JSON.parse(localStorage.getItem(KEY) || '{"members":{},"space":{"id":"sp1","name":"Тест","settings":{}},"sermons":{},"clock":1000}');
  const store = db => localStorage.setItem(KEY, JSON.stringify(db));
  const listeners = new Set();
  let cb = null;
  const tick = db => { db.clock += 1000; return Date.now() + db.clock; };
  const view = (db, r) => ({ app:'swp-sermon', v:r.v, id:r.id, meta:r.meta, settings:r.settings, blocks:r.blocks, createdAt:r.createdAt, updatedAt:r.updatedAt,
    cloudSpace:db.space.id, cloudAt:r.updatedAt, cloudOwner:r.owner, cloudStatus:r.status, cloudBy:r.updatedBy, lock:r.lock || null });
  const live = (db, l) => !!l && Date.now() < l.beat + ((db.space.settings || {}).lockMinutes || 10) * 60000;
  const fail = (code, message, extra) => Object.assign(new Error(message || code), { code }, extra);
  const offline = () => { if (localStorage.getItem('fake-offline') === '1') throw fail('unavailable', 'offline'); };
  const me = () => JSON.parse(localStorage.getItem('fake-user') || 'null');
  const isEditor = (db, email) => { const m = db.members[email]; return !!m && m.role !== 'preacher'; };
  function notify(){ listeners.forEach(f => f()); }
  window.fakeCloud = {   // для тестов: «другой человек» правит базу напрямую
    db: load, put(db){ store(db); notify(); },
    calls: { save:0, lock:0, beat:0, release:0, flags:0 },
  };
  const calls = window.fakeCloud.calls;
  window.CROSSPECT_AUTOSAVE_MS = 3000;   // в форме автосохранение раз в 30 секунд, тестам столько ждать незачем
  window.CROSSPECT_FAKE_API = {
    explain: e => (e && e.message) || String(e),
    onUser(f){ cb = f; setTimeout(() => f(me()), 0); return () => {}; },
    async signIn(){ const u = JSON.parse(localStorage.getItem('fake-next-user') || '{"email":"admin@x.pl","name":"Админ"}'); localStorage.setItem('fake-user', JSON.stringify(u)); cb(u); },
    async signOut(){ localStorage.removeItem('fake-user'); cb(null); },
    async spacesOf(email){ const db = load(), m = db.members[email]; return m ? [Object.assign({ spaceId:db.space.id, email }, m)] : []; },
    async getSpace(){ const db = load(); return { name:db.space.name, settings:db.space.settings }; },
    listen(space, restrict, onList){
      const f = () => { const db = load(); onList(Object.values(db.sermons).filter(r => !restrict || r.owner === restrict).sort((a, b) => b.updatedAt - a.updatedAt).map(r => view(db, r)), false); };
      listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f);
    },
    watch(space, id, onDoc){
      const f = () => { const db = load(), r = db.sermons[id]; onDoc(r ? view(db, r) : null, { fromCache:false }); };
      listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f);
    },
    async get(space, id){ const db = load(), r = db.sermons[id]; return r ? view(db, r) : null; },
    async save(space, s, who, opts){
      calls.save++; offline();
      if (localStorage.getItem('fake-quota') === '1') throw fail('resource-exhausted', 'Облако перегружено до 9:00');   // дневной запас базы исчерпан
      opts = opts || {};
      const db = load(), cur = db.sermons[s.id], L = opts.lock || null, my = who.email;
      const body = JSON.parse(JSON.stringify({ v:s.v, meta:s.meta, settings:s.settings, blocks:(s.blocks || []).map(b => { const c = Object.assign({}, b); delete c.todo; delete c.done; return c; }) }));   // как content() в cloud-api.mjs
      if (cur && (s.cloudAt || opts.force)){
        const l = cur.lock || null, held = !!(L && L.at && l && l.email === my && l.at === L.at);
        if (L && l && !held && live(db, l)) throw fail('lost-lock', 'Проповедь сейчас правит другой', { lock:l, remote:view(db, cur) });
        const ownLater = held && cur.updatedAt >= l.at && cur.updatedBy === my;
        if (!opts.force && cur.updatedAt !== s.cloudAt && !ownLater) throw fail('conflict', 'В облаке проповедь успели изменить', { remote:view(db, cur) });
        const at = tick(db);
        Object.assign(cur, body, { updatedAt:at, updatedBy:my });
        if (opts.status) cur.status = opts.status;
        if (L) cur.lock = L.release ? null : held ? Object.assign({}, l, { beat:at }) : { email:my, name:L.name || my, at, beat:at };
      } else if (cur){
        throw fail('conflict', 'В облаке уже есть такая проповедь', { remote:view(db, cur) });
      } else {
        const at = tick(db);
        db.sermons[s.id] = Object.assign(body, { id:s.id, status:opts.status || 'draft', owner:opts.owner != null ? opts.owner : my, createdBy:my, createdAt:at, updatedAt:at, updatedBy:my,
          lock:L && !L.release ? { email:my, name:L.name || my, at, beat:at } : null });
      }
      store(db); notify(); return view(db, db.sermons[s.id]);
    },
    async lock(space, id, who, name, opts){
      calls.lock++; offline();
      opts = opts || {};
      const db = load(), cur = db.sermons[id], my = who.email;
      if (!cur) throw fail('missing', 'Этой проповеди уже нет в облаке');
      const l = cur.lock || null, same = !!(l && l.email === my && opts.at && l.at === opts.at);
      if (l && !same && live(db, l)){
        if (!opts.force) throw fail('locked', 'Проповедь сейчас правят', { lock:l });
        if (l.email !== my && !isEditor(db, my)) throw fail('locked', 'Проповедь сейчас правят', { lock:l });
      }
      const at = tick(db), before = view(db, cur);
      cur.lock = { email:my, name:name || my, at:same ? l.at : at, beat:at };
      store(db);
      // как Firestore при открытом слушателе: перечитанная версия — ещё без нового замка, он приходит слушателю позже
      if (localStorage.getItem('fake-stale-lock') === '1'){ setTimeout(notify, 300); return before; }
      notify(); return view(db, cur);
    },
    async beat(space, id){
      calls.beat++; offline();
      const db = load(), cur = db.sermons[id], u = me();
      if (!cur || !cur.lock || !u || cur.lock.email !== u.email) throw fail('permission-denied', 'Missing or insufficient permissions');
      cur.lock.beat = tick(db);
      store(db); notify();
    },
    async release(space, id, who, at){
      calls.release++; offline();
      const db = load(), cur = db.sermons[id];
      if (cur && cur.lock && cur.lock.email === who.email && (!at || cur.lock.at === at)){ cur.lock = null; store(db); notify(); }
    },
    /* Отметки редактора: только редактор и админ, как в правилах */
    async getFlags(space, id){
      const db = load(), u = me();
      if (!u || !isEditor(db, u.email)) return {};
      return JSON.parse(JSON.stringify((db.flags || {})[id] || {}));
    },
    async setFlags(space, id, who, flags){
      calls.flags++; offline();
      const db = load();
      if (!isEditor(db, who.email)) throw fail('permission-denied', 'Missing or insufficient permissions');
      db.flags = db.flags || {}; db.flags[id] = JSON.parse(JSON.stringify(flags || {}));
      store(db);
    },
    /* Настройки слайдов пространства: читают все, пишут редактор и админ */
    watchSlides(space, onCfg){
      const f = () => { const db = load(); onCfg(db.slides ? JSON.parse(JSON.stringify(db.slides)) : null); };
      listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f);
    },
    async getSlides(space){ const db = load(); return db.slides ? JSON.parse(JSON.stringify(db.slides)) : null; },
    async setSlides(space, who, slides){
      calls.slides = (calls.slides || 0) + 1; offline();
      const db = load();
      if (!isEditor(db, who.email)) throw fail('permission-denied', 'Missing or insufficient permissions');
      db.slides = JSON.parse(JSON.stringify(slides || {}));
      store(db); notify();
    },
    async remove(space, id){ const db = load(); delete db.sermons[id]; if (db.flags) delete db.flags[id]; store(db); notify(); },
  };
})();
