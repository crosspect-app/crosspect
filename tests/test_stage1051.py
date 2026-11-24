"""Этап 10.5.1: показ слайдов, как F5 в PowerPoint (js/show.js).
Кнопка «Показ», F5 / Shift+F5, весь экран и чёрные поля, листание клавишами и нажатием, «Конец показа», выход по Esc
с выбором слайда в ленте, счётчик, заглушки картинки и видео, телефон (половины экрана и свайп)."""
import pytest

from conftest import cloud_page, only_chromium, open_sermon
from test_cloud import ADMIN, MEMBERS, wait_home

PHONE = dict(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)


def thesis(id, text):
    return {"id": id, "type": "thesis", "name": text, "parts": [{"kind": "text", "html": text, "align": "left", "scale": 100}]}


def show_sermon(sermon):
    s = dict(sermon)
    s["v"] = 2
    s["meta"] = {"title": "Вера и дела", "date": "2026-11-18", "firstName": "Иван", "lastName": "Петров"}
    s["blocks"] = [
        {"id": "sp", "type": "splash"},
        thesis("t1", "Первая мысль"),
        {"id": "im", "type": "image", "name": "Берег", "mode": "find", "desc": "море на закате"},
        {"id": "nt", "type": "note", "text": "Включить музыку"},
        {"id": "vd", "type": "video", "name": "Ролик", "mode": "link", "url": "https://example.com/v", "from": "", "to": "", "desc": ""},
        thesis("t2", "Последняя мысль"),
    ]
    return s


@pytest.fixture
def sh(page, sermon):
    open_sermon(page, show_sermon(sermon), edit=False)
    page.wait_for_selector(".stage .sl")
    return page


def cur(page):
    return page.evaluate("SHOW.el ? SHOW.i : null")


def on_slide_id(page):
    return page.evaluate("(() => { const w = document.querySelector('.show-slide.on'); return w ? w._u.id : null; })()")


def start(page, key="F5"):
    page.keyboard.press(key)
    page.wait_for_selector(".slideshow .show-slide.on")


# ---------- Запуск ----------

def test_button_is_in_header_and_starts_from_selected(sh):
    sh.evaluate("selectBlock('t1')")
    sh.locator("#app .hd-show").click()
    sh.wait_for_selector(".slideshow .show-slide.on")
    assert on_slide_id(sh) == "t1"
    assert cur(sh) == 1


def test_f5_starts_from_first_and_shift_f5_from_selected(sh):
    only_chromium("полный экран в Firefox и WebKit без монитора (CI) работает иначе — проверяется руками, docs/arch/browsers.md")
    sh.evaluate("selectBlock('t2')")
    start(sh, "F5")
    assert cur(sh) == 0 and on_slide_id(sh) == "sp"
    sh.keyboard.press("Escape")
    sh.wait_for_function("!document.querySelector('.slideshow')")
    assert sh.evaluate("selId") == "sp"   # остановились на первом: он и выбран в ленте
    sh.evaluate("selectBlock('t2')")
    start(sh, "Shift+F5")
    assert on_slide_id(sh) == "t2"


def test_f5_does_not_reload_page(sh):
    sh.evaluate("window.__marker = 1")
    start(sh, "F5")
    assert sh.evaluate("window.__marker") == 1


def test_f5_works_from_text_view(sh):
    sh.evaluate("setView('text')")
    sh.wait_for_selector(".tv")
    assert sh.locator("#app .hd-show").count() == 0   # на «Тексте» кнопки «Показ» нет (решение 19 ноября 2026)
    start(sh, "F5")
    assert cur(sh) == 0


def test_no_show_on_home_and_empty_sermon(page, sermon):
    page.keyboard.press("F5")
    page.wait_for_timeout(200)
    assert not page.query_selector(".slideshow")
    s = dict(sermon); s["v"] = 2; s["blocks"] = [{"id": "nt", "type": "note", "text": "только заметка"}]
    open_sermon(page, s, edit=False)
    page.keyboard.press("F5")
    page.wait_for_timeout(200)
    assert not page.query_selector(".slideshow")


def test_selected_note_starts_from_next_slide(sh):
    sh.evaluate("selectBlock('nt')")
    start(sh, "Shift+F5")
    assert on_slide_id(sh) == "vd"


def test_notes_are_not_slides(sh):
    start(sh)
    assert sh.evaluate("SHOW.list.map(u => u.id)") == ["sp", "t1", "im", "vd", "t2"]


# ---------- Вид ----------

def test_fullscreen_black_margins_and_slide_16_9(sh):
    only_chromium("полный экран в Firefox и WebKit без монитора (CI) работает иначе — проверяется руками, docs/arch/browsers.md")
    sh.set_viewport_size({"width": 1500, "height": 700})
    start(sh)
    r = sh.evaluate("""() => { const s = document.querySelector('.show-slide.on').getBoundingClientRect(), v = document.querySelector('.slideshow').getBoundingClientRect();
      return { sw:s.width, sh:s.height, sl:s.left, vw:v.width, vh:v.height, bg:getComputedStyle(document.querySelector('.slideshow')).backgroundColor }; }""")
    assert r["bg"] == "rgb(0, 0, 0)"
    assert abs(r["sw"] / r["sh"] - 16 / 9) < 0.02
    assert r["sh"] <= r["vh"] + 1 and r["sw"] <= r["vw"] + 1
    assert abs(r["sh"] - 700) <= 2 and r["sl"] > 100   # экран шире 16:9: слева и справа чёрные поля


def test_slide_is_laid_out_like_in_jpeg(sh):
    start(sh)
    t = sh.evaluate("document.querySelector('.show-slide.on .sl-sp-title').textContent")
    assert "Вера" in t
    sh.keyboard.press("ArrowRight")
    assert on_slide_id(sh) == "t1"
    txt = sh.evaluate("document.querySelector('.show-slide.on .sl-box').textContent")
    assert "Первая мысль" in txt
    # кадр раскладывается в полном размере и масштабируется, как у JPEG
    s = sh.evaluate("parseFloat(document.querySelector('.show-slide.on .sl').style.getPropertyValue('--s'))")
    w = sh.evaluate("document.querySelector('.show-slide.on').getBoundingClientRect().width")
    assert abs(s - w / 1920) < 0.002


def test_find_and_video_are_placeholders(sh):
    sh.evaluate("selectBlock('im')")
    start(sh, "Shift+F5")
    assert "Берег" in sh.evaluate("document.querySelector('.show-slide.on .ph-big').textContent")
    sh.keyboard.press("ArrowRight")
    assert on_slide_id(sh) == "vd"
    assert "Ролик" in sh.evaluate("document.querySelector('.show-slide.on .ph-big').textContent")
    r = sh.evaluate("""() => { const a = document.querySelector('.show-slide.on').getBoundingClientRect(), b = document.querySelector('.show-slide.on .ph-big').getBoundingClientRect();
      return { dw:Math.abs(a.width - b.width), dh:Math.abs(a.height - b.height) }; }""")
    assert r["dw"] < 3 and r["dh"] < 3   # заглушка занимает весь кадр


def test_neighbours_are_prepared_in_advance(sh):
    start(sh)
    assert sh.evaluate("[...SHOW.cache.keys()].sort()") == [0, 1]
    sh.keyboard.press("ArrowRight")
    assert sh.evaluate("[...SHOW.cache.keys()].sort()") == [0, 1, 2]
    sh.keyboard.press("ArrowRight"); sh.keyboard.press("ArrowRight")
    assert sh.evaluate("[...SHOW.cache.keys()].sort()") == [2, 3, 4]
    # следующий уже разложен: у него есть размер текста, а не пустая коробка
    assert sh.evaluate("document.querySelector('.show-slide:not(.on) .sl-box .sl-inner').offsetHeight") > 0
    assert sh.evaluate("[...document.querySelectorAll('.show-slide')].filter(w => getComputedStyle(w).visibility === 'visible').length") == 1


# ---------- Листание ----------

@pytest.mark.parametrize("key", ["ArrowRight", "ArrowDown", " ", "PageDown", "Enter"])
def test_forward_keys(sh, key):
    start(sh)
    sh.keyboard.press(key)
    assert cur(sh) == 1


@pytest.mark.parametrize("key", ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"])
def test_back_keys(sh, key):
    sh.evaluate("selectBlock('t2')")
    start(sh, "Shift+F5")
    assert cur(sh) == 4
    sh.keyboard.press(key)
    assert cur(sh) == 3


def test_home_end_and_click(sh):
    start(sh)
    sh.keyboard.press("End")
    assert cur(sh) == 4
    sh.keyboard.press("Home")
    assert cur(sh) == 0
    sh.mouse.click(300, 300)
    assert cur(sh) == 1
    sh.keyboard.press("ArrowLeft"); sh.keyboard.press("ArrowLeft")
    assert cur(sh) == 0   # дальше первого не уходит


def test_keys_do_not_leak_to_the_form(sh):
    sh.evaluate("selectBlock('t1')")
    sh.evaluate("window.__sel = selId")
    start(sh, "Shift+F5")
    sh.keyboard.press("ArrowRight")
    sh.keyboard.press("Control+z")
    assert sh.evaluate("selId") == "t1"   # лента не двигалась, пока идёт показ


# ---------- Конец и выход ----------

def test_end_screen_then_exit(sh):
    sh.evaluate("selectBlock('t2')")
    start(sh, "Shift+F5")
    sh.keyboard.press("ArrowRight")
    assert cur(sh) == 5
    assert sh.evaluate("document.querySelector('.show-end').textContent") == "Конец показа"
    assert sh.evaluate("document.querySelector('.show-slide.on')") is None
    assert sh.evaluate("document.querySelector('.show-count').textContent") == ""
    sh.keyboard.press("ArrowLeft")   # назад с «Конца» — на последний слайд
    assert cur(sh) == 4 and not sh.query_selector(".show-end")
    sh.keyboard.press("ArrowRight"); sh.keyboard.press("ArrowRight")
    sh.wait_for_function("!document.querySelector('.slideshow')")
    assert sh.evaluate("selId") == "t2"   # вышли с «Конца» — выбран последний слайд


def test_escape_selects_current_slide_in_film(sh):
    only_chromium("полный экран в Firefox и WebKit без монитора (CI) работает иначе — проверяется руками, docs/arch/browsers.md")
    start(sh)
    for _ in range(3):
        sh.keyboard.press("ArrowRight")
    assert on_slide_id(sh) == "vd"
    sh.keyboard.press("Escape")
    sh.wait_for_function("!document.querySelector('.slideshow')")
    assert sh.evaluate("selId") == "vd"
    assert sh.locator(".film .st.on").get_attribute("data-id") == "vd"
    assert "Ролик" in sh.evaluate("document.querySelector('.stage .ph-big').textContent")


def test_exit_from_text_view_keeps_text_view(sh):
    only_chromium("полный экран в Firefox и WebKit без монитора (CI) работает иначе — проверяется руками, docs/arch/browsers.md")
    sh.evaluate("setView('text')")
    start(sh)
    sh.keyboard.press("ArrowRight"); sh.keyboard.press("ArrowRight")
    sh.keyboard.press("Escape")
    sh.wait_for_function("!document.querySelector('.slideshow')")
    assert sh.evaluate("view") == "text" and sh.evaluate("selId") == "im"


def test_exit_when_fullscreen_is_left(sh):
    only_chromium("полный экран в Firefox и WebKit без монитора (CI) работает иначе — проверяется руками, docs/arch/browsers.md")
    start(sh)
    sh.evaluate("""() => { const e = document.querySelector('.slideshow'); SHOW.fs = true;
      Object.defineProperty(document, 'fullscreenElement', { configurable:true, get:() => null });
      document.dispatchEvent(new Event('fullscreenchange')); }""")
    assert not sh.query_selector(".slideshow")   # Esc в полном экране забирает браузер: показ закрывается по смене режима


def test_works_without_fullscreen(sh):
    sh.evaluate("Element.prototype.requestFullscreen = undefined; Element.prototype.webkitRequestFullscreen = undefined")
    start(sh)
    assert sh.evaluate("document.querySelector('.slideshow').getBoundingClientRect().width") == sh.evaluate("innerWidth")
    sh.keyboard.press("ArrowRight")
    assert cur(sh) == 1


# ---------- Счётчик и курсор ----------

def test_counter_and_idle(sh):
    start(sh)
    assert sh.evaluate("document.querySelector('.show-count').textContent") == "1 / 5"
    sh.keyboard.press("ArrowRight")
    assert sh.evaluate("document.querySelector('.show-count').textContent") == "2 / 5"
    sh.wait_for_selector(".slideshow.idle", timeout=4000)   # через 2 с счётчик и курсор прячутся
    assert sh.evaluate("getComputedStyle(document.querySelector('.slideshow')).cursor") == "none"
    assert float(sh.evaluate("getComputedStyle(document.querySelector('.show-count')).opacity")) < 0.1
    sh.mouse.move(400, 300); sh.mouse.move(420, 310)
    assert not sh.evaluate("document.querySelector('.slideshow').classList.contains('idle')")
    assert sh.evaluate("getComputedStyle(document.querySelector('.slideshow')).cursor") != "none"


def test_resize_relayouts_slides(sh):
    only_chromium("полный экран в Firefox и WebKit без монитора (CI) работает иначе — проверяется руками, docs/arch/browsers.md")
    start(sh)
    sh.evaluate("""() => { const e = document.querySelector('.slideshow'); e.style.right = 'auto'; e.style.bottom = 'auto'; e.style.width = '800px'; e.style.height = '600px'; window.dispatchEvent(new Event('resize')); }""")
    sh.wait_for_function("Math.abs(document.querySelector('.show-slide.on').getBoundingClientRect().width - 800) < 2")
    # на нагруженной машине CI первый resize иногда приходит раньше, чем окно показа сменило размер: повторяем, пока слайд не разложится заново
    sh.wait_for_function("""() => { window.dispatchEvent(new Event('resize'));
      return Math.abs(parseFloat(document.querySelector('.show-slide.on .sl').style.getPropertyValue('--s')) - 800 / 1920) < 0.002; }""", polling=250, timeout=10000)


def test_show_css_does_not_leak_into_jpeg(sh):
    css = sh.evaluate("slideCSS()")
    assert "show-" not in css and ".slideshow" not in css


# ---------- Телефон ----------

def test_phone_taps_by_halves_and_swipe(browser, base_url, sermon):
    only_chromium("телефон (is_mobile) Playwright подменяет только в Chromium")
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, **PHONE)
    try:
        wait_home(page)
        open_sermon(page, show_sermon(sermon), edit=False)
        page.wait_for_selector(".stage .sl")
        page.locator("#app .hd-show").tap()
        page.wait_for_selector(".slideshow .show-slide.on")
        assert cur(page) == 0
        page.touchscreen.tap(300, 400)   # правая половина — вперёд
        assert cur(page) == 1
        page.touchscreen.tap(300, 400)
        assert cur(page) == 2
        page.touchscreen.tap(60, 400)    # левая — назад
        assert cur(page) == 1
        # свайп: пальцем влево — вперёд, вправо — назад
        page.evaluate("""() => {
          const el = document.querySelector('.slideshow');
          const fire = (t, x) => el.dispatchEvent(new PointerEvent(t, { pointerType:'touch', clientX:x, clientY:400, button:0, bubbles:true }));
          fire('pointerdown', 300); fire('pointerup', 120);
        }""")
        assert cur(page) == 2
        page.evaluate("""() => {
          const el = document.querySelector('.slideshow');
          const fire = (t, x) => el.dispatchEvent(new PointerEvent(t, { pointerType:'touch', clientX:x, clientY:400, button:0, bubbles:true }));
          fire('pointerdown', 100); fire('pointerup', 300);
        }""")
        assert cur(page) == 1
    finally:
        ctx.close()


def test_phone_header_button_is_icon_only(browser, base_url, sermon):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, **PHONE)
    try:
        wait_home(page)
        open_sermon(page, show_sermon(sermon), edit=False)
        page.wait_for_selector("#app .hd-show")
        assert page.evaluate("getComputedStyle(document.querySelector('.hd-show span')).display") == "none"
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
    finally:
        ctx.close()
