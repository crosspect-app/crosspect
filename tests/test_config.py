"""Этап 9.6: проверка data/config.json до выпуска. Форма читает этот файл прямо из ветки main: опечатка в JSON доходит до всех сразу,
поэтому CI разбирает файл как JSON и проверяет нужные поля (то же, что читает applyConfig в js/settings.js)."""
import copy
import json
import pathlib
import re

import pytest

CONFIG = pathlib.Path(__file__).resolve().parent.parent / "data" / "config.json"
LANG_GROUPS = {"ru", "uk", "pl", "en"}


def load_strict(text):
    """JSON без повторяющихся ключей: json.loads молча берёт последний, а в файле это почти всегда опечатка"""
    def hook(pairs):
        keys = [k for k, _ in pairs]
        dup = {k for k in keys if keys.count(k) > 1}
        if dup:
            raise ValueError("повторяется ключ: " + ", ".join(sorted(dup)))
        return dict(pairs)
    return json.loads(text, object_pairs_hook=hook)


def problems(cfg):
    """Список проблем файла настроек; пустой — файл годится"""
    out = []
    if not isinstance(cfg, dict):
        return ["файл должен быть объектом {…}"]
    for key in ("version", "bibleBase", "scriptureFooter"):
        if not isinstance(cfg.get(key), str) or not cfg[key].strip():
            out.append(f"нет строки «{key}»")
    if isinstance(cfg.get("scriptureFooter"), str) and "{name}" not in cfg["scriptureFooter"]:
        out.append("в «scriptureFooter» нет {name}: форма такую подпись не примет")
    if isinstance(cfg.get("bibleBase"), str) and not cfg["bibleBase"].startswith("https://"):
        out.append("«bibleBase» должен быть ссылкой https://…")
    groups = cfg.get("groups")
    ids = set()
    if not isinstance(groups, list) or not groups:
        out.append("нет списка «groups»")
    else:
        for g in groups:
            if not (isinstance(g, list) and len(g) == 2 and all(isinstance(x, str) and x for x in g)):
                out.append(f"в «groups» пара должна быть вида [\"ru\", \"Русский\"]: {g!r}")
            else:
                ids.add(g[0])
    tr = cfg.get("translations")
    if not isinstance(tr, list) or not tr:
        out.append("нет списка «translations»")
    else:
        seen = set()
        for i, t in enumerate(tr):
            name = t.get("id") if isinstance(t, dict) else None
            where = f"перевод №{i + 1}" + (f" ({name})" if name else "")
            if not isinstance(t, dict):
                out.append(f"{where}: должен быть объектом")
                continue
            if not isinstance(t.get("id"), str) or not t["id"].strip():
                out.append(f"{where}: нет «id»")
            elif t["id"] in seen:
                out.append(f"{where}: «id» повторяется")
            elif t["id"] == "own":
                out.append(f"{where}: «own» занят — это «Свой перевод»")
            seen.add(t.get("id"))
            if not isinstance(t.get("label"), str) or not t["label"].strip():
                out.append(f"{where}: нет «label»")
            if not (isinstance(t.get("file"), str) and t["file"].endswith(".xml")) and not isinstance(t.get("url"), str):
                out.append(f"{where}: нужен «file» (….xml) или «url»")
            if ids and t.get("group") not in ids:
                out.append(f"{where}: «group» {t.get('group')!r} нет в «groups»")
            if t.get("books") not in LANG_GROUPS:
                out.append(f"{where}: «books» должен быть одним из {sorted(LANG_GROUPS)}")
        if "ru" not in seen:
            out.append("нет перевода с id «ru»: он нужен форме как основа для «Своего перевода»")
    pr = cfg.get("preachers")
    if not isinstance(pr, list) or not pr or not all(isinstance(x, str) and x.strip() for x in pr):
        out.append("«preachers» — непустой список имён")
    elif len(set(pr)) != len(pr):
        out.append("в «preachers» есть повторы")
    return out


def test_config_json_is_valid_and_complete():
    cfg = load_strict(CONFIG.read_text(encoding="utf-8"))
    assert problems(cfg) == []


def test_config_has_no_stray_whitespace_in_names():
    cfg = load_strict(CONFIG.read_text(encoding="utf-8"))
    names = [t["label"] for t in cfg["translations"]] + cfg["preachers"]
    assert [n for n in names if n != n.strip() or re.search(r"\s{2,}", n)] == []


GOOD = load_strict(CONFIG.read_text(encoding="utf-8"))


def broken(fn):
    c = copy.deepcopy(GOOD)
    fn(c)
    return c


@pytest.mark.parametrize("change, expect", [
    (lambda c: c.pop("translations"), "translations"),
    (lambda c: c.pop("preachers"), "preachers"),
    (lambda c: c.update(scriptureFooter="· перевод"), "{name}"),
    (lambda c: c.update(bibleBase="http://x"), "bibleBase"),
    (lambda c: c["translations"].append(dict(c["translations"][0])), "повторяется"),
    (lambda c: c["translations"][1].pop("label"), "label"),
    (lambda c: c["translations"][1].pop("file"), "file"),
    (lambda c: c["translations"][1].update(group="xx"), "group"),
    (lambda c: c["translations"][1].update(books="xx"), "books"),
    (lambda c: c.update(translations=[t for t in c["translations"] if t["id"] != "ru"]), "«ru»"),
    (lambda c: c["preachers"].append(c["preachers"][0]), "повторы"),
])
def test_validator_catches_broken_config(change, expect):
    assert any(expect in p for p in problems(broken(change))), problems(broken(change))


def test_strict_loader_rejects_duplicate_keys_and_bad_json():
    with pytest.raises(ValueError):
        load_strict('{"version": "1", "version": "2"}')
    with pytest.raises(ValueError):
        load_strict('{"version": "1",}')
