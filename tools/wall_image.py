"""Стена главной для телефона: img/wall-phone.webp (этап 10.1.1).

Запуск вручную из корня репозитория: python3 tools/wall_image.py
Снимает стену слайдов из самой формы (js/motion.js, homeBg/fillWall) со стандартным фоном (System Template): тот же фильтр, зерно
и «окно» дымки, только дымка стоит на месте в верхней части. Портрет 430x932 px при масштабе 3 даёт 1290x2796.
Нужны Playwright (Chromium) и Pillow. Размер файла — не больше 250 КБ: качество подбирается само.
Перезапускать, когда меняется стандартный фон, шрифт названий, список WALL_TITLES или параметры стены (docs/arch/phone.md)."""
import functools
import http.server
import io
import pathlib
import sys
import threading

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "img" / "wall-phone.webp"
W, H, SCALE, LIMIT = 430, 932, 3, 250 * 1024

HIDE = """
#app, .gate-fx, .toasts, .overlay { display:none !important }
.home-bg { opacity:1 !important }
.hb-wall { transition:none !important }
.hb-haze { animation:none !important; transform:translate(12vw,-24vh) !important }
"""


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=SCALE, reduced_motion="no-preference")
        pg = ctx.new_page()
        pg.goto("http://127.0.0.1:%d/index.html" % srv.server_address[1])
        pg.wait_for_function("typeof homeBg === 'function' && typeof isPhone === 'function'")
        if pg.evaluate("isPhone()"):
            sys.exit("Контекст снимка оказался «телефоном»: стена из слайдов не построится")
        pg.add_style_tag(content=HIDE)
        pg.evaluate("document.fonts.ready.then(() => { document.body.classList.add('wall-on'); homeBg(); layoutWall(); })")
        pg.wait_for_selector(".hb-wall.ready", state="attached")
        pg.evaluate("document.fonts.ready")
        pg.wait_for_timeout(1200)
        png = pg.screenshot()
        b.close()
    srv.shutdown()
    img = Image.open(io.BytesIO(png)).convert("RGB")
    data = b""
    for q in range(80, 19, -5):
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=q, method=6)
        data = buf.getvalue()
        if len(data) <= LIMIT:
            break
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_bytes(data)
    print("%s: %dx%d, %d КБ, качество %d" % (OUT.relative_to(ROOT), img.width, img.height, len(data) // 1024, q))
    if len(data) > LIMIT:
        sys.exit("Не уложились в %d КБ" % (LIMIT // 1024))


if __name__ == "__main__":
    main()
