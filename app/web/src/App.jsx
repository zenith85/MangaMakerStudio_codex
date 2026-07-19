import { useEffect, useLayoutEffect, useState, useCallback, useRef } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
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
} from "./Bubble";
import ShapePicker from "./ShapePicker";

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

// True if a panel has a generated image or any non-empty scene text/mention — used to
// warn before a layout change would drop it (see changeLayout in App()).
function panelHasContent(panel) {
  if (panel.hasImage) return true;
  const hasNodeContent = (node) => {
    if (!node) return false;
    if (node.type === "mention") return true;
    if (node.type === "text") return !!node.text?.trim();
    return (node.content || []).some(hasNodeContent);
  };
  return hasNodeContent(panel.sceneDoc);
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

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(cw * 2));
    canvas.height = Math.max(1, Math.round(ch * 2));
    canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");

    const originalSrc = img.src;
    const originalObjectPosition = img.style.objectPosition;
    restores.push(() => {
      img.src = originalSrc;
      img.style.objectPosition = originalObjectPosition;
    });

    await new Promise((resolve) => {
      img.onload = resolve;
      img.src = dataUrl;
    });
    img.style.objectPosition = "50% 50%";
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

export default function App() {
  const [projects, setProjects] = useState(null); // null = not loaded yet
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [kind, setKind] = useState("characters");
  const [entities, setEntities] = useState({ characters: [], places: [], objects: [], references: [] });
  const [editingEntity, setEditingEntity] = useState(null); // { kind, entity } | { kind, entity: null } for "new"
  const [pages, setPages] = useState([]);
  const [currentPage, setCurrentPage] = useState(null);
  const [selectedPanelId, setSelectedPanelId] = useState(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfStatus, setPdfStatus] = useState("");
  const [pdfSavedPath, setPdfSavedPath] = useState(""); // relative to the project folder; lets the "Open" button find it
  const pageCanvasRef = useRef(null);

  const openSavedPdf = async () => {
    try {
      await api.openProjectFile(currentProjectId, pdfSavedPath);
    } catch (err) {
      setPdfStatus(`Failed: ${err.message}`);
    }
  };

  const refreshProjects = useCallback(() => api.listProjects().then(setProjects), []);

  const refreshEntities = useCallback((projectId) => {
    for (const k of ["characters", "places", "objects", "references"]) {
      api.listEntities(projectId, k).then((list) => setEntities((prev) => ({ ...prev, [k]: list })));
    }
  }, []);

  const refreshPages = useCallback((projectId) => api.listPages(projectId).then(setPages), []);

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
    setCurrentPage((page) => ({
      ...page,
      panels: page.panels.map((p) => (p.id === panelId ? { ...p, imageOffset } : p)),
    }));
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
    setCurrentPage((page) => ({
      ...page,
      panels: page.panels.map((p) => (p.id === panelId ? { ...p, ...patch } : p)),
    }));
  };

  // Live bubble edits (drag/resize/tail-aim in progress) — local only, no network call.
  const updateBubblesLive = (panelId, bubbles) => {
    setCurrentPage((page) => ({
      ...page,
      panels: page.panels.map((p) => (p.id === panelId ? { ...p, bubbles } : p)),
    }));
  };

  // Persist bubbles — called once at the end of a drag, or immediately for discrete
  // actions (add/delete/shape change/text edit).
  const commitBubbles = (panelId, bubbles) => {
    updateBubblesLive(panelId, bubbles);
    api.updatePanel(currentProjectId, currentPage.id, panelId, { bubbles });
  };

  const addBubble = (panelId) => {
    const panel = currentPage.panels.find((p) => p.id === panelId);
    commitBubbles(panelId, [...(panel.bubbles || []), newBubble()]);
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
    if (selectedPanelId && !updated.panels.some((p) => p.id === selectedPanelId)) setSelectedPanelId(null);
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

  const selectedPanel = currentPage?.panels.find((p) => p.id === selectedPanelId) || null;

  // Every panel across every page in the project, for the scene editor's #mention list
  // (continuity references aren't limited to the current page). `currentPage` stands in
  // for its own entry in `pages` so its panels are never stale mid-edit.
  const allPanelsForMention = pages
    .map((p) => (p.id === currentPage?.id ? currentPage : p))
    .flatMap((p) => p.panels.map((panel) => ({ ...panel, pageTitle: p.title })));

  // ---------- Landing: no project open yet ----------
  if (!currentProjectId) {
    return (
      <>
        <ProjectLanding projects={projects} onOpen={openProject} onCreate={createProject} onDelete={deleteProjectById} />
        <TerminalOverlay
          show={showTerminal}
          projectId={currentProjectId}
          onToggle={() => setShowTerminal((v) => !v)}
        />
      </>
    );
  }

  // Inside a project, the terminal must occupy only the center column — never
  // overlapping the sidebar or the panel editor, which are genuinely separate regions.
  const terminalToggle = (
    <TerminalOverlay
      show={showTerminal}
      projectId={currentProjectId}
      onToggle={() => setShowTerminal((v) => !v)}
      leftInset={280} // .sidebar width
      rightInset={selectedPanel ? 460 : 0} // .panel-editor width, only when it's open
    />
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="app-name">Ibraheem Manga Studio</span>
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
          onExportPdf={exportPagePdf}
          onExportAllPdf={exportAllPagesPdf}
          pdfBusy={pdfBusy}
          pdfStatus={pdfStatus}
          pdfSavedPath={pdfSavedPath}
          onOpenSavedPdf={openSavedPdf}
        />
        {currentPage ? (
          <PageCanvas
            containerRef={pageCanvasRef}
            page={currentPage}
            selectedPanelId={selectedPanelId}
            onSelect={setSelectedPanelId}
            onDragImage={dragPanelImage}
            onDragImageEnd={commitPanelImage}
            onBubblesLive={updateBubblesLive}
            onBubblesCommit={commitBubbles}
          />
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

// Floating toggle + docked panel for the embedded terminal (see Terminal.jsx). The
// underlying shell session lives server-side per project — closing this panel just
// detaches the viewer (Generate can still write into it); reopening reattaches to the
// same running session. `key={projectId}` forces a fresh viewer connection when you
// switch projects, so it attaches to that project's session instead of the old one.
function TerminalOverlay({ show, projectId, onToggle, leftInset = 0, rightInset = 0 }) {
  return (
    <>
      <button className="terminal-toggle" style={{ right: rightInset + 12 }} onClick={onToggle}>
        {show ? "▼ Terminal" : "▲ Terminal"}
      </button>
      {show && (
        <div className="terminal-panel" style={{ left: leftInset, right: rightInset }}>
          <Terminal key={projectId} projectId={projectId} />
        </div>
      )}
    </>
  );
}

function ProjectLanding({ projects, onOpen, onCreate, onDelete }) {
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
      <h1>Ibraheem Manga Studio</h1>
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
  onExportPdf,
  onExportAllPdf,
  pdfBusy,
  pdfStatus,
  pdfSavedPath,
  onOpenSavedPdf,
}) {
  const [showForm, setShowForm] = useState(false);
  const [showLayoutPicker, setShowLayoutPicker] = useState(false);
  const [title, setTitle] = useState("");
  const [layout, setLayout] = useState("grid-2x2");
  const [stylePreset, setStylePreset] = useState("manga_bw");
  const layoutPickerRef = useRef(null);

  useEffect(() => {
    if (!showLayoutPicker) return;
    const onDocPointerDown = (e) => {
      if (layoutPickerRef.current && !layoutPickerRef.current.contains(e.target)) setShowLayoutPicker(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [showLayoutPicker]);

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
      <button onClick={() => setShowForm((v) => !v)}>+ New page</button>
      {currentPage && (
        <div className="layout-picker-wrap" ref={layoutPickerRef}>
          <button onClick={() => setShowLayoutPicker((v) => !v)}>Change layout</button>
          {showLayoutPicker && (
            <div className="layout-picker-popover">
              <LayoutPicker value={currentPage.layout} onChange={pickLayout} />
            </div>
          )}
        </div>
      )}
      {currentPage && (
        <button className="delete-page" onClick={() => onDelete(currentPage.id)}>
          Delete page
        </button>
      )}
      {currentPage && (
        <button onClick={onExportPdf} disabled={pdfBusy}>
          {pdfBusy ? "Saving PDF…" : "Save as PDF"}
        </button>
      )}
      {pages.length > 1 && (
        <button onClick={onExportAllPdf} disabled={pdfBusy}>
          {pdfBusy ? "Saving PDF…" : "Export all pages as PDF"}
        </button>
      )}
      {pdfStatus && (
        <span className={`pdf-status${pdfStatus.startsWith("Failed") ? " pdf-status-error" : ""}`}>{pdfStatus}</span>
      )}
      {pdfSavedPath && (
        <button className="pdf-open-button" onClick={onOpenSavedPdf}>
          Open
        </button>
      )}

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
  onBubblesLive,
  onBubblesCommit,
}) {
  const template = LAYOUTS.find((l) => l.value === page.layout) || LAYOUTS.find((l) => l.value === "grid-2x2");
  const isFreeform = !!template.panels;

  return (
    <div
      ref={containerRef}
      className="page-canvas"
      style={
        isFreeform
          ? undefined
          : { gridTemplateAreas: template.areas, gridTemplateColumns: template.columns, gridTemplateRows: template.rows }
      }
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
            onBubblesLive={onBubblesLive}
            onBubblesCommit={onBubblesCommit}
          />
        );
      })}
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

  const onPointerDown = (e) => {
    if (!panel.hasImage || e.button !== 0) return;
    e.preventDefault();

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOffset: offset,
      overflowX: Math.max(0, renderedW - frameW),
      overflowY: Math.max(0, renderedH - frameH),
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

    const nx = d.overflowX > 0 ? clamp(d.startOffset.x - (dx / d.overflowX) * 100, 0, 100) : 50;
    const ny = d.overflowY > 0 ? clamp(d.startOffset.y - (dy / d.overflowY) * 100, 0, 100) : 50;
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
      className={`panel-slot ${selected ? "selected" : ""} ${panel.hasImage ? "has-image" : ""}`}
      style={clipPath ? { ...slotStyle, clipPath } : slotStyle}
      onPointerDown={onPointerDown}
    >
      {/* clip-path also goes on the OUTER panel-slot (not just the inner image layer
          below) for tilted/diagonal layouts — two panels there share an identical
          bounding box, and without clipping the outer element too, clicks in one
          panel's visible area can hit-test against its neighbor's unclipped box
          instead, since that's what actually captures the pointer event. */}
      <div className="panel-slot-image-layer" style={clipPath ? { clipPath } : undefined}>
        {panel.hasImage ? (
          <>
            <img
              ref={imgRef}
              src={panel.imageUrl}
              alt=""
              draggable={false}
              onLoad={onImgLoad}
              style={{
                position: "absolute",
                left: imgLeft,
                top: imgTop,
                width: renderedW,
                height: renderedH,
                transform: `rotate(${rotate}deg) scale(${rotateScale})`,
                transformOrigin: `${rotateOriginX}px ${rotateOriginY}px`,
              }}
            />
          </>
        ) : (
          <span className="placeholder" style={placeholderStyle} onClick={() => onSelect(panel.id)}>
            Click to set up panel {panel.order + 1}
          </span>
        )}
      </div>

      {bubbles.map((bubble) => (
        <Bubble
          key={bubble.id}
          bubble={bubble}
          containerRef={containerRef}
          editable={selected}
          onChange={(patch, opts) => updateBubble(bubble.id, patch, opts)}
          onDelete={() => deleteBubble(bubble.id)}
        />
      ))}
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
}) {
  const [sceneDoc, setSceneDoc] = useState(panel.sceneDoc);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("scene");
  const [imageBusy, setImageBusy] = useState(false);
  const fileInputRef = useRef(null);
  const [imageError, setImageError] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [editCandidate, setEditCandidate] = useState(null); // { blob, url } | null
  // Live value while dragging the zoom slider or typing in either number box — null
  // means "not editing, show the committed panel value instead" (see the inputs below).
  const [zoomDraft, setZoomDraft] = useState(null);
  const [rotateDraft, setRotateDraft] = useState(null);

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
      const blob = await api.requestPanelEdit(projectId, page.id, panel.id, editInstructions);
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
    setEditInstructions("");
  };

  // Commits the edited candidate the same way a manual file upload would — it's just
  // bytes from the user's point of view, whether they came from disk or from Codex.
  const useEditedVersion = async () => {
    if (!editCandidate) return;
    await uploadImage(editCandidate.blob);
    discardEdit();
  };

  const clearImage = async () => {
    setImageBusy(true);
    setImageError("");
    try {
      await api.clearPanelImage(projectId, page.id, panel.id);
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
  const removeBubble = (bubbleId) => {
    onCommitBubbles(panel.id, bubbles.filter((b) => b.id !== bubbleId));
  };

  return (
    <div className="panel-editor">
      <div className="panel-editor-header">
        <h3>Panel {panel.order + 1}</h3>
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
          Speech bubbles
        </button>
        <button
          className="panel-move-btn"
          title="Move panel earlier"
          onClick={() => onMove(panel.id, "left")}
          disabled={panel.order === 0}
        >
          ←
        </button>
        <button
          className="panel-move-btn"
          title="Move panel later"
          onClick={() => onMove(panel.id, "right")}
          disabled={panel.order === page.panels.length - 1}
        >
          →
        </button>
      </div>

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
          <p className="scene-editor-hint">
            Type <strong>#</strong> to pull in a character, place, or object — it'll appear here
            highlighted, and its reference image will be used when generating this panel. Type{" "}
            <strong>!</strong> to pull in any uploaded reference image the same way. Type{" "}
            <strong>@</strong> to mention any panel from any page (e.g. "@Page 1 · Panel 2") to keep
            its room, decor, and props consistent here.
          </p>
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

          <button className="primary" onClick={generate} disabled={busy}>
            {busy ? "Generating…" : panel.hasImage ? "Regenerate panel" : "Generate panel"}
          </button>
        </section>
      )}

      {tab === "scene" && panel.hasImage && (
        <section className="panel-editor-lower">
          <h4>Edit generated image</h4>
          <p className="scene-editor-hint">
            Describe a change to make to the panel's current image — Codex edits it as a
            reference, not from scratch. Compare the result against the original below and
            pick whichever one should actually be set on the panel; the other is discarded.
          </p>
          <textarea
            className="edit-instructions-input"
            placeholder='e.g. "make the sky sunset orange" or "remove the car in the background"'
            value={editInstructions}
            onChange={(e) => setEditInstructions(e.target.value)}
            disabled={editBusy}
          />
          <button className="primary" onClick={requestEdit} disabled={editBusy || !editInstructions.trim()}>
            {editBusy ? "Requesting edit…" : "Request edit"}
          </button>

          {editError && <p className="error">{editError}</p>}

          {editCandidate && (
            <div className="edit-compare">
              <div className="edit-compare-option">
                <span className="edit-compare-label">Before</span>
                <img src={panel.imageUrl} alt="Before edit" />
                <button onClick={discardEdit} disabled={imageBusy}>
                  Keep this one
                </button>
              </div>
              <div className="edit-compare-option">
                <span className="edit-compare-label">After</span>
                <img src={editCandidate.url} alt="After edit" />
                <button onClick={useEditedVersion} disabled={imageBusy}>
                  Keep this one
                </button>
              </div>
            </div>
          )}
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
                  style={{ fontFamily: FONTS.find((f) => f.value === b.font)?.family }}
                  value={b.font || FONTS[0].value}
                  onChange={(e) => setBubbleFont(b.id, e.target.value)}
                >
                  {FONTS.map((f) => (
                    <option key={f.value} value={f.value} style={{ fontFamily: f.family }}>
                      {f.label}
                    </option>
                  ))}
                </select>
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
              </div>
            ))}
            {bubbles.length === 0 && <p className="empty-hint">No speech bubbles yet.</p>}
          </div>
        </section>
      )}
    </div>
  );
}
