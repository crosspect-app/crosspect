"""Этап 10.1: отправка ссылки конкретному человеку в Telegram, шапка конспекта в одну строку (статус сворачивается в кнопку
со списком). С этапа 10.1.2 вкладки «Операторы» нет: Telegram — колонка в «Людях», оператор — роль; операторы этапа 10.1
(config/operators) переносятся в людей. Облако подменено: tests/fixtures/fake_cloud.js."""
import pytest

from conftest import cloud_page, open_sermon
from test_cloud import ADMIN, IVAN, MEMBERS, rec, wait_home

ED = {"email": "ed@x.pl", "name": "Редактор"}
PEOPLE = dict(MEMBERS, **{"ed@x.pl": {"role": "editor", "firstName": "Эдуард", "lastName": "Редактов"}})
OPS = {"o1": {"name": "Пётр Оператор", "tg": "petr_op"}, "o2": {"name": "Анна", "tg": "anna_live"}}   # операторы этапа 10.1
TG_PEOPLE = {"p-op0000001": {"role": "operator", "firstName": "Пётр", "lastName": "Оператор", "tg": "petr_op"},
             "p-op0000002": {"role": "operator", "firstName": "Анна", "lastName": "", "tg": "anna_live"}}

SPY = "window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; true"


def open_people(page):
    page.evaluate("openSpaces()")
    page.wait_for_selector(".space-sheet .sp-people")


def put_people(page, people):
    page.evaluate("p => { const db = fakeCloud.db(); Object.assign(db.members, p); fakeCloud.put(db); }", people)


def opened(page):
    return page.evaluate("window.__opened")


def edit_people(page):
    if not page.locator(".sp-table.editing").count():
        page.locator(".sp-edit").click()
        page.wait_for_selector(".sp-table.editing")


def save_people(page):
    page.locator(".sp-save").click()


def add_person(page, first, tg, role="operator", save=True):
    """Новая строка в правке «Людей»; save=False — только заполнить (последняя новая строка)."""
    edit_people(page)
    page.locator(".sp-people .sp-addrow").click()
    row = page.locator(".sp-people .sp-new").last
    row.locator("input[aria-label='Имя']").fill(first)
    row.locator("input[aria-label='Telegram']").fill(tg)
    row.locator("select[aria-label='Роль']").select_option(role)
    if save:
        save_people(page)
    return row


def tg_members(page):
    return page.evaluate("Object.entries(fakeCloud.db().members).filter(([k, m]) => m.tg).map(([k, m]) => Object.assign({ key:k }, m))")


@pytest.mark.parametrize("raw", ["@ivan_op", "ivan_op", "t.me/ivan_op", "https://t.me/ivan_op", "telegram.me/ivan_op", "  HTTP://www.t.me/ivan_op?start=1 "])
def test_add_normalizes_all_inputs(browser, base_url, raw):
    ctx, page = cloud_page(browser, base_url, user=ED, members=PEOPLE)
    wait_home(page)
    open_people(page)
    add_person(page, "  Иван   ", raw)
    page.wait_for_function("Object.values(fakeCloud.db().members).some(m => m.tg)")
    [m] = tg_members(page)
    assert m["tg"] == "ivan_op" and m["firstName"] == "Иван" and m["role"] == "operator" and "email" not in m
    assert m["key"].startswith("p-")
    page.wait_for_selector(f".sp-row[data-key='{m['key']}']")
    page.wait_for_selector(".sp-table.editing", state="detached")
    assert page.locator(f".sp-row[data-key='{m['key']}'] .sp-tg").inner_text().strip() == "@ivan_op"
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
])
def test_add_rejects_bad_username(browser, base_url, raw, msg):
    ctx, page = cloud_page(browser, base_url, user=ED, members=PEOPLE)
    wait_home(page)
    open_people(page)
    row = add_person(page, "Иван", raw)
    assert row.locator(".sp-err").inner_text() == msg
    assert page.locator(".sp-table.editing").count() == 1
    assert len(page.evaluate("fakeCloud.db().members")) == len(PEOPLE)   # ничего не сохранилось
    ctx.close()


def test_add_needs_name_and_rejects_duplicate(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=PEOPLE)
    wait_home(page)
    put_people(page, TG_PEOPLE)
    open_people(page)
    page.wait_for_selector(".sp-row[data-key='p-op0000001']")
    row = add_person(page, "", "new_one")
    assert row.locator(".sp-err").inner_text() == "Укажите имя или фамилию"
    row.locator("input[aria-label='Имя']").fill("Другой Пётр")
    row.locator("input[aria-label='Telegram']").fill("@PETR_op")   # регистр не важен
    save_people(page)
    page.locator(".sp-people .sp-err", has_text="Этот Telegram уже указан у другого человека").first.wait_for()
    assert len(tg_members(page)) == 2
    ctx.close()


def test_edit_rows_save_on_button_and_validate(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=PEOPLE)
    wait_home(page)
    put_people(page, TG_PEOPLE)
    open_people(page)
    page.wait_for_selector(".sp-row[data-key='p-op0000001']")
    edit_people(page)
    sel = ".sp-row[data-key='p-op0000001']"
    tg = page.locator(sel + " input[aria-label='Telegram']")
    tg.fill("петя")
    save_people(page)
    assert page.locator(sel + " .sp-err").inner_text() == "Имя пользователя в Telegram — латиницей, от 5 до 32 символов"
    tg.fill("anna_live")
    save_people(page)
    page.locator(".sp-people .sp-err", has_text="Этот Telegram уже указан у другого человека").first.wait_for()
    assert page.evaluate("fakeCloud.db().members['p-op0000001'].tg") == "petr_op"
    tg.fill("t.me/petr_new")
    assert page.evaluate("fakeCloud.db().members['p-op0000001'].tg") == "petr_op"   # до «Сохранить» в облаке прежнее
    save_people(page)
    page.wait_for_function("fakeCloud.db().members['p-op0000001'].tg === 'petr_new'")
    page.wait_for_selector(".sp-table.editing", state="detached")
    assert page.locator(sel + " .sp-tg").inner_text().strip() == "@petr_new"
    # пусто — Telegram убран, кнопки «Проверить» нет
    edit_people(page)
    page.locator(sel + " input[aria-label='Telegram']").fill("")
    save_people(page)
    page.wait_for_function("!fakeCloud.db().members['p-op0000001'].tg")
    page.wait_for_selector(".sp-table.editing", state="detached")
    page.wait_for_function("s => !document.querySelector(s + ' .sp-check')", arg=sel)
    # удалить — при сохранении, с подтверждением
    edit_people(page)
    page.locator(".sp-row[data-key='p-op0000002']").get_by_role("button", name="Убрать из пространства").click()
    assert page.evaluate("!!fakeCloud.db().members['p-op0000002']")
    page.once("dialog", lambda d: d.accept())
    save_people(page)
    page.wait_for_function("!fakeCloud.db().members['p-op0000002']")
    assert not page.errors, page.errors
    ctx.close()


def test_check_button_opens_profile(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=PEOPLE)
    page.evaluate(SPY)
    wait_home(page)
    put_people(page, TG_PEOPLE)
    open_people(page)
    page.locator(".sp-row[data-key='p-op0000001']").get_by_role("button", name="Проверить").click()
    assert opened(page) == ["https://t.me/petr_op"]
    ctx.close()


def test_operators_of_10_1_move_to_people(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=PEOPLE)
    page.evaluate("o => { const db = fakeCloud.db(); db.operators = o; fakeCloud.put(db); }", OPS)
    page.reload()
    wait_home(page)
    page.wait_for_function("fakeCloud.db().operators === undefined")
    ops = sorted((m["firstName"], m["lastName"], m["tg"], m["role"]) for m in tg_members(page))
    assert ops == [("Анна", "", "anna_live", "operator"), ("Пётр", "Оператор", "petr_op", "operator")]
    page.wait_for_function("tgPeople().length === 2")
    ctx.close()
    # автор операторов не переносит (у него нет прав) — и список в Telegram у него пустой, пока перенос не сделал редактор
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=PEOPLE)
    page.evaluate("o => { const db = fakeCloud.db(); db.operators = o; fakeCloud.put(db); }", OPS)
    page.reload()
    wait_home(page)
    page.wait_for_timeout(300)
    assert page.evaluate("fakeCloud.db().operators") == OPS
    assert page.evaluate("fakeCloud.calls.migrate || 0") == 0
    ctx.close()


def link_sheet(page):
    page.evaluate("opLinkSheet('k123')")
    page.wait_for_selector(".oplink-url")


def sermon_page(browser, base_url, user, people):
    s = rec("s1", "Вера и дела", owner=user["email"])
    s["meta"]["firstName"], s["meta"]["lastName"], s["meta"]["date"] = "Иван", "Петров", "2026-11-15"
    ctx, page = cloud_page(browser, base_url, user=user, members=dict(PEOPLE, **(people or {})), sermons={"s1": s})
    page.evaluate(SPY)
    wait_home(page)
    if people:
        page.wait_for_function("tgPeople().length === %d" % len(people))
    open_sermon(page, s, edit=False)
    return ctx, page


def test_telegram_without_people_as_before(browser, base_url):
    ctx, page = sermon_page(browser, base_url, ED, None)
    link_sheet(page)
    page.locator(".oplink").get_by_role("button", name="В Telegram").click()
    assert page.locator(".dd-list").count() == 0
    [u] = opened(page)
    assert u.startswith("https://t.me/share/url?url=")
    ctx.close()


def test_telegram_with_people_opens_chat_with_text(browser, base_url):
    people = dict(TG_PEOPLE, **{"ed2@x.pl": {"role": "editor", "firstName": "Борис", "lastName": "Редактор", "tg": "boris_ed"}})   # любой роли
    ctx, page = sermon_page(browser, base_url, ED, people)
    link_sheet(page)
    page.locator(".oplink").get_by_role("button", name="В Telegram").click()
    # имена по алфавиту, линия, «Другому…»
    assert [b.strip() for b in page.locator(".dd-list button").all_inner_texts()] == ["Анна", "Борис Редактор", "Пётр Оператор", "Другому…"]
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
    ctx, page = sermon_page(browser, base_url, ED, TG_PEOPLE)
    link_sheet(page)
    page.locator(".oplink").get_by_role("button", name="В Telegram").click()
    page.locator(".dd-list button", has_text="Другому…").click()
    [u] = opened(page)
    assert u.startswith("https://t.me/share/url?url=") and "&text=" in u
    ctx.close()


def test_author_reads_telegram_list(browser, base_url):
    ctx, page = sermon_page(browser, base_url, IVAN, TG_PEOPLE)
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
