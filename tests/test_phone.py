"""Этап 10.1.1: Crosspect на телефоне. Контекст 390×844, is_mobile, has_touch, масштаб 2 (как iPhone).
Раскладка (шапки, меню «⋯», поиск, окна, поля 16 px), стена-картинка вместо стены слайдов, правка «Текста к слайду» с телефона.
Облако подменено: tests/fixtures/fake_cloud.js. «На компьютере ничего не меняется»: отдельные тесты на 1280×900 и в узком окне без касания."""
import pathlib

import pytest

from conftest import ROOT, cloud_page, open_sermon
from test_cloud import ADMIN, MEMBERS, rec, wait_home
from test_stage8 import space

PHONE = dict(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
NARROW_DESKTOP = dict(viewport={"width": 600, "height": 800})   # узкое окно с мышью: не телефон
ROWS = {"s1": rec("s1", "Вера и дела", at=5000), "s2": rec("s2", "Благодать", at=6000)}
FMT_BLUE = {"formats": {"f1": {"name": "Синий", "bg": {"color": "#1030a0"}}}, "defaultFormat": "f1"}


def phone_page(browser, base_url, **kw):
    opts = dict(PHONE)
    opts.update(kw.pop("ctx", {}))
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons=kw.pop("sermons", ROWS), **opts, **kw)
    wait_home(page)
    return ctx, page


def rect(page, sel):
    return page.evaluate("""s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; }""", sel)


def no_hscroll(page):
    return page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")


def two_spaces():
    return {"sp2": space("sp2", "Отец", members={}, sermons={})}


# ---------- Главная ----------

def test_home_header_one_row_and_no_hscroll(browser, base_url):
    ctx, page = phone_page(browser, base_url)
    assert page.evaluate("isPhone()")
    bar = rect(page, ".topbar")
    assert bar["height"] <= 64
    assert not page.locator(".topbar .logo-t").is_visible()       # знак без слова CROSSPECT
    assert page.locator(".topbar .hd-sq").is_visible()             # значок поиска
    assert not page.locator(".topbar .search").is_visible()
    assert not page.locator(".topbar .hd-help").is_visible()       # «Как пользоваться» — в меню «⋯»
    assert no_hscroll(page)
    page.locator(".hd-more").click()
    assert page.get_by_role("button", name="Как пользоваться").is_visible()
    ctx.close()


@pytest.mark.parametrize("many", [False, True])
def test_menu_stays_inside_window(browser, base_url, many):
    kw = dict(spaces=two_spaces()) if many else {}
    ctx, page = phone_page(browser, base_url, **kw)
    assert page.evaluate("multiSpace()") == many
    page.locator(".hd-more").click()
    page.wait_for_selector("#menu.open")
    m, bar = rect(page, "#menu"), rect(page, ".topbar")
    assert m["left"] >= 0 and m["right"] <= 390
    assert m["top"] >= bar["bottom"] and m["bottom"] <= 844
    ctx.close()


def test_menu_shifts_inside_window_on_any_width(page):
    """Защита для любой ширины: кнопка «⋯» уехала влево — меню всё равно целиком в окне."""
    page.evaluate("document.querySelector('.topbar .actions').style.marginRight = '1180px'")
    page.evaluate("toggleMenu()")
    m = page.evaluate("(() => { const r = menuEl.getBoundingClientRect(); return [r.left, r.right, innerWidth]; })()")
    assert m[0] >= 0 and m[1] <= m[2]


def test_search_opens_filters_and_closes(browser, base_url):
    ctx, page = phone_page(browser, base_url)
    page.locator(".hd-sq").tap()
    assert page.locator(".topbar .search").is_visible()
    s, bar = rect(page, ".topbar .search"), rect(page, ".topbar")
    assert s["width"] >= 330 and bar["height"] <= 64               # поле на всю шапку, шапка не выросла
    assert page.evaluate("document.activeElement.matches('.search input')")
    page.keyboard.type("Благодать")
    page.wait_for_function("document.querySelectorAll('#home-list .srow:not(.shead)').length === 1")
    page.evaluate("renderTopbar()")                                # перерисовка шапки: с текстом поле остаётся открытым
    assert page.locator(".topbar .search").is_visible()
    page.get_by_role("button", name="Закрыть поиск").tap()
    assert not page.locator(".topbar .search").is_visible()
    assert page.evaluate("homeQuery") == ""
    page.wait_for_function("document.querySelectorAll('#home-list .srow:not(.shead)').length === 2")
    ctx.close()


# ---------- Стена ----------

def test_wall_is_picture_on_phone(browser, base_url):
    ctx, page = phone_page(browser, base_url, reduced_motion="no-preference")
    page.wait_for_selector(".hb-img.ready", state="attached")
    assert page.locator(".hb-cell").count() == 0 and page.locator(".hb-wall").count() == 0
    assert page.evaluate("WALL.proto") is None                      # слайды стены не строились (wallProtos не вызывался)
    bad = page.evaluate("""[...document.querySelectorAll('.home-bg, .home-bg *')].filter(e => getComputedStyle(e).display !== 'none'
      && (getComputedStyle(e).mixBlendMode !== 'normal' || getComputedStyle(e).filter !== 'none' || getComputedStyle(e).animationName !== 'none')).map(e => e.className)""")
    assert bad == []
    assert "wall-phone.webp" in page.evaluate("getComputedStyle(document.querySelector('.hb-img')).backgroundImage")
    assert page.evaluate("fetch('img/wall-phone.webp').then(r => r.status)") == 200
    assert not page.locator(".hb-grain").is_visible() and not page.locator(".hb-haze").is_visible()
    ctx.close()


def test_wall_picture_file_size():
    f = ROOT / "img" / "wall-phone.webp"
    assert f.exists() and f.stat().st_size <= 250 * 1024
    assert f.read_bytes()[:4] == b"RIFF" and f.read_bytes()[8:12] == b"WEBP"


def test_wall_plain_background_for_custom_default_format(browser, base_url):
    ctx, page = phone_page(browser, base_url)
    page.evaluate("s => { const db = fakeCloud.db(); db.slides = s; fakeCloud.put(db); }", FMT_BLUE)   # у пространства свой формат фона по умолчанию
    page.wait_for_function("slidesCfg().defaultFormat === 'f1'")
    page.evaluate("renderMain()")
    page.wait_for_selector(".hb-img.plain", state="attached")
    assert page.evaluate("getComputedStyle(document.querySelector('.hb-img')).backgroundImage").startswith("linear-gradient")
    ctx.close()


def test_wall_of_slides_stays_on_desktop(page):
    page.wait_for_selector(".hb-wall .hb-cell", state="attached")
    assert page.locator(".hb-img").count() == 0
    assert page.evaluate("WALL.phone") is False and page.evaluate("WALL.proto") is not None


def test_narrow_desktop_window_keeps_the_wall(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, **NARROW_DESKTOP)
    wait_home(page)
    assert page.evaluate("isPhone()") is False
    page.wait_for_selector(".hb-wall .hb-cell", state="attached")
    assert page.locator(".hb-img").count() == 0
    ctx.close()


def test_phone_turns_into_wall_and_back_on_rotation(browser, base_url):
    ctx, page = phone_page(browser, base_url, reduced_motion="no-preference")
    page.wait_for_selector(".hb-img", state="attached")
    page.set_viewport_size({"width": 844, "height": 390})           # повернули: уже не «телефон» по ширине
    page.wait_for_selector(".hb-wall .hb-cell", state="attached")
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_selector(".hb-img", state="attached")
    assert page.locator(".hb-cell").count() == 0
    ctx.close()


def test_phone_overlay_without_blur_and_login_grain_still(browser, base_url):
    ctx, page = phone_page(browser, base_url)
    page.evaluate("openMeta ? 0 : 0; sheetOverlay.classList.add('open')")
    ov = page.evaluate("(() => { const s = getComputedStyle(sheetOverlay); return [s.backdropFilter, s.backgroundColor]; })()")
    assert ov[0] == "none" and ov[1] == "rgba(5, 7, 12, 0.75)"
    page.evaluate("sheetOverlay.classList.remove('open')")
    ctx.close()
    ctx, page = cloud_page(browser, base_url, **PHONE)             # экран входа: зерно стоит
    page.wait_for_selector(".gate-grain", state="attached")
    assert page.evaluate("getComputedStyle(document.querySelector('.gate-grain')).animationName") == "none"
    ctx.close()


def test_overlay_blur_stays_on_desktop(page):
    page.evaluate("sheetOverlay.classList.add('open')")
    assert page.evaluate("getComputedStyle(sheetOverlay).backdropFilter") == "blur(4px)"
    page.evaluate("sheetOverlay.classList.remove('open')")


# ---------- Конспект ----------

def test_sermon_header_two_rows_and_film_in_place(browser, base_url, sermon):
    ctx, page = phone_page(browser, base_url)
    open_sermon(page, sermon, edit=False)
    bar = rect(page, ".topbar")
    assert bar["height"] <= 110
    title, seg, edit = rect(page, ".hd-title"), rect(page, ".topbar .seg"), rect(page, ".hd-act")
    assert seg["top"] >= title["bottom"] - 1 and edit["top"] >= title["bottom"] - 1   # «Слайды / Текст» и кнопка — на второй строке
    assert abs(seg["top"] - edit["top"]) < 20
    for hidden in (".hd-back", ".jpg-btn", ".stage-info", ".hist"):
        assert page.locator(hidden).count() == 0 or not page.locator(hidden).first.is_visible(), hidden
    film, stage = rect(page, ".film"), rect(page, ".stage")
    assert film["bottom"] <= stage["top"] + 1
    assert abs(film["top"] - bar["bottom"]) <= 1                    # лента сразу под шапкой, не ниже на 57 px
    assert no_hscroll(page)
    ctx.close()


def test_sermon_header_in_edit_and_undo_redo_in_menu(browser, base_url, sermon):
    ctx, page = phone_page(browser, base_url)
    open_sermon(page, sermon, edit=True)
    assert rect(page, ".topbar")["height"] <= 110 and no_hscroll(page)
    assert not page.locator(".hist").is_visible()
    page.locator(".hd-more").tap()
    undo, redo = page.get_by_role("button", name="Отменить"), page.get_by_role("button", name="Вернуть", exact=True)
    assert undo.is_visible() and redo.is_visible()
    assert undo.is_disabled()                                        # правок ещё нет
    m = rect(page, "#menu")
    assert m["left"] >= 0 and m["right"] <= 390 and m["bottom"] <= 844
    page.keyboard.press("Escape")
    page.locator(".speech .rich").tap()
    page.keyboard.type("текст")
    page.locator(".hd-more").tap()
    assert page.get_by_role("button", name="Отменить").is_enabled()
    ctx.close()


def test_undo_redo_hidden_in_menu_on_desktop(page, sermon):
    open_sermon(page, sermon, edit=True)
    page.locator(".topbar .hd-more").click()
    assert page.locator("#menu .only-sm").first.is_hidden()
    assert page.locator(".hist").is_visible()


def test_status_and_view_switch_work_on_phone(browser, base_url, sermon):
    ctx, page = phone_page(browser, base_url)
    open_sermon(page, sermon, edit=True)
    page.locator(".topbar .seg button", has_text="Текст").tap()
    page.wait_for_function("view === 'text'")
    page.locator(".topbar .seg button", has_text="Слайды").tap()
    page.wait_for_function("view === 'slides'")
    page.locator(".stdrop").tap()
    page.get_by_role("option", name="В работе").is_visible()
    page.keyboard.press("Escape")
    ctx.close()


# ---------- Поля, окна, вкладки ----------

def small_fields(page):
    return page.evaluate("""[...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), select, textarea, [contenteditable="true"]')]
      .filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && parseFloat(getComputedStyle(e).fontSize) < 16)
      .map(e => e.tagName + '.' + e.className + ' ' + getComputedStyle(e).fontSize)""")


def test_fields_at_least_16px(browser, base_url, sermon):
    ctx, page = phone_page(browser, base_url)
    page.locator(".hf-toggle").tap()                                  # фильтры списка
    page.locator(".hd-sq").tap()
    assert small_fields(page) == []
    page.locator(".sq-close").tap()
    open_sermon(page, sermon, edit=True)
    assert small_fields(page) == []                                   # «Слайды»: настройки справа, текст к слайду
    page.evaluate("setView('text')")
    page.wait_for_function("view === 'text'")
    assert small_fields(page) == []
    page.evaluate("setView('slides'); openMeta()")
    page.wait_for_selector(".sheet[aria-label='О проповеди']")
    assert small_fields(page) == []
    ctx.close()


def sheet_fits(page):
    s = rect(page, ".overlay.open .sheet")
    assert s["left"] >= 0 and s["right"] <= 390 and s["top"] >= 0 and s["bottom"] <= 844, s
    assert page.evaluate("(() => { const e = document.querySelector('.overlay.open .sheet'); return e.scrollWidth <= e.clientWidth + 1; })()")
    assert no_hscroll(page)


def test_windows_fit_and_space_tabs_reachable(browser, base_url, sermon):
    ctx, page = phone_page(browser, base_url)
    open_sermon(page, sermon, edit=True)
    page.evaluate("closeSettings(); openMeta()")
    page.wait_for_selector(".overlay.open .sheet")
    sheet_fits(page)
    page.evaluate("closeSettings(); openSpace()")
    page.wait_for_selector(".space-sheet")
    sheet_fits(page)
    tabs = page.locator(".space-tabs button")
    n = tabs.count()
    assert n >= 4
    for i in range(n):                                                # каждая вкладка достижима, в том числе «Общее»
        tabs.nth(i).tap()
        assert tabs.nth(i).get_attribute("aria-selected") == "true"
        sheet_fits(page)
        page.wait_for_function("() => { const t = document.querySelector('.space-tabs'), b = t.querySelector('.on').getBoundingClientRect(); return b.right <= t.getBoundingClientRect().right; }")   # выбранная вкладка видна целиком
    assert page.evaluate("(() => { const t = document.querySelector('.space-tabs'); return getComputedStyle(t).overflowX; })()") == "auto"
    page.evaluate("closeSettings(); openSlidesCfg()")
    page.wait_for_selector(".overlay.open .sheet")
    sheet_fits(page)
    ctx.close()


def test_overlay_height_follows_visible_part(browser, base_url):
    ctx, page = phone_page(browser, base_url)
    page.evaluate("sheetOverlay.classList.add('open')")
    h = page.evaluate("[sheetOverlay.getBoundingClientRect().height, innerHeight]")
    assert abs(h[0] - h[1]) <= 1
    assert page.evaluate("getComputedStyle(document.querySelector('.sheet')).maxHeight") != "none"
    ctx.close()


# ---------- Правка «Текста к слайду» ----------

def block_speech(page, i):
    return page.evaluate("i => state.blocks[i].speech || ''", i)


def test_speech_in_slides_tap_type_grows(browser, base_url, sermon):
    ctx, page = phone_page(browser, base_url)
    open_sermon(page, sermon, edit=True)
    assert not page.locator(".speech-toggle").is_visible()           # «Развернуть / Свернуть» на телефоне нет
    field = page.locator(".speech .rich")
    before = rect(page, ".speech .rich")
    assert before["height"] >= 5 * 1.6 * 16                           # не меньше ~5 строк
    field.tap()
    page.keyboard.press("Control+End")
    page.keyboard.type(" ДОПИСАНО")
    page.wait_for_function("state.blocks[0].speech.includes('ДОПИСАНО')")
    assert page.evaluate("isDirty()")
    for _ in range(14):                                               # длинный текст: поле растёт, внутренней прокрутки нет
        page.keyboard.press("Enter")
        page.keyboard.type("строка")
    after = page.evaluate("(() => { const e = document.querySelector('.speech .rich'); return [e.getBoundingClientRect().height, e.scrollHeight, e.clientHeight]; })()")
    assert after[0] > before["height"] + 100 and after[1] <= after[2] + 1
    ctx.close()


def test_speech_in_text_view_tap_type_grows(browser, base_url, sermon):
    ctx, page = phone_page(browser, base_url)
    open_sermon(page, sermon, edit=True)
    page.evaluate("setView('text')")
    page.wait_for_function("view === 'text'")
    prose = page.locator(".tv .rich.prose")
    n = prose.count()
    assert n >= 3
    idx = 2                                                           # слайд без текста: пустое поле открывается касанием
    f = prose.nth(idx)
    assert rect(page, ".tv .rich.prose:nth-of-type(1)") is not None
    h0 = f.bounding_box()["height"]
    assert h0 >= 40                                                   # цель касания крупнее одной строки
    f.tap()
    assert page.evaluate("document.activeElement.classList.contains('prose')")
    page.keyboard.type("Слово для телефона")
    key = f.get_attribute("data-key").split(":")[0]
    page.wait_for_function("k => (blockById(k).speech || '').includes('Слово для телефона')", arg=key)
    assert page.evaluate("isDirty()")
    for _ in range(10):
        page.keyboard.press("Enter")
        page.keyboard.type("ещё строка")
    box = f.bounding_box()
    assert box["height"] > h0 + 100
    assert page.evaluate("k => { const e = document.querySelector('[data-key=\"' + k + ':tv\"]'); return e.scrollHeight <= e.clientHeight + 1; }", key)
    ctx.close()


def test_caret_is_kept_above_keyboard_and_below_header(browser, base_url, sermon):
    """Клавиатуру в тесте не нажать: подставляем высоту видимой части (как после появления клавиатуры) и проверяем, куда прокрутило."""
    ctx, page = phone_page(browser, base_url)
    open_sermon(page, sermon, edit=True)
    page.evaluate("setView('text')")
    page.wait_for_function("view === 'text'")
    prose = page.locator(".tv .rich.prose")
    last = prose.nth(prose.count() - 1)
    last.scroll_into_view_if_needed()
    page.evaluate("window.scrollTo(0, 0)")
    last.tap()                                                        # поле внизу списка, а окно «стало» 420 px (клавиатура)
    page.evaluate("window.scrollTo(0, 0)")
    assert page.evaluate("revealCaret(420)") is True
    bottom = page.evaluate("document.activeElement.getBoundingClientRect().bottom")
    assert bottom <= 420 - 12 + 1
    top = page.evaluate("document.activeElement.getBoundingClientRect().top"), rect(page, ".topbar")["bottom"]
    assert top[0] >= top[1] - 1                                       # не под липкой шапкой
    assert page.evaluate("parseFloat(getComputedStyle(document.activeElement).scrollMarginTop)") >= rect(page, ".topbar")["height"]
    ctx.close()


def test_hidden_tab_saves_at_once(browser, base_url, sermon):
    ctx, page = phone_page(browser, base_url)
    id = open_sermon(page, sermon, edit=True)
    page.locator(".speech .rich").tap()
    page.keyboard.press("Control+End")
    page.keyboard.type(" ПЕРЕД СВОРАЧИВАНИЕМ")
    page.wait_for_function("state.blocks[0].speech.includes('СВОРАЧИВАНИЕМ')")
    assert page.evaluate("isDirty()")
    assert "СВОРАЧИВАНИЕМ" not in page.evaluate("id => JSON.stringify(fakeCloud.db().sermons[id])", id)
    page.evaluate("""() => { Object.defineProperty(document, 'visibilityState', { configurable:true, get:() => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange')); }""")   # вкладка ушла в фон (Safari свернули)
    page.wait_for_function("id => JSON.stringify(fakeCloud.db().sermons[id]).includes('СВОРАЧИВАНИЕМ')", arg=id, timeout=5000)   # без ожидания 30 секунд
    page.wait_for_function("!isDirty()")
    ctx.close()
