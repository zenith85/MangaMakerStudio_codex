import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { runInProjectTerminal } from "./terminal.js";
import { CodexError } from "./codex.js";
import { bookProjectDirForCodex } from "./bookStore.js";

// Same shellQuote/poll-for-output-file approach as codex.js's own functions (kept as a
// separate copy here, not imported, so nothing in codex.js — Manga Studio's file — ever
// needs to change to support HTML Shorts Maker).
function shellQuote(value) {
  const str = String(value);
  if (process.platform === "win32") {
    return `'${str.replace(/'/g, "''")}'`;
  }
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CODEX_TIMEOUT_MS = 8 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;

// Curates the full text content of an HTML Shorts Maker book (see bookPrompt.js for
// the exact JSON shape) via Codex CLI, in the project's own shared terminal session
// (same mechanism as codex.js's generateImageViaCodex/translateTextsViaCodex) so it's
// visible there too. `prompt` is already fully built (see buildBookContentPrompt).
export async function generateBookContentViaCodex(projectId, prompt) {
  const projectDir = bookProjectDirForCodex(projectId);
  const scratchDir = path.join(projectDir, ".tmp", nanoid(8));
  fs.mkdirSync(scratchDir, { recursive: true });
  const startedAtMs = Date.now();

  try {
    const outputPath = path.join(scratchDir, "book.json");
    const fullPrompt =
      `${prompt}\n\nWrite ONLY that JSON object (no markdown code fences, no commentary) to ${outputPath}. ` +
      `Reply with only the absolute file path.`;

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
      throw new CodexError("codex exec did not produce the book content in time");
    }

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    } catch {
      throw new CodexError("codex exec produced invalid JSON for the book content");
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.chapters) || !parsed.chapters.length) {
      throw new CodexError("codex exec returned book content missing a chapters array");
    }
    return parsed;
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}
