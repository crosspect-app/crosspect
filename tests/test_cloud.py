"""Вход Google и сохранение в облако (этап 5). Облако подменено: tests/fixtures/fake_cloud.js. Замок и автосохранение — test_lock.py."""
import json

from conftest import cloud_page

ADMIN = {"email": "admin@x.pl", "name": "Админ"}
IVAN = {"email": "ivan@x.pl", "name": "Иван"}
MEMBERS = {
    "admin@x.pl": {"role": "admin"},
    "ivan@x.pl": {"role": "preacher", "firstName": "Иван", "lastName": "Петров"},
    "petr@x.pl": {"role": "preacher", "firstName": "Пётр", "lastName": "Сидоров"},
}


def rec(id, title, owner="admin@x.pl", at=5000, date="2099-01-04"):
    return {"id": id, "v": 2, "meta": {"title": title, "date": date, "firstName": "Иван", "lastName": "Петров"}, "settings": {},
            "blocks": [{"id": "b1", "type": "splash", "speech": "<b>привет</b>"}], "status": "draft", "owner": owner,
            "createdBy": owner, "createdAt": at, "updatedAt": at, "updatedBy": owner}


def wait_home(page):
    page.wait_for_selector(".home-top")


def open_edit(page, id):
    """Открыть облачную проповедь и нажать «Редактировать»."""
    page.evaluate("id => navigate(sermonHash(id))", id)
    page.wait_for_function("id => state && state.id === id && screen === 'sermon' && ed.id === id", arg=id)
    page.get_by_role("button", name="Редактировать").click()
    page.wait_for_function("ed.mode === 'edit'")


def test_gate_then_sign_in(browser, base_url):
    ctx, page = cloud_page(browser, base_url, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    page.wait_for_selector(".gate")
    assert page.get_by_role("button", name="Войти через Google").is_visible()
    assert not page.get_by_role("button", name="Продолжить без входа").count()   # с этапа 8 без входа не работаем
    assert not page.locator(".home-top").count()
    page.get_by_role("button", name="Войти через Google").click()
    wait_home(page)
    page.wait_for_selector(".scard")
    assert page.locator(".org").inner_text() == "Слово веры · тест"
    assert "админ" in page.locator(".who").inner_text()
    assert "Вера" in page.locator(".scard").inner_text()
    assert not page.errors, page.errors
    ctx.close()


def test_signed_in_user_is_remembered(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    page.wait_for_selector(".scard")
    page.reload()
    wait_home(page)
    page.wait_for_selector(".scard")
    ctx.close()


def test_not_a_member(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user={"email": "stranger@x.pl", "name": "Чужой"}, members=MEMBERS)
    page.wait_for_selector(".gate")
    assert "stranger@x.pl" in page.locator(".gate").inner_text()
    assert "Вас нет в списке" in page.locator(".gate h1").inner_text()
    assert not page.locator(".home-top").count()
    ctx.close()


def test_without_sign_in_only_gate(browser, base_url):
    """Этап 8: без входа — только экран входа; ни главной, ни проповеди по ссылке, ни новой проповеди."""
    ctx, page = cloud_page(browser, base_url, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    page.wait_for_selector(".gate")
    page.evaluate("newSermon()")
    page.evaluate("navigate('#s=s1')")
    page.wait_for_timeout(300)
    assert page.locator(".gate").count() == 1
    assert not page.locator(".home-top").count() and not page.locator(".film").count()
    assert page.evaluate("screen") == "home"
    page.locator(".topbar .icon-btn[aria-label='Ещё']").click()
    assert "Новая проповедь" not in page.inner_text("#menu")
    assert not page.errors, page.errors
    ctx.close()


def test_save_new_sermon_to_cloud(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS)
    wait_home(page)
    page.evaluate("newSermon()")
    page.wait_for_selector(".sheet[aria-label='О проповеди']")
    page.fill("input[aria-label='Название проповеди']", "Благодать")
    page.evaluate("closeSettings()")
    page.evaluate("addBlock('splash', 0)")
    assert "Не сохранено: уйдёт в облако само" in page.inner_text("#hd-save")
    page.wait_for_function("document.getElementById('hd-save').textContent.includes('Сохранено в облаке')", timeout=10000)   # само, без кнопки
    db = page.evaluate("fakeCloud.db()")
    assert len(db["sermons"]) == 1
    r = next(iter(db["sermons"].values()))
    assert r["meta"]["title"] == "Благодать" and r["owner"] == "admin@x.pl" and r["status"] == "draft" and len(r["blocks"]) == 1
    assert r["lock"]["email"] == "admin@x.pl"   # новая проповедь сразу под замком автора
    # правка после сохранения снова помечается
    page.evaluate("state.meta.title = 'Благодать 2'; change()")
    assert "Не сохранено: уйдёт в облако само" in page.inner_text("#hd-save")
    ctx.close()


def test_open_cloud_sermon_edit_and_unsaved_recovery(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    page.wait_for_selector(".scard")
    page.locator(".scard").first.click()
    page.wait_for_function("state && state.id === 's1' && screen === 'sermon' && ed.id === 's1'")
    assert page.evaluate("state.blocks[0].speech") == "<b>привет</b>"
    assert "Только просмотр" in page.inner_text("#hd-save")
    page.get_by_role("button", name="Редактировать").click()
    page.wait_for_function("ed.mode === 'edit'")
    page.evaluate("state.meta.title = 'Вера и дела'; change()")
    page.wait_for_timeout(600)   # черновик сохраняется в браузере с паузой, в облако — позже
    page.on("dialog", lambda d: d.accept())   # «Покинуть сайт?» — правки ещё не в облаке
    page.reload()
    page.wait_for_function("state && state.id === 's1' && screen === 'sermon' && ed.mode === 'edit'")
    assert page.evaluate("state.meta.title") == "Вера и дела"      # несохранённые правки не потерялись, правка продолжается
    page.wait_for_function("fakeCloud.db().sermons.s1.meta.title === 'Вера и дела'", timeout=10000)
    page.evaluate("state.meta.title = 'Вера и дела 2'; change(); saveNow()")
    page.wait_for_function("fakeCloud.db().sermons.s1.meta.title === 'Вера и дела 2'")
    assert not page.locator(".sheet[aria-label='Проповедь уже изменили']").count()   # свои записи до перезагрузки — не конфликт
    ctx.close()


def test_conflict_replace_and_copy(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    open_edit(page, "s1")
    # замок за это время пропал (истёк, его сняли), и «другой человек» сохранил свою версию
    page.evaluate(OTHER_EDIT)
    page.evaluate("state.meta.title = 'Моя версия'; change(); saveNow()")
    page.wait_for_selector(".sheet[aria-label='Проповедь уже изменили']")
    assert page.evaluate("fakeCloud.db().sermons.s1.meta.title") == "Чужая версия"    # молча ничего не затёрто
    page.get_by_role("button", name="Сохранить копией").click()
    page.wait_for_function("Object.keys(fakeCloud.db().sermons).length === 2")
    sermons = page.evaluate("fakeCloud.db().sermons")
    assert sermons["s1"]["meta"]["title"] == "Чужая версия"
    copy = [r for k, r in sermons.items() if k != "s1"][0]
    assert copy["meta"]["title"] == "Моя версия (копия)"
    ctx.close()


def test_conflict_force_replace(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    open_edit(page, "s1")
    page.evaluate(OTHER_EDIT)
    page.evaluate("state.meta.title = 'Моя версия'; change(); saveNow()")
    page.wait_for_selector(".sheet[aria-label='Проповедь уже изменили']")
    assert "другая версия" in page.inner_text("#hd-save")   # пока не выбрали, в облако ничего не уходит
    page.get_by_role("button", name="Заменить облачную").click()
    page.wait_for_function("fakeCloud.db().sermons.s1.meta.title === 'Моя версия'")
    ctx.close()


OTHER_EDIT = """(() => { const db = fakeCloud.db(), r = db.sermons.s1; r.lock = null; r.meta.title = 'Чужая версия';
  r.updatedAt += 5000; r.updatedBy = 'petr@x.pl'; fakeCloud.put(db); })()"""


def test_browser_drafts_on_home(browser, base_url):
    """На главной — только облако; несохранённый черновик этого пространства (новая проповедь, не успевшая уйти) виден
    с пометкой и удаляется; старые черновики без пространства (до облака) и черновики других пространств не видны."""
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    page.wait_for_selector(".scard")
    old = {"app": "swp-sermon", "v": 2, "id": "old1", "createdAt": 1, "updatedAt": 2, "savedAt": 0, "meta": {"title": "Старый черновик", "date": "2099-02-01"},
           "blocks": [{"id": "b1", "type": "splash"}]}
    new = dict(old, id="new1", meta={"title": "Новая, не в облаке", "date": "2099-02-01"}, cloudSpace="sp1", cloudAt=0)
    other = dict(old, id="oth1", meta={"title": "Из другого пространства", "date": "2099-02-01"}, cloudSpace="sp2", cloudAt=0)
    page.evaluate("ds => { ds.forEach(d => localStorage.setItem('swp-sermon:' + d.id, JSON.stringify(d))); renderHomeList(); }", [old, new, other])
    body = page.inner_text(".home")
    assert "Старый черновик" not in body and "Из другого пространства" not in body
    assert "Только в этом браузере" not in body and not page.get_by_role("button", name="В облако").count()
    card = page.locator(".card-wrap", has_text="Новая, не в облаке")
    assert "Не сохранено в облако" in card.inner_text()
    page.on("dialog", lambda d: d.accept())
    card.locator(".card-del").click(force=True)
    page.wait_for_function("!localStorage.getItem('swp-sermon:new1')")
    assert "Новая, не в облаке" not in page.inner_text(".home")
    assert page.locator(".scard").count() == 1
    assert not page.errors, page.errors
    ctx.close()


def test_delete_from_cloud(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    page.wait_for_selector(".scard")
    page.on("dialog", lambda d: d.accept())
    page.locator(".card-del").first.click(force=True)
    page.wait_for_function("Object.keys(fakeCloud.db().sermons).length === 0")
    ctx.close()


def test_preacher_sees_all_but_edits_own(browser, base_url):
    sermons = {"mine": rec("mine", "Моя", owner="ivan@x.pl"), "other": rec("other", "Чужая", owner="petr@x.pl")}
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons=sermons)
    wait_home(page)
    page.wait_for_selector(".scard")
    assert page.locator(".scard").count() == 2
    page.evaluate("navigate(sermonHash('other'))")
    page.wait_for_function("state && state.id === 'other' && screen === 'sermon' && ed.id === 'other'")
    assert "другого автора" in page.inner_text("#hd-save")
    assert not page.get_by_role("button", name="Редактировать").count()
    assert page.get_by_role("button", name="Сделать копию").is_visible()
    page.evaluate("state.meta.title = 'Правка'; change()")   # правка в просмотре не проходит
    assert page.evaluate("state.meta.title") == "Чужая"
    assert "другого автора" in page.inner_text(".toast")
    page.wait_for_timeout(300)
    assert page.evaluate("fakeCloud.db().sermons.other.meta.title") == "Чужая"
    assert page.evaluate("fakeCloud.calls.save + fakeCloud.calls.lock") == 0
    # свою можно
    page.evaluate("navigate(sermonHash('mine'))")
    page.wait_for_function("state && state.id === 'mine' && ed.id === 'mine'")
    assert page.get_by_role("button", name="Редактировать").is_enabled()
    ctx.close()


def test_new_sermon_defaults_to_me_and_can_be_changed(browser, base_url):
    members = dict(MEMBERS, **{"admin@x.pl": {"role": "admin"}})
    for user, want in [(IVAN, ["Иван", "Петров"]), ({"email": "admin@x.pl", "name": "Виталий Бисюков"}, ["Виталий", "Бисюков"])]:
        ctx, page = cloud_page(browser, base_url, user=user, members=members)
        wait_home(page)
        page.evaluate("newSermon()")
        page.wait_for_selector(".sheet[aria-label='О проповеди']")
        assert page.evaluate("[state.meta.firstName, state.meta.lastName]") == want
        # заменить на другого можно
        page.select_option("select[aria-label='Автор']", "__other")
        page.fill("input[aria-label='Имя']", "Пётр")
        assert page.evaluate("state.meta.firstName") == "Пётр"
        ctx.close()


def test_preacher_closed_space_lists_only_own(browser, base_url):
    sermons = {"mine": rec("mine", "Моя", owner="ivan@x.pl"), "other": rec("other", "Чужая", owner="petr@x.pl")}
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons=sermons, settings={"preachersSeeAll": False})
    wait_home(page)
    page.wait_for_selector(".scard")
    assert page.locator(".scard").count() == 1
    ctx.close()


def test_sign_out_returns_to_gate(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS)
    wait_home(page)
    page.evaluate("cloudSignOut()")
    page.wait_for_selector(".gate")
    ctx.close()


def test_link_to_sermon_opens_after_sign_in(browser, base_url):
    ctx, page = cloud_page(browser, base_url, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    page.goto(base_url + "/index.html#s=s1")
    page.wait_for_selector(".gate")
    page.get_by_role("button", name="Войти через Google").click()
    page.wait_for_function("state && state.id === 's1' && screen === 'sermon'")
    ctx.close()


def test_file_has_no_cloud_marks(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    page.evaluate("navigate(sermonHash('s1'))")
    page.wait_for_function("state && state.id === 's1' && screen === 'sermon'")
    with page.expect_download() as dl:
        page.evaluate("saveFile()")
    data = json.loads(open(dl.value.path(), encoding="utf-8").read())
    assert not [k for k in data if k.startswith("cloud")]
    ctx.close()
