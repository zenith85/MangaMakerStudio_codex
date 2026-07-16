import { useState } from "react";

export const SHAPES = [
  { value: "oval", label: "Oval" },
  { value: "rectangle", label: "Rect" },
  { value: "star", label: "Star" },
  { value: "thought", label: "Thought" },
];

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
    shape: "oval",
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

// Star and thought are the same "alternating outer/inner radius" construction — star
// uses a big depth difference for sharp jagged spikes (the classic manga "shout"
// bubble), thought a shallow one with more, smaller bumps for a scalloped cloud outline
// (the classic "thinking" bubble) instead of the star's plain 5-point look, which reads
// as too generic/decorative for that use.
function scallopedBoundary(bumps, outerR, innerR) {
  const pts = [];
  for (let i = 0; i < bumps * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI * i) / bumps;
    pts.push({ x: 50 + r * Math.sin(angle), y: 50 - r * Math.cos(angle) });
  }
  return pts;
}

function boundaryFor(shape) {
  if (shape === "rectangle") return rectangleBoundary();
  if (shape === "star") return scallopedBoundary(12, 50, 32);
  if (shape === "thought") return scallopedBoundary(16, 50, 42);
  return ellipseBoundary();
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
function boundaryPointAtAngle(boundary, angle) {
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
function outlineWithTail(boundary, bubble) {
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

function pointsToString(pts) {
  return pts.map((p) => `${p.x},${p.y}`).join(" ");
}

function pointsToClipPath(pts) {
  return `polygon(${pts.map((p) => `${p.x}% ${p.y}%`).join(", ")})`;
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
        const nx = clamp(startX + dxPct, 0, 100 - bubble.width);
        const ny = clamp(startY + dyPct, 0, 100 - bubble.height);
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
        const nw = clamp(startW + dwPct, 8, 100 - bubble.x);
        const nh = clamp(startH + dhPct, 8, 100 - bubble.y);
        lastPatch = { width: nw, height: nh };
        onChange(lastPatch, { commit: false });
      },
      () => onChange(lastPatch, { commit: true })
    );
  };

  const dragTail = (e) => {
    const rect = containerRect();
    let lastPatch = {};
    startPointerDrag(
      e,
      (ev) => {
        const nx = clamp(((ev.clientX - rect.left) / rect.width) * 100, 0, 100);
        const ny = clamp(((ev.clientY - rect.top) / rect.height) * 100, 0, 100);
        lastPatch = { tail: { x: nx, y: ny } };
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
  };
  const boundary = boundaryFor(bubble.shape);
  const outline = outlineWithTail(boundary, bubble);

  return (
    <>
      <div
        className={`bubble${editable ? " editable" : ""}`}
        style={outerStyle}
        onPointerDown={editable && !editingText ? moveBody : undefined}
        onDoubleClick={editable ? () => setEditingText(true) : undefined}
      >
        <svg className="bubble-outline" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon points={pointsToString(outline)} vectorEffect="non-scaling-stroke" />
        </svg>

        <div className="bubble-text-clip" style={{ clipPath: pointsToClipPath(boundary) }}>
          {editingText ? (
            <textarea
              className="bubble-text-input"
              defaultValue={bubble.text}
              autoFocus
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => commitText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditingText(false);
              }}
            />
          ) : (
            <div className="bubble-text">{bubble.text}</div>
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

      {editable && bubble.tail && (
        <div
          className="bubble-tail-handle"
          style={{ left: `${bubble.tail.x}%`, top: `${bubble.tail.y}%` }}
          onPointerDown={dragTail}
        />
      )}
    </>
  );
}
