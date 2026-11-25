"""Этап 10.9.2: «Картинка» — несколько картинок и рамок текста (слои b.layers), «Выше» / «Ниже», тень у картинок и фото цитаты,
режим «Попросить редактора» вместо «Найди сам» и «Пришлю отдельно»; JPEG и PowerPoint; уборка «сирот» видит картинки списка."""
from pathlib import Path

from conftest import open_sermon
from test_stage1091 import ROOT, blk, img_sermon, open_img, png, put_image
from test_stage10912 import drag


def layers(page):
    return page.evaluate("JSON.parse(JSON.stringify(blockById('i1').layers))")


def jpeg_px(page, pts):
    return page.evaluate("""async pts => { const bl = await renderJPEG(blockById('i1')), im = new Image(); im.src = URL.createObjectURL(bl); await im.decode();
      const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      return pts.map(([x, y]) => [...g.getImageData(x, y, 1, 1).data]); }""", pts)


def two_pics(page, sermon):
    """Красная внизу, синяя сверху, обе в одном месте посередине слайда."""
    put_image(page, "fixture-0001", "pred", 800, 600, "#dc1e1e")
    put_image(page, "fixture-0001", "pblue", 800, 600, "#1e3cdc")
    place = {"x": 0.5, "y": 0.5, "w": 0.3}
    open_img(page, sermon, todo=False, layers=[
        {"kind": "pic", "id": "a", "imageId": "pred", "imgW": 800, "imgH": 600, "place": place},
        {"kind": "pic", "id": "b", "imageId": "pblue", "imgW": 800, "imgH": 600, "place": place}])
    page.wait_for_function("document.querySelectorAll('.stage .sl-pic img[src]').length === 2")


# ---------- Модель ----------

def test_model_layers_and_modes(page):
    r = page.evaluate("""() => normalize({ app:'swp-sermon', v:2, meta:{}, blocks:[
      { id:'a', type:'image', mode:'upload', layers:[
        { kind:'pic', id:'x', imageId:'p1', imgW:800, imgH:600, shadow:140, place:{ x:0.2, y:0.3, w:0.4 } },
        { kind:'pic', id:'x', imageId:'Bad Id', imgW:800, imgH:600 },
        { kind:'text', id:'x', text:'Привет\\r\\nмир', x:5, y:0.25, w:0.001, size:9999, bold:true, color:'#FF0000', align:'weird', junk:1 },
        { kind:'pic', id:'y', imageId:'p2', imgW:400, imgH:300, shadow:0.4 },
        { kind:'video' } ] },
      { id:'b', type:'image', mode:'find', desc:'Горы' },
      { id:'c', type:'image', mode:'send', desc:'' },
      { id:'d', type:'image', mode:'send', desc:'обрезать по центру' },
      { id:'e', type:'quote', text:'Т', photo:{ id:'lewis-cs', shadow:30 } } ] }).blocks""")
    a, b, c, d, e = r
    L = a["layers"]
    assert [l["kind"] for l in L] == ["pic", "text", "pic"]   # плохая картинка и непонятный слой выброшены, порядок остался
    assert len({l["id"] for l in L}) == 3 and L[0]["id"] == "x"   # одинаковые id — новые
    assert L[0]["shadow"] == 100 and "shadow" not in L[2]   # сила тени 1…100, меньше 1 — без тени
    t = L[1]
    assert t["text"] == "Привет\nмир" and t["x"] == 1 and t["y"] == 0.25 and t["w"] == 0.04 and t["size"] == 240
    assert t["bold"] is True and t["color"] == "#ff0000" and t["align"] == "center" and "junk" not in t
    assert b["mode"] == "ask" and b["desc"] == "Горы" and b["layers"] == []
    assert c["mode"] == "ask" and c["desc"] == "Файл пришлю отдельно."   # «Пришлю отдельно» не теряется — в описании
    assert d["mode"] == "ask" and d["desc"] == "Файл пришлю отдельно. обрезать по центру"
    assert e["photo"]["shadow"] == 30
    assert page.evaluate("newBlock('image').mode") == "ask"
    assert not page.errors, page.errors


def test_mode_switch_has_two_options(page, sermon):
    open_sermon(page, img_sermon(sermon, mode="ask"))
    page.evaluate("selectBlock('i1')")
    page.wait_for_selector(".side .toggle")
    assert page.locator(".side .toggle").first.locator("button").all_text_contents() == ["Попросить редактора", "Загрузить"]
    assert page.locator(".side textarea").first.is_visible()
    assert "Слайд 1" in page.locator(".side .hint", has_text="отдельно").inner_text()
    assert not page.errors, page.errors


# ---------- Несколько картинок ----------

def test_upload_several_files_at_once(page, sermon, tmp_path):
    open_img(page, sermon)
    with page.expect_file_chooser() as fc:
        page.locator(".side .pic-pick").click()
    fc.value.set_files([png(tmp_path, 800, 600, name="a.png"), png(tmp_path, 600, 600, (30, 60, 220), name="b.png")])
    page.wait_for_function("picCount(blockById('i1')) === 2 && !picBusy.size")
    L = layers(page)
    assert "place" not in L[0]   # первая — целиком в полях, как в 10.9.1
    assert L[1]["place"]["w"] < 0.5   # вторая — меньше и поверх
    assert page.locator(".side .ly-card").count() == 2
    assert page.locator(".side .ly-card.on .ly-name").inner_text() == "Картинка 2"   # выбрана только что загруженная
    page.wait_for_function("document.querySelectorAll('.stage .sl-pic img[src]').length === 2")
    assert page.locator(".stage .pic-hit").count() == 2
    assert not page.errors, page.errors


def test_layer_order_up_down_and_jpeg(page, sermon):
    two_pics(page, sermon)
    blue = lambda p: p[2] > 180 and p[0] < 80
    red = lambda p: p[0] > 180 and p[2] < 80
    assert blue(jpeg_px(page, [[960, 540]])[0])   # синяя сверху
    # в панели сверху — верхний слой; «Ниже» у синей
    assert page.locator(".side .ly-card").first.get_attribute("data-l") == "b"
    page.locator(".side .ly-card[data-l='b'] .ly-down").click()
    assert [l["id"] for l in layers(page)] == ["b", "a"]
    assert page.evaluate("[...document.querySelectorAll('.stage .sl-pic img')].map(x => x.dataset.l)") == ["b", "a"]
    assert red(jpeg_px(page, [[960, 540]])[0])
    page.locator(".side .ly-card[data-l='b'] .ly-up").click()
    assert [l["id"] for l in layers(page)] == ["a", "b"]
    # удалить верхнюю — снова красная; слайд остаётся
    page.locator(".side .ly-card[data-l='b'] .ly-del").click()
    assert [l["id"] for l in layers(page)] == ["a"]
    assert red(jpeg_px(page, [[960, 540]])[0])
    assert not page.errors, page.errors


def test_click_on_slide_selects_layer_and_drag_moves_it(page, sermon):
    two_pics(page, sermon)
    page.evaluate("picLayers(blockById('i1'))[0].place = { x:0.25, y:0.5, w:0.2 }; picRepaintAll('i1')")
    page.wait_for_timeout(50)
    drag(page, ".stage .pic-hit[data-l='a']", 100, 0, alt=True)
    L = layers(page)
    assert abs(L[0]["place"]["x"] - (0.25 + 100 / 1920)) < 0.002 and L[1]["place"]["x"] == 0.5
    assert page.locator(".side .ly-card.on").get_attribute("data-l") == "a"
    assert page.locator(".stage .pic-hit.sel").get_attribute("data-l") == "a"
    assert not page.errors, page.errors


def test_snaps_to_edge_of_other_picture(page, sermon):
    two_pics(page, sermon)
    # синяя: левый край на 960 − 288 = 672; красная справа от неё — тянем левый край красной почти к правому краю синей
    page.evaluate("picLayers(blockById('i1'))[0].place = { x:0.8, y:0.5, w:0.1 }; picRepaintAll('i1')")
    page.wait_for_timeout(50)
    g = page.evaluate("(() => { const L = picLayers(blockById('i1')); return [picGeom(L[0]).rect, picGeom(L[1]).rect]; })()")
    target = g[1]["left"] + g[1]["width"]
    drag(page, ".stage .pic-hit[data-l='a']", target - g[0]["left"] + 4, 0)
    r = page.evaluate("picGeom(picLayers(blockById('i1'))[0]).rect")
    assert abs(r["left"] - target) < 0.6, (r, target)
    assert not page.errors, page.errors


# ---------- Текст ----------

def test_text_frame_add_edit_and_jpeg(page, sermon):
    put_image(page, "fixture-0001", "ptxt", 800, 600, "#000000")
    open_img(page, sermon, imageId="ptxt", imgW=800, imgH=600, todo=False, place={"cover": True})
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    before = jpeg_px(page, [[x, 540] for x in range(560, 1360, 8)])
    page.locator(".side .pt-add").click()
    ta = page.locator(".side textarea.pt-text")
    ta.wait_for()
    page.wait_for_function("document.activeElement.classList.contains('pt-text')")   # курсор сразу в поле текста
    ta.fill("ТЕКСТ НА СЛАЙДЕ")
    L = layers(page)
    assert L[1]["kind"] == "text" and L[1]["text"] == "ТЕКСТ НА СЛАЙДЕ"
    el = page.locator(".stage .sl-ptext")
    assert el.inner_text() == "ТЕКСТ НА СЛАЙДЕ"
    page.locator(".side .pt-bold").click()
    page.locator(".side .pt-color-btn").click()   # этап 10.9.6.6: палитра по щелчку на кружок
    page.locator(".side .pt-colors .ph-sw").nth(2).click()
    page.evaluate("const r = document.querySelector('.side .pt-size'); r.value = 120; r.dispatchEvent(new Event('input', { bubbles:true }))")
    page.locator(".side .pt-align .pt-al[data-a='left']").click()
    t = layers(page)[1]
    assert t["bold"] is True and t["size"] == 120 and t["align"] == "left" and t["color"] == page.evaluate("PHOTO_PALETTE[2]")
    st = page.evaluate("(() => { const s = getComputedStyle(document.querySelector('.stage .sl-ptext')); return [s.fontWeight, s.fontSize, s.textAlign]; })()")
    assert st == ["700", "120px", "left"]
    after = jpeg_px(page, [[x, 540] for x in range(560, 1360, 8)])
    assert sum(1 for a, b in zip(before, after) if abs(a[0] - b[0]) > 60) >= 5   # текст вшит в JPEG
    assert not page.errors, page.errors


def test_text_drag_snaps_to_slide_middle_and_resizes(page, sermon):
    open_img(page, sermon, todo=False, layers=[{"kind": "text", "id": "t", "text": "Слово", "x": 0.4, "y": 0.5, "w": 0.3, "size": 80}])
    page.wait_for_selector(".stage .pic-hit[data-l='t']")
    drag(page, ".stage .pic-hit[data-l='t']", 1920 * 0.1 - 5, 0)
    assert layers(page)[0]["x"] == 0.5   # липнет к середине слайда
    drag(page, ".stage .pic-hit[data-l='t']", 50, 0, alt=True)
    x1 = layers(page)[0]["x"]
    assert abs(x1 - (0.5 + 50 / 1920)) < 0.002   # Alt — без привязок
    w0, left0 = layers(page)[0]["w"], (x1 - 0.3 / 2)
    drag(page, ".stage .pic-hit[data-l='t'] .pic-h.c-e", 192, 0, alt=True)
    t = layers(page)[0]
    assert abs(t["w"] - (w0 + 0.1)) < 0.002 and abs((t["x"] - t["w"] / 2) - left0) < 0.002   # левый край стоит
    assert not page.errors, page.errors


def test_text_only_slide_is_drawn(page, sermon):
    open_img(page, sermon, todo=False)
    assert page.evaluate("units().filter(slideDrawn).length") == 0
    page.locator(".side .pt-add").click()
    page.wait_for_selector(".stage .sl-ptext", state="attached")
    assert page.evaluate("units().filter(slideDrawn).map(b => b.id)") == ["i1"]
    assert page.evaluate("pptxIsBlack(blockById('i1'))") is False
    assert not page.errors, page.errors


# ---------- Тень ----------

def test_shadow_slider_from_zero(page, sermon):
    put_image(page, "fixture-0001", "psh", 800, 600)
    open_img(page, sermon, imageId="psh", imgW=800, imgH=600, todo=False)
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    assert page.locator(".side .sh-on").count() == 0   # этап 10.9.6.3: без галочки
    rng = ".side .sh-range"
    assert page.eval_on_selector(rng, "r => [r.min, r.value, r.disabled]") == ["0", "0", False]
    page.evaluate("const r = document.querySelector('.side .sh-range'); r.value = 80; r.dispatchEvent(new Event('input', { bubbles:true }))")
    assert blk(page)["shadow"] == 80
    assert "drop-shadow" in page.evaluate("document.querySelector('.stage .sl-pic img').style.filter")
    page.evaluate("const r = document.querySelector('.side .sh-range'); r.value = 0; r.dispatchEvent(new Event('input', { bubbles:true }))")
    assert "shadow" not in blk(page)
    assert page.evaluate("document.querySelector('.stage .sl-pic img').style.filter") == ""
    assert not page.errors, page.errors


def test_pptx_photo_shadow_effect(page):
    x = page.evaluate("pptxPhotoXml({ photo:{ left:100, top:100, width:400, height:600, shadow:50 } })")
    assert "<a:outerShdw" in x and 'dir="5400000"' in x
    assert "outerShdw" not in page.evaluate("pptxPhotoXml({ photo:{ left:100, top:100, width:400, height:600 } })")
    assert not page.errors, page.errors


# ---------- Облако ----------

def test_orphan_cleanup_sees_pictures_in_list():
    admin = (ROOT / "cloud/scripts/admin.mjs").read_text(encoding="utf-8")
    assert "x.layers.forEach" in admin
    tests = (ROOT / "cloud/tests/scripts.test.mjs").read_text(encoding="utf-8")
    assert "inlayer2" in tests
