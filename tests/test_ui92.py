"""Этап 9.2: меню «⋯» и список — меньше лишнего. Облако подменено: tests/fixtures/fake_cloud.js."""
from conftest import cloud_page
from test_cloud import ADMIN, IVAN, MEMBERS, rec
from test_lock import open_sermon
from test_ui71 import ED, MEMBERS_ED, menu_items

SERMONS = {"s1": rec("s1", "Вера", owner="ivan@x.pl")}


def test_menu_has_no_new_outline_and_no_download_file(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED, sermons=SERMONS)
    page.wait_for_selector(".scard")
    assert "Новый конспект" not in menu_items(page) and "Скачать файл" not in menu_items(page)   # на списке
    open_sermon(page, "s1")
    items = menu_items(page)
    assert "Новый конспект" not in items and "Скачать файл" not in items
    assert page.evaluate("typeof saveFile") == "function"   # сама функция осталась
    ctx.close()


def test_reset_layout_goes_right_under_slide_settings(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED, sermons=SERMONS)
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    items = menu_items(page)
    assert items.index("Сбросить настройки экрана") == items.index("Настройки слайдов") + 1
    assert items.index("Ссылка для оператора") < items.index("Настройки слайдов")
    ctx.close()


def test_author_without_slide_settings_keeps_reset_alone(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons=SERMONS)
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    items = menu_items(page)
    assert "Настройки слайдов" not in items and "Сбросить настройки экрана" in items
    kinds = page.evaluate("[...menuEl.children].map(e => e.className === 'menu-sep' ? '-' : e.textContent.trim())")
    i = kinds.index("Сбросить настройки экрана")
    assert kinds[i - 1] == "-" and kinds[i - 2] != "-", kinds   # перед пунктом одна линия, двух подряд нет
    assert not any(a == b == "-" for a, b in zip(kinds, kinds[1:])), kinds
    ctx.close()


def test_list_has_no_next_mark_and_date_filter_names(browser, base_url):
    S = {"a": rec("a", "Скоро", date="2099-01-04"), "b": rec("b", "Потом", date="2099-02-01"), "c": rec("c", "Давно", date="2020-01-05")}
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons=S)
    page.wait_for_selector(".scard")
    assert page.locator(".next-mark, .scard.next").count() == 0 and "ближайшая" not in page.inner_text(".ptable")
    labels = page.locator(".home-filters select[aria-label='Дата'] option").all_inner_texts()
    assert labels == ["Все даты", "Предстоящие", "Прошлые", "Период…"]
    page.locator(".home-filters select[aria-label='Дата']").select_option("up")
    assert sorted(t.strip() for t in page.locator(".scard .scard-title").all_inner_texts()) == ["Потом", "Скоро"]
    page.locator(".home-filters select[aria-label='Дата']").select_option("past")
    assert [t.strip() for t in page.locator(".scard .scard-title").all_inner_texts()] == ["Давно"]
    ctx.close()


def test_home_wall_is_one_node_and_shows_after_leave_animation(browser, base_url):
    """Возврат из конспекта: стена слайдов не пересобирается (один и тот же узел), прячется на других экранах и проявляется,
    когда конспект уже уехал; список лежит под уезжающим конспектом непрозрачным (гаснет только он)"""
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons=SERMONS, reduced_motion="no-preference")
    page.wait_for_selector(".hb-wall.ready")
    page.wait_for_function("!document.getAnimations().some(a => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('home-bg'))", timeout=5000)   # проявление после входа закончилось
    page.evaluate("window.__wall = document.querySelector('.hb-wall')")
    assert page.evaluate("document.querySelector('.home-bg').parentElement === document.body && document.body.classList.contains('wall-on')")
    open_sermon(page, "s1")
    assert page.evaluate("!document.body.classList.contains('wall-on') && getComputedStyle(document.querySelector('.home-bg')).opacity") == "0"
    page.evaluate("navigate('')")
    page.wait_for_selector(".home")
    assert not page.evaluate("document.body.classList.contains('wall-on')")   # пока конспект уезжает, стены нет
    assert page.evaluate("document.querySelector('.home').getAnimations().every(a => !a.effect.getKeyframes().some(k => 'opacity' in k && k.opacity !== ''))")
    page.wait_for_function("document.body.classList.contains('wall-on')", timeout=3000)
    assert page.evaluate("document.querySelector('.hb-wall') === window.__wall")
    page.wait_for_function("!document.querySelector('.leave-ghost')", timeout=3000)
    ctx.close()
