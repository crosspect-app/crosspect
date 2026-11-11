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


def test_open_json_file(page, sermon):
    open_sermon(page, sermon)
    assert page.evaluate("state.blocks.length") == len(sermon["blocks"])
    assert page.evaluate("state.meta.title") == sermon["meta"]["title"]
    assert page.locator(".block").count() == len(sermon["blocks"])
    assert page.errors == []


def test_open_old_html_file(page, sermon):
    """Файл, сохранённый старой формой: HTML, в котором проповедь лежит в <script id=sermon-data>."""
    data = json.dumps(sermon, ensure_ascii=False).replace("<", "\\u003c")
    old = ('<!DOCTYPE html>\n<html><head><title>Проповедь</title></head><body><div id="app"></div>'
           f'<script id="sermon-data" type="application/json">{data}</script><script>/* форма */</script></body></html>')
    page.set_input_files("#fileInput", {"name": "2026-11-15 Тест формы.html", "mimeType": "text/html",
                                        "buffer": old.encode("utf-8")})
    page.wait_for_function("state.blocks.length > 0")
    assert page.evaluate("state.meta.title") == sermon["meta"]["title"]
    assert page.errors == []


def test_file_without_sermon_is_rejected(page):
    page.set_input_files("#fileInput", {"name": "x.json", "mimeType": "application/json", "buffer": b'{"a":1}'})
    page.wait_for_selector(".toast.show")
    assert "нет проповеди" in page.inner_text(".toast")
    assert page.evaluate("state.blocks.length") == 0


def test_save_writes_json_and_reopens(page, sermon):
    open_sermon(page, sermon)
    with page.expect_download() as dl:
        page.get_by_role("button", name="Сохранить").click()
    d = dl.value
    assert d.suggested_filename == "2026-11-15 Тест формы.json"
    saved = json.loads(open(d.path(), encoding="utf-8").read())
    assert saved["app"] == "swp-sermon"
    assert [b["type"] for b in saved["blocks"]] == page.evaluate("state.blocks.map(b => b.type)")
    assert saved["v"] == 2
    assert saved["savedAt"] > 0
    # сохранённый файл открывается заново и даёт ту же проповедь
    page.evaluate("state = blank(); renderAll()")
    page.set_input_files("#fileInput", {"name": d.suggested_filename, "mimeType": "application/json",
                                        "buffer": open(d.path(), "rb").read()})
    page.wait_for_function("state.blocks.length > 0")
    assert page.evaluate("state.blocks.length") == len(sermon["blocks"])
    assert page.errors == []


def test_ctrl_s_saves(page, sermon):
    open_sermon(page, sermon)
    with page.expect_download() as dl:
        page.keyboard.press("Control+s")
    assert dl.value.suggested_filename.endswith(".json")


def test_draft_survives_reload(page, sermon, base_url):
    open_sermon(page, sermon)
    page.goto(base_url + "/index.html")
    page.wait_for_selector(".topbar")
    assert page.evaluate("state.blocks.length") == len(sermon["blocks"])


def test_view_mode(page, sermon):
    open_sermon(page, sermon)
    page.get_by_role("button", name="Просмотр").click()
    page.wait_for_function("mode === 'view'")
    body = page.inner_text("main").lower()
    assert "включить свет в зале" in body      # заметка оператору
    assert "иоанна 3:16" in body               # место Писания
    assert page.locator("main .block").count() == 0 or page.locator("main .block .namebox input").count() == 0   # редактора нет
    assert page.errors == []


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
        page.evaluate("exportMany(false)")
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
