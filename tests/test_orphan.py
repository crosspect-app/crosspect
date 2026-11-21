"""Одно слово на последней строке (fixOrphan, решение Виталия 21.11.2026).
Перенос последней группы слов вниз отменяется, если строка над ним стала бы короче 2/3 ширины текста.
Предлоги, союзы и частицы, приклеенные неразрывным пробелом, не отрываются от слова ни при каком переносе."""

USER_SLIDES = {"margins": {"side": 40, "top": 50, "bottom": 50},
               "kinds": {"scripture": {"size": 50, "min": 80, "track": -0.04, "lead": 1.05}},
               "verses": {"flow": "lines", "frame": True, "caps": False, "showTr": True, "align": "left", "valign": "top", "gap": 0.4, "refGap": 0.95}}

LINES_JS = """([verses, slides]) => {
  setSlidesBase(slides);
  const blk = {id:'x', type:'scripture', items:[{kind:'scripture', manual:true, ref:'Деяния 17:10', translation:'Синодальный перевод',
    verses, lang:'ru', book:0, chapter:0, sel:[], trName:''}]};
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:1920px;height:1080px';
  document.body.append(host);
  const sl = slideEl(blk); host.append(sl); fitSlide(sl, blk);
  const res = [...sl.querySelectorAll('.sl-verse')].map(p => {
    const lines = [], tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let n, cur = '', top = null;
    while ((n = tw.nextNode())) for (let i = 0; i < n.nodeValue.length; i++){
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); const rc = r.getClientRects()[0];
      if (!rc) continue;
      if (top !== null && rc.top > top + 5){ lines.push(cur.trim()); cur = ''; }
      top = rc.top; cur += n.nodeValue[i];
    }
    lines.push(cur.trim());
    return { lines, width:p.getBoundingClientRect().width, br:p.querySelectorAll('br').length };
  });
  host.remove();
  return res;
}"""

NB = " "


V9 = "Но сии, получив удостоверение от Иасона и прочих, отпустили их."
V11 = "Здешние были благомысленнее Фессалоникских: они приняли слово со всем усердием, ежедневно разбирая Писания, точно ли это так."


def lines(page, texts, slides=USER_SLIDES):
    """Слайд Деяния 17:9–11 (как у Виталия), средний стих — texts[0]; возвращает раскладку среднего стиха"""
    vs = [{"num": str(9 + i), "text": t} for i, t in enumerate([V9] + texts + [V11])]
    return page.evaluate(LINES_JS, [vs, slides])[1:]


def test_no_hole_above_moved_words(page):
    """Деяния 17:10 с настройками Виталия: «в синагогу» не уезжает вниз, если над ним остаётся полстроки"""
    r = lines(page, ["Братия же немедленно ночью отправили Павла и Силу в Верию, куда они прибыв, пошли в синагогу Иудейскую."])[0]
    assert r["lines"][-1] == "Иудейскую.", r["lines"]
    assert r["lines"][-2].endswith("пошли в" + NB + "синагогу"), r["lines"]
    assert r["br"] == 0
    assert not page.errors


def test_orphan_still_fixed_when_line_stays_long(page):
    """Если перенос оставляет строку длинной — одно слово внизу по-прежнему не остаётся"""
    base = "Братия же немедленно ночью отправили Павла и Силу в Верию, куда они прибыв, пошли в синагогу Иудейскую"
    found = None
    for tail in ["и молились там всю ночь сам", "и учили там народ день", "где учили всех людей утром",
                 "и молились там вместе всем народом утром", "и учили народ каждый день очень долго"]:
        r = lines(page, [base + ", " + tail + "."])[0]
        if r["br"]:
            found = r
            break
    assert found, "ни в одном тексте правило не сработало"
    assert len(found["lines"][-1].split()) >= 2, found["lines"]
    assert not page.errors


def test_glued_words_never_split(page):
    """Предлог и частицы остаются со своим словом и при отменённом, и при сработавшем переносе"""
    for t in ["Братия же немедленно ночью отправили Павла и Силу в Верию, куда они прибыв, пошли в синагогу Иудейскую.",
              V11]:
        for ln in lines(page, [t])[0]["lines"]:
            last = ln.split(" ")[-1]
            assert last not in ("в", "и", "со", "же", "ли"), ln
            assert not ln.startswith(("же ", "ли ")), ln
