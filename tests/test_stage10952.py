"""Этап Б (24 ноября 2026): слои слайда «Картинка» — выделение снимается (щелчок по фону, Esc), курсив и расстояния у текста
(модель, слайд, JPEG), «Выше» / «Ниже» — стрелки."""
from test_stage1091 import put_image, open_img
from test_stage1092 import two_pics, layers, jpeg_px
from test_stage10912 import drag


def text_page(page, sermon, **extra):
    t = {"kind": "text", "id": "t1", "text": "Привет мир", "x": 0.5, "y": 0.5, "w": 0.5, "size": 72, "color": "#ffffff", "align": "center"}
    t.update(extra)
    put_image(page, "fixture-0001", "pbg", 800, 600, "#000000")
    open_img(page, sermon, todo=False, layers=[
        {"kind": "pic", "id": "a", "imageId": "pbg", "imgW": 800, "imgH": 600, "place": {"cover": True}}, t])
    page.wait_for_selector(".stage .sl-ptext")


def sel(page):
    return page.evaluate("picSelId(blockById('i1'))")


# ---------- Модель ----------

def test_model_italic_track_lead(page):
    r = page.evaluate("""() => normalize({ app:'swp-sermon', v:2, meta:{}, blocks:[{ id:'a', type:'image', mode:'upload', layers:[
      { kind:'text', id:'a1', text:'x', italic:true, track:0.1, lead:1.5 },
      { kind:'text', id:'a2', text:'y', italic:'yes', track:-0.02, lead:1.18 },
      { kind:'text', id:'a3', text:'z', track:9, lead:0.1 },
      { kind:'text', id:'a4', text:'w' } ] }] }).blocks[0].layers""")
    a1, a2, a3, a4 = r
    assert a1["italic"] is True and a1["track"] == 0.1 and a1["lead"] == 1.5
    assert all(k not in a2 for k in ("italic", "track", "lead")) and all(k not in a4 for k in ("italic", "track", "lead"))   # стандартное не записывается: старые слайды как были
    assert a3["track"] == 0.3 and a3["lead"] == 0.8


# ---------- Выделение ----------

def test_background_click_and_escape_clear_selection(page, sermon):
    two_pics(page, sermon)
    page.evaluate("picLayers(blockById('i1'))[0].place = { x:0.2, y:0.5, w:0.2 }; picLayers(blockById('i1'))[1].place = { x:0.7, y:0.5, w:0.2 }; picRepaintAll('i1')")
    page.wait_for_timeout(50)
    page.locator(".stage .pic-hit[data-l='a']").click()
    page.wait_for_function("picSelId(blockById('i1')) === 'a'")
    assert page.locator(".side .ly-card.on").count() == 1 and page.locator(".stage .pic-hit.sel").count() == 1
    # щелчок по пустому фону слайда (вне рамок) — выделение снято
    bx = page.locator(".stage .stage-slide").bounding_box()
    page.mouse.click(bx["x"] + 4, bx["y"] + 4)
    assert sel(page) is None
    assert page.locator(".side .ly-card.on").count() == 0 and page.locator(".side .ly-body").count() == 0
    assert page.locator(".stage .pic-hit.sel").count() == 0
    # щелчок по картинке — снова выбрана и раскрыта
    page.locator(".stage .pic-hit[data-l='b']").click()
    page.wait_for_function("picSelId(blockById('i1')) === 'b'")
    assert page.locator(".side .ly-card.on").get_attribute("data-l") == "b" and page.locator(".side .ly-body").count() == 1
    # Esc — тоже снимает
    page.keyboard.press("Escape")
    assert sel(page) is None and page.locator(".side .ly-card.on").count() == 0 and page.locator(".stage .pic-hit.sel").count() == 0
    # щелчок по карточке слоя слева раскрывает её
    page.locator(".side .ly-card[data-l='a'] .ly-head").click()
    assert sel(page) == "a" and page.locator(".side .ly-card.on").count() == 1
    assert not page.errors, page.errors


def test_only_one_layer_selected_at_a_time(page, sermon):
    text_page(page, sermon)
    page.locator(".stage .pic-hit[data-l='t1']").click()
    page.wait_for_function("picSelId(blockById('i1')) === 't1'")
    assert page.locator(".stage .pic-hit.sel").count() == 1 and page.locator(".side .ly-card.on").count() == 1
    assert not page.errors, page.errors


# ---------- Текст ----------

def test_text_italic_spacing_on_slide_and_jpeg(page, sermon):
    text_page(page, sermon)
    page.locator(".side .ly-card[data-l='t1'] .ly-head").click()
    page.wait_for_selector(".side .pt-italic")
    assert page.locator(".side .pt-bold").count() == 1 and page.locator(".side .pt-track").count() == 1 and page.locator(".side .pt-lead").count() == 1
    assert page.evaluate("getComputedStyle(document.querySelector('.stage .sl-ptext')).fontStyle") == "normal"
    page.locator(".side .pt-italic").click()
    page.evaluate("""() => { const r = document.querySelector('.side .pt-track'); r.value = 0.2; r.dispatchEvent(new Event('input', { bubbles:true }));
      const q = document.querySelector('.side .pt-lead'); q.value = 1.6; q.dispatchEvent(new Event('input', { bubbles:true })); }""")
    t = [l for l in layers(page) if l["kind"] == "text"][0]
    assert t["italic"] is True and t["track"] == 0.2 and t["lead"] == 1.6
    cs = page.evaluate("(() => { const c = getComputedStyle(document.querySelector('.stage .sl-ptext')); return [c.fontStyle, c.letterSpacing, c.lineHeight, c.fontSize]; })()")
    assert cs[0] == "italic" and abs(float(cs[1][:-2]) - 0.2 * 72) < 0.6 and abs(float(cs[2][:-2]) - 1.6 * 72) < 0.6
    # в ленте и в JPEG — то же
    ph = page.evaluate("[...document.querySelectorAll('.sl-ptext')].map(e => getComputedStyle(e).fontStyle)")
    assert ph and all(x == "italic" for x in ph)
    jp = page.evaluate("""async () => { const bl = await renderJPEG(blockById('i1')); return bl.size > 0; }""")
    assert jp
    # вернули стандартные значения — из слайда они уходят
    page.evaluate("""() => { const r = document.querySelector('.side .pt-track'); r.value = -0.02; r.dispatchEvent(new Event('input', { bubbles:true })); }""")
    t = [l for l in layers(page) if l["kind"] == "text"][0]
    assert "track" not in t
    assert not page.errors, page.errors


def test_text_spacing_changes_rendered_height(page, sermon):
    text_page(page, sermon, text="Раз\nДва\nТри")
    h1 = page.evaluate("document.querySelector('.stage .sl-ptext').offsetHeight")
    page.evaluate("layerSet('i1', 't1', x => { x.lead = 2; })")
    h2 = page.evaluate("document.querySelector('.stage .sl-ptext').offsetHeight")
    assert h2 > h1 * 1.5


# ---------- Порядок слоёв ----------

def test_order_buttons_are_arrows(page, sermon):
    two_pics(page, sermon)
    up, down = page.locator(".side .ly-card[data-l='b'] .ly-up"), page.locator(".side .ly-card[data-l='b'] .ly-down")
    assert up.get_attribute("aria-label") == "Выше" and down.get_attribute("aria-label") == "Ниже"
    assert up.get_attribute("title") == "Выше" and down.get_attribute("title") == "Ниже"
    assert up.inner_text().strip() == "" and up.locator("svg").count() == 1 and down.locator("svg").count() == 1   # значки, не слова
    assert up.is_disabled() and not down.is_disabled()   # верхний слой выше некуда
    down.click()
    assert [l["id"] for l in layers(page)] == ["b", "a"]
    assert not page.errors, page.errors
