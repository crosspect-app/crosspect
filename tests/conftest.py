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


def cloud_page(browser, base_url, *, user=None, members=None, sermons=None, settings=None, admins=("admin@x.pl",), spaces=None, no_spaces=False, reduced_motion="reduce", shares=None, hash=""):
    """Страница формы с подменённым облаком. user — кто входит ({email, name}), members — {почта: {role, firstName, lastName}},
    sermons — проповеди, уже лежащие в «облаке» ({id: запись}), admins — админы всей формы (этап 8; по умолчанию admin@x.pl),
    spaces — другие пространства ({id: {space:{id,name,settings}, members, sermons}}). reduced_motion — «reduce» по умолчанию (анимации выключены), тесты движения передают «no-preference» (этап 7.6).
    Возвращает (контекст, страница)."""
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True, reduced_motion=reduced_motion)
    db = {"members": members or {}, "space": {"id": "sp1", "name": "Слово веры · тест", "settings": settings or {}}, "sermons": sermons or {}, "clock": 1000,
          "admins": list(admins or []), "spaces": spaces or {}, "shares": shares or {}}
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
    """Новая пустая проповедь, как по кнопке «Новая проповедь»; окно «О проповеди» закрыто."""
    page.evaluate("newSermon()")
    page.wait_for_selector(".sheet[aria-label='О проповеди']")
    page.evaluate("closeSettings()")
