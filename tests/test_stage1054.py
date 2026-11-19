"""Этап 10.5.4 (панель «Лимиты базы» снята 19 ноября 2026: Google отдаёт счётчики только проектам с платёжным аккаунтом).
Остался понятный текст при исчерпании бесплатного лимита базы — у любого человека; правки при этом лежат в черновике браузера (см. test_editor)."""
from conftest import cloud_page

EDITOR = {"email": "ed@x.pl", "name": "Редактор"}
MEMBERS = {"ed@x.pl": {"role": "editor", "firstName": "Пётр", "lastName": "Сидоров"}}


def test_exhausted_message_for_everyone(browser, base_url):
    ctx, page = cloud_page(browser, base_url, user=EDITOR, members=MEMBERS)
    page.wait_for_selector(".org-pick")
    text = page.evaluate("""async () => { const m = await import('./js/cloud-api.mjs?v=t'); return m.explain({ code:'resource-exhausted' }); }""")
    assert text == "База на сегодня исчерпала бесплатный лимит, заработает около 9:00. Изменения сохранены в этом браузере."
    ctx.close()
