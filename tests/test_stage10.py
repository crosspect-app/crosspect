"""Этап 10: окно «Пространство» (люди, серии, общее), новое пространство, «входил», список авторов из людей,
серия и формат фона в «О проповеди», фон по серии, колонка и фильтр «Серия». Облако подменено: tests/fixtures/fake_cloud.js."""
from conftest import cloud_page
from test_cloud import ADMIN, IVAN, MEMBERS, rec, wait_home

ED = {"email": "ed@x.pl", "name": "Редактор"}
PEOPLE = dict(MEMBERS, **{"ed@x.pl": {"role": "editor", "firstName": "Эдуард", "lastName": "Редактов"}})
FMT = {"formats": {"f1": {"name": "Синий", "bg": {"color": "#1030a0"}}, "f2": {"name": "Зелёный", "bg": {"color": "#10a030"}}}, "defaultFormat": "system"}


def open_space(page, tab=None):
    page.evaluate("openSpace()")
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
    assert page.locator(".sp-people .sp-row[data-email]").count() == 4
    # добавить: почта проверяется, повтор не проходит
    add = page.locator(".sp-people .sp-add")
    add.locator("input[aria-label='Имя нового человека']").fill("Анна")
    add.locator("input[aria-label='Фамилия нового человека']").fill("Ковальская")
    add.locator("input[aria-label='Почта нового человека']").fill("не почта")
    add.get_by_role("button", name="Добавить").click()
    assert page.locator(".sp-add .sp-err").inner_text() == "Проверьте почту"
    add.locator("input[aria-label='Почта нового человека']").fill("IVAN@x.pl")
    add.get_by_role("button", name="Добавить").click()
    assert page.locator(".sp-add .sp-err").inner_text() == "Этот человек уже есть"
    add.locator("input[aria-label='Почта нового человека']").fill("Anna@X.pl")
    add.get_by_role("button", name="Добавить").click()
    page.wait_for_selector(".sp-row[data-email='anna@x.pl']")
    m = page.evaluate("fakeCloud.db().members['anna@x.pl']")
    assert m["role"] == "preacher" and m["firstName"] == "Анна" and m["lastName"] == "Ковальская"
    page.wait_for_function("PREACHERS.includes('Ковальская Анна')")   # сразу в списке авторов
    # правка прямо в таблице
    row = page.locator(".sp-row[data-email='anna@x.pl']")
    row.locator("input[aria-label='Фамилия']").fill("Новак")
    row.locator("input[aria-label='Фамилия']").press("Tab")
    page.wait_for_function("fakeCloud.db().members['anna@x.pl'].lastName === 'Новак'")
    row = page.locator(".sp-row[data-email='anna@x.pl']")
    row.locator("select[aria-label='Роль']").select_option("editor")
    page.wait_for_function("fakeCloud.db().members['anna@x.pl'].role === 'editor'")
    assert page.locator(".sp-row[data-email='anna@x.pl'] .sp-seen").inner_text() == "ещё не входил"
    # убрать — с подтверждением
    page.once("dialog", lambda d: d.accept())
    page.locator(".sp-row[data-email='anna@x.pl']").get_by_role("button", name="Убрать из пространства").click()
    page.wait_for_function("!fakeCloud.db().members['anna@x.pl']")
    page.wait_for_function("!PREACHERS.includes('Новак Анна')")
    assert not page.errors, page.errors
    ctx.close()


def test_seen_mark_and_editor_reads_only(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=PEOPLE, admins=())
    wait_home(page)
    page.wait_for_function("!!fakeCloud.db().members['ed@x.pl'].seenAt")   # первый вход отмечен сам
    open_space(page)
    assert page.locator(".sp-row[data-email='ed@x.pl'] .sp-seen").inner_text() == "входил"
    assert page.locator(".sp-row[data-email='ivan@x.pl'] .sp-seen").inner_text() == "ещё не входил"
    assert page.locator(".sp-people input").count() == 0 and page.locator(".sp-people select").count() == 0   # только смотрит
    assert page.locator(".sp-people .sp-add").count() == 0
    assert "только админ" in page.inner_text(".space-sheet")
    # серии редактор ведёт; название и время правки — нет; новое пространство — нет
    open_space(page, "Серии проповедей")
    assert page.locator(".sp-series .sp-add").count() == 1
    page.locator(".space-tabs button", has_text="Общее").click()
    assert page.locator(".sp-general input[aria-label='Название пространства']").count() == 0
    assert page.locator(".sp-general input[aria-label='Минут без действий']").count() == 0
    assert page.locator(".sp-general .switch input").count() == 1
    assert page.get_by_role("button", name="Новое пространство").count() == 0
    ctx.close()
    # автору окна нет
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=PEOPLE, admins=())
    wait_home(page)
    page.evaluate("fillMenu()")
    assert "Пространство" not in page.inner_text("#menu")
    page.evaluate("openSpace()")
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
    assert page.locator(".meta-sheet [aria-label='Формат фона']").count() == 0   # «Выбирать формат фона» выключено
    page.evaluate("closeSettings()")
    # добавить серии: «Свободная тема» встроена, повтор названия не проходит
    open_space(page, "Серии проповедей")
    assert page.locator(".sp-series .sp-fixed").inner_text().startswith("Свободная тема")
    name = page.locator("input[aria-label='Название новой серии']")
    for n in ["Нагорная проповедь", "Псалмы"]:
        name.fill(n)
        page.get_by_role("button", name="Добавить серию").click()
        page.wait_for_function("n => Object.values(fakeCloud.db().series || {}).some(x => x.name === n)", arg=n)
        name = page.locator("input[aria-label='Название новой серии']")
    name.fill("псалмы ")
    page.get_by_role("button", name="Добавить серию").click()
    assert page.locator(".sp-series .sp-err").inner_text() == "Серия с таким названием уже есть"
    name.fill("свободная тема")
    page.get_by_role("button", name="Добавить серию").click()
    assert page.locator(".sp-series .sp-err").inner_text() == "Серия с таким названием уже есть"
    sid = page.evaluate("Object.keys(SERIES).find(id => SERIES[id].name === 'Нагорная проповедь')")
    psid = page.evaluate("Object.keys(SERIES).find(id => SERIES[id].name === 'Псалмы')")
    # формат серии
    page.locator(f".sp-row[data-id='{sid}'] select[aria-label='Формат фона']").select_option("f1")
    page.wait_for_function("id => fakeCloud.db().series[id].format === 'f1'", arg=sid)
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
    page.locator(f".sp-row[data-id='{sid}'] .switch .sw").click()
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
    assert page.evaluate(fid, {"series": "a1", "format": "system"}) == "f2"   # свой формат не действует, пока выбор выключен
    # «Выбирать формат фона в проповеди» в «Общем»
    open_space(page, "Общее")
    page.locator(".sp-general .switch .sw").click()
    page.wait_for_function("fakeCloud.db().slides.pickFormat === true && slidesCfg().pickFormat")
    assert page.evaluate("fakeCloud.db().slides.defaultFormat") == "f1"      # остальные настройки слайдов не тронуты
    assert page.evaluate(fid, {"series": "a1", "format": "system"}) == "system"
    assert page.evaluate(fid, {"series": "a1", "format": "gone"}) == "f2"     # формата уже нет — по серии
    page.evaluate("closeSettings()")
    # поле в «О проповеди»: «По умолчанию» показывает, какой формат будет
    page.get_by_role("button", name="Новый конспект").first.click()
    page.wait_for_selector(".meta-sheet")
    f = page.locator(".meta-sheet [aria-label='Формат фона']")
    assert f.inner_text().strip() == "По умолчанию · Синий"
    page.locator(".meta-sheet [aria-label='Серия проповедей']").click()
    page.locator(".dd-list button", has_text="Серия").first.click()
    assert f.inner_text().strip() == "По умолчанию · Зелёный"
    f.click()
    page.locator(".dd-list button", has_text="System Template").click()
    assert page.evaluate("[state.meta.format, sermonFormatId(state)]") == ["system", "system"]
    page.evaluate("closeSettings()")
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
    assert page.locator(".org-pick option").all_inner_texts() == ["Для отца", "Słowo Wiary Poznań"]
    assert page.evaluate("cloud.role") == "admin" and page.evaluate("PREACHERS.length") == 0
    open_space(page, "Люди")
    assert "В пространстве пока никого нет" in page.inner_text(".space-sheet")
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
