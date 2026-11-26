"""Этап 10.5.2: фотобанк в облаке — у человека несколько фото «без фона» и «с фоном», порядок, вид по умолчанию у каждого фото;
загрузка в окне «Фотобанк» (обрезка полей, уменьшение, WebP, отражение «влево»); окно «Из фотобанка» и «Сменить фото» у цитаты;
«с фоном» не отражается; старые photo.id работают (перенос скриптом, до переноса — фото из репозитория); кеш картинок в браузере."""
import base64
import io
import json
from test_stage105 import select_photo
from pathlib import Path

from PIL import Image

from conftest import open_sermon, cloud_page
from test_stage105 import person_png, quote_sermon, q, sugg, bank_db

ROOT = Path(__file__).resolve().parent.parent

# Льюис: два фото — первое без фона, второе с фоном (с видом по умолчанию); тен Бум — одно; Иванов — без фото
BANK = [
    {"id": "lewis-cs", "person": "lewis-cs", "first": "Клайв", "last": "Льюис", "caption": "писатель · 1898–1963", "aliases": ["C. S. Lewis"], "w": 200, "h": 550, "faces": "right", "order": 0},
    {"id": "lewis-bg", "person": "lewis-cs", "first": "Клайв", "last": "Льюис", "caption": "писатель · 1898–1963", "aliases": ["C. S. Lewis"], "w": 300, "h": 200, "kind": "bg", "order": 1},
    {"id": "ten-boom", "first": "Корри", "last": "тен Бум", "caption": "автор «Убежища»", "aliases": [], "w": 200, "h": 550, "faces": "right"},
]
BG_PRESET = {"x": 0.25, "y": 0.9, "h": 0.6, "side": "left", "filter": "sepia", "mirror": True}


def put_bank(page, bank=BANK, extra_people=None, presets=None):
    people, photos, files = bank_db(bank)
    people.update(extra_people if extra_people is not None else {"ivanov": {"first": "Иван", "last": "Иванов", "caption": "", "aliases": []}})
    for k, v in (presets if presets is not None else {"lewis-bg": BG_PRESET}).items():
        photos[k]["preset"] = v
    page.evaluate("""([p, f, x]) => { const db = fakeCloud.db(); db.bankPeople = p; db.bankPhotos = f; db.bankFiles = x; fakeCloud.put(db); }""", [people, photos, files])


def open_q(page, sermon, **qq):
    put_bank(page)
    open_sermon(page, quote_sermon(sermon, **qq))
    page.evaluate("selectBlock('q1')")
    page.wait_for_selector(".stage.t-quote .sl")
    page.evaluate("loadPhotoBank()")
    page.wait_for_function("photoBank.loaded && photoBank.list.length === 3")


# ---------- Несколько фото у человека ----------

def test_person_has_photos_in_order_and_hint_puts_first(page, sermon):
    open_q(page, sermon)
    r = page.evaluate("bankPerson('lewis-cs').photos.map(p => [p.id, p.kind, p.faces, !!p.preset, p.last])")
    assert r == [["lewis-cs", "cut", "right", False, "Льюис"], ["lewis-bg", "bg", None, True, "Льюис"]]
    assert page.evaluate("photoBank.list.map(p => p.last)") == ["Иванов", "Льюис", "тен Бум"]   # по алфавиту фамилии
    page.locator(".side input[placeholder='тен Бум']").fill("льюис")
    sugg(page).first.click()
    b = q(page)
    assert b["photo"]["id"] == "lewis-cs" and b["first"] == "Клайв" and b["caption"] == "писатель · 1898–1963"
    # человек без фото: имя ставится, фото у цитаты нет
    page.locator(".side input[placeholder='тен Бум']").fill("иванов")
    sugg(page).first.click()
    b = q(page)
    assert b["last"] == "Иванов" and b["photo"] is None
    assert not page.errors, page.errors


# ---------- «Из фотобанка» ----------

def test_from_bank_button_search_pick_and_undo(page, sermon):
    open_q(page, sermon, first="Пётр", last="Петров", caption="своя подпись")
    btn = page.locator(".side .au-bank")
    assert btn.inner_text() == "Из фотобанка" and page.locator(".side .ph-panel").count() == 0   # есть и без фото
    btn.click()
    sh = page.locator(".pk-sheet")
    sh.wait_for()
    assert sh.locator(".pk-person").count() == 3
    assert sh.locator(".pk-person").first.locator(".pk-name").inner_text() == "Иван Иванов"
    assert "2 фото" in sh.locator(".pk-person", has_text="Льюис").inner_text()
    sh.locator(".pk-q").fill("lewis")   # другие написания
    assert sh.locator(".pk-person").count() == 1
    sh.locator(".pk-person").click()
    assert sh.locator(".pk-photo").count() == 2
    assert [t.inner_text() for t in sh.locator(".pk-kind").all()] == ["без фона", "с фоном"]
    sh.locator(".pk-photo").nth(1).click()   # с фоном, у него вид по умолчанию
    assert not page.locator(".pk-sheet").is_visible()
    b = q(page)
    assert (b["first"], b["last"], b["caption"]) == ("Клайв", "Льюис", "писатель · 1898–1963")
    assert b["photo"] == {"id": "lewis-bg", "x": 0.25, "y": 0.9, "h": 0.6, "filter": "sepia", "mirror": True}
    page.evaluate("undo()")
    b = q(page)
    assert (b["first"], b["last"], b["caption"], b["photo"]) == ("Пётр", "Петров", "своя подпись", None)
    assert not page.errors, page.errors


def test_change_photo_opens_on_current_person(page, sermon):
    open_q(page, sermon, photo={"id": "lewis-cs"}, first="Клайв", last="Льюис")
    page.wait_for_selector(".side .ph-panel .ph-change")
    page.locator(".side .ph-panel .ph-change").click()
    sh = page.locator(".pk-sheet")
    sh.wait_for()
    assert sh.locator(".pk-who .pk-name").inner_text() == "Клайв Льюис"
    assert sh.locator(".pk-photo").count() == 2 and "on" in sh.locator(".pk-photo").first.get_attribute("class")
    sh.locator(".pk-back").click()
    assert sh.locator(".pk-person").count() == 3
    page.evaluate("closeSettings()")
    assert not page.errors, page.errors


def test_picker_full_screen_on_phone(browser, base_url, sermon):
    ctx, pg = cloud_page(browser, base_url, user={"email": "admin@x.pl", "name": "А"}, members={"admin@x.pl": {"role": "editor"}},
                         viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True)
    try:
        pg.wait_for_selector(".home-top")
        put_bank(pg)
        open_sermon(pg, quote_sermon(sermon))
        pg.evaluate("openPhotoPick(state.blocks.find(b => b.id === 'q1'), false)")
        pg.wait_for_selector(".pk-sheet .pk-person")
        box = pg.locator(".pk-sheet").bounding_box()
        assert box["width"] == 390 and box["height"] >= 790
    finally:
        ctx.close()


# ---------- «С фоном» не отражается ----------

def test_bg_photo_not_mirrored(page, sermon):
    open_q(page, sermon, photo={"id": "lewis-bg"}, half="right")
    select_photo(page)
    page.wait_for_selector(".side .ph-panel .ph-reset")
    assert page.locator(".side .ph-panel", has_text="Не отражать").count() == 0
    assert "с фоном" in page.inner_text(".side .ph-panel .ph-cur")
    page.locator(".side .q-place[data-v='left']").click()
    assert page.evaluate("photoBox(state.blocks.find(b => b.id === 'q1')).flip") is False
    page.evaluate("state.blocks.find(b => b.id === 'q1').photo.id = 'lewis-cs'")
    assert page.evaluate("photoBox(state.blocks.find(b => b.id === 'q1')).flip") is True   # без фона — отражается, как раньше
    assert not page.errors, page.errors


# ---------- Вид по умолчанию — у фото ----------

def test_preset_is_per_photo(page, sermon):
    open_q(page, sermon, photo={"id": "lewis-cs", "x": 0.3, "y": 1, "h": 0.8, "filter": "bw"}, half="right")
    select_photo(page)
    page.locator(".ph-panel button", has_text="Сделать видом по умолчанию").click()
    page.wait_for_function("!!fakeCloud.db().bankPhotos['lewis-cs'].preset")
    db = page.evaluate("fakeCloud.db().bankPhotos")
    assert db["lewis-cs"]["preset"]["filter"] == "bw" and db["lewis-bg"]["preset"] == BG_PRESET   # у второго фото — свой
    # «Сбросить» — у всех, по виду своего фото
    page.evaluate("Object.assign(state.blocks.find(b => b.id === 'q1').photo, { id:'lewis-bg', x:0.6 })")
    page.evaluate("rerender(state.blocks.find(b => b.id === 'q1'))")
    select_photo(page)
    page.locator(".ph-panel button", has_text="Сбросить").click()
    assert q(page)["photo"]["x"] == 0.25 and q(page)["photo"]["filter"] == "sepia"
    assert not page.errors, page.errors


# ---------- Старые фото ----------

def test_old_photo_ids_keep_working(page, sermon):
    old = [{"id": "calvin", "first": "Жан", "last": "Кальвин", "w": 200, "h": 550, "faces": "right"}]
    put_bank(page, old, extra_people={}, presets={})
    open_sermon(page, quote_sermon(sermon, photo={"id": "calvin", "x": 0.3}, half="right"))
    page.evaluate("loadPhotoBank()")
    page.wait_for_function("!!document.querySelector('.stage .sl-photo img[src]')")
    assert page.evaluate("bankEntry('calvin').legacy") is None
    assert not page.errors, page.errors


def test_before_migration_repo_photos_shown_read_only(page, sermon):
    open_sermon(page, quote_sermon(sermon, photo={"id": "calvin"}, half="right"))   # база пуста: фото этапа 10.5 из img/authors
    page.evaluate("loadPhotoBank()")
    page.wait_for_function("photoBank.loaded && !!bankEntry('calvin')")
    assert page.evaluate("bankEntry('calvin').legacy && bankLegacy()") is True
    page.wait_for_function("!!document.querySelector('.stage .sl-photo img[src]')")
    select_photo(page)
    page.wait_for_selector(".side .ph-panel .ph-reset")
    assert page.locator(".ph-panel", has_text="Сделать видом по умолчанию").count() == 0
    page.evaluate("closeSettings(true); openPhotoBank()")
    sh = page.locator(".pb-sheet")
    sh.wait_for()
    sh.locator(".pb-legacy").wait_for()
    assert sh.locator(".pb-new").is_disabled() and sh.locator(".pb-ph-add").count() == 0 and sh.locator(".pb-save").count() == 0
    assert not page.errors, page.errors


def test_images_cached_in_browser(page, sermon):
    open_q(page, sermon, photo={"id": "lewis-cs"}, half="right")
    page.wait_for_function("!!document.querySelector('.stage .sl-photo img[src]')")
    assert page.evaluate("fakeCloud.calls.bankFile") == 1
    page.reload()
    page.wait_for_function("screen === 'sermon' && state && state.id")
    page.evaluate("selectBlock('q1')")
    page.wait_for_function("!!document.querySelector('.stage .sl-photo img[src]')")
    assert page.evaluate("fakeCloud.calls.bankFile || 0") == 0   # из IndexedDB, база не трогалась
    assert not page.errors, page.errors


# ---------- Окно «Фотобанк»: загрузка, порядок, удаление ----------

def open_bank(page):
    page.evaluate("closeSettings(true); openPhotoBank()")
    sh = page.locator(".pb-sheet")
    sh.wait_for()
    page.wait_for_function("photoBank.loaded")
    return sh


def stored_image(page, id):
    """Картинка фото из «базы»: размеры и цвет пикселя слева посередине."""
    return page.evaluate("""async id => { const b64 = fakeCloud.db().bankFiles[id], im = new Image(); im.src = 'data:image/webp;base64,' + b64; await im.decode();
      const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
      return { w:c.width, h:c.height, left:[...x.getImageData(5, Math.floor(c.height / 2), 1, 1).data], bytes:atob(b64).length,
        webp:atob(b64).slice(8, 12) === 'WEBP', thumb:fakeCloud.db().bankPhotos[id].thumb.length }; }""", id)


def test_upload_cut_trims_shrinks_and_flips_left(page, sermon, tmp_path):
    open_q(page, sermon)
    sh = open_bank(page)
    card = sh.locator(".pb-card[data-person='ten-boom']")
    card.locator(".pb-ph-add").click()
    add = card.locator(".pb-add")
    add.locator(".toggle button", has_text="Влево").click()
    add.locator("input[placeholder^='Откуда фото']").fill("Wikimedia Commons")
    big = Image.open(io.BytesIO(person_png())).resize((900, 1800), Image.NEAREST)   # человек 600×1650 после обрезки
    f = tmp_path / "corrie.png"; big.save(f)
    add.locator(".pb-file").set_input_files(str(f))
    add.locator(".pb-prev").wait_for()
    add.locator(".pb-upload").click()
    page.wait_for_function("Object.values(fakeCloud.db().bankPhotos).filter(p => p.person === 'ten-boom').length === 2")
    photos = page.evaluate("fakeCloud.db().bankPhotos")
    new_id, meta = next((k, v) for k, v in photos.items() if v["person"] == "ten-boom" and k != "ten-boom")
    assert meta["kind"] == "cut" and meta["faces"] == "right" and meta["order"] == 1 and meta["source"] == "Wikimedia Commons"
    assert meta["h"] == 1600 and abs(meta["w"] - round(600 * 1600 / 1650)) <= 2   # поля обрезаны, уменьшено до 1600
    img = stored_image(page, new_id)
    assert img["webp"] and (img["w"], img["h"]) == (meta["w"], meta["h"]) and img["bytes"] <= 900 * 1024
    assert img["left"][2] > 180 and img["left"][0] < 80   # смотрел влево: отражено, слева теперь синее
    page.wait_for_function("bankPerson('ten-boom').photos.length === 2")
    assert card.locator(".pb-ph").count() == 3   # два фото и «Добавить фото»
    assert not page.errors, page.errors


def test_upload_bg_shrinks_long_side_and_cut_needs_transparency(page, sermon, tmp_path):
    open_q(page, sermon)
    sh = open_bank(page)
    card = sh.locator(".pb-card[data-person='ivanov']")
    card.locator(".pb-ph-add").click()
    add = card.locator(".pb-add")
    jpg = tmp_path / "x.jpg"; Image.new("RGB", (3000, 2000), (120, 160, 200)).save(jpg, quality=90)
    add.locator(".pb-file").set_input_files(str(jpg))   # тип «Без фона», а фона не вырезали
    add.locator(".sp-err").wait_for()
    assert "нет прозрачного фона" in add.locator(".sp-err").inner_text() and add.locator(".pb-upload").is_disabled()
    add.locator(".toggle button", has_text="С фоном").click()   # тот же файл обрабатывается заново
    assert add.locator(".toggle button", has_text="Анфас").count() == 0   # «куда смотрит» у «с фоном» не нужно
    add.locator(".pb-prev").wait_for()
    add.locator(".pb-upload").click()
    page.wait_for_function("Object.values(fakeCloud.db().bankPhotos).some(p => p.person === 'ivanov')")
    id, meta = page.evaluate("Object.entries(fakeCloud.db().bankPhotos).find(([k, p]) => p.person === 'ivanov')")
    assert meta["kind"] == "bg" and "faces" not in meta and (meta["w"], meta["h"]) == (2400, 1600) and meta["order"] == 0
    img = stored_image(page, id)
    assert img["webp"] and img["w"] == 2400 and 0 < img["thumb"] < 40000
    assert not page.errors, page.errors


def test_order_delete_and_add_person(page, sermon):
    open_q(page, sermon, photo={"id": "lewis-cs"}, first="Клайв", last="Льюис", half="right")
    sh = open_bank(page)
    card = sh.locator(".pb-card[data-person='lewis-cs']")
    assert [t.inner_text() for t in card.locator(".pb-ph-kind").all()] == ["без фона", "с фоном"]
    assert card.locator(".pb-ph-preset").count() == 1
    card.locator(".pb-ph").nth(1).get_by_role("button", name="Раньше").click()
    page.wait_for_function("bankPerson('lewis-cs').photos[0].id === 'lewis-bg'")
    db = page.evaluate("fakeCloud.db().bankPhotos")
    assert (db["lewis-bg"]["order"], db["lewis-cs"]["order"]) == (0, 1)
    # удалить фото, которое стоит в конспекте: там оно больше не рисуется, имя остаётся
    page.once("dialog", lambda d: d.accept())
    card.locator(".pb-ph").nth(1).get_by_role("button", name="Удалить фото").click()
    page.wait_for_function("!fakeCloud.db().bankPhotos['lewis-cs'] && !fakeCloud.db().bankFiles['lewis-cs']")
    page.wait_for_function("!bankEntry('lewis-cs')")
    assert page.evaluate("photoBox(state.blocks.find(b => b.id === 'q1'))") is None and q(page)["last"] == "Льюис"
    # новый человек: сохранить → сразу «Добавить фото»
    sh.locator(".pb-new").click()
    fresh = sh.locator(".pb-fresh")
    fresh.locator("input[placeholder='Фамилия']").fill("Пайпер")
    fresh.locator("input[placeholder='Имя']").fill("Джон")
    fresh.locator(".pb-save").click()
    page.wait_for_function("Object.values(fakeCloud.db().bankPeople).some(p => p.last === 'Пайпер')")
    sh.locator(".pb-card", has_text="").locator(".pb-add").wait_for()
    # удалить человека вместе с фото
    page.once("dialog", lambda d: d.accept())
    sh.locator(".pb-card[data-person='ten-boom'] .pb-del").click()
    page.wait_for_function("!fakeCloud.db().bankPeople['ten-boom'] && !fakeCloud.db().bankPhotos['ten-boom'] && !fakeCloud.db().bankFiles['ten-boom']")
    assert not page.errors, page.errors


def test_bank_window_only_admin_but_picker_for_editor(browser, base_url, sermon):
    ctx, pg = cloud_page(browser, base_url, user={"email": "ed@x.pl", "name": "Ред"}, members={"ed@x.pl": {"role": "editor"}}, admins=())
    try:
        pg.wait_for_selector(".home-top")
        open_q(pg, sermon)
        pg.evaluate("openPhotoBank()")
        assert pg.locator(".pb-sheet").count() == 0
        pg.locator(".side .au-bank").click()
        pg.locator(".pk-person", has_text="тен Бум").click()
        pg.locator(".pk-photo").first.click()
        assert q(pg)["photo"]["id"] == "ten-boom"
        for call in ["cloud.api.setBankPerson(cloud.user, 'x', { first:'X' })", "cloud.api.removeBank(cloud.user, ['ten-boom'], null)",
                     "cloud.api.setBankPhotos(cloud.user, { 'ten-boom':{ order:3 } })"]:
            assert pg.evaluate("c => eval(c).then(() => 'ok', e => e.code)", call) == "permission-denied"
        assert not pg.errors, pg.errors
    finally:
        ctx.close()


def test_view_mode_cannot_open_picker(page, sermon):
    put_bank(page)
    open_sermon(page, quote_sermon(sermon), edit=False)
    page.evaluate("selectBlock('q1')")
    btn = page.locator(".side .au-bank")
    if btn.count():
        assert btn.is_disabled()
    page.evaluate("openPhotoPick(state.blocks.find(b => b.id === 'q1'), false)")
    assert not page.locator(".pk-sheet").is_visible()
    assert not page.errors, page.errors


# ---------- Скрипт и правила ----------

def test_repo_bank_ready_for_migration():
    lst = json.loads((ROOT / "img" / "authors" / "authors.json").read_text(encoding="utf-8"))
    assert {a["id"] for a in lst} >= {"calvin", "luther"}   # id фото = старый id: конспекты не теряют фото
    for a in lst:
        assert a["person"] and (ROOT / "img" / "authors" / a["thumb"]).stat().st_size <= 40960
        assert (ROOT / "img" / "authors" / a["file"]).stat().st_size <= 900 * 1024
    js = (ROOT / "cloud" / "scripts" / "photobank.mjs").read_text(encoding="utf-8")
    assert "bankFiles" in js and "authors" in js
    wf = (ROOT / "cloud" / "private-repo" / ".github" / "workflows" / "photobank.yml").read_text(encoding="utf-8")
    assert "photobank.mjs" in wf and "FIREBASE_SERVICE_ACCOUNT" in wf


def test_rules_cover_bank():
    rules = (ROOT / "cloud" / "firestore.rules").read_text(encoding="utf-8")
    for x in ["match /bankPeople/{id}", "match /bankPhotos/{id}", "match /bankFiles/{id}", "img.size() <= 921600", "thumb.size() <= 40960"]:
        assert x in rules, x
    tests = (ROOT / "cloud" / "tests" / "rules.test.mjs").read_text(encoding="utf-8")
    assert "фотобанк: люди и фото (этап 10.5.2)" in tests


def test_tool_makes_bg_and_second_photo(tmp_path):
    import subprocess, sys
    bank = tmp_path / "bank"
    png = tmp_path / "a.png"; png.write_bytes(person_png())
    jpg = tmp_path / "b.jpg"; Image.new("RGB", (3600, 1800), (10, 20, 30)).save(jpg)
    run = lambda *a: subprocess.run([sys.executable, str(ROOT / "tools" / "author_photo.py"), *a, "--bank", str(bank)], capture_output=True, text=True)
    r = run(str(png), "--id", "lewis-cs", "--first", "Клайв", "--last", "Льюис", "--faces", "right"); assert r.returncode == 0, r.stderr
    r = run(str(jpg), "--id", "lewis-cs-2", "--person", "lewis-cs", "--kind", "bg", "--source", "x"); assert r.returncode == 0, r.stderr
    lst = json.loads((bank / "authors.json").read_text(encoding="utf-8"))
    b = next(a for a in lst if a["id"] == "lewis-cs-2")
    assert b["person"] == "lewis-cs" and b["kind"] == "bg" and "faces" not in b and (b["w"], b["h"]) == (2400, 1200) and b["last"] == "Льюис"
    assert Image.open(bank / "lewis-cs-2.thumb.webp").size == (160, 80)
    r = run(str(png), "--id", "x", "--last", "Икс"); assert r.returncode != 0 and "--faces" in r.stderr
