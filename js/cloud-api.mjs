// Связь формы с облаком (Firebase: вход Google + Cloud Firestore).
// Не знает ничего о странице: получает уже подключённый Firebase (`fb`) и отдаёт простые функции.
// Поэтому тот же файл проверяется в эмуляторе (cloud/tests/client.test.mjs) без браузера.
//
// fb = { auth, db, A (модуль firebase/auth), F (модуль firebase/firestore) }
// Права проверяет база (cloud/firestore.rules): что бы ни сделал этот код, чужого она не отдаст и не примет.
//
// Замок (этап 6): lock = { email, name, at — когда взят, beat — последний сигнал «я здесь» }, время ставит сервер.
// Форма знает «свой» замок по паре почта + at: другая вкладка той же почты берёт замок заново, и at меняется.
//
// Сводки (этап 8): у каждой проповеди есть маленькая копия для списка на главной — spaces/{s}/summaries/{id}
// (summaryOf ниже). Она пишется в той же записи (транзакции или пачке), что и сама проповедь, поэтому главная
// слушает только сводки и не качает целые конспекты. Правила проверяют, что сводка совпадает с проповедью.

const MAX_LIST = 200;               // сколько проповедей показывать на главной
const MAX_BYTES = 900 * 1024;       // документ в Firestore — до 1 МиБ; предупреждаем заранее

/* Сводка проповеди для списка: поля документа проповеди (после записи) → документ summaries/{id}.
   Те же поля, что проверяют правила (validSummary в cloud/firestore.rules). Нужна и служебному скрипту
   (cloud/scripts/admin.mjs migrate-8), поэтому не зависит от Firebase: время и замок копируются как есть. */
export function summaryOf(d){
  const m = d.meta || {}, blocks = Array.isArray(d.blocks) ? d.blocks : [];
  const txt = v => (typeof v === 'string' ? v : '');
  const refs = [];
  blocks.forEach(b => {
    if (b && b.type === 'scripture') (b.items || []).forEach(it => { if (it && typeof it.ref === 'string' && it.ref.trim()) refs.push(it.ref.trim()); });
  });
  return {
    title: txt(m.title), date: txt(m.date), firstName: txt(m.firstName), lastName: txt(m.lastName),
    status: d.status, owner: d.owner, updatedAt: d.updatedAt, updatedBy: d.updatedBy,
    lock: d.lock || null,
    slides: Math.min(500, blocks.filter(b => b && b.type !== 'note').length),   // заметка оператору — не слайд
    refs: refs.join(' · ').slice(0, 2000),
  };
}
/* Документ после update: поля из upd поверх прежних, 'lock.beat' — внутрь замка */
function afterUpdate(cur, upd){
  const d = Object.assign({}, cur, upd);
  if ('lock.beat' in upd){ delete d['lock.beat']; d.lock = Object.assign({}, cur.lock || {}, { beat: upd['lock.beat'] }); }
  return d;
}

export function createCloudAPI(fb){
  const { auth, db, A, F } = fb;
  const col = space => F.collection(db, 'spaces', space, 'sermons');
  const ref = (space, id) => F.doc(db, 'spaces', space, 'sermons', id);
  const sumRef = (space, id) => F.doc(db, 'spaces', space, 'summaries', id);
  const lower = e => String(e || '').trim().toLowerCase();
  const ms = t => (t && typeof t.toMillis === 'function' ? t.toMillis() : 0);
  const err = (code, message, extra) => Object.assign(new Error(message || code), { code }, extra);
  const lockOf = l => (l && l.email ? { email: lower(l.email), name: l.name || '', at: ms(l.at), beat: ms(l.beat) } : null);
  /* Жив ли замок по часам этого компьютера (окончательно решает база по своим часам) */
  const live = (l, minutes) => !!l && Date.now() < l.beat + (minutes || 10) * 60000;
  const denied = e => /permission-denied/.test((e && e.code) || '');
  const pause = msec => new Promise(res => setTimeout(res, msec));
  /* Прочитать документ после своей записи. Пока его слушает onSnapshot, Firestore может отдать копию слушателя,
     в которой этой записи ещё нет: тогда подождать и прочитать ещё раз. ok(snap) — запись уже видна */
  async function readBack(r, ok){
    let snap = null;
    for (let i = 0; i < 12; i++){
      snap = await F.getDocFromServer(r);
      if (ok(snap)) return snap;
      await pause(250);
    }
    return snap;
  }

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
  /* Сводка → строка списка на главной (как проповедь, но без слайдов: slides — их число, refs — места Писания) */
  function fromSummary(space, snap, opt){
    const d = snap.data(opt);
    return {
      id: snap.id, summary: true,
      meta: { title: d.title || '', date: d.date || '', firstName: d.firstName || '', lastName: d.lastName || '' },
      updatedAt: ms(d.updatedAt),
      cloudSpace: space, cloudAt: ms(d.updatedAt), cloudOwner: d.owner || '',
      cloudStatus: d.status || 'draft', cloudBy: d.updatedBy || '',
      lock: lockOf(d.lock), slides: d.slides || 0, refs: d.refs || '',
    };
  }
  /* Проповедь формы → поля документа: без undefined и без лишнего (Firestore не принимает undefined) */
  function content(s){
    const m = s.meta || {};
    return JSON.parse(JSON.stringify({
      v: s.v || 2,
      meta: { title: m.title || '', date: m.date || '', firstName: m.firstName || '', lastName: m.lastName || '' },
      settings: s.settings || {},
      // отметки «доработать» и «готово» в проповедь не пишем: «доработать» лежит в закрытом документе editor/state (этап 7)
      blocks: (s.blocks || []).map(b => { const c = Object.assign({}, b); delete c.todo; delete c.done; return c; }),
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
    /* Админ всей формы (этап 8): его почта лежит в admins/{почта}; свою запись может прочитать каждый */
    async isAdmin(email){
      try { return (await F.getDoc(F.doc(db, 'admins', lower(email)))).exists(); }
      catch (e) { if (denied(e)) return false; throw e; }
    },
    /* Все пространства — только админу (остальным база откажет): [{ id, name, settings }] */
    async allSpaces(){
      const snap = await F.getDocs(F.collection(db, 'spaces'));
      return snap.docs.map(d => ({ id: d.id, name: d.data().name || '', settings: d.data().settings || {} }));
    },

    /* ----- проповеди ----- */
    /* Живой список — по сводкам (этап 8): строки без слайдов (fromSummary). restrictTo — почта: автор, которому
       не открыты чужие проповеди, спрашивает только свои (иначе база отклонит весь запрос).
       Возвращает функцию «перестать слушать». */
    listen(space, restrictTo, onList, onError){
      const c = F.collection(db, 'spaces', space, 'summaries');
      const q = restrictTo
        ? F.query(c, F.where('owner', '==', lower(restrictTo)), F.limit(MAX_LIST))
        : F.query(c, F.orderBy('updatedAt', 'desc'), F.limit(MAX_LIST));
      return F.onSnapshot(q, snap => {
        onList(snap.docs.filter(d => d.data({ serverTimestamps: 'estimate' }).updatedAt).map(d => fromSummary(space, d, { serverTimestamps: 'estimate' })), snap.metadata.fromCache);
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
        status: opts.status || 'draft', owner: lower(opts.owner != null ? opts.owner : me.email),
        createdBy: my, createdAt: ts,
      }, L && !L.release ? { lock: newLock() } : {});
      let before = -1;   // updatedAt до моей записи: перечитанная версия должна быть новее
      if (s.cloudAt || opts.force){
        // проповедь уже в облаке: обновляем, если с тех пор её никто не менял (или человек велел заменить)
        await F.runTransaction(db, async tx => {
          const cur = await tx.get(r);
          if (!cur.exists()) { const f = fresh(); tx.set(r, f); tx.set(sumRef(space, s.id), summaryOf(f)); return; }
          const d = cur.data(), at = ms(d.updatedAt), l = lockOf(d.lock);
          before = at;
          const held = !!(L && L.at && l && l.email === my && l.at === L.at);   // замок взят этой вкладкой и всё ещё её
          if (L && l && !held && live(l, L.minutes)) throw err('lost-lock', 'Проповедь сейчас правит другой', { lock: l, remote: fromDoc(space, cur) });
          const ownLater = held && at >= l.at && d.updatedBy === my;   // версия новее моей, но записана мной же под моим замком
          if (!opts.force && at !== s.cloudAt && !ownLater) throw err('conflict', 'В облаке проповедь успели изменить', { remote: fromDoc(space, cur) });
          const upd = Object.assign({}, body, stamp);
          if (opts.status) upd.status = opts.status;   // «Черновик» (draft) / «Готов к вёрстке» (submitted) / «У редактора» (work, только редактор): правила проверяют
          if (L){
            if (L.release) upd.lock = null;
            else if (held) upd['lock.beat'] = ts;
            else upd.lock = newLock();   // замка нет или он истёк: берём заново
          }
          tx.update(r, upd);
          tx.set(sumRef(space, s.id), summaryOf(afterUpdate(d, upd)));
        });
      } else {
        // новая или из файла: если такая уже есть — не затираем. Чтение несуществующей проповеди проповеднику в закрытом
        // пространстве база отказывает (permission-denied) — это не ошибка: создаём, а чужую запись правила всё равно не пустят
        let cur = null;
        try { cur = await F.getDocFromServer(r); }
        catch (e) { if (!denied(e)) throw e; }
        if (cur && cur.exists()) throw err('conflict', 'В облаке уже есть такая проповедь', { remote: fromDoc(space, cur) });
        const f = fresh(), b = F.writeBatch(db);
        b.set(r, f);
        b.set(sumRef(space, s.id), summaryOf(f));
        await b.commit();
      }
      const back = await readBack(r, snap => snap.exists() && ms(snap.data().updatedAt) > before);   // время ставит сервер: читаем его обратно
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
          const upd = { lock: { email: my, name: String(name || my).slice(0, 200), at: same ? raw.at : ts, beat: ts } };
          tx.update(r, upd);
          tx.set(sumRef(space, id), summaryOf(afterUpdate(cur.data(), upd)));
        });
      } catch (e) {
        if (denied(e) && seen && seen.email !== my) throw err('locked', 'Проповедь сейчас правят', { lock: seen });
        throw e;
      }
      const was = seen && seen.email === my ? seen.beat : 0;   // сигнал моего замка ставится заново: ждём версию с ним
      return fromDoc(space, await readBack(r, snap => { const l = snap.exists() && lockOf(snap.data().lock); return !!l && l.email === my && l.beat > was; }));
    },

    /* Сигнал «я здесь»: продлить свой замок (и замок в сводке). Если замок забрали, база откажет (permission-denied) */
    async beat(space, id){
      const r = ref(space, id);
      await F.runTransaction(db, async tx => {
        const cur = await tx.get(r);
        if (!cur.exists()) throw err('missing', 'Этой проповеди уже нет в облаке');
        const upd = { 'lock.beat': F.serverTimestamp() };
        tx.update(r, upd);
        if (cur.data().lock) tx.set(sumRef(space, id), summaryOf(afterUpdate(cur.data(), upd)));   // замка нет — база всё равно откажет
      });
    },

    /* Отпустить свой замок (at — какой именно: чужой или взятый в другой вкладке не трогаем) */
    async release(space, id, me, at){
      const r = ref(space, id), my = lower(me.email);
      await F.runTransaction(db, async tx => {
        const cur = await tx.get(r);
        if (!cur.exists()) return;
        const l = lockOf(cur.data().lock);
        if (l && l.email === my && (!at || l.at === at)){
          tx.update(r, { lock: null });
          tx.set(sumRef(space, id), summaryOf(afterUpdate(cur.data(), { lock: null })));
        }
      });
    },

    /* Статус конспекта отдельно от содержимого (этап 7.2): 'draft' — «Черновик», 'submitted' — «Готов к вёрстке», 'work' — «У редактора».
       С этапа 7.3 форма меняет статус обычной правкой (save с opts.status) и эту функцию не вызывает; оставлена для служебных случаев.
       Можно, когда замок свободен (нет или истёк) или мой; под чужим живым замком — ошибка 'locked' ({ lock }).
       Истёкший чужой замок при этом снимается (так требуют правила). Возвращает новую облачную версию */
    async setStatus(space, id, me, status, opts){
      opts = opts || {};
      const r = ref(space, id), my = lower(me.email), ts = F.serverTimestamp();
      let before = -1;
      await F.runTransaction(db, async tx => {
        const cur = await tx.get(r);
        if (!cur.exists()) throw err('missing', 'Этой проповеди уже нет в облаке');
        const d = cur.data(), l = lockOf(d.lock);
        before = ms(d.updatedAt);
        if (l && l.email !== my && live(l, opts.minutes)) throw err('locked', 'Проповедь сейчас правят', { lock: l });
        const upd = { status, updatedAt: ts, updatedBy: my };
        if (l && l.email !== my) upd.lock = null;   // чужой истёкший замок
        tx.update(r, upd);
        tx.set(sumRef(space, id), summaryOf(afterUpdate(d, upd)));
      });
      const back = await readBack(r, snap => snap.exists() && ms(snap.data().updatedAt) > before);
      return fromDoc(space, back);
    },

    /* Настройки экрана человека (этап 7.2): people/{почта}/prefs/screen = { layout, updatedAt }. Видит и пишет только он сам.
       layout — ширина и порядок панелей; {} — как по умолчанию. Нет документа — null */
    async getPrefs(me){
      const snap = await F.getDoc(F.doc(db, 'people', lower(me.email), 'prefs', 'screen'));
      return snap.exists() ? (snap.data().layout || {}) : null;
    },
    async setPrefs(me, layout){
      await F.setDoc(F.doc(db, 'people', lower(me.email), 'prefs', 'screen'),
        { layout: JSON.parse(JSON.stringify(layout || {})), updatedAt: F.serverTimestamp() });
    },

    /* Отметки редактора («доработать»): документ editor/state, читает и пишет только редактор (и админ), замок не нужен.
       flags = { <id слайда>: { t: 1 | 0, s: подпись } }. Нет документа или нет прав — пустой набор */
    async getFlags(space, id){
      try {
        const snap = await F.getDoc(F.doc(db, 'spaces', space, 'sermons', id, 'editor', 'state'));
        return snap.exists() ? (snap.data().flags || {}) : {};
      } catch (e) { if (denied(e)) return {}; throw e; }
    },
    async setFlags(space, id, me, flags){
      await F.setDoc(F.doc(db, 'spaces', space, 'sermons', id, 'editor', 'state'),
        { flags: JSON.parse(JSON.stringify(flags || {})), updatedAt: F.serverTimestamp(), updatedBy: lower(me.email) });
    },

    /* Настройки слайдов пространства (этап 7.1): документ config/slides, общий для всех проповедей.
       Читают все участники, пишут админ и редактор. onCfg(slides | null) на каждое изменение; null — документа ещё нет */
    watchSlides(space, onCfg, onError){
      return F.onSnapshot(F.doc(db, 'spaces', space, 'config', 'slides'), snap => {
        onCfg(snap.exists() ? (snap.data().slides || null) : null);
      }, onError);
    },
    async getSlides(space){
      const snap = await F.getDoc(F.doc(db, 'spaces', space, 'config', 'slides'));
      return snap.exists() ? (snap.data().slides || null) : null;
    },
    async setSlides(space, me, slides){
      await F.setDoc(F.doc(db, 'spaces', space, 'config', 'slides'),
        { slides: JSON.parse(JSON.stringify(slides || {})), updatedAt: F.serverTimestamp(), updatedBy: lower(me.email) });
    },

    /* Удалить проповедь (и её сводку, и отметки редактора, если они есть) */
    async remove(space, id){
      const b = F.writeBatch(db);
      b.delete(F.doc(db, 'spaces', space, 'sermons', id, 'editor', 'state'));
      b.delete(sumRef(space, id));
      b.delete(ref(space, id));
      await b.commit();
    },
  };
}

/* Человеческое объяснение ошибки облака */
export function explain(e){
  const c = (e && e.code) || '';
  if (c === 'conflict') return 'conflict';
  if (/resource-exhausted/.test(c)) return 'Облако перегружено до 9:00: бесплатный дневной запас базы закончился. Правки лежат в этом браузере и уйдут в облако сами, когда запас обновится.';
  if (c === 'lost-lock' || c === 'locked') return 'Проповедь сейчас правит другой человек.';
  if (c === 'missing') return 'Этой проповеди уже нет в облаке.';
  if (c === 'too-big') return 'Проповедь слишком большая для облака (больше 900 КБ). Уберите лишнее или скачайте файл: «⋯ → Скачать файл».';
  if (/permission-denied/.test(c)) return 'Нет прав на это действие. Проверьте, что вы вошли под своей почтой.';
  if (/unavailable|network|deadline|failed-precondition/.test(c) || /offline|network/i.test(String(e && e.message))) return 'Нет связи с облаком. Проверьте интернет и попробуйте ещё раз.';
  if (/popup-closed-by-user|cancelled-popup-request/.test(c)) return '';
  if (/popup-blocked/.test(c)) return 'Браузер заблокировал окно входа. Разрешите всплывающие окна для этого сайта и нажмите «Войти» ещё раз.';
  if (/unauthorized-domain/.test(c)) return 'Вход с этого адреса не разрешён. Откройте форму по основной ссылке.';
  return 'Не получилось: ' + (e && e.message ? e.message : c || 'неизвестная ошибка');
}
