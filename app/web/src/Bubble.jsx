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

// Clip-path for shapes that aren't a plain rect/ellipse. Both are the same "alternate
// outer/inner radius around a circle" construction — star uses a big depth difference
// for sharp jagged spikes (the classic manga "shout" bubble), thought uses a shallow
// one with more, smaller bumps for a scalloped cloud outline (the classic "thinking"
// bubble) instead of the star's plain 5-point look, which reads as too generic.
function scallopedPolygon(bumps, outerR, innerR) {
  const points = [];
  for (let i = 0; i < bumps * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI * i) / bumps;
    const x = 50 + r * Math.sin(angle);
    const y = 50 - r * Math.cos(angle);
    points.push(`${x}% ${y}%`);
  }
  return `polygon(${points.join(", ")})`;
}

function clipPathFor(shape) {
  if (shape === "star") return scallopedPolygon(12, 50, 32);
  if (shape === "thought") return scallopedPolygon(16, 50, 42);
  return undefined;
}

// Where the tail attaches to the bubble: the point where a ray from the bubble's
// center toward the tail tip exits its bounding box.
function tailBasePoint(bubble) {
  const cx = bubble.x + bubble.width / 2;
  const cy = bubble.y + bubble.height / 2;
  const dx = bubble.tail.x - cx;
  const dy = bubble.tail.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = bubble.width / 2;
  const hh = bubble.height / 2;
  const scale = Math.min(dx !== 0 ? Math.abs(hw / dx) : Infinity, dy !== 0 ? Math.abs(hh / dy) : Infinity);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function tailPolygonPoints(bubble, base) {
  const dx = bubble.tail.x - base.x;
  const dy = bubble.tail.y - base.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const spread = 4; // percent, half-width of the tail's base
  const p1 = { x: base.x + nx * spread, y: base.y + ny * spread };
  const p2 = { x: base.x - nx * spread, y: base.y - ny * spread };
  return `${p1.x},${p1.y} ${p2.x},${p2.y} ${bubble.tail.x},${bubble.tail.y}`;
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

  // The clip-path/border-radius shape lives on an inner div, never on the outer
  // positioning box — clip-path clips its own descendants too (unlike overflow), which
  // would silently make the toolbar/handles unclickable once a non-rectangular shape
  // (star) is selected.
  const outerStyle = {
    left: `${bubble.x}%`,
    top: `${bubble.y}%`,
    width: `${bubble.width}%`,
    height: `${bubble.height}%`,
  };
  const shapeStyle = {
    borderRadius: bubble.shape === "oval" ? "50%" : bubble.shape === "rectangle" ? "10px" : undefined,
    clipPath: clipPathFor(bubble.shape),
  };

  const tailBase = bubble.tail ? tailBasePoint(bubble) : null;

  return (
    <>
      {bubble.tail && (
        <svg className="bubble-tail" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon points={tailPolygonPoints(bubble, tailBase)} />
        </svg>
      )}

      <div
        className={`bubble${editable ? " editable" : ""}`}
        style={outerStyle}
        onPointerDown={editable && !editingText ? moveBody : undefined}
        onDoubleClick={editable ? () => setEditingText(true) : undefined}
      >
        <div className="bubble-shape" style={shapeStyle}>
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
