import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { runInProjectTerminal } from "./terminal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.join(__dirname, "projects");

// Observed 33s-5min in practice — Codex occasionally hits an internal hiccup (e.g. a
// transient "num_last_images_to_include" tool error) and silently retries once.
const CODEX_TIMEOUT_MS = 8 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;

export class CodexError extends Error {}

// The prompt/paths are built from user-entered content (character names, fields,
// style) and now get written as literal keystrokes into a real shell (see
// terminal.js), not passed as an isolated argv element — so they must be quoted to
// prevent shell injection (e.g. a character named `"; rm -rf ~ #`). Quoting rules
// differ by shell: PowerShell (Windows) escapes an embedded ' by doubling it, while
// bash/sh (Linux/macOS) has no in-quote escape and needs the close-escape-reopen
// trick instead.
function shellQuote(value) {
  const str = String(value);
  if (process.platform === "win32") {
    return `'${str.replace(/'/g, "''")}'`;
  }
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

function newestFileUnder(dir, extension, newerThanMs) {
  if (!fs.existsSync(dir)) return null;
  let newest = null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isDirectory()) continue;
    if (!entry.name.endsWith(extension)) continue;
    const fullPath = path.join(entry.path ?? dir, entry.name);
    const stat = fs.statSync(fullPath);
    if (stat.mtimeMs < newerThanMs) continue; // ignore stale files from earlier runs
    if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { fullPath, mtimeMs: stat.mtimeMs };
  }
  return newest?.fullPath ?? null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Generate an image by running Codex CLI's built-in image_gen tool — via the same
// shared terminal session the browser's embedded terminal shows for this project
// (see terminal.js), so generation is visible instead of an invisible background call.
export async function generateImageViaCodex(projectId, prompt, referenceImages = []) {
  const workDir = path.join(PROJECTS_DIR, projectId, ".tmp", nanoid(8));
  fs.mkdirSync(workDir, { recursive: true });
  const startedAtMs = Date.now();

  try {
    const refPaths = referenceImages.map((buf, i) => {
      const refPath = path.join(workDir, `ref_${i}.png`);
      fs.writeFileSync(refPath, buf);
      return refPath;
    });

    const outPath = path.join(workDir, `out_${nanoid(8)}.png`);
    const refNote = refPaths.length
      ? ` Use these images as visual references for consistency: ${refPaths.join(", ")}.`
      : "";
    // Left ambiguous, Codex sometimes writes Python/PIL code to draw the image itself
    // instead of calling its built-in image generation tool — explicitly forbid that.
    const fullPrompt =
      `Use your built-in image generation tool (image_gen) to generate an image — ` +
      `do not write code (e.g. PIL/matplotlib/SVG) to draw it yourself. ` +
      `Prompt for the tool: ${prompt}.${refNote} ` +
      `Save the PNG to ${outPath} and reply with only the absolute file path.`;

    const command = [
      "codex",
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "--cd",
      shellQuote(workDir),
      shellQuote(fullPrompt),
    ].join(" ");

    runInProjectTerminal(projectId, command);

    // A live shell has no clean "command finished" signal the way a spawned child
    // process does — so we detect completion by polling for the output file instead.
    const deadline = startedAtMs + CODEX_TIMEOUT_MS;
    let finalPath = null;
    while (Date.now() < deadline) {
      if (fs.existsSync(outPath)) {
        finalPath = outPath;
        break;
      }
      // Codex writes to its own generated_images dir first, then copies to our
      // requested path — that copy can be dropped if its final response gets
      // truncated. Fall back to the newest matching file since this request started.
      const fallback = newestFileUnder(path.join(os.homedir(), ".codex", "generated_images"), ".png", startedAtMs);
      if (fallback) {
        finalPath = fallback;
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }

    if (!finalPath) {
      throw new CodexError("codex exec did not produce an image file in time");
    }
    return fs.readFileSync(finalPath);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
