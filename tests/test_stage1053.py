"""Этап 10.5.3: редактор фото на слайде — панель над фото, обрезка, поворот, обводка, скругление углов («с фоном»), фильтр, отражение.
Каждый инструмент пишет в модель и виден в JPEG (по пикселям); толщина обводки не зависит от размера фото; рамка для мыши повёрнута;
панель появляется и пропадает; телефон; вид по умолчанию (админ) и «Сбросить» (все); PowerPoint — картинка со всеми эффектами."""
import io
import zipfile

import pytest
from PIL import Image

from conftest import ENGINE, cloud_page, open_sermon, ME
from test_stage105 import open_quote, q, red, blue, select_photo
from test_stage1052 import open_q, put_bank, BG_PRESET

# Льюис без фона: 200×550, слева красная половина, справа синяя; при «Текст справа» стоит по центру левой зоны:
# середина x = 480, низ 1080, высота 972, ширина 353,5 (слева 303,3, справа 656,7)

PIXELS = """async ([photo, half, pts, id]) => {
  const b = state.blocks.find(x => x.id === 'q1');
  Object.assign(b, { half, text:'.' }); b.photo = Object.assign({ id:id || 'lewis-cs', x:null, y:null, h:null, filter:'none', mirror:true }, photo);
  const blob = await renderJPEG(b), url = URL.createObjectURL(blob), im = new Image(); im.src = url; await im.decode();
  const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
  return pts.map(([a, y]) => [...x.getImageData(a, y, 1, 1).data].slice(0, 3));
}"""


def px(page, photo, pts, half="right", id=None):
    return page.evaluate(PIXELS, [photo, half, pts, id])


def white(c): return min(c) > 215
def dark(c): return max(c) < 120 and not red(c) and not blue(c)


def photo_el(page):
    return page.locator(".stage .ph-hit")


def adv(page):
    """Обработка фото в блоке «Фото» — вкладками (26.11); tab — открыть вкладку"""
    select_photo(page)
    page.wait_for_selector(".side .ph-adv")
    return page.locator(".side .ph-adv")


def ph_tab(page, tab):
    page.locator(".side .ph-adv .pic-tab[data-tab='%s']" % tab).click()


def set_range(page, sel, v):
    page.locator(sel).evaluate("(e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles:true })); }", v)


# ---------- Модель ----------

def test_norm_photo_keeps_valid_and_drops_wrong(page):
    r = page.evaluate("""() => {
      const n = p => normPhoto(Object.assign({ id:'a' }, p));
      return { ok:n({ crop:{ l:.1, t:.2, r:.3, b:0 }, rot:-35.5, outline:{ w:12, color:'#FF0000' }, round:.25 }),
        none:n({}), bad:n({ crop:{ l:.6, t:0, r:.5, b:0 }, rot:200, outline:{ w:99, color:'red' }, round:.9 }),
        zero:n({ crop:{ l:0, t:0, r:0, b:0 }, rot:0, outline:{ w:0, color:'#ffffff' }, round:0 }),
        colorOnly:n({ outline:{ w:0, color:'#00ff00' } }) }; }""")
    assert r["ok"] == {"id": "a", "x": None, "y": None, "h": None, "filter": "none", "mirror": True,
                       "crop": {"l": 0.1, "t": 0.2, "r": 0.3, "b": 0}, "rot": -35.5, "outline": {"w": 12, "color": "#ff0000"}, "round": 0.25}
    assert r["none"] == r["zero"] and set(r["none"]) == {"id", "x", "y", "h", "filter", "mirror"}   # поля есть, только если не по умолчанию
    assert "outline" not in r["bad"]   # толщина 99 — неверная: обводки нет, цвет «red» — неверный: белый, а белый без толщины не хранится
    assert "crop" not in r["bad"] and "rot" not in r["bad"] and "round" not in r["bad"]
    assert r["colorOnly"]["outline"] == {"w": 0, "color": "#00ff00"}
    assert not page.errors, page.errors


def test_old_conspect_opens_as_is(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs", "x": 0.3, "y": 1, "h": 0.9, "filter": "sepia", "mirror": False})
    assert q(page)["photo"] == {"id": "lewis-cs", "x": 0.3, "y": 1, "h": 0.9, "filter": "sepia", "mirror": False}
    assert page.evaluate("photoBox(state.blocks.find(b => b.id === 'q1')).fx") is None   # без правок — картинка как в банке
    assert not page.errors, page.errors


# ---------- JPEG: обрезка, поворот, обводка ----------

def test_crop_is_in_model_and_visible_in_jpeg(page, sermon):
    open_quote(page, sermon)
    a, b = px(page, {}, [(390, 800), (570, 800)])
    assert red(a) and blue(b)
    a, b = px(page, {"crop": {"l": 0.5, "t": 0, "r": 0, "b": 0}}, [(390, 800), (570, 800)])
    assert dark(a) and blue(b)   # левой (красной) половины нет, синяя на месте: обрезка не двигает оставшееся
    a, b = px(page, {"crop": {"l": 0, "t": 0.5, "r": 0, "b": 0}}, [(390, 300), (390, 800)])
    assert dark(a) and red(b)   # верхней половины нет
    assert not page.errors, page.errors


def test_rotate_90_swaps_axes_in_jpeg(page, sermon):
    open_quote(page, sermon)
    pts = [(480, 480), (480, 710), (480, 200), (100, 594)]
    r = px(page, {"rot": 90}, pts)
    assert red(r[0]) and blue(r[1])   # по часовой: левая (красная) половина оказалась сверху
    assert dark(r[2])   # где фото стояло прямо, теперь пусто
    r = px(page, {"rot": -90}, pts[:2])
    assert blue(r[0]) and red(r[1])
    assert not page.errors, page.errors


def test_outline_by_silhouette_and_thickness_does_not_depend_on_size(page, sermon):
    open_quote(page, sermon)
    # слева у фото 303,3: обводка 20 px — белая между 283 и 303
    r = px(page, {"outline": {"w": 20, "color": "#ffffff"}}, [(293, 800), (270, 800), (390, 800)])
    assert white(r[0]) and dark(r[1]) and red(r[2])
    # без обводки (толщина 0) — пусто
    if ENGINE == "chromium":   # JPEG в Firefox и WebKit размывает цвет на несколько точек: край фото «подтекает»
        assert dark(px(page, {"outline": {"w": 0, "color": "#ffffff"}}, [(293, 800)])[0])
    # фото вдвое меньше (h 0.45 → 175,6 px шириной, левый край 392,2): обводка по-прежнему 20 px
    r = px(page, {"h": 0.45, "y": 1, "x": 0.25, "outline": {"w": 20, "color": "#ffffff"}}, [(384, 900), (366, 900), (396, 900)])
    assert white(r[0]) and dark(r[1])
    # цвет любой; фильтр обводку не красит
    r = px(page, {"filter": "bw", "outline": {"w": 20, "color": "#ff0000"}}, [(293, 800), (390, 800)])
    assert red(r[0]) and max(r[1]) - min(r[1]) < 16
    assert not page.errors, page.errors


def test_outline_follows_silhouette_not_frame(page, sermon):
    """Голова уже плеч: у верха обводка идёт вдоль головы, а не по прямоугольнику кадра."""
    open_quote(page, sermon)
    head_left = 303.3 + 353.5 * 60 / 200   # голова с 60 / 200 ширины: x ≈ 409
    r = px(page, {"outline": {"w": 14, "color": "#ffffff"}}, [(int(head_left) - 7, 130), (330, 130)])
    assert white(r[0]) and dark(r[1])
    assert not page.errors, page.errors


def test_round_and_outline_on_background_photo(page, sermon):
    open_q(page, sermon, photo={"id": "lewis-bg"})
    G = {"x": 0.25, "y": 0.9, "h": 0.4}   # 648 × 432: левый край 156, верх 540, низ 972
    pts = [(400, 756), (560, 756), (160, 968), (151, 977), (151, 756)]
    base = px(page, G, pts, id="lewis-bg")
    assert red(base[0]) and blue(base[1]) and not dark(base[2])   # кадр прямой: угол — картинка
    r = px(page, {**G, "round": 0.5}, pts, id="lewis-bg")
    assert red(r[0]) and dark(r[2])   # скруглено: угол кадра пуст
    sq = px(page, {**G, "outline": {"w": 10, "color": "#ffffff"}}, pts, id="lewis-bg")
    assert white(sq[3]) and white(sq[4])   # по краю кадра, углы острые
    both = px(page, {**G, "round": 0.5, "outline": {"w": 10, "color": "#ffffff"}}, pts, id="lewis-bg")
    assert white(both[4]) and not white(both[3])   # обводка повторяет скруглённые углы: у острого угла белого нет
    # «без фона» скругления не знает
    page.evaluate("Object.assign(state.blocks.find(b => b.id === 'q1'), { half:'right', photo:{ id:'lewis-cs', round:.5 } })")
    assert page.evaluate("photoBox(state.blocks.find(b => b.id === 'q1')).fx") is None
    assert not page.errors, page.errors


# ---------- Панель над фото ----------

def test_click_selects_photo_and_highlights_side_block(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs", "x": 0.25, "y": 0.9, "h": 0.5})
    page.wait_for_selector(".stage .ph-hit")
    assert page.locator(".side .ph-panel.sel").count() == 0
    select_photo(page)
    assert "sel" in photo_el(page).get_attribute("class")
    assert page.locator(".ph-bar").count() == 0 and page.locator(".ph-pop").count() == 0   # над фото ничего нет
    # щелчок мимо — выделение снято; щелчок по блоку «Фото» его не снимает
    select_photo(page)
    ph_tab(page, "filter")
    assert page.locator(".side .ph-panel.sel").count() == 1
    page.locator(".stage .sl").click(position={"x": 700, "y": 40})
    assert page.locator(".side .ph-panel.sel").count() == 0 and "sel" not in photo_el(page).get_attribute("class")
    assert not page.errors, page.errors


def test_photo_tabs_like_picture_and_remembered(page, sermon):
    # 26.11: обработка фото — вкладками «Кадр · Фильтр · Обводка · Тень», видно без выделения; открытая вкладка помнится
    open_quote(page, sermon, photo={"id": "lewis-cs"})
    page.wait_for_selector(".side .ph-adv")
    tabs = [t.strip() for t in page.locator(".side .ph-adv .pic-tab").all_inner_texts()]
    assert tabs == ["Кадр", "Фильтр", "Обводка", "Тень"]
    assert page.locator(".side .ph-adv .ph-crop-btn").is_visible() and page.locator(".side .ph-adv .ph-flip").count() == 1
    assert page.locator(".side .ph-adv .ph-flipv").count() == 1
    assert page.locator(".side .ph-panel .ph-reset").is_visible()
    ph_tab(page, "filter")
    assert page.locator(".side .ph-adv .ph-flt").count() == 9
    page.evaluate("rerender(state.blocks.find(b => b.id === 'q1'))")
    assert page.locator(".side .ph-adv .pic-tab.on").get_attribute("data-tab") == "filter"
    assert not page.errors, page.errors


def test_background_photo_has_corners_and_both_flips(page, sermon):
    open_q(page, sermon, photo={"id": "lewis-bg"})
    adv(page)
    assert page.locator(".side .ph-adv .ph-rd").count() == 1
    assert page.locator(".side .ph-adv .ph-flip").count() == 1 and page.locator(".side .ph-adv .ph-flipv").count() == 1   # этап 10.5.7: у всех видов
    assert not page.errors, page.errors


def test_popups_write_model(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs"})
    adv(page)
    assert page.locator(".side .ph-panel input[type=range].ph-rot, .side .ph-panel .ph-r90").count() == 0   # этап 10.5.7: ни ползунка, ни «На 90°»
    set_range(page, ".ph-adv .ph-ow", 12)
    assert q(page)["photo"]["outline"] == {"w": 12, "color": "#ffffff"}   # по умолчанию белый
    ph_tab(page, "out")
    page.locator(".ph-adv .ph-sw[title='#d94b4b']").click()
    assert q(page)["photo"]["outline"] == {"w": 12, "color": "#d94b4b"}
    set_range(page, ".ph-adv .ph-ow", 0)
    assert q(page)["photo"]["outline"] == {"w": 0, "color": "#d94b4b"}
    ph_tab(page, "filter")
    page.locator(".ph-adv .ph-flt[data-f='sepia']").click()
    assert q(page)["photo"]["filter"] == "sepia"
    page.evaluate("undo()")
    assert q(page)["photo"]["filter"] == "none"
    assert not page.errors, page.errors


def test_round_popup_on_background_photo(page, sermon):
    open_q(page, sermon, photo={"id": "lewis-bg"})
    adv(page)
    set_range(page, ".ph-adv .ph-rd", 50)
    assert q(page)["photo"]["round"] == 0.5
    set_range(page, ".ph-adv .ph-rd", 0)
    assert "round" not in q(page)["photo"]
    # 50 % на квадратном кадре — круг: радиус равен половине стороны
    r = page.evaluate("""async () => { const a = bankEntry('lewis-bg'), b = state.blocks.find(x => x.id === 'q1');
      Object.assign(b.photo, { crop:{ l:.1667, t:0, r:.1667, b:0 }, round:.5, h:.5 }); const box = photoBox(b);
      return { w:box.V.width, h:box.V.height }; }""")
    assert abs(r["w"] - r["h"]) < 2   # 300×200 с обрезкой по шестой части справа и слева — квадрат
    assert not page.errors, page.errors


# ---------- Обрезка ----------

def test_crop_mode_handles_esc_and_original_untouched(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs"})
    adv(page).locator(".ph-crop-btn").click()
    page.wait_for_selector(".ph-crop .pc-frame")
    assert page.locator(".ph-crop .pc-h").count() == 8   # ручки по краям и углам
    assert page.locator(".ph-bar .ph-b-done").is_visible()   # над фото — только подсказка и «Готово»
    assert page.locator(".side .ph-crop-btn").inner_text().strip() == "Готово"
    fr = page.locator(".ph-crop .pc-frame").bounding_box()
    h = page.locator(".ph-crop .pc-h.c-w").bounding_box()
    page.mouse.move(h["x"] + 7, h["y"] + 7)
    page.mouse.down(); page.mouse.move(h["x"] + 7 + fr["width"] * 0.25, h["y"] + 7, steps=5); page.mouse.up()
    c = q(page)["photo"]["crop"]
    assert abs(c["l"] - 0.25) < 0.02 and c["t"] == 0 and c["r"] == 0 and c["b"] == 0
    # меньше 10 % оставить нельзя
    h = page.locator(".ph-crop .pc-h.c-e").bounding_box()
    page.mouse.move(h["x"] + 7, h["y"] + 7)
    page.mouse.down(); page.mouse.move(h["x"] - 600, h["y"] + 7, steps=6); page.mouse.up()
    c = q(page)["photo"]["crop"]
    assert 1 - c["l"] - c["r"] >= 0.0999
    page.keyboard.press("Escape")
    assert page.locator(".ph-crop").count() == 0 and page.evaluate("photoUI.crop") is None
    # размер картинки в банке не тронут, рамка — в долях
    assert page.evaluate("[bankEntry('lewis-cs').w, bankEntry('lewis-cs').h]") == [200, 550]
    assert not page.errors, page.errors


def test_crop_ends_on_click_elsewhere_and_done_button(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs"})
    adv(page).locator(".ph-crop-btn").click()
    page.wait_for_selector(".ph-crop .pc-frame")
    page.locator(".ph-bar .ph-b-done").click()
    assert page.locator(".ph-crop").count() == 0 and page.locator(".side .ph-crop-btn").inner_text().strip() == "Обрезать"
    page.locator(".side .ph-crop-btn").click()
    page.wait_for_selector(".ph-crop .pc-frame")
    page.locator(".side .ph-crop-btn").click()   # «Готово» в блоке «Фото»
    assert page.locator(".ph-crop").count() == 0
    page.locator(".side .ph-crop-btn").click()
    page.locator(".stage .sl").click(position={"x": 700, "y": 40})
    assert page.locator(".ph-crop").count() == 0 and page.evaluate("photoUI.crop") is None
    assert not page.errors, page.errors


# ---------- Рамка для мыши и поворот ----------

def test_hit_frame_is_rotated_and_drag_follows(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs", "rot": 30})
    page.wait_for_selector(".stage .ph-hit")
    assert "rotate(30deg)" in page.locator(".stage .ph-hit").evaluate("e => e.style.transform")
    # размер за угол повёрнутой рамки: противоположный угол стоит на месте
    r = page.evaluate("""() => { const b = state.blocks.find(x => x.id === 'q1'), a = photoBox(b), V = a.V, t = a.rot * Math.PI / 180;
      const corner = (box, sx, sy) => ({ x:box.V.cx + sx * box.V.width / 2 * Math.cos(t) - sy * box.V.height / 2 * Math.sin(t), y:box.V.cy + sx * box.V.width / 2 * Math.sin(t) + sy * box.V.height / 2 * Math.cos(t) });
      return { c:corner(a, -1, -1) }; }""")
    hit = page.locator(".stage .ph-hit")
    bb = hit.bounding_box()
    corner = page.locator(".stage .ph-hit .ph-corner.c-se").bounding_box()
    sx, sy = corner["x"] + 7, corner["y"] + 7
    before = page.evaluate("(() => { const b = state.blocks.find(x => x.id === 'q1'), a = photoBox(b), t = a.rot * Math.PI / 180; return [a.V.cx - a.V.width / 2 * Math.cos(t) + a.V.height / 2 * Math.sin(t), a.V.cy - a.V.width / 2 * Math.sin(t) - a.V.height / 2 * Math.cos(t), a.F.height]; })()")
    page.mouse.move(sx, sy)
    page.mouse.down(); page.mouse.move(sx + 40, sy + 60, steps=6); page.mouse.up()
    after = page.evaluate("(() => { const b = state.blocks.find(x => x.id === 'q1'), a = photoBox(b), t = a.rot * Math.PI / 180; return [a.V.cx - a.V.width / 2 * Math.cos(t) + a.V.height / 2 * Math.sin(t), a.V.cy - a.V.width / 2 * Math.sin(t) - a.V.height / 2 * Math.cos(t), a.F.height]; })()")
    assert after[2] != before[2]   # размер изменился
    assert abs(after[0] - before[0]) < 1.5 and abs(after[1] - before[1]) < 1.5   # северо-западный угол на месте
    assert q(page)["photo"]["rot"] == 30
    assert not page.errors, page.errors


# ---------- Отражение, сторона текста ----------

def test_flip_and_text_side_mirror_crop_and_rotation(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs", "crop": {"l": 0.3, "t": 0, "r": 0.1, "b": 0}, "rot": 20}, half="left", halfW=30)
    assert page.evaluate("photoBox(state.blocks.find(b => b.id === 'q1')).flip") is True   # «Текст слева»: само смотрит к тексту
    adv(page).locator(".ph-flip").click()   # «Слева направо» снимает отражение: обрезка и поворот зеркально
    p = q(page)["photo"]
    assert p["flipH"] is True and p["mirror"] is True and p["crop"] == {"l": 0.1, "t": 0, "r": 0.3, "b": 0} and p["rot"] == -20
    assert page.evaluate("photoBox(state.blocks.find(b => b.id === 'q1')).flip") is False
    page.locator(".side .ph-flip").click()
    p = q(page)["photo"]
    assert "flipH" not in p and p["crop"]["l"] == 0.3 and p["rot"] == 20
    # переключили сторону текста: фото отражается — обрезка и поворот вместе с ним
    page.evaluate("(() => { const b = state.blocks.find(x => x.id === 'q1'); photoHalfSwitch(b, 'right'); b.half = 'right'; })()")
    p = q(page)["photo"]
    assert p["crop"] == {"l": 0.1, "t": 0, "r": 0.3, "b": 0} and p["rot"] == -20
    assert not page.errors, page.errors


# ---------- Вид по умолчанию и «Сбросить» ----------

def test_preset_keeps_everything_but_visibility_and_reset_clears_all(page, sermon):
    open_q(page, sermon, photo={"id": "lewis-bg", "x": 0.2, "y": 0.9, "h": 0.5, "filter": "bw", "mirror": True,
                                  "crop": {"l": 0.1, "t": 0, "r": 0, "b": 0.2}, "rot": 15, "outline": {"w": 8, "color": "#f2c14e"}, "round": 0.2, "off": False})
    page.evaluate("delete state.blocks.find(b => b.id === 'q1').photo.off")
    select_photo(page)
    page.locator(".ph-panel button", has_text="Сделать видом по умолчанию").click()
    page.wait_for_function("bankEntry('lewis-bg').preset && bankEntry('lewis-bg').preset.rot === 15")
    ps = page.evaluate("bankEntry('lewis-bg').preset")
    assert ps["crop"] == {"l": 0.1, "t": 0, "r": 0, "b": 0.2} and ps["outline"] == {"w": 8, "color": "#f2c14e"} and ps["round"] == 0.2 and ps["filter"] == "bw"
    assert "off" not in ps
    # «Сбросить» — к виду по умолчанию целиком (и обводка, и поворот)
    page.evaluate("Object.assign(state.blocks.find(b => b.id === 'q1').photo, { rot:-40, outline:{ w:2, color:'#000000' }, round:.4 })")
    select_photo(page)
    page.locator(".ph-panel button", has_text="Сбросить").click()
    p = q(page)["photo"]
    assert p["rot"] == 15 and p["outline"] == {"w": 8, "color": "#f2c14e"} and p["round"] == 0.2 and p["crop"] == {"l": 0.1, "t": 0, "r": 0, "b": 0.2}
    assert not page.errors, page.errors


def test_reset_without_preset_clears_everything(page, sermon):
    open_quote(page, sermon, photo={"id": "ten-boom", "rot": 30, "crop": {"l": 0.2, "t": 0, "r": 0, "b": 0}, "outline": {"w": 5, "color": "#ffffff"}})
    select_photo(page)
    page.locator(".ph-panel button", has_text="Сбросить").click()
    assert q(page)["photo"] == {"id": "ten-boom", "x": None, "y": None, "h": None, "filter": "none", "mirror": True}
    assert not page.errors, page.errors


def test_preset_on_other_side_mirrors_crop_and_rotation(page, sermon):
    open_quote(page, sermon)
    r = page.evaluate("""() => { const a = { id:'x', kind:'cut', faces:'right', preset:{ x:.75, y:1, h:.9, side:'right', filter:'none', mirror:true,
        crop:{ l:.3, t:0, r:.1, b:0 }, rot:20, outline:{ w:6, color:'#ffffff' } } };
      const left = { type:'quote', half:'left' }, right = { type:'quote', half:'right' };
      return { same:presetPhoto(left, a), other:presetPhoto(right, a) }; }""")
    assert r["same"]["crop"] == {"l": 0.3, "t": 0, "r": 0.1, "b": 0} and r["same"]["rot"] == 20 and r["same"]["x"] == 0.75
    assert r["other"]["crop"] == {"l": 0.1, "t": 0, "r": 0.3, "b": 0} and r["other"]["rot"] == -20 and r["other"]["x"] == 0.25
    assert r["other"]["outline"] == {"w": 6, "color": "#ffffff"}
    assert not page.errors, page.errors


def test_only_admin_sees_preset_button(browser, base_url, sermon):
    ctx, pg = cloud_page(browser, base_url, user={"email": "ed@x.pl", "name": "Ред"}, members={"ed@x.pl": {"role": "editor"}})
    try:
        pg.wait_for_selector(".home-top")
        open_quote(pg, sermon, photo={"id": "lewis-cs", "rot": 10})
        select_photo(pg)
        pg.wait_for_selector(".ph-panel .ph-reset")
        assert pg.locator(".ph-panel", has_text="Сделать видом по умолчанию").count() == 0
        assert not pg.errors, pg.errors
    finally:
        ctx.close()


# ---------- Скрыть ----------

def test_on_slide_switch_hides_and_shows_again(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs", "rot": 10})
    page.wait_for_selector(".stage .ph-hit")
    page.locator(".side .grp-photo .ph-hide").click()
    assert q(page)["photo"]["off"] is True and q(page)["photo"]["rot"] == 10   # выбор и правки хранятся
    assert page.locator(".stage .ph-hit").count() == 0 and page.locator(".side .ph-adv").count() == 0
    page.locator(".side .grp-photo .ph-hide").click()
    assert "off" not in q(page)["photo"]
    page.wait_for_selector(".stage .ph-hit")
    assert not page.errors, page.errors


# ---------- Панель не попадает в JPEG и PowerPoint ----------

def test_bar_is_not_in_export(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs", "rot": 90})
    select_photo(page)
    html = page.evaluate("""async () => { const b = state.blocks.find(x => x.id === 'q1'); const s = new XMLSerializer().serializeToString(slideEl(b)); return s; }""")
    assert "ph-bar" not in html and "ph-hit" not in html
    assert not page.errors, page.errors


def test_pptx_photo_has_all_effects_and_frame_of_rotated_rect(page, sermon):
    pptx = pytest.importorskip("pptx")
    open_quote(page, sermon, first="Клайв", last="Льюис", photo={"id": "lewis-cs", "x": 0.25, "y": 1, "h": 0.9, "rot": 90, "outline": {"w": 10, "color": "#ffffff"}})
    with page.expect_download(timeout=120000) as dl:
        page.evaluate("exportPPTX()")
    path = dl.value.path()
    z = zipfile.ZipFile(path)
    n = page.evaluate("units().filter(b => TYPES[b.type].slide).findIndex(b => b.id === 'q1') + 1")
    prs = pptx.Presentation(path)
    pics = [sh for sh in list(prs.slides)[n - 1].shapes if sh.shape_type == 13]
    photo = pics[1]
    E = 12192000 / 1920
    ph = Image.open(io.BytesIO(z.read(f"ppt/media/photo{n}.png")))
    # картинка повёрнута на 90°: 353,5 × 972 стало 972 × 353,5, плюс обводка по 10 px с каждой стороны
    assert abs(ph.width - (972 + 20)) <= 2 and abs(ph.height - (354 + 20)) <= 2
    assert ph.mode == "RGBA" and ph.getpixel((0, 0))[3] == 0   # углы повёрнутой картинки прозрачные
    assert abs((photo.width + photo.crop_left * 0) - ph.width * E) < E * 40   # рамка по повёрнутому прямоугольнику (часть за краем слайда обрезана)
    assert not page.errors, page.errors


# ---------- Телефон ----------

@pytest.mark.parametrize("opts", [dict(viewport={"width": 700, "height": 900}),
                                  dict(viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True, device_scale_factor=2)])
def test_bar_at_bottom_on_phone(browser, base_url, sermon, opts):
    ctx, pg = cloud_page(browser, base_url, user=ME, members={"admin@x.pl": {"role": "editor"}}, **opts)
    try:
        pg.wait_for_selector(".home-top")
        open_quote(pg, sermon, photo={"id": "lewis-cs"})
        pg.wait_for_selector(".stage .ph-hit")
        pg.evaluate("photoCropStart('q1')")   # над фото панель только при обрезке
        pg.wait_for_selector(".ph-bar")
        bar = pg.locator(".ph-bar").bounding_box()
        assert pg.locator(".ph-bar").evaluate("e => getComputedStyle(e).position") == "fixed"
        assert abs(bar["y"] + bar["height"] - opts["viewport"]["height"]) < 2   # прижата к низу экрана
        assert bar["x"] <= 1 and bar["width"] >= opts["viewport"]["width"] - 2
        assert not pg.errors, pg.errors
    finally:
        ctx.close()
