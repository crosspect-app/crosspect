"""Этап 10.9.2.1: режимы заставки «Обычная» / «Свой фон» / «Картинка целиком» (settings.splashMode) и «Затемнение» (settings.splashDim, 0–70 %).
Модель и перевод старой «Своей заставки», панель, «Свой фон» (картинка вместо фона, название поверх, затемнение, без картинки — обычная),
JPEG, PowerPoint и архив."""
import json

from conftest import open_sermon
from test_stage1091 import put_image
from test_stage10911 import open_splash, two_splashes, upload, png

IMG = {"imageId": "pbg", "imgW": 1600, "imgH": 900}


def bg_splash(page, sermon, dim=None, image=True, mode="bg"):
    st = {"splashMode": mode}
    if dim is not None:
        st["splashDim"] = dim
    if image:
        put_image(page, "fixture-0001", "pbg", 1600, 900, "#dc1e1e")
        st["customSplashImage"] = IMG
    open_splash(page, sermon, **st)
    if image:
        page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")


def pixels(page, pts):
    return page.evaluate("""async pts => { const bl = await renderJPEG(state.blocks.find(b => b.type === 'splash')), im = new Image(); im.src = URL.createObjectURL(bl); await im.decode();
      const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      return pts.map(p => [...g.getImageData(p[0], p[1], 1, 1).data]); }""", pts)


# ---------- Модель ----------

def test_model_modes_dim_and_legacy_custom_splash(page):
    r = page.evaluate("""() => {
      const n = s => normalize({ app:'swp-sermon', v:2, meta:{}, blocks:[], settings:s }).settings;
      return [n({ customSplash:true }), n({}), n({ splashMode:'bg', splashDim:40 }), n({ splashMode:'full', customSplash:true }),
              n({ splashMode:'zzz' }), n({ splashMode:'bg', splashDim:71 }), n({ splashMode:'bg', splashDim:-1 }), n({ splashMode:'bg', splashDim:'40' }),
              n({ splashMode:'bg', splashDim:0 }),
              normalize({ app:'swp-sermon', v:2, meta:{}, blocks:[{ id:'s', type:'splash', custom:true }] }).settings ]; }""")
    assert r[0]["splashMode"] == "full" and "customSplash" not in r[0]   # старая «Своя заставка» — «Картинка целиком»
    assert "splashMode" not in r[1]
    assert (r[2]["splashMode"], r[2]["splashDim"]) == ("bg", 40)
    assert r[3]["splashMode"] == "full"
    assert "splashMode" not in r[4]
    assert all("splashDim" not in x for x in (r[5], r[6], r[7]))   # вне 0–70 и не число — отбрасывается
    assert r[8]["splashDim"] == 0
    assert r[9]["splashMode"] == "full"   # самое старое поле у заставки


def test_dim_defaults_when_not_set(page, sermon):
    open_sermon(page, sermon)
    assert page.evaluate("splashDim()") == 30
    page.evaluate("state.settings.splashDim = 0")
    assert page.evaluate("splashDim()") == 0


# ---------- Панель ----------

def test_panel_modes_and_dim_slider_only_in_bg(page, sermon):
    open_splash(page, sermon)
    assert page.locator(".side .spic-panel").is_hidden()
    page.locator(".side .splash-mode .sm-bg").click()
    page.wait_for_selector(".side .spic-pick")
    assert page.locator(".side .spic-dim").count() == 1
    assert page.locator(".side .splash-mode button.on").inner_text() == "Свой фон"
    assert page.evaluate("state.settings.splashMode") == "bg"
    page.locator(".side .splash-mode .sm-full").click()
    page.wait_for_selector(".side .spic-pick")
    assert page.locator(".side .spic-dim").count() == 0   # затемнение — только у «Свой фон»
    page.locator(".side .splash-mode .sm-normal").click()
    assert page.locator(".side .spic-panel").is_hidden()
    assert not page.evaluate("state.settings.splashMode")
    assert not page.errors, page.errors


def test_bg_without_picture_is_plain_splash(page, sermon):
    open_splash(page, sermon, splashMode="bg")
    page.wait_for_selector(".stage .sl .sl-sp-title")
    assert page.evaluate("document.querySelector('.stage .sl-stage').classList.contains('sl-bgsplash')") is False
    assert page.locator(".stage .sl.sl-custom").count() == 0
    assert page.evaluate("getComputedStyle(document.querySelector('.stage .sl-panel')).display") != "none"   # фон обычный
    assert page.locator(".stage-bar button", has_text="JPEG").is_enabled()
    assert page.locator(".side .spic-pick").count() == 1
    assert not page.errors, page.errors


def test_upload_in_bg_mode_and_dim_slider_writes_settings(page, sermon, tmp_path):
    open_splash(page, sermon, splashMode="bg")
    upload(page, png(tmp_path, 1600, 900))
    page.wait_for_function("document.querySelector('.stage .sl-stage').classList.contains('sl-bgsplash')")
    sl = ".stage .sl-stage"
    assert page.evaluate("getComputedStyle(document.querySelector('%s')).getPropertyValue('--sp-dim')" % sl).strip() == "0.3"   # по умолчанию 30 %
    page.locator(".side .spic-dim").evaluate("e => { e.value = 55; e.dispatchEvent(new Event('input', { bubbles:true })); }")
    assert page.evaluate("state.settings.splashDim") == 55
    assert page.locator(".side .spic-dim-val").inner_text() == "55 %"
    page.wait_for_function("getComputedStyle(document.querySelector('.stage .sl-stage')).getPropertyValue('--sp-dim').trim() === '0.55'")
    page.wait_for_function("[...document.querySelectorAll('.film .sl .sl-stage')].filter(s => s.classList.contains('sl-bgsplash')).length === 2")   # обе заставки
    assert not page.errors, page.errors


def test_remove_picture_in_bg_returns_plain_splash_and_modes_keep_picture(page, sermon):
    bg_splash(page, sermon, dim=40)
    page.locator(".side .splash-mode .sm-normal").click()
    page.wait_for_function("!document.querySelector('.stage .sl-stage').classList.contains('sl-bgsplash')")
    assert page.evaluate("getComputedStyle(document.querySelector('.stage .sl-pic img')).display") == "none"
    assert page.evaluate("state.settings.customSplashImage.imageId") == "pbg"   # картинка осталась в конспекте
    page.locator(".side .splash-mode .sm-bg").click()
    page.wait_for_function("document.querySelector('.stage .sl-stage').classList.contains('sl-bgsplash')")
    page.locator(".side .spic-del").click()
    page.wait_for_function("!document.querySelector('.stage .sl-stage').classList.contains('sl-bgsplash')")
    assert page.evaluate("state.settings.customSplashImage") is None
    assert page.evaluate("state.settings.splashMode") == "bg"   # режим помнится, картинки нет — обычная заставка
    assert not page.errors, page.errors


# ---------- Вид ----------

def test_bg_stage_shows_picture_under_title_without_panel_and_frame(page, sermon):
    bg_splash(page, sermon, dim=40)
    st = ".stage .sl-stage"
    d = lambda s: page.evaluate("getComputedStyle(document.querySelector('%s')).display" % s)
    assert d(st + " .sl-frame") == "none" and d(st + " .sl-panel") == "none"   # рамки и панели нет
    assert d(st + " .sl-sp-box") != "none"   # название поверх картинки
    assert page.locator(".stage .sl-sp-title").inner_text() != ""
    r = page.evaluate("(() => { const s = document.querySelector('.stage .sl-pic img').style; return [s.left, s.top, s.width, s.height].map(parseFloat); })()")
    assert r == [0, 0, 1920, 1080]
    assert page.evaluate("getComputedStyle(document.querySelector('.stage .sl-stage')).getPropertyValue('--sp-dim').trim()") == "0.4"
    assert page.locator(".stage-bar button", has_text="JPEG").is_enabled()
    assert page.evaluate("pptxIsBlack(state.blocks.find(b => b.type === 'splash'))") is False
    assert page.evaluate("picOn(state.blocks.find(b => b.type === 'splash'))") is False   # слайд остаётся текстовым
    assert not page.errors, page.errors


def test_bg_foot_and_title_size_still_work(page, sermon):
    bg_splash(page, sermon)
    page.evaluate("state.settings.splashFoot = true; refreshSplash()")
    page.wait_for_function("getComputedStyle(document.querySelector('.stage .sl-sp-foot')).display !== 'none'")
    page.evaluate("state.settings.splashFoot = false; refreshSplash()")
    page.wait_for_function("getComputedStyle(document.querySelector('.stage .sl-sp-foot')).display === 'none'")
    assert not page.errors, page.errors


# ---------- Выгрузка ----------

def test_jpeg_dims_picture_and_keeps_title(page, sermon):
    bg_splash(page, sermon, dim=0)
    p0 = pixels(page, [[4, 4], [1915, 1075]])
    assert all(p[0] > 180 and p[1] < 80 and p[2] < 80 for p in p0)   # без затемнения — красная картинка до краёв, рамки нет
    page.evaluate("state.settings.splashDim = 50; refreshSplash()")
    page.wait_for_function("getComputedStyle(document.querySelector('.stage .sl-stage')).getPropertyValue('--sp-dim').trim() === '0.5'")
    p50 = pixels(page, [[4, 4], [1915, 1075]])
    assert all(0.4 < b[0] / a[0] < 0.6 for a, b in zip(p0, p50)), (p0, p50)   # затемнение 50 % — красный вдвое темнее
    page.evaluate("state.settings.splashDim = 70; refreshSplash()")
    page.wait_for_function("getComputedStyle(document.querySelector('.stage .sl-stage')).getPropertyValue('--sp-dim').trim() === '0.7'")
    p70 = pixels(page, [[4, 4]])
    assert 0.2 < p70[0][0] / p0[0][0] < 0.4
    # название поверх: в области названия есть светлые пиксели
    light = page.evaluate("""async () => { const bl = await renderJPEG(state.blocks.find(b => b.type === 'splash')), im = new Image(); im.src = URL.createObjectURL(bl); await im.decode();
      const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 200, 1920, 600).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) n++; return n; }""")
    assert light > 500
    assert not page.errors, page.errors


def test_pptx_and_zip_with_bg_splash(page, sermon):
    import pytest, zipfile
    pptx = pytest.importorskip("pptx")
    from test_stage95 import download
    bg_splash(page, sermon, dim=40)
    prs = pptx.Presentation(download(page, "exportPPTX()").path())
    types = page.evaluate("state.blocks.filter(b => TYPES[b.type].slide).map(b => b.type)")
    slides = list(prs.slides)
    for i in [i for i, t in enumerate(types) if t == "splash"]:   # каждая заставка — картинка, не чёрный слайд и не заглушка
        assert any(sh.shape_type == 13 for sh in slides[i].shapes)
    z = zipfile.ZipFile(download(page, "exportMany()").path())
    assert len([n for n in z.namelist() if n.endswith(".jpg") and "Заставка" in n]) == 1   # одна, первая
    assert not page.errors, page.errors


def test_old_custom_splash_with_picture_opens_as_full_picture(page, sermon):
    put_image(page, "fixture-0001", "pold", 1600, 900, "#dc1e1e")
    open_splash(page, sermon, customSplash=True, customSplashImage={"imageId": "pold", "imgW": 1600, "imgH": 900})
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    assert page.evaluate("state.settings.splashMode") == "full"
    assert page.locator(".side .splash-mode button.on").inner_text() == "Картинка целиком"
    assert page.evaluate("getComputedStyle(document.querySelector('.stage .sl-sp-box')).display") == "none"   # название не рисуется
    assert page.locator(".side .spic-dim").count() == 0
    p = pixels(page, [[960, 540], [4, 4]])
    assert all(x[0] > 180 and x[1] < 80 and x[2] < 80 for x in p)   # без затемнения
    assert not page.errors, page.errors
