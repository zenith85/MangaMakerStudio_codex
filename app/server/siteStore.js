import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";

// Site Builder's own storage — a SEPARATE tree (site-projects/) and module, same
// reasoning as bookStore.js: nothing here touches Manga Studio's or HTML Shorts Maker's
// folders. A site project is just site.json (page settings + rows/columns/elements, see
// SiteApp.jsx's newSite) and a flat site-assets/ folder of uploaded images. The HTML
// itself is rendered in the browser (see siteRender.js), so the server never needs to
// understand the element tree — it stores and returns it as-is.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_PROJECTS_DIR = path.join(__dirname, "site-projects");

const LOCAL_ORIGIN = `http://localhost:${process.env.PORT || 8787}`;

fs.mkdirSync(SITE_PROJECTS_DIR, { recursive: true });

// Write-then-rename, same as bookStore.js's writeJSON — the site is autosaved on a
// short debounce while you edit, so a torn write is a real risk without it.
function writeJSON(p, data) {
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}

function slugify(name) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "site";
}

function uniqueSlug(dir, name) {
  const base = slugify(name);
  let slug = base;
  let n = 2;
  while (fs.existsSync(path.join(dir, slug))) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

function projectDir(projectId) {
  return path.join(SITE_PROJECTS_DIR, projectId);
}

// ---------- Site projects ----------

export function listSiteProjects() {
  return fs
    .readdirSync(SITE_PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const meta = readProjectMeta(d.name);
      return meta && { ...meta, id: d.name };
    })
    .filter(Boolean)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function readProjectMeta(projectId) {
  const p = path.join(projectDir(projectId), "project.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function getSiteProject(projectId) {
  const meta = readProjectMeta(projectId);
  return meta && { ...meta, id: projectId };
}

// `site` is the starting content picked on the frontend (blank or a template) — the
// server doesn't know the shape, it just stores it.
export function createSiteProject(name, site) {
  const id = uniqueSlug(SITE_PROJECTS_DIR, name);
  const dir = projectDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const project = { name: name.trim(), createdAt: Date.now() };
  writeJSON(path.join(dir, "project.json"), project);
  writeJSON(path.join(dir, "site.json"), site);
  return { ...project, id };
}

export function deleteSiteProject(projectId) {
  fs.rmSync(projectDir(projectId), { recursive: true, force: true });
}

export function siteProjectDir(projectId) {
  return projectDir(projectId);
}

// ---------- Site content: <projectId>/site.json ----------

function sitePath(projectId) {
  return path.join(projectDir(projectId), "site.json");
}

export function getSite(projectId) {
  return JSON.parse(fs.readFileSync(sitePath(projectId), "utf-8"));
}

export function saveSite(projectId, site) {
  writeJSON(sitePath(projectId), site);
  return site;
}

// ---------- Assets: <projectId>/site-assets/<assetId>.<ext> ----------

function assetsDir(projectId) {
  return path.join(projectDir(projectId), "site-assets");
}

// The extension is part of the stored filename (unlike book images, which are always
// .png) because uploads keep their own format — a GIF stays animated, an SVG stays
// vector. Returns the new asset's id and its URL; elements reference the URL directly.
export function saveSiteAsset(projectId, buffer, ext) {
  fs.mkdirSync(assetsDir(projectId), { recursive: true });
  const assetId = `${nanoid(10)}.${ext}`;
  fs.writeFileSync(path.join(assetsDir(projectId), assetId), buffer);
  return { assetId, url: `${LOCAL_ORIGIN}/site-projects/${projectId}/site-assets/${assetId}` };
}

export { SITE_PROJECTS_DIR };
