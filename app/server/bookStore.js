import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Ibraheem HTML Studio's own storage — deliberately a SEPARATE tree
// (book-projects/, not projects/) and a separate module from store.js, so nothing here
// ever touches Manga Studio's project folders or code path. A book project has no
// characters/pages/panels — just book.json (title/author/language plus the
// Codex-curated content tree) and a flat book-images/ folder for the cover and one
// illustration per chapter.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOK_PROJECTS_DIR = path.join(__dirname, "book-projects");

const LOCAL_ORIGIN = `http://localhost:${process.env.PORT || 8787}`;

fs.mkdirSync(BOOK_PROJECTS_DIR, { recursive: true });

// Write-then-rename rather than a direct writeFileSync: a rename is atomic on the same
// filesystem, so a concurrent reader always sees either the old file or the fully
// written new one, never a torn/truncated write — matters for the book PATCH route's
// read-modify-write, which would otherwise risk saving a blanked-out record over real
// data if it ever read mid-write.
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
  return slug || "book";
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
  return path.join(BOOK_PROJECTS_DIR, projectId);
}

// ---------- Book projects ----------

export function listBookProjects() {
  return fs
    .readdirSync(BOOK_PROJECTS_DIR, { withFileTypes: true })
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

export function getBookProject(projectId) {
  const meta = readProjectMeta(projectId);
  return meta && { ...meta, id: projectId };
}

export function createBookProject(name) {
  const id = uniqueSlug(BOOK_PROJECTS_DIR, name);
  const dir = projectDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const project = { name: name.trim(), createdAt: Date.now() };
  writeJSON(path.join(dir, "project.json"), project);
  writeJSON(path.join(dir, "book.json"), { title: "", author: "", language: "English", content: null });
  return { ...project, id };
}

export function deleteBookProject(projectId) {
  fs.rmSync(projectDir(projectId), { recursive: true, force: true });
}

export function bookProjectDirForCodex(projectId) {
  return projectDir(projectId);
}

// ---------- Book content: <projectId>/book.json ----------

function bookPath(projectId) {
  return path.join(projectDir(projectId), "book.json");
}

// Deliberately reads the raw file rather than swallowing a parse failure into a blank
// default — a book project's directory always has a book.json (created at project
// creation, see createBookProject above), so a read failure here is a real error to
// surface, not "book doesn't exist yet".
export function getBook(projectId) {
  return JSON.parse(fs.readFileSync(bookPath(projectId), "utf-8"));
}

export function saveBook(projectId, book) {
  writeJSON(bookPath(projectId), book);
  return book;
}

// ---------- Book images: <projectId>/book-images/<imageId>.png ----------

function bookImagesDir(projectId) {
  return path.join(projectDir(projectId), "book-images");
}

export function bookImagePath(projectId, imageId) {
  return path.join(bookImagesDir(projectId), `${imageId}.png`);
}

export function saveBookImage(projectId, imageId, buffer) {
  fs.mkdirSync(bookImagesDir(projectId), { recursive: true });
  fs.writeFileSync(bookImagePath(projectId, imageId), buffer);
}

export function loadBookImage(projectId, imageId) {
  const p = bookImagePath(projectId, imageId);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

export function deleteBookImage(projectId, imageId) {
  const p = bookImagePath(projectId, imageId);
  if (fs.existsSync(p)) fs.rmSync(p);
}

// Chapter images are keyed purely by their chapter's array index (chapter-0, chapter-1,
// ...) — there's no separate per-chapter id (see index.js's DELETE chapter route). So
// removing chapter `deletedIndex` from an `oldCount`-long array means every later
// chapter's image has to shift down one slot to stay attached to the right chapter,
// exactly the way its content already does via Array.filter. Copies rather than moves,
// so a missing source (a chapter whose image was never generated) correctly clears the
// destination too, instead of leaving a stale image behind from what used to be there.
export function renumberChapterImagesAfterDelete(projectId, deletedIndex, oldCount) {
  for (let k = deletedIndex; k <= oldCount - 2; k++) {
    const src = bookImagePath(projectId, `chapter-${k + 1}`);
    const dest = bookImagePath(projectId, `chapter-${k}`);
    if (fs.existsSync(src)) fs.copyFileSync(src, dest);
    else if (fs.existsSync(dest)) fs.rmSync(dest);
  }
  deleteBookImage(projectId, `chapter-${oldCount - 1}`); // now-orphaned last slot
}

// mtime cache-busting — a redraw overwrites the same filename, so without a
// version query the browser would just keep serving its cached copy of the old image.
export function bookImageInfo(projectId, imageId) {
  const p = bookImagePath(projectId, imageId);
  if (!fs.existsSync(p)) return { hasImage: false, imageUrl: null };
  const v = Math.round(fs.statSync(p).mtimeMs);
  return { hasImage: true, imageUrl: `${LOCAL_ORIGIN}/book-projects/${projectId}/book-images/${imageId}.png?v=${v}` };
}

export { BOOK_PROJECTS_DIR };
