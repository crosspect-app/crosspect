#!/usr/bin/env python3
"""Фото в фотобанк (этапы 10.5 и 10.5.2) — так же, как загрузка в окне «Фотобанк» формы:
  --kind cut (без фона, по умолчанию): обрезать прозрачные поля, не выше 1600 px, человек смотрит вправо;
  --kind bg (с фоном): обычное фото, не больше 2400 px по длинной стороне, не отражается.
WebP (~0,85) не больше 900 КБ и миниатюра 160 px (<id>.thumb.webp); запись в img/authors/authors.json.
Оттуда фото в базу кладёт скрипт cloud/scripts/photobank.mjs (crosspect-backup → Actions → «Фотобанк»).

Куда смотрит человек на фото без фона, решает Claude, посмотрев на него (--faces):
  right — вправо (как нужно), left — влево (развернуть), front — анфас (не трогать, на слайде не отражается).
У человека может быть несколько фото: --id — id фото, --person — id человека (по умолчанию тот же).

Пример:
  python3 tools/author_photo.py lewis.png --id lewis-cs --first Клайв --last Льюис \\
      --caption "писатель · 1898–1963" --aliases "К. С. Льюис; C. S. Lewis; Клайв Стейплз Льюис" --faces left --source "Wikimedia Commons, общественное достояние"
  python3 tools/author_photo.py lewis2.jpg --id lewis-cs-2 --person lewis-cs --kind bg --source "…"

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
HEIGHT = 1600      # без фона: не выше
SIDE = 2400        # с фоном: длинная сторона не больше
THUMB = 160
MAX = 900 * 1024   # картинка в базе (правила Firestore)


def load(path=LIST):
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding='utf-8'))
    return data if isinstance(data, list) else data.get('authors', [])


def save(items, path=LIST):
    items = sorted(items, key=lambda a: (a.get('last', '').lower(), a.get('first', '').lower(), a['id']))
    path.write_text(json.dumps(items, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def process(src, faces, kind='cut'):
    im = Image.open(src)
    if kind == 'bg':
        im = im.convert('RGB')
        k = min(1, SIDE / max(im.size))
        if k < 1:
            im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        return im
    if im.mode != 'RGBA':
        im = im.convert('RGBA')
    alpha = im.getchannel('A')
    if alpha.getextrema()[0] == 255:
        raise SystemExit('У картинки нет прозрачного фона: нужен PNG с вырезанным человеком (обычное фото — --kind bg).')
    box = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()   # почти прозрачные края тоже срезаем
    if not box:
        raise SystemExit('Картинка целиком прозрачная.')
    im = im.crop(box)
    if faces == 'left':
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    if im.height > HEIGHT:
        im = im.resize((max(1, round(im.width * HEIGHT / im.height)), HEIGHT), Image.LANCZOS)
    return im


def save_webp(im, path):
    """WebP не больше MAX: сначала качество, потом размер (как в форме)."""
    for _ in range(8):
        for q in (85, 75, 65):
            im.save(path, 'WEBP', quality=q, method=6)
            if path.stat().st_size <= MAX:
                return im
        im = im.resize((max(1, round(im.width * .85)), max(1, round(im.height * .85))), Image.LANCZOS)
    raise SystemExit('Фото не получилось сжать до 900 КБ.')


def save_thumb(im, path):
    t = im.copy()
    t.thumbnail((THUMB, THUMB), Image.LANCZOS)
    t.save(path, 'WEBP', quality=80, method=6)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('src', help='прозрачный PNG')
    ap.add_argument('--id', required=True, help='латиница, цифры и дефис: lewis-cs')
    ap.add_argument('--first', default='', help='имя, как на слайде (обычным)')
    ap.add_argument('--last', default='', help='фамилия, как на слайде (жирным)')
    ap.add_argument('--caption', default='', help='подпись: описание и годы через « · », «писатель · 1898–1963»')
    ap.add_argument('--aliases', default='', help='другие написания через «;»')
    ap.add_argument('--person', default='', help='id человека, если у него уже есть фото (по умолчанию — как --id)')
    ap.add_argument('--kind', default='cut', choices=['cut', 'bg'], help='cut — без фона (по умолчанию), bg — с фоном')
    ap.add_argument('--faces', choices=['right', 'left', 'front'], help='без фона: куда смотрит человек на исходной картинке')
    ap.add_argument('--source', default='', help='откуда фото')
    ap.add_argument('--bank', default=str(BANK), help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    if not re.fullmatch(r'[a-z0-9-]{1,60}', a.id):
        raise SystemExit('--id: только строчная латиница, цифры и дефис.')
    person = a.person or a.id
    if not re.fullmatch(r'[a-z0-9-]{1,60}', person):
        raise SystemExit('--person: только строчная латиница, цифры и дефис.')
    if a.kind == 'cut' and not a.faces:
        raise SystemExit('Для фото без фона нужен --faces (right, left или front).')
    bank = Path(a.bank)
    bank.mkdir(parents=True, exist_ok=True)
    lst = bank / 'authors.json'
    items = load(lst)
    same = [x for x in items if x.get('person', x['id']) == person and x['id'] != a.id]
    names = {k: getattr(a, k).strip() for k in ('first', 'last', 'caption')}
    names['aliases'] = [s.strip() for s in a.aliases.split(';') if s.strip()]
    if same and not (names['first'] or names['last']):   # ещё одно фото того же человека: описание — как у прежних
        names = {k: same[0].get(k, [] if k == 'aliases' else '') for k in ('first', 'last', 'caption', 'aliases')}
    if not (names['first'] or names['last']):
        raise SystemExit('Нужно имя или фамилия.')
    im = process(a.src, a.faces, a.kind)
    file, thumb = a.id + '.webp', a.id + '.thumb.webp'
    im = save_webp(im, bank / file)
    save_thumb(im, bank / thumb)
    old = next((x for x in items if x['id'] == a.id), None)
    entry = dict(id=a.id, person=person, **names, kind=a.kind, file=file, thumb=thumb, w=im.width, h=im.height)
    if a.kind == 'cut':
        entry['faces'] = 'front' if a.faces == 'front' else 'right'
    entry['source'] = a.source.strip()
    entry['added'] = old['added'] if old and old.get('added') else datetime.date.today().isoformat()
    items = [x for x in items if x['id'] != a.id] + [entry]
    for x in items:   # описание человека общее у всех его фото
        if x.get('person', x['id']) == person:
            x.update(names)
    save(items, lst)
    kb = (bank / file).stat().st_size // 1024
    look = ('с фоном' if a.kind == 'bg' else 'развёрнуто вправо' if a.faces == 'left' else 'анфас' if a.faces == 'front' else 'смотрит вправо')
    print(f'{a.id} ({person}): {names["first"]} {names["last"]} — {im.width}×{im.height}, {kb} КБ, {look}')


if __name__ == '__main__':
    sys.exit(main())
