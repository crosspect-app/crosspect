# Crosspect — настройка Firebase (делает Виталий один раз)

Что получится: база для проповедей в облаке церкви, вход через Google, ночные резервные копии. Всё бесплатно (тариф Spark, карта не нужна). Займёт минут 20–30. Названия кнопок могут немного отличаться — консоль бывает на английском, русском или польском.

Входить везде под церковным аккаунтом **«Słowo Wiary Poznań - Media»**, чтобы проект принадлежал церкви.

## 1. Проект

1. Открыть [console.firebase.google.com](https://console.firebase.google.com) → **Create a project** (Создать проект).
2. Название: `Crosspect`. Firebase предложит идентификатор вроде `crosspect-1a2b3` — оставить как есть.
3. Google Analytics — **выключить** (не нужен).
4. Дождаться «Your project is ready» → Continue.

## 2. База Firestore

1. Слева **Build → Firestore Database** → **Create database**.
2. Edition (если спросит) — **Standard**.
3. Location — **europe-central2 (Warsaw)**. Потом его не поменять.
4. Режим — **Start in production mode** (всё закрыто; правила Claude выложит сам).
5. Create.

## 3. Вход через Google

1. Слева **Build → Authentication** → **Get started**.
2. Вкладка **Sign-in method** → **Google** → включить (Enable). Project support email — почта церкви. **Save**.
3. Вкладка **Settings → Authorized domains** → **Add domain** → `crosspect-app.github.io` → Add.

## 4. Веб-приложение (настройки для формы)

1. Шестерёнка слева вверху → **Project settings** → вкладка **General**.
2. Внизу «Your apps» → значок **`</>`** (Web).
3. App nickname: `Crosspect`. Галочку Firebase Hosting **не** ставить. **Register app**.
4. Появится блок `const firebaseConfig = { apiKey: …, authDomain: …, projectId: … }`. **Скопировать его целиком и прислать Claude в чат.** Это не секрет: эти же строки видны в коде любого сайта на Firebase, защищают данные правила базы.

## 5. Ключ для GitHub (секретный)

1. **Project settings → Service accounts** → **Generate new private key** → Generate key. Скачается файл `crosspect-…-firebase-adminsdk-….json`.
   Это **секрет**: с ним можно делать с базой что угодно. Не пересылать в чатах, не класть в общие папки.
2. На той же странице ссылка **Manage service account permissions** (откроется Google Cloud) → слева **IAM**.
3. Найти строку `firebase-adminsdk-…@….iam.gserviceaccount.com` → карандаш справа → **Add another role** → в поиске `Firebase Admin` (по-русски «Администратор Firebase») → выбрать → **Save**.
   Без этой роли GitHub не сможет выкладывать правила базы.

## 6. Ключ в GitHub

1. Открыть [github.com/crosspect-app/crosspect/settings/secrets/actions](https://github.com/crosspect-app/crosspect/settings/secrets/actions) → **New repository secret**.
2. Name: `FIREBASE_SERVICE_ACCOUNT`.
3. Secret: открыть скачанный JSON-файл в Блокноте (TextEdit на Mac), выделить всё, скопировать и вставить. **Add secret**.

## 7. Приватный репозиторий для копий

1. Открыть [github.com/organizations/crosspect-app/repositories/new](https://github.com/organizations/crosspect-app/repositories/new).
2. Repository name: `crosspect-backup`. Видимость — **Private**. Поставить галочку **Add a README file**. **Create repository**.
3. В нём так же: **Settings → Secrets and variables → Actions → New repository secret**, имя `FIREBASE_SERVICE_ACCOUNT`, тот же JSON целиком.
4. Файл ключа с компьютера удалить (или убрать в менеджер паролей).

## 8. Написать Claude

Прислать в чат:
- блок `firebaseConfig` из шага 4;
- «ключ добавлен в оба репозитория»;
- **под какой почтой Google ты будешь входить** в Crosspect — она станет админом всей формы (с этапа 8 — запись `admins/{почта}` в базе, команда `set-admin` в «Пространствах»).

Дальше Claude сам: проверит выкладку правил, подключит к `crosspect-backup` ночные копии и создаст пространство.

## Если что-то пошло не так

- **Ключ попал не туда.** Project settings → Service accounts → Generate new private key (новый), затем в Google Cloud → IAM → Service accounts → этот аккаунт → Keys → удалить старый. Новый вставить в оба секрета (кнопка Update у секрета).
- **Ошибка 403 / Permission denied в Actions** при выкладке — проверить роль из шага 5.3.

### Облако: настроено (11 ноября 2026)
- Проект Firebase `crosspect-2dabd` в аккаунте «Słowo Wiary Poznań - Media»: база Firestore (europe-central2, Варшава), вход Google, домен `crosspect-app.github.io` разрешён. Настройки для формы — `js/firebase-config.js` (подключён, пока не используется).
- Правила и индексы выложены из `main` (job «Выкладка правил Firestore»); секрет `FIREBASE_SERVICE_ACCOUNT` есть в `crosspect` и `crosspect-backup`, у сервисного аккаунта роль Firebase Admin.
- Приватный `crosspect-app/crosspect-backup`: ночная копия (первая сделана), восстановление, «Пространства».
- Пространство «Słowo Wiary Poznań», id `3fSpkDd6m1modjqmIWYL`. Админ всей формы — церковный аккаунт Google (`admins/swpoznan.media@gmail.com`, с этапа 8). Авторов (`preacher`) и редакторов (`editor`) добавлять через `crosspect-backup` → Actions → «Пространства» → `set-member`, новое пространство (например, для отца) — `create-space` (до этапа 10, где это появится в форме). Админа назначает и снимает `set-admin` / `remove-admin`.
- GitHub: организацией `crosspect-app` владеет личный аккаунт Виталия; церковный аккаунт GitHub `swpoznan` в неё не входит.

