"""Этап 10.5.5: рамка текста цитаты с фото — двигать и тянуть мышью, выравнивание текста в рамке, привязки (край фото, поле слайда,
середина свободного места, верх и низ фото, середина слайда; Alt — без привязок), «Выровнять по свободному месту», «Сбросить»,
зеркало при смене стороны, «Во всю ширину» рамку не применяет, старые конспекты как раньше; JPEG и PowerPoint — как в редакторе."""
import io
import zipfile

import pytest
from PIL import Image

from conftest import cloud_page, ME
from test_stage105 import open_quote, q

TEXT = "Вера — это доверие Богу во всём"
# Льюис без фона при «Текст справа»: середина x = 480, ширина 353,5 → правый край фото 656,75, верх 108, низ 1080


def tb(page):
    return q(page)["textBox"]


def hit(page):
    return page.locator(".stage .tb-hit")


def k(page):
    return page.evaluate("document.querySelector('.stage .sl').clientWidth / SL.W")


def margins(page):
    return page.evaluate("tbMargins()")


def drag(page, dx, dy, handle=None, alt=False):
    """Тянуть рамку (или ручку) на dx, dy пикселей кадра 1920×1080"""
    loc = page.locator(".stage .tb-h.c-" + handle) if handle else hit(page)
    if handle:
        hit(page).hover()
    bx, s = loc.bounding_box(), k(page)
    x, y = bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2
    page.mouse.move(x, y)
    if alt:
        page.keyboard.down("Alt")
    page.mouse.down()
    page.mouse.move(x + dx * s, y + dy * s, steps=6)
    page.mouse.up()
    if alt:
        page.keyboard.up("Alt")


def box_rect(page):
    """Рамка текста на большом слайде в px кадра"""
    return page.evaluate("""() => { const b = document.querySelector('.stage .sl-box');
      return { l:b.offsetLeft, t:b.offsetTop, r:b.offsetLeft + b.offsetWidth, b:b.offsetTop + b.offsetHeight }; }""")


def opened(page, sermon, **kw):
    kw.setdefault("text", TEXT)
    kw.setdefault("photo", {"id": "lewis-cs"})
    open_quote(page, sermon, **kw)
    page.wait_for_selector(".stage .tb-hit")


# ---------- Модель ----------

def test_norm_text_box(page):
    r = page.evaluate("""() => ({
      ok:normTextBox({ x:.1, y:.2, w:.3, h:.4, ha:'left', va:'bottom' }),
      dflt:normTextBox({ x:'0.5', y:0, w:.5, h:1 }),
      bad:[normTextBox(null), normTextBox({ x:.8, y:0, w:.5, h:.5 }), normTextBox({ x:-1, y:0, w:.5, h:.5 }), normTextBox({ x:0, y:0, w:0, h:.5 }),
           normTextBox({ x:0, y:0, w:'a', h:.5 }), normTextBox('x')],
      old:normalize({ v:2, blocks:[{ id:'a', type:'quote', text:'x', half:'right' }] }).blocks[0].textBox,
      kept:normalize({ v:2, blocks:[{ id:'a', type:'quote', text:'x', half:'full', textBox:{ x:.5, y:.1, w:.4, h:.5 } }] }).blocks[0].textBox,
      fresh:newBlock('quote').textBox })""")
    assert r["ok"] == {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4, "ha": "left", "va": "bottom"}
    assert r["dflt"] == {"x": 0.5, "y": 0, "w": 0.5, "h": 1, "ha": "center", "va": "center"}
    assert r["bad"] == [None] * 6
    assert r["old"] is None and r["fresh"] is None
    assert r["kept"]["x"] == 0.5   # при «Во всю ширину» хранится
    assert not page.errors, page.errors


def test_old_conspect_looks_as_before(page, sermon):
    opened(page, sermon)
    m = margins(page)
    r = box_rect(page)
    assert r == {"l": 960 + 48, "t": m["t"] + 150, "r": 1920 - m["x"], "b": 1080 - m["b"] - 150}   # как по CSS «Текст справа», 50 %
    assert tb(page) is None
    assert page.evaluate("document.querySelector('.stage .sl-box').getAttribute('style') || ''").find("left") < 0
    assert page.locator(".half-w").count() == 1 and page.locator(".tb-reset").count() == 0
    assert not page.errors, page.errors


# ---------- Мышь ----------

def test_drag_moves_frame_and_writes_model(page, sermon):
    opened(page, sermon)
    r0 = box_rect(page)
    drag(page, -100, -200, alt=True)
    t = tb(page)
    assert abs(t["x"] * 1920 - (r0["l"] - 100)) <= 3 and abs(t["y"] * 1080 - (r0["t"] - 200)) <= 3
    assert abs(t["w"] * 1920 - (r0["r"] - r0["l"])) <= 1 and abs(t["h"] * 1080 - (r0["b"] - r0["t"])) <= 1
    assert t["ha"] == "center" and t["va"] == "center"
    r = box_rect(page)
    assert abs(r["l"] - t["x"] * 1920) <= 1 and abs(r["t"] - t["y"] * 1080) <= 1   # слайд стоит по модели
    assert page.locator(".half-w").count() == 0 and page.locator(".tb-reset").count() == 1   # «Ширина текста» не нужна, есть «Сбросить»
    # лента тоже по модели
    th = page.evaluate("""() => { const b = document.querySelector('.film .sl[data-id="q1"] .sl-box'); return b && b.offsetTop; }""")
    assert th is None or abs(th - t["y"] * 1080) <= 1
    assert not page.errors, page.errors


def test_resize_by_edge_and_corner(page, sermon):
    opened(page, sermon)
    r0 = box_rect(page)
    drag(page, -150, 0, handle="w", alt=True)
    t = tb(page)
    assert abs(t["x"] * 1920 - (r0["l"] - 150)) <= 3 and abs((t["x"] + t["w"]) * 1920 - r0["r"]) <= 1
    assert abs(t["y"] * 1080 - r0["t"]) <= 1 and abs(t["h"] * 1080 - (r0["b"] - r0["t"])) <= 1   # по вертикали не тронута
    drag(page, 0, 120, handle="se", alt=True)
    t2 = tb(page)
    assert abs((t2["y"] + t2["h"]) * 1080 - (r0["b"] + 120)) <= 3 and abs(t2["x"] - t["x"]) < 0.002
    # меньше предела не сжать
    drag(page, -2000, 0, handle="e", alt=True)
    assert tb(page)["w"] * 1920 >= 159
    assert not page.errors, page.errors


def test_click_selects_and_click_outside_deselects(page, sermon):
    opened(page, sermon)
    hit(page).click()
    assert "sel" in hit(page).get_attribute("class")
    assert tb(page) is None   # щелчок рамку не меняет
    page.locator(".stage .sl").click(position={"x": 20, "y": 20})
    assert "sel" not in hit(page).get_attribute("class")
    assert not page.errors, page.errors


# ---------- Привязки ----------

def test_snap_to_photo_edge_and_alt_turns_it_off(page, sermon):
    opened(page, sermon)
    pr = page.evaluate("(() => { const p = photoBox(state.blocks.find(b => b.id === 'q1')); return p.left + p.width; })()")
    r0 = box_rect(page)
    drag(page, pr + 5 - r0["l"], 0)
    assert abs(tb(page)["x"] * 1920 - pr) < 0.5   # прилипла к правому краю фото
    page.evaluate("state.blocks.find(b => b.id === 'q1').textBox = null; rerender(state.blocks.find(b => b.id === 'q1'))")
    drag(page, pr + 5 - r0["l"], 0, alt=True)
    assert abs(tb(page)["x"] * 1920 - (pr + 5)) <= 2.5   # с Alt — где отпустили
    assert not page.errors, page.errors


def test_snap_to_margin_free_center_and_photo_top(page, sermon):
    opened(page, sermon)
    m = margins(page)
    pr = page.evaluate("(() => { const p = photoBox(state.blocks.find(b => b.id === 'q1')); return p.left + p.width; })()")
    # сначала узкая рамка, без привязок
    drag(page, 300, 0, handle="w", alt=True)
    r = box_rect(page); w = r["r"] - r["l"]
    # правый край — к полю слайда: от него уже стоит; середина — к середине свободного места
    free_c = (pr + 1920 - m["x"]) / 2
    drag(page, free_c - (r["l"] + w / 2) + 4, 0)
    t = tb(page)
    assert abs((t["x"] + t["w"] / 2) * 1920 - free_c) < 0.6
    # верх — к верху фото (108)
    r = box_rect(page)
    drag(page, 0, 108 + 6 - r["t"])
    assert abs(tb(page)["y"] * 1080 - 108) < 0.6
    # ручкой — правый край к полю слайда
    r = box_rect(page)
    drag(page, (1920 - m["x"]) - r["r"] - 5, 0, handle="e")
    t = tb(page)
    assert abs((t["x"] + t["w"]) * 1920 - (1920 - m["x"])) < 0.6
    assert not page.errors, page.errors


def test_guides_shown_while_snapped(page, sermon):
    opened(page, sermon)
    pr = page.evaluate("(() => { const p = photoBox(state.blocks.find(b => b.id === 'q1')); return p.left + p.width; })()")
    r0, s = box_rect(page), k(page)
    bx = hit(page).bounding_box()
    x, y = bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2
    page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + (pr + 4 - r0["l"]) * s, y, steps=5)
    page.wait_for_timeout(50)
    assert page.locator(".stage .tb-guide.v").count() >= 1
    page.mouse.up()
    assert page.locator(".stage .tb-guide").count() == 0
    assert not page.errors, page.errors


# ---------- Кнопки ----------

def test_fit_free_space(page, sermon):
    opened(page, sermon, first="Клайв", last="Льюис")
    m = margins(page)
    pr = page.evaluate("(() => { const p = photoBox(state.blocks.find(b => b.id === 'q1')); return p.left + p.width; })()")
    page.locator(".tb-fit").click()
    t = tb(page)
    assert abs(t["x"] * 1920 - pr) < 0.5 and abs((t["x"] + t["w"]) * 1920 - (1920 - m["x"])) < 0.5
    assert abs(t["y"] * 1080 - m["t"]) < 0.5
    au = page.evaluate("document.querySelector('.stage .sl-author').offsetTop")
    assert abs((t["y"] + t["h"]) * 1080 - (au - 40)) < 1   # до подписи автора
    # без автора — до нижнего поля
    page.evaluate("const b = state.blocks.find(b => b.id === 'q1'); b.first = b.last = ''; rerender(b)")
    page.locator(".tb-fit").click()
    t = tb(page)
    assert abs((t["y"] + t["h"]) * 1080 - (1080 - m["b"])) < 0.5
    assert not page.errors, page.errors


def test_align_buttons(page, sermon):
    opened(page, sermon)
    page.locator(".tb-panel button[title='По левому краю']").click()
    page.locator(".tb-panel button[title='Прижать к верху']").click()
    t = tb(page)
    assert t["ha"] == "left" and t["va"] == "top"
    r = page.evaluate("""() => { const b = document.querySelector('.stage .sl-box'), i = b.querySelector('.sl-inner');
      return [i.style.textAlign, b.style.justifyContent, i.offsetTop]; }""")
    assert r[0] == "left" and r[1] == "flex-start" and r[2] <= 2
    assert "on" in page.locator(".tb-panel button[title='По левому краю']").get_attribute("class")
    assert not page.errors, page.errors


def test_reset_returns_old_layout(page, sermon):
    opened(page, sermon)
    r0 = box_rect(page)
    drag(page, -200, -100, alt=True)
    assert tb(page) is not None
    page.locator(".tb-reset").click()
    assert tb(page) is None and box_rect(page) == r0
    assert page.locator(".half-w").count() == 1
    assert not page.errors, page.errors


def test_mirror_on_side_switch_and_full_width_ignores(page, sermon):
    opened(page, sermon)
    page.evaluate("const b = state.blocks.find(b => b.id === 'q1'); b.textBox = { x:.6, y:.1, w:.3, h:.5, ha:'left', va:'top' }; rerender(b)")
    page.locator(".toggle button", has_text="Текст слева").click()
    t = tb(page)
    assert abs(t["x"] - 0.1) < 1e-6 and t["ha"] == "right" and t["va"] == "top"
    page.locator(".toggle button", has_text="Во всю ширину").click()
    assert tb(page)["x"] == t["x"]   # хранится
    st = page.evaluate("document.querySelector('.stage .sl-box').getAttribute('style') || ''")
    assert "left" not in st and page.locator(".stage .tb-hit").count() == 0 and page.locator(".tb-panel").count() == 0
    page.locator(".toggle button", has_text="Текст справа").click()   # из «Во всю ширину»: рамка была слева — уходит направо
    t = tb(page)
    assert abs(t["x"] - 0.6) < 1e-6 and t["ha"] == "left"
    assert not page.errors, page.errors


def test_author_follows_frame(page, sermon):
    opened(page, sermon, first="Клайв", last="Льюис")
    page.evaluate("const b = state.blocks.find(b => b.id === 'q1'); b.textBox = { x:.4, y:.1, w:.3, h:.5 }; rerender(b)")
    r = page.evaluate("(() => { const a = document.querySelector('.stage .sl-author'); return [a.offsetLeft + a.offsetWidth, a.offsetWidth]; })()")
    assert abs(r[0] - 0.7 * 1920) <= 1 and r[1] <= 0.3 * 1920 + 1
    assert not page.errors, page.errors


def test_viewer_has_no_frame(browser, base_url, sermon):
    ctx, pg = cloud_page(browser, base_url, user=ME, members={"admin@x.pl": {"role": "editor"}})
    try:
        pg.wait_for_selector(".home-top")
        from conftest import open_sermon
        from test_stage105 import quote_sermon, with_bank
        with_bank(pg)
        open_sermon(pg, quote_sermon(sermon, text=TEXT, photo={"id": "lewis-cs"}), edit=False)
        pg.evaluate("selectBlock('q1')")
        pg.wait_for_selector(".stage.t-quote .sl")
        assert pg.locator(".stage .tb-hit").count() == 0
        assert not pg.errors, pg.errors
    finally:
        ctx.close()


# ---------- JPEG и PowerPoint ----------

BRIGHT = """async ([layer]) => {
  const b = state.blocks.find(x => x.id === 'q1');
  const blob = await renderJPEG(b, layer || undefined), url = URL.createObjectURL(blob), im = new Image(); im.src = url; await im.decode();
  const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
  const d = x.getImageData(0, 0, 1920, 1080).data;
  let l = 1e9, t = 1e9, r = -1, bt = -1;
  for (let y = 50; y < 1030; y += 2) for (let a = 700; a < 1870; a += 2){ const i = (y * 1920 + a) * 4;
    if (d[i + 3] > 200 && Math.min(d[i], d[i + 1], d[i + 2]) > 190){ l = Math.min(l, a); r = Math.max(r, a); t = Math.min(t, y); bt = Math.max(bt, y); } }
  const s = document.querySelector('.stage .sl-inner'), st = s.closest('.sl-stage');
  const k = st.getBoundingClientRect().width / 1920, sr = st.getBoundingClientRect();
  const ed = [...s.querySelectorAll('.sl-tp, .sl-text, span')].map(e => e.getBoundingClientRect()).filter(q => q.width);
  const R = s.getBoundingClientRect();
  return { jpeg:[l, t, r, bt], editor:[(R.left - sr.left) / k, (R.top - sr.top) / k, (R.right - sr.left) / k, (R.bottom - sr.top) / k], type:blob.type };
}"""


@pytest.mark.parametrize("layer", [None, "text"])
def test_jpeg_and_pptx_text_match_editor(page, sermon, layer):
    opened(page, sermon)
    page.evaluate("const b = state.blocks.find(b => b.id === 'q1'); b.textBox = { x:.45, y:.06, w:.45, h:.3, ha:'right', va:'top' }; rerender(b)")
    page.wait_for_timeout(200)
    r = page.evaluate(BRIGHT, [layer])
    assert r["type"] == ("image/png" if layer else "image/jpeg")
    l, t, rr, bt = r["jpeg"]
    el, et, er, eb = r["editor"]
    assert t >= 0.06 * 1080 - 4 and bt <= 0.36 * 1080 + 4   # текст — в рамке, вверху
    assert abs(rr - er) <= 6 and abs(t - et) <= 30 and bt <= eb + 4   # и там же, где в редакторе (прижат вправо и вверх)
    assert rr <= 0.9 * 1920 + 4 and l >= 0.45 * 1920 - 4
    assert not page.errors, page.errors


def test_pptx_has_text_picture_in_frame(page, sermon):
    pytest.importorskip("pptx")
    opened(page, sermon)
    page.evaluate("const b = state.blocks.find(b => b.id === 'q1'); b.textBox = { x:.5, y:.05, w:.4, h:.3, ha:'center', va:'top' }; rerender(b)")
    with page.expect_download(timeout=120000) as dl:
        page.evaluate("exportPPTX()")
    z = zipfile.ZipFile(dl.value.path())
    n = page.evaluate("units().filter(b => TYPES[b.type].slide).findIndex(b => b.id === 'q1') + 1")
    im = Image.open(io.BytesIO(z.read(f"ppt/media/text{n}.png"))).convert("RGBA")
    bb = im.getchannel("A").point(lambda a: 255 if a > 200 else 0).getbbox()
    assert bb and bb[0] >= 0.5 * 1920 - 4 and bb[2] <= 0.9 * 1920 + 4 and bb[1] >= 0.05 * 1080 - 4 and bb[3] <= 0.35 * 1080 + 4
    assert not page.errors, page.errors
