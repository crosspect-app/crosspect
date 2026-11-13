'use strict';

/* ========= PowerPoint (.pptx) из слайдов (этап 9.3) =========
   Файл собирается без библиотек: ZIP — тот же makeZip, что и в архиве JPEG (export.js), слайды — картинки renderJPEG.
   Слайд на весь кадр 16:9: картинка 1920×1080, порядок как в конспекте, поэтому номера [N] совпадают с названиями JPEG.
   Чёрные слайды (картинка, видео, свободный и — у редактора и админа — слайд с отметкой «доработать»): чёрный фон, без подписи,
   задание лежит в заметках докладчика. У обычного слайда в заметки идёт «текст к слайду».
   makePPTX(slides) — чистая сборка из готовых данных (её же проверяют тесты), exportPPTX — выгрузка из открытого конспекта. */
const PPTX_W = 12192000, PPTX_H = 6858000;   // 13,333 × 7,5 дюйма: 16:9
const PPTX_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const PPTX_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const PPTX_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PPTX_CT = 'application/vnd.openxmlformats-officedocument.presentationml.';
/* в XML нельзя управляющие символы (кроме таба и переводов строк), иначе PowerPoint «чинит» файл */
const xmlText = s => esc(String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, ''));
const pptxRels = list => PPTX_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  list.map(([id, type, target]) => '<Relationship Id="' + id + '" Type="' + (type.startsWith('http') ? type : PPTX_REL + type) + '" Target="' + target + '"/>').join('') + '</Relationships>';
const PPTX_GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const PPTX_CLRMAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';

function pptxTheme(){
  const fill3 = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3);
  const ln3 = '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'.repeat(3);
  const clr = (n, v) => '<a:' + n + '><a:srgbClr val="' + v + '"/></a:' + n + '>';
  const font = n => '<a:' + n + '><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:' + n + '>';
  return PPTX_HEAD + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Crosspect"><a:themeElements>' +
    '<a:clrScheme name="Crosspect">' + clr('dk1', '000000') + clr('lt1', 'FFFFFF') + clr('dk2', '1F1F1F') + clr('lt2', 'ECDFCF') +
    clr('accent1', 'FFDE59') + clr('accent2', 'C27A52') + clr('accent3', '6B56D8') + clr('accent4', '1F8D73') + clr('accent5', 'C44579') + clr('accent6', 'C9532F') +
    clr('hlink', '6B56D8') + clr('folHlink', '8A6D45') + '</a:clrScheme>' +
    '<a:fontScheme name="Crosspect">' + font('majorFont') + font('minorFont') + '</a:fontScheme>' +
    '<a:fmtScheme name="Crosspect"><a:fillStyleLst>' + fill3 + '</a:fillStyleLst><a:lnStyleLst>' + ln3 + '</a:lnStyleLst>' +
    '<a:effectStyleLst>' + '<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3) + '</a:effectStyleLst><a:bgFillStyleLst>' + fill3 + '</a:bgFillStyleLst></a:fmtScheme>' +
    '</a:themeElements></a:theme>';
}
const pptxParas = text => String(text || '').split('\n').map(l => l.trim()
  ? '<a:p><a:r><a:rPr lang="ru-RU" dirty="0"/><a:t>' + xmlText(l) + '</a:t></a:r></a:p>' : '<a:p><a:endParaRPr lang="ru-RU" dirty="0"/></a:p>').join('');
const pptxPh = (id, name, ph, extra) => '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + name + '"/><p:cNvSpPr><a:spLocks noGrp="1"' + (extra || '') + '/></p:cNvSpPr><p:nvPr><p:ph ' + ph + '/></p:nvPr></p:nvSpPr>';

function pptxSlideXml(s, n){
  const bg = s.jpeg ? '' : '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>';
  const pic = s.jpeg ? '<p:pic><p:nvPicPr><p:cNvPr id="2" name="Слайд ' + n + '" descr="' + xmlText(s.alt || '') + '"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
    '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
    '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + PPTX_W + '" cy="' + PPTX_H + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>' : '';
  return PPTX_HEAD + '<p:sld ' + PPTX_NS + '><p:cSld>' + bg + '<p:spTree>' + PPTX_GROUP + pic + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
}
function pptxNotesXml(text){
  return PPTX_HEAD + '<p:notes ' + PPTX_NS + '><p:cSld><p:spTree>' + PPTX_GROUP +
    pptxPh(2, 'Slide Image Placeholder 1', 'type="sldImg"', ' noRot="1" noChangeAspect="1"') + '<p:spPr/></p:sp>' +
    pptxPh(3, 'Notes Placeholder 2', 'type="body" idx="1"') + '<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>' + pptxParas(text) + '</p:txBody></p:sp>' +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>';
}
function pptxNotesMasterXml(){
  const xf = (x, y, cx, cy) => '<p:spPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>';
  return PPTX_HEAD + '<p:notesMaster ' + PPTX_NS + '><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>' + PPTX_GROUP +
    pptxPh(2, 'Slide Image Placeholder 1', 'type="sldImg" idx="2"', ' noRot="1" noChangeAspect="1"') + xf(685800, 1143000, 5486400, 3086100) + '</p:sp>' +
    pptxPh(3, 'Notes Placeholder 2', 'type="body" sz="quarter" idx="3"') + xf(685800, 4400550, 5486400, 3600450) +
    '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ru-RU"/></a:p></p:txBody></p:sp>' +
    '</p:spTree></p:cSld>' + PPTX_CLRMAP + '</p:notesMaster>';
}

/* slides: [{ jpeg: Uint8Array | null (чёрный слайд), notes: 'текст заметок докладчика', alt: 'подпись картинки' }] → Blob .pptx */
function makePPTX(slides, title){
  const enc = new TextEncoder(), files = [];
  const add = (name, xml) => files.push({ name, data:enc.encode(xml) });
  const withNotes = slides.map(s => !!String(s.notes || '').trim());
  const notesIdx = []; let nn = 0; withNotes.forEach((w, i) => { notesIdx[i] = w ? ++nn : 0; });
  const ct = [['Default', 'rels', 'application/vnd.openxmlformats-package.relationships+xml'], ['Default', 'xml', 'application/xml'], ['Default', 'jpg', 'image/jpeg'],
    ['Override', '/ppt/presentation.xml', PPTX_CT + 'presentation.main+xml'], ['Override', '/ppt/slideMasters/slideMaster1.xml', PPTX_CT + 'slideMaster+xml'],
    ['Override', '/ppt/slideLayouts/slideLayout1.xml', PPTX_CT + 'slideLayout+xml'], ['Override', '/ppt/notesMasters/notesMaster1.xml', PPTX_CT + 'notesMaster+xml'],
    ['Override', '/ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'], ['Override', '/ppt/theme/theme2.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'],
    ['Override', '/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'], ['Override', '/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml']];
  slides.forEach((s, i) => {
    ct.push(['Override', '/ppt/slides/slide' + (i + 1) + '.xml', PPTX_CT + 'slide+xml']);
    if (notesIdx[i]) ct.push(['Override', '/ppt/notesSlides/notesSlide' + notesIdx[i] + '.xml', PPTX_CT + 'notesSlide+xml']);
  });
  add('[Content_Types].xml', PPTX_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    ct.map(([k, a, t]) => k === 'Default' ? '<Default Extension="' + a + '" ContentType="' + t + '"/>' : '<Override PartName="' + a + '" ContentType="' + t + '"/>').join('') + '</Types>');
  add('_rels/.rels', pptxRels([['rId1', 'officeDocument', 'ppt/presentation.xml'], ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
    ['rId3', 'extended-properties', 'docProps/app.xml']]));
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  add('docProps/core.xml', PPTX_HEAD + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:title>' + xmlText(title || '') + '</dc:title><dc:creator>Crosspect</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>');
  add('docProps/app.xml', PPTX_HEAD + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Crosspect</Application><Slides>' + slides.length + '</Slides></Properties>');
  add('ppt/presentation.xml', PPTX_HEAD + '<p:presentation ' + PPTX_NS + '><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    '<p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>' + slides.map((s, i) => '<p:sldId id="' + (256 + i) + '" r:id="rId' + (10 + i) + '"/>').join('') + '</p:sldIdLst>' +
    '<p:sldSz cx="' + PPTX_W + '" cy="' + PPTX_H + '"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>');
  add('ppt/_rels/presentation.xml.rels', pptxRels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'notesMaster', 'notesMasters/notesMaster1.xml'], ['rId3', 'theme', 'theme/theme1.xml']]
    .concat(slides.map((s, i) => ['rId' + (10 + i), 'slide', 'slides/slide' + (i + 1) + '.xml']))));
  add('ppt/slideMasters/slideMaster1.xml', PPTX_HEAD + '<p:sldMaster ' + PPTX_NS + '><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>' + PPTX_GROUP + '</p:spTree></p:cSld>' +
    PPTX_CLRMAP + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>');
  add('ppt/slideMasters/_rels/slideMaster1.xml.rels', pptxRels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]));
  add('ppt/slideLayouts/slideLayout1.xml', PPTX_HEAD + '<p:sldLayout ' + PPTX_NS + ' type="blank" preserve="1"><p:cSld name="Пусто"><p:spTree>' + PPTX_GROUP + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>');
  add('ppt/slideLayouts/_rels/slideLayout1.xml.rels', pptxRels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]));
  add('ppt/theme/theme1.xml', pptxTheme());
  add('ppt/theme/theme2.xml', pptxTheme());
  add('ppt/notesMasters/notesMaster1.xml', pptxNotesMasterXml());
  add('ppt/notesMasters/_rels/notesMaster1.xml.rels', pptxRels([['rId1', 'theme', '../theme/theme2.xml']]));
  slides.forEach((s, i) => {
    const n = i + 1, rels = [['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']];
    if (s.jpeg){ rels.push(['rId2', 'image', '../media/image' + n + '.jpg']); files.push({ name:'ppt/media/image' + n + '.jpg', data:s.jpeg }); }
    if (notesIdx[i]) rels.push(['rId3', 'notesSlide', '../notesSlides/notesSlide' + notesIdx[i] + '.xml']);
    add('ppt/slides/slide' + n + '.xml', pptxSlideXml(s, n));
    add('ppt/slides/_rels/slide' + n + '.xml.rels', pptxRels(rels));
    if (notesIdx[i]){
      add('ppt/notesSlides/notesSlide' + notesIdx[i] + '.xml', pptxNotesXml(s.notes));
      add('ppt/notesSlides/_rels/notesSlide' + notesIdx[i] + '.xml.rels', pptxRels([['rId1', 'notesMaster', '../notesMasters/notesMaster1.xml'], ['rId2', 'slide', '../slides/slide' + n + '.xml']]));
    }
  });
  const blob = makeZip(files);
  return new Blob([blob], { type:'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}

/* Чёрный слайд: форма сама его не рисует — картинка, видео, свободный слайд или слайд, который редактор отметил «доработать» */
const pptxIsBlack = b => !PREVIEW[b.type] || todoOn(b);
/* Заметки чёрного слайда: что на нём должно быть («[7] Картинка: название», дальше описание и подробности) */
function pptxBlackNotes(b, n){
  const T = TYPES[b.type], name = cleanName(b.name), m = state.meta, out = [];
  out.push('[' + n + '] ' + T.label + (name ? ': ' + name : ''));
  const add = (label, v) => { v = String(v == null ? '' : v).trim(); if (v) out.push(label + v); };
  switch (b.type){
    case 'image':
      if (b.mode === 'send') out.push('Пришлю отдельно: файл с подписью «Слайд ' + n + '»');
      add('Описание: ', b.desc); break;
    case 'video':
      if (b.mode === 'send') out.push('Пришлю отдельно: видео с подписью «Слайд ' + n + '»'); else add('Ссылка: ', b.url);
      if (b.from || b.to) out.push('Отрезок: с ' + (b.from || '0:00') + ' до ' + (b.to || 'конца'));
      add('Комментарий: ', b.desc); break;
    case 'free':
      add('Описание: ', b.desc); break;
    case 'splash':
      add('Название: ', m.title); break;
    case 'scripture':
      b.items.forEach(it => {
        if (it.kind === 'text') add('', plain(it.html));
        else if (it.kind !== 'line') out.push([it.ref, it.translation].filter(Boolean).join(' ') + (it.verses ? ': ' + it.verses.map(v => (v.num ? v.num + ' ' : '') + plain(v.text).trim()).filter(Boolean).join(' ') : ''));
      }); break;
    case 'thesis':
      add('', plain(b.text)); break;
    case 'quote':
      add('', '«' + plain(b.text).trim() + '»'); add('Автор: ', b.author); add('Подпись: ', b.caption); break;
  }
  if (PREVIEW[b.type]) out.push('Отмечено «доработать»: слайд нужно сделать или поправить');
  if (plain(b.speech).trim()) out.push('', 'Текст к слайду:', plain(b.speech).trim());
  return out.join('\n');
}
async function exportPPTX(){
  if (exporting) return;
  const list = state.blocks.filter(b => TYPES[b.type].slide);
  if (!list.length){ toast('В конспекте пока нет слайдов'); return; }
  exporting = true; motionPause();
  try {
    const nums = slideNums(), slides = []; let black = 0;
    for (let i = 0; i < list.length; i++){
      toast('Собираю PowerPoint: ' + (i + 1) + ' из ' + list.length + '…');
      const b = list[i], n = nums[b.id], bl = pptxIsBlack(b);
      if (bl) black++;
      slides.push({
        jpeg:bl ? null : new Uint8Array(await (await renderJPEG(b)).arrayBuffer()),
        alt:slideName(b, n),
        notes:bl ? pptxBlackNotes(b, n) : plain(b.speech).trim()
      });
    }
    download(makePPTX(slides, state.meta.title), folderName() + '.pptx');
    toast('Скачан PowerPoint: ' + list.length + ' ' + plural(list.length, 'слайд', 'слайда', 'слайдов') + (black ? ', из них чёрных: ' + black : ''));
  } catch(e){ toast('Не получилось собрать PowerPoint: ' + (e && e.message ? e.message : 'ошибка') + '. Проверьте интернет.'); }
  finally { exporting = false; motionResume(); }
}

/* «⋯ → Скачать слайды»: окно с выбором — JPEG в архиве или PowerPoint */
function openDownload(){
  if (!state || !state.blocks.some(b => TYPES[b.type].slide)){ toast('В конспекте пока нет слайдов'); return; }
  const opt = (icon, title, text, fn) => h('button', { type:'button', class:'btn dl-opt', onclick:() => { closeSettings(); fn(); } },
    h('span', { class:'dl-opt-title' }, ic(icon), title), h('span', { class:'dl-opt-text', text }));
  settingsOverlay.innerHTML = '';
  settingsOverlay.append(h('div', { class:'sheet dlsheet', role:'dialog', 'aria-label':'Скачать слайды' },
    h('div', { class:'sheet-head' }, h('div', { class:'sheet-title', text:'Скачать слайды' }), iconBtn('close', 'Закрыть', closeSettings)),
    h('div', { class:'dl-opts' },
      opt('zip', 'JPEG в архиве', 'Слайды, которые собирает форма, по одному файлу. Картинки, видео и свободные слайды не входят.', () => exportMany()),
      opt('frame', 'PowerPoint', 'Один файл .pptx со всеми слайдами по порядку. На местах картинок, видео и свободных слайдов стоят чёрные слайды, задание к ним — в заметках.', () => exportPPTX()))));
  settingsOverlay.classList.add('open');
}
