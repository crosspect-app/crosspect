"""Этап 10.5.7: фото — отражение слева направо и сверху вниз кнопками (у всех видов фото; модель, JPEG по пикселям, PowerPoint,
вид по умолчанию), поворот только круглой стрелкой над выделенным фото (привязки к 0°, 90°, 180°, −90°, Alt — без них, угол рядом,
пока тянут; на телефоне — пальцем). Ползунка поворота и «На 90°» нет (проверка — в test_stage1053.py)."""
import io
import math
import zipfile
from pathlib import Path

import pytest
from PIL import Image

from conftest import cloud_page, ME, only_chromium
from test_stage105 import open_quote, q, red, blue
from test_stage1052 import open_q
from test_stage1053 import px, dark, adv, select_photo

ROOT = Path(__file__).resolve().parent.parent

# Льюис без фона при «Текст справа»: x 303…657, верх 108, низ 1080. «Голова» сверху уже плеч: у левого края сверху пусто, снизу — красное
TOP_LEFT, BOTTOM_LEFT = (330, 150), (330, 1050)


# ---------- Модель ----------

def test_norm_photo_keeps_flips_only_when_true(page):
    r = page.evaluate("""() => ({ on:normPhoto({ id:'a', flipH:true, flipV:true }), off:normPhoto({ id:'a', flipH:false, flipV:'yes' }),
      preset:normPreset({ x:.2, y:1, h:.9, side:'left', filter:'none', mirror:true, flipH:true, flipV:true }) })""")
    assert r["on"]["flipH"] is True and r["on"]["flipV"] is True
    assert "flipH" not in r["off"] and "flipV" not in r["off"]
    assert r["preset"]["flipH"] is True and r["preset"]["flipV"] is True
    assert not page.errors, page.errors


def test_old_conspect_without_flips_looks_the_same(page, sermon):
    open_quote(page, sermon, half="left", photo={"id": "lewis-cs", "mirror": False})
    assert page.evaluate("photoBox(state.blocks.find(b => b.id === 'q1')).flip") is False   # «Не отражать» из старых конспектов — как было
    assert "flipH" not in q(page)["photo"] and "flipV" not in q(page)["photo"]
    assert not page.errors, page.errors


# ---------- JPEG ----------

def test_flip_vertical_in_jpeg(page, sermon):
    open_quote(page, sermon)
    a, b = px(page, {}, [TOP_LEFT, BOTTOM_LEFT])
    assert dark(a) and red(b)
    a, b = px(page, {"flipV": True}, [TOP_LEFT, BOTTOM_LEFT])
    assert red(a) and not red(b)   # перевёрнуто: широкие плечи сверху, узкая «голова» снизу; левая половина осталась красной
    a, b = px(page, {"flipV": True, "crop": {"l": 0, "t": 0, "r": 0, "b": 0.5}}, [(330, 300), (330, 900)])
    assert red(a) and dark(b)   # обрезка задана, как фото видно: срезан низ
    assert not page.errors, page.errors


def test_flip_horizontal_on_background_photo_in_jpeg(page, sermon):
    open_q(page, sermon, photo={"id": "lewis-bg"})
    G = {"x": 0.25, "y": 0.9, "h": 0.4}
    a, b = px(page, G, [(400, 756), (560, 756)], id="lewis-bg")
    assert red(a) and blue(b)
    a, b = px(page, {**G, "flipH": True}, [(400, 756), (560, 756)], id="lewis-bg")
    assert blue(a) and red(b)   # «с фоном» тоже отражается кнопкой
    assert not page.errors, page.errors


# ---------- Кнопки ----------

def test_flip_buttons_toggle_and_mirror_crop_and_rotation(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs", "crop": {"l": 0.3, "t": 0.2, "r": 0.1, "b": 0}, "rot": 20})
    a = adv(page)
    assert a.locator(".ph-flip").inner_text().strip().endswith("Слева направо") and a.locator(".ph-flipv").inner_text().strip().endswith("Сверху вниз")
    a.locator(".ph-flipv").click()
    p = q(page)["photo"]
    assert p["flipV"] is True and p["crop"] == {"l": 0.3, "t": 0, "r": 0.1, "b": 0.2} and p["rot"] == -20
    assert page.locator(".side .ph-flipv").get_attribute("aria-pressed") == "true"
    assert page.evaluate("photoBox(state.blocks.find(b => b.id === 'q1')).flipV") is True
    page.locator(".side .ph-flip").click()   # текст справа: фото само не отражается — кнопка отражает
    p = q(page)["photo"]
    assert p["flipH"] is True and p["crop"] == {"l": 0.1, "t": 0, "r": 0.3, "b": 0.2} and p["rot"] == 20
    assert page.evaluate("photoBox(state.blocks.find(b => b.id === 'q1')).flip") is True
    page.evaluate("undo()")
    assert "flipH" not in q(page)["photo"] and q(page)["photo"]["flipV"] is True
    page.locator(".side .ph-flipv").click()
    assert "flipV" not in q(page)["photo"] and q(page)["photo"]["crop"]["t"] == 0.2
    assert not page.errors, page.errors


def test_flip_survives_text_side_switch(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs", "flipH": True})
    assert page.evaluate("photoBox(state.blocks.find(b => b.id === 'q1')).flip") is True
    page.locator(".side .toggle button", has_text="Текст слева").click()
    # само фото при «Тексте слева» отражается к тексту, кнопка отражает поверх: смотрит, как и раньше, от текста
    assert page.evaluate("photoBox(state.blocks.find(b => b.id === 'q1')).flip") is False
    assert not page.errors, page.errors


def test_preset_keeps_flips(page, sermon):
    open_quote(page, sermon)
    r = page.evaluate("""() => { const a = { id:'x', kind:'cut', faces:'right', preset:{ x:.25, y:1, h:.9, side:'left', filter:'none', mirror:true, flipH:true, flipV:true } };
      return presetPhoto({ type:'quote', half:'right' }, a); }""")
    assert r["flipH"] is True and r["flipV"] is True
    rules = (ROOT / "cloud" / "firestore.rules").read_text(encoding="utf-8")
    assert "'round', 'flipH', 'flipV'])" in rules and "p.flipV is bool" in rules
    tests = (ROOT / "cloud" / "tests" / "rules.test.mjs").read_text(encoding="utf-8")
    assert "этап 10.5.7: отражение по двум осям" in tests
    assert not page.errors, page.errors


def test_pptx_photo_flipped_vertically(page, sermon):
    pytest.importorskip("pptx")
    open_quote(page, sermon, first="Клайв", last="Льюис", photo={"id": "lewis-cs", "x": 0.25, "y": 1, "h": 0.9, "flipV": True})
    with page.expect_download(timeout=120000) as dl:
        page.evaluate("exportPPTX()")
    z = zipfile.ZipFile(dl.value.path())
    n = page.evaluate("units().filter(b => TYPES[b.type].slide).findIndex(b => b.id === 'q1') + 1")
    ph = Image.open(io.BytesIO(z.read(f"ppt/media/photo{n}.png"))).convert("RGBA")
    top, bottom = ph.getpixel((3, 3)), ph.getpixel((3, ph.height - 3))
    assert top[3] > 200 and top[0] > 200 and top[2] < 80   # сверху — плечи (красные)
    assert bottom[3] == 0   # снизу — узкая «голова», у края пусто
    assert not page.errors, page.errors


# ---------- Поворот стрелкой ----------

def settle(page):
    """Блок «Фото» прокручивается в вид плавно: дождаться, пока фото на экране перестанет сдвигаться"""
    page.wait_for_function("""() => new Promise(res => { const r = () => JSON.stringify(document.querySelector('.stage .ph-hit').getBoundingClientRect());
      const a = r(); setTimeout(() => requestAnimationFrame(() => res(a === r())), 150); })""")


def knob_drag(page, angles, alt=False):
    """Взять стрелку и провести по кругу вокруг середины фото: angles — углы по часовой от «вверх», в градусах. Вернуть подписи угла по ходу"""
    settle(page)
    hit = page.locator(".stage .ph-hit").bounding_box()
    kb = page.locator(".stage .ph-rot").bounding_box()
    cx, cy = hit["x"] + hit["width"] / 2, hit["y"] + hit["height"] / 2
    sx, sy = kb["x"] + kb["width"] / 2, kb["y"] + kb["height"] / 2
    R = math.hypot(sx - cx, sy - cy)
    page.mouse.move(sx, sy)
    page.mouse.down()
    if alt:
        page.keyboard.down("Alt")
    tags = []
    for a in angles:
        t = math.radians(a)
        page.mouse.move(cx + R * math.sin(t), cy - R * math.cos(t), steps=3)
        tags.append(page.locator(".stage .ph-angle").inner_text())
    if alt:
        page.keyboard.up("Alt")
    page.mouse.up()
    return tags


def test_knob_only_on_selected_photo(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs", "x": 0.25, "y": 1, "h": 0.6})
    page.wait_for_selector(".stage .ph-hit")
    assert not page.locator(".stage .ph-rot").is_visible()
    select_photo(page)
    assert page.locator(".stage .ph-rot").is_visible()
    hit, kb = page.locator(".stage .ph-hit").bounding_box(), page.locator(".stage .ph-rot").bounding_box()
    assert kb["y"] + kb["height"] < hit["y"] and abs(kb["x"] + kb["width"] / 2 - (hit["x"] + hit["width"] / 2)) < 2   # над рамкой, посередине
    page.evaluate("photoCropStart('q1')")
    assert not page.locator(".stage .ph-rot").is_visible()   # при обрезке поворота нет
    assert not page.errors, page.errors


def test_knob_rotates_snaps_and_shows_angle(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs", "x": 0.25, "y": 1, "h": 0.6})
    select_photo(page)
    before = page.evaluate("hist.undo.length")
    tags = knob_drag(page, [20, 45])
    assert abs(q(page)["photo"]["rot"] - 45) <= 1 and tags[-1] == str(q(page)["photo"]["rot"]) + "°"
    assert page.locator(".stage .ph-angle").count() == 0   # отпустили — угла не видно
    assert page.evaluate("hist.undo.length") == before + 1   # одна правка на весь поворот
    assert page.locator(".stage .ph-rot").is_visible()   # фото осталось выделенным
    knob_drag(page, [60, 137])   # стрелка крутится вместе с фото: угол — куда она смотрит
    assert abs(q(page)["photo"]["rot"] - 137) <= 1
    knob_drag(page, [100, 92])   # у 90° прилипает
    assert q(page)["photo"]["rot"] == 90
    assert "rotate(90deg)" in page.locator(".stage .ph-hit").evaluate("e => e.style.transform")
    knob_drag(page, [88], alt=True)   # Alt — без привязки
    assert abs(q(page)["photo"]["rot"] - 88) <= 1
    knob_drag(page, [1])   # у 0° прилипает: поворота нет
    assert "rot" not in q(page)["photo"]
    assert not page.errors, page.errors


def test_rotation_preview_turns_ready_picture(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs", "x": 0.25, "y": 1, "h": 0.6})
    select_photo(page)
    page.wait_for_function("document.querySelector('.stage .sl-photo img').getAttribute('src')")
    settle(page)
    hit = page.locator(".stage .ph-hit").bounding_box(); kb = page.locator(".stage .ph-rot").bounding_box()
    cx, cy = hit["x"] + hit["width"] / 2, hit["y"] + hit["height"] / 2
    page.mouse.move(kb["x"] + kb["width"] / 2, kb["y"] + kb["height"] / 2); page.mouse.down()
    page.mouse.move(cx + 200, cy, steps=4)   # вправо от середины — 90°
    assert "rotate(90deg)" in page.locator(".stage .sl-photo img").evaluate("e => e.style.transform")
    page.mouse.up()
    page.wait_for_function("!document.querySelector('.stage .sl-photo img').style.transform")   # отпустили — готовая картинка с поворотом
    assert q(page)["photo"]["rot"] == 90
    assert not page.errors, page.errors


def test_knob_by_finger_on_phone(browser, base_url, sermon):
    opts = dict(viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True, device_scale_factor=2)
    ctx, pg = cloud_page(browser, base_url, user=ME, members={"admin@x.pl": {"role": "editor"}}, **opts)
    try:
        pg.wait_for_selector(".home-top")
        open_quote(pg, sermon, photo={"id": "lewis-cs", "x": 0.25, "y": 1, "h": 0.6})
        pg.wait_for_selector(".stage .ph-hit")
        y0 = pg.evaluate("scrollY")
        pg.evaluate("photoSelect('q1')")
        settle(pg)
        assert pg.evaluate("scrollY") == y0   # на телефоне выделение не уводит слайд за экран
        kb = pg.locator(".stage .ph-rot").bounding_box()
        assert kb["width"] >= 33   # под палец
        hit = pg.locator(".stage .ph-hit").bounding_box()
        cx, cy = hit["x"] + hit["width"] / 2, hit["y"] + hit["height"] / 2
        only_chromium("касания через CDP")
        s = pg.context.new_cdp_session(pg)
        pt = lambda x, y: {"touchPoints": [{"x": x, "y": y}]}
        s.send("Input.dispatchTouchEvent", {"type": "touchStart", **pt(kb["x"] + kb["width"] / 2, kb["y"] + kb["height"] / 2)})
        for x, y in [(cx + 30, cy - 60), (cx + 60, cy - 60), (cx + 80, cy - 80)]:
            s.send("Input.dispatchTouchEvent", {"type": "touchMove", **pt(x, y)})
        s.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        assert abs(q(pg)["photo"]["rot"] - 45) <= 2   # пальцем — с точностью до касания
        assert not pg.errors, pg.errors
    finally:
        ctx.close()


def test_bank_snapshot_does_not_rebuild_photo_block(page, sermon):
    """Снимки фотобанка приходят по нескольку раз: блок «Фото» не собирается заново без нужды, иначе нажатая кнопка пропадала"""
    open_quote(page, sermon, photo={"id": "lewis-cs"})
    adv(page)
    r = page.evaluate("""() => { const btn = document.querySelector('.side .ph-crop-btn'); bankRebuild(); const same = btn.isConnected;
      photoBank.people['lewis-cs'].last = 'Льюис-Новый'; bankRebuild();
      return [same, btn.isConnected, document.querySelector('.side .ph-cur-name').textContent]; }""")
    assert r[0] is True   # ничего не поменялось — та же кнопка
    assert r[1] is False and "Льюис-Новый" in r[2]   # поменялось имя — блок собран заново
    assert not page.errors, page.errors


def test_crop_starts_before_photo_layer_exists(page, sermon):
    """«Обрезать», пока картинка фото ещё не готова и слоя на слайде нет (медленный интернет): обрезка не сбрасывается сама"""
    open_quote(page, sermon, photo={"id": "lewis-cs"})
    page.wait_for_selector(".stage .ph-layer")
    r = page.evaluate("""() => { document.querySelector('.stage .ph-layer').remove(); photoCropStart('q1');
      return [photoUI.crop, !!document.querySelector('.stage .ph-crop .pc-frame')]; }""")
    assert r == ["q1", True]
    assert not page.errors, page.errors
