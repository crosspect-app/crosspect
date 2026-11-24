"""Общие настройки тестов Crosspect: сервер с формой и страница с учётом ошибок."""
import functools
import http.server
import json
import pathlib
import threading

import os

import pytest
from playwright.sync_api import sync_playwright

# Этап 10.9.6: движок браузера для тестов — CROSSPECT_BROWSER=chromium (по умолчанию) | firefox | webkit
ENGINE = os.environ.get("CROSSPECT_BROWSER", "chromium")


def pytest_collection_modifyitems(config, items):
    """CROSSPECT_SHARD=i/N — только каждый N-й тест, начиная с i-го (1…N): прогоны Firefox и WebKit в CI идут частями."""
    sh = os.environ.get("CROSSPECT_SHARD")
    if not sh:
        return
    i, n = (int(x) for x in sh.split("/"))
    keep = [t for k, t in enumerate(items) if k % n == i - 1]
    config.hook.pytest_deselected(items=[t for t in items if t not in keep])
    items[:] = keep


def dl_name(d):
    """Имя скачанного файла. Playwright в WebKit заменяет пробелы на «_» (Safari так не делает) — возвращаем пробелы."""
    n = d.suggested_filename
    return n.replace("_", " ") if ENGINE == "webkit" else n


def only_chromium(why="нужен Chromium"):
    """Пропустить тест не в Chromium (CDP, права буфера обмена и т. п.)."""
    if ENGINE != "chromium":
        pytest.skip(why)

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
def _pw():
    with sync_playwright() as p:
        yield p


@pytest.fixture(scope=lambda fixture_name, config: "function" if ENGINE == "webkit" else "session")
def browser(_pw):
    """WebKit — свой браузер на каждый тест: за долгий прогон он копит память, и машину CI останавливают (этап 10.9.6)."""
    b = getattr(_pw, ENGINE).launch()
    yield b
    b.close()


@pytest.fixture
def sermon():
    return json.loads((FIXTURES / "sermon.json").read_text(encoding="utf-8"))


FAKE_CLOUD = (FIXTURES / "fake_cloud.js").read_text(encoding="utf-8")
ME = {"email": "admin@x.pl", "name": "Админ"}   # кто входит в обычной фикстуре page: админ всей формы


@pytest.fixture
def page(browser, base_url):
    """Форма после входа (облако подменено, вошёл админ), открыта главная; ошибки скриптов собираются в page.errors.
    С этапа 8 без входа форма не работает, поэтому и тесты редактора, файлов и выгрузки идут «в облаке»."""
    ctx, pg = cloud_page(browser, base_url, user=ME, members={"admin@x.pl": {"role": "editor"}})
    pg.wait_for_selector(".home-top")
    yield pg
    ctx.close()


def cloud_page(browser, base_url, *, user=None, members=None, sermons=None, settings=None, series=None, admins=("admin@x.pl",), spaces=None, no_spaces=False, reduced_motion="reduce", shares=None, hash="", **ctx_opts):
    """Страница формы с подменённым облаком. user — кто входит ({email, name}), members — {почта: {role, firstName, lastName}},
    sermons — проповеди, уже лежащие в «облаке» ({id: запись}), admins — админы всей формы (этап 8; по умолчанию admin@x.pl),
    spaces — другие пространства ({id: {space:{id,name,settings}, members, sermons}}). reduced_motion — «reduce» по умолчанию (анимации выключены), тесты движения передают «no-preference» (этап 7.6).
    Возвращает (контекст, страница)."""
    opts = dict(viewport={"width": 1280, "height": 900}, accept_downloads=True, reduced_motion=reduced_motion)
    opts.update(ctx_opts)   # этап 10.1.1: телефонный контекст (viewport, is_mobile, has_touch, device_scale_factor)
    ctx = browser.new_context(**opts)
    if ENGINE != "chromium":
        # Firefox — 15 с: зависший тест не съедает весь прогон. WebKit без видеокарты (CI) рисует стену главной
        # десятки секунд — ему 60 с, и в CI идут не все тесты, а основные пути (browsers.yml)
        ctx.set_default_timeout(60000 if ENGINE == "webkit" else 15000)
    db = {"members": members or {}, "space": {"id": "sp1", "name": "Слово веры · тест", "settings": settings or {}}, "sermons": sermons or {}, "clock": 1000,
          "admins": list(admins or []), "spaces": spaces or {}, "shares": shares or {}, "series": series or {}}
    if no_spaces:
        db["space"] = None   # в базе нет ни одного пространства
    ctx.add_init_script("if (!localStorage.getItem('fake-cloud')) localStorage.setItem('fake-cloud', %s);" % json.dumps(json.dumps(db)))
    if user:
        ctx.add_init_script("if (!localStorage.getItem('fake-user')) localStorage.setItem('fake-user', %s);" % json.dumps(json.dumps(user)))
    ctx.add_init_script(FAKE_CLOUD)
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.on("console", lambda m: pg.errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
    pg.goto(base_url + "/index.html" + hash)
    return ctx, pg


def open_sermon(page, sermon, edit=True):
    """Кладёт проповедь (в любом формате, в том числе старом v1) в подменённое облако, открывает её
    и, если edit, нажимает «Редактировать». Возвращает id."""
    id = page.evaluate("""s => {
      const db = fakeCloud.db(), id = s.id || ('t' + Date.now()), me = (JSON.parse(localStorage.getItem('fake-user') || 'null') || {}).email || '';
      db.clock += 1000;
      db.sermons[id] = Object.assign({}, s, { id, status:s.status || 'draft', owner:me, createdBy:me, createdAt:1000,
        updatedAt:Date.now() + db.clock, updatedBy:me, lock:null });
      fakeCloud.put(db);
      try { localStorage.removeItem('swp-sermon:' + id); } catch(e){}
      navigate(sermonHash(id));
      return id;
    }""", sermon)
    page.wait_for_function("id => state && state.id === id && screen === 'sermon' && ed.id === id && !ed.busy", arg=id)
    if edit:
        page.locator("#app").get_by_role("button", name="Редактировать").click()
        page.wait_for_function("ed.mode === 'edit' && !ed.busy")
    return id


def download_file(page):
    """«⋯ → Скачать файл»: возвращает скачанный файл проповеди (Playwright Download)."""
    with page.expect_download() as dl:
        page.evaluate("saveFile()")
    return dl.value


def start_blank(page):
    """Новая пустая проповедь, как по кнопке «Новая проповедь»; окно «О проповеди» закрыто без проверки обязательных полей
    (этап 10.1.3: closeSettings(true) — конспект остаётся и уходит в облако, как после «Готово»)."""
    page.evaluate("newSermon()")
    page.wait_for_selector(".sheet[aria-label='О проповеди']")
    page.evaluate("closeSettings(true)")


def cfg_tab(page, name):
    """Открыть вкладку окна «Настройки слайдов» (этап 10.5.8): «Общее», «Заставка», «Писание», «Тезис», «Цитата»."""
    page.locator(".scfg-tabs").get_by_role("button", name=name, exact=True).click()
