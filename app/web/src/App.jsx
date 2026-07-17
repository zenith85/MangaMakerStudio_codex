import { useEffect, useState, useCallback, useRef } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { api } from "./api";
import Terminal from "./Terminal";
import SceneEditor from "./SceneEditor";
import Bubble, { newBubble, FONTS, defaultTailFor } from "./Bubble";
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
];

// True if a panel has a generated image or any non-empty scene text/mention — used to
// warn before a layout change would drop it (see changeLayout in App()).
function panelHasContent(panel) {
  if (panel.imageAssetId) return true;
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

export default function App() {
  const [projects, setProjects] = useState(null); // null = not loaded yet
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [kind, setKind] = useState("characters");
  const [entities, setEntities] = useState({ characters: [], places: [], objects: [] });
  const [editingEntity, setEditingEntity] = useState(null); // { kind, entity } | { kind, entity: null } for "new"
  const [pages, setPages] = useState([]);
  const [currentPage, setCurrentPage] = useState(null);
  const [selectedPanelId, setSelectedPanelId] = useState(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfStatus, setPdfStatus] = useState("");
  const pageCanvasRef = useRef(null);

  const refreshProjects = useCallback(() => api.listProjects().then(setProjects), []);

  const refreshEntities = useCallback((projectId) => {
    for (const k of ["characters", "places", "objects"]) {
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
    let restoreImages = () => {};
    try {
      restoreImages = await precropPanelImages(pageCanvasRef.current);
      const canvas = await html2canvas(pageCanvasRef.current, { backgroundColor: "#1c1d24", scale: 2 });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ unit: "px", format: [canvas.width, canvas.height] });
      pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
      const blob = pdf.output("blob");

      const formData = new FormData();
      formData.append("pdf", blob, "page.pdf");
      const result = await api.savePagePdf(currentProjectId, currentPage.id, formData);
      setPdfStatus(`Saved as pages/${result.filename}`);
    } catch (err) {
      setPdfStatus(`Failed: ${err.message}`);
    } finally {
      restoreImages();
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
          pdfBusy={pdfBusy}
          pdfStatus={pdfStatus}
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
          allPanels={allPanelsForMention}
          onClose={() => setSelectedPanelId(null)}
          onUpdated={refreshCurrentPage}
          onDelete={deletePanel}
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

  const allFields = { ...fields, description };

  const saveDetails = async () => {
    setBusy(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("name", name.trim());
      formData.append("style", style);
      formData.append("fields", JSON.stringify(allFields));
      if (entity) {
        const updated = await api.updateEntity(projectId, kind, entity.id, formData);
        setEntity(updated);
      } else {
        const created = await api.createEntity(projectId, kind, formData);
        setEntity(created);
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

  const uploadImage = async (file) => {
    if (!entity) {
      setError("Save the details first, then upload a picture.");
      return;
    }
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

        <section className="entity-image-section">
          <h4>Picture</h4>
          <div className="tabs entity-image-tabs">
            <button className={imageTab === "create" ? "active" : ""} onClick={() => setImageTab("create")}>
              Create
            </button>
            <button className={imageTab === "generate" ? "active" : ""} onClick={() => setImageTab("generate")}>
              Generate
            </button>
          </div>

          {entity?.imageUrl ? (
            <img className="entity-preview" src={entity.imageUrl} alt={entity.name} />
          ) : (
            <div className="entity-preview entity-preview-empty">No image yet</div>
          )}

          {imageTab === "create" ? (
            <>
              <p className="scene-editor-hint">Browse for a picture on your computer and use it directly.</p>
              <input
                type="file"
                accept="image/*"
                disabled={busy}
                onChange={(e) => e.target.files[0] && uploadImage(e.target.files[0])}
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

          {!entity && <p className="empty-hint">Save the details below first, then come back here.</p>}
        </section>

        <section className="entity-info-section">
          <h4>Name</h4>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />

          <h4>Description</h4>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />

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
      </div>
    </div>
  );
}

function PageBar({ pages, currentPage, onOpen, onCreate, onChangeLayout, onDelete, onExportPdf, pdfBusy, pdfStatus }) {
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
      {pdfStatus && (
        <span className={`pdf-status${pdfStatus.startsWith("Failed") ? " pdf-status-error" : ""}`}>{pdfStatus}</span>
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

// A panel's generated image is rendered with object-fit: cover, so a wider-than-tall
// (or taller-than-wide) image gets cropped to fill the frame. Holding and dragging the
// image pans that crop by adjusting object-position — this tracks the drag in pixels,
// converts it to a percentage of how far the rendered image overflows the frame in each
// axis, and only treats it as a "select this panel" click if the pointer never moved.
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

  const offset = panel.imageOffset || { x: 50, y: 50 };
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
    if (!panel.imageAssetId || e.button !== 0) return;
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || !img.naturalWidth) return;
    e.preventDefault();

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const naturalRatio = img.naturalWidth / img.naturalHeight;
    const containerRatio = cw / ch;
    const renderedW = naturalRatio > containerRatio ? ch * naturalRatio : cw;
    const renderedH = naturalRatio > containerRatio ? ch : cw / naturalRatio;

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOffset: offset,
      overflowX: Math.max(0, renderedW - cw),
      overflowY: Math.max(0, renderedH - ch),
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
      className={`panel-slot ${selected ? "selected" : ""} ${panel.imageAssetId ? "has-image" : ""}`}
      style={clipPath ? { ...slotStyle, clipPath } : slotStyle}
      onPointerDown={onPointerDown}
    >
      {/* clip-path also goes on the OUTER panel-slot (not just the inner image layer
          below) for tilted/diagonal layouts — two panels there share an identical
          bounding box, and without clipping the outer element too, clicks in one
          panel's visible area can hit-test against its neighbor's unclipped box
          instead, since that's what actually captures the pointer event. */}
      <div className="panel-slot-image-layer" style={clipPath ? { clipPath } : undefined}>
        {panel.imageAssetId ? (
          <img
            ref={imgRef}
            src={`/uploads/${panel.imageAssetId}.png`}
            alt=""
            draggable={false}
            style={{ objectPosition: `${offset.x}% ${offset.y}%` }}
          />
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
  allPanels,
  onClose,
  onUpdated,
  onDelete,
  onAddBubble,
  onCommitBubbles,
}) {
  const [sceneDoc, setSceneDoc] = useState(panel.sceneDoc);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("scene");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");

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
          Image
        </button>
        <button className={tab === "scene" ? "active" : ""} onClick={() => setTab("scene")}>
          Scene
        </button>
        <button className={tab === "bubbles" ? "active" : ""} onClick={() => setTab("bubbles")}>
          Speech bubbles
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

          {panel.imageAssetId ? (
            <img className="panel-image-preview" src={`/uploads/${panel.imageAssetId}.png`} alt="" />
          ) : (
            <div className="panel-image-preview panel-image-preview-empty">No image yet</div>
          )}

          <input
            type="file"
            accept="image/*"
            disabled={imageBusy}
            onChange={(e) => e.target.files[0] && uploadImage(e.target.files[0])}
          />

          {imageError && <p className="error">{imageError}</p>}

          {panel.imageAssetId && (
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
            <strong>@</strong> to mention any panel from any page (e.g. "@Page 1 · Panel 2") to keep
            its room, decor, and props consistent here.
          </p>
          <SceneEditor
            content={sceneDoc}
            onChange={setSceneDoc}
            characters={characters}
            places={places}
            objects={objects}
            panels={allPanels.filter((p) => p.id !== panel.id)}
          />
          {characters.length === 0 && places.length === 0 && objects.length === 0 && (
            <p className="empty-hint">Add characters, places, or objects in the sidebar first.</p>
          )}

          {error && <p className="error">{error}</p>}

          <button className="primary" onClick={generate} disabled={busy}>
            {busy ? "Generating…" : panel.imageAssetId ? "Regenerate panel" : "Generate panel"}
          </button>
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
              </div>
            ))}
            {bubbles.length === 0 && <p className="empty-hint">No speech bubbles yet.</p>}
          </div>
        </section>
      )}
    </div>
  );
}
