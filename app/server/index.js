import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
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

app.post("/api/projects/:projectId/pages/:pageId/panels/:panelId/generate", async (req, res) => {
  try {
    const { projectId, pageId, panelId } = req.params;
    const { pages, page, panel } = findPanel(projectId, pageId, panelId);
    if (!panel) return res.status(404).json({ error: "panel not found" });

    Object.assign(panel, req.body); // sceneDoc
    savePages(projectId, pages);

    const { plainText, characterIds, placeIds, objectIds } = parseSceneDoc(panel.sceneDoc);
    const characters = characterIds.map((id) => getEntity(projectId, "characters", id)).filter(Boolean);
    const places = placeIds.map((id) => getEntity(projectId, "places", id)).filter(Boolean);
    const objects = objectIds.map((id) => getEntity(projectId, "objects", id)).filter(Boolean);

    const referenceImages = [
      ...characters.map((c) => loadEntityImage(projectId, "characters", c.id)).filter(Boolean),
      ...places.map((p) => loadEntityImage(projectId, "places", p.id)).filter(Boolean),
      ...objects.map((o) => loadEntityImage(projectId, "objects", o.id)).filter(Boolean),
    ];

    const prompt = buildPrompt({
      sceneDescription: plainText,
      characters,
      places,
      objects,
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
