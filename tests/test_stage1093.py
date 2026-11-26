"""Этап 10.9.3: фон заставки у серии проповедей. У серии — splash { mode, imageId, imgW, imgH, dim }, картинка — seriesImages пространства.
Порядок фона заставки: свой у конспекта (режим и своя картинка) → у серии → как раньше. Окно «Серии проповедей»: загрузить, заменить,
удалить, режим и затемнение; лишние картинки стираются при «Сохранить», «Отменить» и удалении серии."""
from conftest import open_sermon
from test_stage1091 import put_image
from test_stage10911 import png, two_splashes
from test_stage10 import open_space
from test_series_table import edit, save

SER = "s1"


def put_series_image(page, img_id, w, h, color):
    page.evaluate("""async ([id, w, h, color]) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h);
      const bl = await new Promise(r => c.toBlob(r, 'image/webp', 0.9)), u8 = new Uint8Array(await bl.arrayBuffer());
      let s = ''; u8.forEach(x => s += String.fromCharCode(x));
      const db = fakeCloud.db(); db.seriesImages = db.seriesImages || {}; db.seriesImages[id] = { img:btoa(s), w, h, updatedBy:'admin@x.pl' }; fakeCloud.put(db); }""",
                  [img_id, w, h, color])


def set_series(page, splash=None):
    page.evaluate("""sp => { const db = fakeCloud.db(); db.series = { s1:Object.assign({ name:'Псалмы', active:true, format:'' }, sp ? { splash:sp } : {}) }; fakeCloud.put(db); }""", splash)


def series_splash(page, mode="bg", dim=0, color="#dc1e1e"):
    put_series_image(page, "sser1", 1600, 900, color)
    set_series(page, {"mode": mode, "imageId": "sser1", "imgW": 1600, "imgH": 900, "dim": dim})


def open_in_series(page, sermon, **settings):
    s = two_splashes(sermon, **settings)
    s["meta"]["series"] = SER
    open_sermon(page, s)
    page.evaluate("selectBlock(state.blocks.find(b => b.type === 'splash').id)")
    page.wait_for_selector(".side .own-splash")


def pixel(page):
    return page.evaluate("""async () => { const bl = await renderJPEG(state.blocks.find(b => b.type === 'splash')), im = new Image(); im.src = URL.createObjectURL(bl); await im.decode();
      const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      return [...g.getImageData(60, 60, 1, 1).data]; }""")


def is_red(p):
    return p[0] > 170 and p[1] < 80 and p[2] < 80


def is_blue(p):
    return p[2] > 170 and p[0] < 80 and p[1] < 80


# ---------- Модель ----------

def test_series_keeps_good_splash_and_drops_bad(page):
    r = page.evaluate("""() => normSeries({
      a:{ name:'А', splash:{ mode:'full', imageId:'sabc', imgW:800, imgH:600, dim:40, junk:1 } },
      b:{ name:'Б', splash:{ imageId:'sabc', imgW:800, imgH:600 } },
      c:{ name:'В', splash:{ mode:'bg', imageId:'Bad Id', imgW:800, imgH:600 } },
      d:{ name:'Г', splash:{ mode:'bg', imageId:'sok', imgW:0, imgH:600 } },
      e:{ name:'Д', splash:{ mode:'bg', imageId:'sok', imgW:10, imgH:10, dim:99 } } })""")
    assert r["a"]["splash"] == {"mode": "full", "imageId": "sabc", "imgW": 800, "imgH": 600, "dim": 40}
    assert r["b"]["splash"] == {"mode": "bg", "imageId": "sabc", "imgW": 800, "imgH": 600, "dim": 30}   # нет режима — «Свой фон», затемнение по умолчанию
    assert "splash" not in r["c"] and "splash" not in r["d"]
    assert r["e"]["splash"]["dim"] == 30


# ---------- Заставка конспекта ----------

def test_sermon_in_series_uses_series_background(page, sermon):
    series_splash(page)
    open_in_series(page, sermon)
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    assert page.evaluate("splashEff().from") == "series"
    assert page.evaluate("document.querySelector('.stage .sl-stage').classList.contains('sl-bgsplash')")
    page.wait_for_selector(".stage .sl .sl-sp-title")   # название поверх картинки
    assert is_red(pixel(page))
    assert page.evaluate("fakeCloud.calls.seriesImage") >= 1 and not page.evaluate("fakeCloud.calls.slideImage || 0")
    # в панели заставки — откуда фон; свой режим конспекта по-прежнему «Обычная»
    assert "серии «Псалмы»" in page.locator(".side .spic-series").inner_text()
    assert page.locator(".side .splash-mode button.on").inner_text() == "Текущий фон"
    assert not page.errors, page.errors


def test_series_full_picture_and_pptx(page, sermon):
    series_splash(page, mode="full")
    open_in_series(page, sermon)
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    assert page.evaluate("isCustomSplash(state.blocks.find(b => b.type === 'splash')) && picOn(state.blocks.find(b => b.type === 'splash'))")
    assert is_red(pixel(page))
    assert page.locator(".stage-bar .jpg-btn").is_enabled()


def test_own_picture_wins_over_series(page, sermon):
    series_splash(page)
    put_image(page, "fixture-0001", "pown", 1600, 900, "#1e1edc")
    open_in_series(page, sermon, splashMode="bg", splashDim=0, customSplashImage={"imageId": "pown", "imgW": 1600, "imgH": 900})
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    assert page.evaluate("splashEff().from") == "own"
    assert is_blue(pixel(page))
    assert page.locator(".side .spic-series").count() == 0


def test_own_mode_without_picture_falls_back_to_series(page, sermon):
    series_splash(page)
    open_in_series(page, sermon, splashMode="full")   # «Картинка целиком» без своей картинки
    assert page.evaluate("splashEff().from") == "series"
    assert page.locator(".side .spic-series").count() == 1


def test_no_series_or_series_without_picture_is_plain(page, sermon):
    set_series(page)
    open_in_series(page, sermon)
    page.wait_for_selector(".stage .sl .sl-sp-title")
    assert page.evaluate("splashEff().from") == ""
    assert not page.evaluate("document.querySelector('.stage .sl-stage').classList.contains('sl-bgsplash')")
    assert page.locator(".side .spic-panel").is_hidden()


def test_series_picture_removed_returns_plain_splash(page, sermon):
    series_splash(page)
    open_in_series(page, sermon)
    page.wait_for_function("document.querySelector('.stage .sl-stage').classList.contains('sl-bgsplash')")
    set_series(page)   # другой человек убрал фон у серии: пришло из облака
    page.wait_for_function("!document.querySelector('.stage .sl-stage').classList.contains('sl-bgsplash')")
    page.wait_for_function("!document.querySelector('.side .spic-series')")
    assert page.evaluate("splashEff().from") == ""
    assert not page.errors, page.errors


def test_changing_series_in_meta_switches_splash(page, sermon):
    series_splash(page)
    s = two_splashes(sermon)
    open_sermon(page, s)
    page.evaluate("selectBlock(state.blocks.find(b => b.type === 'splash').id)")
    assert page.evaluate("splashEff().from") == ""
    page.evaluate("state.meta.series = 's1'; refreshSlides(); refreshSplashAll()")
    page.wait_for_function("document.querySelector('.stage .sl-stage').classList.contains('sl-bgsplash')")
    page.wait_for_selector(".side .spic-series")


# ---------- Окно «Серии проповедей» ----------

def open_series_edit(page):
    open_space(page, "Серии проповедей")
    page.wait_for_selector(".sp-series .sp-row[data-id='s1']")
    edit(page)
    page.locator(".sp-row[data-id='s1'] .sp-spl-btn").click()
    page.wait_for_selector(".sp-spl-edit")


def upload_series(page, path):
    with page.expect_file_chooser() as fc:
        page.locator(".sp-spl-edit .sp-spl-pick, .sp-spl-edit .sp-spl-replace").first.click()
    fc.value.set_files(path)
    page.wait_for_function("SPW.edit && !SPW.edit.busy && SPW.edit.draft.s1.splash && SPW.edit.uploaded.size")


def test_series_table_upload_mode_dim_save(page, tmp_path):
    set_series(page)
    page.wait_for_function("SERIES.s1 && !SERIES.s1.splash")
    open_series_edit(page)
    upload_series(page, png(tmp_path, 1600, 900))
    img = page.evaluate("SPW.edit.draft.s1.splash.imageId")
    assert img.startswith("s") and page.evaluate("id => !!fakeCloud.db().seriesImages[id]", img)   # картинка в облаке сразу
    assert "splash" not in page.evaluate("fakeCloud.db().series.s1")   # в серии — только после «Сохранить»
    assert page.locator(".sp-spl-dim").count() == 1
    page.locator(".sp-spl-mode button", has_text="Картинка целиком").click()
    assert page.locator(".sp-spl-dim").count() == 0   # затемнение — только у «Свой фон»
    page.locator(".sp-spl-mode button", has_text="Свой фон").click()
    page.locator(".sp-spl-dim").fill("45")
    save(page)
    page.wait_for_function("fakeCloud.db().series.s1.splash")
    sp = page.evaluate("fakeCloud.db().series.s1.splash")
    assert sp == {"mode": "bg", "imageId": img, "imgW": 1600, "imgH": 900, "dim": 45}
    assert "Свой фон, 45 %" in page.locator(".sp-row[data-id='s1'] .sp-spl").inner_text()
    assert page.evaluate("SERIES.s1.splash.imageId") == img
    assert not page.errors, page.errors


def test_series_table_replace_and_remove_clean_up(page, tmp_path):
    series_splash(page)
    page.wait_for_function("SERIES.s1 && SERIES.s1.splash")
    open_series_edit(page)
    upload_series(page, png(tmp_path, 1200, 800, (30, 30, 220)))
    new = page.evaluate("SPW.edit.draft.s1.splash.imageId")
    assert new != "sser1"
    save(page)
    page.wait_for_function("id => fakeCloud.db().series.s1.splash.imageId === id", arg=new)
    page.wait_for_function("!fakeCloud.db().seriesImages.sser1")   # прежняя картинка стёрта
    edit(page)
    page.locator(".sp-row[data-id='s1'] .sp-spl-btn").click()
    page.locator(".sp-spl-del").click()
    save(page)
    page.wait_for_function("!fakeCloud.db().series.s1.splash")
    page.wait_for_function("id => !fakeCloud.db().seriesImages[id]", arg=new)
    assert "Обычный" in page.locator(".sp-row[data-id='s1'] .sp-spl").inner_text()


def test_series_table_cancel_removes_uploaded(page, tmp_path):
    set_series(page)
    page.wait_for_function("SERIES.s1")
    open_series_edit(page)
    upload_series(page, png(tmp_path, 800, 600))
    img = page.evaluate("SPW.edit.draft.s1.splash.imageId")
    page.once("dialog", lambda d: d.accept())   # «Изменения не сохранены. Выйти?»
    page.locator(".sp-foot .btn.ghost", has_text="Отменить").click()
    page.wait_for_selector(".sp-table.editing", state="detached")
    page.wait_for_function("id => !fakeCloud.db().seriesImages[id]", arg=img)
    assert "splash" not in page.evaluate("fakeCloud.db().series.s1")


def test_deleting_series_deletes_its_picture(page):
    series_splash(page)
    page.wait_for_function("SERIES.s1 && SERIES.s1.splash")
    open_space(page, "Серии проповедей")
    page.wait_for_function("seriesUse() && SPW.series && SPW.series.s1")
    edit(page)
    page.locator(".sp-row[data-id='s1'] [aria-label='Удалить серию'], .sp-row[data-id='s1'] [title='Удалить серию']").first.click()
    save(page)
    page.wait_for_function("!fakeCloud.db().series.s1")
    page.wait_for_function("!fakeCloud.db().seriesImages.sser1")


# ---------- Облако: правила и скрипты ----------

def test_rules_and_scripts_know_series_images():
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent
    rules = (root / "cloud/firestore.rules").read_text(encoding="utf-8")
    assert "match /seriesImages/{img}" in rules
    admin = (root / "cloud/scripts/admin.mjs").read_text(encoding="utf-8")
    assert "seriesImages" in admin
    api = (root / "js/cloud-api.mjs").read_text(encoding="utf-8")
    assert "putSeriesImage" in api and "serImgDoc(space, x.imageId)" in api
