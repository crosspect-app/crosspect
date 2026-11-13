"""Бюджет документов: STATUS.md и CLAUDE.md короткие, ссылки из них ведут в существующие файлы."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
COLD = ["PLAN.md", "FEATURES.md", "HISTORY.md", "CHECKS.md", "DECISIONS.md", "FIREBASE.md", "DESIGN.md"]


def test_status_within_budget():
    assert (ROOT / "STATUS.md").stat().st_size <= 12_000, "STATUS.md больше 12 000 байт: перенести подробности в docs/"


def test_claude_md_within_budget():
    assert (ROOT / "CLAUDE.md").stat().st_size <= 6_000, "CLAUDE.md больше 6 000 байт"


def test_cold_docs_exist():
    for name in COLD:
        assert (ROOT / "docs" / name).is_file(), f"нет docs/{name}"


def test_status_links_resolve():
    text = (ROOT / "STATUS.md").read_text(encoding="utf-8")
    for link in re.findall(r"\]\(([^)#\s]+)\)", text):
        assert (ROOT / link).exists(), f"STATUS.md ведёт на несуществующий {link}"
