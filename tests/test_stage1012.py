"""Этап 10.1.2: люди, роли, пространства. «Настроить пространства» в выпадающем списке пространств, слева список, справа вкладки;
человек без почты (p-ключ), почта переносом записи; права редактора; удаление пустого пространства и неиспользуемой серии.
Облако подменено: tests/fixtures/fake_cloud.js (первое пространство sp1 — в корне базы, другие — в spaces)."""
from conftest import cloud_page
from test_cloud import ADMIN, IVAN, rec, wait_home
from test_stage8 import ED, space

MEMBERS = {"ed@x.pl": {"role": "editor", "firstName": "Эд", "lastName": "Редактов"},
           "ivan@x.pl": {"role": "preacher", "firstName": "Иван", "lastName": "Петров"}}


def open_window(page, item="Настроить пространства"):
    page.locator(".topbar .org-pick").click()
    page.locator(".dd-list button", has_text=item).click()
    page.wait_for_selector(".space-sheet")


def test_menu_item_under_line_and_single_space(browser, base_url):
    # одно пространство: тот же пункт открывается по названию в шапке
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS, admins=())
    wait_home(page)
    page.locator(".topbar .org-pick").click()
    items = page.locator(".dd-list > *")
    assert [items.nth(i).evaluate("e => e.tagName") for i in range(items.count())] == ["BUTTON", "HR", "BUTTON"]
    assert page.locator(".dd-list button.dd-act").inner_text() == "Настроить пространства"
    page.locator(".dd-list button.dd-act").click()
    page.wait_for_selector(".space-sheet")
    assert page.locator(".spw-item").all_inner_texts() == ["Слово веры · тест"]
    assert [t.strip() for t in page.locator(".space-tabs button").all_inner_texts()] == ["Люди", "Серии проповедей", "Общее"]
    page.evaluate("fillMenu()")
    assert "Пространств" not in page.inner_text("#menu")   # «⋯ → Пространство» убрано
    assert not page.errors, page.errors
    ctx.close()


def test_editor_sees_only_his_spaces_and_switches_inside(browser, base_url):
    sp2 = space("sp2", "Отец", members={"ed@x.pl": {"role": "editor"}, "anna@x.pl": {"role": "preacher", "firstName": "Анна"}})
    sp3 = space("sp3", "Где он автор", members={"ed@x.pl": {"role": "preacher"}})
    sp4 = space("sp4", "Чужое", members={"x@x.pl": {"role": "editor"}})
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS, admins=(), spaces={"sp2": sp2, "sp3": sp3, "sp4": sp4})
    wait_home(page)
    page.evaluate("cloud.space === 'sp1' || switchSpace('sp1')")
    open_window(page)
    assert page.locator(".spw-item").all_inner_texts() == ["Отец", "Слово веры · тест"]
    assert page.locator(".spw-item.on").inner_text() == "Слово веры · тест"   # открывается на текущем
    page.locator(".spw-item", has_text="Отец").click()
    page.wait_for_selector(".sp-row[data-email='anna@x.pl']")
    assert page.evaluate("cloud.space") == "sp1"   # текущее пространство формы не меняется
    # правка людей другого пространства уходит туда
    page.locator(".sp-edit").click()
    page.wait_for_selector(".sp-table.editing")
    page.locator(".sp-row[data-email='anna@x.pl'] input[aria-label='Фамилия']").fill("Новак")
    page.locator(".sp-row[data-email='anna@x.pl'] input[aria-label='Фамилия']").press("Tab")
    assert page.evaluate("fakeCloud.db().spaces.sp2.members['anna@x.pl'].lastName") != "Новак"
    page.locator(".sp-save").click()
    page.wait_for_function("fakeCloud.db().spaces.sp2.members['anna@x.pl'].lastName === 'Новак'")
    assert page.evaluate("PREACHERS") == ["Петров Иван"]   # авторы текущего пространства не смешались
    page.evaluate("closeSettings()")
    assert page.evaluate("SPW") is None   # окно закрыто — его слушатели остановлены
    ctx.close()


def test_person_without_email_and_moving_email(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS, admins=())
    wait_home(page)
    open_window(page)
    page.locator(".sp-edit").click()
    page.wait_for_selector(".sp-table.editing")
    page.locator(".sp-people .sp-addrow").click()
    new = page.locator(".sp-people .sp-new").last
    new.locator("input[aria-label='Почта Google']").fill("guest@x.pl")
    page.locator(".sp-save").click()
    assert new.locator(".sp-err").inner_text() == "Укажите имя или фамилию"
    new.locator("input[aria-label='Почта Google']").fill("")
    new.locator("input[aria-label='Имя']").fill("Гость")
    new.locator("input[aria-label='Фамилия']").fill("Гостев")
    page.locator(".sp-save").click()
    page.wait_for_selector(".sp-table.editing", state="detached")
    page.wait_for_function("Object.keys(fakeCloud.db().members).some(k => k.startsWith('p-'))")
    key = page.evaluate("Object.keys(fakeCloud.db().members).find(k => k.startsWith('p-'))")
    m = page.evaluate("k => fakeCloud.db().members[k]", key)
    assert m["role"] == "preacher" and "email" not in m
    row = page.locator(f".sp-row[data-key='{key}']")
    row.wait_for()
    assert row.locator(".sp-seen").inner_text() == "—" and row.locator(".sp-seen").get_attribute("title") == "Без почты в форму не войти"
    page.wait_for_function("PREACHERS.includes('Гостев Гость')")   # автор без почты — в списке авторов
    # почту дописали: запись переехала на ключ-почту (при сохранении)
    page.locator(".sp-edit").click()
    page.wait_for_selector(".sp-table.editing")
    mail = row.locator("input[aria-label='Почта Google']")
    mail.fill("ivan@x.pl")
    page.locator(".sp-save").click()
    assert row.locator(".sp-err").inner_text() == "Человек с такой почтой уже есть"   # ошибка — у строки, которую правили
    mail.fill("не почта")
    page.locator(".sp-save").click()
    assert row.locator(".sp-err").inner_text() == "Проверьте почту"
    assert page.evaluate("k => !!fakeCloud.db().members[k]", key)
    mail.fill("Guest@X.pl")
    page.locator(".sp-save").click()
    page.wait_for_function("k => !fakeCloud.db().members[k] && fakeCloud.db().members['guest@x.pl']", arg=key)
    assert page.evaluate("fakeCloud.db().members['guest@x.pl']")["firstName"] == "Гость"
    page.wait_for_selector(".sp-row[data-email='guest@x.pl']")
    assert page.locator(".sp-row[data-email='guest@x.pl'] .sp-seen").inner_text() == "не входил"
    # и обратно без почты
    page.locator(".sp-edit").click()
    page.wait_for_selector(".sp-table.editing")
    mail = page.locator(".sp-row[data-email='guest@x.pl'] input[aria-label='Почта Google']")
    mail.fill("")
    page.locator(".sp-save").click()
    page.wait_for_function("!fakeCloud.db().members['guest@x.pl'] && Object.keys(fakeCloud.db().members).some(k => k.startsWith('p-'))")
    assert not page.errors, page.errors
    ctx.close()


def test_operator_with_email_cannot_enter(browser, base_url):
    members = dict(MEMBERS, **{"op@x.pl": {"role": "operator", "firstName": "Опер"}})
    ctx, page = cloud_page(browser, base_url, user={"email": "op@x.pl", "name": "Опер"}, members=members, admins=())
    page.wait_for_selector("text=Нет доступа")
    assert page.evaluate("cloud.mode") == "noaccess"
    ctx.close()
    # в таблице у оператора вместо входа — прочерк, и в авторах его нет
    ctx, page = cloud_page(browser, base_url, user=ED, members=members, admins=())
    wait_home(page)
    open_window(page)
    seen = page.locator(".sp-row[data-email='op@x.pl'] .sp-seen")
    assert seen.inner_text() == "—" and seen.get_attribute("title") == "Оператор в форму не входит"
    assert page.evaluate("PREACHERS") == ["Петров Иван"]   # редактор и оператор — не авторы
    ctx.close()


def test_delete_series_only_when_unused(browser, base_url):
    used = rec("s1", "С серией")
    used["meta"]["series"] = "a1"
    gone = rec("s2", "В корзине")
    gone["meta"]["series"] = "a2"
    gone["deletedAt"], gone["deletedBy"] = 6000, "ed@x.pl"
    series = {"a1": {"name": "Псалмы", "active": True, "format": ""}, "a2": {"name": "Притчи", "active": True, "format": ""},
              "a3": {"name": "Пустая", "active": False, "format": ""}}
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS, admins=(), sermons={"s1": used, "s2": gone}, series=series)
    wait_home(page)
    page.wait_for_function("cloud.list && cloud.list.size === 2")
    open_window(page)
    page.locator(".space-tabs button", has_text="Серии проповедей").click()
    page.locator(".sp-edit").click()
    page.wait_for_selector(".sp-table.editing")
    for sid, tip in (("a1", "Выбрана в конспектах: 1"), ("a2", "Выбрана в конспектах: 1")):   # корзина тоже считается
        cell = page.locator(f".sp-row[data-id='{sid}'] .sp-del-off")
        assert cell.get_attribute("title") == tip
        assert cell.locator("button").is_disabled()
    page.locator(".sp-row[data-id='a3']").get_by_role("button", name="Удалить серию").click()
    assert page.evaluate("!!fakeCloud.db().series.a3")   # убрана из черновика, в облаке — до «Сохранить»
    page.locator(".sp-save").click()
    page.wait_for_function("!fakeCloud.db().series.a3 && fakeCloud.db().series.a1")
    page.wait_for_function("!SERIES.a3")
    assert not page.errors, page.errors
    ctx.close()


def test_admin_deletes_empty_space_not_full(browser, base_url):
    sp2 = space("sp2", "Пустое", members={"ed@x.pl": {"role": "editor"}})
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")}, spaces={"sp2": sp2})
    wait_home(page)
    page.evaluate("cloud.space === 'sp1' || switchSpace('sp1')")
    page.wait_for_function("cloud.space === 'sp1' && cloud.list")
    open_window(page)
    page.locator(".space-tabs button", has_text="Общее").click()
    page.get_by_role("button", name="Удалить пространство").click()
    page.wait_for_selector(".sp-danger .sp-err:not(:empty)")
    assert page.locator(".sp-danger .sp-err").inner_text() == "В пространстве есть конспекты (1). Удалите их и очистите корзину, потом удалите пространство."
    assert page.evaluate("fakeCloud.calls.delSpace || 0") == 0
    # пустое: с подтверждением; удалили не текущее — остаёмся в окне
    page.locator(".spw-item", has_text="Пустое").click()
    page.wait_for_selector(".spw-item.on >> text=Пустое")
    page.locator(".space-tabs button", has_text="Общее").click()
    msgs = []
    page.once("dialog", lambda d: (msgs.append(d.message), d.dismiss()))
    page.get_by_role("button", name="Удалить пространство").click()
    page.wait_for_function("true")
    page.wait_for_timeout(200)
    assert msgs and "Вернуть их будет нельзя" in msgs[0]
    assert page.evaluate("!!fakeCloud.db().spaces.sp2")   # отказались — ничего не удалено
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("button", name="Удалить пространство").click()
    page.wait_for_function("!fakeCloud.db().spaces.sp2")
    page.wait_for_function("!cloud.spaces.some(x => x.id === 'sp2')")
    assert page.locator(".spw-item").all_inner_texts() == ["Слово веры · тест"]
    assert page.evaluate("cloud.space") == "sp1"
    assert not page.errors, page.errors
    ctx.close()


def test_admin_deletes_current_space_and_moves_on(browser, base_url):
    sp2 = space("sp2", "Другое", members={}, sermons={"f1": rec("f1", "Там")})
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, spaces={"sp2": sp2})
    wait_home(page)
    page.evaluate("cloud.space === 'sp1' || switchSpace('sp1')")
    page.wait_for_function("cloud.space === 'sp1' && cloud.list")
    open_window(page)
    page.locator(".space-tabs button", has_text="Общее").click()
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("button", name="Удалить пространство").click()
    page.wait_for_function("cloudOn() && cloud.space === 'sp2'")
    assert page.evaluate("cloud.spaces.map(x => x.id)") == ["sp2"]
    assert page.evaluate("settingsOverlay.classList.contains('open') || !!SPW") is False   # окно закрыто
    assert not page.errors, page.errors
    ctx.close()
