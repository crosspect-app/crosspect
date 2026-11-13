"""Этап 9.3: цитата по центру слайда по вертикали, «Текст на половине слайда», PowerPoint из слайдов."""
from conftest import cloud_page, start_blank

MEASURE = """half => {
  const b = Object.assign(newBlock('quote'), { text:'Вера — живое, смелое доверие к Божьей благодати', author:'Мартин Лютер', caption:'Предисловие', half });
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-40000px;top:0;width:1920px;height:1080px';
  const sl = slideEl(b); sl.style.width = '1920px'; host.append(sl); document.body.append(host); fitSlide(sl, b);
  const s = sl.getBoundingClientRect();
  const r = q => { const x = sl.querySelector(q).getBoundingClientRect(); return { l:x.left - s.left, r:x.right - s.left, t:x.top - s.top, b:x.bottom - s.top }; };
  const out = { box:r('.sl-box'), inner:r('.sl-inner'), author:r('.sl-author') };
  host.remove(); return out; }"""


def test_quote_text_is_centered_vertically(page):
    m = page.evaluate(MEASURE, "full")
    mid = (m["inner"]["t"] + m["inner"]["b"]) / 2
    assert abs(mid - 540) <= 2, m   # раньше текст стоял на ~75 px выше
    assert m["author"]["b"] > 900   # подпись осталась внизу


def test_quote_author_does_not_move_with_layout(page):
    full = page.evaluate(MEASURE, "full")["author"]
    left = page.evaluate(MEASURE, "left")["author"]
    right = page.evaluate(MEASURE, "right")["author"]
    assert abs(full["b"] - left["b"]) < 1 and abs(full["b"] - right["b"]) < 1
    assert abs(full["r"] - right["r"]) < 1   # справа — как сейчас
    assert left["l"] < 960 and left["r"] <= 960   # слева — зеркально, не шире половины
    assert right["l"] >= 960


def test_quote_half_slide_left_and_right(page):
    L = page.evaluate(MEASURE, "left")
    R = page.evaluate(MEASURE, "right")
    F = page.evaluate(MEASURE, "full")
    assert L["inner"]["r"] <= 960 - 40 and L["inner"]["l"] >= 40
    assert R["inner"]["l"] >= 960 + 40 and R["inner"]["r"] <= 1920 - 40
    for m in (L, R):   # по вертикали тоже по центру слайда
        assert abs((m["inner"]["t"] + m["inner"]["b"]) / 2 - 540) <= 2, m
    assert F["inner"]["r"] - F["inner"]["l"] > 960   # во всю ширину — как раньше


def test_quote_half_survives_normalize_and_defaults(page):
    r = page.evaluate("""() => {
      const q = half => { const b = { id:'q', type:'quote', text:'x' }; if (half !== undefined) b.half = half; return normalize({ blocks:[b] }).blocks[0].half; };
      return [q('left'), q('right'), q('diagonal'), q(undefined), newBlock('quote').half]; }""")
    assert r == ["left", "right", "full", "full", "full"]


def test_quote_editor_has_layout_switch(page):
    start_blank(page)
    page.evaluate("addBlock('quote')")
    page.wait_for_selector(".bbody .toggle")
    page.get_by_role("button", name="Текст слева").click()
    assert page.evaluate("state.blocks.find(b => b.type === 'quote').half") == "left"
    page.wait_for_function("document.querySelector('.stage .sl-box-quote').dataset.half === 'left'")
    page.get_by_role("button", name="Во всю ширину").click()
    assert page.evaluate("state.blocks.find(b => b.type === 'quote').half") == "full"
    assert page.errors == []


# ---------- PowerPoint ----------
import io
import zipfile
from xml.dom import minidom

import pytest
from conftest import open_sermon

BUILD = """async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const blob = makePPTX([
    { jpeg, alt:'[1] Заставка', notes:'' },
    { jpeg:null, alt:'', notes:'[2] Картинка: Фото & <Друг>\\nОписание: a\\u0001b' },
    { jpeg, alt:'[3] Тезис "x"', notes:'Текст к слайду\\n\\nвторой абзац' },
  ], 'Проповедь & <ко>');
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s); }"""


def build_pptx(page):
    import base64
    return base64.b64decode(page.evaluate(BUILD))


def test_makepptx_structure_and_xml_is_well_formed(page):
    z = zipfile.ZipFile(io.BytesIO(build_pptx(page)))
    names = z.namelist()
    assert names[0] == "[Content_Types].xml"
    for n in names:
        if n.endswith(".xml") or n.endswith(".rels"):
            minidom.parseString(z.read(n))   # каждый кусок — правильный XML (в том числе экранирование &, <, управляющий символ)
    assert [n for n in names if n.startswith("ppt/slides/slide")] == ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml"]
    assert [n for n in names if n.startswith("ppt/media/")] == ["ppt/media/image1.jpg", "ppt/media/image3.jpg"]   # у чёрного слайда картинки нет
    assert [n for n in names if n.startswith("ppt/notesSlides/notesSlide")] == ["ppt/notesSlides/notesSlide1.xml", "ppt/notesSlides/notesSlide2.xml"]   # у слайда без текста заметок нет
    assert "Фото &amp; &lt;Друг&gt;" in z.read("ppt/notesSlides/notesSlide1.xml").decode()
    assert "\x01" not in z.read("ppt/notesSlides/notesSlide1.xml").decode()


def test_makepptx_opens_in_python_pptx(page):
    pptx = pytest.importorskip("pptx")
    prs = pptx.Presentation(io.BytesIO(build_pptx(page)))
    assert (prs.slide_width, prs.slide_height) == (12192000, 6858000)   # 16:9
    s = list(prs.slides)
    assert len(s) == 3
    assert [bool([sh for sh in x.shapes if sh.shape_type == 13]) for x in s] == [True, False, True]
    assert not s[0].has_notes_slide
    assert s[1].notes_slide.notes_text_frame.text.startswith("[2] Картинка: Фото & <Друг>")
    assert s[2].notes_slide.notes_text_frame.text == "Текст к слайду\n\nвторой абзац"
    assert prs.core_properties.title == "Проповедь & <ко>"


def download_pptx(page, call):
    with page.expect_download(timeout=120000) as dl:
        page.evaluate(call)
    return dl.value


def test_export_pptx_order_black_slides_and_notes(page, sermon):
    pptx = pytest.importorskip("pptx")
    open_sermon(page, sermon)
    d = download_pptx(page, "exportPPTX()")
    assert d.suggested_filename == "2026-11-15 Тест формы.pptx"
    prs = pptx.Presentation(d.path())
    s = list(prs.slides)
    types = page.evaluate("state.blocks.filter(b => TYPES[b.type].slide).map(b => b.type)")
    assert len(s) == len(types)   # порядок и число — как в конспекте: номера [N] совпадают
    for i, (x, t) in enumerate(zip(s, types), 1):
        has_pic = any(sh.shape_type == 13 for sh in x.shapes)
        if t in ("image", "video", "free"):
            assert not has_pic and x.notes_slide.notes_text_frame.text.startswith("[%d] " % i), (i, t)
        else:
            assert has_pic, (i, t)
    img = next(x for x, t in zip(s, types) if t == "image")
    assert "Описание: " in img.notes_slide.notes_text_frame.text
    assert page.errors == []


def test_export_pptx_todo_slide_is_black_only_for_editor(page, sermon):
    pptx = pytest.importorskip("pptx")
    open_sermon(page, sermon)
    page.evaluate("state.blocks.find(b => b.type === 'thesis').todo = true")
    prs = pptx.Presentation(download_pptx(page, "exportPPTX()").path())
    types = page.evaluate("state.blocks.filter(b => TYPES[b.type].slide).map(b => b.type)")
    th = list(prs.slides)[types.index("thesis")]
    assert not any(sh.shape_type == 13 for sh in th.shapes)
    assert "Отмечено «доработать»" in th.notes_slide.notes_text_frame.text
    # автор отметок не видит: слайд остаётся обычным
    page.evaluate("cloud.role = 'preacher'")
    prs = pptx.Presentation(download_pptx(page, "exportPPTX()").path())
    th = list(prs.slides)[types.index("thesis")]
    assert any(sh.shape_type == 13 for sh in th.shapes)


def test_notes_hold_only_file_name_and_black_slide_comments(page, sermon):
    """Этап 9.5: в заметках — название файла слайда; текста к слайду и содержимого слайдов нет."""
    pptx = pytest.importorskip("pptx")
    open_sermon(page, sermon)
    page.evaluate("state.blocks.find(b => b.type === 'quote').speech = 'Сказать это вслух'")
    prs = pptx.Presentation(download_pptx(page, "exportPPTX()").path())
    names = page.evaluate("(() => { const n = slideNums(); return state.blocks.filter(b => TYPES[b.type].slide).map(b => slideName(b, n[b.id])); })()")
    types = page.evaluate("state.blocks.filter(b => TYPES[b.type].slide).map(b => b.type)")
    for x, name, t in zip(prs.slides, names, types):
        text = x.notes_slide.notes_text_frame.text
        assert text.split("\n")[0] == name, (t, text)   # название файла — первой строкой, у каждого слайда
        assert "Сказать это вслух" not in text
        if t in ("splash", "scripture", "thesis", "quote"):
            assert text == name, (t, text)   # у обычного слайда — только название
    assert page.errors == []


def test_download_menu_offers_jpeg_and_powerpoint(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("fillMenu()")
    assert page.evaluate("[...menuEl.querySelectorAll('button')].some(b => b.textContent.trim() === 'Скачать слайды')")
    assert not page.evaluate("[...menuEl.querySelectorAll('button')].some(b => b.textContent.includes('Скачать все слайды'))")
    page.evaluate("openDownload()")
    sheet = page.locator(".sheet.dlsheet")
    assert sheet.get_by_role("button", name="JPEG в архиве").count() == 1 and sheet.get_by_role("button", name="PowerPoint").count() == 1
    with page.expect_download(timeout=120000) as dl:
        sheet.get_by_role("button", name="JPEG в архиве").click()
    assert dl.value.suggested_filename.endswith(".zip")
    page.evaluate("openDownload()")
    with page.expect_download(timeout=120000) as dl:
        page.locator(".sheet.dlsheet").get_by_role("button", name="PowerPoint").click()
    assert dl.value.suggested_filename.endswith(".pptx")
    assert not page.locator(".sheet.dlsheet").is_visible()   # окно закрылось
