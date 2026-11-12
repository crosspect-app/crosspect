"""Этап 8: только облако, админ всей формы, переключатель пространств, сводки на главной.
Облако подменено: tests/fixtures/fake_cloud.js (первое пространство sp1 — в корне базы, другие — в spaces)."""
from conftest import cloud_page
from test_cloud import ADMIN, IVAN, rec, wait_home

ED = {"email": "ed@x.pl", "name": "Ред Акторов"}


def space(id, name, members=None, sermons=None, settings=None):
    return {"space": {"id": id, "name": name, "settings": settings or {}}, "members": members or {}, "sermons": sermons or {}}


def two_spaces(**kw):
    """sp1 «Слово веры · тест» и sp2 «Отец»: ed — редактор в обоих, ivan — автор только в sp1, админ — ни в одном"""
    members = {"ed@x.pl": {"role": "editor"}, "ivan@x.pl": {"role": "preacher", "firstName": "Иван", "lastName": "Петров"}}
    sp2 = space("sp2", "Отец", members={"ed@x.pl": {"role": "editor"}}, sermons={"f1": rec("f1", "Проповедь отца", owner="ed@x.pl")})
    return dict(members=members, sermons={"s1": rec("s1", "Вера")}, spaces={"sp2": sp2}, **kw)


def picker(page):
    return page.locator("select.org-pick")


def titles(page):
    return [t.strip() for t in page.locator(".scard .scard-title").all_inner_texts()]


def test_admin_sees_all_spaces_and_switches(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, **two_spaces())
    wait_home(page)
    page.wait_for_selector(".scard")
    assert page.evaluate("cloud.admin") is True
    assert "админ" in page.locator(".who").inner_text()
    opts = picker(page).locator("option").all_inner_texts()
    assert sorted(opts) == ["Отец", "Слово веры · тест"]
    cur = page.evaluate("cloud.space")
    other = "sp2" if cur == "sp1" else "sp1"
    picker(page).select_option(other)
    page.wait_for_function("id => cloud.space === id && cloud.list", arg=other)
    page.wait_for_selector(".scard")
    want = "Проповедь отца" if other == "sp2" else "Вера"
    assert titles(page) == [want]
    assert page.evaluate("document.title").endswith("Отец" if other == "sp2" else "Слово веры · тест")
    # выбор запоминается: после перезагрузки — то же пространство
    page.reload()
    wait_home(page)
    page.wait_for_selector(".scard")
    assert page.evaluate("cloud.space") == other
    assert titles(page) == [want]
    assert not page.errors, page.errors
    ctx.close()


def test_member_of_two_spaces_sees_only_them(browser, base_url):
    extra = space("sp3", "Чужая церковь", members={"x@x.pl": {"role": "editor"}}, sermons={"z": rec("z", "Чужая")})
    kw = two_spaces()
    kw["spaces"]["sp3"] = extra
    ctx, page = cloud_page(browser, base_url, user=ED, **kw)
    wait_home(page)
    assert page.evaluate("cloud.admin") is False
    assert sorted(picker(page).locator("option").all_inner_texts()) == ["Отец", "Слово веры · тест"]
    assert "редактор" in page.locator(".who").inner_text()
    ctx.close()


def test_one_space_no_picker(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, **two_spaces())
    wait_home(page)
    assert not picker(page).count()
    assert page.locator(".org").inner_text() == "Слово веры · тест"
    assert "автор" in page.locator(".who").inner_text()
    ctx.close()


def test_old_admin_role_is_editor(browser, base_url):
    """Роль admin у участника (до этапа 8) — просто редактор: своё пространство, «Настройки слайдов», без чужих пространств."""
    kw = two_spaces(admins=())
    kw["members"]["boss@x.pl"] = {"role": "admin"}
    ctx, page = cloud_page(browser, base_url, user={"email": "boss@x.pl", "name": "Босс"}, **kw)
    wait_home(page)
    page.wait_for_selector(".scard")
    assert page.evaluate("[cloud.admin, cloud.role, cloud.spaces.length]") == [False, "editor", 1]
    assert "редактор" in page.locator(".who").inner_text()
    assert page.evaluate("canEditSlidesCfg()")
    ctx.close()


def test_noaccess_and_admin_without_spaces(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user={"email": "nobody@x.pl", "name": "Никто"}, **two_spaces())
    page.wait_for_selector(".gate h1")
    assert "Вас нет в списке" in page.inner_text(".gate h1")
    assert "swpoznan.media@gmail.com" in page.inner_text(".gate")
    assert not page.locator("text=Продолжить без входа").count()
    ctx.close()
    # админ, но пространств ещё нет: понятный экран, а не «Вас нет в списке»
    ctx, page = cloud_page(browser, base_url, user={"email": "lone@x.pl", "name": "Один"}, admins=("lone@x.pl",), no_spaces=True)
    page.wait_for_selector(".gate h1")
    assert "Пространств пока нет" in page.inner_text(".gate h1")
    assert not page.errors, page.errors
    ctx.close()


def test_link_switches_space_and_opens_sermon(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, **two_spaces())
    wait_home(page)
    page.evaluate("cloud.space === 'sp1' || switchSpace('sp1')")
    page.wait_for_function("cloud.space === 'sp1'")
    page.evaluate("location.hash = '#s=f1&sp=sp2'")
    page.wait_for_function("state && state.id === 'f1' && screen === 'sermon'")
    assert page.evaluate("cloud.space") == "sp2"
    assert page.evaluate("state.meta.title") == "Проповедь отца"
    assert "sp=sp2" in page.evaluate("sermonHash('f1')")
    # ссылка в пространство, где человека нет, — на главную с объяснением
    page.evaluate("location.hash = '#s=z&sp=nope'")
    page.wait_for_function("screen === 'home'")
    page.wait_for_selector(".toast.show")
    assert "нет доступа" in page.inner_text(".toast")
    assert not page.errors, page.errors
    ctx.close()


def test_switch_while_editing_saves_and_releases(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, **two_spaces())
    wait_home(page)
    page.evaluate("cloud.space === 'sp1' || switchSpace('sp1')")
    page.wait_for_function("cloud.space === 'sp1'")
    page.evaluate("navigate(sermonHash('s1'))")
    page.wait_for_function("state && state.id === 's1' && ed.id === 's1' && !ed.busy")
    page.locator("#app").get_by_role("button", name="Редактировать").click()
    page.wait_for_function("ed.mode === 'edit' && !ed.busy")
    page.evaluate("state.meta.title = 'Вера перед переходом'; change()")
    page.evaluate("navigate('')")
    page.wait_for_function("screen === 'home'")
    page.wait_for_selector("select.org-pick")
    picker(page).select_option("sp2")
    page.wait_for_function("cloud.space === 'sp2'")
    page.wait_for_function("fakeCloud.db().sermons.s1.meta.title === 'Вера перед переходом' && !fakeCloud.db().sermons.s1.lock")
    ctx.close()


def test_new_sermon_goes_to_current_space(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, **two_spaces())
    wait_home(page)
    page.evaluate("cloud.space === 'sp2' || switchSpace('sp2')")
    page.wait_for_function("cloud.space === 'sp2'")
    page.evaluate("newSermon()")
    page.wait_for_selector(".sheet[aria-label='О проповеди']")
    page.fill("input[aria-label='Название проповеди']", "Новая у отца")
    page.evaluate("closeSettings(); saveNow()")
    page.wait_for_function("Object.values(fakeCloud.db().spaces.sp2.sermons).some(r => r.meta.title === 'Новая у отца')")
    assert not any(r["meta"]["title"] == "Новая у отца" for r in page.evaluate("Object.values(fakeCloud.db().sermons)"))
    ctx.close()


def test_home_list_from_summaries(browser, base_url):
    """Главная слушает сводки: в списке нет слайдов, но есть их число и места Писания для поиска."""
    r = rec("s1", "Вера")
    r["blocks"] = [{"id": "a", "type": "splash"}, {"id": "n", "type": "note", "text": "свет"},
                   {"id": "b", "type": "scripture", "items": [{"kind": "scripture", "ref": "Евр. 11:1", "verses": []}]}]
    ctx, page = cloud_page(browser, base_url, user=ADMIN, sermons={"s1": r, "s2": rec("s2", "Надежда")})
    wait_home(page)
    page.wait_for_selector(".scard")
    row = page.evaluate("cloud.list.get('s1')")
    assert row["summary"] is True and "blocks" not in row
    assert row["slides"] == 2 and row["refs"] == "Евр. 11:1"
    card = page.locator(".card-wrap", has_text="Вера")
    assert "2 слайда" in card.inner_text()
    page.locator(".search input").fill("евр. 11")
    assert titles(page) == ["Вера"]
    page.locator(".search input").fill("")
    # чужой замок виден на карточке
    page.evaluate("() => { const db = fakeCloud.db(); db.sermons.s2.lock = { email:'ivan@x.pl', name:'Иван', at:Date.now(), beat:Date.now() }; fakeCloud.put(db); }")
    page.wait_for_function("document.querySelector('.home').innerText.includes('Правит Иван')")
    assert not page.errors, page.errors
    ctx.close()


def test_slide_settings_follow_space(browser, base_url):
    kw = two_spaces()
    kw["spaces"]["sp2"]["slides"] = {"margins": {"side": 140}}
    ctx, page = cloud_page(browser, base_url, user=ED, **kw)
    page.evaluate("() => { const db = fakeCloud.db(); db.slides = { margins:{ side:90 } }; fakeCloud.put(db); }")
    wait_home(page)
    page.evaluate("cloud.space === 'sp1' || switchSpace('sp1')")
    page.wait_for_function("SLIDES_BASE.margins.side === 90")
    picker(page).select_option("sp2")
    page.wait_for_function("SLIDES_BASE.margins.side === 140")
    assert "140" in page.evaluate("localStorage.getItem('swp-slides-cache:sp2')")
    assert "90" in page.evaluate("localStorage.getItem('swp-slides-cache:sp1')")
    ctx.close()
