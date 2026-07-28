import express from "express";
import cors from "cors";
import multer from "multer";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { attachTerminal } from "./terminal.js";
import {
  listProjects,
  getProject,
  createProject,
  deleteProject,
  listEntities,
  getEntity,
  createEntity,
  updateEntity,
  deleteEntity,
  saveEntityImage,
  loadEntityImage,
  entityImageUrl,
  entityImagePath,
  listPages,
  savePages,
  savePanelImage,
  loadPanelImage,
  deletePanelImage,
  panelImageInfo,
  panelImagePath,
  listFonts,
  createFont,
  deleteFont,
} from "./store.js";
import { generateImageViaCodex, CodexError } from "./codex.js";
import { buildPrompt, buildEntityPrompt, buildEditPrompt } from "./prompt.js";
import { parseSceneDoc, EMPTY_SCENE_DOC } from "./scene.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.join(__dirname, "projects");

const upload = multer({ storage: multer.memoryStorage() });

// Every image file on disk is always named/served as "image.png" (see store.js) — but a
// manually-uploaded file could be a JPG, WEBP, etc., saved as-is under that name. Browsers
// render it fine regardless (they sniff actual content, not the extension), but the file
// on disk is then mislabeled, which can confuse anything else that opens it expecting a
// real PNG. Decoding+re-encoding through sharp on upload means the bytes always actually
// match the name — accepts any format sharp can read (a strict superset of PNG/JPEG).
// Codex-generated images skip this: codex.js already asks for a PNG output file directly.
async function normalizeUploadedImage(buffer) {
  try {
    return await sharp(buffer).png().toBuffer();
  } catch {
    throw new Error("Uploaded file isn't a valid image");
  }
}

function isValidMarkerRect(rect) {
  return (
    rect &&
    typeof rect === "object" &&
    ["x", "y", "width", "height"].every((k) => Number.isFinite(rect[k])) &&
    rect.width > 0.5 &&
    rect.height > 0.5
  );
}

// Bakes a red rectangle onto a COPY of the panel image, in image-pixel coordinates
// derived from rect's 0-100 percentages (as drawn by the user over the displayed image on
// the frontend, which shows the same unrotated/unscaled source file). This copy is sent
// to Codex as an extra reference image purely to point at the edit region — see
// buildEditPrompt's hasMarker note, which tells Codex not to reproduce the rectangle.
async function drawMarkerRect(imageBuffer, rect) {
  const { width: imgW, height: imgH } = await sharp(imageBuffer).metadata();
  const strokeWidth = Math.max(4, Math.round(Math.min(imgW, imgH) * 0.008));
  const x = (rect.x / 100) * imgW;
  const y = (rect.y / 100) * imgH;
  const w = (rect.width / 100) * imgW;
  const h = (rect.height / 100) * imgH;
  const svg =
    `<svg width="${imgW}" height="${imgH}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="red" stroke-width="${strokeWidth}" /></svg>`;
  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}
const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use("/projects", express.static(PROJECTS_DIR)); // serves .../<projectId>/<kind>/<entityId>/image.png directly

// Lets the frontend tell whether a local agent is running on this visitor's own machine
// at all (see the health-check in App.jsx) — distinct from any real route, so it stays
// meaningful even as the rest of the API changes.
app.get("/api/health", (req, res) => res.json({ ok: true }));

// References are plain uploaded images (no Codex generation, no descriptive fields) —
// they share the same generic CRUD as characters/places/objects, but ENTITY_KINDS is the
// wider list used only for list/create/update/delete; GENERATABLE_KINDS below stays
// narrower so a /generate route only exists for kinds that actually have one.
const ENTITY_KINDS = ["characters", "places", "objects", "references"];
const GENERATABLE_KINDS = ["characters", "places", "objects"];

function withEntityUrl(projectId, kind, entity) {
  return { ...entity, imageUrl: entity.hasImage ? entityImageUrl(projectId, kind, entity.id) : null };
}

// Attaches hasImage/imageUrl to a panel fresh on every response, computed from whether
// its image file actually exists — never persisted into pages.json, since pages.json's
// panel objects are also read-modify-written by several endpoints below (e.g. the
// generic PATCH) and a stale cached URL baked into that JSON would defeat the whole
// point of using file mtime as the cache-buster.
function withPanelImage(projectId, pageId, panel) {
  return { ...panel, ...panelImageInfo(projectId, pageId, panel.id) };
}
function withPageImages(projectId, page) {
  return {
    ...page,
    panels: page.panels.map((p) => withPanelImage(projectId, page.id, p)),
    // Defaults to [] here (not just wherever it's read) so every page in every response
    // always has this field, even ones saved before floating panels existed.
    floatingPanels: (page.floatingPanels || []).map((p) => withPanelImage(projectId, page.id, p)),
  };
}

// ---------- Projects ----------

app.get("/api/projects", (_req, res) => {
  res.json(listProjects());
});

app.post("/api/projects", (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name is required" });
  res.json(createProject(name));
});

app.delete("/api/projects/:id", (req, res) => {
  deleteProject(req.params.id);
  res.json({ ok: true });
});

// Opens the project's folder in the host machine's native file manager — this is a
// local-only tool, so shelling out to the desktop is in scope, but the command is run
// via execFile (never a shell string) and the resolved path is checked to stay inside
// PROJECTS_DIR, so a crafted :id can't inject shell syntax or reach an arbitrary path.
app.post("/api/projects/:id/open-folder", (req, res) => {
  const dir = path.resolve(path.join(PROJECTS_DIR, req.params.id));
  if (!dir.startsWith(path.resolve(PROJECTS_DIR) + path.sep)) {
    return res.status(400).json({ error: "invalid project id" });
  }
  if (!fs.existsSync(dir)) return res.status(404).json({ error: "project not found" });

  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  execFile(opener, [dir], (err) => {
    if (err) console.error(`open-folder: failed to launch ${opener}:`, err.message);
  });
  res.json({ ok: true, path: dir });
});

// ---------- Characters / Places / Objects ----------

for (const kind of ENTITY_KINDS) {
  app.get(`/api/projects/:projectId/${kind}`, (req, res) => {
    res.json(listEntities(req.params.projectId, kind).map((e) => withEntityUrl(req.params.projectId, kind, e)));
  });

  app.post(`/api/projects/:projectId/${kind}`, upload.single("image"), async (req, res) => {
    const { name, style } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    let fields = {};
    if (req.body.fields) {
      try {
        fields = typeof req.body.fields === "string" ? JSON.parse(req.body.fields) : req.body.fields;
      } catch {
        return res.status(400).json({ error: "fields must be valid JSON" });
      }
    }
    if (req.file) {
      try {
        req.file.buffer = await normalizeUploadedImage(req.file.buffer);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }
    const entity = createEntity(req.params.projectId, kind, { name, fields, style });
    if (req.file) saveEntityImage(req.params.projectId, kind, entity.id, req.file.buffer);
    res.json(withEntityUrl(req.params.projectId, kind, getEntity(req.params.projectId, kind, entity.id)));
  });

  app.patch(`/api/projects/:projectId/${kind}/:id`, upload.single("image"), async (req, res) => {
    const { projectId, id } = req.params;
    let fields;
    if (req.body.fields) {
      try {
        fields = typeof req.body.fields === "string" ? JSON.parse(req.body.fields) : req.body.fields;
      } catch {
        return res.status(400).json({ error: "fields must be valid JSON" });
      }
    }
    if (req.file) {
      try {
        req.file.buffer = await normalizeUploadedImage(req.file.buffer);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }
    const entity = updateEntity(projectId, kind, id, { name: req.body.name, fields, style: req.body.style });
    if (!entity) return res.status(404).json({ error: `${kind} not found` });
    if (req.file) saveEntityImage(projectId, kind, id, req.file.buffer); // manual upload = a "redraw" too
    res.json(withEntityUrl(projectId, kind, getEntity(projectId, kind, id)));
  });

  app.delete(`/api/projects/:projectId/${kind}/:id`, (req, res) => {
    deleteEntity(req.params.projectId, kind, req.params.id);
    res.json({ ok: true });
  });
}

// ---------- Custom fonts (uploaded by the user, alongside the fixed preset list) ----------
// Project-scoped, not panel/bubble-scoped — upload once, every bubble in this project can
// use it. Served via the same static /projects mount everything else under a project's
// folder already uses (see app.use("/projects", ...) above), so no dedicated file route
// is needed here beyond create/list/delete.

const FONT_EXTENSIONS = new Set(["ttf", "otf", "woff", "woff2"]);

app.get("/api/projects/:projectId/fonts", (req, res) => {
  res.json(listFonts(req.params.projectId));
});

app.post("/api/projects/:projectId/fonts", upload.single("font"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "font file is required" });
  const ext = path.extname(req.file.originalname).slice(1).toLowerCase();
  if (!FONT_EXTENSIONS.has(ext)) {
    return res.status(400).json({ error: "font must be a .ttf, .otf, .woff, or .woff2 file" });
  }
  const name = req.body.name?.trim() || path.basename(req.file.originalname, path.extname(req.file.originalname));
  res.json(createFont(req.params.projectId, { name, ext, buffer: req.file.buffer }));
});

app.delete("/api/projects/:projectId/fonts/:fontId", (req, res) => {
  deleteFont(req.params.projectId, req.params.fontId);
  res.json({ ok: true });
});

for (const kind of GENERATABLE_KINDS) {
  // Generate (or redraw) this entity's single reference image via Codex.
  app.post(`/api/projects/:projectId/${kind}/:id/generate`, async (req, res) => {
    try {
      const { projectId, id } = req.params;
      const entity = getEntity(projectId, kind, id);
      if (!entity) return res.status(404).json({ error: `${kind} not found` });

      const prompt = buildEntityPrompt({ kind, name: entity.name, fields: entity.fields, style: entity.style });
      await generateImageViaCodex(projectId, entityImagePath(projectId, kind, id), prompt);

      res.json({ ...withEntityUrl(projectId, kind, getEntity(projectId, kind, id)), prompt });
    } catch (err) {
      console.error(err);
      if (err instanceof CodexError) return res.status(502).json({ error: err.message, code: "CODEX_ERROR" });
      res.status(500).json({ error: err.message });
    }
  });
}

// ---------- Pages (project-scoped) ----------

app.get("/api/projects/:projectId/pages", (req, res) => {
  res.json(listPages(req.params.projectId).map((pg) => withPageImages(req.params.projectId, pg)));
});

app.post("/api/projects/:projectId/pages", (req, res) => {
  // panelCount comes from the frontend's layout template (see LAYOUTS in App.jsx) —
  // the backend doesn't need its own copy of every layout's panel count, just the count.
  const { title, layout = "grid-2x2", stylePreset = "manga_bw", panelCount = 4 } = req.body;

  const page = {
    id: nanoid(10),
    title: title?.trim() || "Untitled page",
    layout,
    stylePreset,
    panels: Array.from({ length: panelCount }, (_, i) => ({
      id: nanoid(8),
      order: i,
      // Rich-text scene description (Tiptap doc) with inline #mentions of
      // characters/places/objects — this is the sole source of a panel's cast and
      // setting; see scene.js for how mentions are extracted at generation time.
      sceneDoc: EMPTY_SCENE_DOC,
      // No imageAssetId field — whether a panel has an image, and its URL, is derived
      // fresh on every response from whether pages/<id>/panels/<id>/image.png exists
      // (see withPanelImage).
    })),
    createdAt: Date.now(),
  };

  const pages = listPages(req.params.projectId);
  pages.push(page);
  savePages(req.params.projectId, pages);
  res.json(withPageImages(req.params.projectId, page));
});

app.get("/api/projects/:projectId/pages/:id", (req, res) => {
  const page = listPages(req.params.projectId).find((p) => p.id === req.params.id);
  if (!page) return res.status(404).json({ error: "page not found" });
  res.json(withPageImages(req.params.projectId, page));
});

// A floating panel is a regular panel in every way that matters (scene/generate/edit,
// bubbles, expressions, image transforms — see findPanel) except where it lives on the
// page: not a slot in the layout grid, but its own freely dragged/resized box, in
// percent of the page canvas — x/y/width/height here, not an array-index-driven
// gridArea/freeform slot like `panels`. Deliberately no `order` field — grid-only
// concept (see reindexPanelOrder), meaningless for something with no fixed neighbors.
app.post("/api/projects/:projectId/pages/:pageId/floating-panels", (req, res) => {
  const { projectId, pageId } = req.params;
  const pages = listPages(projectId);
  const page = pages.find((p) => p.id === pageId);
  if (!page) return res.status(404).json({ error: "page not found" });

  const panel = {
    id: nanoid(8),
    floating: true,
    sceneDoc: EMPTY_SCENE_DOC,
    x: 30,
    y: 30,
    width: 30,
    height: 30,
  };
  page.floatingPanels = page.floatingPanels || [];
  page.floatingPanels.push(panel);
  savePages(projectId, pages);
  res.json(withPageImages(projectId, page));
});

// A panel lives in one of two places on a page: `panels` (the grid layout — position
// comes from array index, see reindexPanelOrder below) or `floatingPanels` (freely
// dragged/resized above the page, position is its own x/y/width/height fields — see
// the /floating-panels route). Every panel sub-route (image, generate, edit, bubbles/
// expressions via the generic PATCH) goes through this one lookup, so a floating panel
// gets every one of those for free without needing its own copies of those routes.
function findPanel(projectId, pageId, panelId) {
  const pages = listPages(projectId);
  const page = pages.find((p) => p.id === pageId);
  if (!page) return {};
  const panel = page.panels.find((pn) => pn.id === panelId) || (page.floatingPanels || []).find((pn) => pn.id === panelId);
  return { pages, page, panel };
}

app.patch("/api/projects/:projectId/pages/:pageId/panels/:panelId", (req, res) => {
  const { projectId, pageId, panelId } = req.params;
  const { pages, panel } = findPanel(projectId, pageId, panelId);
  if (!panel) return res.status(404).json({ error: "panel not found" });
  Object.assign(panel, req.body);
  savePages(projectId, pages);
  res.json(withPanelImage(projectId, pageId, panel));
});

// ---------- Panel image generation (composes a full scene from characters/place/objects) ----------
// Panel image files themselves (save/load/delete, folder layout) live in store.js,
// alongside the equivalent character/place/object image functions.

// Keeps "Panel N" labels sequential and gap-free after a panel is removed or a
// layout change adds/drops panels — position in the array is what actually
// drives grid placement (see PageCanvas), this is just the display label.
function reindexPanelOrder(panels) {
  panels.forEach((p, i) => {
    p.order = i;
  });
}

// ---------- Panel deletion & layout changes ----------

app.delete("/api/projects/:projectId/pages/:pageId/panels/:panelId", (req, res) => {
  const { projectId, pageId, panelId } = req.params;
  const { pages, page, panel } = findPanel(projectId, pageId, panelId);
  if (!panel) return res.status(404).json({ error: "panel not found" });

  deletePanelImage(projectId, pageId, panel.id);
  // Grid panels reindex order (their position in the array is what drives grid
  // placement, see reindexPanelOrder); floating panels have no such notion — dropping
  // one from its own array is the whole operation.
  if (page.panels.some((p) => p.id === panelId)) {
    page.panels = page.panels.filter((p) => p.id !== panelId);
    reindexPanelOrder(page.panels);
  } else {
    page.floatingPanels = (page.floatingPanels || []).filter((p) => p.id !== panelId);
  }
  savePages(projectId, pages);
  res.json(withPageImages(projectId, page));
});

// Swaps this panel with its neighbor on either side — array position is what actually
// drives grid placement (see reindexPanelOrder above), so the other panel visibly shifts
// into this one's old spot in the same move.
app.post("/api/projects/:projectId/pages/:pageId/panels/:panelId/move", (req, res) => {
  const { projectId, pageId, panelId } = req.params;
  const { direction } = req.body;
  const { pages, page, panel } = findPanel(projectId, pageId, panelId);
  if (!panel) return res.status(404).json({ error: "panel not found" });

  const index = page.panels.findIndex((p) => p.id === panelId);
  const targetIndex = direction === "left" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= page.panels.length) {
    return res.status(400).json({ error: "panel is already at that end" });
  }

  [page.panels[index], page.panels[targetIndex]] = [page.panels[targetIndex], page.panels[index]];
  reindexPanelOrder(page.panels);
  savePages(projectId, pages);
  res.json(withPageImages(projectId, page));
});

app.delete("/api/projects/:projectId/pages/:pageId", (req, res) => {
  const { projectId, pageId } = req.params;
  const pages = listPages(projectId);
  const page = pages.find((p) => p.id === pageId);
  if (!page) return res.status(404).json({ error: "page not found" });

  for (const panel of page.panels) deletePanelImage(projectId, pageId, panel.id);
  savePages(projectId, pages.filter((p) => p.id !== pageId));
  res.json({ ok: true });
});

// Changes a page's layout. `panelCount` comes from the frontend's chosen layout
// template, same as page creation. Growing appends empty panels; shrinking drops
// panels from the end (and their generated images) — the frontend is expected to
// warn the user before sending a panelCount smaller than the page's current count.
app.patch("/api/projects/:projectId/pages/:pageId", (req, res) => {
  const { projectId, pageId } = req.params;
  const pages = listPages(projectId);
  const page = pages.find((p) => p.id === pageId);
  if (!page) return res.status(404).json({ error: "page not found" });

  const { layout, panelCount, gridColumns, gridRows } = req.body;
  if (layout) {
    page.layout = layout;
    // A different layout has an entirely different grid-area structure, so any hand-
    // dragged track sizes from the previous one no longer correspond to anything —
    // drop them and let the new layout's own template columns/rows apply.
    delete page.gridColumns;
    delete page.gridRows;
  }
  // Only set when actually provided — a resize-drag PATCH sends just these two fields
  // with no `layout`, and shouldn't touch it or panelCount.
  if (gridColumns !== undefined) page.gridColumns = gridColumns;
  if (gridRows !== undefined) page.gridRows = gridRows;
  if (panelCount != null && panelCount !== page.panels.length) {
    if (panelCount < page.panels.length) {
      for (const removed of page.panels.slice(panelCount)) deletePanelImage(projectId, pageId, removed.id);
      page.panels = page.panels.slice(0, panelCount);
    } else {
      const toAdd = panelCount - page.panels.length;
      for (let i = 0; i < toAdd; i++) {
        page.panels.push({ id: nanoid(8), order: 0, sceneDoc: EMPTY_SCENE_DOC });
      }
    }
    reindexPanelOrder(page.panels);
  }

  savePages(projectId, pages);
  res.json(withPageImages(projectId, page));
});

// Manually sets (or replaces) a panel's image directly, bypassing Codex — for when a
// generated image isn't well composed and the user would rather place their own.
// Resets imageOffset back to centered since a brand new image's crop has no relation to
// whatever the previous one's pan position was.
app.post("/api/projects/:projectId/pages/:pageId/panels/:panelId/image", upload.single("image"), async (req, res) => {
  const { projectId, pageId, panelId } = req.params;
  const { pages, panel } = findPanel(projectId, pageId, panelId);
  if (!panel) return res.status(404).json({ error: "panel not found" });
  if (!req.file) return res.status(400).json({ error: "image is required" });

  let buffer;
  try {
    buffer = await normalizeUploadedImage(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  savePanelImage(projectId, pageId, panel.id, buffer);
  panel.imageOffset = { x: 50, y: 50 };
  savePages(projectId, pages);
  res.json(withPanelImage(projectId, pageId, panel));
});

app.delete("/api/projects/:projectId/pages/:pageId/panels/:panelId/image", (req, res) => {
  const { projectId, pageId, panelId } = req.params;
  const { panel } = findPanel(projectId, pageId, panelId);
  if (!panel) return res.status(404).json({ error: "panel not found" });

  deletePanelImage(projectId, pageId, panel.id);
  res.json(withPanelImage(projectId, pageId, panel));
});

// Reveals a panel's saved image file in the host's native file manager. macOS/Windows can
// select the specific file; xdg-open has no universal cross-file-manager way to do that,
// so Linux just opens the containing per-panel folder. Same execFile-only approach as
// /projects/:id/open-folder above — the path is built entirely from server-side IDs
// (projectId/pageId/panelId), never taken raw from the request.
app.post("/api/projects/:projectId/pages/:pageId/panels/:panelId/open-image", (req, res) => {
  const { projectId, pageId, panelId } = req.params;
  const { panel } = findPanel(projectId, pageId, panelId);
  if (!panel) return res.status(404).json({ error: "panel not found" });

  const filePath = panelImagePath(projectId, pageId, panelId);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "panel has no image" });

  if (process.platform === "darwin") {
    execFile("open", ["-R", filePath], (err) => {
      if (err) console.error("open-image: failed to launch open:", err.message);
    });
  } else if (process.platform === "win32") {
    execFile("explorer", [`/select,${filePath}`], (err) => {
      if (err) console.error("open-image: failed to launch explorer:", err.message);
    });
  } else {
    execFile("xdg-open", [path.dirname(filePath)], (err) => {
      if (err) console.error("open-image: failed to launch xdg-open:", err.message);
    });
  }
  res.json({ ok: true, path: filePath });
});

function slugifyTitle(title) {
  const slug = (title || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return slug || "untitled";
}

// Saves a finished page as a PDF, rendered client-side (the browser already has the
// exact composed page — panels, images, speech bubbles — on screen) and posted here to
// live on disk under the project, in projects/<id>/pages/<page title>.pdf.
app.post("/api/projects/:projectId/pages/:pageId/pdf", upload.single("pdf"), (req, res) => {
  const { projectId, pageId } = req.params;
  const pages = listPages(projectId);
  const page = pages.find((p) => p.id === pageId);
  if (!page) return res.status(404).json({ error: "page not found" });
  if (!req.file) return res.status(400).json({ error: "pdf is required" });

  const dir = path.join(PROJECTS_DIR, projectId, "pages");
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${slugifyTitle(page.title)}.pdf`;
  fs.writeFileSync(path.join(dir, filename), req.file.buffer);
  res.json({ ok: true, filename });
});

// Saves every page of the project stitched into one multi-page PDF (built client-side —
// see exportAllPagesPdf in App.jsx), living at the project's root rather than inside
// pages/ alongside the individual per-page exports, since it isn't one of those.
app.post("/api/projects/:projectId/pdf", upload.single("pdf"), (req, res) => {
  const { projectId } = req.params;
  const project = getProject(projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  if (!req.file) return res.status(400).json({ error: "pdf is required" });

  const filename = `${slugifyTitle(project.name)}.pdf`;
  fs.writeFileSync(path.join(PROJECTS_DIR, projectId, filename), req.file.buffer);
  res.json({ ok: true, filename });
});

// Reveals an arbitrary file saved somewhere under this project's folder — currently used
// for the "open" button shown right after a PDF export finishes (both the per-page and
// all-pages ones), so there's a way to jump straight to what was just saved instead of
// only reading its path in a status message. Same execFile-only, must-stay-inside-the-
// project's-own-folder approach as the other open-* endpoints above; relativePath is
// resolved against and checked to stay inside PROJECTS_DIR/:projectId, so it can't escape
// to an arbitrary path on disk.
app.post("/api/projects/:projectId/open-file", (req, res) => {
  const { projectId } = req.params;
  const { relativePath } = req.body;
  if (!relativePath) return res.status(400).json({ error: "relativePath is required" });

  const projectDir = path.resolve(path.join(PROJECTS_DIR, projectId));
  const filePath = path.resolve(path.join(projectDir, relativePath));
  if (!filePath.startsWith(projectDir + path.sep)) {
    return res.status(400).json({ error: "invalid path" });
  }
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "file not found" });

  if (process.platform === "darwin") {
    execFile("open", ["-R", filePath], (err) => {
      if (err) console.error("open-file: failed to launch open:", err.message);
    });
  } else if (process.platform === "win32") {
    execFile("explorer", [`/select,${filePath}`], (err) => {
      if (err) console.error("open-file: failed to launch explorer:", err.message);
    });
  } else {
    execFile("xdg-open", [path.dirname(filePath)], (err) => {
      if (err) console.error("open-file: failed to launch xdg-open:", err.message);
    });
  }
  res.json({ ok: true, path: filePath });
});

app.post("/api/projects/:projectId/pages/:pageId/panels/:panelId/generate", async (req, res) => {
  try {
    const { projectId, pageId, panelId } = req.params;
    const { pages, page, panel } = findPanel(projectId, pageId, panelId);
    if (!panel) return res.status(404).json({ error: "panel not found" });

    Object.assign(panel, req.body); // sceneDoc
    savePages(projectId, pages);

    const { plainText, characterIds, placeIds, objectIds, referenceIds, panelIds } = parseSceneDoc(panel.sceneDoc);
    const characters = characterIds.map((id) => getEntity(projectId, "characters", id)).filter(Boolean);
    const places = placeIds.map((id) => getEntity(projectId, "places", id)).filter(Boolean);
    const objects = objectIds.map((id) => getEntity(projectId, "objects", id)).filter(Boolean);
    const references = referenceIds.map((id) => getEntity(projectId, "references", id)).filter(Boolean);

    // Panels mentioned in the scene text (e.g. "#Panel 2") anchor continuity — their
    // generated image comes along as a reference so the room/decor/props stay
    // consistent, without forcing every panel to inherit whatever came right before it.
    // Panel ids are unique project-wide, so this can pull in a panel from any page.
    const continuityPanels = panelIds
      .map((id) => {
        for (const pg of pages) {
          const found = pg.panels.find((p) => p.id === id);
          if (found) return { ...found, pageId: pg.id, pageTitle: pg.title };
        }
        return null;
      })
      .filter(Boolean)
      .map((p) => ({
        order: p.order,
        pageTitle: p.pageTitle,
        plainText: parseSceneDoc(p.sceneDoc).plainText,
        pageId: p.pageId,
        panelId: p.id,
      }));

    const referenceImages = [
      ...characters.map((c) => loadEntityImage(projectId, "characters", c.id)).filter(Boolean),
      ...places.map((p) => loadEntityImage(projectId, "places", p.id)).filter(Boolean),
      ...objects.map((o) => loadEntityImage(projectId, "objects", o.id)).filter(Boolean),
      ...references.map((r) => loadEntityImage(projectId, "references", r.id)).filter(Boolean),
      ...continuityPanels.map((p) => loadPanelImage(projectId, p.pageId, p.panelId)).filter(Boolean),
    ];

    const prompt = buildPrompt({
      sceneDescription: plainText,
      characters,
      places,
      objects,
      references,
      continuityPanels,
      stylePreset: page.stylePreset,
    });

    await generateImageViaCodex(projectId, panelImagePath(projectId, pageId, panel.id), prompt, referenceImages);

    savePages(projectId, pages);

    res.json({ ...withPanelImage(projectId, pageId, panel), prompt });
  } catch (err) {
    console.error(err);
    if (err instanceof CodexError) return res.status(502).json({ error: err.message, code: "CODEX_ERROR" });
    res.status(500).json({ error: err.message });
  }
});

// Generates an EDITED candidate from the panel's current image + a text instruction,
// via Codex — returned as raw image bytes, not committed to the panel. The frontend
// shows it next to the original (before/after) and only calls the existing manual-image
// endpoint to actually commit it if the user picks the edited version; picking "keep
// original" just discards the response, nothing on disk ever changes for that case.
app.post("/api/projects/:projectId/pages/:pageId/panels/:panelId/edit", async (req, res) => {
  try {
    const { projectId, pageId, panelId } = req.params;
    const { instructions, sceneDoc, markerRect } = req.body;
    const { pages, page, panel } = findPanel(projectId, pageId, panelId);
    if (!panel) return res.status(404).json({ error: "panel not found" });

    const currentImage = loadPanelImage(projectId, pageId, panel.id);
    if (!currentImage) return res.status(400).json({ error: "panel has no image to edit" });

    const markedImage = isValidMarkerRect(markerRect) ? await drawMarkerRect(currentImage, markerRect) : null;

    // sceneDoc (a Tiptap doc, like a panel's own scene description) carries any
    // #/!/@-mentioned characters/places/objects/references/panels; plain `instructions`
    // is kept as a fallback for callers that only send text.
    const { plainText, characterIds, placeIds, objectIds, referenceIds, panelIds } = sceneDoc
      ? parseSceneDoc(sceneDoc)
      : { plainText: "", characterIds: [], placeIds: [], objectIds: [], referenceIds: [], panelIds: [] };
    const finalInstructions = plainText || instructions;
    if (!finalInstructions?.trim()) return res.status(400).json({ error: "instructions are required" });

    const characters = characterIds.map((id) => getEntity(projectId, "characters", id)).filter(Boolean);
    const places = placeIds.map((id) => getEntity(projectId, "places", id)).filter(Boolean);
    const objects = objectIds.map((id) => getEntity(projectId, "objects", id)).filter(Boolean);
    const references = referenceIds.map((id) => getEntity(projectId, "references", id)).filter(Boolean);
    const continuityPanels = panelIds
      .map((id) => {
        for (const pg of pages) {
          const found = pg.panels.find((p) => p.id === id);
          if (found) return { ...found, pageId: pg.id, pageTitle: pg.title };
        }
        return null;
      })
      .filter(Boolean)
      .map((p) => ({
        order: p.order,
        pageTitle: p.pageTitle,
        plainText: parseSceneDoc(p.sceneDoc).plainText,
        pageId: p.pageId,
        panelId: p.id,
      }));

    // Panel being edited goes FIRST (clean, untouched) — buildEditPrompt tells Codex
    // that's the edit target. The marked-up copy, if any, goes SECOND, purely to point
    // at the edit region. Everything after that is just for matching appearance.
    const referenceImages = [
      currentImage,
      ...(markedImage ? [markedImage] : []),
      ...characters.map((c) => loadEntityImage(projectId, "characters", c.id)).filter(Boolean),
      ...places.map((p) => loadEntityImage(projectId, "places", p.id)).filter(Boolean),
      ...objects.map((o) => loadEntityImage(projectId, "objects", o.id)).filter(Boolean),
      ...references.map((r) => loadEntityImage(projectId, "references", r.id)).filter(Boolean),
      ...continuityPanels.map((p) => loadPanelImage(projectId, p.pageId, p.panelId)).filter(Boolean),
    ];

    const prompt = buildEditPrompt({
      instructions: finalInstructions,
      characters,
      places,
      objects,
      references,
      continuityPanels,
      stylePreset: page.stylePreset,
      hasMarker: !!markedImage,
    });
    const imageBuf = await generateImageViaCodex(projectId, null, prompt, referenceImages);

    res.set("Content-Type", "image/png");
    res.send(imageBuf);
  } catch (err) {
    console.error(err);
    if (err instanceof CodexError) return res.status(502).json({ error: err.message, code: "CODEX_ERROR" });
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8787;
const server = http.createServer(app);
attachTerminal(server);
server.listen(PORT, () => console.log(`Manga backend running on http://localhost:${PORT}`));
