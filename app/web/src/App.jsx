import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "./api";
import Terminal from "./Terminal";
import SceneEditor from "./SceneEditor";

// Manga panel layout templates. Panels are assigned grid-area "p1", "p2", ...
// in order, so a layout's look comes entirely from its grid-template — no
// per-panel styling needed. `panelCount` drives how many panels a page gets.
const LAYOUTS = [
  { value: "single", label: "1 panel — splash page", panelCount: 1, areas: `"p1"`, columns: "1fr", rows: "1fr" },
  {
    value: "stack-2",
    label: "2 panels — stacked",
    panelCount: 2,
    areas: `"p1" "p2"`,
    columns: "1fr",
    rows: "1fr 1fr",
  },
  {
    value: "side-2",
    label: "2 panels — side by side",
    panelCount: 2,
    areas: `"p1 p2"`,
    columns: "1fr 1fr",
    rows: "1fr",
  },
  {
    value: "stack-3",
    label: "3 panels — stacked",
    panelCount: 3,
    areas: `"p1" "p2" "p3"`,
    columns: "1fr",
    rows: "1fr 1fr 1fr",
  },
  {
    value: "big-top-3",
    label: "3 panels — big top + 2 below",
    panelCount: 3,
    areas: `"p1 p1" "p2 p3"`,
    columns: "1fr 1fr",
    rows: "2fr 1fr",
  },
  {
    value: "big-bottom-3",
    label: "3 panels — 2 above + big bottom",
    panelCount: 3,
    areas: `"p1 p2" "p3 p3"`,
    columns: "1fr 1fr",
    rows: "1fr 2fr",
  },
  {
    value: "grid-2x2",
    label: "4 panels — grid",
    panelCount: 4,
    areas: `"p1 p2" "p3 p4"`,
    columns: "1fr 1fr",
    rows: "1fr 1fr",
  },
  {
    value: "big-left-4",
    label: "4 panels — big left + 3 stacked right",
    panelCount: 4,
    areas: `"p1 p2" "p1 p3" "p1 p4"`,
    columns: "2fr 1fr",
    rows: "1fr 1fr 1fr",
  },
  {
    value: "big-right-4",
    label: "4 panels — 3 stacked left + big right",
    panelCount: 4,
    areas: `"p2 p1" "p3 p1" "p4 p1"`,
    columns: "1fr 2fr",
    rows: "1fr 1fr 1fr",
  },
  {
    value: "grid-2x3",
    label: "6 panels — grid",
    panelCount: 6,
    areas: `"p1 p2" "p3 p4" "p5 p6"`,
    columns: "1fr 1fr",
    rows: "1fr 1fr 1fr",
  },
];

const STYLE_PRESETS = [
  { value: "manga_bw", label: "Manga (B&W)" },
  { value: "manhwa_color", label: "Manhwa (color)" },
  { value: "novel_illustration", label: "Novel illustration" },
];

const ENTITY_KINDS = [
  { value: "characters", label: "Characters", singular: "character" },
  { value: "places", label: "Places", singular: "place" },
  { value: "objects", label: "Objects", singular: "object" },
];

// True if a panel has a generated image or any non-empty scene text/mention — used to
// warn before a layout change would drop it (see changeLayout in App()).
function panelHasContent(panel) {
  if (panel.imageAssetId) return true;
  const hasNodeContent = (node) => {
    if (!node) return false;
    if (node.type === "mention") return true;
    if (node.type === "text") return !!node.text?.trim();
    return (node.content || []).some(hasNodeContent);
  };
  return hasNodeContent(panel.sceneDoc);
}

export default function App() {
  const [projects, setProjects] = useState(null); // null = not loaded yet
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [kind, setKind] = useState("characters");
  const [entities, setEntities] = useState({ characters: [], places: [], objects: [] });
  const [editingEntity, setEditingEntity] = useState(null); // { kind, entity } | { kind, entity: null } for "new"
  const [pages, setPages] = useState([]);
  const [currentPage, setCurrentPage] = useState(null);
  const [selectedPanelId, setSelectedPanelId] = useState(null);
  const [showTerminal, setShowTerminal] = useState(false);

  const refreshProjects = useCallback(() => api.listProjects().then(setProjects), []);

  const refreshEntities = useCallback((projectId) => {
    for (const k of ["characters", "places", "objects"]) {
      api.listEntities(projectId, k).then((list) => setEntities((prev) => ({ ...prev, [k]: list })));
    }
  }, []);

  const refreshPages = useCallback((projectId) => api.listPages(projectId).then(setPages), []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  const openProject = (id) => {
    setCurrentProjectId(id);
    setCurrentPage(null);
    setSelectedPanelId(null);
    setShowTerminal(true); // auto-open, cwd'd into this project's folder
    refreshEntities(id);
    refreshPages(id);
  };

  const createProject = async (name) => {
    const project = await api.createProject(name);
    await refreshProjects();
    openProject(project.id);
  };

  const openPage = async (id) => {
    const page = await api.getPage(currentProjectId, id);
    setCurrentPage(page);
    setSelectedPanelId(null);
  };

  // Also patches the page into `pages` (not just `currentPage`) so mentioning this
  // page's panels for continuity from elsewhere in the project stays up to date.
  const refreshCurrentPage = async () => {
    if (!currentPage) return;
    const updated = await api.getPage(currentProjectId, currentPage.id);
    setCurrentPage(updated);
    setPages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  // Live drag feedback (no network call) — see PanelThumb's pointermove handler.
  const dragPanelImage = (panelId, imageOffset) => {
    setCurrentPage((page) => ({
      ...page,
      panels: page.panels.map((p) => (p.id === panelId ? { ...p, imageOffset } : p)),
    }));
  };

  // Persist the final position once the drag ends.
  const commitPanelImage = (panelId, imageOffset) => {
    api.updatePanel(currentProjectId, currentPage.id, panelId, { imageOffset });
  };

  const createPage = async ({ title, layout, stylePreset }) => {
    const panelCount = LAYOUTS.find((l) => l.value === layout)?.panelCount ?? 4;
    const page = await api.createPage(currentProjectId, { title, layout, stylePreset, panelCount });
    await refreshPages(currentProjectId);
    setCurrentPage(page);
  };

  const deletePage = async (pageId) => {
    const target = pages.find((p) => p.id === pageId);
    if (!target) return;
    const withContent = target.panels.filter(panelHasContent).length;
    const detail = withContent > 0 ? ` — ${withContent} panel(s) have a generated image or scene text` : "";
    if (!window.confirm(`Delete "${target.title}" and all its panels${detail}? This can't be undone.`)) return;

    await api.deletePage(currentProjectId, pageId);
    setPages((prev) => prev.filter((p) => p.id !== pageId));
    if (currentPage?.id === pageId) {
      setCurrentPage(null);
      setSelectedPanelId(null);
    }
  };

  // Switching to a layout with fewer panels drops the trailing ones (grid position
  // comes from array order — see PageCanvas), so warn first if any would be lost.
  const changeLayout = async (layoutValue) => {
    const panelCount = LAYOUTS.find((l) => l.value === layoutValue)?.panelCount ?? 4;
    const dropped = currentPage.panels.slice(panelCount);
    if (dropped.length > 0) {
      const withContent = dropped.filter(panelHasContent).length;
      const detail =
        withContent > 0
          ? `, including ${withContent} with a generated image or scene text`
          : " (all empty)";
      const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
      if (
        !window.confirm(
          `This layout has ${plural(panelCount, "panel")} — the last ${plural(dropped.length, "panel")}${detail} will be removed. Continue?`
        )
      ) {
        return;
      }
    }
    const updated = await api.updatePage(currentProjectId, currentPage.id, { layout: layoutValue, panelCount });
    setCurrentPage(updated);
    await refreshPages(currentProjectId);
    if (selectedPanelId && !updated.panels.some((p) => p.id === selectedPanelId)) setSelectedPanelId(null);
  };

  const deletePanel = async (panelId) => {
    if (!window.confirm("Delete this panel? This can't be undone.")) return;
    const updated = await api.deletePanel(currentProjectId, currentPage.id, panelId);
    setCurrentPage(updated);
    setPages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setSelectedPanelId(null);
  };

  const selectedPanel = currentPage?.panels.find((p) => p.id === selectedPanelId) || null;

  // Every panel across every page in the project, for the scene editor's #mention list
  // (continuity references aren't limited to the current page). `currentPage` stands in
  // for its own entry in `pages` so its panels are never stale mid-edit.
  const allPanelsForMention = pages
    .map((p) => (p.id === currentPage?.id ? currentPage : p))
    .flatMap((p) => p.panels.map((panel) => ({ ...panel, pageTitle: p.title })));

  // ---------- Landing: no project open yet ----------
  if (!currentProjectId) {
    return (
      <>
        <ProjectLanding projects={projects} onOpen={openProject} onCreate={createProject} />
        <TerminalOverlay
          show={showTerminal}
          projectId={currentProjectId}
          onToggle={() => setShowTerminal((v) => !v)}
        />
      </>
    );
  }

  // Inside a project, the terminal must occupy only the center column — never
  // overlapping the sidebar or the panel editor, which are genuinely separate regions.
  const terminalToggle = (
    <TerminalOverlay
      show={showTerminal}
      projectId={currentProjectId}
      onToggle={() => setShowTerminal((v) => !v)}
      leftInset={280} // .sidebar width
      rightInset={selectedPanel ? 460 : 0} // .panel-editor width, only when it's open
    />
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="app-name">Ibraheem Manga Studio</span>
          <button className="back-link" onClick={() => setCurrentProjectId(null)}>
            ← Projects
          </button>
        </div>

        <div className="tabs">
          {ENTITY_KINDS.map((k) => (
            <button key={k.value} className={k.value === kind ? "active" : ""} onClick={() => setKind(k.value)}>
              {k.label}
            </button>
          ))}
        </div>

        <button
          className="primary add-entity-button"
          onClick={() => setEditingEntity({ kind, entity: null })}
        >
          + Add new {ENTITY_KINDS.find((k) => k.value === kind).singular}
        </button>

        <div className="asset-grid">
          {entities[kind].map((entity) => (
            <button
              className="asset-card"
              key={entity.id}
              onClick={() => setEditingEntity({ kind, entity })}
            >
              {entity.imageUrl ? (
                <img src={entity.imageUrl} alt={entity.name} />
              ) : (
                <div className="asset-card-placeholder">No image</div>
              )}
              <span>{entity.name}</span>
            </button>
          ))}
          {entities[kind].length === 0 && <p className="empty-hint">No {kind} yet.</p>}
        </div>
      </aside>

      <main className="main">
        <PageBar
          pages={pages}
          currentPage={currentPage}
          onOpen={openPage}
          onCreate={createPage}
          onChangeLayout={changeLayout}
          onDelete={deletePage}
        />
        {currentPage ? (
          <PageCanvas
            page={currentPage}
            selectedPanelId={selectedPanelId}
            onSelect={setSelectedPanelId}
            onDragImage={dragPanelImage}
            onDragImageEnd={commitPanelImage}
          />
        ) : (
          <p className="empty-hint">Create a page to get started.</p>
        )}
      </main>

      {selectedPanel && (
        <PanelEditor
          key={selectedPanel.id}
          projectId={currentProjectId}
          page={currentPage}
          panel={selectedPanel}
          characters={entities.characters}
          places={entities.places}
          objects={entities.objects}
          allPanels={allPanelsForMention}
          onClose={() => setSelectedPanelId(null)}
          onUpdated={refreshCurrentPage}
          onDelete={deletePanel}
        />
      )}

      {editingEntity && (
        <EntityCreatorModal
          projectId={currentProjectId}
          kind={editingEntity.kind}
          entity={editingEntity.entity}
          onClose={() => setEditingEntity(null)}
          onSaved={() => refreshEntities(currentProjectId)}
        />
      )}

      {terminalToggle}
    </div>
  );
}

// Floating toggle + docked panel for the embedded terminal (see Terminal.jsx). The
// underlying shell session lives server-side per project — closing this panel just
// detaches the viewer (Generate can still write into it); reopening reattaches to the
// same running session. `key={projectId}` forces a fresh viewer connection when you
// switch projects, so it attaches to that project's session instead of the old one.
function TerminalOverlay({ show, projectId, onToggle, leftInset = 0, rightInset = 0 }) {
  return (
    <>
      <button className="terminal-toggle" style={{ right: rightInset + 12 }} onClick={onToggle}>
        {show ? "▼ Terminal" : "▲ Terminal"}
      </button>
      {show && (
        <div className="terminal-panel" style={{ left: leftInset, right: rightInset }}>
          <Terminal key={projectId} projectId={projectId} />
        </div>
      )}
    </>
  );
}

function ProjectLanding({ projects, onOpen, onCreate }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreate(name.trim());
    } finally {
      setBusy(false);
    }
  };

  if (projects === null) {
    return <div className="landing" />; // still loading
  }

  return (
    <div className="landing">
      <h1>Ibraheem Manga Studio</h1>
      <div className="project-grid">
        {projects.map((p) => (
          <button className="project-card" key={p.id} onClick={() => onOpen(p.id)}>
            {p.name}
          </button>
        ))}
        <button className="project-card project-card-new" onClick={() => setShowForm(true)}>
          +
        </button>
      </div>
      {projects.length === 0 && !showForm && (
        <p className="empty-hint">No projects yet — click + to create your first one.</p>
      )}
      {showForm && (
        <form className="new-project-form" onSubmit={submit}>
          <input
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </form>
      )}
    </div>
  );
}

// Simple key/value editor for arbitrary structured details (gender, hairColor, texture, ...)
function FieldsEditor({ fields, onChange }) {
  const rows = Object.entries(fields);

  const setRow = (index, key, value) => {
    const next = [...rows];
    next[index] = [key, value];
    onChange(Object.fromEntries(next));
  };
  const addRow = () => onChange(Object.fromEntries([...rows, ["", ""]]));
  const removeRow = (index) => onChange(Object.fromEntries(rows.filter((_, i) => i !== index)));

  return (
    <div className="fields-editor">
      {rows.map(([key, value], i) => (
        <div className="field-row" key={i}>
          <input placeholder="field (e.g. gender)" value={key} onChange={(e) => setRow(i, e.target.value, value)} />
          <input placeholder="value" value={value} onChange={(e) => setRow(i, key, e.target.value)} />
          <button type="button" className="delete" onClick={() => removeRow(i)}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="add-field" onClick={addRow}>
        + Field
      </button>
    </div>
  );
}

// The character/place/object creator: fill in info, pick a style, then either upload a
// picture or click Generate to bridge everything to Codex. Redraw just re-runs
// generate against the same entity, replacing its image.
function EntityCreatorModal({ projectId, kind, entity: initialEntity, onClose, onSaved }) {
  const singular = ENTITY_KINDS.find((k) => k.value === kind).singular;
  const [entity, setEntity] = useState(initialEntity);
  const [name, setName] = useState(initialEntity?.name || "");
  const [style, setStyle] = useState(initialEntity?.style || "manga_bw");
  const [fields, setFields] = useState(
    Object.fromEntries(Object.entries(initialEntity?.fields || {}).filter(([k]) => k !== "description"))
  );
  const [description, setDescription] = useState(initialEntity?.fields?.description || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const allFields = { ...fields, description };

  const saveDetails = async () => {
    setBusy(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("name", name.trim());
      formData.append("style", style);
      formData.append("fields", JSON.stringify(allFields));
      if (entity) {
        const updated = await api.updateEntity(projectId, kind, entity.id, formData);
        setEntity(updated);
      } else {
        const created = await api.createEntity(projectId, kind, formData);
        setEntity(created);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (!entity) {
      setError("Save the details first, then generate.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await api.generateEntity(projectId, kind, entity.id);
      setEntity(updated);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (file) => {
    if (!entity) {
      setError("Save the details first, then upload a picture.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("image", file);
      const updated = await api.updateEntity(projectId, kind, entity.id, formData);
      setEntity(updated);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!entity) return onClose();
    await api.deleteEntity(projectId, kind, entity.id);
    onSaved();
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal entity-modal">
        <div className="panel-editor-header">
          <h2>{entity ? entity.name : `New ${singular}`}</h2>
          <button onClick={onClose}>Close</button>
        </div>

        <section>
          <h4>Picture</h4>
          {entity?.imageUrl ? (
            <img className="entity-preview" src={entity.imageUrl} alt={entity.name} />
          ) : (
            <div className="entity-preview entity-preview-empty">No image yet</div>
          )}
          <input type="file" accept="image/*" onChange={(e) => e.target.files[0] && uploadImage(e.target.files[0])} />
        </section>

        <section>
          <h4>Name</h4>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        </section>

        <section>
          <h4>Description</h4>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </section>

        <section>
          <h4>Details</h4>
          <FieldsEditor fields={fields} onChange={setFields} />
        </section>

        <section>
          <h4>Style</h4>
          <select value={style} onChange={(e) => setStyle(e.target.value)}>
            {STYLE_PRESETS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </section>

        {error && <p className="error">{error}</p>}

        <button className="primary" onClick={saveDetails} disabled={busy || !name.trim()}>
          {busy ? "Saving…" : entity ? "Save changes" : "Create"}
        </button>

        <button className="primary" onClick={generate} disabled={busy || !entity}>
          {busy ? "Generating…" : entity?.imageUrl ? "Redraw" : "Generate"}
        </button>

        {entity && (
          <button className="delete-entity" onClick={remove}>
            Delete {singular}
          </button>
        )}
      </div>
    </div>
  );
}

function PageBar({ pages, currentPage, onOpen, onCreate, onChangeLayout, onDelete }) {
  const [showForm, setShowForm] = useState(false);
  const [showLayoutPicker, setShowLayoutPicker] = useState(false);
  const [title, setTitle] = useState("");
  const [layout, setLayout] = useState("grid-2x2");
  const [stylePreset, setStylePreset] = useState("manga_bw");

  const submit = async (e) => {
    e.preventDefault();
    await onCreate({ title, layout, stylePreset });
    setTitle("");
    setShowForm(false);
  };

  const pickLayout = (value) => {
    onChangeLayout(value);
    setShowLayoutPicker(false);
  };

  return (
    <div className="page-bar">
      <select value={currentPage?.id || ""} onChange={(e) => onOpen(e.target.value)}>
        <option value="" disabled>
          Select a page…
        </option>
        {pages.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
      <button onClick={() => setShowForm((v) => !v)}>+ New page</button>
      {currentPage && (
        <>
          <button onClick={() => setShowLayoutPicker((v) => !v)}>Change layout</button>
          <button className="delete-page" onClick={() => onDelete(currentPage.id)}>
            Delete page
          </button>
        </>
      )}

      {showForm && (
        <form className="new-page-form" onSubmit={submit}>
          <input placeholder="Page title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <LayoutPicker value={layout} onChange={setLayout} />
          <select value={stylePreset} onChange={(e) => setStylePreset(e.target.value)}>
            {STYLE_PRESETS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button type="submit">Create</button>
        </form>
      )}

      {showLayoutPicker && currentPage && (
        <div className="layout-picker-popover">
          <LayoutPicker value={currentPage.layout} onChange={pickLayout} />
        </div>
      )}
    </div>
  );
}

// Visual grid of layout thumbnails — each one renders a small live replica of the
// actual panel arrangement (same grid template as the real page), so you can see the
// shape directly instead of guessing from a text label.
function LayoutPicker({ value, onChange }) {
  return (
    <div className="layout-picker">
      {LAYOUTS.map((l) => (
        <button
          key={l.value}
          type="button"
          className={`layout-option ${l.value === value ? "selected" : ""}`}
          onClick={() => onChange(l.value)}
          title={l.label}
        >
          <div
            className="layout-preview"
            style={{ gridTemplateAreas: l.areas, gridTemplateColumns: l.columns, gridTemplateRows: l.rows }}
          >
            {Array.from({ length: l.panelCount }, (_, i) => (
              <div key={i} className="layout-preview-panel" style={{ gridArea: `p${i + 1}` }} />
            ))}
          </div>
          <span className="layout-option-label">{l.panelCount}p</span>
        </button>
      ))}
    </div>
  );
}

function PageCanvas({ page, selectedPanelId, onSelect, onDragImage, onDragImageEnd }) {
  const template = LAYOUTS.find((l) => l.value === page.layout) || LAYOUTS.find((l) => l.value === "grid-2x2");

  return (
    <div
      className="page-canvas"
      style={{
        gridTemplateAreas: template.areas,
        gridTemplateColumns: template.columns,
        gridTemplateRows: template.rows,
      }}
    >
      {page.panels.map((panel, i) => (
        <PanelThumb
          key={panel.id}
          panel={panel}
          selected={panel.id === selectedPanelId}
          gridArea={`p${i + 1}`}
          onSelect={onSelect}
          onDragImage={onDragImage}
          onDragImageEnd={onDragImageEnd}
        />
      ))}
    </div>
  );
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// A panel's generated image is rendered with object-fit: cover, so a wider-than-tall
// (or taller-than-wide) image gets cropped to fill the frame. Holding and dragging the
// image pans that crop by adjusting object-position — this tracks the drag in pixels,
// converts it to a percentage of how far the rendered image overflows the frame in each
// axis, and only treats it as a "select this panel" click if the pointer never moved.
function PanelThumb({ panel, selected, gridArea, onSelect, onDragImage, onDragImageEnd }) {
  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const dragRef = useRef(null);

  const offset = panel.imageOffset || { x: 50, y: 50 };

  const onPointerDown = (e) => {
    if (!panel.imageAssetId || e.button !== 0) return;
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || !img.naturalWidth) return;
    e.preventDefault();

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const naturalRatio = img.naturalWidth / img.naturalHeight;
    const containerRatio = cw / ch;
    const renderedW = naturalRatio > containerRatio ? ch * naturalRatio : cw;
    const renderedH = naturalRatio > containerRatio ? ch : cw / naturalRatio;

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOffset: offset,
      overflowX: Math.max(0, renderedW - cw),
      overflowY: Math.max(0, renderedH - ch),
      moved: false,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    d.moved = true;

    const nx = d.overflowX > 0 ? clamp(d.startOffset.x - (dx / d.overflowX) * 100, 0, 100) : 50;
    const ny = d.overflowY > 0 ? clamp(d.startOffset.y - (dy / d.overflowY) * 100, 0, 100) : 50;
    d.lastOffset = { x: nx, y: ny };
    onDragImage(panel.id, d.lastOffset);
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    dragRef.current = null;
    if (!d) return;
    if (d.moved) onDragImageEnd(panel.id, d.lastOffset);
    else onSelect(panel.id);
  };

  return (
    <div
      ref={containerRef}
      className={`panel-slot ${selected ? "selected" : ""} ${panel.imageAssetId ? "has-image" : ""}`}
      style={{ gridArea }}
      onPointerDown={onPointerDown}
    >
      {panel.imageAssetId ? (
        <img
          ref={imgRef}
          src={`/uploads/${panel.imageAssetId}.png`}
          alt=""
          draggable={false}
          style={{ objectPosition: `${offset.x}% ${offset.y}%` }}
        />
      ) : (
        <span className="placeholder" onClick={() => onSelect(panel.id)}>
          Click to set up panel {panel.order + 1}
        </span>
      )}
    </div>
  );
}

function PanelEditor({ projectId, page, panel, characters, places, objects, allPanels, onClose, onUpdated, onDelete }) {
  const [sceneDoc, setSceneDoc] = useState(panel.sceneDoc);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      await api.generatePanel(projectId, page.id, panel.id, { sceneDoc });
      await onUpdated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-editor">
      <div className="panel-editor-header">
        <h3>Panel {panel.order + 1}</h3>
        <div className="panel-editor-header-actions">
          <button className="delete-panel" onClick={() => onDelete(panel.id)}>
            Delete panel
          </button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>

      <section className="scene-editor-section">
        <h4>Scene description</h4>
        <p className="scene-editor-hint">
          Type <strong>#</strong> to pull in a character, place, or object — it'll appear here
          highlighted, and its reference image will be used when generating this panel. Type{" "}
          <strong>@</strong> to mention any panel from any page (e.g. "@Page 1 · Panel 2") to keep
          its room, decor, and props consistent here.
        </p>
        <SceneEditor
          content={sceneDoc}
          onChange={setSceneDoc}
          characters={characters}
          places={places}
          objects={objects}
          panels={allPanels.filter((p) => p.id !== panel.id)}
        />
        {characters.length === 0 && places.length === 0 && objects.length === 0 && (
          <p className="empty-hint">Add characters, places, or objects in the sidebar first.</p>
        )}
      </section>

      {error && <p className="error">{error}</p>}

      <button className="primary" onClick={generate} disabled={busy}>
        {busy ? "Generating…" : panel.imageAssetId ? "Regenerate panel" : "Generate panel"}
      </button>
    </div>
  );
}
