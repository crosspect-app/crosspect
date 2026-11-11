"""Общие настройки тестов Crosspect: сервер с формой и страница с учётом ошибок."""
import functools
import http.server
import json
import pathlib
import threading

import pytest
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURES = pathlib.Path(__file__).resolve().parent / "fixtures"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture(scope="session")
def base_url():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


@pytest.fixture
def sermon():
    return json.loads((FIXTURES / "sermon.json").read_text(encoding="utf-8"))


@pytest.fixture
def page(browser, base_url):
    """Чистая страница формы; ошибки скриптов собираются в page.errors."""
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.on("console", lambda m: pg.errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
    pg.goto(base_url + "/index.html")
    pg.wait_for_selector(".topbar")
    yield pg
    ctx.close()


def open_sermon(page, sermon):
    """Открывает проповедь так же, как это делает человек: «Открыть» → файл."""
    page.set_input_files("#fileInput", {
        "name": "sermon.json",
        "mimeType": "application/json",
        "buffer": json.dumps(sermon, ensure_ascii=False).encode("utf-8"),
    })
    page.wait_for_function("state.blocks.length > 0")


def start_blank(page):
    """Новая пустая проповедь, как по кнопке «Новая проповедь»; окно «О проповеди» закрыто."""
    page.evaluate("newSermon()")
    page.wait_for_selector(".sheet[aria-label='О проповеди']")
    page.evaluate("closeSettings()")
