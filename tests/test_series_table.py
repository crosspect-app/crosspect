"""Этап 10.4.1: таблицы «Серии проповедей» и «Люди» — просмотр (только текст, «Изменить») и правка (черновик, «Сохранить» / «Отменить»).
Пока идёт правка, строки не сортируются (новая — внизу); после «Сохранить» — по алфавиту. Сохранение ложится поверх последних данных."""
from conftest import cloud_page
from test_cloud import ADMIN, wait_home
from test_stage10 import FMT, PEOPLE, open_space, put_slides


def names(page):
    return page.locator(".sp-series .sp-row[data-id] input[aria-label='Название серии']").evaluate_all("l => l.map(x => x.value)")


def view_names(page):
    return page.locator(".sp-series .sp-row[data-id] .sp-name").all_inner_texts()


def edit(page):
    page.locator(".sp-edit").click()
    page.wait_for_selector(".sp-table.editing")


def save(page):
    page.locator(".sp-save").click()
    page.wait_for_selector(".sp-table.editing", state="detached")


def add_series(page, n):
    page.locator(".sp-series .sp-addrow").click()
    page.locator(".sp-series .sp-new input[aria-label='Название серии']").last.fill(n)


def test_series_view_edit_save(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=PEOPLE)
    wait_home(page)
    put_slides(page, FMT)
    open_space(page, "Серии проповедей")
    assert page.locator(".sp-series input").count() == 0   # просмотр — без полей
    edit(page)
    add_series(page, "Псалмы")
    add_series(page, "Бытие")
    page.locator(".sp-series .sp-new select[aria-label='Формат фона']").last.select_option("f1")
    assert names(page) == ["Псалмы", "Бытие"]   # новые — внизу, без сортировки
    assert page.evaluate("Object.keys(fakeCloud.db().series || {}).length") == 0   # до «Сохранить» в облаке ничего
    save(page)
    page.wait_for_function("Object.keys(fakeCloud.db().series || {}).length === 2")
    assert view_names(page) == ["Бытие", "Псалмы"]   # после сохранения — по алфавиту
    sid = page.evaluate("Object.keys(fakeCloud.db().series).find(id => fakeCloud.db().series[id].name === 'Бытие')")
    psid = page.evaluate("Object.keys(fakeCloud.db().series).find(id => fakeCloud.db().series[id].name === 'Псалмы')")
    assert page.evaluate("id => fakeCloud.db().series[id].format", sid) == "f1"
    # правим две строки, переименованная остаётся на месте; фон первой не теряется
    edit(page)
    page.locator(f".sp-row[data-id='{psid}'] select[aria-label='Формат фона']").select_option("f2")
    page.locator(f".sp-row[data-id='{sid}'] input[aria-label='Название серии']").fill("Яков")
    assert names(page) == ["Яков", "Псалмы"]
    save(page)
    page.wait_for_function("id => fakeCloud.db().series[id].name === 'Яков'", arg=sid)
    db = page.evaluate("fakeCloud.db().series")
    assert db[sid]["format"] == "f1" and db[psid]["format"] == "f2"
    assert view_names(page) == ["Псалмы", "Яков"]
    # «Отменить» возвращает всё; повтор названия и пустое — ошибка, запись не уходит
    edit(page)
    page.locator(f".sp-row[data-id='{sid}'] input[aria-label='Название серии']").fill("псалмы")
    page.locator(".sp-save").click()
    assert page.locator(f".sp-row[data-id='{sid}'] .sp-err").inner_text() == "Серия с таким названием уже есть"
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("button", name="Отменить").click()
    assert view_names(page) == ["Псалмы", "Яков"]
    assert page.evaluate("id => fakeCloud.db().series[id].name", sid) == "Яков"
    assert not page.errors, page.errors
    ctx.close()


def test_leave_unsaved_asks(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=PEOPLE)
    wait_home(page)
    open_space(page, "Серии проповедей")
    edit(page)
    add_series(page, "Псалмы")
    msgs = []
    page.once("dialog", lambda d: (msgs.append(d.message), d.dismiss()))
    page.locator(".space-tabs button", has_text="Люди").click()
    assert msgs and "не сохранены" in msgs[0]
    assert page.locator(".sp-series.editing").count() == 1   # осталась в правке
    page.once("dialog", lambda d: d.dismiss())
    page.keyboard.press("Escape")
    page.evaluate("closeSettings()")
    assert page.locator(".space-sheet").count() == 1 and page.evaluate("settingsOverlay.classList.contains('open')")
    assert not page.errors, page.errors
    ctx.close()


def test_people_edit_save(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=PEOPLE)
    wait_home(page)
    open_space(page)
    assert page.locator(".sp-people input").count() == 0
    edit(page)
    page.locator(".sp-people .sp-addrow").click()
    row = page.locator(".sp-people .sp-new").last
    row.locator("input[aria-label='Имя']").fill("Мария")
    row.locator("input[aria-label='Telegram']").fill("t.me/maria_k")
    ed = page.locator(".sp-people .sp-row[data-email='ed@x.pl']")
    ed.locator("input[aria-label='Фамилия']").fill("Новиков")
    assert page.evaluate("Object.values(fakeCloud.db().members || {}).some(m => m.firstName === 'Мария')") is False
    save(page)
    page.wait_for_function("Object.values(fakeCloud.db().members || {}).some(m => m.firstName === 'Мария' && m.tg === 'maria_k')")
    page.wait_for_function("(fakeCloud.db().members['ed@x.pl'] || {}).lastName === 'Новиков'")
    # ошибка в строке не даёт сохранить
    edit(page)
    page.locator(".sp-people .sp-addrow").click()
    page.locator(".sp-people .sp-new").last.locator("input[aria-label='Почта Google']").fill("плохая")
    page.locator(".sp-save").click()
    assert "Укажите имя или фамилию" in page.locator(".sp-people .sp-new .sp-err").last.inner_text()
    assert not page.errors, page.errors
    ctx.close()
