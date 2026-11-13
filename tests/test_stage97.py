"""Этап 9.7: «доработать» видит автор, статус «Презентация готова», «Сделать копию» и «Копировать в пространство…»,
история сохранений. Облако подменено: tests/fixtures/fake_cloud.js."""
from conftest import cloud_page
from test_cloud import ADMIN, IVAN, MEMBERS, rec, wait_home
from test_lock import open_sermon, start_edit
from test_ui71 import menu_items
from test_editor import full, opt
from test_stage8 import space


def db(page, js):
    return page.evaluate("(() => { const db = fakeCloud.db(); return %s; })()" % js)


# ---------- «Доработать» видит автор ----------

def test_author_sees_editor_flag_in_film_counter_and_text(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full()})
    page.evaluate("""() => { const db = fakeCloud.db(); db.flags = { s1: { b2: { t:1, s:'x' } } }; fakeCloud.put(db); }""")
    wait_home(page)
    open_sermon(page, "s1")
    assert page.evaluate("state.blocks.map(b => b.todo)") == [False, True, True]
    assert page.locator(".film .st.todo").count() == 2
    assert "2 доработать" in page.inner_text("#film-count")
    assert not page.locator(".stage-bar .btn.todo").count()   # ставить и снимать автор не может
    page.evaluate("navigate(sermonHash('s1', 'text'))")
    page.wait_for_selector(".tv-todo")
    assert page.locator(".tv-todo").count() == 2
    assert not page.errors, page.errors
    ctx.close()


def test_editor_flag_button_says_author_sees_it(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full()})
    wait_home(page)
    open_sermon(page, "s1")
    page.locator(".film .st").nth(1).click()
    assert "Автор тоже её увидит" in page.locator(".stage-bar .btn.todo").get_attribute("title")
    ctx.close()


# ---------- «Презентация готова» ----------

def test_editor_sets_ready_and_author_is_locked_out(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full(st="work")})
    page.set_viewport_size({"width": 1920, "height": 900})   # здесь проверяется широкий переключатель статуса; на 1280 px он свёрнут в кнопку (этап 10.1)
    wait_home(page)
    open_sermon(page, "s1")
    start_edit(page)
    assert page.locator(".topbar .stswitch .sw-opt").all_inner_texts() == ["Черновик", "Готов к вёрстке", "У редактора", "Презентация готова"]
    opt(page, "Презентация готова").click()
    page.locator("#app").get_by_role("button", name="Готово").click()
    page.wait_for_function("fakeCloud.db().sermons.s1.status === 'ready' && ed.mode === 'view'")
    ctx.close()
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full(st="ready")})
    wait_home(page)
    open_sermon(page, "s1")
    assert page.locator(".topbar .hd-edit").is_disabled()
    assert opt(page, "Презентация готова").is_disabled() and opt(page, "Черновик").count()
    assert "Презентация уже готова" in page.locator(".topbar .hd-edit").get_attribute("title")
    assert not page.errors, page.errors
    ctx.close()


def test_ready_in_list_card_filter_and_trash(browser, base_url):
    sermons = {"a": full("a", "Первая", st="ready"), "b": full("b", "Вторая", st="work"), "c": full("c", "Третья", st="draft")}
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons=sermons)
    wait_home(page)
    chips = page.locator(".home-filters .hf-chip")
    assert chips.all_inner_texts() == ["Черновик", "Готов к вёрстке", "У редактора", "Презентация готова"]
    assert page.locator(".srow.st-ready .stchip.st-ready").inner_text() == "Презентация готова"
    page.locator(".home-filters .hf-chip.st-ready").click()
    page.locator(".home-filters .hf-chip.st-work").click()   # несколько статусов сразу
    page.wait_for_function("document.querySelectorAll('.scard').length === 2")
    assert page.evaluate("homeView.f.status") == ["work", "ready"]
    color = page.evaluate("getComputedStyle(document.querySelector('.srow.st-ready .stchip')).color")
    assert color != page.evaluate("getComputedStyle(document.querySelector('.srow.st-work .stchip')).color")   # свой цвет
    # окно корзины тоже показывает статус
    page.evaluate("""() => { const db = fakeCloud.db(); db.sermons.a.deletedAt = Date.now(); db.sermons.a.deletedBy = 'admin@x.pl'; fakeCloud.put(db); }""")
    page.wait_for_selector(".home-trash")
    page.locator(".home-trash").click()
    assert page.locator(".trash-row .stchip.st-ready").inner_text() == "Презентация готова"
    assert not page.errors, page.errors
    ctx.close()


def test_ready_needs_slides(page):
    from conftest import start_blank
    start_blank(page)
    assert page.locator(".stswitch .sw-opt.st-ready").get_attribute("title") == "Сначала добавьте слайды"


# ---------- Копии ----------

def test_editor_makes_copy_of_any_sermon(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full(st="submitted")})
    wait_home(page)
    open_sermon(page, "s1")
    items = menu_items(page)
    assert "Сделать копию" in items and "Копировать в пространство…" in items
    assert page.evaluate("[...menuEl.querySelectorAll('button')].find(b => b.textContent.includes('Копировать в пространство')).disabled")   # пространство одно
    page.evaluate("[...menuEl.querySelectorAll('button')].find(b => b.textContent.trim() === 'Сделать копию').click()")
    page.wait_for_function("state.id !== 's1' && Object.keys(fakeCloud.db().sermons).length === 2")
    new = page.evaluate("state.id")
    r = db(page, "db.sermons[%r]" % new)
    assert r["owner"] == "admin@x.pl" and r["status"] == "draft" and r["meta"]["title"] == "Вера (копия)"
    assert db(page, "db.sermons.s1.status") == "submitted" and db(page, "db.sermons.s1.meta.title") == "Вера"
    assert page.evaluate("ed.mode") == "edit"   # копия — свой черновик, сразу правится
    assert not page.errors, page.errors
    ctx.close()


def test_copy_while_editing_saves_the_original_too(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full()})
    wait_home(page)
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("state.meta.title = 'Новое название'; change()")
    page.evaluate("saveAsCopy({ keep:true })")
    page.wait_for_function("Object.keys(fakeCloud.db().sermons).length === 2 && fakeCloud.db().sermons.s1.lock === null")
    assert db(page, "db.sermons.s1.meta.title") == "Новое название"
    assert page.evaluate("state.meta.title") == "Новое название (копия)"
    ctx.close()


def test_copy_to_other_space(browser, base_url):
    sp2 = space("sp2", "Отец", members={"ivan@x.pl": {"role": "preacher", "firstName": "Иван", "lastName": "Петров"}})
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full(owner="petr@x.pl", st="submitted")}, spaces={"sp2": sp2})
    wait_home(page)
    page.evaluate("switchSpace('sp1')")   # «Отец» по алфавиту первым
    page.wait_for_function("cloud.space === 'sp1' && cloud.list && cloud.list.has('s1')")
    open_sermon(page, "s1")
    menu_items(page)
    page.evaluate("[...menuEl.querySelectorAll('button')].find(b => b.textContent.includes('Копировать в пространство')).click()")
    page.locator(".copy-sheet .btn", has_text="Отец").click()
    page.wait_for_function("Object.keys(fakeCloud.db().spaces.sp2.sermons || {}).length === 1")
    r = db(page, "Object.values(db.spaces.sp2.sermons)[0]")
    assert r["owner"] == "ivan@x.pl" and r["status"] == "draft" and r["meta"]["title"] == "Вера"
    assert page.evaluate("state.id") == "s1" and page.evaluate("cloud.space") == "sp1"   # открытый конспект не меняется
    page.wait_for_selector(".toast:has-text('Отец')")
    page.locator(".toast button", has_text="Открыть").click()
    page.wait_for_function("cloud.space === 'sp2' && state && state.id === %s && screen === 'sermon'" % repr(r["id"]))
    assert not page.errors, page.errors
    ctx.close()


# ---------- История сохранений ----------

def save_with_title(page, title):
    start_edit(page)
    page.evaluate("t => { state.meta.title = t; change(); }", title)
    page.locator("#app").get_by_role("button", name="Готово").click()
    page.wait_for_function("t => ed.mode === 'view' && fakeCloud.db().sermons.s1.meta.title === t", arg=title)


def versions(page):
    return page.evaluate("((fakeCloud.db().versions || {}).s1 || []).map(v => v.meta.title)")


def test_save_keeps_copy_autosave_does_not(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full()})
    wait_home(page)
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("state.meta.title = 'Автосохранение'; change()")
    page.wait_for_function("fakeCloud.db().sermons.s1.meta.title === 'Автосохранение'")   # ушло само
    assert versions(page) == []
    page.locator("#app").get_by_role("button", name="Готово").click()   # правки уже в облаке, а копия — по «Готово»
    page.wait_for_function("((fakeCloud.db().versions || {}).s1 || []).length === 1")
    save_with_title(page, "Второе")
    page.wait_for_function("((fakeCloud.db().versions || {}).s1 || []).length === 2")
    assert versions(page) == ["Второе", "Автосохранение"]
    v = page.evaluate("fakeCloud.db().versions.s1[0]")
    assert v["savedBy"] == "ivan@x.pl" and v["name"] == "Иван Петров"
    assert all("todo" not in b for b in v["blocks"])
    ctx.close()


def test_history_window_and_restore_with_undo(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full()})
    wait_home(page)
    open_sermon(page, "s1")
    save_with_title(page, "Первое")
    page.wait_for_function("((fakeCloud.db().versions || {}).s1 || []).length === 1")
    save_with_title(page, "Второе")
    page.wait_for_function("((fakeCloud.db().versions || {}).s1 || []).length === 2")
    assert "История" in menu_items(page)
    page.evaluate("openHistory()")
    page.wait_for_selector(".ver-row")
    assert page.locator(".ver-row").count() == 2
    assert "Второе" in page.inner_text(".ver-view")
    assert page.locator(".ver-sheet .btn.primary").is_disabled()   # первая — такая же, как сейчас
    page.locator(".ver-row").nth(1).click()
    assert "Первое" in page.inner_text(".ver-view")
    assert page.locator(".ver-sheet .btn.primary").is_disabled()   # в просмотре вернуть нельзя
    assert "Редактировать" in page.inner_text(".ver-note")
    page.evaluate("closeSettings()")
    start_edit(page)
    page.evaluate("openHistory()")
    page.wait_for_selector(".ver-row")
    page.locator(".ver-row").nth(1).click()
    page.locator(".ver-sheet .btn.primary", has_text="Вернуть эту версию").click()
    assert page.evaluate("state.meta.title") == "Первое"
    assert page.evaluate("canUndo()")
    page.evaluate("undo()")
    assert page.evaluate("state.meta.title") == "Второе"
    assert not page.errors, page.errors
    ctx.close()


def test_history_only_for_those_who_can_edit(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full(owner="petr@x.pl")})
    wait_home(page)
    open_sermon(page, "s1")
    items = menu_items(page)
    assert "История" not in items
    assert "Сделать копию" in items   # копию сделать может каждый, кто видит
    ctx.close()


def test_preview_lists_slides_as_text(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full()})
    wait_home(page)
    open_sermon(page, "s1")
    save_with_title(page, "Текстом")
    page.wait_for_function("((fakeCloud.db().versions || {}).s1 || []).length === 1")
    page.evaluate("openHistory()")
    page.wait_for_selector(".ver-slide")
    caps = page.locator(".ver-cap").all_inner_texts()
    assert caps[0].startswith("1") and len(caps) == 3
    assert "Мысль" in page.inner_text(".ver-view") and "раз" in page.inner_text(".ver-view")
    ctx.close()
