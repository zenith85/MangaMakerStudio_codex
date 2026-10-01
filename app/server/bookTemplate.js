// Renders an HTML Shorts Maker book (title/author/chapters/images — see
// bookPrompt.js's CONTENT_SCHEMA_DESCRIPTION for the exact shape `content` must match)
// into ONE self-contained HTML file: no external requests, no build step — images are
// inlined as base64 data URIs and the whole reader (pagination engine + styles) lives in
// this one document, so the exported file opens and reads correctly from a phone's
// downloads folder years from now with zero dependencies.
//
// The reader mechanics (measure-and-paginate into swipeable "pages", font-size steps,
// the #source/#page/#measure DOM dance) are a fixed, content-agnostic engine — every
// piece of actual book content lives in the #source div as plain elements with
// sequential data-seq attributes, which the engine slices into pages purely by
// measuring rendered height. That engine is unchanged by which book is being rendered;
// only buildSourceHtml below varies per book.

// Exported for bookImport.js, which reverse-maps a re-imported export's <html lang="">
// back to one of BookApp.jsx's LANGUAGES options.
export const LANG_CODES = {
  korean: "ko", english: "en", japanese: "ja", chinese: "zh", "chinese (simplified)": "zh-CN",
  "chinese (traditional)": "zh-TW", spanish: "es", french: "fr", german: "de", portuguese: "pt",
  italian: "it", russian: "ru", arabic: "ar", hindi: "hi", vietnamese: "vi", thai: "th", indonesian: "id",
};

function langCode(language) {
  return LANG_CODES[String(language || "").trim().toLowerCase()] || "en";
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toDataUri(buffer) {
  return buffer ? `data:image/png;base64,${buffer.toString("base64")}` : null;
}

// Builds the #source div's inner HTML plus the parallel {seq: expectedText} map used by
// the reader's own self-check (window.BookReaderDebug.verifyText) — every text-bearing
// node gets the next sequential seq number in document order, exactly mirroring how the
// pagination engine slices/reassembles that same text across pages.
function buildSource(content, images) {
  let seq = 0;
  const nextSeq = () => ++seq;
  const expected = {};
  const parts = [];

  // field, when given, is a dot-path into `content` (e.g. "chapters.2.lead") — baked in
  // as data-field purely as inert metadata for the frontend's live-preview editor (see
  // BookApp.jsx's BookPreviewPane), which reads it back to know which piece of `content`
  // a contenteditable edit belongs to. Unused by the reader engine itself, and present in
  // the exported file too (harmless — nothing there depends on the absence of an
  // unrecognized attribute).
  const block = (tag, cls, text, { breakBefore = false, extraAttrs = "", field } = {}) => {
    const s = nextSeq();
    expected[s] = String(text ?? "");
    const fieldAttr = field ? ` data-field="${esc(field)}"` : "";
    const attrs = `${breakBefore ? ' data-break-before="always"' : ""} data-seq="${s}"${fieldAttr}${extraAttrs}`;
    parts.push(`<${tag} class="${cls}"${attrs}>${esc(text)}</${tag}>`);
  };

  const figure = (cls, imageId, caption, { cover = false, captionField } = {}) => {
    const uri = images[imageId];
    if (!uri) return; // no image generated yet for this slot — skip the figure entirely
    const captionHtml = caption
      ? (() => {
          const s = nextSeq();
          expected[s] = String(caption);
          const fieldAttr = captionField ? ` data-field="${esc(captionField)}"` : "";
          return `<figcaption data-seq="${s}"${fieldAttr}>${esc(caption)}</figcaption>`;
        })()
      : "";
    const coverAttr = cover ? ' data-cover-figure="true"' : "";
    parts.push(
      `<figure class="${cls}" data-kind="figure" data-atomic="true"${coverAttr}>` +
        `<img src="${uri}" alt="" width="1440" height="1080" draggable="false">${captionHtml}</figure>`
    );
  };

  block("div", "cover-kicker", content.kicker, { breakBefore: false, field: "kicker" });
  block("h1", "cover-title", content.title, { field: "title" });
  if (content.originalTitle && content.originalTitle.trim() && content.originalTitle.trim() !== content.title.trim()) {
    block("div", "cover-original", content.originalTitle, { field: "originalTitle" });
  }
  block("div", "cover-author", content.author, { field: "author" });
  figure("cover-figure", "cover", null, { cover: true });
  block("p", "cover-tagline", content.tagline, { field: "tagline" });

  block("h2", "intro-title", content.introTitle, { breakBefore: true, field: "introTitle" });
  block("div", "intro-author", content.introAuthor, { field: "introAuthor" });
  block("p", "intro-summary intro-part", content.introSummary[0], { field: "introSummary.0" });
  block("p", "intro-summary intro-last", content.introSummary[1], { field: "introSummary.1" });

  block("h2", "toc-title", content.tocTitle, { field: "tocTitle" });
  content.toc.forEach((item, i) => block("div", "toc-item", item, { field: `toc.${i}` }));
  block("p", "notice", content.notice, { field: "notice" });

  content.chapters.forEach((chapter, i) => {
    block("div", "chapter-number", chapter.number, { breakBefore: true, field: `chapters.${i}.number` });
    block("h2", "chapter-title", chapter.title, { field: `chapters.${i}.title` });
    block("p", "chapter-lead", chapter.lead, { field: `chapters.${i}.lead` });
    chapter.paragraphs.forEach((para, j) => {
      const cls = para.type === "quote" ? "body-text quote" : "body-text";
      block("p", cls, para.text, { field: `chapters.${i}.paragraphs.${j}.text` });
    });
    figure("reader-figure", `chapter-${i}`, chapter.imageCaption, { captionField: `chapters.${i}.imageCaption` });
  });

  block("h2", "closing-title", content.closing.title, { breakBefore: true, field: "closing.title" });
  block("p", "closing-lead", content.closing.lead, { field: "closing.lead" });
  content.closing.sections.forEach((section, i) => {
    block("h3", "analysis-subhead", section.subhead, { field: `closing.sections.${i}.subhead` });
    block("p", "body-text", section.text, { field: `closing.sections.${i}.text` });
  });
  block("h3", "question-title", content.closing.questionTitle, { breakBefore: true, field: "closing.questionTitle" });
  block("p", "question-text", content.closing.questionText, { field: "closing.questionText" });

  return { sourceHtml: parts.join("\n"), expected };
}

const READER_CSS = `
:root{
  --app-h:100dvh;
  --host-bottom-guard:0px;
  --reader-font:16px;
  --font-scale:1;
  --page-pad-x:clamp(22px,5.5vw,52px);
  --page-pad-y:clamp(18px,3.2vh,34px);
  --image-max-h:300px;
  --cover-image-max-h:300px;
  --ink:#1d1d1f;
  --muted:#6d6d72;
  --soft:#f3f3f2;
  --soft-2:#f7f7f6;
  --line:#d9d9d7;
}
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fafafa;color:var(--ink)}
body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans","Noto Sans KR","Noto Sans JP","Noto Sans SC","Noto Sans Arabic",sans-serif;
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;
  overscroll-behavior:none;
}
button{font:inherit}
.app{
  width:100%;
  height:var(--app-h);
  display:flex;
  flex-direction:column;
  background:#fafafa;
  overflow:hidden;
  padding-bottom:var(--host-bottom-guard);
}
.topbar{
  flex:0 0 auto;
  min-height:48px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:16px;
  padding:8px clamp(16px,4vw,28px) 7px;
  border-bottom:1px solid #ececea;
  background:#fafafa;
}
.page-status{
  font-size:12px;
  line-height:1;
  color:#666;
  font-variant-numeric:tabular-nums;
  letter-spacing:.01em;
  white-space:nowrap;
}
.type-controls{display:flex;align-items:center;gap:6px}
.type-btn{
  min-width:42px;
  min-height:32px;
  border:0;
  border-radius:999px;
  background:#ededeb;
  color:#2f2f31;
  cursor:pointer;
  font-weight:700;
  font-size:13px;
  line-height:1;
  touch-action:manipulation;
}
.type-btn:disabled{opacity:.35;cursor:default}
.reader{
  flex:1 1 auto;
  min-height:0;
  position:relative;
  overflow:hidden;
  background:#fff;
}
.page{
  width:100%;
  height:100%;
  min-height:0;
  overflow:hidden;
  padding:var(--page-pad-y) var(--page-pad-x);
  background:#fff;
  font-size:var(--reader-font);
  line-height:1.82;
  word-break:keep-all;
  overflow-wrap:break-word;
  text-wrap:pretty;
}
.page.measure{
  position:absolute;
  inset:0;
  z-index:-1;
  visibility:hidden;
  pointer-events:none;
}
.navbar{
  flex:0 0 auto;
  display:flex;
  gap:12px;
  padding:10px clamp(16px,4vw,28px) calc(10px + env(safe-area-inset-bottom,0px));
  border-top:1px solid #ececea;
  background:#fafafa;
}
.nav-btn{
  flex:1 1 0;
  min-height:48px;
  border:0;
  border-radius:999px;
  padding:0 18px;
  cursor:pointer;
  font-weight:700;
  font-size:14px;
  touch-action:manipulation;
}
.nav-prev{background:#ededeb;color:#777}
.nav-next{background:#252525;color:#fff}
.nav-btn:disabled{opacity:.38;cursor:default}
#source{display:none}

.cover-kicker,.cover-title,.cover-original,.cover-author,.cover-tagline{
  text-align:center;
  white-space:pre-wrap;
}
.cover-kicker{
  margin:clamp(8px,2.6vh,24px) 0 clamp(14px,2.2vh,22px);
  font-size:.78em;
  font-weight:700;
  letter-spacing:.06em;
  color:#5b5b5e;
}
.cover-title{
  margin:0 0 .28em;
  font-size:clamp(2.15em,7vw,3.15em);
  line-height:1.12;
  letter-spacing:-.045em;
  font-weight:800;
}
.cover-original{
  margin:0 0 .45em;
  font-family:Georgia,"Times New Roman",serif;
  font-size:1.08em;
  font-weight:700;
  color:#5c5c60;
}
.cover-author{
  margin:0 0 1.2em;
  font-size:1.15em;
  font-weight:500;
}
.cover-figure{
  margin:0 auto .9em;
  text-align:center;
}
.cover-figure img{
  display:block;
  width:min(100%,560px);
  max-width:86%;
  max-height:var(--cover-image-max-h);
  height:auto;
  margin:0 auto;
  object-fit:contain;
}
.cover-tagline{
  margin:.8em auto 0;
  max-width:34em;
  font-size:.98em;
  line-height:1.62;
  font-style:italic;
  color:#5d5d60;
}

.intro-title{
  margin:0;
  padding:.95em 1em .18em;
  border-radius:18px 18px 0 0;
  background:var(--soft);
  font-size:1.32em;
  line-height:1.35;
  letter-spacing:-.025em;
}
.intro-author{
  margin:0;
  padding:.15em 1.2em .55em;
  background:var(--soft);
  font-size:.88em;
  color:#636366;
}
.intro-summary{
  margin:0 0 1.3em;
  padding:.1em 1.2em 1em;
  border-radius:0 0 18px 18px;
  background:var(--soft);
  text-align:justify;
  text-justify:inter-character;
  white-space:pre-wrap;
}
.intro-summary.intro-part{
  margin-bottom:0;
  padding-bottom:.48em;
  border-radius:0;
}
.intro-summary.intro-last{
  padding-top:.34em;
}
.toc-title{
  margin:.2em 0 .72em;
  font-size:1.32em;
  line-height:1.35;
  letter-spacing:-.025em;
}
.toc-item{
  margin:0;
  padding:.26em 0;
  border-bottom:1px solid #efefed;
  white-space:pre-wrap;
  font-size:.96em;
  line-height:1.56;
}
.toc-item:last-child{border-bottom:0}

.chapter-number{
  margin:0 0 .35em;
  font-size:.82em;
  line-height:1.2;
  font-weight:800;
  letter-spacing:.04em;
  color:#666;
  white-space:pre-wrap;
}
.chapter-title{
  margin:0 0 .65em;
  font-size:1.7em;
  line-height:1.28;
  letter-spacing:-.035em;
  font-weight:800;
  white-space:pre-wrap;
}
.chapter-lead{
  margin:0 0 1.15em;
  font-size:.98em;
  line-height:1.62;
  color:#68686b;
  font-style:italic;
  white-space:pre-wrap;
}
.body-text,.analysis-text{
  margin:0 0 .92em;
  text-align:justify;
  text-justify:inter-character;
  white-space:pre-wrap;
}
.quote{
  margin:1.05em 0 1.08em;
  padding:.08em 0 .08em 1em;
  border-left:3px solid #8b8b89;
  color:#444447;
  font-style:italic;
  text-align:left;
}
.notice{
  margin:.2em 0 0;
  padding:.85em 0 0;
  border-top:1px solid #ececea;
  font-size:.74em;
  line-height:1.55;
  color:#747478;
  white-space:pre-wrap;
}
.reader-figure{
  margin:1.05em auto 1.18em;
  text-align:center;
}
.reader-figure img{
  display:block;
  width:min(100%,560px);
  max-width:86%;
  max-height:var(--image-max-h);
  height:auto;
  margin:0 auto;
  object-fit:contain;
}
.reader-figure figcaption{
  margin:.6em auto 0;
  max-width:36em;
  color:#858589;
  font-size:.72em;
  line-height:1.5;
  text-align:center;
  white-space:pre-wrap;
}

.closing-title{
  margin:0 0 .32em;
  font-size:1.7em;
  line-height:1.28;
  letter-spacing:-.035em;
  font-weight:800;
  white-space:pre-wrap;
}
.closing-lead{
  margin:0 0 1.35em;
  color:#5f5f62;
  font-style:italic;
  line-height:1.62;
  white-space:pre-wrap;
}
.analysis-subhead{
  margin:1.2em 0 .46em;
  font-size:1.12em;
  line-height:1.4;
  font-weight:800;
  letter-spacing:-.015em;
  white-space:pre-wrap;
}
.question-title{
  margin:1.25em 0 0;
  padding:1em 1.05em .35em;
  border-radius:18px 18px 0 0;
  background:var(--soft-2);
  font-size:1.08em;
  line-height:1.35;
  font-weight:800;
  white-space:pre-wrap;
}
.question-text{
  margin:0;
  padding:.25em 1.05em 1.05em;
  border-radius:0 0 18px 18px;
  background:var(--soft-2);
  line-height:1.75;
  text-align:justify;
  text-justify:inter-character;
  white-space:pre-wrap;
}

.split-open{margin-bottom:.22em!important}
.split-cont{margin-top:0!important}
.split-middle{margin-top:0!important;margin-bottom:.22em!important}
.intro-summary.split-open,.question-text.split-open{border-radius:0!important;margin-bottom:0!important}
.intro-summary.split-cont,.question-text.split-cont{border-radius:0 0 18px 18px!important}

.app.compact .topbar{min-height:42px;padding-top:6px;padding-bottom:6px}
.app.compact .navbar{padding-top:8px;padding-bottom:calc(8px + env(safe-area-inset-bottom,0px));gap:9px}
.app.compact .nav-btn{min-height:42px}
.app.host-guard .navbar{padding-top:6px;padding-bottom:calc(6px + env(safe-area-inset-bottom,0px))}
.app.host-guard .nav-btn{min-height:40px}
.app.compact .type-btn{min-height:30px;min-width:40px}
.app.compact .page{line-height:1.72}
.app.compact .reader-figure{margin:.72em auto .82em}
.app.compact .cover-kicker{margin-top:4px;margin-bottom:10px}
.app.compact .cover-author{margin-bottom:.75em}
.app.compact .body-text{margin-bottom:.72em}

@media (orientation:landscape){
  .topbar{min-height:40px;padding-top:5px;padding-bottom:5px}
  .navbar{padding-top:7px;padding-bottom:calc(7px + env(safe-area-inset-bottom,0px))}
  .nav-btn{min-height:40px}
  .cover-title{font-size:2em}
  .cover-kicker{margin-top:0;margin-bottom:8px}
  .cover-author{margin-bottom:.6em}
  .reader-figure,.cover-figure{margin-top:.5em;margin-bottom:.55em}
}
`;

// Content-agnostic measure-and-paginate reader engine — verbatim mechanics regardless
// of which book is loaded into #source. See the giant comment atop this file.
const READER_JS = `
(() => {
  'use strict';

  const app = document.getElementById('app');
  const reader = document.getElementById('reader');
  const pageEl = document.getElementById('page');
  const measure = document.getElementById('measure');
  const source = document.getElementById('source');
  const status = document.getElementById('pageStatus');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const smallerBtn = document.getElementById('smallerBtn');
  const largerBtn = document.getElementById('largerBtn');

  const fontScales = [0.88, 1, 1.15, 1.30];
  let fontIndex = 1;
  let pages = [];
  let currentPage = 0;
  let layoutTimer = 0;
  let paginating = false;
  let lastMetricsKey = '';

  function clamp(min, value, max){
    return Math.max(min, Math.min(max, value));
  }

  function viewportMetrics(){
    const vv = window.visualViewport;
    const heightCandidates = [
      vv && vv.height,
      window.innerHeight,
      document.documentElement.clientHeight
    ].filter(v => Number.isFinite(v) && v > 1);
    const widthCandidates = [
      vv && vv.width,
      window.innerWidth,
      document.documentElement.clientWidth
    ].filter(v => Number.isFinite(v) && v > 1);

    const vh = Math.max(1, Math.floor(Math.min(...heightCandidates)));
    const vw = Math.max(1, Math.floor(Math.min(...widthCandidates)));
    const dpr = Math.max(1, Number(window.devicePixelRatio) || 1);
    const screenShortPx = window.screen
      ? Math.min(Number(window.screen.width) || vw, Number(window.screen.height) || vh) * dpr
      : Math.min(vw, vh) * dpr;
    const cssShort = Math.min(vw, vh);
    const sixInchLike = cssShort <= 570 || screenShortPx <= 1180;
    const portrait = vh >= vw;
    const hostGuard = sixInchLike
      ? Math.round(portrait ? clamp(76, vh * 0.12, 96) : clamp(48, vh * 0.11, 68))
      : 0;

    return {vh, vw, hostGuard};
  }

  function applyViewportMetrics(){
    const {vh, vw, hostGuard} = viewportMetrics();
    document.documentElement.style.setProperty('--app-h', vh + 'px');
    document.documentElement.style.setProperty('--host-bottom-guard', hostGuard + 'px');
    app.classList.toggle('host-guard', hostGuard > 0);

    const compact = vh < 650 || vw < 470 || (vw > vh && vh < 560) || hostGuard > 0;
    app.classList.toggle('compact', compact);

    const base = clamp(15, vw * 0.024, 18);
    const readerFont = base * fontScales[fontIndex];
    document.documentElement.style.setProperty('--reader-font', readerFont.toFixed(2) + 'px');

    requestAnimationFrame(() => {
      const h = reader.clientHeight || 1;
      const w = reader.clientWidth || 1;
      const landscape = w > h;
      const padX = compact ? clamp(18, w * 0.045, 32) : clamp(24, w * 0.055, 52);
      const padY = compact ? clamp(12, h * 0.035, 20) : clamp(18, h * 0.045, 34);
      const imageRatio = landscape ? 0.48 : (compact ? 0.42 : 0.46);
      const coverRatio = landscape ? 0.42 : (compact ? 0.40 : 0.45);
      document.documentElement.style.setProperty('--page-pad-x', Math.round(padX) + 'px');
      document.documentElement.style.setProperty('--page-pad-y', Math.round(padY) + 'px');
      document.documentElement.style.setProperty('--image-max-h', Math.max(92, Math.floor(h * imageRatio)) + 'px');
      document.documentElement.style.setProperty('--cover-image-max-h', Math.max(88, Math.floor(h * coverRatio)) + 'px');
    });
  }

  function fits(){
    return measure.scrollHeight <= measure.clientHeight + 1;
  }

  function cloneTextNode(node, text, mode){
    const clone = node.cloneNode(false);
    clone.textContent = text;
    clone.removeAttribute('data-break-before');
    if(mode === 'open'){
      clone.classList.add('split-open');
    } else if(mode === 'cont'){
      clone.classList.add('split-cont');
    } else if(mode === 'middle'){
      clone.classList.add('split-middle');
    }
    return clone;
  }

  function sentenceBreaks(text){
    const points = [];
    const enders = new Set(['.','!','?','。','！','？']);
    const closers = new Set(['”','’','"',"'",'』','」',')',']']);
    for(let i=0;i<text.length;i++){
      if(enders.has(text[i])){
        let j = i + 1;
        while(j < text.length && closers.has(text[j])) j++;
        while(j < text.length && /\\s/.test(text[j])) j++;
        if(j > 0 && j < text.length) points.push(j);
      }
    }
    return [...new Set(points)].sort((a,b)=>a-b);
  }

  function phraseBreaks(text){
    const points = [];
    const marks = new Set([',','，',';','；',':','：']);
    for(let i=0;i<text.length;i++){
      if(marks.has(text[i])){
        let j=i+1;
        while(j < text.length && /\\s/.test(text[j])) j++;
        if(j > 0 && j < text.length) points.push(j);
      }
    }
    return [...new Set(points)].sort((a,b)=>a-b);
  }

  function wordBreaks(text){
    const points = [];
    const re = /\\s+/g;
    let m;
    while((m = re.exec(text)) !== null){
      const p = m.index + m[0].length;
      if(p > 0 && p < text.length) points.push(p);
    }
    return points;
  }

  function charBreaks(text){
    const points = [];
    for(let i=1;i<text.length;i++) points.push(i);
    return points;
  }

  function maxPrefixAtBreaks(node, text, points){
    if(!points.length) return 0;
    let lo=0, hi=points.length-1, best=0;
    while(lo<=hi){
      const mid=(lo+hi)>>1;
      const pos=points[mid];
      const test=cloneTextNode(node, text.slice(0,pos), 'open');
      measure.appendChild(test);
      const ok=fits();
      test.remove();
      if(ok){
        best=pos;
        lo=mid+1;
      }else{
        hi=mid-1;
      }
    }
    return best;
  }

  function findSplit(node, text){
    let p=maxPrefixAtBreaks(node,text,sentenceBreaks(text));
    if(p>0) return p;
    p=maxPrefixAtBreaks(node,text,phraseBreaks(text));
    if(p>0) return p;
    p=maxPrefixAtBreaks(node,text,wordBreaks(text));
    if(p>0) return p;
    return maxPrefixAtBreaks(node,text,charBreaks(text));
  }

  function finalizePage(){
    if(!measure.children.length) return;
    pages.push(measure.innerHTML);
    measure.replaceChildren();
  }

  function appendAtomic(node){
    let clone=node.cloneNode(true);
    measure.appendChild(clone);
    if(fits()) return true;
    clone.remove();

    if(measure.children.length){
      finalizePage();
    }

    clone=node.cloneNode(true);
    measure.appendChild(clone);
    if(fits()) return true;

    if(node.dataset.kind === 'figure'){
      const img=clone.querySelector('img');
      if(img){
        const minimum = node.hasAttribute('data-cover-figure') ? 52 : 60;
        let maxH = Math.max(minimum, Math.floor(measure.clientHeight * 0.70));
        img.style.maxHeight = maxH + 'px';
        let guard=0;
        while(!fits() && maxH > minimum && guard < 40){
          maxH = Math.max(minimum, Math.floor(maxH * 0.88));
          img.style.maxHeight = maxH + 'px';
          guard++;
        }
      }
    }
    return fits();
  }

  function placeTextNode(original){
    let node=original;
    while(true){
      const full=node.cloneNode(true);
      full.removeAttribute('data-break-before');
      measure.appendChild(full);
      if(fits()) return;
      full.remove();

      if(measure.children.length){
        finalizePage();
        continue;
      }

      const text=node.textContent || '';
      if(!text){
        measure.appendChild(node.cloneNode(true));
        return;
      }

      const split=findSplit(node,text);
      if(split<=0 || split>=text.length){
        measure.appendChild(node.cloneNode(true));
        return;
      }

      const first=cloneTextNode(node,text.slice(0,split),'open');
      measure.appendChild(first);
      finalizePage();

      const rest=cloneTextNode(node,text.slice(split),'cont');
      node=rest;
    }
  }

  function paginate(){
    if(paginating) return;
    paginating=true;
    clearTimeout(layoutTimer);
    applyViewportMetrics();

    requestAnimationFrame(() => {
      const oldCount=pages.length;
      const oldProgress=oldCount>1 ? currentPage/(oldCount-1) : 0;
      pages=[];
      measure.replaceChildren();

      const nodes=Array.from(source.children);
      for(const original of nodes){
        if(original.dataset.breakBefore === 'always' && measure.children.length){
          finalizePage();
        }

        if(original.dataset.atomic === 'true'){
          const ok=appendAtomic(original);
          if(!ok){
            const current=measure.lastElementChild;
            if(current && current.dataset.kind === 'figure'){
              const img=current.querySelector('img');
              if(img) img.style.maxHeight='52px';
            }
          }
        }else{
          placeTextNode(original);
        }
      }
      finalizePage();

      currentPage = pages.length ? Math.min(pages.length-1, Math.max(0, Math.round(oldProgress * Math.max(0,pages.length-1)))) : 0;
      renderPage();
      paginating=false;
      lastMetricsKey = [reader.clientWidth,reader.clientHeight,fontIndex,pages.length].join(':');
    });
  }

  function renderPage(){
    pageEl.innerHTML = pages[currentPage] || '';
    const total=pages.length || 1;
    status.textContent = (pages.length ? currentPage+1 : 0) + ' / ' + total;
    prevBtn.disabled = !pages.length || currentPage<=0;
    nextBtn.disabled = !pages.length || currentPage>=pages.length-1;
    smallerBtn.disabled = fontIndex<=0;
    largerBtn.disabled = fontIndex>=fontScales.length-1;
    pageEl.setAttribute('aria-label', total ? \`\${currentPage+1} / \${total}\` : '');
  }

  function go(delta){
    const next=currentPage+delta;
    if(next<0 || next>=pages.length) return;
    currentPage=next;
    renderPage();
  }

  function schedulePaginate(){
    clearTimeout(layoutTimer);
    layoutTimer=window.setTimeout(paginate,80);
  }

  prevBtn.addEventListener('click',()=>go(-1));
  nextBtn.addEventListener('click',()=>go(1));
  smallerBtn.addEventListener('click',()=>{
    if(fontIndex>0){ fontIndex--; paginate(); }
  });
  largerBtn.addEventListener('click',()=>{
    if(fontIndex<fontScales.length-1){ fontIndex++; paginate(); }
  });

  window.addEventListener('keydown',(e)=>{
    // The shipped reader never has a focused editable element (nothing here is ever
    // contenteditable) — this guard only matters for BookApp.jsx's live preview pane,
    // where #source's text IS made contenteditable for in-place editing. Without it,
    // typing a space or using arrow keys while editing a field flips reader pages out
    // from under you instead of typing the character.
    const ae=document.activeElement;
    if(ae && (ae.isContentEditable || ae.tagName==='INPUT' || ae.tagName==='TEXTAREA')) return;
    if(e.key==='ArrowLeft' || e.key==='PageUp') go(-1);
    else if(e.key==='ArrowRight' || e.key==='PageDown' || e.key===' ') go(1);
  });

  let touchX=null;
  pageEl.addEventListener('touchstart',(e)=>{
    if(e.touches && e.touches.length===1) touchX=e.touches[0].clientX;
  },{passive:true});
  pageEl.addEventListener('touchend',(e)=>{
    if(touchX===null || !e.changedTouches || !e.changedTouches.length) return;
    const dx=e.changedTouches[0].clientX-touchX;
    touchX=null;
    if(Math.abs(dx)>50) go(dx>0 ? -1 : 1);
  },{passive:true});

  window.addEventListener('resize',schedulePaginate,{passive:true});
  window.addEventListener('orientationchange',schedulePaginate,{passive:true});
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize',schedulePaginate,{passive:true});
    window.visualViewport.addEventListener('scroll',schedulePaginate,{passive:true});
  }

  if('ResizeObserver' in window){
    new ResizeObserver(schedulePaginate).observe(reader);
  }

  source.querySelectorAll('img').forEach(img=>{
    img.addEventListener('load',schedulePaginate,{once:true});
  });

  const imageReady=Promise.all(Array.from(source.querySelectorAll('img')).map(img=>{
    if(img.complete && img.naturalWidth) return Promise.resolve();
    if(img.decode) return img.decode().catch(()=>{});
    return new Promise(resolve=>{
      img.addEventListener('load',resolve,{once:true});
      img.addEventListener('error',resolve,{once:true});
    });
  }));

  const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready.catch(()=>{}) : Promise.resolve();

  window.BookReaderDebug = {
    getState:()=>({pages:pages.length,current:currentPage,fontIndex,metrics:lastMetricsKey,reader:{w:reader.clientWidth,h:reader.clientHeight},hostGuard:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--host-bottom-guard'))||0}),
    setFontIndex:(i)=>{fontIndex=clamp(0,Math.round(i),fontScales.length-1);paginate();},
    goTo:(i)=>{currentPage=clamp(0,Math.round(i),Math.max(0,pages.length-1));renderPage();},
    verifyText:()=>{
      const map={};
      const holder=document.createElement('div');
      for(const pageHTML of pages){
        holder.innerHTML=pageHTML;
        holder.querySelectorAll('[data-seq]').forEach(el=>{
          const k=el.getAttribute('data-seq');
          map[k]=(map[k]||'')+(el.textContent||'');
        });
      }
      const expected=JSON.parse(document.getElementById('expectedText').textContent);
      const mismatches=[];
      for(const [k,v] of Object.entries(expected)){
        if((map[k]||'')!==v) mismatches.push({seq:k,expected:v,actual:map[k]||''});
      }
      const extras=Object.keys(map).filter(k=>!(k in expected));
      return {ok:mismatches.length===0 && extras.length===0,mismatches,extras,count:Object.keys(map).length};
    },
    checkOverflow:()=>{
      const over=[];
      const saved=measure.innerHTML;
      pages.forEach((pageHTML,i)=>{
        measure.innerHTML=pageHTML;
        if(!fits()) over.push({page:i+1,scrollHeight:measure.scrollHeight,clientHeight:measure.clientHeight});
      });
      measure.innerHTML=saved;
      return over;
    },
    imageCount:()=>{
      const holder=document.createElement('div');
      let count=0;
      for(const pageHTML of pages){ holder.innerHTML=pageHTML; count+=holder.querySelectorAll('img').length; }
      return count;
    }
  };

  Promise.all([imageReady,fontsReady]).then(()=>{
    applyViewportMetrics();
    requestAnimationFrame(()=>requestAnimationFrame(paginate));
  });
})();
`;

// content: the Codex-curated JSON (see CONTENT_SCHEMA_DESCRIPTION). images: a plain
// object keyed by imageId ("cover", "chapter-0", ...) to PNG Buffers — any key may be
// missing/null, in which case that figure is simply omitted from the export (an
// unfinished book still exports, just without that one illustration).
export function renderBookHtml(content, images, { language } = {}) {
  const dataUris = Object.fromEntries(Object.entries(images || {}).map(([k, buf]) => [k, toDataUri(buf)]));
  const { sourceHtml, expected } = buildSource(content, dataUris);
  const ui = content.ui || {};

  return `<!doctype html>
<html lang="${langCode(language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1">
<title>${esc(content.title)}</title>
<style>${READER_CSS}</style>
</head>
<body>
<div class="app" id="app">
  <header class="topbar">
    <div class="page-status" id="pageStatus" aria-live="polite">0 / 0</div>
    <div class="type-controls" aria-label="${esc(ui.fontControlsAriaLabel || "Font size")}">
      <button class="type-btn" id="smallerBtn" type="button" aria-label="${esc(ui.smallerAriaLabel || "Decrease font size")}">A-</button>
      <button class="type-btn" id="largerBtn" type="button" aria-label="${esc(ui.largerAriaLabel || "Increase font size")}">A+</button>
    </div>
  </header>
  <main class="reader" id="reader">
    <article class="page" id="page" aria-live="polite"></article>
    <div class="page measure" id="measure" aria-hidden="true"></div>
  </main>
  <footer class="navbar">
    <button class="nav-btn nav-prev" id="prevBtn" type="button" disabled>${esc(ui.prev || "Previous")}</button>
    <button class="nav-btn nav-next" id="nextBtn" type="button" disabled>${esc(ui.next || "Next")}</button>
  </footer>
</div>
<div id="source" aria-hidden="true">
${sourceHtml}
</div>
<script type="application/json" id="expectedText">${JSON.stringify(expected)}</script>
<script>${READER_JS}</script>
</body>
</html>
`;
}
