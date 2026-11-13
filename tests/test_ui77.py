"""Этап 7.7: лента без пересборки, фокус, перетаскивание, переходы, заставка при входе, список проповедей одной таблицей.
Облако подменено: tests/fixtures/fake_cloud.js. Обычные тесты — с «Уменьшить движение»; где нужно движение — MOVE."""
from conftest import cloud_page
from test_cloud import ADMIN, rec
from test_lock import open_sermon, start_edit

MOVE = {"reduced_motion": "no-preference"}
MEMBERS = {"admin@x.pl": {"role": "editor"}}


def thesis(i):
    return {"id": "t%d" % i, "type": "thesis", "speech": "", "valign": "center",
            "parts": [{"kind": "text", "html": "Мысль номер %d: вера без дел мертва" % i, "align": "center", "scale": 100, "caps": True, "frame": False}]}


def long_sermon(n=14, **kw):
    """Заставка + n тезисов: лента длиннее экрана"""
    r = rec("s1", "Вера", **kw)
    r["blocks"] = [{"id": "sp", "type": "splash", "speech": ""}] + [thesis(i) for i in range(1, n + 1)]
    return r


def sermon_page(browser, base_url, motion=False, sermon=None, edit=True):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": sermon or long_sermon()}, **(MOVE if motion else {}))
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    page.wait_for_selector(".film .st")
    if edit:
        start_edit(page)
    return ctx, page


REMEMBER = "window.__nodes = new Map([...document.querySelectorAll('.film .st-box')].map(b => [b.dataset.box, b]))"
CHANGED = "[...document.querySelectorAll('.film .st-box')].filter(b => window.__nodes.get(b.dataset.box) !== b).map(b => b.dataset.box)"
# у каждой миниатюры-слайда в ленте есть разложенный текст (пустая рамка — это .sl-inner без содержимого)
EMPTY_THUMBS = """[...document.querySelectorAll('.film .st-box')].filter(b => {
  const t = b.querySelector('.sl-inner, .sl-sp-title'); return t && !t.textContent.trim(); }).map(b => b.dataset.box)"""


def visible_in_film(page, id):
    """Миниатюра целиком в видимой части ленты (по раскладке, без сдвигов анимации)"""
    return page.evaluate("""id => { const b = filmEl.querySelector('.st-box[data-box="' + id + '"]');
      let a = 0, e = b; while (e && e !== filmEl){ a += e.offsetTop; e = e.offsetParent; }
      return a >= filmEl.scrollTop - 1 && a + b.offsetHeight <= filmEl.scrollTop + filmEl.clientHeight + 1; }""", id)


# ---------- лента не пересобирается ----------

def test_film_nodes_survive_edit_autosave_save(browser, base_url):
    ctx, page = sermon_page(browser, base_url, edit=False)
    page.evaluate(REMEMBER)
    start_edit(page)   # вход в правку: значки и «+» появились, узлы те же
    assert page.evaluate(CHANGED) == []
    assert page.locator(".film .film-gap").count() == 15 and page.locator(".film .st-acts").count() == 15
    # правка текста в правой панели: меняется только содержимое своей миниатюры, узел тот же
    page.locator(".film .st[data-id='t3']").click()
    page.locator(".side .rich").first.click()
    page.keyboard.type(" и любви")
    page.wait_for_function("state.blocks.find(b => b.id === 't3').parts[0].html.includes('любви')")
    page.wait_for_function("document.querySelector('.film .st-box[data-box=\"t3\"] .sl-inner').textContent.includes('любви')")
    assert page.evaluate(CHANGED) == []
    # автосохранение и Ctrl+S
    page.keyboard.press("Control+s")
    page.wait_for_function("!isDirty() && !ed.saving")
    assert page.evaluate(CHANGED) == []
    # «Готово» закрывает правку: значки ушли, узлы те же
    page.locator("#app").get_by_role("button", name="Готово").click()
    page.wait_for_function("ed.mode === 'view'")
    assert page.evaluate(CHANGED) == []
    assert page.locator(".film .st-acts").count() == 0 and page.locator(".film .film-gap").count() == 0
    # сцена и правая панель того же слайда не пересобирались ради ленты: выбран тот же слайд
    assert page.evaluate("selId") == "t3"
    assert not page.errors, page.errors
    ctx.close()


def test_stage_kept_when_same_slide(browser, base_url):
    ctx, page = sermon_page(browser, base_url)
    page.locator(".film .st[data-id='t2']").click()
    page.evaluate("window.__stage = document.querySelector('.stage .sl'); window.__side = document.querySelector('.side .bbody')")
    page.evaluate("duplicate(state.blocks.find(b => b.id === 't5'))")   # выбрана копия: сцена — её
    page.evaluate("selectBlock('t2')")
    page.evaluate("window.__stage = document.querySelector('.stage .sl'); window.__side = document.querySelector('.side .bbody')")
    page.evaluate("renderMain()")   # та же проповедь, тот же слайд: ничего не трогаем
    assert page.evaluate("document.querySelector('.stage .sl') === window.__stage && document.querySelector('.side .bbody') === window.__side")
    ctx.close()


def test_undo_and_remote_update_reuse_nodes(browser, base_url):
    ctx, page = sermon_page(browser, base_url)
    page.evaluate(REMEMBER)
    page.evaluate("removeBlock(state.blocks.find(b => b.id === 't4'))")
    page.keyboard.press("Control+z")
    page.wait_for_function("state.blocks.some(b => b.id === 't4')")
    assert page.evaluate(CHANGED) == ["t4"]   # вернувшийся слайд — новый узел, остальные прежние
    assert page.evaluate(EMPTY_THUMBS) == []
    # «Готово», потом правка другого человека приходит в просмотр: узлы те же, меняется только его миниатюра
    page.locator("#app").get_by_role("button", name="Готово").click()
    page.wait_for_function("ed.mode === 'view'")
    page.evaluate(REMEMBER)
    page.evaluate("""() => { const db = fakeCloud.db(), r = db.sermons.s1; db.clock += 1000;
      r.blocks.find(b => b.id === 't7').parts[0].html = 'Другой человек поправил'; r.updatedAt = Date.now() + db.clock; r.updatedBy = 'ivan@x.pl'; fakeCloud.put(db); }""")
    page.wait_for_function("document.querySelector('.film .st-box[data-box=\"t7\"] .sl-inner').textContent.includes('Другой')")
    assert page.evaluate(CHANGED) == []
    ctx.close()


def test_no_empty_frame_on_open_and_duplicate(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": long_sermon()})
    page.wait_for_selector(".scard")
    # как только лента появилась в документе (до первой отрисовки), в миниатюрах уже есть текст
    page.evaluate("""() => { window.__empty = null; const mo = new MutationObserver(() => {
        if (window.__empty === null && document.querySelector('.film .st-box')){ window.__empty = (%s); mo.disconnect(); } });
      mo.observe(document.getElementById('app'), { childList:true, subtree:true }); }""" % EMPTY_THUMBS)
    page.evaluate("navigate(sermonHash('s1'))")
    page.wait_for_function("window.__empty !== null")
    assert page.evaluate("window.__empty") == []
    start_edit(page)
    # копия — разложена сразу, в том же действии
    assert page.evaluate("(() => { duplicate(state.blocks.find(b => b.id === 't6')); return %s; })()" % EMPTY_THUMBS) == []
    assert page.evaluate("(() => { addBlock('thesis', 3); return %s; })()" % EMPTY_THUMBS) == []
    ctx.close()


def test_drag_moves_nodes_and_lifts(browser, base_url):
    ctx, page = sermon_page(browser, base_url, motion=True)
    page.evaluate(REMEMBER)
    a = page.locator(".film .st[data-id='t1']").bounding_box()
    c = page.locator(".film .st[data-id='t3']").bounding_box()
    page.mouse.move(a["x"] + a["width"] / 2, a["y"] + a["height"] / 2)
    page.mouse.down()
    page.mouse.move(a["x"] + a["width"] / 2, a["y"] + a["height"] / 2 + 20, steps=4)
    page.mouse.move(c["x"] + c["width"] / 2, c["y"] + c["height"] * 0.8, steps=10)
    # приподнят и идёт за указателем; соседи раздвинулись
    assert page.locator(".film .st-box.lifted[data-box='t1']").count() == 1
    assert "translateY" in page.evaluate("document.querySelector('.st-box[data-box=\"t1\"]').style.transform")
    assert page.evaluate("document.querySelector('.st-box[data-box=\"t2\"]').style.transform").startswith("translateY(-")
    page.mouse.up()
    page.wait_for_function("state.blocks[3].id === 't1'")
    assert [x for x in page.evaluate("state.blocks.map(b => b.id)")[:5]] == ["sp", "t2", "t3", "t1", "t4"]
    assert page.evaluate(CHANGED) == []   # узлы переставлены, а не пересозданы
    assert page.evaluate("[...document.querySelectorAll('.film > .st-box')].slice(0, 5).map(b => b.dataset.box)") == ["sp", "t2", "t3", "t1", "t4"]
    assert page.evaluate("[...document.querySelectorAll('.film .st-box')].every(b => !b.style.transform && !b.classList.contains('lifted'))")
    # слайд доезжает на место (анимация на живом узле)
    assert page.evaluate("document.querySelector('.st-box[data-box=\"t1\"]').getAnimations().length") >= 1
    assert not page.errors, page.errors
    ctx.close()


def test_drag_edge_scrolls_smoothly(browser, base_url):
    ctx, page = sermon_page(browser, base_url)
    f = page.locator(".film").bounding_box()
    t = page.locator(".film .st[data-id='t2']").bounding_box()
    page.mouse.move(t["x"] + t["width"] / 2, t["y"] + t["height"] / 2)
    page.mouse.down()
    page.mouse.move(t["x"] + t["width"] / 2, t["y"] + t["height"] / 2 + 20, steps=3)
    page.mouse.move(t["x"] + t["width"] / 2, f["y"] + f["height"] - 8, steps=5)
    s0 = page.evaluate("filmEl.scrollTop")
    page.wait_for_timeout(400)
    s1 = page.evaluate("filmEl.scrollTop")
    assert s1 - s0 > 100   # прокрутка каждый кадр, а не по 14 px на движение мыши
    page.mouse.up()
    ctx.close()


# ---------- фокус: выбранный слайд на виду ----------

def test_duplicate_in_middle_keeps_both_visible(browser, base_url):
    ctx, page = sermon_page(browser, base_url)
    page.evaluate("filmEl.scrollTop = 500")
    page.wait_for_timeout(50)
    mid = page.evaluate("""(() => { const f = filmEl.getBoundingClientRect(); const els = [...filmEl.querySelectorAll('.st-box')];
      const v = els.filter(b => { const r = b.getBoundingClientRect(); return r.top >= f.top && r.bottom <= f.bottom; });
      return v[Math.floor(v.length / 2)].dataset.box; })()""")
    top = page.evaluate("filmEl.scrollTop")
    page.locator(".film .st-box[data-box='%s']" % mid).hover()
    page.locator(".film .st-box[data-box='%s'] .st-acts .icon-btn" % mid).first.click()   # «Дублировать»
    copy = page.evaluate("selId")
    assert copy != mid and page.evaluate("state.blocks[state.blocks.findIndex(b => b.id === %r) + 1].id" % mid) == copy
    assert visible_in_film(page, copy) and visible_in_film(page, mid)
    assert abs(page.evaluate("filmEl.scrollTop") - top) < 400   # лента не прыгнула к началу
    assert page.locator(".toast", has_text="Слайд скопирован").count() == 1
    ctx.close()


def test_duplicate_at_bottom_edge_scrolls_to_copy(browser, base_url):
    ctx, page = sermon_page(browser, base_url)
    last = page.evaluate("""(() => { const f = filmEl.getBoundingClientRect();
      return [...filmEl.querySelectorAll('.st-box')].filter(b => b.getBoundingClientRect().bottom <= f.bottom).pop().dataset.box; })()""")
    page.evaluate("id => duplicate(state.blocks.find(b => b.id === id))", last)
    page.wait_for_timeout(600)   # плавная прокрутка
    assert visible_in_film(page, page.evaluate("selId"))
    ctx.close()


def test_delete_selects_next_and_shows_it(browser, base_url):
    ctx, page = sermon_page(browser, base_url)
    page.evaluate("filmEl.scrollTop = 700")
    page.wait_for_timeout(50)
    victim = page.evaluate("""(() => { const f = filmEl.getBoundingClientRect();
      return [...filmEl.querySelectorAll('.st-box')].filter(b => { const r = b.getBoundingClientRect(); return r.top >= f.top && r.bottom <= f.bottom; }).pop().dataset.box; })()""")
    nxt = page.evaluate("id => state.blocks[state.blocks.findIndex(b => b.id === id) + 1].id", victim)
    page.evaluate("id => removeBlock(state.blocks.find(b => b.id === id))", victim)
    page.wait_for_timeout(600)
    assert page.evaluate("selId") == nxt and visible_in_film(page, nxt)
    # удалили последний — выбран предыдущий
    ids = page.evaluate("state.blocks.map(b => b.id)")
    page.evaluate("removeBlock(state.blocks[state.blocks.length - 1])")
    page.wait_for_timeout(600)
    assert page.evaluate("selId") == ids[-2] and visible_in_film(page, ids[-2])
    ctx.close()


def test_stage_arrows_and_alt_keys_keep_selected_visible(browser, base_url):
    ctx, page = sermon_page(browser, base_url)
    for _ in range(9):
        page.locator(".stage-bar .stepper .icon-btn").nth(1).click()
    page.wait_for_timeout(500)
    assert visible_in_film(page, page.evaluate("selId"))
    sel = page.evaluate("selId")
    page.locator(".film .st[data-id='%s']" % sel).focus()
    page.keyboard.press("Alt+ArrowDown")
    page.keyboard.press("Alt+ArrowDown")
    page.wait_for_timeout(500)
    assert page.evaluate("document.activeElement.dataset.id") == sel   # фокус остался на переставленном слайде
    assert visible_in_film(page, sel)
    ctx.close()


def test_from_text_view_slide_is_visible_near_middle(browser, base_url):
    ctx, page = sermon_page(browser, base_url, edit=False)
    page.locator(".seg button", has_text="Текст").click()
    page.wait_for_selector(".tv-thumb[data-id='t12']")
    page.locator(".tv-thumb[data-id='t12']").scroll_into_view_if_needed()
    page.locator(".tv-thumb[data-id='t12']").click()
    page.wait_for_selector(".film .st[data-id='t12']")
    assert page.evaluate("selId") == "t12"
    assert visible_in_film(page, "t12")
    assert page.evaluate("filmEl.scrollTop") > 0
    ctx.close()


def test_text_view_highlight_lasts_two_seconds(browser, base_url):
    ctx, page = sermon_page(browser, base_url, motion=True, edit=False)
    page.locator(".film .st[data-id='t6']").click()
    page.locator(".seg button", has_text="Текст").click()
    page.wait_for_selector(".blk.hl")
    assert page.evaluate("getComputedStyle(document.querySelector('.blk.hl')).getPropertyValue('--hl-ms').trim()") == "2000ms"
    page.wait_for_timeout(1200)
    assert page.locator(".blk.hl").count() == 1
    page.wait_for_function("!document.querySelector('.blk.hl')", timeout=3000)
    ctx.close()


# ---------- переходы ----------

def test_open_sermon_slides_in_and_back_slides_out(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": long_sermon()}, **MOVE)
    page.wait_for_selector(".scard", timeout=8000)
    page.wait_for_function("!document.querySelector('.gate-ghost')")   # заставка входа уже растворилась
    page.evaluate("""() => { window.__anims = []; const o = Element.prototype.animate;
      Element.prototype.animate = function(k, t){ window.__anims.push([this.id || this.className, JSON.stringify(k)]); return o.call(this, k, t); }; }""")
    page.locator(".scard").first.click()
    page.wait_for_selector(".film .st")
    page.wait_for_function("window.__anims.some(a => a[0] === 'main')")
    assert any("translateX(56px)" in k for _, k in page.evaluate("window.__anims"))
    page.evaluate("window.__anims = []")
    page.locator("a.btn.ghost", has_text="Конспекты").click()
    page.wait_for_selector(".home-top")
    anims = page.evaluate("window.__anims")
    assert any(c == "leave-ghost" and "translateX(56px)" in k for c, k in anims)   # прежний экран уезжает поверх списка
    assert not any(c == "home" and "opacity" in k for c, k in anims)   # список под ним не гаснет и не проявляется (этап 9.2): гаснет только уезжающий
    page.wait_for_function("!document.querySelector('.leave-ghost')", timeout=2000)
    # при возврате на главную заставки входа нет
    assert page.locator(".gate").count() == 0
    ctx.close()


def test_intro_splash_holds_then_dissolves(browser, base_url):
    for motion, slow in (("no-preference", True), ("reduce", False)):
        ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec("s1", "Вера")}, reduced_motion=motion)
        ctx.add_init_script("""new MutationObserver((m, mo) => { if (document.querySelector('.home-top')){ window.__homeAt = performance.now(); mo.disconnect(); } })
          .observe(document, { childList:true, subtree:true });""")
        page.reload()
        page.wait_for_selector(".home-top", timeout=8000)
        at = page.evaluate("window.__homeAt")
        if slow:
            assert at >= 1450, at   # заставка не короче ~1,5 с
            assert page.evaluate("document.querySelectorAll('.gate-logo').length") >= 1   # знак ещё виден, расплывается поверх
        else:
            assert at < 1400, at    # «Уменьшить движение» — без задержки
            assert page.locator(".gate-ghost").count() == 0
        ctx.close()


# ---------- «В строку» + рамка ----------

def test_inline_verses_with_frame_are_one_paragraph(page):
    r = page.evaluate("""() => {
      const b = { id:'v1', type:'scripture', items:[{ kind:'scripture', manual:true, ref:'Иакова 2:17-18', translation:'Синодальный перевод',
        verses:[{ num:'17', text:'Так и вера, если не имеет дел, мертва сама по себе.' }, { num:'18', text:'Но скажет кто-нибудь: ты имеешь веру, а я имею дела: покажи мне веру твою без дел твоих, а я покажу тебе веру мою из дел моих.' }] }] };
      const out = [];
      for (const align of ['left', 'center', 'right']) for (const caps of [true, false]) for (const flow of ['inline', 'lines']){
        setSlidesBase(Object.assign({}, SLIDES_BASE, { verses:Object.assign({}, SLIDES_BASE.verses, { frame:true, align, caps, flow }) }));
        const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:960px'; document.body.append(host);
        const sl = slideEl(b); host.append(sl); fitSlide(sl, b);
        const framed = sl.querySelectorAll('.framed');
        out.push({ align, caps, flow, frames:framed.length, paras:sl.querySelectorAll('.sl-verse').length, brs:framed[0] ? framed[0].querySelectorAll('br').length : -1,
          inline:framed[0] && framed[0].tagName === 'P' });
        host.remove();
      }
      return out; }""")
    for x in r:
        assert x["frames"] == 1, x   # одна рамка
        if x["flow"] == "inline":
            assert x["paras"] == 1 and x["inline"] and x["brs"] == 0, x   # один абзац, переносы только по ширине
        else:
            assert x["paras"] == 2, x


# ---------- список проповедей ----------

def home_rows(page):
    return [t.strip() for t in page.locator(".scard .scard-title").all_inner_texts()]


def list_page(browser, base_url):
    S = {
        "a": dict(rec("a", "Будущая", date="2099-02-01", at=10), status="work"),
        "b": dict(rec("b", "Скоро", date="2099-01-04", at=11), status="submitted"),
        "c": dict(rec("c", "Прошлая", date="2020-05-03", at=12)),
        "d": dict(rec("d", "Без даты", date="", at=13)),
        "e": dict(rec("e", "Давняя", date="2019-01-06", at=14), status="submitted"),
    }
    S["c"]["meta"].update(firstName="Пётр", lastName="Сидоров")
    S["e"]["meta"].update(firstName="Анна", lastName="Ковальская")
    # «Слайдов» без заставок: у «Будущей» — заставка, тезис, картинка «пришлю отдельно», видео, свободный и заметка → 4
    S["a"]["blocks"] = [{"id": "s", "type": "splash"}, thesis(1), {"id": "i", "type": "image", "mode": "send"}, {"id": "v", "type": "video"},
                        {"id": "f", "type": "free"}, {"id": "n", "type": "note", "text": "свет"}]
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons=S)
    page.wait_for_selector(".scard")
    return ctx, page


def test_home_one_table_default_order_and_counts(browser, base_url):
    ctx, page = list_page(browser, base_url)
    assert page.locator(".ptable").count() == 1 and page.locator(".cards").count() == 0
    assert home_rows(page) == ["Без даты", "Будущая", "Скоро", "Прошлая", "Давняя"]   # без даты — сверху, дальше от новых к старым
    assert [t.replace("\n", "") for t in page.locator(".srow.shead [role=columnheader]").all_inner_texts()[:5]] == ["Дата", "Название", "Автор", "Слайдов", "Статус"]   # сортировки по заголовкам нет с этапа 7.8
    assert page.locator(".scard.next, .next-mark").count() == 0   # пометки «ближайшая» с этапа 9.2 нет
    row = page.locator(".card-wrap", has_text="Будущая")
    assert row.locator(".c-slides .c-n").inner_text() == "4"
    assert page.locator(".card-wrap", has_text="Скоро").locator(".c-slides .c-n").inner_text() == "0"   # только заставка
    ctx.close()


def test_home_filters_with_search_and_reset(browser, base_url):
    ctx, page = list_page(browser, base_url)
    sel = lambda label, v: page.locator(".home-filters select[aria-label='%s']" % label).select_option(v)
    sel("Дата", "up")
    assert home_rows(page) == ["Будущая", "Скоро"]
    sel("Дата", "past")
    assert home_rows(page) == ["Прошлая", "Давняя"]
    sel("Дата", "range")
    page.locator(".hf-range input").first.fill("2019-06-01")
    page.locator(".hf-range input").first.dispatch_event("change")
    assert home_rows(page) == ["Будущая", "Скоро", "Прошлая"]
    sel("Дата", "all")
    sel("Автор", "Сидоров Пётр")
    assert home_rows(page) == ["Прошлая"]
    sel("Автор", "")
    page.locator(".hf-chip", has_text="Готов к вёрстке").click()
    assert home_rows(page) == ["Скоро", "Давняя"]
    page.locator(".hf-chip", has_text="Черновик").click()   # несколько статусов
    assert home_rows(page) == ["Без даты", "Скоро", "Прошлая", "Давняя"]
    # вместе с поиском
    page.locator(".search input").fill("давн")
    assert home_rows(page) == ["Давняя"]
    page.locator(".search input").fill("будущ")
    assert home_rows(page) == [] and "ничего не нашлось" in page.inner_text("#home-list")
    page.locator(".home-none button", has_text="Сбросить фильтры").click()
    assert home_rows(page) == ["Будущая"]
    page.locator(".search input").fill("")
    assert len(home_rows(page)) == 5 and page.locator(".hf-reset").count() == 0
    # «Сбросить» появляется, когда что-то выбрано
    page.locator(".hf-chip", has_text="У редактора").click()
    page.locator(".hf-reset").click()
    assert len(home_rows(page)) == 5
    ctx.close()


def test_home_narrow_screen_cards_and_filters_button(browser, base_url):
    ctx, page = list_page(browser, base_url)
    page.set_viewport_size({"width": 390, "height": 800})
    assert not page.locator(".srow.shead").is_visible()
    assert not page.locator(".hf-body").is_visible()
    page.locator(".hf-toggle").click()
    assert page.locator(".hf-body").is_visible()
    row = page.locator(".card-wrap", has_text="Будущая")
    assert "4 слайда" in row.inner_text() and "У редактора" in row.inner_text()
    ctx.close()


def test_film_header_counts_without_splash(browser, base_url):
    ctx, page = sermon_page(browser, base_url, sermon=long_sermon(3), edit=False)
    assert page.evaluate("document.querySelector('#film-count').textContent").startswith("3 слайда + 1 заставка")
    ctx.close()
