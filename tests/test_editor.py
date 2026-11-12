"""Работа редактора (этапы 7, 7.2 и 7.3): статусы «Черновик / Готов к вёрстке / У редактора», «доработать» только у редактора
(editor/state, вне замка), автосохранение, «автор», исчерпанный запас базы. Облако подменено: tests/fixtures/fake_cloud.js."""
from conftest import cloud_page
from test_cloud import ADMIN, IVAN, MEMBERS, rec
from test_lock import open_sermon, start_edit, db_eval, status
from test_ui71 import menu_items


def full(id="s1", title="Вера", owner="ivan@x.pl", st="draft"):
    r = rec(id, title, owner=owner)
    r["status"] = st
    r["blocks"] = [{"id": "b1", "type": "splash", "speech": "привет"},
                   {"id": "b2", "type": "thesis", "text": "Мысль", "speech": "<b>раз</b>"},
                   {"id": "b3", "type": "image", "desc": "Фото"}]
    return r


def flags(page):
    return page.evaluate("fakeCloud.db().flags && fakeCloud.db().flags.s1 || {}")


def todo(page):
    return page.evaluate("state.blocks.map(b => b.todo)")


# ---------- статус (этап 7.3: «Черновик» / «Готов к вёрстке» / «У редактора») ----------

def st_label(page):
    """Статус в шапке: включённое положение переключателя или метка"""
    sw = page.locator(".topbar .stswitch .sw-opt.on")
    return sw.inner_text() if sw.count() else page.locator(".topbar .stchip").inner_text()


def opt(page, label):
    return page.locator(".topbar .stswitch .sw-opt", has_text=label)


def test_author_switches_draft_and_ready_while_editing(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full()})
    page.wait_for_selector(".scard")
    assert "Черновик" in page.inner_text(".scard")
    open_sermon(page, "s1")
    assert page.locator(".topbar .stswitch .sw-opt").count() == 3   # переключатель виден и в просмотре
    assert st_label(page) == "Черновик"
    assert "null" not in page.inner_text(".topbar")
    assert opt(page, "У редактора").is_disabled()   # этот статус ставит редактор
    # в просмотре статус не меняется: подсказка про «Редактировать»
    opt(page, "Готов к вёрстке").click()
    page.wait_for_function("document.querySelector('.toast').textContent.includes('Редактировать')")
    assert st_label(page) == "Черновик" and page.evaluate("ed.mode") == "view"
    start_edit(page)
    page.evaluate("state.blocks[1].speech = 'дописал'; change()")
    # «Готов к вёрстке» — обычная правка: правка не закрывается, статус уходит в облако вместе с текстом
    saves = page.evaluate("fakeCloud.calls.save")
    opt(page, "Готов к вёрстке").click()
    assert st_label(page) == "Готов к вёрстке"
    assert page.evaluate("ed.mode") == "edit" and page.evaluate("fakeCloud.calls.save") == saves, "отдельной записи нет"
    page.wait_for_function("fakeCloud.db().sermons.s1.status === 'submitted'", timeout=10000)
    assert page.evaluate("fakeCloud.db().sermons.s1.blocks[1].speech") == "дописал"
    assert page.evaluate("fakeCloud.db().sermons.s1.lock.email") == "ivan@x.pl"   # правка не закрылась
    # правка готового конспекта статус не сбрасывает
    page.evaluate("state.blocks[1].speech = 'другое'; change()")
    page.keyboard.press("Control+s")
    page.wait_for_function("fakeCloud.db().sermons.s1.blocks[1].speech === 'другое'")
    assert page.evaluate("fakeCloud.db().sermons.s1.status") == "submitted" and st_label(page) == "Готов к вёрстке"
    # и обратно в «Черновик» — тоже без ограничений
    opt(page, "Черновик").click()
    page.get_by_role("button", name="Сохранить").click()
    page.wait_for_function("ed.mode === 'view' && fakeCloud.db().sermons.s1.status === 'draft'")
    assert not page.evaluate("fakeCloud.calls.status"), "отдельная запись статуса больше не нужна"
    # смена статуса в отмену не входит
    assert st_label(page) == "Черновик"
    assert not page.errors, page.errors
    ctx.close()


def test_status_is_not_undone(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("state.blocks[1].speech = 'раз'; change()")
    opt(page, "У редактора").click()
    page.keyboard.press("Control+z")
    assert page.evaluate("state.blocks[1].speech") != "раз"
    assert st_label(page) == "У редактора"
    ctx.close()


def test_editor_takes_sermon_and_author_cannot_edit(browser, base_url):
    # редактор: «У редактора» в правке, вместе с содержимым
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full(st="submitted")})
    page.wait_for_selector(".scard")
    assert "Готов к вёрстке" in page.inner_text(".scard")
    open_sermon(page, "s1")
    start_edit(page)
    assert opt(page, "У редактора").is_enabled()
    opt(page, "У редактора").click()
    page.keyboard.press("Control+s")
    page.wait_for_function("fakeCloud.db().sermons.s1.status === 'work'")
    assert page.evaluate("ed.mode") == "edit"
    ctx.close()
    # автор: смотреть можно, править — нет
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full(st="work")})
    page.wait_for_selector(".scard")
    assert "У редактора" in page.inner_text(".scard")
    open_sermon(page, "s1")
    assert st_label(page) == "У редактора"
    btn = page.locator("#app").get_by_role("button", name="Редактировать")
    assert btn.is_disabled()
    assert "у редактора" in btn.get_attribute("title").lower()
    assert "Конспект у редактора: если нужны правки, напишите ему" in status(page)
    page.locator(".side").click()
    page.wait_for_function("document.querySelector('.toast').textContent.includes('Конспект у редактора')")
    assert page.evaluate("ed.mode") == "view" and page.evaluate("fakeCloud.calls.lock") == 0
    # копию сделать можно: она — новый черновик автора
    assert "Сделать копию" in menu_items(page)
    # удалить нельзя
    page.evaluate("deleteCloudSermon(state)")
    assert page.evaluate("!!fakeCloud.db().sermons.s1")
    # редактор вернул «Черновик» — автор снова правит (живое обновление, без перезагрузки)
    db_eval(page, "r.status = 'draft'; r.updatedAt += 1000; r.updatedBy = 'admin@x.pl'")
    page.wait_for_function("(() => { const b = [...document.querySelectorAll('#app button')].find(x => x.textContent.includes('Редактировать')); return b && !b.disabled; })()")
    start_edit(page)
    page.evaluate("state.blocks[1].speech = 'снова правлю'; change()")
    page.keyboard.press("Control+s")
    page.wait_for_function("fakeCloud.db().sermons.s1.blocks[1].speech === 'снова правлю'")
    assert not page.errors, page.errors
    ctx.close()


def test_editor_takes_while_author_edits_rescues_copy(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("state.meta.title = 'Мои правки'; change()")   # ещё не ушло в облако
    # редактор забирает правку и ставит «У редактора»
    db_eval(page, "r.lock = { email:'admin@x.pl', name:'Админ', at:Date.now() + 999999, beat:Date.now() + 999999 }; r.status = 'work'")
    page.wait_for_selector(".sheet[aria-label='Правку забрали']")
    copy = [r for k, r in page.evaluate("fakeCloud.db().sermons").items() if k != "s1"]
    assert len(copy) == 1 and copy[0]["meta"]["title"] == "Мои правки (копия)" and copy[0]["status"] == "draft"
    page.get_by_role("button", name="Понятно").click()
    assert st_label(page) == "У редактора"
    assert page.locator("#app").get_by_role("button", name="Редактировать").is_disabled()
    ctx.close()


def test_author_reopens_with_unsaved_draft_while_at_editor(browser, base_url):
    """В браузере остались несохранённые правки, а конспект уже у редактора: правки уходят копией"""
    r = full(st="work")
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": r})
    page.wait_for_selector(".scard")
    # черновик в браузере основан на версии до того, как редактор взял конспект; человек решает оставить свои правки
    local = dict(full(), cloudSpace="sp1", cloudAt=r["updatedAt"] - 1000, cloudOwner="ivan@x.pl", cloudStatus="draft", cloudBy="ivan@x.pl",
                 app="swp-sermon", savedAt=r["updatedAt"] - 1000, updatedAt=r["updatedAt"] + 50000)
    local["meta"] = dict(local["meta"], title="Несохранённое")
    page.evaluate("d => localStorage.setItem('swp-sermon:s1', JSON.stringify(d))", local)
    page.on("dialog", lambda d: d.accept())
    page.evaluate("navigate(sermonHash('s1'))")
    page.wait_for_selector(".sheet[aria-label='Правку забрали']")
    assert "Конспект у редактора" in page.inner_text(".sheet[aria-label='Правку забрали']")
    assert any(x["meta"]["title"] == "Несохранённое (копия)" for x in page.evaluate("Object.values(fakeCloud.db().sermons)"))
    ctx.close()


def test_other_authors_sermon_shows_status_only(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full(owner="petr@x.pl", st="submitted")})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    assert not page.locator(".topbar .stswitch").count()
    assert page.locator(".topbar .stchip").inner_text() == "Готов к вёрстке"
    ctx.close()


def test_new_sermon_is_draft_and_old_done_counts_as_at_editor(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s2": full("s2", "Старая", "ivan@x.pl", "done")})
    page.wait_for_selector(".scard")
    assert "У редактора" in page.inner_text(".scard")
    open_sermon(page, "s2")
    assert page.locator("#app").get_by_role("button", name="Редактировать").is_disabled()
    page.evaluate("newSermon()")
    page.wait_for_selector(".sheet[aria-label='О проповеди']")
    page.evaluate("closeSettings()")
    assert st_label(page) == "Черновик"
    page.evaluate("state.meta.title = 'Новая'; change()")
    page.keyboard.press("Control+s")
    page.wait_for_function("Object.values(fakeCloud.db().sermons).some(r => r.meta.title === 'Новая' && r.status === 'draft')")
    ctx.close()


# ---------- доработать ----------

def test_speaker_does_not_see_todo(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    start_edit(page)
    for i in range(3):
        page.locator(".film .st").nth(i).click()
        assert not page.locator(".stage-bar .btn.todo").count()
        assert not page.locator(".editor-box").count()
    assert not page.locator(".film .st.todo").count()
    assert "доработать" not in page.inner_text("#film-count")
    assert not page.errors, page.errors
    ctx.close()


def test_editor_sets_todo_outside_lock(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    assert page.evaluate("readOnly()")
    assert todo(page) == [False, False, True]   # картинка просит доработки сама
    assert "1 доработать" in page.inner_text("#film-count")
    page.locator(".film .st").nth(1).click()
    page.locator(".stage-bar .btn.todo").click()   # в просмотре, замок не нужен
    assert todo(page) == [False, True, True]
    assert page.evaluate("fakeCloud.db().sermons.s1.lock") is None
    page.wait_for_function("fakeCloud.db().flags && fakeCloud.db().flags.s1 && fakeCloud.db().flags.s1.b2")
    assert flags(page)["b2"]["t"] == 1
    assert page.evaluate("fakeCloud.calls.save") == 0   # проповедь не записывалась
    # переоткрыть: отметки на месте и в ленте, и на кнопке над слайдом (в боковой панели отметки больше нет)
    page.evaluate("navigate('')")
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    assert todo(page) == [False, True, True]
    assert page.locator(".film .st.todo").count() == 2
    page.locator(".film .st").nth(1).click()
    assert page.locator(".stage-bar .btn.todo.on").is_visible()
    assert page.locator(".side .editor-box").count() == 0
    assert not page.errors, page.errors
    ctx.close()


def test_todo_is_not_stored_in_the_sermon(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("state.blocks[1].speech = 'x'; change()")
    page.keyboard.press("Control+s")
    page.wait_for_function("fakeCloud.db().sermons.s1.blocks[1].speech === 'x'")
    assert page.evaluate("fakeCloud.db().sermons.s1.blocks.some(b => 'todo' in b || 'done' in b)") is False
    assert todo(page) == [False, False, True]   # редактору отметка видна по-прежнему
    ctx.close()


def test_speaker_change_brings_todo_back(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    page.locator(".film .st").nth(2).click()
    page.locator(".stage-bar .btn.todo").click()   # картинку сделали: отметка снята
    assert todo(page) == [False, False, False]
    page.wait_for_function("fakeCloud.db().flags && fakeCloud.db().flags.s1 && fakeCloud.db().flags.s1.b3")
    assert flags(page)["b3"]["t"] == 0
    # спикер дописал описание картинки: у редактора отметка вернулась сама (живое обновление, без перезагрузки)
    db_eval(page, "r.blocks[2].desc = 'Другое фото'; r.updatedAt += 5000")
    page.wait_for_function("state.blocks[2].todo === true", timeout=10000)
    assert page.locator(".film .st.todo").count() == 1
    # а если спикер ничего не менял, отметка не возвращается
    page.locator(".film .st").nth(2).click()
    page.locator(".stage-bar .btn.todo").click()
    assert todo(page) == [False, False, False]
    page.reload()   # адрес #s=s1 открывает проповедь сам
    page.wait_for_function("state && state.id === 's1' && screen === 'sermon' && ed.id === 's1' && !ed.busy")
    assert todo(page) == [False, False, False]
    assert not page.errors, page.errors
    ctx.close()


def test_editors_own_edit_does_not_bring_todo_back(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    page.locator(".film .st").nth(2).click()
    page.locator(".stage-bar .btn.todo").click()
    page.wait_for_function("fakeCloud.db().flags && fakeCloud.db().flags.s1")
    start_edit(page)
    page.evaluate("state.blocks[2].desc = 'Поправил сам'; change()")
    page.keyboard.press("Control+s")
    page.wait_for_function("fakeCloud.db().sermons.s1.blocks[2].desc === 'Поправил сам'")
    page.get_by_role("button", name="Сохранить", exact=True).click()
    page.wait_for_function("ed.mode === 'view'")
    page.wait_for_timeout(2500)   # отметки уходят с небольшой паузой
    page.evaluate("navigate('')")
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    assert todo(page) == [False, False, False]
    ctx.close()


def test_only_todo_filter(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    assert page.locator(".film .st").count() == 3
    page.locator("#film-count .film-todo").click()
    assert page.locator(".film .st").count() == 1
    page.locator("#film-count .film-todo").click()
    assert page.locator(".film .st").count() == 3
    page.locator("#film-count .film-todo").click()
    page.locator(".film .st").click()   # единственный слайд в ленте — картинка
    page.locator(".stage-bar .btn.todo").click()   # сняли последнюю отметку: лента сама показывает всё
    assert page.locator(".film .st").count() == 3
    assert "доработать" not in page.inner_text("#film-count")
    ctx.close()


def test_no_synced_flags_for_speaker_even_if_stored(browser, base_url):
    """Отметки лежат там, где спикер их прочитать не может; в «облаке» у него их просто нет"""
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full()})
    page.wait_for_selector(".scard")
    assert page.evaluate("CROSSPECT_FAKE_API.getFlags('sp1', 's1')") == {}
    ctx.close()


# ---------- автосохранение и запас базы ----------

def test_autosave_default_is_thirty_seconds(browser, base_url):
    ctx = browser.new_context()   # без подмены облака: форма как у людей
    pg = ctx.new_page()
    pg.goto(base_url + "/index.html")
    pg.wait_for_selector(".topbar")
    assert pg.evaluate("AUTOSAVE_MS") == 30000
    ctx.close()


def test_quota_exhausted_keeps_edits_in_browser(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("localStorage.setItem('fake-quota', '1')")
    page.evaluate("state.blocks[1].speech = 'в запас'; change()")
    page.wait_for_function("ed.quota === true", timeout=10000)
    assert "перегружено до 9:00" in status(page)
    assert "перегружено до 9:00" in page.inner_text(".toast")
    assert "нет прав" not in status(page).lower()
    assert page.evaluate("JSON.parse(localStorage.getItem('swp-sermon:s1')).blocks[1].speech") == "в запас"
    assert page.evaluate("fakeCloud.db().sermons.s1.blocks[1].speech") == "<b>раз</b>"
    # запас обновился — Ctrl+S пробует сразу
    page.evaluate("localStorage.removeItem('fake-quota')")
    page.keyboard.press("Control+s")
    page.wait_for_function("fakeCloud.db().sermons.s1.blocks[1].speech === 'в запас'", timeout=10000)
    assert page.evaluate("ed.quota") is False
    ctx.close()


# ---------- «автор» вместо «спикер» (этап 7.3) ----------

def test_role_is_called_author(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full(owner="admin@x.pl")})
    page.wait_for_selector(".scard")
    assert "автор" in page.locator(".who").inner_text()
    assert "автор" in page.locator(".topbar input[type=search]").get_attribute("placeholder")
    open_sermon(page, "s1")
    assert "другого автора" in status(page)
    assert "спикер" not in page.inner_text("body").lower()
    ctx.close()


def test_no_speaker_word_anywhere(browser, base_url):
    """Слова «спикер» нет ни на главной, ни в проповеди, ни в окне «О проповеди», ни в подсказках"""
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full()})
    page.wait_for_selector(".scard")
    texts = [page.inner_text("body")]
    open_sermon(page, "s1")
    start_edit(page)
    texts.append(page.inner_text("body"))
    page.evaluate("openMeta()")
    page.wait_for_selector(".sheet[aria-label='О проповеди']")
    texts.append(page.inner_text(".sheet[aria-label='О проповеди']"))
    assert page.locator(".sheet[aria-label='О проповеди'] .lbl", has_text="Автор").count() == 1
    page.evaluate("closeSettings()")
    page.evaluate("openSlidesCfg()")
    texts.append(page.inner_text(".sheet.scfg"))
    texts.append(page.evaluate("[...document.querySelectorAll('[title],[aria-label],[placeholder]')].map(e => [e.title, e.getAttribute('aria-label'), e.placeholder].join(' ')).join(' ')"))
    for t in texts:
        assert "спикер" not in t.lower(), t[:200]
    ctx.close()
