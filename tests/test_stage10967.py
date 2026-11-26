"""Этап 10.9.6.7 (26 ноября 2026): рамки на слайде, «АА» и рамка у текста, «Элементы слайда», заставка, цитата."""
from test_stage10952 import text_page, layers
from test_stage105 import open_quote


def tcard(page):
    page.locator(".side .ly-card[data-l='t1'] .ly-head").click()
    page.wait_for_selector(".side .pt-bar")
    return ".side .ly-card[data-l='t1'] "


# ---------- Модель текста: caps, frame, rot ----------

def test_text_model_caps_frame_rot(page):
    r = page.evaluate("""() => normalize({ app:'swp-sermon', v:2, meta:{}, blocks:[{ id:'a', type:'image', mode:'upload', layers:[
      { kind:'text', id:'a1', text:'x', caps:true, frame:true, rot:30.4 },
      { kind:'text', id:'a2', text:'y', caps:'yes', rot:0 },
      { kind:'text', id:'a3', text:'z', rot:500 } ] }] }).blocks[0].layers""")
    a1, a2, a3 = r
    assert a1["caps"] is True and a1["frame"] is True and a1["rot"] == 30
    assert all(k not in a2 for k in ("caps", "frame", "rot"))
    assert a3["rot"] == -180


def test_text_caps_and_frame_buttons(page, sermon):
    page.set_viewport_size({"width": 1920, "height": 1080})
    text_page(page, sermon)
    c = tcard(page)
    bar = page.locator(c + ".pt-bar")
    caps, frame = bar.locator(".pt-caps"), bar.locator(".pt-frame")
    assert caps.count() == 1 and frame.count() == 1
    assert caps.locator("xpath=..").get_attribute("class").find("pt-style") >= 0   # «АА» в одной группе с Ж и К
    assert bar.locator(".pt-color-btn").locator("xpath=..").get_attribute("class") == "pt-bar"   # цвет отдельно от рамки
    caps.click(); frame.click()
    t = [l for l in layers(page) if l["kind"] == "text"][0]
    assert t["caps"] is True and t["frame"] is True
    el = page.locator(".stage .sl-ptext").first
    assert el.evaluate("e => getComputedStyle(e).textTransform") == "uppercase"
    st = el.evaluate("e => { const s = getComputedStyle(e); return [s.borderTopStyle, s.borderTopLeftRadius, s.borderTopColor, s.color]; }")
    assert st[0] == "dashed" and st[1] != "0px" and st[2] == st[3]
    assert page.locator(c + ".pt-text").input_value() == "Привет мир"   # в поле — как написано
    assert not page.errors, page.errors


def test_text_rotates_with_handle(page, sermon):
    text_page(page, sermon, rot=20)
    assert "rotate(20deg)" in page.locator(".stage .sl-ptext").first.evaluate("e => e.style.transform")
    page.locator(".stage .sl-ptext").first.click(force=True)
    page.evaluate("picSelect('i1', 't1')")
    hit = page.locator(".stage-slide .pic-hit[data-l='t1']")
    assert hit.locator(".c-rot").count() == 1
    assert "rotate(20deg)" in hit.evaluate("e => e.style.transform")
    assert not page.errors, page.errors


# ---------- Рамки ----------

def test_rotate_icon_centered(page, sermon):
    text_page(page, sermon)
    page.evaluate("picSelect('i1', 'a')")
    r = page.locator(".stage-slide .pic-hit[data-l='a'] .c-rot")
    o, i = r.bounding_box(), r.locator("svg").bounding_box()
    assert abs((o["x"] + o["width"] / 2) - (i["x"] + i["width"] / 2)) < 1
    assert abs((o["y"] + o["height"] / 2) - (i["y"] + i["height"] / 2)) < 1


def test_quote_text_frame_hidden_without_selection(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs"}, half="right")
    hit = page.locator(".stage-slide .tb-hit")
    page.mouse.move(2, 2)
    page.evaluate("tbUI.sel = false; document.querySelectorAll('.tb-hit').forEach(x => x.classList.remove('sel'))")
    assert hit.evaluate("e => getComputedStyle(e).borderTopColor") == "rgba(0, 0, 0, 0)"


# ---------- «Элементы слайда» ----------

def test_layers_tiles_above_list(page, sermon):
    text_page(page, sermon)
    g = page.locator(".side .grp-layers")
    tiles = g.locator(".pic-add .ly-tile")
    assert tiles.count() == 2 and g.locator(".pic-add .pic-pick").count() == 1 and g.locator(".pic-add .pt-add").count() == 1
    y_tiles = g.locator(".pic-add").bounding_box()["y"]
    y0 = tiles.first.bounding_box()["y"]
    assert y_tiles < g.locator(".ly-card").first.bounding_box()["y"]   # плитки над списком
    assert g.locator(".ly-card .ly-kind-pic").count() == 1 and g.locator(".ly-card .ly-kind-text").count() == 1
    page.locator(".side .pt-add").click()
    assert abs(page.locator(".side .pic-add .ly-tile").first.bounding_box()["y"] - y0) < 1   # плитки не сдвинулись
    first = page.locator(".side .grp-layers .ly-card").first.get_attribute("data-l")
    assert first == layers(page)[-1]["id"]   # новый элемент — первым в списке (поверх остальных)
    assert not page.errors, page.errors


def test_layers_empty_slide(page, sermon):
    from test_stage1091 import open_img
    open_img(page, sermon, todo=False, layers=[])
    g = page.locator(".side .grp-layers")
    g.wait_for()
    assert g.locator(".ly-empty").inner_text() == "На слайде пока ничего нет"
    assert g.locator(".pic-add .ly-tile").count() == 2
    assert not page.errors, page.errors


# ---------- Заставка ----------

def test_splash_model_title_and_foot_size(page):
    r = page.evaluate("""() => [
      normalize({ app:'swp-sermon', v:2, meta:{}, settings:{ splashTitle:false, splashFootSize:120 }, blocks:[] }).settings,
      normalize({ app:'swp-sermon', v:2, meta:{}, settings:{ splashTitle:true, splashFootSize:100 }, blocks:[] }).settings,
      normalize({ app:'swp-sermon', v:2, meta:{}, settings:{ splashFootSize:999 }, blocks:[] }).settings ]""")
    assert r[0]["splashTitle"] is False and r[0]["splashFootSize"] == 120
    assert "splashTitle" not in r[1] and "splashFootSize" not in r[1]   # по умолчанию не записывается
    assert "splashFootSize" not in r[2]


def test_splash_title_off_and_foot_size(page, sermon):
    from test_stage10911 import open_splash
    open_splash(page, sermon)
    side = page.locator(".side .own-splash")
    secs = side.locator(".sp-sec")
    assert secs.nth(0).locator(".lbl").text_content() == "Текст" and secs.nth(1).locator(".lbl").text_content() == "Фон"   # текст выше фона
    title = side.locator(".sp-title input[type=checkbox]")
    assert title.is_checked() and side.locator(".sp-foot input[type=checkbox]").is_checked()   # по умолчанию всё включено
    side.locator(".sp-title .switch").click()
    assert page.evaluate("state.settings.splashTitle") is False
    page.wait_for_function("getComputedStyle(document.querySelector('.stage .sl-sp-title')).visibility === 'hidden'")
    assert "off" in side.locator(".sp-title").get_attribute("class")
    fs0 = page.evaluate("parseFloat(getComputedStyle(document.querySelector('.stage .sl-sp-foot')).fontSize)")
    side.locator(".sp-foot-step button").nth(1).click()
    assert page.evaluate("state.settings.splashFootSize") == 105
    page.wait_for_function("parseFloat(getComputedStyle(document.querySelector('.stage .sl-sp-foot')).fontSize) > %f" % (fs0 + 0.5))
    side.locator(".sp-foot .switch").click()   # обе строки выключены — остаётся один фон
    assert page.evaluate("state.settings.splashFoot") is False
    assert not page.errors, page.errors


def test_splash_bg_buttons_and_dim_only_with_picture(page, sermon, tmp_path):
    from test_stage10911 import open_splash, upload, png
    open_splash(page, sermon, splashMode="bg")
    p = page.locator(".side .spic-panel")
    assert p.locator(".spic-pick").is_enabled() and p.locator(".spic-replace").is_disabled() and p.locator(".spic-del").is_disabled()
    assert p.locator(".spic-dim").count() == 0
    assert p.locator(".hint").count() == 0
    upload(page, png(tmp_path, 1600, 900))
    page.wait_for_selector(".side .spic-panel .spic-dim")
    p = page.locator(".side .spic-panel")
    assert p.locator(".spic-pick").is_disabled() and p.locator(".spic-replace").is_enabled() and p.locator(".spic-del").is_enabled()
    assert not page.errors, page.errors
