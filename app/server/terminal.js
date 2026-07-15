import { WebSocketServer } from "ws";
import pty from "node-pty";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.join(__dirname, "projects");

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

  const cwd = key ? path.join(PROJECTS_DIR, key) : os.homedir();
  const shell = process.env.SHELL || "/bin/bash";
  const term = pty.spawn(shell, ["-l"], {
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
  session.term.write(command);
  setTimeout(() => session.term.write("\r"), 50);
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
