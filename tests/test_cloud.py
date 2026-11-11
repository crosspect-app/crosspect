"""Вход Google и сохранение в облако (этап 5). Облако подменено: tests/fixtures/fake_cloud.js."""
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


def test_gate_then_sign_in(browser, base_url):
    ctx, page = cloud_page(browser, base_url, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    page.wait_for_selector(".gate")
    assert page.get_by_role("button", name="Войти через Google").is_visible()
    assert page.get_by_role("button", name="Продолжить без входа").is_visible()
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


def test_without_sign_in_works_as_before(browser, base_url):
    ctx, page = cloud_page(browser, base_url, members=MEMBERS)
    page.wait_for_selector(".gate")
    page.get_by_role("button", name="Продолжить без входа").click()
    wait_home(page)
    assert not page.locator(".who").count()
    page.evaluate("newSermon()")
    page.wait_for_selector(".sheet[aria-label='О проповеди']")
    page.evaluate("closeSettings(); addBlock('splash', 0)")
    page.wait_for_function("document.getElementById('hd-save').textContent.includes('Не сохранено в файл')")
    page.evaluate("menuEl.querySelector('button')")   # меню строится без ошибок
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
    assert "Не сохранено в облако" in page.inner_text("#hd-save")
    page.get_by_role("button", name="Сохранить").click()
    page.wait_for_function("document.getElementById('hd-save').textContent.includes('Сохранено в облаке')")
    db = page.evaluate("fakeCloud.db()")
    assert len(db["sermons"]) == 1
    r = next(iter(db["sermons"].values()))
    assert r["meta"]["title"] == "Благодать" and r["owner"] == "admin@x.pl" and r["status"] == "draft" and len(r["blocks"]) == 1
    # правка после сохранения снова помечается
    page.evaluate("state.meta.title = 'Благодать 2'; change()")
    assert "Не сохранено в облако" in page.inner_text("#hd-save")
    ctx.close()


def test_open_cloud_sermon_edit_and_unsaved_recovery(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    page.wait_for_selector(".scard")
    page.locator(".scard").first.click()
    page.wait_for_function("state && state.id === 's1' && screen === 'sermon'")
    assert page.evaluate("state.blocks[0].speech") == "<b>привет</b>"
    assert "Сохранено в облаке" in page.inner_text("#hd-save")
    page.evaluate("state.meta.title = 'Вера и дела'; change()")
    page.wait_for_timeout(600)   # черновик сохраняется в браузере с паузой
    page.reload()
    page.wait_for_function("state && state.id === 's1' && screen === 'sermon'")
    assert page.evaluate("state.meta.title") == "Вера и дела"      # несохранённые правки не потерялись
    assert "Не сохранено в облако" in page.inner_text("#hd-save")
    page.get_by_role("button", name="Сохранить").click()
    page.wait_for_function("fakeCloud.db().sermons.s1.meta.title === 'Вера и дела'")
    ctx.close()


def test_conflict_replace_and_copy(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    page.evaluate("navigate(sermonHash('s1'))")
    page.wait_for_function("state && state.id === 's1' && screen === 'sermon'")
    # пока форма открыта, «другой человек» сохранил свою версию
    page.evaluate("(() => { const db = fakeCloud.db(); db.sermons.s1.meta.title = 'Чужая версия'; db.sermons.s1.updatedAt += 5000; fakeCloud.put(db); })()")
    page.evaluate("state.meta.title = 'Моя версия'; change()")
    page.get_by_role("button", name="Сохранить").click()
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
    page.evaluate("navigate(sermonHash('s1'))")
    page.wait_for_function("state && state.id === 's1' && screen === 'sermon'")
    page.evaluate("(() => { const db = fakeCloud.db(); db.sermons.s1.updatedAt += 5000; fakeCloud.put(db); })()")
    page.evaluate("state.meta.title = 'Моя версия'; change()")
    page.get_by_role("button", name="Сохранить").click()
    page.get_by_role("button", name="Заменить облачную").click()
    page.wait_for_function("fakeCloud.db().sermons.s1.meta.title === 'Моя версия'")
    ctx.close()


def test_local_only_draft_goes_to_cloud(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS)
    wait_home(page)
    d = {"app": "swp-sermon", "v": 2, "id": "loc1", "createdAt": 1, "updatedAt": 2, "savedAt": 0, "meta": {"title": "Из браузера", "date": "2099-02-01"},
         "blocks": [{"id": "b1", "type": "splash"}]}
    page.evaluate("d => { localStorage.setItem('swp-sermon:loc1', JSON.stringify(d)); renderHomeList(); }", d)
    page.wait_for_selector("text=Только в этом браузере")
    assert "Не в облаке" in page.inner_text(".home")
    page.get_by_role("button", name="В облако").click()
    page.wait_for_function("fakeCloud.db().sermons.loc1")
    assert page.evaluate("fakeCloud.db().sermons.loc1.meta.title") == "Из браузера"
    page.wait_for_function("!document.body.innerText.includes('Только в этом браузере')")
    ctx.close()


def test_import_several_files(browser, base_url, sermon):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    page.wait_for_selector(".scard")
    a = dict(sermon, id="imp1"); b = dict(sermon, id="imp2"); dup = dict(sermon, id="s1")
    files = [{"name": f"{i}.json", "mimeType": "application/json", "buffer": json.dumps(x, ensure_ascii=False).encode()} for i, x in enumerate([a, b, dup])]
    page.set_input_files("#fileInput", files)
    page.wait_for_function("document.querySelector('.toast').textContent.includes('Перенос')")   # итог — когда обработаны все файлы
    assert len(page.evaluate("fakeCloud.db().sermons")) == 3
    assert "уже были в облаке: 1" in page.inner_text(".toast")
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
    page.wait_for_function("state && state.id === 'other' && screen === 'sermon'")
    assert "другого проповедника" in page.inner_text("#hd-save")
    page.evaluate("state.meta.title = 'Правка'; change()")
    page.get_by_role("button", name="Сохранить").click()
    assert "другого проповедника" in page.inner_text(".toast")
    assert page.evaluate("fakeCloud.db().sermons.other.meta.title") == "Чужая"
    # свою можно
    page.evaluate("navigate(sermonHash('mine'))")
    page.wait_for_function("state && state.id === 'mine'")
    assert "Сохранено в облаке" in page.inner_text("#hd-save")
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
        page.select_option("select[aria-label='Проповедник']", "__other")
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
