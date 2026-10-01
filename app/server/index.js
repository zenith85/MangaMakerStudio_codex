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
  saveFilterImage,
  deleteFilterImage,
  filterImageInfo,
  listFonts,
  createFont,
  deleteFont,
  listFolders,
  saveFolders,
} from "./store.js";
import { generateImageViaCodex, translateTextsViaCodex, CodexError } from "./codex.js";
import { buildPrompt, buildEntityPrompt, buildEditPrompt } from "./prompt.js";
import { applyImageFilter } from "./imageFilters.js";
import { composePageThumbnail } from "./pageThumbnail.js";
import { parseSceneDoc, EMPTY_SCENE_DOC } from "./scene.js";
// HTML Shorts Maker — a fully separate feature bolted on beneath, with its own
// storage (bookStore.js, a sibling book-projects/ tree, never Manga Studio's projects/)
// and its own Codex text-curation call (bookCodex.js). It reuses generateImageViaCodex
// from codex.js as-is (imported above), since illustration generation is identical
// mechanics either way.
import {
  listBookProjects,
  getBookProject,
  createBookProject,
  deleteBookProject,
  getBook,
  saveBook,
  saveBookImage,
  deleteBookImage,
  renumberChapterImagesAfterDelete,
  loadBookImage,
  bookImageInfo,
  BOOK_PROJECTS_DIR,
} from "./bookStore.js";
import { generateBookContentViaCodex } from "./bookCodex.js";
import { buildBookContentPrompt, buildBookCoverImagePrompt, buildBookChapterImagePrompt } from "./bookPrompt.js";
import { renderBookHtml } from "./bookTemplate.js";
import { parseBookHtml } from "./bookImport.js";

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

function isValidMarker(m) {
  if (!m || typeof m !== "object") return false;
  if (m.type === "arrow") {
    return ["x1", "y1", "x2", "y2"].every((k) => Number.isFinite(m[k])) && Math.hypot(m.x2 - m.x1, m.y2 - m.y1) > 0.5;
  }
  return (
    ["x", "y", "width", "height"].every((k) => Number.isFinite(m[k])) && m.width > 0.5 && m.height > 0.5
  );
}

// Bakes red annotations (boxes and/or arrows) onto a COPY of the panel image, in
// image-pixel coordinates derived from each marker's 0-100 percentages (as drawn by the
// user over the displayed image on the frontend, which shows the same unrotated/unscaled
// source file). This copy is sent to Codex as an extra reference image purely to point
// at the edit region/direction — see buildEditPrompt's hasMarker note, which tells Codex
// not to reproduce the markup.
async function drawMarkers(imageBuffer, markers) {
  const { width: imgW, height: imgH } = await sharp(imageBuffer).metadata();
  const strokeWidth = Math.max(4, Math.round(Math.min(imgW, imgH) * 0.008));
  const shapes = markers
    .map((m) => {
      if (m.type === "arrow") {
        const x1 = (m.x1 / 100) * imgW;
        const y1 = (m.y1 / 100) * imgH;
        const x2 = (m.x2 / 100) * imgW;
        const y2 = (m.y2 / 100) * imgH;
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="red" stroke-width="${strokeWidth}" marker-end="url(#edit-arrowhead)" />`;
      }
      const x = (m.x / 100) * imgW;
      const y = (m.y / 100) * imgH;
      const w = (m.width / 100) * imgW;
      const h = (m.height / 100) * imgH;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="red" stroke-width="${strokeWidth}" />`;
    })
    .join("");
  const svg =
    `<svg width="${imgW}" height="${imgH}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><marker id="edit-arrowhead" markerWidth="4" markerHeight="4" refX="3.5" refY="2" orient="auto">` +
    `<polygon points="0 0, 4 2, 0 4" fill="red" /></marker></defs>` +
    shapes +
    `</svg>`;
  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}
const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use("/projects", express.static(PROJECTS_DIR)); // serves .../<projectId>/<kind>/<entityId>/image.png directly
app.use("/book-projects", express.static(BOOK_PROJECTS_DIR)); // serves .../<projectId>/book-images/<imageId>.png

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
  const info = panelImageInfo(projectId, pageId, panel.id);
  const filterInfo = filterImageInfo(projectId, pageId, panel.id);
  // The toggle (panel.imageFilterEnabled) just picks which already-on-disk file to point
  // imageUrl at — the original is never touched, so switching it off always falls back
  // to the untouched picture with no re-upload or re-generation needed.
  const imageUrl = panel.imageFilterEnabled && filterInfo.hasFilter ? filterInfo.filterUrl : info.imageUrl;
  return { ...panel, ...info, imageUrl, hasFilter: filterInfo.hasFilter };
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
    let descriptionDoc;
    if (req.body.descriptionDoc) {
      try {
        descriptionDoc = JSON.parse(req.body.descriptionDoc);
      } catch {
        return res.status(400).json({ error: "descriptionDoc must be valid JSON" });
      }
    }
    if (req.file) {
      try {
        req.file.buffer = await normalizeUploadedImage(req.file.buffer);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }
    // Lets "+ Add new" from inside an open folder drop the new entity straight into it,
    // instead of always landing unfiled and needing a second move.
    const folderId = req.body.folderId || null;
    const entity = createEntity(req.params.projectId, kind, { name, fields, style, descriptionDoc, folderId });
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
    let descriptionDoc;
    if (req.body.descriptionDoc) {
      try {
        descriptionDoc = JSON.parse(req.body.descriptionDoc);
      } catch {
        return res.status(400).json({ error: "descriptionDoc must be valid JSON" });
      }
    }
    if (req.file) {
      try {
        req.file.buffer = await normalizeUploadedImage(req.file.buffer);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }
    const entity = updateEntity(projectId, kind, id, { name: req.body.name, fields, style: req.body.style, descriptionDoc });
    if (!entity) return res.status(404).json({ error: `${kind} not found` });
    if (req.file) saveEntityImage(projectId, kind, id, req.file.buffer); // manual upload = a "redraw" too
    res.json(withEntityUrl(projectId, kind, getEntity(projectId, kind, id)));
  });

  app.delete(`/api/projects/:projectId/${kind}/:id`, (req, res) => {
    deleteEntity(req.params.projectId, kind, req.params.id);
    res.json({ ok: true });
  });

  // A dedicated JSON route (not the multipart update above) for moving an entity into or
  // out of a folder — drag-and-drop and a plain "move to folder" picker both only ever
  // need to send this one field, not a full FormData resend of everything else.
  app.patch(`/api/projects/:projectId/${kind}/:id/folder`, (req, res) => {
    const { projectId, id } = req.params;
    const entity = updateEntity(projectId, kind, id, { folderId: req.body.folderId || null });
    if (!entity) return res.status(404).json({ error: `${kind} not found` });
    res.json(withEntityUrl(projectId, kind, entity));
  });

  app.get(`/api/projects/:projectId/${kind}/folders`, (req, res) => {
    res.json(listFolders(req.params.projectId, kind));
  });

  app.post(`/api/projects/:projectId/${kind}/folders`, (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    const folders = listFolders(req.params.projectId, kind);
    const folder = { id: nanoid(10), name: name.trim(), createdAt: Date.now() };
    folders.push(folder);
    saveFolders(req.params.projectId, kind, folders);
    res.json(folder);
  });

  app.patch(`/api/projects/:projectId/${kind}/folders/:folderId`, (req, res) => {
    const { projectId, folderId } = req.params;
    const folders = listFolders(projectId, kind);
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return res.status(404).json({ error: "folder not found" });
    if (req.body.name?.trim()) folder.name = req.body.name.trim();
    saveFolders(projectId, kind, folders);
    res.json(folder);
  });

  // Un-files every entity in the folder (rather than deleting them) before dropping the
  // folder itself — grouping is just a label, losing the label shouldn't lose the picture.
  app.delete(`/api/projects/:projectId/${kind}/folders/:folderId`, (req, res) => {
    const { projectId, folderId } = req.params;
    for (const entity of listEntities(projectId, kind)) {
      if (entity.folderId === folderId) updateEntity(projectId, kind, entity.id, { folderId: null });
    }
    saveFolders(projectId, kind, listFolders(projectId, kind).filter((f) => f.id !== folderId));
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

      // Same #/!/@ mention system as a panel's scene description (see the /generate
      // route below) — lets a character/place/object's own description reference other
      // entities/panels for visual context (e.g. a character described relative to a place).
      const { plainText, characterIds, placeIds, objectIds, referenceIds, panelIds } = entity.descriptionDoc
        ? parseSceneDoc(entity.descriptionDoc)
        : { plainText: "", characterIds: [], placeIds: [], objectIds: [], referenceIds: [], panelIds: [] };

      const characters = characterIds.map((cid) => getEntity(projectId, "characters", cid)).filter(Boolean);
      const places = placeIds.map((pid) => getEntity(projectId, "places", pid)).filter(Boolean);
      const objects = objectIds.map((oid) => getEntity(projectId, "objects", oid)).filter(Boolean);
      const references = referenceIds.map((rid) => getEntity(projectId, "references", rid)).filter(Boolean);

      const pages = listPages(projectId);
      const continuityPanels = panelIds
        .map((pid) => {
          for (const pg of pages) {
            const found = pg.panels.find((p) => p.id === pid);
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

      const prompt = buildEntityPrompt({
        kind, name: entity.name, fields: entity.fields, style: entity.style,
        description: plainText, characters, places, objects, references, continuityPanels,
      });
      await generateImageViaCodex(projectId, entityImagePath(projectId, kind, id), prompt, referenceImages);

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

// Pages Manager (drag-to-reorder, insert-between): takes the full desired order of page
// ids and rewrites the pages array to match it — simplest correct model, no separate
// "move to index" math to get wrong. Also renumbers every page's title to its new
// 1-based position, since the Pages Manager promises page names always reflect where a
// page actually sits in the book — this intentionally overrides any custom title the
// moment pages are reordered through it, same tradeoff quickAddPage's position-based
// naming already makes on the frontend.
app.post("/api/projects/:projectId/pages/reorder", (req, res) => {
  const { projectId } = req.params;
  const { pageIds } = req.body;
  const pages = listPages(projectId);

  if (!Array.isArray(pageIds) || pageIds.length !== pages.length || new Set(pageIds).size !== pageIds.length) {
    return res.status(400).json({ error: "pageIds must include every page exactly once" });
  }
  const byId = new Map(pages.map((p) => [p.id, p]));
  const reordered = pageIds.map((id) => byId.get(id));
  if (reordered.some((p) => !p)) return res.status(400).json({ error: "unknown page id" });

  reordered.forEach((p, i) => { p.title = String(i + 1); });
  savePages(projectId, reordered);
  res.json(reordered.map((p) => withPageImages(projectId, p)));
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
  deleteFilterImage(projectId, pageId, panel.id);
  // A grid panel is a fixed slot the page's layout template expects exactly one of
  // (PageCanvas indexes page.panels by the template's own p1/p2/... labels, not by
  // however many panels currently exist) — actually removing it from the array leaves
  // that slot with nothing to render there and crashes the whole page. So "delete" on a
  // grid panel means "clear it back to blank" (same shape as a freshly-added panel),
  // keeping its id/order and the array length untouched; only a floating panel — no
  // fixed slot to preserve — actually gets removed from its array.
  const gridIndex = page.panels.findIndex((p) => p.id === panelId);
  if (gridIndex !== -1) {
    page.panels[gridIndex] = { id: panel.id, order: panel.order, sceneDoc: EMPTY_SCENE_DOC };
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

  const { title, layout, panelCount, gridColumns, gridRows, language } = req.body;
  // Trimmed and ignored-if-empty rather than a 400 — a rename that clears the field back
  // out shouldn't be treated as an error, just a no-op that leaves the old title in place.
  if (typeof title === "string" && title.trim()) page.title = title.trim();
  // Which language's text every bubble on this page currently displays/edits — "en" (or
  // absent) is the original; switching to a translated language never touches bubble.text
  // itself (see the /translate route), so this alone is enough to flip back instantly.
  if (language !== undefined) page.language = language;
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

// Keyed by language code (matches the frontend's BUBBLE_LANGUAGES in App.jsx and
// bubble.translations' own keys) — adding another language later is just another entry
// here plus a button, not a schema change.
const TRANSLATE_LANGUAGE_NAMES = { ko: "Korean", ja: "Japanese", zh: "Chinese (Simplified)", ar: "Arabic" };

// Translates every speech bubble's text on a page into another language via Codex, and
// switches the page to display it — a bubble's ORIGINAL text (bubble.text) never
// changes; translations live in a separate bubble.translations[langCode] field, so
// switching back (see the generic PATCH above, `{ language: "en" }`) is instant and the
// original is always recoverable. Already-translated bubbles are skipped (cheap re-
// toggle after the first translate), so only genuinely new/changed text costs a Codex
// call — see Bubble.jsx's commitText, which clears a bubble's translations when its
// original text is hand-edited so a stale translation can't be shown as current.
app.post("/api/projects/:projectId/pages/:pageId/translate", async (req, res) => {
  try {
    const { projectId, pageId } = req.params;
    const targetLang = req.body?.targetLang || "ko";
    const languageName = TRANSLATE_LANGUAGE_NAMES[targetLang];
    if (!languageName) return res.status(400).json({ error: `unsupported target language: ${targetLang}` });

    const pages = listPages(projectId);
    const page = pages.find((p) => p.id === pageId);
    if (!page) return res.status(404).json({ error: "page not found" });

    const allPanels = [...page.panels, ...(page.floatingPanels || [])];
    const pendingBubbles = [];
    for (const panel of allPanels) {
      for (const bubble of panel.bubbles || []) {
        const text = (bubble.text || "").trim();
        if (!text || bubble.translations?.[targetLang]) continue;
        pendingBubbles.push(bubble);
      }
    }

    if (pendingBubbles.length > 0) {
      const translated = await translateTextsViaCodex(
        projectId,
        pendingBubbles.map((b) => b.text),
        languageName
      );
      pendingBubbles.forEach((bubble, i) => {
        bubble.translations = { ...(bubble.translations || {}), [targetLang]: translated[i] };
      });
    }

    page.language = targetLang;
    savePages(projectId, pages);
    res.json(withPageImages(projectId, page));
  } catch (err) {
    console.error(err);
    if (err instanceof CodexError) return res.status(502).json({ error: err.message, code: "CODEX_ERROR" });
    res.status(500).json({ error: err.message });
  }
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
  panel.imageFilterEnabled = false; // a filter baked from the previous image has no meaning for a brand new one
  savePages(projectId, pages);
  res.json(withPanelImage(projectId, pageId, panel));
});

app.delete("/api/projects/:projectId/pages/:pageId/panels/:panelId/image", (req, res) => {
  const { projectId, pageId, panelId } = req.params;
  const { pages, panel } = findPanel(projectId, pageId, panelId);
  if (!panel) return res.status(404).json({ error: "panel not found" });

  deletePanelImage(projectId, pageId, panel.id);
  panel.imageFilterEnabled = false;
  savePages(projectId, pages);
  res.json(withPanelImage(projectId, pageId, panel));
});

// Bakes one of the manga filters (see imageFilters.js: screentone/crosshatch/inkThreshold/
// vignette) onto the panel's CURRENT image and saves it as a single DERIVATIVE slot
// (filter.png, see store.js) — the original image.png is never touched, so this is safe to
// commit immediately rather than needing an accept/discard step. The panel's
// `imageFilterEnabled` flag (toggled independently via the generic PATCH below) just picks
// which of the two files to show; re-calling this (e.g. with a different type or a changed
// slider) simply re-bakes the derivative from the still-untouched original, overwriting
// whichever filter was baked there before.
app.post("/api/projects/:projectId/pages/:pageId/panels/:panelId/filter", async (req, res) => {
  try {
    const { projectId, pageId, panelId } = req.params;
    const { type, params } = req.body;
    const { pages, panel } = findPanel(projectId, pageId, panelId);
    if (!panel) return res.status(404).json({ error: "panel not found" });

    const currentImage = loadPanelImage(projectId, pageId, panel.id);
    if (!currentImage) return res.status(400).json({ error: "panel has no image to filter" });

    const outBuf = await applyImageFilter(currentImage, type, params || {});
    saveFilterImage(projectId, pageId, panel.id, outBuf);
    panel.imageFilter = type;
    panel.imageFilterParams = params || {};
    panel.imageFilterEnabled = true;
    savePages(projectId, pages);
    res.json(withPanelImage(projectId, pageId, panel));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
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

// The pose-sketch canvas (see App.jsx's PoseSketchPad) sends its drawing as a plain
// "data:image/png;base64,..." URL rather than a multipart upload — small enough (a few
// black lines) that JSON is simpler than switching those two routes to FormData just for
// this one optional field. Returns null for anything falsy/malformed rather than
// throwing, since a pose sketch is always optional.
function decodeDataUrl(dataUrl) {
  if (!dataUrl) return null;
  const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    return Buffer.from(match[1], "base64");
  } catch {
    return null;
  }
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

// Saves every page of the project stitched into one CBZ (a zip of page images built
// client-side — see exportAllPagesCbz in App.jsx), living at the project's root next to
// the equivalent all-pages PDF. CBZ readers just expect a plain zip of page images in
// order, nothing more, so the server's only job is to persist the already-built bytes.
// Saves a single page as its own one-image CBZ (built client-side — see exportPageCbz in
// App.jsx), living in pages/ alongside the equivalent single-page PDF. A one-page CBZ is
// an unusual thing to want on its own, but this only exists for symmetry with "Save as
// PDF" right next to it in the menu — same file, same page slug, just a .cbz extension.
app.post("/api/projects/:projectId/pages/:pageId/cbz", upload.single("cbz"), (req, res) => {
  const { projectId, pageId } = req.params;
  const pages = listPages(projectId);
  const page = pages.find((p) => p.id === pageId);
  if (!page) return res.status(404).json({ error: "page not found" });
  if (!req.file) return res.status(400).json({ error: "cbz is required" });

  const dir = path.join(PROJECTS_DIR, projectId, "pages");
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${slugifyTitle(page.title)}.cbz`;
  fs.writeFileSync(path.join(dir, filename), req.file.buffer);
  res.json({ ok: true, filename });
});

app.post("/api/projects/:projectId/cbz", upload.single("cbz"), (req, res) => {
  const { projectId } = req.params;
  const project = getProject(projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  if (!req.file) return res.status(400).json({ error: "cbz is required" });

  const filename = `${slugifyTitle(project.name)}.cbz`;
  fs.writeFileSync(path.join(PROJECTS_DIR, projectId, filename), req.file.buffer);
  res.json({ ok: true, filename });
});

// Saves every page of the project as one fixed-layout EPUB (a full valid EPUB3
// container — mimetype/container.xml/content.opf/nav/toc.ncx/page images — built
// client-side, see buildEpub in App.jsx), living at the project's root next to the
// equivalent all-pages PDF/CBZ. Same "client builds the whole file, server just
// persists the bytes" split as those two.
app.post("/api/projects/:projectId/epub", upload.single("epub"), (req, res) => {
  const { projectId } = req.params;
  const project = getProject(projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  if (!req.file) return res.status(400).json({ error: "epub is required" });

  const filename = `${slugifyTitle(project.name)}.epub`;
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

    // poseSketch/lastPageId/previousPanel are one-shot inputs for THIS generation only —
    // pulled out before the Object.assign below (which persists everything else in the
    // body, e.g. sceneDoc), since none belong permanently on the panel itself.
    const { poseSketch, lastPageId, previousPanel, ...panelPatch } = req.body;
    Object.assign(panel, panelPatch); // sceneDoc
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

    // "Reference last page" (see the Scene tab toggle) — a small composite of every
    // panel on the given page, for loose scene/environment continuity. null if the
    // frontend didn't ask for one (toggle off, or there's no previous page) or that
    // page has no panel images yet to composite.
    const lastPageThumbnail = lastPageId ? await composePageThumbnail(projectId, lastPageId) : null;
    // "Reference previous panel" (same Scene tab) — the image of the panel right before
    // this one, for tighter shot-to-shot continuity than the whole-page composite. null
    // if not asked for, or that panel has no image yet.
    const previousPanelImage =
      previousPanel?.pageId && previousPanel?.panelId
        ? loadPanelImage(projectId, previousPanel.pageId, previousPanel.panelId)
        : null;
    const poseSketchBuffer = decodeDataUrl(poseSketch);
    const referenceImages = [
      ...characters.map((c) => loadEntityImage(projectId, "characters", c.id)).filter(Boolean),
      ...places.map((p) => loadEntityImage(projectId, "places", p.id)).filter(Boolean),
      ...objects.map((o) => loadEntityImage(projectId, "objects", o.id)).filter(Boolean),
      ...references.map((r) => loadEntityImage(projectId, "references", r.id)).filter(Boolean),
      ...continuityPanels.map((p) => loadPanelImage(projectId, p.pageId, p.panelId)).filter(Boolean),
      // Always in this order, always LAST(-ish) — see buildPrompt's hasLastPageThumbnail/
      // hasPreviousPanelImage/hasPoseSketch notes, which describe these by exact trailing
      // position.
      ...(lastPageThumbnail ? [lastPageThumbnail] : []),
      ...(previousPanelImage ? [previousPanelImage] : []),
      ...(poseSketchBuffer ? [poseSketchBuffer] : []),
    ];

    const prompt = buildPrompt({
      sceneDescription: plainText,
      characters,
      places,
      objects,
      references,
      continuityPanels,
      stylePreset: page.stylePreset,
      hasLastPageThumbnail: !!lastPageThumbnail,
      hasPreviousPanelImage: !!previousPanelImage,
      hasPoseSketch: !!poseSketchBuffer,
    });

    await generateImageViaCodex(projectId, panelImagePath(projectId, pageId, panel.id), prompt, referenceImages);
    // Writes straight to panelImagePath rather than going through savePanelImage (which
    // would normally invalidate this for us) — so the stale filter derivative has to be
    // cleared explicitly here too.
    deleteFilterImage(projectId, pageId, panel.id);
    panel.imageFilterEnabled = false;

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
    const { instructions, sceneDoc, markers, poseSketch, manualReference, baseImage } = req.body;
    const { pages, page, panel } = findPanel(projectId, pageId, panelId);
    if (!panel) return res.status(404).json({ error: "panel not found" });

    // baseImage (a data URL — see the "after edit chat" in App.jsx's sendEditChatMessage)
    // is the CURRENT candidate, when refining one further — falls back to the panel's
    // actual committed image for a fresh edit request. Either way this is just the image
    // Codex edits; nothing here is written back to disk unless the result is later
    // explicitly committed via the manual-image endpoint.
    const currentImage = decodeDataUrl(baseImage) || loadPanelImage(projectId, pageId, panel.id);
    if (!currentImage) return res.status(400).json({ error: "panel has no image to edit" });

    const validMarkers = Array.isArray(markers) ? markers.filter(isValidMarker) : [];
    const markedImage = validMarkers.length ? await drawMarkers(currentImage, validMarkers) : null;

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

    const poseSketchBuffer = decodeDataUrl(poseSketch);
    const manualReferenceBuffer = decodeDataUrl(manualReference);
    // Panel being edited goes FIRST (clean, untouched) — buildEditPrompt tells Codex
    // that's the edit target. The marked-up copy, if any, goes SECOND, purely to point
    // at the edit region. Everything after that is just for matching appearance, with the
    // manual cut-and-move layout guide (if any) then the pose sketch (if any) always LAST
    // — see buildEditPrompt's hasManualReference/hasPoseSketch notes.
    const referenceImages = [
      currentImage,
      ...(markedImage ? [markedImage] : []),
      ...characters.map((c) => loadEntityImage(projectId, "characters", c.id)).filter(Boolean),
      ...places.map((p) => loadEntityImage(projectId, "places", p.id)).filter(Boolean),
      ...objects.map((o) => loadEntityImage(projectId, "objects", o.id)).filter(Boolean),
      ...references.map((r) => loadEntityImage(projectId, "references", r.id)).filter(Boolean),
      ...continuityPanels.map((p) => loadPanelImage(projectId, p.pageId, p.panelId)).filter(Boolean),
      ...(manualReferenceBuffer ? [manualReferenceBuffer] : []),
      ...(poseSketchBuffer ? [poseSketchBuffer] : []),
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
      hasManualReference: !!manualReferenceBuffer,
      hasPoseSketch: !!poseSketchBuffer,
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

// ==================== HTML Shorts Maker ====================
// Entirely separate route namespace (/api/book-projects/...) and storage
// (bookStore.js's book-projects/ tree) from everything above — no shared state with
// Manga Studio's /api/projects routes beyond the same Express app and the same
// generateImageViaCodex/CodexError already imported at the top of this file.

app.get("/api/book-projects", (_req, res) => {
  res.json(listBookProjects());
});

app.post("/api/book-projects", (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name is required" });
  res.json(createBookProject(name));
});

// Creates a whole new book project straight from an HTML file this same app
// previously exported (see bookImport.js's parseBookHtml) — the "Import HTML" option
// on the book landing screen (see BookApp.jsx), an alternative to the usual
// title-then-generate-with-Codex flow when you already have a finished book to bring
// back in and keep editing/regenerating pieces of.
app.post("/api/book-projects/import", upload.single("html"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "html file is required" });
  try {
    const { content, images, language } = parseBookHtml(req.file.buffer.toString("utf-8"));
    const name = content.title || req.file.originalname.replace(/\.html?$/i, "") || "Imported book";
    const project = createBookProject(name);

    const book = getBook(project.id);
    book.title = content.title || name;
    book.author = content.author || "";
    book.language = language;
    book.content = content;
    saveBook(project.id, book);

    Object.entries(images).forEach(([imageId, buffer]) => {
      if (buffer) saveBookImage(project.id, imageId, buffer);
    });

    res.json({ id: project.id, ...withBookImages(project.id, getBook(project.id)) });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "Failed to import this HTML file" });
  }
});

app.delete("/api/book-projects/:id", (req, res) => {
  deleteBookProject(req.params.id);
  res.json({ ok: true });
});

app.post("/api/book-projects/:id/open-folder", (req, res) => {
  const dir = path.resolve(path.join(BOOK_PROJECTS_DIR, req.params.id));
  if (!dir.startsWith(path.resolve(BOOK_PROJECTS_DIR) + path.sep)) {
    return res.status(400).json({ error: "invalid project id" });
  }
  if (!fs.existsSync(dir)) return res.status(404).json({ error: "project not found" });

  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  execFile(opener, [dir], (err) => {
    if (err) console.error(`open-folder: failed to launch ${opener}:`, err.message);
  });
  res.json({ ok: true, path: dir });
});

function withBookImages(projectId, book) {
  const images = { cover: bookImageInfo(projectId, "cover") };
  (book.content?.chapters || []).forEach((_, i) => {
    images[`chapter-${i}`] = bookImageInfo(projectId, `chapter-${i}`);
  });
  return { ...book, images };
}

app.get("/api/book-projects/:projectId/book", (req, res) => {
  const project = getBookProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  res.json(withBookImages(req.params.projectId, getBook(req.params.projectId)));
});

app.patch("/api/book-projects/:projectId/book", (req, res) => {
  const { projectId } = req.params;
  const project = getBookProject(projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const book = getBook(projectId);
  const { title, author, language, notes, content } = req.body;
  if (title !== undefined) book.title = title;
  if (author !== undefined) book.author = author;
  if (language !== undefined) book.language = language;
  if (notes !== undefined) book.notes = notes;
  if (content !== undefined) book.content = content; // manual edits to already-generated content
  saveBook(projectId, book);
  res.json(withBookImages(projectId, book));
});

// Chapter count is fixed at 7 to match a genuine ~10-minute read; not exposed as a
// setting since Codex already adapts each chapter's length to the material.
const BOOK_CHAPTER_COUNT = 7;

app.post("/api/book-projects/:projectId/book/generate-content", async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = getBookProject(projectId);
    if (!project) return res.status(404).json({ error: "project not found" });
    const book = getBook(projectId);
    if (!book.title?.trim()) return res.status(400).json({ error: "book title is required" });

    const prompt = buildBookContentPrompt({
      title: book.title,
      author: book.author,
      language: book.language || "English",
      chapterCount: BOOK_CHAPTER_COUNT,
      notes: book.notes,
    });
    const content = await generateBookContentViaCodex(projectId, prompt);
    book.content = content;
    saveBook(projectId, book);
    res.json(withBookImages(projectId, book));
  } catch (err) {
    console.error(err);
    if (err instanceof CodexError) return res.status(502).json({ error: err.message, code: "CODEX_ERROR" });
    res.status(500).json({ error: err.message });
  }
});

// Returns the exact prompt text that generate-content would send to Codex right now,
// without actually calling it — lets the UI show "what will be created" before
// committing to a (slow, one-shot) generation call.
app.get("/api/book-projects/:projectId/book/content-prompt", (req, res) => {
  const { projectId } = req.params;
  const book = getBook(projectId);
  if (!book.title?.trim()) return res.status(400).json({ error: "book title is required" });
  const prompt = buildBookContentPrompt({
    title: book.title,
    author: book.author,
    language: book.language || "English",
    chapterCount: BOOK_CHAPTER_COUNT,
    notes: book.notes,
  });
  res.json({ prompt });
});

const BOOK_ILLUSTRATION_STYLES = new Set(["bw_illustration", "color_illustration"]);

app.post("/api/book-projects/:projectId/book/cover/generate", async (req, res) => {
  try {
    const { projectId } = req.params;
    const book = getBook(projectId);
    if (!book.content) return res.status(400).json({ error: "generate the book's content first" });
    const style = BOOK_ILLUSTRATION_STYLES.has(req.body?.style) ? req.body.style : "bw_illustration";

    const prompt = buildBookCoverImagePrompt({
      title: book.content.title,
      tagline: book.content.tagline,
      style,
      imagePrompt: book.content.coverImagePrompt,
    });
    const outputPath = path.join(BOOK_PROJECTS_DIR, projectId, "book-images", "cover.png");
    const buffer = await generateImageViaCodex(projectId, outputPath, prompt);
    saveBookImage(projectId, "cover", buffer);
    res.json(withBookImages(projectId, book));
  } catch (err) {
    console.error(err);
    if (err instanceof CodexError) return res.status(502).json({ error: err.message, code: "CODEX_ERROR" });
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/book-projects/:projectId/book/chapters/:index/generate", async (req, res) => {
  try {
    const { projectId, index } = req.params;
    const book = getBook(projectId);
    const chapter = book.content?.chapters?.[Number(index)];
    if (!chapter) return res.status(404).json({ error: "chapter not found" });
    const style = BOOK_ILLUSTRATION_STYLES.has(req.body?.style) ? req.body.style : "bw_illustration";

    const imageId = `chapter-${index}`;
    const prompt = buildBookChapterImagePrompt({ imagePrompt: chapter.imagePrompt, style });
    const outputPath = path.join(BOOK_PROJECTS_DIR, projectId, "book-images", `${imageId}.png`);
    const buffer = await generateImageViaCodex(projectId, outputPath, prompt);
    saveBookImage(projectId, imageId, buffer);
    res.json(withBookImages(projectId, book));
  } catch (err) {
    console.error(err);
    if (err instanceof CodexError) return res.status(502).json({ error: err.message, code: "CODEX_ERROR" });
    res.status(500).json({ error: err.message });
  }
});

// Manually sets (or replaces) the cover or a chapter's illustration directly, bypassing
// Codex — same idea as the panel-image upload route above, and the same imageId scheme
// ("cover" / "chapter-<index>") withBookImages already reads. Drag-and-drop and
// clipboard-paste onto an ImageSlot (see BookApp.jsx) both funnel through this route.
app.post("/api/book-projects/:projectId/book/images/:imageId/upload", upload.single("image"), async (req, res) => {
  const { projectId, imageId } = req.params;
  const book = getBook(projectId);
  if (!book.content) return res.status(400).json({ error: "generate the book's content first" });
  if (imageId !== "cover") {
    const idx = Number(imageId.replace(/^chapter-/, ""));
    if (!/^chapter-\d+$/.test(imageId) || !book.content.chapters[idx]) {
      return res.status(400).json({ error: "invalid image slot" });
    }
  }
  if (!req.file) return res.status(400).json({ error: "image is required" });

  let buffer;
  try {
    buffer = await normalizeUploadedImage(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  saveBookImage(projectId, imageId, buffer);
  res.json(withBookImages(projectId, book));
});

// Removes one chapter entirely (content + its illustration), re-numbering every later
// chapter's "number" field and shifting their images down one slot to stay attached to
// the right chapter (see renumberChapterImagesAfterDelete's own comment — chapter images
// are keyed by array index, not a stable per-chapter id).
app.delete("/api/book-projects/:projectId/book/chapters/:index", (req, res) => {
  const { projectId, index } = req.params;
  const book = getBook(projectId);
  const idx = Number(index);
  const chapters = book.content?.chapters;
  if (!chapters || !Number.isInteger(idx) || idx < 0 || idx >= chapters.length) {
    return res.status(404).json({ error: "chapter not found" });
  }
  const oldCount = chapters.length;
  book.content.chapters = chapters.filter((_, i) => i !== idx).map((ch, i) => ({ ...ch, number: String(i + 1).padStart(2, "0") }));
  renumberChapterImagesAfterDelete(projectId, idx, oldCount);
  saveBook(projectId, book);
  res.json(withBookImages(projectId, book));
});

// Same rendered HTML as /export below, minus the download headers and the on-disk
// copy — for BookApp's live preview pane (see BookPreviewPane in BookApp.jsx), which
// loads this into an iframe via srcDoc and lets text with a data-field attribute (see
// bookTemplate.js's block()) be edited in place before Export re-applies those edits to
// the saved content.
app.get("/api/book-projects/:projectId/book/preview", (req, res) => {
  const { projectId } = req.params;
  const project = getBookProject(projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const book = getBook(projectId);
  if (!book.content) return res.status(400).json({ error: "generate the book's content first" });

  const images = { cover: loadBookImage(projectId, "cover") };
  book.content.chapters.forEach((_, i) => {
    images[`chapter-${i}`] = loadBookImage(projectId, `chapter-${i}`);
  });
  res.json({ html: renderBookHtml(book.content, images, { language: book.language }) });
});

app.get("/api/book-projects/:projectId/book/export", (req, res) => {
  const { projectId } = req.params;
  const project = getBookProject(projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const book = getBook(projectId);
  if (!book.content) return res.status(400).json({ error: "generate the book's content first" });

  const images = { cover: loadBookImage(projectId, "cover") };
  book.content.chapters.forEach((_, i) => {
    images[`chapter-${i}`] = loadBookImage(projectId, `chapter-${i}`);
  });

  const html = renderBookHtml(book.content, images, { language: book.language });
  const safeTitle = (book.content.title || book.title || "book").replace(/[\\/:*?"<>|]+/g, "").trim() || "book";
  const filename = `${safeTitle}_10min.html`;
  fs.writeFileSync(path.join(BOOK_PROJECTS_DIR, projectId, filename), html);

  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.send(html);
});

const PORT = process.env.PORT || 8787;
const server = http.createServer(app);
attachTerminal(server);
server.listen(PORT, () => console.log(`Manga backend running on http://localhost:${PORT}`));
