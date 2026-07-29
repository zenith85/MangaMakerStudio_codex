import sharp from "sharp";

// A handful of classic manga/comic ink styles, each baked onto a panel's image as a
// derivative file (see store.js's filterImagePath/saveFilterImage) rather than replacing
// the original — same non-destructive on/off toggle for all of them, driven by
// panel.imageFilter + panel.imageFilterEnabled (see index.js's /filter route and
// withPanelImage). Every filter here takes a buffer and a small params object and returns
// a PNG buffer; applyImageFilter dispatches to the right one by name.

function mod(n, m) {
  return ((n % m) + m) % m;
}
function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// ---------- Screentone: classic halftone dot screen ----------
// Splits the (grayscaled) image into square cells and draws one black dot per cell whose
// AREA (not radius — real ink coverage is proportional to area) scales with how dark that
// cell's average pixel was. The dot's edge is anti-aliased over ~1px so even sub-pixel
// dots (small cellSize) show up as soft gray instead of vanishing outright, letting low
// cell sizes fade toward the original grayscale image rather than toward blank white.
const MIN_CELL_SIZE = 1;
const MAX_CELL_SIZE = 40;

export async function applyScreentone(buffer, { cellSize = 8 } = {}) {
  const size = Math.round(clamp(cellSize, MIN_CELL_SIZE, MAX_CELL_SIZE));

  const { data, info } = await sharp(buffer).rotate().grayscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const out = Buffer.alloc(width * height, 255);

  for (let cy = 0; cy < height; cy += size) {
    const ch = Math.min(size, height - cy);
    for (let cx = 0; cx < width; cx += size) {
      const cw = Math.min(size, width - cx);

      let sum = 0;
      for (let y = 0; y < ch; y++) {
        const rowOffset = (cy + y) * width + cx;
        for (let x = 0; x < cw; x++) sum += data[rowOffset + x];
      }
      const avg = sum / (cw * ch);
      const darkness = 1 - avg / 255;
      if (darkness <= 0) continue;

      const maxRadius = Math.min(cw, ch) / 2;
      const radius = Math.sqrt(darkness) * maxRadius;
      const centerX = cx + cw / 2;
      const centerY = cy + ch / 2;
      const rCeil = Math.ceil(radius) + 1;
      for (let dy = -rCeil; dy <= rCeil; dy++) {
        const py = Math.round(centerY + dy);
        if (py < 0 || py >= height) continue;
        for (let dx = -rCeil; dx <= rCeil; dx++) {
          const px = Math.round(centerX + dx);
          if (px < 0 || px >= width) continue;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const coverage = clamp(radius - dist + 0.5, 0, 1);
          if (coverage <= 0) continue;
          const idx = py * width + px;
          const value = Math.round(255 * (1 - coverage));
          if (value < out[idx]) out[idx] = value;
        }
      }
    }
  }

  return sharp(out, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

// ---------- Crosshatch: tiered pen-and-ink line hatching ----------
// Per-pixel (not per-cell — hatching follows fine grayscale detail better than a blocky
// average) diagonal/straight line grids, layered on top of each other as darkness rises:
// one direction for light-mid tones, a crossing second direction for mid-dark, then two
// more directions layered in for the darkest tones — the classic engraving/ink-hatching
// look of denser crossed lines standing in for shadow.
const MIN_SPACING = 3;
const MAX_SPACING = 30;

export async function applyCrosshatch(buffer, { spacing = 10 } = {}) {
  const s = Math.round(clamp(spacing, MIN_SPACING, MAX_SPACING));
  const lineWidth = Math.max(1, s / 3);

  const { data, info } = await sharp(buffer).rotate().grayscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const out = Buffer.alloc(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const darkness = 1 - data[idx] / 255;
      if (darkness < 0.2) {
        out[idx] = 255;
        continue;
      }
      let ink = mod(x + y, s) < lineWidth; // 45°, lightest hatched tier
      if (darkness >= 0.45) ink = ink || mod(x - y, s) < lineWidth; // crossing -45°
      if (darkness >= 0.65) ink = ink || mod(x, s) < lineWidth; // vertical
      if (darkness >= 0.85) ink = ink || mod(y, s) < lineWidth; // horizontal, darkest tier
      out[idx] = ink ? 0 : 255;
    }
  }

  return sharp(out, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

// ---------- Ink threshold: dithered high-contrast black & white ----------
// A flat brightness cutoff turns photos into featureless blobs of solid black/white — an
// ordered (Bayer 4x4) dither reproduces grayscale as a fine noisy stipple pattern instead,
// the "newspaper halftone print" look, while still being pure 1-bit ink. `threshold`
// (0-100, default 50) biases overall brightness before dithering, so it works like an
// ink-coverage knob: lower values are lighter/more selective, higher values bolder/darker.
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export async function applyInkThreshold(buffer, { threshold = 50 } = {}) {
  const bias = (clamp(threshold, 0, 100) - 50) / 100;

  const { data, info } = await sharp(buffer).rotate().grayscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const out = Buffer.alloc(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const value = clamp(data[idx] / 255 + bias, 0, 1);
      const ditherThreshold = (BAYER_4X4[y % 4][x % 4] + 0.5) / 16;
      out[idx] = value > ditherThreshold ? 255 : 0;
    }
  }

  return sharp(out, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

// ---------- Vignette: darkened edges/corners ----------
// The only filter here that stays in color (a lighting effect, not a line-art style
// conversion) — multiplies each pixel by a falloff based on its distance from center,
// `strength` (0-100) controlling how dark the corners get.
export async function applyVignette(buffer, { strength = 50 } = {}) {
  const strengthNorm = clamp(strength, 0, 100) / 100;

  const { data, info } = await sharp(buffer).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.from(data);

  const cx = width / 2;
  const cy = height / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
      const falloff = 1 - strengthNorm * dist * dist;
      const idx = (y * width + x) * channels;
      for (let c = 0; c < channels; c++) {
        out[idx + c] = clamp(Math.round(data[idx + c] * falloff), 0, 255);
      }
    }
  }

  return sharp(out, { raw: { width, height, channels } }).png().toBuffer();
}

export async function applyImageFilter(buffer, type, params = {}) {
  switch (type) {
    case "screentone":
      return applyScreentone(buffer, params);
    case "crosshatch":
      return applyCrosshatch(buffer, params);
    case "inkThreshold":
      return applyInkThreshold(buffer, params);
    case "vignette":
      return applyVignette(buffer, params);
    default:
      throw new Error(`unknown filter type: ${type}`);
  }
}
