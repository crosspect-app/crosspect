"""Таблица «Серии проповедей»: правка одной строки не стирает только что выбранный фон другой (запись от последних данных),
порядок строк не меняется, пока открыта вкладка (новая серия — внизу), по алфавиту — при следующем открытии."""
from conftest import cloud_page
from test_cloud import ADMIN, wait_home
from test_stage10 import FMT, PEOPLE, open_space, put_slides


def add_series(page, n):
    page.locator("input[aria-label='Название новой серии']").fill(n)
    page.locator("input[aria-label='Название новой серии']").press("Enter")
    page.wait_for_function("n => Object.values(fakeCloud.db().series || {}).some(x => x.name === n)", arg=n)


def names(page):
    return page.locator(".sp-series .sp-row[data-id] input[aria-label='Название серии']").evaluate_all("l => l.map(x => x.value)")


def test_format_survives_next_edit_and_order_frozen(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=PEOPLE)
    wait_home(page)
    put_slides(page, FMT)
    open_space(page, "Серии проповедей")
    add_series(page, "Псалмы")
    add_series(page, "Бытие")
    assert names(page) == ["Псалмы", "Бытие"]   # новая — внизу, без сортировки
    sid = page.evaluate("Object.keys(fakeCloud.db().series).find(id => fakeCloud.db().series[id].name === 'Бытие')")
    assert page.evaluate("document.activeElement.closest('.sp-row').dataset.id") == sid   # фокус — на фоне новой серии
    page.locator(f".sp-row[data-id='{sid}'] select[aria-label='Формат фона']").select_option("f1")
    page.wait_for_function("id => fakeCloud.db().series[id].format === 'f1'", arg=sid)
    # не уходя из окна, правим другую строку: фон «Бытия» остаётся
    psid = page.evaluate("Object.keys(fakeCloud.db().series).find(id => fakeCloud.db().series[id].name === 'Псалмы')")
    inp = page.locator(f".sp-row[data-id='{psid}'] input[aria-label='Название серии']")
    inp.fill("Ястреб")
    inp.press("Tab")
    page.wait_for_function("id => fakeCloud.db().series[id].name === 'Ястреб'", arg=psid)
    page.locator(f".sp-row[data-id='{psid}'] select[aria-label='Формат фона']").select_option("f2")
    page.wait_for_function("id => fakeCloud.db().series[id].format === 'f2'", arg=psid)
    assert page.evaluate("id => fakeCloud.db().series[id].format", sid) == "f1"
    assert page.evaluate("id => SERIES[id].format", sid) == "f1"
    page.locator(".space-sheet").click(position={"x": 5, "y": 5})
    assert names(page) == ["Ястреб", "Бытие"]   # переименовали — строка на месте
    # снова открыли вкладку — по алфавиту
    page.locator(".space-tabs button", has_text="Люди").click()
    page.locator(".space-tabs button", has_text="Серии проповедей").click()
    assert names(page) == ["Бытие", "Ястреб"]
    assert not page.errors, page.errors
    ctx.close()
