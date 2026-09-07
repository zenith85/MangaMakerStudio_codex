// Reconstructs a book project's `content` JSON (see bookPrompt.js's
// CONTENT_SCHEMA_DESCRIPTION) plus its cover/chapter illustrations from an HTML file
// this same app previously exported (see bookTemplate.js's renderBookHtml) — the
// "Import HTML" option on the book landing screen (see BookApp.jsx).
//
// Reads every field back purely by the CSS classes buildSource has always given each
// block (cover-title, chapter-lead, toc-item, ...) plus document order — deliberately
// NOT via the data-field attribute buildSource also now stamps on (that one exists only
// for BookPreviewPane's live in-browser editing). A file exported before data-field
// existed has none of those attributes at all, and importing one of those files with a
// data-field-only reader silently came back with every cover/intro/toc field blank
// (chapters still worked, since they were already parsed positionally) — so importing
// has to stay independent of data-field and work from the classes alone, which every
// export this app has ever produced carries.
//
// Two things genuinely can't be recovered from the exported file, since the template
// never renders them anywhere: each chapter's original AI image-generation prompt
// (only its caption is shown), and the book's free-text "notes for the AI". Both come
// back blank — same as any other project, they're just optional inputs for future
// regeneration, not part of the book's actual content.
import * as cheerio from "cheerio";
import { LANG_CODES } from "./bookTemplate.js";

const CODE_TO_LANGUAGE = Object.fromEntries(
  Object.entries(LANG_CODES).map(([name, code]) => [code, titleCase(name)])
);

function titleCase(key) {
  return key.replace(/(^|\s|\()([a-z])/g, (_, pre, c) => pre + c.toUpperCase());
}

function dataUriToBuffer(uri) {
  const m = /^data:image\/\w+;base64,(.+)$/s.exec(uri || "");
  return m ? Buffer.from(m[1], "base64") : null;
}

export function parseBookHtml(html) {
  const $ = cheerio.load(html);
  const source = $("#source");
  if (!source.length) {
    throw new Error("This doesn't look like an Ibraheem HTML Studio export (no book content found in the file).");
  }

  const one = (selector) => {
    const el = source.find(selector).first();
    return el.length ? el.text().trim() : "";
  };

  const toc = [];
  source.find(".toc-item").each((_, el) => toc.push($(el).text().trim()));

  const chapters = [];
  const chapterImages = []; // parallel to `chapters` — the Buffer for that same index, or null
  const closingSections = [];
  let closing = { title: "", lead: "", sections: [], questionTitle: "", questionText: "" };
  let current = null; // the chapter currently being filled, in document order
  let inClosing = false;

  // #source's children are a flat, ordered list of blocks (see buildSource — nothing is
  // nested per-chapter), so a single pass reconstructs both chapter and closing-section
  // boundaries purely from which marker element (chapter-number / closing-title /
  // analysis-subhead) was most recently seen — including each chapter's own image
  // (only some chapters may have one, so this can't be recovered positionally after
  // the fact; it has to be grabbed right here, still attached to the chapter it follows).
  source.children().each((_, el) => {
    const node = $(el);
    const cls = node.attr("class") || "";
    const text = () => node.text().trim();

    if (cls.includes("chapter-number")) {
      current = { number: text(), title: "", lead: "", paragraphs: [], imagePrompt: "", imageCaption: "" };
      chapters.push(current);
      chapterImages.push(null);
      return;
    }
    if (cls.includes("closing-title")) {
      inClosing = true;
      current = null;
      closing.title = text();
      return;
    }
    if (inClosing) {
      if (cls.includes("closing-lead")) closing.lead = text();
      else if (cls.includes("analysis-subhead")) closingSections.push({ subhead: text(), text: "" });
      else if (cls === "body-text" && closingSections.length) closingSections[closingSections.length - 1].text = text();
      else if (cls.includes("question-title")) closing.questionTitle = text();
      else if (cls.includes("question-text")) closing.questionText = text();
      return;
    }
    if (!current) return; // still in the cover/intro/toc/notice region, already read via field() above
    if (cls.includes("chapter-title")) current.title = text();
    else if (cls.includes("chapter-lead")) current.lead = text();
    else if (cls.includes("body-text")) current.paragraphs.push({ type: cls.includes("quote") ? "quote" : "text", text: text() });
    else if (node.is("figure") && cls.includes("reader-figure")) {
      current.imageCaption = node.find("figcaption").text().trim();
      chapterImages[chapterImages.length - 1] = dataUriToBuffer(node.find("img").attr("src"));
    }
  });
  closing.sections = closingSections;

  if (!chapters.length) {
    throw new Error("This file has no chapters — it may not be an Ibraheem HTML Studio export.");
  }

  const content = {
    kicker: one(".cover-kicker"),
    title: one(".cover-title"),
    originalTitle: one(".cover-original"),
    author: one(".cover-author"),
    tagline: one(".cover-tagline"),
    introTitle: one(".intro-title"),
    introAuthor: one(".intro-author"),
    introSummary: [one(".intro-summary.intro-part"), one(".intro-summary.intro-last")],
    tocTitle: one(".toc-title"),
    toc,
    notice: one(".notice"),
    chapters,
    closing,
    ui: {
      prev: $(".nav-prev").text().trim() || "Previous",
      next: $(".nav-next").text().trim() || "Next",
      fontControlsAriaLabel: $(".type-controls").attr("aria-label") || "Font size",
      smallerAriaLabel: $("#smallerBtn").attr("aria-label") || "Decrease font size",
      largerAriaLabel: $("#largerBtn").attr("aria-label") || "Increase font size",
    },
  };

  const images = { cover: dataUriToBuffer(source.find(".cover-figure img").attr("src")) };
  chapterImages.forEach((buf, i) => {
    images[`chapter-${i}`] = buf;
  });

  const langCode = ($("html").attr("lang") || "en").toLowerCase();
  const language = CODE_TO_LANGUAGE[langCode] || "English";

  return { content, images, language };
}
