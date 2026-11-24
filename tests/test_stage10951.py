"""Этап А (24 ноября 2026): меню шапки на узком и невысоком экране.
Статусы — в одну строку, без прокрутки, у края окна сдвигаются; меню «⋯» не выше окна, внутри прокрутка, на низком экране компактнее,
на телефоне — нижняя панель."""
from conftest import open_sermon
from test_phone import phone_page, rect


def status_list_ok(page):
    page.locator(".stdrop").click()
    page.wait_for_selector(".dd-list")
    return page.evaluate("""() => {
      const l = document.querySelector('.dd-list'), r = l.getBoundingClientRect();
      const bs = [...l.querySelectorAll('button')];
      return { left:r.left, right:r.right, iw:innerWidth, hscroll:l.scrollWidth > l.clientWidth + 1,
               oneLine:bs.every(b => b.getBoundingClientRect().height < 40), n:bs.length, texts:bs.map(b => b.textContent) };
    }""")


def test_status_list_one_line_and_inside_window(page, sermon):
    page.set_viewport_size({"width": 900, "height": 700})
    open_sermon(page, sermon, edit=False)
    page.wait_for_selector(".stdrop", state="attached")
    info = status_list_ok(page) if page.locator(".stdrop").is_visible() else None
    if info is None:
        page.set_viewport_size({"width": 1100, "height": 700})
        info = status_list_ok(page)
    assert info["n"] == 4 and "Презентация готова" in info["texts"]
    assert info["oneLine"] and not info["hscroll"]
    assert info["left"] >= 0 and info["right"] <= info["iw"]


def test_more_menu_fits_low_window_and_scrolls(page, sermon):
    page.set_viewport_size({"width": 1280, "height": 420})
    open_sermon(page, sermon, edit=False)
    page.evaluate("toggleMenu()")
    page.wait_for_selector("#menu.open")
    m = page.evaluate("(() => { const r = menuEl.getBoundingClientRect(); return { bottom:r.bottom, ih:innerHeight, sh:menuEl.scrollHeight, ch:menuEl.clientHeight }; })()")
    assert m["bottom"] <= m["ih"]
    assert m["sh"] > m["ch"]   # не влезло — прокрутка внутри меню
    page.evaluate("menuEl.scrollTop = menuEl.scrollHeight")
    last = page.locator("#menu button", has_text="Выйти")
    box = last.bounding_box()
    assert box["y"] + box["height"] <= 420


def test_more_menu_items_one_line_and_compact_on_low_window(page, sermon):
    page.set_viewport_size({"width": 1280, "height": 600})
    open_sermon(page, sermon, edit=False)
    page.evaluate("toggleMenu()")
    page.wait_for_selector("#menu.open")
    hs = page.evaluate("[...document.querySelectorAll('#menu button')].filter(b => b.offsetParent).map(b => b.getBoundingClientRect().height)")
    assert hs and max(hs) < 34


def test_phone_menu_is_bottom_sheet(browser, base_url):
    ctx, page = phone_page(browser, base_url)
    page.locator(".hd-more").click()
    page.wait_for_selector("#menu.open")
    m = rect(page, "#menu")
    assert m["left"] <= 1 and m["right"] >= 389 and abs(m["bottom"] - 844) <= 1
    assert m["top"] >= 0
    page.get_by_role("button", name="Выйти").scroll_into_view_if_needed()
    assert page.get_by_role("button", name="Выйти").is_visible()
    ctx.close()
