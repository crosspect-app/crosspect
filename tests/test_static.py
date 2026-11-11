"""Проверки исходников: синтаксис и «сырые» невидимые символы."""
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = sorted((ROOT / "js").glob("*.js")) + [ROOT / "css" / "style.css", ROOT / "index.html"]
BAD = {" ": "U+00A0", "­": "U+00AD", " ": "U+2028", " ": "U+2029"}


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
def test_no_raw_invisible_chars(path):
    text = path.read_text(encoding="utf-8")
    found = [name for ch, name in BAD.items() if ch in text]
    assert not found, f"в {path.name} «сырые» символы {found}: писать их нужно экранированными"


@pytest.mark.skipif(shutil.which("node") is None, reason="нет node")
@pytest.mark.parametrize("path", sorted((ROOT / "js").glob("*.js")), ids=lambda p: p.name)
def test_js_syntax(path):
    r = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_index_lists_every_script_once():
    index = (ROOT / "index.html").read_text(encoding="utf-8")
    for f in (ROOT / "js").glob("*.js"):
        assert index.count(f'src="js/{f.name}?v=') == 1, f"{f.name} должен подключаться ровно один раз"
