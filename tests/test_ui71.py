"""Этап 7.1: «Настройки слайдов» общие для пространства (в облаке), лента слайдов (перетаскивание, вставка),
панель «Место Писания» и боковая панель. Облако подменено: tests/fixtures/fake_cloud.js."""
from conftest import cloud_page, start_blank
from test_cloud import ADMIN, IVAN, MEMBERS, rec
from test_lock import open_sermon, start_edit

ED = {"email": "ed@x.pl", "name": "Редактор"}
MEMBERS_ED = dict(MEMBERS, **{"ed@x.pl": {"role": "editor", "firstName": "Ред", "lastName": "Актор"}})


def menu_items(page):
    page.evaluate("fillMenu()")
    return page.evaluate("[...menuEl.querySelectorAll('button')].map(b => b.textContent.trim())")


def three_slides(id="s1"):
    r = rec(id, "Вера")
    r["blocks"] = [{"id": "b1", "type": "splash", "speech": ""},
                   {"id": "b2", "type": "thesis", "name": "Первый", "nameAuto": False, "parts": [{"kind": "text", "html": "Первый", "align": "center", "scale": 100}], "speech": ""},
                   {"id": "b3", "type": "thesis", "name": "Второй", "nameAuto": False, "parts": [{"kind": "text", "html": "Второй", "align": "center", "scale": 100}], "speech": ""}]
    return r


def order(page):
    return page.evaluate("state.blocks.map(b => b.id)")


def test_settings_window_for_editor_only(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED)
    page.wait_for_selector(".home-top")
    assert "Настройки слайдов" in menu_items(page)
    assert "Лимиты" not in menu_items(page)
    page.evaluate("openSlidesCfg()")
    sheet = page.locator(".sheet.scfg")
    text = sheet.inner_text()
    for gone in ("config.json", "Общие (по умолчанию)", "Плотность шрифта", "только в этом браузере", "обязательно"):
        assert gone not in text, gone
    for there in ("Общие настройки", "Настройки для видов слайдов", "Место Писания", "Шрифт для греческого", "С новой строки"):
        assert there in text, there
    page.wait_for_selector(".scfg-slide .sl")
    assert page.locator(".scfg-slide .sl").count() == 1   # живой пример слайда
    assert not page.errors, page.errors
    ctx.close()
    # спикер окна не видит
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS_ED)
    page.wait_for_selector(".home-top")
    assert "Настройки слайдов" not in menu_items(page)
    page.evaluate("openSlidesCfg()")
    assert page.locator(".sheet.scfg").count() == 0
    ctx.close()


def test_apply_writes_cloud_and_applies_everywhere(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED, sermons={"s1": three_slides()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    page.evaluate("openSlidesCfg()")
    page.locator(".scfg [aria-label='Тезис: между строками']").fill("1.3")
    page.locator(".scfg [aria-label='Тезис: лимит символов']").fill("150")
    page.get_by_role("button", name="С новой строки").click()
    assert page.evaluate("SLIDES_BASE.kinds.thesis.lead") == 1.05   # пока не нажали «Применить», ничего не меняется
    page.get_by_role("button", name="Применить").click()
    page.wait_for_function("fakeCloud.calls.slides === 1")
    cfg = page.evaluate("fakeCloud.db().slides")
    assert cfg["kinds"]["thesis"]["lead"] == 1.3 and cfg["limits"]["thesis"] == 150 and cfg["verses"]["flow"] == "lines"
    assert page.evaluate("SLIDES_BASE.kinds.thesis.lead") == 1.3
    # уже показанные слайды получили новые значения без перерисовки экрана
    assert page.evaluate("getComputedStyle(document.querySelector('.film .sl-stage')).getPropertyValue('--th-lead').trim()") == "1.3"
    assert page.evaluate("limitFor(state.blocks[1])") == 150
    assert not page.errors, page.errors
    ctx.close()


def test_speaker_gets_cloud_settings(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS_ED)
    page.evaluate("() => { const db = fakeCloud.db(); db.slides = { margins:{ side:120 }, verses:{ align:'right' } }; fakeCloud.put(db); }")
    page.wait_for_selector(".home-top")
    page.wait_for_function("SLIDES_BASE.margins.side === 120")
    assert page.evaluate("SLIDES_BASE.verses.align") == "right"
    assert "120" in page.evaluate("localStorage.getItem('swp-slides-cache:sp1')")   # без сети — последняя копия, у каждого пространства своя
    ctx.close()


def test_speaker_cannot_write_settings(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS_ED)
    page.wait_for_selector(".home-top")
    err = page.evaluate("cloud.api.setSlides('sp1', cloud.user, {}).then(() => 'ok', e => e.code)")
    assert err == "permission-denied"
    ctx.close()


def test_film_drag_reorders(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": three_slides()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    assert page.locator(".film .film-gap").count() == 0   # просмотр: переставлять нельзя
    start_edit(page)
    assert page.locator(".film .film-gap").count() == 3
    a = page.locator(".film .st[data-id='b3']").bounding_box()
    b = page.locator(".film .st[data-id='b1']").bounding_box()
    page.mouse.move(a["x"] + a["width"] / 2, a["y"] + a["height"] / 2)
    page.mouse.down()
    page.mouse.move(a["x"] + a["width"] / 2, a["y"] + 10, steps=3)
    page.mouse.move(b["x"] + b["width"] / 2, b["y"] + 8, steps=8)
    assert page.evaluate("drag && drag.on && drag.at") == 0   # этап 7.7: вместо черты соседи раздвигаются, место — в drag.at
    assert page.locator(".film .st-box.lifted[data-box='b3']").count() == 1
    page.mouse.up()
    page.wait_for_function("state.blocks[0].id === 'b3'")
    assert order(page) == ["b3", "b1", "b2"]
    assert page.evaluate("selId") == "b3"
    assert page.evaluate("slideName(state.blocks[0], slideNums().b3)").startswith("[1]")   # номер пересчитан
    # обычный щелчок по-прежнему выбирает слайд, а не двигает
    page.locator(".film .st[data-id='b2']").click()
    assert page.evaluate("selId") == "b2" and order(page) == ["b3", "b1", "b2"]
    # Alt+↓ с клавиатуры
    page.locator(".film .st[data-id='b3']").focus()
    page.keyboard.press("Alt+ArrowDown")
    assert order(page) == ["b1", "b3", "b2"]
    assert not page.errors, page.errors
    ctx.close()


def test_insert_between_slides(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": three_slides()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    start_edit(page)
    page.locator(".film .film-gap[data-at='1']").hover()
    page.locator(".film .film-gap[data-at='1'] .film-ins").click()
    assert page.inner_text(".overlay.open .sheet-title") == "Слайд 2"   # номер, который получит слайд (этап 9.8)
    page.locator(".overlay.open .type.t-quote").click()
    assert page.evaluate("state.blocks.map(b => b.type)") == ["splash", "quote", "thesis", "thesis"]
    # плашка «+ Добавить слайд» после последнего слайда — в конец (этап 9.8)
    page.locator(".film-end .film-ins").click()
    page.locator(".overlay.open .type.t-free").click()
    assert page.evaluate("state.blocks[state.blocks.length - 1].type") == "free"
    ctx.close()


def test_side_panel_without_move_and_todo(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": three_slides()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    start_edit(page)
    side = page.locator(".side")
    assert side.get_by_role("button", name="Выше").count() == 0 and side.get_by_role("button", name="Ниже").count() == 0
    assert side.get_by_role("button", name="Дублировать").count() == 0   # с этапа 7.4 — значками на миниатюре (test_ui74.py)
    assert page.locator(".side .editor-box").count() == 0
    assert page.locator(".stage-bar .btn.todo").count() == 1   # «Доработать» — над слайдом
    ctx.close()


def test_scripture_panel_translation_on_top(page):
    start_blank(page)
    page.evaluate("addBlock('scripture', 0)")
    page.wait_for_selector(".side .trp-field")
    labels = page.evaluate("[...document.querySelectorAll('.side .item .lbl')].map(x => x.textContent)")
    assert labels[:3] == ["Перевод", "Книга", "Глава"]
    # одним вызовом: панель может перерисоваться, когда догрузится перевод
    w_tr, w_item = page.evaluate("[document.querySelector('.side .trp-field').getBoundingClientRect().width, document.querySelector('.side .item').getBoundingClientRect().width]")
    assert w_tr > w_item * 0.8   # перевод — на всю ширину
    side = page.inner_text(".side")
    for gone in ("В строку", "Каждый с новой строки", "Рамка пунктиром", "Показывать перевод на слайде", "Стихи заглавными"):
        assert gone not in side, gone
    assert not page.errors, page.errors


def test_old_sermon_limits_are_ignored(page, sermon):
    from conftest import open_sermon as open_file
    sermon["settings"] = {"minScale": 40, "limitThesis": 10, "limitQuote": 10, "lang": "ru"}
    open_file(page, sermon)
    assert page.evaluate("state.settings") == {"lang": "ru"}
    assert page.evaluate("limitFor(state.blocks.find(b => b.type === 'thesis'))") == 220
