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
//
// outputPath, when given, is the REAL final destination (e.g. a character's
// characters/<id>/image.png or a panel's image.png) — Codex is told to save straight
// there, no separate temp file that then gets copied into place. When outputPath is
// null (the panel-edit preview endpoint), there is no permanent destination yet — the
// caller only wants the raw bytes back to show a before/after, and discards them if
// the user rejects the edit — so a scratch file is still used for that case.
//
// A small per-call scratch folder is still needed regardless, only to hold copies of
// the reference input images Codex reads from (and, when outputPath is null, the
// generated output itself) — it's deleted after every call either way.
export async function generateImageViaCodex(projectId, outputPath, prompt, referenceImages = []) {
  const projectDir = path.join(PROJECTS_DIR, projectId);
  const scratchDir = path.join(projectDir, ".tmp", nanoid(8));
  fs.mkdirSync(scratchDir, { recursive: true });
  const startedAtMs = Date.now();

  try {
    const refPaths = referenceImages.map((buf, i) => {
      const refPath = path.join(scratchDir, `ref_${i}.png`);
      fs.writeFileSync(refPath, buf);
      return refPath;
    });

    const finalPath = outputPath ?? path.join(scratchDir, `out_${nanoid(8)}.png`);
    if (outputPath) fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const refNote = refPaths.length
      ? ` Use these images as visual references for consistency: ${refPaths.join(", ")}.`
      : "";
    // Left ambiguous, Codex sometimes writes Python/PIL code to draw the image itself
    // instead of calling its built-in image generation tool — explicitly forbid that.
    const fullPrompt =
      `Use your built-in image generation tool (image_gen) to generate an image — ` +
      `do not write code (e.g. PIL/matplotlib/SVG) to draw it yourself. ` +
      `Prompt for the tool: ${prompt}.${refNote} ` +
      `Save the PNG to ${finalPath} and reply with only the absolute file path.`;

    const command = [
      "codex",
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "--cd",
      // Scoped to the whole project dir (not just scratchDir) so the sandbox's
      // workspace-write permission covers writing directly to finalPath too, when
      // finalPath lives elsewhere under this project (e.g. characters/<id>/image.png).
      shellQuote(projectDir),
      shellQuote(fullPrompt),
    ].join(" ");

    runInProjectTerminal(projectId, command);

    // A live shell has no clean "command finished" signal the way a spawned child
    // process does — so we detect completion by polling for the output file instead.
    const deadline = startedAtMs + CODEX_TIMEOUT_MS;
    let readPath = null;
    while (Date.now() < deadline) {
      // mtime check matters when finalPath is a redraw target that already had an
      // image before this call started — plain existsSync would be true instantly.
      if (fs.existsSync(finalPath) && fs.statSync(finalPath).mtimeMs >= startedAtMs) {
        readPath = finalPath;
        break;
      }
      // Codex writes to its own generated_images dir first, then copies to our
      // requested path — that copy can be dropped if its final response gets
      // truncated. Fall back to the newest matching file since this request started.
      const fallback = newestFileUnder(path.join(os.homedir(), ".codex", "generated_images"), ".png", startedAtMs);
      if (fallback) {
        if (outputPath) fs.copyFileSync(fallback, finalPath);
        readPath = outputPath ? finalPath : fallback;
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }

    if (!readPath) {
      throw new CodexError("codex exec did not produce an image file in time");
    }
    return fs.readFileSync(readPath);
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

// Batch-translates an array of manga speech-bubble texts via Codex CLI — same shared
// terminal + poll-for-output-file mechanism as generateImageViaCodex above, since a live
// PTY has no clean "done" signal to hook a return value onto. Codex is asked to write a
// JSON array (same order, same length) to a scratch file rather than just printing to
// the terminal, since nothing here parses the terminal's own output stream.
export async function translateTextsViaCodex(projectId, texts, targetLanguageName) {
  if (texts.length === 0) return [];
  const projectDir = path.join(PROJECTS_DIR, projectId);
  const scratchDir = path.join(projectDir, ".tmp", nanoid(8));
  fs.mkdirSync(scratchDir, { recursive: true });
  const startedAtMs = Date.now();

  try {
    const inputPath = path.join(scratchDir, "input.json");
    const outputPath = path.join(scratchDir, "output.json");
    fs.writeFileSync(inputPath, JSON.stringify(texts, null, 2));

    const fullPrompt =
      `Read the JSON array of strings at ${inputPath} — each string is one manga speech-bubble's ` +
      `dialogue, in order. Translate every single one into natural, concise ${targetLanguageName} ` +
      `suitable for manga/comic dialogue (keep the tone, register, and punctuation style; keep it ` +
      `punchy, not overly formal). Write a JSON array of the exact same length, in the exact same ` +
      `order, containing ONLY the translated strings as plain JSON strings (no extra keys, no ` +
      `commentary, no markdown code fences) to ${outputPath}. Reply with only the absolute file path.`;

    const command = [
      "codex",
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "--cd",
      shellQuote(projectDir),
      shellQuote(fullPrompt),
    ].join(" ");

    runInProjectTerminal(projectId, command);

    const deadline = startedAtMs + CODEX_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).mtimeMs >= startedAtMs) break;
      await sleep(POLL_INTERVAL_MS);
    }
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).mtimeMs < startedAtMs) {
      throw new CodexError("codex exec did not produce a translation file in time");
    }

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    } catch {
      throw new CodexError("codex exec produced invalid JSON for the translation");
    }
    if (!Array.isArray(parsed) || parsed.length !== texts.length) {
      throw new CodexError("codex exec returned a translation array of the wrong length");
    }
    return parsed.map((s) => String(s));
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}
