"""Этап 10.1: вкладка «Операторы» в «Пространстве» (config/operators), отправка ссылки конкретному оператору в Telegram,
шапка конспекта в одну строку (статус сворачивается в кнопку со списком). Облако подменено: tests/fixtures/fake_cloud.js."""
import pytest

from conftest import cloud_page, open_sermon
from test_cloud import ADMIN, IVAN, MEMBERS, rec, wait_home

ED = {"email": "ed@x.pl", "name": "Редактор"}
PEOPLE = dict(MEMBERS, **{"ed@x.pl": {"role": "editor", "firstName": "Эдуард", "lastName": "Редактов"}})
OPS = {"o1": {"name": "Пётр Оператор", "tg": "petr_op"}, "o2": {"name": "Анна", "tg": "anna_live"}}

SPY = "window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; true"


def open_space(page, tab="Операторы"):
    page.evaluate("openSpace()")
    page.wait_for_selector(".space-sheet")
    if tab:
        page.locator(".space-tabs button", has_text=tab).click()


def put_operators(page, ops):
    page.evaluate("o => { const db = fakeCloud.db(); db.operators = o; fakeCloud.put(db); }", ops)


def opened(page):
    return page.evaluate("window.__opened")


def add_operator(page, name, tg):
    add = page.locator(".sp-operators .sp-add")
    add.locator("input[aria-label='Имя нового оператора']").fill(name)
    add.locator("input[aria-label='Telegram нового оператора']").fill(tg)
    add.get_by_role("button", name="Добавить").click()


def test_tab_visible_to_admin_and_editor_not_author(browser, base_url):
    for user, can in ((ADMIN, True), (ED, True), (IVAN, False)):
        ctx, page = cloud_page(browser, base_url, user=user, members=PEOPLE)
        wait_home(page)
        assert page.evaluate("canSpace()") is can
        if can:
            open_space(page, None)
            assert [t.strip() for t in page.locator(".space-tabs button").all_inner_texts()] == ["Люди", "Серии проповедей", "Операторы", "Общее"]
            page.locator(".space-tabs button", has_text="Операторы").click()
            assert page.locator(".sp-operators").count() == 1
        else:
            page.evaluate("openSpace()")
            assert page.locator(".space-sheet").count() == 0
        ctx.close()


@pytest.mark.parametrize("raw", ["@ivan_op", "ivan_op", "t.me/ivan_op", "https://t.me/ivan_op", "telegram.me/ivan_op", "  HTTP://www.t.me/ivan_op?start=1 "])
def test_add_normalizes_all_inputs(browser, base_url, raw):
    ctx, page = cloud_page(browser, base_url, user=ED, members=PEOPLE)
    wait_home(page)
    open_space(page)
    add_operator(page, "  Иван   Оператор ", raw)
    page.wait_for_selector(".sp-operators .sp-row[data-id]")
    ops = page.evaluate("fakeCloud.db().operators")
    assert list(ops.values()) == [{"name": "Иван Оператор", "tg": "ivan_op"}]
    assert page.locator(".sp-operators .sp-row[data-id] input[aria-label='Telegram оператора']").input_value() == "@ivan_op"
    assert not page.errors, page.errors
    ctx.close()


@pytest.mark.parametrize("raw,msg", [
    ("ivan", "Имя пользователя в Telegram — латиницей, от 5 до 32 символов"),
    ("иван_оператор", "Имя пользователя в Telegram — латиницей, от 5 до 32 символов"),
    ("1ivan_op", "Имя пользователя в Telegram — латиницей, от 5 до 32 символов"),
    ("a" * 33, "Имя пользователя в Telegram — латиницей, от 5 до 32 символов"),
    ("ivan_op_", "Имя пользователя не кончается на «_» и не содержит два «_» подряд"),
    ("ivan__op", "Имя пользователя не кончается на «_» и не содержит два «_» подряд"),
    ("+48 600 100 200", "Нужно имя пользователя в Telegram, а не номер"),
    ("48600100200", "Нужно имя пользователя в Telegram, а не номер"),
    ("", "Укажите имя пользователя в Telegram"),
])
def test_add_rejects_bad_username(browser, base_url, raw, msg):
    ctx, page = cloud_page(browser, base_url, user=ED, members=PEOPLE)
    wait_home(page)
    open_space(page)
    add_operator(page, "Иван", raw)
    assert page.locator(".sp-operators .sp-add .sp-err").inner_text() == msg
    assert not page.evaluate("fakeCloud.db().operators")   # ничего не сохранилось
    ctx.close()


def test_add_needs_name_and_rejects_duplicate(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=PEOPLE)
    wait_home(page)
    put_operators(page, OPS)
    open_space(page)
    page.wait_for_selector(".sp-operators .sp-row[data-id]")
    add_operator(page, "", "new_one")
    assert page.locator(".sp-operators .sp-add .sp-err").inner_text() == "Укажите имя"
    add_operator(page, "Другой Пётр", "@PETR_op")   # регистр не важен
    assert page.locator(".sp-operators .sp-add .sp-err").inner_text() == "Этот оператор уже есть"
    assert len(page.evaluate("fakeCloud.db().operators")) == 2
    ctx.close()


def test_edit_rows_save_at_once_and_validate(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=PEOPLE)
    wait_home(page)
    put_operators(page, OPS)
    open_space(page)
    row = page.locator(".sp-row[data-id='o1']")
    row.locator("input[aria-label='Имя оператора']").fill("Пётр Звукорежиссёр")
    row.locator("input[aria-label='Имя оператора']").press("Tab")
    page.wait_for_function("fakeCloud.db().operators.o1.name === 'Пётр Звукорежиссёр'")
    # неверное имя пользователя не сохраняется, причина — под строкой
    row = page.locator(".sp-row[data-id='o1']")
    row.locator("input[aria-label='Telegram оператора']").fill("петя")
    row.locator("input[aria-label='Telegram оператора']").press("Tab")
    assert row.locator(".sp-err").inner_text() == "Имя пользователя в Telegram — латиницей, от 5 до 32 символов"
    row.locator("input[aria-label='Telegram оператора']").fill("anna_live")
    row.locator("input[aria-label='Telegram оператора']").press("Tab")
    assert row.locator(".sp-err").inner_text() == "Этот оператор уже есть"
    assert page.evaluate("fakeCloud.db().operators.o1.tg") == "petr_op"
    row.locator("input[aria-label='Telegram оператора']").fill("t.me/petr_new")
    row.locator("input[aria-label='Telegram оператора']").press("Tab")
    page.wait_for_function("fakeCloud.db().operators.o1.tg === 'petr_new'")
    assert page.locator(".sp-row[data-id='o1'] input[aria-label='Telegram оператора']").input_value() == "@petr_new"
    # удалить — с подтверждением
    page.once("dialog", lambda d: d.accept())
    page.locator(".sp-row[data-id='o2']").get_by_role("button", name="Убрать оператора").click()
    page.wait_for_function("!fakeCloud.db().operators.o2")
    assert not page.errors, page.errors
    ctx.close()


def test_check_button_opens_profile(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=PEOPLE)
    page.evaluate(SPY)
    wait_home(page)
    put_operators(page, OPS)
    open_space(page)
    page.locator(".sp-row[data-id='o1']").get_by_role("button", name="Проверить").click()
    assert opened(page) == ["https://t.me/petr_op"]
    assert "откроется его профиль" in page.locator(".sp-after").inner_text()
    ctx.close()


def link_sheet(page):
    page.evaluate("opLinkSheet('k123')")
    page.wait_for_selector(".oplink-url")


def sermon_page(browser, base_url, user, ops):
    s = rec("s1", "Вера и дела", owner=user["email"])
    s["meta"]["firstName"], s["meta"]["lastName"], s["meta"]["date"] = "Иван", "Петров", "2026-11-15"
    ctx, page = cloud_page(browser, base_url, user=user, members=PEOPLE, sermons={"s1": s})
    page.evaluate(SPY)
    wait_home(page)
    if ops:
        put_operators(page, ops)
        page.wait_for_function("Object.keys(OPERATORS).length === %d" % len(ops))
    open_sermon(page, s, edit=False)
    return ctx, page


def test_telegram_without_operators_as_before(browser, base_url):
    ctx, page = sermon_page(browser, base_url, ED, None)
    link_sheet(page)
    page.locator(".oplink").get_by_role("button", name="В Telegram").click()
    assert page.locator(".dd-list").count() == 0
    [u] = opened(page)
    assert u.startswith("https://t.me/share/url?url=")
    ctx.close()


def test_telegram_with_operators_opens_chat_with_text(browser, base_url):
    ctx, page = sermon_page(browser, base_url, ED, OPS)
    link_sheet(page)
    page.locator(".oplink").get_by_role("button", name="В Telegram").click()
    # имена по алфавиту, линия, «Другому…»
    assert [b.strip() for b in page.locator(".dd-list button").all_inner_texts()] == ["Анна", "Пётр Оператор", "Другому…"]
    assert page.locator(".dd-list hr").count() == 1
    page.locator(".dd-list button", has_text="Пётр Оператор").click()
    [u] = opened(page)
    assert u.startswith("https://t.me/petr_op?text=") and "share/url" not in u
    from urllib.parse import parse_qs, urlparse
    text = parse_qs(urlparse(u).query)["text"][0]
    lines = text.split("\n")
    assert lines[0] == page.locator(".oplink-url").input_value()   # ссылка — первой строкой самого текста
    assert lines[1] == "─" * 20 and lines[2] == "Конспект для оператора слайдов"
    assert lines[3].startswith("Вера и дела | ") and lines[4] == "15 ноября 2026 г."
    ctx.close()


def test_telegram_other_goes_to_share(browser, base_url):
    ctx, page = sermon_page(browser, base_url, ED, OPS)
    link_sheet(page)
    page.locator(".oplink").get_by_role("button", name="В Telegram").click()
    page.locator(".dd-list button", has_text="Другому…").click()
    [u] = opened(page)
    assert u.startswith("https://t.me/share/url?url=") and "&text=" in u
    ctx.close()


def test_author_reads_operators_list(browser, base_url):
    ctx, page = sermon_page(browser, base_url, IVAN, OPS)
    link_sheet(page)
    page.locator(".oplink").get_by_role("button", name="В Telegram").click()
    assert [b.strip() for b in page.locator(".dd-list button").all_inner_texts()] == ["Анна", "Пётр Оператор", "Другому…"]
    ctx.close()


# ---------- шапка конспекта ----------

LONG = "Очень длинное название конспекта про веру, надежду и любовь, которое точно не помещается в шапку"


def header(page, w):
    page.set_viewport_size({"width": w, "height": 800})
    page.wait_for_timeout(100)
    return page.evaluate("""() => { const t = document.querySelector('.topbar'); return { h:t.getBoundingClientRect().height, sw:t.scrollWidth, cw:t.clientWidth,
      full:getComputedStyle(document.querySelector('.stswitch')).display !== 'none', drop:getComputedStyle(document.querySelector('.stdrop')).display !== 'none' } }""")


@pytest.mark.parametrize("edit", [False, True])
def test_header_one_line_from_1024(browser, base_url, sermon, edit):
    sermon["meta"]["title"] = LONG
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members={"admin@x.pl": {"role": "admin"}})
    wait_home(page)
    open_sermon(page, sermon, edit=edit)
    base = header(page, 1920)
    assert base["full"] and not base["drop"]
    for w in (1024, 1100, 1280, 1440):
        r = header(page, w)
        assert r["h"] == base["h"], (w, r)            # высота как на 1920: шапка не переносится
        assert r["sw"] <= r["cw"], (w, r)             # и не вылезает вбок
        assert r["drop"] == (w <= 1400) and r["full"] == (w > 1400), (w, r)
    assert not page.errors, page.errors
    ctx.close()


def test_status_changes_through_list(browser, base_url, sermon):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members={"admin@x.pl": {"role": "admin"}})
    wait_home(page)
    open_sermon(page, sermon, edit=True)
    page.set_viewport_size({"width": 1280, "height": 800})
    drop = page.locator(".topbar .stdrop")
    assert drop.inner_text().strip() == "Черновик"
    drop.click()
    assert [b.strip() for b in page.locator(".dd-list button").all_inner_texts()] == ["Черновик", "Готов к вёрстке", "У редактора", "Презентация готова"]
    page.locator(".dd-list button", has_text="Готов к вёрстке").click()
    page.wait_for_function("state.cloudStatus === 'submitted'")
    assert page.locator(".topbar .stdrop").inner_text().strip() == "Готов к вёрстке"
    assert "st-submitted" in page.locator(".topbar .stdrop").get_attribute("class")
    # на широком экране тот же статус — в переключателе
    page.set_viewport_size({"width": 1920, "height": 800})
    assert "on" in page.locator(".topbar .stswitch .sw-opt.st-submitted").get_attribute("class")
    assert not page.errors, page.errors
    ctx.close()


def test_status_list_keeps_rules(browser, base_url, sermon):
    """Что недоступно, в списке серое с подсказкой: автору «У редактора» и «Презентация готова»; в просмотре выбор даёт подсказку, статус не меняется"""
    s = dict(sermon, id="mine")
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=PEOPLE)
    wait_home(page)
    open_sermon(page, s, edit=True)
    page.set_viewport_size({"width": 1280, "height": 800})
    page.locator(".topbar .stdrop").click()
    for name, off in (("Черновик", False), ("Готов к вёрстке", False), ("У редактора", True), ("Презентация готова", True)):
        b = page.locator(".dd-list button", has_text=name)
        assert b.is_disabled() is off, name
        if off:
            assert b.get_attribute("title") == "Этот статус ставит и снимает редактор"
    page.keyboard.press("Escape")
    page.mouse.click(5, 400)
    page.evaluate("closeEdit('button')")
    page.wait_for_function("ed.mode !== 'edit' && !ed.busy")
    page.locator(".topbar .stdrop").click()
    page.locator(".dd-list button", has_text="Готов к вёрстке").click()
    assert page.evaluate("statusKey(state.cloudStatus)") == "draft"
    ctx.close()
