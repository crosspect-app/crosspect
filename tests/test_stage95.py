"""Этап 9.5: «Своя заставка», ширина текста у цитаты «слева / справа», окно хода выгрузки со знаком, заметки PowerPoint."""
import zipfile

import pytest
from conftest import ME, cloud_page, open_sermon, start_blank

MEMBERS = {"admin@x.pl": {"role": "editor"}}


@pytest.fixture
def mpage(browser, base_url):
    """Как обычная страница, но с включённым движением: окно хода выгрузки играет знак."""
    ctx, pg = cloud_page(browser, base_url, user=ME, members=MEMBERS, reduced_motion="no-preference")
    pg.wait_for_selector(".home-top")
    yield pg
    ctx.close()


def download(page, call):
    with page.expect_download(timeout=120000) as dl:
        page.evaluate(call)
    return dl.value


# ---------- «Своя заставка» ----------

def test_custom_splash_defaults_and_normalize(page):
    r = page.evaluate("""() => {
      const n = d => normalize(d).settings.customSplash === true;
      return [n({ blocks:[] }), n({ blocks:[], settings:{ customSplash:true } }), n({ blocks:[{ id:'s', type:'splash', custom:true }] }),   // старое поле у заставки переезжает в настройки проповеди
              'custom' in normalize({ blocks:[{ id:'s', type:'splash', custom:true }] }).blocks[0], 'custom' in newBlock('splash')]; }""")
    assert r == [False, True, True, False, False]


def test_custom_splash_switch_applies_to_every_splash(page, sermon):
    """Этап 9.6: свою заставку видно чёрным экраном с надписью (значка «своя» больше нет), пояснение — только когда включена"""
    open_sermon(page, sermon)
    page.evaluate("state.blocks.splice(3, 0, newBlock('splash')); renderMain(); selectBlock(state.blocks.find(b => b.type === 'splash').id)")
    sw = page.locator(".side .own-splash .switch")
    sw.wait_for()
    assert "Своя заставка" in sw.inner_text()
    assert not page.locator(".side .own-splash .hint").is_visible()   # выключена — пояснения нет
    sw.click()
    assert page.evaluate("state.settings.customSplash") is True
    assert page.locator(".side .own-splash .hint").is_visible()
    page.wait_for_function("document.querySelectorAll('.film .sl.sl-custom').length === 2")   # на всех заставках сразу
    assert page.locator(".st .own").count() == 0   # значка «своя» нет
    assert page.locator(".stage .sl-custom .sl-sp-title").inner_text() == "Добавить свою заставку"
    page.evaluate("state.blocks.push(newBlock('splash')); renderMain()")
    assert page.evaluate("state.blocks.filter(isCustomSplash).length") == 3   # и на новых
    page.wait_for_function("document.querySelectorAll('.film .sl.sl-custom').length === 3")
    sw.click()
    assert not page.evaluate("state.settings.customSplash")
    assert not page.locator(".side .own-splash .hint").is_visible()
    page.wait_for_function("document.querySelectorAll('.sl.sl-custom').length === 0")
    assert page.errors == []


def test_custom_splash_is_black_in_pptx_with_note(page, sermon):
    pptx = pytest.importorskip("pptx")
    open_sermon(page, sermon)
    page.evaluate("state.blocks.splice(3, 0, newBlock('splash')); state.settings.customSplash = true")
    prs = pptx.Presentation(download(page, "exportPPTX()").path())
    types = page.evaluate("state.blocks.filter(b => TYPES[b.type].slide).map(b => b.type)")
    names = page.evaluate("(() => { const n = slideNums(); return state.blocks.filter(b => TYPES[b.type].slide).map(b => slideName(b, n[b.id])); })()")
    slides = list(prs.slides)
    for i in [i for i, t in enumerate(types) if t == "splash"]:   # все заставки — чёрные
        assert not any(sh.shape_type == 13 for sh in slides[i].shapes)
        assert slides[i].notes_slide.notes_text_frame.text == names[i] + "\nСвоя заставка"
    assert page.errors == []


def test_only_first_splash_goes_to_jpeg_archive(page, sermon):
    """Этап 9.6: у всех заставок один номер в Holyrics — в архив идёт первая; своя заставка не входит совсем"""
    open_sermon(page, sermon)
    page.evaluate("state.blocks.unshift(newBlock('splash')); state.blocks.splice(4, 0, newBlock('splash'))")
    z = zipfile.ZipFile(download(page, "exportMany()").path())
    names = [n for n in z.namelist() if n.endswith(".jpg")]
    assert len([n for n in names if "Заставка" in n]) == 1 and "[1] Заставка" in "".join(names), names
    page.evaluate("state.settings.customSplash = true")
    z = zipfile.ZipFile(download(page, "exportMany()").path())
    assert not any("Заставка" in n for n in z.namelist()), z.namelist()
    # JPEG одной обычной заставки остаётся
    page.evaluate("delete state.settings.customSplash")
    d = download(page, "exportOne(state.blocks.find(b => b.type === 'splash'))")
    assert d.suggested_filename.endswith(".jpg") and "Заставка" in d.suggested_filename


def test_archive_with_only_splash_says_nothing_to_collect(page):
    start_blank(page)
    page.evaluate("addBlock('splash'); state.settings.customSplash = true; exportMany()")   # обычная заставка в архив входит (этап 9.6), своя — нет
    page.wait_for_selector(".toast:has-text('нет слайдов для архива')")


# ---------- Нижняя строка, обводка цитаты, название тезиса ----------

def test_thesis_has_no_name_field_and_auto_name(page):
    start_blank(page)
    page.evaluate("addBlock('thesis')")
    page.wait_for_selector(".side .bbody")
    assert page.locator(".side .namebox").count() == 0
    page.evaluate("(() => { const b = state.blocks.find(b => b.type === 'thesis'); b.text = 'Бегать прыгать дышать'; b.parts[0].html = 'Бегать прыгать дышать'; change(); })()")
    assert page.evaluate("slideName(state.blocks.find(b => b.type === 'thesis'), 1)") == "[1] Бегать прыгать дышать"
    assert page.evaluate("missingNames().length") == 0   # пустое название тезиса не мешает выгрузке


def test_quote_dashed_frame_switch(page):
    start_blank(page)
    page.evaluate("addBlock('quote')")
    page.wait_for_selector(".bbody .switch")
    assert page.evaluate("newBlock('quote').frame") is False
    page.locator(".bbody .switch", has_text="Обводка пунктиром").click()
    assert page.evaluate("state.blocks.find(b => b.type === 'quote').frame") is True
    page.wait_for_function("document.querySelector('.stage .sl-inner').classList.contains('framed')")
    assert page.evaluate("getComputedStyle(document.querySelector('.stage .sl-inner')).borderTopStyle") == "dashed"
    assert page.evaluate("normalize({ blocks:[{ id:'q', type:'quote', text:'x' }] }).blocks[0].frame") is False


# ---------- Ширина текста у цитаты ----------

HALF = """([half, w]) => {
  const b = Object.assign(newBlock('quote'), { text:'Вера — живое, смелое доверие к Божьей благодати', author:'Мартин Лютер', caption:'Предисловие', half });
  if (w !== null) b.halfW = w;
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-40000px;top:0;width:1920px;height:1080px';
  const sl = slideEl(b); sl.style.width = '1920px'; host.append(sl); document.body.append(host); fitSlide(sl, b);
  const s = sl.getBoundingClientRect();
  const r = q => { const x = sl.querySelector(q).getBoundingClientRect(); return { l:x.left - s.left, r:x.right - s.left, t:x.top - s.top, b:x.bottom - s.top }; };
  const out = { box:r('.sl-box'), inner:r('.sl-inner'), author:r('.sl-author') };
  host.remove(); return out; }"""


@pytest.mark.parametrize("w", [30, 50, 80])
def test_quote_area_width_follows_halfw(page, w):
    L = page.evaluate(HALF, ["left", w])
    R = page.evaluate(HALF, ["right", w])
    edge = 1920 * w / 100
    assert abs(L["box"]["r"] - (edge - 48)) <= 1, L   # от края слайда до границы области минус зазор 48 px
    assert abs(R["box"]["l"] - (1920 - edge + 48)) <= 1, R
    assert L["inner"]["r"] <= edge - 48 + 1 and R["inner"]["l"] >= 1920 - edge + 48 - 1
    assert L["author"]["r"] <= edge - 48 + 1   # подпись держится в пределах той же ширины
    assert R["author"]["l"] >= 1920 - edge + 48 - 1 or R["author"]["r"] > 1900   # справа подпись у правого края, не шире области
    assert R["author"]["r"] - R["author"]["l"] <= edge - 48 - 60 + 1


def test_quote_area_default_is_half_for_old_quotes(page):
    old = page.evaluate(HALF, ["left", None])
    fifty = page.evaluate(HALF, ["left", 50])
    assert old == fifty
    assert page.evaluate("normalize({ blocks:[{ id:'q', type:'quote', text:'x', half:'left' }] }).blocks[0].halfW") == 50


def test_halfw_is_clamped_by_normalize(page):
    r = page.evaluate("""() => [10, 99, 'x', 62.4, null, undefined, 35].map(v => normalize({ blocks:[{ id:'q', type:'quote', text:'x', halfW:v }] }).blocks[0].halfW)""")
    assert r == [30, 80, 50, 62, 50, 50, 35]


def test_wider_area_means_wider_text(page):
    narrow = page.evaluate(HALF, ["left", 30])["box"]
    wide = page.evaluate(HALF, ["left", 80])["box"]
    assert wide["r"] - wide["l"] > narrow["r"] - narrow["l"] + 800


def test_halfw_slider_appears_only_for_half_layouts(page):
    start_blank(page)
    page.evaluate("addBlock('quote')")
    page.wait_for_selector(".bbody .toggle")
    slider = page.locator(".half-w input[type=range]")
    assert slider.count() == 0   # «Во всю ширину»
    page.get_by_role("button", name="Текст слева").click()
    assert slider.count() == 1
    assert (slider.get_attribute("min"), slider.get_attribute("max"), slider.get_attribute("step"), slider.input_value()) == ("30", "80", "5", "50")
    slider.fill("35")
    assert page.evaluate("state.blocks.find(b => b.type === 'quote').halfW") == 35
    assert page.locator(".half-w-val").inner_text() == "35%"
    page.wait_for_function("document.querySelector('.stage .sl-box-quote').style.getPropertyValue('--hw') === '35%'")
    page.get_by_role("button", name="Текст справа").click()
    assert slider.input_value() == "35"   # значение остаётся при смене стороны
    page.get_by_role("button", name="Во всю ширину").click()
    assert slider.count() == 0
    assert page.errors == []


# ---------- Окно хода выгрузки ----------

HOOK = """() => {
  window.__snaps = [];
  const orig = window.renderJPEG;
  window.renderJPEG = async b => {
    const w = document.querySelector('.exp-prog');
    const ps = w ? [...w.querySelectorAll('.exp-mark path')] : [];
    window.__snaps.push({ wins:document.querySelectorAll('.exp-prog').length, text:w ? w.querySelector('.exp-t').textContent : '',
      inBody:!!w && w.parentElement === document.body, inSlide:!!w && !!w.closest('.sl'),
      anims:ps.reduce((n, p) => n + p.getAnimations().length, 0), running:ps.every(p => p.getAnimations().every(a => a.playState === 'running')),
      noMotion:document.documentElement.classList.contains('no-motion'), stacked:[...document.querySelectorAll('.toast')].filter(t => t.textContent.includes(' из ')).length,
      bar:w ? w.querySelector('.exp-bar i').style.transform : '' });
    return orig(b);
  };
}"""


def test_pptx_progress_window_with_playing_mark(mpage, sermon):
    open_sermon(mpage, sermon)
    mpage.evaluate(HOOK)
    download(mpage, "exportPPTX()")
    snaps = mpage.evaluate("window.__snaps")
    total = mpage.evaluate("state.blocks.filter(b => TYPES[b.type].slide).length")
    assert snaps, "ни один слайд не снимался"
    for i, s in enumerate(snaps):
        assert s["wins"] == 1 and s["inBody"] and not s["inSlide"], s   # одно окно, вне слайдов и снимков
        assert s["text"].startswith("Собираю PowerPoint: ") and s["text"].endswith(" из %d" % total), s
        assert s["anims"] >= 3 and s["running"], s   # три части знака играют, хотя движение на время сборки выключено
        assert s["noMotion"] is True
        assert s["stacked"] == 0   # стопки сообщений «N из M» больше нет
    assert snaps[0]["text"] == "Собираю PowerPoint: 1 из %d" % total
    assert snaps[0]["bar"] == "scaleX(0)"
    assert snaps[-1]["bar"] != "scaleX(0)"
    # в конце: окно закрывается, итог — одним сообщением
    mpage.wait_for_function("!document.querySelector('.exp-prog')", timeout=5000)
    toasts = mpage.evaluate("[...document.querySelectorAll('.toast')].map(t => t.textContent)")
    assert len(toasts) == 1 and toasts[0].startswith("Скачан PowerPoint: "), toasts
    assert mpage.errors == []


def test_progress_window_closes_with_whole_mark_and_done_state(mpage, sermon):
    open_sermon(mpage, sermon)
    mpage.evaluate("""() => { window.__fin = null; const o = exportProgress; window.exportProgress = (t, n) => { const p = o(t, n), e = p.end; p.end = () => { e(); window.__fin = { cls:p.el.className, text:p.el.querySelector('.exp-t').textContent,
      anims:[...p.el.querySelectorAll('.exp-mark path')].reduce((n, x) => n + x.getAnimations().length, 0), bar:p.el.querySelector('.exp-bar i').style.transform }; }; return p; }; }""")
    download(mpage, "exportPPTX()")
    fin = mpage.evaluate("window.__fin")
    assert "done" in fin["cls"] and fin["anims"] == 0 and fin["bar"] == "scaleX(1)" and fin["text"] == "Готово", fin   # знак собран целиком, полоска полная


def test_jpeg_archive_uses_the_same_window(mpage, sermon):
    open_sermon(mpage, sermon)
    mpage.evaluate(HOOK)
    download(mpage, "exportMany()")
    snaps = mpage.evaluate("window.__snaps")
    assert snaps and all(s["wins"] == 1 and s["text"].startswith("Готовлю слайды: ") and s["stacked"] == 0 for s in snaps), snaps
    mpage.wait_for_function("!document.querySelector('.exp-prog')", timeout=5000)
    assert mpage.evaluate("[...document.querySelectorAll('.toast')].map(t => t.textContent)")[0].startswith("Скачан архив")


def test_progress_mark_stands_still_with_reduced_motion(page, sermon):
    open_sermon(page, sermon)   # обычная фикстура: «уменьшить движение»
    page.evaluate(HOOK)
    download(page, "exportPPTX()")
    snaps = page.evaluate("window.__snaps")
    assert snaps and all(s["wins"] == 1 and s["anims"] == 0 for s in snaps), snaps   # окно есть, знак стоит
    assert page.errors == []


def test_progress_window_does_not_reach_slide_snapshots(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("""() => { window.__inSvg = []; const o = window.renderJPEG; window.renderJPEG = async b => {
      const blob = await o(b); window.__inSvg.push(blob.size > 1000); return blob; }; }""")
    download(page, "exportPPTX()")
    assert all(page.evaluate("window.__inSvg"))
    # снимок строится из клона самого слайда (renderJPEG), окно хода к нему не относится: проверяем, что оно не внутри .sl
    assert page.evaluate("document.querySelectorAll('.sl .exp-prog, .sl .exp-mark').length") == 0


def test_progress_window_removed_after_error(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("() => { window.renderJPEG = async () => { throw new Error('сбой'); }; }")
    page.evaluate("exportPPTX()")
    page.wait_for_selector(".toast:has-text('Не получилось собрать PowerPoint')")
    assert page.locator(".exp-prog").count() == 0
    assert page.evaluate("exporting") is False


def test_single_jpeg_and_pdf_use_progress_window(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("""() => { window.__w = []; const o = window.renderJPEG; window.renderJPEG = async b => { window.__w.push(document.querySelectorAll('.exp-prog').length); return o(b); }; }""")
    d = download(page, "exportOne(state.blocks.find(b => b.type === 'thesis'))")
    assert d.suggested_filename.endswith(".jpg")
    assert page.evaluate("window.__w") == [1]
    page.wait_for_function("!document.querySelector('.exp-prog')", timeout=5000)
    assert page.evaluate("[...document.querySelectorAll('.toast')].map(t => t.textContent)")[0].startswith("Скачано: ")
    # PDF: окно хода, потом одно сообщение про «Сохранить как PDF»
    page.evaluate("window.print = () => { window.__printed = document.querySelectorAll('.exp-prog').length; }; operatorPDF()")
    page.wait_for_function("window.__printed !== undefined", timeout=5000)
    assert page.evaluate("window.__printed") == 0   # окно хода закрыто до печати
    assert page.evaluate("[...document.querySelectorAll('.toast')].filter(t => t.textContent.includes('Сохранить как PDF')).length") == 1


# ---------- Заметки PowerPoint ----------

def test_notes_of_black_slides_keep_task_comments(page, sermon):
    pptx = pytest.importorskip("pptx")
    open_sermon(page, sermon)
    prs = pptx.Presentation(download(page, "exportPPTX()").path())
    slides = list(prs.slides)
    types = page.evaluate("state.blocks.filter(b => TYPES[b.type].slide).map(b => b.type)")
    img = slides[types.index("image")].notes_slide.notes_text_frame.text
    assert img.startswith("[") and "Описание: " in img or "Пришлю отдельно" in img
    for t in ("thesis", "quote", "scripture"):
        assert "Текст:" not in slides[types.index(t)].notes_slide.notes_text_frame.text
    assert page.errors == []
