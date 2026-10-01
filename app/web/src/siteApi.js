// Site Builder's API client — separate from api.js (Manga Studio) and bookApi.js
// (HTML Shorts Maker), hitting its own /api/site-projects/... namespace on the same
// local backend.
const BASE = "http://localhost:8787/api";

async function req(path, options = {}) {
  const res = await fetch(BASE + path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

const json = (body) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const siteApi = {
  listProjects: () => req("/site-projects"),
  // `site` is the starting document (blank or a template, see siteTemplates.js).
  createProject: (name, site) => req("/site-projects", { method: "POST", ...json({ name, site }) }),
  deleteProject: (id) => req(`/site-projects/${id}`, { method: "DELETE" }),
  openProjectFolder: (id) => req(`/site-projects/${id}/open-folder`, { method: "POST" }),
  getSite: (projectId) => req(`/site-projects/${projectId}/site`),
  saveSite: (projectId, site) => req(`/site-projects/${projectId}/site`, { method: "PUT", ...json(site) }),
  // Returns { assetId, url } — elements store the url.
  uploadAsset: (projectId, file) => {
    const formData = new FormData();
    formData.append("file", file);
    return req(`/site-projects/${projectId}/assets`, { method: "POST", body: formData });
  },
};
