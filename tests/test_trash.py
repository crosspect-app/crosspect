"""Корзина (этап 9.1): «Удалить» убирает конспект в корзину, «Корзина» на главной — «Восстановить» и «Удалить навсегда».
Облако подменено (tests/fixtures/fake_cloud.js); правила и слой облака — cloud/tests/ (в CI)."""
import time

from conftest import cloud_page
from test_cloud import ADMIN, IVAN, MEMBERS, rec, wait_home, open_edit

DAY = 86400000


def now_ms():
    return int(time.time() * 1000)


def trashed(id, title, owner="admin@x.pl", days_ago=0, by=None, **kw):
    r = rec(id, title, owner=owner, **kw)
    r["deletedAt"] = now_ms() - days_ago * DAY - 60000
    r["deletedBy"] = by or owner
    return r


def titles(page):
    return page.locator(".scard .scard-title").all_inner_texts()


def test_delete_goes_to_trash_and_back(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера"), "s2": rec("s2", "Надежда")})
    wait_home(page)
    page.wait_for_selector(".scard")
    assert not page.locator(".home-trash").count()   # пустая корзина — кнопки нет
    asked = []
    page.on("dialog", lambda d: (asked.append(d.message), d.accept()))
    page.locator(".card-wrap", has_text="Вера").locator(".card-del").click(force=True)
    page.wait_for_function("!!fakeCloud.db().sermons.s1.deletedAt")
    assert asked == []   # в корзину — без вопроса
    page.wait_for_function("document.querySelectorAll('.scard').length === 1")
    assert titles(page) == ["Надежда"]
    db = page.evaluate("fakeCloud.db().sermons.s1")
    assert db["deletedBy"] == "admin@x.pl" and db["meta"]["title"] == "Вера"
    assert "«Вера» в корзине" in page.inner_text(".toast")
    assert page.locator(".home-trash").inner_text().strip() == "Корзина · 1"
    # «Вернуть» прямо в уведомлении
    page.locator(".toast button", has_text="Вернуть").click()
    page.wait_for_function("!fakeCloud.db().sermons.s1.deletedAt")
    page.wait_for_function("document.querySelectorAll('.scard').length === 2")
    page.wait_for_function("!document.querySelector('.home-trash')")
    assert not page.errors, page.errors
    ctx.close()


def test_trash_window_restore_and_purge(browser, base_url):
    sermons = {"a": trashed("a", "Старая", days_ago=3), "b": trashed("b", "Вчерашняя", by="ivan@x.pl", owner="ivan@x.pl"), "c": rec("c", "Живая")}
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons=sermons)
    wait_home(page)
    page.wait_for_selector(".scard")
    assert titles(page) == ["Живая"]
    page.locator(".home-trash").click()
    sheet = page.locator(".trash-sheet")
    sheet.wait_for()
    rows = sheet.locator(".trash-row")
    assert rows.count() == 2
    assert rows.nth(0).locator(".trash-title").inner_text() == "Вчерашняя"   # свежие сверху
    when0, when1 = rows.nth(0).locator(".trash-when").inner_text(), rows.nth(1).locator(".trash-when").inner_text()
    assert "ivan@x.pl" in when0 and "Сотрётся через 30 дней" in when0
    assert "admin@x.pl" not in when1 and "Сотрётся через 27 дней" in when1
    assert "Иван Петров" in rows.nth(0).locator(".trash-meta").inner_text()
    # восстановить: окно остаётся, строка уходит, конспект снова в списке
    rows.nth(1).get_by_role("button", name="Восстановить").click()
    page.wait_for_function("!fakeCloud.db().sermons.a.deletedAt")
    page.wait_for_function("document.querySelectorAll('.trash-row').length === 1")
    page.wait_for_function("document.querySelectorAll('.scard').length === 2")
    assert "снова в списке" in page.inner_text(".toast")
    # удалить навсегда — с вопросом; «Отмена» ничего не делает
    page.once("dialog", lambda d: d.dismiss())
    sheet.get_by_role("button", name="Удалить навсегда").click()
    assert "b" in page.evaluate("Object.keys(fakeCloud.db().sermons)")
    msgs = []
    page.once("dialog", lambda d: (msgs.append(d.message), d.accept()))
    sheet.get_by_role("button", name="Удалить навсегда").click()
    page.wait_for_function("!fakeCloud.db().sermons.b")
    assert "навсегда" in msgs[0] and "«Вчерашняя»" in msgs[0]
    page.wait_for_selector(".trash-empty")
    assert sheet.locator(".trash-empty").inner_text() == "Корзина пуста"
    page.keyboard.press("Escape")
    page.wait_for_function("!document.querySelector('.home-trash')")
    assert not page.errors, page.errors
    ctx.close()


def test_author_trash_rights(browser, base_url):
    sermons = {
        "mine": rec("mine", "Мой черновик", owner="ivan@x.pl"),
        "ready": dict(rec("ready", "Мой готовый", owner="ivan@x.pl"), status="submitted"),
        "gone": trashed("gone", "Убрал редактор", owner="ivan@x.pl", by="admin@x.pl"),
        "petr": trashed("petr", "Чужой", owner="petr@x.pl"),
    }
    sermons["gone"]["status"] = "submitted"
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons=sermons)
    wait_home(page)
    page.wait_for_selector(".scard")
    assert sorted(titles(page)) == ["Мой готовый", "Мой черновик"]
    assert not page.locator(".home-trash").count()   # в корзине нет того, что автор может вернуть
    # готовый не удаляется (как раньше)
    page.locator(".card-wrap", has_text="Мой готовый").locator(".card-del").click(force=True)
    assert "только черновик" in page.inner_text(".toast")
    assert not page.evaluate("fakeCloud.db().sermons.ready.deletedAt")
    # свой черновик — в корзину, и он виден в окне; чужих и убранных редактором там нет
    page.locator(".card-wrap", has_text="Мой черновик").locator(".card-del").click(force=True)
    page.wait_for_function("!!fakeCloud.db().sermons.mine.deletedAt")
    page.locator(".home-trash").click()
    page.wait_for_selector(".trash-row")
    assert page.locator(".trash-row .trash-title").all_inner_texts() == ["Мой черновик"]
    assert not page.errors, page.errors
    ctx.close()


def test_link_to_trashed_sermon(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"t1": trashed("t1", "В корзине")}, hash="#s=t1&sp=sp1")
    page.wait_for_selector(".home-top")
    page.wait_for_function("document.querySelector('.toast') && document.querySelector('.toast').textContent.includes('в корзине')")
    assert page.evaluate("screen") == "home" and page.evaluate("location.hash") == ""
    page.locator(".toast button", has_text="Корзина").click()
    page.wait_for_selector(".trash-row")
    assert not page.errors, page.errors
    ctx.close()


def test_trashed_while_viewing_and_while_editing(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера"), "s2": rec("s2", "Правлю")})
    wait_home(page)
    # смотрю — другой убрал в корзину: на главную с уведомлением
    page.evaluate("navigate(sermonHash('s1'))")
    page.wait_for_function("state && state.id === 's1' && screen === 'sermon' && ed.id === 's1'")
    page.evaluate("(() => { const db = fakeCloud.db(); db.sermons.s1.deletedAt = Date.now(); db.sermons.s1.deletedBy = 'ed@x.pl'; fakeCloud.put(db); })()")
    page.wait_for_function("screen === 'home'")
    assert "убрали в корзину" in page.inner_text(".toast")
    # правлю, замок истёк, а конспект убрали: несохранённое уходит копией
    open_edit(page, "s2")
    page.evaluate("state.blocks[0].speech = 'не успело уйти'; change()")
    page.evaluate("(() => { const db = fakeCloud.db(); db.sermons.s2.lock = null; db.sermons.s2.deletedAt = Date.now(); db.sermons.s2.deletedBy = 'ed@x.pl'; localStorage.setItem('fake-cloud', JSON.stringify(db)); })()")
    page.keyboard.press("Control+s")
    page.wait_for_function("screen === 'home'")
    page.wait_for_function("Object.values(fakeCloud.db().sermons).some(r => r.meta.title === 'Правлю (копия)' && !r.deletedAt)")
    copy = page.evaluate("Object.values(fakeCloud.db().sermons).find(r => r.meta.title === 'Правлю (копия)')")
    assert copy["blocks"][0]["speech"] == "не успело уйти"
    assert "«Правлю» убрали в корзину. Ваши несохранённые правки — в копии «Правлю (копия)»" in page.locator(".toast").last.inner_text()
    assert not page.errors, page.errors
    ctx.close()


def test_unsaved_browser_edits_wait_in_trash(browser, base_url):
    """Несохранённые правки из браузера не пропадают: пока конспект в корзине, их не видно; вернули — они снова на главной."""
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    page.wait_for_selector(".scard")
    d = page.evaluate("fakeCloud.db().sermons.s1")
    local = dict(d, app="swp-sermon", meta=dict(d["meta"], title="Вера, правки"), cloudSpace="sp1", cloudAt=d["updatedAt"], savedAt=d["updatedAt"], updatedAt=d["updatedAt"] + 99999)
    page.evaluate("d => { localStorage.setItem('swp-sermon:s1', JSON.stringify(d)); renderHomeList(); }", local)
    assert "Не сохранено в облако" in page.inner_text(".home")
    page.locator(".card-del").first.click(force=True)
    page.wait_for_function("!!fakeCloud.db().sermons.s1.deletedAt")
    page.wait_for_function("!document.querySelector('.scard')")
    assert page.evaluate("!!localStorage.getItem('swp-sermon:s1')")
    page.locator(".home-trash").click()
    page.get_by_role("button", name="Восстановить").click()
    page.wait_for_function("document.querySelectorAll('.scard').length === 1")
    assert "Вера, правки" in page.inner_text(".home") and "Не сохранено в облако" in page.inner_text(".home")
    ctx.close()


def test_operator_link_comes_back_after_restore(browser, base_url):
    s = rec("s1", "Со ссылкой")
    s["shareKey"] = "k" * 24
    shares = {"k" * 24: {"spaceId": "sp1", "sermonId": "s1", "sermon": {"v": 1, "title": "Со ссылкой", "blocks": []}, "createdBy": "admin@x.pl", "updatedAt": 1}}
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": s}, shares=shares)
    wait_home(page)
    page.wait_for_selector(".scard")
    page.locator(".card-del").first.click(force=True)
    page.wait_for_function("!!fakeCloud.db().sermons.s1.deletedAt")
    assert page.evaluate("fakeCloud.db().shares") == {}           # ссылка в корзине не работает
    assert page.evaluate("fakeCloud.db().sermons.s1.shareKey") == "k" * 24
    page.locator(".home-trash").click()
    page.get_by_role("button", name="Восстановить").click()
    page.wait_for_function("!!(fakeCloud.db().shares || {})['" + "k" * 24 + "']")
    snap = page.evaluate("fakeCloud.db().shares['" + "k" * 24 + "'].sermon")
    assert snap["title"] == "Со ссылкой" and snap["total"] == 1
    assert not page.errors, page.errors
    ctx.close()
