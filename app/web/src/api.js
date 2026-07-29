// Absolute, not relative — the frontend may be served from somewhere else entirely (a
// centrally-hosted UI), but "localhost" in a browser always means the browser's OWN
// machine, which is where the actual local backend (storage/Codex/terminal) runs.
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

export const api = {
  listProjects: () => req("/projects"),
  createProject: (name) => req("/projects", { method: "POST", ...json({ name }) }),
  deleteProject: (id) => req(`/projects/${id}`, { method: "DELETE" }),
  openProjectFolder: (id) => req(`/projects/${id}/open-folder`, { method: "POST" }),

  listEntities: (projectId, kind) => req(`/projects/${projectId}/${kind}`),
  createEntity: (projectId, kind, formData) =>
    req(`/projects/${projectId}/${kind}`, { method: "POST", body: formData }),
  updateEntity: (projectId, kind, id, formData) =>
    req(`/projects/${projectId}/${kind}/${id}`, { method: "PATCH", body: formData }),
  deleteEntity: (projectId, kind, id) =>
    req(`/projects/${projectId}/${kind}/${id}`, { method: "DELETE" }),
  generateEntity: (projectId, kind, id) =>
    req(`/projects/${projectId}/${kind}/${id}/generate`, { method: "POST", ...json({}) }),

  listFonts: (projectId) => req(`/projects/${projectId}/fonts`),
  createFont: (projectId, formData) => req(`/projects/${projectId}/fonts`, { method: "POST", body: formData }),
  deleteFont: (projectId, fontId) => req(`/projects/${projectId}/fonts/${fontId}`, { method: "DELETE" }),

  listPages: (projectId) => req(`/projects/${projectId}/pages`),
  createPage: (projectId, body) => req(`/projects/${projectId}/pages`, { method: "POST", ...json(body) }),
  getPage: (projectId, id) => req(`/projects/${projectId}/pages/${id}`),
  createFloatingPanel: (projectId, pageId) =>
    req(`/projects/${projectId}/pages/${pageId}/floating-panels`, { method: "POST", ...json({}) }),
  updatePage: (projectId, pageId, body) =>
    req(`/projects/${projectId}/pages/${pageId}`, { method: "PATCH", ...json(body) }),
  deletePage: (projectId, pageId) => req(`/projects/${projectId}/pages/${pageId}`, { method: "DELETE" }),

  updatePanel: (projectId, pageId, panelId, body) =>
    req(`/projects/${projectId}/pages/${pageId}/panels/${panelId}`, { method: "PATCH", ...json(body) }),
  deletePanel: (projectId, pageId, panelId) =>
    req(`/projects/${projectId}/pages/${pageId}/panels/${panelId}`, { method: "DELETE" }),
  movePanel: (projectId, pageId, panelId, direction) =>
    req(`/projects/${projectId}/pages/${pageId}/panels/${panelId}/move`, { method: "POST", ...json({ direction }) }),
  generatePanel: (projectId, pageId, panelId, body) =>
    req(`/projects/${projectId}/pages/${pageId}/panels/${panelId}/generate`, { method: "POST", ...json(body) }),
  uploadPanelImage: (projectId, pageId, panelId, formData) =>
    req(`/projects/${projectId}/pages/${pageId}/panels/${panelId}/image`, { method: "POST", body: formData }),
  clearPanelImage: (projectId, pageId, panelId) =>
    req(`/projects/${projectId}/pages/${pageId}/panels/${panelId}/image`, { method: "DELETE" }),
  openPanelImage: (projectId, pageId, panelId) =>
    req(`/projects/${projectId}/pages/${pageId}/panels/${panelId}/open-image`, { method: "POST" }),
  savePagePdf: (projectId, pageId, formData) =>
    req(`/projects/${projectId}/pages/${pageId}/pdf`, { method: "POST", body: formData }),
  saveProjectPdf: (projectId, formData) => req(`/projects/${projectId}/pdf`, { method: "POST", body: formData }),
  saveProjectCbz: (projectId, formData) => req(`/projects/${projectId}/cbz`, { method: "POST", body: formData }),
  openProjectFile: (projectId, relativePath) =>
    req(`/projects/${projectId}/open-file`, { method: "POST", ...json({ relativePath }) }),
  // Returns a Blob (raw image bytes), not JSON like everything above — the edit
  // candidate is a preview, not committed yet, so it doesn't go through `req`'s
  // res.json() parsing.
  requestPanelEdit: async (projectId, pageId, panelId, sceneDoc, markerRect) => {
    const res = await fetch(`${BASE}/projects/${projectId}/pages/${pageId}/panels/${panelId}/edit`, {
      method: "POST",
      ...json({ sceneDoc, markerRect }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error || res.statusText);
      err.code = body.code;
      throw err;
    }
    return res.blob();
  },
  // Unlike requestPanelEdit above, this commits immediately — it only ever bakes a
  // derivative file (filter.png) alongside the untouched original, so there's no
  // "candidate" step needed. Returns the updated panel (imageFilterEnabled: true, new
  // imageUrl). `type` is one of "screentone" | "crosshatch" | "inkThreshold" | "vignette".
  applyPanelFilter: (projectId, pageId, panelId, type, params) =>
    req(`/projects/${projectId}/pages/${pageId}/panels/${panelId}/filter`, {
      method: "POST",
      ...json({ type, params }),
    }),
};
