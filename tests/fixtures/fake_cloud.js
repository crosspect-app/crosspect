// Подмена облака для тестов формы: та же форма ответов, что у cloud/js/cloud-api.mjs, но «база» — в localStorage страницы.
// Состояние: localStorage['fake-cloud'] = { members:{email:{spaceId,role,firstName,lastName}}, space:{id,name,settings}, sermons:{id:{...}}, clock }.
(function(){
  const KEY = 'fake-cloud';
  const load = () => JSON.parse(localStorage.getItem(KEY) || '{"members":{},"space":{"id":"sp1","name":"Тест","settings":{}},"sermons":{},"clock":1000}');
  const store = db => localStorage.setItem(KEY, JSON.stringify(db));
  const listeners = new Set();
  let cb = null;
  const tick = db => { db.clock += 1000; return Date.now() + db.clock; };
  const view = (db, r) => ({ app:'swp-sermon', v:r.v, id:r.id, meta:r.meta, settings:r.settings, blocks:r.blocks, createdAt:r.createdAt, updatedAt:r.updatedAt,
    cloudSpace:db.space.id, cloudAt:r.updatedAt, cloudOwner:r.owner, cloudStatus:r.status, cloudBy:r.updatedBy });
  function notify(){ listeners.forEach(f => f()); }
  window.fakeCloud = {   // для тестов: «другой человек» правит базу напрямую
    db: load, put(db){ store(db); notify(); },
  };
  window.CROSSPECT_FAKE_API = {
    explain: e => (e && e.message) || String(e),
    onUser(f){ cb = f; setTimeout(() => f(JSON.parse(localStorage.getItem('fake-user') || 'null')), 0); return () => {}; },
    async signIn(){ const u = JSON.parse(localStorage.getItem('fake-next-user') || '{"email":"admin@x.pl","name":"Админ"}'); localStorage.setItem('fake-user', JSON.stringify(u)); cb(u); },
    async signOut(){ localStorage.removeItem('fake-user'); cb(null); },
    async spacesOf(email){ const db = load(), m = db.members[email]; return m ? [Object.assign({ spaceId:db.space.id, email }, m)] : []; },
    async getSpace(){ const db = load(); return { name:db.space.name, settings:db.space.settings }; },
    listen(space, restrict, onList){
      const f = () => { const db = load(); onList(Object.values(db.sermons).filter(r => !restrict || r.owner === restrict).sort((a, b) => b.updatedAt - a.updatedAt).map(r => view(db, r)), false); };
      listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f);
    },
    async get(space, id){ const db = load(), r = db.sermons[id]; return r ? view(db, r) : null; },
    async save(space, s, me, opts){
      const db = load(), cur = db.sermons[s.id];
      if (cur && !(opts && opts.force) && cur.updatedAt !== (s.cloudAt || 0)){ const e = new Error('В облаке проповедь успели изменить'); e.code = 'conflict'; e.remote = view(db, cur); throw e; }
      const body = JSON.parse(JSON.stringify({ v:s.v, meta:s.meta, settings:s.settings, blocks:s.blocks }));
      const at = tick(db);
      db.sermons[s.id] = cur ? Object.assign(cur, body, { updatedAt:at, updatedBy:me.email })
        : Object.assign(body, { id:s.id, status:'draft', owner:me.email, createdBy:me.email, createdAt:at, updatedAt:at, updatedBy:me.email });
      store(db); notify(); return view(db, db.sermons[s.id]);
    },
    async remove(space, id){ const db = load(); delete db.sermons[id]; store(db); notify(); },
  };
})();
