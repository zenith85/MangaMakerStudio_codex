// Prompt builders for HTML Shorts Maker — a condensed, illustrated "10-minute read"
// of a book, rendered as one self-contained HTML file (see bookTemplate.js). Two kinds
// of Codex call feed it: one text-curation call that writes the whole structured book
// content as JSON (buildBookContentPrompt), and one image_gen call per illustration
// (buildBookCoverImagePrompt / buildBookChapterImagePrompt).

// Keys match exactly what bookTemplate.js reads and what index.js validates — described
// here once so the content prompt and the validator can't drift apart silently.
const CONTENT_SCHEMA_DESCRIPTION = `{
  "kicker": string,            // small eyebrow line above the title, e.g. "10-MINUTE READ"
  "title": string,             // the book's title, in the target language (transliterated/translated if needed)
  "originalTitle": string,     // the book's original-language title; omit or repeat "title" if they'd be identical
  "author": string,            // author's name, in the target language
  "tagline": string,           // one-sentence hook for the cover, in the target language
  "introTitle": string,        // usually just the title again, shown atop the intro block
  "introAuthor": string,       // e.g. "by <author>", in the target language
  "introSummary": [string, string], // exactly two short paragraphs setting up premise + stakes, in the target language
  "tocTitle": string,          // heading for the table of contents, e.g. "Contents", in the target language
  "toc": [string, ...],        // one line per chapter ("01  <chapter title>", ...) plus a final closing entry, in the target language
  "notice": string,            // one short content note, in the target language (e.g. spoiler warning)
  "chapters": [
    {
      "number": string,        // "01", "02", ...
      "title": string,
      "lead": string,          // one-sentence italic hook under the chapter title
      "paragraphs": [
        { "type": "text", "text": string } |
        { "type": "quote", "text": string }   // a short, striking line of dialogue/narration, quotation-marked
      ],
      "imagePrompt": string,   // vivid, concrete visual description (setting, characters, action, mood) of ONE key moment in this chapter, for an illustrator — in ENGLISH regardless of target language, since it only ever reaches an image model
      "imageCaption": string   // one sentence, in the target language, caption for that illustration
    }, ...
  ],
  "closing": {
    "title": string,           // e.g. "Closing thoughts"
    "lead": string,            // one-sentence takeaway line
    "sections": [ { "subhead": string, "text": string }, ... ], // 3-4 short analysis sections
    "questionTitle": string,   // e.g. "One last question"
    "questionText": string     // one open reflective question for the reader
  },
  "ui": {
    "prev": string,            // "Previous"-style label for the reader's back button, short, in the target language
    "next": string,            // "Next"-style label for the reader's forward button, short, in the target language
    "fontControlsAriaLabel": string, // accessible label for the font-size control group, in the target language
    "smallerAriaLabel": string,      // accessible label for "decrease font size", in the target language
    "largerAriaLabel": string        // accessible label for "increase font size", in the target language
  }
}`;

// `notes` is the user's own free-text guidance (see BookApp.jsx's "Notes for the AI"
// field) — the one place the user actually steers what gets generated, rather than
// title/author alone silently going straight to Codex.
export function buildBookContentPrompt({ title, author, language, chapterCount, notes }) {
  const byline = author?.trim() ? ` by ${author.trim()}` : "";
  const notesLine = notes?.trim()
    ? `\n\nThe author of this edition also left this guidance — follow it wherever it doesn't conflict with the ` +
      `requirements above: ${notes.trim()}`
    : "";
  return (
    `You are curating a condensed, "10-minute read" illustrated edition of the book "${title.trim()}"${byline}, ` +
    `entirely in ${language}. Write EVERY string value in ${language} (natural, well-written prose for a general ` +
    `reader) EXCEPT each chapter's "imagePrompt", which must stay in English. Draw on your own knowledge of the ` +
    `book; if you are not confident of the real book's plot or author, do your best to still produce a coherent, ` +
    `well-written, and clearly-labeled condensation rather than refusing. Split the story into ${chapterCount} ` +
    `chapters, each with 3-5 paragraphs (mostly "text", with at most one short "quote" per chapter — omit the ` +
    `quote entirely for chapters where nothing is worth quoting directly) — flowing narrative prose that reads ` +
    `like a well-written condensation, not a bulleted plot summary. The closing section should offer genuine ` +
    `literary analysis (themes, symbols, why the ending matters), not just a recap.${notesLine}\n\n` +
    `Write a single JSON object with exactly this shape (all fields required, in this exact key structure):\n${CONTENT_SCHEMA_DESCRIPTION}`
  );
}

const ILLUSTRATION_STYLE_SUFFIX = {
  bw_illustration:
    "Render as a detailed black-and-white cross-hatched ink illustration — cinematic single scene, moody " +
    "lighting, fine linework, literary/editorial book-illustration style. No text, no lettering, no panel borders.",
  color_illustration:
    "Render as a full-color painterly editorial illustration — cinematic single scene, moody lighting, rich " +
    "brushwork, literary book-illustration style. No text, no lettering, no panel borders.",
  realistic:
    "Render as a photorealistic photograph — cinematic single scene, natural moody lighting, real textures and " +
    "materials, like a still frame from a live-action film. No text, no lettering, no panel borders, no " +
    "illustrative linework or stylization of any kind.",
};

// imagePrompt is the user's own override (see BookApp.jsx's Cover card — a manual
// English scene description, the same idea as each chapter's Codex-authored
// imagePrompt) — when blank, falls back to the auto-built title/tagline scene this
// always used before that field existed.
export function buildBookCoverImagePrompt({ title, tagline, style, imagePrompt }) {
  const scene =
    imagePrompt?.trim() ||
    `A cover illustration for a book titled "${title}". Mood/theme: ${tagline}. A single evocative image that ` +
      `captures the book's central image or feeling — no title text, no lettering, no book-cover layout, just the ` +
      `illustrated scene itself.`;
  return `${scene} ${ILLUSTRATION_STYLE_SUFFIX[style] || ILLUSTRATION_STYLE_SUFFIX.bw_illustration}`;
}

export function buildBookChapterImagePrompt({ imagePrompt, style }) {
  return `${imagePrompt.trim()} ${ILLUSTRATION_STYLE_SUFFIX[style] || ILLUSTRATION_STYLE_SUFFIX.bw_illustration}`;
}
