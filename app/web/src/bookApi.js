// Ibraheem HTML Studio's own API client — a separate module from api.js (Manga
// Studio's), hitting a separate route namespace (/api/book-projects/...) on the same
// local backend. Kept apart so nothing here ever needs api.js to change.
const BASE = "http://localhost:8787/api";

async function req(path, options = {}) {
  const res = await fetch(BASE + path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || res.statusText);
    err.code = body.code;
    throw err;
  }
  return res.json();
}

const json = (body) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const bookApi = {
  listProjects: () => req("/book-projects"),
  createProject: (name) => req("/book-projects", { method: "POST", ...json({ name }) }),
  deleteProject: (id) => req(`/book-projects/${id}`, { method: "DELETE" }),
  openProjectFolder: (id) => req(`/book-projects/${id}/open-folder`, { method: "POST" }),

  getBook: (projectId) => req(`/book-projects/${projectId}/book`),
  updateBook: (projectId, body) => req(`/book-projects/${projectId}/book`, { method: "PATCH", ...json(body) }),
  getContentPrompt: (projectId) => req(`/book-projects/${projectId}/book/content-prompt`),
  generateBookContent: (projectId) =>
    req(`/book-projects/${projectId}/book/generate-content`, { method: "POST", ...json({}) }),
  generateBookCover: (projectId, style) =>
    req(`/book-projects/${projectId}/book/cover/generate`, { method: "POST", ...json({ style }) }),
  generateBookChapterImage: (projectId, index, style) =>
    req(`/book-projects/${projectId}/book/chapters/${index}/generate`, { method: "POST", ...json({ style }) }),
  // Not JSON — the export route streams the HTML file itself with download headers, so
  // the caller just needs the URL to point a plain <a href download> at.
  bookExportUrl: (projectId) => `${BASE}/book-projects/${projectId}/book/export`,
};
