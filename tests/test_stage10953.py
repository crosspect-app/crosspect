"""Поправки к этапам А и Б (25 ноября 2026): поворот картинки — ручка возле рамки, как в Канве, и прежняя картинка поворачивается сразу;
пипетка и любой цвет у обводки и цвета текста."""
from test_stage1091 import put_image, open_img
from test_stage1092 import two_pics, layers
from test_stage10952 import text_page

FAKE_DROPPER = "() => { window.EyeDropper = class { open(){ return Promise.resolve({ sRGBHex:'#12AB34' }); } }; }"


def one_pic(page, sermon, **extra):
    put_image(page, "fixture-0001", "prot", 800, 600, "#dc1e1e")
    lay = {"kind": "pic", "id": "a", "imageId": "prot", "imgW": 800, "imgH": 600, "place": {"x": 0.5, "y": 0.45, "w": 0.3}}
    lay.update(extra)
    open_img(page, sermon, todo=False, layers=[lay])
    page.wait_for_function("document.querySelectorAll('.stage .sl-pic img[src]').length === 1")


def test_rotate_handle_turns_picture(page, sermon):
    one_pic(page, sermon)
    page.locator(".stage .pic-hit").click()
    hd = page.locator(".stage .pic-hit .c-rot")
    assert hd.count() == 1 and hd.is_visible()
    hb, fb = hd.bounding_box(), page.locator(".stage .pic-hit").bounding_box()
    cx, cy = fb["x"] + fb["width"] / 2, fb["y"] + fb["height"] / 2
    assert hb["y"] > fb["y"] + fb["height"]   # ручка под рамкой
    page.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2)
    page.mouse.down()
    page.mouse.move(cx + 150, cy + 60, steps=4)
    page.mouse.move(cx + 200, cy, steps=4)   # вправо от середины: ручка была снизу (90°), стала справа (0°) → −90°
    page.mouse.up()
    L = layers(page)[0]
    assert L["pic"]["rot"] == -90
    assert page.locator(".side .pic-rot").count() == 0   # этап 10.9.6.3: ползунка в панели нет, поворот — ручкой
    assert "rotate(" in page.evaluate("document.querySelector('.stage .pic-hit').style.transform")
    assert not page.errors, page.errors


def test_rotate_handle_not_on_text(page, sermon):
    text_page(page, sermon)
    page.locator(".stage .pic-hit[data-l='t1']").click()
    assert page.locator(".stage .pic-hit[data-l='t1'] .c-rot").count() == 0


def test_old_picture_turns_at_once_while_new_one_is_prepared(page, sermon):
    one_pic(page, sermon)
    r = page.evaluate("""() => { layerSet('i1', 'a', x => { x.pic = { rot:30 }; });
      const im = document.querySelector('.stage .sl-pic img'), hit = document.querySelector('.stage .pic-hit');
      return [im.style.transform, hit.style.transform]; }""")
    assert r[0].startswith("rotate(") and r[0] == r[1]   # картинка и рамка повёрнуты одинаково, не «вкось»
    page.wait_for_function("!document.querySelector('.stage .sl-pic img').style.transform")   # новая готова — поворот уже в самой картинке
    assert not page.errors, page.errors


def test_pipette_and_any_color_for_outline(page, sermon):
    one_pic(page, sermon)
    page.evaluate(FAKE_DROPPER)
    page.locator(".stage .pic-hit").click()
    page.evaluate("picPanelRefresh('i1')")
    page.locator(".side .ly-card.on details.ph-adv summary").click()
    assert page.locator(".side .ly-card.on .ph-color").count() == 1
    page.locator(".side .ly-card.on .ph-pipette").click()
    page.wait_for_function("(blockById('i1').layers[0].pic || {}).outline")
    o = layers(page)[0]["pic"]["outline"]
    assert o["color"] == "#12ab34" and o["w"] == 0   # этап 10.9.6.3: цвет не меняет толщину
    assert page.locator(".side .ly-card.on .ph-color").input_value() == "#12ab34"
    assert not page.errors, page.errors


def test_no_pipette_button_without_eyedropper_api(page, sermon):
    one_pic(page, sermon)
    page.evaluate("delete window.EyeDropper")
    page.locator(".stage .pic-hit").click()
    page.evaluate("picPanelRefresh('i1')")
    assert page.locator(".side .ly-card.on .ph-pipette").count() == 0 and page.locator(".side .ly-card.on .ph-color").count() == 1


def test_pipette_for_text_color(page, sermon):
    text_page(page, sermon)
    page.evaluate(FAKE_DROPPER)
    page.locator(".side .ly-card[data-l='t1'] .ly-head").click()
    page.evaluate("picPanelRefresh('i1')")
    page.locator(".side .ly-card.on .ph-pipette").click()
    page.wait_for_function("blockById('i1').layers.find(l => l.id === 't1').color === '#12ab34'")
    assert not page.errors, page.errors
