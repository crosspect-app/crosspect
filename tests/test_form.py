"""Проверки формы: запуск, файлы, просмотр, выгрузка JPEG / ZIP, PDF для оператора."""
import io
import json
import re
import struct
import zipfile

from conftest import open_sermon


def jpeg_size(data):
    """Размер JPEG из заголовка кадра (SOF)."""
    assert data[:2] == b"\xff\xd8", "это не JPEG"
    i = 2
    while i < len(data):
        assert data[i] == 0xFF
        marker = data[i + 1]
        length = struct.unpack(">H", data[i + 2:i + 4])[0]
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return w, h
        i += 2 + length
    raise AssertionError("в JPEG нет заголовка кадра")


def test_page_loads_without_errors(page):
    page.wait_for_timeout(1500)   # дать фоновой загрузке настроек отработать
    assert page.errors == []
    assert page.locator(".topbar").count() == 1


def test_open_sermon_from_cloud(page, sermon):
    """Проповедь в старом формате (v1), лежащая в облаке, открывается и переводится на новую модель."""
    open_sermon(page, sermon)
    assert page.evaluate("state.meta.title") == sermon["meta"]["title"]
    assert page.evaluate("state.v") == 2
    assert page.locator(".film .st").count() == page.evaluate("state.blocks.filter(b => TYPES[b.type].slide || b.type === 'note').length")
    assert page.errors == []


def test_no_file_opening_and_no_local_mode(page):
    """Этап 8: файл в форме не открыть, работы без входа нет."""
    assert page.locator("#fileInput").count() == 0
    assert page.evaluate("typeof parseSermonFile") == "undefined"
    assert page.evaluate("typeof localMode") == "undefined"
    page.locator(".topbar .icon-btn[aria-label='Ещё']").click()
    menu = page.inner_text("#menu")
    assert "Открыть файл" not in menu and "Войти в облако" not in menu
    assert page.locator("text=Продолжить без входа").count() == 0


def test_download_file_is_a_copy(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("state.meta.title = 'Тест формы'; change()")
    page.locator(".topbar .icon-btn[aria-label='Ещё']").click()
    with page.expect_download() as dl:
        page.locator("#menu button", has_text="Скачать файл").click()
    d = dl.value
    assert d.suggested_filename == "2026-11-15 Тест формы.json"
    saved = json.loads(open(d.path(), encoding="utf-8").read())
    assert saved["app"] == "swp-sermon"
    assert saved["v"] == 2
    assert [b["type"] for b in saved["blocks"]] == page.evaluate("state.blocks.map(b => b.type)")
    assert not any(k.startswith("cloud") for k in saved), "метки облака в файл не идут"
    # файл — копия: несохранённая правка по-прежнему ждёт отправки в облако
    assert page.evaluate("isDirty()")
    page.keyboard.press("Control+s")
    page.wait_for_function("fakeCloud.db().sermons[state.id].meta.title === 'Тест формы'")
    assert page.errors == []


def test_ctrl_s_saves_to_cloud(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("state.meta.title = 'Сразу'; change()")
    page.keyboard.press("Control+s")
    page.wait_for_function("fakeCloud.db().sermons[state.id].meta.title === 'Сразу'", timeout=5000)


def test_draft_survives_reload(page, sermon, base_url):
    open_sermon(page, sermon)
    page.goto(base_url + "/index.html")
    page.wait_for_selector(".topbar")
    assert page.evaluate("state.blocks.length") == len(sermon["blocks"])


def test_text_view(page, sermon):
    open_sermon(page, sermon)
    page.locator(".seg button", has_text="Текст").click()
    page.wait_for_function("view === 'text'")
    assert page.evaluate("location.hash").endswith("v=text")
    body = page.inner_text("main").lower()
    assert "включить свет в зале" in body      # заметка оператору
    assert "иоанна 3:16" in body               # место Писания
    assert page.locator(".film").count() == 0   # в «Тексте» ленты слайдов нет
    assert page.evaluate("document.body.classList.contains('light')")   # «Текст» светлый
    page.locator(".seg button", has_text="Слайды").click()
    page.wait_for_function("view === 'slides'")
    assert not page.evaluate("document.body.classList.contains('light')")
    assert page.errors == []


def test_home_lists_saved_sermons_and_opens_them(page, sermon, base_url):
    open_sermon(page, sermon)
    page.locator("a.btn.ghost").click()
    page.wait_for_function("screen === 'home'")
    assert page.locator(".scard").count() == 1
    assert sermon["meta"]["title"] in page.inner_text(".scard")
    page.locator(".search input").fill("такого-нет")
    assert page.locator(".scard").count() == 0
    page.locator(".search input").fill("форм")
    assert page.locator(".scard").count() == 1
    page.locator(".scard").click()
    page.wait_for_function("screen === 'sermon'")
    assert page.evaluate("state.blocks.length") == len(sermon["blocks"])
    assert page.errors == []


def test_back_button_returns_to_home_and_reload_keeps_sermon(page, sermon, base_url):
    open_sermon(page, sermon)
    page.go_back()
    page.wait_for_function("screen === 'home'")
    page.go_forward()
    page.wait_for_function("screen === 'sermon'")
    page.reload()
    page.wait_for_selector(".film .st")
    assert page.evaluate("state.blocks.length") == len(sermon["blocks"])


def test_new_sermon_from_home(page):
    page.get_by_role("button", name="Новый конспект").first.click()
    page.wait_for_function("screen === 'sermon'")
    assert page.locator(".sheet[aria-label='О проповеди']").count() == 1   # сразу спрашиваем название, проповедника и дату
    page.evaluate("closeSettings()")
    assert page.evaluate("state.blocks.length") == 0


def test_slide_selection_and_stepper(page, sermon):
    open_sermon(page, sermon)
    ids = page.evaluate("state.blocks.map(b => b.id)")
    assert page.evaluate("selId") == ids[0]
    page.locator(".film .st").nth(2).click()
    assert page.evaluate("selId") == ids[2]
    assert page.locator(".film .st.on").count() == 1
    page.get_by_role("button", name="Следующий слайд").click()
    assert page.evaluate("selId") == ids[3]
    page.get_by_role("button", name="Предыдущий слайд").click()
    assert page.evaluate("selId") == ids[2]


def test_export_single_jpeg(page, sermon):
    open_sermon(page, sermon)
    with page.expect_download(timeout=60000) as dl:
        page.evaluate("exportOne(state.blocks.find(b => b.type === 'quote'))")
    d = dl.value
    assert d.suggested_filename.endswith(".jpg") and "цитата" in d.suggested_filename
    assert jpeg_size(open(d.path(), "rb").read()) == (1920, 1080)


def test_export_all_slides_zip(page, sermon):
    open_sermon(page, sermon)
    with page.expect_download(timeout=120000) as dl:
        page.evaluate("exportMany()")
    d = dl.value
    assert d.suggested_filename == "2026-11-15 Тест формы.zip"
    z = zipfile.ZipFile(io.BytesIO(open(d.path(), "rb").read()))
    jpgs = [n for n in z.namelist() if n.endswith(".jpg")]
    assert len(jpgs) == 4   # заставка (из текста в начале старого файла), Писание, тезис, цитата; картинка, видео и свободный не собираются
    for n in jpgs:
        assert n.startswith("2026-11-15 Тест формы/")
        assert jpeg_size(z.read(n)) == (1920, 1080)


def test_operator_pdf(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("buildOperatorPrint(); document.body.classList.add('op-print')")
    page.emulate_media(media="print")
    pdf = page.pdf(prefer_css_page_size=True)
    assert pdf[:4] == b"%PDF"
    box = re.search(rb"/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)", pdf)
    assert box, "в PDF нет размера страницы"
    assert abs(float(box.group(1)) / 72 * 25.4 - 80) < 1, "страница должна быть шириной 80 мм"
