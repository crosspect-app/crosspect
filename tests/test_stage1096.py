"""Этап 10.9.6: работа в разных браузерах. Safari не сохраняет холст в WebP (молча отдаёт PNG) — картинки сжимаются в JPEG,
с прозрачностью — в PNG, и открываются по байтам; на iPhone нет полного экрана — показ во всё окно."""
from pathlib import Path

import pytest

from conftest import ENGINE, cloud_page, ME, open_sermon
from test_stage1091 import blk, open_img, png, upload

ROOT = Path(__file__).resolve().parent.parent

NO_WEBP = """() => {   // как в Safari: WebP при сохранении холста не получается, браузер отдаёт PNG
  const tb = HTMLCanvasElement.prototype.toBlob, td = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toBlob = function(cb, t, q){ return tb.call(this, cb, t === 'image/webp' ? 'image/png' : t, q); };
  HTMLCanvasElement.prototype.toDataURL = function(t, q){ return td.call(this, t === 'image/webp' ? 'image/png' : t, q); };
  pbWebpOk = null;
}"""


def test_no_webp_falls_back_to_jpeg_and_png(page):
    page.evaluate(NO_WEBP)
    r = page.evaluate("""async () => {
      const c = pbCanvas(300, 200), g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 300, 200);
      const a = await pbEncode(c);
      const t = pbCanvas(300, 200), k = t.getContext('2d'); k.fillStyle = '#c33'; k.fillRect(50, 50, 100, 100);
      const b = await pbEncode(t), cut = await pbEncode(t, true);
      const head = async x => Array.from(new Uint8Array(await x.blob.arrayBuffer()).slice(0, 2));
      return { canWebp:pbCanWebp(), a:a.type, ah:await head(a), b:b.type, bh:await head(b), cut:cut.type,
        mime:[imgMime(new Uint8Array([0xFF, 0xD8])), imgMime(new Uint8Array([0x89, 0x50])), imgMime(new Uint8Array([0x52, 0x49]))] };
    }""")
    assert r["canWebp"] is False
    assert r["a"] == "image/jpeg" and r["ah"] == [0xFF, 0xD8]   # без прозрачности — JPEG
    assert r["b"] == "image/png" and r["bh"] == [0x89, 0x50] and r["cut"] == "image/png"   # с прозрачностью — PNG
    assert r["mime"] == ["image/jpeg", "image/png", "image/webp"]
    assert not page.errors, page.errors


def test_upload_without_webp_works_and_shows(page, sermon, tmp_path):
    open_img(page, sermon)
    page.evaluate(NO_WEBP)
    upload(page, png(tmp_path, 1600, 900))
    b = blk(page)
    head = page.evaluate("id => Array.from(atob(fakeCloud.db().slideImages[state.id][id].img).slice(0, 2)).map(c => c.charCodeAt(0))", b["imageId"])
    assert head == [0xFF, 0xD8]
    # другое устройство: картинки нет в кеше браузера — берётся из облака и открывается как JPEG
    w = page.evaluate("""async id => {
      await new Promise(res => { const r = indexedDB.open('crosspect-photos', 1); r.onsuccess = () => { const t = r.result.transaction('img', 'readwrite');
        t.objectStore('img').delete(PIC_KEY(id)); t.oncomplete = res; }; });
      picImgs.delete(id);
      const im = await picImage(id); return im.naturalWidth; }""", b["imageId"])
    assert w == 1600
    assert not page.errors, page.errors


def test_show_without_fullscreen_fills_window(page, sermon):
    """iPhone: у элементов нет requestFullscreen — показ во всё окно, без ошибок."""
    open_sermon(page, sermon, edit=False)
    page.evaluate("() => { Element.prototype.requestFullscreen = undefined; Element.prototype.webkitRequestFullscreen = undefined; }")
    page.evaluate("showOpen(false)")
    page.wait_for_selector(".slideshow .show-slide.on")
    box = page.locator(".slideshow").bounding_box()
    assert (box["width"], box["height"]) == (1280, 900)
    assert page.evaluate("!document.fullscreenElement")
    page.keyboard.press("Escape")
    page.wait_for_function("!document.querySelector('.slideshow')")
    assert not page.errors, page.errors


def test_browsers_doc_has_table():
    t = (ROOT / "docs/arch/browsers.md").read_text(encoding="utf-8")
    for w in ("Chrome", "Edge", "Firefox", "Safari", "iPhone", "Android"):
        assert w in t


def test_phone_show_has_close_button(browser, base_url, sermon):
    """Телефон и планшет: «✕» в углу закрывает показ и не листает слайд; на компьютере кнопки нет."""
    if ENGINE == "firefox":
        pytest.skip("телефон (is_mobile) Playwright не подменяет в Firefox")
    from test_stage1051 import ADMIN, MEMBERS, PHONE, show_sermon, cur, wait_home
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, **PHONE)
    try:
        wait_home(page)
        open_sermon(page, show_sermon(sermon), edit=False)
        page.wait_for_selector(".stage .sl")
        page.locator("#app .hd-show").tap()
        page.wait_for_selector(".slideshow .show-slide.on")
        x = page.locator(".slideshow .show-x")
        assert x.is_visible() and x.get_attribute("aria-label") == "Закончить показ"
        bb = x.bounding_box()
        assert bb["width"] >= 44 and bb["x"] + bb["width"] <= 390
        page.wait_for_selector(".slideshow.idle", timeout=4000)   # прячется вместе со счётчиком
        assert page.evaluate("getComputedStyle(document.querySelector('.show-x')).pointerEvents") == "none"
        page.touchscreen.tap(60, 400)   # касание (левая половина: на первом слайде назад некуда) — снова видно
        assert cur(page) == 0
        page.wait_for_function("!document.querySelector('.slideshow').classList.contains('idle')")
        x.tap()
        page.wait_for_function("!document.querySelector('.slideshow')")
        assert not page.errors, page.errors
    finally:
        ctx.close()


def test_desktop_show_has_no_close_button(page, sermon):
    open_sermon(page, sermon, edit=False)
    page.evaluate("showOpen(false)")
    page.wait_for_selector(".slideshow .show-slide.on")
    assert page.locator(".slideshow .show-x").count() == 0
