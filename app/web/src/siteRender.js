// Site Builder's renderer — the ONE place that turns a site (settings + rows → columns →
// elements, see newSite below) into HTML/CSS. Used twice: SiteApp.jsx's editor canvas
// injects each element's HTML and the same stylesheet (scoped, see siteCss's `editor`
// option), and Export builds the final standalone file from it. Keeping both on one
// renderer is what makes the canvas an honest preview of what gets exported.

export const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- Layouts ----------

// A row's layout is its column ratios, e.g. "2-1" = two columns at 2fr / 1fr.
export const ROW_LAYOUTS = ["1", "1-1", "2-1", "1-2", "1-1-1", "1-2-1", "1-1-1-1"];

export const layoutColumnCount = (layout) => layout.split("-").length;
const layoutTemplate = (layout) =>
  layout
    .split("-")
    .map((n) => `minmax(0,${n}fr)`)
    .join(" ");

// ---------- Fonts ----------

export const SITE_FONTS = [
  {
    value: "system",
    label: "System (Korean-friendly)",
    family:
      '-apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic","Segoe UI",sans-serif',
  },
  { value: "serif", label: "Serif", family: 'Georgia,"Noto Serif KR","Nanum Myeongjo","Times New Roman",serif' },
  { value: "rounded", label: "Rounded", family: '"Nunito","Arial Rounded MT Bold","Noto Sans KR",sans-serif' },
  { value: "mono", label: "Monospace", family: 'ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace' },
];
const fontFamily = (value) => (SITE_FONTS.find((f) => f.value === value) || SITE_FONTS[0]).family;

// ---------- Defaults ----------

export function newSite(title = "") {
  return {
    version: 1,
    settings: {
      title,
      lang: "ko",
      maxWidth: 720,
      pageBg: "#dfe4e1",
      contentBg: "#ffffff",
      textColor: "#111111",
      font: "system",
    },
    rows: [],
  };
}

export function newRow(layout = "1") {
  return {
    id: uid(),
    layout,
    stackOnMobile: true,
    bg: "",
    paddingY: 24,
    paddingX: 28,
    marginY: 0,
    marginX: 0,
    gap: 20,
    elementGap: 12,
    valign: "start",
    borderWidth: 0,
    borderColor: "#050505",
    borderStyle: "solid",
    radius: 0,
    columns: Array.from({ length: layoutColumnCount(layout) }, () => ({ id: uid(), elements: [] })),
  };
}

// Changing a row's layout keeps every element: extra columns' contents are folded into
// the new last column rather than dropped, and new columns start empty.
export function relayoutRow(row, layout) {
  const count = layoutColumnCount(layout);
  const columns = row.columns.slice(0, count).map((c) => ({ ...c, elements: [...c.elements] }));
  while (columns.length < count) columns.push({ id: uid(), elements: [] });
  row.columns.slice(count).forEach((c) => columns[count - 1].elements.push(...c.elements));
  return { ...row, layout, columns };
}

export const ELEMENT_TYPES = [
  { type: "heading", label: "Heading", icon: "H" },
  { type: "text", label: "Text", icon: "¶" },
  { type: "badge", label: "Label", icon: "▭" },
  { type: "image", label: "Image", icon: "🖼" },
  { type: "button", label: "Button", icon: "▶" },
  { type: "quote", label: "Quote", icon: "❝" },
  { type: "gallery", label: "Book shelf", icon: "▦" },
  { type: "spacer", label: "Spacer", icon: "↕" },
  { type: "divider", label: "Divider", icon: "—" },
  { type: "html", label: "Custom HTML", icon: "</>" },
];

const NO_ACTION = { type: "none", value: "" };

export function newElement(type) {
  const base = { id: uid(), type };
  switch (type) {
    case "heading":
      return { ...base, text: "Your headline", level: 2, size: 28, color: "", align: "left", weight: 800 };
    case "text":
      return { ...base, text: "Write something here.", size: 15, color: "#5a625e", align: "left", lineHeight: 1.7 };
    case "badge":
      return { ...base, text: "START HERE", bg: "#050505", color: "#00efa2", size: 10, align: "left" };
    case "image":
      return { ...base, src: "", alt: "", width: 100, radius: 0, align: "center", action: NO_ACTION };
    case "button":
      return {
        ...base,
        text: "Read now →",
        bg: "#050505",
        color: "#00efa2",
        size: 14,
        radius: 0,
        align: "left",
        fullWidth: false,
        action: NO_ACTION,
      };
    case "quote":
      return { ...base, text: "“A memorable line.”", size: 15, color: "#111111", borderColor: "#00efa2" };
    case "gallery":
      return { ...base, columns: 3, gap: 14, ratio: "2/3", showTitles: true, titleSize: 12, items: [] };
    case "spacer":
      return { ...base, height: 32 };
    case "divider":
      return { ...base, color: "#050505", thickness: 2 };
    case "html":
      return { ...base, html: "<p>Custom HTML</p>" };
    default:
      throw new Error(`unknown element type ${type}`);
  }
}

export const newGalleryItem = () => ({ id: uid(), src: "", title: "", action: NO_ACTION });

// Fresh ids all the way down — for Duplicate, so the copy never shares an id with its
// original (selection and drag-and-drop both find things by id).
export function cloneWithNewIds(node) {
  if (Array.isArray(node)) return node.map(cloneWithNewIds);
  if (!node || typeof node !== "object") return node;
  const copy = {};
  for (const [k, v] of Object.entries(node)) copy[k] = cloneWithNewIds(v);
  if ("id" in node) copy.id = uid();
  return copy;
}

// ---------- Actions (what clicking an image/button/shelf item does) ----------

// PageBox's in-app book link: the host Android app exposes window.AndroidBridge and
// expects exactly `window.AndroidBridge.onFinished('CM<digits>')` — the same markup the
// reference PageBox pages use, which the platform's injected click handler matches by
// regex. Codes that don't fit are left unlinked rather than emitting a broken call.
export const BOOK_CODE_RE = /^CM\d{1,20}$/;

function actionAttrs(action, label, { editor }) {
  if (action?.type === "url" && action.value.trim()) {
    // A link in the editor canvas would navigate away from the builder on click.
    return editor ? { tag: "a", attrs: "" } : { tag: "a", attrs: ` href="${attr(action.value.trim())}" target="_blank" rel="noopener"` };
  }
  if (action?.type === "book" && BOOK_CODE_RE.test(action.value.trim())) {
    const code = action.value.trim();
    // Inline onclick would actually run (and throw — no AndroidBridge here) in the canvas.
    const onclick = editor ? "" : ` onclick="window.AndroidBridge.onFinished('${code}'); return false;"`;
    return { tag: "button", attrs: ` type="button"${onclick}${label ? ` aria-label="${attr(label)}"` : ""}` };
  }
  return null;
}

// ---------- Escaping / styles ----------

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function attr(s) {
  return esc(s).replace(/"/g, "&quot;");
}
const multiline = (s) => esc(s).replace(/\n/g, "<br>");

const kebab = (k) => (k.startsWith("--") ? k : k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));
const px = (n) => `${Number(n) || 0}px`;

// Style objects are camelCase (usable directly as a React `style` prop on the canvas);
// this turns one into an inline style="" string for the HTML output. Empty values are
// skipped, so "inherit the page default" is just leaving a color blank.
export function styleToCss(style) {
  return Object.entries(style)
    .filter(([, v]) => v !== "" && v !== undefined && v !== null)
    .map(([k, v]) => `${kebab(k)}:${v}`)
    .join(";");
}
const styleAttr = (style) => {
  const css = styleToCss(style);
  return css ? ` style="${attr(css)}"` : "";
};

const JUSTIFY = { left: "flex-start", center: "center", right: "flex-end" };

export function rowStyle(row) {
  return {
    "--sb-cols": layoutTemplate(row.layout),
    background: row.bg,
    padding: `${px(row.paddingY)} ${px(row.paddingX)}`,
    margin: `${px(row.marginY)} ${px(row.marginX)}`,
    border: Number(row.borderWidth) > 0 ? `${px(row.borderWidth)} ${row.borderStyle || "solid"} ${row.borderColor}` : "",
    borderRadius: Number(row.radius) > 0 ? px(row.radius) : "",
  };
}
export const colsStyle = (row) => ({ gap: px(row.gap), alignItems: row.valign });
export const colStyle = (row) => ({ gap: px(row.elementGap) });

// ---------- Elements ----------

// Optional frame around any element: border (width/style/color), corner radius, inner
// padding and background. Stored as box* fields (not border*, which the quote element
// already uses for its bar color) and absent on elements that never set them — only
// rendered as a wrapper when something is actually set, so plain elements export as
// plain tags.
export const BOX_DEFAULTS = {
  boxBorderWidth: 0,
  boxBorderStyle: "solid",
  boxBorderColor: "#050505",
  boxRadius: 0,
  boxPadding: 0,
  boxBg: "",
};

function boxStyle(el) {
  const b = { ...BOX_DEFAULTS, ...el };
  const width = Number(b.boxBorderWidth) || 0;
  const style = {
    border: width > 0 ? `${px(width)} ${b.boxBorderStyle} ${b.boxBorderColor}` : "",
    borderRadius: Number(b.boxRadius) > 0 ? px(b.boxRadius) : "",
    padding: Number(b.boxPadding) > 0 ? px(b.boxPadding) : "",
    background: b.boxBg,
  };
  return Object.values(style).some((v) => v !== "") ? style : null;
}

// Editor-only placeholder text goes through the builder's interface language when the
// canvas passes ctx.t (see siteI18n.jsx); the export never shows placeholders.
const tr = (ctx, text) => (ctx.t ? ctx.t(text) : text);

// ctx.assetSrc maps a stored image URL to what should actually go in src="" (the URL
// itself on the canvas, a data: URI in the export); ctx.editor marks canvas rendering.
// Buttons and labels are inline-sized, so their frame shrinks to fit them (positioned by
// the element's own alignment) instead of spanning the whole column.
const FIT_MARGIN = { left: "0 auto 0 0", center: "0 auto", right: "0 0 0 auto" };

export function renderElement(el, ctx) {
  const inner = renderElementInner(el, ctx);
  const box = boxStyle(el);
  if (!box || !inner) return inner;
  const fit = el.type === "badge" || (el.type === "button" && !el.fullWidth);
  const style = fit ? { ...box, width: "fit-content", margin: FIT_MARGIN[el.align] || FIT_MARGIN.left } : box;
  return `<div class="sb-box"${styleAttr(style)}>${inner}</div>`;
}

function renderElementInner(el, ctx) {
  switch (el.type) {
    case "heading": {
      const level = [1, 2, 3, 4].includes(Number(el.level)) ? Number(el.level) : 2;
      return `<h${level} class="sb-heading"${styleAttr({
        fontSize: px(el.size),
        color: el.color,
        textAlign: el.align,
        fontWeight: el.weight,
      })}>${multiline(el.text)}</h${level}>`;
    }
    case "text":
      return `<p class="sb-text"${styleAttr({
        fontSize: px(el.size),
        color: el.color,
        textAlign: el.align,
        lineHeight: el.lineHeight,
      })}>${multiline(el.text)}</p>`;
    case "badge":
      return `<div class="sb-badge-wrap"${styleAttr({ textAlign: el.align })}><span class="sb-badge"${styleAttr({
        background: el.bg,
        color: el.color,
        fontSize: px(el.size),
      })}>${multiline(el.text)}</span></div>`;
    case "image": {
      if (!el.src) return ctx.editor ? `<div class="sb-placeholder">${esc(tr(ctx, "Image — choose a file on the right, or drop one here"))}</div>` : "";
      const width = `${Number(el.width) || 100}%`;
      const radius = Number(el.radius) > 0 ? px(el.radius) : "";
      const a = actionAttrs(el.action, el.alt, ctx);
      // When linked, the link takes the image's width and the image fills the link.
      const img = `<img src="${attr(ctx.assetSrc(el.src))}" alt="${attr(el.alt)}"${styleAttr({ width: a ? "100%" : width, borderRadius: radius })}>`;
      const inner = a ? `<${a.tag} class="sb-action"${a.attrs}${styleAttr({ width })}>${img}</${a.tag}>` : img;
      return `<div class="sb-image"${styleAttr({ justifyContent: JUSTIFY[el.align] })}>${inner}</div>`;
    }
    case "button": {
      const style = styleAttr({
        background: el.bg,
        color: el.color,
        fontSize: px(el.size),
        borderRadius: Number(el.radius) > 0 ? px(el.radius) : "",
        width: el.fullWidth ? "100%" : "",
      });
      const a = actionAttrs(el.action, el.text, ctx) || { tag: "span", attrs: "" };
      return `<div class="sb-button-wrap"${styleAttr({ textAlign: el.align })}><${a.tag} class="sb-button"${a.attrs}${style}>${multiline(el.text)}</${a.tag}></div>`;
    }
    case "quote":
      return `<blockquote class="sb-quote"${styleAttr({
        fontSize: px(el.size),
        color: el.color,
        borderLeftColor: el.borderColor,
      })}>${multiline(el.text)}</blockquote>`;
    case "gallery": {
      const items = el.items.length
        ? el.items
            .map((item) => {
              const img = item.src
                ? `<img class="sb-gallery-img" src="${attr(ctx.assetSrc(item.src))}" alt="${attr(item.title)}"${styleAttr({ aspectRatio: el.ratio })}>`
                : `<span class="sb-gallery-img sb-gallery-empty"${styleAttr({ aspectRatio: el.ratio })}></span>`;
              const title = el.showTitles && item.title ? `<span class="sb-gallery-title"${styleAttr({ fontSize: px(el.titleSize) })}>${esc(item.title)}</span>` : "";
              const a = actionAttrs(item.action, item.title, ctx) || { tag: "div", attrs: "" };
              return `<${a.tag} class="sb-gallery-item sb-action"${a.attrs}>${img}${title}</${a.tag}>`;
            })
            .join("")
        : ctx.editor
        ? `<div class="sb-placeholder" style="grid-column:1/-1">${esc(tr(ctx, "Book shelf — add covers on the right"))}</div>`
        : "";
      return `<div class="sb-gallery"${styleAttr({
        gridTemplateColumns: `repeat(${Number(el.columns) || 3},minmax(0,1fr))`,
        gap: px(el.gap),
      })}>${items}</div>`;
    }
    case "spacer":
      return `<div class="sb-spacer"${styleAttr({ height: px(el.height) })}></div>`;
    case "divider":
      return `<hr class="sb-divider"${styleAttr({ borderTop: `${px(el.thickness)} solid ${el.color}` })}>`;
    case "html":
      // Scripts would run inside the builder itself if injected into the canvas.
      return ctx.editor ? `<div class="sb-html">${(el.html || "").replace(/<script[\s\S]*?<\/script>/gi, "")}</div>` : `<div class="sb-html">${el.html || ""}</div>`;
    default:
      return "";
  }
}

// ---------- Stylesheet ----------

// `editor: true` scopes everything under .sb-canvas-root instead of html/body (so it
// can't restyle the builder around it), first reverting the builder's own global
// element styles (index.css styles every <button>, for one) inside the page — except
// the editor's own chrome (toolbars, drop markers), which is marked with class "sbe".
// Both :where()s keep that reset at the same specificity as the .sb-* rules after it,
// so those (and inline styles) still win. The reset re-applies border-box sizing
// straight away, since `all` would otherwise also undo the `*{box-sizing}` rule and
// make padded full-width things overflow their column on the canvas only. It also
// adds .sb-mobile, which forces the phone layout for the canvas's phone-preview toggle
// since a real media query only sees the builder's own wide window.
export function siteCss(settings, { editor = false } = {}) {
  const root = editor ? ".sb-canvas-root" : "html,body";
  const scope = editor ? ".sb-canvas-root " : "";
  return `
${editor ? `.sb-canvas-root .sb-page :where(h1,h2,h3,h4,p,button,a,img,blockquote,hr,span,div):where(:not(.sbe,.sbe *)){all:revert;box-sizing:border-box}` : ""}
${scope}*{box-sizing:border-box}
${root}{margin:0;padding:0;background:${settings.pageBg};color:${settings.textColor};font-family:${fontFamily(settings.font)};-webkit-font-smoothing:antialiased}
${scope}.sb-page{width:100%;max-width:${Number(settings.maxWidth) || 720}px;margin:0 auto;background:${settings.contentBg};overflow:hidden;color:${settings.textColor};font-family:${fontFamily(settings.font)}}
${scope}.sb-cols{display:grid;grid-template-columns:var(--sb-cols)}
${scope}.sb-col{display:flex;flex-direction:column;min-width:0}
${scope}.sb-heading{margin:0;line-height:1.28;letter-spacing:-.04em}
${scope}.sb-text{margin:0;white-space:normal}
${scope}.sb-badge-wrap{line-height:1}
${scope}.sb-badge{display:inline-block;padding:6px 10px;font-weight:900;letter-spacing:.12em}
${scope}.sb-image{display:flex}
${scope}.sb-image img{display:block;max-width:100%;height:auto}
${scope}.sb-action{display:block;padding:0;margin:0;border:0;background:none;font:inherit;color:inherit;text-align:inherit;text-decoration:none;cursor:pointer}
${scope}.sb-button{display:inline-block;padding:13px 18px;border:0;font-family:inherit;font-weight:800;line-height:1.3;text-align:center;text-decoration:none;cursor:pointer}
${scope}.sb-quote{margin:0;padding:4px 0 4px 14px;border-left:3px solid;font-weight:700;line-height:1.6}
${scope}.sb-gallery{display:grid}
${scope}.sb-gallery-item{display:flex;flex-direction:column;gap:7px;min-width:0}
${scope}.sb-gallery-img{display:block;width:100%;object-fit:cover;box-shadow:0 6px 16px rgba(0,0,0,.14)}
${scope}.sb-gallery-empty{background:#e3e7e5}
${scope}.sb-gallery-title{font-weight:700;line-height:1.35;text-align:center}
${scope}.sb-spacer{width:100%}
${scope}.sb-box{overflow:hidden}
${scope}.sb-divider{margin:0;border:0;width:100%}
@media (max-width:560px){${scope}.sb-row.sb-stack .sb-cols{grid-template-columns:minmax(0,1fr)}}
${editor ? `.sb-canvas-root.sb-mobile .sb-row.sb-stack .sb-cols{grid-template-columns:minmax(0,1fr)}` : ""}
`.trim();
}

// ---------- Whole document ----------

export function rowClass(row) {
  return `sb-row${row.stackOnMobile ? " sb-stack" : ""}`;
}

export function renderSiteHtml(site, { assetSrc = (u) => u } = {}) {
  const ctx = { assetSrc, editor: false };
  const s = site.settings;
  const rows = site.rows
    .map(
      (row) =>
        `<section class="${rowClass(row)}"${styleAttr(rowStyle(row))}><div class="sb-cols"${styleAttr(colsStyle(row))}>${row.columns
          .map((col) => `<div class="sb-col"${styleAttr(colStyle(row))}>${col.elements.map((el) => renderElement(el, ctx)).join("\n")}</div>`)
          .join("")}</div></section>`
    )
    .join("\n");
  return `<!DOCTYPE html>
<html lang="${attr(s.lang || "en")}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(s.title)}</title>
<style>
${siteCss(s)}
</style>
</head>
<body>
<main class="sb-page">
${rows}
</main>
</body>
</html>
`;
}
