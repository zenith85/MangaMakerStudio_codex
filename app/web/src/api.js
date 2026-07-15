const BASE = "/api";

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

  listEntities: (projectId, kind) => req(`/projects/${projectId}/${kind}`),
  createEntity: (projectId, kind, formData) =>
    req(`/projects/${projectId}/${kind}`, { method: "POST", body: formData }),
  updateEntity: (projectId, kind, id, formData) =>
    req(`/projects/${projectId}/${kind}/${id}`, { method: "PATCH", body: formData }),
  deleteEntity: (projectId, kind, id) =>
    req(`/projects/${projectId}/${kind}/${id}`, { method: "DELETE" }),
  generateEntity: (projectId, kind, id) =>
    req(`/projects/${projectId}/${kind}/${id}/generate`, { method: "POST", ...json({}) }),

  listPages: (projectId) => req(`/projects/${projectId}/pages`),
  createPage: (projectId, body) => req(`/projects/${projectId}/pages`, { method: "POST", ...json(body) }),
  getPage: (projectId, id) => req(`/projects/${projectId}/pages/${id}`),
  updatePage: (projectId, pageId, body) =>
    req(`/projects/${projectId}/pages/${pageId}`, { method: "PATCH", ...json(body) }),

  updatePanel: (projectId, pageId, panelId, body) =>
    req(`/projects/${projectId}/pages/${pageId}/panels/${panelId}`, { method: "PATCH", ...json(body) }),
  deletePanel: (projectId, pageId, panelId) =>
    req(`/projects/${projectId}/pages/${pageId}/panels/${panelId}`, { method: "DELETE" }),
  generatePanel: (projectId, pageId, panelId, body) =>
    req(`/projects/${projectId}/pages/${pageId}/panels/${panelId}/generate`, { method: "POST", ...json(body) }),
};
