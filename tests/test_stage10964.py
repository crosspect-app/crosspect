"""Этап 10.9.6.4 (25 ноября 2026): без чёрной полосы внизу экрана, карточка картинки компактнее (отражение, углы, ровные ползунки,
без «Сбросить правки» и пояснения), блок «Элементы слайда» с перетаскиванием, настройки фото цитаты — у выделенного фото."""
from test_stage1091 import put_image, open_img
from test_stage1092 import two_pics, layers, jpeg_px
from test_stage105 import open_quote, select_photo


def pic(page, sermon, **extra):
    put_image(page, "fixture-0001", "p64", 800, 600, "#dc1e1e")
    L = {"kind": "pic", "id": "a", "imageId": "p64", "imgW": 800, "imgH": 600, "place": {"x": 0.5, "y": 0.5, "w": 0.4}}
    L.update(extra)
    open_img(page, sermon, todo=False, layers=[L])
    page.wait_for_function("document.querySelectorAll('.stage .sl-pic img[src]').length === 1")
    page.locator(".stage .pic-hit").click()


def test_no_black_strip_with_long_settings(page, sermon):
    page.set_viewport_size({"width": 1897, "height": 955})
    open_quote(page, sermon, photo={"id": "lewis-cs"}, half="right")
    select_photo(page)
    page.locator(".side .ph-adv summary").click()
    page.evaluate("document.querySelector('.side').scrollTop = 99999")
    assert page.evaluate("document.documentElement.scrollHeight - innerHeight") <= 3   # страница не длиннее окна
    assert page.evaluate("getComputedStyle(document.querySelector('.ph-onoff .switch')).position") == "relative"


def test_picture_card_compact(page, sermon):
    pic(page, sermon)
    assert page.locator(".side .pic-move-hint").count() == 0 and page.locator(".side .pic-reset").count() == 0
    assert page.locator(".side .pic-left, .side .pic-right").count() == 0
    page.locator(".side .ly-card.on details.ph-adv summary").click()
    row = page.locator(".side .ly-card.on .ph-tools")
    assert row.locator(".pic-filter").count() == 1 and row.locator(".pic-crop").count() == 1 and row.locator(".pic-flip svg").count() == 1 and row.locator(".pic-flipv svg").count() == 1
    assert page.locator(".side .ly-card.on .pic-filter").bounding_box()["height"] <= 34
    # ползунки начинаются и кончаются ровно
    xs = page.evaluate("[...document.querySelectorAll('.side .ly-card.on .ph-range')].map(r => { const b = r.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)]; })")
    assert len(xs) == 3 and len({x[0] for x in xs}) == 1 and len({x[1] for x in xs}) == 1, xs
    assert not page.errors, page.errors


def test_picture_flip_and_round(page, sermon):
    pic(page, sermon)
    page.locator(".side .ly-card.on details.ph-adv summary").click()
    page.locator(".side .pic-flip").click()
    page.locator(".side .pic-flipv").click()
    page.evaluate("(() => { const r = document.querySelector('.side .pic-rd'); r.value = 30; r.dispatchEvent(new Event('input', { bubbles:true })); })()")
    p = layers(page)[0]["pic"]
    assert p == {"flipH": True, "flipV": True, "round": 0.3}
    page.locator(".side .pic-flip").click()
    assert "flipH" not in layers(page)[0]["pic"]
    # углы: в готовой картинке угол прозрачный, середина красная
    r = page.evaluate("""async () => { const v = await picRender(picLayers(blockById('i1'))[0]), g = v.canvas.getContext('2d');
      return [g.getImageData(1, 1, 1, 1).data[3], [...g.getImageData(v.canvas.width >> 1, v.canvas.height >> 1, 1, 1).data]]; }""")
    assert r[0] == 0 and r[1][0] > 200 and r[1][3] == 255
    assert page.evaluate("normalize({ app:'swp-sermon', v:2, meta:{}, blocks:[{ id:'a', type:'image', mode:'upload', layers:[{ kind:'pic', id:'x', imageId:'q', imgW:10, imgH:10, pic:{ round:9, flipH:'y', flipV:true } }] }] }).blocks[0].layers[0].pic") == {"round": 0.5, "flipV": True}
    assert not page.errors, page.errors


def test_flip_mirrors_pixels(page, sermon):
    put_image(page, "fixture-0001", "half", 800, 600, "#dc1e1e")
    open_img(page, sermon, todo=False, layers=[{"kind": "pic", "id": "a", "imageId": "half", "imgW": 800, "imgH": 600, "place": {"x": 0.5, "y": 0.5, "w": 0.4}, "pic": {"crop": {"l": 0, "t": 0, "r": 0.5, "b": 0}}}])
    page.wait_for_function("document.querySelectorAll('.stage .sl-pic img[src]').length === 1")
    probe = """async () => { const v = await picRender(picLayers(blockById('i1'))[0]), g = v.canvas.getContext('2d'); return [...g.getImageData(2, v.canvas.height >> 1, 1, 1).data]; }"""
    a = page.evaluate(probe)
    page.evaluate("picFxSet('i1', 'a', q => { q.flipH = true; })")
    b = page.evaluate(probe)
    assert a[3] == 255 and b[3] == 255   # обе стороны непрозрачны: отражается видимая часть, а не вся картинка
    assert not page.errors, page.errors


def test_layers_group_and_drag_reorder(page, sermon):
    two_pics(page, sermon)
    g = page.locator(".side .grp-layers")
    assert g.count() == 1 and g.locator(".grp-head").inner_text().strip().lower() == "элементы слайда"
    assert g.locator(".pic-add").count() == 1 and g.locator(".ly-card").count() == 2
    assert [l["id"] for l in layers(page)] == ["a", "b"]   # сверху в списке — b
    top = g.locator(".ly-card").nth(0)
    assert top.get_attribute("data-l") == "b"
    grip = top.locator(".ly-grip").bounding_box()
    low = g.locator(".ly-card").nth(1).bounding_box()
    page.mouse.move(grip["x"] + grip["width"] / 2, grip["y"] + grip["height"] / 2)
    page.mouse.down()
    page.mouse.move(grip["x"] + 5, low["y"] + low["height"] * 0.6 + 4, steps=8)
    assert "translateY" in top.evaluate("e => e.style.transform")   # едет за мышью
    page.mouse.up()
    assert [l["id"] for l in layers(page)] == ["b", "a"]
    assert page.locator(".side .grp-layers .ly-card").nth(0).get_attribute("data-l") == "a"
    page.evaluate("undo()")
    assert [l["id"] for l in layers(page)] == ["a", "b"]
    assert not page.errors, page.errors


def test_quote_photo_settings_only_when_selected(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs"}, half="right")
    page.wait_for_selector(".stage .ph-hit", state="attached")
    assert page.locator(".side .ph-adv").count() == 0 and page.locator(".side .ph-reset").count() == 0
    page.locator(".side .ph-cur").click()   # щелчок по строке фото — как по фото на слайде
    page.wait_for_selector(".side .ph-adv")
    assert page.evaluate("photoUI.sel") == "q1"
    page.keyboard.press("Escape")
    page.wait_for_function("!document.querySelector('.side .ph-adv')")
    assert page.evaluate("photoUI.sel") is None
    select_photo(page)
    page.locator(".side .ph-adv summary").click()
    assert page.locator(".side .ph-adv .ph-tools .ph-flip svg").count() == 1 and page.locator(".side .ph-adv .ph-flip").inner_text().strip() == ""
    assert not page.errors, page.errors
