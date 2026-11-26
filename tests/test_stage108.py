"""Этап 10.8: мелкие доработки — правая панель в окне ~1280 px, превью фона в «О проповеди», подсказка поиска, прокрутка в фотобанке.
Облако подменено: tests/fixtures/fake_cloud.js."""
from conftest import cloud_page, ME
from test_cloud import ADMIN, wait_home
from test_stage10 import FMT, PEOPLE, put_slides
from test_stage105 import open_quote
from test_stage1052 import put_bank


# ---------- 1. Правая панель ----------

OVER = """() => {
  const s = document.querySelector('.side'), cs = getComputedStyle(s), edge = s.getBoundingClientRect().right - parseFloat(cs.paddingRight) + 0.5;
  return { scroll:s.scrollWidth - s.clientWidth, out:[...s.querySelectorAll('*')].filter(e => e.getBoundingClientRect().width && e.getBoundingClientRect().right > edge)
    .map(e => (e.className || e.tagName) + ' ' + (e.textContent || '').slice(0, 20)) };
}"""


def test_quote_panel_fits_in_1280_window(browser, base_url, sermon):
    """Три кнопки «Место текста» и всё остальное в правой панели цитаты помещаются при окне 1280 px (панель 300 px)"""
    ctx, page = cloud_page(browser, base_url, user=ME, members={"admin@x.pl": {"role": "editor"}}, viewport={"width": 1280, "height": 900})
    page.wait_for_selector(".home-top")
    open_quote(page, sermon, half="right")
    assert page.evaluate("document.querySelector('.side').clientWidth") <= 320
    r = page.evaluate(OVER)
    assert r["scroll"] <= 0 and not r["out"], r
    assert page.locator(".side .q-place[data-v='right']").is_visible()
    assert not page.errors, page.errors
    ctx.close()


def test_quote_panel_toggle_unchanged_on_wide_screen(browser, base_url, sermon):
    """На широком экране переключатель не растягивается и не сжимается: кнопки в одну строку"""
    ctx, page = cloud_page(browser, base_url, user=ME, members={"admin@x.pl": {"role": "editor"}}, viewport={"width": 1920, "height": 1000})
    page.wait_for_selector(".home-top")
    open_quote(page, sermon, half="right")
    r = page.evaluate("""() => { const t = document.querySelector('.side .q-places');
      return { w:t.getBoundingClientRect().width, h:t.getBoundingClientRect().height, side:document.querySelector('.side').clientWidth }; }""")
    assert r["h"] < 50 and r["w"] < r["side"], r   # одна строка
    assert not page.evaluate(OVER)["out"]
    ctx.close()


# ---------- 2. Превью фона ----------

def test_format_preview_follows_format(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=PEOPLE)
    wait_home(page)
    put_slides(page, dict(FMT, defaultFormat="f1"))
    page.wait_for_function("slidesCfg().defaultFormat === 'f1'")
    page.evaluate("newSermon()")
    page.wait_for_selector(".meta-sheet [aria-label='Формат фона']")
    prev = page.locator(".meta-sheet .fmt-prev .sl")
    prev.wait_for()
    f = page.locator(".meta-sheet [aria-label='Формат фона']")
    bg = lambda: page.evaluate("document.querySelector('.fmt-prev .sl-stage').style.getPropertyValue('--sl-bg')")
    w = page.evaluate("document.querySelector('.fmt-prev .sl').getBoundingClientRect().width")
    assert 100 < w < 160, w                                                       # уменьшенная заставка рядом с полем
    assert page.evaluate("document.querySelector('.fmt-prev .sl').querySelector('.sl-sp-title') !== null")
    page.locator(".meta-sheet input[aria-label='Название проповеди']").fill("Вера и дела")
    page.wait_for_function("document.querySelector('.fmt-prev .sl-sp-title').textContent.replace(/\u00a0/g, ' ').toLowerCase().includes('вера и дела')")   # название на заставке — как набрали
    box = f.bounding_box(), prev.bounding_box()
    assert abs((box[0]["y"] + box[0]["height"] / 2) - (box[1]["y"] + box[1]["height"] / 2)) < 30   # на одной линии с полем
    blue = bg()
    assert blue and blue != "none"
    f.click()
    page.locator(".dd-list button", has_text="System Template").click()
    assert bg() == "none"                                                         # System Template — прежний фон без картинки
    f.click()
    page.locator(".dd-list button", has_text="Зелёный").click()
    green = bg()
    assert green != "none" and green != blue
    assert page.evaluate("lastScale") is None or page.evaluate("lastScale") > 0.15   # превью не сбивает масштаб больших слайдов
    assert not page.errors, page.errors
    ctx.close()


# ---------- 3. Подсказка поиска ----------

def test_search_placeholder_fits(page):
    inp = page.locator(".topbar .search input")
    assert inp.get_attribute("placeholder") == "Название, автор, стих"
    assert page.evaluate("(() => { const i = document.querySelector('.topbar .search input'); return i.scrollWidth <= i.clientWidth; })()")   # подсказка видна целиком


# ---------- 4. Фотобанк: прокрутка ----------

MANY = {"p%02d" % i: {"first": "Имя%d" % i, "last": "Фамилия%02d" % i, "caption": "", "aliases": []} for i in range(14)}


def test_photobank_add_photo_is_revealed_and_scroll_is_kept(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ME, members={"admin@x.pl": {"role": "editor"}}, viewport={"width": 1280, "height": 720})
    page.wait_for_selector(".home-top")
    put_bank(page, extra_people=MANY, presets={})
    page.evaluate("loadPhotoBank()")
    page.wait_for_function("photoBank.loaded && photoBank.list.length >= 16")
    page.evaluate("openPhotoBank()")
    page.wait_for_selector(".pb-card")
    lst = page.locator(".pb-list")
    lst.evaluate("e => { e.scrollTop = e.scrollHeight; }")
    assert lst.evaluate("e => e.scrollTop") > 100
    page.locator(".pb-card").last.locator(".pb-ph-add").click()                 # «Добавить фото» у нижнего человека
    page.wait_for_selector(".pb-add")
    inside = """() => { const a = document.querySelector('.pb-add').getBoundingClientRect(), l = document.querySelector('.pb-list').getBoundingClientRect(),
      s = document.querySelector('.pb-sheet').getBoundingClientRect();
      return { top:a.top >= l.top - 1 && a.top >= s.top - 1, bottom:a.bottom <= Math.min(l.bottom, s.bottom, innerHeight) + 1 }; }"""
    r = page.evaluate(inside)
    assert r["top"] and r["bottom"], r                                          # плашка видна целиком
    before = page.evaluate("[document.querySelector('.pb-list').scrollTop, document.querySelector('.pb-sheet').scrollTop]")
    assert before[0] > 100
    for name in ("С фоном", "Без фона"):                                        # кнопки в плашке перерисовывают окно, прокрутка остаётся
        page.locator(".pb-add .toggle button", has_text=name).first.click()
        after = page.evaluate("[document.querySelector('.pb-list').scrollTop, document.querySelector('.pb-sheet').scrollTop]")
        assert after == before, (name, before, after)
    assert not page.errors, page.errors
    ctx.close()
