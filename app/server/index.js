import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { attachTerminal } from "./terminal.js";
import {
  listProjects,
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
  listPages,
  savePages,
} from "./store.js";
import { generateImageViaCodex, CodexError } from "./codex.js";
import { buildPrompt, buildEntityPrompt } from "./prompt.js";
import { parseSceneDoc, EMPTY_SCENE_DOC } from "./scene.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.join(__dirname, "projects");

const upload = multer({ storage: multer.memoryStorage() });
const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use("/projects", express.static(PROJECTS_DIR)); // serves .../<projectId>/<kind>/<entityId>/image.png directly

const ENTITY_KINDS = ["characters", "places", "objects"];

function withEntityUrl(projectId, kind, entity) {
  return { ...entity, imageUrl: entity.hasImage ? entityImageUrl(projectId, kind, entity.id) : null };
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

  app.post(`/api/projects/:projectId/${kind}`, upload.single("image"), (req, res) => {
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
    const entity = createEntity(req.params.projectId, kind, { name, fields, style });
    if (req.file) saveEntityImage(req.params.projectId, kind, entity.id, req.file.buffer);
    res.json(withEntityUrl(req.params.projectId, kind, getEntity(req.params.projectId, kind, entity.id)));
  });

  app.patch(`/api/projects/:projectId/${kind}/:id`, upload.single("image"), (req, res) => {
    const { projectId, id } = req.params;
    let fields;
    if (req.body.fields) {
      try {
        fields = typeof req.body.fields === "string" ? JSON.parse(req.body.fields) : req.body.fields;
      } catch {
        return res.status(400).json({ error: "fields must be valid JSON" });
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

  // Generate (or redraw) this entity's single reference image via Codex.
  app.post(`/api/projects/:projectId/${kind}/:id/generate`, async (req, res) => {
    try {
      const { projectId, id } = req.params;
      const entity = getEntity(projectId, kind, id);
      if (!entity) return res.status(404).json({ error: `${kind} not found` });

      const prompt = buildEntityPrompt({ kind, name: entity.name, fields: entity.fields, style: entity.style });
      const imageBuf = await generateImageViaCodex(projectId, prompt);

      saveEntityImage(projectId, kind, id, imageBuf);
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
  res.json(listPages(req.params.projectId));
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
      imageAssetId: null, // nanoid; served from /uploads (page-panel renders, separate from entity reference images)
    })),
    createdAt: Date.now(),
  };

  const pages = listPages(req.params.projectId);
  pages.push(page);
  savePages(req.params.projectId, pages);
  res.json(page);
});

app.get("/api/projects/:projectId/pages/:id", (req, res) => {
  const page = listPages(req.params.projectId).find((p) => p.id === req.params.id);
  if (!page) return res.status(404).json({ error: "page not found" });
  res.json(page);
});

function findPanel(projectId, pageId, panelId) {
  const pages = listPages(projectId);
  const page = pages.find((p) => p.id === pageId);
  if (!page) return {};
  const panel = page.panels.find((pn) => pn.id === panelId);
  return { pages, page, panel };
}

app.patch("/api/projects/:projectId/pages/:pageId/panels/:panelId", (req, res) => {
  const { projectId, pageId, panelId } = req.params;
  const { pages, panel } = findPanel(projectId, pageId, panelId);
  if (!panel) return res.status(404).json({ error: "panel not found" });
  Object.assign(panel, req.body);
  savePages(projectId, pages);
  res.json(panel);
});

// ---------- Panel image generation (composes a full scene from characters/place/objects) ----------

const UPLOAD_DIR = path.join(__dirname, "uploads"); // panel renders only; entity images live under projects/
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOAD_DIR));

function savePanelImage(buf) {
  const id = nanoid(12);
  fs.writeFileSync(path.join(UPLOAD_DIR, `${id}.png`), buf);
  return id;
}
function loadPanelImage(id) {
  return fs.readFileSync(path.join(UPLOAD_DIR, `${id}.png`));
}
function panelImageUrl(id) {
  return `/uploads/${id}.png`;
}
function deletePanelAsset(panel) {
  if (!panel.imageAssetId) return;
  const p = path.join(UPLOAD_DIR, `${panel.imageAssetId}.png`);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
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

  deletePanelAsset(panel);
  page.panels = page.panels.filter((p) => p.id !== panelId);
  reindexPanelOrder(page.panels);
  savePages(projectId, pages);
  res.json(page);
});

app.delete("/api/projects/:projectId/pages/:pageId", (req, res) => {
  const { projectId, pageId } = req.params;
  const pages = listPages(projectId);
  const page = pages.find((p) => p.id === pageId);
  if (!page) return res.status(404).json({ error: "page not found" });

  for (const panel of page.panels) deletePanelAsset(panel);
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

  const { layout, panelCount } = req.body;
  if (layout) page.layout = layout;
  if (panelCount != null && panelCount !== page.panels.length) {
    if (panelCount < page.panels.length) {
      for (const removed of page.panels.slice(panelCount)) deletePanelAsset(removed);
      page.panels = page.panels.slice(0, panelCount);
    } else {
      const toAdd = panelCount - page.panels.length;
      for (let i = 0; i < toAdd; i++) {
        page.panels.push({ id: nanoid(8), order: 0, sceneDoc: EMPTY_SCENE_DOC, imageAssetId: null });
      }
    }
    reindexPanelOrder(page.panels);
  }

  savePages(projectId, pages);
  res.json(page);
});

// Manually sets (or replaces) a panel's image directly, bypassing Codex — for when a
// generated image isn't well composed and the user would rather place their own.
// Resets imageOffset back to centered since a brand new image's crop has no relation to
// whatever the previous one's pan position was.
app.post("/api/projects/:projectId/pages/:pageId/panels/:panelId/image", upload.single("image"), (req, res) => {
  const { projectId, pageId, panelId } = req.params;
  const { pages, panel } = findPanel(projectId, pageId, panelId);
  if (!panel) return res.status(404).json({ error: "panel not found" });
  if (!req.file) return res.status(400).json({ error: "image is required" });

  deletePanelAsset(panel);
  panel.imageAssetId = savePanelImage(req.file.buffer);
  panel.imageOffset = { x: 50, y: 50 };
  savePages(projectId, pages);
  res.json({ ...panel, imageUrl: panelImageUrl(panel.imageAssetId) });
});

app.delete("/api/projects/:projectId/pages/:pageId/panels/:panelId/image", (req, res) => {
  const { projectId, pageId, panelId } = req.params;
  const { pages, panel } = findPanel(projectId, pageId, panelId);
  if (!panel) return res.status(404).json({ error: "panel not found" });

  deletePanelAsset(panel);
  panel.imageAssetId = null;
  savePages(projectId, pages);
  res.json(panel);
});

// Reveals a panel's saved image file in the host's native file manager. macOS/Windows can
// select the specific file; xdg-open has no universal cross-file-manager way to do that,
// so Linux just opens the containing uploads folder. Same execFile-only, path-must-stay-
// inside-the-safe-root approach as /projects/:id/open-folder above — imageAssetId comes
// from the panel we already looked up server-side, never taken raw from the request, but
// the containment check stays as defense in depth.
app.post("/api/projects/:projectId/pages/:pageId/panels/:panelId/open-image", (req, res) => {
  const { projectId, pageId, panelId } = req.params;
  const { panel } = findPanel(projectId, pageId, panelId);
  if (!panel) return res.status(404).json({ error: "panel not found" });
  if (!panel.imageAssetId) return res.status(404).json({ error: "panel has no image" });

  const filePath = path.resolve(path.join(UPLOAD_DIR, `${panel.imageAssetId}.png`));
  if (!filePath.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
    return res.status(400).json({ error: "invalid image id" });
  }
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "image file missing" });

  if (process.platform === "darwin") {
    execFile("open", ["-R", filePath], (err) => {
      if (err) console.error("open-image: failed to launch open:", err.message);
    });
  } else if (process.platform === "win32") {
    execFile("explorer", [`/select,${filePath}`], (err) => {
      if (err) console.error("open-image: failed to launch explorer:", err.message);
    });
  } else {
    execFile("xdg-open", [UPLOAD_DIR], (err) => {
      if (err) console.error("open-image: failed to launch xdg-open:", err.message);
    });
  }
  res.json({ ok: true, path: filePath });
});

function slugifyPageTitle(title) {
  const slug = (title || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return slug || "page";
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
  const filename = `${slugifyPageTitle(page.title)}.pdf`;
  fs.writeFileSync(path.join(dir, filename), req.file.buffer);
  res.json({ ok: true, filename });
});

app.post("/api/projects/:projectId/pages/:pageId/panels/:panelId/generate", async (req, res) => {
  try {
    const { projectId, pageId, panelId } = req.params;
    const { pages, page, panel } = findPanel(projectId, pageId, panelId);
    if (!panel) return res.status(404).json({ error: "panel not found" });

    Object.assign(panel, req.body); // sceneDoc
    savePages(projectId, pages);

    const { plainText, characterIds, placeIds, objectIds, panelIds } = parseSceneDoc(panel.sceneDoc);
    const characters = characterIds.map((id) => getEntity(projectId, "characters", id)).filter(Boolean);
    const places = placeIds.map((id) => getEntity(projectId, "places", id)).filter(Boolean);
    const objects = objectIds.map((id) => getEntity(projectId, "objects", id)).filter(Boolean);

    // Panels mentioned in the scene text (e.g. "#Panel 2") anchor continuity — their
    // generated image comes along as a reference so the room/decor/props stay
    // consistent, without forcing every panel to inherit whatever came right before it.
    // Panel ids are unique project-wide, so this can pull in a panel from any page.
    const continuityPanels = panelIds
      .map((id) => {
        for (const pg of pages) {
          const found = pg.panels.find((p) => p.id === id);
          if (found) return { ...found, pageTitle: pg.title };
        }
        return null;
      })
      .filter(Boolean)
      .map((p) => ({
        order: p.order,
        pageTitle: p.pageTitle,
        plainText: parseSceneDoc(p.sceneDoc).plainText,
        imageAssetId: p.imageAssetId,
      }));

    const referenceImages = [
      ...characters.map((c) => loadEntityImage(projectId, "characters", c.id)).filter(Boolean),
      ...places.map((p) => loadEntityImage(projectId, "places", p.id)).filter(Boolean),
      ...objects.map((o) => loadEntityImage(projectId, "objects", o.id)).filter(Boolean),
      ...continuityPanels.map((p) => (p.imageAssetId ? loadPanelImage(p.imageAssetId) : null)).filter(Boolean),
    ];

    const prompt = buildPrompt({
      sceneDescription: plainText,
      characters,
      places,
      objects,
      continuityPanels,
      stylePreset: page.stylePreset,
    });

    const imageBuf = await generateImageViaCodex(projectId, prompt, referenceImages);

    panel.imageAssetId = savePanelImage(imageBuf);
    savePages(projectId, pages);

    res.json({ ...panel, imageUrl: panelImageUrl(panel.imageAssetId), prompt });
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
