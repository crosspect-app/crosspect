"""Этап 7.3: фон слайдов (одинаковый предпросмотр и JPEG, повторяемость; окно форматов — test_ui75.py),
окно настроек («Применить» только при изменениях, без «Закрыть», «Между ссылкой и текстом», заставка «Только название»),
без «Источника настроек» и «Открыть файл», контакт на экране «Вас нет в списке».
Статусы и «автор» — в test_editor.py. Облако подменено: tests/fixtures/fake_cloud.js."""
from conftest import cloud_page
from test_cloud import MEMBERS
from test_lock import open_sermon
from test_ui71 import ED, MEMBERS_ED, menu_items, three_slides
from test_ui72 import with_splashes

# фон для проверок JPEG: без зерна и затемнения, чтобы цвета картинки и JPEG можно было сравнить напрямую
TEST_BG = {"stripesV": 100, "stripesH": 0, "spots": 0, "shades": 3, "color": "#2f6fd0", "spread": 60, "blur": 20,
           "grain": 0, "grainKind": "fine", "base": 10, "vignette": 0, "seed": 3}


def stage_var(page, sel, name):
    return page.evaluate("([s, n]) => getComputedStyle(document.querySelector(s)).getPropertyValue(n).trim()", [sel, name])


def apply_btn(page):
    return page.locator(".sheet.scfg").get_by_role("button", name="Применить")


# ---------- окно «Настройки слайдов» ----------

def test_apply_only_when_changed_and_no_close_button(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED, sermons={"s1": three_slides()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    page.evaluate("openSlidesCfg()")
    sheet = page.locator(".sheet.scfg")
    page.wait_for_selector(".scfg-slide .sl")
    assert apply_btn(page).is_disabled()   # ничего не меняли
    assert sheet.locator(".sheet-foot").get_by_role("button", name="Закрыть").count() == 0
    assert sheet.locator(".sheet-head [aria-label='Закрыть']").count() == 1   # крестик остаётся
    lim = sheet.locator("[aria-label='Тезис: лимит символов']")
    lim.fill("150")
    page.wait_for_function("!document.querySelector('.scfg .sheet-foot .btn.primary').disabled")
    lim.fill("220")   # вернули как было — снова неактивна
    page.wait_for_function("document.querySelector('.scfg .sheet-foot .btn.primary').disabled")
    lim.fill("150")
    page.wait_for_function("!document.querySelector('.scfg .sheet-foot .btn.primary').disabled")
    apply_btn(page).click()
    page.wait_for_function("fakeCloud.calls.slides === 1")
    page.wait_for_function("document.querySelector('.scfg .sheet-foot .btn.primary').disabled")   # после «Применить» — снова неактивна
    assert page.evaluate("fakeCloud.db().slides.limits.thesis") == 150
    # закрыли с неприменёнными изменениями — ничего не спрашивается и не применяется
    lim.fill("90")
    page.keyboard.press("Escape")
    assert not page.evaluate("settingsOverlay.classList.contains('open')")
    assert page.evaluate("fakeCloud.calls.slides") == 1 and page.evaluate("SLIDES_BASE.limits.thesis") == 150
    assert not page.errors, page.errors
    ctx.close()


def test_ref_gap_is_called_link_and_text(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED)
    page.wait_for_selector(".home-top")
    page.evaluate("openSlidesCfg()")
    text = page.inner_text(".sheet.scfg")
    assert "Между ссылкой и текстом" in text and "Между местом и текстом" not in text
    f = page.locator(".scfg [aria-label='Расстояние между ссылкой и текстом']")
    assert f.count() == 1 and "ссылк" in f.get_attribute("title")
    ctx.close()


def test_splash_title_only(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED, sermons={"s1": with_splashes()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    page.evaluate("selectBlock('b4')")
    page.wait_for_selector(".stage .sl[data-id='b4'] .sl-sp-name")
    # выключено — как раньше: линия, имя и дата видны
    assert page.locator(".stage .sl[data-id='b4'] .sl-sp-foot").is_visible()
    jpeg_off = page.evaluate("renderJPEG(state.blocks.find(b => b.id === 'b4')).then(blob => createImageBitmap(blob)).then(footLight)".replace(
        "footLight", "bm => { const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const x = c.getContext('2d'); x.drawImage(bm, 0, 0);"
        " const d = x.getImageData(110, 900, 900, 80).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; }"))
    page.evaluate("openSlidesCfg()")
    sheet = page.locator(".sheet.scfg")
    foot = sheet.locator("[aria-label='Заставка: имя и дата: размер']")
    assert foot.is_enabled()
    sheet.get_by_text("Заставка: только название").click()
    assert foot.is_disabled()   # строка «Заставка: имя и дата» неактивна
    page.wait_for_function("(() => { const f = document.querySelector('.scfg-slide .sl-sp-foot'); return f && getComputedStyle(f).display === 'none'; })()")
    apply_btn(page).click()
    page.wait_for_function("fakeCloud.db().slides && fakeCloud.db().slides.kinds.splash.titleOnly === true")
    page.keyboard.press("Escape")
    # на сцене и в ленте: нет линии, имени и даты, название посередине всей области текста
    page.wait_for_function("[...document.querySelectorAll('.sl[data-id=\"b4\"] .sl-sp-foot')].every(f => getComputedStyle(f).display === 'none')")
    box = page.evaluate("""(() => { const sl = document.querySelector('.stage .sl[data-id="b4"]'), st = sl.querySelector('.sl-stage');
      const b = sl.querySelector('.sl-sp-box'), t = sl.querySelector('.sl-sp-title'), k = sl.clientWidth / 1920;
      const sr = st.getBoundingClientRect(), tr = t.getBoundingClientRect();
      return { bottom:getComputedStyle(b).bottom, mid:((tr.top + tr.bottom) / 2 - sr.top) / k,
               area:(parseFloat(getComputedStyle(st).getPropertyValue('--sl-t')) + 1080 - parseFloat(getComputedStyle(st).getPropertyValue('--sl-b'))) / 2 }; })()""")
    assert box["bottom"] == "104px", box   # 44 + поле 60
    assert abs(box["mid"] - box["area"]) < 4, box
    jpeg_on = page.evaluate("renderJPEG(state.blocks.find(b => b.id === 'b4')).then(blob => createImageBitmap(blob)).then(footLight)".replace(
        "footLight", "bm => { const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const x = c.getContext('2d'); x.drawImage(bm, 0, 0);"
        " const d = x.getImageData(110, 900, 900, 80).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; }"))
    assert jpeg_off > jpeg_on + 4, (jpeg_off, jpeg_on)   # в JPEG внизу больше нет светлой линии и имени
    assert not page.errors, page.errors
    ctx.close()


# ---------- фон ----------

# Генератор фона в окне с этапа 7.5 работает через форматы: «Создать новый», «Сохранить», «Сделать по умолчанию» —
# проверки в test_ui75.py (там же System Template — прежний фон один в один).


def test_author_gets_background_and_cannot_change_it(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user={"email": "ivan@x.pl", "name": "Иван"}, members=MEMBERS_ED, sermons={"s1": three_slides()})
    page.evaluate("d => { const db = fakeCloud.db(); db.slides = { bg:d }; fakeCloud.put(db); }", TEST_BG)
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    page.wait_for_function("getComputedStyle(document.querySelector('.film .sl-stage')).getPropertyValue('--sl-bg').includes('data:image/jpeg')")
    assert "Настройки слайдов" not in menu_items(page)
    ctx.close()


def test_background_is_repeatable(browser, base_url):
    """Случайность — только от номера варианта: в другой вкладке (и у другого человека) картинка та же; зерно — тоже"""
    shots = []
    for _ in range(2):
        ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED)
        page.wait_for_selector(".home-top")
        shots.append(page.evaluate("d => [bgImage(normBg(d)), NOISE, grainTile('coarse').url, grainTile('color').url]", TEST_BG))
        other = page.evaluate("d => bgImage(normBg(Object.assign({}, d, { seed:d.seed + 1 })))", TEST_BG)
        ctx.close()
    assert shots[0] == shots[1]
    assert shots[0][0].startswith("url(data:image/jpeg") and other != shots[0][0]


def test_background_jpeg_matches_preview(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED, sermons={"s1": with_splashes()})
    page.evaluate("d => { const db = fakeCloud.db(); db.slides = { bg:d }; fakeCloud.put(db); }", TEST_BG)
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    page.wait_for_function("sermonBg(state) && sermonBg(state).color === '#2f6fd0'")   # фон 7.3 стал форматом «Фон пространства» (этап 7.5)
    # одни и те же точки панели: в картинке фона (как её растягивает слайд) и в JPEG картинки-слайда (пустой слайд — только фон)
    res = page.evaluate("""async () => {
      const pts = [[300, 300], [960, 540], [1600, 800], [700, 900], [1300, 200]];
      const url = bgImage(sermonBg(state)).slice(4, -1), img = new Image(); img.src = url; await img.decode();
      const a = document.createElement('canvas'); a.width = 1920; a.height = 1080;
      const ax = a.getContext('2d'); ax.drawImage(img, 44, 44, 1832, 992);   // панель — отступ 44 от края кадра
      const bm = await createImageBitmap(await renderJPEG(state.blocks.find(b => b.type === 'image')));
      const b = document.createElement('canvas'); b.width = 1920; b.height = 1080;
      const bx = b.getContext('2d'); bx.drawImage(bm, 0, 0);
      const def = await createImageBitmap(await (async () => { const keep = SLIDES_BASE; SLIDES_BASE = mergeSlides(SLIDES_DEFAULT, null);
        try { return await renderJPEG(state.blocks.find(b => b.type === 'image')); } finally { SLIDES_BASE = keep; } })());
      const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
      const cx = c.getContext('2d'); cx.drawImage(def, 0, 0);
      const px = (x, X, Y) => Array.from(x.getImageData(X - 3, Y - 3, 7, 7).data).reduce((s, v, i) => { s[i % 4] += v / 49; return s; }, [0, 0, 0, 0]).slice(0, 3);
      return pts.map(([X, Y]) => ({ bg:px(ax, X, Y), jpeg:px(bx, X, Y), def:px(cx, X, Y) }));
    }""")
    for r in res:
        diff = max(abs(a - b) for a, b in zip(r["bg"], r["jpeg"]))
        assert diff < 14, r   # фон в JPEG — та же картинка, что и в предпросмотре
    assert any(max(abs(a - b) for a, b in zip(r["jpeg"], r["def"])) > 30 for r in res), "с прежним фоном JPEG другой"
    assert not page.errors, page.errors
    ctx.close()


# ---------- меню и главная ----------

def test_no_settings_source_and_no_open_file(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED, sermons={"s1": three_slides()})
    page.evaluate("localStorage.setItem('swp-config-url', 'https://example.com/config.json')")
    page.reload()
    page.wait_for_selector(".scard")
    assert page.evaluate("localStorage.getItem('swp-config-url')") is None   # своя ссылка забыта
    assert page.evaluate("configUrl() === CONFIG_URL_DEFAULT")
    items = menu_items(page)
    assert "Источник настроек" not in items and "Открыть файл" not in items
    assert "Открыть файл" not in page.inner_text(".home")
    open_sermon(page, "s1")
    items = menu_items(page)
    assert "Источник настроек" not in items and "Открыть файл" not in items and "Скачать файл" in items
    assert page.evaluate("Object.keys(LANGS).length") >= 20   # переводы на месте
    ctx.close()


def test_empty_home_has_no_open_file(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED)
    page.wait_for_selector(".home .empty")
    assert "файл" not in page.inner_text(".home .empty").lower()
    ctx.close()


def test_not_a_member_sees_contact_email(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user={"email": "stranger@x.pl", "name": "Чужой"}, members=MEMBERS)
    page.wait_for_selector(".gate")
    link = page.locator(".gate a[href='mailto:swpoznan.media@gmail.com']")
    assert link.count() == 1 and link.inner_text() == "swpoznan.media@gmail.com"
    assert page.evaluate("CONTACT_EMAIL") == "swpoznan.media@gmail.com"
    assert "stranger@x.pl" in page.inner_text(".gate")
    ctx.close()
