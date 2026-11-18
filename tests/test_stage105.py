"""Этап 10.5: автор цитаты — отдельно имя и фамилия; фото автора из фотобанка у цитаты «Текст слева / справа»
(положение, размер, фильтр, отражение, «Сбросить», JPEG, PowerPoint); автор выбирается подсказкой из фотобанка или вводится сам;
вид фото по умолчанию и окно «Фотобанк» — только у админа; роли «Claude User» больше нет; tools/author_photo.py."""
import io
import json
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest
from PIL import Image

from conftest import open_sermon

ROOT = Path(__file__).resolve().parent.parent


def person_png(w=300, hh=600):
    """Прозрачный PNG: «человек» 200×550, левая половина красная, правая синяя — по ним видно отражение."""
    im = Image.new("RGBA", (w, hh), (0, 0, 0, 0))
    for x in range(50, 250):
        for y in range(50, hh):
            if y < 110 and not 110 <= x < 190: continue   # «голова» уже плеч: углы прозрачные
            im.putpixel((x, y), (255, 0, 0, 255) if x < 150 else (0, 0, 255, 255))
    buf = io.BytesIO(); im.save(buf, "PNG"); return buf.getvalue()


BANK = [
    {"id": "lewis-cs", "first": "Клайв", "last": "Льюис", "caption": "писатель · 1898–1963", "aliases": ["К. С. Льюис", "C. S. Lewis"], "file": "lewis-cs.webp", "w": 200, "h": 550, "faces": "right"},
    {"id": "ten-boom", "first": "Корри", "last": "тен Бум", "caption": "автор «Убежища» · 1892–1983", "aliases": ["Corrie ten Boom"], "file": "ten-boom.webp", "w": 200, "h": 550, "faces": "right"},
    {"id": "teresa", "first": "Мать", "last": "Тереза", "aliases": [], "file": "teresa.webp", "w": 200, "h": 550, "faces": "front"},
]


def bank_db(bank=BANK, body=None):
    """Фотобанк в подменённом облаке (этап 10.5.2): человек и одно фото «без фона» с тем же id, картинка — PNG в base64."""
    import base64
    if body is None:
        im = Image.open(io.BytesIO(person_png())).crop((50, 50, 250, 600)); buf = io.BytesIO(); im.save(buf, "PNG"); body = buf.getvalue()
    b64 = base64.b64encode(body).decode()
    people = {a.get("person", a["id"]): {"first": a["first"], "last": a["last"], "caption": a.get("caption", ""), "aliases": a.get("aliases", [])} for a in bank}
    photos = {a["id"]: {"person": a.get("person", a["id"]), "kind": a.get("kind", "cut"), "w": a["w"], "h": a["h"], "order": a.get("order", 0),
                        "source": "", "thumb": b64, **({"faces": a["faces"]} if a.get("kind", "cut") == "cut" else {})} for a in bank}
    return people, photos, {a["id"]: b64 for a in bank}


def with_bank(page, bank=BANK):
    people, photos, files = bank_db(bank)
    page.evaluate("""([p, f, x]) => { const db = fakeCloud.db(); db.bankPeople = p; db.bankPhotos = f; db.bankFiles = x; fakeCloud.put(db); }""", [people, photos, files])


def quote_sermon(sermon, **q):
    s = dict(sermon)
    b = {"id": "q1", "type": "quote", "text": "Вера — это доверие", "half": "right", "halfW": 50}
    b.update(q)
    s["blocks"] = [x for x in sermon["blocks"] if x["type"] == "splash"][:1] + [b]
    return s


def open_quote(page, sermon, **q):
    with_bank(page)
    open_sermon(page, quote_sermon(sermon, **q))
    page.evaluate("selectBlock('q1')")
    page.wait_for_selector(".stage.t-quote .sl")
    page.evaluate("loadPhotoBank()")
    page.wait_for_function("photoBank.loaded && photoBank.list.length === 3")


def q(page):
    return page.evaluate("state.blocks.find(b => b.id === 'q1')")


# ---------- Имя и фамилия ----------

def test_old_quotes_get_first_and_last(page):
    r = page.evaluate("""() => normalize({ v:2, blocks:[
      { id:'a', type:'quote', text:'x', author:'Мартин Лютер Кинг' },
      { id:'b', type:'quote', text:'x', author:'Жан Кальвин, Наставление' },
      { id:'c', type:'quote', text:'x', author:'Августин', caption:'Исповедь' },
      { id:'d', type:'quote', text:'x', first:'Корри', last:'тен Бум', author:'не то' },
      { id:'e', type:'quote', text:'x' }] }).blocks.map(b => [b.first, b.last, b.caption, 'author' in b])""")
    assert r == [["Мартин Лютер", "Кинг", "", False], ["Жан", "Кальвин", "Наставление", False], ["", "Августин", "Исповедь", False],
                 ["Корри", "тен Бум", "", False], ["", "", "", False]]
    assert page.evaluate("newBlock('quote').first === '' && newBlock('quote').last === '' && newBlock('quote').photo === null")


def test_last_name_bold_whole_field_and_names_everywhere(page, sermon):
    open_sermon(page, quote_sermon(sermon, first="Корри", last="тен Бум", caption="Убежище", half="full"))
    r = page.evaluate("""() => { const b = state.blocks.find(x => x.id === 'q1'), n = slideNums()[b.id];
      return { html:authorHTML(b), name:slideName(b, n), count:charCount(b), who:quoteAuthor(b) }; }""")
    assert r["html"].startswith("Корри <b>тен") and "Бум</b>" in r["html"]
    assert r["name"].endswith("цитата Корри ТЕН БУМ")
    assert r["who"] == "Корри тен Бум"
    assert r["count"] == len("Вера — это доверие") + len("Корри тен Бум") + len("Убежище")
    # только фамилия или только имя
    assert page.evaluate("authorHTML({ first:'', last:'Августин', caption:'' })") == "<b>Августин</b>"
    assert page.evaluate("authorHTML({ first:'Мать', last:'', caption:'' })") == "Мать"
    assert page.evaluate("quoteNamePart({ first:'', last:'' })") == "цитата"
    assert not page.errors, page.errors


def test_text_view_and_pdf_show_full_name(page, sermon):
    open_sermon(page, quote_sermon(sermon, first="Клайв", last="Льюис", caption="Просто христианство", half="full"))
    page.evaluate("buildOperatorPrint && buildOperatorPrint()")
    assert "— Клайв Льюис, Просто христианство" in page.inner_text("#print-op")
    page.evaluate("navigate(sermonHash(state.id, 'text'))")
    page.wait_for_selector(".vs-author")
    assert page.inner_text(".vs-author") == "— Клайв Льюис, Просто христианство"
    assert not page.errors, page.errors


def test_panel_has_first_and_last_fields_and_find_replace_both(page, sermon):
    open_sermon(page, quote_sermon(sermon, first="Клайв", last="Льюис", half="full"))
    page.evaluate("selectBlock('q1')")
    side = page.locator(".side")
    first = side.locator("label.field", has_text="Имя").first.locator("input")
    last = side.locator("label.field", has_text="Фамилия").locator("input")
    assert first.input_value() == "Клайв" and last.input_value() == "Льюис"
    last.fill("тен Бум")
    assert q(page)["last"] == "тен Бум"
    assert side.locator(".ph-panel").count() == 0   # фото — только у «Текст слева / справа»
    labels = page.evaluate("findFields(state.blocks.find(b => b.id === 'q1')).map(f => f.label)")
    assert "Имя автора цитаты" in labels and "Фамилия автора цитаты" in labels
    assert not page.errors, page.errors


# ---------- Модель фото ----------

def test_photo_normalize(page):
    r = page.evaluate("""() => [
      { id:'lewis-cs', x:0.3, y:1, h:0.8, filter:'sepia', mirror:false },
      { id:'Bad Id' }, null, 'x',
      { id:'lewis-cs', x:'a', y:99, h:0.01, filter:'neon' }].map(p => normalize({ v:2, blocks:[{ id:'q', type:'quote', text:'x', photo:p }] }).blocks[0].photo)""")
    assert r[0] == {"id": "lewis-cs", "x": 0.3, "y": 1, "h": 0.8, "filter": "sepia", "mirror": False}
    assert r[1] is None and r[2] is None and r[3] is None
    assert r[4] == {"id": "lewis-cs", "x": None, "y": None, "h": None, "filter": "none", "mirror": True}


def test_search_aliases_and_match_on_top(page, sermon):
    open_quote(page, sermon, first="Корри", last="тен Бум")
    ids = lambda qq: page.evaluate("q => photoSearch(q, state.blocks.find(b => b.id === 'q1')).map(a => a.id)", qq)
    assert ids("") [0] == "ten-boom"   # совпадение с именем и фамилией цитаты — сверху
    assert ids("льюис") == ["lewis-cs"] and ids("c. s.") == ["lewis-cs"] and ids("к с льюис") == ["lewis-cs"]
    assert ids("бум") == ["ten-boom"] and ids("corrie") == ["ten-boom"]
    assert ids("пайпер") == []
    assert not page.errors, page.errors


def sugg(page):
    return page.locator(".side .au-sugg .au-item")


def test_pick_from_suggestions_replaces_names_and_caption(page, sermon):
    open_quote(page, sermon, caption="Старая подпись")
    page.locator(".side input[placeholder='тен Бум']").fill("льюис")
    assert sugg(page).count() == 1 and "писатель · 1898–1963" in sugg(page).first.inner_text()
    sugg(page).first.click()
    b = q(page)
    assert (b["first"], b["last"], b["caption"]) == ("Клайв", "Льюис", "писатель · 1898–1963")
    assert b["photo"] == {"id": "lewis-cs", "x": None, "y": None, "h": None, "filter": "none", "mirror": True}
    assert page.locator(".side .au-sugg").is_hidden()
    # выбрали другого — всё прежнее затирается; ↶ возвращает
    page.locator(".side input[placeholder='Корри']").fill("Корри")
    page.locator(".side input[placeholder='Корри']").press("ArrowDown")
    page.locator(".side input[placeholder='Корри']").press("Enter")
    b = q(page)
    assert (b["first"], b["last"], b["photo"]["id"]) == ("Корри", "тен Бум", "ten-boom")
    page.evaluate("undo()")
    b = q(page)
    assert b["photo"]["id"] == "lewis-cs"
    assert not page.errors, page.errors


def test_manual_author_without_photo_and_no_ask(page, sermon):
    open_quote(page, sermon)
    page.locator(".side input[placeholder='Корри']").fill("Джон")
    page.locator(".side input[placeholder='тен Бум']").fill("Пайпер")
    assert sugg(page).count() == 0
    b = q(page)
    assert (b["first"], b["last"], b["photo"]) == ("Джон", "Пайпер", None)
    assert page.locator(".side .ph-panel").count() == 0
    side = page.locator(".side").inner_text()
    assert "Попросить фото" not in side and "фото нет" not in side.lower()
    assert not page.errors, page.errors


def test_search_only_by_names_not_caption(page, sermon):
    open_quote(page, sermon)
    ids = lambda qq: page.evaluate("q => photoSearch(q, null).map(a => a.id)", qq)
    assert ids("писатель") == [] and ids("1898") == []
    page.locator(".side input[placeholder='тен Бум']").fill("писатель")
    assert sugg(page).count() == 0


def test_edit_name_keeps_photo_and_on_slide_switch(page, sermon):
    open_quote(page, sermon)
    page.locator(".side input[placeholder='тен Бум']").fill("бум")
    sugg(page).first.click()
    page.locator(".side input[placeholder='Корри']").fill("Корнелия")
    assert q(page)["photo"]["id"] == "ten-boom"   # связь с банком остаётся
    page.evaluate("Object.assign(state.blocks.find(b => b.id === 'q1').photo, { x:0.3, filter:'sepia' })")
    page.locator(".side .ph-panel .switch", has_text="На слайде").click()
    b = q(page)
    assert b["photo"]["off"] is True and b["photo"]["x"] == 0.3 and (b["first"], b["last"]) == ("Корнелия", "тен Бум")
    assert page.evaluate("photoBox(state.blocks.find(b => b.id === 'q1'))") is None   # не видно нигде: слайд, JPEG, PowerPoint
    assert page.locator(".side .ph-panel .ph-filter").count() == 0 and page.locator(".side .ph-panel .ph-reset").count() == 0
    assert page.locator(".side .ph-panel", has_text="Без фото").count() == 0
    # включили — всё как было
    page.locator(".side .ph-panel .switch", has_text="На слайде").click()
    b = q(page)
    assert "off" not in b["photo"] and b["photo"]["x"] == 0.3 and b["photo"]["filter"] == "sepia"
    assert page.evaluate("!!photoBox(state.blocks.find(b => b.id === 'q1'))")
    # в файле сохраняется; неверное значение — включено
    assert page.evaluate("normPhoto({ id:'ten-boom', off:true }).off") is True
    assert page.evaluate("'off' in normPhoto({ id:'ten-boom', off:'да' })") is False
    assert not page.errors, page.errors


PRESET = {"x": 0.3, "y": 1.05, "h": 1.2, "side": "left", "filter": "bw", "mirror": False}


def set_preset(page, id="lewis-cs", preset=PRESET, **extra):
    page.evaluate("([id, f]) => { const db = fakeCloud.db(); Object.assign(db.bankPhotos[id], f); fakeCloud.put(db); }",
                  [id, dict(preset=preset, **extra)])
    page.wait_for_function("id => { const a = bankEntry(id); return a && !!a.preset; }", arg=id)


def test_preset_applies_on_pick_and_reset_mirrored_for_other_side(page, sermon):
    open_quote(page, sermon, photo={"id": "ten-boom", "x": 0.2, "y": 1, "h": 0.5}, first="Корри", last="тен Бум")
    set_preset(page)
    assert q(page)["photo"]["x"] == 0.2   # поставленные фото не меняются
    # «Текст справа» → фото слева, как у вида по умолчанию
    page.locator(".side input[placeholder='тен Бум']").fill("льюис")
    sugg(page).first.click()
    assert q(page)["photo"] == {"id": "lewis-cs", "x": 0.3, "y": 1.05, "h": 1.2, "filter": "bw", "mirror": False}
    page.evaluate("Object.assign(state.blocks.find(b => b.id === 'q1').photo, { x:0.5, filter:'none' })")
    page.locator(".side .toggle button", has_text="Текст слева").click()   # фото справа
    page.locator(".ph-panel button", has_text="Сбросить").click()
    assert q(page)["photo"] == {"id": "lewis-cs", "x": 0.7, "y": 1.05, "h": 1.2, "filter": "bw", "mirror": False}
    assert not page.errors, page.errors


def test_preset_from_full_width_lands_on_photo_side(page, sermon):
    open_quote(page, sermon, half="full")
    set_preset(page)
    page.locator(".side input[placeholder='тен Бум']").fill("льюис")
    sugg(page).first.click()
    assert q(page)["photo"]["x"] == 0.3
    page.locator(".side .toggle button", has_text="Текст слева").click()   # фото должно быть справа
    assert q(page)["photo"]["x"] == 0.7
    assert not page.errors, page.errors


def test_admin_saves_preset(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs", "x": 0.25, "y": 0.98, "h": 0.8, "filter": "sepia", "mirror": True}, half="left", halfW=50)
    page.locator(".ph-panel button", has_text="Сделать видом по умолчанию").click()
    page.wait_for_function("(() => { const a = (fakeCloud.db().bankPhotos || {})['lewis-cs']; return a && a.preset; })()")
    ps = page.evaluate("fakeCloud.db().bankPhotos['lewis-cs'].preset")
    assert ps == {"x": 0.25, "y": 0.98, "h": 0.8, "side": "right", "filter": "sepia", "mirror": True}
    assert not page.errors, page.errors


def test_preset_button_and_photobank_only_for_admin(browser, base_url, sermon):
    from conftest import cloud_page
    ctx, pg = cloud_page(browser, base_url, user={"email": "ed@x.pl", "name": "Ред"}, members={"ed@x.pl": {"role": "editor"}}, admins=())
    try:
        pg.wait_for_selector(".home-top")
        open_quote(pg, sermon, photo={"id": "lewis-cs"})
        pg.wait_for_selector(".ph-panel .ph-reset")
        assert pg.locator(".ph-panel", has_text="Сделать видом по умолчанию").count() == 0
        assert pg.evaluate("typeof openPhotoBank") == "function"
        pg.evaluate("openPhotoBank()")
        assert pg.locator(".pb-sheet").count() == 0
        items = pg.evaluate("(() => { const out = []; const d = dropdown; window.dropdown = (a, it) => { out.push(...it.map(x => x.label)); }; spaceMenu(document.body); window.dropdown = d; return out; })()")
        assert "Фотобанк" not in items
        with pytest.raises(Exception):
            pg.evaluate("cloud.api.setBankPerson(cloud.user, 'lewis-cs', { first:'X' })")
        assert not pg.errors, pg.errors
    finally:
        ctx.close()


def test_photobank_window_edits_names_for_everyone(page, sermon):
    open_quote(page, sermon)
    items = page.evaluate("(() => { const out = []; const d = dropdown; window.dropdown = (a, it) => { out.push(...it.map(x => x.label)); }; spaceMenu(document.body); window.dropdown = d; return out; })()")
    assert "Фотобанк" in items
    page.evaluate("openPhotoBank()")
    sheet = page.locator(".pb-sheet")
    sheet.wait_for()
    assert sheet.locator(".pb-row").count() == 3
    sheet.locator(".pb-q").fill("льюис")
    assert sheet.locator(".pb-row").count() == 1
    row = sheet.locator(".pb-row").first
    assert row.locator(".pb-save").is_disabled()
    row.locator("input[placeholder='Подпись']").fill("писатель, богослов · 1898–1963")
    row.locator("input[placeholder='Другие написания']").fill("К. С. Льюис; Джек Льюис")
    row.locator(".pb-save").click()
    page.wait_for_function("fakeCloud.db().bankPeople['lewis-cs'].caption === 'писатель, богослов · 1898–1963'")
    saved = page.evaluate("fakeCloud.db().bankPeople['lewis-cs']")
    assert saved["caption"] == "писатель, богослов · 1898–1963" and saved["aliases"] == ["К. С. Льюис", "Джек Льюис"]
    page.wait_for_function("bankEntry('lewis-cs').caption === 'писатель, богослов · 1898–1963'")
    assert page.evaluate("photoSearch('джек', null).map(a => a.id)") == ["lewis-cs"]
    page.evaluate("closeSettings(true)")
    page.locator(".side input[placeholder='тен Бум']").fill("джек")
    sugg(page).first.click()
    assert q(page)["caption"] == "писатель, богослов · 1898–1963"
    assert not page.errors, page.errors


def test_default_position_mirror_and_front(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs"})
    box = lambda: page.evaluate("(() => { const r = photoBox(state.blocks.find(b => b.id === 'q1')); return r && [Math.round(r.left + r.width / 2), Math.round(r.top + r.height), Math.round(r.height), r.flip]; })()")
    assert box() == [480, 1080, 972, False]   # «Текст справа»: середина левой зоны, нижний край, 90 % высоты, как в банке
    page.evaluate("Object.assign(state.blocks.find(b => b.id === 'q1'), { half:'left', halfW:30 })")
    assert box() == [1920 - 672, 1080, 972, True]   # «Текст слева»: зона справа (70 %), отражено — смотрит к тексту
    page.evaluate("state.blocks.find(b => b.id === 'q1').photo.mirror = false")
    assert box()[3] is False   # «Не отражать»
    page.evaluate("Object.assign(state.blocks.find(b => b.id === 'q1').photo, { id:'teresa', mirror:true })")
    assert box()[3] is False   # анфас не отражается
    page.evaluate("state.blocks.find(b => b.id === 'q1').half = 'full'")
    assert box() is None


def test_photo_on_slide_hidden_on_full_width_and_kept(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs", "x": 0.3, "y": 0.95, "h": 0.5})
    img = ".stage .sl-photo img"
    page.wait_for_function("(() => { const i = document.querySelector('.stage .sl-photo img'); return i && i.style.display === 'block' && i.complete && i.naturalWidth > 0; })()")
    # текст цитаты поверх фото: фото раньше в DOM и без z-index
    order = page.evaluate("[...document.querySelector('.stage .sl-stage').children].map(x => x.className)")
    assert order.index("sl-photo") < order.index("sl-box sl-box-quote")
    page.locator(".side .toggle button", has_text="Во всю ширину").click()
    page.wait_for_function("document.querySelector('.stage .sl-photo img').style.display === 'none'")
    assert q(page)["photo"]["x"] == 0.3   # хранится
    assert page.locator(".side .ph-panel").count() == 0
    page.locator(".side .toggle button", has_text="Текст справа").click()
    page.wait_for_function("document.querySelector('.stage .sl-photo img').style.display === 'block'")
    assert q(page)["photo"]["x"] == 0.3
    page.locator(".side .toggle button", has_text="Текст слева").click()   # в другую зону — зеркально
    assert q(page)["photo"]["x"] == 0.7
    assert not page.errors, page.errors


def test_drag_resize_and_reset(page, sermon):
    open_quote(page, sermon, photo={"id": "lewis-cs"})
    page.wait_for_selector(".stage .ph-hit")
    hit = page.locator(".stage .ph-hit").bounding_box()
    page.mouse.move(hit["x"] + hit["width"] / 2, hit["y"] + hit["height"] / 2)
    page.mouse.down(); page.mouse.move(hit["x"] + hit["width"] / 2 + 60, hit["y"] + hit["height"] / 2 - 30, steps=5); page.mouse.up()
    p = q(page)["photo"]
    assert p["x"] > 0.25 and p["y"] < 1 and abs(p["h"] - 0.9) < 0.001
    # за угол — крупнее, пропорции те же
    hit = page.locator(".stage .ph-hit").bounding_box()
    page.mouse.move(hit["x"] + hit["width"], hit["y"] + 2)
    page.mouse.down(); page.mouse.move(hit["x"] + hit["width"] + 40, hit["y"] - 80, steps=5); page.mouse.up()
    p2 = q(page)["photo"]
    assert p2["h"] > p["h"] + 0.05
    assert abs((p2["y"]) - p["y"]) < 0.002   # противоположный (нижний левый) угол на месте
    # фильтр (этап 10.5.3: в панели над фото) и «Сбросить»
    page.locator(".stage .ph-hit").click()
    page.locator(".ph-bar .ph-b-filter").click()
    page.locator(".ph-bar .ph-opt[data-f='bw']").click()
    assert q(page)["photo"]["filter"] == "bw"
    page.locator(".ph-panel button", has_text="Сбросить").click()
    p3 = q(page)["photo"]
    assert (p3["x"], p3["y"], p3["h"], p3["filter"]) == (None, None, None, "none")
    assert not page.errors, page.errors


def test_view_mode_has_no_drag_layer(page, sermon):
    with_bank(page)
    open_sermon(page, quote_sermon(sermon, photo={"id": "lewis-cs"}), edit=False)
    page.evaluate("selectBlock('q1')")
    page.wait_for_function("(() => { const i = document.querySelector('.stage .sl-photo img'); return i && i.style.display === 'block'; })()")
    assert page.locator(".stage .ph-layer").count() == 0


# ---------- Выгрузка ----------

SAMPLE = """async ([half, filter, mirror]) => {
  const b = state.blocks.find(x => x.id === 'q1');
  Object.assign(b, { half, text:'.' }); b.photo = { id:'lewis-cs', x:null, y:null, h:null, filter, mirror };
  const blob = await renderJPEG(b), url = URL.createObjectURL(blob), im = new Image(); im.src = url; await im.decode();
  const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
  const px = (a, y) => [...x.getImageData(a, y, 1, 1).data].slice(0, 3);
  return { type:blob.type, at:[px(390, 800), px(570, 800), px(1350, 800), px(1530, 800)] };
}"""


def red(c): return c[0] > 180 and c[1] < 80 and c[2] < 80
def blue(c): return c[2] > 180 and c[0] < 80 and c[1] < 80


def test_jpeg_draws_photo_with_mirror_and_filter(page, sermon):
    open_quote(page, sermon)
    r = page.evaluate(SAMPLE, ["right", "none", True])
    assert r["type"] == "image/jpeg"
    assert red(r["at"][0]) and blue(r["at"][1])   # слева, как в банке
    r = page.evaluate(SAMPLE, ["left", "none", True])
    assert blue(r["at"][2]) and red(r["at"][3])   # справа, отражено
    r = page.evaluate(SAMPLE, ["left", "none", False])
    assert red(r["at"][2]) and blue(r["at"][3])   # «Не отражать»
    r = page.evaluate(SAMPLE, ["right", "bw", True])
    c = r["at"][0]
    assert max(c) - min(c) < 16   # ЧБ
    assert not page.errors, page.errors


def test_every_filter_paints(page, sermon):
    open_quote(page, sermon)
    out = page.evaluate("""async () => { const a = bankEntry('lewis-cs'), res = {};
      for (const [f] of PHOTO_FILTERS){ const v = await photoVariant(a, f, false); res[f] = [...v.canvas.getContext('2d').getImageData(10, 300, 1, 1).data]; }
      return res; }""")
    assert set(out) == {"none", "bw", "bwHard", "bwSoft", "sepia", "warm", "cool", "muted", "tone"}
    assert out["none"][:3] == [255, 0, 0] and all(v[3] == 255 for v in out.values())
    assert len({tuple(v) for v in out.values()}) >= 8   # фильтры разные
    assert not page.errors, page.errors


def test_pptx_photo_is_separate_picture_between_back_and_text(page, sermon):
    pptx = pytest.importorskip("pptx")
    open_quote(page, sermon, first="Клайв", last="Льюис", photo={"id": "lewis-cs", "x": 0.05, "y": 1, "h": 0.9})
    with page.expect_download(timeout=120000) as dl:
        page.evaluate("exportPPTX()")
    path = dl.value.path()
    z = zipfile.ZipFile(path)
    names = z.namelist()
    n = page.evaluate("units().filter(b => TYPES[b.type].slide).findIndex(b => b.id === 'q1') + 1")
    assert f"ppt/media/photo{n}.png" in names and f"ppt/media/text{n}.png" in names
    prs = pptx.Presentation(path)
    pics = [sh for sh in list(prs.slides)[n - 1].shapes if sh.shape_type == 13]
    assert [p.name for p in pics] == [pics[0].name, "Фото автора", "Текст"]   # фон, фото, текст поверх
    photo = pics[1]
    E = 12192000 / 1920
    assert photo.left == 0   # фото выходит за левый край: обрезано по краю слайда
    assert photo.crop_left > 0 and photo.crop_right == 0
    assert abs(photo.height - 972 * E) < E * 2
    text = Image.open(io.BytesIO(z.read(f"ppt/media/text{n}.png")))
    assert text.mode == "RGBA" and text.getpixel((5, 5))[3] == 0   # слой текста прозрачный
    ph = Image.open(io.BytesIO(z.read(f"ppt/media/photo{n}.png")))
    assert ph.size == (200, 550)
    assert not page.errors, page.errors


def test_pdf_and_operator_snapshot_without_photo(page, sermon):
    open_quote(page, sermon, first="Клайв", last="Льюис", photo={"id": "lewis-cs"})
    page.evaluate("buildOperatorPrint()")
    assert page.locator("#print-op img").count() == 0
    snap = page.evaluate("JSON.stringify(opSnapshot(state))")
    assert "lewis-cs" not in snap and "Клайв Льюис" in snap


# ---------- Роли «Claude User» больше нет ----------

def test_no_claude_role(page):
    assert page.evaluate("'claude' in ROLE_LABEL") is False
    assert page.evaluate("typeof photoAsk") == "undefined"
    rules = (ROOT / "cloud" / "firestore.rules").read_text(encoding="utf-8")
    assert "['editor', 'preacher', 'operator']" in rules and "'claude'" not in rules
    # старая запись с этой ролью показывается оператором
    page.evaluate("() => { const db = fakeCloud.db(); db.members['p-old001'] = { role:'claude', firstName:'Виталий', tg:'vitaliy_b' }; fakeCloud.put(db); }")
    page.wait_for_function("(cloud.people || []).some(p => p.key === 'p-old001' && p.role === 'operator')")


# ---------- Скрипт фотобанка ----------

def test_author_photo_script(tmp_path):
    src = tmp_path / "x.png"; src.write_bytes(person_png())
    bank = tmp_path / "bank"
    run = lambda *a: subprocess.run([sys.executable, str(ROOT / "tools" / "author_photo.py"), str(src), "--bank", str(bank), *a],
                                    capture_output=True, text=True)
    r = run("--id", "lewis-cs", "--first", "Клайв", "--last", "Льюис", "--caption", "писатель · 1898–1963", "--aliases", "К. С. Льюис; C. S. Lewis", "--faces", "left", "--source", "Тест")
    assert r.returncode == 0, r.stderr
    im = Image.open(bank / "lewis-cs.webp")
    assert im.format == "WEBP" and im.mode == "RGBA" and (im.width, im.height) == (200, 550)   # прозрачные поля обрезаны, мелкое не растягивается (10.5.2)
    left = im.getpixel((20, 400)); assert left[2] > 200 and left[0] < 60   # было «смотрит влево»: развёрнуто, слева теперь синее
    lst = json.loads((bank / "authors.json").read_text(encoding="utf-8"))
    assert lst[0]["id"] == "lewis-cs" and lst[0]["faces"] == "right" and lst[0]["aliases"] == ["К. С. Льюис", "C. S. Lewis"]
    assert lst[0]["caption"] == "писатель · 1898–1963"
    assert lst[0]["w"] == im.width and lst[0]["h"] == 550 and lst[0]["source"] == "Тест" and lst[0]["added"]
    r = run("--id", "teresa", "--first", "Мать", "--last", "Тереза", "--faces", "front")
    assert r.returncode == 0, r.stderr
    lst = json.loads((bank / "authors.json").read_text(encoding="utf-8"))
    assert [a["id"] for a in lst] == ["lewis-cs", "teresa"] and lst[1]["faces"] == "front"   # по фамилии
    im = Image.open(bank / "teresa.webp"); assert im.getpixel((20, 400))[0] > 200   # анфас не развёрнут
    opaque = tmp_path / "o.png"; Image.new("RGB", (10, 10)).save(opaque)
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "author_photo.py"), str(opaque), "--bank", str(bank), "--id", "x", "--last", "Икс", "--faces", "right"], capture_output=True, text=True)
    assert r.returncode != 0 and "прозрачного фона" in r.stderr


def test_bank_file_is_valid():
    lst = json.loads((ROOT / "img" / "authors" / "authors.json").read_text(encoding="utf-8"))
    assert isinstance(lst, list)
    for a in lst:
        assert (ROOT / "img" / "authors" / a["file"]).exists(), a["id"]
        assert (ROOT / "img" / "authors" / a["thumb"]).exists(), a["id"]
        assert a["kind"] in ("cut", "bg") and a["person"] and a["w"] > 0 and 0 < a["h"] <= 1600 and (a["first"] or a["last"])
        assert a["kind"] == "bg" or a["faces"] in ("right", "front")
