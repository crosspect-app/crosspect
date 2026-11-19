"""Этап 10.5.8: «Настройки слайдов» по вкладкам — Общее · Заставка · Писание · Тезис · Цитата.
Облако подменено: tests/fixtures/fake_cloud.js."""
from conftest import cfg_tab, cloud_page
from test_ui71 import ED, MEMBERS_ED, three_slides
from test_lock import open_sermon

CAPS = "[...document.querySelectorAll('.scfg-sec:not([hidden]) .scfg-cap')].map(x => x.textContent)"


def opened(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED, sermons={"s1": three_slides()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    page.evaluate("openSlidesCfg()")
    page.wait_for_selector(".scfg-slide .sl")
    return ctx, page


def test_each_tab_shows_only_its_blocks(browser, base_url):
    ctx, page = opened(browser, base_url)
    assert page.evaluate(CAPS) == ["Шрифты", "Поля и название слайда", "Фон", "Расположение панелей на экране «Слайды»"]
    for tab, caps in (("Заставка", ["Название проповеди", "Нижняя строка: имя и дата"]),
                      ("Писание", ["Текст стихов", "Блок «Текст»", "Как стоят стихи"]),
                      ("Тезис", ["Текст"]), ("Цитата", ["Текст"])):
        cfg_tab(page, tab)
        assert page.evaluate(CAPS) == caps, tab
        assert page.locator(".scfg-tolink").is_visible()
    cfg_tab(page, "Общее")
    assert not page.locator(".scfg-tolink").is_visible()
    assert not page.errors, page.errors
    ctx.close()


def test_general_sample_is_four_slides_with_guides(browser, base_url):
    ctx, page = opened(browser, base_url)
    assert page.locator(".scfg-slide .sl").count() == 4
    assert "Общие настройки действуют на все виды слайдов" in page.inner_text(".scfg-info")
    page.locator(".scfg [aria-label='Поля сверху']").focus()
    page.wait_for_function("document.querySelectorAll('.scfg-slide .sl-guide').length === 4")   # «Область текста» на всех четырёх
    page.locator(".scfg [aria-label='Поля сверху']").blur()
    page.wait_for_function("document.querySelectorAll('.scfg-slide .sl-guide').length === 0")
    ctx.close()


def test_link_goes_to_general_and_tabs_keep_values(browser, base_url):
    ctx, page = opened(browser, base_url)
    cfg_tab(page, "Тезис")
    page.locator(".scfg [aria-label='Тезис: лимит символов']").fill("150")
    page.locator(".scfg-tolink").get_by_role("button", name="Общее").click()
    assert page.locator(".scfg-tabs button.on").inner_text() == "Общее"
    cfg_tab(page, "Цитата")
    cfg_tab(page, "Тезис")
    assert page.locator(".scfg [aria-label='Тезис: лимит символов']").input_value() == "150"
    assert page.evaluate("fakeCloud.calls.slides || 0") == 0   # до «Применить» ничего не уходит
    ctx.close()


def test_splash_size_applies_and_foot_switch_greys_fields(browser, base_url):
    ctx, page = opened(browser, base_url)
    cfg_tab(page, "Заставка")
    foot = page.locator(".scfg [aria-label='Заставка: имя и дата: размер']")
    assert foot.is_enabled()
    page.get_by_text("Показывать на заставке").click()
    assert foot.is_disabled()
    page.get_by_text("Показывать на заставке").click()
    assert foot.is_enabled()
    page.locator(".scfg [aria-label='Заставка: название: размер 100%']").fill("160")
    page.get_by_role("button", name="Применить").click()
    page.wait_for_function("fakeCloud.calls.slides === 1")
    assert page.evaluate("fakeCloud.db().slides.kinds.splash.size") == 160
    assert page.evaluate("SLIDES_BASE.kinds.splash.size") == 160
    assert not page.errors, page.errors
    ctx.close()


def test_tabs_scroll_on_narrow_screen(browser, base_url):
    ctx, page = opened(browser, base_url)
    page.set_viewport_size({"width": 340, "height": 700})
    assert page.evaluate("getComputedStyle(document.querySelector('.scfg-tabs')).overflowX") == "auto"
    assert page.evaluate("document.querySelector('.scfg-tabs').scrollWidth >= document.querySelector('.scfg-tabs').clientWidth")
    ctx.close()
