import { WebSocketServer } from "ws";
import pty from "node-pty";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.join(__dirname, "projects");
// Ibraheem HTML Studio's book projects live in a separate tree (see bookStore.js) —
// checked as a fallback below so its book projects' terminal sessions cwd into their
// own folder too, without this file needing to know anything else about that studio.
const BOOK_PROJECTS_DIR = path.join(__dirname, "book-projects");

const LOCALHOST_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isLocalhost(remoteAddress) {
  return LOCALHOST_ADDRESSES.has(remoteAddress);
}

// One shared PTY session per project, so the visible terminal (opened when you open
// a project) and Generate-triggered commands run in the same place — you can watch
// generation happen live. Keyed by projectId; "" (no project) gets a home-dir shell.
const sessions = new Map();

function getOrCreateSession(projectId) {
  const key = projectId || "";
  let session = sessions.get(key);
  if (session) return session;

  // A manga project folder always wins when both somehow exist (extremely unlikely,
  // since the two studios use unrelated id namespaces) — this preserves the exact
  // previous cwd for every existing manga project, whose folder is the only one that
  // has ever existed under either path until now.
  const mangaDir = key ? path.join(PROJECTS_DIR, key) : null;
  const bookDir = key ? path.join(BOOK_PROJECTS_DIR, key) : null;
  const cwd = !key ? os.homedir() : fs.existsSync(mangaDir) ? mangaDir : fs.existsSync(bookDir) ? bookDir : mangaDir;
  const isWindows = process.platform === "win32";
  const shell = isWindows ? "powershell.exe" : (process.env.SHELL || "/bin/bash");
  const args = isWindows ? [] : ["-l"];
  const term = pty.spawn(shell, args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: process.env,
  });

  session = { term, ws: null };
  term.onData((data) => {
    if (session.ws && session.ws.readyState === session.ws.OPEN) {
      session.ws.send(JSON.stringify({ type: "data", data }));
    }
  });
  term.onExit(({ exitCode }) => {
    if (session.ws && session.ws.readyState === session.ws.OPEN) {
      session.ws.send(JSON.stringify({ type: "exit", exitCode }));
    }
    sessions.delete(key);
  });

  sessions.set(key, session);
  return session;
}

// Writes a command into the given project's shared terminal session (creating the
// session if it isn't already open) so it's visible in the browser terminal, same as
// if you'd typed it yourself. Does not wait for completion — callers that need to know
// when a command finishes (e.g. image generation) detect it some other way (e.g.
// polling for an expected output file), since a live PTY has no clean "done" signal.
export function runInProjectTerminal(projectId, command) {
  const session = getOrCreateSession(projectId);
  // Two things had to be fixed here, both verified directly against a running Codex
  // session: (1) real Enter sends \r (carriage return), not \n (line feed) - Codex's
  // own chat UI only submits on \r; (2) \r bundled into the same write() call as the
  // text gets treated as pasted content (no submit-on-Enter for pastes) rather than a
  // real keystroke - it must be a genuinely separate write, after the text has landed.
  // (3) a fixed 50ms wasn't always enough: with a long prompt (e.g. several #characters'
  // descriptions), Codex was still ingesting the paste when \r arrived, so the Enter
  // got folded into the pasted text and the prompt just sat unsent in the input box
  // until the caller timed out. Wrapping the text in bracketed-paste markers tells the
  // receiver exactly where the paste ends, so the \r after it is always a real keypress.
  // Bash's readline binds these markers even with enable-bracketed-paste off, so a plain
  // shell prompt handles them too. PowerShell gets the old unwrapped write.
  if (process.platform === "win32") {
    session.term.write(command);
  } else {
    session.term.write(`\x1b[200~${command}\x1b[201~`);
  }
  // Scaled to the prompt's length as a second safety margin, then Enter once more a bit
  // later in case the first landed too early anyway — a stray extra Enter is harmless
  // both in Codex's chat (empty input box, nothing to submit) and at a shell prompt.
  const delay = 150 + Math.min(1500, Math.round(command.length / 10));
  setTimeout(() => session.term.write("\r"), delay);
  setTimeout(() => session.term.write("\r"), delay + 2000);
}

// Sends Ctrl+C into the given project's terminal session, to stop a `codex exec` that
// generateImageViaCodex/translateTextsViaCodex (see codex.js) has given up waiting on —
// otherwise it keeps running unattended in this same shared session and can, much
// later, still write its output where a completely unrelated future call's fallback
// file search (see codex.js's newestFileUnder) might pick it up as if it were that
// later call's own result. A no-op if the session doesn't exist (nothing to interrupt).
export function interruptProjectTerminal(projectId) {
  const session = sessions.get(projectId || "");
  if (session) session.term.write("\x03");
}

// Attaches a WebSocket-based terminal bridge to an existing HTTP server. Connecting
// with ?projectId=<id> attaches to (or creates) that project's shared session, cwd'd
// to that project's folder — so interactive programs (including `codex`) work exactly
// as they would in a normal terminal window, and Generate-triggered commands land in
// the same visible session.
//
// SECURITY: this hands out an unauthenticated interactive shell — restricted to
// connections originating from this same machine. Do not remove this check
// without adding real authentication in its place.
export function attachTerminal(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/terminal" });

  wss.on("connection", (ws, req) => {
    const remoteAddress = req.socket.remoteAddress;
    if (!isLocalhost(remoteAddress)) {
      console.warn(`Rejected terminal connection from non-localhost address: ${remoteAddress}`);
      ws.close(1008, "Terminal access is restricted to localhost");
      return;
    }

    const { searchParams } = new URL(req.url, "http://localhost");
    const projectId = searchParams.get("projectId") || "";
    const session = getOrCreateSession(projectId);
    session.ws = ws; // one visible viewer per project at a time

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "input") session.term.write(msg.data);
      else if (msg.type === "resize") session.term.resize(msg.cols, msg.rows);
    });

    ws.on("close", () => {
      // Detaching the viewer does NOT kill the shell — Generate can still use it,
      // and reopening the terminal panel reattaches to the same running session.
      if (session.ws === ws) session.ws = null;
    });
  });

  return wss;
}
