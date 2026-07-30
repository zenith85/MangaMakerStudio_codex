import { useEffect, useLayoutEffect, useState, useCallback, useRef } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import { api } from "./api";
import Terminal from "./Terminal";
import SceneEditor from "./SceneEditor";
import Bubble, {
  newBubble,
  FONTS,
  defaultTailFor,
  DEFAULT_FONT_SIZE,
  boundaryFor,
  tailStyleFor,
  outlineWithTail,
  dotTrailPoints,
  isDashed,
  isSharpCornered,
  hasNoBackground,
  normalizeSignedDegrees,
  customFontValue,
  customFontFamilyName,
  fontFamilyFor,
} from "./Bubble";
import ShapePicker from "./ShapePicker";
import ExpressionMark, {
  EXPRESSION_TYPES,
  newExpression,
  DEFAULT_THICKNESS,
  MIN_THICKNESS,
  MAX_THICKNESS,
  DEFAULT_LINE_COUNT,
  MIN_LINE_COUNT,
  MAX_LINE_COUNT,
} from "./ExpressionMark";
import ExpressionPicker from "./ExpressionPicker";
import GridResizeHandles from "./GridResize";

// Manga panel layout templates. Panels are assigned grid-area "p1", "p2", ...
// in order, so a layout's look comes entirely from its grid-template — no
// per-panel styling needed. `panelCount` drives how many panels a page gets.
const LAYOUTS = [
  { value: "single", label: "1 panel — splash page", panelCount: 1, areas: `"p1"`, columns: "1fr", rows: "1fr" },
  {
    value: "stack-2",
    label: "2 panels — stacked",
    panelCount: 2,
    areas: `"p1" "p2"`,
    columns: "1fr",
    rows: "1fr 1fr",
  },
  {
    value: "side-2",
    label: "2 panels — side by side",
    panelCount: 2,
    areas: `"p1 p2"`,
    columns: "1fr 1fr",
    rows: "1fr",
  },
  {
    value: "stack-3",
    label: "3 panels — stacked",
    panelCount: 3,
    areas: `"p1" "p2" "p3"`,
    columns: "1fr",
    rows: "1fr 1fr 1fr",
  },
  {
    value: "big-top-3",
    label: "3 panels — big top + 2 below",
    panelCount: 3,
    areas: `"p1 p1" "p2 p3"`,
    columns: "1fr 1fr",
    rows: "2fr 1fr",
  },
  {
    value: "big-bottom-3",
    label: "3 panels — 2 above + big bottom",
    panelCount: 3,
    areas: `"p1 p2" "p3 p3"`,
    columns: "1fr 1fr",
    rows: "1fr 2fr",
  },
  {
    value: "grid-2x2",
    label: "4 panels — grid",
    panelCount: 4,
    areas: `"p1 p2" "p3 p4"`,
    columns: "1fr 1fr",
    rows: "1fr 1fr",
  },
  {
    value: "small-big-medium-4",
    label: "4 panels — small, big, then 2 medium",
    panelCount: 4,
    areas: `"p1 p2" "p3 p2" "p4 p2"`,
    columns: "1fr 1.4fr",
    rows: "0.8fr 1fr 1fr",
  },
  {
    value: "small-verybig-medium-4",
    label: "4 panels — small, very big, then 2 medium",
    panelCount: 4,
    areas: `"p1 p1" "p2 p2" "p3 p4"`,
    columns: "1fr 1fr",
    rows: "0.5fr 4.5fr 2fr",
  },
  {
    value: "split-top-big-bottom-4",
    label: "4 panels — split top row, big split bottom row",
    panelCount: 4,
    areas: `"p1 p2" "p3 p4"`,
    columns: "1fr 1fr",
    rows: "1fr 3fr",
  },
  {
    value: "big-left-4",
    label: "4 panels — big left + 3 stacked right",
    panelCount: 4,
    areas: `"p1 p2" "p1 p3" "p1 p4"`,
    columns: "2fr 1fr",
    rows: "1fr 1fr 1fr",
  },
  {
    value: "big-right-4",
    label: "4 panels — 3 stacked left + big right",
    panelCount: 4,
    areas: `"p2 p1" "p3 p1" "p4 p1"`,
    columns: "1fr 2fr",
    rows: "1fr 1fr 1fr",
  },
  {
    value: "top-then-tall-left-stacked-right-5",
    label: "5 panels — top strip, then tall left + 3 stacked right",
    panelCount: 5,
    areas: `"p1 p1" "p2 p3" "p2 p4" "p2 p5"`,
    columns: "1fr 1fr",
    rows: "1fr 1fr 1fr 1fr",
  },
  {
    value: "grid-2x3",
    label: "6 panels — grid",
    panelCount: 6,
    areas: `"p1 p2" "p3 p4" "p5 p6"`,
    columns: "1fr 1fr",
    rows: "1fr 1fr 1fr",
  },
];

// CSS Grid can only ever produce rectangular cells, so the tilted/diagonal panel
// borders in real manga pages need a different technique: panels are positioned
// freehand (percent x/y/width/height, like a speech bubble) rather than placed in a
// named grid area, and a slanted divider between two panels is drawn by giving them
// the *same* overlapping box with complementary clip-path polygons — each only paints
// its half of that shared box, with a small inset on both sides of the divider so the
// gap between them matches the same gutter every other layout uses (without it, tilted
// panels touch edge-to-edge while every rectangular layout has a visible gap — exactly
// the "inconsistent spacing" that made earlier versions look off). A layout using this
// mode sets `panels` (one {x,y,width,height,clipPath?} per panel, in order) instead of
// areas/columns/rows; PageCanvas and LayoutPicker check for that to switch modes.
//
// The page itself isn't square (aspect-ratio 5/7 in CSS), so "1.6% of width" and "1.6%
// of height" are NOT the same number of pixels — using one flat percent for both axes
// made vertical gaps visibly wider than horizontal ones. GAP_X/GAP_Y below are each
// calibrated (given the page's actual pixel width and aspect ratio) so a gap along
// either axis resolves to the same ~10px the grid layouts use via `gap: 10px`.
const PAGE_W = 640; // matches .page-canvas max-width
const PAGE_ASPECT = 5 / 7; // matches .page-canvas aspect-ratio (width / height)
const GAP_X = (10 / PAGE_W) * 100; // percent of page width for a 10px horizontal gap
const GAP_Y = GAP_X * PAGE_ASPECT; // percent of page height for that same 10px, vertically

// Two panels sharing the full-width band from y0 to y0+h, split by a divider tilted
// between (0%, divLeftFrac) and (100%, divRightFrac) within that band. The divider runs
// along the y axis, so its gap is calibrated against page height (GAP_Y).
function tiltedRow(y0, h, divLeftFrac, divRightFrac) {
  const g = (GAP_Y / h) * 100; // page-percent gap converted to this band's local percent
  const leftY = divLeftFrac * 100;
  const rightY = divRightFrac * 100;
  return [
    { x: 0, y: y0, width: 100, height: h, clipPath: `polygon(0% 0%, 100% 0%, 100% ${rightY - g / 2}%, 0% ${leftY - g / 2}%)` },
    { x: 0, y: y0, width: 100, height: h, clipPath: `polygon(0% ${leftY + g / 2}%, 100% ${rightY + g / 2}%, 100% 100%, 0% 100%)` },
  ];
}

// Same idea, vertical: two panels sharing one box, split by a divider tilted between
// (divTopFrac, 0%) and (divBottomFrac, 100%). The divider runs along the x axis, so its
// gap is calibrated against page width (GAP_X).
function tiltedColumn(x0, y0, w, h, divTopFrac, divBottomFrac) {
  const g = (GAP_X / w) * 100;
  const topX = divTopFrac * 100;
  const bottomX = divBottomFrac * 100;
  return [
    { x: x0, y: y0, width: w, height: h, clipPath: `polygon(0% 0%, ${topX - g / 2}% 0%, ${bottomX - g / 2}% 100%, 0% 100%)` },
    { x: x0, y: y0, width: w, height: h, clipPath: `polygon(${topX + g / 2}% 0%, 100% 0%, 100% 100%, ${bottomX + g / 2}% 100%)` },
  ];
}

// A dramatic diagonal slash across a box, from (topFrac, 0%) to (bottomFrac, 100%).
function diagonalSplit(x0, y0, w, h, topFrac, bottomFrac) {
  const g = (GAP_X / w) * 100;
  const topX = topFrac * 100;
  const bottomX = bottomFrac * 100;
  return [
    { x: x0, y: y0, width: w, height: h, clipPath: `polygon(0% 0%, ${topX - g / 2}% 0%, ${bottomX - g / 2}% 100%, 0% 100%)` },
    { x: x0, y: y0, width: w, height: h, clipPath: `polygon(${topX + g / 2}% 0%, 100% 0%, 100% 100%, ${bottomX + g / 2}% 100%)` },
  ];
}

// Lays out a column of full-width bands stacked top to bottom with an exact GAP_Y
// between every pair, given their relative height weights (e.g. [18, 40, 19, 20]).
function stackBands(weights) {
  const totalGap = GAP_Y * (weights.length - 1);
  const scale = (100 - totalGap) / weights.reduce((a, b) => a + b, 0);
  let y = 0;
  return weights.map((w) => {
    const band = { y0: y, h: w * scale };
    y += band.h + GAP_Y;
    return band;
  });
}

// The empty-panel placeholder can't just be centered on a panel's full bounding box —
// for a tilted/diagonal slot two panels share the same box, so the box's own center is
// often outside (or right on the seam of) the actual visible clipped shape. This finds
// the true centroid of the clip-path polygon so the placeholder lands inside the shape
// a user actually sees.
function polygonCentroid(clipPath) {
  const match = clipPath.match(/polygon\(([^)]+)\)/);
  if (!match) return { x: 50, y: 50 };
  const pts = match[1].split(",").map((pair) => pair.trim().split(/\s+/).map((v) => parseFloat(v)));
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-6) {
    const n = pts.length;
    return { x: pts.reduce((s, p) => s + p[0], 0) / n, y: pts.reduce((s, p) => s + p[1], 0) / n };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

// Converts the same polygon(x% y%, ...) string into an SVG <polygon points="..."> value
// in actual pixel space (frameW/frameH) instead of percent — see PanelThumb's diagonal-
// panel rendering, which draws each panel as a genuinely-shaped SVG polygon (a real
// trapezoid, different width top vs bottom) rather than a rectangle with clip-path
// hiding part of it. A real shape is a native SVG feature — much more reliably captured
// when exporting to PDF than a CSS clip-path trick layered on a plain rectangle.
function svgPolygonPoints(clipPath, frameW, frameH) {
  const match = clipPath.match(/polygon\(([^)]+)\)/);
  if (!match) return "";
  return match[1]
    .split(",")
    .map((pair) => {
      const [xPct, yPct] = pair.trim().split(/\s+/).map((v) => parseFloat(v));
      return `${(xPct / 100) * frameW},${(yPct / 100) * frameH}`;
    })
    .join(" ");
}

const DIAGONAL_LAYOUTS = [
  // A tilted band across the top (split into 2 panels by a diagonal seam), then 2
  // squares below. panelCount must match panels.length exactly — PageCanvas and
  // LayoutPicker both index into `panels` by array position, so an undercount here
  // silently drops the last slot entirely instead of erroring.
  {
    value: "tilt-top-4",
    label: "4 panels — tilted band split + 2 below",
    panelCount: 4,
    panels: (() => {
      const [band, squareRow] = stackBands([63, 37]);
      const squareW = (100 - GAP_X) / 2;
      return [
        ...tiltedRow(band.y0, band.h, 0.5, 0.5 + 0.16),
        { x: 0, y: squareRow.y0, width: squareW, height: squareRow.h },
        { x: squareW + GAP_X, y: squareRow.y0, width: squareW, height: squareRow.h },
      ];
    })(),
  },
  // One wide panel, then a tilted pair (wide left + narrower right panel), then 2 more
  // wide panels stacked below.
  {
    value: "diagonal-slice-5",
    label: "5 panels — wide top + diagonal + 2 wide",
    panelCount: 5,
    panels: (() => {
      const [top, column, row3, row4] = stackBands([18, 40, 19, 20]);
      return [
        { x: 0, y: top.y0, width: 100, height: top.h },
        ...tiltedColumn(0, column.y0, 100, column.h, 0.72, 0.6),
        { x: 0, y: row3.y0, width: 100, height: row3.h },
        { x: 0, y: row4.y0, width: 100, height: row4.h },
      ];
    })(),
  },
  // A simple, dramatic full-page diagonal split into 2 panels.
  {
    value: "diagonal-2",
    label: "2 panels — diagonal slash",
    panelCount: 2,
    panels: diagonalSplit(0, 0, 100, 100, 0.62, 0.38),
  },
  // Pure rectangles, no tilt at all — top 2 squares, a tall left panel running the rest
  // of the page's height, and a smaller panel + a wide bar stacked on the right.
  {
    value: "grid-mixed-5",
    label: "5 panels — 2 top + tall left + 2 right",
    panelCount: 5,
    areas: `"p1 p2" "p3 p4" "p3 p5"`,
    columns: "1fr 1fr",
    rows: "0.75fr 1.3fr 0.85fr",
  },
];

LAYOUTS.push(...DIAGONAL_LAYOUTS);

// Matches server/scene.js's EMPTY_SCENE_DOC — used here for the "Request edit"
// instructions editor, which is a fresh Tiptap doc each time, not loaded from a panel.
const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

// Mirrors server/imageFilters.js's per-type params — kept in sync by hand since the
// server and browser bundles can't share source. Each filter takes exactly one adjustable
// slider param; `key` is the name that param is sent to the backend under.
const FILTER_TYPES = [
  { value: "screentone", label: "Screentone (dots)", param: { key: "cellSize", label: "Dot size", min: 1, max: 40, step: 1, default: 8, unit: "px" } },
  { value: "crosshatch", label: "Crosshatch", param: { key: "spacing", label: "Line spacing", min: 3, max: 30, step: 1, default: 10, unit: "px" } },
  { value: "inkThreshold", label: "Ink threshold", param: { key: "threshold", label: "Threshold", min: 0, max: 100, step: 1, default: 50, unit: "%" } },
  { value: "vignette", label: "Vignette", param: { key: "strength", label: "Strength", min: 0, max: 100, step: 1, default: 50, unit: "%" } },
];
function filterParamMeta(type) {
  return FILTER_TYPES.find((f) => f.value === type)?.param ?? FILTER_TYPES[0].param;
}

// Mirrors server/index.js's TRANSLATE_LANGUAGE_NAMES keys — "en" is the original (never
// sent to the backend, just flips the page's display flag back), the rest go through
// the /translate route.
const BUBBLE_LANGUAGES = [
  { value: "en", label: "English (original)" },
  { value: "ko", label: "한국어 (Korean)" },
  { value: "ja", label: "日本語 (Japanese)" },
  { value: "zh", label: "中文 (Chinese)" },
  { value: "ar", label: "العربية (Arabic)" },
];

const STYLE_PRESETS = [
  { value: "manga_bw", label: "Manga (B&W, screentone detail)" },
  { value: "manga_simple", label: "Manga (B&W, simple/clean)" },
  { value: "manhwa_color", label: "Manhwa (color)" },
  { value: "novel_illustration", label: "Novel illustration" },
];

const ENTITY_KINDS = [
  { value: "characters", label: "Characters", singular: "character" },
  { value: "places", label: "Places", singular: "place" },
  { value: "objects", label: "Objects", singular: "object" },
  { value: "references", label: "References", singular: "reference" },
];

// References don't have Codex generation, style, or descriptive fields — just a name and
// an uploaded picture — so EntityCreatorModal checks this to hide those sections.
const GENERATABLE_ENTITY_KINDS = new Set(["characters", "places", "objects"]);

// True if a Tiptap doc has any non-empty text or a mention anywhere in it — shared by
// panelHasContent below and the "Request edit" button's disabled state, since an editDoc
// is the same shape as a panel's sceneDoc.
function docHasContent(node) {
  if (!node) return false;
  if (node.type === "mention") return true;
  if (node.type === "text") return !!node.text?.trim();
  return (node.content || []).some(docHasContent);
}

// True if a panel has a generated image or any non-empty scene text/mention — used to
// warn before a layout change would drop it (see changeLayout in App()).
function panelHasContent(panel) {
  if (panel.hasImage) return true;
  return docHasContent(panel.sceneDoc);
}

// html2canvas doesn't reliably honor object-fit/object-position on <img> elements — it
// tends to just stretch the raw image to fill the box, ignoring the crop/pan the user
// set up on screen. So before capturing the page for PDF export, this bakes each panel
// image's actual visible crop onto an offscreen canvas (the same object-fit: cover +
// object-position math the browser itself uses) and swaps that in as the image's src —
// by the time html2canvas runs, there's no cropping left for it to get wrong. Returns a
// function that restores the original images afterward.
async function precropPanelImages(container) {
  if (!container) return () => {};
  const imgs = Array.from(container.querySelectorAll(".panel-slot img"));
  const restores = [];

  for (const img of imgs) {
    const cw = img.clientWidth;
    const ch = img.clientHeight;
    if (!img.naturalWidth || !cw || !ch) continue;

    const [posXStr, posYStr] = getComputedStyle(img).objectPosition.split(" ");
    const offsetX = parseFloat(posXStr) || 50;
    const offsetY = parseFloat(posYStr) || 50;

    const containerRatio = cw / ch;
    const imgRatio = img.naturalWidth / img.naturalHeight;
    let sx, sy, sw, sh;
    if (imgRatio > containerRatio) {
      sh = img.naturalHeight;
      sw = sh * containerRatio;
      sy = 0;
      sx = (img.naturalWidth - sw) * (offsetX / 100);
    } else {
      sw = img.naturalWidth;
      sh = sw / containerRatio;
      sx = 0;
      sy = (img.naturalHeight - sh) * (offsetY / 100);
    }

    // Brightness (see the brightness slider in the panel editor) is baked into the
    // canvas pixels here too — html2canvas doesn't reliably honor CSS filter either, and
    // baking it now (then clearing the live style below) also avoids it getting applied
    // twice: once here, once again by the browser rendering the swapped-in img's own
    // inline filter during capture.
    const filter = getComputedStyle(img).filter;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(cw * 2));
    canvas.height = Math.max(1, Math.round(ch * 2));
    const ctx = canvas.getContext("2d");
    if (filter && filter !== "none") ctx.filter = filter;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");

    const originalSrc = img.src;
    const originalObjectPosition = img.style.objectPosition;
    const originalFilter = img.style.filter;
    restores.push(() => {
      img.src = originalSrc;
      img.style.objectPosition = originalObjectPosition;
      img.style.filter = originalFilter;
    });

    await new Promise((resolve) => {
      img.onload = resolve;
      img.src = dataUrl;
    });
    img.style.objectPosition = "50% 50%";
    img.style.filter = "none";
  }

  return () => restores.forEach((fn) => fn());
}

// html2canvas also doesn't reliably rasterize the bubble outline SVGs (see Bubble.jsx) —
// specifically, a tail whose point sits far outside the bubble's own box (relying on the
// SVG's overflow: visible, which a real browser honors but html2canvas's approximate
// renderer doesn't) comes out as a broken/jagged mark instead of a clean spike, the
// farther outside the box it reaches. Same fix as precropPanelImages above: bake the
// correct geometry onto a plain canvas overlay — computed directly from the bubble data,
// not read back from the DOM — and hide the live SVGs during capture, since html2canvas
// handles plain canvases fine. The bubble TEXT is untouched; it's ordinary DOM and
// already renders correctly.
function precropBubbleOutlines(container, page) {
  if (!container || !page) return () => {};
  const panelSlots = Array.from(container.querySelectorAll(".panel-slot"));
  const containerRect = container.getBoundingClientRect();
  if (!containerRect.width || !containerRect.height) return () => {};

  const SCALE = 2; // matches the scale: 2 passed to html2canvas for the actual capture
  const overlay = document.createElement("canvas");
  overlay.width = Math.round(containerRect.width * SCALE);
  overlay.height = Math.round(containerRect.height * SCALE);
  overlay.style.position = "absolute";
  overlay.style.left = "0";
  overlay.style.top = "0";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.pointerEvents = "none";
  const ctx = overlay.getContext("2d");
  ctx.scale(SCALE, SCALE);

  const rotatePoint = (p, center, deg) => {
    if (!deg) return p;
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
  };

  page.panels.forEach((panel, i) => {
    const slot = panelSlots[i];
    if (!slot || !(panel.bubbles || []).length) return;
    const slotRect = slot.getBoundingClientRect();
    const originX = slotRect.left - containerRect.left;
    const originY = slotRect.top - containerRect.top;

    for (const bubble of panel.bubbles) {
      const rotate = bubble.rotate || 0;
      const bx = originX + (bubble.x / 100) * slotRect.width;
      const by = originY + (bubble.y / 100) * slotRect.height;
      const bw = (bubble.width / 100) * slotRect.width;
      const bh = (bubble.height / 100) * slotRect.height;
      const center = { x: bx + bw / 2, y: by + bh / 2 };
      const toScreen = (p) => rotatePoint({ x: bx + (p.x / 100) * bw, y: by + (p.y / 100) * bh }, center, rotate);

      const boundary = boundaryFor(bubble.shape);
      const tailStyle = tailStyleFor(bubble.shape);
      const outline = (tailStyle === "spike" ? outlineWithTail(boundary, bubble) : boundary).map(toScreen);
      const dots = tailStyle === "dots" ? dotTrailPoints(boundary, bubble) : [];
      const avgScale = (bw + bh) / 2 / 100; // dot radii are in the same 0-100 local units as the boundary

      // Noise/SFX bubbles have no bubble fill or outline at all (see hasNoBackground in
      // Bubble.jsx) — painting the usual white box here would put an opaque rectangle
      // behind their hollow text in the exported PDF that never shows on screen.
      if (!hasNoBackground(bubble.shape)) {
        ctx.save();
        ctx.beginPath();
        outline.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.fillStyle = "white";
        ctx.fill();
        ctx.lineJoin = isSharpCornered(bubble.shape) ? "miter" : "round";
        ctx.setLineDash(isDashed(bubble.shape) ? [5, 4] : []);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#1a1a1a";
        ctx.stroke();
        ctx.restore();
      }

      for (const d of dots) {
        const p = toScreen(d);
        ctx.beginPath();
        ctx.arc(p.x, p.y, d.r * avgScale, 0, Math.PI * 2);
        ctx.fillStyle = "white";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#1a1a1a";
        ctx.stroke();
      }
    }
  });

  container.appendChild(overlay);
  const svgs = Array.from(container.querySelectorAll(".bubble-outline"));
  const prevVisibility = svgs.map((svg) => svg.style.visibility);
  svgs.forEach((svg) => {
    svg.style.visibility = "hidden";
  });

  return () => {
    overlay.remove();
    svgs.forEach((svg, i) => {
      svg.style.visibility = prevVisibility[i];
    });
  };
}

// Dark is this app's original look and the default for anyone who hasn't chosen yet;
// the choice is global (not per-project), so it's read/written directly to
// localStorage rather than living in project data. Applied via a data-theme attribute
// on the root element, which index.css's `:root[data-theme="light"]` block hooks into.
function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return [theme, toggleTheme];
}

// A day/night pill switch, placed beside the app title (both on the project-landing
// screen and the in-project sidebar) — the one control for a preference that otherwise
// has no visible home of its own.
function ThemeToggle({ theme, onToggle }) {
  const isLight = theme === "light";
  return (
    <button
      type="button"
      className={`theme-toggle${isLight ? " light" : ""}`}
      role="switch"
      aria-checked={isLight}
      title={isLight ? "Switch to dark mode" : "Switch to light mode"}
      onClick={onToggle}
    >
      <span className="theme-toggle-track">
        <span className="theme-toggle-knob">{isLight ? "☀️" : "🌙"}</span>
      </span>
    </button>
  );
}

// A panel lives in one of two arrays on a page: `panels` (the grid layout) or
// `floatingPanels` (freely dragged/resized above it — see the "+ Floating panel"
// button). Bubbles/expressions/image-drag callbacks are shared between both kinds of
// panel (they're passed the same way into PanelThumb either way), so their handlers
// below need to find/patch a panel without knowing which array it's actually in.
function findPanelInPage(page, panelId) {
  return page.panels.find((p) => p.id === panelId) || (page.floatingPanels || []).find((p) => p.id === panelId);
}
function patchPanelInPage(page, panelId, updater) {
  if (page.panels.some((p) => p.id === panelId)) {
    return { ...page, panels: page.panels.map((p) => (p.id === panelId ? updater(p) : p)) };
  }
  return { ...page, floatingPanels: (page.floatingPanels || []).map((p) => (p.id === panelId ? updater(p) : p)) };
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [projects, setProjects] = useState(null); // null = not loaded yet
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [kind, setKind] = useState("characters");
  const [entities, setEntities] = useState({ characters: [], places: [], objects: [], references: [] });
  const [customFonts, setCustomFonts] = useState([]); // project-scoped — uploaded once, usable by every bubble in it
  const [editingEntity, setEditingEntity] = useState(null); // { kind, entity } | { kind, entity: null } for "new"
  const [pages, setPages] = useState([]);
  const [currentPage, setCurrentPage] = useState(null);
  const [selectedPanelId, setSelectedPanelId] = useState(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfStatus, setPdfStatus] = useState("");
  const [pdfSavedPath, setPdfSavedPath] = useState(""); // relative to the project folder; lets the "Open" button find it
  const [cbzBusy, setCbzBusy] = useState(false);
  const [cbzStatus, setCbzStatus] = useState("");
  const [cbzSavedPath, setCbzSavedPath] = useState("");
  const [translateBusy, setTranslateBusy] = useState(false);
  const [translateError, setTranslateError] = useState("");
  const pageCanvasRef = useRef(null);

  // "checking" | "online" | "offline" — whether a local agent is running on THIS
  // visitor's own machine (see api.js: every API call targets their own localhost, not
  // wherever this page itself was served from). Without this, someone with no local
  // agent running just sees every request silently fail with no explanation.
  const [agentStatus, setAgentStatus] = useState("checking");
  const [agentCheckAttempt, setAgentCheckAttempt] = useState(0);
  const recheckAgent = () => {
    setAgentStatus("checking");
    setAgentCheckAttempt((n) => n + 1);
  };
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    fetch("http://localhost:8787/api/health", { signal: controller.signal })
      .then((res) => setAgentStatus(res.ok ? "online" : "offline"))
      .catch(() => setAgentStatus("offline"))
      .finally(() => clearTimeout(timeout));
  }, [agentCheckAttempt]);

  const openSavedPdf = async () => {
    try {
      await api.openProjectFile(currentProjectId, pdfSavedPath);
    } catch (err) {
      setPdfStatus(`Failed: ${err.message}`);
    }
  };

  const openSavedCbz = async () => {
    try {
      await api.openProjectFile(currentProjectId, cbzSavedPath);
    } catch (err) {
      setCbzStatus(`Failed: ${err.message}`);
    }
  };

  // Switching back to a language already shown before is instant — bubble.translations
  // is never cleared by this, only by hand-editing a bubble's original text (see
  // Bubble.jsx's commitText) — so there's nothing to re-translate, just flip the page's
  // display flag via the plain page PATCH. Switching TO a new language calls the actual
  // /translate route, which only pays for a Codex call on bubbles it hasn't already
  // translated.
  const changeLanguage = async (targetLang) => {
    if (!currentPage) return;
    setTranslateError("");
    const applyUpdatedPage = (updated) => {
      setCurrentPage(updated);
      setPages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    };
    if (targetLang === "en") {
      const updated = await api.updatePage(currentProjectId, currentPage.id, { language: "en" });
      applyUpdatedPage(updated);
      return;
    }
    setTranslateBusy(true);
    try {
      const updated = await api.translatePage(currentProjectId, currentPage.id, targetLang);
      applyUpdatedPage(updated);
    } catch (err) {
      setTranslateError(err.message);
    } finally {
      setTranslateBusy(false);
    }
  };

  const refreshProjects = useCallback(() => api.listProjects().then(setProjects), []);

  const refreshEntities = useCallback((projectId) => {
    for (const k of ["characters", "places", "objects", "references"]) {
      api.listEntities(projectId, k).then((list) => setEntities((prev) => ({ ...prev, [k]: list })));
    }
  }, []);

  const refreshPages = useCallback((projectId) => api.listPages(projectId).then(setPages), []);

  const refreshCustomFonts = useCallback((projectId) => api.listFonts(projectId).then(setCustomFonts), []);

  // Registers each uploaded font's @font-face so `customFontFamilyName(font.id)` (see
  // Bubble.jsx's fontFamilyFor) actually resolves to something — done here, once per
  // project, rather than per-bubble, since the same uploaded font can be reused by any
  // bubble anywhere in the project.
  useEffect(() => {
    const styleEl = document.createElement("style");
    document.head.appendChild(styleEl);
    styleEl.textContent = customFonts
      .map((f) => `@font-face { font-family: "${customFontFamilyName(f.id)}"; src: url("${f.url}"); }`)
      .join("\n");
    return () => styleEl.remove();
  }, [customFonts]);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  const openProject = (id) => {
    setCurrentProjectId(id);
    setCurrentPage(null);
    setSelectedPanelId(null);
    setShowTerminal(true); // auto-open, cwd'd into this project's folder
    refreshEntities(id);
    refreshPages(id);
    refreshCustomFonts(id);
  };

  // Uploads a font file from the user's computer, makes it available project-wide (not
  // just to the bubble that triggered the upload), and returns its new `custom:<id>`
  // bubble.font value so the caller can apply it immediately.
  const uploadCustomFont = async (file) => {
    const formData = new FormData();
    formData.append("font", file);
    const font = await api.createFont(currentProjectId, formData);
    setCustomFonts((prev) => [...prev, font]);
    return customFontValue(font.id);
  };

  const createProject = async (name) => {
    const project = await api.createProject(name);
    await refreshProjects();
    openProject(project.id);
  };

  const deleteProjectById = async (id, name) => {
    if (!window.confirm(`Delete "${name}" and everything in it — characters, places, objects, pages, panels? This can't be undone.`)) {
      return;
    }
    await api.deleteProject(id);
    await refreshProjects();
    if (currentProjectId === id) setCurrentProjectId(null);
  };

  const [folderStatus, setFolderStatus] = useState("");
  const openCurrentProjectFolder = async () => {
    setFolderStatus("");
    try {
      await api.openProjectFolder(currentProjectId);
      setFolderStatus("Opened in file manager");
    } catch (err) {
      setFolderStatus(`Failed: ${err.message}`);
    }
  };

  const openPage = async (id) => {
    const page = await api.getPage(currentProjectId, id);
    setCurrentPage(page);
    setSelectedPanelId(null);
  };

  // Big prev/next arrows beside the page canvas — quicker than reaching for the page
  // picker dropdown when just paging through a project in order.
  const currentPageIndex = currentPage ? pages.findIndex((p) => p.id === currentPage.id) : -1;
  const goToPrevPage = () => {
    if (currentPageIndex > 0) openPage(pages[currentPageIndex - 1].id);
  };
  const goToNextPage = () => {
    if (currentPageIndex >= 0 && currentPageIndex < pages.length - 1) openPage(pages[currentPageIndex + 1].id);
  };

  // Also patches the page into `pages` (not just `currentPage`) so mentioning this
  // page's panels for continuity from elsewhere in the project stays up to date.
  const refreshCurrentPage = async () => {
    if (!currentPage) return;
    const updated = await api.getPage(currentProjectId, currentPage.id);
    setCurrentPage(updated);
    setPages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  // Live drag feedback (no network call) — see PanelThumb's pointermove handler.
  const dragPanelImage = (panelId, imageOffset) => {
    setCurrentPage((page) => patchPanelInPage(page, panelId, (p) => ({ ...p, imageOffset })));
  };

  // Persist the final position once the drag ends.
  const commitPanelImage = (panelId, imageOffset) => {
    api.updatePanel(currentProjectId, currentPage.id, panelId, { imageOffset });
  };

  // Generic live-preview patch (no network call) — used by the panel editor sidebar's
  // zoom slider so the canvas visibly updates while dragging, not just once it's
  // released. Mirrors dragPanelImage above; that one's offset-specific, this one isn't
  // since the sidebar has more than one field that wants this (zoom now, maybe more later).
  const updatePanelLive = (panelId, patch) => {
    setCurrentPage((page) => patchPanelInPage(page, panelId, (p) => ({ ...p, ...patch })));
  };

  // Live bubble edits (drag/resize/tail-aim in progress) — local only, no network call.
  const updateBubblesLive = (panelId, bubbles) => {
    setCurrentPage((page) => patchPanelInPage(page, panelId, (p) => ({ ...p, bubbles })));
  };

  // Persist bubbles — called once at the end of a drag, or immediately for discrete
  // actions (add/delete/shape change/text edit).
  const commitBubbles = (panelId, bubbles) => {
    updateBubblesLive(panelId, bubbles);
    api.updatePanel(currentProjectId, currentPage.id, panelId, { bubbles });
  };

  const addBubble = (panelId) => {
    const panel = findPanelInPage(currentPage, panelId);
    commitBubbles(panelId, [...(panel.bubbles || []), newBubble()]);
  };

  // Live expression-mark edits (drag/resize/rotate in progress) — local only, no
  // network call. Mirrors updateBubblesLive/commitBubbles/addBubble above.
  const updateExpressionsLive = (panelId, expressions) => {
    setCurrentPage((page) => patchPanelInPage(page, panelId, (p) => ({ ...p, expressions })));
  };

  const commitExpressions = (panelId, expressions) => {
    updateExpressionsLive(panelId, expressions);
    api.updatePanel(currentProjectId, currentPage.id, panelId, { expressions });
  };

  const addExpression = (panelId) => {
    const panel = findPanelInPage(currentPage, panelId);
    commitExpressions(panelId, [...(panel.expressions || []), newExpression()]);
  };

  // Live floating-panel move/resize (dragging in progress) — local only, no network
  // call. Persisted the same way as everything else on a panel: the generic PATCH
  // endpoint, which finds the panel in whichever of the two arrays actually has it.
  const updateFloatingLive = (panelId, patch) => {
    setCurrentPage((page) => patchPanelInPage(page, panelId, (p) => ({ ...p, ...patch })));
  };

  const commitFloatingPatch = (panelId, patch) => {
    updateFloatingLive(panelId, patch);
    api.updatePanel(currentProjectId, currentPage.id, panelId, patch);
  };

  // Adds a floating panel and immediately opens it in the sidebar — same idea as
  // clicking a freshly-created grid panel, so the user lands straight on "generate an
  // image or add bubbles" instead of having to go find the tiny new box on the page.
  const addFloatingPanel = async () => {
    const updated = await api.createFloatingPanel(currentProjectId, currentPage.id);
    setCurrentPage(updated);
    setPages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    const created = updated.floatingPanels[updated.floatingPanels.length - 1];
    setSelectedPanelId(created.id);
  };

  // Live grid track resize (dragging a seam between panels, see GridResizeHandles) — local
  // only, so the canvas visibly reflows while dragging, not just once it's released.
  const updateGridLive = (patch) => {
    setCurrentPage((page) => ({ ...page, ...patch }));
  };

  // Persist the dragged column/row track sizes once at the end of a drag.
  const commitGrid = (patch) => {
    updateGridLive(patch);
    api.updatePage(currentProjectId, currentPage.id, patch);
  };

  const createPage = async ({ title, layout, stylePreset }) => {
    const panelCount = LAYOUTS.find((l) => l.value === layout)?.panelCount ?? 4;
    const page = await api.createPage(currentProjectId, { title, layout, stylePreset, panelCount });
    await refreshPages(currentProjectId);
    setCurrentPage(page);
  };

  const deletePage = async (pageId) => {
    const target = pages.find((p) => p.id === pageId);
    if (!target) return;
    const withContent = target.panels.filter(panelHasContent).length;
    const detail = withContent > 0 ? ` — ${withContent} panel(s) have a generated image or scene text` : "";
    if (!window.confirm(`Delete "${target.title}" and all its panels${detail}? This can't be undone.`)) return;

    await api.deletePage(currentProjectId, pageId);
    setPages((prev) => prev.filter((p) => p.id !== pageId));
    if (currentPage?.id === pageId) {
      setCurrentPage(null);
      setSelectedPanelId(null);
    }
  };

  // Renders the page canvas exactly as shown on screen (panels, images, speech bubbles)
  // to a raster image via html2canvas, drops that into a same-aspect-ratio PDF page, and
  // posts the bytes to the backend to live under projects/<id>/pages/<title>.pdf.
  // Deselecting first hides edit-only chrome (delete buttons, resize/tail handles) that
  // shouldn't appear in the exported page.
  const exportPagePdf = async () => {
    const hadSelection = selectedPanelId;
    setSelectedPanelId(null);
    await new Promise((r) => setTimeout(r, 50));

    setPdfBusy(true);
    setPdfStatus("");
    setPdfSavedPath("");
    let restoreImages = () => {};
    let restoreBubbles = () => {};
    try {
      restoreImages = await precropPanelImages(pageCanvasRef.current);
      restoreBubbles = precropBubbleOutlines(pageCanvasRef.current, currentPage);
      const canvas = await html2canvas(pageCanvasRef.current, { backgroundColor: "#1c1d24", scale: 2 });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ unit: "px", format: [canvas.width, canvas.height] });
      pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
      const blob = pdf.output("blob");

      const formData = new FormData();
      formData.append("pdf", blob, "page.pdf");
      const result = await api.savePagePdf(currentProjectId, currentPage.id, formData);
      setPdfStatus(`Saved as pages/${result.filename}`);
      setPdfSavedPath(`pages/${result.filename}`);
    } catch (err) {
      setPdfStatus(`Failed: ${err.message}`);
    } finally {
      restoreImages();
      restoreBubbles();
      setPdfBusy(false);
      if (hadSelection) setSelectedPanelId(hadSelection);
    }
  };

  // Same per-page capture as exportPagePdf, looped across every page into one multi-page
  // PDF instead of one file per page. html2canvas can only capture DOM that's actually on
  // screen, and only one page is ever mounted at a time (`currentPage`) — so this works by
  // briefly flipping the visible page through each one in turn, capturing it, then moving
  // on. That means the page view visibly flashes through every page during export; this
  // is simpler than rendering pages off-screen and the page count is normally small enough
  // that it doesn't matter in practice.
  const exportAllPagesPdf = async () => {
    const hadSelection = selectedPanelId;
    const hadPageId = currentPage?.id;
    setSelectedPanelId(null);

    setPdfBusy(true);
    setPdfStatus("");
    setPdfSavedPath("");
    // `pages` only gets refreshed by certain actions (creating/deleting a page, etc.) —
    // bubble/scene edits update `currentPage` alone, so whichever page you were just
    // editing can be stale here otherwise (missing whatever you just added). Same
    // substitution as allPanelsForMention below, for the same reason. Declared outside
    // the try so the finally block below (which restores whatever page was open before
    // export) can use the same fresh data instead of reverting it back to stale.
    const freshPages = pages.map((p) => (p.id === currentPage?.id ? currentPage : p));
    try {
      let pdf = null;
      for (const page of freshPages) {
        setCurrentPage(page);
        await new Promise((r) => setTimeout(r, 50));

        const restoreImages = await precropPanelImages(pageCanvasRef.current);
        const restoreBubbles = precropBubbleOutlines(pageCanvasRef.current, page);
        const canvas = await html2canvas(pageCanvasRef.current, { backgroundColor: "#1c1d24", scale: 2 });
        restoreImages();
        restoreBubbles();
        const imgData = canvas.toDataURL("image/png");

        if (!pdf) {
          pdf = new jsPDF({ unit: "px", format: [canvas.width, canvas.height] });
        } else {
          pdf.addPage([canvas.width, canvas.height]);
        }
        pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
      }

      if (!pdf) throw new Error("no pages to export");
      const blob = pdf.output("blob");
      const formData = new FormData();
      formData.append("pdf", blob, "book.pdf");
      const result = await api.saveProjectPdf(currentProjectId, formData);
      setPdfStatus(`Saved as ${result.filename}`);
      setPdfSavedPath(result.filename);
    } catch (err) {
      setPdfStatus(`Failed: ${err.message}`);
    } finally {
      const restored = freshPages.find((p) => p.id === hadPageId);
      setCurrentPage(restored || null);
      setPdfBusy(false);
      if (hadSelection) setSelectedPanelId(hadSelection);
    }
  };

  // Same per-page capture loop as exportAllPagesPdf, but zips the page images into a CBZ
  // (a plain zip of page001.png, page002.png, ... — the format every comic/manga reader
  // expects) instead of assembling a PDF.
  const exportAllPagesCbz = async () => {
    const hadSelection = selectedPanelId;
    const hadPageId = currentPage?.id;
    setSelectedPanelId(null);

    setCbzBusy(true);
    setCbzStatus("");
    setCbzSavedPath("");
    const freshPages = pages.map((p) => (p.id === currentPage?.id ? currentPage : p));
    try {
      const zip = new JSZip();
      let pageNumber = 0;
      for (const page of freshPages) {
        setCurrentPage(page);
        await new Promise((r) => setTimeout(r, 50));

        const restoreImages = await precropPanelImages(pageCanvasRef.current);
        const restoreBubbles = precropBubbleOutlines(pageCanvasRef.current, page);
        const canvas = await html2canvas(pageCanvasRef.current, { backgroundColor: "#1c1d24", scale: 2 });
        restoreImages();
        restoreBubbles();

        pageNumber += 1;
        const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        zip.file(`page-${String(pageNumber).padStart(3, "0")}.png`, pngBlob);
      }

      if (pageNumber === 0) throw new Error("no pages to export");
      const blob = await zip.generateAsync({ type: "blob" });
      const formData = new FormData();
      formData.append("cbz", blob, "book.cbz");
      const result = await api.saveProjectCbz(currentProjectId, formData);
      setCbzStatus(`Saved as ${result.filename}`);
      setCbzSavedPath(result.filename);
    } catch (err) {
      setCbzStatus(`Failed: ${err.message}`);
    } finally {
      const restored = freshPages.find((p) => p.id === hadPageId);
      setCurrentPage(restored || null);
      setCbzBusy(false);
      if (hadSelection) setSelectedPanelId(hadSelection);
    }
  };

  // Switching to a layout with fewer panels drops the trailing ones (grid position
  // comes from array order — see PageCanvas), so warn first if any would be lost.
  const changeLayout = async (layoutValue) => {
    const panelCount = LAYOUTS.find((l) => l.value === layoutValue)?.panelCount ?? 4;
    const dropped = currentPage.panels.slice(panelCount);
    if (dropped.length > 0) {
      const withContent = dropped.filter(panelHasContent).length;
      const detail =
        withContent > 0
          ? `, including ${withContent} with a generated image or scene text`
          : " (all empty)";
      const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
      if (
        !window.confirm(
          `This layout has ${plural(panelCount, "panel")} — the last ${plural(dropped.length, "panel")}${detail} will be removed. Continue?`
        )
      ) {
        return;
      }
    }
    const updated = await api.updatePage(currentProjectId, currentPage.id, { layout: layoutValue, panelCount });
    setCurrentPage(updated);
    await refreshPages(currentProjectId);
    if (selectedPanelId && !findPanelInPage(updated, selectedPanelId)) setSelectedPanelId(null);
  };

  const deletePanel = async (panelId) => {
    if (!window.confirm("Delete this panel? This can't be undone.")) return;
    const updated = await api.deletePanel(currentProjectId, currentPage.id, panelId);
    setCurrentPage(updated);
    setPages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setSelectedPanelId(null);
  };

  // Swaps this panel with its neighbor — the panel stays selected throughout, it's just
  // moved to a different spot in the grid (see the server's reindexPanelOrder comment).
  const movePanel = async (panelId, direction) => {
    const updated = await api.movePanel(currentProjectId, currentPage.id, panelId, direction);
    setCurrentPage(updated);
    setPages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const selectedPanel = (currentPage && findPanelInPage(currentPage, selectedPanelId)) || null;

  // Every panel across every page in the project, for the scene editor's #mention list
  // (continuity references aren't limited to the current page). `currentPage` stands in
  // for its own entry in `pages` so its panels are never stale mid-edit.
  const allPanelsForMention = pages
    .map((p) => (p.id === currentPage?.id ? currentPage : p))
    .flatMap((p) => p.panels.map((panel) => ({ ...panel, pageTitle: p.title })));

  // ---------- Local agent not reachable / not yet checked ----------
  if (agentStatus === "checking") return <div className="agent-checking">Checking for local agent…</div>;
  if (agentStatus === "offline") return <DownloadPrompt onRetry={recheckAgent} />;

  // ---------- Landing: no project open yet ----------
  if (!currentProjectId) {
    return (
      <>
        <ProjectLanding
          projects={projects}
          onOpen={openProject}
          onCreate={createProject}
          onDelete={deleteProjectById}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <TerminalOverlay
          show={showTerminal}
          projectId={currentProjectId}
          onToggle={() => setShowTerminal((v) => !v)}
        />
      </>
    );
  }

  const terminalToggle = (
    <TerminalOverlay show={showTerminal} projectId={currentProjectId} onToggle={() => setShowTerminal((v) => !v)} />
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-header-top">
            <span className="app-name">Ibraheem Manga Studio</span>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
          <button className="back-link" onClick={() => setCurrentProjectId(null)}>
            ← Projects
          </button>
        </div>

        <button className="open-folder-button" onClick={openCurrentProjectFolder}>
          Open folder location
        </button>
        {folderStatus && (
          <p className={`empty-hint${folderStatus.startsWith("Failed") ? " error" : ""}`}>{folderStatus}</p>
        )}

        <div className="tabs">
          {ENTITY_KINDS.map((k) => (
            <button key={k.value} className={k.value === kind ? "active" : ""} onClick={() => setKind(k.value)}>
              {k.label}
            </button>
          ))}
        </div>

        <button
          className="primary add-entity-button"
          onClick={() => setEditingEntity({ kind, entity: null })}
        >
          + Add new {ENTITY_KINDS.find((k) => k.value === kind).singular}
        </button>

        <div className="asset-grid">
          {entities[kind].map((entity) => (
            <button
              className="asset-card"
              key={entity.id}
              onClick={() => setEditingEntity({ kind, entity })}
            >
              {entity.imageUrl ? (
                <img src={entity.imageUrl} alt={entity.name} />
              ) : (
                <div className="asset-card-placeholder">No image</div>
              )}
              <span>{entity.name}</span>
            </button>
          ))}
          {entities[kind].length === 0 && <p className="empty-hint">No {kind} yet.</p>}
        </div>
      </aside>

      <main className="main">
        <PageBar
          pages={pages}
          currentPage={currentPage}
          onOpen={openPage}
          onCreate={createPage}
          onChangeLayout={changeLayout}
          onDelete={deletePage}
          onAddFloatingPanel={addFloatingPanel}
          onExportPdf={exportPagePdf}
          onExportAllPdf={exportAllPagesPdf}
          onExportAllCbz={exportAllPagesCbz}
          pdfBusy={pdfBusy}
          pdfStatus={pdfStatus}
          pdfSavedPath={pdfSavedPath}
          onOpenSavedPdf={openSavedPdf}
          cbzBusy={cbzBusy}
          cbzStatus={cbzStatus}
          cbzSavedPath={cbzSavedPath}
          onOpenSavedCbz={openSavedCbz}
          onChangeLanguage={changeLanguage}
          translateBusy={translateBusy}
          translateError={translateError}
        />
        {currentPage ? (
          <div className="page-canvas-nav">
            <button
              className="page-nav-arrow"
              onClick={goToPrevPage}
              disabled={currentPageIndex <= 0}
              title="Previous page"
              aria-label="Previous page"
            >
              ‹
            </button>
            <PageCanvas
              containerRef={pageCanvasRef}
              page={currentPage}
              selectedPanelId={selectedPanelId}
              onSelect={setSelectedPanelId}
              onDragImage={dragPanelImage}
              onDragImageEnd={commitPanelImage}
              customFonts={customFonts}
              lang={currentPage.language || "en"}
              onBubblesLive={updateBubblesLive}
              onBubblesCommit={commitBubbles}
              onExpressionsLive={updateExpressionsLive}
              onExpressionsCommit={commitExpressions}
              onFloatingLive={updateFloatingLive}
              onFloatingCommit={commitFloatingPatch}
              onGridLive={updateGridLive}
              onGridCommit={commitGrid}
            />
            <button
              className="page-nav-arrow"
              onClick={goToNextPage}
              disabled={currentPageIndex < 0 || currentPageIndex >= pages.length - 1}
              title="Next page"
              aria-label="Next page"
            >
              ›
            </button>
          </div>
        ) : (
          <p className="empty-hint">Create a page to get started.</p>
        )}
      </main>

      {selectedPanel && (
        <PanelEditor
          key={selectedPanel.id}
          projectId={currentProjectId}
          page={currentPage}
          panel={selectedPanel}
          characters={entities.characters}
          places={entities.places}
          objects={entities.objects}
          references={entities.references}
          allPanels={allPanelsForMention}
          onClose={() => setSelectedPanelId(null)}
          onUpdated={refreshCurrentPage}
          onDelete={deletePanel}
          onMove={movePanel}
          onLiveUpdate={updatePanelLive}
          onAddBubble={addBubble}
          onCommitBubbles={commitBubbles}
          onAddExpression={addExpression}
          onCommitExpressions={commitExpressions}
          customFonts={customFonts}
          onUploadFont={uploadCustomFont}
        />
      )}

      {editingEntity && (
        <EntityCreatorModal
          projectId={currentProjectId}
          kind={editingEntity.kind}
          entity={editingEntity.entity}
          onClose={() => setEditingEntity(null)}
          onSaved={() => refreshEntities(currentProjectId)}
        />
      )}

      {terminalToggle}
    </div>
  );
}

const TERMINAL_DEFAULT_SIZE = { width: 640, height: 380 };
const TERMINAL_MIN_SIZE = { width: 320, height: 180 };

// Floating, draggable, resizable window for the embedded terminal (see Terminal.jsx).
// Floats above the rest of the app (but stays below modals — a confirmation dialog
// must never end up hidden behind it). The underlying shell session lives server-side
// per project — closing this window just detaches the viewer (Generate can still write
// into it); reopening reattaches to the same running session. `key={projectId}` forces
// a fresh viewer connection when you switch projects, so it attaches to that project's
// session instead of the old one.
function TerminalOverlay({ show, projectId, onToggle }) {
  const [pos, setPos] = useState(() => ({
    x: Math.max(20, window.innerWidth - TERMINAL_DEFAULT_SIZE.width - 20),
    y: Math.max(20, window.innerHeight - TERMINAL_DEFAULT_SIZE.height - 60),
  }));
  const [size, setSize] = useState(TERMINAL_DEFAULT_SIZE);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const restoreRef = useRef(null);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);

  const onTitleMouseDown = (e) => {
    if (maximized || minimized || e.target.closest("button")) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: pos.x, startPosY: pos.y };
    const onMove = (ev) => {
      const { startX, startY, startPosX, startPosY } = dragRef.current;
      // Keeps the whole window on screen, not just its top-left edge — the titlebar's
      // buttons live on the right, and the resize handle lives at the bottom-right
      // corner, so clamping only one edge could push either out of reach.
      setPos({
        x: clamp(startPosX + (ev.clientX - startX), 0, Math.max(0, window.innerWidth - size.width)),
        y: clamp(startPosY + (ev.clientY - startY), 0, Math.max(0, window.innerHeight - size.height)),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onResizeMouseDown = (e) => {
    if (maximized) return;
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startWidth: size.width, startHeight: size.height };
    const onMove = (ev) => {
      const { startX, startY, startWidth, startHeight } = resizeRef.current;
      // Capped against the viewport edges too (not just a minimum) — otherwise growing
      // the window past the screen edge pushes its own titlebar buttons out of reach,
      // same failure as the uncapped drag bug above.
      setSize({
        width: clamp(startWidth + (ev.clientX - startX), TERMINAL_MIN_SIZE.width, window.innerWidth - pos.x),
        height: clamp(startHeight + (ev.clientY - startY), TERMINAL_MIN_SIZE.height, window.innerHeight - pos.y),
      });
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const toggleMaximize = () => {
    if (maximized) {
      if (restoreRef.current) {
        setPos(restoreRef.current.pos);
        setSize(restoreRef.current.size);
      }
      setMaximized(false);
    } else {
      restoreRef.current = { pos, size };
      setPos({ x: 20, y: 20 });
      setSize({ width: window.innerWidth - 40, height: window.innerHeight - 40 });
      setMaximized(true);
    }
  };

  return (
    <>
      <button className="terminal-toggle" onClick={onToggle}>
        {show ? "▼ Terminal" : "▲ Terminal"}
      </button>
      {show && (
        <div
          className="terminal-window"
          style={
            minimized
              ? { left: pos.x, bottom: 12, width: size.width, height: undefined }
              : { left: pos.x, top: pos.y, width: size.width, height: size.height }
          }
        >
          <div className="terminal-window-titlebar" onMouseDown={onTitleMouseDown}>
            <span>Terminal</span>
            <div className="terminal-window-controls">
              <button title={minimized ? "Restore" : "Minimize"} onClick={() => setMinimized((v) => !v)}>
                {minimized ? "▢" : "—"}
              </button>
              <button title={maximized ? "Restore" : "Maximize"} onClick={toggleMaximize}>
                {maximized ? "❐" : "□"}
              </button>
              <button title="Close" onClick={onToggle}>
                ✕
              </button>
            </div>
          </div>
          {!minimized && (
            <div className="terminal-window-body">
              <Terminal key={projectId} projectId={projectId} />
            </div>
          )}
          {!minimized && !maximized && <div className="terminal-window-resize-handle" onMouseDown={onResizeMouseDown} />}
        </div>
      )}
    </>
  );
}

// Shown instead of the app when no local agent answers on this visitor's own machine
// (see the health-check in App()). Download links point at files served from THIS same
// host (public/downloads/), not GitHub — so a real visitor never needs a GitHub account.
function DownloadPrompt({ onRetry }) {
  return (
    <div className="download-prompt">
      <h1>Get the local app</h1>
      <p>
        This runs on your own computer — your projects, your Codex account, and the terminal all stay on your
        machine, never on ours. Download and run it once, then come back here.
      </p>
      <div className="download-prompt-buttons">
        <a href="/downloads/manga-agent-windows.zip">Download for Windows</a>
        <a href="/downloads/manga-agent-linux.zip">Download for Linux</a>
      </div>
      <ol className="download-prompt-steps">
        <li>Download the zip for your OS above and extract it.</li>
        <li>
          Run <code>manga-agent</code> (or <code>manga-agent.exe</code> on Windows) — a window/terminal will show it
          running on <code>localhost:8787</code>.
        </li>
        <li>Come back to this page and click "Check again" below.</li>
      </ol>
      <button className="download-prompt-retry" onClick={onRetry}>
        Check again
      </button>
    </div>
  );
}

function ProjectLanding({ projects, onOpen, onCreate, onDelete, theme, onToggleTheme }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreate(name.trim());
    } finally {
      setBusy(false);
    }
  };

  if (projects === null) {
    return <div className="landing" />; // still loading
  }

  return (
    <div className="landing">
      <div className="landing-header">
        <h1>Ibraheem Manga Studio</h1>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
      <div className="project-grid">
        {projects.map((p) => (
          <div className="project-card-wrap" key={p.id}>
            <button className="project-card" onClick={() => onOpen(p.id)}>
              {p.name}
            </button>
            <button
              className="project-card-delete"
              title={`Delete ${p.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(p.id, p.name);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button className="project-card project-card-new" onClick={() => setShowForm(true)}>
          +
        </button>
      </div>
      {projects.length === 0 && !showForm && (
        <p className="empty-hint">No projects yet — click + to create your first one.</p>
      )}
      {showForm && (
        <form className="new-project-form" onSubmit={submit}>
          <input
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </form>
      )}
    </div>
  );
}

// Simple key/value editor for arbitrary structured details (gender, hairColor, texture, ...)
function FieldsEditor({ fields, onChange }) {
  const rows = Object.entries(fields);

  const setRow = (index, key, value) => {
    const next = [...rows];
    next[index] = [key, value];
    onChange(Object.fromEntries(next));
  };
  const addRow = () => onChange(Object.fromEntries([...rows, ["", ""]]));
  const removeRow = (index) => onChange(Object.fromEntries(rows.filter((_, i) => i !== index)));

  return (
    <div className="fields-editor">
      {rows.map(([key, value], i) => (
        <div className="field-row" key={i}>
          <input placeholder="field (e.g. gender)" value={key} onChange={(e) => setRow(i, e.target.value, value)} />
          <input placeholder="value" value={value} onChange={(e) => setRow(i, key, e.target.value)} />
          <button type="button" className="delete" onClick={() => removeRow(i)}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="add-field" onClick={addRow}>
        + Field
      </button>
    </div>
  );
}

// The character/place/object creator: fill in info, pick a style, then either upload a
// picture or click Generate to bridge everything to Codex. Redraw just re-runs
// generate against the same entity, replacing its image.
function EntityCreatorModal({ projectId, kind, entity: initialEntity, onClose, onSaved }) {
  const singular = ENTITY_KINDS.find((k) => k.value === kind).singular;
  const generatable = GENERATABLE_ENTITY_KINDS.has(kind);
  const [entity, setEntity] = useState(initialEntity);
  const [name, setName] = useState(initialEntity?.name || "");
  const [style, setStyle] = useState(initialEntity?.style || "manga_bw");
  const [fields, setFields] = useState(
    Object.fromEntries(Object.entries(initialEntity?.fields || {}).filter(([k]) => k !== "description"))
  );
  const [description, setDescription] = useState(initialEntity?.fields?.description || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [imageTab, setImageTab] = useState("create");
  // A picture picked before the entity is first saved can't be uploaded yet (there's no
  // entity id for the image endpoint to attach it to) — buffered here instead, previewed
  // via an object URL, and sent along with the very first save. Editing an existing
  // entity's picture still uploads immediately (see uploadImage below); this is only for
  // the "brand new, not saved yet" case.
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState(null);

  useEffect(() => {
    return () => {
      if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    };
  }, [pendingPreviewUrl]);

  const allFields = { ...fields, description };

  const saveDetails = async () => {
    setBusy(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("name", name.trim());
      // References are just a name + picture — no style/fields to save.
      if (generatable) {
        formData.append("style", style);
        formData.append("fields", JSON.stringify(allFields));
      }
      if (entity) {
        const updated = await api.updateEntity(projectId, kind, entity.id, formData);
        setEntity(updated);
      } else {
        if (pendingFile) formData.append("image", pendingFile);
        const created = await api.createEntity(projectId, kind, formData);
        setEntity(created);
        if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
        setPendingFile(null);
        setPendingPreviewUrl(null);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (!entity) {
      setError("Save the details first, then generate.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await api.generateEntity(projectId, kind, entity.id);
      setEntity(updated);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // The file input calls this — for a brand new (unsaved) entity it just buffers the
  // picked file for saveDetails to send; for an existing one it uploads right away.
  const pickImage = (file) => {
    if (!file) return;
    if (!entity) {
      if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
      setPendingFile(file);
      setPendingPreviewUrl(URL.createObjectURL(file));
      return;
    }
    uploadImage(file);
  };

  const uploadImage = async (file) => {
    setBusy(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("image", file);
      const updated = await api.updateEntity(projectId, kind, entity.id, formData);
      setEntity(updated);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!entity) return onClose();
    await api.deleteEntity(projectId, kind, entity.id);
    onSaved();
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal entity-modal">
        <div className="panel-editor-header">
          <h2>{entity ? entity.name : `New ${singular}`}</h2>
          <button onClick={onClose}>Close</button>
        </div>

        <div className="entity-modal-body">
          <section className="entity-info-section">
            <h4>Name</h4>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />

            {generatable && (
              <>
                <h4>Description</h4>
                <textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />

                <h4>Details</h4>
                <FieldsEditor fields={fields} onChange={setFields} />

                <h4>Style</h4>
                <select value={style} onChange={(e) => setStyle(e.target.value)}>
                  {STYLE_PRESETS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </>
            )}

            {error && <p className="error">{error}</p>}

            <button className="primary" onClick={saveDetails} disabled={busy || !name.trim()}>
              {busy ? "Saving…" : entity ? "Save changes" : "Create"}
            </button>

            {entity && (
              <button className="delete-entity" onClick={remove}>
                Delete {singular}
              </button>
            )}
          </section>

          <section className="entity-image-section">
            <h4>Picture</h4>
            {generatable && (
              <div className="tabs entity-image-tabs">
                <button className={imageTab === "create" ? "active" : ""} onClick={() => setImageTab("create")}>
                  Create
                </button>
                <button className={imageTab === "generate" ? "active" : ""} onClick={() => setImageTab("generate")}>
                  Generate
                </button>
              </div>
            )}

            {pendingPreviewUrl || entity?.imageUrl ? (
              <img className="entity-preview" src={pendingPreviewUrl || entity.imageUrl} alt={name || entity?.name} />
            ) : (
              <div className="entity-preview entity-preview-empty">No image yet</div>
            )}

            {!generatable || imageTab === "create" ? (
              <>
                <p className="scene-editor-hint">Browse for a picture on your computer and use it directly.</p>
                <input
                  type="file"
                  accept="image/*"
                  disabled={busy}
                  onChange={(e) => pickImage(e.target.files[0])}
                />
              </>
            ) : (
              <>
                <p className="scene-editor-hint">
                  Uses the name, description, and details below to generate a picture via Codex.
                </p>
                <button className="primary" onClick={generate} disabled={busy || !entity}>
                  {busy ? "Generating…" : entity?.imageUrl ? "Redraw" : "Generate"}
                </button>
              </>
            )}

            {pendingFile && !entity && <p className="empty-hint">Picked — click "Create" to save it.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

function PageBar({
  pages,
  currentPage,
  onOpen,
  onCreate,
  onChangeLayout,
  onDelete,
  onAddFloatingPanel,
  onExportPdf,
  onExportAllPdf,
  onExportAllCbz,
  pdfBusy,
  pdfStatus,
  pdfSavedPath,
  onOpenSavedPdf,
  cbzBusy,
  cbzStatus,
  cbzSavedPath,
  onOpenSavedCbz,
  onChangeLanguage,
  translateBusy,
  translateError,
}) {
  const [showForm, setShowForm] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showLayoutPicker, setShowLayoutPicker] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [title, setTitle] = useState("");
  const [layout, setLayout] = useState("grid-2x2");
  const [stylePreset, setStylePreset] = useState("manga_bw");
  const menuRef = useRef(null);
  const langMenuRef = useRef(null);

  useEffect(() => {
    if (!showLangMenu) return;
    const onDocPointerDown = (e) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target)) setShowLangMenu(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [showLangMenu]);

  // One shared popover anchor (the ⋮ button) for both the action list and the layout
  // grid — closes both on an outside click, same trigger point either way instead of
  // jumping to wherever "Change layout" used to live in the old always-visible row.
  useEffect(() => {
    if (!showMenu && !showLayoutPicker) return;
    const onDocPointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
        setShowLayoutPicker(false);
      }
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [showMenu, showLayoutPicker]);

  const submit = async (e) => {
    e.preventDefault();
    await onCreate({ title, layout, stylePreset });
    setTitle("");
    setShowForm(false);
  };

  const pickLayout = (value) => {
    onChangeLayout(value);
    setShowLayoutPicker(false);
  };

  return (
    <div className="page-bar">
      {currentPage && (
        <div className="page-menu-wrap" ref={langMenuRef}>
          <button
            type="button"
            className="page-language-toggle"
            onClick={() => setShowLangMenu((v) => !v)}
            disabled={translateBusy}
            title="Translate every speech bubble on this page, or switch back to the original"
          >
            {translateBusy
              ? "Translating…"
              : BUBBLE_LANGUAGES.find((l) => l.value === (currentPage.language || "en"))?.label}
          </button>

          {showLangMenu && (
            <div className="page-menu-popover">
              {BUBBLE_LANGUAGES.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  className={`page-menu-item${l.value === (currentPage.language || "en") ? " active" : ""}`}
                  onClick={() => {
                    setShowLangMenu(false);
                    onChangeLanguage(l.value);
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <select value={currentPage?.id || ""} onChange={(e) => onOpen(e.target.value)}>
        <option value="" disabled>
          Select a page…
        </option>
        {pages.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>

      <div className="page-menu-wrap" ref={menuRef}>
        <button
          type="button"
          className="page-menu-trigger"
          onClick={() => {
            setShowLayoutPicker(false);
            setShowMenu((v) => !v);
          }}
          title="Page actions"
          aria-label="Page actions"
        >
          ⋮
        </button>

        {showMenu && (
          <div className="page-menu-popover">
            <button
              type="button"
              className="page-menu-item"
              onClick={() => {
                setShowForm((v) => !v);
                setShowMenu(false);
              }}
            >
              + New page
            </button>
            {currentPage && (
              <button
                type="button"
                className="page-menu-item"
                title="Add a floating panel — drag/resize it anywhere on top of the page"
                onClick={() => {
                  onAddFloatingPanel();
                  setShowMenu(false);
                }}
              >
                + Floating panel
              </button>
            )}
            {currentPage && (
              <button
                type="button"
                className="page-menu-item"
                onClick={() => {
                  setShowMenu(false);
                  setShowLayoutPicker(true);
                }}
              >
                Change layout
              </button>
            )}
            {currentPage && (
              <button
                type="button"
                className="page-menu-item"
                disabled={pdfBusy || cbzBusy}
                onClick={() => {
                  setShowMenu(false);
                  onExportPdf();
                }}
              >
                {pdfBusy ? "Saving PDF…" : "Save as PDF"}
              </button>
            )}
            {pages.length > 1 && (
              <button
                type="button"
                className="page-menu-item"
                disabled={pdfBusy || cbzBusy}
                onClick={() => {
                  setShowMenu(false);
                  onExportAllPdf();
                }}
              >
                {pdfBusy ? "Saving PDF…" : "Export all pages as PDF"}
              </button>
            )}
            {pages.length > 1 && (
              <button
                type="button"
                className="page-menu-item"
                disabled={pdfBusy || cbzBusy}
                onClick={() => {
                  setShowMenu(false);
                  onExportAllCbz();
                }}
              >
                {cbzBusy ? "Saving CBZ…" : "Export all pages as CBZ"}
              </button>
            )}
            {currentPage && (
              <button
                type="button"
                className="page-menu-item page-menu-item-danger"
                onClick={() => {
                  setShowMenu(false);
                  onDelete(currentPage.id);
                }}
              >
                Delete page
              </button>
            )}
          </div>
        )}

        {showLayoutPicker && currentPage && (
          <div className="page-menu-popover page-menu-popover-wide">
            <LayoutPicker value={currentPage.layout} onChange={pickLayout} />
          </div>
        )}
      </div>

      {pdfStatus && (
        <span className={`pdf-status${pdfStatus.startsWith("Failed") ? " pdf-status-error" : ""}`}>{pdfStatus}</span>
      )}
      {pdfSavedPath && (
        <button className="pdf-open-button" onClick={onOpenSavedPdf}>
          Open
        </button>
      )}
      {cbzStatus && (
        <span className={`pdf-status${cbzStatus.startsWith("Failed") ? " pdf-status-error" : ""}`}>{cbzStatus}</span>
      )}
      {cbzSavedPath && (
        <button className="pdf-open-button" onClick={onOpenSavedCbz}>
          Open
        </button>
      )}
      {translateError && <span className="pdf-status pdf-status-error">{translateError}</span>}

      {showForm && (
        <form className="new-page-form" onSubmit={submit}>
          <input placeholder="Page title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <LayoutPicker value={layout} onChange={setLayout} />
          <select value={stylePreset} onChange={(e) => setStylePreset(e.target.value)}>
            {STYLE_PRESETS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button type="submit">Create</button>
        </form>
      )}
    </div>
  );
}

// Visual grid of layout thumbnails — each one renders a small live replica of the
// actual panel arrangement (same grid template as the real page), so you can see the
// shape directly instead of guessing from a text label.
function LayoutPicker({ value, onChange }) {
  return (
    <div className="layout-picker">
      {LAYOUTS.map((l) => (
        <button
          key={l.value}
          type="button"
          className={`layout-option ${l.value === value ? "selected" : ""}`}
          onClick={() => onChange(l.value)}
          title={l.label}
        >
          <div
            className="layout-preview"
            style={l.panels ? undefined : { gridTemplateAreas: l.areas, gridTemplateColumns: l.columns, gridTemplateRows: l.rows }}
          >
            {Array.from({ length: l.panelCount }, (_, i) =>
              l.panels ? (
                <div
                  key={i}
                  className="layout-preview-panel"
                  style={{
                    position: "absolute",
                    left: `${l.panels[i].x}%`,
                    top: `${l.panels[i].y}%`,
                    width: `${l.panels[i].width}%`,
                    height: `${l.panels[i].height}%`,
                    clipPath: l.panels[i].clipPath,
                  }}
                />
              ) : (
                <div key={i} className="layout-preview-panel" style={{ gridArea: `p${i + 1}` }} />
              )
            )}
          </div>
          <span className="layout-option-label">{l.panelCount}p</span>
        </button>
      ))}
    </div>
  );
}

function PageCanvas({
  containerRef,
  page,
  selectedPanelId,
  onSelect,
  onDragImage,
  onDragImageEnd,
  customFonts,
  lang,
  onBubblesLive,
  onBubblesCommit,
  onExpressionsLive,
  onExpressionsCommit,
  onFloatingLive,
  onFloatingCommit,
  onGridLive,
  onGridCommit,
}) {
  const template = LAYOUTS.find((l) => l.value === page.layout) || LAYOUTS.find((l) => l.value === "grid-2x2");
  const isFreeform = !!template.panels;
  // A page can override its layout template's default track sizes by dragging the seams
  // between panels (see GridResizeHandles) — cleared server-side whenever the layout
  // itself changes, since a different template's grid-area structure makes an old
  // override meaningless.
  const columns = page.gridColumns || template.columns;
  const rows = page.gridRows || template.rows;

  return (
    <div
      ref={containerRef}
      className="page-canvas"
      style={isFreeform ? undefined : { gridTemplateAreas: template.areas, gridTemplateColumns: columns, gridTemplateRows: rows }}
    >
      {page.panels.map((panel, i) => {
        const slot = isFreeform ? template.panels[i] : null;
        const slotStyle = isFreeform
          ? { position: "absolute", left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.width}%`, height: `${slot.height}%` }
          : { gridArea: `p${i + 1}` };
        return (
          <PanelThumb
            key={panel.id}
            panel={panel}
            selected={panel.id === selectedPanelId}
            slotStyle={slotStyle}
            clipPath={slot?.clipPath}
            onSelect={onSelect}
            onDragImage={onDragImage}
            onDragImageEnd={onDragImageEnd}
            customFonts={customFonts}
            lang={lang}
            onBubblesLive={onBubblesLive}
            onBubblesCommit={onBubblesCommit}
            onExpressionsLive={onExpressionsLive}
            onExpressionsCommit={onExpressionsCommit}
          />
        );
      })}
      {!isFreeform && (
        <GridResizeHandles
          containerRef={containerRef}
          columns={columns}
          rows={rows}
          areas={template.areas}
          onLiveChange={onGridLive}
          onCommit={onGridCommit}
        />
      )}

      {/* Rendered AFTER the grid panels above (not interleaved with them) — floats over
          the whole layout rather than occupying a grid-area/freeform slot of its own,
          positioned by its own x/y/width/height instead of an array-index-driven slot. */}
      {(page.floatingPanels || []).map((panel) => (
        <PanelThumb
          key={panel.id}
          panel={panel}
          selected={panel.id === selectedPanelId}
          slotStyle={{ position: "absolute", left: `${panel.x}%`, top: `${panel.y}%`, width: `${panel.width}%`, height: `${panel.height}%` }}
          floating
          pageContainerRef={containerRef}
          onFloatingLive={onFloatingLive}
          onFloatingCommit={onFloatingCommit}
          onSelect={onSelect}
          onDragImage={onDragImage}
          onDragImageEnd={onDragImageEnd}
          customFonts={customFonts}
          lang={lang}
          onBubblesLive={onBubblesLive}
          onBubblesCommit={onBubblesCommit}
          onExpressionsLive={onExpressionsLive}
          onExpressionsCommit={onExpressionsCommit}
        />
      ))}
    </div>
  );
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// object-fit: cover sizes the image to exactly fill the (axis-aligned) frame — rotating
// that already-fitted box with a plain CSS rotate() just spins it in place, which uncovers
// the frame's corners (or past 45°, most of it, since the box's long/short axes swap
// relative to the frame). This is the minimum extra scale, for the given rotation and
// frame aspect ratio (width/height), needed so the rotated box still fully covers an
// axis-aligned frame of that aspect ratio with no gaps.
function requiredCoverScale(rotateDeg, aspect) {
  const rad = (rotateDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return Math.max(1, c + s / aspect, aspect * s + c);
}

// A panel's image is manually sized to its natural aspect ratio (scaled by imageScale,
// set from the panel editor sidebar) and positioned with left/top rather than
// object-fit: cover, so zooming actually zooms the source photo instead of just resizing
// an already-decided crop (see the sizing math above). Holding and dragging the image
// pans that crop — this tracks the drag in pixels, converts it to a percentage of how
// far the image overflows the frame in each axis, and only treats it as a "select this
// panel" click if the pointer never moved. Rotate/resize used to have on-canvas overlay
// buttons here too, but those lived inside .panel-slot-image-layer, which gets a
// clip-path for tilted/diagonal layouts — a corner-positioned button is frequently
// outside a slanted panel's actual visible polygon, so it was invisible and unclickable
// on exactly those panels. Moved to the panel editor sidebar instead, which is never
// clipped and always in the same place regardless of panel shape.
function PanelThumb({
  panel,
  selected,
  slotStyle,
  clipPath,
  onSelect,
  onDragImage,
  onDragImageEnd,
  onBubblesLive,
  onBubblesCommit,
  onExpressionsLive,
  onExpressionsCommit,
  floating,
  pageContainerRef,
  onFloatingLive,
  onFloatingCommit,
  customFonts,
  lang,
}) {
  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const dragRef = useRef(null);
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState(null);

  // Measured directly off the real box (rather than derived from the layout template's
  // width/height fractions) so it's exact regardless of the page-canvas's own padding/gap.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth && el.clientHeight) setFrameSize({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // We size/position the image manually instead of object-fit: cover (below), so we need
  // its natural dimensions ourselves — object-fit would otherwise have worked this out
  // internally without exposing them.
  const onImgLoad = (e) => setNatural({ w: e.target.naturalWidth, h: e.target.naturalHeight });
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
  }, [panel.imageUrl]);

  // Diagonal/tilted panels (clipPath truthy) render as a real SVG polygon shape instead
  // of a plain <img> — see the return below — so there's no rendered <img> element here
  // for `natural` to come from the usual way. Measured off a detached Image() instead,
  // and immediately re-encoded as a data: URI: an SVG <image> referencing this app's own
  // backend (a different port = a different origin) can silently fail to actually paint
  // when the page gets rasterized for a PDF export, even with proper CORS — inlining the
  // pixels directly sidesteps that rather than depending on it not happening.
  const [svgImageHref, setSvgImageHref] = useState(null);
  useEffect(() => {
    if (!clipPath || !panel.imageUrl) {
      setSvgImageHref(null);
      return;
    }
    let cancelled = false;
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      if (cancelled) return;
      setNatural({ w: im.naturalWidth, h: im.naturalHeight });
      const c = document.createElement("canvas");
      c.width = im.naturalWidth;
      c.height = im.naturalHeight;
      c.getContext("2d").drawImage(im, 0, 0);
      setSvgImageHref(c.toDataURL("image/png"));
    };
    im.src = panel.imageUrl;
    return () => {
      cancelled = true;
    };
  }, [clipPath, panel.imageUrl]);

  const offset = panel.imageOffset || { x: 50, y: 50 };
  const rotate = panel.imageRotate || 0;
  const zoom = panel.imageScale || 1;
  const frameW = frameSize.w || 1;
  const frameH = frameSize.h || 1;
  const rotateScale = requiredCoverScale(rotate, frameW / frameH);

  // `object-fit: cover` picks a fixed crop from the frame's own box size and never
  // revisits it — so scaling that already-cropped result via transform just shrinks/grows
  // the SAME crop, never showing more or less of the original photo. To make zoom behave
  // like an actual camera zoom (same frame size, more or less of the source visible), we
  // size the image ourselves at its natural aspect ratio, scaled by `zoom`, and position
  // it with left/top instead of object-position — object-fit never enters into it.
  let coverW = frameW;
  let coverH = frameH;
  if (natural && natural.w && natural.h) {
    const naturalRatio = natural.w / natural.h;
    const frameRatio = frameW / frameH;
    if (naturalRatio > frameRatio) {
      coverH = frameH;
      coverW = frameH * naturalRatio;
    } else {
      coverW = frameW;
      coverH = frameW / naturalRatio;
    }
  }
  const renderedW = coverW * zoom;
  const renderedH = coverH * zoom;
  const imgLeft = (frameW - renderedW) * (offset.x / 100);
  const imgTop = (frameH - renderedH) * (offset.y / 100);
  // Rotation must pivot on the FRAME's center, not this box's own center — panning moves
  // the box off-center, and rotating around the wrong point would spin the crop around
  // some point that visibly drifts as you pan.
  const rotateOriginX = frameW / 2 - imgLeft;
  const rotateOriginY = frameH / 2 - imgTop;

  const bubbles = panel.bubbles || [];
  const placeholderStyle = clipPath
    ? (() => {
        const c = polygonCentroid(clipPath);
        return { position: "absolute", left: `${c.x}%`, top: `${c.y}%`, transform: "translate(-50%, -50%)" };
      })()
    : undefined;

  const updateBubble = (bubbleId, patch, { commit }) => {
    const next = bubbles.map((b) => (b.id === bubbleId ? { ...b, ...patch } : b));
    (commit ? onBubblesCommit : onBubblesLive)(panel.id, next);
  };

  const deleteBubble = (bubbleId) => {
    onBubblesCommit(panel.id, bubbles.filter((b) => b.id !== bubbleId));
  };

  const expressions = panel.expressions || [];
  const updateExpression = (markId, patch, { commit }) => {
    const next = expressions.map((m) => (m.id === markId ? { ...m, ...patch } : m));
    (commit ? onExpressionsCommit : onExpressionsLive)(panel.id, next);
  };
  const deleteExpression = (markId) => {
    onExpressionsCommit(panel.id, expressions.filter((m) => m.id !== markId));
  };

  // Moving/resizing the floating panel itself — separate from onPointerDown below,
  // which pans/crops the IMAGE inside a panel. Both live on the same box, so each has
  // its own dedicated handle (a titlebar strip, a corner handle) and stops the pointer
  // event from bubbling to the other's listener. Math is percent-of-the-whole-page-
  // canvas (pageContainerRef), not percent-of-this-panel's-own-box (containerRef) —
  // unlike Bubble/ExpressionMark, this box IS the thing being measured, so it can't be
  // its own reference frame.
  const onFloatDragStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(panel.id);
    const rect = pageContainerRef.current.getBoundingClientRect();
    const startX = panel.x;
    const startY = panel.y;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    let lastPatch = {};
    const onMove = (ev) => {
      const dxPct = ((ev.clientX - startClientX) / rect.width) * 100;
      const dyPct = ((ev.clientY - startClientY) / rect.height) * 100;
      lastPatch = { x: clamp(startX + dxPct, 0, 100 - panel.width), y: clamp(startY + dyPct, 0, 100 - panel.height) };
      onFloatingLive(panel.id, lastPatch);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onFloatingCommit(panel.id, lastPatch);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onFloatResizeStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = pageContainerRef.current.getBoundingClientRect();
    const startW = panel.width;
    const startH = panel.height;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    let lastPatch = {};
    const onMove = (ev) => {
      const dwPct = ((ev.clientX - startClientX) / rect.width) * 100;
      const dhPct = ((ev.clientY - startClientY) / rect.height) * 100;
      lastPatch = { width: clamp(startW + dwPct, 10, 100 - panel.x), height: clamp(startH + dhPct, 10, 100 - panel.y) };
      onFloatingLive(panel.id, lastPatch);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onFloatingCommit(panel.id, lastPatch);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onPointerDown = (e) => {
    if (!panel.hasImage || e.button !== 0) return;
    e.preventDefault();

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOffset: offset,
      // SIGNED difference, not Math.max(0, ...) — when the image is smaller than the
      // frame (zoomed below 1x) this is negative, which is what makes the offset
      // formula below drag in the same direction as the mouse in that case too. Forcing
      // it positive (as a "no overflow" fallback used to) flipped the drag direction
      // specifically when zoomed out. The || frameW only guards the exact knife-edge
      // where image size equals frame size, to avoid a literal divide-by-zero.
      overflowX: renderedW - frameW || frameW,
      overflowY: renderedH - frameH || frameH,
      moved: false,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    d.moved = true;

    // No clamping — the frame's own overflow: hidden already crops whatever exits it,
    // so dragging far enough to crop the image out entirely (or, when zoomed below 1x,
    // to expose background on every side) is a deliberate, allowed outcome now, not
    // something to prevent.
    const nx = d.startOffset.x - (dx / d.overflowX) * 100;
    const ny = d.startOffset.y - (dy / d.overflowY) * 100;
    d.lastOffset = { x: nx, y: ny };
    onDragImage(panel.id, d.lastOffset);
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    dragRef.current = null;
    if (!d) return;
    if (d.moved) onDragImageEnd(panel.id, d.lastOffset);
    else onSelect(panel.id);
  };

  return (
    <div
      ref={containerRef}
      className={`panel-slot ${selected ? "selected" : ""} ${panel.hasImage ? "has-image" : ""} ${floating ? "floating" : ""}`}
      style={clipPath ? { ...slotStyle, clipPath } : slotStyle}
      onPointerDown={onPointerDown}
    >
      {floating && selected && (
        <button
          type="button"
          className="floating-panel-drag-handle"
          onPointerDown={onFloatDragStart}
          title="Drag to move"
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="5 9 2 12 5 15" />
            <polyline points="9 5 12 2 15 5" />
            <polyline points="15 19 12 22 9 19" />
            <polyline points="19 9 22 12 19 15" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <line x1="12" y1="2" x2="12" y2="22" />
          </svg>
        </button>
      )}
      {/* The OUTER panel-slot (not this inner image layer) still gets its own
          clip-path for tilted/diagonal layouts — two panels there share an identical
          bounding box, and without clipping the outer element too, clicks in one
          panel's visible area can hit-test against its neighbor's unclipped box
          instead, since that's what actually captures the pointer event. This layer's
          own clip-path is gone: for a diagonal panel the shape now comes from a real
          SVG polygon below instead, not a rectangle with part of it hidden. */}
      {/* This layer's own background/border are a plain rectangle CSS paints
          unconditionally — for a diagonal panel that would opaquely cover whichever
          sibling panel shares this exact box, exactly the bug this rework fixes.
          Cleared so only the SVG polygon shape below is ever actually visible. */}
      <div className="panel-slot-image-layer" style={clipPath ? { background: "transparent", border: "none" } : undefined}>
        {panel.hasImage ? (
          clipPath ? (
            svgImageHref && (
              <svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${frameW} ${frameH}`}
                preserveAspectRatio="none"
                style={{ position: "absolute", inset: 0, overflow: "hidden" }}
              >
                <defs>
                  <clipPath id={`panel-shape-${panel.id}`}>
                    <polygon points={svgPolygonPoints(clipPath, frameW, frameH)} />
                  </clipPath>
                </defs>
                <image
                  href={svgImageHref}
                  xlinkHref={svgImageHref}
                  x={imgLeft}
                  y={imgTop}
                  width={renderedW}
                  height={renderedH}
                  clipPath={`url(#panel-shape-${panel.id})`}
                  transform={`translate(${rotateOriginX} ${rotateOriginY}) rotate(${rotate}) scale(${rotateScale}) translate(${-rotateOriginX} ${-rotateOriginY})`}
                  style={{ filter: `brightness(${panel.imageBrightness ?? 100}%)` }}
                />
              </svg>
            )
          ) : (
            <img
              ref={imgRef}
              src={panel.imageUrl}
              alt=""
              draggable={false}
              crossOrigin="anonymous"
              onLoad={onImgLoad}
              style={{
                position: "absolute",
                left: imgLeft,
                top: imgTop,
                width: renderedW,
                height: renderedH,
                transform: `rotate(${rotate}deg) scale(${rotateScale})`,
                transformOrigin: `${rotateOriginX}px ${rotateOriginY}px`,
                filter: `brightness(${panel.imageBrightness ?? 100}%)`,
              }}
            />
          )
        ) : (
          <span className="placeholder" style={placeholderStyle} onClick={() => onSelect(panel.id)}>
            {floating ? "Click to set up this floating panel" : `Click to set up panel ${panel.order + 1}`}
          </span>
        )}
      </div>

      {floating && selected && (
        <div className="floating-panel-resize-handle" onPointerDown={onFloatResizeStart} title="Drag to resize" />
      )}

      {bubbles.map((bubble) => (
        <Bubble
          key={bubble.id}
          bubble={bubble}
          containerRef={containerRef}
          editable={selected}
          onChange={(patch, opts) => updateBubble(bubble.id, patch, opts)}
          onDelete={() => deleteBubble(bubble.id)}
          customFonts={customFonts}
          lang={lang}
        />
      ))}

      {expressions.map((mark) => (
        <ExpressionMark
          key={mark.id}
          mark={mark}
          containerRef={containerRef}
          editable={selected}
          onChange={(patch, opts) => updateExpression(mark.id, patch, opts)}
          onDelete={() => deleteExpression(mark.id)}
        />
      ))}
    </div>
  );
}

// Pops up once a requested edit comes back — big before/after images instead of the
// small inline thumbnails this replaced, since a tiny side-by-side pair made it hard to
// actually judge the change. Clicking either image IS the decision (no separate "keep
// this one" button to also click); there's no backdrop-dismiss, since "before" already
// covers "never mind, keep what I had."
function EditCompareModal({ beforeUrl, afterUrl, busy, onKeepOriginal, onKeepEdited }) {
  return (
    <div className="modal-backdrop">
      <div className="modal edit-compare-modal">
        <h2>Choose a version</h2>
        <p className="scene-editor-hint">Click the image you want to keep.</p>
        <div className="edit-compare-grid">
          <button type="button" className="edit-compare-option" onClick={onKeepOriginal} disabled={busy}>
            <span className="edit-compare-label">Before</span>
            <img src={beforeUrl} alt="Before edit" />
          </button>
          <button type="button" className="edit-compare-option" onClick={onKeepEdited} disabled={busy}>
            <span className="edit-compare-label">After</span>
            <img src={afterUrl} alt="After edit" />
          </button>
        </div>
        {busy && <p className="empty-hint">Saving…</p>}
      </div>
    </div>
  );
}

function PanelEditor({
  projectId,
  page,
  panel,
  characters,
  places,
  objects,
  references,
  allPanels,
  onClose,
  onUpdated,
  onDelete,
  onMove,
  onLiveUpdate,
  onAddBubble,
  onCommitBubbles,
  onAddExpression,
  onCommitExpressions,
  customFonts,
  onUploadFont,
}) {
  const [sceneDoc, setSceneDoc] = useState(panel.sceneDoc);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("scene");
  const [imageBusy, setImageBusy] = useState(false);
  const fileInputRef = useRef(null);
  const [imageError, setImageError] = useState("");
  const [editDoc, setEditDoc] = useState(EMPTY_DOC);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [editCandidate, setEditCandidate] = useState(null); // { blob, url } | null
  // Marks the region that needs the change, as 0-100 percentages of the panel's own
  // image — drawn by the user over the preview below, sent alongside the edit request,
  // but never part of the edited result (see backend's drawMarkerRect/buildEditPrompt).
  const [editMarker, setEditMarker] = useState(null); // { x, y, width, height } | null
  const [editMarkerAspect, setEditMarkerAspect] = useState(null);
  const editMarkerBoxRef = useRef(null);
  const editMarkerDragRef = useRef(null);
  const [showCopyFromPanel, setShowCopyFromPanel] = useState(false);
  // Live value while dragging the zoom slider or typing in either number box — null
  // means "not editing, show the committed panel value instead" (see the inputs below).
  const [zoomDraft, setZoomDraft] = useState(null);
  const [rotateDraft, setRotateDraft] = useState(null);
  const [brightnessDraft, setBrightnessDraft] = useState(null);
  const [filterType, setFilterType] = useState(panel.imageFilter || FILTER_TYPES[0].value);
  const [filterParamValue, setFilterParamValue] = useState(
    panel.imageFilterParams?.[filterParamMeta(panel.imageFilter || FILTER_TYPES[0].value).key] ??
      filterParamMeta(panel.imageFilter || FILTER_TYPES[0].value).default
  );
  const [filterBusy, setFilterBusy] = useState(false);
  const [filterError, setFilterError] = useState("");

  // Switching the filter type has no baked history to read a param value back from
  // (panel.imageFilterParams only ever holds params for whichever type is currently/was
  // last baked) — unless you're switching back to that exact type, in which case restore
  // what was actually baked rather than resetting to the generic default.
  const onChangeFilterType = (type) => {
    setFilterType(type);
    const meta = filterParamMeta(type);
    setFilterParamValue(type === panel.imageFilter ? panel.imageFilterParams?.[meta.key] ?? meta.default : meta.default);
  };

  // PanelEditor remounts per-panel (see key={selectedPanel.id} at the call site) so a
  // stale candidate never shows for the wrong panel — this just avoids leaking the
  // object URL itself when that remount/unmount happens.
  useEffect(() => {
    return () => {
      if (editCandidate) URL.revokeObjectURL(editCandidate.url);
    };
  }, [editCandidate]);

  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      await api.generatePanel(projectId, page.id, panel.id, { sceneDoc });
      await onUpdated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (file) => {
    setImageBusy(true);
    setImageError("");
    try {
      const formData = new FormData();
      formData.append("image", file);
      await api.uploadPanelImage(projectId, page.id, panel.id, formData);
      await onUpdated();
    } catch (err) {
      setImageError(err.message);
    } finally {
      setImageBusy(false);
    }
  };

  // Reuses uploadImage (a manual upload = a "redraw" too, same as a file picked from
  // disk) — just fetches the source panel's already-generated image as a blob first
  // instead of reading from a file input.
  const copyFromPanel = async (sourcePanel) => {
    setShowCopyFromPanel(false);
    setImageBusy(true);
    setImageError("");
    try {
      const blob = await fetch(sourcePanel.imageUrl).then((r) => r.blob());
      await uploadImage(blob);
    } catch (err) {
      setImageError(err.message);
      setImageBusy(false);
    }
  };

  const openImageLocation = async () => {
    setImageError("");
    try {
      await api.openPanelImage(projectId, page.id, panel.id);
    } catch (err) {
      setImageError(err.message);
    }
  };

  const onImageDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) uploadImage(file);
  };

  // Rotate/resize used to be overlay buttons on the panel canvas itself, but those live
  // inside an element that gets clip-path'd for tilted/diagonal layouts — a corner-
  // positioned button ends up outside the actual visible (slanted) shape on exactly those
  // panels, so it was invisible and unclickable there. This sidebar is never clipped and
  // always in the same spot regardless of panel shape, so it lives here instead.
  const rotateImage = async () => {
    const next = ((panel.imageRotate || 0) + 90) % 360;
    await api.updatePanel(projectId, page.id, panel.id, { imageRotate: next });
    await onUpdated();
  };

  const commitZoom = async (value) => {
    await api.updatePanel(projectId, page.id, panel.id, { imageScale: value });
    setZoomDraft(null);
    await onUpdated();
  };

  // 100 = untouched. Generation sometimes comes out overexposed, so this exists purely
  // to dim/darken the result after the fact rather than needing to regenerate.
  const commitBrightness = async (value) => {
    await api.updatePanel(projectId, page.id, panel.id, { imageBrightness: value });
    setBrightnessDraft(null);
    await onUpdated();
  };

  // Typed rotation isn't limited to 90° steps like the button above — normalized into
  // [0, 360) so e.g. -10 and 710 both land on the same, sensible 350°.
  const commitRotate = async (value) => {
    const normalized = ((value % 360) + 360) % 360;
    await api.updatePanel(projectId, page.id, panel.id, { imageRotate: normalized });
    setRotateDraft(null);
    await onUpdated();
  };

  // Sends the panel's CURRENT (already-committed) image to Codex as a reference, along
  // with the requested change, and gets back a candidate — not committed anywhere yet.
  // Shown next to the original so the user picks before anything on disk changes.
  const requestEdit = async () => {
    setEditBusy(true);
    setEditError("");
    try {
      const blob = await api.requestPanelEdit(projectId, page.id, panel.id, editDoc, editMarker);
      if (editCandidate) URL.revokeObjectURL(editCandidate.url);
      setEditCandidate({ blob, url: URL.createObjectURL(blob) });
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditBusy(false);
    }
  };

  const discardEdit = () => {
    if (editCandidate) URL.revokeObjectURL(editCandidate.url);
    setEditCandidate(null);
    setEditDoc(EMPTY_DOC);
    setEditMarker(null);
  };

  // Commits the edited candidate the same way a manual file upload would — it's just
  // bytes from the user's point of view, whether they came from disk or from Codex.
  const useEditedVersion = async () => {
    if (!editCandidate) return;
    await uploadImage(editCandidate.blob);
    discardEdit();
  };

  // Bakes (or re-bakes, e.g. after changing type or the slider) a filter derivative from
  // the panel's current ORIGINAL image — the original itself is never touched, so this
  // commits immediately rather than going through an accept/discard step like requestEdit
  // above.
  const applyFilter = async () => {
    setFilterBusy(true);
    setFilterError("");
    try {
      const meta = filterParamMeta(filterType);
      await api.applyPanelFilter(projectId, page.id, panel.id, filterType, { [meta.key]: filterParamValue });
      await onUpdated();
    } catch (err) {
      setFilterError(err.message);
    } finally {
      setFilterBusy(false);
    }
  };

  // Just flips which already-on-disk file (original vs. derivative) imageUrl points at —
  // see withPanelImage on the backend — so toggling back and forth is instant either way.
  const toggleFilter = async (enabled) => {
    await api.updatePanel(projectId, page.id, panel.id, { imageFilterEnabled: enabled });
    await onUpdated();
  };

  // Percentages relative to the marker box's own rendered bounding rect, which is sized
  // via editMarkerAspect to exactly match the image's natural aspect ratio (see onLoad
  // below) — so these percentages line up 1:1 with the image-pixel math the backend does
  // in drawMarkerRect, regardless of how big the box is drawn on screen.
  const editMarkerPercentFromEvent = (e) => {
    const rect = editMarkerBoxRef.current.getBoundingClientRect();
    return {
      x: clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100),
    };
  };

  const onEditMarkerPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = editMarkerPercentFromEvent(e);
    editMarkerDragRef.current = { start };
    setEditMarker({ x: start.x, y: start.y, width: 0, height: 0 });
    window.addEventListener("pointermove", onEditMarkerPointerMove);
    window.addEventListener("pointerup", onEditMarkerPointerUp);
  };

  const onEditMarkerPointerMove = (e) => {
    const d = editMarkerDragRef.current;
    if (!d) return;
    const cur = editMarkerPercentFromEvent(e);
    d.last = {
      x: Math.min(d.start.x, cur.x),
      y: Math.min(d.start.y, cur.y),
      width: Math.abs(cur.x - d.start.x),
      height: Math.abs(cur.y - d.start.y),
    };
    setEditMarker(d.last);
  };

  const onEditMarkerPointerUp = () => {
    window.removeEventListener("pointermove", onEditMarkerPointerMove);
    window.removeEventListener("pointerup", onEditMarkerPointerUp);
    const d = editMarkerDragRef.current;
    editMarkerDragRef.current = null;
    // A stray click (no real drag) leaves a near-zero-size box — drop it rather than
    // sending a meaningless sliver of a marker.
    if (!d?.last || d.last.width < 1 || d.last.height < 1) setEditMarker(null);
  };

  const clearImage = async () => {
    setImageBusy(true);
    setImageError("");
    try {
      await api.clearPanelImage(projectId, page.id, panel.id);
      // The "Edit image" tab only exists while there's an image to point Codex at (see
      // its button above) — bounce back to Scene so clearing the image doesn't leave the
      // user stranded on a tab that just disappeared.
      if (tab === "edit") setTab("scene");
      await onUpdated();
    } catch (err) {
      setImageError(err.message);
    } finally {
      setImageBusy(false);
    }
  };

  const bubbles = panel.bubbles || [];
  const setBubbleShape = (bubbleId, shape) => {
    onCommitBubbles(panel.id, bubbles.map((b) => (b.id === bubbleId ? { ...b, shape } : b)));
  };
  const setBubbleTail = (bubble, wantTail) => {
    const tail = wantTail ? bubble.tail || defaultTailFor(bubble) : null;
    onCommitBubbles(panel.id, bubbles.map((b) => (b.id === bubble.id ? { ...b, tail } : b)));
  };
  const setBubbleFont = (bubbleId, font) => {
    onCommitBubbles(panel.id, bubbles.map((b) => (b.id === bubbleId ? { ...b, font } : b)));
  };
  const setBubbleFontSize = (bubbleId, fontSize) => {
    onCommitBubbles(panel.id, bubbles.map((b) => (b.id === bubbleId ? { ...b, fontSize } : b)));
  };
  const setBubbleBold = (bubbleId, bold) => {
    onCommitBubbles(panel.id, bubbles.map((b) => (b.id === bubbleId ? { ...b, bold } : b)));
  };
  const setBubbleTextColor = (bubbleId, textColor) => {
    onCommitBubbles(panel.id, bubbles.map((b) => (b.id === bubbleId ? { ...b, textColor } : b)));
  };
  const setBubbleRotate = (bubbleId, rotate) => {
    onCommitBubbles(panel.id, bubbles.map((b) => (b.id === bubbleId ? { ...b, rotate } : b)));
  };
  const removeBubble = (bubbleId) => {
    onCommitBubbles(panel.id, bubbles.filter((b) => b.id !== bubbleId));
  };

  const expressions = panel.expressions || [];
  const setExpressionType = (markId, type) => {
    onCommitExpressions(panel.id, expressions.map((m) => (m.id === markId ? { ...m, type } : m)));
  };
  const setExpressionRotate = (markId, rotate) => {
    onCommitExpressions(panel.id, expressions.map((m) => (m.id === markId ? { ...m, rotate } : m)));
  };
  const setExpressionThickness = (markId, thickness) => {
    onCommitExpressions(panel.id, expressions.map((m) => (m.id === markId ? { ...m, thickness } : m)));
  };
  const setExpressionLineCount = (markId, lineCount) => {
    onCommitExpressions(panel.id, expressions.map((m) => (m.id === markId ? { ...m, lineCount } : m)));
  };
  const removeExpression = (markId) => {
    onCommitExpressions(panel.id, expressions.filter((m) => m.id !== markId));
  };

  return (
    <>
    <div className="panel-editor">
      <div className="panel-editor-header">
        <h3>{panel.floating ? "Floating panel" : `Panel ${panel.order + 1}`}</h3>
        <div className="panel-editor-header-actions">
          <button className="delete-panel" onClick={() => onDelete(panel.id)}>
            Delete panel
          </button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>

      <div className="tabs panel-editor-tabs">
        <button className={tab === "image" ? "active" : ""} onClick={() => setTab("image")}>
          Canvas
        </button>
        <button className={tab === "scene" ? "active" : ""} onClick={() => setTab("scene")}>
          Scene
        </button>
        <button className={tab === "bubbles" ? "active" : ""} onClick={() => setTab("bubbles")}>
          Speech
        </button>
        <button className={tab === "expressions" ? "active" : ""} onClick={() => setTab("expressions")}>
          Facials
        </button>
        {/* Only meaningful once there's an image to point Codex at — hidden rather than
            shown-but-empty for a brand new panel. */}
        {panel.hasImage && (
          <button className={tab === "edit" ? "active" : ""} onClick={() => setTab("edit")}>
            Edit image
          </button>
        )}
      </div>

      {/* Moving means swapping grid slots (see server's reindexPanelOrder) — floating
          panels have no fixed neighbors to swap with, they're just dragged wherever. On
          its own row (not crammed alongside the 4 tabs above) so both rows have room to
          show their full label instead of squeezing 6 buttons into one line. */}
      {!panel.floating && (
        <div className="tabs panel-editor-move-row">
          <button
            className="panel-move-btn"
            title="Move panel earlier"
            onClick={() => onMove(panel.id, "left")}
            disabled={panel.order === 0}
          >
            ← Move earlier
          </button>
          <button
            className="panel-move-btn"
            title="Move panel later"
            onClick={() => onMove(panel.id, "right")}
            disabled={panel.order === page.panels.length - 1}
          >
            Move later →
          </button>
        </div>
      )}

      {(tab === "scene" || tab === "edit") && (
        <p className="scene-editor-hint">
          <strong>#</strong> character/place/object, <strong>!</strong> reference image,{" "}
          <strong>@</strong> another panel — in the editor below.
        </p>
      )}

      {tab === "image" && (
        <section className="panel-editor-upper panel-editor-image">
          <h4>Panel image</h4>
          <p className="scene-editor-hint">
            Generated images don't always land well-composed in the frame. Upload your own
            picture here instead — it'll drop into the panel the same way, and you can still
            drag it to reposition and resize its crop right on the panel.
          </p>

          {panel.hasImage ? (
            <img
              className="panel-image-preview"
              src={panel.imageUrl}
              alt=""
              onDragOver={(e) => e.preventDefault()}
              onDrop={onImageDrop}
            />
          ) : (
            <div
              className="panel-image-preview panel-image-preview-empty"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onImageDrop}
            >
              Drop an image here, or choose one below
            </div>
          )}

          <div className="panel-image-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              disabled={imageBusy}
              onChange={(e) => e.target.files[0] && uploadImage(e.target.files[0])}
              hidden
            />
            <button
              className="panel-image-action-btn"
              onClick={() => fileInputRef.current.click()}
              disabled={imageBusy}
            >
              Choose file
            </button>
            {panel.hasImage && (
              <button className="panel-image-action-btn" onClick={openImageLocation}>
                Open image location
              </button>
            )}
            <div className="copy-from-panel-wrap">
              <button
                className="panel-image-action-btn"
                onClick={() => setShowCopyFromPanel((v) => !v)}
                disabled={imageBusy}
              >
                Copy from panel
              </button>
              {showCopyFromPanel && (
                <div className="copy-from-panel-popover">
                  {allPanels.filter((p) => p.id !== panel.id && p.hasImage).length === 0 ? (
                    <p className="empty-hint">No other panels have an image yet.</p>
                  ) : (
                    allPanels
                      .filter((p) => p.id !== panel.id && p.hasImage)
                      .map((p) => (
                        <button key={p.id} className="copy-from-panel-option" onClick={() => copyFromPanel(p)}>
                          <img src={p.imageUrl} alt="" />
                          <span>{p.pageTitle ? `${p.pageTitle} · Panel ${p.order + 1}` : `Panel ${p.order + 1}`}</span>
                        </button>
                      ))
                  )}
                </div>
              )}
            </div>
          </div>

          {panel.hasImage && (
            <div className="panel-image-transform">
              <button className="panel-image-action-btn" onClick={rotateImage}>
                ⟳ Rotate 90°
              </button>
              <label className="panel-zoom-control">
                Rotation
                <input
                  type="number"
                  className="panel-number-input"
                  step="1"
                  value={rotateDraft ?? Math.round(panel.imageRotate || 0)}
                  onChange={(e) => setRotateDraft(e.target.value)}
                  onBlur={(e) => commitRotate(parseFloat(e.target.value) || 0)}
                  onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
                />
                <span className="panel-zoom-value">°</span>
              </label>
              <label className="panel-zoom-control">
                Zoom
                <input
                  type="range"
                  min="0.2"
                  max="4"
                  step="0.01"
                  value={zoomDraft ?? (panel.imageScale || 1)}
                  onChange={(e) => {
                    setZoomDraft(e.target.value);
                    onLiveUpdate(panel.id, { imageScale: parseFloat(e.target.value) });
                  }}
                  onMouseUp={(e) => commitZoom(parseFloat(e.target.value))}
                  onTouchEnd={(e) => commitZoom(parseFloat(e.target.value))}
                />
                <input
                  type="number"
                  className="panel-number-input"
                  min="0.2"
                  max="4"
                  step="0.01"
                  value={zoomDraft ?? (panel.imageScale || 1)}
                  onChange={(e) => {
                    setZoomDraft(e.target.value);
                    const v = parseFloat(e.target.value);
                    if (!Number.isNaN(v)) onLiveUpdate(panel.id, { imageScale: v });
                  }}
                  onBlur={(e) => commitZoom(clamp(parseFloat(e.target.value) || 1, 0.2, 4))}
                  onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
                />
                <span className="panel-zoom-value">×</span>
              </label>
              <label className="panel-zoom-control">
                Brightness
                <input
                  type="range"
                  min="40"
                  max="160"
                  step="1"
                  value={brightnessDraft ?? (panel.imageBrightness ?? 100)}
                  onChange={(e) => {
                    setBrightnessDraft(e.target.value);
                    onLiveUpdate(panel.id, { imageBrightness: parseFloat(e.target.value) });
                  }}
                  onMouseUp={(e) => commitBrightness(parseFloat(e.target.value))}
                  onTouchEnd={(e) => commitBrightness(parseFloat(e.target.value))}
                />
                <input
                  type="number"
                  className="panel-number-input"
                  min="40"
                  max="160"
                  step="1"
                  value={brightnessDraft ?? (panel.imageBrightness ?? 100)}
                  onChange={(e) => {
                    setBrightnessDraft(e.target.value);
                    const v = parseFloat(e.target.value);
                    if (!Number.isNaN(v)) onLiveUpdate(panel.id, { imageBrightness: v });
                  }}
                  onBlur={(e) => commitBrightness(clamp(parseFloat(e.target.value) || 100, 40, 160))}
                  onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
                />
                <span className="panel-zoom-value">%</span>
              </label>
            </div>
          )}

          {panel.hasImage && (
            <div className="panel-screentone">
              <label className="panel-zoom-control">
                Filter
                <select
                  className="bubble-list-font"
                  value={filterType}
                  onChange={(e) => onChangeFilterType(e.target.value)}
                >
                  {FILTER_TYPES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="panel-zoom-control">
                {filterParamMeta(filterType).label}
                <input
                  type="range"
                  min={filterParamMeta(filterType).min}
                  max={filterParamMeta(filterType).max}
                  step={filterParamMeta(filterType).step}
                  value={filterParamValue}
                  onChange={(e) => setFilterParamValue(parseFloat(e.target.value))}
                />
                <input
                  type="number"
                  className="panel-number-input"
                  min={filterParamMeta(filterType).min}
                  max={filterParamMeta(filterType).max}
                  step={filterParamMeta(filterType).step}
                  value={filterParamValue}
                  onChange={(e) => {
                    const meta = filterParamMeta(filterType);
                    setFilterParamValue(clamp(parseFloat(e.target.value) || meta.default, meta.min, meta.max));
                  }}
                  onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
                />
                <span className="panel-zoom-value">{filterParamMeta(filterType).unit}</span>
              </label>
              <button className="panel-image-action-btn" onClick={applyFilter} disabled={filterBusy}>
                {filterBusy ? "Applying filter…" : panel.hasFilter ? "Re-apply filter" : "Apply filter"}
              </button>
              {panel.hasFilter && (
                <label className="bubble-list-bold panel-screentone-toggle">
                  <input
                    type="checkbox"
                    checked={!!panel.imageFilterEnabled}
                    onChange={(e) => toggleFilter(e.target.checked)}
                  />
                  Show filter
                </label>
              )}
              {filterError && <p className="error">{filterError}</p>}
            </div>
          )}

          {imageError && <p className="error">{imageError}</p>}

          {panel.hasImage && (
            <button className="delete-panel image-clear-button" onClick={clearImage} disabled={imageBusy}>
              Remove image
            </button>
          )}
        </section>
      )}

      {tab === "scene" && (
        <section className="panel-editor-upper">
          <h4>Scene description</h4>
          <SceneEditor
            content={sceneDoc}
            onChange={setSceneDoc}
            characters={characters}
            places={places}
            objects={objects}
            references={references}
            panels={allPanels.filter((p) => p.id !== panel.id)}
          />
          {characters.length === 0 && places.length === 0 && objects.length === 0 && references.length === 0 && (
            <p className="empty-hint">Add characters, places, objects, or references in the sidebar first.</p>
          )}

          {error && <p className="error">{error}</p>}

          {panel.hasImage ? (
            <button className="primary" onClick={generate} disabled={busy}>
              {busy ? "Generating…" : "Regenerate panel"}
            </button>
          ) : (
            <button className="primary" onClick={generate} disabled={busy}>
              {busy ? "Generating…" : "Generate panel"}
            </button>
          )}
        </section>
      )}

      {tab === "edit" && panel.hasImage && (
        <section className="panel-editor-lower">
          <h4>Edit generated image</h4>
          <p className="scene-editor-hint">
            Optionally drag a box on the image below to point at the exact spot that needs
            the change — it's just a pointer for Codex, the box itself never shows up in
            the edited result.
          </p>
          <div
            ref={editMarkerBoxRef}
            className="edit-marker-box"
            style={editMarkerAspect ? { aspectRatio: editMarkerAspect } : undefined}
            onPointerDown={onEditMarkerPointerDown}
          >
            <img
              src={panel.imageUrl}
              alt=""
              draggable={false}
              onLoad={(e) => setEditMarkerAspect(e.target.naturalWidth / e.target.naturalHeight)}
            />
            {editMarker && (
              <div
                className="edit-marker-rect"
                style={{
                  left: `${editMarker.x}%`,
                  top: `${editMarker.y}%`,
                  width: `${editMarker.width}%`,
                  height: `${editMarker.height}%`,
                }}
              />
            )}
            {editMarker && (
              <button
                type="button"
                className="edit-marker-clear"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setEditMarker(null)}
                title="Clear marker"
              >
                ×
              </button>
            )}
          </div>
          <SceneEditor
            content={editDoc}
            onChange={setEditDoc}
            characters={characters}
            places={places}
            objects={objects}
            references={references}
            panels={allPanels.filter((p) => p.id !== panel.id)}
          />
          <button
            className="primary"
            onClick={requestEdit}
            disabled={editBusy || !docHasContent(editDoc)}
          >
            {editBusy ? "Requesting edit…" : "Request edit"}
          </button>

          {editError && <p className="error">{editError}</p>}
        </section>
      )}

      {tab === "bubbles" && (
        <section className="panel-editor-lower">
          <p className="scene-editor-hint">
            On the panel itself: drag a bubble to move it, its corner to resize, and the small
            dot to aim its tail. Double-click to edit its text. Pick each bubble's shape from
            the dropdown below, and switch its tail on or off with the toggle next to it.
          </p>
          <button className="primary" onClick={() => onAddBubble(panel.id)}>
            + Add speech bubble
          </button>

          {bubbles.length > 0 && <h4 className="bubble-list-heading">Your bubbles</h4>}
          <div className="bubble-list">
            {bubbles.map((b, i) => (
              <div className="bubble-list-row" key={b.id}>
                <div className="bubble-list-row-header">
                  <span className="bubble-list-label">
                    {b.text?.trim() ? b.text.trim().slice(0, 90) : `Bubble ${i + 1}`}
                  </span>
                  <button className="delete" onClick={() => removeBubble(b.id)}>
                    ×
                  </button>
                </div>
                <ShapePicker
                  bubble={b}
                  onSetShape={(shape) => setBubbleShape(b.id, shape)}
                  onSetTail={(wantTail) => setBubbleTail(b, wantTail)}
                />
                <select
                  className="bubble-list-font"
                  style={{ fontFamily: fontFamilyFor(b.font, customFonts) }}
                  value={b.font || FONTS[0].value}
                  onChange={(e) => setBubbleFont(b.id, e.target.value)}
                >
                  {FONTS.map((f) => (
                    <option key={f.value} value={f.value} style={{ fontFamily: f.family }}>
                      {f.label}
                    </option>
                  ))}
                  {customFonts.length > 0 && (
                    <optgroup label="Your fonts">
                      {customFonts.map((f) => (
                        <option
                          key={f.id}
                          value={customFontValue(f.id)}
                          style={{ fontFamily: customFontFamilyName(f.id) }}
                        >
                          {f.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <label className="bubble-list-font-upload" title="Upload a font file (.ttf, .otf, .woff, .woff2)">
                  + Font
                  <input
                    type="file"
                    accept=".ttf,.otf,.woff,.woff2"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      const value = await onUploadFont(file);
                      setBubbleFont(b.id, value);
                    }}
                  />
                </label>
                <label className="bubble-list-font-size">
                  Font size
                  <input
                    type="number"
                    min="6"
                    max="60"
                    value={b.fontSize || DEFAULT_FONT_SIZE}
                    onChange={(e) => setBubbleFontSize(b.id, clamp(parseInt(e.target.value, 10) || DEFAULT_FONT_SIZE, 6, 60))}
                  />
                </label>
                <label className="bubble-list-font-size">
                  Rotation
                  <input
                    type="number"
                    min="-180"
                    max="180"
                    value={normalizeSignedDegrees(b.rotate || 0)}
                    onChange={(e) => setBubbleRotate(b.id, clamp(parseInt(e.target.value, 10) || 0, -180, 180))}
                  />
                </label>
                <label className="bubble-list-color">
                  Text color
                  <input
                    type="color"
                    value={b.textColor || "#111111"}
                    onChange={(e) => setBubbleTextColor(b.id, e.target.value)}
                  />
                </label>
                <label className="bubble-list-bold">
                  <input type="checkbox" checked={!!b.bold} onChange={(e) => setBubbleBold(b.id, e.target.checked)} />
                  Bold
                </label>
              </div>
            ))}
            {bubbles.length === 0 && <p className="empty-hint">No speech bubbles yet.</p>}
          </div>
        </section>
      )}

      {tab === "expressions" && (
        <section className="panel-editor-lower">
          <p className="scene-editor-hint">
            On the panel itself: drag a mark onto a face to move it, its corner to
            resize, and the ↻ handle to rotate it. Pick each mark's type and line
            thickness below.
          </p>
          <button className="primary" onClick={() => onAddExpression(panel.id)}>
            + Add expression mark
          </button>

          {expressions.length > 0 && <h4 className="bubble-list-heading">Your expression marks</h4>}
          <div className="bubble-list">
            {expressions.map((m, i) => (
              <div className="bubble-list-row" key={m.id}>
                <div className="bubble-list-row-header">
                  <span className="bubble-list-label">
                    {EXPRESSION_TYPES.find((t) => t.value === m.type)?.label ?? `Mark ${i + 1}`}
                  </span>
                  <button className="delete" onClick={() => removeExpression(m.id)}>
                    ×
                  </button>
                </div>
                <ExpressionPicker mark={m} onSetType={(type) => setExpressionType(m.id, type)} />
                <label className="bubble-list-font-size">
                  Rotation
                  <input
                    type="number"
                    min="-180"
                    max="180"
                    value={normalizeSignedDegrees(m.rotate || 0)}
                    onChange={(e) => setExpressionRotate(m.id, clamp(parseInt(e.target.value, 10) || 0, -180, 180))}
                  />
                </label>
                <label className="bubble-list-thickness">
                  Thickness
                  <div className="bubble-list-thickness-controls">
                    <input
                      type="range"
                      min={MIN_THICKNESS}
                      max={MAX_THICKNESS}
                      step="0.1"
                      value={m.thickness ?? DEFAULT_THICKNESS}
                      onChange={(e) => setExpressionThickness(m.id, parseFloat(e.target.value) || DEFAULT_THICKNESS)}
                    />
                    <input
                      type="number"
                      min={MIN_THICKNESS}
                      max={MAX_THICKNESS}
                      step="0.1"
                      value={m.thickness ?? DEFAULT_THICKNESS}
                      onChange={(e) =>
                        setExpressionThickness(m.id, clamp(parseFloat(e.target.value) || DEFAULT_THICKNESS, MIN_THICKNESS, MAX_THICKNESS))
                      }
                    />
                  </div>
                </label>
                {m.type === "speedlines" && (
                  <label className="bubble-list-thickness">
                    Line count
                    <div className="bubble-list-thickness-controls">
                      <input
                        type="range"
                        min={MIN_LINE_COUNT}
                        max={MAX_LINE_COUNT}
                        step="1"
                        value={m.lineCount ?? DEFAULT_LINE_COUNT}
                        onChange={(e) => setExpressionLineCount(m.id, parseInt(e.target.value, 10) || DEFAULT_LINE_COUNT)}
                      />
                      <input
                        type="number"
                        min={MIN_LINE_COUNT}
                        max={MAX_LINE_COUNT}
                        step="1"
                        value={m.lineCount ?? DEFAULT_LINE_COUNT}
                        onChange={(e) =>
                          setExpressionLineCount(
                            m.id,
                            clamp(parseInt(e.target.value, 10) || DEFAULT_LINE_COUNT, MIN_LINE_COUNT, MAX_LINE_COUNT)
                          )
                        }
                      />
                    </div>
                  </label>
                )}
              </div>
            ))}
            {expressions.length === 0 && <p className="empty-hint">No expression marks yet.</p>}
          </div>
        </section>
      )}
    </div>

    {editCandidate && (
      <EditCompareModal
        beforeUrl={panel.imageUrl}
        afterUrl={editCandidate.url}
        busy={imageBusy}
        onKeepOriginal={discardEdit}
        onKeepEdited={useEditedVersion}
      />
    )}
    </>
  );
}
