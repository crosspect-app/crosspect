# Облако (`cloud/`)
Часть `ARCHITECTURE.md`, вынесена 13 ноября 2026. Оглавление — в `ARCHITECTURE.md`.

Firebase: Cloud Firestore + вход Google. Что строим и по каким этапам — [`docs/PLAN.md`](docs/PLAN.md), там же модель данных и таблица прав. Настройка проекта — [`docs/FIREBASE.md`](docs/FIREBASE.md). Форма подключена к облаку с этапа 5: см. «Облако в форме» ниже.

| Файл | Что внутри |
|---|---|
| `cloud/firestore.rules` | права: админы всей формы (`admins`), пространства, участники, сводки (`summaries`), настройки слайдов (`config/slides`), проповеди, замок, отметки редактора, история сохранений (`versions`, этап 9.7), раскладка экрана человека (`people/{почта}/prefs/screen`), ссылки для оператора. Функции наверху (`signedIn`, `me`, `hasRole`, `isEditor`…), затем `match` по коллекциям |
| `cloud/firestore.indexes.json` | индекс `members.email` для запроса по всем пространствам (collection group); тяжёлые поля (`blocks`, `settings`, `flags`, `sermon`) исключены из индексов |
| `cloud/firebase.json` | пути к правилам и индексам, порт эмулятора |
| `cloud/tests/rules.test.mjs` | тесты правил в эмуляторе (`node:test` + `@firebase/rules-unit-testing`): вход, пространство, участники, чтение / создание / правка / удаление проповедей, замок, отметки, ссылки. `RULES_FILE=путь` — прогнать на другом файле правил |
| `cloud/tests/scripts.test.mjs` | служебные скрипты в эмуляторе: пространство и участники (и что их записи проходят правила), бэкап → очистка → восстановление даёт ту же копию |
| `cloud/scripts/lib.mjs` | подключение (эмулятор или ключ `GOOGLE_APPLICATION_CREDENTIALS`), перевод документов в JSON (`$timestamp`, `$ref`, `$map` …) и обратно |
| `cloud/scripts/backup.mjs` | вся база в папку: документ → `путь/документа.json` |
| `cloud/scripts/restore.mjs` | папка → база, `--wipe` сначала очищает |
| `cloud/scripts/admin.mjs` | `create-space`, `set-member`, `remove-member`, `set-admin`, `remove-admin`, `migrate-8`, `purge-trash` (корзина, этап 9.1), `list` — в обход правил; сводки считает `summaryOf` из `js/cloud-api.mjs` |
| `cloud/private-repo/` | файлы для приватного репозитория `crosspect-app/crosspect-backup`: ночная копия (и уборка корзины после неё, этап 9.1), восстановление, «Пространства». Меняешь здесь — перенеси туда |

- `cloud/tests/client.test.mjs` — код `js/cloud-api.mjs` в эмуляторах Firestore и Auth (вход выдуманной учёткой Google, настоящие правила): членство, создание и обновление, конфликт версий, права проповедника, закрытое пространство, живой список, удаление; замок: новая проповедь с замком, продление и отпускание записью, взять / сигнал / отпустить, «занято», редактор забирает, `lost-lock`, другая вкладка той же почты, свои записи после обрыва связи, истёкший чужой замок, `watch`; настройки слайдов и форматы фона (пишут админ и редактор, автор — нет; данные 7.3 с `bg`).
- Тесты: `cd cloud && npm ci && npm test` (Node 22, Java 21; эмулятор Firestore скачивается с Google Storage — в рабочей среде Claude он закрыт, поэтому тесты правил гоняются в CI: запушить ветку и запустить workflow вручную, `gh api -X POST repos/crosspect-app/crosspect/actions/workflows/ci.yml/dispatches -f ref=<ветка>`).
- Секрет `FIREBASE_SERVICE_ACCOUNT` (JSON-ключ сервисного аккаунта с ролью Firebase Admin) — в обоих репозиториях. Идентификатор проекта берётся из ключа (`project_id`).
- Email в базе — всегда строчными; `me()` в правилах приводит почту из токена к строчным.
- Время — только `serverTimestamp()`: правила сверяют его с `request.time`.
- Новое поле проповеди — добавить в `validSermon` (`hasOnly`) и тест; иначе база его не примет.

