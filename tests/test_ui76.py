"""Этап 7.6: анимации интерфейса (js/motion.js, раздел «Движение» в css/style.css).
Обычные тесты идут с «Уменьшить движение» (conftest: reduced_motion="reduce"), чтобы анимации не делали их нестабильными;
здесь движение включается явно (MOVE). Облако подменено: tests/fixtures/fake_cloud.js."""
import base64

from conftest import cloud_page
from test_cloud import ADMIN, IVAN, MEMBERS
from test_editor import full, opt
from test_lock import open_sermon, start_edit
from test_ui71 import ED, MEMBERS_ED, three_slides

MOVE = {"reduced_motion": "no-preference"}
# считаем только вызовы document.startViewTransition из самой формы (стек без служебных кадров Playwright)
SPY_VT = """(() => { window.__vt = 0; const o = document.startViewTransition.bind(document);
  document.startViewTransition = f => { if (!/UtilityScript/.test(new Error().stack)) window.__vt++; return o(f); }; })()"""


def editor_page(browser, base_url, motion, sermon=None):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED, sermons={"s1": sermon or three_slides()}, **(MOVE if motion else {}))
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    page.wait_for_selector(".sv.lay")
    start_edit(page)
    return ctx, page


def anim_on(page, selector):
    """Идёт ли сейчас анимация у элемента (CSS или Web Animations)"""
    return page.evaluate("sel => [...document.querySelectorAll(sel)].some(e => e.getAnimations().length > 0)", selector)


# ---------- основа ----------

def test_motion_variables_and_module(browser, base_url):
    ctx, page = editor_page(browser, base_url, True)
    var = "n => getComputedStyle(document.documentElement).getPropertyValue(n).trim()"
    assert [page.evaluate(var, n) for n in ("--motion-fast", "--motion", "--motion-slow")] == ["120ms", "200ms", "250ms"]
    assert page.evaluate(var, "--ease-out").startswith("cubic-bezier")
    assert page.evaluate("typeof motionFilm === 'function' && typeof motionHL === 'function' && typeof viewTransition === 'function' && typeof motionPause === 'function'")
    assert page.evaluate("MOTION.off()") is False
    assert not page.errors, page.errors
    ctx.close()


def test_reduced_motion_zeroes_everything(browser, base_url):
    ctx, page = editor_page(browser, base_url, False)   # по умолчанию в тестах — «Уменьшить движение»
    var = "n => getComputedStyle(document.documentElement).getPropertyValue(n).trim()"
    assert [page.evaluate(var, n) for n in ("--motion-fast", "--motion", "--motion-slow")] == ["0ms", "0ms", "0ms"]
    assert page.evaluate("MOTION.off()") is True
    # лента: «Дублировать» ничего не двигает (FLIP не запускается), но подсветка остаётся
    page.locator(".st-box").first.hover()
    page.locator(".st-box").first.get_by_role("button", name="Дублировать").click()
    assert not anim_on(page, ".st-box")
    page.wait_for_selector(".st.hl")
    assert not page.evaluate("document.getAnimations().some(a => a.animationName === 'hl-out')")   # рамка стоит без движения
    page.wait_for_function("!document.querySelector('.st.hl')", timeout=3000)
    # главная: фон и зерно стоят
    page.evaluate("navigate('')")
    page.wait_for_selector(".home-bg")
    assert page.evaluate("getComputedStyle(document.querySelector('.home-bg')).animationName") == "none"
    assert not page.errors, page.errors
    ctx.close()


def test_gate_logo_whole_at_once_and_grain_still_when_reduced(browser, base_url):
    ctx, page = cloud_page(browser, base_url)   # без входа — экран входа
    page.wait_for_selector(".gate-logo .logo-mark path")
    assert page.evaluate("[...document.querySelectorAll('.gate-logo .logo-mark path')].map(p => getComputedStyle(p).opacity)") == ["1", "1", "1"]
    assert page.evaluate("getComputedStyle(document.querySelector('.gate-grain')).animationName") == "none"
    assert not page.errors, page.errors
    ctx.close()


# ---------- экран входа ----------

def test_gate_logo_assembles_and_grain_moves(browser, base_url):
    ctx, page = cloud_page(browser, base_url, **MOVE)
    page.wait_for_selector(".gate-logo.intro")
    assert page.evaluate("document.querySelectorAll('.gate-logo.intro .logo-mark path').length") == 3
    assert page.evaluate("[...document.querySelectorAll('.gate-logo.intro path')].every(p => p.getAnimations().length === 1)")
    # три части по очереди: задержки 0 / 200 / 400 мс, вместе ≈ 900 мс
    delays = page.evaluate("[...document.querySelectorAll('.gate-logo.intro path')].map(p => p.getAnimations()[0].effect.getComputedTiming().delay + p.getAnimations()[0].effect.getComputedTiming().duration)")
    done = page.evaluate("parseFloat(getComputedStyle(document.querySelector('.gate-logo')).getPropertyValue('--el')) || 0")   # перерисовка в первую секунду продолжает сборку
    assert 850 <= max(delays) + done <= 950 and delays == sorted(delays), (delays, done)
    # зерно: та же текстура, что у слайдов, сдвигается рывками (steps), слабая прозрачность
    css = page.evaluate("(() => { const s = getComputedStyle(document.querySelector('.gate-grain')); return [s.animationName, s.backgroundImage.slice(0, 8), s.opacity]; })()")
    assert css[0] == "grain" and css[1] == "url(\"dat" and float(css[2]) < 0.15, css
    same = page.evaluate("getComputedStyle(document.querySelector('.gate-grain')).backgroundImage.replace(/\"/g, '') === document.documentElement.style.getPropertyValue('--noise').replace(/\"/g, '')")
    assert same   # та же повторяемая текстура зерна, что у слайдов
    page.wait_for_function("[...document.querySelectorAll('.gate-logo path')].every(p => p.getAnimations().every(a => a.playState === 'finished'))", timeout=3000)   # собрались и остановились
    assert not page.errors, page.errors
    ctx.close()


# ---------- лента ----------

def test_film_duplicate_highlights_and_animates(browser, base_url):
    ctx, page = editor_page(browser, base_url, True)
    first = page.locator(".st-box").first
    first.hover()
    first.get_by_role("button", name="Дублировать").click()
    page.wait_for_selector(".st.hl")
    assert page.evaluate("document.querySelectorAll('.st.hl').length") == 1
    assert page.evaluate("document.querySelector('.st.hl').dataset.id === selId")   # подсвечена новая копия
    assert anim_on(page, ".st-box")   # копия проявляется, нижние миниатюры съезжают (FLIP)
    page.wait_for_function("!document.querySelector('.st.hl')", timeout=3000)   # через ~0,6 с рамки нет
    page.wait_for_function("!document.getAnimations().some(a => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('st-box'))", timeout=3000)
    assert page.evaluate("state.blocks.length") == 4
    assert not page.errors, page.errors
    ctx.close()


def test_film_delete_fades_out_and_others_move_up(browser, base_url):
    ctx, page = editor_page(browser, base_url, True)
    bid = page.evaluate("state.blocks[1].id")
    box = page.locator(".st-box[data-box='%s']" % bid)
    box.hover()
    box.get_by_role("button", name="Удалить").click()
    page.wait_for_selector(".film-ghost")   # уходящая миниатюра гаснет на месте
    assert page.locator(".st-box[data-box='%s']" % bid).count() == 0
    assert anim_on(page, ".st-box")   # остальные подъезжают
    page.wait_for_function("!document.querySelector('.film-ghost')", timeout=3000)
    assert page.evaluate("state.blocks.length") == 2
    assert not page.errors, page.errors
    ctx.close()


def test_film_drag_reorder_flips_neighbours(browser, base_url):
    ctx, page = editor_page(browser, base_url, True)
    ids = page.evaluate("state.blocks.map(b => b.id)")
    page.evaluate("moveTo(state.blocks[2], 0)")   # то, что делает отпускание при перетаскивании
    assert page.evaluate("state.blocks.map(b => b.id)") == [ids[2], ids[0], ids[1]]
    assert anim_on(page, ".st-box")
    page.wait_for_function("!document.getAnimations().some(a => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('st-box'))", timeout=3000)
    assert not page.errors, page.errors
    ctx.close()


def test_slides_never_animate(browser, base_url):
    ctx, page = editor_page(browser, base_url, True)
    first = page.locator(".st-box").first
    first.hover()
    first.get_by_role("button", name="Дублировать").click()
    # внутри слайдов (.sl*) анимаций нет ни на сцене, ни в миниатюрах
    assert not page.evaluate("[...document.querySelectorAll('.sl, .sl *')].some(e => e.getAnimations().length > 0)")
    assert page.evaluate("[...document.querySelectorAll('.sl, .sl-stage')].every(e => getComputedStyle(e).animationName === 'none' && getComputedStyle(e).transitionDuration.split(',').every(x => parseFloat(x) === 0))")
    ctx.close()


def test_jpeg_during_animation_matches_static(browser, base_url):
    ctx, page = editor_page(browser, base_url, True)
    page.evaluate("(() => { window.__paused = []; const o = renderJPEG; renderJPEG = b => { window.__paused.push(MOTION.paused > 0 && document.documentElement.classList.contains('no-motion')); return o(b); }; })()")
    first = page.locator(".st-box").first
    first.hover()
    first.get_by_role("button", name="Дублировать").click()
    page.wait_for_selector(".st.hl")
    # слайд, пока идёт анимация копии (экспорт сам выключает движение)
    page.evaluate("selectBlock(state.blocks[0].id)")
    with page.expect_download() as dl:
        page.evaluate("exportOne(state.blocks[0])")
    during = open(dl.value.path(), "rb").read()
    page.wait_for_function("!document.querySelector('.st.hl')", timeout=3000)
    page.wait_for_timeout(300)
    with page.expect_download() as dl2:
        page.evaluate("exportOne(state.blocks[0])")
    still = open(dl2.value.path(), "rb").read()
    assert during == still and len(during) > 5000
    assert page.evaluate("window.__paused") == [True, True]   # на время снятия JPEG движение стояло на паузе
    assert page.evaluate("MOTION.paused") == 0 and not page.evaluate("document.documentElement.classList.contains('no-motion')")
    assert not page.errors, page.errors
    ctx.close()


# ---------- статус, замок, клин ----------

def test_status_pill_moves_and_wedge_flashes(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full()}, **MOVE)
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    assert not anim_on(page, ".topbar .lg-c")   # при открытии клин не вспыхивает
    start_edit(page)
    opt(page, "Готов к вёрстке").click()
    page.wait_for_selector(".stswitch .sw-pill")   # подложка переезжает на новое место
    assert anim_on(page, ".topbar .lg-c")   # клин вспыхивает
    page.wait_for_function("!document.querySelector('.stswitch .sw-pill') && !document.querySelector('.pill-wait')", timeout=3000)
    assert page.locator(".stswitch .sw-opt.on").inner_text() == "Готов к вёрстке"
    # обратно на «Черновик»: подложка переезжает, клин не вспыхивает
    page.wait_for_function("!document.querySelector('.topbar .lg-c').getAnimations().length")
    opt(page, "Черновик").click()
    page.wait_for_selector(".stswitch .sw-pill")
    assert not anim_on(page, ".topbar .lg-c")
    assert not page.errors, page.errors
    ctx.close()


def test_wedge_does_not_flash_on_cloud_update(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full()}, **MOVE)
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    page.evaluate("(() => { const d = fakeCloud.db(); d.sermons.s1.status = 'submitted'; d.sermons.s1.updatedAt += 1000; fakeCloud.put(d); })()")
    page.wait_for_function("document.querySelector('.stswitch .sw-opt.on, .stchip') && /Готов/.test(document.querySelector('.stswitch .sw-opt.on, .stchip').textContent)", timeout=8000)
    assert not anim_on(page, ".topbar .lg-c")
    assert not page.errors, page.errors
    ctx.close()


def test_lock_on_edit_button_for_author_at_editor_only(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full(st="work")}, **MOVE)
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    btn = page.locator(".topbar .hd-edit")
    assert btn.is_disabled() and btn.locator(".lockbadge").count() == 1   # у автора при «У редактора» на кнопке замок
    ctx.close()
    # у редактора и админа замка нет: кнопка работает
    ctx, page = cloud_page(browser, base_url, user=ADMIN, members=MEMBERS, sermons={"s1": full(st="work")}, **MOVE)
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    btn = page.locator(".topbar .hd-edit")
    assert btn.is_enabled() and btn.locator(".lockbadge").count() == 0
    ctx.close()


def test_lock_appears_and_disappears_with_status(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=IVAN, members=MEMBERS, sermons={"s1": full(st="draft")}, **MOVE)
    page.wait_for_selector(".scard")
    open_sermon(page, "s1")
    assert page.locator(".topbar .lockbadge").count() == 0
    page.evaluate("(() => { const d = fakeCloud.db(); d.sermons.s1.status = 'work'; d.sermons.s1.updatedAt += 1000; fakeCloud.put(d); })()")
    page.wait_for_selector(".topbar .hd-edit .lockbadge:not(.gone)", timeout=8000)   # статус поставили — замок проявляется
    assert anim_on(page, ".topbar .lockbadge")
    page.evaluate("(() => { const d = fakeCloud.db(); d.sermons.s1.status = 'draft'; d.sermons.s1.updatedAt += 1000; fakeCloud.put(d); })()")
    page.wait_for_function("!document.querySelector('.topbar .lockbadge:not(.gone)')", timeout=8000)   # снят — исчезает
    page.wait_for_function("!document.querySelector('.topbar .lockbadge')", timeout=3000)
    assert page.locator(".topbar .hd-edit").is_enabled()
    assert not page.errors, page.errors
    ctx.close()


# ---------- «Слайды ↔ Текст» ----------

def test_view_transition_between_slides_and_text(browser, base_url):
    ctx, page = editor_page(browser, base_url, True)
    page.evaluate(SPY_VT)
    page.evaluate("selectBlock(state.blocks[2].id)")
    page.locator(".topbar .seg button").nth(1).click()
    page.wait_for_selector(".tv")
    assert page.evaluate("window.__vt") == 1
    # выбранный слайд — в своём блоке, блок на ~0,5 с подсвечен
    page.wait_for_selector(".blk.hl")
    assert page.evaluate("document.querySelector('.blk.hl .tv-thumb').dataset.id === state.blocks[2].id")
    page.wait_for_function("!document.querySelector('.blk.hl')", timeout=3000)
    page.locator(".topbar .seg button").nth(0).click()
    page.wait_for_selector(".sv")
    assert page.evaluate("window.__vt") == 2
    page.wait_for_function("!document.querySelector('[style*=view-transition-name]')", timeout=3000)   # имена убираются: только на время перехода
    assert not page.errors, page.errors
    ctx.close()


def test_view_switch_works_without_view_transitions(browser, base_url):
    ctx, page = editor_page(browser, base_url, True)
    page.evaluate("document.startViewTransition = undefined")   # браузер не умеет
    page.locator(".topbar .seg button").nth(1).click()
    page.wait_for_selector(".tv")
    assert page.evaluate("view") == "text"
    page.locator(".topbar .seg button").nth(0).click()
    page.wait_for_selector(".sv")
    assert page.evaluate("view") == "slides"
    assert not page.errors, page.errors
    ctx.close()


def test_no_view_transition_when_reduced(browser, base_url):
    ctx, page = editor_page(browser, base_url, False)
    page.evaluate(SPY_VT)
    page.locator(".topbar .seg button").nth(1).click()
    page.wait_for_selector(".tv")
    assert page.evaluate("window.__vt") == 0
    ctx.close()


# ---------- автосохранение ----------

def test_autosave_shows_check_not_logo(browser, base_url):
    ctx, page = editor_page(browser, base_url, True)
    page.evaluate("window.__lv = []; setInterval(() => { const v = LG.level; const a = window.__lv; if (a[a.length - 1] !== v) a.push(v); }, 15)")
    page.evaluate("state.meta.title = 'Тихо'; change()")
    page.wait_for_function("fakeCloud.db().sermons.s1.meta.title === 'Тихо'", timeout=15000)   # автосохранение (в тестах раз в 3 с)
    page.wait_for_selector("#hd-check.on")
    assert page.evaluate("window.__lv") == [0]   # знак ни разу не загорался
    assert anim_on(page, "#hd-check .ck")   # галочка прорисовывается
    page.wait_for_function("!document.querySelector('#hd-check.on')", timeout=4000)   # гаснет через ~1,5 с
    # «Сохранить» (Ctrl+S) — как раньше, анимация знака
    page.evaluate("window.__lv = []; state.meta.title = 'Громко'; change(); saveNow()")
    page.wait_for_function("window.__lv.includes(4)", timeout=8000)
    assert not page.errors, page.errors
    ctx.close()


def test_autosave_error_has_no_check(browser, base_url):
    ctx, page = editor_page(browser, base_url, True)
    page.evaluate("localStorage.setItem('fake-offline', '1'); state.meta.title = 'Без сети'; change()")
    page.wait_for_function("ed.offline === true", timeout=15000)
    page.wait_for_timeout(500)
    assert page.locator("#hd-check.on").count() == 0
    assert page.evaluate("fakeCloud.db().sermons.s1.meta.title") != "Без сети"
    page.evaluate("localStorage.removeItem('fake-offline')")
    ctx.close()


# ---------- уведомления ----------

def test_toasts_stack_without_overlap_and_slide_in(browser, base_url):
    ctx, page = editor_page(browser, base_url, True)
    page.evaluate("toast('Первое уведомление'); toast('Второе уведомление')")
    assert page.locator(".toast").count() == 2
    a, b = [page.locator(".toast").nth(i).bounding_box() for i in (0, 1)]
    assert a["y"] + a["height"] <= b["y"] + 1   # стопкой, не друг на друге
    assert anim_on(page, ".toast")   # выезжают снизу
    assert page.locator(".toast .toast-bar").count() == 2   # полоска: сколько осталось
    assert anim_on(page, ".toast-bar")
    page.evaluate("toast('Второе уведомление')")
    assert page.locator(".toast").count() == 2   # то же сообщение не множится
    page.wait_for_function("document.querySelectorAll('.toast').length === 0", timeout=6000)
    assert not page.errors, page.errors
    ctx.close()


def test_toast_hover_pauses_auto_hide(browser, base_url):
    ctx, page = editor_page(browser, base_url, False)
    page.evaluate("toast('Наведите мышь')")
    page.locator(".toast").hover()
    page.wait_for_timeout(3200)   # обычное время — 2,4 с
    assert page.locator(".toast").count() == 1   # мышь на уведомлении: отсчёт на паузе
    page.mouse.move(5, 5)
    page.wait_for_function("document.querySelectorAll('.toast').length === 0", timeout=5000)
    # уведомление с кнопкой всё так же работает
    page.evaluate("window.__k = 0; toast('С кнопкой', 'Вернуть', () => { window.__k++; })")
    page.locator(".toast button").click()
    assert page.evaluate("window.__k") == 1
    assert not page.errors, page.errors
    ctx.close()


# ---------- загрузка и главная ----------

def test_home_skeleton_then_cards_reveal(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED, sermons={"s1": three_slides()}, **MOVE)
    page.wait_for_selector(".scard")
    page.evaluate("cloud.list = null; renderHomeList()")   # список ещё не пришёл
    assert page.locator(".sk-card").count() == 4 and page.locator(".scard").count() == 0
    assert page.evaluate("document.getAnimations().some(a => a.animationName === 'sk-shine')")   # серые заготовки мерцают
    assert page.evaluate("getComputedStyle(document.querySelector('.sk-card'), '::after').animationDuration") == "1.2s"
    page.evaluate("cloud.list = new Map(); renderHomeList()")   # проповедей нет — обычный пустой экран
    assert page.locator(".sk-card").count() == 0 and "Пока нет ни одной проповеди" in page.inner_text("#home-list")
    assert page.evaluate("document.querySelector('#home-list').classList.contains('reveal')")   # заготовки сменились проявлением
    assert not page.errors, page.errors
    ctx.close()


def test_home_background_drifts_and_text_stays_readable(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED, sermons={"s1": three_slides()}, **MOVE)
    page.wait_for_selector(".scard")
    css = page.evaluate("(() => { const s = getComputedStyle(document.querySelector('.home-bg')); return [s.animationName, s.animationIterationCount, parseFloat(s.animationDuration), s.backgroundImage.slice(0, 9), parseFloat(s.opacity)]; })()")
    assert css[0] == "home-drift" and css[1] == "infinite" and 20 <= css[2] <= 30 and css[3].startswith("url(\"data") and css[4] <= 0.4, css
    # контраст: самое светлое место фона при его прозрачности под серым текстом (#a39a8e) — не хуже 4,5 : 1
    ratio = page.evaluate("""async () => {
      const bg = getComputedStyle(document.querySelector('.home-bg')), op = parseFloat(bg.opacity);
      const url = bg.backgroundImage.slice(5, -2), img = new Image(); img.src = url; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data; let max = [0, 0, 0], best = -1;
      for (let i = 0; i < d.length; i += 16){ const l = d[i] + d[i + 1] + d[i + 2]; if (l > best){ best = l; max = [d[i], d[i + 1], d[i + 2]]; } }
      const base = [14, 14, 14], mix = max.map((v, k) => v * op + base[k] * (1 - op));
      const lum = rgb => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
      const a = lum([163, 154, 142]), b = lum(mix); return (a + 0.05) / (b + 0.05);
    }""")
    assert ratio >= 4.5, ratio
    # карточки на сплошной подложке, фон под ними не просвечивает
    assert page.evaluate("getComputedStyle(document.querySelector('.scard')).backgroundColor") != "rgba(0, 0, 0, 0)"
    assert page.evaluate("getComputedStyle(document.querySelector('.home')).position") == "relative"
    ctx.close()


def test_infinite_animations_pause_in_background_tab(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=ED, members=MEMBERS_ED, sermons={"s1": three_slides()}, **MOVE)
    page.wait_for_selector(".home-bg")
    page.evaluate("document.documentElement.classList.add('page-hidden')")   # то же, что делает visibilitychange
    assert page.evaluate("getComputedStyle(document.querySelector('.home-bg')).animationPlayState") == "paused"
    ctx.close()


# ---------- настройки слайдов: фон в примере ----------

def test_sample_background_crossfade_only_for_variant_and_format(browser, base_url):
    ctx, page = editor_page(browser, base_url, True)
    page.evaluate("openSlidesCfg()")
    sheet = page.locator(".sheet.scfg")
    sheet.get_by_role("button", name="Создать новый").click()
    page.wait_for_selector(".scfg-slide .scfg-old")   # старый фон гаснет поверх нового
    assert anim_on(page, ".scfg-old")
    page.wait_for_function("!document.querySelector('.scfg-old')", timeout=3000)
    # ползунки — без анимации, пример меняется сразу
    page.evaluate("document.querySelector('.sheet.scfg input[aria-label=\"Поля сверху\"]').value = 80; document.querySelector('.sheet.scfg input[aria-label=\"Поля сверху\"]').dispatchEvent(new Event('input', { bubbles:true }))")
    page.wait_for_timeout(300)
    assert page.locator(".scfg-old").count() == 0
    # «Другой вариант» — перетекает
    sheet.get_by_role("button", name="Другой вариант").click()
    page.wait_for_selector(".scfg-slide .scfg-old")
    assert not page.errors, page.errors
    ctx.close()
