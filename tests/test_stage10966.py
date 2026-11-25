"""Этап 10.9.6.6: настройки текста на слайде — строка как в редакторе текста (вариант T1)."""
from test_stage10952 import text_page, layers


def card(page):
    page.locator(".side .ly-card[data-l='t1'] .ly-head").click()
    page.wait_for_selector(".side .pt-bar")
    return ".side .ly-card[data-l='t1'] "


def test_toolbar_row_and_controls(page, sermon):
    page.set_viewport_size({"width": 1920, "height": 1080})   # на узкой панели строка переносится — это нормально
    text_page(page, sermon)
    c = card(page)
    bar = page.locator(c + ".pt-bar")
    for s_ in (".pt-size-dn", ".pt-size", ".pt-size-up", ".pt-bold", ".pt-italic", ".pt-al[data-a='left']", ".pt-al[data-a='center']", ".pt-al[data-a='right']", ".pt-color-btn"):
        assert bar.locator(s_).count() == 1, s_
    ys = {round(bar.locator(s_).bounding_box()["y"] + bar.locator(s_).bounding_box()["height"] / 2) for s_ in (".pt-size", ".pt-bold", ".pt-al[data-a='left']", ".pt-color-btn")}
    assert max(ys) - min(ys) <= 2, ys   # всё в одну строку
    assert bar.bounding_box()["y"] < page.locator(c + ".pt-text").bounding_box()["y"]   # строка над полем
    assert page.locator(c + ".switch").count() == 0 and page.locator(c + ".toggle").count() == 0
    size0 = [l for l in layers(page) if l["kind"] == "text"][0]["size"]
    bar.locator(".pt-size-up").click(); bar.locator(".pt-size-up").click()
    assert [l for l in layers(page) if l["kind"] == "text"][0]["size"] == size0 + 4
    bar.locator(".pt-size").fill("97"); bar.locator(".pt-size").press("Enter"); bar.locator(".pt-size").blur()
    assert [l for l in layers(page) if l["kind"] == "text"][0]["size"] in (96, 98)
    bar.locator(".pt-bold").click(); bar.locator(".pt-al[data-a='right']").click()
    t = [l for l in layers(page) if l["kind"] == "text"][0]
    assert t["bold"] is True and t["align"] == "right"
    assert bar.locator(".pt-bold").get_attribute("aria-pressed") == "true"
    assert bar.locator(".pt-al.on").get_attribute("data-a") == "right"
    # цвет: палитра спрятана, открывается кружком
    assert not page.locator(c + ".pt-colors").is_visible()
    bar.locator(".pt-color-btn").click()
    page.locator(c + ".pt-colors .ph-sw").nth(1).click()
    assert [l for l in layers(page) if l["kind"] == "text"][0]["color"] == page.evaluate("PHOTO_PALETTE[1]")
    assert page.locator(c + ".pt-colors").is_visible()
    assert not page.errors, page.errors


def test_spacing_folded_and_remembered(page, sermon):
    text_page(page, sermon)
    c = card(page)
    assert page.locator(c + "details.pt-adv").get_attribute("open") is None
    assert not page.locator(c + ".pt-track").is_visible()
    page.locator(c + "details.pt-adv summary").click()
    assert page.locator(c + ".pt-track").is_visible() and page.locator(c + ".pt-lead").is_visible()
    page.wait_for_function("localStorage.getItem('crosspect.ptAdv') === '1'")
    page.evaluate("picPanelRefresh('i1')")
    assert page.locator(".side .ly-card[data-l='t1'] details.pt-adv").get_attribute("open") is not None
    assert not page.errors, page.errors
