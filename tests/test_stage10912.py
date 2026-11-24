"""Этап 10.9.1.2: «Картинка» (режим «Загрузить») — двигать мышью и менять размер с сохранением пропорций, привязки (Alt — без них),
«На весь слайд» и «Вписать в поля»; за краем слайда в редакторе — полупрозрачно, в выгрузке срезается; старые конспекты — как в 10.9.1."""
from test_stage1091 import blk, open_img, put_image


def ready(page):
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]') && !!document.querySelector('.stage .pic-hit')")


def rect(page):
    return page.evaluate("(() => { const s = document.querySelector('.stage .sl-pic img').style; return [s.left, s.top, s.width, s.height].map(parseFloat); })()")


def jpeg_px(page, pts):
    return page.evaluate("""async pts => { const bl = await renderJPEG(blockById('i1')), im = new Image(); im.src = URL.createObjectURL(bl); await im.decode();
      const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      return pts.map(([x, y]) => [...g.getImageData(x, y, 1, 1).data]); }""", pts)


def red(px):
    return px[0] > 180 and px[1] < 80 and px[2] < 80


def drag(page, sel, dx, dy, alt=False):
    """Тянуть элемент слоя на большом слайде; dx, dy — в px кадра 1920×1080."""
    k = page.evaluate("document.querySelector('.stage .sl').clientWidth / 1920")
    page.hover(".stage .pic-hit")
    b = page.locator(sel).first.bounding_box()
    x, y = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
    page.mouse.move(x, y)
    if alt:
        page.keyboard.down("Alt")
    page.mouse.down()
    for i in range(1, 6):
        page.mouse.move(x + dx * k * i / 5, y + dy * k * i / 5)
    page.mouse.up()
    if alt:
        page.keyboard.up("Alt")
    page.wait_for_timeout(50)


# ---------- Модель ----------

def test_model_place(page):
    r = page.evaluate("""() => normalize({ app:'swp-sermon', v:2, meta:{}, blocks:[
      { id:'a', type:'image', mode:'upload', imageId:'pa', imgW:800, imgH:600, place:{ x:0.25, y:0.5, w:0.4, junk:1 } },
      { id:'b', type:'image', mode:'upload', imageId:'pb', imgW:800, imgH:600, place:{ cover:true, x:3 } },
      { id:'c', type:'image', mode:'upload', imageId:'pc', imgW:800, imgH:600, place:{ x:2, y:0.5, w:0.4 } },
      { id:'d', type:'image', mode:'upload', imageId:'pd', imgW:800, imgH:600, place:{ x:0.5, y:0.5, w:0 } },
      { id:'e', type:'image', mode:'upload', imageId:'pe', imgW:800, imgH:600 },
      { id:'f', type:'image', mode:'upload', place:{ cover:true } } ] }).blocks""")
    a, b, c, d, e, f = [x["layers"][0] if x["layers"] else {} for x in r]   # этап 10.9.2: картинка — слой списка
    assert a["place"] == {"x": 0.25, "y": 0.5, "w": 0.4}
    assert b["place"] == {"cover": True}
    assert "place" not in c and "place" not in d and "place" not in e   # плохие и старые — в полях, как в 10.9.1
    assert f == {}   # без картинки слоя нет
    assert not page.errors, page.errors


# ---------- Кнопки ----------

def test_cover_and_fit_buttons(page, sermon):
    put_image(page, "fixture-0001", "pcov", 1600, 1200)
    open_img(page, sermon, imageId="pcov", imgW=1600, imgH=1200, todo=False)
    ready(page)
    fit = rect(page)
    assert page.locator(".side .pic-fit").get_attribute("aria-pressed") == "true"
    page.locator(".side .pic-cover").click()
    assert blk(page)["place"] == {"cover": True}
    assert page.locator(".side .pic-cover").get_attribute("aria-pressed") == "true"
    r = rect(page)
    assert r[0] <= 0.5 and r[1] <= 0.5 and r[0] + r[2] >= 1919.5 and r[1] + r[3] >= 1079.5   # закрывает кадр
    assert abs(r[2] / r[3] - 1600 / 1200) < 0.01   # пропорции те же: лишнее срезается, не растягивается
    page.wait_for_function("(() => { const s = document.querySelector('.stage .sl-pic img').style; return parseFloat(s.width) > 1919; })()")
    px = jpeg_px(page, [[2, 2], [1917, 2], [2, 1077], [1917, 1077], [960, 540]])
    assert all(red(p) for p in px), px   # в JPEG картинка до самых краёв
    # поворот: всё равно закрывает кадр
    page.evaluate("picFxSet('i1', picLayers(blockById('i1'))[0].id, q => { q.rot = 30; })")
    G = page.evaluate("(() => { const G = picGeom(picLayers(blockById('i1'))[0]); return [G.cx, G.cy, G.iw, G.ih, G.th]; })()")
    import math
    cx, cy, iw, ih, th = G
    for x, y in [(0, 0), (1920, 0), (0, 1080), (1920, 1080)]:   # углы кадра — внутри повёрнутой картинки
        lx = (x - cx) * math.cos(th) + (y - cy) * math.sin(th)
        ly = -(x - cx) * math.sin(th) + (y - cy) * math.cos(th)
        assert abs(lx) <= iw / 2 + 0.5 and abs(ly) <= ih / 2 + 0.5
    page.evaluate("picFxSet('i1', picLayers(blockById('i1'))[0].id, q => { q.rot = 0; })")
    page.locator(".side .pic-fit").click()
    assert "place" not in blk(page)
    assert [round(v) for v in rect(page)] == [round(v) for v in fit]   # снова как в 10.9.1
    assert not page.errors, page.errors


# ---------- Мышь ----------

def test_move_with_snap_and_alt(page, sermon):
    put_image(page, "fixture-0001", "pmov", 800, 600)
    open_img(page, sermon, imageId="pmov", imgW=800, imgH=600)
    ready(page)
    r0 = rect(page)
    drag(page, ".stage .pic-hit", -300, 0, alt=True)
    p = blk(page)["place"]
    assert abs(p["x"] * 1920 - (r0[0] + r0[2] / 2 - 300)) <= 2 and abs(p["y"] * 1080 - (r0[1] + r0[3] / 2)) <= 2
    r1 = rect(page)
    assert abs(r1[2] - r0[2]) < 0.5 and abs(r1[3] - r0[3]) < 0.5   # размер тот же
    assert r1[0] < r0[0] - 250
    # почти к середине — липнет к середине слайда
    page.evaluate("picLayers(blockById('i1'))[0].place = { x:0.4, y:0.5, w:picLayers(blockById('i1'))[0].place.w }; picRepaintAll('i1')")
    drag(page, ".stage .pic-hit", 1920 * 0.1 - 5, 0)
    assert blk(page)["place"]["x"] == 0.5
    # с Alt — без привязки
    page.evaluate("picLayers(blockById('i1'))[0].place = { x:0.4, y:0.5, w:picLayers(blockById('i1'))[0].place.w }; picRepaintAll('i1')")
    drag(page, ".stage .pic-hit", 1920 * 0.1 - 5, 0, alt=True)
    assert abs(blk(page)["place"]["x"] - (0.5 - 5 / 1920)) < 0.002
    assert not page.errors, page.errors


def test_corner_resize_keeps_ratio_and_opposite_corner(page, sermon):
    put_image(page, "fixture-0001", "pres", 800, 600)
    open_img(page, sermon, imageId="pres", imgW=800, imgH=600)
    ready(page)
    r0 = rect(page)
    drag(page, ".stage .pic-h.c-se", -200, -150, alt=True)
    r1 = rect(page)
    assert abs(r1[0] - r0[0]) < 1.5 and abs(r1[1] - r0[1]) < 1.5   # левый верхний угол на месте
    assert abs(r1[2] / r1[3] - 800 / 600) < 0.01   # пропорции
    assert r1[2] < r0[2] - 150
    # край: «e» тянет вправо, левый край на месте, по высоте — от середины
    drag(page, ".stage .pic-h.c-e", 100, 0, alt=True)
    r2 = rect(page)
    assert abs(r2[0] - r1[0]) < 1.5 and r2[2] > r1[2] + 80
    assert abs((r2[1] + r2[3] / 2) - (r1[1] + r1[3] / 2)) < 1.5
    assert abs(r2[2] / r2[3] - 800 / 600) < 0.01
    page.wait_for_function("!!picVars.get(picKey(picLayers(blockById('i1'))[0])) && !!picVars.get(picKey(picLayers(blockById('i1'))[0])).ready")   # после отпускания — новая картинка
    assert not page.errors, page.errors


def test_resize_snaps_edge_to_margin(page, sermon):
    put_image(page, "fixture-0001", "psnap", 800, 600)
    open_img(page, sermon, imageId="psnap", imgW=800, imgH=600)
    ready(page)
    page.evaluate("picLayers(blockById('i1'))[0].place = { x:0.3, y:0.5, w:0.2 }; picRepaintAll('i1')")
    page.wait_for_timeout(50)
    r0 = rect(page)
    mx = page.evaluate("tbMargins().x")
    target = 1920 - mx   # правое поле
    drag(page, ".stage .pic-h.c-e", target - (r0[0] + r0[2]) - 4, 0)
    r1 = rect(page)
    assert abs(r1[0] + r1[2] - target) < 0.6
    assert not page.errors, page.errors


# ---------- За краем слайда ----------

def test_off_slide_ghost_and_cropped_export(page, sermon):
    put_image(page, "fixture-0001", "poff", 800, 600, "#dc1e1e")
    open_img(page, sermon, imageId="poff", imgW=800, imgH=600, todo=False, place={"x": 0, "y": 0.5, "w": 0.5})   # середина на левом краю: половина за слайдом
    ready(page)
    r = rect(page)
    assert r[0] < -400
    g = page.evaluate("(() => { const im = document.querySelector('.stage .pic-ghost img'); return { src:!!im.getAttribute('src'), left:parseFloat(im.style.left), op:getComputedStyle(im).opacity }; })()")
    assert g["src"] and g["left"] < 0 and float(g["op"]) < 0.5   # часть за краем — полупрозрачная
    page.wait_for_function("(() => { const v = picVars.get(picKey(picLayers(blockById('i1'))[0])); return v && v.ready; })()")
    px = jpeg_px(page, [[2, 540], [400, 540], [800, 540]])
    assert red(px[0]) and red(px[1]) and not red(px[2]), px   # в выгрузке срезано по краю кадра
    assert page.evaluate("pptxIsBlack(blockById('i1'))") is False
    assert not page.errors, page.errors


def test_view_mode_has_no_mouse_layer(page, sermon):
    from conftest import open_sermon
    from test_stage1091 import img_sermon
    put_image(page, "fixture-0001", "pview", 800, 600)
    open_sermon(page, img_sermon(sermon, imageId="pview", imgW=800, imgH=600, place={"cover": True}), edit=False)
    page.evaluate("selectBlock('i1')")
    page.wait_for_function("!!document.querySelector('.stage .sl-pic img[src]')")
    assert page.locator(".stage .pic-hit").count() == 0
    r = rect(page)
    assert r[2] >= 1919.5
    assert not page.errors, page.errors
