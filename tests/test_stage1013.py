"""Этап 10.1.3: обязательные поля «О проповеди», окно в просмотре, статус и рамка слайда в просмотре, «Экспорт» и «Поделиться»,
кто выбирает фон вручную и подписи источника фона, своя заставка — серая заглушка, надстрочный номер стиха, «Добавить»,
никаких «null» на экранах, «Готово» видно в «Тексте»."""
import pathlib
import re

from conftest import ROOT, cloud_page, open_sermon
from test_cloud import rec, wait_home


def meta_sheet(page):
    return page.locator(".sheet[aria-label='О проповеди']")


# ---------- 1. Обязательные поля ----------

def test_new_sermon_needs_title_and_author_and_cancel_drops_it(page):
    page.evaluate("newSermon()")
    sheet = meta_sheet(page)
    sheet.wait_for()
    id = page.evaluate("state.id")
    sheet.get_by_role("button", name="Готово").click()
    assert sheet.is_visible()
    assert page.inner_text(".meta-err") == "Укажите название и автора проповеди."
    assert page.locator(".meta-sheet .field.invalid").count() == 2
    page.keyboard.press("Escape")
    assert sheet.is_visible()
    page.locator(".meta-sheet input[aria-label='Название проповеди']").fill("Вера")
    assert page.inner_text(".meta-err") == "Укажите автора проповеди."   # ошибка обновляется на ходу
    page.evaluate("autoSave()")   # пока окно не подтвердили, в облако конспект не уходит
    assert page.evaluate("id => !fakeCloud.db().sermons[id]", id)
    sheet.get_by_role("button", name="Отмена").click()
    page.wait_for_function("screen === 'home' && !document.querySelector('.overlay.open')")
    assert page.evaluate("id => localStorage.getItem('swp-sermon:' + id) === null && !fakeCloud.db().sermons[id]", id)
    page.wait_for_timeout(600)   # отложенная запись черновика не вернула его
    assert page.evaluate("id => localStorage.getItem('swp-sermon:' + id) === null", id)
    assert page.locator(".srow").count() == 0
    assert not page.errors, page.errors


def test_new_sermon_goes_to_cloud_after_done(page):
    page.evaluate("newSermon()")
    sheet = meta_sheet(page)
    sheet.wait_for()
    id = page.evaluate("state.id")
    page.locator(".meta-sheet input[aria-label='Название проповеди']").fill("Вера")
    page.locator(".meta-sheet input[aria-label='Имя']").fill("Иван")
    page.locator(".meta-sheet input[aria-label='Фамилия']").fill("Петров")
    assert page.inner_text(".meta-err") == ""
    sheet.get_by_role("button", name="Готово").click()
    assert not sheet.is_visible()
    assert page.evaluate("metaNew") is None
    page.wait_for_function("id => !!fakeCloud.db().sermons[id]", arg=id)
    assert page.evaluate("id => fakeCloud.db().sermons[id].meta.title", id) == "Вера"
    assert not page.errors, page.errors


def test_leaving_new_sermon_without_done_drops_it(page):
    page.evaluate("newSermon()")
    meta_sheet(page).wait_for()
    id = page.evaluate("state.id")
    page.evaluate("history.back()")
    page.wait_for_function("screen === 'home' && !document.querySelector('.overlay.open')")
    assert page.evaluate("id => localStorage.getItem('swp-sermon:' + id) === null && !fakeCloud.db().sermons[id]", id)
    assert not page.errors, page.errors


def test_existing_sermon_title_and_author_cannot_be_cleared(page, sermon):
    open_sermon(page, sermon)
    page.locator(".topbar .hd-title").click()
    sheet = meta_sheet(page)
    sheet.wait_for()
    assert sheet.get_by_role("button", name="Отмена").count() == 0   # «Отмена» — только у нового
    page.locator(".meta-sheet input[aria-label='Название проповеди']").fill("")
    sheet.get_by_role("button", name="Готово").click()
    assert sheet.is_visible() and page.inner_text(".meta-err") == "Укажите название проповеди."
    page.locator(".overlay.open").click(position={"x": 5, "y": 5})   # щелчок мимо окна — тоже не закрывает
    assert sheet.is_visible()
    page.locator(".meta-sheet input[aria-label='Название проповеди']").fill("Новое")
    sheet.get_by_role("button", name="Готово").click()
    assert not sheet.is_visible()
    assert not page.errors, page.errors


# ---------- 2. Просмотр ----------

def test_view_mode_meta_read_only_neutral_status_gray_frame(page, sermon):
    open_sermon(page, sermon, edit=False)
    page.locator(".topbar .hd-title").click()
    sheet = meta_sheet(page)
    sheet.wait_for()
    assert page.evaluate("document.querySelector('.meta-sheet .set-grid').inert") is True
    assert sheet.get_by_role("button", name="Готово").count() == 0
    sheet.get_by_role("button", name="Закрыть").last.click()
    assert not sheet.is_visible()
    on = "getComputedStyle(document.querySelector('.topbar .stswitch .sw-opt.on')).backgroundColor"
    assert page.evaluate(on) == "rgb(38, 38, 38)"   # без цвета: нейтральная подложка
    page.evaluate("selectBlock(state.blocks[1].id)")
    frame = "getComputedStyle(document.querySelector('.film .st.on')).boxShadow"
    assert "143, 138, 128" in page.evaluate(frame)   # серая рамка
    page.locator("#app").get_by_role("button", name="Редактировать").click()
    page.wait_for_function("ed.mode === 'edit' && !ed.busy")
    assert page.evaluate(on) == "rgb(58, 44, 8)"   # в правке — цвет статуса
    assert "255, 222, 89" in page.evaluate(frame)   # жёлтая рамка
    assert not page.errors, page.errors


# ---------- 7. «null», «Добавить», «Готово» в «Тексте», заглушки, номер стиха ----------

NATIVE = re.compile(r"\.(append|prepend|before|after|replaceWith|replaceChildren)\(")


def top_level_args(src, start):
    """Текст аргументов вызова с позиции start (сразу после «(»): только верхний уровень, вложенные скобки и строки выброшены"""
    depth, i, out = 1, start, []
    while i < len(src) and depth:
        c = src[i]
        if c in "'\"`":
            q = c
            i += 1
            while i < len(src) and src[i] != q:
                i += 2 if src[i] == "\\" else 1
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif depth == 1:
            out.append(c)
        i += 1
    return "".join(out)


def test_no_native_append_with_null_or_and():
    """Встроенный append превращает null в текст «null»: условные значения — только через h(…) или put(…) (util.js)"""
    bad = []
    for f in sorted((ROOT / "js").glob("*.js")):
        src = f.read_text(encoding="utf-8")
        for m in NATIVE.finditer(src):
            args = re.sub(r"//[^\n]*", "", top_level_args(src, m.end()))
            if re.search(r"\bnull\b|&&", args):
                bad.append(f"{f.name}:{src.count(chr(10), 0, m.start()) + 1}")
    assert not bad, bad


NULL_NODES = """(() => [...document.querySelectorAll('body *')].flatMap(e => [...e.childNodes])
  .filter(n => n.nodeType === 3 && /\\b(null|undefined)\\b/.test(n.textContent)).map(n => n.parentElement.className + ': ' + n.textContent))()"""


def test_no_null_text_on_main_screens(page, sermon):
    assert page.evaluate(NULL_NODES) == []   # главная
    open_sermon(page, sermon)
    for i in range(page.evaluate("state.blocks.length")):   # «Слайды», каждый блок, в том числе заметка оператору
        page.evaluate("i => selectBlock(state.blocks[i].id)", i)
        assert page.evaluate(NULL_NODES) == [], page.evaluate("i => state.blocks[i].type", i)
    page.evaluate("openMeta()")
    assert page.evaluate(NULL_NODES) == []
    page.evaluate("closeSettings(true); setView('text')")
    page.wait_for_selector(".tv")
    assert page.evaluate(NULL_NODES) == []
    assert not page.errors, page.errors


def test_note_has_no_null_under_plate(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("selectBlock(state.blocks.find(b => b.type === 'note').id)")
    page.wait_for_selector(".stage .note-plate")
    assert "null" not in page.inner_text(".stage")


def test_add_plate_and_plus_say_add(page, sermon):
    open_sermon(page, sermon)
    plate = page.locator(".film-end .film-plate")
    assert plate.inner_text().strip() == "Добавить"
    assert page.evaluate("[...document.querySelectorAll('.film .film-ins')].every(b => b.title === 'Добавить')")


def test_done_button_readable_in_text_view(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("setView('text')")
    page.wait_for_selector(".tv")
    done = page.locator(".topbar .hd-done")
    done.wait_for()
    fg, bg = page.evaluate("""(() => { const s = getComputedStyle(document.querySelector('.topbar .hd-done')); return [s.color, s.backgroundColor]; })()""")

    def lum(c):
        r, g, b = [int(x) / 255 for x in re.findall(r"\d+", c)[:3]]
        f = lambda v: v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    a, b = sorted([lum(fg), lum(bg)])
    assert (b + 0.05) / (a + 0.05) > 7, (fg, bg)


def test_placeholder_text_twice_as_big(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("selectBlock(state.blocks.find(b => b.type === 'image').id)")
    page.wait_for_selector(".stage .ph-big")
    assert page.evaluate("parseFloat(getComputedStyle(document.querySelector('.stage .ph-name')).fontSize)") == 40
    assert page.evaluate("parseFloat(getComputedStyle(document.querySelector('.film .ph-thumb')).fontSize)") == 20


VERSE_SCRIPT = """mode => {
  const b = state.blocks.find(x => x.type === 'scripture');
  b.items = [{ kind:'scripture', manual:true, mBook:'1 Коринфянам', mChapter:'13', mVerses:'6-7', translation:'', ref:'1 Коринфянам 13:6-7',
    verses:[{ num:'6', text:'не радуется неправде, а сорадуется истине;' }, { num:'7', text:'все покрывает, всему верит, всего надеется, все переносит.' }] }];
  SLIDES_TRY = mergeSlides(SLIDES_BASE, { verses:Object.assign({}, SLIDES_BASE.verses, mode) });   // как пример в окне настроек: облако не перезапишет
  renderMain(); selectBlock(b.id);
}"""
NUM_VS_TEXT = """sel => {
  const sl = document.querySelector('.stage .sl');
  const num = sl.querySelector(sel);
  const p = sel === '.sl-vn' ? num.nextElementSibling : num.parentElement;
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, { acceptNode:n => n.parentElement.closest('sup') || !n.textContent.trim() ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  const t = walker.nextNode(), r = document.createRange();
  const k = t.textContent.search(/\\S/); r.setStart(t, k); r.setEnd(t, k + 1);
  const a = num.getBoundingClientRect(), c = r.getBoundingClientRect();
  return { numMid:(a.top + a.bottom) / 2, numBottom:a.bottom, textTop:c.top, textMid:(c.top + c.bottom) / 2, textH:c.height };
}"""


def test_verse_number_is_superscript_in_every_layout(page, sermon):
    open_sermon(page, sermon)
    for mode, sel in [({"flow": "lines", "align": "left"}, ".sl-vn"), ({"flow": "lines", "align": "center"}, ".sl-vstack sup"),
                      ({"flow": "lines", "align": "right"}, ".sl-vstack sup"), ({"flow": "inline", "align": "center"}, ".sl-verse sup")]:
        page.evaluate(VERSE_SCRIPT, mode)
        page.wait_for_selector(".stage .sl " + sel)
        g = page.evaluate(NUM_VS_TEXT, sel)
        assert g["numMid"] < g["textMid"] - g["textH"] * 0.15, (mode, g)   # выше середины строки
        assert g["numBottom"] < g["textMid"] + g["textH"] * 0.1, (mode, g)   # и не на нижней линии
    assert not page.errors, page.errors


# ---------- 5–6. Кто выбирает фон вручную; откуда фон ----------

from test_cloud import ADMIN, IVAN  # noqa: E402
from test_stage10 import FMT, PEOPLE, open_space, put_slides  # noqa: E402

SERIES = {"a1": {"name": "Серия", "active": True, "format": "f2"}, "a2": {"name": "Без фона", "active": True, "format": ""}}


def test_pick_roles_normalized_from_old_pick_format(page):
    m = "o => { const r = mergeSlides(SLIDES_DEFAULT, o); return ['pickFormat' in r, r.pickRoles]; }"
    assert page.evaluate(m, {"pickFormat": True}) == [False, ["editor", "preacher"]]
    assert page.evaluate(m, {"pickFormat": False}) == [False, []]
    assert page.evaluate(m, {}) == [False, []]
    assert page.evaluate(m, {"pickRoles": ["preacher", "operator", "x"]}) == [False, ["preacher"]]
    assert page.evaluate(m, {"pickRoles": ["preacher"], "pickFormat": True}) == [False, ["preacher"]]   # новое поле важнее старого


def test_author_sees_format_field_only_when_allowed(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=PEOPLE, series=SERIES)
    wait_home(page)
    put_slides(page, dict(FMT, defaultFormat="f1"))
    page.wait_for_function("slidesCfg().defaultFormat === 'f1'")
    page.evaluate("newSermon()")
    page.wait_for_selector(".meta-sheet")
    assert page.locator(".meta-sheet [aria-label='Формат фона']").count() == 0
    page.evaluate("dropNewSermon(); navigate('')")
    put_slides(page, dict(FMT, defaultFormat="f1", pickRoles=["preacher"]))
    page.wait_for_function("slidesCfg().pickRoles.includes('preacher')")
    page.evaluate("newSermon()")
    page.wait_for_selector(".meta-sheet [aria-label='Формат фона']")
    assert not page.errors, page.errors
    ctx.close()


def test_roles_switch_in_slides_settings_not_in_space_general(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=PEOPLE)
    wait_home(page)
    put_slides(page, dict(FMT, pickFormat=True))   # прежняя галочка — обе роли
    page.wait_for_function("slidesCfg().pickRoles.length === 2")
    open_space(page, "Общее")
    assert "фон" not in page.inner_text(".sp-general").lower()
    page.evaluate("closeSettings(true); openSlidesCfg()")
    sec = page.locator(".scfg-pick")
    sec.wait_for()
    assert "Кто может выбрать фон проповеди вручную" in sec.inner_text()
    assert sec.get_attribute("title") == "По умолчанию фон определяется по серии проповедей."   # подсказка при наведении, как во всём окне
    ed = sec.locator(".switch", has_text="Редактор")
    assert ed.locator("input").is_checked() and sec.locator(".switch", has_text="Автор").locator("input").is_checked()
    ed.locator(".sw").click()
    page.get_by_role("button", name="Применить").click()
    page.wait_for_function("JSON.stringify(fakeCloud.db().slides.pickRoles) === '[\"preacher\"]'")
    assert "pickFormat" not in page.evaluate("fakeCloud.db().slides")
    assert page.evaluate("fakeCloud.db().slides.defaultFormat") == "system"   # остальное не тронуто
    assert not page.errors, page.errors
    ctx.close()


def test_format_field_shows_origin_and_auto_pick_clears_manual(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=PEOPLE, series=SERIES)
    wait_home(page)
    put_slides(page, dict(FMT, defaultFormat="f1"))
    page.wait_for_function("slidesCfg().defaultFormat === 'f1' && !!SERIES.a1")
    page.evaluate("newSermon()")
    page.wait_for_selector(".meta-sheet")
    f = page.locator(".meta-sheet [aria-label='Формат фона']")
    series = page.locator(".meta-sheet [aria-label='Серия проповедей']")

    def pick(trigger, name):
        trigger.click()
        page.locator(".dd-list button", has_text=name).first.click()

    def items():
        f.click()
        out = [t.strip() for t in page.locator(".dd-list button").all_inner_texts()]
        page.keyboard.press("Escape")
        return out
    assert f.inner_text().strip() == "Синий (по умолчанию)"                     # «Свободная тема»: по умолчанию
    assert items() == ["System Template", "Зелёный", "Синий (по умолчанию)"]
    pick(series, "Серия")
    assert f.inner_text().strip() == "Зелёный (указан для серии)"
    assert items() == ["System Template", "Зелёный (указан для серии)", "Синий (по умолчанию)"]
    pick(f, "System Template")                                                  # вручную — без скобок
    assert f.inner_text().strip() == "System Template" and page.evaluate("state.meta.format") == "system"
    pick(f, "Синий")                                                            # вручную формат по умолчанию — со скобками, но остаётся ручным
    assert f.inner_text().strip() == "Синий (по умолчанию)" and page.evaluate("state.meta.format") == "f1"
    pick(f, "Зелёный")                                                          # формат серии — ручной выбор снят
    assert f.inner_text().strip() == "Зелёный (указан для серии)" and page.evaluate("'format' in state.meta") is False
    pick(series, "Без фона")                                                    # у серии формата нет — по умолчанию
    assert f.inner_text().strip() == "Синий (по умолчанию)"
    page.evaluate("fakeCloud.db(); put = s => { const db = fakeCloud.db(); db.slides = Object.assign(db.slides, { defaultFormat:'f2' }); fakeCloud.put(db); }; put()")
    page.wait_for_function("slidesCfg().defaultFormat === 'f2'")
    pick(series, "Серия")                                                       # формат серии он же по умолчанию — «указан для серии»
    assert f.inner_text().strip() == "Зелёный (указан для серии)"
    assert not page.errors, page.errors
    ctx.close()


# ---------- 3–4. «Экспорт» и «Поделиться» ----------

import io  # noqa: E402

import pytest  # noqa: E402


TG = dict(PEOPLE, **{"op@x.pl": {"role": "operator", "firstName": "Олег", "lastName": "Операторов", "tg": "oleg_op"}})


def menu_items(page):
    page.evaluate("fillMenu()")
    return page.evaluate("[...menuEl.querySelectorAll('button')].map(b => b.textContent.trim())")


def test_menu_has_export_and_share_instead_of_old_items(page, sermon):
    open_sermon(page, sermon)
    items = menu_items(page)
    assert "Экспорт" in items and "Поделиться" in items
    for old in ["Скачать слайды", "PDF для оператора", "Ссылка для оператора"]:
        assert old not in items
    page.evaluate("openExport()")
    sheet = page.locator(".sheet[aria-label='Экспорт']")
    assert [t.strip() for t in sheet.locator(".dl-opt-title").all_inner_texts()] == ["JPEG (архив ZIP)", "PowerPoint", "PDF"]
    sheet.locator(".icon-btn[aria-label='Закрыть']").click()
    page.evaluate("setView('text')")
    page.wait_for_selector(".tv-side")
    assert [t.strip() for t in page.locator(".tv-side button").all_inner_texts()][:2] == ["Экспорт", "Поделиться"]


def test_export_pdf_is_a_real_file(page, sermon):
    pypdf = pytest.importorskip("pypdf")
    open_sermon(page, sermon)
    page.evaluate("openExport()")
    with page.expect_download() as dl:
        page.locator(".dl-opt", has_text="PDF").click()
    d = dl.value
    assert d.suggested_filename == "2026-11-15 Тест формы — оператор.pdf"
    r = pypdf.PdfReader(io.BytesIO(open(d.path(), "rb").read()))
    assert len(r.pages) >= 1
    w, h = float(r.pages[0].mediabox.width), float(r.pages[0].mediabox.height)
    assert abs(w / 72 * 25.4 - 80) < 0.5 and abs(h / 72 * 25.4 - 170) < 0.5   # как при печати: 80 × 170 мм
    assert r.metadata.title == "Тест формы — оператор"
    assert not page.errors, page.errors


def test_pdf_pages_break_between_cards(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("for (let i = 0; i < 6; i++) state.blocks.push(Object.assign(newBlock('thesis'), { name:'Т' + i, text:'Мысль номер ' + i, parts:[{ kind:'text', html:'Мысль номер ' + i + ' — довольно длинная, чтобы занять несколько строк на узкой странице', align:'center', scale:100 }] }))")
    res = page.evaluate("""async () => {
      buildOperatorPrint();
      printEl.setAttribute('style', 'display:block;position:absolute;left:-10000px;top:0;width:' + ((PDF_PAGE.w - 2 * PDF_PAGE.side) * PDF_MM) + 'px');
      await document.fonts.ready;
      const d = pdfCollect(printEl), pages = pdfBreaks(d, (PDF_PAGE.h - PDF_PAGE.top - PDF_PAGE.bottom) * PDF_MM);
      const cards = [...printEl.querySelectorAll('.op-slide, .op-note')].map(e => { const r = e.getBoundingClientRect(), b = printEl.getBoundingClientRect(); return [r.top - b.top, r.bottom - b.top]; });
      printEl.removeAttribute('style'); printEl.innerHTML = '';
      return { pages, cards, glyphs:d.glyphs.length };
    }""")
    assert len(res["pages"]) >= 2 and res["glyphs"] > 100
    for pg in res["pages"][:-1]:
        cut = pg["cut"]
        assert not any(a < cut - 0.5 and b > cut + 0.5 for a, b in res["cards"]), cut   # карточка не разрезана


def test_share_window_link_and_system_share_pdf(browser, base_url, sermon):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=TG)
    wait_home(page)
    page.evaluate("""() => { window.__shared = null;
      navigator.canShare = o => !!(o && o.files && o.files.length);
      navigator.share = async o => { window.__shared = { name:o.files[0].name, type:o.files[0].type, size:o.files[0].size }; }; }""")
    open_sermon(page, sermon, edit=False)
    page.evaluate("openShare()")
    sheet = page.locator(".sheet.share")
    sheet.wait_for()
    assert [t.strip() for t in sheet.locator(".share-sec > .lbl").all_text_contents()] == ["Ссылка на конспект", "PDF-файл"]
    page.wait_for_selector(".share .oplink-url")
    assert "#op=" in page.locator(".share .oplink-url").input_value()
    btn = sheet.get_by_role("button", name="Отправить PDF…")
    btn.wait_for()
    btn.click()
    page.wait_for_function("window.__shared")
    assert page.evaluate("window.__shared.name") == "2026-11-15 Тест формы — оператор.pdf"
    assert page.evaluate("window.__shared.type") == "application/pdf" and page.evaluate("window.__shared.size") > 10000
    assert not page.errors, page.errors
    ctx.close()


def test_share_pdf_on_desktop_without_file_share_downloads_and_opens_chat(browser, base_url, sermon):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=TG)
    wait_home(page)
    page.evaluate("navigator.canShare = () => false; window.__opened = []; window.tgOpen = tg => window.__opened.push(tg); 0")   # «; 0»: иначе evaluate вызовет саму функцию
    open_sermon(page, sermon, edit=False)
    page.evaluate("openShare()")
    tg = page.locator(".share .share-sec").nth(1).get_by_role("button", name="В Telegram")
    tg.wait_for()
    assert "перетащите файл" in page.locator(".share .share-sec").nth(1).inner_text()
    tg.click()
    assert [t.strip() for t in page.locator(".dd-list button").all_inner_texts()] == ["Олег Операторов", "Другому…"]
    with page.expect_download() as dl:
        page.locator(".dd-list button", has_text="Олег").click()
    assert dl.value.suggested_filename.endswith(" — оператор.pdf")
    assert page.evaluate("window.__opened") == ["oleg_op"]
    tg.click()
    with page.expect_download():
        page.locator(".dd-list button", has_text="Другому…").click()
    assert page.evaluate("window.__opened") == ["oleg_op", ""]
    assert not page.errors, page.errors
    ctx.close()


def test_author_without_edit_rights_sees_only_pdf(browser, base_url):
    other = rec("o1", "Чужой", owner="admin@x.pl")
    other["blocks"].append({"id": "b2", "type": "thesis", "name": "Мысль", "parts": [{"kind": "text", "html": "Мысль"}]})
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=TG, sermons={"o1": other})
    wait_home(page)
    page.evaluate("navigate(sermonHash('o1'))")
    page.wait_for_function("state && state.id === 'o1' && ed.id === 'o1' && !ed.busy")
    assert "Поделиться" in menu_items(page)
    page.evaluate("openShare()")
    page.wait_for_selector(".sheet.share")
    assert [t.strip() for t in page.locator(".share .share-sec > .lbl").all_text_contents()] == ["PDF-файл"]
    assert page.evaluate("Object.keys(fakeCloud.db().shares || {}).length") == 0   # ссылку не делали
    assert not page.errors, page.errors
    ctx.close()
