import { newSite, newRow, newElement } from "./siteRender";

// Starting points for a new site. "Book collection" is modeled on the PageBox
// collection pages (hero image, "where to start" theme cards, a shelf of covers, a
// closing note), with placeholder copy and empty image slots to fill in.

const el = (type, props = {}) => ({ ...newElement(type), ...props });
const row = (layout, props, columns) => {
  const r = { ...newRow(layout), ...props };
  r.columns = r.columns.map((c, i) => ({ ...c, elements: columns[i] || [] }));
  return r;
};

const MINT = "#00efa2";
const MINT_SOFT = "#dcfff3";
const BLACK = "#050505";
const SUB = "#5a625e";

function themeCard(label, title, works, desc, quote, bg) {
  return row(
    "2-1",
    {
      stackOnMobile: false,
      bg,
      paddingY: 22,
      paddingX: 22,
      marginY: 8,
      marginX: 28,
      borderWidth: 2,
      borderColor: BLACK,
      valign: "end",
      elementGap: 8,
    },
    [
      [
        el("badge", { text: label, size: 9, bg: bg === MINT_SOFT ? MINT : BLACK, color: bg === MINT_SOFT ? "#000000" : MINT }),
        el("heading", { text: title, level: 3, size: 20 }),
        el("text", { text: works, size: 11.5, color: "#242926", lineHeight: 1.5 }),
        el("text", { text: desc, size: 13, color: SUB, lineHeight: 1.65 }),
        el("quote", { text: quote, size: 13, borderColor: MINT }),
        el("button", { text: "Start reading →", size: 13, bg: BLACK, color: MINT }),
      ],
      [el("image", { alt: `${title} cover` })],
    ]
  );
}

export const SITE_TEMPLATES = [
  {
    id: "blank",
    label: "Blank page",
    desc: "Start from nothing and drag in rows.",
    build: (title) => newSite(title),
  },
  {
    id: "collection",
    label: "Book collection",
    desc: "Hero image, theme cards, a shelf of covers and a closing note — like a PageBox collection page.",
    build: (title) => ({
      ...newSite(title),
      rows: [
        row("1", { paddingY: 0, paddingX: 0, bg: MINT }, [[el("image", { alt: "Main visual" })]]),
        row("1", { paddingY: 54, paddingX: 28 }, [
          [
            el("badge", { text: "START HERE", align: "center" }),
            el("heading", { text: "Not sure\nwhere to start?", level: 2, size: 30, align: "center" }),
            el("text", {
              text: "Pick the question that pulls you in.\nWe'll guide you to the right book.",
              size: 13.5,
              color: SUB,
              align: "center",
            }),
          ],
        ]),
        themeCard("THEME ONE", "If you're curious about what lies beyond", "Book A · Book B · Book C", "One or two lines about what these books explore.", "“A question that hooks the reader?”", "#ffffff"),
        themeCard("THEME TWO", "Where did we come from, and where are we going?", "Book D · Book E", "One or two lines about what these books explore.", "“Another question worth asking?”", MINT_SOFT),
        themeCard("THEME THREE", "If you want to see the everyday differently", "Book F · Book G · Book H", "One or two lines about what these books explore.", "“What if the obvious wasn't?”", "#ffffff"),
        row("1", { paddingY: 48, paddingX: 28 }, [
          [
            el("badge", { text: "FULL COLLECTION", align: "center" }),
            el("heading", { text: "The whole collection", level: 3, size: 24, align: "center" }),
            el("text", { text: "Tap a cover to open that book.", size: 13, color: SUB, align: "center" }),
            el("spacer", { height: 8 }),
            el("gallery", { columns: 3 }),
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
      ],
    }),
  },
];
