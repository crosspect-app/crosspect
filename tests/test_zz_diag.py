import json, time
from conftest import FAKE_CLOUD, ME


def test_diag_start(browser, base_url):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    db = {"members": {"admin@x.pl": {"role": "editor"}}, "space": {"id": "sp1", "name": "T", "settings": {}}, "sermons": {}, "clock": 1000,
          "admins": ["admin@x.pl"], "spaces": {}, "shares": {}, "series": {}}
    ctx.add_init_script("localStorage.setItem('fake-cloud', %s);" % json.dumps(json.dumps(db)))
    ctx.add_init_script("localStorage.setItem('fake-user', %s);" % json.dumps(json.dumps(ME)))
    ctx.add_init_script(FAKE_CLOUD)
    pg = ctx.new_page()
    t0 = time.time()
    pg.on("console", lambda m: print("CON %.1f %s %s" % (time.time() - t0, m.type, m.text[:300])))
    pg.on("pageerror", lambda e: print("ERR %.1f %s" % (time.time() - t0, str(e)[:300])))
    pg.on("requestfailed", lambda r: print("REQFAIL %.1f %s %s" % (time.time() - t0, r.url[:120], r.failure)))
    pg.on("response", lambda r: print("RESP %.1f %s %s" % (time.time() - t0, r.status, r.url[-80:])) if time.time() - t0 > 1 else None)
    pg.goto(base_url + "/index.html")
    for i in range(40):
        st = pg.evaluate("() => ({ home: !!document.querySelector('.home-top'), gate: (document.querySelector('.gate')||{}).textContent || '', body: document.body.className, scr: typeof screen === 'string' ? screen : '?', cloud: typeof cloud === 'object' ? { started: cloud.started, user: !!cloud.user, space: cloud.space, api: !!cloud.api } : null })")
        print("ST %.1f %s" % (time.time() - t0, json.dumps(st, ensure_ascii=False)[:400]))
        if st["home"]:
            break
        time.sleep(1)
    ctx.close()
