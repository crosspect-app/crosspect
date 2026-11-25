"""Этап 10.9.1: картинки конспекта — режим «Загрузить» у блока «Картинка»: сжатие в WebP, облако рядом с конспектом, кеш в браузере,
правки (обрезка, поворот, фильтр, обводка), картинка целиком внутри полей слайда, JPEG, PowerPoint, архив; правила и ночные скрипты."""
import json

import pytest
from pathlib import Path

from PIL import Image

from conftest import ENGINE, open_sermon

ROOT = Path(__file__).resolve().parent.parent


def img_sermon(sermon, **extra):
    s = json.loads(json.dumps(sermon))
    b = {"id": "i1", "type": "image", "name": "Картинка", "mode": "upload", "desc": "", "speech": "", "todo": True}
    b.update(extra)
    s["blocks"] = [b]
    return s


def png(tmp_path, w, h, color=(220, 30, 30), name="pic.png"):
    f = tmp_path / name
    Image.new("RGB", (w, h), color).save(f)
    return str(f)


def blk(page):
    """Блок «Картинки»; поля первой картинки (этап 10.9.2 — слой b.layers) подняты в сам блок, как было до 10.9.2."""
    b = page.evaluate("JSON.parse(JSON.stringify(blockById('i1')))")
    pic = next((l for l in b.get("layers", []) if l["kind"] == "pic"), None)
    if pic:
        b.update({k: v for k, v in pic.items() if k not in ("kind", "id")})
    return b


def open_img(page, sermon, **extra):
    open_sermon(page, img_sermon(sermon, **extra))
    page.evaluate("selectBlock('i1')")
    page.wait_for_selector(".side .pic-panel")


def upload(page, path):
    with page.expect_file_chooser() as fc:
        page.locator(".side .pic-pick, .side .pic-replace").first.click()
    fc.value.set_files(path)
    page.wait_for_function("blockById('i1') && picCount(blockById('i1')) && !picBusy.size")


def put_image(page, sermon_id, img_id, w, h, color="#dc1e1e"):
    """Картинка прямо в «облако» (как будто её загрузили раньше, с другого устройства)."""
    page.evaluate("""async ([sid, id, w, h, color]) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h);
      const bl = await new Promise(r => c.toBlob(r, 'image/webp', 0.9)), u8 = new Uint8Array(await bl.arrayBuffer());
      let s = ''; u8.forEach(x => s += String.fromCharCode(x));
      const db = fakeCloud.db(), x = db; x.slideImages = x.slideImages || {}; x.slideImages[sid] = x.slideImages[sid] || {};
      x.slideImages[sid][id] = { img:btoa(s), w, h, updatedBy:'admin@x.pl' }; fakeCloud.put(db); }""", [sermon_id, img_id, w, h, color])


# ---------- Модель ----------

def test_model_keeps_upload_fields_and_drops_bad_ones(page):
    r = page.evaluate("""() => normalize({ app:'swp-sermon', v:2, meta:{}, blocks:[
      { id:'a', type:'image', mode:'upload', imageId:'pabc', imgW:800, imgH:600, pic:{ rot:90, filter:'bw', crop:{ l:0.1, t:0, r:0, b:0.2 }, outline:{ w:6, color:'#FFFFFF' }, junk:1 } },
      { id:'b', type:'image', mode:'upload', imageId:'Bad Id', imgW:800, imgH:600, pic:{ rot:90 } },
      { id:'c', type:'image', mode:'weird', imageId:'pok', imgW:0, imgH:600 },
      { id:'d', type:'image', mode:'find', imageId:'pkeep', imgW:10, imgH:10 } ] }).blocks""")
    a, b, c, d = r
    # этап 10.9.2: картинка — первый слой списка b.layers, у самого блока полей картинки нет
    assert a["mode"] == "upload" and "imageId" not in a and len(a["layers"]) == 1
    la = a["layers"][0]
    assert la["kind"] == "pic" and la["imageId"] == "pabc" and (la["imgW"], la["imgH"]) == (800, 600)
    assert la["pic"] == {"rot": 90, "filter": "bw", "crop": {"l": 0.1, "t": 0, "r": 0, "b": 0.2}, "outline": {"w": 6, "color": "#ffffff"}}
    assert b["layers"] == []
    assert c["mode"] == "ask" and c["layers"] == []
    assert d["mode"] == "ask" and d["layers"][0]["imageId"] == "pkeep"   # переключили на «Попросить редактора» — картинка хранится, вернуть можно


# ---------- Загрузка ----------

def test_upload_shrinks_to_webp_and_puts_it_on_slide(page, sermon, tmp_path):
    open_img(page, sermon)
    assert page.locator(".side .toggle button", has_text="Загрузить").get_attribute("class").find("on") >= 0
    assert page.locator(".stage .sl-pic").count() == 0   # пока нет картинки — заглушка
    upload(page, png(tmp_path, 3200, 1600))
    b = blk(page)
    assert b["mode"] == "upload" and b["imageId"].startswith("p") and (b["imgW"], b["imgH"]) == (2560, 1280)
    assert b["todo"] is False   # картинку загрузили — слайд готов
    stored = page.evaluate("""id => { const r = fakeCloud.db().slideImages[state.id][id]; return { w:r.w, h:r.h, bytes:atob(r.img).length, webp:atob(r.img).slice(8, 12) === 'WEBP', jpeg:atob(r.img).charCodeAt(0) === 0xFF }; }""", b["imageId"])
    assert (stored["webp"] if page.evaluate("pbCanWebp()") else stored["jpeg"]) and (stored["w"], stored["h"]) == (2560, 1280) and stored["bytes"] <= 900 * 1024
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    page.wait_for_function("!!document.querySelector('.film .sl[data-id=\"i1\"] .sl-pic img[src]')")   # и в ленте
    assert not page.errors, page.errors


def test_picture_fits_inside_slide_margins(page, sermon):
    put_image(page, "fixture-0001", "pwide", 1600, 900)
    open_img(page, sermon, imageId="pwide", imgW=1600, imgH=900)
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    m = page.evaluate("slidesCfg().margins")
    x, t = 44 + m["side"], 44 + m["top"]
    w, h = 1920 - 2 * x, 1080 - t - 44 - m["bottom"]
    r = page.evaluate("(() => { const s = document.querySelector('.stage .sl-pic img').style; return [s.left, s.top, s.width, s.height].map(parseFloat); })()")
    k = min(w / 1600, h / 900)
    assert abs(r[2] - 1600 * k) <= 1 and abs(r[3] - 900 * k) <= 1
    assert abs(r[0] - (x + (w - r[2]) / 2)) <= 1 and abs(r[1] - (t + (h - r[3]) / 2)) <= 1   # по середине полей
    assert not page.errors, page.errors


def test_edits_rotate_outline_filter_crop(page, sermon):
    put_image(page, "fixture-0001", "pedit", 1600, 900, "#dc1e1e")
    open_img(page, sermon, imageId="pedit", imgW=1600, imgH=900)
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    page.locator(".side details.ph-adv summary").click()   # этап 10.9.6.3: правки под «Расширенными настройками»
    page.locator(".side .pic-right").click()
    assert blk(page)["pic"] == {"rot": 90}
    page.locator(".side .pic-filter").select_option("bw")
    page.evaluate("picFxSet('i1', picLayers(blockById('i1'))[0].id, q => { q.outline = { w:10, color:'#ffffff' }; })")
    r = page.evaluate("""async () => { const v = await picRender(picLayers(blockById('i1'))[0]), g = v.canvas.getContext('2d');
      const mid = [...g.getImageData(v.canvas.width >> 1, v.canvas.height >> 1, 1, 1).data], edge = [...g.getImageData(3, v.canvas.height >> 1, 1, 1).data];
      return { w:v.canvas.width, h:v.canvas.height, mid, edge }; }""")
    assert r["h"] > r["w"]   # повёрнуто на 90°: высокая
    assert abs(r["mid"][0] - r["mid"][1]) < 8 and abs(r["mid"][1] - r["mid"][2]) < 8   # ЧБ
    assert min(r["edge"][:3]) > 240   # белая обводка по краю
    # обрезка в окне: «Вся картинка» и своя рамка
    page.locator(".side .pic-crop").click()
    page.locator(".picc-sheet").wait_for()
    page.evaluate("PCW.crop = { l:0.25, t:0, r:0.25, b:0 }")
    page.locator(".picc-done").click()
    assert blk(page)["pic"]["crop"] == {"l": 0.25, "t": 0, "r": 0.25, "b": 0}
    page.locator(".side .pic-reset").click()
    assert "pic" not in blk(page)
    assert not page.errors, page.errors


def test_images_cached_in_browser(page, sermon, tmp_path):
    if ENGINE == "webkit":
        pytest.skip("WebKit не кладёт файлы в IndexedDB в приватном окне, а окна Playwright — приватные")
    open_img(page, sermon)
    upload(page, png(tmp_path, 800, 600))
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    assert page.evaluate("fakeCloud.calls.slideImage || 0") == 0   # только что загрузили: из облака не качали
    page.reload()
    page.wait_for_function("screen === 'sermon' && state && state.id")
    page.evaluate("selectBlock('i1')")
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    assert page.evaluate("fakeCloud.calls.slideImage || 0") == 0   # из IndexedDB
    assert not page.errors, page.errors


def test_other_device_downloads_once(page, sermon):
    put_image(page, "fixture-0001", "pother", 400, 300)
    open_img(page, sermon, imageId="pother", imgW=400, imgH=300)
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    assert page.evaluate("fakeCloud.calls.slideImage") == 1   # лента, сцена — одна загрузка
    assert not page.errors, page.errors


def test_missing_image_says_so(page, sermon):
    open_img(page, sermon, imageId="pgone", imgW=400, imgH=300)
    page.wait_for_selector(".side .pic-err")
    assert "Загрузите её заново" in page.locator(".side .pic-err").inner_text()
    assert not page.errors, page.errors


def test_view_mode_cannot_upload(page, sermon):
    open_sermon(page, img_sermon(sermon), edit=False)
    page.evaluate("selectBlock('i1')")
    page.wait_for_selector(".side .pic-panel")
    assert page.locator(".side .pic-pick").is_disabled()
    assert not page.errors, page.errors


# ---------- Выгрузка ----------

def test_jpeg_pptx_and_zip_include_picture(page, sermon):
    put_image(page, "fixture-0001", "pjpg", 1600, 900, "#dc1e1e")
    open_img(page, sermon, imageId="pjpg", imgW=1600, imgH=900, todo=False)
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    px = page.evaluate("""async () => { const bl = await renderJPEG(blockById('i1')), im = new Image(); im.src = URL.createObjectURL(bl); await im.decode();
      const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return [...g.getImageData(960, 540, 1, 1).data]; }""")
    assert px[0] > 180 and px[1] < 80 and px[2] < 80   # посередине слайда — красная картинка
    assert page.evaluate("pptxIsBlack(blockById('i1'))") is False
    assert page.evaluate("units().filter(slideDrawn).map(b => b.id)") == ["i1"]
    # без картинки — как прежде: чёрный слайд PowerPoint и в архив не входит
    page.evaluate("blockById('i1').mode = 'ask'")
    assert page.evaluate("pptxIsBlack(blockById('i1'))") is True
    assert page.evaluate("units().filter(slideDrawn).length") == 0
    assert not page.errors, page.errors


def test_switching_mode_swaps_placeholder_and_slide(page, sermon):
    put_image(page, "fixture-0001", "pswap", 400, 300)
    open_img(page, sermon, imageId="pswap", imgW=400, imgH=300)
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    page.locator(".side .toggle button", has_text="Попросить редактора").click()
    page.wait_for_selector(".stage .ph-big")
    assert page.locator(".stage .sl-pic").count() == 0
    page.locator(".side .toggle button", has_text="Загрузить").click()
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    assert not page.errors, page.errors


# ---------- Облако: правила и скрипты (сами тесты — в cloud/tests, идут в CI) ----------

def test_rules_and_scripts_cover_slide_images():
    rules = (ROOT / "cloud/firestore.rules").read_text(encoding="utf-8")
    assert "match /slideImages/{img}" in rules and "d.img.size() <= 921600" in rules
    tests = (ROOT / "cloud/tests/rules.test.mjs").read_text(encoding="utf-8")
    assert "картинки конспекта (этап 10.9.1)" in tests
    admin = (ROOT / "cloud/scripts/admin.mjs").read_text(encoding="utf-8")
    assert "collection('slideImages').listDocuments()" in admin and "orphan-hours" in admin
    assert "$file" in (ROOT / "cloud/scripts/backup.mjs").read_text(encoding="utf-8")
    assert "$file" in (ROOT / "cloud/scripts/restore.mjs").read_text(encoding="utf-8")
    api = (ROOT / "js/cloud-api.mjs").read_text(encoding="utf-8")
    assert "putSlideImage" in api and "pics.forEach(i => b.delete(imgDoc(space, id, i)))" in api
