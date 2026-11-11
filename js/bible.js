'use strict';

/* ========= Тексты Библии: XML (формат Holyrics / Beblia), грузятся по требованию ========= */
const BIBLE_SRC = ['https://raw.githubusercontent.com/Beblia/Holy-Bible-XML-Format/master/', 'https://cdn.jsdelivr.net/gh/Beblia/Holy-Bible-XML-Format@master/'];
const bibles = {};
/* Чистка стиха: сноски [60] и метки [1-6а], ударения, мягкие переносы, скобки разметки, пропущенный пробел после знака («Давида.Господь»), «***» у объединённых стихов */
const cleanVerse = t => String(t || '').replace(/[\u00ad\u0301]/g, '').replace(/\[\d[^\]]*\]/g, '').replace(/[\[\]{}|]/g, '')
  .replace(/^\s*\*{3}\s*$/, '').replace(/([.,;:!?»])(?=[А-ЯЁA-Z])/g, '$1 ').replace(/([,;:])(?=[а-яё])/g, '$1 ')
  .replace(/\s+/g, ' ').replace(/ [–-] /g, ' — ').trim();
/* Текст стиха без сносок и примечаний внутри (формат Zefania: <f>, <NOTE>) */
function verseText(el){
  let out = '';
  el.childNodes.forEach(n => {
    if (n.nodeType === 3) out += n.nodeValue;
    else if (n.nodeType === 1 && !/^(f|note|NOTE|DIV)$/.test(n.tagName)) out += verseText(n);
  });
  return out;
}
function loadBible(lang){
  lang = srcKey(lang);
  if (!LANGS[lang]) return Promise.resolve(null);
  if (bibles[lang] && bibles[lang].status !== 'error') return bibles[lang].safe;
  const rec = bibles[lang] = { status:'loading' };
  rec.promise = (async () => {
    let txt = null, err = null;
    for (const base of BIBLE_SRC){
      try { const r = await fetch(LANGS[lang].url || base + LANGS[lang].file); if (!r.ok) throw new Error('HTTP ' + r.status); txt = await r.text(); break; }
      catch(e){ err = e; }
    }
    if (!txt) throw err || new Error('load');
    const doc = new DOMParser().parseFromString(txt, 'application/xml');
    const data = {};
    // два формата: Beblia (book/chapter/verse, number) и Zefania (BIBLEBOOK/CHAPTER/VERS, bnumber/cnumber/vnumber)
    const zef = doc.getElementsByTagName('BIBLEBOOK').length > 0;
    const T = zef ? ['BIBLEBOOK', 'CHAPTER', 'VERS', 'bnumber', 'cnumber', 'vnumber'] : ['book', 'chapter', 'verse', 'number', 'number', 'number'];
    const books = doc.getElementsByTagName(T[0]);
    for (let i = 0; i < books.length; i++){
      const bk = books[i], chs = data[+bk.getAttribute(T[3])] = {};
      const chapters = bk.getElementsByTagName(T[1]);
      for (let j = 0; j < chapters.length; j++){
        const ch = chapters[j], vs = chs[+ch.getAttribute(T[4])] = {};
        const verses = ch.getElementsByTagName(T[2]);
        for (let k = 0; k < verses.length; k++) vs[+verses[k].getAttribute(T[5])] = cleanVerse(verseText(verses[k]));
      }
    }
    if (!Object.keys(data).length) throw new Error('empty');
    rec.data = data; rec.status = 'ready';
    return data;
  })();
  rec.safe = rec.promise.then(d => d, e => { rec.status = 'error'; rec.error = e; return null; });
  rec.safe.then(() => refreshLang(lang));
  return rec.safe;
}
function refreshLang(lang){
  if (!state || mode !== 'edit') return;
  state.blocks.forEach(b => {
    if (b.type !== 'scripture' || !b.items.some(it => it.kind === 'scripture' && !it.manual && srcKey(it.lang) === lang)) return;
    b.items.forEach(it => { if (it.kind === 'scripture' && !it.manual && srcKey(it.lang) === lang) syncVerses(it); });
    if (!document.querySelector('.block[data-id="' + b.id + '"]')) return;
    const a = document.activeElement, keep = a && a.closest && a.closest('.block[data-id="' + b.id + '"]') && a.classList.contains('rich');
    if (!keep) rerender(b);
  });
}
const bibleData = lang => { const k = srcKey(lang); return bibles[k] && bibles[k].status === 'ready' ? bibles[k].data : null; };
function chapterVerses(it){
  const d = bibleData(it.lang); if (!d || !it.book || !it.chapter) return null;
  return (d[it.book] || {})[it.chapter] || null;
}
function refString(it){
  if (it.manual) return it.ref || '';
  if (!it.book) return '';
  const name = bookRefName(it.lang, it.book);
  if (!it.chapter) return name;
  return name + ' ' + it.chapter + (it.sel.length ? ':' + formatSel(it.sel) : '');
}
/* Строки стихов = выбранные номера; правки текста у оставшихся стихов сохраняются */
function syncVerses(it){
  if (it.manual) return;
  const d = bibleData(it.lang);
  if (d && it.book && !d[it.book]){ it.book = 0; it.chapter = 0; it.sel = []; }   // в этом переводе нет такой книги
  const cv = chapterVerses(it);
  const old = {}; (it.verses || []).forEach(v => { old[v.num] = v; });
  it.verses = it.sel.map(n => {
    const o = old[String(n)], orig = it.lang === 'own' ? '' : (cv && cv[n] != null ? cv[n] : (o ? o.orig : ''));
    if (o && o.text && o.text !== esc(o.orig || '')) return { num:String(n), text:o.text, orig:orig };   // правки и оформление сохраняются
    return { num:String(n), text:esc(orig), orig:orig };
  });
  it.translation = trOf(it);
  it.ref = refString(it);
}

