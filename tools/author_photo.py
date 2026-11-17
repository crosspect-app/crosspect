#!/usr/bin/env python3
"""Фото автора цитаты в фотобанк (этап 10.5): обрезать прозрачные поля, высота 1600 px, WebP с прозрачностью,
человек смотрит вправо; запись в img/authors/authors.json.

Куда смотрит человек на исходной картинке, решает Claude, посмотрев на неё (--faces):
  right — вправо (как нужно), left — влево (развернуть), front — анфас (не трогать, на слайде не отражается).

Пример:
  python3 tools/author_photo.py lewis.png --id lewis-cs --first Клайв --last Льюис \\
      --aliases "К. С. Льюис; C. S. Lewis; Клайв Стейплз Льюис" --faces left --source "Wikimedia Commons, общественное достояние"

Повторный запуск с тем же --id заменяет фото и запись (дата добавления остаётся прежней).
"""
import argparse
import datetime
import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BANK = ROOT / 'img' / 'authors'
LIST = BANK / 'authors.json'
HEIGHT = 1600


def load(path=LIST):
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding='utf-8'))
    return data if isinstance(data, list) else data.get('authors', [])


def save(items, path=LIST):
    items = sorted(items, key=lambda a: (a.get('last', '').lower(), a.get('first', '').lower(), a['id']))
    path.write_text(json.dumps(items, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def process(src, faces):
    im = Image.open(src)
    if im.mode != 'RGBA':
        im = im.convert('RGBA')
    alpha = im.getchannel('A')
    if alpha.getextrema()[0] == 255:
        raise SystemExit('У картинки нет прозрачного фона: нужен PNG с вырезанным человеком.')
    box = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()   # почти прозрачные края тоже срезаем
    if not box:
        raise SystemExit('Картинка целиком прозрачная.')
    im = im.crop(box)
    if faces == 'left':
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    if im.height != HEIGHT:
        im = im.resize((max(1, round(im.width * HEIGHT / im.height)), HEIGHT), Image.LANCZOS)
    return im


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('src', help='прозрачный PNG')
    ap.add_argument('--id', required=True, help='латиница, цифры и дефис: lewis-cs')
    ap.add_argument('--first', default='', help='имя, как на слайде (обычным)')
    ap.add_argument('--last', default='', help='фамилия, как на слайде (жирным)')
    ap.add_argument('--aliases', default='', help='другие написания через «;»')
    ap.add_argument('--faces', required=True, choices=['right', 'left', 'front'], help='куда смотрит человек на исходной картинке')
    ap.add_argument('--source', default='', help='откуда фото')
    ap.add_argument('--bank', default=str(BANK), help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    if not re.fullmatch(r'[a-z0-9-]{1,60}', a.id):
        raise SystemExit('--id: только строчная латиница, цифры и дефис.')
    if not (a.first.strip() or a.last.strip()):
        raise SystemExit('Нужно имя или фамилия.')
    bank = Path(a.bank)
    bank.mkdir(parents=True, exist_ok=True)
    lst = bank / 'authors.json'
    im = process(a.src, a.faces)
    file = a.id + '.webp'
    im.save(bank / file, 'WEBP', quality=90, method=6)
    items = load(lst)
    old = next((x for x in items if x['id'] == a.id), None)
    entry = {
        'id': a.id, 'first': a.first.strip(), 'last': a.last.strip(),
        'aliases': [s.strip() for s in a.aliases.split(';') if s.strip()],
        'file': file, 'w': im.width, 'h': im.height,
        'faces': 'front' if a.faces == 'front' else 'right',
        'source': a.source.strip(),
        'added': old['added'] if old and old.get('added') else datetime.date.today().isoformat(),
    }
    items = [x for x in items if x['id'] != a.id] + [entry]
    save(items, lst)
    kb = (bank / file).stat().st_size // 1024
    print(f'{a.id}: {entry["first"]} {entry["last"]} — {im.width}×{im.height}, {kb} КБ, '
          f'{"развёрнуто вправо" if a.faces == "left" else "анфас" if a.faces == "front" else "смотрит вправо"}')


if __name__ == '__main__':
    sys.exit(main())
