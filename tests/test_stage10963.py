"""Этап 10.9.6.3 (25 ноября 2026): карточка картинки как у фото цитаты (расширенные настройки свёрнуты), тень ползунком от 0 и над обводкой,
цвет обводки отдельно от толщины, плашка «выше / ниже / удалить», блоки в настройках цитаты."""
from test_stage1091 import put_image, open_img
from test_stage1092 import two_pics, layers

def one_pic(page, sermon):
    put_image(page, "fixture-0001", "p63", 800, 600, "#dc1e1e")
    open_img(page, sermon, todo=False, layers=[{"kind": "pic", "id": "a", "imageId": "p63", "imgW": 800, "imgH": 600, "place": {"x": 0.5, "y": 0.5, "w": 0.3}}])
    page.wait_for_function("document.querySelectorAll('.stage .sl-pic img[src]').length === 1")
    page.locator(".stage .pic-hit").click()

def set_range(page, sel, v):
    page.evaluate("([s, v]) => { const r = document.querySelector(s); r.value = v; r.dispatchEvent(new Event('input', { bubbles:true })); }", [sel, v])

def card(page): return ".side .ly-card.on "


def test_picture_card_like_quote_photo(page, sermon):
    """Этап 10.9.6.5: вместо «Заменить» и «Расширенных настроек» — вкладки «Фильтр», «Кадр», «Обводка», «Тень»; открыта одна."""
    one_pic(page, sermon)
    c = card(page)
    assert page.locator(c + ".pic-replace").count() == 0 and page.locator(c + "details.ph-adv").count() == 0
    assert page.locator(c + ".pic-rot, " + c + ".pic-cover, " + c + ".pic-fit").count() == 0
    assert page.locator(c + ".pic-tab").all_text_contents() == ["Фильтр", "Кадр", "Обводка", "Тень"]
    for tab, sels in (("filter", (".pic-flt",)), ("frame", (".pic-crop", ".pic-flip", ".pic-flipv", ".pic-rd")), ("out", (".pic-ow", ".ph-sw")), ("shadow", (".sh-range",))):
        page.locator(c + f".pic-tab[data-tab='{tab}']").click()
        assert page.locator(c + ".pic-pane:not([hidden])").count() == 1
        for s_ in sels:
            assert page.locator(c + s_).first.is_visible(), s_
    page.evaluate("picPanelRefresh('i1')")
    assert page.locator(card(page) + ".pic-tab.on").get_attribute("data-tab") == "shadow"   # открытая вкладка помнится
    assert not page.errors, page.errors


def test_outline_color_independent_of_width(page, sermon):
    one_pic(page, sermon)
    page.locator(card(page) + ".pic-tab[data-tab='out']").click()
    page.locator(card(page) + ".ph-sw[title='#d94b4b']").click()
    o = (layers(page)[0].get("pic") or {}).get("outline")
    assert o == {"w": 0, "color": "#d94b4b"}   # цвет выбран — толщина осталась 0
    set_range(page, card(page) + ".pic-ow", 9)
    assert layers(page)[0]["pic"]["outline"] == {"w": 9, "color": "#d94b4b"}
    set_range(page, card(page) + ".pic-ow", 0)
    set_range(page, card(page) + ".pic-ow", 5)
    assert layers(page)[0]["pic"]["outline"] == {"w": 5, "color": "#d94b4b"}   # не сбрасывается на белый
    page.locator(card(page) + ".ph-sw[title='#4b8bd9']").click()
    assert layers(page)[0]["pic"]["outline"] == {"w": 5, "color": "#4b8bd9"}   # цвет не трогает толщину
    assert page.evaluate("normalize({ app:'swp-sermon', v:2, meta:{}, blocks:[{ id:'a', type:'image', mode:'upload', layers:[{ kind:'pic', id:'x', imageId:'q', imgW:10, imgH:10, pic:{ outline:{ w:0, color:'#d94b4b' } } }] }] }).blocks[0].layers[0].pic") == {"outline": {"w": 0, "color": "#d94b4b"}}
    assert not page.errors, page.errors


def test_layer_tools_plate(page, sermon):
    two_pics(page, sermon)
    t = page.locator(".side .ly-card[data-l='b'] .ly-tools")
    assert t.count() == 1 and t.locator("button").count() == 3 and t.locator("svg").count() == 3
    assert [t.locator("button").nth(i).get_attribute("aria-label") for i in range(3)] == ["Выше", "Ниже", "Удалить"]
    t.locator(".ly-del").click()
    assert [l["id"] for l in layers(page)] == ["a"]
    assert not page.errors, page.errors


def test_quote_settings_in_groups(page, sermon):
    from test_stage1053 import open_quote
    open_quote(page, sermon, photo={"id": "lewis-cs"})
    heads = page.evaluate("[...document.querySelectorAll('.side .grp > .grp-head')].map(e => e.textContent)")
    assert heads == ["Текст", "Расположение", "Автор", "Фото"]
    assert page.locator(".side .grp-photo .ph-panel").count() == 1 and page.locator(".side .grp-author .au-wrap").count() == 1
    # тень у фото цитаты — ползунок от 0, над обводкой
    from test_stage105 import select_photo
    select_photo(page)
    page.locator(".side .ph-adv summary").click()
    assert page.locator(".side .ph-adv .sh-on").count() == 0
    order = page.evaluate("[...document.querySelectorAll('.side .ph-adv-body .ph-row .ph-lbl')].map(e => e.textContent)")
    assert order.index("Тень") < order.index("Обводка")
    assert not page.errors, page.errors


def test_filter_grid_thumbnails(page, sermon):
    """Этап 10.9.6.5: 9 фильтров сеткой 3×3, миниатюры — сама картинка с фильтром; щелчок выбирает фильтр."""
    one_pic(page, sermon)
    c = card(page)
    page.locator(c + ".pic-tab[data-tab='filter']").click()
    assert page.locator(c + ".pic-flt").count() == 9
    page.wait_for_function("[...document.querySelectorAll('.side .ly-card.on .pic-flt-img')].every(e => e.style.backgroundImage.startsWith('url(\"data:image/png'))")
    assert page.locator(c + ".pic-flt.on").get_attribute("data-f") == "none"
    page.locator(c + ".pic-flt[data-f='sepia']").click()
    assert layers(page)[0]["pic"]["filter"] == "sepia"
    assert page.locator(c + ".pic-flt.on").get_attribute("data-f") == "sepia"
    page.locator(c + ".pic-flt[data-f='none']").click()
    assert "filter" not in (layers(page)[0].get("pic") or {})
    assert not page.errors, page.errors
