"""Этап 10.4: отрывок по слайдам («Целиком» · «По стихам» · «Вручную»), части в ленте, «Тексте», PDF, PowerPoint и ZIP;
разрывы страниц PDF только между стихами, шапка слайда повторяется."""
import io
import zipfile

import pytest

from conftest import open_sermon

PASSAGE = """(n, opts) => {
  opts = opts || {};
  const b = newBlock('scripture'), it = b.items[0];
  const nums = []; for (let i = 3; i < 3 + n; i++) nums.push(i);
  Object.assign(it, { lang:'ru', book:32, chapter:4, sel:nums.slice(),
    verses:nums.map(v => ({ num:String(v), text:'Текст стиха ' + v + (opts.long ? ' — ' + 'длинные слова '.repeat(opts.long) : ''), orig:'' })) });
  it.ref = refString(it); it.translation = 'Синодальный';
  if (opts.split) b.split = normSplit(opts.split);
  b.speech = opts.speech || '';
  return b;
}"""


def put_blocks(page, js):
    page.evaluate("mk => { const P = eval(mk); state.blocks = (" + js + ")(P); passageTidyAll(); change(); renderMain(); }", PASSAGE)


def base(sermon):
    s = dict(sermon)
    s["blocks"] = [b for b in sermon["blocks"] if b["type"] == "splash" or b["type"] == "text"][:1]
    return s


def test_split_by_verses_gives_parts_numbers_names(page, sermon):
    open_sermon(page, sermon)
    put_blocks(page, "P => [newBlock('thesis'), P(7, { split:{ mode:'verses', per:4 } }), newBlock('quote')]")
    r = page.evaluate("""() => { const nums = slideNums(), us = units().filter(b => b.type === 'scripture');
      return { ids:us.map(u => u.id), nums:us.map(u => nums[u.id]), names:us.map(u => slideName(u, nums[u.id])), total:nums._total,
               onSlide:us.map(u => u.items[0].ref), quote:nums[state.blocks[2].id] }; }""")
    assert len(r["ids"]) == 2 and r["ids"][1].endswith("~1")
    assert r["nums"] == [2, 3] and r["quote"] == 4 and r["total"] == 4
    assert r["names"] == ["[2] ИОН. 4_3-6", "[3] ИОН. 4_7-9"]
    assert r["onSlide"][0].endswith("4:3–6")
    # лента: обёртка отрывка со скобкой, подпись, метки 1/2, «+» между частями нет
    grp = page.locator(".film .pgroup")
    assert grp.count() == 1
    assert "отрывок · 2 слайда" in grp.locator(".pg-cap").inner_text()
    assert grp.locator(".ppart").count() == 2 and grp.locator(".film-gap").count() == 0
    assert grp.locator(".st-pn").all_inner_texts() == ["1/2", "2/2"]
    assert grp.locator(".pg-head .st-acts").count() == 1 and grp.locator(".ppart .st-acts").count() == 0
    assert not page.errors, page.errors


def test_select_part_stage_bar_and_own_speech(page, sermon):
    open_sermon(page, sermon)
    put_blocks(page, "P => [P(6, { split:{ mode:'verses', per:3 }, speech:'Первая' })]")
    pid = page.evaluate("state.blocks[0].id + '~1'")
    page.locator(f".st[data-id='{pid}']").click()
    assert "отрывок, слайд 2 из 2" in page.inner_text(".stage-bar .cap").lower()
    page.locator(".speech .rich").click()
    page.keyboard.type("Вторая")
    r = page.evaluate("() => { const b = state.blocks[0]; return [b.speech, b.split.speech[1]]; }")
    assert r == ["Первая", "Вторая"]
    # правая панель — весь отрывок, текущая часть подсвечена в списке
    rows = page.locator(".split-sec .part-row")
    page.wait_for_function("document.querySelectorAll('.split-sec .part-row').length === 2")   # панель перерисовывается после ввода — ждём, а не проверяем сразу
    assert rows.count() == 2 and "on" in rows.nth(1).get_attribute("class")
    assert "3 стиха" in rows.nth(1).inner_text()
    assert not page.errors, page.errors


def test_fewer_parts_moves_speech_to_previous(page, sermon):
    open_sermon(page, sermon)
    put_blocks(page, "P => [P(6, { split:{ mode:'verses', per:2 }, speech:'А' })]")
    page.evaluate("state.blocks[0].split.speech = ['', 'Б', 'В']; change();")
    page.evaluate("setSplitMode(state.blocks[0], 'verses', 3); change();")
    r = page.evaluate("() => { const b = state.blocks[0]; return [b.speech, (b.split.speech || [])[1] || '', units().length]; }")
    assert r[2] == 2
    assert r[0] == "А<br><br>Б" and r[1] == "В"   # части 3–4 не стало: её текст — к первой
    page.evaluate("setSplitMode(state.blocks[0], 'whole'); change();")
    assert page.evaluate("state.blocks[0].speech") == "А<br><br>Б<br><br>В"
    assert not page.errors, page.errors


def test_manual_breaks_follow_verses(page, sermon):
    open_sermon(page, sermon)
    put_blocks(page, "P => [P(6, { split:{ mode:'verses', per:2 } })]")   # стихи 3–8, части 3–4, 5–6, 7–8
    page.locator(".split-sec .toggle button", has_text="Вручную").click()
    assert page.evaluate("state.blocks[0].split.mode") == "manual"
    assert page.evaluate("state.blocks[0].split.breaks") == [5, 7]   # линии там, где были разрывы
    lines = page.locator(".verses.manual .vbreak")
    assert lines.count() == 6   # над первым стихом и между стихами
    assert page.locator(".verses.manual .vbreak.on").count() == 2
    assert page.locator(".verses.manual .vb-cap").all_inner_texts() == ["СЛАЙД 1", "СЛАЙД 2", "СЛАЙД 3"]
    # нажал на линию перед стихом 4 — новый слайд; ещё раз — убрал
    page.locator(".verses.manual .vbreak").nth(1).click()
    assert page.evaluate("state.blocks[0].split.breaks") == [4, 5, 7]
    page.locator(".verses.manual .vbreak").nth(1).click()
    assert page.evaluate("state.blocks[0].split.breaks") == [5, 7]
    # сняли стих 5 — линия у стиха 6; сняли 6 — у 7 уже есть: одна линия; сняли 7, 8 — после линии стихов нет
    js = "n => { const it = state.blocks[0].items[0]; it.sel = it.sel.filter(x => x !== n); it.verses = it.verses.filter(v => +v.num !== n); change(); return state.blocks[0].split.breaks; }"
    assert page.evaluate(js, 5) == [6, 7]
    assert page.evaluate(js, 6) == [7]
    assert page.evaluate(js, 8) == [7]
    assert page.evaluate(js, 7) == []
    assert page.evaluate("units().length") == 1
    assert not page.errors, page.errors


def test_split_disabled_for_complex_slide(page, sermon):
    open_sermon(page, sermon)
    put_blocks(page, "P => { const b = P(5, { split:{ mode:'verses', per:2 } }); b.items.push(newTextItem()); return [b]; }")
    assert page.evaluate("units().length") == 1
    sec = page.locator(".split-sec")
    assert "off" in sec.get_attribute("class")
    assert "одно место Писания" in sec.get_attribute("title")
    assert not page.errors, page.errors


def test_squeezed_scripture_has_split_button(page, sermon):
    open_sermon(page, sermon)
    put_blocks(page, "P => [P(12, { long:12 })]")
    btn = page.locator(".stage-info .split-now")
    btn.wait_for()
    btn.click()
    assert page.evaluate("state.blocks[0].split.mode") == "verses"
    assert page.evaluate("units().length") >= 2
    assert not page.errors, page.errors


def test_drag_whole_passage_and_delete_copy_from_label(page, sermon):
    open_sermon(page, sermon)
    put_blocks(page, "P => [newBlock('thesis'), P(4, { split:{ mode:'verses', per:2 } })]")
    page.evaluate("moveTo(state.blocks[1], 0)")
    assert page.evaluate("state.blocks[0].type") == "scripture"
    page.locator(".pgroup .pg-head").hover()
    page.locator(".pgroup .pg-head .st-acts button[title='Дублировать']").click()
    assert page.evaluate("state.blocks.filter(b => b.type === 'scripture').length") == 2
    assert page.locator(".film .pgroup").count() == 2
    assert not page.errors, page.errors


def test_text_view_plate_and_strip(page, sermon):
    open_sermon(page, sermon)
    put_blocks(page, "P => [P(7, { split:{ mode:'verses', per:4 } })]")
    page.evaluate("setView('text')")
    page.wait_for_selector(".tv-passage")
    assert "Отрывок · " in page.inner_text(".tv-pcap") and "2 слайда" in page.inner_text(".tv-pcap")
    plates = page.locator(".tv-passage .vs-part").all_inner_texts()
    assert plates[0].startswith("Слайд 1 из 2 · на экране 4:3–6") and plates[1].endswith("4:7–9")
    assert page.locator(".tv-passage .vs-ref").first.inner_text().startswith(page.evaluate("state.blocks[0].items[0].ref"))
    assert not page.errors, page.errors


def test_pptx_and_zip_have_parts(page, sermon):
    open_sermon(page, sermon)
    put_blocks(page, "P => [newBlock('thesis'), P(7, { split:{ mode:'verses', per:4 } })]")
    page.evaluate("state.blocks[0].parts[0].html = 'Мысль'; syncThesisText(state.blocks[0]); change();")
    with page.expect_download() as dl:
        page.evaluate("exportMany()")
    z = zipfile.ZipFile(io.BytesIO(open(dl.value.path(), "rb").read()))
    names = [n.split("/")[-1] for n in z.namelist() if n.endswith(".jpg")]
    assert "[2] ИОН. 4_3-6.jpg" in names and "[3] ИОН. 4_7-9.jpg" in names
    pptx = pytest.importorskip("pptx")
    with page.expect_download() as dl:
        page.evaluate("exportPPTX()")
    prs = pptx.Presentation(dl.value.path())
    notes = [s.notes_slide.notes_text_frame.text.split("\n")[0] for s in prs.slides]
    assert notes[-2:] == ["[2] ИОН. 4_3-6", "[3] ИОН. 4_7-9"]
    assert not page.errors, page.errors


def test_operator_snapshot_parts(page, sermon):
    open_sermon(page, sermon)
    put_blocks(page, "P => [P(7, { split:{ mode:'verses', per:4 } })]")
    snap = page.evaluate("opSnapshot(state)")
    sc = [b for b in snap["blocks"] if b["t"] == "scripture"]
    assert len(sc) == 2 and sc[1]["part"] == {"k": 2, "n": 2, "on": "4:7–9"}
    assert snap["total"] == 2
    assert not page.errors, page.errors


PDF_RUN = """async () => {
  buildOperatorPrint();
  printEl.setAttribute('style', 'display:block;position:absolute;left:-10000px;top:0;width:' + ((PDF_PAGE.w - 2 * PDF_PAGE.side) * PDF_MM) + 'px;background:#fff');
  await document.fonts.ready;
  const d = pdfCollect(printEl), pages = pdfBreaks(d, (PDF_PAGE.h - PDF_PAGE.top - PDF_PAGE.bottom) * PDF_MM);
  const rel = e => { const r = e.getBoundingClientRect(), b = printEl.getBoundingClientRect(); return [r.top - b.top, r.bottom - b.top]; };
  const out = { pages, verses:[...printEl.querySelectorAll('.op-v')].map(rel), solid:[...printEl.querySelectorAll('.op-note, .op-slide:not(:has(.op-v))')].map(rel),
    heads:[...printEl.querySelectorAll('.op-slide')].filter(c => c.querySelector('.op-v')).map(c => [rel(c)[0], rel(c.querySelector('.op-v'))[0]]) };
  printEl.removeAttribute('style'); printEl.innerHTML = '';
  return out;
}"""


def check_pdf(res):
    pages = res["pages"]
    for pg in pages:
        top, cut = pg["top"], pg["cut"]
        assert not any(a < cut - 0.5 and b > cut + 0.5 for a, b in res["verses"]), cut     # стих целиком на одной странице
        assert not any(a < cut - 0.5 and b > cut + 0.5 for a, b in res["solid"]), cut      # тезис и заметка не рвутся
        assert not any(h0 < cut - 0.5 and h1 > cut - 0.5 for h0, h1 in res["heads"]), cut  # шапка не остаётся одна внизу
        if pg["head"]:
            assert any(abs(pg["head"][0] - h0) < 0.5 for h0, _ in res["heads"])


def test_pdf_whole_chapter_breaks_between_verses(page, sermon):
    open_sermon(page, sermon)
    put_blocks(page, "P => [P(40, { long:3 })]")
    res = page.evaluate(PDF_RUN)
    assert len(res["pages"]) >= 3
    check_pdf(res)
    assert all(p["head"] for p in res["pages"][1:])   # на новой странице повторена шапка
    assert not page.errors, page.errors


def test_pdf_passage_parts_and_place_after_place(page, sermon):
    open_sermon(page, sermon)
    put_blocks(page, "P => [P(14, { long:3, split:{ mode:'verses', per:7 }, speech:'Текст к слайду ' + 'слово '.repeat(60) }), P(10, { long:3 }), Object.assign(newBlock('note'), { text:'Запустить видео' })]")
    res = page.evaluate(PDF_RUN)
    check_pdf(res)
    pages = res["pages"]
    for a, b in zip(pages, pages[1:]):
        assert b["top"] >= a["cut"] - 0.5 and b["top"] - a["cut"] < 40   # без больших пустот
    page.evaluate("buildOperatorPrint()")
    assert page.locator("#print-op .op-passage .op-part").count() == 2
    assert "Отрывок · " in page.inner_text("#print-op .op-pcap")
    page.evaluate("printEl.innerHTML = ''")
    assert not page.errors, page.errors


def test_old_file_without_split_opens(page, sermon):
    open_sermon(page, sermon)
    assert page.evaluate("state.blocks.every(b => !b.split)")
    assert page.evaluate("units().length") == page.evaluate("state.blocks.length")
    assert not page.errors, page.errors
