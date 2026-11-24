from test_stage10940 import scripture_page


def test_diag_mark(page):
    scripture_page(page)
    page.locator(".rich.vtext").nth(0).dblclick()
    print("\nDIAG1", page.evaluate("""() => { const a = document.activeElement, s = getSelection(), r = s.rangeCount && s.getRangeAt(0);
      return { a: a && (a.tagName + '.' + a.className), sel: s.toString(), n: s.rangeCount, anc: r && (r.commonAncestorContainer.nodeName + '/' + (r.commonAncestorContainer.parentNode||{}).className),
        sc: r && r.startContainer.nodeName, so: r && r.startOffset, ec: r && r.endContainer.nodeName, eo: r && r.endOffset, html: document.querySelector('.rich.vtext').outerHTML.slice(0, 300),
        btns: document.querySelectorAll('[aria-label="Выделить цветом"]').length, vis: Array.from(document.querySelectorAll('[aria-label="Выделить цветом"]')).map(b => b.offsetParent ? 1 : 0) }; }"""))
    page.get_by_role("button", name="Выделить цветом").first.click()
    print("DIAG2", page.evaluate("""() => ({ a: document.activeElement && (document.activeElement.tagName + '.' + document.activeElement.className), html: document.querySelector('.rich.vtext').outerHTML.slice(0, 400), text: state.blocks[0].items[0].verses[0].text.slice(0, 200) })"""))
    print("DIAG3", page.errors)
