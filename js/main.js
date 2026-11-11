'use strict';

/* ========= Запуск ========= */
loadCachedConfig();   // последняя загруженная копия настроек: форма сразу знает все переводы, даже без интернета
applySlides();
const dr = readDraft();
state = dr ? normalize(dr) : blank();
renderAll();
fetchConfig().then(ok => { if (ok && !activeRich()) renderMain(); });   // свежие настройки из репозитория
