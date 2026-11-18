"""Этап 10.5.4: лимиты базы — окно «Лимиты базы» и подсветка у админа. Счётчики лежат в usage/current (их кладёт скрипт из crosspect-backup):
четыре полоски с цветом (жёлтый от 70 %, красный от 90 %) и временем сброса; жёлтая точка на кнопке списка пространств и жёлтый пункт от 80 %,
красные от 90 %; у не-админа ничего нет; данные прошлых суток и месяца не считаются; обновление без перезагрузки; текст при исчерпании."""
import re

from conftest import cloud_page, ME

EDITOR = {"email": "ed@x.pl", "name": "Редактор"}
MEMBERS = {"ed@x.pl": {"role": "editor", "firstName": "Пётр", "lastName": "Сидоров"}}
MIB = 1024 * 1024
GIB = 1024 * MIB


def flat(t):
    return re.sub(r"[\s  ]+", " ", t).strip()


def put_usage(page, **kw):
    """usage/current как после скрипта: сегодняшние сутки и месяц (по тихоокеанскому времени, как считает форма); kw перекрывает поля."""
    page.evaluate("""kw => { const pt = usagePT(Date.now()), db = fakeCloud.db();
      db.usage = { current: Object.assign({ at: Date.now(), day: pt.day, month: pt.month, reads: 0, writes: 0, dataBytes: 0, egressBytes: 0 }, kw) }; fakeCloud.put(db); }""", kw)


def open_menu(page):
    page.click(".org-pick")
    page.wait_for_selector(".dd-list")


def menu_item(page):
    return page.locator(".dd-list button", has_text="Лимиты базы")


def dot(page):
    return page.locator(".org-sel .usage-dot")


def start(browser, base_url, user=ME, members=None):
    ctx, page = cloud_page(browser, base_url, user=user, members=members or {})
    page.wait_for_selector(".org-pick")
    page.wait_for_function("typeof usageLevel === 'function'")
    return ctx, page


def open_panel(page):
    open_menu(page)
    menu_item(page).click()
    page.wait_for_selector(".usage-sheet")


def test_item_only_for_admin_after_photobank(browser, base_url):
    ctx, page = start(browser, base_url)
    open_menu(page)
    labels = [flat(x) for x in page.locator(".dd-list button").all_inner_texts()]
    assert "Лимиты базы" in labels and labels.index("Лимиты базы") == labels.index("Фотобанк") + 1
    ctx.close()
    ctx, page = start(browser, base_url, user=EDITOR, members=MEMBERS)
    open_menu(page)
    assert menu_item(page).count() == 0
    assert dot(page).count() == 0
    ctx.close()


def test_panel_four_bars_with_numbers_and_reset(browser, base_url):
    ctx, page = start(browser, base_url)
    put_usage(page, reads=4120, writes=860, dataBytes=312 * MIB, egressBytes=int(1.2 * GIB))
    open_panel(page)
    page.wait_for_selector(".usage-row")
    rows = {k: flat(page.inner_text(f'[data-usage="{k}"]')) for k in ("reads", "writes", "data", "egress")}
    assert "Чтения сегодня" in rows["reads"] and "4 120 из 50 000" in rows["reads"]
    assert "Записи сегодня" in rows["writes"] and "860 из 20 000" in rows["writes"]
    assert "Данные" in rows["data"] and "312 МБ из 1 ГБ" in rows["data"]
    assert re.search(r"Трафик за [а-я]+ 1,2 ГБ из 10 ГБ", rows["egress"])
    assert re.search(r"сбросится (сегодня|завтра) в \d{1,2}:\d{2}", rows["reads"]) and re.search(r"сбросится (сегодня|завтра) в", rows["writes"])
    assert re.search(r"сбросится 1 [а-я]+", rows["egress"])
    assert "не сбрасывается" in rows["data"]
    assert re.search(r"Обновлено (\d\d\.\d\d )?в \d{1,2}:\d{2}", flat(page.inner_text(".usage-foot")))
    link = page.locator(".usage-link")
    assert link.inner_text() == "Открыть в консоли Firebase" and "console.firebase.google.com/project/crosspect-2dabd" in link.get_attribute("href")
    page.click(".usage-sheet [aria-label='Закрыть']")
    assert not page.evaluate("settingsOverlay.classList.contains('open') || usageOpen")
    assert not page.errors
    ctx.close()


def test_bar_colors_by_share(browser, base_url):
    ctx, page = start(browser, base_url)
    put_usage(page, reads=34000, writes=15000, dataBytes=950 * MIB, egressBytes=0)   # 68 %, 75 %, 93 %, 0 %
    open_panel(page)
    page.wait_for_selector(".usage-row")
    cls = {k: page.get_attribute(f'[data-usage="{k}"] .usage-bar', "class") for k in ("reads", "writes", "data", "egress")}
    assert "warn" not in cls["reads"] and "crit" not in cls["reads"]
    assert "warn" in cls["writes"] and "crit" in cls["data"]
    assert "warn" not in cls["egress"] and "crit" not in cls["egress"]
    ctx.close()


def test_highlight_thresholds_dot_and_item(browser, base_url):
    ctx, page = start(browser, base_url)
    put_usage(page, reads=39000)   # 78 % — ещё нет
    page.wait_for_function("usageLevel() === 'none'")
    assert not dot(page).is_visible()
    put_usage(page, reads=42000)   # 84 % — жёлтая
    page.wait_for_function("usageLevel() === 'warn'")
    assert dot(page).is_visible() and "crit" not in dot(page).get_attribute("class")
    assert dot(page).get_attribute("title") == "Чтения базы на сегодня — 84 %"
    open_menu(page)
    item = menu_item(page)
    assert "usage-warn" in item.get_attribute("class") and item.get_attribute("title") == "Чтения базы на сегодня — 84 %"
    page.keyboard.press("Escape")
    put_usage(page, reads=10, writes=18500)   # 92,5 % — красная; самый заполненный лимит — записи
    page.wait_for_function("usageLevel() === 'crit'")
    assert "crit" in dot(page).get_attribute("class") and dot(page).get_attribute("title") == "Записи базы на сегодня — 92 %"
    page.evaluate("closeDropdown()")
    open_menu(page)
    assert "usage-crit" in menu_item(page).get_attribute("class")
    ctx.close()


def test_highlight_follows_worst_limit_and_clears(browser, base_url):
    ctx, page = start(browser, base_url)
    put_usage(page, reads=1, writes=1, egressBytes=int(8.5 * GIB))   # трафик 85 %
    page.wait_for_function("usageLevel() === 'warn'")
    assert dot(page).get_attribute("title") == "Трафик базы за месяц — 85 %"
    put_usage(page, reads=1, writes=1, egressBytes=int(2 * GIB))   # меньше 80 % — подсветка уходит сама
    page.wait_for_function("usageLevel() === 'none'")
    assert not dot(page).is_visible()
    ctx.close()


def test_old_day_and_month_do_not_count(browser, base_url):
    ctx, page = start(browser, base_url)
    # вчерашние чтения и прошлый месяц: лимиты сбросились, подсветки нет, в панели «ещё не обновлено»
    put_usage(page, day="2000-01-01", month="2000-01", reads=49000, writes=19000, egressBytes=9 * GIB, dataBytes=100 * MIB)
    page.wait_for_function("usageData && usageData.day === '2000-01-01'")
    assert page.evaluate("usageLevel()") == "none" and not dot(page).is_visible()
    open_panel(page)
    page.wait_for_selector(".usage-row")
    assert "ещё не обновлено" in flat(page.inner_text('[data-usage="reads"]'))
    assert "ещё не обновлено" in flat(page.inner_text('[data-usage="egress"]'))
    assert "100 МБ из 1 ГБ" in flat(page.inner_text('[data-usage="data"]'))   # объём данных не сбрасывается
    ctx.close()


def test_data_without_counter_and_no_document(browser, base_url):
    ctx, page = start(browser, base_url)
    open_panel(page)
    page.wait_for_selector(".usage-sheet .hint")
    assert "Данных пока нет" in page.inner_text(".usage-sheet")
    put_usage(page, reads=100, writes=10, dataBytes=None, egressBytes=None)   # скрипт не получил объём и трафик
    page.wait_for_selector(".usage-row")
    assert "нет данных" in flat(page.inner_text('[data-usage="data"]')) and "нет данных" in flat(page.inner_text('[data-usage="egress"]'))
    assert page.evaluate("usageLevel()") == "none"
    ctx.close()


def test_open_panel_updates_live(browser, base_url):
    ctx, page = start(browser, base_url)
    put_usage(page, reads=1000)
    open_panel(page)
    page.wait_for_selector(".usage-row")
    assert "1 000 из 50 000" in flat(page.inner_text('[data-usage="reads"]'))
    put_usage(page, reads=2000)
    page.wait_for_function("document.querySelector('[data-usage=reads]').innerText.replace(/\\s/g, '').includes('2000из50000')")
    ctx.close()


def test_not_admin_never_reads_usage(browser, base_url):
    ctx, page = start(browser, base_url, user=EDITOR, members=MEMBERS)
    put_usage(page, reads=49000)
    page.wait_for_timeout(300)
    assert page.evaluate("usageLevel()") == "none" and page.evaluate("typeof usageUnsub !== 'undefined' && usageUnsub === null")
    assert dot(page).count() == 0 and not page.errors
    ctx.close()


def test_exhausted_message_for_everyone(browser, base_url):
    """Ошибка resource-exhausted: понятный текст у любого человека; правки остаются в браузере (проверяет test_editor)."""
    ctx, page = start(browser, base_url, user=EDITOR, members=MEMBERS)
    text = page.evaluate("""async () => { const m = await import('./js/cloud-api.mjs?v=t'); return m.explain({ code:'resource-exhausted' }); }""")
    assert text == "База на сегодня исчерпала бесплатный лимит, заработает около 9:00. Изменения сохранены в этом браузере."
    ctx.close()
