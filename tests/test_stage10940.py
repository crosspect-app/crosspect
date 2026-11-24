"""Этап 10.9.4: жёлтое выделение текста Писания (и его снятие) — обычная правка для отмены и возврата: стрелка сразу,
один шаг за раз, отмена другой правки выделение не трогает."""
from conftest import start_blank


def scripture_page(page):
    start_blank(page)
    page.evaluate("""() => {
      const b = newBlock('scripture'), it = b.items[0];
      Object.assign(it, { lang:'ru', book:32, chapter:4, sel:[3, 4],
        verses:[{ num:'3', text:'Первый стих', orig:'Первый стих' }, { num:'4', text:'Второй стих', orig:'Второй стих' }] });
      it.ref = refString(it); it.translation = 'Синодальный';
      state.blocks = [b, newBlock('thesis')]; change(); renderAll(); selectBlock(b.id);
    }""")
    page.wait_for_selector(".rich.vtext")   # перевод Библии грузится из data/bibles/, поля стихов появляются после него
    page.evaluate("histReset()")


def mark_first_word(page, n=0):
    """Двойной щелчок по первому слову стиха n и «Выделить цветом» (кнопка не забирает фокус у поля)."""
    page.locator(".rich.vtext").nth(n).dblclick()
    page.evaluate("""n => { const s = getSelection(); if (s.toString().trim()) return;   // Firefox в Playwright: двойной щелчок не выделяет слово
      const el = document.querySelectorAll('.rich.vtext')[n], t = el.firstChild, m = /\\S+/.exec(t.data), r = document.createRange();
      r.setStart(t, m.index); r.setEnd(t, m.index + m[0].length); s.removeAllRanges(); s.addRange(r); }""", n)
    page.get_by_role("button", name="Выделить цветом").first.click()


def verse(page, n):
    return page.evaluate("n => state.blocks[0].items[0].verses[n].text", n)


def marked(page, n=0):
    return "<mark>" in verse(page, n)


def type_at_end(page, n, text):
    page.locator(".rich.vtext").nth(n).click()
    page.keyboard.press("Control+End")   # в конец поля, а не строки: строки переносятся по-разному
    page.keyboard.type(text)


def undo_btn(page):
    return page.locator(".hist-undo")


def test_mark_shows_undo_arrow_and_undo_redo_by_one_step(page):
    scripture_page(page)
    assert undo_btn(page).is_disabled()
    mark_first_word(page)
    assert marked(page) and undo_btn(page).is_enabled()   # стрелка появилась сразу
    undo_btn(page).click()
    assert not marked(page) and undo_btn(page).is_disabled()
    page.locator(".hist-redo").click()
    assert marked(page)
    assert not page.errors, page.errors


def test_undo_of_other_edit_keeps_mark(page):
    scripture_page(page)
    mark_first_word(page)
    type_at_end(page, 1, " Аминь")   # другое поле: другая правка
    assert "Аминь" in verse(page, 1)
    undo_btn(page).click()
    assert "Аминь" not in verse(page, 1) and marked(page)   # выделение осталось
    undo_btn(page).click()
    assert not marked(page)
    assert not page.errors, page.errors


def test_typing_in_same_field_right_after_mark_is_a_separate_step(page):
    scripture_page(page)
    mark_first_word(page)
    type_at_end(page, 0, " Аминь")   # то же поле, меньше полутора секунд после выделения
    assert marked(page) and "Аминь" in verse(page, 0)
    undo_btn(page).click()
    assert marked(page) and "Аминь" not in verse(page, 0)
    undo_btn(page).click()
    assert not marked(page)
    assert not page.errors, page.errors


def test_mark_right_after_typing_in_same_field_is_a_separate_step(page):
    scripture_page(page)
    type_at_end(page, 0, " Аминь")
    mark_first_word(page)   # сразу после набора в том же поле
    undo_btn(page).click()
    assert not marked(page) and "Аминь" in verse(page, 0)
    undo_btn(page).click()
    assert "Аминь" not in verse(page, 0)
    assert not page.errors, page.errors


def test_removing_mark_is_a_step_too(page):
    scripture_page(page)
    mark_first_word(page)
    type_at_end(page, 1, " Аминь")
    page.evaluate("""() => {   // выделить выделенное слово в первом стихе
      const el = document.querySelectorAll('.rich.vtext')[0]; el.focus();
      const r = document.createRange(); r.selectNodeContents(el.querySelector('mark')); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }""")
    page.get_by_role("button", name="Выделить цветом").first.click()   # снять
    assert not marked(page)
    undo_btn(page).click()
    assert marked(page) and "Аминь" in verse(page, 1)   # вернулось выделение, остальное на месте
    undo_btn(page).click()
    assert marked(page) and "Аминь" not in verse(page, 1)
    undo_btn(page).click()
    assert not marked(page)
    assert not page.errors, page.errors


def test_ctrl_z_in_field_undoes_mark_not_earlier_typing(page):
    scripture_page(page)
    type_at_end(page, 0, " Аминь")
    page.wait_for_timeout(1700)   # набор — отдельный шаг
    mark_first_word(page)
    page.keyboard.press("Control+z")
    assert not marked(page) and "Аминь" in verse(page, 0)   # снялось выделение, набор на месте
    page.keyboard.press("Control+y")
    assert marked(page) and "Аминь" in verse(page, 0)
    assert not page.errors, page.errors
