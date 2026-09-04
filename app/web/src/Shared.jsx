import { useEffect, useRef, useState } from "react";
import Terminal from "./Terminal";

// Used by Ibraheem HTML Studio (BookApp.jsx / StudioPicker.jsx) only. These are
// deliberate COPIES of the equivalent bits already living inside App.jsx (Manga
// Studio) — not imports from it and not extracted out of it — specifically so Manga
// Studio's file never has to be touched to build or change this studio.

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// Dark is this app's original look and the default for anyone who hasn't chosen yet;
// the choice is global (not per-project), so it's read/written directly to
// localStorage rather than living in project data. Applied via a data-theme attribute
// on the root element, which index.css's `:root[data-theme="light"]` block hooks into
// (index.css is loaded once, globally, by main.jsx regardless of which studio is shown).
export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return [theme, toggleTheme];
}

export function ThemeToggle({ theme, onToggle }) {
  const isLight = theme === "light";
  return (
    <button
      type="button"
      className={`theme-toggle${isLight ? " light" : ""}`}
      role="switch"
      aria-checked={isLight}
      title={isLight ? "Switch to dark mode" : "Switch to light mode"}
      onClick={onToggle}
    >
      <span className="theme-toggle-track">
        <span className="theme-toggle-knob">{isLight ? "☀️" : "🌙"}</span>
      </span>
    </button>
  );
}

// "checking" | "online" | "offline" — whether a local agent is running on THIS
// visitor's own machine. Without this, someone with no local agent running just sees
// every request silently fail with no explanation.
export function useAgentStatus() {
  const [agentStatus, setAgentStatus] = useState("checking");
  const [agentCheckAttempt, setAgentCheckAttempt] = useState(0);
  const recheckAgent = () => {
    setAgentStatus("checking");
    setAgentCheckAttempt((n) => n + 1);
  };
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    fetch("http://localhost:8787/api/health", { signal: controller.signal })
      .then((res) => setAgentStatus(res.ok ? "online" : "offline"))
      .catch(() => setAgentStatus("offline"))
      .finally(() => clearTimeout(timeout));
  }, [agentCheckAttempt]);
  return { agentStatus, recheckAgent };
}

export function DownloadPrompt({ onRetry }) {
  return (
    <div className="download-prompt">
      <h1>Get the local app</h1>
      <p>
        This runs on your own computer — your projects, your Codex account, and the terminal all stay on your
        machine, never on ours. Download and run it once, then come back here.
      </p>
      <div className="download-prompt-buttons">
        <a href="/downloads/manga-agent-windows.zip">Download for Windows</a>
        <a href="/downloads/manga-agent-linux.zip">Download for Linux</a>
      </div>
      <ol className="download-prompt-steps">
        <li>Download the zip for your OS above and extract it.</li>
        <li>
          Run <code>manga-agent</code> (or <code>manga-agent.exe</code> on Windows) — a window/terminal will show it
          running on <code>localhost:8787</code>.
        </li>
        <li>Come back to this page and click "Check again" below.</li>
      </ol>
      <button className="download-prompt-retry" onClick={onRetry}>
        Check again
      </button>
    </div>
  );
}

const TERMINAL_DEFAULT_SIZE = { width: 640, height: 380 };
const TERMINAL_MIN_SIZE = { width: 320, height: 180 };

// Floating, draggable, resizable window for the embedded terminal (see Terminal.jsx,
// which is generic/shared as-is — it just connects to ws://localhost:8787/ws/terminal
// with whatever projectId it's given, no changes needed there either).
export function TerminalOverlay({ show, projectId, onToggle }) {
  const [pos, setPos] = useState(() => ({
    x: Math.max(20, window.innerWidth - TERMINAL_DEFAULT_SIZE.width - 20),
    y: Math.max(20, window.innerHeight - TERMINAL_DEFAULT_SIZE.height - 60),
  }));
  const [size, setSize] = useState(TERMINAL_DEFAULT_SIZE);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const restoreRef = useRef(null);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);

  const onTitleMouseDown = (e) => {
    if (maximized || minimized || e.target.closest("button")) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: pos.x, startPosY: pos.y };
    const onMove = (ev) => {
      const { startX, startY, startPosX, startPosY } = dragRef.current;
      setPos({
        x: clamp(startPosX + (ev.clientX - startX), 0, Math.max(0, window.innerWidth - size.width)),
        y: clamp(startPosY + (ev.clientY - startY), 0, Math.max(0, window.innerHeight - size.height)),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onResizeMouseDown = (e) => {
    if (maximized) return;
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startWidth: size.width, startHeight: size.height };
    const onMove = (ev) => {
      const { startX, startY, startWidth, startHeight } = resizeRef.current;
      setSize({
        width: clamp(startWidth + (ev.clientX - startX), TERMINAL_MIN_SIZE.width, window.innerWidth - pos.x),
        height: clamp(startHeight + (ev.clientY - startY), TERMINAL_MIN_SIZE.height, window.innerHeight - pos.y),
      });
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const toggleMaximize = () => {
    if (maximized) {
      if (restoreRef.current) {
        setPos(restoreRef.current.pos);
        setSize(restoreRef.current.size);
      }
      setMaximized(false);
    } else {
      restoreRef.current = { pos, size };
      setPos({ x: 20, y: 20 });
      setSize({ width: window.innerWidth - 40, height: window.innerHeight - 40 });
      setMaximized(true);
    }
  };

  return (
    <>
      <button className="terminal-toggle" onClick={onToggle}>
        {show ? "▼ Terminal" : "▲ Terminal"}
      </button>
      {show && (
        <div
          className="terminal-window"
          style={
            minimized
              ? { left: pos.x, bottom: 12, width: size.width, height: undefined }
              : { left: pos.x, top: pos.y, width: size.width, height: size.height }
          }
        >
          <div className="terminal-window-titlebar" onMouseDown={onTitleMouseDown}>
            <span>Terminal</span>
            <div className="terminal-window-controls">
              <button title={minimized ? "Restore" : "Minimize"} onClick={() => setMinimized((v) => !v)}>
                {minimized ? "▢" : "—"}
              </button>
              <button title={maximized ? "Restore" : "Maximize"} onClick={toggleMaximize}>
                {maximized ? "❐" : "□"}
              </button>
              <button title="Close" onClick={onToggle}>
                ✕
              </button>
            </div>
          </div>
          {!minimized && (
            <div className="terminal-window-body">
              <Terminal key={projectId} projectId={projectId} />
            </div>
          )}
          {!minimized && !maximized && <div className="terminal-window-resize-handle" onMouseDown={onResizeMouseDown} />}
        </div>
      )}
    </>
  );
}
