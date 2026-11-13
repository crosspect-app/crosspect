"""Этап 9.8: правка через «Редактировать / Готово» без «Сохранить», вид полей по режиму, подсветка кнопки вместо
сообщения, копии в историю при «Готово», Ctrl+S и раз в 10 минут. Облако подменено: tests/fixtures/fake_cloud.js."""
from conftest import cloud_page
from test_cloud import ADMIN, IVAN, MEMBERS, rec, wait_home
from test_lock import open_sermon, start_edit
from test_editor import full


def css(page, sel, prop):
    return page.evaluate("([s, p]) => getComputedStyle(document.querySelector(s))[p]", [sel, prop])


def versions(page):
    return page.evaluate("((fakeCloud.db().versions || {}).s1 || []).map(v => v.meta.title)")


def test_view_grey_fields_edit_bright_with_yellow_frame(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full()})
    wait_home(page)
    open_sermon(page, "s1")
    page.locator(".film .st").nth(1).click()   # тезис: поле текста и переключатели
    field = ".side .bbody .rich"
    assert not page.locator(".ro-note").count()   # плашки «Только просмотр» нет
    assert css(page, field, "backgroundColor") == "rgb(38, 38, 38)"   # серое
    assert css(page, field, "borderTopColor") == "rgba(0, 0, 0, 0)"   # без рамки
    assert css(page, ".speech", "borderTopColor") == "rgba(0, 0, 0, 0)"
    on = page.evaluate("(() => { const b = document.querySelector('.side .bbody .toggle button.on'); return b ? getComputedStyle(b).backgroundColor : ''; })()")
    assert on in ("", "rgb(61, 59, 56)")   # выбранное в группе — тоже серое
    stage = page.locator(".stage .sl").first.screenshot()
    start_edit(page)
    assert css(page, field, "backgroundColor") == "rgb(29, 28, 26)"   # чуть светлее фона
    assert css(page, field, "borderTopColor").startswith("color(srgb 1 0.870588 0.34902")   # жёлтая рамка (accent с прозрачностью)
    assert css(page, ".speech", "borderTopColor").startswith("color(srgb 1 0.870588 0.34902")
    assert page.locator(".stage .sl").first.screenshot() == stage   # слайды в обоих режимах одинаковые
    assert not page.errors, page.errors
    ctx.close()


def test_done_button_and_status_under_title(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full()})
    wait_home(page)
    open_sermon(page, "s1")
    head = page.locator(".topbar .hd-act")
    assert head.inner_text().strip() == "Редактировать" and "primary" in head.get_attribute("class")
    assert page.inner_text("#hd-sub") != "" and "Правка" not in page.inner_text("#hd-sub")   # дата и автор
    assert page.inner_text("#hd-save") == ""
    start_edit(page)
    assert head.inner_text().strip() == "Готово" and "hd-done" in head.get_attribute("class")
    assert not page.locator(".topbar").get_by_role("button", name="Сохранить").count()
    assert page.inner_text("#hd-sub").startswith("Правка · ")
    page.evaluate("state.meta.title = 'Новое'; change()")
    assert page.inner_text("#hd-sub") == "Правка · изменения сохранятся сами"
    page.wait_for_function("document.getElementById('hd-sub').textContent.startsWith('Правка · сохранено в ')", timeout=10000)
    # Ctrl+S — сохранить сразу, из правки не выходить
    page.evaluate("state.meta.title = 'Сразу'; change()")
    page.keyboard.press("Control+s")
    page.wait_for_function("fakeCloud.db().sermons.s1.meta.title === 'Сразу'", timeout=1500)
    assert page.evaluate("ed.mode") == "edit" and page.evaluate("fakeCloud.db().sermons.s1.lock.email") == "admin@x.pl"
    # «Готово» — сохранить и отпустить
    page.evaluate("state.meta.title = 'Готово'; change()")
    head.click()
    page.wait_for_function("ed.mode === 'view'")
    r = page.evaluate("fakeCloud.db().sermons.s1")
    assert r["meta"]["title"] == "Готово" and r["lock"] is None
    assert head.inner_text().strip() == "Редактировать" and "Правка" not in page.inner_text("#hd-sub")
    assert not page.errors, page.errors
    ctx.close()


def click_at(page, sel):
    """Щелчок мышью по месту элемента: по полю с inert Playwright щёлкать не даёт"""
    b = page.locator(sel).first.bounding_box()
    page.mouse.click(b["x"] + b["width"] / 2, b["y"] + min(20, b["height"] / 2))


def test_click_on_grey_field_nudges_edit_button_without_toast(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full()})
    wait_home(page)
    open_sermon(page, "s1")
    page.locator(".film .st").nth(1).click()
    click_at(page, ".side .bbody .rich")
    assert page.locator(".topbar .hd-act.nudge").count() == 1
    click_at(page, ".speech .speech-text")
    assert page.locator(".topbar .hd-act.nudge").count() == 1
    page.keyboard.press("Control+s")   # в просмотре — тоже подсветка
    assert page.locator(".toast").count() == 0
    page.wait_for_timeout(1400)
    assert page.locator(".topbar .hd-act.nudge").count() == 0   # подсветка гаснет сама
    assert page.evaluate("ed.mode") == "view"
    ctx.close()


def test_someone_else_editing_nudges_status_line(browser, base_url):
    s = rec("s1", "Вера"); s["lock"] = {"email": "ivan@x.pl", "name": "Иван Петров", "at": 0, "beat": 0}
    ctx, page = cloud_page(browser, base_url, user={"email": "petr@x.pl", "name": "Пётр"}, members=MEMBERS, sermons={"s1": s})
    page.evaluate("(() => { const db = fakeCloud.db(); const t = Date.now(); db.sermons.s1.owner = 'petr@x.pl'; db.sermons.s1.lock.at = db.sermons.s1.lock.beat = t; fakeCloud.put(db); })()")
    wait_home(page)
    open_sermon(page, "s1")
    assert "Сейчас правит Иван Петров" in page.inner_text("#hd-save")
    click_at(page, ".speech .speech-text")
    assert page.locator("#hd-save.nudge").count() == 1 and page.locator(".toast").count() == 0
    ctx.close()


def test_versions_on_ctrl_s_done_and_every_ten_minutes(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full()})
    wait_home(page)
    open_sermon(page, "s1")
    start_edit(page)
    # автосохранение без 10 минут правки копии не делает
    page.evaluate("state.meta.title = 'Сначала'; change()")
    page.wait_for_function("fakeCloud.db().sermons.s1.meta.title === 'Сначала'")
    page.wait_for_timeout(300)
    assert versions(page) == []
    # Ctrl+S — копия, даже если всё уже ушло автосохранением
    page.keyboard.press("Control+s")
    page.wait_for_function("((fakeCloud.db().versions || {}).s1 || []).length === 1")
    assert versions(page) == ["Сначала"] and page.evaluate("ed.mode") == "edit"
    # прошло 10 минут правки: копию делает ближайшее автосохранение
    page.evaluate("ed.verAt = Date.now() - 600001; state.meta.title = 'Через 10 минут'; change()")
    page.wait_for_function("((fakeCloud.db().versions || {}).s1 || []).length === 2", timeout=10000)
    assert versions(page)[0] == "Через 10 минут"
    # «Готово» — копия
    page.evaluate("state.meta.title = 'В конце'; change()")
    page.locator("#app").get_by_role("button", name="Готово").click()
    page.wait_for_function("((fakeCloud.db().versions || {}).s1 || []).length === 3")
    assert versions(page)[0] == "В конце"
    assert not page.errors, page.errors
    ctx.close()


def test_leaving_edit_keeps_copy_too(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full()})
    wait_home(page)
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("state.meta.title = 'Ушёл без «Готово»'; change(); navigate('')")
    wait_home(page)
    page.wait_for_function("((fakeCloud.db().versions || {}).s1 || []).length === 1")
    assert versions(page) == ["Ушёл без «Готово»"]
    assert page.evaluate("fakeCloud.db().sermons.s1.lock") is None
    ctx.close()


def test_add_sheet_title_is_new_slide_number(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full()})
    wait_home(page)
    open_sermon(page, "s1")
    start_edit(page)
    total = page.evaluate("slideNums()._total")
    page.locator(".film-end .film-plate").click()
    assert page.inner_text(".overlay.open .sheet-title") == "Слайд %d" % (total + 1)
    page.keyboard.press("Escape")
    page.locator(".film .film-gap[data-at='1']").hover()
    page.locator(".film .film-gap[data-at='1'] .film-ins").click()
    assert page.inner_text(".overlay.open .sheet-title") == "Слайд 2"
    page.keyboard.press("Escape")
    page.locator(".topbar .hd-act").click()   # «Готово»: в просмотре ни «+», ни плашки
    page.wait_for_function("ed.mode === 'view'")
    assert page.locator(".film-gap").count() == 0 and page.locator(".film-end").count() == 0
    ctx.close()
