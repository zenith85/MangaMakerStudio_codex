import { useCallback, useEffect, useRef, useState } from "react";
import { siteApi } from "./siteApi";
import { useTheme, ThemeToggle, useAgentStatus, DownloadPrompt } from "./Shared";
import {
  ROW_LAYOUTS,
  ELEMENT_TYPES,
  SITE_FONTS,
  BOOK_CODE_RE,
  BOX_DEFAULTS,
  newRow,
  newElement,
  newGalleryItem,
  relayoutRow,
  cloneWithNewIds,
  renderElement,
  renderSiteHtml,
  siteCss,
  rowClass,
  rowStyle,
  colsStyle,
  colStyle,
} from "./siteRender";
import { SITE_TEMPLATES } from "./siteTemplates";
import { LangProvider, LangToggle, useT } from "./siteI18n";
import "./site-app.css";

// Site Builder — a third studio: build a single web page by dragging rows (column
// layouts) and elements (heading, text, image, button, book shelf, ...) onto a canvas,
// tune each one in the inspector on the right, then export one self-contained HTML
// file (images embedded) — the same shape as the PageBox collection pages it's modeled
// on. All rendering lives in siteRender.js, shared by the canvas and the export.

// The interface language (English / 한국어, see siteI18n.jsx) is chosen per browser and
// covers this whole studio, so the provider sits at its root.
export default function SiteApp(props) {
  return (
    <LangProvider>
      <SiteAppInner {...props} />
    </LangProvider>
  );
}

function SiteAppInner({ onBackToStudios }) {
  const t = useT();
  const [theme, toggleTheme] = useTheme();
  const { agentStatus, recheckAgent } = useAgentStatus();
  const [sites, setSites] = useState(null); // null = not loaded yet
  const [current, setCurrent] = useState(null); // { id, name }

  const refreshSites = useCallback(() => siteApi.listProjects().then(setSites), []);
  useEffect(() => {
    if (agentStatus === "online") refreshSites();
  }, [agentStatus, refreshSites]);

  const createSite = async (name, templateId) => {
    const template = SITE_TEMPLATES.find((tpl) => tpl.id === templateId) || SITE_TEMPLATES[0];
    const project = await siteApi.createProject(name, template.build(name));
    await refreshSites();
    setCurrent({ id: project.id, name: project.name });
  };

  const deleteSite = async (id, name) => {
    if (!window.confirm(t('Delete "{name}" and everything in it? This can\'t be undone.', { name }))) return;
    await siteApi.deleteProject(id);
    await refreshSites();
  };

  if (agentStatus === "checking") return <div className="agent-checking">{t("Checking for local agent…")}</div>;
  if (agentStatus === "offline") return <DownloadPrompt onRetry={recheckAgent} />;

  if (!current) {
    return (
      <SiteLanding
        sites={sites}
        onOpen={(s) => setCurrent({ id: s.id, name: s.name })}
        onCreate={createSite}
        onDelete={deleteSite}
        theme={theme}
        onToggleTheme={toggleTheme}
        onBackToStudios={onBackToStudios}
      />
    );
  }

  return (
    <SiteEditor
      key={current.id}
      projectId={current.id}
      projectName={current.name}
      theme={theme}
      onToggleTheme={toggleTheme}
      onExit={() => {
        setCurrent(null);
        refreshSites();
      }}
    />
  );
}

function SiteLanding({ sites, onOpen, onCreate, onDelete, theme, onToggleTheme, onBackToStudios }) {
  const t = useT();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("collection");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onCreate(name.trim(), templateId);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (sites === null) return <div className="landing" />; // still loading

  return (
    <div className="landing">
      <div className="landing-header">
        <div className="site-landing-title">
          <button className="back-link" onClick={onBackToStudios}>
            {t("← Studios")}
          </button>
          <h1>{t("Site Builder")}</h1>
        </div>
        <span className="site-landing-controls">
          <LangToggle />
          <ThemeToggle theme={theme} onToggle={onToggleTheme} titles={{ toLight: t("Switch to light mode"), toDark: t("Switch to dark mode") }} />
        </span>
      </div>
      <div className="project-grid">
        {sites.map((s) => (
          <div className="project-card-wrap" key={s.id}>
            <button className="project-card" onClick={() => onOpen(s)}>
              {s.name}
            </button>
            <button
              className="project-card-delete"
              title={t("Delete {name}", { name: s.name })}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(s.id, s.name);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button className="project-card project-card-new" onClick={() => setShowForm(true)}>
          +
        </button>
      </div>
      {sites.length === 0 && !showForm && <p className="empty-hint">{t("No sites yet — click + to start one.")}</p>}
      {showForm && (
        <form className="site-new-form" onSubmit={submit}>
          <input placeholder={t("Site name")} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <div className="site-template-grid">
            {SITE_TEMPLATES.map((tpl) => (
              <button
                type="button"
                key={tpl.id}
                className={`site-template-card${templateId === tpl.id ? " active" : ""}`}
                onClick={() => setTemplateId(tpl.id)}
              >
                <strong>{t(tpl.label)}</strong>
                <span>{t(tpl.desc)}</span>
              </button>
            ))}
          </div>
          <button type="submit" className="primary" disabled={busy || !name.trim()}>
            {busy ? t("Creating…") : t("Create")}
          </button>
          {error && <p className="empty-hint site-error">{error}</p>}
        </form>
      )}
    </div>
  );
}

// ---------- Site tree helpers (all operate on a structuredClone'd draft) ----------

function locateElement(site, id) {
  for (const row of site.rows) {
    for (const col of row.columns) {
      const index = col.elements.findIndex((e) => e.id === id);
      if (index !== -1) return { row, col, index, el: col.elements[index] };
    }
  }
  return null;
}

function locateColumn(site, colId) {
  for (const row of site.rows) {
    const col = row.columns.find((c) => c.id === colId);
    if (col) return { row, col };
  }
  return null;
}

// Every image URL the site references — what Export has to fetch and embed.
function collectAssetUrls(site) {
  const urls = new Set();
  site.rows.forEach((row) =>
    row.columns.forEach((col) =>
      col.elements.forEach((el) => {
        if (el.type === "image" && el.src) urls.add(el.src);
        if (el.type === "gallery") el.items.forEach((item) => item.src && urls.add(item.src));
      })
    )
  );
  return [...urls];
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Where in `container`'s matching children a drop at clientY lands: before the first
// child whose vertical midpoint is below the pointer, else at the end.
function dropIndex(container, selector, clientY) {
  const children = [...container.querySelectorAll(selector)];
  for (let i = 0; i < children.length; i++) {
    const r = children[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return i;
  }
  return children.length;
}

const isImageFile = (f) => f.type.startsWith("image/");
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
const typeLabel = (type) => ELEMENT_TYPES.find((t) => t.type === type)?.label || type;

const PHONE_WIDTH = 390;
const SAVE_DEBOUNCE_MS = 500;
const COALESCE_MS = 1000;

function SiteEditor({ projectId, projectName, theme, onToggleTheme, onExit }) {
  const t = useT();
  const [site, setSiteState] = useState(null);
  const siteRef = useRef(null);
  // Undo/redo stacks of whole-site snapshots. Typing into one inspector field commits
  // on every keystroke; those are coalesced into one undo step per field (see commit).
  const historyRef = useRef({ past: [], future: [], lastKey: null, lastAt: 0 });
  const [, setHistoryTick] = useState(0); // re-render so Undo/Redo enable state updates
  const [selection, setSelection] = useState(null); // { kind: "element" | "row", id } | null
  const [device, setDevice] = useState("desktop");
  const [saveState, setSaveState] = useState("saved"); // "saved" | "saving" | "error"
  const [dropTarget, setDropTarget] = useState(null); // { kind: "col", colId, index } | { kind: "row", index } | { kind: "el", id }
  const [showPreview, setShowPreview] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [error, setError] = useState("");
  const dragRef = useRef(null); // payload of the drag in progress, if it started inside the builder
  const saveTimerRef = useRef(null);

  useEffect(() => {
    siteApi
      .getSite(projectId)
      .then((s) => {
        siteRef.current = s;
        setSiteState(s);
      })
      .catch((err) => setError(err.message));
  }, [projectId]);

  const save = useCallback(async () => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    setSaveState("saving");
    try {
      await siteApi.saveSite(projectId, siteRef.current);
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      setError(t("Couldn't save: {message}", { message: err.message }));
    }
  }, [projectId]);

  const scheduleSave = useCallback(() => {
    setSaveState("saving");
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(save, SAVE_DEBOUNCE_MS);
  }, [save]);

  const replaceSite = useCallback(
    (next) => {
      siteRef.current = next;
      setSiteState(next);
      scheduleSave();
    },
    [scheduleSave]
  );

  // The one way the site changes: `mutator` edits a deep copy in place. Reads the
  // latest site from siteRef (not a state updater) so the history push happens exactly
  // once, even under StrictMode's double-invoked updaters.
  const commit = useCallback(
    (mutator, coalesceKey) => {
      const prev = siteRef.current;
      if (!prev) return;
      const next = structuredClone(prev);
      mutator(next);
      const h = historyRef.current;
      const now = Date.now();
      if (!(coalesceKey && h.lastKey === coalesceKey && now - h.lastAt < COALESCE_MS)) {
        h.past.push(prev);
        if (h.past.length > 100) h.past.shift();
      }
      h.lastKey = coalesceKey || null;
      h.lastAt = now;
      h.future = [];
      setHistoryTick((t) => t + 1);
      replaceSite(next);
    },
    [replaceSite]
  );

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (!h.past.length) return;
    h.future.push(siteRef.current);
    h.lastKey = null;
    setHistoryTick((t) => t + 1);
    replaceSite(h.past.pop());
  }, [replaceSite]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (!h.future.length) return;
    h.past.push(siteRef.current);
    h.lastKey = null;
    setHistoryTick((t) => t + 1);
    replaceSite(h.future.pop());
  }, [replaceSite]);

  const exit = async () => {
    if (saveTimerRef.current) await save();
    onExit();
  };

  // ---------- Uploads ----------

  const uploadFiles = async (files) => {
    const images = [...files].filter(isImageFile);
    if (!images.length) return [];
    setError("");
    try {
      const results = await Promise.all(images.map((f) => siteApi.uploadAsset(projectId, f)));
      return results.map((r) => r.url);
    } catch (err) {
      setError(t("Upload failed: {message}", { message: err.message }));
      return [];
    }
  };

  // ---------- Structural edits ----------

  const insertElementsAt = (els, colId, index) => {
    commit((s) => {
      const loc = locateColumn(s, colId);
      if (loc) loc.col.elements.splice(index, 0, ...els);
    });
    if (els.length) setSelection({ kind: "element", id: els[els.length - 1].id });
  };

  const insertRowAt = (row, index) => {
    commit((s) => s.rows.splice(index, 0, row));
  };

  const moveElement = (id, colId, index) => {
    commit((s) => {
      const src = locateElement(s, id);
      const dest = locateColumn(s, colId);
      if (!src || !dest) return;
      let at = index;
      if (src.col.id === colId && src.index < index) at -= 1;
      src.col.elements.splice(src.index, 1);
      dest.col.elements.splice(at, 0, src.el);
    });
  };

  const moveElementToNewRow = (id, rowIndex) => {
    const row = newRow("1");
    commit((s) => {
      const src = locateElement(s, id);
      if (!src) return;
      src.col.elements.splice(src.index, 1);
      row.columns[0].elements.push(src.el);
      s.rows.splice(rowIndex, 0, row);
    });
  };

  const moveRow = (id, index) => {
    commit((s) => {
      const from = s.rows.findIndex((r) => r.id === id);
      if (from === -1) return;
      const [row] = s.rows.splice(from, 1);
      s.rows.splice(from < index ? index - 1 : index, 0, row);
    });
  };

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    commit((s) => {
      if (selection.kind === "row") s.rows = s.rows.filter((r) => r.id !== selection.id);
      else {
        const loc = locateElement(s, selection.id);
        if (loc) loc.col.elements.splice(loc.index, 1);
      }
    });
    setSelection(null);
  }, [selection, commit]);

  const duplicateSelection = useCallback(() => {
    if (!selection) return;
    let newId = null;
    commit((s) => {
      if (selection.kind === "row") {
        const i = s.rows.findIndex((r) => r.id === selection.id);
        if (i === -1) return;
        const copy = cloneWithNewIds(s.rows[i]);
        newId = copy.id;
        s.rows.splice(i + 1, 0, copy);
      } else {
        const loc = locateElement(s, selection.id);
        if (!loc) return;
        const copy = cloneWithNewIds(loc.el);
        newId = copy.id;
        loc.col.elements.splice(loc.index + 1, 0, copy);
      }
    });
    if (newId) setSelection({ kind: selection.kind, id: newId });
  }, [selection, commit]);

  // Clicking a palette tile (instead of dragging it) adds next to whatever's selected:
  // right after a selected element, into a selected row's first column, or as a new row
  // at the bottom of the page.
  const addElementByClick = (type) => {
    const el = newElement(type);
    const s = siteRef.current;
    if (selection?.kind === "element") {
      const loc = locateElement(s, selection.id);
      if (loc) return insertElementsAt([el], loc.col.id, loc.index + 1);
    }
    if (selection?.kind === "row") {
      const row = s.rows.find((r) => r.id === selection.id);
      if (row) return insertElementsAt([el], row.columns[0].id, row.columns[0].elements.length);
    }
    const row = newRow("1");
    row.columns[0].elements.push(el);
    insertRowAt(row, s.rows.length);
    setSelection({ kind: "element", id: el.id });
  };

  const addRowByClick = (layout) => {
    const row = newRow(layout);
    const s = siteRef.current;
    const i = selection?.kind === "row" ? s.rows.findIndex((r) => r.id === selection.id) : -1;
    insertRowAt(row, i === -1 ? s.rows.length : i + 1);
    setSelection({ kind: "row", id: row.id });
  };

  // ---------- Drag and drop ----------

  const startDrag = (e, payload) => {
    dragRef.current = payload;
    e.dataTransfer.effectAllowed = "copyMove";
    e.dataTransfer.setData("text/plain", payload.kind); // Firefox won't start a drag without data
  };
  const endDrag = () => {
    dragRef.current = null;
    setDropTarget(null);
  };
  const setDropTargetIfChanged = (t) =>
    setDropTarget((prev) =>
      prev && prev.kind === t.kind && prev.colId === t.colId && prev.index === t.index && prev.id === t.id ? prev : t
    );

  const isElementDrag = (e) => {
    const p = dragRef.current;
    return hasFiles(e) || p?.kind === "new-element" || p?.kind === "move-element";
  };

  const onColumnDragOver = (e, colId) => {
    if (!isElementDrag(e)) return; // rows fall through to the page-level handler
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = dragRef.current?.kind === "move-element" ? "move" : "copy";
    setDropTargetIfChanged({ kind: "col", colId, index: dropIndex(e.currentTarget, ":scope > [data-el-id]", e.clientY) });
  };

  const onColumnDrop = async (e, colId) => {
    if (!isElementDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const index = dropIndex(e.currentTarget, ":scope > [data-el-id]", e.clientY);
    const p = dragRef.current;
    const files = hasFiles(e) ? [...e.dataTransfer.files] : [];
    endDrag();
    if (p?.kind === "new-element") insertElementsAt([newElement(p.type)], colId, index);
    else if (p?.kind === "move-element") moveElement(p.id, colId, index);
    else if (files.length) {
      const urls = await uploadFiles(files);
      insertElementsAt(urls.map((src) => ({ ...newElement("image"), src })), colId, index);
    }
  };

  const onPageDragOver = (e) => {
    if (!dragRef.current && !hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = dragRef.current?.kind?.startsWith("move") ? "move" : "copy";
    setDropTargetIfChanged({ kind: "row", index: dropIndex(e.currentTarget, ":scope > [data-row-id]", e.clientY) });
  };

  // Dropping between rows (rather than into a column): a row lands there; an element
  // or image file gets wrapped in a new one-column row there.
  const onPageDrop = async (e) => {
    if (!dragRef.current && !hasFiles(e)) return;
    e.preventDefault();
    const index = dropIndex(e.currentTarget, ":scope > [data-row-id]", e.clientY);
    const p = dragRef.current;
    const files = hasFiles(e) ? [...e.dataTransfer.files] : [];
    endDrag();
    if (p?.kind === "new-row") {
      const row = newRow(p.layout);
      insertRowAt(row, index);
      setSelection({ kind: "row", id: row.id });
    } else if (p?.kind === "move-row") moveRow(p.id, index);
    else if (p?.kind === "move-element") moveElementToNewRow(p.id, index);
    else if (p?.kind === "new-element" || files.length) {
      const els =
        p?.kind === "new-element"
          ? [newElement(p.type)]
          : (await uploadFiles(files)).map((src) => ({ ...newElement("image"), src }));
      if (!els.length) return;
      const row = newRow("1");
      row.columns[0].elements.push(...els);
      insertRowAt(row, index);
      setSelection({ kind: "element", id: els[els.length - 1].id });
    }
  };

  // An image file dropped straight onto an image element replaces that image.
  const onElementDragOver = (e, el) => {
    if (el.type !== "image" || !hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTargetIfChanged({ kind: "el", id: el.id });
  };
  const onElementDrop = async (e, el) => {
    if (el.type !== "image" || !hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const files = [...e.dataTransfer.files];
    endDrag();
    const [src] = await uploadFiles(files.slice(0, 1));
    if (src) commit((s) => Object.assign(locateElement(s, el.id)?.el || {}, { src }));
    setSelection({ kind: "element", id: el.id });
  };

  // ---------- Keyboard ----------

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "d" && !typing && selection) {
        e.preventDefault();
        duplicateSelection();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !typing && selection) {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === "Escape" && !typing) {
        setSelection(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selection, duplicateSelection, deleteSelection]);

  // ---------- Export ----------

  const exportHtml = async () => {
    setExportBusy(true);
    setError("");
    try {
      if (saveTimerRef.current) await save();
      const urls = collectAssetUrls(siteRef.current);
      const dataUris = {};
      await Promise.all(
        urls.map(async (url) => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`couldn't load ${url}`);
          dataUris[url] = await blobToDataUrl(await res.blob());
        })
      );
      const html = renderSiteHtml(siteRef.current, { assetSrc: (u) => dataUris[u] || u });
      const filename = `${(siteRef.current.settings.title || projectName).replace(/[\\/:*?"<>|]+/g, "").trim() || "site"}.html`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) {
      setError(t("Export failed: {message}", { message: err.message }));
    } finally {
      setExportBusy(false);
    }
  };

  if (!site) {
    return <div className="agent-checking">{error || t("Loading site…")}</div>;
  }

  const h = historyRef.current;
  const editorCtx = { assetSrc: (u) => u, editor: true, t };

  return (
    <div className="site-editor">
      <header className="site-topbar">
        <button className="back-link" onClick={exit}>
          {t("← Sites")}
        </button>
        <span className="app-name site-topbar-name">{projectName}</span>
        <div className="site-topbar-group">
          <button onClick={undo} disabled={!h.past.length} title={t("Undo (Ctrl+Z)")}>
            {t("↶ Undo")}
          </button>
          <button onClick={redo} disabled={!h.future.length} title={t("Redo (Ctrl+Shift+Z)")}>
            {t("↷ Redo")}
          </button>
        </div>
        <div className="site-topbar-group site-device-toggle">
          <button className={device === "desktop" ? "active" : ""} onClick={() => setDevice("desktop")}>
            {t("🖥 Desktop")}
          </button>
          <button className={device === "phone" ? "active" : ""} onClick={() => setDevice("phone")}>
            {t("📱 Phone")}
          </button>
        </div>
        <span className={`site-save-state ${saveState}`}>
          {saveState === "saving" ? t("Saving…") : saveState === "error" ? t("Not saved") : t("Saved")}
        </span>
        <div className="site-topbar-group site-topbar-right">
          <button onClick={() => siteApi.openProjectFolder(projectId).catch((err) => setError(err.message))}>
            {t("Open folder")}
          </button>
          <button onClick={() => setShowPreview(true)}>{t("Preview")}</button>
          <button className="primary" onClick={exportHtml} disabled={exportBusy}>
            {exportBusy ? t("Exporting…") : t("Export HTML")}
          </button>
          <LangToggle />
          <ThemeToggle theme={theme} onToggle={onToggleTheme} titles={{ toLight: t("Switch to light mode"), toDark: t("Switch to dark mode") }} />
        </div>
      </header>

      <aside className="site-palette">
        <h4>{t("Rows")}</h4>
        <p className="site-hint">{t("Drag onto the page, or click to add.")}</p>
        <div className="site-layout-grid">
          {ROW_LAYOUTS.map((layout) => (
            <button
              key={layout}
              className="site-layout-tile"
              draggable
              onDragStart={(e) => startDrag(e, { kind: "new-row", layout })}
              onDragEnd={endDrag}
              onClick={() => addRowByClick(layout)}
              title={t("{n}-column row ({ratio})", { n: layout.split("-").length, ratio: layout.replace(/-/g, " : ") })}
            >
              {layout.split("-").map((n, i) => (
                <span key={i} style={{ flex: Number(n) }} />
              ))}
            </button>
          ))}
        </div>
        <h4>{t("Elements")}</h4>
        <p className="site-hint">{t("Drag into a column. Drop image files from your computer straight onto the page too.")}</p>
        <div className="site-element-grid">
          {ELEMENT_TYPES.map((et) => (
            <button
              key={et.type}
              className="site-element-tile"
              draggable
              onDragStart={(e) => startDrag(e, { kind: "new-element", type: et.type })}
              onDragEnd={endDrag}
              onClick={() => addElementByClick(et.type)}
            >
              <span className="site-element-icon">{et.icon}</span>
              {t(et.label)}
            </button>
          ))}
        </div>
        <p className="site-hint site-shortcuts">
          <strong>Del</strong> {t("delete")} · <strong>Ctrl+D</strong> {t("duplicate")} · <strong>Ctrl+Z</strong>{" "}
          {t("undo")} · <strong>Esc</strong> {t("page settings")}
        </p>
      </aside>

      <main
        className="site-canvas-scroll"
        onClick={() => setSelection(null)}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget(null);
        }}
      >
        <style>{siteCss(site.settings, { editor: true })}</style>
        <div className={`sb-canvas-root${device === "phone" ? " sb-mobile" : ""}`}>
          <div
            className={`sb-page sbe-page${site.rows.length === 0 ? " sbe-page-empty" : ""}${
              dropTarget?.kind === "row" && site.rows.length === 0 ? " sbe-page-drop" : ""
            }`}
            style={device === "phone" ? { maxWidth: PHONE_WIDTH } : undefined}
            onDragOver={onPageDragOver}
            onDrop={onPageDrop}
          >
            {site.rows.length === 0 && (
              <div className="sbe sbe-page-placeholder">{t("Drag a row layout or an element here to start.")}</div>
            )}
            {site.rows.map((row, rowIndex) => {
              const rowSelected = selection?.kind === "row" && selection.id === row.id;
              const rowDrop =
                dropTarget?.kind === "row"
                  ? dropTarget.index === rowIndex
                    ? " sbe-drop-before"
                    : dropTarget.index === site.rows.length && rowIndex === site.rows.length - 1
                    ? " sbe-drop-after"
                    : ""
                  : "";
              return (
                <section
                  key={row.id}
                  data-row-id={row.id}
                  className={`${rowClass(row)} sbe-row${rowSelected ? " is-selected" : ""}${rowDrop}`}
                  style={rowStyle(row)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelection({ kind: "row", id: row.id });
                  }}
                >
                  <RowToolbar
                    row={row}
                    index={rowIndex}
                    count={site.rows.length}
                    onDragStart={(e) => startDrag(e, { kind: "move-row", id: row.id })}
                    onDragEnd={endDrag}
                    onLayout={(layout) =>
                      commit((s) => {
                        const i = s.rows.findIndex((r) => r.id === row.id);
                        s.rows[i] = relayoutRow(s.rows[i], layout);
                      })
                    }
                    onMove={(dir) => moveRow(row.id, dir < 0 ? rowIndex - 1 : rowIndex + 2)}
                    onDuplicate={() => {
                      const copy = cloneWithNewIds(row);
                      commit((s) => s.rows.splice(rowIndex + 1, 0, copy));
                      setSelection({ kind: "row", id: copy.id });
                    }}
                    onDelete={() => {
                      commit((s) => (s.rows = s.rows.filter((r) => r.id !== row.id)));
                      setSelection(null);
                    }}
                  />
                  <div className="sb-cols" style={colsStyle(row)}>
                    {row.columns.map((col) => {
                      const colDrop = dropTarget?.kind === "col" && dropTarget.colId === col.id ? dropTarget.index : -1;
                      return (
                        <div
                          key={col.id}
                          className={`sb-col sbe-col${colDrop !== -1 && col.elements.length === 0 ? " sbe-col-drop" : ""}`}
                          style={colStyle(row)}
                          onDragOver={(e) => onColumnDragOver(e, col.id)}
                          onDrop={(e) => onColumnDrop(e, col.id)}
                        >
                          {col.elements.map((el, i) => (
                            <ElementBlock
                              key={el.id}
                              el={el}
                              html={renderElement(el, editorCtx)}
                              selected={selection?.kind === "element" && selection.id === el.id}
                              dropClass={
                                dropTarget?.kind === "el" && dropTarget.id === el.id
                                  ? " sbe-drop-replace"
                                  : colDrop === i
                                  ? " sbe-drop-before"
                                  : colDrop === col.elements.length && i === col.elements.length - 1
                                  ? " sbe-drop-after"
                                  : ""
                              }
                              onSelect={() => setSelection({ kind: "element", id: el.id })}
                              onDragStart={(e) => {
                                e.stopPropagation();
                                startDrag(e, { kind: "move-element", id: el.id });
                              }}
                              onDragEnd={endDrag}
                              onDragOver={(e) => onElementDragOver(e, el)}
                              onDrop={(e) => onElementDrop(e, el)}
                              onDuplicate={duplicateSelection}
                              onDelete={deleteSelection}
                            />
                          ))}
                          {col.elements.length === 0 && <div className="sbe sbe-col-empty">{t("Drop elements here")}</div>}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </main>

      <aside className="site-inspector">
        {error && (
          <p className="site-error" onClick={() => setError("")} title={t("Click to dismiss")}>
            {error}
          </p>
        )}
        <Inspector site={site} selection={selection} commit={commit} uploadFiles={uploadFiles} onDeselect={() => setSelection(null)} />
      </aside>

      {showPreview && <PreviewModal site={site} onClose={() => setShowPreview(false)} />}
    </div>
  );
}

function RowToolbar({ row, index, count, onDragStart, onDragEnd, onLayout, onMove, onDuplicate, onDelete }) {
  const t = useT();
  const stop = (e) => e.stopPropagation();
  return (
    <div className="sbe sbe-row-tools" onClick={stop}>
      <span className="sbe-handle" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} title={t("Drag to move row")}>
        {t("⠿ Row")}
      </span>
      <select value={row.layout} onChange={(e) => onLayout(e.target.value)} title={t("Column layout")}>
        {ROW_LAYOUTS.map((l) => (
          <option key={l} value={l}>
            {l.split("-").length === 1 ? t("1 column") : t("{n} cols · {ratio}", { n: l.split("-").length, ratio: l.replace(/-/g, ":") })}
          </option>
        ))}
      </select>
      <button onClick={() => onMove(-1)} disabled={index === 0} title={t("Move up")}>
        ↑
      </button>
      <button onClick={() => onMove(1)} disabled={index === count - 1} title={t("Move down")}>
        ↓
      </button>
      <button onClick={onDuplicate} title={t("Duplicate row")}>
        ⧉
      </button>
      <button onClick={onDelete} title={t("Delete row")} className="sbe-danger">
        ✕
      </button>
    </div>
  );
}

function ElementBlock({ el, html, selected, dropClass, onSelect, onDragStart, onDragEnd, onDragOver, onDrop, onDuplicate, onDelete }) {
  const t = useT();
  return (
    <div
      data-el-id={el.id}
      className={`sbe-el${selected ? " is-selected" : ""}${dropClass}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onSelect();
      }}
    >
      <div className="sbe-el-body" dangerouslySetInnerHTML={{ __html: html }} />
      {selected && (
        <div className="sbe sbe-el-tools" onClick={(e) => e.stopPropagation()}>
          <span>{t(typeLabel(el.type))}</span>
          <button onClick={onDuplicate} title={t("Duplicate (Ctrl+D)")}>
            ⧉
          </button>
          <button onClick={onDelete} title={t("Delete (Del)")} className="sbe-danger">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function PreviewModal({ site, onClose }) {
  const t = useT();
  const [width, setWidth] = useState("desktop");
  const html = renderSiteHtml(site);
  return (
    <div className="site-preview-overlay" onClick={onClose}>
      <div className="site-preview" onClick={(e) => e.stopPropagation()}>
        <div className="site-preview-bar">
          <div className="site-topbar-group site-device-toggle">
            <button className={width === "desktop" ? "active" : ""} onClick={() => setWidth("desktop")}>
              {t("🖥 Desktop")}
            </button>
            <button className={width === "phone" ? "active" : ""} onClick={() => setWidth("phone")}>
              {t("📱 Phone")}
            </button>
          </div>
          <span className="site-hint">{t("Exactly what Export produces (links and book buttons are live here).")}</span>
          <button onClick={onClose}>{t("Close")}</button>
        </div>
        <iframe
          title={t("Site preview")}
          className="site-preview-frame"
          style={width === "phone" ? { width: PHONE_WIDTH } : undefined}
          srcDoc={html}
        />
      </div>
    </div>
  );
}

// ---------- Inspector ----------

function Inspector({ site, selection, commit, uploadFiles, onDeselect }) {
  if (selection?.kind === "element") {
    const loc = locateElement(site, selection.id);
    if (loc) return <ElementInspector el={loc.el} commit={commit} uploadFiles={uploadFiles} onDeselect={onDeselect} />;
  }
  if (selection?.kind === "row") {
    const row = site.rows.find((r) => r.id === selection.id);
    if (row) return <RowInspector row={row} commit={commit} onDeselect={onDeselect} />;
  }
  return <PageInspector settings={site.settings} commit={commit} />;
}

function PageInspector({ settings, commit }) {
  const t = useT();
  const set = (key) => (value) => commit((s) => (s.settings[key] = value), `page:${key}`);
  return (
    <div className="site-inspector-body">
      <h4>{t("Page settings")}</h4>
      <p className="site-hint">{t("Click any row or element on the page to edit it.")}</p>
      <Field label="Page title (browser tab)">
        <input value={settings.title} onChange={(e) => set("title")(e.target.value)} />
      </Field>
      <Field label="Language code">
        <input value={settings.lang} onChange={(e) => set("lang")(e.target.value)} placeholder={t("ko, en, ja…")} />
      </Field>
      <NumberField label="Page width (px)" value={settings.maxWidth} min={320} max={1600} step={10} onChange={set("maxWidth")} />
      <Field label="Font">
        <select value={settings.font} onChange={(e) => set("font")(e.target.value)}>
          {SITE_FONTS.map((f) => (
            <option key={f.value} value={f.value}>
              {t(f.label)}
            </option>
          ))}
        </select>
      </Field>
      <ColorField label="Background (outside the page)" value={settings.pageBg} onChange={set("pageBg")} />
      <ColorField label="Page background" value={settings.contentBg} onChange={set("contentBg")} />
      <ColorField label="Text color" value={settings.textColor} onChange={set("textColor")} />
    </div>
  );
}

function RowInspector({ row, commit, onDeselect }) {
  const t = useT();
  const set = (key) => (value) =>
    commit((s) => {
      const r = s.rows.find((x) => x.id === row.id);
      if (r) r[key] = value;
    }, `${row.id}:${key}`);
  // Same as BoxFields: choosing a border color/style on a row with no border turns it on.
  const setWithBorder = (key) => (value) =>
    commit((s) => {
      const r = s.rows.find((x) => x.id === row.id);
      if (!r) return;
      r[key] = value;
      if (!(Number(r.borderWidth) > 0)) r.borderWidth = DEFAULT_BORDER_WIDTH;
    }, `${row.id}:${key}`);
  return (
    <div className="site-inspector-body">
      <InspectorHeader title="Row" onBack={onDeselect} />
      <Field label="Columns">
        <select
          value={row.layout}
          onChange={(e) =>
            commit((s) => {
              const i = s.rows.findIndex((r) => r.id === row.id);
              s.rows[i] = relayoutRow(s.rows[i], e.target.value);
            })
          }
        >
          {ROW_LAYOUTS.map((l) => (
            <option key={l} value={l}>
              {l.split("-").length === 1
                ? t("1 column")
                : t("{n} columns · {ratio}", { n: l.split("-").length, ratio: l.replace(/-/g, " : ") })}
            </option>
          ))}
        </select>
      </Field>
      <CheckField label="Stack columns on phones" checked={row.stackOnMobile} onChange={set("stackOnMobile")} />
      <Field label="Vertical alignment" group>
        <Segmented
          value={row.valign}
          options={[
            ["start", "Top"],
            ["center", "Middle"],
            ["end", "Bottom"],
            ["stretch", "Stretch"],
          ]}
          onChange={set("valign")}
        />
      </Field>
      <ColorField label="Background" value={row.bg} onChange={set("bg")} allowEmpty />
      <div className="site-field-pair">
        <NumberField label="Padding top/bottom" value={row.paddingY} min={0} max={200} onChange={set("paddingY")} />
        <NumberField label="Padding sides" value={row.paddingX} min={0} max={200} onChange={set("paddingX")} />
      </div>
      <div className="site-field-pair">
        <NumberField label="Outer margin top/bottom" value={row.marginY} min={0} max={200} onChange={set("marginY")} />
        <NumberField label="Outer margin sides" value={row.marginX} min={0} max={200} onChange={set("marginX")} />
      </div>
      <div className="site-field-pair">
        <NumberField label="Gap between columns" value={row.gap} min={0} max={120} onChange={set("gap")} />
        <NumberField label="Gap between elements" value={row.elementGap} min={0} max={120} onChange={set("elementGap")} />
      </div>
      <div className="site-field-pair">
        <NumberField label="Border width" value={row.borderWidth} min={0} max={20} onChange={set("borderWidth")} />
        <NumberField label="Corner radius" value={row.radius} min={0} max={80} onChange={set("radius")} />
      </div>
      <Field label="Border style" group>
        <Segmented value={row.borderStyle || "solid"} options={BORDER_STYLES} onChange={setWithBorder("borderStyle")} />
      </Field>
      <ColorField label="Border color" value={row.borderColor} onChange={setWithBorder("borderColor")} />
    </div>
  );
}

function ElementInspector({ el, commit, uploadFiles, onDeselect }) {
  const update = (patch, key) => commit((s) => Object.assign(locateElement(s, el.id)?.el || {}, patch), key);
  const set = (key) => (value) => update({ [key]: value }, `${el.id}:${key}`);

  return (
    <div className="site-inspector-body">
      <InspectorHeader title={typeLabel(el.type)} onBack={onDeselect} />

      {["heading", "text", "badge", "quote", "button"].includes(el.type) && (
        <Field label="Text">
          <textarea rows={el.type === "text" ? 5 : 3} value={el.text} onChange={(e) => set("text")(e.target.value)} />
        </Field>
      )}

      {el.type === "heading" && (
        <Field label="Heading level" group>
          <Segmented
            value={Number(el.level)}
            options={[
              [1, "H1"],
              [2, "H2"],
              [3, "H3"],
              [4, "H4"],
            ]}
            onChange={set("level")}
          />
        </Field>
      )}

      {["heading", "text", "badge", "quote", "button"].includes(el.type) && (
        <NumberField label="Font size (px)" value={el.size} min={6} max={120} step={0.5} onChange={set("size")} />
      )}
      {el.type === "heading" && (
        <Field label="Weight" group>
          <Segmented
            value={Number(el.weight)}
            options={[
              [400, "Regular"],
              [700, "Bold"],
              [800, "Extra"],
              [900, "Black"],
            ]}
            onChange={set("weight")}
          />
        </Field>
      )}
      {el.type === "text" && (
        <NumberField label="Line height" value={el.lineHeight} min={1} max={3} step={0.05} onChange={set("lineHeight")} />
      )}

      {["heading", "text", "badge", "button", "image"].includes(el.type) && (
        <Field label="Alignment" group>
          <Segmented
            value={el.align}
            options={[
              ["left", "Left"],
              ["center", "Center"],
              ["right", "Right"],
            ]}
            onChange={set("align")}
          />
        </Field>
      )}

      {["heading", "text", "quote"].includes(el.type) && (
        <ColorField label="Text color" value={el.color} onChange={set("color")} allowEmpty />
      )}
      {["badge", "button"].includes(el.type) && (
        <>
          <ColorField label="Background" value={el.bg} onChange={set("bg")} />
          <ColorField label="Text color" value={el.color} onChange={set("color")} />
        </>
      )}
      {el.type === "quote" && <ColorField label="Bar color" value={el.borderColor} onChange={set("borderColor")} />}
      {el.type === "button" && (
        <>
          <NumberField label="Corner radius" value={el.radius} min={0} max={60} onChange={set("radius")} />
          <CheckField label="Full width" checked={el.fullWidth} onChange={set("fullWidth")} />
        </>
      )}

      {el.type === "image" && (
        <>
          <ImageField src={el.src} uploadFiles={uploadFiles} onChange={(src) => update({ src })} />
          <Field label="Alt text (describes the image)">
            <input value={el.alt} onChange={(e) => set("alt")(e.target.value)} />
          </Field>
          <NumberField label="Width (%)" value={el.width} min={5} max={100} onChange={set("width")} />
          <NumberField label="Corner radius" value={el.radius} min={0} max={200} onChange={set("radius")} />
        </>
      )}

      {(el.type === "button" || el.type === "image") && (
        <ActionField action={el.action} onChange={(action) => update({ action }, `${el.id}:action`)} />
      )}

      {el.type === "gallery" && <GalleryInspector el={el} update={update} set={set} uploadFiles={uploadFiles} />}

      {el.type === "spacer" && <NumberField label="Height (px)" value={el.height} min={0} max={400} onChange={set("height")} />}

      {el.type === "divider" && (
        <>
          <NumberField label="Thickness (px)" value={el.thickness} min={1} max={20} onChange={set("thickness")} />
          <ColorField label="Color" value={el.color} onChange={set("color")} />
        </>
      )}

      {el.type !== "spacer" && <BoxFields el={el} set={set} update={update} />}

      {el.type === "html" && (
        <Field label="HTML (scripts only run in Preview and the export)">
          <textarea className="site-code" rows={12} value={el.html} onChange={(e) => set("html")(e.target.value)} />
        </Field>
      )}
    </div>
  );
}

function GalleryInspector({ el, update, set, uploadFiles }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const setItem = (id, patch, key) =>
    update({ items: el.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) }, key && `${id}:${key}`);
  const moveItem = (i, dir) => {
    const items = el.items.slice();
    const [item] = items.splice(i, 1);
    items.splice(i + dir, 0, item);
    update({ items });
  };
  const addCovers = async (files) => {
    setBusy(true);
    const urls = await uploadFiles(files);
    setBusy(false);
    if (urls.length) update({ items: [...el.items, ...urls.map((src) => ({ ...newGalleryItem(), src }))] });
  };

  return (
    <>
      <div className="site-field-pair">
        <NumberField label="Columns" value={el.columns} min={1} max={8} onChange={set("columns")} />
        <NumberField label="Gap (px)" value={el.gap} min={0} max={60} onChange={set("gap")} />
      </div>
      <Field label="Cover shape" group>
        <Segmented
          value={el.ratio}
          options={[
            ["2/3", "Book"],
            ["3/4", "3:4"],
            ["1/1", "Square"],
            ["16/9", "Wide"],
          ]}
          onChange={set("ratio")}
        />
      </Field>
      <CheckField label="Show titles" checked={el.showTitles} onChange={set("showTitles")} />
      {el.showTitles && <NumberField label="Title size (px)" value={el.titleSize} min={8} max={32} step={0.5} onChange={set("titleSize")} />}

      <div
        className="site-dropzone"
        onDragOver={(e) => hasFiles(e) && e.preventDefault()}
        onDrop={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          addCovers([...e.dataTransfer.files]);
        }}
        onClick={() => fileRef.current?.click()}
      >
        {busy ? t("Uploading…") : t("＋ Add covers — click or drop several images")}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            addCovers([...e.target.files]);
            e.target.value = "";
          }}
        />
      </div>

      <div className="site-gallery-items">
        {el.items.map((item, i) => (
          <div className="site-gallery-item" key={item.id}>
            <div className="site-gallery-item-top">
              <ImageThumb src={item.src} uploadFiles={uploadFiles} onChange={(src) => setItem(item.id, { src })} />
              <div className="site-gallery-item-fields">
                <input placeholder={t("Title")} value={item.title} onChange={(e) => setItem(item.id, { title: e.target.value }, "title")} />
                <div className="site-gallery-item-buttons">
                  <button onClick={() => moveItem(i, -1)} disabled={i === 0} title={t("Move earlier")}>
                    ←
                  </button>
                  <button onClick={() => moveItem(i, 1)} disabled={i === el.items.length - 1} title={t("Move later")}>
                    →
                  </button>
                  <button className="sbe-danger" onClick={() => update({ items: el.items.filter((x) => x.id !== item.id) })} title={t("Remove")}>
                    ✕
                  </button>
                </div>
              </div>
            </div>
            <ActionField compact action={item.action} onChange={(action) => setItem(item.id, { action }, "action")} />
          </div>
        ))}
      </div>
    </>
  );
}

const BORDER_STYLES = [
  ["solid", "Solid"],
  ["dashed", "Dashed"],
  ["dotted", "Dotted"],
  ["double", "Double"],
];

// Picking a border color or style only means something once there's a border to show
// — so if the width is still 0, doing either also turns the border on.
const DEFAULT_BORDER_WIDTH = 2;

// The frame every element can have (see siteRender.js's boxStyle) — border, corners,
// inner padding and background. Elements made before this existed have no box* fields,
// so missing ones read as BOX_DEFAULTS.
function BoxFields({ el, set, update }) {
  const t = useT();
  const b = { ...BOX_DEFAULTS, ...el };
  const setWithBorder = (key) => (value) =>
    update(
      Number(b.boxBorderWidth) > 0 ? { [key]: value } : { [key]: value, boxBorderWidth: DEFAULT_BORDER_WIDTH },
      `${el.id}:${key}`
    );
  return (
    <div className="site-box-fields">
      <h4>{t("Border & box")}</h4>
      <div className="site-field-pair">
        <NumberField label="Border width (px)" value={b.boxBorderWidth} min={0} max={30} onChange={set("boxBorderWidth")} />
        <NumberField label="Corner radius" value={b.boxRadius} min={0} max={200} onChange={set("boxRadius")} />
      </div>
      <Field label="Border style" group>
        <Segmented value={b.boxBorderStyle} options={BORDER_STYLES} onChange={setWithBorder("boxBorderStyle")} />
      </Field>
      <ColorField label="Border color" value={b.boxBorderColor} onChange={setWithBorder("boxBorderColor")} />
      <NumberField label="Inner padding (px)" value={b.boxPadding} min={0} max={120} onChange={set("boxPadding")} />
      <ColorField label="Box background" value={b.boxBg} onChange={set("boxBg")} allowEmpty />
    </div>
  );
}

// ---------- Inspector fields ----------

// Captions passed to InspectorHeader and the field components below are English
// strings that these components translate themselves (see siteI18n.jsx), so call
// sites just write label="Corner radius" etc.
function InspectorHeader({ title, onBack }) {
  const t = useT();
  return (
    <div className="site-inspector-header">
      <h4>{t(title)}</h4>
      <button className="back-link" onClick={onBack} title={t("Back to page settings (Esc)")}>
        {t("Page settings")}
      </button>
    </div>
  );
}

// `group`: a <div> instead of a <label>, for fields holding several controls (a label
// would forward clicks on its caption to the first one — e.g. pop the color picker).
function Field({ label, children, group = false }) {
  const t = useT();
  const Tag = group ? "div" : "label";
  return (
    <Tag className="site-field">
      <span>{t(label)}</span>
      {children}
    </Tag>
  );
}

// A slider for dragging plus a small number box for typing/arrow keys, both bound to
// the same value. Typing past the slider's range is allowed (the slider just pins at
// its end). Dragging commits on every step, which commit() coalesces into one undo step.
function NumberField({ label, value, min, max, step = 1, onChange }) {
  const t = useT();
  const num = Number(value) || 0;
  const emit = (raw) => {
    const v = parseFloat(raw);
    onChange(Number.isNaN(v) ? 0 : v);
  };
  return (
    <div className="site-field site-number-field">
      <span className="site-number-head">
        <span>{t(label)}</span>
        <input type="number" value={value} min={min} max={max} step={step} onChange={(e) => emit(e.target.value)} />
      </span>
      <input
        type="range"
        className="site-slider"
        value={Math.min(max, Math.max(min, num))}
        min={min}
        max={max}
        step={step}
        onChange={(e) => emit(e.target.value)}
        aria-label={t(label)}
      />
    </div>
  );
}

// allowEmpty: blank means "inherit" (e.g. a heading using the page's text color).
function ColorField({ label, value, onChange, allowEmpty = false }) {
  const t = useT();
  return (
    <Field label={label} group>
      <span className="site-color">
        <input type="color" value={value || "#000000"} onChange={(e) => onChange(e.target.value)} />
        <input
          className="site-color-text"
          value={value}
          placeholder={allowEmpty ? t("default") : ""}
          onChange={(e) => onChange(e.target.value.trim())}
        />
        {allowEmpty && value && (
          <button type="button" onClick={() => onChange("")} title={t("Use the default")}>
            ✕
          </button>
        )}
      </span>
    </Field>
  );
}

function CheckField({ label, checked, onChange }) {
  const t = useT();
  return (
    <label className="site-check">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {t(label)}
    </label>
  );
}

function Segmented({ value, options, onChange }) {
  const t = useT();
  return (
    <span className="site-segmented">
      {options.map(([v, label]) => (
        <button type="button" key={v} className={value === v ? "active" : ""} onClick={() => onChange(v)}>
          {t(label)}
        </button>
      ))}
    </span>
  );
}

function ActionField({ action, onChange, compact = false }) {
  const t = useT();
  const a = action || { type: "none", value: "" };
  const invalidBook = a.type === "book" && a.value.trim() && !BOOK_CODE_RE.test(a.value.trim());
  return (
    <div className={`site-action${compact ? " compact" : ""}`}>
      {!compact && <span className="site-field-label">{t("When tapped")}</span>}
      <select value={a.type} onChange={(e) => onChange({ ...a, type: e.target.value })}>
        <option value="none">{t("Nothing")}</option>
        <option value="url">{t("Open a web link")}</option>
        <option value="book">{t("Open a PageBox book")}</option>
      </select>
      {a.type !== "none" && (
        <input
          value={a.value}
          placeholder={a.type === "url" ? "https://…" : t("Book code, e.g. CM1789619174392963")}
          onChange={(e) => onChange({ ...a, value: e.target.value })}
        />
      )}
      {invalidBook && <span className="site-error-inline">{t("Book codes look like CM followed by digits.")}</span>}
    </div>
  );
}

function ImageField({ src, uploadFiles, onChange }) {
  const t = useT();
  return (
    <Field label="Image" group>
      <ImageThumb large src={src} uploadFiles={uploadFiles} onChange={onChange} />
      {src && (
        <button type="button" className="back-link site-remove-image" onClick={() => onChange("")}>
          {t("Remove image")}
        </button>
      )}
    </Field>
  );
}

// Click to pick a file, or drop one on it — replaces the image in place.
function ImageThumb({ src, uploadFiles, onChange, large = false }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const accept = async (files) => {
    setBusy(true);
    const [url] = await uploadFiles([...files].slice(0, 1));
    setBusy(false);
    if (url) onChange(url);
  };
  return (
    <span
      className={`site-thumb${large ? " large" : ""}`}
      onClick={(e) => {
        e.preventDefault();
        fileRef.current?.click();
      }}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        accept(e.dataTransfer.files);
      }}
      title={t("Click to choose an image, or drop one here")}
    >
      {busy ? t("Uploading…") : src ? <img src={src} alt="" /> : large ? t("Click or drop an image") : "＋"}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          accept(e.target.files);
          e.target.value = "";
        }}
      />
    </span>
  );
}
