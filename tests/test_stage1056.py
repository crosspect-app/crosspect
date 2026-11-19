"""Этап 10.5.6: размер текста у блока «Текст» на слайде Писания.
Строка «Писание: текст» в настройках слайдов (kinds.scrText), кнопки «− 100 % +» в шапке блока (it.scale),
границы из настроек, старые конспекты и настройки — как раньше, у каждого блока свой размер, JPEG совпадает с редактором."""
from conftest import cloud_page
from test_cloud import MEMBERS, rec
from test_lock import open_sermon, start_edit
from test_ui71 import ED, MEMBERS_ED

SCR = {"kind": "scripture", "manual": True, "ref": "Иакова 2:17", "translation": "Синодальный перевод",
       "verses": [{"num": "17", "text": "Так и вера, если не имеет дел, мертва сама по себе."}]}


def text_item(html="hypónoia", **kw):
    return dict({"kind": "text", "html": html, "align": "center", "caps": False}, **kw)


def sermon_with(items):
    r = rec("s1", "Вера")
    r["blocks"] = [{"id": "b1", "type": "scripture", "name": "Иак", "nameAuto": False, "items": items, "speech": ""}]
    return r


def opened(browser, base_url, items, slides=None):
    """Конспект с одним слайдом Писания; slides — настройки слайдов поверх умолчаний (как после «Применить»)"""
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED, sermons={"s1": sermon_with(items)})
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    start_edit(page)
    page.evaluate("selectBlock('b1')")
    page.wait_for_selector(".side .item-head")
    if slides:
        page.evaluate("s => { setSlidesBase(s); rerender(state.blocks[0]); }", slides)
    return ctx, page


def steppers(page):
    return page.locator(".side .item-head .step")


def em(page, i=0):
    """Размер блока «Текст» относительно стихов на большом слайде"""
    return page.evaluate("""i => { const s = document.querySelectorAll('.stage .sl-text')[i], v = document.querySelector('.stage .sl-verse');
      return parseFloat(getComputedStyle(s).fontSize) / parseFloat(getComputedStyle(v).fontSize); }""", i)


# ---------- Модель и настройки ----------

def test_norm_item_scale(page):
    r = page.evaluate("""() => [normItem({ kind:'text', html:'а' }).scale, normItem({ kind:'text', html:'а', scale:'abc' }).scale,
      normItem({ kind:'text', html:'а', scale:-5 }).scale, normItem({ kind:'text', html:'а', scale:85.4 }).scale, newTextItem().scale]""")
    assert r == [100, 100, 100, 85, 100]


def test_default_settings_like_verses(page):
    k = page.evaluate("SLIDES_BASE.kinds")
    assert k["scrText"] == {"size": 52.8, "min": 70, "max": 130, "track": -0.04, "lead": 1.05}
    assert k["scrText"]["size"] == k["scripture"]["size"]


def test_old_settings_from_cloud_get_default(browser, base_url):
    # в облаке настройки без scrText (сохранены до этапа 10.5.6): берётся умолчание
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED)
    page.wait_for_selector(".home-top")
    page.evaluate("setSlidesBase({ kinds:{ scripture:{ size:52.8, min:80 } } })")
    assert page.evaluate("SLIDES_BASE.kinds.scrText.max") == 130
    assert not page.errors, page.errors
    ctx.close()


def test_settings_row_writes_kinds_and_changes_slide(browser, base_url):
    ctx, page = opened(browser, base_url, [SCR, text_item()])
    page.evaluate("openSlidesCfg()")
    page.wait_for_selector(".scfg [aria-label='Писание: текст: размер 100%']")
    labels = page.evaluate("[...document.querySelectorAll('.scfg-kinds .kl')].map(x => x.textContent)")
    assert labels.index("Писание: текст") == labels.index("Место Писания") + 1
    for lbl, v in (("размер 100%", "40"), ("уменьшение до", "60"), ("увеличение до", "150"), ("между символами", "0.1"), ("между строками", "1.4")):
        page.locator(".scfg [aria-label='Писание: текст: %s']" % lbl).fill(v)
    assert page.evaluate("SLIDES_BASE.kinds.scrText.max") == 130   # до «Применить» ничего не меняется
    page.get_by_role("button", name="Применить").click()
    page.wait_for_function("fakeCloud.calls.slides === 1")
    c = page.evaluate("fakeCloud.db().slides.kinds.scrText")
    assert c == {"size": 40, "min": 60, "max": 150, "track": 0.1, "lead": 1.4}
    assert page.evaluate("slidesCfg().kinds.scrText.size") == 40
    page.keyboard.press("Escape")
    page.wait_for_function("Math.abs(parseFloat(getComputedStyle(document.querySelector('.stage .sl-text')).fontSize) / parseFloat(getComputedStyle(document.querySelector('.stage .sl-verse')).fontSize) - 40 / 52.8) < 0.01")
    # слайд: блок «Текст» уменьшился в 40 / 52,8 раза, расстояния — свои, у стихов прежние
    assert abs(em(page) - 40 / 52.8) < 0.01
    assert page.evaluate("getComputedStyle(document.querySelector('.stage .sl-text')).letterSpacing") != page.evaluate("getComputedStyle(document.querySelector('.stage .sl-verse')).letterSpacing")
    assert page.evaluate("getComputedStyle(document.querySelector('.stage .sl-stage')).getPropertyValue('--sc-lead').trim()") == "1.05"
    assert not page.errors, page.errors
    ctx.close()


# ---------- Кнопки в конспекте ----------

def test_buttons_write_model_and_resize(browser, base_url):
    ctx, page = opened(browser, base_url, [SCR, text_item()])
    assert steppers(page).count() == 1 and steppers(page).first.inner_text().replace("\n", "").strip() == "−100%+"
    assert abs(em(page) - 1) < 0.01   # по умолчанию как стихи
    plus, minus = steppers(page).first.locator("button").nth(1), steppers(page).first.locator("button").nth(0)
    plus.click(); plus.click(); plus.click()
    assert page.evaluate("state.blocks[0].items[1].scale") == 103
    assert abs(em(page) - 1.03) < 0.01
    minus.click(); minus.click(); minus.click(); minus.click(); minus.click()
    assert page.evaluate("state.blocks[0].items[1].scale") == 98
    assert abs(em(page) - 0.98) < 0.01
    # стихи и название места Писания не изменились
    assert page.evaluate("getComputedStyle(document.querySelector('.stage .sl-verse')).fontSize") == page.evaluate("getComputedStyle(document.querySelector('.stage .sl-content')).fontSize")
    assert not page.errors, page.errors
    ctx.close()


def test_buttons_stop_at_settings_range(browser, base_url):
    ctx, page = opened(browser, base_url, [SCR, text_item(scale=99)], slides={"kinds": {"scrText": {"min": 98, "max": 101}}})
    st = steppers(page).first
    minus, plus = st.locator("button").nth(0), st.locator("button").nth(1)
    minus.click()
    assert page.evaluate("state.blocks[0].items[1].scale") == 98 and minus.is_disabled() and not plus.is_disabled()
    plus.click(); plus.click(); plus.click()
    assert page.evaluate("state.blocks[0].items[1].scale") == 101 and plus.is_disabled() and not minus.is_disabled()
    assert not page.errors, page.errors
    ctx.close()


def test_value_beyond_range_is_clamped_on_show(browser, base_url):
    # в конспекте 200 %, в настройках потолок 130 %: показывается и рисуется 130 %
    ctx, page = opened(browser, base_url, [SCR, text_item(scale=200)])
    assert steppers(page).first.inner_text().replace("\n", "").strip() == "−130%+"
    assert abs(em(page) - 1.3) < 0.01
    ctx.close()


def test_each_text_block_has_its_own_size(browser, base_url):
    ctx, page = opened(browser, base_url, [SCR, text_item("первый", scale=80), text_item("второй", scale=120)])
    assert steppers(page).count() == 2
    assert abs(em(page, 0) - 0.8) < 0.01 and abs(em(page, 1) - 1.2) < 0.01
    steppers(page).nth(0).locator("button").nth(1).click()
    assert page.evaluate("state.blocks[0].items.slice(1).map(i => i.scale)") == [81, 120]
    assert abs(em(page, 1) - 1.2) < 0.01
    ctx.close()


def test_old_outline_looks_as_before(browser, base_url):
    # у блока «Текст» нет размера (конспект до 10.5.6) → 100 %, слайд такой же, как был
    ctx, page = opened(browser, base_url, [SCR, text_item()])
    assert page.evaluate("state.blocks[0].items[1].scale") == 100
    assert steppers(page).first.inner_text().replace("\n", "").strip() == "−100%+"
    assert abs(em(page) - 1) < 0.01
    assert page.evaluate("getComputedStyle(document.querySelector('.stage .sl-text')).letterSpacing") == page.evaluate("getComputedStyle(document.querySelector('.stage .sl-verse')).letterSpacing")
    ctx.close()


def test_new_text_block_has_stepper_and_saves_scale(browser, base_url):
    ctx, page = opened(browser, base_url, [SCR])
    assert steppers(page).count() == 0
    page.evaluate("addItem(state.blocks[0], newTextItem())")
    page.wait_for_selector(".side .item-head .step")
    steppers(page).first.locator("button").nth(1).click()
    assert page.evaluate("state.blocks[0].items[1].scale") == 101
    ctx.close()


def test_thesis_stepper_still_works(page):
    from conftest import start_blank
    start_blank(page)
    page.evaluate("addBlock('thesis', 0)")
    page.wait_for_selector(".side .step")
    page.locator(".side .step button").nth(1).click()
    assert page.evaluate("state.blocks[0].parts[0].scale") == 101


# ---------- JPEG ----------

BRIGHT = """async (scale) => {
  const b = state.blocks[0]; b.items[1].scale = scale;
  const blob = await renderJPEG(b), url = URL.createObjectURL(blob), im = new Image(); im.src = url; await im.decode();
  const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
  const d = x.getImageData(0, 0, 1920, 1080).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) n++;
  return n;
}"""


def test_jpeg_matches_editor(browser, base_url):
    ctx, page = opened(browser, base_url, [SCR, text_item("МНОГО ТЕКСТА ДЛЯ ПРОВЕРКИ РАЗМЕРА")])
    small, mid, big = (page.evaluate(BRIGHT, v) for v in (70, 100, 130))
    assert small < mid < big   # JPEG берёт тот же размер блока, что и редактор
    ctx.close()
