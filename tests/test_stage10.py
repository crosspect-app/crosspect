"""Этап 10: окно «Пространства» (люди, серии, общее; с этапа 10.1.2 — из списка пространств в шапке), новое пространство, последний вход, список авторов из людей,
серия и формат фона в «О проповеди», фон по серии, колонка и фильтр «Серия». Облако подменено: tests/fixtures/fake_cloud.js."""
from conftest import cloud_page
from test_cloud import ADMIN, IVAN, MEMBERS, rec, wait_home

ED = {"email": "ed@x.pl", "name": "Редактор"}
PEOPLE = dict(MEMBERS, **{"ed@x.pl": {"role": "editor", "firstName": "Эдуард", "lastName": "Редактов"}})
FMT = {"formats": {"f1": {"name": "Синий", "bg": {"color": "#1030a0"}}, "f2": {"name": "Зелёный", "bg": {"color": "#10a030"}}}, "defaultFormat": "system"}


def open_space(page, tab=None):
    page.evaluate("openSpaces()")
    page.wait_for_selector(".space-sheet")
    if tab:
        page.locator(".space-tabs button", has_text=tab).click()


def put_slides(page, slides):
    page.evaluate("s => { const db = fakeCloud.db(); db.slides = s; fakeCloud.put(db); }", slides)


def test_admin_manages_people(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=PEOPLE)
    wait_home(page)
    open_space(page)
    assert page.locator(".space-tabs button.on").inner_text() == "Люди"
    page.wait_for_selector(".sp-people .sp-row[data-key]")
    assert page.locator(".sp-people .sp-row[data-key]").count() == 4
    # добавить: почта проверяется, повтор не проходит; до «Сохранить» в облаке ничего
    page.locator(".sp-edit").click()
    page.wait_for_selector(".sp-table.editing")
    page.locator(".sp-people .sp-addrow").click()
    row = page.locator(".sp-people .sp-new").last
    row.locator("input[aria-label='Имя']").fill("Анна")
    row.locator("input[aria-label='Фамилия']").fill("Ковальская")
    row.locator("input[aria-label='Почта Google']").fill("не почта")
    page.locator(".sp-save").click()
    assert row.locator(".sp-err").inner_text() == "Проверьте почту"
    row.locator("input[aria-label='Почта Google']").fill("IVAN@x.pl")
    page.locator(".sp-save").click()
    assert row.locator(".sp-err").inner_text() == "Человек с такой почтой уже есть"
    assert page.locator(".sp-table.editing").count() >= 1
    row.locator("input[aria-label='Почта Google']").fill("Anna@X.pl")
    assert page.evaluate("!fakeCloud.db().members['anna@x.pl']")
    page.locator(".sp-save").click()
    page.wait_for_selector(".sp-table.editing", state="detached")
    page.wait_for_selector(".sp-row[data-email='anna@x.pl']")
    m = page.evaluate("fakeCloud.db().members['anna@x.pl']")
    assert m["role"] == "preacher" and m["firstName"] == "Анна" and m["lastName"] == "Ковальская"
    page.wait_for_function("PREACHERS.includes('Ковальская Анна')")   # сразу в списке авторов
    # правка в таблице: фамилия и роль уходят в облако только по «Сохранить»
    page.locator(".sp-edit").click()
    page.wait_for_selector(".sp-table.editing")
    row = page.locator(".sp-row[data-email='anna@x.pl']")
    row.locator("input[aria-label='Фамилия']").fill("Новак")
    row.locator("input[aria-label='Фамилия']").press("Tab")
    row.locator("select[aria-label='Роль']").select_option("editor")
    assert page.evaluate("fakeCloud.db().members['anna@x.pl'].lastName") == "Ковальская"
    assert page.evaluate("fakeCloud.db().members['anna@x.pl'].role") == "preacher"
    page.locator(".sp-save").click()
    page.wait_for_function("fakeCloud.db().members['anna@x.pl'].lastName === 'Новак'")
    page.wait_for_function("fakeCloud.db().members['anna@x.pl'].role === 'editor'")
    page.wait_for_selector(".sp-table.editing", state="detached")
    assert page.locator(".sp-row[data-email='anna@x.pl'] .sp-seen").inner_text() == "не входил"
    # убрать — при сохранении, с одним подтверждением
    page.locator(".sp-edit").click()
    page.wait_for_selector(".sp-table.editing")
    page.locator(".sp-row[data-email='anna@x.pl']").get_by_role("button", name="Убрать из пространства").click()
    assert page.evaluate("!!fakeCloud.db().members['anna@x.pl']")
    page.once("dialog", lambda d: d.accept())
    page.locator(".sp-save").click()
    page.wait_for_function("!fakeCloud.db().members['anna@x.pl']")
    page.wait_for_function("!PREACHERS.includes('Новак Анна')")
    assert not page.errors, page.errors
    ctx.close()


def test_last_seen_and_editor_rights(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=PEOPLE, admins=())
    wait_home(page)
    page.wait_for_function("!!fakeCloud.db().members['ed@x.pl'].seenAt")   # вход отмечен сам
    first = page.evaluate("fakeCloud.db().members['ed@x.pl'].seenAt")
    open_space(page)
    page.wait_for_selector(".sp-row[data-email='ed@x.pl']")
    assert page.locator(".sp-row[data-email='ed@x.pl'] .sp-seen").inner_text().startswith("сегодня, ")
    assert page.locator(".sp-row[data-email='ivan@x.pl'] .sp-seen").inner_text() == "не входил"
    # редактор правит людей (этап 10.1.2), но себе не меняет почту и роль и себя не убирает
    assert page.locator(".sp-edit").count() == 1
    page.locator(".sp-edit").click()
    page.wait_for_selector(".sp-table.editing")
    assert page.locator(".sp-people .sp-addrow").count() == 1
    ivan = page.locator(".sp-row[data-email='ivan@x.pl']")
    ivan.locator("select[aria-label='Роль']").select_option("operator")
    me = page.locator(".sp-row[data-email='ed@x.pl']")
    assert me.locator("select").count() == 0 and me.locator("input[aria-label='Почта Google']").count() == 0
    assert me.get_by_role("button", name="Убрать из пространства").count() == 0
    assert page.evaluate("fakeCloud.db().members['ivan@x.pl'].role") != "operator"
    page.locator(".sp-save").click()
    page.wait_for_function("fakeCloud.db().members['ivan@x.pl'].role === 'operator'")
    page.wait_for_selector(".sp-table.editing", state="detached")
    # серии редактор ведёт; «Общее» только смотрит; нового пространства нет
    open_space(page, "Серии проповедей")
    assert page.locator(".sp-edit").count() == 1
    page.locator(".space-tabs button", has_text="Общее").click()
    assert page.locator(".sp-general input[aria-label='Название пространства']").count() == 0
    assert page.locator(".sp-general input[aria-label='Минут без действий']").count() == 0
    assert page.locator(".sp-general .switch").count() == 0   # этап 10.1.3: выбор фона переехал в «Настройки слайдов»
    assert page.locator(".sp-general").get_by_role("button", name="Удалить пространство").count() == 0
    assert page.get_by_role("button", name="Новое пространство").count() == 0
    ctx.close()
    # при следующем входе время обновляется
    ctx, page = cloud_page(browser, base_url, user=ED, members=dict(PEOPLE, **{"ed@x.pl": dict(PEOPLE["ed@x.pl"], seenAt=first - 86400000)}), admins=())
    wait_home(page)
    page.wait_for_function("t => fakeCloud.db().members['ed@x.pl'].seenAt > t", arg=first - 1000)
    ctx.close()
    # автору окна нет, и в выпадающем списке пункта нет
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=PEOPLE, admins=())
    wait_home(page)
    page.evaluate("fillMenu()")
    assert "Пространств" not in page.inner_text("#menu")
    assert page.locator(".topbar .org-pick").count() == 0   # одно пространство и настраивать нечего — просто название
    page.evaluate("openSpaces()")
    assert page.locator(".space-sheet").count() == 0
    ctx.close()


def test_series_table_and_meta_field(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=PEOPLE, sermons={"s1": rec("s1", "Вера")})
    wait_home(page)
    put_slides(page, FMT)
    # серий нет: в «О проповеди» поле не меняется
    page.evaluate("navigate(sermonHash('s1'))")
    page.wait_for_function("state && state.id === 's1' && ed.id === 's1'")
    page.get_by_role("button", name="Редактировать").click()
    page.wait_for_function("ed.mode === 'edit'")
    page.evaluate("openMeta()")
    fixed = page.locator(".meta-sheet .dfield.fixed")
    assert fixed.inner_text() == "Свободная тема"
    assert page.locator(".meta-sheet [aria-label='Формат фона']").count() == 1   # этап 10.1.3: админ выбирает фон вручную всегда
    page.evaluate("closeSettings()")
    # добавить серии: «Свободная тема» встроена, повтор названия не проходит
    open_space(page, "Серии проповедей")
    assert page.locator(".sp-series .sp-fixed").inner_text().startswith("Свободная тема")
    page.locator(".sp-edit").click()
    page.wait_for_selector(".sp-table.editing")
    for n in ["Нагорная проповедь", "Псалмы"]:
        page.locator(".sp-series .sp-addrow").click()
        page.locator(".sp-series .sp-new input[aria-label='Название серии']").last.fill(n)
    page.locator(".sp-save").click()
    page.wait_for_selector(".sp-table.editing", state="detached")
    page.wait_for_function("['Нагорная проповедь', 'Псалмы'].every(n => Object.values(fakeCloud.db().series || {}).some(x => x.name === n))")
    page.wait_for_function("Object.values(SERIES).filter(x => x.name === 'Псалмы').length === 1")
    sid = page.evaluate("Object.keys(SERIES).find(id => SERIES[id].name === 'Нагорная проповедь')")
    psid = page.evaluate("Object.keys(SERIES).find(id => SERIES[id].name === 'Псалмы')")
    # повтор названия (с пробелом и в другом регистре) и «Свободная тема» не проходят, в облако ничего не уходит
    page.locator(".sp-edit").click()
    page.wait_for_selector(".sp-table.editing")
    page.locator(".sp-series .sp-addrow").click()
    new = page.locator(".sp-series .sp-new input[aria-label='Название серии']").last
    new.fill("псалмы ")
    page.locator(".sp-save").click()
    assert page.locator(".sp-series .sp-new .sp-err").inner_text() == "Серия с таким названием уже есть"
    new.fill("свободная тема")
    page.locator(".sp-save").click()
    assert page.locator(".sp-series .sp-new .sp-err").inner_text() == "Серия с таким названием уже есть"
    assert page.evaluate("Object.keys(fakeCloud.db().series).length") == 2
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("button", name="Отменить", exact=True).click()
    page.wait_for_selector(".sp-table.editing", state="detached")
    # формат серии
    page.locator(".sp-edit").click()
    page.wait_for_selector(".sp-table.editing")
    page.locator(f".sp-row[data-id='{sid}'] select[aria-label='Формат фона']").select_option("f1")
    page.locator(".sp-save").click()
    page.wait_for_function("id => fakeCloud.db().series[id].format === 'f1'", arg=sid)
    page.wait_for_selector(".sp-table.editing", state="detached")
    page.evaluate("closeSettings()")
    # в «О проповеди» — список из «Свободной темы» и активных серий
    page.evaluate("openMeta()")
    trig = page.locator(".meta-sheet [aria-label='Серия проповедей']")
    trig.click()
    assert page.locator(".dd-list button").all_inner_texts() == ["Свободная тема", "Нагорная проповедь", "Псалмы"]
    page.locator(".dd-list button", has_text="Нагорная проповедь").click()
    assert page.evaluate("state.meta.series") == sid
    assert page.evaluate("sermonFormatId(state)") == "f1"   # фон — формат серии
    page.evaluate("closeSettings(); saveNow()")
    page.wait_for_function("id => (fakeCloud.db().sermons.s1.meta || {}).series === id", arg=sid)
    # выключили серию: в проповеди осталась, в списке её нет; сменили — вернуть нельзя
    open_space(page, "Серии проповедей")
    page.locator(".sp-edit").click()
    page.wait_for_selector(".sp-table.editing")
    page.locator(f".sp-row[data-id='{sid}'] .switch .sw").click()
    page.locator(".sp-save").click()
    page.wait_for_function("id => fakeCloud.db().series[id].active === false", arg=sid)
    page.evaluate("closeSettings(); openMeta()")
    trig = page.locator(".meta-sheet [aria-label='Серия проповедей']")
    assert trig.inner_text().strip() == "Нагорная проповедь"
    trig.click()
    assert page.locator(".dd-list button").all_inner_texts() == ["Свободная тема", "Псалмы"]
    page.locator(".dd-list button", has_text="Свободная тема").click()
    assert page.evaluate("state.meta.series === undefined")
    trig.click()
    assert "Нагорная проповедь" not in page.locator(".dd-list").inner_text()
    page.keyboard.press("Escape")
    assert psid
    assert not page.errors, page.errors
    ctx.close()


def test_background_order_and_own_format(browser, base_url):
    series = {"a1": {"name": "Серия", "active": True, "format": "f2"}, "a2": {"name": "Без фона", "active": True, "format": ""}}
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=PEOPLE, series=series)
    wait_home(page)
    put_slides(page, dict(FMT, defaultFormat="f1"))
    page.wait_for_function("slidesCfg().defaultFormat === 'f1' && !!SERIES.a1")
    fid = "s => sermonFormatId({ meta:s })"
    assert page.evaluate(fid, {}) == "f1"                                     # без серии — формат по умолчанию
    assert page.evaluate(fid, {"series": "a2"}) == "f1"                       # у серии «По умолчанию»
    assert page.evaluate(fid, {"series": "a1"}) == "f2"                       # формат серии
    # этап 10.1.3: формат, выбранный вручную, действует всегда (выбирать его может админ и роли из «Настроек слайдов → Фон»)
    assert page.evaluate(fid, {"series": "a1", "format": "system"}) == "system"
    assert page.evaluate(fid, {"series": "a1", "format": "gone"}) == "f2"     # формата уже нет — по серии
    # поле в «О проповеди» (админ видит всегда): действующий фон и откуда он
    page.get_by_role("button", name="Новый конспект").first.click()
    page.wait_for_selector(".meta-sheet")
    f = page.locator(".meta-sheet [aria-label='Формат фона']")
    assert f.inner_text().strip() == "Синий (по умолчанию)"
    page.locator(".meta-sheet [aria-label='Серия проповедей']").click()
    page.locator(".dd-list button", has_text="Серия").first.click()
    assert f.inner_text().strip() == "Зелёный (указан для серии)"
    f.click()
    page.locator(".dd-list button", has_text="System Template").click()
    assert page.evaluate("[state.meta.format, sermonFormatId(state)]") == ["system", "system"]
    assert f.inner_text().strip() == "System Template"
    page.evaluate("closeSettings(true)")
    # удалили формат серии — у серии «По умолчанию»
    page.evaluate("seriesFormatGone('f2')")
    page.wait_for_function("fakeCloud.db().series.a1.format === ''")
    assert not page.errors, page.errors
    ctx.close()


def test_home_series_column_and_filter(browser, base_url):
    sermons = {"s1": rec("s1", "Первая"), "s2": rec("s2", "Вторая"), "s3": rec("s3", "Третья")}
    sermons["s1"]["meta"]["series"] = "a1"
    sermons["s2"]["meta"]["series"] = "a2"
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=PEOPLE, sermons=sermons)
    wait_home(page)
    page.wait_for_selector(".scard")
    assert page.locator(".ptable.has-series").count() == 0 and page.locator(".c-series").count() == 0   # серий нет — колонки нет
    page.evaluate("""() => { const db = fakeCloud.db(); db.series = { a1:{ name:'Псалмы', active:true, format:'' }, a2:{ name:'Старая', active:false, format:'' }, a3:{ name:'Пустая', active:true, format:'' } }; fakeCloud.put(db); }""")
    page.wait_for_selector(".ptable.has-series")
    assert page.locator(".shead .c-series").inner_text() == "Серия"
    cells = dict(zip(page.locator(".scard .c-title .scard-title").all_inner_texts(), page.locator(".scard .c-series").all_inner_texts()))
    assert cells == {"Первая": "Псалмы", "Вторая": "Старая", "Третья": "Свободная тема"}
    sel = page.locator("select[aria-label='Серия']")
    opts = sel.locator("option").all_inner_texts()
    assert opts == ["Все серии", "Свободная тема", "Псалмы", "Пустая", "Старая"]   # выключенная — потому что есть в конспектах
    sel.select_option(label="Свободная тема")
    assert page.locator(".scard .c-title .scard-title").all_inner_texts() == ["Третья"]
    sel = page.locator("select[aria-label='Серия']")
    sel.select_option(label="Старая")
    assert page.locator(".scard .c-title .scard-title").all_inner_texts() == ["Вторая"]
    assert page.evaluate("JSON.parse(localStorage.getItem('swp-home-view')).f.series") == "a2"
    assert not page.errors, page.errors
    ctx.close()


def test_admin_creates_space_and_renames(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=PEOPLE)
    wait_home(page)
    open_space(page, "Общее")
    # название и время правки — у админа
    n = page.locator("input[aria-label='Название пространства']")
    n.fill("Słowo Wiary Poznań")
    n.press("Tab")
    page.wait_for_function("fakeCloud.db().space.name === 'Słowo Wiary Poznań' && cloud.spaceName === 'Słowo Wiary Poznań'")
    mins = page.locator("input[aria-label='Минут без действий']")
    mins.fill("500")
    mins.press("Tab")
    assert page.evaluate("fakeCloud.db().space.settings.lockMinutes") is None
    mins = page.locator("input[aria-label='Минут без действий']")
    mins.fill("15")
    mins.press("Tab")
    page.wait_for_function("fakeCloud.db().space.settings.lockMinutes === 15 && cloud.settings.lockMinutes === 15")
    # новое пространство: пустое, сразу текущее, в переключателе
    page.get_by_role("button", name="Новое пространство").click()
    page.wait_for_selector(".new-space-sheet")
    page.fill(".new-space-sheet input", "słowo wiary poznań")
    page.get_by_role("button", name="Создать", exact=True).click()
    assert "уже есть" in page.inner_text(".new-space-sheet .sp-err")
    page.fill(".new-space-sheet input", "Для отца")
    page.get_by_role("button", name="Создать", exact=True).click()
    page.wait_for_function("cloud.spaceName === 'Для отца' && cloudOn()")
    wait_home(page)
    # окно «Пространства» открылось на новом пространстве, на «Людях»
    page.wait_for_selector(".space-sheet .spw-item.on")
    assert page.locator(".spw-item.on").inner_text() == "Для отца"
    assert page.locator(".space-tabs button.on").inner_text() == "Люди"
    page.wait_for_selector("text=В пространстве пока никого нет")
    page.evaluate("closeSettings()")
    page.locator(".topbar .org-pick").click()
    assert [b.strip() for b in page.locator(".dd-list button").all_inner_texts()] == ["Для отца", "Słowo Wiary Poznań", "Настроить пространства", "Фотобанк"]   # фотобанк — только админу (этап 10.5)
    page.keyboard.press("Escape")
    assert page.evaluate("cloud.role") == "admin" and page.evaluate("PREACHERS.length") == 0
    assert not page.errors, page.errors
    ctx.close()


def test_admin_without_spaces_creates_first(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, no_spaces=True)
    page.wait_for_selector("text=Пространств пока нет")
    page.get_by_role("button", name="Создать пространство").click()
    page.fill(".new-space-sheet input", "Первое")
    page.get_by_role("button", name="Создать", exact=True).click()
    page.wait_for_function("cloudOn() && cloud.spaceName === 'Первое'")
    wait_home(page)
    ctx.close()


def test_old_outline_without_series_and_summary_field(browser, base_url):
    """Старые конспекты без серии открываются как «Свободная тема»; серия и свой формат переживают normalize"""
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=PEOPLE)
    wait_home(page)
    assert page.evaluate("normalize({ meta:{ title:'x' }, blocks:[] }).meta.series") is None
    assert page.evaluate("normalize({ meta:{ title:'x', series:'a1', format:'f1' }, blocks:[] }).meta") == {"title": "x", "date": "", "firstName": "", "lastName": "", "series": "a1", "format": "f1"}
    assert page.evaluate("seriesName('')") == "Свободная тема"
    ctx.close()
