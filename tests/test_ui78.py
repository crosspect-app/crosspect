"""Этап 7.8: «Конспекты», список без сортировки, заставка без шапки, «+» в начале и в конце ленты, «Как пользоваться»,
окно «О проповеди» (воскресенья, свой календарь, список авторов), статус пустого конспекта. Облако подменено."""
from conftest import cloud_page, start_blank
from test_cloud import ADMIN, rec
from test_lock import open_sermon, start_edit
from test_ui77 import long_sermon, MEMBERS

MOVE = {"reduced_motion": "no-preference"}


def test_names_list_without_sorting_and_note(page):
    assert page.inner_text(".home-top h1") == "Конспекты"
    assert page.get_by_role("button", name="Новый конспект").count() >= 1
    assert page.locator(".home-note").count() == 0
    assert page.evaluate("getComputedStyle(document.documentElement).overflowX") == "clip"   # въезд экрана не даёт прокрутки вбок


def test_list_has_no_sort_buttons_and_keeps_date_order(browser, base_url):
    S = {"a": rec("a", "Старая", date="2020-01-05"), "b": rec("b", "Новая", date="2099-01-04"), "c": rec("c", "Без даты", date="")}
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons=S)
    page.wait_for_selector(".scard")
    assert page.locator(".srow.shead button").count() == 0
    assert [t.strip() for t in page.locator(".scard .scard-title").all_inner_texts()] == ["Без даты", "Новая", "Старая"]
    ctx.close()


def test_splash_without_topbar_and_light_first(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, **MOVE)
    page.wait_for_selector(".gate-card.splash")
    assert not page.locator(".topbar").is_visible()
    t = page.evaluate("['.lg-c', '.lg-a', '.lg-b'].map(c => document.querySelector('.gate-logo.intro ' + c).getAnimations()[0].effect.getComputedTiming().delay)")
    assert t == sorted(t) and t[0] < t[1], t   # сначала жёлтый клин, потом кремовые части
    page.wait_for_selector(".home-top", timeout=8000)
    assert page.locator(".topbar").is_visible()
    ctx.close()


def test_film_plus_at_start_and_end(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": long_sermon(3)})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    assert page.locator(".film-end").count() == 0 and page.locator(".film-gap").count() == 0   # просмотр
    start_edit(page)
    assert page.locator(".film-add").count() == 0
    first = page.locator(".film > .film-gap").first
    assert "first" in first.get_attribute("class")
    # этап 9.8: «+» перед первым — как между слайдами, только при наведении; в конце — плашка размером с миниатюру
    op = "sel => getComputedStyle(document.querySelector(sel)).opacity"
    assert page.evaluate(op, ".film-gap.first .film-ins") == "0" and page.evaluate(op, ".film > .film-gap:not(.first) .film-ins") == "0"
    plate = page.locator(".film-end .film-plate")
    assert page.evaluate(op, ".film-end .film-plate") == "1" and plate.inner_text().strip() == "Добавить слайд"
    assert page.evaluate("[...document.querySelectorAll('.film .film-ins')].every(b => b.title === 'Добавить слайд')")
    thumb = page.evaluate("(() => { const r = document.querySelector('.film .st-thumb').getBoundingClientRect(); return [r.width, r.height]; })()")
    pl = plate.bounding_box()
    assert abs(pl["width"] - thumb[0]) <= 2 and abs(pl["height"] - thumb[1]) <= 2, (pl, thumb)
    total = page.evaluate("slideNums()._total")
    plate.click()
    assert page.inner_text(".overlay.open .sheet-title") == "Слайд %d" % (total + 1)
    page.keyboard.press("Escape")
    first.hover()
    assert page.evaluate(op, ".film-gap.first .film-ins") == "1"
    page.locator(".film-gap.first .film-ins").click()
    assert page.inner_text(".overlay.open .sheet-title") == "Слайд 1"
    ctx.close()


def test_help_page_and_back(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": long_sermon(3)})
    page.wait_for_selector(".scard")
    page.locator(".hd-help").click()
    page.wait_for_selector(".help")
    assert page.inner_text(".help h1") == "Как пользоваться"
    page.locator(".topbar .btn.ghost", has_text="Назад").click()
    page.wait_for_function("screen === 'home' && !location.hash")   # «Назад» — это history.back(): ждём, пока он отработает
    # из конспекта в правке: «⋯ → Как пользоваться» и обратно — правка и замок на месте
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("openHelp()")
    page.wait_for_selector(".help")
    assert page.evaluate("ed.mode") == "edit", page.evaluate("JSON.stringify({mode:ed.mode, id:ed.id, st:state && state.id, hash:location.hash, screen})")
    page.locator(".help .btn.primary", has_text="Вернуться").click()
    page.wait_for_function("screen === 'sermon' && !!document.querySelector('.film .st')")
    assert page.evaluate("ed.mode") == "edit"
    assert not page.errors, page.errors
    ctx.close()


def test_meta_dialog_sundays_and_calendar(page):
    page.evaluate("PREACHERS.length = 0; PREACHERS.push('Петров Иван', 'Шух Валентин')")
    start_blank(page)
    page.evaluate("openMeta()")
    chips = page.locator(".date-chips .date-chip")
    assert chips.count() == 3 and "ближайшее" in chips.first.inner_text()
    assert "on" in chips.first.get_attribute("class")   # новая — на ближайшее воскресенье
    chips.nth(1).click()
    assert page.evaluate("state.meta.date") == page.evaluate("sundaysAhead(3)[1]")
    # другая дата — свой календарь: воскресенья, сегодня, выбор
    page.locator(".date-other").click()
    page.wait_for_selector(".cal")
    assert page.locator(".cal .wd.sun").inner_text() == "Вс"
    assert page.locator(".cal .d.today").count() == 1 and page.locator(".cal .d.sun").count() >= 4
    page.locator(".cal .cal-nav .icon-btn").nth(1).click()   # следующий месяц
    page.locator(".cal .d:not(.out)", has_text="3").first.click()
    assert page.locator(".cal").count() == 0
    d = page.evaluate("state.meta.date")
    assert d.endswith("-03")
    assert page.locator(".date-chips .date-chip.on").count() == 1   # выбранная дата — отдельной кнопкой
    # Esc закрывает календарь, а окно остаётся
    page.locator(".date-other").click()
    page.keyboard.press("Escape")
    assert page.locator(".cal").count() == 0 and page.locator(".sheet[aria-label='О проповеди']").is_visible()


def test_calendar_marks_dates_with_outlines(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"x": rec("x", "Есть", date="2099-01-04")})
    page.wait_for_selector(".scard")
    start_blank(page)
    page.evaluate("state.meta.date = '2099-01-11'; openMeta()")
    page.locator(".date-other").click()
    assert page.locator(".cal .d.has").inner_text() == "4"
    assert "уже есть конспект" in page.inner_text(".cal")
    ctx.close()


def test_author_list_and_manual(page):
    page.evaluate("PREACHERS.length = 0; PREACHERS.push('Петров Иван', 'Шух Валентин')")
    start_blank(page)
    page.evaluate("openMeta()")
    trig = page.locator(".sheet .author-field .dfield")
    assert trig.inner_text().strip() == "Выберите автора"   # в списке есть авторы: без «Имя» и «Фамилия»
    assert not page.locator(".author-names").is_visible()
    trig.click()
    items = page.locator(".dd-list button").all_inner_texts()
    assert items == ["Иван Петров", "Валентин Шух", "Ввести вручную"] and page.locator(".dd-list hr").count() == 1
    page.locator(".dd-list button", has_text="Валентин Шух").click()
    assert page.evaluate("[state.meta.firstName, state.meta.lastName]") == ["Валентин", "Шух"]
    assert trig.inner_text().strip() == "Валентин Шух"
    trig.click()
    page.locator(".dd-list .man").click()
    assert page.locator(".author-names").is_visible() and trig.inner_text().strip() == "Ввести вручную"
    page.locator(".author-names input").first.fill("Анна")
    page.locator(".author-names input").nth(1).fill("Ковальская")
    assert page.evaluate("preacherName(state.meta)") == "Анна Ковальская"
    # без списка авторов: поле «Ввести вручную» не раскрывается, имя и фамилия видны сразу
    page.evaluate("closeSettings(); PREACHERS.length = 0; openMeta()")
    fixed = page.locator(".sheet .author-field .dfield.fixed")
    assert fixed.inner_text().strip() == "Ввести вручную" and page.locator(".author-names").is_visible()
    assert page.locator(".author-names input").first.input_value() == "Анна"


def test_new_outline_author_from_table_not_google(browser, base_url):
    # этап 10: имя подставляется только автору — из таблицы людей; у редактора поле пустое, имени Google нет нигде
    members = {"ivan@x.pl": {"role": "preacher", "firstName": "Валентин", "lastName": "Шух"}, "ed@x.pl": {"role": "editor", "firstName": "Пётр", "lastName": "Сидоров"}}
    ctx, page = cloud_page(browser, base_url, user={"email": "ivan@x.pl", "name": "Гугл Аккаунт"}, members=members, admins=())
    page.wait_for_selector(".home-top")
    page.wait_for_function("PREACHERS.length === 2")   # список авторов — из таблицы людей
    page.evaluate("newSermon(); closeSettings()")
    assert page.evaluate("preacherName(state.meta)") == "Валентин Шух"
    ctx.close()
    ctx, page = cloud_page(browser, base_url, user={"email": "ed@x.pl", "name": "Гугл Аккаунт"}, members=members, admins=())
    page.wait_for_selector(".home-top")
    page.wait_for_function("PREACHERS.length === 2")
    page.evaluate("newSermon(); closeSettings()")
    assert page.evaluate("preacherName(state.meta)") == ""   # редактор: поле пустое, даже если он сам проповедует
    ctx.close()
    ctx, page = cloud_page(browser, base_url, user={"email": "ivan@x.pl", "name": "Гугл Аккаунт"}, members={"ivan@x.pl": {"role": "preacher"}}, admins=())
    page.wait_for_selector(".home-top")
    page.evaluate("newSermon(); closeSettings()")
    assert page.evaluate("preacherName(state.meta)") == ""   # в таблице имени нет — из Google не берём
    ctx.close()


def test_status_locked_to_draft_while_empty(page):
    start_blank(page)
    opts = lambda: page.evaluate("[...document.querySelectorAll('.stswitch .sw-opt')].map(b => b.disabled)")
    assert opts() == [False, True, True, True]
    assert page.locator(".stswitch .sw-opt.st-submitted").get_attribute("title") == "Сначала добавьте слайды"
    page.evaluate("addBlock('thesis', 0)")
    assert opts()[1] is False   # слайд есть — «Готов к вёрстке» можно
    page.locator(".stswitch .sw-opt.st-submitted").click()
    assert page.evaluate("state.cloudStatus") == "submitted"
