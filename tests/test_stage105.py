"""Этап 10.5: автор цитаты — отдельно имя и фамилия; фото автора из фотобанка у цитаты «Текст слева / справа»
(положение, размер, фильтр, отражение, «Сбросить», JPEG, PowerPoint), «Попросить фото», роль «Claude User», tools/author_photo.py."""
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
    {"id": "lewis-cs", "first": "Клайв", "last": "Льюис", "aliases": ["К. С. Льюис", "C. S. Lewis"], "file": "lewis-cs.webp", "w": 200, "h": 550, "faces": "right"},
    {"id": "ten-boom", "first": "Корри", "last": "тен Бум", "aliases": ["Corrie ten Boom"], "file": "ten-boom.webp", "w": 200, "h": 550, "faces": "right"},
    {"id": "teresa", "first": "Мать", "last": "Тереза", "aliases": [], "file": "teresa.webp", "w": 200, "h": 550, "faces": "front"},
]


def with_bank(page, bank=BANK):
    im = Image.open(io.BytesIO(person_png())).crop((50, 50, 250, 600)); buf = io.BytesIO(); im.save(buf, "PNG"); body = buf.getvalue()
    page.route("**/img/authors/authors.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(bank, ensure_ascii=False)))
    page.route("**/img/authors/*.webp", lambda r: r.fulfill(status=200, content_type="image/png", body=body))


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


def test_pick_photo_fills_empty_names_only(page, sermon):
    open_quote(page, sermon)
    page.locator(".ph-panel .ph-q").fill("льюис")
    page.locator(".ph-panel .ph-item").first.click()
    b = q(page)
    assert b["photo"]["id"] == "lewis-cs" and b["first"] == "Клайв" and b["last"] == "Льюис"
    page.locator(".ph-panel button", has_text="Заменить").click()
    page.locator(".ph-panel .ph-q").fill("бум")
    page.locator(".ph-panel .ph-item").first.click()
    b = q(page)
    assert b["photo"]["id"] == "ten-boom" and b["last"] == "Льюис"   # заполненные поля не трогаем
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
    # фильтр и «Сбросить»
    page.locator(".ph-panel select.ph-filter").select_option("bw")
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


# ---------- Попросить фото и Claude User ----------

def test_ask_photo_goes_to_claude_user_in_telegram(page, sermon):
    open_quote(page, sermon, first="Джон", last="Пайпер")
    page.evaluate("() => { window._opened = []; window.open = u => { window._opened.push(u); }; }")
    page.evaluate("""setPeople([{ key:'p-claude1', role:'claude', firstName:'Виталий', tg:'vitaliy_b' },
                               { key:'p-op1', role:'operator', firstName:'Пётр', tg:'petr_op' }]); photoRepaintAll();""")
    panel = page.locator(".side .ph-panel")
    assert "Фото этого автора в фотобанке нет." in panel.inner_text()
    panel.get_by_role("button", name="Попросить фото").click()
    url = page.evaluate("window._opened[0]")
    assert url.startswith("https://t.me/vitaliy_b?text=")
    from urllib.parse import unquote
    text = unquote(url.split("?text=")[1])
    assert text.startswith("Нужно фото автора цитаты: Джон Пайпер") and "#s=" in text
    # никого с ролью Claude User — Telegram с выбором чата
    page.evaluate("setPeople([]); window._opened = []")
    panel.get_by_role("button", name="Попросить фото").click()
    assert page.evaluate("window._opened[0]").startswith("https://t.me/share/url?url=")
    assert not page.errors, page.errors


def test_claude_role_label_and_no_login(page):
    assert page.evaluate("ROLE_LABEL.claude") == "Claude User"
    assert page.evaluate("NO_LOGIN.claude") == "Claude User в форму не входит"
    rules = (ROOT / "cloud" / "firestore.rules").read_text(encoding="utf-8")
    assert "['editor', 'preacher', 'operator', 'claude']" in rules


# ---------- Скрипт фотобанка ----------

def test_author_photo_script(tmp_path):
    src = tmp_path / "x.png"; src.write_bytes(person_png())
    bank = tmp_path / "bank"
    run = lambda *a: subprocess.run([sys.executable, str(ROOT / "tools" / "author_photo.py"), str(src), "--bank", str(bank), *a],
                                    capture_output=True, text=True)
    r = run("--id", "lewis-cs", "--first", "Клайв", "--last", "Льюис", "--aliases", "К. С. Льюис; C. S. Lewis", "--faces", "left", "--source", "Тест")
    assert r.returncode == 0, r.stderr
    im = Image.open(bank / "lewis-cs.webp")
    assert im.format == "WEBP" and im.mode == "RGBA" and im.height == 1600
    assert abs(im.width - round(200 * 1600 / 550)) <= 1   # прозрачные поля обрезаны
    left = im.getpixel((20, 800)); assert left[2] > 200 and left[0] < 60   # было «смотрит влево»: развёрнуто, слева теперь синее
    lst = json.loads((bank / "authors.json").read_text(encoding="utf-8"))
    assert lst[0]["id"] == "lewis-cs" and lst[0]["faces"] == "right" and lst[0]["aliases"] == ["К. С. Льюис", "C. S. Lewis"]
    assert lst[0]["w"] == im.width and lst[0]["h"] == 1600 and lst[0]["source"] == "Тест" and lst[0]["added"]
    r = run("--id", "teresa", "--first", "Мать", "--last", "Тереза", "--faces", "front")
    assert r.returncode == 0, r.stderr
    lst = json.loads((bank / "authors.json").read_text(encoding="utf-8"))
    assert [a["id"] for a in lst] == ["lewis-cs", "teresa"] and lst[1]["faces"] == "front"   # по фамилии
    im = Image.open(bank / "teresa.webp"); assert im.getpixel((20, 800))[0] > 200   # анфас не развёрнут
    opaque = tmp_path / "o.png"; Image.new("RGB", (10, 10)).save(opaque)
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "author_photo.py"), str(opaque), "--bank", str(bank), "--id", "x", "--last", "Икс", "--faces", "right"], capture_output=True, text=True)
    assert r.returncode != 0 and "прозрачного фона" in r.stderr


def test_bank_file_is_valid():
    lst = json.loads((ROOT / "img" / "authors" / "authors.json").read_text(encoding="utf-8"))
    assert isinstance(lst, list)
    for a in lst:
        assert (ROOT / "img" / "authors" / a["file"]).exists(), a["id"]
        assert a["faces"] in ("right", "front") and a["w"] > 0 and a["h"] == 1600 and (a["first"] or a["last"])
