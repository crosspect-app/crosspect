"""Замок и автосохранение (этап 6). Облако подменено: tests/fixtures/fake_cloud.js; «другой человек» правит базу напрямую."""
import time

from conftest import cloud_page
from test_cloud import ADMIN, IVAN, MEMBERS, rec, wait_home


def now_ms():
    return int(time.time() * 1000)


def lock_of(email, name, minutes_ago=0):
    t = now_ms() - minutes_ago * 60000
    return {"email": email, "name": name, "at": t, "beat": t}


def open_sermon(page, id):
    page.evaluate("id => navigate(sermonHash(id))", id)
    page.wait_for_function("id => state && state.id === id && screen === 'sermon' && ed.id === id && !ed.busy", arg=id)


def start_edit(page):
    page.locator("#app").get_by_role("button", name="Редактировать").click()
    page.wait_for_function("ed.mode === 'edit' && !ed.busy")


def db_eval(page, js):
    """Правка базы «другим человеком»: r — запись проповеди s1"""
    page.evaluate("(() => { const db = fakeCloud.db(), r = db.sermons.s1; %s; fakeCloud.put(db); })()" % js)


def status(page):
    return page.inner_text("#hd-save")


def test_opens_read_only_and_edit_takes_lock(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    open_sermon(page, "s1")
    assert "Только просмотр" in status(page)
    assert page.evaluate("readOnly()")
    assert page.evaluate("document.querySelector('.side .bbody').inert")
    assert not page.locator(".film-add").count()
    assert "null" not in page.inner_text("#film-count")
    # правка в просмотре не проходит и подсказывает про «Редактировать»
    page.evaluate("state.meta.title = 'Тайком'; change()")
    assert page.evaluate("state.meta.title") == "Вера"
    assert "только просмотр" in page.inner_text(".toast").lower()
    assert page.evaluate("fakeCloud.db().sermons.s1.lock") is None
    start_edit(page)
    lock = page.evaluate("fakeCloud.db().sermons.s1.lock")
    assert lock["email"] == "admin@x.pl" and lock["name"] == "Админ"
    assert page.get_by_role("button", name="Сохранить", exact=True).is_visible()
    assert not page.evaluate("document.querySelector('.side .bbody').inert")
    assert page.locator(".film-add").count() == 1
    assert not page.errors, page.errors
    ctx.close()


def test_autosave_then_save_and_close_releases(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("state.meta.title = 'Вера и дела'; change()")
    assert "Не сохранено: уйдёт в облако само" in status(page)
    page.wait_for_function("fakeCloud.db().sermons.s1.meta.title === 'Вера и дела'", timeout=10000)   # само, без кнопки
    page.wait_for_function("document.getElementById('hd-save').textContent.includes('Сохранено в облаке')")
    assert page.evaluate("fakeCloud.db().sermons.s1.lock.email") == "admin@x.pl"   # запись под замком его продлевает
    page.evaluate("state.meta.title = 'Вера, надежда'; change()")
    page.get_by_role("button", name="Сохранить", exact=True).click()
    page.wait_for_function("ed.mode === 'view'")
    r = page.evaluate("fakeCloud.db().sermons.s1")
    assert r["meta"]["title"] == "Вера, надежда" and r["lock"] is None
    assert "Только просмотр" in status(page)
    assert page.get_by_role("button", name="Редактировать").is_visible()
    ctx.close()


def test_ctrl_s_saves_at_once(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("state.meta.title = 'Сразу'; change()")
    page.keyboard.press("Control+s")
    page.wait_for_function("fakeCloud.db().sermons.s1.meta.title === 'Сразу'", timeout=1500)
    ctx.close()


def test_someone_else_editing_shows_name_and_live_updates(browser, base_url):
    s = rec("s1", "Вера"); s["lock"] = lock_of("ivan@x.pl", "Иван Петров")
    ctx, page = cloud_page(browser, base_url, user={"email": "petr@x.pl", "name": "Пётр"}, members=MEMBERS, sermons={"s1": s})
    page.evaluate("(() => { const db = fakeCloud.db(); db.sermons.s1.owner = 'petr@x.pl'; fakeCloud.put(db); })()")   # своя проповедь, но правит Иван
    wait_home(page)
    page.wait_for_selector(".lock-mark")
    assert "Правит Иван Петров" in page.inner_text(".lock-mark")
    open_sermon(page, "s1")
    assert "Сейчас правит Иван Петров" in status(page)
    btn = page.get_by_role("button", name="Редактировать")
    assert btn.is_disabled()   # проповедник чужую правку не забирает
    # Иван правит — у Петра проповедь обновляется сама
    db_eval(page, "r.meta.title = 'Вера живая'; r.blocks.push({ id:'b2', type:'thesis', parts:[{ kind:'text', html:'Новый тезис' }] }); r.updatedAt += 5000; r.updatedBy = 'ivan@x.pl'")
    page.wait_for_function("state.meta.title === 'Вера живая' && state.blocks.length === 2")
    assert "Вера живая" in page.inner_text(".hd-name")
    assert page.locator(".film .st").count() == 2
    # Иван закончил — кнопка заработала
    db_eval(page, "r.lock = null")
    page.wait_for_function("!document.querySelector('.topbar .btn.primary').disabled")
    assert "Только просмотр" in status(page)
    assert not page.errors, page.errors
    ctx.close()


def test_expired_lock_does_not_block(browser, base_url):
    s = rec("s1", "Вера"); s["lock"] = lock_of("ivan@x.pl", "Иван", minutes_ago=11)
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": s})
    wait_home(page)
    assert not page.locator(".lock-mark").count()
    open_sermon(page, "s1")
    assert "Только просмотр" in status(page)
    start_edit(page)
    assert page.evaluate("fakeCloud.db().sermons.s1.lock.email") == "admin@x.pl"
    ctx.close()


def test_lock_minutes_from_space_settings(browser, base_url):
    s = rec("s1", "Вера"); s["lock"] = lock_of("ivan@x.pl", "Иван", minutes_ago=3)
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": s}, settings={"lockMinutes": 2})
    wait_home(page)
    open_sermon(page, "s1")
    assert "Только просмотр" in status(page)   # замок жил 2 минуты и уже истёк
    ctx.close()


def test_editor_takes_over(browser, base_url):
    s = rec("s1", "Вера", owner="ivan@x.pl"); s["lock"] = lock_of("ivan@x.pl", "Иван")
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": s})
    wait_home(page)
    open_sermon(page, "s1")
    assert "Сейчас правит Иван" in status(page)
    page.on("dialog", lambda d: d.accept())
    page.get_by_role("button", name="Забрать правку").click()
    page.wait_for_function("ed.mode === 'edit'")
    assert page.evaluate("fakeCloud.db().sermons.s1.lock.email") == "admin@x.pl"
    ctx.close()


def test_lock_taken_away_saves_unsaved_as_copy(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": rec("s1", "Вера", owner="ivan@x.pl")})
    wait_home(page)
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("state.meta.title = 'Мои правки'; change()")   # ещё не ушло в облако
    db_eval(page, "r.lock = { email:'admin@x.pl', name:'Админ', at:Date.now() + 999999, beat:Date.now() + 999999 }")
    page.wait_for_selector(".sheet[aria-label='Правку забрали']")
    assert "Админ сейчас правит" in page.inner_text(".sheet[aria-label='Правку забрали']")
    assert ed_mode(page) == "view"
    sermons = page.evaluate("fakeCloud.db().sermons")
    assert sermons["s1"]["meta"]["title"] == "Вера"               # чужое не затёрто
    copy = [r for k, r in sermons.items() if k != "s1"]
    assert len(copy) == 1 and copy[0]["meta"]["title"] == "Мои правки (копия)" and copy[0]["owner"] == "ivan@x.pl"
    assert page.evaluate("state.meta.title") == "Вера"
    page.get_by_role("button", name="Открыть копию").click()
    page.wait_for_function("id => state.id === id && ed.mode === 'edit'", arg=copy[0]["id"])   # копию можно сразу править
    ctx.close()


def test_lock_taken_without_unsaved_no_copy(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    open_sermon(page, "s1")
    start_edit(page)
    db_eval(page, "r.lock = { email:'ed@x.pl', name:'Редактор', at:Date.now() + 999999, beat:Date.now() + 999999 }")
    page.wait_for_selector(".sheet[aria-label='Правку забрали']")
    assert "успели сохраниться" in page.inner_text(".sheet[aria-label='Правку забрали']")
    assert len(page.evaluate("fakeCloud.db().sermons")) == 1
    ctx.close()


def ed_mode(page):
    return page.evaluate("ed.mode")


def test_other_tab_of_same_user(browser, base_url):
    s = rec("s1", "Вера"); s["lock"] = lock_of("admin@x.pl", "Админ")
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": s})
    wait_home(page)
    open_sermon(page, "s1")
    assert "в другой вкладке" in status(page)
    page.on("dialog", lambda d: d.accept())
    page.get_by_role("button", name="Править здесь").click()
    page.wait_for_function("ed.mode === 'edit'")
    assert page.evaluate("fakeCloud.db().sermons.s1.lock.at") > s["lock"]["at"]
    ctx.close()


def test_second_tab_does_not_touch_draft_of_first(browser, base_url):
    s = rec("s1", "Вера"); s["lock"] = lock_of("admin@x.pl", "Админ")   # в «первой вкладке» идёт правка
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": s})
    wait_home(page)
    d = dict(rec("s1", "Правка первой вкладки"), app="swp-sermon", cloudSpace="sp1", cloudAt=5000, cloudOwner="admin@x.pl", savedAt=5000, updatedAt=9_000_000_000_000)
    page.evaluate("d => localStorage.setItem('swp-sermon:s1', JSON.stringify(d))", d)
    open_sermon(page, "s1")
    assert "в другой вкладке" in status(page)
    assert page.evaluate("state.meta.title") == "Вера"
    page.wait_for_timeout(300)
    assert len(page.evaluate("fakeCloud.db().sermons")) == 1   # копию не делает
    assert page.evaluate("JSON.parse(localStorage.getItem('swp-sermon:s1')).meta.title") == "Правка первой вкладки"
    ctx.close()


def test_idle_saves_and_releases(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("state.meta.title = 'Перед простоем'; change(); ed.lastAct = Date.now() - 11 * 60000; tick()")
    page.wait_for_selector(".sheet[aria-label='Правка закрыта']")
    r = page.evaluate("fakeCloud.db().sermons.s1")
    assert r["meta"]["title"] == "Перед простоем" and r["lock"] is None
    assert ed_mode(page) == "view"
    page.get_by_role("button", name="Править дальше").click()
    page.wait_for_function("ed.mode === 'edit'")
    ctx.close()


def test_heartbeat(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    open_sermon(page, "s1")
    start_edit(page)
    before = page.evaluate("fakeCloud.db().sermons.s1.lock.beat")
    page.evaluate("ed.lastBeat = Date.now() - 2 * 60000; tick()")
    page.wait_for_function("b => fakeCloud.db().sermons.s1.lock.beat > b", arg=before)
    assert page.evaluate("fakeCloud.db().sermons.s1.updatedAt") == 5000   # сигнал — не правка
    ctx.close()


def test_offline_edits_wait_and_go_later(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("localStorage.setItem('fake-offline', '1'); state.meta.title = 'Без сети'; change(); saveNow()")
    page.wait_for_function("document.getElementById('hd-save').textContent.includes('Нет связи')")
    assert page.evaluate("JSON.parse(localStorage.getItem('swp-sermon:s1')).meta.title") == "Без сети"   # правка в браузере
    page.evaluate("localStorage.removeItem('fake-offline'); window.dispatchEvent(new Event('online'))")
    page.wait_for_function("fakeCloud.db().sermons.s1.meta.title === 'Без сети'", timeout=5000)
    ctx.close()


def test_leaving_sermon_saves_and_releases(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("state.meta.title = 'Ушёл'; change()")
    page.get_by_role("link", name="Проповеди").click()
    wait_home(page)
    page.wait_for_function("(() => { const r = fakeCloud.db().sermons.s1; return r.meta.title === 'Ушёл' && r.lock === null; })()")
    ctx.close()


def test_leaving_clean_sermon_releases(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("navigate('')")
    wait_home(page)
    page.wait_for_function("fakeCloud.db().sermons.s1.lock === null")
    assert page.evaluate("fakeCloud.db().sermons.s1.updatedAt") == 5000
    ctx.close()


def test_unsaved_draft_opens_in_edit_when_free(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    d = dict(rec("s1", "Правка из браузера"), app="swp-sermon", cloudSpace="sp1", cloudAt=5000, cloudOwner="admin@x.pl", savedAt=5000, updatedAt=9_000_000_000_000)
    page.evaluate("d => localStorage.setItem('swp-sermon:s1', JSON.stringify(d))", d)
    open_sermon(page, "s1")
    page.wait_for_function("ed.mode === 'edit'")
    page.wait_for_function("fakeCloud.db().sermons.s1.meta.title === 'Правка из браузера'", timeout=10000)
    ctx.close()


def test_unsaved_draft_when_someone_edits_becomes_copy(browser, base_url):
    s = rec("s1", "Вера"); s["lock"] = lock_of("ivan@x.pl", "Иван")
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": s})
    wait_home(page)
    d = dict(rec("s1", "Правка из браузера"), app="swp-sermon", cloudSpace="sp1", cloudAt=5000, cloudOwner="admin@x.pl", savedAt=5000, updatedAt=9_000_000_000_000)
    page.evaluate("d => localStorage.setItem('swp-sermon:s1', JSON.stringify(d))", d)
    open_sermon(page, "s1")
    page.wait_for_selector(".sheet[aria-label='Правку забрали']")
    assert "отдельной копией" in page.inner_text(".sheet[aria-label='Правку забрали']")
    sermons = page.evaluate("fakeCloud.db().sermons")
    assert sermons["s1"]["meta"]["title"] == "Вера"
    assert [r["meta"]["title"] for k, r in sermons.items() if k != "s1"] == ["Правка из браузера (копия)"]
    assert page.evaluate("state.meta.title") == "Вера" and ed_mode(page) == "view"
    assert page.evaluate("localStorage.getItem('swp-sermon:s1')") is None   # второй раз копию не сделает
    ctx.close()


def test_delete_blocked_while_someone_edits(browser, base_url):
    s = rec("s1", "Вера"); s["lock"] = lock_of("ivan@x.pl", "Иван")
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": s})
    wait_home(page)
    page.wait_for_selector(".scard")
    page.locator(".card-del").first.click(force=True)
    assert "Сейчас её правит Иван" in page.inner_text(".toast")
    assert "s1" in page.evaluate("fakeCloud.db().sermons")
    ctx.close()


def test_new_sermon_edits_right_away(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS)
    wait_home(page)
    page.evaluate("newSermon()")
    page.wait_for_selector(".sheet[aria-label='О проповеди']")
    assert page.evaluate("ed.mode") == "edit"
    page.fill("input[aria-label='Название проповеди']", "С нуля")
    page.wait_for_function("Object.values(fakeCloud.db().sermons).some(r => r.meta.title === 'С нуля' && r.lock && r.lock.email === 'admin@x.pl')", timeout=10000)
    ctx.close()


def test_deleted_while_viewing(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    open_sermon(page, "s1")
    page.evaluate("(() => { const db = fakeCloud.db(); delete db.sermons.s1; fakeCloud.put(db); })()")
    wait_home(page)
    assert "удалили" in page.inner_text(".toast")
    ctx.close()


def test_text_view_read_only(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    open_sermon(page, "s1")
    page.evaluate("navigate(sermonHash('s1', 'text'))")
    page.wait_for_selector(".tv .prose")
    assert page.evaluate("document.querySelector('.tv .prose').inert")
    page.locator(".tv .cont").first.click()
    assert "только просмотр" in page.inner_text(".toast").lower()
    page.locator("#app").get_by_role("button", name="Редактировать").click()
    page.wait_for_function("ed.mode === 'edit' && !document.querySelector('.tv .prose').inert")
    assert not page.errors, page.errors
    ctx.close()


def test_sign_out_releases(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("state.meta.title = 'Перед выходом'; change(); cloudSignOut()")
    page.wait_for_selector(".gate")
    r = page.evaluate("fakeCloud.db().sermons.s1")
    assert r["meta"]["title"] == "Перед выходом" and r["lock"] is None
    ctx.close()


def stays_editing(page):
    """Правка не слетает, когда замок наконец приходит слушателю: форма считает его своим"""
    page.wait_for_function("fakeCloud.db().sermons.s1.lock && ed.myAt === fakeCloud.db().sermons.s1.lock.at", timeout=5000)
    page.wait_for_timeout(500)
    assert page.evaluate("ed.mode") == "edit"
    assert not page.evaluate("settingsOverlay.classList.contains('open')"), page.inner_text("#app")
    assert page.get_by_role("button", name="Сохранить", exact=True).is_visible()


def test_edit_when_cloud_reads_back_old_lock(browser, base_url):
    # Firestore при открытом слушателе иногда перечитывает версию без только что взятого замка
    s = rec("s1", "Вера"); s["lock"] = lock_of("admin@x.pl", "Админ", minutes_ago=15)   # свой старый, истёкший
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": s})
    page.evaluate("localStorage.setItem('fake-stale-lock', '1')")
    wait_home(page)
    open_sermon(page, "s1")
    start_edit(page)
    stays_editing(page)
    assert not page.errors, page.errors
    ctx.close()


def test_edit_here_when_cloud_reads_back_old_lock(browser, base_url):
    s = rec("s1", "Вера"); s["lock"] = lock_of("admin@x.pl", "Админ")   # свой живой, «из другой вкладки»
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": s})
    page.evaluate("localStorage.setItem('fake-stale-lock', '1')")
    wait_home(page)
    open_sermon(page, "s1")
    page.on("dialog", lambda d: d.accept())
    page.get_by_role("button", name="Править здесь").click()
    page.wait_for_function("ed.mode === 'edit' && !ed.busy")
    stays_editing(page)
    ctx.close()
