import { newSite, newRow, newElement, newGalleryItem } from "./siteRender";
import { HERO_ART, coverArt, shelfItems } from "./siteArt";

// Starting points for a new site — all in the shape of the PageBox book-promotion pages:
// a single 720px mobile column with a hero, books presented with a "read" button each, a
// shelf of covers, and a closing note. Each style has its own palette, typography and
// purpose (collection guide, author spotlight, seasonal event, ranking chart, short-read
// curation, editorial review) and ships with placeholder art (siteArt.js) so it looks
// finished the moment it's created. Copy is placeholder text to replace; book buttons
// start with no action until a PageBox book code is set.

const el = (type, props = {}) => ({ ...newElement(type), ...props });
const row = (layout, props, columns) => {
  const r = { ...newRow(layout), ...props };
  r.columns = r.columns.map((c, i) => ({ ...c, elements: columns[i] || [] }));
  return r;
};
const site = (title, settings, rows) => {
  const s = newSite(title);
  return { ...s, settings: { ...s.settings, ...settings }, rows };
};
const hero = (src, bg) => row("1", { paddingY: 0, paddingX: 0, bg }, [[el("image", { src, alt: "Main visual" })]]);
const shelf = (palettes, count, props = {}) =>
  el("gallery", {
    columns: 3,
    items: shelfItems(palettes, count, (src, i) => ({ ...newGalleryItem(), src, title: `Book Title ${i + 1}` })),
    ...props,
  });

// ---------- Mint Compass (the original "Book collection") ----------

const MINT = "#00efa2";
const MINT_SOFT = "#dcfff3";
const BLACK = "#050505";
const SUB = "#5a625e";

function mintCard(label, title, works, desc, quote, bg, coverIndex) {
  return row(
    "2-1",
    { stackOnMobile: false, bg, paddingY: 22, paddingX: 22, marginY: 8, marginX: 28, borderWidth: 2, borderColor: BLACK, valign: "end", elementGap: 8 },
    [
      [
        el("badge", { text: label, size: 9, bg: bg === MINT_SOFT ? MINT : BLACK, color: bg === MINT_SOFT ? "#000000" : MINT }),
        el("heading", { text: title, level: 3, size: 20 }),
        el("text", { text: works, size: 11.5, color: "#242926", lineHeight: 1.5 }),
        el("text", { text: desc, size: 13, color: SUB, lineHeight: 1.65 }),
        el("quote", { text: quote, size: 13, borderColor: MINT }),
        el("button", { text: "Start reading →", size: 13, bg: BLACK, color: MINT }),
      ],
      [el("image", { alt: `${title} cover`, src: coverArt({ ...MINT_COVERS[coverIndex % MINT_COVERS.length], label: "BOOK", motif: coverIndex }) })],
    ]
  );
}
const MINT_COVERS = [
  { bg: "#050505", fg: "#00efa2", accent: "#00efa2" },
  { bg: "#dcfff3", fg: "#050505", accent: "#050505" },
  { bg: "#00efa2", fg: "#050505", accent: "#ffffff" },
];

const mintCompass = (title) =>
  site(title, { pageBg: "#dfe4e1" }, [
    hero(HERO_ART.mint, MINT),
    row("1", { paddingY: 54, paddingX: 28 }, [
      [
        el("badge", { text: "START HERE", align: "center" }),
        el("heading", { text: "Not sure\nwhere to start?", level: 2, size: 30, align: "center" }),
        el("text", { text: "Pick the question that pulls you in.\nWe'll guide you to the right book.", size: 13.5, color: SUB, align: "center" }),
      ],
    ]),
    mintCard("THEME ONE", "If you're curious about what lies beyond", "Book A · Book B · Book C", "One or two lines about what these books explore.", "“A question that hooks the reader?”", "#ffffff", 0),
    mintCard("THEME TWO", "Where did we come from, and where are we going?", "Book D · Book E", "One or two lines about what these books explore.", "“Another question worth asking?”", MINT_SOFT, 1),
    mintCard("THEME THREE", "If you want to see the everyday differently", "Book F · Book G · Book H", "One or two lines about what these books explore.", "“What if the obvious wasn't?”", "#ffffff", 2),
    row("1", { paddingY: 48, paddingX: 28 }, [
      [
        el("badge", { text: "FULL COLLECTION", align: "center" }),
        el("heading", { text: "The whole collection", level: 3, size: 24, align: "center" }),
        el("text", { text: "Tap a cover to open that book.", size: 13, color: SUB, align: "center" }),
        el("spacer", { height: 8 }),
        shelf(MINT_COVERS, 6),
      ],
    ]),
    row("1", { paddingY: 56, paddingX: 28, bg: BLACK }, [
      [
        el("text", { text: "AUTHOR × PAGEBOX", size: 10, color: MINT, align: "center", lineHeight: 1.4 }),
        el("heading", { text: "Open one question,\nand a new world begins.", level: 3, size: 22, color: "#ffffff", align: "center" }),
        el("text", { text: "Start with the story you're most curious about.", size: 13, color: "#b9c2bd", align: "center" }),
        el("text", { text: "PAGEBOX", size: 10, color: "#6f7a74", align: "center", lineHeight: 1.4 }),
      ],
    ]),
  ]);

// ---------- Midnight Library — author spotlight, navy & gold, serif ----------

const NAVY = "#0e1726";
const NAVY_2 = "#16233c";
const GOLD = "#d4af6a";
const CREAM = "#f3efe6";
const MIST = "#9aa4b5";
const MIDNIGHT_COVERS = [
  { bg: "#16233c", fg: GOLD, accent: GOLD },
  { bg: GOLD, fg: NAVY, accent: NAVY },
  { bg: "#2a1f3d", fg: CREAM, accent: GOLD },
];

function midnightFeature(reverse, label, coverIndex) {
  const text = [
    el("badge", { text: label, size: 9, bg: GOLD, color: NAVY }),
    el("heading", { text: "Featured Book Title", level: 3, size: 22, color: CREAM }),
    el("text", { text: "Two lines on why this is the book to start with — its mood, its idea, the reader it suits.", size: 13, color: MIST, lineHeight: 1.7 }),
    el("button", { text: "Read now →", size: 13, bg: GOLD, color: NAVY, radius: 30 }),
  ];
  const cover = [el("image", { alt: "Cover", radius: 6, src: coverArt({ ...MIDNIGHT_COVERS[coverIndex], label: "BOOK", motif: coverIndex + 2 }) })];
  return row(
    reverse ? "2-1" : "1-2",
    { stackOnMobile: false, bg: NAVY_2, paddingY: 24, paddingX: 24, marginY: 10, marginX: 24, radius: 14, borderWidth: 1, borderColor: "#2a3650", valign: "center", gap: 22, elementGap: 10 },
    reverse ? [text, cover] : [cover, text]
  );
}

const midnightLibrary = (title) =>
  site(title, { pageBg: "#070c16", contentBg: NAVY, textColor: CREAM, font: "serif" }, [
    hero(HERO_ART.midnight, NAVY),
    row("1", { paddingY: 52, paddingX: 32 }, [
      [
        el("badge", { text: "AUTHOR SPOTLIGHT", align: "center", bg: GOLD, color: NAVY }),
        el("heading", { text: "Inside the Author's\nNight Library", level: 1, size: 34, color: CREAM, align: "center", weight: 700 }),
        el("text", { text: "One writer, every world they built.\nA guided way into their books, starting tonight.", size: 14, color: MIST, align: "center" }),
      ],
    ]),
    row("1", { paddingY: 36, paddingX: 40, bg: "#121d30" }, [
      [
        el("quote", { text: "“A line from the author that sets the mood for everything that follows.”", size: 19, color: CREAM, borderColor: GOLD }),
        el("text", { text: "— Author Name", size: 13, color: GOLD, align: "right" }),
      ],
    ]),
    row("1", { paddingY: 28, paddingX: 28 }, [[el("heading", { text: "Where to begin", level: 3, size: 15, color: GOLD, align: "center", weight: 700 })]]),
    midnightFeature(false, "START WITH THIS", 0),
    midnightFeature(true, "THEN TRY THIS", 1),
    row("1", { paddingY: 48, paddingX: 28 }, [
      [
        el("badge", { text: "THE COMPLETE SHELF", align: "center", bg: "#1d2c48", color: GOLD }),
        el("heading", { text: "Every book, in one place", level: 3, size: 22, color: CREAM, align: "center", weight: 700 }),
        el("spacer", { height: 6 }),
        shelf(MIDNIGHT_COVERS, 6, { titleSize: 12 }),
      ],
    ]),
    row("1", { paddingY: 48, paddingX: 32, bg: "#070c16" }, [
      [
        el("divider", { color: GOLD, thickness: 1 }),
        el("spacer", { height: 10 }),
        el("heading", { text: "The night is long.\nStart one more chapter.", level: 3, size: 21, color: CREAM, align: "center", weight: 700 }),
        el("text", { text: "AUTHOR × PAGEBOX", size: 10, color: GOLD, align: "center", lineHeight: 1.4 }),
      ],
    ]),
  ]);

// ---------- Paper Lantern — seasonal reading event, cream & vermilion ----------

const PAPER = "#fbf3e4";
const VERMILION = "#e2533b";
const INK = "#2b2118";
const OLIVE = "#6b7d4f";
const SAND = "#f4e6cc";
const LANTERN_COVERS = [
  { bg: VERMILION, fg: PAPER, accent: "#f6a34b" },
  { bg: OLIVE, fg: PAPER, accent: PAPER },
  { bg: SAND, fg: INK, accent: VERMILION },
  { bg: INK, fg: PAPER, accent: VERMILION },
];

const step = (n, title, text) => [
  el("heading", { text: n, level: 3, size: 30, color: VERMILION, align: "center", weight: 900 }),
  el("heading", { text: title, level: 4, size: 15, color: INK, align: "center", weight: 800 }),
  el("text", { text, size: 12, color: "#6d5f52", align: "center", lineHeight: 1.6 }),
];
const lanternPick = (i) => [
  el("image", { alt: "Cover", radius: 8, width: 82, align: "left", src: coverArt({ ...LANTERN_COVERS[i], label: "BOOK", motif: i + 1 }) }),
  el("heading", { text: "Event Pick Title", level: 4, size: 16, color: INK, weight: 800 }),
  el("text", { text: "One line on why it fits a long autumn night.", size: 12, color: "#6d5f52", lineHeight: 1.55 }),
  el("button", { text: "Read →", size: 12, bg: INK, color: PAPER, radius: 30 }),
];

const paperLantern = (title) =>
  site(title, { pageBg: "#efe2c9", contentBg: PAPER, textColor: INK, font: "rounded" }, [
    hero(HERO_ART.lantern, PAPER),
    row("1", { paddingY: 44, paddingX: 28 }, [
      [
        el("badge", { text: "AUTUMN READING FESTIVAL", align: "center", bg: VERMILION, color: "#ffffff" }),
        el("heading", { text: "Long nights,\ngood books.", level: 1, size: 36, color: INK, align: "center", weight: 900 }),
        el("text", { text: "OCT 1 – OCT 31 · Every book in this collection", size: 13, color: OLIVE, align: "center" }),
        el("spacer", { height: 4 }),
        el("button", { text: "Join the event →", size: 15, bg: VERMILION, color: "#ffffff", radius: 30, align: "center" }),
      ],
    ]),
    row("1-1-1", { stackOnMobile: false, bg: SAND, paddingY: 32, paddingX: 20, gap: 12, elementGap: 6 }, [
      step("01", "Pick a book", "Choose any title from the lantern shelf."),
      step("02", "Read a chapter", "Finish the first chapter before the 31st."),
      step("03", "Get a gift", "Unlock a bonus story for every book."),
    ]),
    row("1", { paddingY: 40, paddingX: 28, elementGap: 6 }, [
      [
        el("heading", { text: "This season's picks", level: 2, size: 24, color: INK, align: "center", weight: 900 }),
        el("text", { text: "Chosen by our editors for the season.", size: 13, color: OLIVE, align: "center" }),
      ],
    ]),
    row("1-1", { stackOnMobile: false, paddingY: 0, paddingX: 28, gap: 18, elementGap: 8 }, [lanternPick(0), lanternPick(1)]),
    row("1", { paddingY: 44, paddingX: 28 }, [
      [
        el("divider", { color: VERMILION, thickness: 2 }),
        el("spacer", { height: 8 }),
        el("heading", { text: "More lantern picks", level: 3, size: 20, color: INK, align: "center", weight: 800 }),
        shelf(LANTERN_COVERS, 8, { columns: 4, gap: 10, titleSize: 11 }),
      ],
    ]),
    row("1", { paddingY: 52, paddingX: 28, bg: VERMILION }, [
      [
        el("heading", { text: "See you under\nthe lantern light.", level: 3, size: 24, color: "#ffffff", align: "center", weight: 900 }),
        el("text", { text: "The festival ends Oct 31 — start tonight.", size: 13, color: "#ffe1d6", align: "center" }),
      ],
    ]),
  ]);

// ---------- Neon Ranking — weekly bestseller chart, black & hot pink ----------

const PINK = "#ff2e88";
const CYAN = "#2ee6ff";
const NIGHT = "#111111";
const GREY = "#9a9a9a";
const NEON_COVERS = [
  { bg: "#1c1c1c", fg: PINK, accent: PINK },
  { bg: PINK, fg: "#0a0a0a", accent: "#0a0a0a" },
  { bg: "#1c1c1c", fg: CYAN, accent: CYAN },
  { bg: CYAN, fg: "#0a0a0a", accent: "#0a0a0a" },
];

const rankRow = (rank) =>
  row(
    "1-2",
    { stackOnMobile: false, bg: rank === 1 ? "#1d0b15" : NIGHT, paddingY: 18, paddingX: 24, valign: "center", gap: 20, elementGap: 6, borderWidth: rank === 1 ? 2 : 0, borderColor: PINK, marginX: rank === 1 ? 16 : 0, marginY: rank === 1 ? 8 : 0, radius: rank === 1 ? 12 : 0 },
    [
      [el("image", { alt: "Cover", radius: 6, src: coverArt({ ...NEON_COVERS[rank % NEON_COVERS.length], label: `#${rank}`, motif: rank }) })],
      [
        el("heading", { text: `#${rank}`, level: 3, size: rank === 1 ? 40 : 30, color: rank === 1 ? PINK : CYAN, weight: 900 }),
        el("heading", { text: "Book Title Goes Here", level: 4, size: 18, color: "#ffffff", weight: 800 }),
        el("text", { text: "Author Name · Genre", size: 12, color: GREY, lineHeight: 1.4 }),
        el("button", { text: "Read →", size: 12, bg: PINK, color: "#ffffff", radius: 30 }),
      ],
    ]
  );

const neonRanking = (title) =>
  site(title, { pageBg: "#000000", contentBg: NIGHT, textColor: "#ffffff", font: "system" }, [
    hero(HERO_ART.neon, "#0a0a0a"),
    row("1", { paddingY: 44, paddingX: 28 }, [
      [
        el("badge", { text: "THIS WEEK", align: "center", bg: PINK, color: "#ffffff" }),
        el("heading", { text: "TOP 5\nRIGHT NOW", level: 1, size: 46, color: "#ffffff", align: "center", weight: 900 }),
        el("text", { text: "The most-read books this week.\nUpdated every Monday.", size: 13.5, color: GREY, align: "center" }),
      ],
    ]),
    rankRow(1),
    rankRow(2),
    row("1", { paddingY: 0, paddingX: 24 }, [[el("divider", { color: "#262626", thickness: 1 })]]),
    rankRow(3),
    row("1", { paddingY: 0, paddingX: 24 }, [[el("divider", { color: "#262626", thickness: 1 })]]),
    rankRow(4),
    row("1", { paddingY: 0, paddingX: 24 }, [[el("divider", { color: "#262626", thickness: 1 })]]),
    rankRow(5),
    row("1", { paddingY: 44, paddingX: 24 }, [
      [
        el("badge", { text: "#6 – #15", align: "center", bg: "#1c1c1c", color: CYAN }),
        el("heading", { text: "Still climbing", level: 3, size: 22, color: "#ffffff", align: "center", weight: 900 }),
        shelf(NEON_COVERS, 10, { columns: 5, gap: 8, showTitles: false }),
      ],
    ]),
    row("1", { paddingY: 40, paddingX: 28, bg: "#000000" }, [
      [el("text", { text: "RANKINGS BY PAGEBOX · UPDATED WEEKLY", size: 10, color: PINK, align: "center", lineHeight: 1.4 })],
    ]),
  ]);

// ---------- Sunday Brunch — soft pastel short-read curation ----------

const PEACH = "#ffe8dc";
const CORAL = "#ff7a59";
const SAGE = "#8fb39a";
const COCOA = "#3d2c29";
const BRUNCH_COVERS = [
  { bg: CORAL, fg: "#fffaf6", accent: "#ffd2bf" },
  { bg: SAGE, fg: "#fffaf6", accent: "#fffaf6" },
  { bg: "#ffd2bf", fg: COCOA, accent: CORAL },
];

const brunchPair = (reverse, i) => {
  const image = [el("image", { alt: "Cover", radius: 20, width: 84, src: coverArt({ ...BRUNCH_COVERS[i], label: "BOOK", motif: i + 3 }) })];
  const text = [
    el("badge", { text: i === 0 ? "5 MIN" : "8 MIN", size: 9, bg: SAGE, color: "#ffffff" }),
    el("heading", { text: "A Short Read Title", level: 3, size: 21, color: COCOA, weight: 800 }),
    el("text", { text: "A gentle two-line teaser — the kind of story that fits between coffee and the first plans of the day.", size: 13, color: "#7a625c", lineHeight: 1.7 }),
    el("button", { text: "Read with coffee →", size: 13, bg: CORAL, color: "#ffffff", radius: 30 }),
  ];
  return row("1-1", { stackOnMobile: true, paddingY: 22, paddingX: 28, valign: "center", gap: 24, elementGap: 10 }, reverse ? [text, image] : [image, text]);
};

const sundayBrunch = (title) =>
  site(title, { pageBg: PEACH, contentBg: "#fffaf6", textColor: COCOA, font: "rounded" }, [
    hero(HERO_ART.brunch, PEACH),
    row("1", { paddingY: 44, paddingX: 28 }, [
      [
        el("badge", { text: "5-MINUTE READS", align: "center", bg: SAGE, color: "#ffffff" }),
        el("heading", { text: "Slow Sunday,\nshort stories.", level: 1, size: 34, color: COCOA, align: "center", weight: 800 }),
        el("text", { text: "Little books for a long breakfast.\nEach one finishes before your coffee does.", size: 14, color: "#7a625c", align: "center" }),
      ],
    ]),
    row("1", { bg: "#fff1e8", paddingY: 30, paddingX: 30, marginX: 24, marginY: 6, radius: 24 }, [
      [
        el("quote", { text: "“A soft, memorable line from one of this week's short reads.”", size: 19, color: COCOA, borderColor: CORAL }),
        el("text", { text: "— from A Short Read Title", size: 12.5, color: CORAL, align: "right" }),
      ],
    ]),
    brunchPair(false, 0),
    brunchPair(true, 1),
    row("1", { paddingY: 40, paddingX: 28 }, [
      [
        el("heading", { text: "More for the weekend", level: 3, size: 21, color: COCOA, align: "center", weight: 800 }),
        el("spacer", { height: 4 }),
        shelf(BRUNCH_COVERS, 6, { ratio: "3/4", gap: 14 }),
      ],
    ]),
    row("1", { paddingY: 48, paddingX: 28, bg: SAGE }, [
      [
        el("heading", { text: "Have a slow Sunday.", level: 3, size: 23, color: "#ffffff", align: "center", weight: 800 }),
        el("text", { text: "New short reads every weekend.", size: 13, color: "#eef5f0", align: "center" }),
      ],
    ]),
  ]);

// ---------- Front Page — editorial review, newspaper black & white with red ----------

const NEWSPRINT = "#fdfcf8";
const PRESS_INK = "#111111";
const PRESS_RED = "#c8102e";
const PRESS_GREY = "#555555";
const PRESS_COVERS = [
  { bg: PRESS_INK, fg: NEWSPRINT, accent: PRESS_RED },
  { bg: "#e6e3da", fg: PRESS_INK, accent: PRESS_INK },
  { bg: PRESS_RED, fg: NEWSPRINT, accent: NEWSPRINT },
];
const reviewCard = (i) => [
  el("image", { alt: "Cover", src: coverArt({ ...PRESS_COVERS[i], label: "BOOK", motif: i }) }),
  el("heading", { text: "Reviewed Title", level: 4, size: 15, color: PRESS_INK, weight: 800 }),
  el("text", { text: "A one-line verdict from our editor.", size: 12, color: PRESS_GREY, lineHeight: 1.5 }),
  el("button", { text: "Read →", size: 12, bg: PRESS_INK, color: NEWSPRINT }),
];

const frontPage = (title) =>
  site(title, { pageBg: "#e9e7e0", contentBg: NEWSPRINT, textColor: PRESS_INK, font: "serif" }, [
    row("1", { paddingY: 30, paddingX: 28, elementGap: 8 }, [
      [
        el("text", { text: "VOL. 1 · NO. 1 · THE PAGEBOX REVIEW", size: 10, color: PRESS_GREY, align: "center", lineHeight: 1.4 }),
        el("heading", { text: "THE WEEKLY REVIEW", level: 1, size: 40, color: PRESS_INK, align: "center", weight: 900 }),
        el("divider", { color: PRESS_INK, thickness: 4 }),
        el("text", { text: "MONDAY EDITION · EDITOR'S PICKS · 4 BOOKS", size: 10.5, color: PRESS_INK, align: "center", lineHeight: 1.4 }),
        el("divider", { color: PRESS_INK, thickness: 1 }),
      ],
    ]),
    row("1", { paddingY: 6, paddingX: 28, elementGap: 10 }, [
      [
        el("badge", { text: "COVER STORY", bg: PRESS_RED, color: "#ffffff" }),
        el("heading", { text: "A headline about this week's big book, set in two lines", level: 2, size: 28, color: PRESS_INK, weight: 900 }),
        el("text", { text: "By Editor Name", size: 12, color: PRESS_GREY, lineHeight: 1.4 }),
        el("image", { alt: "Cover story visual", src: HERO_ART.paper }),
      ],
    ]),
    row("1-1", { stackOnMobile: true, paddingY: 22, paddingX: 28, gap: 26, elementGap: 12 }, [
      [
        el("text", { text: "The opening paragraph of the review: what the book is, who wrote it, and why it matters this week. Keep it to three or four sentences.", size: 14.5, color: PRESS_INK, lineHeight: 1.8 }),
        el("text", { text: "A second paragraph with the editor's take — what works, what surprised, and who should read it first.", size: 14.5, color: PRESS_INK, lineHeight: 1.8 }),
      ],
      [
        el("quote", { text: "“A pull quote from the book that makes the reader stop scrolling.”", size: 18, color: PRESS_INK, borderColor: PRESS_RED }),
        el("button", { text: "Read the book →", size: 13, bg: PRESS_INK, color: NEWSPRINT, fullWidth: true }),
      ],
    ]),
    row("1", { paddingY: 14, paddingX: 28, elementGap: 10 }, [
      [el("divider", { color: PRESS_INK, thickness: 2 }), el("badge", { text: "ALSO REVIEWED", bg: PRESS_INK, color: NEWSPRINT })],
    ]),
    row("1-1-1", { stackOnMobile: false, paddingY: 8, paddingX: 28, gap: 14, elementGap: 8 }, [reviewCard(0), reviewCard(1), reviewCard(2)]),
    row("1", { paddingY: 36, paddingX: 28, elementGap: 8 }, [
      [
        el("divider", { color: PRESS_INK, thickness: 1 }),
        el("text", { text: "© THE PAGEBOX REVIEW · ALL BOOKS AVAILABLE ON PAGEBOX", size: 10, color: PRESS_GREY, align: "center", lineHeight: 1.4 }),
      ],
    ]),
  ]);

// ---------- The list ----------

// `id`s are stored nowhere (a site is just its rows once created), but "collection" is
// kept for the original template so the landing's default pick stays the same.
export const SITE_TEMPLATES = [
  { id: "blank", label: "Blank page", desc: "Start from nothing and drag in rows.", build: (title) => newSite(title) },
  {
    id: "collection",
    label: "Mint Compass",
    desc: "Collection guide — hero, “where to start” theme cards, a shelf of covers and a closing note.",
    build: mintCompass,
  },
  {
    id: "midnight",
    label: "Midnight Library",
    desc: "Author spotlight — navy and gold, an opening quote, featured books and the full shelf.",
    build: midnightLibrary,
  },
  {
    id: "lantern",
    label: "Paper Lantern",
    desc: "Seasonal reading event — dates, three easy steps, editor's picks and a festival shelf.",
    build: paperLantern,
  },
  {
    id: "neon",
    label: "Neon Ranking",
    desc: "Weekly bestseller chart — a ranked top 5 with covers, then the rest of the chart.",
    build: neonRanking,
  },
  {
    id: "brunch",
    label: "Sunday Brunch",
    desc: "Soft short-read curation — a pull quote, cozy picks side by side, pastel tones.",
    build: sundayBrunch,
  },
  {
    id: "frontpage",
    label: "Front Page",
    desc: "Editorial review — a newspaper front page with a cover story and reviewed books.",
    build: frontPage,
  },
];
