'use strict';

/* ========= Запуск ========= */
loadCachedConfig();   // последняя загруженная копия настроек: форма сразу знает все переводы, даже без интернета
loadSlidesCache();   // настройки слайдов пространства: последняя копия из облака (или значения по умолчанию)
const dr = readDraft();
state = dr ? normalize(dr) : blank();
route();   // главная или проповедь — по адресу страницы
if (!localMode()) initCloud();   // облако: вход Google; без него форма работает по-старому
fetchConfig().then(ok => { if (ok && !mainEl.contains(document.activeElement)) renderMain(); });   // свежие настройки из репозитория; не мешаем, если человек уже что-то набирает
