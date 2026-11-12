"""Этап 7.5: форматы фона. System Template (прежний фон, не меняется и не удаляется), «Создать новый», «Копировать»,
«Сохранить», «Удалить», «Сделать по умолчанию», вопрос о несохранённом формате, перенос фона 7.3 в «Фон пространства»,
фон проповеди по одному правилу (sermonBg) в сцене, ленте и JPEG, автор окна не видит.
Облако подменено: tests/fixtures/fake_cloud.js."""
from conftest import cloud_page
from test_lock import open_sermon
from test_ui71 import ED, MEMBERS_ED, menu_items, three_slides
from test_ui72 import with_splashes
from test_ui73 import TEST_BG, apply_btn, stage_var

BLUE = dict(TEST_BG)
RED = dict(TEST_BG, color="#c03030", seed=5)


def editor_in_window(browser, base_url, slides=None, sermons=None):
    """Редактор открыл проповедь и «Настройки слайдов»"""
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED, sermons=sermons or {"s1": with_splashes()})
    if slides is not None:
        page.evaluate("d => { const db = fakeCloud.db(); db.slides = d; fakeCloud.put(db); }", slides)
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    page.evaluate("openSlidesCfg()")
    page.wait_for_selector(".scfg-slide .sl")
    return ctx, page


def sheet(page):
    return page.locator(".sheet.scfg")


def btn(page, name):
    return sheet(page).locator(".scfg-fmt").get_by_role("button", name=name, exact=True)


def fmt_select(page):
    return sheet(page).locator("[aria-label='Формат фона']")


def options(page):
    return page.evaluate("[...document.querySelectorAll('.scfg [aria-label=\"Формат фона\"] option')].map(o => o.textContent)")


def cloud_slides(page):
    return page.evaluate("fakeCloud.db().slides")


def film_bgs(page):
    return page.evaluate("[...document.querySelectorAll('.film .sl-stage, .stage .sl-stage')].map(s => getComputedStyle(s).getPropertyValue('--sl-bg').trim())")


# ---------- System Template ----------

def test_system_template_is_locked(browser, base_url):
    ctx, page = editor_in_window(browser, base_url)
    assert options(page) == ["System Template · по умолчанию"]
    assert sheet(page).get_by_role("button", name="Сбросить фон").count() == 0   # не нужна: есть System Template
    # ползунки, цвет, зерно и «Другой вариант» — серые; «Сохранить», «Удалить», «Сделать по умолчанию» — неактивны
    for label in ("Полосы по вертикали", "Пятна", "Оттенков", "Основной цвет", "Размытие", "Зернистость", "Яркость основы", "Затемнение краёв"):
        assert sheet(page).locator("[aria-label='%s']" % label).is_disabled(), label
    assert sheet(page).get_by_role("button", name="Другой вариант").is_disabled()
    assert page.evaluate("[...document.querySelectorAll('.scfg-bg .toggle button')].every(b => b.disabled)")
    assert page.evaluate("document.querySelector('.scfg-bg').classList.contains('locked')")
    assert "нельзя изменить" in page.get_attribute(".scfg-bg", "title")
    assert btn(page, "Сохранить").is_disabled() and btn(page, "Удалить").is_disabled() and btn(page, "Сделать по умолчанию").is_disabled()
    assert btn(page, "Копировать").is_enabled() and btn(page, "Создать новый").is_enabled()
    name = sheet(page).locator("[aria-label='Название формата']")
    assert name.is_disabled() and name.input_value() == "System Template"
    # пример и проповедь — прежний фон один в один
    assert stage_var(page, ".scfg-slide .sl-stage", "--sl-bg") == "none"
    assert set(film_bgs(page)) == {"none"}
    assert not page.errors, page.errors
    ctx.close()


# ---------- создать, сохранить, копировать, удалить ----------

def test_create_save_copy_delete(browser, base_url):
    ctx, page = editor_in_window(browser, base_url)
    page.on("dialog", lambda d: d.accept())
    btn(page, "Создать новый").click()
    # новый формат: чёрный, все ползунки на нуле, оттенков 1, вариант 1, имя пустое
    vals = page.evaluate("""(() => { const q = l => document.querySelector('.scfg [aria-label="' + l + '"]').value;
      return ['Полосы по вертикали', 'Полосы по горизонтали', 'Пятна', 'Оттенков', 'Основной цвет', 'Разброс оттенков', 'Размытие',
              'Зернистость', 'Яркость основы', 'Затемнение краёв', 'Название формата'].map(q); })()""")
    assert vals == ["0", "0", "0", "1", "#000000", "0", "0", "0", "0", "0", ""], vals
    assert options(page)[0] == "Новый формат (не сохранён)"
    name = sheet(page).locator("[aria-label='Название формата']")
    assert name.is_enabled()
    assert btn(page, "Сохранить").is_disabled() and "название" in btn(page, "Сохранить").get_attribute("title")
    assert btn(page, "Удалить").is_disabled() and btn(page, "Сделать по умолчанию").is_disabled()
    page.wait_for_function("getComputedStyle(document.querySelector('.scfg-slide .sl-stage')).getPropertyValue('--sl-bg').includes('data:image/jpeg')")
    name.fill("Синий")
    sheet(page).locator("[aria-label='Основной цвет']").fill("#2244aa")
    sheet(page).locator("[aria-label='Пятна']").fill("70")
    btn(page, "Сохранить").click()
    page.wait_for_function("fakeCloud.calls.slides === 1")
    sl = cloud_slides(page)
    assert sl["defaultFormat"] == "system" and "bg" not in sl
    (fid, f), = sl["formats"].items()
    assert f["name"] == "Синий" and f["bg"]["color"] == "#2244aa" and f["bg"]["spots"] == 70 and f["bg"]["shades"] == 1
    # сохранённый: выбран в списке, имя не меняется, «Сохранить» неактивна до первой правки
    page.wait_for_function("document.querySelector('.scfg [aria-label=\"Формат фона\"]').value === %r" % fid)
    assert options(page) == ["System Template · по умолчанию", "Синий"]
    assert name.is_disabled() and btn(page, "Сохранить").is_disabled()
    assert btn(page, "Удалить").is_enabled() and btn(page, "Сделать по умолчанию").is_enabled()
    assert set(film_bgs(page)) == {"none"}   # проповеди — по-прежнему формат по умолчанию (System Template)
    sheet(page).locator("[aria-label='Затемнение краёв']").fill("40")
    assert btn(page, "Сохранить").is_enabled() and btn(page, "Сделать по умолчанию").is_disabled()   # сначала сохранить
    btn(page, "Сохранить").click()
    page.wait_for_function("fakeCloud.calls.slides === 2")
    sl = cloud_slides(page)
    assert list(sl["formats"]) == [fid] and sl["formats"][fid]["name"] == "Синий" and sl["formats"][fid]["bg"]["vignette"] == 40
    # копия: те же настройки и то же имя — сохранить нельзя, пока имя не поменяли (без учёта регистра и пробелов по краям)
    btn(page, "Копировать").click()
    assert options(page)[0] == "Копия (не сохранена)"
    assert name.input_value() == "Синий" and name.is_enabled()
    assert sheet(page).locator("[aria-label='Затемнение краёв']").input_value() == "40"
    assert btn(page, "Сохранить").is_disabled() and "то же название" in btn(page, "Сохранить").get_attribute("title")
    name.fill("  синий ")
    assert btn(page, "Сохранить").is_disabled()
    name.fill("system template")
    assert btn(page, "Сохранить").is_disabled() and "уже есть" in btn(page, "Сохранить").get_attribute("title")
    name.fill("Синий тёмный")
    assert btn(page, "Сохранить").is_enabled()
    btn(page, "Сохранить").click()
    page.wait_for_function("fakeCloud.calls.slides === 3")
    sl = cloud_slides(page)
    assert sorted(f["name"] for f in sl["formats"].values()) == ["Синий", "Синий тёмный"]
    copy_id = next(k for k, v in sl["formats"].items() if v["name"] == "Синий тёмный")
    assert sl["formats"][copy_id]["bg"] == sl["formats"][fid]["bg"]
    assert options(page) == ["System Template · по умолчанию", "Синий", "Синий тёмный"]
    # удалить (с подтверждением) — формат пропал, выбран формат по умолчанию
    btn(page, "Удалить").click()
    page.wait_for_function("fakeCloud.calls.slides === 4")
    assert list(cloud_slides(page)["formats"]) == [fid]
    page.wait_for_function("document.querySelector('.scfg [aria-label=\"Формат фона\"]').value === 'system'")
    assert not page.errors, page.errors
    ctx.close()


def test_copy_of_system_template_keeps_old_background(browser, base_url):
    """Копия System Template — тот же прежний фон, пока ползунки не тронули"""
    ctx, page = editor_in_window(browser, base_url)
    btn(page, "Копировать").click()
    sheet(page).locator("[aria-label='Название формата']").fill("Как раньше")
    assert sheet(page).locator("[aria-label='Пятна']").is_enabled()
    assert stage_var(page, ".scfg-slide .sl-stage", "--sl-bg") == "none"
    btn(page, "Сохранить").click()
    page.wait_for_function("fakeCloud.calls.slides === 1")
    (f,) = cloud_slides(page)["formats"].values()
    assert f == {"name": "Как раньше", "bg": None}
    ctx.close()


# ---------- формат по умолчанию: все проповеди, JPEG ----------

def test_make_default_changes_every_sermon_and_jpeg(browser, base_url):
    slides = {"formats": {"blue": {"name": "Синий", "bg": BLUE}, "red": {"name": "Красный", "bg": RED}}, "defaultFormat": "system"}
    ctx, page = editor_in_window(browser, base_url, slides=slides)
    assert options(page) == ["System Template · по умолчанию", "Красный", "Синий"]
    fmt_select(page).select_option("blue")
    # выбор показывает формат в примере и ползунках, на проповеди не влияет
    page.wait_for_function("getComputedStyle(document.querySelector('.scfg-slide .sl-stage')).getPropertyValue('--sl-bg') === bgImage(normBg(%s))" % _js(BLUE))
    assert sheet(page).locator("[aria-label='Основной цвет']").input_value() == BLUE["color"]
    assert set(film_bgs(page)) == {"none"}
    btn(page, "Сделать по умолчанию").click()
    page.wait_for_function("fakeCloud.calls.slides === 1")
    assert cloud_slides(page)["defaultFormat"] == "blue"
    assert options(page)[2] == "Синий · по умолчанию"
    assert btn(page, "Сделать по умолчанию").is_disabled()
    # все слайды проповеди (и пустые: картинка) — с этим фоном, одна и та же картинка (кеш)
    page.wait_for_function("[...document.querySelectorAll('.film .sl-stage')].every(s => getComputedStyle(s).getPropertyValue('--sl-bg') === bgImage(normBg(%s)))" % _js(BLUE))
    vals = film_bgs(page)
    assert len(set(vals)) == 1 and len(vals) >= 5
    page.keyboard.press("Escape")
    # JPEG картинки-слайда (только рамка и фон) — с тем же фоном
    res = page.evaluate("""async () => {
      const url = bgImage(sermonBg(state)).slice(4, -1), img = new Image(); img.src = url; await img.decode();
      const a = document.createElement('canvas'); a.width = 1920; a.height = 1080;
      const ax = a.getContext('2d'); ax.drawImage(img, 44, 44, 1832, 992);
      const bm = await createImageBitmap(await renderJPEG(state.blocks.find(b => b.type === 'image')));
      const b = document.createElement('canvas'); b.width = 1920; b.height = 1080;
      const bx = b.getContext('2d'); bx.drawImage(bm, 0, 0);
      const px = (x, X, Y) => Array.from(x.getImageData(X - 3, Y - 3, 7, 7).data).reduce((s, v, i) => { s[i % 4] += v / 49; return s; }, [0, 0, 0, 0]).slice(0, 3);
      return [[300, 300], [960, 540], [1600, 800]].map(([X, Y]) => [px(ax, X, Y), px(bx, X, Y)]);
    }""")
    for a, b in res:
        assert max(abs(x - y) for x, y in zip(a, b)) < 14, (a, b)
    # удалили формат по умолчанию — снова System Template, у всех прежний фон
    page.evaluate("openSlidesCfg()")
    page.on("dialog", lambda d: d.accept())
    assert fmt_select(page).input_value() == "blue"   # окно открывается на формате по умолчанию
    btn(page, "Удалить").click()
    page.wait_for_function("fakeCloud.calls.slides === 2")
    sl = cloud_slides(page)
    assert sl["defaultFormat"] == "system" and list(sl["formats"]) == ["red"]
    page.wait_for_function("[...document.querySelectorAll('.film .sl-stage')].every(s => getComputedStyle(s).getPropertyValue('--sl-bg').trim() === 'none')")
    assert options(page) == ["System Template · по умолчанию", "Красный"]
    assert not page.errors, page.errors
    ctx.close()


def _js(d):
    import json
    return json.dumps(d)


# ---------- перенос фона 7.3 ----------

def test_background_73_becomes_format(browser, base_url):
    ctx, page = editor_in_window(browser, base_url, slides={"bg": BLUE, "limits": {"thesis": 200, "quote": 300}})
    assert options(page) == ["System Template", "Фон пространства · по умолчанию"]
    assert fmt_select(page).input_value() == "space"
    assert page.evaluate("SLIDES_BASE.defaultFormat") == "space" and page.evaluate("'bg' in SLIDES_BASE") is False
    assert page.evaluate("JSON.stringify(sermonBg(state)) === JSON.stringify(normBg(%s))" % _js(BLUE))
    assert set(film_bgs(page)) == {page.evaluate("bgImage(normBg(%s))" % _js(BLUE))}   # на экране ничего не поменялось
    # первая же запись настроек кладёт в облако форматы, а не bg
    sheet(page).locator("[aria-label='Тезис: лимит символов']").fill("150")
    apply_btn(page).click()
    page.wait_for_function("fakeCloud.calls.slides === 1")
    sl = cloud_slides(page)
    assert "bg" not in sl and sl["defaultFormat"] == "space" and sl["formats"]["space"]["name"] == "Фон пространства"
    assert sl["formats"]["space"]["bg"] == page.evaluate("normBg(%s)" % _js(BLUE)) and sl["limits"]["thesis"] == 150
    ctx.close()


def test_model_rules_for_formats(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED)
    page.wait_for_selector(".home-top")
    r = page.evaluate("""d => {
      const m = o => { const c = mergeSlides(SLIDES_DEFAULT, o); return { f:c.formats, d:c.defaultFormat }; };
      return {
        none: m(null),
        old73null: m({ bg:null }),
        noMigrateWithFormats: m({ bg:d, formats:{} }),
        missingDefault: m({ formats:{ a:{ name:'A', bg:d } }, defaultFormat:'gone' }),
        bad: m({ formats:{ 'bad id':{ name:'X', bg:d }, system:{ name:'Y', bg:d }, e:{ name:'  ', bg:d }, a:{ name:' Синий ', bg:d },
                           b:{ name:'синий', bg:d }, c:{ name:'SYSTEM TEMPLATE', bg:d }, n:{ name:'Прежний', bg:null } }, defaultFormat:'a' }),
        order: formatList(mergeSlides(SLIDES_DEFAULT, { formats:{ x:{ name:'Яблоко', bg:null }, y:{ name:'Арбуз', bg:null } } })).map(f => f.name),
        idOrder: (() => { const c = mergeSlides(SLIDES_DEFAULT, { formats:{ x:{ name:'X', bg:d } }, defaultFormat:'x' }); return [sermonFormatId(null, c), sermonFormatId({ settings:{} }, c)]; })(),
      };
    }""", BLUE)
    assert r["none"] == {"f": {}, "d": "system"}
    assert r["old73null"] == {"f": {}, "d": "system"}   # фон 7.3 не трогали — переносить нечего
    assert r["noMigrateWithFormats"] == {"f": {}, "d": "system"}
    assert r["missingDefault"]["d"] == "system"
    bad = r["bad"]
    assert sorted(bad["f"]) == ["a", "n"] and bad["f"]["a"]["name"] == "Синий" and bad["f"]["n"]["bg"] is None and bad["d"] == "a"
    assert r["order"] == ["System Template", "Арбуз", "Яблоко"]
    assert r["idOrder"] == ["x", "x"]
    ctx.close()


# ---------- несохранённый формат ----------

def test_unsaved_format_asks_before_leaving(browser, base_url):
    slides = {"formats": {"blue": {"name": "Синий", "bg": BLUE}}, "defaultFormat": "blue"}
    ctx, page = editor_in_window(browser, base_url, slides=slides)
    ask = page.locator(".scfg-ask")
    sheet(page).locator("[aria-label='Пятна']").fill("55")
    # выбрать другой формат — вопрос; «Отмена» — остаёмся с правками
    fmt_select(page).select_option("system")
    ask.wait_for(state="visible")
    assert "«Синий»" in ask.inner_text() and "несохранённые изменения" in ask.inner_text()
    ask.get_by_role("button", name="Отмена").click()
    assert ask.is_hidden() and fmt_select(page).input_value() == "blue"
    assert sheet(page).locator("[aria-label='Пятна']").input_value() == "55"
    # «Не сохранять» — уходим, в облаке ничего не записано
    fmt_select(page).select_option("system")
    ask.get_by_role("button", name="Не сохранять").click()
    assert fmt_select(page).input_value() == "system" and page.evaluate("fakeCloud.calls.slides || 0") == 0
    # закрыть окно с правками (Esc) — тот же вопрос; «Сохранить» — сохраняет и закрывает
    fmt_select(page).select_option("blue")
    sheet(page).locator("[aria-label='Пятна']").fill("44")
    page.keyboard.press("Escape")
    ask.wait_for(state="visible")
    assert page.evaluate("settingsOverlay.classList.contains('open')")
    page.keyboard.press("Escape")   # Esc при вопросе — отмена вопроса, окно остаётся
    assert ask.is_hidden() and page.evaluate("settingsOverlay.classList.contains('open')")
    sheet(page).locator(".sheet-head [aria-label='Закрыть']").click()
    ask.get_by_role("button", name="Сохранить").click()
    page.wait_for_function("!settingsOverlay.classList.contains('open')")
    assert cloud_slides(page)["formats"]["blue"]["bg"]["spots"] == 44
    # новый формат без названия: сохранить нельзя — только вернуться или не сохранять
    page.evaluate("openSlidesCfg()")
    btn(page, "Создать новый").click()
    sheet(page).locator("[aria-label='Пятна']").fill("30")
    page.keyboard.press("Escape")
    ask.wait_for(state="visible")
    assert "Напишите название" in ask.inner_text()
    assert ask.get_by_role("button", name="Сохранить").count() == 0
    ask.get_by_role("button", name="Не сохранять").click()
    page.wait_for_function("!settingsOverlay.classList.contains('open')")
    # без правок — закрывается сразу, без вопроса; другие окна (closeSettings) тоже не задерживаются
    page.evaluate("openSlidesCfg()")
    btn(page, "Создать новый").click()
    page.keyboard.press("Escape")
    page.wait_for_function("!settingsOverlay.classList.contains('open')")
    page.evaluate("openSlidesCfg()")
    sheet(page).locator("[aria-label='Пятна']").fill("12")
    # другое окно (как «Правку забрали» в lock.js) заменило настройки — его закрытие ни о чём не спрашивает
    page.evaluate("settingsOverlay.innerHTML = ''; settingsOverlay.append(h('div', { class:'sheet' }, 'другое окно'))")
    page.evaluate("closeSettings()")
    assert not page.evaluate("settingsOverlay.classList.contains('open')")
    assert not page.errors, page.errors
    ctx.close()


def test_formats_are_separate_from_apply(browser, base_url):
    """Действия с форматами пишутся сразу и не уносят неприменённые настройки; «Применить» не затирает форматы"""
    ctx, page = editor_in_window(browser, base_url)
    sheet(page).locator("[aria-label='Тезис: лимит символов']").fill("150")
    btn(page, "Создать новый").click()
    sheet(page).locator("[aria-label='Название формата']").fill("Ночь")
    btn(page, "Сохранить").click()
    page.wait_for_function("fakeCloud.calls.slides === 1")
    sl = cloud_slides(page)
    assert sl["limits"]["thesis"] == 220 and [f["name"] for f in sl["formats"].values()] == ["Ночь"]
    assert apply_btn(page).is_enabled()   # лимит ещё не применён
    apply_btn(page).click()
    page.wait_for_function("fakeCloud.calls.slides === 2")
    sl = cloud_slides(page)
    assert sl["limits"]["thesis"] == 150 and [f["name"] for f in sl["formats"].values()] == ["Ночь"]
    page.wait_for_function("document.querySelector('.scfg .sheet-foot .btn.primary').disabled")
    # формат, который другой редактор поменял, пока окно открыто, приходит в список сам
    page.evaluate("""() => { const db = fakeCloud.db(); db.slides.formats.zz = { name:'Утро', bg:null }; fakeCloud.put(db); }""")
    page.wait_for_function("[...document.querySelectorAll('.scfg [aria-label=\"Формат фона\"] option')].some(o => o.textContent === 'Утро')")
    assert not page.errors, page.errors
    ctx.close()


# ---------- автор ----------

def test_author_gets_default_format_and_no_window(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user={"email": "ivan@x.pl", "name": "Иван"}, members=MEMBERS_ED, sermons={"s1": three_slides()})
    page.evaluate("d => { const db = fakeCloud.db(); db.slides = { formats:{ blue:{ name:'Синий', bg:d }, red:{ name:'Красный', bg:%s } }, defaultFormat:'blue' }; fakeCloud.put(db); }" % _js(RED), BLUE)
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    page.wait_for_function("[...document.querySelectorAll('.film .sl-stage')].every(s => getComputedStyle(s).getPropertyValue('--sl-bg') === bgImage(normBg(%s)))" % _js(BLUE))
    assert "Настройки слайдов" not in menu_items(page)
    page.evaluate("openSlidesCfg()")
    assert page.locator(".sheet.scfg").count() == 0
    # редактор поменял формат по умолчанию — у автора фон меняется сам
    page.evaluate("() => { const db = fakeCloud.db(); db.slides.defaultFormat = 'red'; fakeCloud.put(db); }")
    page.wait_for_function("[...document.querySelectorAll('.film .sl-stage')].every(s => getComputedStyle(s).getPropertyValue('--sl-bg') === bgImage(normBg(%s)))" % _js(RED))
    assert not page.errors, page.errors
    ctx.close()
