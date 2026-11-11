// Связь формы с облаком (Firebase: вход Google + Cloud Firestore).
// Не знает ничего о странице: получает уже подключённый Firebase (`fb`) и отдаёт простые функции.
// Поэтому тот же файл проверяется в эмуляторе (cloud/tests/client.test.mjs) без браузера.
//
// fb = { auth, db, A (модуль firebase/auth), F (модуль firebase/firestore) }
// Права проверяет база (cloud/firestore.rules): что бы ни сделал этот код, чужого она не отдаст и не примет.
//
// Замок (этап 6): lock = { email, name, at — когда взят, beat — последний сигнал «я здесь» }, время ставит сервер.
// Форма знает «свой» замок по паре почта + at: другая вкладка той же почты берёт замок заново, и at меняется.

const MAX_LIST = 200;               // сколько проповедей показывать на главной
const MAX_BYTES = 900 * 1024;       // документ в Firestore — до 1 МиБ; предупреждаем заранее

export function createCloudAPI(fb){
  const { auth, db, A, F } = fb;
  const col = space => F.collection(db, 'spaces', space, 'sermons');
  const ref = (space, id) => F.doc(db, 'spaces', space, 'sermons', id);
  const lower = e => String(e || '').trim().toLowerCase();
  const ms = t => (t && typeof t.toMillis === 'function' ? t.toMillis() : 0);
  const err = (code, message, extra) => Object.assign(new Error(message || code), { code }, extra);
  const lockOf = l => (l && l.email ? { email: lower(l.email), name: l.name || '', at: ms(l.at), beat: ms(l.beat) } : null);
  /* Жив ли замок по часам этого компьютера (окончательно решает база по своим часам) */
  const live = (l, minutes) => !!l && Date.now() < l.beat + (minutes || 10) * 60000;
  const denied = e => /permission-denied/.test((e && e.code) || '');

  /* Документ → проповедь в том виде, как её хранит форма (id, миллисекунды), плюс облачные поля */
  function fromDoc(space, snap, opt){
    const d = snap.data(opt);
    return {
      app: 'swp-sermon', v: d.v, id: snap.id,
      meta: d.meta || {}, settings: d.settings || {}, blocks: d.blocks || [],
      createdAt: ms(d.createdAt), updatedAt: ms(d.updatedAt),
      cloudSpace: space, cloudAt: ms(d.updatedAt), cloudOwner: d.owner || '',
      cloudStatus: d.status || 'draft', cloudBy: d.updatedBy || '',
      lock: lockOf(d.lock),
    };
  }
  /* Проповедь формы → поля документа: без undefined и без лишнего (Firestore не принимает undefined) */
  function content(s){
    const m = s.meta || {};
    return JSON.parse(JSON.stringify({
      v: s.v || 2,
      meta: { title: m.title || '', date: m.date || '', firstName: m.firstName || '', lastName: m.lastName || '' },
      settings: s.settings || {},
      blocks: s.blocks || [],
    }));
  }

  return {
    MAX_BYTES,

    /* ----- вход ----- */
    onUser(cb){ return A.onAuthStateChanged(auth, u => cb(u ? { email: lower(u.email), name: u.displayName || '', photo: u.photoURL || '' } : null)); },
    async signIn(){
      const p = new A.GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      await A.signInWithPopup(auth, p);
    },
    signOut(){ return A.signOut(auth); },

    /* ----- пространство ----- */
    /* В каких пространствах эта почта состоит (запрос по всем «members», индекс есть) */
    async spacesOf(email){
      const snap = await F.getDocs(F.query(F.collectionGroup(db, 'members'), F.where('email', '==', lower(email))));
      return snap.docs.map(d => Object.assign({ spaceId: d.ref.parent.parent.id }, d.data()));
    },
    async getSpace(space){
      const snap = await F.getDoc(F.doc(db, 'spaces', space));
      return snap.exists() ? snap.data() : null;
    },

    /* ----- проповеди ----- */
    /* Живой список. restrictTo — почта: проповедник, которому не открыты чужие проповеди, спрашивает только свои
       (иначе база отклонит весь запрос). Возвращает функцию «перестать слушать». */
    listen(space, restrictTo, onList, onError){
      const q = restrictTo
        ? F.query(col(space), F.where('owner', '==', lower(restrictTo)), F.limit(MAX_LIST))
        : F.query(col(space), F.orderBy('updatedAt', 'desc'), F.limit(MAX_LIST));
      return F.onSnapshot(q, snap => {
        onList(snap.docs.filter(d => d.data().updatedAt).map(d => fromDoc(space, d, { serverTimestamps: 'estimate' })), snap.metadata.fromCache);
      }, onError);
    },
    async get(space, id){
      const snap = await F.getDoc(ref(space, id));
      return snap.exists() ? fromDoc(space, snap) : null;
    },

    /* Живая проповедь: onDoc(проповедь | null, { fromCache }) на каждое изменение, в том числе замка.
       Возвращает функцию «перестать слушать». */
    watch(space, id, onDoc, onError){
      return F.onSnapshot(ref(space, id), snap => {
        onDoc(snap.exists() ? fromDoc(space, snap, { serverTimestamps: 'estimate' }) : null, { fromCache: snap.metadata.fromCache });
      }, onError);
    },

    /* Сохранить. Новая проповедь создаётся, существующая обновляется, но только если с тех пор, как форма
       её читала (baseAt), в облаке ничего не менялось. Иначе — ошибка 'conflict' с облачной версией:
       форма спросит человека. force: true — всё равно заменить. Возвращает новую облачную версию.
       lock: { name, at, release, minutes } — правка под замком (этап 6): at — мой замок (мс), 0 — замка ещё нет.
         Под моим замком запись продлевает его; release: true — отпускает. Если замок теперь чужой и живой —
         ошибка 'lost-lock' ({ lock, remote }), ничего не записано. Пока замок мой, свои же прежние записи
         (например, дошедшие после обрыва связи) конфликтом не считаются. */
    async save(space, s, me, opts){
      opts = opts || {};
      const body = content(s);
      if (new TextEncoder().encode(JSON.stringify(body)).length * 1.1 > MAX_BYTES) throw err('too-big', 'Проповедь слишком большая для облака');
      const r = ref(space, s.id), my = lower(me.email), L = opts.lock || null, ts = F.serverTimestamp();
      const stamp = { updatedAt: ts, updatedBy: my };
      const newLock = () => ({ email: my, name: String(L.name || my).slice(0, 200), at: ts, beat: ts });
      const fresh = () => Object.assign({}, body, stamp, {
        status: 'draft', owner: lower(opts.owner != null ? opts.owner : me.email),
        createdBy: my, createdAt: ts,
      }, L && !L.release ? { lock: newLock() } : {});
      if (s.cloudAt || opts.force){
        // проповедь уже в облаке: обновляем, если с тех пор её никто не менял (или человек велел заменить)
        await F.runTransaction(db, async tx => {
          const cur = await tx.get(r);
          if (!cur.exists()) { tx.set(r, fresh()); return; }
          const d = cur.data(), at = ms(d.updatedAt), l = lockOf(d.lock);
          const held = !!(L && L.at && l && l.email === my && l.at === L.at);   // замок взят этой вкладкой и всё ещё её
          if (L && l && !held && live(l, L.minutes)) throw err('lost-lock', 'Проповедь сейчас правит другой', { lock: l, remote: fromDoc(space, cur) });
          const ownLater = held && at >= l.at && d.updatedBy === my;   // версия новее моей, но записана мной же под моим замком
          if (!opts.force && at !== s.cloudAt && !ownLater) throw err('conflict', 'В облаке проповедь успели изменить', { remote: fromDoc(space, cur) });
          const upd = Object.assign({}, body, stamp);
          if (L){
            if (L.release) upd.lock = null;
            else if (held) upd['lock.beat'] = ts;
            else upd.lock = newLock();   // замка нет или он истёк: берём заново
          }
          tx.update(r, upd);
        });
      } else {
        // новая или из файла: если такая уже есть — не затираем. Чтение несуществующей проповеди проповеднику в закрытом
        // пространстве база отказывает (permission-denied) — это не ошибка: создаём, а чужую запись правила всё равно не пустят
        let cur = null;
        try { cur = await F.getDocFromServer(r); }
        catch (e) { if (!denied(e)) throw e; }
        if (cur && cur.exists()) throw err('conflict', 'В облаке уже есть такая проповедь', { remote: fromDoc(space, cur) });
        await F.setDoc(r, fresh());
      }
      const back = await F.getDocFromServer(r);   // время ставит сервер: читаем его обратно
      return fromDoc(space, back);
    },

    /* Взять замок, чтобы править. Чужой живой замок — ошибка 'locked' ({ lock }); force: true — забрать
       (чужой — только редактор, так решает база; свой из другой вкладки — любой). at — мой прежний замок (мс):
       если он всё ещё мой, время начала сохраняется (перезагрузка страницы). Возвращает проповедь с замком. */
    async lock(space, id, me, name, opts){
      opts = opts || {};
      const r = ref(space, id), my = lower(me.email), ts = F.serverTimestamp();
      let seen = null;
      try {
        await F.runTransaction(db, async tx => {
          const cur = await tx.get(r);
          if (!cur.exists()) throw err('missing', 'Этой проповеди уже нет в облаке');
          const raw = cur.data().lock || null, l = seen = lockOf(raw);
          const same = !!(l && l.email === my && opts.at && l.at === opts.at);
          if (l && !same && live(l, opts.minutes) && !opts.force) throw err('locked', 'Проповедь сейчас правят', { lock: l });
          tx.update(r, { lock: { email: my, name: String(name || my).slice(0, 200), at: same ? raw.at : ts, beat: ts } });
        });
      } catch (e) {
        if (denied(e) && seen && seen.email !== my) throw err('locked', 'Проповедь сейчас правят', { lock: seen });
        throw e;
      }
      return fromDoc(space, await F.getDocFromServer(r));
    },

    /* Сигнал «я здесь»: продлить свой замок. Если замок забрали, база откажет (permission-denied) */
    beat(space, id){
      return F.updateDoc(ref(space, id), { 'lock.beat': F.serverTimestamp() });
    },

    /* Отпустить свой замок (at — какой именно: чужой или взятый в другой вкладке не трогаем) */
    async release(space, id, me, at){
      const r = ref(space, id), my = lower(me.email);
      await F.runTransaction(db, async tx => {
        const cur = await tx.get(r);
        if (!cur.exists()) return;
        const l = lockOf(cur.data().lock);
        if (l && l.email === my && (!at || l.at === at)) tx.update(r, { lock: null });
      });
    },

    /* Удалить проповедь (и отметки редактора, если они есть) */
    async remove(space, id){
      const b = F.writeBatch(db);
      b.delete(F.doc(db, 'spaces', space, 'sermons', id, 'editor', 'state'));
      b.delete(ref(space, id));
      await b.commit();
    },
  };
}

/* Человеческое объяснение ошибки облака */
export function explain(e){
  const c = (e && e.code) || '';
  if (c === 'conflict') return 'conflict';
  if (c === 'lost-lock' || c === 'locked') return 'Проповедь сейчас правит другой человек.';
  if (c === 'missing') return 'Этой проповеди уже нет в облаке.';
  if (c === 'too-big') return 'Проповедь слишком большая для облака (больше 900 КБ). Уберите лишнее или сохраните файл.';
  if (/permission-denied/.test(c)) return 'Нет прав на это действие. Проверьте, что вы вошли под своей почтой.';
  if (/unavailable|network|deadline|failed-precondition/.test(c) || /offline|network/i.test(String(e && e.message))) return 'Нет связи с облаком. Проверьте интернет и попробуйте ещё раз.';
  if (/popup-closed-by-user|cancelled-popup-request/.test(c)) return '';
  if (/popup-blocked/.test(c)) return 'Браузер заблокировал окно входа. Разрешите всплывающие окна для этого сайта и нажмите «Войти» ещё раз.';
  if (/unauthorized-domain/.test(c)) return 'Вход с этого адреса не разрешён. Откройте форму по основной ссылке.';
  return 'Не получилось: ' + (e && e.message ? e.message : c || 'неизвестная ошибка');
}
