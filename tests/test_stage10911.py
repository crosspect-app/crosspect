"""Этап 10.9.1.1: своя заставка — картинкой. «Загрузить картинку» у «Своей заставки»: одна на все заставки конспекта (settings.customSplashImage),
на весь слайд, JPEG (первая заставка), PowerPoint (каждая), «Удалить картинку» — снова серая заглушка; облачные скрипты считают картинку занятой."""
import json
from pathlib import Path

from PIL import Image

from conftest import open_sermon
from test_stage1091 import put_image

ROOT = Path(__file__).resolve().parent.parent


def png(tmp_path, w, h, color=(220, 30, 30), name="splash.png"):
    f = tmp_path / name
    Image.new("RGB", (w, h), color).save(f)
    return str(f)


def two_splashes(sermon, **settings):
    """Конспект фикстуры с двумя заставками: первая в начале, вторая в конце."""
    s = json.loads(json.dumps(sermon))
    s.setdefault("settings", {}).update(settings)
    sp = {"type": "splash", "speech": "", "todo": False, "collapsed": False}
    s["blocks"] = [dict(sp, id="sp1")] + [b for b in s["blocks"] if b["type"] != "splash"] + [dict(sp, id="sp2")]
    return s


def open_splash(page, sermon, **settings):
    open_sermon(page, two_splashes(sermon, **settings))
    page.evaluate("selectBlock(state.blocks.find(b => b.type === 'splash').id)")
    page.wait_for_selector(".side .own-splash")


def upload(page, path):
    with page.expect_file_chooser() as fc:
        page.locator(".side .spic-pick, .side .spic-replace").first.click()
    fc.value.set_files(path)
    page.wait_for_function("!!state.settings.customSplashImage && !splashBusy")


def first_id(page):
    return page.evaluate("state.blocks.find(b => b.type === 'splash').id")


# ---------- Модель ----------

def test_model_keeps_good_splash_image_and_drops_bad(page):
    r = page.evaluate("""() => [
      normalize({ app:'swp-sermon', v:2, meta:{}, blocks:[], settings:{ customSplash:true, customSplashImage:{ imageId:'pabc', imgW:800, imgH:600, junk:1 } } }).settings,
      normalize({ app:'swp-sermon', v:2, meta:{}, blocks:[], settings:{ customSplashImage:{ imageId:'Bad Id', imgW:800, imgH:600 } } }).settings,
      normalize({ app:'swp-sermon', v:2, meta:{}, blocks:[], settings:{ customSplashImage:{ imageId:'pok', imgW:0, imgH:600 } } }).settings,
      normalize({ app:'swp-sermon', v:2, meta:{}, blocks:[], settings:{ customSplashImage:'x' } }).settings ]""")
    assert r[0]["customSplashImage"] == {"imageId": "pabc", "imgW": 800, "imgH": 600}
    assert all("customSplashImage" not in x for x in r[1:])


# ---------- Загрузка и вид ----------

def test_panel_shows_upload_only_when_custom_splash_is_on(page, sermon):
    open_splash(page, sermon)
    assert page.locator(".side .spic-panel").is_hidden()
    page.locator(".side .switch", has_text="Своя заставка").click()
    page.wait_for_selector(".side .spic-pick")
    assert page.locator(".side .spic-panel .hint").count() == 0   # пояснений нет
    page.wait_for_selector(".stage .sl.sl-custom")   # без картинки — серая заглушка, как прежде
    assert page.locator(".stage-bar button", has_text="JPEG").is_disabled()
    assert not page.errors, page.errors


def test_upload_puts_picture_on_all_splashes_full_frame(page, sermon, tmp_path):
    open_splash(page, sermon, customSplash=True)
    upload(page, png(tmp_path, 1000, 1000))   # квадрат: на весь кадр 16:9 — лишнее сверху и снизу срезается
    x = page.evaluate("state.settings.customSplashImage")
    assert x["imageId"].startswith("p") and (x["imgW"], x["imgH"]) == (1000, 1000)
    stored = page.evaluate("id => { const r = fakeCloud.db().slideImages[state.id][id]; return { bytes:atob(r.img).length, webp:atob(r.img).slice(8, 12) === 'WEBP' }; }", x["imageId"])
    assert stored["webp"] and stored["bytes"] <= 900 * 1024
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    page.wait_for_function("document.querySelectorAll('.film .sl .sl-pic img[src]').length === 2")   # в ленте — обе заставки
    r = page.evaluate("(() => { const s = document.querySelector('.stage .sl-pic img').style; return [s.left, s.top, s.width, s.height].map(parseFloat); })()")
    assert r == [0, 0, 1920, 1080]
    assert page.evaluate("getComputedStyle(document.querySelector('.stage .sl-sp-box')).display") == "none"   # названия на слайде нет
    assert page.locator(".stage-bar button", has_text="JPEG").is_enabled()
    assert page.locator(".side .spic-panel .hint").count() == 0
    assert not page.errors, page.errors


def test_cover_crops_edges_not_stretches(page, sermon):
    put_image(page, "fixture-0001", "pcov", 1000, 1000, "#dc1e1e")
    open_splash(page, sermon, customSplash=True, customSplashImage={"imageId": "pcov", "imgW": 1000, "imgH": 1000})
    r = page.evaluate("""async () => { const v = await picRender(state.blocks.find(b => b.type === 'splash')), g = v.canvas.getContext('2d');
      const at = (x, y) => [...g.getImageData(x, y, 1, 1).data]; return { w:v.canvas.width, h:v.canvas.height, corners:[at(2, 2), at(1917, 2), at(2, 1077), at(1917, 1077)] }; }""")
    assert (r["w"], r["h"]) == (1920, 1080)
    assert all(c[0] > 180 and c[1] < 80 and c[3] == 255 for c in r["corners"])   # весь кадр закрыт, без чёрных полос
    assert not page.errors, page.errors


def test_remove_picture_returns_placeholder_and_toggle_keeps_it(page, sermon):
    put_image(page, "fixture-0001", "pkeep", 800, 450)
    open_splash(page, sermon, customSplash=True, customSplashImage={"imageId": "pkeep", "imgW": 800, "imgH": 450})
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    # выключили «Свою заставку» — обычная заставка, а картинка в конспекте осталась
    page.locator(".side .switch", has_text="Своя заставка").click()
    page.wait_for_selector(".stage .sl:not(.sl-custom) .sl-sp-title")
    assert page.evaluate("getComputedStyle(document.querySelector('.stage .sl-pic img')).display") == "none"
    assert page.evaluate("getComputedStyle(document.querySelector('.stage .sl-sp-box')).display") != "none"
    assert page.evaluate("state.settings.customSplashImage.imageId") == "pkeep"
    page.locator(".side .switch", has_text="Своя заставка").click()
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    # «Удалить картинку» — серая заглушка, как раньше
    page.locator(".side .spic-del").click()
    page.wait_for_selector(".stage .sl.sl-custom")
    assert page.evaluate("state.settings.customSplashImage") is None
    assert page.locator(".side .spic-pick").count() == 1
    assert page.locator(".stage-bar button", has_text="JPEG").is_disabled()
    assert not page.errors, page.errors


def test_view_mode_cannot_upload_splash_picture(page, sermon):
    open_sermon(page, two_splashes(sermon, customSplash=True), edit=False)
    page.evaluate("selectBlock(state.blocks.find(b => b.type === 'splash').id)")
    page.wait_for_selector(".side .spic-pick")
    assert page.locator(".side .spic-pick").is_disabled()
    assert not page.errors, page.errors


def test_missing_splash_image_says_so(page, sermon):
    open_splash(page, sermon, customSplash=True, customSplashImage={"imageId": "pgone", "imgW": 800, "imgH": 450})
    page.wait_for_selector(".side .pic-err")
    assert "Загрузите её заново" in page.locator(".side .pic-err").inner_text()
    assert not page.errors, page.errors


# ---------- Выгрузка ----------

def test_jpeg_pptx_and_zip_with_splash_picture(page, sermon):
    put_image(page, "fixture-0001", "pexp", 1600, 900, "#dc1e1e")
    open_splash(page, sermon, customSplash=True, customSplashImage={"imageId": "pexp", "imgW": 1600, "imgH": 900})
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    px = page.evaluate("""async () => { const bl = await renderJPEG(state.blocks.find(b => b.type === 'splash')), im = new Image(); im.src = URL.createObjectURL(bl); await im.decode();
      const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return [[960, 540], [4, 4], [1915, 1075]].map(p => [...g.getImageData(p[0], p[1], 1, 1).data]); }""")
    assert all(p[0] > 180 and p[1] < 80 and p[2] < 80 for p in px)   # название не рисуется, картинка во весь кадр
    # PowerPoint: каждая заставка — своя картинка, не чёрный слайд и не заглушка; в заметках нет «Своя заставка»
    assert page.evaluate("state.blocks.filter(b => b.type === 'splash').map(b => pptxIsBlack(b))") == [False, False]
    assert "Своя заставка" not in page.evaluate("pptxNotes(state.blocks.find(b => b.type === 'splash'), 1, false)")
    # без картинки — как прежде: серая заглушка рисуется формой (не чёрный слайд), в архив не входит
    page.evaluate("delete state.settings.customSplashImage")
    assert page.evaluate("pptxIsBlack(state.blocks.find(b => b.type === 'splash'))") is False
    assert "Своя заставка" in page.evaluate("pptxNotes(state.blocks.find(b => b.type === 'splash'), 1, false)")
    names = page.evaluate("""async () => { const got = []; const orig = renderJPEG; window.renderJPEG = async b => { got.push(b.id); return orig(b); };
      download = () => {}; await exportMany(); window.renderJPEG = orig; return got; }""")
    assert not [i for i in names if i in ("sp1", "sp2")]
    assert not page.errors, page.errors


def test_zip_has_only_first_splash_with_picture(page, sermon):
    put_image(page, "fixture-0001", "pzip", 1600, 900, "#dc1e1e")
    open_splash(page, sermon, customSplash=True, customSplashImage={"imageId": "pzip", "imgW": 1600, "imgH": 900})
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    names = page.evaluate("""async () => { const got = []; const orig = renderJPEG; window.renderJPEG = async b => { got.push(b.id); return orig(b); };
      download = () => {}; await exportMany(); window.renderJPEG = orig; return got; }""")
    splashes = page.evaluate("state.blocks.filter(b => b.type === 'splash').map(b => b.id)")
    assert [i for i in names if i in splashes] == [splashes[0]]
    assert not page.errors, page.errors


# ---------- Облако: ссылки на картинку заставки ----------

def test_cloud_scripts_count_splash_image_as_used():
    api = (ROOT / "js/cloud-api.mjs").read_text(encoding="utf-8")
    assert "customSplashImage" in api and api.count("customSplashImage") >= 2   # remove: из конспекта и из истории
    admin = (ROOT / "cloud/scripts/admin.mjs").read_text(encoding="utf-8")
    assert "customSplashImage" in admin
    t = (ROOT / "cloud/tests/scripts.test.mjs").read_text(encoding="utf-8")
    assert "customSplashImage" in t
    r = (ROOT / "cloud/tests/rules.test.mjs").read_text(encoding="utf-8")
    assert "slideImages" in r
