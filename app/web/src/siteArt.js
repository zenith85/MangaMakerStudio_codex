// Placeholder artwork for Site Builder templates — small inline SVGs (as data: URIs) in
// each template's own palette, so a freshly created site looks like a finished page
// instead of a page of empty image boxes. They're ordinary image sources: replacing one
// is the same as replacing any image, and Export embeds them like uploads (see
// SiteApp.jsx's collectAssetUrls). Deliberately text-free in the heroes (the page's own
// headings carry the words) and generic on the covers ("BOOK 1"), so nothing reads as
// a real title.

const svgUri = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s+/g, " ").trim())}`;

// A book cover: flat background, a framed panel, a simple motif and a short label.
// `motif` picks the decoration so a shelf of covers doesn't look copy-pasted.
export function coverArt({ bg, fg, accent, label, motif = 0 }) {
  const motifs = [
    `<circle cx="100" cy="128" r="38" fill="${accent}"/>`,
    `<path d="M60 160 L100 92 L140 160 Z" fill="${accent}"/>`,
    `<rect x="64" y="96" width="72" height="72" rx="6" fill="${accent}" transform="rotate(12 100 132)"/>`,
    `<path d="M56 150 Q100 70 144 150" stroke="${accent}" stroke-width="10" fill="none" stroke-linecap="round"/>`,
    `<g fill="${accent}"><circle cx="76" cy="118" r="14"/><circle cx="124" cy="118" r="14"/><circle cx="100" cy="152" r="14"/></g>`,
    `<path d="M100 88 L112 122 L148 122 L119 143 L130 178 L100 157 L70 178 L81 143 L52 122 L88 122 Z" fill="${accent}"/>`,
  ];
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" width="400" height="600">
    <rect width="200" height="300" fill="${bg}"/>
    <rect x="14" y="14" width="172" height="272" fill="none" stroke="${fg}" stroke-opacity=".35" stroke-width="2"/>
    ${motifs[motif % motifs.length]}
    <rect x="44" y="214" width="112" height="3" fill="${fg}" opacity=".6"/>
    <text x="100" y="250" text-anchor="middle" font-family="Georgia, serif" font-size="20" font-weight="700" fill="${fg}" letter-spacing="2">${label}</text>
  </svg>`);
}

// A row of covers for a template's book shelf, cycling through `palettes`.
export function shelfItems(palettes, count, makeItem) {
  return Array.from({ length: count }, (_, i) => {
    const p = palettes[i % palettes.length];
    return makeItem(coverArt({ ...p, label: `BOOK ${i + 1}`, motif: i }), i);
  });
}

const HERO_W = 720;
const HERO_H = 420;
const hero = (body) =>
  svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${HERO_W} ${HERO_H}" width="1440" height="840">${body}</svg>`);

// One hero illustration per template, each in that template's palette.
export const HERO_ART = {
  mint: hero(`
    <rect width="720" height="420" fill="#00efa2"/>
    <circle cx="560" cy="120" r="150" fill="#00d690"/>
    <circle cx="140" cy="360" r="120" fill="#5cffc8"/>
    <g transform="translate(360 210)">
      <circle r="92" fill="#050505"/>
      <circle r="78" fill="none" stroke="#00efa2" stroke-width="3"/>
      <path d="M0 -62 L16 0 L0 62 L-16 0 Z" fill="#00efa2"/>
      <circle r="8" fill="#050505" stroke="#00efa2" stroke-width="3"/>
    </g>`),
  midnight: hero(`
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16233c"/><stop offset="1" stop-color="#0e1726"/></linearGradient></defs>
    <rect width="720" height="420" fill="url(#g)"/>
    <circle cx="520" cy="130" r="70" fill="#d4af6a"/>
    <circle cx="548" cy="112" r="66" fill="#16233c"/>
    <g fill="#d4af6a" opacity=".8"><circle cx="90" cy="70" r="2.5"/><circle cx="210" cy="120" r="2"/><circle cx="330" cy="60" r="3"/><circle cx="640" cy="260" r="2"/><circle cx="420" cy="90" r="1.8"/><circle cx="150" cy="200" r="1.8"/></g>
    <g fill="#1d2c48"><rect x="60" y="250" width="44" height="170"/><rect x="108" y="220" width="36" height="200"/><rect x="148" y="270" width="52" height="150"/><rect x="204" y="236" width="30" height="184"/><rect x="238" y="290" width="48" height="130"/></g>
    <g fill="#d4af6a" opacity=".55"><rect x="68" y="262" width="28" height="4"/><rect x="114" y="232" width="24" height="4"/><rect x="156" y="282" width="36" height="4"/></g>`),
  lantern: hero(`
    <rect width="720" height="420" fill="#fbf3e4"/>
    <path d="M0 70 Q360 140 720 70" stroke="#2b2118" stroke-width="2" fill="none"/>
    <g>${[120, 260, 400, 540, 650]
      .map(
        (x, i) =>
          `<g transform="translate(${x} ${92 + (i % 2) * 22})"><line x1="0" y1="-20" x2="0" y2="0" stroke="#2b2118" stroke-width="2"/><ellipse cx="0" cy="44" rx="${34 - (i % 2) * 6}" ry="${46 - (i % 2) * 6}" fill="#e2533b"/><rect x="-12" y="-2" width="24" height="8" fill="#2b2118"/><ellipse cx="0" cy="44" rx="${14 - (i % 2) * 3}" ry="${30 - (i % 2) * 4}" fill="#f6a34b" opacity=".75"/></g>`
      )
      .join("")}</g>
    <path d="M0 360 Q180 320 360 352 T720 340 L720 420 L0 420 Z" fill="#6b7d4f"/>`),
  neon: hero(`
    <rect width="720" height="420" fill="#0a0a0a"/>
    <g fill="none" stroke-width="6"><path d="M80 330 L220 330 L220 240 L360 240 L360 150 L500 150 L500 80 L640 80" stroke="#ff2e88"/><path d="M80 350 L640 350" stroke="#2ee6ff" stroke-width="3"/></g>
    <g fill="#ff2e88"><rect x="100" y="270" width="100" height="60"/><rect x="240" y="190" width="100" height="140"/><rect x="380" y="110" width="100" height="220"/><rect x="520" y="40" width="100" height="290" fill="#2ee6ff"/></g>`),
  brunch: hero(`
    <rect width="720" height="420" fill="#ffe8dc"/>
    <path d="M-40 120 C 120 20, 260 200, 420 90 S 700 40, 780 140 L780 -20 L-40 -20 Z" fill="#ffd2bf"/>
    <circle cx="560" cy="250" r="110" fill="#ff7a59" opacity=".85"/>
    <circle cx="180" cy="290" r="90" fill="#8fb39a" opacity=".85"/>
    <g transform="translate(360 238)"><ellipse rx="70" ry="18" cy="60" fill="#e9c9b8"/><path d="M-50 -10 L50 -10 L40 58 L-40 58 Z" fill="#fffaf6"/><path d="M50 4 C 80 4, 80 40, 46 40" stroke="#fffaf6" stroke-width="10" fill="none"/><path d="M-10 -40 C -20 -60, 0 -66, -6 -86 M14 -40 C 4 -60, 24 -66, 18 -86" stroke="#ff7a59" stroke-width="4" fill="none" stroke-linecap="round"/></g>`),
  paper: hero(`
    <rect width="720" height="420" fill="#ecebe5"/>
    <g fill="#111"><rect x="40" y="40" width="300" height="20"/><rect x="40" y="76" width="260" height="10"/><rect x="40" y="96" width="280" height="10"/><rect x="40" y="116" width="220" height="10"/></g>
    <g fill="#bdbab0"><rect x="40" y="150" width="300" height="230"/></g>
    <circle cx="190" cy="265" r="62" fill="#111"/>
    <g fill="#111">${Array.from({ length: 12 }, (_, i) => `<rect x="398" y="${44 + i * 28}" width="${282 - (i % 3) * 40}" height="9"/>`).join("")}</g>
    <rect x="380" y="44" width="6" height="320" fill="#c8102e"/>`),
};
