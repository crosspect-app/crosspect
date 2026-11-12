"""Работа редактора (этапы 7 и 7.2): статусы «В работе / Готов к вёрстке», «доработать» только у редактора (editor/state, вне замка),
автосохранение, «спикер», исчерпанный запас базы. Облако подменено: tests/fixtures/fake_cloud.js."""
from conftest import cloud_page
from test_cloud import ADMIN, IVAN, MEMBERS, rec
from test_lock import open_sermon, start_edit, db_eval, status


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


# ---------- статус ----------

def st_label(page):
    """Статус в шапке: включённое положение переключателя или метка"""
    sw = page.locator(".topbar .stswitch .sw-opt.on")
    return sw.inner_text() if sw.count() else page.locator(".topbar .stchip").inner_text()


def test_speaker_marks_ready_and_edit_resets_it(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full()})
    page.wait_for_selector(".scard")
    assert "В работе" in page.inner_text(".scard")
    open_sermon(page, "s1")
    assert page.locator(".topbar .stswitch").is_visible()   # переключатель — на экране проповеди, и в просмотре тоже
    assert "null" not in page.inner_text(".topbar")
    start_edit(page)
    page.evaluate("state.blocks[1].speech = 'дописал'; change()")
    page.locator(".topbar .stswitch").click()
    # спикер: «Готов к вёрстке» — сохранить и закрыть правку
    page.wait_for_function("fakeCloud.db().sermons.s1.status === 'submitted' && !fakeCloud.db().sermons.s1.lock", timeout=10000)
    page.wait_for_function("ed.mode === 'view'")
    assert page.evaluate("fakeCloud.db().sermons.s1.blocks[1].speech") == "дописал"
    assert st_label(page) == "Готов к вёрстке"
    assert "готов к вёрстке" in page.inner_text(".toast").lower()
    assert page.get_by_role("button", name="Редактировать").is_visible()
    # спикер снова правит готовый конспект — он снова «В работе», сразу и в облаке
    start_edit(page)
    page.evaluate("state.blocks[1].speech = 'другое'; change()")
    assert st_label(page) == "В работе"
    assert "снова «В работе»" in page.inner_text(".toast")
    page.wait_for_function("fakeCloud.db().sermons.s1.status === 'draft'", timeout=10000)
    assert page.evaluate("fakeCloud.db().sermons.s1.blocks[1].speech") == "другое"
    page.get_by_role("button", name="Сохранить").click()
    page.wait_for_function("ed.mode === 'view'")
    # в просмотре статус меняется отдельной записью, правка не открывается
    page.locator(".topbar .stswitch").click()
    page.wait_for_function("fakeCloud.db().sermons.s1.status === 'submitted'")
    assert page.evaluate("ed.mode") == "view" and page.evaluate("fakeCloud.calls.status") >= 1
    page.wait_for_function("document.querySelector('.topbar .stswitch .sw-opt.on').textContent === 'Готов к вёрстке'")
    page.locator(".topbar .stswitch").click()
    page.wait_for_function("fakeCloud.db().sermons.s1.status === 'draft'")
    assert not page.errors, page.errors
    ctx.close()


def test_speaker_ready_offline_keeps_status(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full()})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("state.blocks[1].speech = 'без сети'; change()")
    page.evaluate("localStorage.setItem('fake-offline', '1')")
    page.locator(".topbar .stswitch").click()
    page.wait_for_function("document.querySelector('.toast').textContent.includes('статус не изменился')", timeout=10000)
    assert st_label(page) == "В работе"
    assert page.evaluate("ed.mode") == "edit"
    assert page.evaluate("fakeCloud.db().sermons.s1.status") == "draft"
    ctx.close()


def test_editor_switches_status_freely_and_edit_keeps_it(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full(st="submitted")})
    page.wait_for_selector(".scard")
    assert "Готов к вёрстке" in page.inner_text(".scard")
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("state.blocks[1].speech = 'поправил редактор'; change()")
    assert st_label(page) == "Готов к вёрстке"
    # редактор переключает статус без выхода из правки; содержимое уходит своим чередом
    page.locator(".topbar .stswitch").click()
    page.wait_for_function("fakeCloud.db().sermons.s1.status === 'draft'")
    assert page.evaluate("ed.mode") == "edit"
    page.locator(".topbar .stswitch").click()
    page.wait_for_function("fakeCloud.db().sermons.s1.status === 'submitted'")
    page.keyboard.press("Control+s")
    page.wait_for_function("fakeCloud.db().sermons.s1.blocks[1].speech === 'поправил редактор'")
    assert page.evaluate("fakeCloud.db().sermons.s1.status") == "submitted"
    assert not page.evaluate("settingsOverlay.classList.contains('open')"), "без окна конфликта"
    assert not page.errors, page.errors
    ctx.close()


def test_status_not_changed_while_someone_else_edits(browser, base_url):
    rec_ = full()
    rec_["lock"] = {"email": "ivan@x.pl", "name": "Иван Петров", "at": 9e12, "beat": 9e12}
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": rec_})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    page.locator(".topbar .stswitch").click()
    page.wait_for_function("document.querySelector('.toast').textContent.includes('Иван Петров')")
    assert page.evaluate("fakeCloud.db().sermons.s1.status") == "draft"
    assert st_label(page) == "В работе"
    ctx.close()


def test_other_speakers_sermon_shows_status_only(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full(owner="petr@x.pl", st="submitted")})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    assert not page.locator(".topbar .stswitch").count()
    assert page.locator(".topbar .stchip").inner_text() == "Готов к вёрстке"
    ctx.close()


def test_new_sermon_starts_in_work_and_old_done_counts_as_ready(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s2": full("s2", "Старая", "ivan@x.pl", "done")})
    page.wait_for_selector(".scard")
    assert "Готов к вёрстке" in page.inner_text(".scard")
    page.evaluate("newSermon()")
    page.wait_for_selector(".sheet[aria-label='О проповеди']")
    page.evaluate("closeSettings()")
    assert st_label(page) == "В работе"
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

def test_autosave_default_is_thirty_seconds(page):
    assert page.evaluate("AUTOSAVE_MS") == 30000   # у обычной страницы тестовой подмены нет


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


# ---------- «спикер» ----------

def test_role_is_called_speaker(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full(owner="admin@x.pl")})
    page.wait_for_selector(".scard")
    assert "спикер" in page.locator(".who").inner_text()
    open_sermon(page, "s1")
    assert "другого спикера" in status(page)
    ctx.close()
