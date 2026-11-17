"""Этап 10.6: свои копии переводов Библии (data/bibles/) и шрифтов (fonts/, css/fonts.css) — форма не ходит на чужие адреса."""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "data" / "config.json").read_text(encoding="utf-8"))
RAW = "https://raw.githubusercontent.com/crosspect-app/crosspect/main/data/"
FOREIGN = re.compile(r"fonts\.googleapis|fonts\.gstatic|githubusercontent\.com/Beblia|jsdelivr", re.I)


def test_every_translation_has_a_local_file():
    for t in CFG["translations"]:
        name = t.get("file") or t["url"].split("/", 1)[1]
        f = ROOT / "data" / "bibles" / name
        assert f.is_file() and f.stat().st_size > 500_000, f"нет файла перевода {t['id']}: data/bibles/{name}"
        head = f.read_bytes()[:400].decode("utf-8-sig", "replace")
        assert head.lstrip().startswith("<?xml") and ("<bible" in head or "<XMLBIBLE" in head), f"{name}: это не файл Библии"


def test_no_stray_files_in_bibles_folder():
    used = {(t.get("file") or t["url"].split("/", 1)[1]) for t in CFG["translations"]}
    have = {p.name for p in (ROOT / "data" / "bibles").iterdir()}
    assert have == used, f"лишние или недостающие файлы: {sorted(have ^ used)}"


def test_bible_base_is_own_folder():
    assert CFG["bibleBase"] == "bibles/"


def test_no_foreign_addresses_in_the_form():
    for f in [ROOT / "index.html", *sorted((ROOT / "js").glob("*.js")), *sorted((ROOT / "css").glob("*.css")), ROOT / "data" / "config.json"]:
        assert not FOREIGN.search(f.read_text(encoding="utf-8")), f"в {f.name} чужой адрес шрифтов или переводов"


def test_fonts_css_files_exist_and_cover_families():
    css = (ROOT / "css" / "fonts.css").read_text(encoding="utf-8")
    for u in re.findall(r"url\(([^)]+)\)", css):
        assert (ROOT / "css" / u).resolve().is_file(), f"fonts.css ссылается на отсутствующий файл {u}"
    for fam in ("Unbounded", "Inter", "Noto Sans Hebrew"):
        assert f"font-family: '{fam}'" in css
    for sub in ("cyrillic", "latin", "hebrew"):
        assert sub in css


def test_ci_copies_fonts_folder():
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    assert re.search(r"cp -r [^\n]*\bfonts\b[^\n]*_site", ci)


def serve_local(page):
    """Файлы «репозитория» берутся с диска, всё остальное из интернета — ошибка; возвращает список запрошенных адресов."""
    seen = []
    def cfg(r):
        seen.append(r.request.url); r.fulfill(status=200, content_type="application/json", body=(ROOT / "data" / "config.json").read_bytes())
    def bib(r):
        seen.append(r.request.url); r.fulfill(status=200, content_type="text/plain", body=(ROOT / "data" / "bibles" / r.request.url.rsplit("/", 1)[1]).read_bytes())
    page.route(RAW + "config.json", cfg)
    page.route(RAW + "bibles/*", bib)
    return seen


def test_bible_loads_from_own_copy(page):
    seen = serve_local(page)
    page.evaluate("fetchConfig()")
    page.wait_for_function("CONFIG.source === 'репозиторий'")
    assert page.evaluate("BIBLE_SRC[0]") == RAW + "bibles/" and page.evaluate("BIBLE_SRC[1]") == "data/bibles/"
    for lang, expect in (("ru", "Бог"), ("des", "Бог"), ("pl", "Bóg"), ("en", "God")):
        page.evaluate("l => { delete bibles[l]; }", lang)
        assert page.evaluate("l => loadBible(l).then(d => !!d)", lang), lang
        text = page.evaluate("l => bibleData(l)[43][3][16]", lang)
        assert expect in text, (lang, text)
    assert all(u.startswith(RAW) for u in seen) and any("RussianSynodalBible" in u for u in seen)


def test_bible_falls_back_to_site_copy(page):
    page.route(RAW + "bibles/*", lambda r: r.fulfill(status=404, body="no"))
    page.route("**/data/bibles/*", lambda r: r.continue_())
    page.evaluate("delete bibles.ru")
    assert page.evaluate("loadBible('ru').then(d => !!d)")
    assert "Бог" in page.evaluate("bibleData('ru')[1][1][1]")


def test_fonts_come_from_own_files_and_embed_into_jpeg(page):
    assert page.evaluate("document.fonts.load('700 20px Unbounded', 'Привет').then(f => f.length)") > 0
    assert page.evaluate("document.fonts.load('400 16px Inter', 'Ωα').then(f => f.length)") > 0
    assert page.evaluate("document.fonts.load('400 16px \"Noto Sans Hebrew\"', 'שלום').then(f => f.length)") > 0
    reqs = page.evaluate("performance.getEntriesByType('resource').map(e => e.name)")   # страница уже открыта: шрифты могли загрузиться до проверки
    assert any("/fonts/unbounded-" in u for u in reqs)
    assert not [u for u in reqs if re.search(r"googleapis|gstatic", u) and "firebasejs" not in u]
    css = page.evaluate("exportFonts()")
    assert css.count("@font-face") >= 15 and "data:font/woff2;base64," in css
    assert not re.search(r"url\((?!data:)", css) and "font-display:block" in css and "swap" not in css
