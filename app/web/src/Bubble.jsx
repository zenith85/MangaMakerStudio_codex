import { useState } from "react";

export const SHAPES = [
  { value: "speaking", label: "Speaking" },
  { value: "thinking", label: "Thinking" },
  { value: "whisper", label: "Whisper" },
  { value: "yell", label: "Yell" },
  { value: "scream", label: "Scream" },
  { value: "harder", label: "Harder!" },
  { value: "spooky", label: "Spooky" },
  { value: "digital", label: "Digital" },
  { value: "dreamy", label: "Dreamy" },
  { value: "caption", label: "Caption" },
  { value: "noiseLoud", label: "Noise (Loud)" },
  { value: "noiseNormal", label: "Noise (Normal)" },
  { value: "noiseAscend", label: "Noise (Ascend)" },
];

// Old shape values from before this library expanded — resolved everywhere shape is
// read, not migrated on disk, so bubbles saved with the old names keep rendering
// correctly without a data migration.
const SHAPE_ALIASES = { oval: "speaking", rectangle: "caption", star: "scream", thought: "thinking" };
export function resolveShape(shape) {
  return SHAPE_ALIASES[shape] || shape;
}

// Shapes whose tail is conventionally a chain of shrinking trailing dots rather than a
// single pointed spike (thought/dreamy bubbles, and the drips on a "spooky" one).
const DOT_TAIL_SHAPES = new Set(["thinking", "dreamy", "spooky"]);
export function tailStyleFor(shape) {
  return DOT_TAIL_SHAPES.has(resolveShape(shape)) ? "dots" : "spike";
}

const DASHED_SHAPES = new Set(["whisper"]);
export function isDashed(shape) {
  return DASHED_SHAPES.has(resolveShape(shape));
}

// Ambient sound-effect lettering (onomatopoeia like "BOOM" or "POW") — unlike dialogue,
// these sit directly on the panel art with no bubble around them at all, so their outline
// polygon is only used for text clipping/tail placement and must render with no fill or
// stroke of its own (see the .bubble-text-noise-* CSS classes for the bold-outline look,
// and precropBubbleOutlines in App.jsx, which must skip painting these during PDF export).
const NO_BACKGROUND_SHAPES = new Set(["noiseLoud", "noiseNormal", "noiseAscend"]);
export function hasNoBackground(shape) {
  return NO_BACKGROUND_SHAPES.has(resolveShape(shape));
}

// Which of the noise styles' bold-outline treatment (weight/stroke — see index.css) a
// bubble's text should get. Non-noise shapes get none, so their text stays solid, sitting
// on the bubble's own fill.
const NOISE_TEXT_CLASS = {
  noiseLoud: "bubble-text-noise-loud",
  noiseNormal: "bubble-text-noise-normal",
  noiseAscend: "bubble-text-noise-ascend",
};
export function noiseTextClass(shape) {
  return NOISE_TEXT_CLASS[resolveShape(shape)] || "";
}

// "Ascend" grows each successive letter of a noise bubble's text, so a word like "Hello"
// reads H < e < l < l < o — the comic convention for a sound building as it goes. Growth
// is capped so a long sentence typed into an ascend bubble doesn't run away in size.
export function isAscendShape(shape) {
  return resolveShape(shape) === "noiseAscend";
}
const ASCEND_GROWTH_PER_CHAR = 0.16;
const ASCEND_MAX_MULTIPLIER = 2.6;
export function ascendFontSize(baseSize, charIndex) {
  return baseSize * Math.min(1 + charIndex * ASCEND_GROWTH_PER_CHAR, ASCEND_MAX_MULTIPLIER);
}

// Splits ascend text into per-line, per-character spans, each sized by its position in
// the overall sequence (not reset per line) so growth carries across a wrapped/multi-line
// bubble. Each line is its own block so newlines still break the line, same as plain text.
export function renderAscendText(text, baseSize) {
  let globalIndex = 0;
  return text.split("\n").map((line, lineIdx) => (
    <span className="bubble-text-ascend-line" key={lineIdx}>
      {Array.from(line).map((ch, charIdx) => {
        const size = ascendFontSize(baseSize, globalIndex);
        globalIndex += 1;
        return (
          <span key={charIdx} style={{ fontSize: `${size}px` }}>
            {ch === " " ? " " : ch}
          </span>
        );
      })}
    </span>
  ));
}

// Free (SIL OFL / Apache 2.0), self-hosted under public/fonts — see public/fonts/LICENSES
// — so bubbles render consistently offline instead of depending on a fonts CDN.
export const FONTS = [
  { value: "comicneue", label: "Comic Neue", family: "'Comic Neue', sans-serif" },
  { value: "bangers", label: "Bangers", family: "'Bangers', cursive" },
  { value: "permanentmarker", label: "Permanent Marker", family: "'Permanent Marker', cursive" },
  { value: "shojumaru", label: "Shojumaru", family: "'Shojumaru', cursive" },
  { value: "reggaeone", label: "Reggae One", family: "'Reggae One', cursive" },
];

export function fontFamilyFor(fontValue) {
  return FONTS.find((f) => f.value === fontValue)?.family ?? FONTS[0].family;
}

// Matches the size .bubble-text/.bubble-text-input used before this was adjustable.
export const DEFAULT_FONT_SIZE = 13;

// A sensible default tail point when turning a bubble's tail back on — just below its
// center. Shared so the sidebar's "No tail" toggle (App.jsx) computes the same default
// this component used to when the toggle lived on-canvas.
export function defaultTailFor(bubble) {
  return { x: clamp(bubble.x + bubble.width / 2, 0, 100), y: clamp(bubble.y + bubble.height + 8, 0, 100) };
}

export function newBubble() {
  return {
    id: crypto.randomUUID(),
    text: "New text",
    shape: "speaking",
    font: "comicneue",
    x: 30,
    y: 10,
    width: 35,
    height: 20,
    tail: { x: 20, y: 32 },
  };
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// Every shape is described as a list of {x,y} points (percent, in the bubble's own
// 0-100 local box) tracing its outline — an ellipse and a scalloped cloud are just
// sampled more finely than a plain rectangle. Keeping them all as point lists (rather
// than CSS border-radius/clip-path) is what makes it possible to splice the tail
// directly into the same outline below, instead of drawing it as a separate shape that
// only approximately lines up with the bubble's edge.
function ellipseBoundary(n = 64) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push({ x: 50 + 50 * Math.sin(a), y: 50 - 50 * Math.cos(a) });
  }
  return pts;
}

function rectangleBoundary() {
  return [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
}

// A sharp jagged burst — straight edges alternating between an outer and inner radius,
// so each bump comes to an actual point. Used for scream/harder, which should look
// spiky, not soft.
function scallopedBoundary(bumps, outerR, innerR) {
  const pts = [];
  for (let i = 0; i < bumps * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI * i) / bumps;
    pts.push({ x: 50 + r * Math.sin(angle), y: 50 - r * Math.cos(angle) });
  }
  return pts;
}

// A genuine cloud outline: `bumpCount` circles of radius `bumpR`, evenly spaced around
// a base circle of radius `baseR`, traced along their union's outer edge (for each
// sampled angle, the farthest point where a ray from center exits any of the circles).
// A single cosine harmonic instead of this would vary the radius continuously too, but
// still comes to flower-like cusps between lobes rather than true rounded valleys —
// this is what real thought/dreamy cloud bubbles actually look like.
function cloudBoundary(bumpCount, baseR, bumpR, n = 160) {
  const centers = [];
  for (let i = 0; i < bumpCount; i++) {
    const a = (2 * Math.PI * i) / bumpCount;
    centers.push({ cx: baseR * Math.sin(a), cy: -baseR * Math.cos(a), r: bumpR });
  }
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    let maxT = 0;
    for (const c of centers) {
      const dot = dx * c.cx + dy * c.cy;
      const distSq = c.cx * c.cx + c.cy * c.cy;
      const disc = dot * dot - (distSq - c.r * c.r);
      if (disc < 0) continue;
      const t = dot + Math.sqrt(disc);
      if (t > maxT) maxT = t;
    }
    pts.push({ x: 50 + dx * maxT, y: 50 + dy * maxT });
  }
  return pts;
}

// An irregular, hand-drawn-looking wobble for the "spooky" shape — a sum of a few sine
// harmonics at different frequencies/phases, so it looks organic rather than a
// perfectly repeating pattern (which scallopedBoundary would give).
function wobblyBoundary(n = 72) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    const r = 50 + 6 * Math.sin(a * 5) + 3 * Math.sin(a * 9 + 1.3) + 2 * Math.sin(a * 13 + 2.7);
    pts.push({ x: 50 + r * Math.sin(a), y: 50 - r * Math.cos(a) });
  }
  return pts;
}

// A rectangle with small square notches stepped into each edge, for a glitchy
// "digital" look instead of a plain caption box. Rendered with a miter join (see
// isSharpCornered) so the steps read as actual right angles, not a soft wave.
function steppedRectangleBoundary(segmentsPerEdge = 4, notchDepth = 9) {
  const corners = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const pts = [];
  for (let c = 0; c < 4; c++) {
    const p1 = corners[c];
    const p2 = corners[(c + 1) % 4];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let s = 0; s < segmentsPerEdge; s++) {
      const t = s / segmentsPerEdge;
      const bx = p1.x + dx * t;
      const by = p1.y + dy * t;
      const step = s % 2 === 1 ? notchDepth : 0;
      pts.push({ x: bx + nx * step, y: by + ny * step });
    }
  }
  return pts;
}

export function boundaryFor(shape) {
  switch (resolveShape(shape)) {
    case "caption":
    case "noiseLoud":
    case "noiseNormal":
    case "noiseAscend":
      return rectangleBoundary();
    case "digital":
      return steppedRectangleBoundary();
    case "yell":
      return scallopedBoundary(9, 50, 36);
    case "scream":
      return scallopedBoundary(12, 50, 30);
    case "harder":
      return scallopedBoundary(15, 50, 26);
    case "thinking":
      return cloudBoundary(7, 26, 24);
    case "dreamy":
      return cloudBoundary(5, 20, 28);
    case "spooky":
      return wobblyBoundary();
    default: // speaking, whisper
      return ellipseBoundary();
  }
}

// Sharp/jagged shapes need a miter join so their points and steps read as crisp corners
// — the round join used everywhere else (so it doesn't look like a rendering glitch on
// smooth shapes) would blunt them into a soft blob, especially at small preview sizes.
const SHARP_JOIN_SHAPES = new Set(["yell", "scream", "harder", "digital"]);
export function isSharpCornered(shape) {
  return SHARP_JOIN_SHAPES.has(resolveShape(shape));
}

function normalizeAngle(a) {
  const twoPi = Math.PI * 2;
  return ((a % twoPi) + twoPi) % twoPi;
}

function angleOf(p) {
  return normalizeAngle(Math.atan2(p.y - 50, p.x - 50));
}

// Finds where a ray from the shape's center at `angle` crosses its boundary, by finding
// which two consecutive sampled points bracket that angle and interpolating between
// them. This works for any "star-shaped" boundary — one where every ray from the center
// crosses it exactly once — which is true of all four bubble shapes here.
export function boundaryPointAtAngle(boundary, angle) {
  const target = normalizeAngle(angle);
  const n = boundary.length;
  for (let i = 0; i < n; i++) {
    const a1 = angleOf(boundary[i]);
    const a2 = angleOf(boundary[(i + 1) % n]);
    let span = a2 - a1;
    if (span <= 0) span += Math.PI * 2;
    let offset = target - a1;
    if (offset < 0) offset += Math.PI * 2;
    if (offset <= span) {
      const t = span === 0 ? 0 : offset / span;
      const p1 = boundary[i];
      const p2 = boundary[(i + 1) % n];
      return { afterIndex: i, point: { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t } };
    }
  }
  return { afterIndex: n - 1, point: boundary[0] };
}

// Splices the tail directly into the shape's boundary, as a spike inserted right where
// a ray toward the tail tip crosses the outline — one continuous outline for the whole
// bubble, tail included, instead of a separate triangle glued behind it.
export function outlineWithTail(boundary, bubble) {
  if (!bubble.tail) return boundary;

  const tlx = ((bubble.tail.x - bubble.x) / bubble.width) * 100;
  const tly = ((bubble.tail.y - bubble.y) / bubble.height) * 100;
  const angle = Math.atan2(tly - 50, tlx - 50);
  const { afterIndex, point: base } = boundaryPointAtAngle(boundary, angle);

  const p1 = boundary[afterIndex];
  const p2 = boundary[(afterIndex + 1) % boundary.length];
  const ex = p2.x - p1.x;
  const ey = p2.y - p1.y;
  const elen = Math.hypot(ex, ey) || 1;
  const ux = ex / elen;
  const uy = ey / elen;
  const spread = 6; // percent, half-width of the tail's base along the boundary
  const left = { x: base.x - ux * spread, y: base.y - uy * spread };
  const right = { x: base.x + ux * spread, y: base.y + uy * spread };
  const tip = { x: tlx, y: tly };

  return [...boundary.slice(0, afterIndex + 1), left, tip, right, ...boundary.slice(afterIndex + 1)];
}

// Three shrinking dots leading from the bubble's edge to the tail tip — the
// thought/dreamy/spooky convention, instead of a spike merged into the outline.
export function dotTrailPoints(boundary, bubble, steps = 3) {
  if (!bubble.tail) return [];
  const tlx = ((bubble.tail.x - bubble.x) / bubble.width) * 100;
  const tly = ((bubble.tail.y - bubble.y) / bubble.height) * 100;
  const angle = Math.atan2(tly - 50, tlx - 50);
  const { point: base } = boundaryPointAtAngle(boundary, angle);

  const dots = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    dots.push({
      x: base.x + (tlx - base.x) * t,
      y: base.y + (tly - base.y) * t,
      r: 5 - 3 * t,
    });
  }
  return dots;
}

export function pointsToString(pts) {
  return pts.map((p) => `${p.x},${p.y}`).join(" ");
}

function pointsToClipPath(pts) {
  return `polygon(${pts.map((p) => `${p.x}% ${p.y}%`).join(", ")})`;
}

// Rotates point `p` around `center` by `deg` (screen-space convention: x right, y down —
// matches everywhere else in this app that rotates a point, e.g. the panel image editor).
function rotateAroundPoint(p, center, deg) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

// Wraps a degree value into (-180, 180] — used for the rotate handle, so dragging
// past the seam (e.g. from 179° to -179°) reads as a small step rather than a 358° jump.
// Exported so the sidebar's numeric input can show old bubbles saved with an unsigned
// 0-270 value (from the bubble's previous 90°-step-only button) in the same -180..180
// range the input now uses, instead of jumping to a big number the first time it's opened.
export function normalizeSignedDegrees(deg) {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

function startPointerDrag(e, onMove, onEnd) {
  e.preventDefault();
  e.stopPropagation();
  const move = (ev) => onMove(ev);
  const up = (ev) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    onEnd?.(ev);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

// One speech bubble, absolutely positioned (in percent of the panel) over the panel
// image. Read-only when `editable` is false (viewing the page); when true — the panel
// is the one currently open in the editor — it can be dragged, resized, have its tail
// aimed by dragging the tail tip, and have its text edited in place via double-click.
export default function Bubble({ bubble, containerRef, editable, onChange, onDelete }) {
  const [editingText, setEditingText] = useState(false);

  const containerRect = () => containerRef.current.getBoundingClientRect();

  const moveBody = (e) => {
    const rect = containerRect();
    const startX = bubble.x;
    const startY = bubble.y;
    const startTail = bubble.tail;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    // Track the last computed patch and send it (not an empty {}) on drag-end — the
    // window-level pointerup listener holds a closure from before the drag started, so
    // an empty "just persist what's already live" patch would apply on top of that
    // stale bubble state and silently revert the move.
    let lastPatch = {};
    startPointerDrag(
      e,
      (ev) => {
        const dxPct = ((ev.clientX - startClientX) / rect.width) * 100;
        const dyPct = ((ev.clientY - startClientY) / rect.height) * 100;
        // Up to half the bubble is allowed to hang off any edge — comic bubbles/SFX
        // routinely bleed off a panel's edge, and strictly confining the whole box left
        // no room for that (nor any margin for error reaching the boundary exactly).
        const nx = clamp(startX + dxPct, -bubble.width / 2, 100 - bubble.width / 2);
        const ny = clamp(startY + dyPct, -bubble.height / 2, 100 - bubble.height / 2);
        lastPatch = { x: nx, y: ny };
        if (startTail) {
          lastPatch.tail = { x: clamp(startTail.x + (nx - startX), 0, 100), y: clamp(startTail.y + (ny - startY), 0, 100) };
        }
        onChange(lastPatch, { commit: false });
      },
      () => onChange(lastPatch, { commit: true })
    );
  };

  const resize = (e) => {
    const rect = containerRect();
    const startW = bubble.width;
    const startH = bubble.height;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    let lastPatch = {};
    startPointerDrag(
      e,
      (ev) => {
        const dwPct = ((ev.clientX - startClientX) / rect.width) * 100;
        const dhPct = ((ev.clientY - startClientY) / rect.height) * 100;
        // Not capped by position (100 - bubble.x/y) any more — that tied how big a bubble
        // could grow to where it happened to be sitting, stopping it well short of full
        // size for anything not already near the top-left corner. Now it can grow up to
        // the full size of the panel from wherever it starts; moveBody above is what lets
        // the resulting box hang off an edge if that makes it too big to fit in place.
        const nw = clamp(startW + dwPct, 8, 100);
        const nh = clamp(startH + dhPct, 8, 100);
        lastPatch = { width: nw, height: nh };
        onChange(lastPatch, { commit: false });
      },
      () => onChange(lastPatch, { commit: true })
    );
  };

  // The tail is stored as if the bubble were unrotated — the visible (rotated) tail
  // handle is derived from it for rendering (see displayTail below), so dragging it has
  // to go the other way: convert the screen-space point the user is actually pointing at
  // back into that unrotated frame before storing it, or the stored tail would drift
  // further off with every drag once the bubble has any rotation applied.
  const rotate = bubble.rotate || 0;
  const center = { x: bubble.x + bubble.width / 2, y: bubble.y + bubble.height / 2 };

  const dragTail = (e) => {
    const rect = containerRect();
    let lastPatch = {};
    startPointerDrag(
      e,
      (ev) => {
        const nx = clamp(((ev.clientX - rect.left) / rect.width) * 100, 0, 100);
        const ny = clamp(((ev.clientY - rect.top) / rect.height) * 100, 0, 100);
        const stored = rotateAroundPoint({ x: nx, y: ny }, center, -rotate);
        lastPatch = { tail: stored };
        onChange(lastPatch, { commit: false });
      },
      () => onChange(lastPatch, { commit: true })
    );
  };

  // Lets the bubble's rotation be set by dragging a handle that orbits it, at any angle —
  // not just typing a number or stepping by 90°. The handle sits outside the rotated
  // .bubble div (see displayRotateHandle below), so unlike dragTail this reads the
  // pointer's angle around center directly: there's no separate rotation layer to undo,
  // since this IS the whole rotation now. +90 makes 0° read as "straight up", matching
  // where the handle starts and how displayRotateHandle positions it.
  const dragRotate = (e) => {
    const rect = containerRect();
    let lastPatch = {};
    startPointerDrag(
      e,
      (ev) => {
        const px = ((ev.clientX - rect.left) / rect.width) * 100;
        const py = ((ev.clientY - rect.top) / rect.height) * 100;
        const angleDeg = (Math.atan2(py - center.y, px - center.x) * 180) / Math.PI;
        const newRotate = Math.round(normalizeSignedDegrees(angleDeg + 90));
        lastPatch = { rotate: newRotate };
        onChange(lastPatch, { commit: false });
      },
      () => onChange(lastPatch, { commit: true })
    );
  };

  const commitText = (text) => {
    setEditingText(false);
    onChange({ text }, { commit: true });
  };

  // The outline (fill + border, tail spliced in) lives in an SVG, separate from the text
  // — clip-path (used to keep text from spilling into the shape's corners) clips its own
  // descendants too (unlike overflow), which would silently make the delete
  // button/resize handle unclickable if it were applied any higher up, on something
  // that also contains them.
  const outerStyle = {
    left: `${bubble.x}%`,
    top: `${bubble.y}%`,
    width: `${bubble.width}%`,
    height: `${bubble.height}%`,
    transform: rotate ? `rotate(${rotate}deg)` : undefined,
  };
  const boundary = boundaryFor(bubble.shape);
  const tailStyle = tailStyleFor(bubble.shape);
  const outline = tailStyle === "spike" ? outlineWithTail(boundary, bubble) : boundary;
  const dots = tailStyle === "dots" ? dotTrailPoints(boundary, bubble) : [];
  const dashed = isDashed(bubble.shape);
  const noBackground = hasNoBackground(bubble.shape);
  // font-weight: bold only has something to switch to on fonts that actually ship a bold
  // face (Comic Neue does; Bangers/Permanent Marker/Shojumaru/Reggae One are single-weight
  // display fonts with no bold variant to synthesize, so the browser renders them
  // identically either way) — a thin same-color text-stroke thickens the glyphs directly,
  // so Bold has a visible effect regardless of which font is picked. Noise bubbles already
  // render their own thick outline via .bubble-text-noise-* and set their own -webkit-text-
  // stroke, so this would just clobber that (inline style always wins over the class).
  const boldStroke = bubble.bold && !noBackground ? "0.6px currentColor" : undefined;
  // The tail-drag handle is a sibling of .bubble, not a child, so it isn't carried along
  // by that div's CSS rotation — its on-screen position has to be rotated to match by
  // hand (the inverse of what dragTail un-rotates when storing a new tail point).
  const displayTail = bubble.tail ? rotateAroundPoint(bubble.tail, center, rotate) : null;

  // The rotate handle has no stored position of its own (unlike the tail) — it just orbits
  // the bubble at a fixed radius, at the angle `rotate` itself represents. 0° sits straight
  // up (angle -90° in atan2's convention, where 0=right and 90=down), matching where
  // dragRotate reads it back from. Unlike displayTail, there's no separate layer to
  // compose with — this angle *is* the bubble's rotation — so no rotateAroundPoint needed.
  const rotateHandleRadius = Math.max(bubble.width, bubble.height) / 2 + 6;
  const rotateAngleRad = ((rotate - 90) * Math.PI) / 180;
  const displayRotateHandle = {
    x: center.x + rotateHandleRadius * Math.cos(rotateAngleRad),
    y: center.y + rotateHandleRadius * Math.sin(rotateAngleRad),
  };

  return (
    <>
      <div
        className={`bubble${editable ? " editable" : ""}`}
        style={outerStyle}
        onPointerDown={editable && !editingText ? moveBody : undefined}
        onDoubleClick={editable ? () => setEditingText(true) : undefined}
      >
        <svg className="bubble-outline" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon
            points={pointsToString(outline)}
            vectorEffect="non-scaling-stroke"
            strokeDasharray={dashed ? "5 4" : undefined}
            style={{
              ...(isSharpCornered(bubble.shape) ? { strokeLinejoin: "miter" } : null),
              ...(noBackground ? { fill: "none", stroke: "none" } : null),
            }}
          />
          {dots.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>

        <div className="bubble-text-clip" style={{ clipPath: pointsToClipPath(boundary) }}>
          {editingText ? (
            <textarea
              className="bubble-text-input"
              style={{
                fontFamily: fontFamilyFor(bubble.font),
                fontSize: `${bubble.fontSize || DEFAULT_FONT_SIZE}px`,
                fontWeight: bubble.bold ? "bold" : undefined,
                color: bubble.textColor || undefined,
                WebkitTextStroke: boldStroke,
              }}
              defaultValue={bubble.text}
              autoFocus
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => commitText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditingText(false);
              }}
            />
          ) : (
            <div
              className={`bubble-text${noiseTextClass(bubble.shape) ? ` ${noiseTextClass(bubble.shape)}` : ""}`}
              style={{
                fontFamily: fontFamilyFor(bubble.font),
                fontSize: `${bubble.fontSize || DEFAULT_FONT_SIZE}px`,
                fontWeight: bubble.bold ? "bold" : undefined,
                color: bubble.textColor || undefined,
                WebkitTextStroke: boldStroke,
              }}
            >
              {isAscendShape(bubble.shape)
                ? renderAscendText(bubble.text, bubble.fontSize || DEFAULT_FONT_SIZE)
                : bubble.text}
            </div>
          )}
        </div>

        {editable && !editingText && (
          <>
            <button className="bubble-delete" onPointerDown={(e) => e.stopPropagation()} onClick={onDelete}>
              ×
            </button>
            <div className="bubble-resize-handle" onPointerDown={resize} />
          </>
        )}
      </div>

      {editable && displayTail && (
        <div
          className="bubble-tail-handle"
          style={{ left: `${displayTail.x}%`, top: `${displayTail.y}%` }}
          onPointerDown={dragTail}
        />
      )}

      {editable && !editingText && (
        <div
          className="bubble-rotate-handle"
          style={{ left: `${displayRotateHandle.x}%`, top: `${displayRotateHandle.y}%` }}
          onPointerDown={dragRotate}
          title="Drag to rotate"
        >
          ↻
        </div>
      )}
    </>
  );
}
