import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.join(__dirname, "projects");
const ENTITY_KINDS = ["characters", "places", "objects"];

fs.mkdirSync(PROJECTS_DIR, { recursive: true });

function readJSON(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}
function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function slugify(name) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "item";
}

// Turn a name into a unique folder name under `dir` (handles "alex", "alex-2", ...)
function uniqueSlug(dir, name) {
  const base = slugify(name);
  let slug = base;
  let n = 2;
  while (fs.existsSync(path.join(dir, slug))) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

// ---------- Projects: ProjectName/ ----------

function projectDir(projectId) {
  return path.join(PROJECTS_DIR, projectId);
}

export function listProjects() {
  return fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readJSON(path.join(PROJECTS_DIR, d.name, "project.json")))
    .filter(Boolean)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function getProject(projectId) {
  return readJSON(path.join(projectDir(projectId), "project.json"));
}

export function createProject(name) {
  const id = uniqueSlug(PROJECTS_DIR, name);
  const dir = projectDir(id);
  fs.mkdirSync(dir, { recursive: true });
  for (const kind of ENTITY_KINDS) fs.mkdirSync(path.join(dir, kind), { recursive: true });

  const project = { id, name: name.trim(), createdAt: Date.now() };
  writeJSON(path.join(dir, "project.json"), project);
  writeJSON(path.join(dir, "pages.json"), []);
  return project;
}

export function deleteProject(projectId) {
  fs.rmSync(projectDir(projectId), { recursive: true, force: true });
}

// ---------- Characters / Places / Objects: ProjectName/<kind>/<slug>/ ----------
// Each entity folder holds: meta.json (source of truth), information.txt (human-readable
// mirror of meta.json), and image.png (once generated/uploaded).

function entityDir(projectId, kind, entityId) {
  return path.join(projectDir(projectId), kind, entityId);
}

function writeInformationTxt(dir, meta) {
  const lines = [`Name: ${meta.name}`];
  if (meta.style) lines.push(`Style: ${meta.style}`);
  for (const [key, value] of Object.entries(meta.fields || {})) {
    if (String(value ?? "").trim() === "") continue;
    lines.push(`${key.charAt(0).toUpperCase()}${key.slice(1)}: ${value}`);
  }
  fs.writeFileSync(path.join(dir, "information.txt"), lines.join("\n") + "\n");
}

function readEntity(projectId, kind, entityId) {
  const dir = entityDir(projectId, kind, entityId);
  const meta = readJSON(path.join(dir, "meta.json"));
  if (!meta) return null;
  return { ...meta, id: entityId, hasImage: fs.existsSync(path.join(dir, "image.png")) };
}

export function listEntities(projectId, kind) {
  const kindDir = path.join(projectDir(projectId), kind);
  if (!fs.existsSync(kindDir)) return [];
  return fs
    .readdirSync(kindDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readEntity(projectId, kind, d.name))
    .filter(Boolean)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function getEntity(projectId, kind, entityId) {
  return readEntity(projectId, kind, entityId);
}

export function createEntity(projectId, kind, { name, fields = {}, style = "" }) {
  const kindDir = path.join(projectDir(projectId), kind);
  fs.mkdirSync(kindDir, { recursive: true });
  const id = uniqueSlug(kindDir, name);
  const dir = path.join(kindDir, id);
  fs.mkdirSync(dir, { recursive: true });

  const meta = { name: name.trim(), fields, style, createdAt: Date.now() };
  writeJSON(path.join(dir, "meta.json"), meta);
  writeInformationTxt(dir, meta);
  return { ...meta, id, hasImage: false };
}

export function updateEntity(projectId, kind, entityId, updates) {
  const dir = entityDir(projectId, kind, entityId);
  const meta = readJSON(path.join(dir, "meta.json"));
  if (!meta) return null;

  if (updates.name?.trim()) meta.name = updates.name.trim();
  if (updates.fields) meta.fields = { ...meta.fields, ...updates.fields };
  if (updates.style !== undefined) meta.style = updates.style;

  writeJSON(path.join(dir, "meta.json"), meta);
  writeInformationTxt(dir, meta);
  return { ...meta, id: entityId, hasImage: fs.existsSync(path.join(dir, "image.png")) };
}

export function deleteEntity(projectId, kind, entityId) {
  fs.rmSync(entityDir(projectId, kind, entityId), { recursive: true, force: true });
}

export function saveEntityImage(projectId, kind, entityId, buffer) {
  fs.writeFileSync(path.join(entityDir(projectId, kind, entityId), "image.png"), buffer);
}

export function loadEntityImage(projectId, kind, entityId) {
  const p = path.join(entityDir(projectId, kind, entityId), "image.png");
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

export function entityImageUrl(projectId, kind, entityId) {
  return `/projects/${projectId}/${kind}/${entityId}/image.png`;
}

// ---------- Pages: ProjectName/pages.json ----------

// Panels used to store characterIds/placeId/objectIds arrays plus a separate plain
// sceneDescription string. That's replaced by a single sceneDoc (rich text with
// inline #mentions — see scene.js). Migrate any panel still in the old shape by
// folding its selections into an equivalent doc, so existing pages keep their cast.
function migratePanel(projectId, panel) {
  if (panel.sceneDoc) return panel;

  const content = [];
  if (panel.sceneDescription?.trim()) content.push({ type: "text", text: panel.sceneDescription.trim() + " " });

  const mentionsFor = (kind, ids) => {
    for (const id of ids ?? []) {
      const entity = getEntity(projectId, kind, id);
      if (entity) content.push({ type: "mention", attrs: { id: `${kind}:${id}`, label: entity.name } }, { type: "text", text: " " });
    }
  };
  mentionsFor("characters", panel.characterIds);
  mentionsFor("places", panel.placeId ? [panel.placeId] : []);
  mentionsFor("objects", panel.objectIds);

  const { characterIds, placeId, objectIds, sceneDescription, ...rest } = panel;
  return { ...rest, sceneDoc: { type: "doc", content: [{ type: "paragraph", content }] } };
}

export function listPages(projectId) {
  const pages = readJSON(path.join(projectDir(projectId), "pages.json")) || [];
  let migrated = false;
  for (const page of pages) {
    page.panels = page.panels.map((panel) => {
      if (panel.sceneDoc) return panel;
      migrated = true;
      return migratePanel(projectId, panel);
    });
  }
  if (migrated) savePages(projectId, pages);
  return pages;
}
export function savePages(projectId, pages) {
  writeJSON(path.join(projectDir(projectId), "pages.json"), pages);
}
