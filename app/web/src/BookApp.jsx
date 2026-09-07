import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { bookApi } from "./bookApi";
import { useTheme, ThemeToggle, useAgentStatus, DownloadPrompt, TerminalOverlay } from "./Shared";
import "./book-app.css";

const LANGUAGES = [
  "English", "Korean", "Japanese", "Chinese (Simplified)", "Chinese (Traditional)", "Spanish", "French",
  "German", "Portuguese", "Italian", "Russian", "Arabic", "Hindi", "Vietnamese", "Thai", "Indonesian",
];

const ILLUSTRATION_STYLES = [
  { value: "bw_illustration", label: "Black & white ink illustration" },
  { value: "color_illustration", label: "Full-color painterly illustration" },
];

// A chapter's paragraphs (see bookPrompt.js's CONTENT_SCHEMA_DESCRIPTION: [{type,text}])
// are edited as one flowing textarea, paragraphs separated by a blank line — the
// type:"quote"/"text" split is re-derived on save purely from whether a paragraph is
// wrapped in quote marks, rather than exposing that as its own control.
const QUOTE_RE = /^[“"'「『]([\s\S]*)[”"'」』]$/;

function contentToDraft(content) {
  return {
    ...content,
    chapters: content.chapters.map((ch) => ({ ...ch, bodyText: ch.paragraphs.map((p) => p.text).join("\n\n") })),
    closing: { ...content.closing, sections: content.closing.sections.map((s) => ({ ...s })) },
  };
}

// Applies one BookPreviewPane edit back into `content`, immutably, by walking a
// data-field path like "chapters.2.paragraphs.1.text" or "introSummary.0" — array vs.
// object indexing is inferred from the value at each step, since content mixes both
// (e.g. `chapters` is an array, `chapters[i]` is an object, `introSummary` is an array
// of plain strings).
function setPath(obj, path, value) {
  const [key, ...rest] = path.split(".");
  if (Array.isArray(obj)) {
    const idx = Number(key);
    const copy = obj.slice();
    copy[idx] = rest.length ? setPath(copy[idx], rest.join("."), value) : value;
    return copy;
  }
  return { ...obj, [key]: rest.length ? setPath(obj[key], rest.join("."), value) : value };
}

function draftToContent(draft, original) {
  return {
    ...original,
    title: draft.title,
    originalTitle: draft.originalTitle,
    author: draft.author,
    tagline: draft.tagline,
    coverImagePrompt: draft.coverImagePrompt,
    introSummary: draft.introSummary,
    notice: draft.notice,
    chapters: draft.chapters.map((ch, i) => {
      const paragraphs = ch.bodyText
        .split(/\n\s*\n/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((text) => ({ type: QUOTE_RE.test(text) ? "quote" : "text", text }));
      return { ...original.chapters[i], number: ch.number, title: ch.title, lead: ch.lead, imageCaption: ch.imageCaption, imagePrompt: ch.imagePrompt, paragraphs };
    }),
    closing: {
      ...original.closing,
      title: draft.closing.title,
      lead: draft.closing.lead,
      sections: draft.closing.sections,
      questionTitle: draft.closing.questionTitle,
      questionText: draft.closing.questionText,
    },
  };
}

export default function BookApp({ onBackToStudios }) {
  const [theme, toggleTheme] = useTheme();
  const { agentStatus, recheckAgent } = useAgentStatus();
  const [books, setBooks] = useState(null); // null = not loaded yet
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [book, setBook] = useState(null); // { title, author, language, notes, content, images }
  const [showTerminal, setShowTerminal] = useState(false);
  const [draft, setDraft] = useState(null);
  const [style, setStyle] = useState("bw_illustration");
  const [contentBusy, setContentBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [chapterBusy, setChapterBusy] = useState({}); // { [index]: true }
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState("");
  const [folderStatus, setFolderStatus] = useState("");
  const [promptPreview, setPromptPreview] = useState(""); // "" = not shown; set to the actual text sent to Codex
  const [promptBusy, setPromptBusy] = useState(false);
  // Bumped whenever `book.content` (or its images) just changed on the server, to tell
  // BookPreviewPane to reload — see its own comment for why this isn't just "reload on
  // every book state change" (that would wipe out in-progress edits typed into the
  // preview pane over something unrelated, like a sidebar field's onBlur autosave).
  const [previewVersion, setPreviewVersion] = useState(0);
  const [exportBusy, setExportBusy] = useState(false);
  const previewRef = useRef(null);

  const refreshBooks = useCallback(() => bookApi.listProjects().then(setBooks), []);
  useEffect(() => {
    refreshBooks();
  }, [refreshBooks]);

  const refreshBook = useCallback((projectId) => {
    return bookApi.getBook(projectId).then((b) => {
      setBook(b);
      if (b.content) setPreviewVersion((v) => v + 1);
    });
  }, []);

  useEffect(() => {
    if (book?.content) setDraft(contentToDraft(book.content));
    else setDraft(null);
  }, [book]);

  const openBook = (id) => {
    setCurrentProjectId(id);
    setError("");
    setPromptPreview("");
    setShowTerminal(true); // auto-open, cwd'd into this project's folder — same as Manga Studio
    refreshBook(id);
  };

  const createBook = async ({ title, author, language, notes }) => {
    const project = await bookApi.createProject(title);
    await bookApi.updateBook(project.id, { title, author, language, notes });
    await refreshBooks();
    openBook(project.id);
  };

  // Alternative to createBook — reconstructs a whole new project's content/images from
  // an HTML file this same app previously exported (see bookImport.js), then opens it
  // straight into the normal editor so any part can be regenerated or edited in place.
  const importBook = async (file) => {
    setImportBusy(true);
    setImportError("");
    try {
      const result = await bookApi.importProject(file);
      await refreshBooks();
      openBook(result.id);
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImportBusy(false);
    }
  };

  const deleteBook = async (id, name) => {
    if (!window.confirm(`Delete "${name}" and everything in it? This can't be undone.`)) return;
    await bookApi.deleteProject(id);
    await refreshBooks();
    if (currentProjectId === id) setCurrentProjectId(null);
  };

  const openCurrentBookFolder = async () => {
    try {
      await bookApi.openProjectFolder(currentProjectId);
      setFolderStatus("");
    } catch (err) {
      setFolderStatus(`Failed: ${err.message}`);
    }
  };

  const previewPrompt = async () => {
    setPromptBusy(true);
    setError("");
    try {
      const { prompt } = await bookApi.getContentPrompt(currentProjectId);
      setPromptPreview(prompt);
    } catch (err) {
      setError(err.message);
    } finally {
      setPromptBusy(false);
    }
  };

  const generateContent = async () => {
    setContentBusy(true);
    setError("");
    try {
      setBook(await bookApi.generateBookContent(currentProjectId));
      setPreviewVersion((v) => v + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setContentBusy(false);
    }
  };

  const generateCover = async () => {
    setCoverBusy(true);
    setError("");
    try {
      setBook(await bookApi.generateBookCover(currentProjectId, style));
      setPreviewVersion((v) => v + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setCoverBusy(false);
    }
  };

  const generateChapterImage = async (index) => {
    setChapterBusy((prev) => ({ ...prev, [index]: true }));
    setError("");
    try {
      setBook(await bookApi.generateBookChapterImage(currentProjectId, index, style));
      setPreviewVersion((v) => v + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setChapterBusy((prev) => ({ ...prev, [index]: false }));
    }
  };

  // Manual alternative to generateCover/generateChapterImage above — drag-drop, paste,
  // or a plain file picker (see ImageSlot) all land here instead of asking Codex.
  const uploadCoverImage = async (file) => {
    setCoverBusy(true);
    setError("");
    try {
      setBook(await bookApi.uploadBookImage(currentProjectId, "cover", file));
      setPreviewVersion((v) => v + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setCoverBusy(false);
    }
  };

  const uploadChapterImage = async (index, file) => {
    setChapterBusy((prev) => ({ ...prev, [index]: true }));
    setError("");
    try {
      setBook(await bookApi.uploadBookImage(currentProjectId, `chapter-${index}`, file));
      setPreviewVersion((v) => v + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setChapterBusy((prev) => ({ ...prev, [index]: false }));
    }
  };

  const deleteChapter = async (index, title) => {
    if (!window.confirm(`Delete chapter${title ? ` "${title}"` : ""}? This can't be undone.`)) return;
    setChapterBusy((prev) => ({ ...prev, [index]: true }));
    setError("");
    try {
      setBook(await bookApi.deleteBookChapter(currentProjectId, index));
      setPreviewVersion((v) => v + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setChapterBusy((prev) => ({ ...prev, [index]: false }));
    }
  };

  const saveContent = async () => {
    setSaveBusy(true);
    setError("");
    try {
      const content = draftToContent(draft, book.content);
      setBook(await bookApi.updateBook(currentProjectId, { content }));
      setPreviewVersion((v) => v + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaveBusy(false);
    }
  };

  // Applies any in-place edits sitting in the preview pane (see BookPreviewPane) to the
  // saved content first, so the download that follows reflects them — then triggers the
  // same file the old plain <a href download> did, just via a synthetic click so this
  // can await the save first.
  const exportBook = async () => {
    setExportBusy(true);
    setError("");
    try {
      const updated = previewRef.current?.applyEdits(book.content);
      if (updated) {
        setBook(await bookApi.updateBook(currentProjectId, { content: updated }));
        setPreviewVersion((v) => v + 1);
      }
      const a = document.createElement("a");
      a.href = bookApi.bookExportUrl(currentProjectId);
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setError(err.message);
    } finally {
      setExportBusy(false);
    }
  };

  if (agentStatus === "checking") return <div className="agent-checking">Checking for local agent…</div>;
  if (agentStatus === "offline") return <DownloadPrompt onRetry={recheckAgent} />;

  if (!currentProjectId) {
    return (
      <>
        <BookLanding
          books={books}
          onOpen={openBook}
          onCreate={createBook}
          onDelete={deleteBook}
          onImport={importBook}
          importBusy={importBusy}
          importError={importError}
          theme={theme}
          onToggleTheme={toggleTheme}
          onBackToStudios={onBackToStudios}
        />
        <TerminalOverlay show={showTerminal} projectId={currentProjectId} onToggle={() => setShowTerminal((v) => !v)} />
      </>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-header-top">
            <span className="app-name">Ibraheem HTML Studio</span>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
          <button className="back-link" onClick={() => setCurrentProjectId(null)}>
            ← Books
          </button>
        </div>

        <button className="open-folder-button" onClick={openCurrentBookFolder}>
          Open folder location
        </button>
        {folderStatus && <p className="empty-hint error">{folderStatus}</p>}

        {book && (
          <div className="book-meta-card">
            <label>
              Title
              <input
                value={book.title}
                onChange={(e) => setBook({ ...book, title: e.target.value })}
                onBlur={() => bookApi.updateBook(currentProjectId, { title: book.title }).then(setBook)}
              />
            </label>
            <label>
              Author
              <input
                value={book.author}
                onChange={(e) => setBook({ ...book, author: e.target.value })}
                onBlur={() => bookApi.updateBook(currentProjectId, { author: book.author }).then(setBook)}
              />
            </label>
            <label>
              Language
              <select
                value={book.language}
                onChange={(e) => bookApi.updateBook(currentProjectId, { language: e.target.value }).then(setBook)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Notes for the AI (optional)
              <textarea
                rows={3}
                placeholder="e.g. focus on the ending, keep a hopeful tone, emphasize the friendship theme…"
                value={book.notes || ""}
                onChange={(e) => setBook({ ...book, notes: e.target.value })}
                onBlur={() => bookApi.updateBook(currentProjectId, { notes: book.notes }).then(setBook)}
              />
            </label>
            <label>
              Illustration style
              <select value={style} onChange={(e) => setStyle(e.target.value)}>
                {ILLUSTRATION_STYLES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            {book.content && (
              <button className="primary book-export-link" disabled={exportBusy} onClick={exportBook}>
                {exportBusy ? "Exporting…" : "⬇ Export as HTML"}
              </button>
            )}
          </div>
        )}
      </aside>

      <main className={`main book-main${book?.content ? " book-main-split" : ""}`}>
        {error && <p className="empty-hint error">{error}</p>}

        {!book ? (
          <p className="empty-hint">Loading…</p>
        ) : !book.content ? (
          <div className="book-generate-prompt">
            <p className="empty-hint">
              Give this book a title (and, optionally, an author and notes) in the sidebar, then generate its
              condensed, illustrated "10-minute read" content. Codex writes the whole thing — cover tagline,
              intro, seven chapters, and closing analysis — from its own knowledge of the book, entirely in{" "}
              <strong>{book.language}</strong>.
            </p>
            <div className="book-generate-actions">
              <button disabled={promptBusy || !book.title.trim()} onClick={previewPrompt}>
                {promptBusy ? "Loading…" : "Preview prompt"}
              </button>
              <button className="primary" disabled={contentBusy || !book.title.trim()} onClick={generateContent}>
                {contentBusy ? "Generating content… (watch the terminal)" : "Generate content"}
              </button>
            </div>
            {promptPreview && (
              <div className="book-prompt-preview">
                <div className="book-prompt-preview-label">Exact text that will be sent to Codex:</div>
                <pre>{promptPreview}</pre>
              </div>
            )}
          </div>
        ) : (
          draft && (
            <div className="book-split">
              <div className="book-split-col book-split-left">
                <BookEditor
                  draft={draft}
                  setDraft={setDraft}
                  book={book}
                  coverBusy={coverBusy}
                  chapterBusy={chapterBusy}
                  saveBusy={saveBusy}
                  onGenerateCover={generateCover}
                  onGenerateChapterImage={generateChapterImage}
                  onUploadCoverImage={uploadCoverImage}
                  onUploadChapterImage={uploadChapterImage}
                  onDeleteChapter={deleteChapter}
                  onSave={saveContent}
                  onRegenerateContent={generateContent}
                  contentBusy={contentBusy}
                />
              </div>
              <div className="book-split-col book-split-right">
                <BookPreviewPane ref={previewRef} projectId={currentProjectId} reloadKey={previewVersion} />
              </div>
            </div>
          )
        )}
      </main>

      <TerminalOverlay show={showTerminal} projectId={currentProjectId} onToggle={() => setShowTerminal((v) => !v)} />
    </div>
  );
}

function BookLanding({ books, onOpen, onCreate, onDelete, onImport, importBusy, importError, theme, onToggleTheme, onBackToStudios }) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [language, setLanguage] = useState("English");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const importInputRef = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onCreate({ title: title.trim(), author: author.trim(), language, notes: notes.trim() });
    } finally {
      setBusy(false);
    }
  };

  const acceptImportFile = (file) => {
    if (file && /\.html?$/i.test(file.name)) onImport(file);
  };

  if (books === null) {
    return <div className="landing" />; // still loading
  }

  return (
    <div
      className={`landing${dragOver ? " landing-drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        acceptImportFile(e.dataTransfer.files?.[0]);
      }}
    >
      <div className="landing-header">
        <div className="landing-header-title">
          <button className="back-link" onClick={onBackToStudios}>
            ← Studios
          </button>
          <h1>Ibraheem HTML Studio</h1>
        </div>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
      <div className="project-grid">
        {books.map((b) => (
          <div className="project-card-wrap" key={b.id}>
            <button className="project-card" onClick={() => onOpen(b.id)}>
              {b.name}
            </button>
            <button
              className="project-card-delete"
              title={`Delete ${b.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(b.id, b.name);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button className="project-card project-card-new" onClick={() => setShowForm(true)}>
          +
        </button>
        <button
          className="project-card project-card-import"
          disabled={importBusy}
          onClick={() => importInputRef.current?.click()}
          title="Bring back a book this app already exported, to keep editing/regenerating it"
        >
          {importBusy ? "Importing…" : "⇪ Import HTML"}
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept=".html,.htm,text/html"
          hidden
          onChange={(e) => {
            acceptImportFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {books.length === 0 && !showForm && (
        <p className="empty-hint">No books yet — click + to condense your first one, or drag in an exported HTML to import it.</p>
      )}
      {importError && <p className="empty-hint error">{importError}</p>}
      {showForm && (
        <form className="new-project-form book-new-form" onSubmit={submit}>
          <input placeholder="Book title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <input placeholder="Author (optional)" value={author} onChange={(e) => setAuthor(e.target.value)} />
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <textarea
            className="book-new-form-notes"
            rows={2}
            placeholder="Notes for the AI (optional) — e.g. focus on the ending, keep a hopeful tone…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </form>
      )}
    </div>
  );
}

function BookEditor({
  draft, setDraft, book, coverBusy, chapterBusy, saveBusy,
  onGenerateCover, onGenerateChapterImage, onUploadCoverImage, onUploadChapterImage, onDeleteChapter,
  onSave, onRegenerateContent, contentBusy,
}) {
  const setField = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const setChapterField = (index, key, value) =>
    setDraft((d) => ({
      ...d,
      chapters: d.chapters.map((ch, i) => (i === index ? { ...ch, [key]: value } : ch)),
    }));
  const setClosingField = (key, value) => setDraft((d) => ({ ...d, closing: { ...d.closing, [key]: value } }));
  const setSectionField = (index, key, value) =>
    setDraft((d) => ({
      ...d,
      closing: {
        ...d.closing,
        sections: d.closing.sections.map((s, i) => (i === index ? { ...s, [key]: value } : s)),
      },
    }));
  const addSection = () =>
    setDraft((d) => ({ ...d, closing: { ...d.closing, sections: [...d.closing.sections, { subhead: "", text: "" }] } }));
  const removeSection = (index) =>
    setDraft((d) => ({ ...d, closing: { ...d.closing, sections: d.closing.sections.filter((_, i) => i !== index) } }));

  return (
    <div className="book-editor">
      <div className="book-editor-toolbar">
        <button className="primary" disabled={saveBusy} onClick={onSave}>
          {saveBusy ? "Saving…" : "Save changes"}
        </button>
        <button disabled={contentBusy} onClick={onRegenerateContent} title="Discards manual edits and re-curates everything from scratch">
          {contentBusy ? "Regenerating… (watch the terminal)" : "↻ Regenerate all content"}
        </button>
      </div>

      <section className="book-card">
        <h2>Cover</h2>
        <div className="book-card-body">
          <ImageSlot
            url={book.images.cover.imageUrl}
            busy={coverBusy}
            onGenerate={onGenerateCover}
            onUpload={onUploadCoverImage}
            label="cover"
          />
          <div className="book-card-fields">
            <label>
              Title
              <input value={draft.title} onChange={(e) => setField("title", e.target.value)} />
            </label>
            <label>
              Original-language title (optional)
              <input value={draft.originalTitle || ""} onChange={(e) => setField("originalTitle", e.target.value)} />
            </label>
            <label>
              Author
              <input value={draft.author} onChange={(e) => setField("author", e.target.value)} />
            </label>
            <label>
              Tagline
              <input value={draft.tagline} onChange={(e) => setField("tagline", e.target.value)} />
            </label>
            <label>
              Cover illustration prompt (English, optional — leave blank to auto-generate from title/tagline)
              <textarea
                rows={2}
                placeholder="e.g. A lone lighthouse on a storm-lit cliff, waves crashing below…"
                value={draft.coverImagePrompt || ""}
                onChange={(e) => setField("coverImagePrompt", e.target.value)}
              />
            </label>
            <label>
              Intro — part 1
              <textarea rows={3} value={draft.introSummary[0]} onChange={(e) => setField("introSummary", [e.target.value, draft.introSummary[1]])} />
            </label>
            <label>
              Intro — part 2
              <textarea rows={3} value={draft.introSummary[1]} onChange={(e) => setField("introSummary", [draft.introSummary[0], e.target.value])} />
            </label>
            <label>
              Content notice
              <input value={draft.notice} onChange={(e) => setField("notice", e.target.value)} />
            </label>
          </div>
        </div>
      </section>

      {draft.chapters.map((ch, i) => (
        <section className="book-card" key={i}>
          <div className="book-card-header">
            <h2>
              Chapter {ch.number} — {ch.title || "Untitled"}
            </h2>
            <button
              type="button"
              className="delete book-chapter-delete"
              title="Delete this chapter"
              disabled={!!chapterBusy[i]}
              onClick={() => onDeleteChapter(i, ch.title)}
            >
              ×
            </button>
          </div>
          <div className="book-card-body">
            <ImageSlot
              url={book.images[`chapter-${i}`]?.imageUrl}
              busy={!!chapterBusy[i]}
              onGenerate={() => onGenerateChapterImage(i)}
              onUpload={(file) => onUploadChapterImage(i, file)}
              label={`chapter ${ch.number}`}
            />
            <div className="book-card-fields">
              <label>
                Chapter title
                <input value={ch.title} onChange={(e) => setChapterField(i, "title", e.target.value)} />
              </label>
              <label>
                Lead line
                <input value={ch.lead} onChange={(e) => setChapterField(i, "lead", e.target.value)} />
              </label>
              <label>
                Body (blank line between paragraphs)
                <textarea rows={8} value={ch.bodyText} onChange={(e) => setChapterField(i, "bodyText", e.target.value)} />
              </label>
              <label>
                Illustration caption
                <input value={ch.imageCaption} onChange={(e) => setChapterField(i, "imageCaption", e.target.value)} />
              </label>
              <label>
                Illustration prompt (English — describes what the image shows)
                <textarea rows={2} value={ch.imagePrompt} onChange={(e) => setChapterField(i, "imagePrompt", e.target.value)} />
              </label>
            </div>
          </div>
        </section>
      ))}

      <section className="book-card">
        <h2>Closing</h2>
        <div className="book-card-fields">
          <label>
            Title
            <input value={draft.closing.title} onChange={(e) => setClosingField("title", e.target.value)} />
          </label>
          <label>
            Lead line
            <input value={draft.closing.lead} onChange={(e) => setClosingField("lead", e.target.value)} />
          </label>
          {draft.closing.sections.map((s, i) => (
            <div className="book-section-row" key={i}>
              <input placeholder="Subhead" value={s.subhead} onChange={(e) => setSectionField(i, "subhead", e.target.value)} />
              <textarea rows={2} placeholder="Analysis text" value={s.text} onChange={(e) => setSectionField(i, "text", e.target.value)} />
              <button type="button" className="delete" onClick={() => removeSection(i)}>
                ×
              </button>
            </div>
          ))}
          <button type="button" className="add-field" onClick={addSection}>
            + Section
          </button>
          <label>
            Closing question title
            <input value={draft.closing.questionTitle} onChange={(e) => setClosingField("questionTitle", e.target.value)} />
          </label>
          <label>
            Closing question
            <textarea rows={2} value={draft.closing.questionText} onChange={(e) => setClosingField("questionText", e.target.value)} />
          </label>
        </div>
      </section>
    </div>
  );
}

// Renders the actual exported HTML (same document /export downloads) live, in an
// iframe, with every data-field-tagged text node (see bookTemplate.js's block()) made
// directly editable — so you can read the real "10-minute read" layout instead of the
// form on the left, and fix a word or a line right where you see it. Edits sit only in
// the iframe's own DOM until applyEdits() is called (by BookApp's exportBook, and only
// then) — nothing here saves on its own, and reloading the preview (reloadKey bumping,
// or the Refresh button) discards whatever hasn't been applied yet.
const BookPreviewPane = forwardRef(function BookPreviewPane({ projectId, reloadKey }, ref) {
  const [html, setHtml] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const iframeRef = useRef(null);
  const editsRef = useRef({}); // data-field path -> edited text, accumulated since the last load/apply

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    editsRef.current = {};
    setDirty(false);
    bookApi
      .getBookPreview(projectId)
      .then(({ html }) => setHtml(html))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, reloadKey]);

  const onIframeLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    doc.querySelectorAll("[data-field]").forEach((el) => {
      el.contentEditable = "true";
      el.spellcheck = false;
      el.addEventListener("input", () => {
        editsRef.current[el.getAttribute("data-field")] = el.innerText;
        setDirty(true);
      });
    });
  };

  useImperativeHandle(ref, () => ({
    // Folds every pending edit into `content` (immutably) and returns the result, or
    // null if nothing was edited — the caller (BookApp's exportBook) only saves when
    // this returns non-null, so exporting with no preview edits doesn't touch the book.
    applyEdits(content) {
      const paths = Object.keys(editsRef.current);
      if (!paths.length) return null;
      let updated = content;
      for (const path of paths) updated = setPath(updated, path, editsRef.current[path]);
      editsRef.current = {};
      setDirty(false);
      return updated;
    },
  }));

  return (
    <div className="book-preview-pane">
      <div className="book-preview-toolbar">
        <span className="book-preview-hint">Click any text below to edit it — Export saves those edits too.</span>
        {dirty && <span className="book-preview-dirty">Unsaved edits here</span>}
        <button type="button" onClick={load} disabled={loading}>
          ↻ Refresh preview
        </button>
      </div>
      {error && <p className="empty-hint error">{error}</p>}
      {loading && !html ? (
        <p className="empty-hint">Loading preview…</p>
      ) : (
        html && (
          <iframe
            ref={iframeRef}
            className="book-preview-frame"
            srcDoc={html}
            onLoad={onIframeLoad}
            title="Book preview"
          />
        )
      )}
    </div>
  );
});

// Accepts an image three ways besides the Generate/Redraw button: dropping a file onto
// it, pasting one from the clipboard (click the slot first so it has focus — a paste
// event only fires on whatever currently does), or the plain file picker. All three
// funnel into the same onUpload(file), which just uploads it as-is (see BookApp's
// uploadCoverImage/uploadChapterImage — the server re-encodes it to PNG either way).
function ImageSlot({ url, busy, onGenerate, onUpload, label }) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const acceptFile = (file) => {
    if (file && file.type.startsWith("image/")) onUpload(file);
  };

  return (
    <div
      className={`book-image-slot${dragOver ? " drag-over" : ""}`}
      tabIndex={0}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        acceptFile(e.dataTransfer.files?.[0]);
      }}
      onPaste={(e) => {
        const item = Array.from(e.clipboardData?.items || []).find((it) => it.type.startsWith("image/"));
        if (item) {
          e.preventDefault();
          acceptFile(item.getAsFile());
        }
      }}
    >
      {url ? (
        <img src={url} alt="" />
      ) : (
        <div className="book-image-slot-placeholder">Drag, paste, or generate an image</div>
      )}
      <button disabled={busy} onClick={onGenerate}>
        {busy ? "Working… (watch the terminal)" : url ? `↻ Redraw ${label}` : `Generate ${label}`}
      </button>
      <button type="button" disabled={busy} onClick={() => fileInputRef.current?.click()}>
        Upload image…
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          acceptFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
