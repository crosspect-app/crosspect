"""Этап 7.4: «Расположение панелей» в настройках слайдов (общий порядок пространства), серые поля заставки,
«Дублировать» и «Удалить» значками на миниатюре, логотип и анимация сохранения. Облако подменено: tests/fixtures/fake_cloud.js."""
from conftest import cloud_page
from test_cloud import ADMIN, MEMBERS
from test_lock import open_sermon, start_edit
from test_ui71 import ED, MEMBERS_ED, three_slides, order

PANELS = "[...document.querySelectorAll('.scfg-panel')].map(t => t.dataset.k)"
ON_SCREEN = "[...document.querySelectorAll('.sv > .film, .sv > .stage, .sv > .side')].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map(el => el.classList.contains('film') ? 'film' : el.classList.contains('stage') ? 'stage' : 'side')"


def editor_page(browser, base_url, **kw):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED, sermons={"s1": three_slides()}, **kw)
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    page.wait_for_selector(".sv.lay")
    return ctx, page


# ---------- расположение панелей ----------

def test_panels_section_in_settings_window(browser, base_url):
    ctx, page = editor_page(browser, base_url)
    page.evaluate("openSlidesCfg()")
    sheet = page.locator(".sheet.scfg")
    assert "Расположение панелей" in sheet.inner_text()
    assert page.evaluate(PANELS) == ["film", "stage", "side"]
    assert [t.inner_text().strip() for t in sheet.locator(".scfg-panel").all()] == ["Миниатюры", "Слайд", "Редактор"]
    assert sheet.locator(".scfg-panel .hint").count() == 0 and sheet.locator(".hint").count() == 0   # подсказки — только всплывающие
    assert page.locator(".scfg-panels").get_attribute("title")
    apply = sheet.get_by_role("button", name="Применить")
    assert apply.is_disabled()
    # стрелка: «Миниатюры» правее — порядок Слайд, Миниатюры, Редактор
    sheet.get_by_role("button", name="Миниатюры: правее").click()
    assert page.evaluate(PANELS) == ["stage", "film", "side"]
    assert apply.is_enabled()
    # первой плашке нельзя левее, последней — правее
    assert sheet.get_by_role("button", name="Слайд: левее").is_disabled()
    assert sheet.get_by_role("button", name="Редактор: правее").is_disabled()
    # вернули как было — «Применить» снова серая
    sheet.get_by_role("button", name="Миниатюры: левее").click()
    assert page.evaluate(PANELS) == ["film", "stage", "side"]
    assert apply.is_disabled()
    assert not page.errors, page.errors
    ctx.close()


def test_panels_keyboard_and_drag(browser, base_url):
    ctx, page = editor_page(browser, base_url)
    page.evaluate("openSlidesCfg()")
    tile = page.locator(".scfg-panel[data-k='side']")
    tile.focus()
    page.keyboard.press("ArrowLeft")
    assert page.evaluate(PANELS) == ["film", "side", "stage"]
    assert page.evaluate("document.activeElement.dataset.k") == "side"   # фокус остался на той же плашке
    page.keyboard.press("ArrowLeft")
    assert page.evaluate(PANELS) == ["side", "film", "stage"]
    # мышью: «Слайд» — на место первой
    a = page.locator(".scfg-panel[data-k='stage']").bounding_box()
    b = page.locator(".scfg-panel[data-k='side']").bounding_box()
    page.mouse.move(a["x"] + a["width"] / 2, a["y"] + a["height"] / 2)
    page.mouse.down()
    page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, steps=8)
    page.mouse.up()
    assert page.evaluate(PANELS) == ["stage", "side", "film"]
    assert not page.errors, page.errors
    ctx.close()


def test_panels_apply_changes_order_for_those_without_own_layout(browser, base_url):
    ctx, page = editor_page(browser, base_url)
    assert page.evaluate(ON_SCREEN) == ["film", "stage", "side"]
    page.evaluate("openSlidesCfg()")
    sheet = page.locator(".sheet.scfg")
    sheet.get_by_role("button", name="Редактор: левее").click()
    sheet.get_by_role("button", name="Редактор: левее").click()   # Редактор, Миниатюры, Слайд
    assert page.evaluate(ON_SCREEN) == ["film", "stage", "side"]   # пока не применили — не меняется
    sheet.get_by_role("button", name="Применить").click()
    page.wait_for_function("fakeCloud.db().slides && fakeCloud.db().slides.panels && fakeCloud.db().slides.panels[0] === 'side'")
    assert page.evaluate("fakeCloud.db().slides.panels") == ["side", "film", "stage"]
    page.wait_for_function("(" + ON_SCREEN + ")[0] === 'side'")
    assert page.evaluate(ON_SCREEN) == ["side", "film", "stage"]
    assert page.evaluate("layout.order") is None   # своего порядка не появилось
    # после перезагрузки — тот же порядок
    page.reload()   # адрес #s=s1 открывает ту же проповедь
    page.wait_for_selector(".sv.lay")
    assert page.evaluate(ON_SCREEN) == ["side", "film", "stage"]
    assert not page.errors, page.errors
    ctx.close()


def test_own_layout_beats_space_order_until_reset(browser, base_url):
    ctx, page = editor_page(browser, base_url)
    # человек сам переставил панели
    page.evaluate("swapPanels('film', 'side')")
    assert page.evaluate(ON_SCREEN) == ["side", "stage", "film"]
    assert page.evaluate("layout.order") == ["side", "stage", "film"]
    # редактор меняет порядок пространства — у него своя раскладка, она не меняется
    page.evaluate("openSlidesCfg()")
    sheet = page.locator(".sheet.scfg")
    sheet.get_by_role("button", name="Слайд: левее").click()   # Слайд, Миниатюры, Редактор
    sheet.get_by_role("button", name="Применить").click()
    page.wait_for_function("fakeCloud.db().slides && fakeCloud.db().slides.panels && fakeCloud.db().slides.panels[0] === 'stage'")
    page.evaluate("closeSettings()")
    assert page.evaluate(ON_SCREEN) == ["side", "stage", "film"]
    # «Сбросить настройки экрана» — порядок пространства
    page.evaluate("resetLayout()")
    assert page.evaluate("layout.order") is None
    assert page.evaluate(ON_SCREEN) == ["stage", "film", "side"]
    page.wait_for_function("JSON.stringify(fakeCloud.db().prefs['ed@x.pl']) === '{}'")
    assert not page.errors, page.errors
    ctx.close()


def test_old_default_order_in_browser_is_not_own(browser, base_url):
    """До 7.4 порядок по умолчанию всегда лежал в браузере: он не должен считаться своим выбором"""
    ctx, page = editor_page(browser, base_url)
    page.evaluate("localStorage.setItem('swp-layout', JSON.stringify({ order:['film', 'stage', 'side'], film:240, side:400 }))")
    page.evaluate("fakeCloud.db().slides")
    assert page.evaluate("normLayout({ order:['film', 'stage', 'side'], film:240, side:400 }).order") is None
    assert page.evaluate("normLayout({ v:2, order:['film', 'stage', 'side'], film:240, side:400 }).order") == ["film", "stage", "side"]
    assert page.evaluate("normLayout({ order:['stage', 'film', 'side'] }).order") == ["stage", "film", "side"]
    assert page.evaluate("normPanels(['film', 'film', 'side'])") == ["film", "stage", "side"]   # неправильный порядок — по умолчанию
    assert page.evaluate("mergeSlides(SLIDES_DEFAULT, { panels:['side', 'stage', 'film'] }).panels") == ["side", "stage", "film"]
    ctx.close()


def test_panels_section_only_in_editor_window(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": three_slides()})
    page.wait_for_selector(".scard")
    page.evaluate("openSlidesCfg()")   # админ — видит
    assert "Расположение панелей" in page.locator(".sheet.scfg").inner_text()
    ctx.close()
    ctx, page = cloud_page(browser, base_url, user={"email": "ivan@x.pl", "name": "Иван"}, members=dict(MEMBERS_ED, **{"ivan@x.pl": {"role": "preacher", "firstName": "Иван", "lastName": "Иванов"}}))
    page.wait_for_selector(".home-top")
    page.evaluate("openSlidesCfg()")   # автор — окна нет
    assert page.locator(".sheet.scfg").count() == 0
    ctx.close()


# ---------- поля заставки ----------

def test_splash_panel_has_only_settings(browser, base_url):
    """Этап 9.5: в настройках заставки нет названия, даты, автора и кнопки «Изменить…» — только размер, нижняя строка, своя заставка"""
    ctx, page = editor_page(browser, base_url)
    side = page.locator(".side")
    assert page.locator(".side .info-row").count() == 0
    assert side.get_by_role("button", name="Изменить название, дату, автора").count() == 0
    assert "Holyrics" not in side.inner_text()
    assert side.locator(".step").count() == 1
    assert [t.strip() for t in side.locator(".switch").all_inner_texts()] == ["Нижняя строка", "Своя заставка"]
    assert "чёрный слайд" in side.locator(".own-splash .hint").inner_text() and "архив JPEG" in side.locator(".own-splash .hint").inner_text()
    assert not page.errors, page.errors
    ctx.close()


def test_splash_foot_switch_applies_to_all_splashes(browser, base_url):
    ctx, page = editor_page(browser, base_url, settings=None)
    start_edit(page)
    page.evaluate("state.blocks.splice(2, 0, newBlock('splash')); renderMain()")
    sp = "state.blocks.filter(b => b.type === 'splash')"
    assert page.evaluate(sp + ".length") >= 2
    page.locator(".side .switch", has_text="Нижняя строка").click()
    assert page.evaluate("state.settings.splashFoot") is False
    page.wait_for_function("[...document.querySelectorAll('.st.t-splash .sl-sp-foot')].length >= 2 && [...document.querySelectorAll('.st.t-splash .sl-sp-foot')].every(f => getComputedStyle(f).display === 'none')")
    page.locator(".side .switch", has_text="Нижняя строка").click()
    assert page.evaluate("state.settings.splashFoot") is True
    ctx.close()


def test_splash_foot_default_comes_from_space_settings(browser, base_url):
    ctx, page = editor_page(browser, base_url, settings=None)
    assert page.evaluate("splashFootOn(state.blocks.find(b => b.type === 'splash'))") is True
    page.evaluate("""() => { const db = fakeCloud.db(); db.slides = { kinds:{ splash:{ titleOnly:true } } }; fakeCloud.put(db); }""")
    page.wait_for_function("splashFootOn(state.blocks.find(b => b.type === 'splash')) === false", timeout=5000)
    assert not page.locator(".side .switch", has_text="Нижняя строка").locator("input").is_checked()
    # у проповеди своё значение важнее настроек пространства
    assert page.evaluate("(() => { state.settings.splashFoot = true; return splashFootOn(state.blocks.find(b => b.type === 'splash')); })()") is True
    ctx.close()


# ---------- значки на миниатюре ----------

def test_duplicate_and_delete_icons_on_thumbnail(browser, base_url):
    ctx, page = editor_page(browser, base_url)
    start_edit(page)
    # в панели справа кнопок «Дублировать» и «Удалить» больше нет
    assert page.locator(".side").get_by_role("button", name="Дублировать").count() == 0
    assert page.locator(".side").get_by_role("button", name="Удалить").count() == 0
    box = page.locator(".st-box[data-box='b2']")
    acts = box.locator(".st-acts")
    assert page.evaluate("getComputedStyle(document.querySelector(\".st-box[data-box='b2'] .st-acts\")).opacity") == "0"   # без наведения не видны
    box.hover()
    page.wait_for_function("getComputedStyle(document.querySelector(\".st-box[data-box='b2'] .st-acts\")).opacity === '1'")
    assert acts.get_by_role("button", name="Дублировать").get_attribute("title") == "Дублировать"
    assert acts.get_by_role("button", name="Удалить").get_attribute("title") == "Удалить"
    # значки не закрывают номер и «доработать»
    n, a = box.locator(".st-n").bounding_box(), acts.bounding_box()
    assert a["x"] > n["x"] + n["width"]
    # копия встаёт следом
    acts.get_by_role("button", name="Дублировать").click()
    ids = order(page)
    assert len(ids) == 4 and ids[:2] == ["b1", "b2"] and ids[2] not in ("b3",) and ids[3] == "b3"
    assert page.evaluate("selId") == ids[2]
    # корзина удаляет другой слайд, не выбранный
    page.locator(".st-box[data-box='b3']").hover()
    page.locator(".st-box[data-box='b3'] .st-acts").get_by_role("button", name="Удалить").click()
    assert order(page) == ids[:3]
    assert not page.errors, page.errors
    ctx.close()


def test_thumbnail_icons_not_in_view_mode_and_keyboard(browser, base_url):
    ctx, page = editor_page(browser, base_url)
    assert page.locator(".st-acts").count() == 0   # в просмотре значков нет
    start_edit(page)
    assert page.locator(".st-acts").count() == 3
    # с клавиатуры: фокус на значке — он виден
    page.locator(".st-box[data-box='b2'] .st-acts button").first.focus()
    page.wait_for_function("getComputedStyle(document.querySelector(\".st-box[data-box='b2'] .st-acts\")).opacity === '1'")
    # перетаскивание миниатюры по-прежнему работает (значки в нём не участвуют)
    page.evaluate("moveTo(state.blocks[2], 0)")
    assert order(page) == ["b3", "b1", "b2"]
    ctx.close()


def test_thumbnail_icons_always_visible_on_touch_screens(browser, base_url):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, has_touch=True, is_mobile=True)
    import json, conftest
    db = {"members": MEMBERS_ED, "space": {"id": "sp1", "name": "Слово веры · тест", "settings": {}}, "sermons": {"s1": three_slides()}, "clock": 1000}
    ctx.add_init_script("if (!localStorage.getItem('fake-cloud')) localStorage.setItem('fake-cloud', %s);" % json.dumps(json.dumps(db)))
    ctx.add_init_script("localStorage.setItem('fake-user', %s);" % json.dumps(json.dumps(ED)))
    ctx.add_init_script(conftest.FAKE_CLOUD)
    page = ctx.new_page(); page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.goto(base_url + "/index.html")
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    start_edit(page)
    assert page.evaluate("matchMedia('(hover: none)').matches")
    op = "id => getComputedStyle(document.querySelector(\".st-box[data-box='\" + id + \"'] .st-acts\")).opacity"
    sel = page.evaluate("selId")
    page.wait_for_timeout(250)
    assert page.evaluate(op, sel) == "1"   # у выбранной — всегда
    other = [b for b in ("b1", "b2", "b3") if b != sel][0]
    assert page.evaluate(op, other) == "0"
    assert not page.errors, page.errors
    ctx.close()


# ---------- логотип ----------

def test_logo_in_headers_gate_and_favicon(browser, base_url):
    ctx, page = cloud_page(browser, base_url)   # не вошли: экран входа
    page.wait_for_selector(".gate")
    assert page.locator(".gate-logo .logo-mark svg").count() == 1
    assert page.locator(".gate-logo .logo-t").text_content() == "Crosspect"
    assert page.evaluate("getComputedStyle(document.querySelector('.gate-logo .logo-t')).textTransform") == "uppercase"
    assert page.locator(".topbar .logo .logo-mark").count() == 1   # шапка тоже
    assert page.locator("link[rel=icon]").get_attribute("href").startswith("data:image/svg+xml")
    ctx.close()
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": three_slides()})
    page.wait_for_selector(".scard")
    assert page.locator(".topbar .logo .logo-mark svg path").count() == 3   # три части
    assert page.locator(".topbar .logo .logo-t").text_content() == "Crosspect"
    fills = page.evaluate("[...document.querySelectorAll('.topbar .logo-mark path')].map(p => getComputedStyle(p).fill)")
    assert fills == ["rgb(236, 223, 207)", "rgb(236, 223, 207)", "rgb(255, 222, 89)"]   # крем, крем, жёлтый клин
    open_sermon(page, "s1")
    assert page.locator(".topbar .logo-only .logo-mark").count() == 1   # в шапке проповеди — знак без надписи
    # светлый вид «Текст»: одноцветный тёмный, клин тёмно-жёлтый
    page.evaluate("setView('text')")
    page.wait_for_selector("body.light")
    fills = page.evaluate("[...document.querySelectorAll('.topbar .logo-mark path')].map(p => getComputedStyle(p).fill)")
    assert fills == ["rgb(29, 28, 26)", "rgb(29, 28, 26)", "rgb(224, 168, 0)"]
    assert not page.errors, page.errors
    ctx.close()


def test_logo_animation_steps_and_colors(browser, base_url):
    ctx, page = editor_page(browser, base_url)
    fill = "i => getComputedStyle(document.querySelectorAll('.topbar .logo-mark path')[i]).fill"
    page.evaluate("logoTo(4)")
    seen = []
    for _ in range(40):
        seen.append(page.evaluate("LG.level"))
        page.wait_for_timeout(60)
    assert seen[0] >= 1 and 4 in seen and seen[-1] in (0, 4)
    assert [x for i, x in enumerate(seen) if i == 0 or x != seen[i - 1]][:5] in ([1, 2, 3, 4, 0], [2, 3, 4, 0], [1, 2, 3, 4], [2, 3, 4])   # по порядку: 1 погасло, 2 левая, 3 верхняя правая, 4 клин
    page.wait_for_function("LG.level === 0", timeout=4000)   # всё вернулось
    page.wait_for_timeout(400)
    assert [page.evaluate(fill, i) for i in range(3)] == ["rgb(236, 223, 207)", "rgb(236, 223, 207)", "rgb(255, 222, 89)"]
    # по стадиям: после «2» горит одна левая часть, остальные серые
    page.evaluate("LG.STEP = 5000; logoTo(2)")   # шаг долгий: останавливаемся на стадии
    page.wait_for_function("LG.level === 1")
    page.evaluate("LG.timer && (clearTimeout(LG.timer), LG.timer = 0); LG.STEP = 1; logoTick()")
    page.wait_for_function("LG.level === 2")
    page.wait_for_timeout(450)
    assert [page.evaluate(fill, i) for i in range(3)] == ["rgb(90, 209, 122)", "rgb(46, 46, 46)", "rgb(46, 46, 46)"]
    page.evaluate("logoReset(); LG.STEP = 350")
    assert not page.errors, page.errors
    ctx.close()


def test_logo_follows_real_save_stages(browser, base_url):
    ctx, page = editor_page(browser, base_url)
    start_edit(page)
    page.evaluate("window.__lv = []; setInterval(() => { const v = LG.level; const a = window.__lv; if (a[a.length - 1] !== v) a.push(v); }, 20)")
    page.evaluate("state.meta.title = 'Новое'; change(); saveNow()")
    page.wait_for_function("window.__lv.includes(4) && window.__lv[window.__lv.length - 1] === 0", timeout=8000)
    lv = [x for x in page.evaluate("window.__lv") if x]
    assert lv == [1, 2, 3, 4], lv   # погасли → левая → верхняя правая → клин
    # нет сети: записано в браузере (левая горит), до облака не дошло (остальные серые, клин не загорается)
    page.evaluate("localStorage.setItem('fake-offline', '1'); window.__lv = []; state.meta.title = 'Без сети'; change(); saveNow()")
    page.wait_for_function("LG.level === 2 && LG.want === 2", timeout=6000)
    page.wait_for_timeout(700)
    assert page.evaluate("LG.level") == 2
    assert page.evaluate("getComputedStyle(document.querySelectorAll('.topbar .logo-mark path')[0]).fill") == "rgb(90, 209, 122)"
    assert page.evaluate("getComputedStyle(document.querySelectorAll('.topbar .logo-mark path')[2]).fill") == "rgb(46, 46, 46)"
    # сеть вернулась — запись прошла, знак доигрывает и возвращает цвета
    page.evaluate("localStorage.removeItem('fake-offline'); window.dispatchEvent(new Event('online'))")
    page.wait_for_function("LG.level === 4 || window.__lv.includes(4)", timeout=20000)
    page.wait_for_function("LG.level === 0", timeout=4000)
    assert not page.errors, page.errors
    ctx.close()


def test_logo_animation_ignores_reduced_motion(browser, base_url):
    """Решение Виталия: анимация идёт всегда, даже если в системе включено «уменьшить анимацию»"""
    ctx, page = editor_page(browser, base_url)
    page.emulate_media(reduced_motion="reduce")
    page.evaluate("logoTo(4)")
    page.wait_for_function("LG.level >= 2", timeout=3000)
    page.wait_for_function("LG.level === 4", timeout=3000)
    page.wait_for_timeout(400)
    assert page.evaluate("getComputedStyle(document.querySelectorAll('.topbar .logo-mark path')[0]).fill") == "rgb(90, 209, 122)"
    assert not page.errors, page.errors
    ctx.close()


def test_logo_resets_on_home(browser, base_url):
    ctx, page = editor_page(browser, base_url)
    page.evaluate("LG.STEP = 50; logoTo(2)")
    page.wait_for_function("LG.level === 2")
    page.evaluate("navigate('')")
    page.wait_for_selector(".home-top")
    assert page.evaluate("LG.level") == 0
    assert page.evaluate("document.querySelector('.topbar .logo-mark').dataset.lg") == "0"
    ctx.close()
