"""Этап 9.6: одна заставка в Holyrics, правки после ревью (орфография по языку, проблемные слайды, «Текст», найти и заменить)."""
import pytest
from conftest import cloud_page, open_sermon, start_blank


# ---------- Нумерация: все заставки — с номером первой ----------

def test_all_splashes_share_the_first_number(page):
    start_blank(page)
    r = page.evaluate("""() => {
      state.blocks = ['splash', 'scripture', 'thesis', 'splash', 'quote'].map(t => newBlock(t));
      const n = slideNums();
      return [state.blocks.map(b => n[b.id]), n._total];
    }""")
    assert r == [[1, 2, 3, 1, 4], 4]
    names = page.evaluate("(() => { const n = slideNums(); return state.blocks.map(b => slideName(b, n[b.id])); })()")
    assert names[0].startswith("[1] Заставка") and names[3].startswith("[1] Заставка") and names[4].startswith("[4]")


def test_first_slide_not_splash_keeps_order_without_gaps(page):
    start_blank(page)
    r = page.evaluate("""() => {
      state.blocks = ['thesis', 'splash', 'quote', 'splash'].map(t => newBlock(t));
      const n = slideNums(); return state.blocks.map(b => n[b.id]);
    }""")
    assert r == [1, 2, 3, 2]


def test_operator_snapshot_uses_same_numbers(page):
    start_blank(page)
    r = page.evaluate("""() => {
      state.blocks = ['splash', 'scripture', 'note', 'thesis', 'splash', 'quote'].map(t => newBlock(t));
      return opSnapshot(state).blocks.filter(x => x.t !== 'note').map(x => x.n);
    }""")
    assert r == [1, 2, 3, 1, 4]


def test_pdf_count_is_number_of_distinct_numbers(page):
    start_blank(page)
    page.evaluate("state.blocks = ['splash', 'scripture', 'thesis', 'splash', 'quote'].map(t => newBlock(t)); buildOperatorPrint()")
    assert "слайдов: 4" in page.locator(".op-meta").inner_text()


# ---------- «Своя заставка»: чёрный экран с надписью, JPEG неактивен ----------

def test_custom_splash_stage_is_black_with_caption_and_no_jpeg(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("state.settings.customSplash = true; renderMain(); selectBlock(state.blocks.find(b => b.type === 'splash').id)")
    page.wait_for_selector(".stage .sl.sl-custom")
    title = page.locator(".stage .sl-custom .sl-sp-title")
    assert title.inner_text() == "Добавить свою заставку"
    size = page.evaluate("parseFloat(getComputedStyle(document.querySelector('.stage .sl-custom .sl-sp-title')).fontSize)")
    assert size == 50
    assert page.evaluate("getComputedStyle(document.querySelector('.stage .sl-custom .sl-frame')).display") == "none"
    assert page.evaluate("getComputedStyle(document.querySelector('.stage .sl-custom .sl-sp-title')).fontWeight") in ("700", "800", "900")
    assert page.locator(".stage-bar button", has_text="JPEG").is_disabled()
    # выключили — снова обычная заставка, кнопка активна
    page.evaluate("delete state.settings.customSplash; renderMain(); selectBlock(state.blocks.find(b => b.type === 'splash').id)")
    page.wait_for_selector(".stage .sl:not(.sl-custom)")
    assert page.locator(".stage-bar button", has_text="JPEG").is_enabled()
    assert page.errors == []


# ---------- Орфография и неразрывные пробелы по языку ----------

def test_typo_short_words_by_language(page):
    start_blank(page)
    r = page.evaluate("""() => [
      typoText('А що до нього під мостом', 'uk'), typoText('To jest dla was, że tak', 'pl'), typoText('Nie ma w tym nic', 'pl'),
      typoText('to be or not', 'en'), typoText('Что же ты без меня', 'ru'), typoText('Він же ж пішов', 'uk')]""")
    nb = "\u00a0"
    assert r[0] == f"А{nb}що{nb}до{nb}нього під{nb}мостом"
    assert r[1] == f"To{nb}jest dla{nb}was, że{nb}tak"   # «jest» — не короткое слово; польское «że» — с диакритикой
    assert r[2] == f"Nie ma{nb}w{nb}tym nic"
    assert r[3] == f"to{nb}be{nb}or{nb}not"
    assert r[4] == f"Что{nb}же{nb}ты{nb}без{nb}меня"   # русский — как раньше
    assert r[5] == f"Він{nb}же{nb}ж{nb}пішов"


def test_field_lang_follows_scripture_translation_or_sermon_language(page):
    start_blank(page)
    r = page.evaluate("""() => {
      const sc = (lang) => ({ type:'scripture', items:[{ kind:'scripture', manual:false, lang }] });
      state.settings.lang = 'uk';
      return [textLang(sc('pl')), textLang(sc('ukt')), textLang({ type:'thesis' }), textLang(null), textLang(sc('own'))]; }""")
    assert r == ["pl", "uk", "uk", "uk", "uk"]
    page.evaluate("""() => {
      state.settings.lang = 'ru';
      const b = newBlock('scripture'); b.items[0].lang = 'pl'; b.items.push(newTextItem());
      const t = newBlock('thesis'); state.blocks.push(b, t); renderMain(); selectBlock(b.id); }""")
    page.wait_for_selector(".side .rich")
    assert {el for el in page.eval_on_selector_all(".side .rich", "els => els.map(e => e.lang)")} == {"pl"}
    assert page.locator(".speech-text").first.get_attribute("lang") == "pl"
    page.evaluate("selectBlock(state.blocks[state.blocks.length - 1].id)")
    page.wait_for_function("document.querySelector('.side .rich') && document.querySelector('.side .rich').lang === 'ru'")


# ---------- Проблемные слайды на миниатюрах ----------

def test_problem_markers_by_status(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("""() => {
      const th = newBlock('thesis');                                    // пустой
      const ok = newBlock('thesis'); ok.parts[0].html = 'Бог любит'; syncThesisText(ok);
      const long = newBlock('quote'); long.text = 'а'.repeat(limitFor(long) + 5);
      const img = newBlock('image');                                    // без названия
      const sc = newBlock('scripture');                                 // без места
      window.__ids = { th:th.id, ok:ok.id, long:long.id, img:img.id, sc:sc.id };
      state.blocks.push(th, ok, long, img, sc); renderMain(); }""")
    page.wait_for_selector(".film .st")
    assert page.locator(".film .pb").count() == 0   # «Черновик» — значков нет
    page.evaluate("state.cloudStatus = 'submitted'; syncFilm()")
    tip = lambda k: page.locator(f".st[data-id='{page.evaluate('__ids.' + k)}'] .pb").get_attribute("title")
    assert tip("th") == "Слайд пустой"
    assert tip("img") == "Нет названия слайда"
    assert tip("sc") == "Не указано место Писания"
    assert tip("long").startswith("Много текста: ")
    assert page.locator(f".st[data-id='{page.evaluate('__ids.ok')}'] .pb").count() == 0
    page.evaluate("state.cloudStatus = 'work'; syncFilm()")
    assert page.locator(".film .pb").count() >= 4   # дальше по статусам — тоже видны
    page.evaluate("state.cloudStatus = 'draft'; syncFilm()")
    assert page.locator(".film .pb").count() == 0
    assert page.errors == []


def test_problem_marker_click_selects_and_sits_away_from_todo_flag(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("""() => { const th = newBlock('thesis'); th.todo = true; window.__id = th.id; state.blocks.push(th); state.cloudStatus = 'submitted'; renderMain(); }""")
    pb = page.locator(".st[data-id='" + page.evaluate("__id") + "'] .pb")
    pb.wait_for()
    th = page.locator(".st[data-id='" + page.evaluate("__id") + "']")
    page.evaluate("document.querySelector('.st[data-id=\"' + __id + '\"] .fl').style.display = 'block'")
    a, f = pb.bounding_box(), th.locator(".fl").bounding_box()
    assert a["x"] + a["width"] <= f["x"] or a["y"] + a["height"] <= f["y"]   # не налезают друг на друга
    page.evaluate("selectBlock(state.blocks[0].id)")
    pb.click()
    assert page.evaluate("selId") == page.evaluate("__id")


def test_problem_marker_for_squeezed_scripture(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("""() => {
      const b = newBlock('scripture'), it = b.items[0];
      Object.assign(it, { manual:true, ref:'Ин 3:16', mBook:'Ин', mChapter:'3', mVerses:'16' }); it.verses = [{ num:'16', text:'слово '.repeat(900) }];
      window.__sq = b.id; state.blocks.push(b); state.cloudStatus = 'submitted'; renderMain(); }""")
    pb = page.locator(".st[data-id='" + page.evaluate("__sq") + "'] .pb")
    pb.wait_for(timeout=15000)
    assert "Текст сжат до " in pb.get_attribute("title")
    assert page.errors == []


# ---------- Список: прошедшие приглушены; вид «Текст» открыт без названий ----------

def test_past_sermons_are_muted_in_list(browser, base_url):
    from test_cloud import ADMIN, rec
    S = {"a": dict(rec("a", "Будущая", date="2099-02-01", at=10)), "c": dict(rec("c", "Прошлая", date="2020-05-03", at=12)),
         "d": dict(rec("d", "Без даты", date="", at=13))}
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members={"admin@x.pl": {"role": "editor"}}, sermons=S)
    page.wait_for_selector(".scard")
    op = lambda title: float(page.evaluate("t => getComputedStyle([...document.querySelectorAll('a.srow')].find(a => a.textContent.includes(t))).opacity", title))
    assert op("Прошлая") < 1 and op("Будущая") == 1 and op("Без даты") == 1   # без даты — не прошедшая
    assert page.errors == []
    ctx.close()


def test_text_view_opens_without_slide_names_but_exports_need_them(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("state.blocks.push(newBlock('image'))")   # слайд без названия
    page.evaluate("setView('text')")
    page.wait_for_selector(".tv-doc")
    assert page.locator(".toast:has-text('Напишите названия')").count() == 0
    # выгрузка без названия — не собирается, ведёт к пустому названию
    page.evaluate("exportPPTX()")
    page.wait_for_selector(".toast:has-text('Напишите названия слайдов')")
    assert page.evaluate("view") == "slides"
    assert page.errors == []


# ---------- Найти и заменить ----------

def fr_page(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("""() => {
      const t = newBlock('thesis'); t.parts[0].html = 'Ковчег любит <b>каждого</b> из нас. Ковчег рядом'; syncThesisText(t); t.speech = '<p>Говорю про Ковчега</p>';
      window.__t = t.id; state.blocks.push(t); change(); renderMain(); }""")


def test_find_opens_with_ctrl_f_and_counts_matches(page, sermon):
    fr_page(page, sermon)
    page.keyboard.press("Control+f")
    page.wait_for_selector(".findbar")
    page.fill(".fb-q", "ковчег")
    n = page.evaluate("findAll().length")
    assert n == 3   # без учёта регистра: два «Ковчег» в тезисе и «Ковчега» в тексте к слайду
    assert page.locator(".fb-count").inner_text().startswith("1 из ")
    # переход к слайду с совпадением и вперёд по кругу
    page.press(".fb-q", "Enter")
    page.wait_for_function("document.querySelector('.fb-count').textContent.startsWith('2 из')")
    page.evaluate("selectBlock(state.blocks[0].id)")
    page.click(".fb-next")
    assert page.evaluate("selId") in page.evaluate("[...new Set(findAll().map(h => h.id))]")
    page.fill(".fb-q", "такого слова нет")
    assert page.locator(".fb-count").inner_text() == "Не найдено"
    page.keyboard.press("Escape")
    assert page.locator(".findbar").count() == 0
    assert page.errors == []


def test_find_case_toggle_and_nbsp(page, sermon):
    fr_page(page, sermon)
    page.evaluate("state.blocks.find(b => b.id === __t).speech = 'Слово\\u00a0Божье и слово божье'")
    page.keyboard.press("Control+f")
    page.fill(".fb-q", "слово б")
    assert page.evaluate("findAll().filter(h => h.id === __t).length") == 2   # неразрывный пробел находится обычным; регистр не важен
    page.click(".fb-cs")
    assert page.evaluate("findAll().filter(h => h.id === __t).length") == 1


def test_replace_all_is_one_undo_step_and_keeps_formatting(page, sermon):
    fr_page(page, sermon)
    before = page.evaluate("histSnap()")
    page.keyboard.press("Control+f")
    page.fill(".fb-q", "Ковчег")
    page.fill(".fb-r", "Ящик")
    steps = page.evaluate("hist.undo.length")
    page.click(".fb-all")
    page.wait_for_selector(".toast:has-text('Заменено')")
    r = page.evaluate("(() => { const t = state.blocks.find(b => b.id === __t); return [t.parts[0].html, t.speech, t.name]; })()")
    assert r[0] == "Ящик любит <b>каждого</b> из нас. Ящик рядом" and "Ящик" in r[1] and "Ковчег" not in r[0]
    assert page.evaluate("hist.undo.length") == steps + 1   # один шаг на все замены
    page.locator(".hist-undo").click()
    assert page.evaluate("histSnap()") == before
    assert page.errors == []


def test_replace_one_moves_on_and_does_not_loop_on_itself(page, sermon):
    fr_page(page, sermon)
    page.keyboard.press("Control+f")
    page.fill(".fb-q", "Ковчег")
    page.fill(".fb-r", "Ковчег Завета")   # замена сама содержит искомое
    total = page.evaluate("findAll().length")
    page.click(".fb-one")
    assert page.evaluate("findAll().length") == total   # заменили одно: «Ковчег» → «Ковчег Завета», число совпадений прежнее
    assert page.evaluate("state.blocks.find(b => b.id === __t).parts[0].html.split('Ковчег Завета').length - 1") == 1
    page.click(".fb-one")
    assert page.evaluate("state.blocks.find(b => b.id === __t).parts[0].html.split('Ковчег Завета').length - 1") == 2   # вторая замена — следующее вхождение, не то же самое
    assert page.evaluate("state.blocks.find(b => b.id === __t).parts[0].html.includes('Ковчег Завета Завета')") is False


def test_find_in_view_mode_has_no_replace(browser, base_url, sermon):
    from conftest import ME
    ctx, pg = cloud_page(browser, base_url, user=ME, members={"admin@x.pl": {"role": "editor"}})
    pg.wait_for_selector(".home-top")
    open_sermon(pg, sermon, edit=False)
    pg.wait_for_selector(".film .st")
    pg.keyboard.press("Control+f")
    pg.wait_for_selector(".findbar")
    assert not pg.locator(".fb-rep").is_visible()   # просмотр: искать можно, заменять нельзя
    pg.fill(".fb-q", "Десмонд")
    assert pg.locator(".fb-count").inner_text().startswith("1 из")
    ctx.close()


def test_ctrl_f_in_text_view_is_left_to_browser(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("setView('text')")
    page.wait_for_selector(".tv-doc")
    assert page.evaluate("""() => { const e = new KeyboardEvent('keydown', { key:'f', ctrlKey:true, cancelable:true, bubbles:true }); document.dispatchEvent(e); return e.defaultPrevented; }""") is False
    assert page.locator(".findbar").count() == 0
