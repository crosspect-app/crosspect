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
      const c = v => { const b = { id:'s', type:'splash' }; if (v !== undefined) b.custom = v; return normalize({ blocks:[b] }).blocks[0].custom; };
      return [c(true), c(false), c(undefined), c('да'), newBlock('splash').custom, 'custom' in normalize({ blocks:[{ id:'t', type:'thesis', custom:true }] }).blocks[0]]; }""")
    assert r == [True, False, False, True, False, False]   # у старых заставок выкл.; у других слайдов поля нет


def test_custom_splash_switch_badge_and_thumbnail(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("selectBlock(state.blocks.find(b => b.type === 'splash').id)")
    sw = page.locator(".own-splash")
    sw.wait_for()
    assert sw.get_by_text("Своя заставка").count() == 1
    th = page.locator(".st.t-splash").first
    assert not th.locator(".own").is_visible()
    sw.click()
    assert page.evaluate("state.blocks.find(b => b.type === 'splash').custom") is True
    assert th.locator(".own").is_visible()
    assert th.locator(".own").get_attribute("title") == "Своя заставка: в PowerPoint будет чёрным слайдом"
    # значок не там, где «доработать»
    page.evaluate("state.blocks.find(b => b.type === 'splash').todo = true; refreshThumb(state.blocks.find(b => b.type === 'splash'))")
    own, fl = th.locator(".own").bounding_box(), th.locator(".fl").bounding_box()
    assert own["y"] >= fl["y"] + fl["height"] or own["x"] + own["width"] <= fl["x"], (own, fl)   # не накладываются
    assert own["x"] < fl["x"] and own["y"] > fl["y"]   # другой угол: слева внизу
    sw.click()
    assert page.evaluate("state.blocks.find(b => b.type === 'splash').custom") is False
    assert not th.locator(".own").is_visible()
    assert page.errors == []


def test_custom_splash_is_per_splash_and_undoable(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("state.blocks.splice(3, 0, newBlock('splash'))")
    r = page.evaluate("""() => { const sp = state.blocks.filter(b => b.type === 'splash'); sp[0].custom = true; return sp.map(b => b.custom); }""")
    assert r == [True, False]   # на другие и на новые заставки не действует
    assert page.evaluate("newBlock('splash').custom") is False
    # смена «своей заставки» не ставит «доработать» вместо редактора: сигнатура слайда не меняется
    assert page.evaluate("(() => { const b = state.blocks.find(x => x.type === 'splash'), a = blockSig(b); b.custom = !b.custom; return a === blockSig(b); })()")


def test_custom_splash_is_black_in_pptx_with_note(page, sermon):
    pptx = pytest.importorskip("pptx")
    open_sermon(page, sermon)
    page.evaluate("state.blocks.splice(3, 0, newBlock('splash')); state.blocks.find(b => b.type === 'splash').custom = true")
    prs = pptx.Presentation(download(page, "exportPPTX()").path())
    types = page.evaluate("state.blocks.filter(b => TYPES[b.type].slide).map(b => b.type)")
    names = page.evaluate("(() => { const n = slideNums(); return state.blocks.filter(b => TYPES[b.type].slide).map(b => slideName(b, n[b.id])); })()")
    slides = list(prs.slides)
    first, second = [i for i, t in enumerate(types) if t == "splash"]
    assert not any(sh.shape_type == 13 for sh in slides[first].shapes)   # чёрный слайд
    assert slides[first].notes_slide.notes_text_frame.text == names[first] + "\nСвоя заставка"
    assert any(sh.shape_type == 13 for sh in slides[second].shapes)   # вторая заставка — обычная
    assert slides[second].notes_slide.notes_text_frame.text == names[second]
    assert page.errors == []


def test_custom_splash_not_in_jpeg_archive_but_single_jpeg_works(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("state.blocks.splice(3, 0, newBlock('splash')); state.blocks.find(b => b.type === 'splash').custom = true")
    z = zipfile.ZipFile(download(page, "exportMany()").path())
    names = [n for n in z.namelist() if n.endswith(".jpg")]
    assert not any("Заставка" in n and "[1]" in n for n in names), names
    assert sum("Заставка" in n for n in names) == 1   # вторая заставка в архиве есть
    # JPEG одного слайда остаётся обычным
    d = download(page, "exportOne(state.blocks.find(b => b.type === 'splash'))")
    assert d.suggested_filename.endswith(".jpg")
    assert page.errors == []


def test_custom_splash_alone_gives_nothing_for_archive(page):
    start_blank(page)
    page.evaluate("addBlock('splash'); state.blocks.find(b => b.type === 'splash').custom = true; exportMany()")
    page.wait_for_selector(".toast:has-text('нет слайдов, которые форма собирает сама')")


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


def test_single_jpeg_updates_same_toast(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("""() => { window.__t = []; const o = window.toast; window.toast = function(){ const el = o.apply(this, arguments); window.__t.push(el); return el; };
      const sh = window.toastSet; window.toastSet = function(el, m){ const r = sh.apply(this, arguments); window.__t.push(r); return r; }; }""")
    d = download(page, "exportOne(state.blocks.find(b => b.type === 'thesis'))")
    assert d.suggested_filename.endswith(".jpg")
    r = page.evaluate("({ n:document.querySelectorAll('.toast').length, texts:[...document.querySelectorAll('.toast')].map(t => t.textContent), same:new Set(window.__t).size })")
    assert r["n"] == 1 and r["texts"][0].startswith("Скачано: ") and r["same"] == 1, r   # «Готовлю JPEG…» стало «Скачано: …» в том же окошке


def test_toast_set_falls_back_when_toast_is_gone(page):
    r = page.evaluate("""() => { const t = toast('раз'); t.remove(); const n = toastSet(t, 'два'); return [n !== t, n.textContent.startsWith('два')]; }""")
    assert r == [True, True]


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
