"""Этап 10.9.5: показ на втором экране и пульт докладчика (js/show.js).
Один экран — как в 10.5.1; два экрана (Window Management API подменён) — полный экран на втором, окно-пульт на этом,
листание из любого окна идёт вместе; разрешение спросили — карточка «На втором экране»; «⋯ → Показ в отдельном окне» —
слайды в отдельном окне, пульт во вкладке формы, F — во весь экран, закрыли окно — показ окончен."""
import pytest

from conftest import cloud_page, open_sermon
from test_cloud import ADMIN, MEMBERS, wait_home
from test_stage1051 import show_sermon, cur, on_slide_id, PHONE

SCREENS = """([perm, fsFail]) => {
  Object.defineProperty(window.screen, 'isExtended', { get:() => true, configurable:true });
  const A = { label:'A', isPrimary:true, availLeft:0, availTop:0, availWidth:1280, availHeight:860 },
        B = { label:'B', isPrimary:false, availLeft:1280, availTop:0, availWidth:1920, availHeight:1080 };
  window.getScreenDetails = async () => ({ screens:[A, B], currentScreen:A });
  window.__perm = perm; window.__fsFail = fsFail; window.__fs = [];
  navigator.permissions.query = async () => ({ state:window.__perm });
  Element.prototype.requestFullscreen = function(o){
    window.__fs.push(o && o.screen ? o.screen.label : null);
    return window.__fsFail ? Promise.reject(new Error('нет нажатия')) : Promise.resolve();
  };
}"""


@pytest.fixture
def sh(page, sermon):
    open_sermon(page, show_sermon(sermon), edit=False)
    page.wait_for_selector(".stage .sl")
    return page


def con_text(p):
    return p.evaluate("(() => { const b = document.querySelector('.con-box-cur .show-slide'); return b ? b.innerText : ''; })()")


def ext_start(page, perm="granted", fs_fail=False):
    page.evaluate(SCREENS, [perm, fs_fail])
    with page.expect_popup() as pi:
        page.keyboard.press("F5")
    pop = pi.value
    pop.wait_for_selector(".con .con-box-cur .show-mini")
    return pop


# ---------- Один экран ----------

def test_one_screen_as_before(sh):
    sh.evaluate("window.__fs = []; Element.prototype.requestFullscreen = function(o){ window.__fs.push(o && o.screen ? 'screen' : null); return Promise.resolve(); }; 0")
    sh.keyboard.press("F5")
    sh.wait_for_selector(".slideshow .show-slide.on")
    assert sh.evaluate("SHOW.mode") == "here" and sh.evaluate("window.__fs") == [None]
    assert sh.evaluate("SHOW.pop") is None and not sh.query_selector(".con")
    assert len(sh.context.pages) == 1


def test_denied_permission_as_before(sh):
    sh.evaluate(SCREENS, ["denied", False])
    sh.keyboard.press("F5")
    sh.wait_for_selector(".slideshow .show-slide.on")
    assert sh.evaluate("window.__fs") == [None] and sh.evaluate("SHOW.mode") == "here"
    assert len(sh.context.pages) == 1


# ---------- Два экрана ----------

def test_two_screens_show_on_second_and_console_here(sh):
    pop = ext_start(sh)
    assert sh.evaluate("window.__fs") == ["B"] and sh.evaluate("SHOW.mode") == "ext"
    assert pop.inner_text(".con-count") == "Слайд 1 из 5"
    assert pop.query_selector(".con-box-next .show-slide")   # следующий слайд виден
    assert pop.query_selector(".con-timer") and pop.query_selector(".con-clock")
    assert pop.evaluate("document.title") == "Crosspect — пульт"


def test_console_and_show_step_together(sh):
    pop = ext_start(sh)
    pop.keyboard.press("ArrowRight")   # с пульта
    sh.wait_for_function("SHOW.i === 1")
    assert on_slide_id(sh) == "t1"
    pop.wait_for_function("document.querySelector('.con-count').textContent === 'Слайд 2 из 5'")
    assert "Первая мысль" in con_text(pop)
    sh.mouse.click(600, 400)   # щелчок по показу на проекторе
    sh.wait_for_function("SHOW.i === 2")
    pop.wait_for_function("document.querySelector('.con-count').textContent === 'Слайд 3 из 5'")
    pop.click(".con-nav[aria-label='Назад']")
    sh.wait_for_function("SHOW.i === 1")
    pop.keyboard.press("End")
    sh.wait_for_function("SHOW.i === 4")
    assert "Последняя мысль" in con_text(pop)
    assert pop.inner_text(".con-box-next") == "Конец показа"   # дальше — конец показа


def test_console_clone_matches_show(sh):
    pop = ext_start(sh)
    pop.keyboard.press("ArrowRight")
    sh.wait_for_function("SHOW.i === 1")
    main = sh.evaluate("document.querySelector('.slideshow .show-slide.on').innerText")
    pop.wait_for_function("document.querySelector('.con-count').textContent === 'Слайд 2 из 5'")
    assert con_text(pop) == main
    r = pop.evaluate("(() => { const r = document.querySelector('.con-box-cur .show-mini').getBoundingClientRect(); return r.width / r.height; })()")
    assert abs(r - 16 / 9) < 0.02


def test_escape_on_console_ends_show_and_closes_it(sh):
    pop = ext_start(sh)
    pop.keyboard.press("ArrowRight")
    sh.wait_for_function("SHOW.i === 1")
    try:
        pop.keyboard.press("Escape")   # окно закрывается прямо в обработчике
    except Exception:
        pass
    sh.wait_for_function("!document.querySelector('.slideshow')")
    assert pop.is_closed() or pop.evaluate("window.closed")
    assert sh.evaluate("selId") == "t1"


def test_end_button_on_console(sh):
    pop = ext_start(sh)
    pop.click(".con .btn:has-text('Закончить показ')")
    sh.wait_for_function("!document.querySelector('.slideshow')")


def test_asked_permission_needs_one_more_click(sh):
    sh.evaluate(SCREENS, ["prompt", True])
    sh.keyboard.press("F5")
    sh.wait_for_selector(".slideshow .show-ask")
    assert sh.evaluate("window.__fs") == ["B"]
    assert len(sh.context.pages) == 1
    sh.evaluate("window.__fsFail = false")
    with sh.expect_popup() as pi:
        sh.click(".show-ask button:has-text('На втором экране')")
    pop = pi.value
    pop.wait_for_selector(".con")
    assert sh.evaluate("window.__fs") == ["B", "B"] and not sh.query_selector(".show-ask")
    assert sh.evaluate("SHOW.i") == 0   # нажатие по карточке не листает


def test_asked_permission_this_screen(sh):
    sh.evaluate(SCREENS, ["prompt", True])
    sh.keyboard.press("F5")
    sh.wait_for_selector(".slideshow .show-ask")
    sh.evaluate("window.__fsFail = false")
    sh.click(".show-ask button:has-text('На этом экране')")
    sh.wait_for_function("!document.querySelector('.show-ask')")
    assert sh.evaluate("window.__fs") == ["B", None] and sh.evaluate("SHOW.mode") == "here"


# ---------- Отдельное окно ----------

def win_start(page):
    page.evaluate("toggleMenu()")
    with page.expect_popup() as pi:
        page.click("#menu button:has-text('Показ в отдельном окне')")
    pop = pi.value
    pop.wait_for_selector(".show-out .show-mini .show-slide")
    page.wait_for_selector(".slideshow.show-con .con")
    return pop


def test_window_mode_show_in_window_console_here(sh):
    sh.evaluate("selectBlock('t1')")
    pop = win_start(sh)
    assert sh.evaluate("SHOW.mode") == "win" and cur(sh) == 1
    assert pop.evaluate("document.title") == "Crosspect — показ"
    assert "Первая мысль" in pop.inner_text(".show-out .show-slide")
    assert "F" in sh.inner_text(".con-hint") and "Расширить" in sh.inner_text(".con-hint")
    assert pop.inner_text(".show-hint")


def test_window_mode_steps_from_both(sh):
    pop = win_start(sh)
    sh.keyboard.press("ArrowRight")   # в пульте
    pop.wait_for_function("document.querySelector('.show-out').dataset.i === '1'")
    pop.keyboard.press("ArrowRight")   # в окне показа
    sh.wait_for_function("SHOW.i === 2")
    assert sh.inner_text(".con-count") == "Слайд 3 из 5"
    pop.mouse.click(300, 200)   # щелчок по окну показа
    sh.wait_for_function("SHOW.i === 3")
    sh.mouse.click(5, 5)   # щелчок по пульту не листает
    sh.wait_for_timeout(150)
    assert sh.evaluate("SHOW.i") == 3


def test_window_mode_clone_fits_window(sh):
    pop = win_start(sh)
    pop.set_viewport_size({"width": 800, "height": 600})
    pop.wait_for_function("Math.abs(document.querySelector('.show-out .show-mini').getBoundingClientRect().width - 800) < 2")
    r = pop.evaluate("(() => { const r = document.querySelector('.show-out .show-mini').getBoundingClientRect(); return [r.width, r.height]; })()")
    assert abs(r[1] - 450) < 2


def test_window_mode_f_fullscreen_in_window(sh):
    pop = win_start(sh)
    pop.evaluate("window.__f = 0; document.documentElement.requestFullscreen = () => { window.__f++; return Promise.resolve(); }; 0")
    pop.keyboard.press("f")
    assert pop.evaluate("window.__f") == 1
    assert sh.evaluate("SHOW.i") == 0


def test_window_mode_closing_window_ends_show(sh):
    pop = win_start(sh)
    pop.close()
    sh.wait_for_function("!document.querySelector('.slideshow')", timeout=4000)


def test_window_mode_escape_in_console(sh):
    pop = win_start(sh)
    sh.keyboard.press("Escape")
    sh.wait_for_function("!document.querySelector('.slideshow')")
    assert pop.is_closed() or pop.evaluate("window.closed")


def test_window_mode_end_screen(sh):
    pop = win_start(sh)
    sh.keyboard.press("End")
    sh.keyboard.press("ArrowRight")
    pop.wait_for_selector(".show-out .show-end")
    assert sh.inner_text(".con-count") == "Конец показа"


def test_no_window_item_on_phone(browser, base_url, sermon):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, **PHONE)
    try:
        wait_home(page)
        open_sermon(page, show_sermon(sermon), edit=False)
        page.evaluate("toggleMenu()")
        assert "Показ в отдельном окне" not in page.inner_text("#menu")
    finally:
        ctx.close()
