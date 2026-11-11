"""Модель проповеди версии 2: текст к слайду, заставка, «доработать», перевод старых файлов, новые настройки слайдов."""
import json

from conftest import open_sermon, start_blank


def blocks(page):
    return page.evaluate("state.blocks.map(b => ({ type:b.type, speech:b.speech || '', todo:!!b.todo }))")


def test_old_file_migrates_text_to_slides(page, sermon):
    """Старый файл: блоки «Текст проповеди» становятся текстом к слайду или заставкой."""
    sermon["blocks"].insert(3, {"id": "t2", "type": "text", "text": "После тезиса.\nВторая строка.", "splash": False})
    sermon["blocks"].insert(5, {"id": "t3", "type": "text", "text": "История", "splash": True})
    sermon["blocks"].insert(6, {"id": "t4", "type": "text", "text": "Продолжение истории", "splash": False})
    open_sermon(page, sermon)
    bs = blocks(page)
    assert [b["type"] for b in bs] == ["splash", "scripture", "thesis", "quote", "splash", "image", "video", "free", "note"]
    assert bs[0]["speech"] == "Полный текст проповеди для проповедника."   # текст в начале — заставка
    assert bs[2]["speech"] == "После тезиса.<br>Вторая строка."            # текст после слайда — к нему
    assert bs[4]["speech"] == "История<br><br>Продолжение истории"          # «вывести заставку» — новая заставка
    assert [b["todo"] for b in bs] == [False, False, False, False, False, True, True, True, False]
    assert page.evaluate("state.v") == 2
    assert page.locator(".block.t-text").count() == 0
    assert page.errors == []


def test_old_file_meta_and_quote(page, sermon):
    sermon["meta"]["preacher"] = "Ковальчук Андрей"
    q = next(b for b in sermon["blocks"] if b["type"] == "quote")
    q["author"] = "Жан Кальвин, Наставление в христианской вере"
    open_sermon(page, sermon)
    meta = page.evaluate("state.meta")
    assert meta["firstName"] == "Андрей" and meta["lastName"] == "Ковальчук"
    assert "preacher" not in meta
    quote = page.evaluate("state.blocks.find(b => b.type === 'quote')")
    assert quote["author"] == "Жан Кальвин" and quote["caption"] == "Наставление в христианской вере"
    scr = page.evaluate("state.blocks.find(b => b.type === 'scripture')")
    assert (scr["caps"], scr["flow"], scr["frame"], scr["align"], scr["valign"]) == (True, "inline", False, "center", "top")


def test_new_file_roundtrip_keeps_model(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("""() => {
      const s = state.blocks.find(b => b.type === 'scripture');
      Object.assign(s, { flow:'lines', align:'left', valign:'bottom', caps:false, speech:'Текст <b>к слайду</b>' });
      state.blocks.find(b => b.type === 'thesis').parts[0].frame = true;
      state.blocks.find(b => b.type === 'quote').caption = 'Письма';
      Object.assign(state.meta, { firstName:'Андрей', lastName:'Ковальчук' });
    }""")
    data = page.evaluate("JSON.stringify(state)")
    page.evaluate("state = blank(); renderAll()")
    page.set_input_files("#fileInput", {"name": "x.json", "mimeType": "application/json", "buffer": data.encode("utf-8")})
    page.wait_for_function("state.blocks.length > 0")
    s = page.evaluate("state.blocks.find(b => b.type === 'scripture')")
    assert (s["flow"], s["align"], s["valign"], s["caps"], s["speech"]) == ("lines", "left", "bottom", False, "Текст <b>к слайду</b>")
    assert page.evaluate("state.blocks.find(b => b.type === 'thesis').parts[0].frame") is True
    assert page.evaluate("state.blocks.find(b => b.type === 'quote').caption") == "Письма"
    assert page.evaluate("[state.meta.firstName, state.meta.lastName]") == ["Андрей", "Ковальчук"]
    assert page.evaluate("state.blocks.filter(b => b.type === 'splash').length") == 1   # заставка не задвоилась


def test_new_blocks_get_todo_and_speech(page):
    start_blank(page)
    page.evaluate("['splash', 'scripture', 'image', 'video', 'free', 'note'].forEach((t, i) => addBlock(t, i))")
    bs = page.evaluate("state.blocks.map(b => [b.type, b.todo, b.speech])")
    assert bs == [["splash", False, ""], ["scripture", False, ""], ["image", True, ""], ["video", True, ""], ["free", True, ""], ["note", None, None]]
    assert page.locator(".film .st.todo").count() == 3
    has = []
    for i in range(6):   # «Текст к слайду» есть у каждого слайда, у заметки нет
        page.locator(".film .st").nth(i).click()
        has.append(page.locator(".stage .speech").count())
    assert has == [1, 1, 1, 1, 1, 0]
    assert page.errors == []


def test_speech_typing_counts_words(page):
    start_blank(page)
    page.evaluate("addBlock('thesis', 0)")
    box = page.locator(".stage .speech .rich")
    box.click()
    page.keyboard.type("Раз два три четыре пять")
    assert page.evaluate("plain(state.blocks[0].speech)") == "Раз два три четыре пять"
    assert "5 слов" in page.inner_text(".stage .speech .count")


def test_todo_toggle(page):
    start_blank(page)
    page.evaluate("addBlock('image', 0)")
    assert page.locator(".film .st.todo").count() == 1
    page.locator(".stage-bar .btn.todo").click()
    assert page.evaluate("state.blocks[0].todo") is False
    assert page.locator(".film .st.todo").count() == 0
    page.locator(".stage-bar .btn.todo").click()
    assert page.evaluate("state.blocks[0].todo") is True
    assert page.locator(".film .st.todo").count() == 1


def test_no_done_mark_any_more(page):
    """Этап 7: отметки «готово» у слайдов нет ни в ленте, ни на сцене, ни на карточке; старая «готово» только снимает «доработать»"""
    start_blank(page)
    page.evaluate("addBlock('thesis', 0); addBlock('thesis', 1)")
    page.locator(".film .st").first.click()
    assert not page.locator(".stage-bar .btn.ok").count()
    assert not page.locator(".film .st-ok").count()
    page.locator("a.btn.ghost").click()
    page.wait_for_selector(".scard")
    assert "Готово" not in page.inner_text(".scard") and not page.locator(".scard .prog").count()
    assert "2 слайда" in page.inner_text(".scard")
    assert not page.evaluate("state.blocks.some(b => 'done' in b)")
    # старый файл: картинка с «готово» не просит доработки, а самой отметки в модели уже нет
    r = page.evaluate("""(() => { const s = normalize({ app:'swp-sermon', v:2, id:'x', meta:{}, settings:{}, blocks:[
      { id:'a', type:'image', done:true }, { id:'b', type:'image' }, { id:'c', type:'thesis', done:true }] });
      return s.blocks.map(b => [b.todo, 'done' in b]); })()""")
    assert r == [[False, False], [True, False], [False, False]]


def test_delete_slide_keeps_its_speech(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("""() => {
      state.blocks.find(b => b.type === 'scripture').speech = 'Первый';
      state.blocks.find(b => b.type === 'thesis').speech = 'Второй';
      renderMain();
    }""")
    page.evaluate("removeBlock(state.blocks.find(b => b.type === 'thesis'))")
    assert page.evaluate("state.blocks.find(b => b.type === 'scripture').speech") == "Первый<br><br>Второй"
    assert "перенесён к слайду 2" in page.inner_text(".toast")
    page.locator(".toast button").click()   # «Вернуть»
    assert page.evaluate("state.blocks.find(b => b.type === 'scripture').speech") == "Первый"
    assert page.evaluate("state.blocks.find(b => b.type === 'thesis').speech") == "Второй"


def test_duplicate_does_not_copy_speech(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("state.blocks[1].speech = 'Текст'; duplicate(state.blocks[1])")
    assert page.evaluate("state.blocks[2].speech") == ""


def test_preacher_by_hand(page):
    page.wait_for_function("CONFIG.loadedAt > 0 || CONFIG.error !== ''", timeout=15000)   # список проповедников из настроек уже пришёл
    page.get_by_role("button", name="Новая проповедь").first.click()   # окно «О проповеди» открывается само
    page.wait_for_selector(".sheet[aria-label='О проповеди'] select")
    page.select_option(".sheet select", "__other")
    page.fill(".sheet input[aria-label='Имя']", "Андрей")
    page.fill(".sheet input[aria-label='Фамилия']", "Ковальчук")
    assert page.evaluate("[state.meta.firstName, state.meta.lastName]") == ["Андрей", "Ковальчук"]
    page.select_option(".sheet select", "Шода Евгений")
    assert page.evaluate("[state.meta.firstName, state.meta.lastName]") == ["Евгений", "Шода"]


def test_splash_slide(page):
    start_blank(page)
    page.evaluate("Object.assign(state.meta, { title:'Сила в немощи', firstName:'Андрей', lastName:'Ковальчук', date:'2026-11-15' }); addBlock('splash', 0)")
    page.wait_for_function("document.querySelector('.stage .sl-sp-title') && document.querySelector('.stage .sl-sp-title').textContent.length > 0")
    page.wait_for_timeout(300)
    sl = page.locator(".stage .sl").first
    assert sl.locator(".sl-sp-title").inner_text().upper() == "СИЛА В НЕМОЩИ" or "НЕМОЩИ" in sl.locator(".sl-sp-title").inner_text().upper()
    assert sl.locator(".sl-sp-name b").inner_text().upper() == "КОВАЛЬЧУК"
    assert sl.locator(".sl-sp-date").inner_text() == "15/11"
    px = page.evaluate("parseFloat(document.querySelector('.stage .sl-sp-title').style.fontSize)")
    assert 110 <= px <= 200
    assert page.evaluate("slideName(state.blocks[0], 1)") == "[1] заставка"


def test_splash_long_title_has_no_broken_words(page):
    start_blank(page)
    page.evaluate("state.meta.title = 'Сила Божья совершается в нашей немощи и слабости, когда мы доверяем'; addBlock('splash', 0)")
    page.wait_for_timeout(500)
    ok = page.evaluate("""() => { const t = document.querySelector('.stage .sl-sp-title'); return t.scrollWidth <= t.clientWidth + 1; }""")
    assert ok


def test_scripture_modes_in_preview(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("selectBlock(state.blocks.find(b => b.type === 'scripture').id)")
    page.evaluate("const s = state.blocks.find(b => b.type === 'scripture'); s.frame = true; rerender(s)")
    page.wait_for_selector(".stage.t-scripture .sl-verse.framed")
    page.evaluate("const s = state.blocks.find(b => b.type === 'scripture'); s.flow = 'lines'; rerender(s)")
    page.wait_for_selector(".stage.t-scripture .sl-vlist .sl-vn")
    assert page.locator(".stage.t-scripture .sl-verse.framed").count() == 0   # в режиме «с новой строки» рамки нет
    page.evaluate("const s = state.blocks.find(b => b.type === 'scripture'); s.valign = 'bottom'; rerender(s)")
    assert "translateY" in page.evaluate("document.querySelector('.stage.t-scripture .sl-content').style.transform")
    assert page.evaluate("getComputedStyle(document.querySelector('.stage.t-scripture .sl-vt')).textTransform") == "uppercase"


def test_thesis_frame_and_quote_caption_in_preview(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("""() => {
      const t = state.blocks.find(b => b.type === 'thesis'); selectBlock(t.id); t.parts[0].frame = true; rerender(t);
    }""")
    page.wait_for_selector(".stage.t-thesis .sl-part.framed")
    page.evaluate("""() => {
      const q = state.blocks.find(b => b.type === 'quote'); selectBlock(q.id); q.caption = 'Письма'; rerender(q);
    }""")
    page.wait_for_selector(".stage.t-quote .sl-author .src")
    assert page.inner_text(".stage.t-quote .sl-author .src") == "Письма"


def test_canva_font_is_default(page):
    cfg = page.evaluate("mergeSlides(SLIDES_DEFAULT, null)")
    assert cfg["font"]["canva"] == "all" and cfg["sizes"]["scripture"]["size"] == 110


def test_view_and_pdf_show_speech(page, sermon):
    open_sermon(page, sermon)
    page.evaluate("state.blocks.find(b => b.type === 'quote').speech = 'Слова после цитаты'")
    page.evaluate("setView('text')")
    page.wait_for_selector(".tv-doc")
    assert "Слова после цитаты" in page.inner_text("main")
    page.locator(".tv-side .toggle button", has_text="Только слайды").click()
    assert "Слова после цитаты" not in page.inner_text("main")
    page.evaluate("buildOperatorPrint()")
    pdf_text = page.evaluate("document.getElementById('print-op').textContent")
    assert "Слова после цитаты" in pdf_text
    assert "заставка" in pdf_text.lower()


def test_splash_jpeg(page, sermon):
    open_sermon(page, sermon)
    with page.expect_download(timeout=60000) as dl:
        page.evaluate("exportOne(state.blocks.find(b => b.type === 'splash'))")
    assert dl.value.suggested_filename == "[1] заставка.jpg"
