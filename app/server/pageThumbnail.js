import sharp from "sharp";
import { listPages, loadPanelImage } from "./store.js";

// "Reference last page" (see the Scene tab's toggle in App.jsx) needs the previous
// page's overall look-and-feel handed to Codex as an extra reference image — but the
// full-resolution panel images from a whole page would be a lot of tokens for what's
// only meant as loose environment/continuity context, not a precise match target.
// This composites every panel's image on a page into one small grid and re-compresses
// it, so the whole page costs roughly what a single normal reference image would.
const CELL_SIZE = 240; // px per panel cell before the final downscale below
const MAX_OUTPUT_DIM = 720; // px — final composite is capped to this on its longer side

export async function composePageThumbnail(projectId, pageId) {
  const pages = listPages(projectId);
  const page = pages.find((p) => p.id === pageId);
  if (!page) return null;

  const allPanels = [...page.panels, ...(page.floatingPanels || [])];
  const buffers = allPanels.map((panel) => loadPanelImage(projectId, pageId, panel.id)).filter(Boolean);
  if (!buffers.length) return null;

  const cols = Math.ceil(Math.sqrt(buffers.length));
  const rows = Math.ceil(buffers.length / cols);

  const cells = await Promise.all(
    buffers.map((buf) => sharp(buf).resize(CELL_SIZE, CELL_SIZE, { fit: "cover" }).toBuffer())
  );
  const composite = cells.map((buf, i) => ({
    input: buf,
    left: (i % cols) * CELL_SIZE,
    top: Math.floor(i / cols) * CELL_SIZE,
  }));

  return sharp({
    create: { width: cols * CELL_SIZE, height: rows * CELL_SIZE, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite(composite)
    .resize(MAX_OUTPUT_DIM, MAX_OUTPUT_DIM, { fit: "inside" })
    .jpeg({ quality: 65 })
    .toBuffer();
}
