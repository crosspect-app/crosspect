"""Этап 9: «Ссылка для оператора» и страница оператора (#op=<ключ>, без входа).
Облако подменено: tests/fixtures/fake_cloud.js (снимок — db.shares[ключ], как shares/{ключ} в Firestore)."""
import json

from conftest import cloud_page, download_file, open_sermon
from test_cloud import ADMIN, IVAN, wait_home

ED = {"email": "ed@x.pl", "name": "Ред Акторов"}
MEMBERS = {"admin@x.pl": {"role": "editor"}, "ed@x.pl": {"role": "editor"},
           "ivan@x.pl": {"role": "preacher", "firstName": "Иван", "lastName": "Петров"}}
HINT = "ПОДСКАЗКА-РЕДАКТОРУ"
SECRET = "secret.example"

RICH = {
    "id": "r1", "v": 2, "meta": {"title": "Вера и дела", "date": "2026-11-15", "firstName": "Иван", "lastName": "Петров"}, "settings": {},
    "blocks": [
        {"id": "b1", "type": "splash", "speech": "Приветствие <b>громко</b>"},
        {"id": "b2", "type": "scripture", "speech": "Читаем вслух",
         "items": [{"kind": "scripture", "ref": "Ин. 3:16", "translation": "СИНОД", "verses": [{"num": "16", "text": "Ибо так возлюбил Бог мир"}], "sel": [16]},
                   {"kind": "text", "html": "Дополнительный текст", "align": "center"}]},
        {"id": "b3", "type": "thesis", "name": "Бог любит всех", "text": "Бог любит <b>всех</b>", "parts": [{"kind": "text", "html": "Бог любит <b>всех</b>", "align": "center"}]},
        {"id": "b4", "type": "quote", "text": "Вера без дел мертва", "author": "Иаков", "caption": "Послание"},
        {"id": "b5", "type": "image", "name": "Фото Десмонд Досс", "mode": "find", "desc": HINT},
        {"id": "b6", "type": "video", "name": "История Николаса Винтона", "mode": "link", "url": "https://" + SECRET + "/v", "from": "1:00", "to": "2:30"},
        {"id": "b7", "type": "note", "text": "включить музыку"},
    ],
    "status": "draft", "owner": "admin@x.pl", "createdBy": "admin@x.pl", "createdAt": 1000, "updatedAt": 5000, "updatedBy": "admin@x.pl",
}


def make(browser, base_url, user=ADMIN, sermon=RICH, **kw):
    ctx, page = cloud_page(browser, base_url, user=user, members=MEMBERS, sermons={sermon["id"]: sermon}, **kw)
    ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=base_url)
    wait_home(page)
    return ctx, page


def to_text_view(page, id="r1"):
    page.evaluate("id => navigate(sermonHash(id, 'text'))", id)
    page.wait_for_selector(".tv-doc")


def press_link(page):
    page.locator(".tv-side button:has-text('Ссылка для оператора')").click()
    page.wait_for_selector(".oplink-url")
    return page.locator(".oplink-url").input_value()


def operator_page(ctx, page, url):
    """Вторая вкладка без входа: «база» у неё общая с первой (localStorage), а человека как будто нет."""
    page.evaluate("localStorage.removeItem('fake-user')")
    op = ctx.new_page()
    op.errors = []
    op.on("pageerror", lambda e: op.errors.append(str(e)))
    op.goto(url)
    return op


def db(page):
    return page.evaluate("fakeCloud.db()")


def test_create_link_copies_and_second_press_gives_same_link(browser, base_url):
    ctx, page = make(browser, base_url)
    page.evaluate("id => navigate(sermonHash(id))", "r1")
    page.wait_for_function("state && state.id === 'r1' && screen === 'sermon' && ed.id === 'r1' && !ed.busy")
    to_text_view(page)
    url = press_link(page)
    d = db(page)
    key = d["sermons"]["r1"]["shareKey"]
    assert url == base_url + "/index.html#op=" + key and 20 <= len(key) <= 64
    sh = d["shares"][key]
    assert sh["sermonId"] == "r1" and sh["createdBy"] == "admin@x.pl" and sh["spaceId"] == "sp1"
    assert page.evaluate("navigator.clipboard.readText()") == url   # ссылка уже в буфере
    # повторное нажатие — та же ссылка, новой не появляется
    page.locator(".oplink .icon-btn[aria-label='Закрыть']").click()
    assert press_link(page) == url
    assert len(db(page)["shares"]) == 1
    assert page.evaluate("state.cloudShare") == key
    assert page.errors == []
    ctx.close()


def test_link_not_in_downloaded_file(browser, base_url):
    ctx, page = make(browser, base_url)
    page.evaluate("id => navigate(sermonHash(id))", "r1")
    page.wait_for_function("state && state.id === 'r1' && ed.id === 'r1' && !ed.busy")
    to_text_view(page)
    press_link(page)
    page.locator(".oplink .icon-btn[aria-label='Закрыть']").click()
    f = download_file(page)
    data = json.loads(open(f.path(), encoding="utf-8").read())
    assert "cloudShare" not in data and "shareKey" not in data
    ctx.close()


def test_operator_page_without_sign_in_shows_pdf_content_without_hints(browser, base_url):
    ctx, page = make(browser, base_url)
    page.evaluate("id => navigate(sermonHash(id))", "r1")
    page.wait_for_function("state && state.id === 'r1' && ed.id === 'r1' && !ed.busy")
    to_text_view(page)
    url = press_link(page)
    op = operator_page(ctx, page, url)
    op.wait_for_selector(".opv-title")
    assert op.evaluate("screen") == "op" and not op.evaluate("cloud.user") and op.evaluate("cloud.authOn") is False
    assert op.locator(".opv-title").inner_text() == "Вера и дела"
    meta = op.locator(".opv-meta").inner_text()
    assert "15 ноября 2026" in meta and "Иван Петров" in meta
    assert op.locator(".opv-upd").inner_text().startswith("Обновлено")
    types = op.locator(".opv-slide .opv-type").all_inner_texts()
    assert [t.strip().lower() for t in types] == ["заставка проповеди", "место писания", "тезис", "цитата", "картинка", "видео"]   # на экране заглавными (CSS)
    nums = op.locator(".opv-num").all_inner_texts()
    assert nums == ["01", "02", "03", "04", "05", "06"]
    body = op.locator(".opv").inner_text()
    assert "Ин. 3:16" in body and "Ибо так возлюбил Бог мир" in body and "Дополнительный текст" in body
    assert "Бог любит всех" in body and "Вера без дел мертва" in body and "Иаков" in body
    assert "Фото Десмонд Досс" in body and "История Николаса Винтона" in body and "с 1:00 до 2:30" in body
    assert "Приветствие громко" in body and "Читаем вслух" in body   # текст к слайду под каждым слайдом
    note = op.locator(".opv-note")
    assert note.count() == 1 and "включить музыку" in note.inner_text().lower() and "⚠" in note.inner_text()
    assert op.evaluate("getComputedStyle(document.querySelector('.opv-note-body')).textTransform") == "uppercase"
    # подсказок редактора нет ни на странице, ни в снимке
    assert HINT not in body and SECRET not in body and "доработать" not in body.lower()
    raw = json.dumps(db(page)["shares"], ensure_ascii=False)
    assert HINT not in raw and SECRET not in raw and "desc" not in raw and "mode" not in raw
    # шапки формы нет, экрана входа и заставки тоже
    assert not op.locator(".topbar").is_visible() and op.locator(".gate").count() == 0
    assert op.errors == []
    ctx.close()


def test_operator_text_size_and_slides_only_are_remembered(browser, base_url):
    ctx, page = make(browser, base_url)
    page.evaluate("id => navigate(sermonHash(id))", "r1")
    page.wait_for_function("state && state.id === 'r1' && ed.id === 'r1' && !ed.busy")
    to_text_view(page)
    url = press_link(page)
    op = operator_page(ctx, page, url)
    op.wait_for_selector(".opv-title")
    assert op.locator(".opv-speech").count() == 2
    size0 = op.evaluate("parseFloat(getComputedStyle(document.querySelector('.opv-thesis')).fontSize)")
    op.get_by_role("button", name="Крупнее").click()
    op.get_by_role("button", name="Крупнее").click()
    assert op.evaluate("parseFloat(getComputedStyle(document.querySelector('.opv-thesis')).fontSize)") > size0 * 1.15
    op.get_by_role("button", name="Мельче").click()
    op.get_by_role("button", name="Только слайды").click()
    assert op.locator(".opv-speech").count() == 0
    assert op.locator(".opv-note").count() == 1   # заметки видны и в «Только слайды»
    assert op.locator(".opv-slide").count() == 6
    saved = json.loads(op.evaluate("localStorage.getItem('swp-op-view')"))
    assert saved["showText"] is False and abs(saved["size"] - 1.1) < 0.01
    op.reload()
    op.wait_for_selector(".opv-title")
    assert op.locator(".opv-speech").count() == 0 and abs(op.evaluate("parseFloat(getComputedStyle(document.querySelector('.opv')).getPropertyValue('--ops'))") - 1.1) < 0.01
    op.get_by_role("button", name="Всё").click()
    assert op.locator(".opv-speech").count() == 2
    ctx.close()


def test_operator_page_updates_live_after_save(browser, base_url):
    ctx, page = make(browser, base_url)
    open_sermon_edit(page)
    to_text_view(page)
    url = press_link(page)
    page.locator(".oplink .icon-btn[aria-label='Закрыть']").click()
    op = operator_page(ctx, page, url)
    op.wait_for_selector(".opv-title")
    before = op.locator(".opv-upd").inner_text()
    op.evaluate("window.scrollTo(0, 120)")
    # правим текст к слайду и название, сохраняем — страница оператора меняется сама, без перезагрузки
    page.evaluate("state.meta.title = 'Новое название'; state.blocks[2].text = 'Совсем другой тезис'; state.blocks[2].parts[0].html = 'Совсем другой тезис'; change(); saveNow();")
    page.wait_for_function("!isDirty()")
    op.wait_for_function("document.querySelector('.opv-title').textContent === 'Новое название'")
    assert "Совсем другой тезис" in op.locator(".opv").inner_text()
    assert before.startswith("Обновлено") and page.evaluate("ed.conflict") is None
    ctx.close()


def open_sermon_edit(page):
    page.evaluate("id => navigate(sermonHash(id))", "r1")
    page.wait_for_function("state && state.id === 'r1' && ed.id === 'r1' && !ed.busy")
    page.locator("#app").get_by_role("button", name="Редактировать").click()
    page.wait_for_function("ed.mode === 'edit' && !ed.busy")


def test_save_without_visible_change_does_not_rewrite_snapshot(browser, base_url):
    ctx, page = make(browser, base_url)
    open_sermon_edit(page)
    to_text_view(page)
    press_link(page)
    page.locator(".oplink .icon-btn[aria-label='Закрыть']").click()
    # подсказка редактору оператору не видна: снимок не меняется, лишней записи нет
    page.evaluate("state.blocks[4].desc = 'другая подсказка'; change(); saveNow();")
    page.wait_for_function("!isDirty()")
    assert page.evaluate("fakeCloud.calls.shareSync || 0") == 0
    page.evaluate("state.blocks[3].text = 'Новая цитата'; change(); saveNow();")
    page.wait_for_function("!isDirty()")
    page.wait_for_function("(fakeCloud.calls.shareSync || 0) === 1")
    ctx.close()


def test_create_link_in_edit_mode_flushes_changes_and_editing_goes_on(browser, base_url):
    ctx, page = make(browser, base_url)
    open_sermon_edit(page)
    page.evaluate("state.meta.title = 'Правка до ссылки'; change();")
    to_text_view(page)
    press_link(page)
    d = db(page)
    key = d["sermons"]["r1"]["shareKey"]
    assert d["sermons"]["r1"]["meta"]["title"] == "Правка до ссылки" and d["shares"][key]["sermon"]["title"] == "Правка до ссылки"
    page.locator(".oplink .icon-btn[aria-label='Закрыть']").click()
    # правка продолжается: свою же запись ключа форма конфликтом не считает, и снимок идёт за сохранением
    page.evaluate("state.meta.title = 'Правка после ссылки'; change(); saveNow();")
    page.wait_for_function("!isDirty()")
    assert page.evaluate("ed.conflict") is None and not page.locator(".sheet[aria-label='Конспект уже изменили']").count()
    page.wait_for_function("k => (fakeCloud.db().shares[k].sermon.title === 'Правка после ссылки')", arg=key)
    assert db(page)["sermons"]["r1"]["shareKey"] == key
    ctx.close()


def test_link_window_has_three_buttons_and_no_disable(browser, base_url):
    """Этап 9.2: без пояснения, без «Отключить ссылку»; ссылка остаётся, пока жив конспект"""
    ctx, page = make(browser, base_url)
    page.evaluate("id => navigate(sermonHash(id))", "r1")
    page.wait_for_function("state && state.id === 'r1' && ed.id === 'r1' && !ed.busy")
    to_text_view(page)
    url = press_link(page)
    sheet = page.locator(".oplink")
    assert [b.strip() for b in sheet.locator("button").all_inner_texts() if b.strip()] == ["Скопировать ссылку", "Скопировать", "В Telegram"]
    assert sheet.locator(".hint").count() == 0 and "Откройте её на телефоне" not in sheet.inner_text()
    assert sheet.locator(".btn.danger").count() == 0 and "Отключить" not in sheet.inner_text()
    # страница оператора открыта и работает
    op = operator_page(ctx, page, url)
    op.wait_for_selector(".opv-title")
    assert op.locator(".opv-slide").count() > 0
    ctx.close()


def test_delete_sermon_removes_link(browser, base_url):
    ctx, page = make(browser, base_url)
    page.evaluate("id => navigate(sermonHash(id))", "r1")
    page.wait_for_function("state && state.id === 'r1' && ed.id === 'r1' && !ed.busy")
    to_text_view(page)
    url = press_link(page)
    page.locator(".oplink .icon-btn[aria-label='Закрыть']").click()
    op = operator_page(ctx, page, url)
    op.wait_for_selector(".opv-title")
    page.evaluate("localStorage.setItem('fake-user', JSON.stringify({email:'admin@x.pl', name:'Админ'}))")
    page.on("dialog", lambda dlg: dlg.accept())
    page.evaluate("trashCloudSermon(state)")   # в корзину (этап 9.1): снимок уходит сразу, ключ остаётся
    page.wait_for_function("!!fakeCloud.db().sermons.r1.deletedAt")
    assert db(page)["shares"] == {}
    op.wait_for_selector(".opv-msg")
    assert "больше не работает" in op.locator(".opv-msg").inner_text()
    ctx.close()


def test_unknown_key_says_link_does_not_work(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=None, hash="#op=" + "x" * 24)
    page.wait_for_selector(".opv-msg")
    assert "Эта ссылка больше не работает" in page.locator(".opv-msg").inner_text()
    assert page.errors == []
    ctx.close()


def test_button_visibility_by_role(browser, base_url):
    mine = dict(RICH, id="m1", owner="ivan@x.pl", createdBy="ivan@x.pl")
    other = dict(RICH, id="o1", owner="admin@x.pl")
    atEd = dict(RICH, id="e1", owner="ivan@x.pl", createdBy="ivan@x.pl", status="work")
    sermons = {"m1": mine, "o1": other, "e1": atEd}

    def items(page, id):
        page.evaluate("id => navigate(sermonHash(id, 'text'))", id)
        page.wait_for_selector(".tv-doc")
        menu = page.evaluate("[...document.querySelectorAll('#menu button')].map(b => b.textContent.trim())")
        return "Ссылка для оператора" in menu, page.locator(".tv-side button:has-text('Ссылка для оператора')").count() == 1

    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons=sermons)
    wait_home(page)
    assert items(page, "m1") == (True, True)     # автор — свой конспект
    assert items(page, "o1") == (False, False)   # чужой конспект автор только читает
    assert items(page, "e1") == (False, False)   # свой, но «У редактора»
    ctx.close()
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS, sermons=sermons)
    wait_home(page)
    assert items(page, "o1") == (True, True) and items(page, "e1") == (True, True)   # редактор — любой
    ctx.close()


def test_busy_by_someone_else_gives_message_and_no_link(browser, base_url):
    ctx, page = make(browser, base_url)
    page.evaluate("""() => { const d = fakeCloud.db(); d.sermons.r1.lock = { email:'ed@x.pl', name:'Ред Акторов', at:Date.now(), beat:Date.now() + 10 * 60000 }; fakeCloud.put(d); }""")
    page.evaluate("id => navigate(sermonHash(id))", "r1")
    page.wait_for_function("state && state.id === 'r1' && ed.id === 'r1' && !ed.busy")
    to_text_view(page)
    page.locator(".tv-side button:has-text('Ссылка для оператора')").click()
    page.wait_for_selector(".toasts .toast")
    assert "Сейчас конспект правит Ред Акторов" in page.locator(".toasts").inner_text()
    assert db(page).get("shares", {}) == {} and not page.evaluate("settingsOverlay.classList.contains('open')")
    ctx.close()


LINE = "─" * 20


def test_share_text_is_same_for_copy_and_telegram(browser, base_url):
    ctx, page = make(browser, base_url)
    page.evaluate("id => navigate(sermonHash(id))", "r1")
    page.wait_for_function("state && state.id === 'r1' && ed.id === 'r1' && !ed.busy")
    to_text_view(page)
    page.evaluate("window.open = (u) => { window.__opened = u; }")
    url = press_link(page)
    date = page.evaluate("fmtDate('2026-11-15')")
    assert date == "15 ноября 2026 г."
    body = ["Конспект для оператора слайдов", "Вера и дела | Иван Петров", date]
    # кнопки: у «Скопировать» и «В Telegram» есть значки
    assert page.locator(".oplink .btn", has_text="Скопировать").locator(".ic").count() == 2 and page.locator(".oplink .btn.primary .ic").count() == 1
    # «Скопировать»: ссылка, линия, название, автор, дата — простой текст
    page.get_by_role("button", name="Скопировать", exact=True).click()
    page.wait_for_selector(".toast:has-text('Текст скопирован')")
    copied = page.evaluate("navigator.clipboard.readText()")
    assert copied == "\n".join([url, LINE] + body)
    # «В Telegram»: тот же текст, адрес Telegram ставит первой строкой сам
    page.get_by_role("button", name="В Telegram").click()
    opened = page.evaluate("window.__opened")
    from urllib.parse import parse_qs, urlparse
    q = parse_qs(urlparse(opened).query)
    assert opened.startswith("https://t.me/share/url?") and q["url"] == [url]
    assert q["url"][0] + "\n" + q["text"][0] == copied
    # «Скопировать ссылку»: только адрес
    page.get_by_role("button", name="Скопировать ссылку").click()
    assert page.evaluate("navigator.clipboard.readText()") == url
    ctx.close()


def test_share_text_without_author_and_date(browser, base_url):
    """Нет автора — только название; нет даты — строки с датой нет"""
    ctx, page = make(browser, base_url)
    page.evaluate("id => navigate(sermonHash(id))", "r1")
    page.wait_for_function("state && state.id === 'r1' && ed.id === 'r1' && !ed.busy")
    lines = lambda: page.evaluate("opShareLines('U')")
    head = ["U", LINE, "Конспект для оператора слайдов"]
    assert lines() == head + ["Вера и дела | Иван Петров", "15 ноября 2026 г."]
    page.evaluate("state.meta.firstName = ''; state.meta.lastName = ''")
    assert lines() == head + ["Вера и дела", "15 ноября 2026 г."]
    page.evaluate("state.meta.date = ''")
    assert lines() == head + ["Вера и дела"]
    page.evaluate("state.meta.title = ''")
    assert lines() == head + ["Без названия"]
    ctx.close()


def test_wake_lock_while_operator_page_is_open(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=None, shares={"k" * 24: {"spaceId": "sp1", "sermonId": "r1", "createdBy": "admin@x.pl", "updatedAt": 7000,
                           "sermon": {"v": 1, "title": "Служение", "date": "2026-11-15", "author": "Иван Петров", "total": 1, "blocks": [{"t": "thesis", "n": 1, "html": "Тезис"}]}}})
    ctx.add_init_script("""window.__wl = 0; window.__wlr = 0;
      Object.defineProperty(navigator, 'wakeLock', { configurable:true, value:{ request: async () => { window.__wl++; return { release(){ window.__wlr++; return Promise.resolve(); }, addEventListener(){} }; } } });""")
    op = ctx.new_page()
    op.errors = []
    op.on("pageerror", lambda e: op.errors.append(str(e)))
    op.goto(base_url + "/index.html#op=" + "k" * 24)
    op.wait_for_selector(".opv-title")
    op.wait_for_function("window.__wl >= 1")
    assert op.evaluate("document.title") == "Служение · для оператора"
    # ушли со страницы оператора — замок снимается
    op.evaluate("location.hash = ''")
    op.wait_for_function("window.__wlr >= 1")
    assert op.errors == []
    ctx.close()


def test_operator_page_keeps_text_when_connection_drops_and_works_without_wake_lock(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=None, hash="#op=" + "k" * 24, shares={"k" * 24: {"spaceId": "sp1", "sermonId": "r1", "createdBy": "admin@x.pl", "updatedAt": 7000,
                           "sermon": {"v": 1, "title": "Служение", "date": "", "author": "", "total": 1, "blocks": [{"t": "thesis", "n": 1, "html": "Тезис <script>alert(1)</script><b>жирный</b>"}]}}})
    page.wait_for_selector(".opv-title")
    html = page.locator(".opv-thesis").inner_html()
    assert "<script" not in html and "<b>жирный</b>" in html   # даже если в облако попало лишнее, страница его не выполнит
    page.evaluate("localStorage.setItem('fake-offline', '1')")
    assert page.locator(".opv-title").inner_text() == "Служение"
    assert page.errors == []
    ctx.close()
