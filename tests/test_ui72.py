"""Этап 7.2: окно «Настройки слайдов», заставка −/+ на всю проповедь, подпись перевода, панель оформления над полем,
раскладка панелей (в облаке у человека), отмена и возврат, «Сохранить», название заставки, окно добавления, пустой JPEG.
Облако подменено: tests/fixtures/fake_cloud.js; статусы — в test_editor.py."""
from conftest import cloud_page, start_blank
from test_cloud import ADMIN, IVAN, MEMBERS
from test_lock import open_sermon, start_edit
from test_ui71 import ED, MEMBERS_ED, menu_items, three_slides, order


def with_splashes(id="s1"):
    r = three_slides(id)
    r["blocks"].append({"id": "b4", "type": "splash", "speech": ""})
    r["blocks"].append({"id": "b5", "type": "image", "name": "Фото", "mode": "find", "desc": "Закат", "speech": ""})
    return r


# ---------- окно «Настройки слайдов» ----------

def test_settings_apply_keeps_window_and_new_fields(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED, sermons={"s1": three_slides()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    page.evaluate("openSlidesCfg()")
    sheet = page.locator(".sheet.scfg")
    text = sheet.inner_text()
    for there in ("Уменьшение до", "Увеличение до", "Лимит, симв.", "Место Писания", "Между стихами", "Между ссылкой и текстом"):
        assert there in text, there
    for gone in ("Мельче до", "Крупнее до", "Стихи на слайдах Писания", "Тезис, до", "Цитата, до"):
        assert gone not in text, gone
    assert sheet.locator(".hint").count() == 0   # объяснения — только во всплывающих подписях
    # лимиты — в таблице видов слайдов; у заставки есть «Увеличение до» и расстояния, у имени и даты — свои расстояния
    for label in ("Тезис: лимит символов", "Цитата: лимит символов", "Заставка: название: увеличение до", "Заставка: название: между символами",
                  "Заставка: название: между строками", "Заставка: имя и дата: между символами", "Заставка: имя и дата: между строками"):
        assert sheet.locator("[aria-label='%s']" % label).count() == 1, label
    # «Между стихами» действует только с новой строки
    gap = sheet.locator("[aria-label='Расстояние между стихами']")
    assert gap.is_disabled()
    page.get_by_role("button", name="С новой строки").click()
    assert sheet.locator("[aria-label='Расстояние между стихами']").is_enabled()
    sheet.locator("[aria-label='Расстояние между стихами']").fill("0.6")
    sheet.locator("[aria-label='Расстояние между ссылкой и текстом']").fill("1.2")
    sheet.locator("[aria-label='Заставка: название: между строками']").fill("1.3")
    sheet.locator("[aria-label='Заставка: имя и дата: между символами']").fill("0.02")
    page.get_by_role("button", name="Применить").click()
    page.wait_for_function("fakeCloud.calls.slides === 1")
    # окно остаётся открытым, у кнопки — «Применено»
    assert page.locator(".sheet.scfg").is_visible()
    page.wait_for_function("document.querySelector('.scfg-done').textContent.includes('Применено')")
    cfg = page.evaluate("fakeCloud.db().slides")
    assert cfg["verses"]["gap"] == 0.6 and cfg["verses"]["refGap"] == 1.2
    assert cfg["kinds"]["splash"]["lead"] == 1.3 and cfg["kinds"]["splash"]["footTrack"] == 0.02
    st = "getComputedStyle(document.querySelector('.film .sl-stage')).getPropertyValue('%s').trim()"
    assert page.evaluate(st % "--sc-vgap") == "0.6em" and page.evaluate(st % "--sc-gap") == "1.2em"
    assert page.evaluate(st % "--sp-lead") == "1.3" and page.evaluate(st % "--sp-ftrack") == "0.02em"
    # второе «Применить» из того же окна тоже работает
    sheet.locator("[aria-label='Тезис: лимит символов']").fill("150")
    page.get_by_role("button", name="Применить").click()
    page.wait_for_function("fakeCloud.calls.slides === 2")
    assert page.evaluate("fakeCloud.db().slides.limits.thesis") == 150
    assert not page.errors, page.errors
    ctx.close()


def test_splash_size_is_one_per_sermon(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": with_splashes()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("selectBlock('b1')")
    page.wait_for_timeout(300)
    px = "parseFloat(document.querySelector('.film .st[data-id=\"%s\"] .sl-sp-title').style.fontSize)"
    before1, before4 = page.evaluate(px % "b1"), page.evaluate(px % "b4")
    step = page.locator(".side .step").first
    assert step.locator("span").inner_text() == "100%"
    for _ in range(3):
        step.get_by_role("button", name="Мельче на 1%").click()
    assert page.evaluate("state.settings.splash") == 97
    page.wait_for_timeout(400)
    assert page.evaluate(px % "b1") < before1 and page.evaluate(px % "b4") < before4   # меняются все заставки проповеди
    page.evaluate("selectBlock('b4')")
    assert page.locator(".side .step span").first.inner_text() == "97%"
    page.keyboard.press("Control+s")
    page.wait_for_function("fakeCloud.db().sermons.s1.settings.splash === 97")
    # старый файл без размера — 100%; размер не выходит за диапазон из настроек
    assert page.evaluate("normalize({ blocks:[] }).settings.splash") is None
    assert page.evaluate("normalize({ blocks:[], settings:{ splash:120 } }).settings.splash") == 120
    page.evaluate("state.settings.splash = 500")
    assert page.evaluate("splashScale()") == page.evaluate("SLIDES_BASE.kinds.splash.max")
    # в боковой панели заставки нет текстовых подсказок
    assert page.locator(".side .hint").count() == 0
    assert not page.errors, page.errors
    ctx.close()


def test_translation_footer_starts_with_dot(page):
    start_blank(page)
    page.evaluate("""() => { const b = newBlock('scripture');
      b.items = [{ kind:'scripture', manual:true, mBook:'Иакова', mChapter:'2', mVerses:'17', ref:'Иакова 2:17', translation:'Синодальный перевод', verses:[{ num:'17', text:'Так и вера' }] }];
      state.blocks.push(b); selId = b.id; change(); renderMain(); }""")
    page.wait_for_function("document.querySelector('.stage .sl-tr.on')")
    assert page.inner_text(".stage .sl-tr").startswith("·")
    assert "Синодальный перевод" in page.inner_text(".stage .sl-tr")
    assert page.evaluate("TR_FOOTER") == "· {name}"


# ---------- названия, окно добавления, пустой JPEG ----------

def test_splash_name_and_add_sheet(page):
    start_blank(page)
    page.evaluate("state.meta.title = 'Вера, которая действует и побеждает мир'; addBlock('splash', 0)")
    assert page.evaluate("slideName(state.blocks[0], 1)") == "[1] Заставка Вера, которая действует и"
    assert page.evaluate("splashNamePart().length") <= page.evaluate("slidesCfg().names.maxLength")
    page.evaluate("state.meta.title = 'Сила'; change()")
    assert page.evaluate("slideName(state.blocks[0], 1)") == "[1] Заставка Сила"
    assert '"' not in page.evaluate("slideName(state.blocks[0], 1)") and "«" not in page.evaluate("slideName(state.blocks[0], 1)")
    # окно добавления: «Добавить после Слайда N», «Добавить в конец», плитки парами
    page.evaluate("openSheet(0)")
    assert page.inner_text(".overlay.open .sheet-title") == "Добавить в начало"
    page.evaluate("closeSheet(); openSheet(1)")
    assert page.inner_text(".overlay.open .sheet-title") == "Добавить в конец"
    page.evaluate("addBlock('thesis', 1); addBlock('quote', 2); openSheet(2)")
    assert page.inner_text(".overlay.open .sheet-title") == "Добавить после Слайда 2"
    names = page.evaluate("[...document.querySelectorAll('.overlay.open .type .type-name')].map(x => x.textContent)")
    assert names == ["Заставка проповеди", "Место Писания", "Тезис", "Цитата", "Картинка", "Видео", "Свободный слайд", "Заметка оператору"]
    widths = page.evaluate("[...document.querySelectorAll('.overlay.open .type')].map(x => Math.round(x.getBoundingClientRect().width))")
    assert len(set(widths)) == 1, widths   # все плитки одной ширины
    descs = page.inner_text(".overlay.open .types")
    assert "Одно или несколько мест Писания, а также дополнительный текст" in descs
    assert "Мысль, пункт плана, пояснение слова или понятия, список" in descs
    page.evaluate("closeSheet(); selectBlock(state.blocks[0].id)")
    assert "заставка проповеди" in page.inner_text(".stage-bar").lower()


def test_blank_jpeg_for_image_video_free(page):
    start_blank(page)
    page.evaluate("const b = newBlock('image'); b.name = 'Фото Досс'; state.blocks.push(b); selId = b.id; change(); renderMain();")
    btn = page.locator(".stage-bar").get_by_role("button", name="JPEG")
    assert btn.is_visible()
    with page.expect_download(timeout=60000) as dl:
        btn.click()
    assert dl.value.suggested_filename == "[1] Фото Досс.jpg"
    # пустой слайд: рамка и фон без текста
    assert page.evaluate("(() => { const sl = slideEl(state.blocks[0]); return !sl.querySelector('.sl-content, .sl-box, .sl-sp-box') && !!sl.querySelector('.sl-frame') && !!sl.querySelector('.sl-panel'); })()")
    for t in ("video", "free"):
        page.evaluate("t => { const b = newBlock(t); b.name = 'Слайд ' + t; state.blocks.push(b); selId = b.id; change(); renderMain(); }", t)
        assert page.locator(".stage-bar").get_by_role("button", name="JPEG").is_visible()
    # в архив «Скачать все слайды» пустые не попадают
    assert page.evaluate("state.blocks.filter(b => PREVIEW[b.type]).length") == 0
    assert not page.errors, page.errors


# ---------- панель оформления над полем ----------

def test_format_bar_sits_above_the_field(page):
    start_blank(page)
    page.evaluate("addBlock('quote', 0)")
    rich = page.locator(".side .bbody .rich").first
    rich.click()
    bar = page.locator("#fmtbar")
    assert bar.is_visible()
    assert page.evaluate("document.querySelector('#fmtbar').nextElementSibling === document.querySelector('.side .bbody .rich')")
    fb, rb = bar.bounding_box(), rich.bounding_box()
    assert fb["y"] + fb["height"] <= rb["y"] + 1   # над полем, а не под слайдом
    # «Текст к слайду» — панель в его заголовке
    page.locator(".speech .rich").click()
    assert page.evaluate("!!document.querySelector('.speech-head #fmtbar')")
    assert bar.is_visible()
    # фокус ушёл из полей — панели не видно
    page.locator(".stage-bar .cap").click()
    page.wait_for_timeout(100)
    assert not bar.is_visible()
    assert not page.errors, page.errors


# ---------- раскладка панелей ----------

def test_panels_resize_swap_saved_in_cloud(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": three_slides()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    page.wait_for_selector(".sv.lay .sv-resize")
    film_w = page.evaluate("filmEl.getBoundingClientRect().width")
    hd = page.locator(".sv-resize[data-i='0']").bounding_box()
    x, y = hd["x"] + hd["width"] / 2, hd["y"] + 200
    page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + 60, y, steps=5); page.mouse.up()
    assert abs(page.evaluate("filmEl.getBoundingClientRect().width") - (film_w + 60)) <= 2
    # этап 7.8: в облаке — доля ширины экрана «Слайды», а не пиксели
    page.wait_for_function("(() => { const p = fakeCloud.db().prefs && fakeCloud.db().prefs['admin@x.pl']; return p && p.v === 3 && Math.abs(p.film * document.querySelector('.sv').clientWidth - %d) <= 2; })()" % round(film_w + 60), timeout=5000)
    # поменять местами ленту и боковую панель: перетащить за заголовок
    head = page.locator(".side .side-head").bounding_box()
    tx = page.locator(".film").bounding_box()
    page.mouse.move(head["x"] + 10, head["y"] + 5); page.mouse.down()
    page.mouse.move(tx["x"] + 40, tx["y"] + 300, steps=8); page.mouse.up()
    assert page.evaluate("layout.order") == ["side", "stage", "film"]
    assert page.evaluate("sideEl.getBoundingClientRect().left < stageEl.getBoundingClientRect().left && stageEl.getBoundingClientRect().left < filmEl.getBoundingClientRect().left")
    page.wait_for_function("fakeCloud.db().prefs['admin@x.pl'].order && fakeCloud.db().prefs['admin@x.pl'].order[0] === 'side'", timeout=5000)
    # «Сбросить настройки экрана» — как было
    assert "Сбросить настройки экрана" in menu_items(page)
    page.evaluate("resetLayout()")
    assert page.evaluate("layout.order") is None and page.evaluate("curOrder()") == ["film", "stage", "side"]   # своего порядка нет: порядок пространства
    page.wait_for_function("JSON.stringify(fakeCloud.db().prefs['admin@x.pl']) === '{}'")
    assert not page.errors, page.errors
    ctx.close()


def test_layout_comes_from_cloud_on_other_computer(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": three_slides()})
    page.evaluate("() => { const db = fakeCloud.db(); db.prefs = { 'admin@x.pl':{ order:['stage', 'film', 'side'], film:260, side:360 } }; fakeCloud.put(db); localStorage.removeItem('swp-layout'); }")
    page.reload()
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    page.wait_for_function("layout.order[0] === 'stage'")
    page.wait_for_selector(".sv.lay")
    # запись в пикселях (до этапа 7.8) — пересчитана от экрана 1900 px в долю
    sv = page.evaluate("document.querySelector('.sv').clientWidth")
    assert abs(page.evaluate("filmEl.getBoundingClientRect().width") - round(260 / 1900 * sv)) <= 2
    assert page.evaluate("stageEl.getBoundingClientRect().left < filmEl.getBoundingClientRect().left")
    ctx.close()


def test_layout_keeps_proportions_on_any_screen(browser, base_url):
    """Этап 7.8: доли ширины — на большом и на маленьком экране пропорции те же; слайду — не меньше трети"""
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": three_slides()})
    page.evaluate("() => { const db = fakeCloud.db(); db.prefs = { 'admin@x.pl':{ v:3, order:['film', 'side', 'stage'], film:0.12, side:0.3 } }; fakeCloud.put(db); localStorage.removeItem('swp-layout'); }")
    shares = []
    for w in (1900, 1280):
        page.set_viewport_size({"width": w, "height": 900})
        page.evaluate("history.replaceState(null, '', location.pathname)")
        page.reload()
        page.wait_for_selector(".scard")
        open_sermon(page, "s1")
        page.wait_for_selector(".sv.lay")
        r = page.evaluate("(() => { const t = document.querySelector('.sv').clientWidth; return [filmEl.getBoundingClientRect().width / t, sideEl.getBoundingClientRect().width / t, stageEl.getBoundingClientRect().width / t]; })()")
        shares.append(r)
    assert abs(shares[0][1] - shares[1][1]) < 0.02 and abs(shares[0][0] - shares[1][0]) < 0.02, shares   # боковая панель — та же доля
    # очень широкая боковая панель на маленьком экране: слайду всё равно не меньше трети
    page.evaluate("setLayout({ v:3, order:['film', 'side', 'stage'], film:0.25, side:0.45 })")
    page.set_viewport_size({"width": 1200, "height": 900})
    page.wait_for_timeout(200)
    t = page.evaluate("document.querySelector('.sv').clientWidth")
    assert page.evaluate("stageEl.getBoundingClientRect().width") >= t / 3 - 2
    ctx.close()


def test_narrow_screen_keeps_old_layout(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": three_slides()})
    page.set_viewport_size({"width": 700, "height": 900})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    assert not page.locator(".sv.lay").count() and not page.locator(".sv-resize").count()
    assert "Сбросить настройки экрана" not in menu_items(page)
    ctx.close()


# ---------- отмена и возврат ----------

def test_undo_redo_slide_actions(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": three_slides()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    assert not page.locator(".hist").count()   # в просмотре кнопок нет
    start_edit(page)
    undo_b, redo_b = page.locator(".hist-undo"), page.locator(".hist-redo")
    assert undo_b.is_disabled() and redo_b.is_disabled()   # отменять нечего
    # удалить слайд — Ctrl+Z возвращает
    page.evaluate("selectBlock('b2')")
    page.locator(".st-box[data-box='b2']").hover()
    page.locator(".st-box[data-box='b2'] .st-acts").get_by_role("button", name="Удалить").click()   # значок на миниатюре (этап 7.4)
    assert order(page) == ["b1", "b3"]
    assert undo_b.is_enabled()
    page.evaluate("document.activeElement && document.activeElement.blur()")
    page.keyboard.press("Control+z")
    assert order(page) == ["b1", "b2", "b3"]
    assert page.evaluate("selId") == "b2"
    assert redo_b.is_enabled()
    page.keyboard.press("Control+y")
    assert order(page) == ["b1", "b3"]
    undo_b.click()
    assert order(page) == ["b1", "b2", "b3"]
    # переставить и добавить — тоже
    page.evaluate("moveTo(state.blocks[2], 0)")
    assert order(page) == ["b3", "b1", "b2"]
    page.evaluate("addBlock('quote', 3)")
    assert len(order(page)) == 4
    undo_b.click()
    assert order(page) == ["b3", "b1", "b2"]
    undo_b.click()
    assert order(page) == ["b1", "b2", "b3"]
    # история переживает автосохранение
    page.wait_for_function("!isDirty()", timeout=10000)
    assert page.evaluate("fakeCloud.db().sermons.s1.blocks.map(b => b.id)") == ["b1", "b2", "b3"]
    assert undo_b.is_disabled() and redo_b.is_enabled()
    redo_b.click()
    assert order(page) == ["b3", "b1", "b2"]
    page.wait_for_function("!isDirty()", timeout=10000)
    assert undo_b.is_enabled()   # автосохранение историю не стирает
    undo_b.click()
    assert order(page) == ["b1", "b2", "b3"]
    redo_b.click()
    # «доработать» в отмену не входит
    n = page.evaluate("hist.undo.length")
    page.evaluate("toggleTodo(state.blocks[0])")
    assert page.evaluate("hist.undo.length") == n
    # «Сохранить» закрывает правку — история сбрасывается
    page.get_by_role("button", name="Сохранить", exact=True).click()
    page.wait_for_function("ed.mode === 'view'")
    assert not page.locator(".hist").count()
    start_edit(page)
    assert page.locator(".hist-undo").is_disabled()
    assert not page.errors, page.errors
    ctx.close()


def test_undo_in_field_first_undoes_typing(page):
    start_blank(page)
    page.evaluate("addBlock('quote', 0)")
    page.evaluate("addBlock('thesis', 1)")
    page.evaluate("selectBlock(state.blocks[0].id)")
    rich = page.locator(".side .bbody .rich").first
    rich.click()
    page.keyboard.type("Слово")
    page.wait_for_timeout(50)
    assert page.evaluate("plain(state.blocks[0].text)") == "Слово"
    # сначала Ctrl+Z отменяет набор в самом поле (как в браузере), слайды на месте
    for _ in range(8):
        if not page.evaluate("plain(state.blocks[0].text)"):
            break
        page.keyboard.press("Control+z")
        page.wait_for_timeout(30)
        assert page.evaluate("state.blocks.length") == 2
    assert page.evaluate("plain(state.blocks[0].text)") == ""
    # потом — действия со слайдами
    page.keyboard.press("Control+z")
    page.wait_for_timeout(50)
    if page.evaluate("state.blocks.length") == 2:   # браузер ещё считал, что в поле есть что отменять
        page.evaluate("document.activeElement.blur()")
        page.keyboard.press("Control+z")
    assert page.evaluate("state.blocks.length") == 1
    page.keyboard.press("Control+y")
    assert page.evaluate("state.blocks.length") == 2
    assert not page.errors, page.errors


def test_save_button_label_and_icon(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": three_slides()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    start_edit(page)
    btn = page.locator(".topbar").get_by_role("button", name="Сохранить", exact=True)
    assert btn.is_visible()
    assert not page.locator(".topbar").get_by_role("button", name="Сохранить и закрыть").count()
    assert "M12 4v11" not in btn.inner_html()   # без стрелки вниз
    ctx.close()
