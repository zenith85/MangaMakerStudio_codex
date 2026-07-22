import { useState, useRef, useEffect } from "react";
import {
  SHAPES,
  resolveShape,
  boundaryFor,
  outlineWithTail,
  dotTrailPoints,
  tailStyleFor,
  isDashed,
  isSharpCornered,
  pointsToString,
  ascendFontSize,
} from "./Bubble";

// Noise/SFX shapes have no bubble outline at all (see hasNoBackground in Bubble.jsx) —
// an outline-only preview would render as literally nothing, so these show sample bold
// lettering instead, tuned to look like the real .bubble-text-noise-* CSS treatment, so
// Loud vs. Normal's outline weight actually reads as distinct in the dropdown.
const NOISE_PREVIEWS = {
  noiseLoud: { label: "BOOM", fontSize: 28, strokeWidth: 5, weight: 900 },
  noiseNormal: { label: "POW", fontSize: 24, strokeWidth: 2.5, weight: 700 },
};
// Ascend can't use a single fontSize like the other noise previews — its whole point is
// each letter growing past the last — so it gets its own branch below, one <tspan> per
// letter of the same demo word, each sized by the real growth formula (ascendFontSize).
const ASCEND_PREVIEW_LABEL = "BOOM";
const ASCEND_PREVIEW_BASE_SIZE = 12;

// A standalone rendering of a shape's outline (reusing the exact same boundary+tail
// geometry the real bubble uses), for showing what a shape actually looks like rather
// than making the user guess from a text label like "Scream" or "Dreamy". `withTail`
// draws a short demo tail — as a merged spike or trailing dots, whichever that shape
// actually uses — so the preview reads as a real speech bubble.
function ShapePreview({ shape, withTail, size }) {
  const resolved = resolveShape(shape);
  const noise = NOISE_PREVIEWS[resolved];
  if (noise) {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" style={{ overflow: "visible", flexShrink: 0 }}>
        <text
          x="50"
          y="60"
          textAnchor="middle"
          fontFamily="'Bangers', cursive"
          fontWeight={noise.weight}
          fontSize={noise.fontSize}
          paintOrder="stroke"
          fill="#ffffff"
          stroke="#1a1a1a"
          strokeWidth={noise.strokeWidth}
        >
          {noise.label}
        </text>
      </svg>
    );
  }
  if (resolved === "noiseAscend") {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" style={{ overflow: "visible", flexShrink: 0 }}>
        <text
          x="50"
          y="65"
          textAnchor="middle"
          fontFamily="'Bangers', cursive"
          fontWeight={700}
          paintOrder="stroke"
          fill="#ffffff"
          stroke="#1a1a1a"
          strokeWidth={2.5}
        >
          {Array.from(ASCEND_PREVIEW_LABEL).map((ch, i) => (
            <tspan key={i} fontSize={ascendFontSize(ASCEND_PREVIEW_BASE_SIZE, i)}>
              {ch}
            </tspan>
          ))}
        </text>
      </svg>
    );
  }

  const boundary = boundaryFor(shape);
  const demoBubble = { x: 0, y: 0, width: 100, height: 100, tail: withTail ? { x: 15, y: 135 } : null };
  const tailStyle = tailStyleFor(shape);
  const outline = withTail && tailStyle === "spike" ? outlineWithTail(boundary, demoBubble) : boundary;
  const dots = withTail && tailStyle === "dots" ? dotTrailPoints(boundary, demoBubble) : [];

  return (
    <svg width={size} height={size} viewBox="-15 -15 130 160" style={{ overflow: "visible", flexShrink: 0 }}>
      <polygon
        points={pointsToString(outline)}
        fill="white"
        stroke="#1a1a1a"
        strokeWidth="4"
        strokeLinejoin={isSharpCornered(shape) ? "miter" : "round"}
        strokeDasharray={isDashed(shape) ? "8 6" : undefined}
        vectorEffect="non-scaling-stroke"
      />
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="white" stroke="#1a1a1a" strokeWidth="4" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

// A dropdown: a trigger button showing the current choice (small preview + name), and a
// popover grid of every option (bigger preview + name) that opens on click and closes on
// pick. Same interaction as the page bar's "Change layout" picker, so choosing a bubble's
// shape or tail doesn't mean parsing a row of small icons — you open it, see real
// examples, and pick one.
function Dropdown({ triggerShape, triggerTail, triggerLabel, options, renderOption, isActive, onPick }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [open]);

  return (
    <div className="shape-dropdown" ref={rootRef}>
      <button type="button" className="shape-dropdown-trigger" onClick={() => setOpen((v) => !v)}>
        <ShapePreview shape={triggerShape} withTail={triggerTail} size={22} />
        <span>{triggerLabel}</span>
        <span className="shape-dropdown-caret">▾</span>
      </button>
      {open && (
        <div className="shape-dropdown-popover">
          <div className="shape-dropdown-grid">
            {options.map((opt) => {
              const { shape, withTail, label, value } = renderOption(opt);
              return (
                <button
                  key={label}
                  type="button"
                  className={isActive(opt) ? "active" : ""}
                  onClick={() => {
                    onPick(value);
                    setOpen(false);
                  }}
                >
                  <ShapePreview shape={shape} withTail={withTail} size={54} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// A binary on/off switch — the tail is just present or not, so a dropdown of two
// options was overkill; flipping a switch is quicker and reads at a glance.
function TailToggle({ hasTail, onToggle }) {
  return (
    <label className="tail-toggle">
      <span className="tail-toggle-label">Tail</span>
      <button
        type="button"
        role="switch"
        aria-checked={hasTail}
        className={`tail-toggle-switch${hasTail ? " on" : ""}`}
        onClick={() => onToggle(!hasTail)}
      >
        <span className="tail-toggle-knob" />
      </button>
    </label>
  );
}

// Lets you pick a bubble's shape from a dropdown — each option shows an actual rendered
// example instead of relying on a text label alone — and flip whether it has a tail at
// all with a simple switch.
export default function ShapePicker({ bubble, onSetShape, onSetTail }) {
  const resolved = resolveShape(bubble.shape);
  const currentShape = SHAPES.find((s) => s.value === resolved);
  const hasTail = !!bubble.tail;

  return (
    <div className="shape-picker">
      <Dropdown
        triggerShape={bubble.shape}
        triggerTail={hasTail}
        triggerLabel={currentShape?.label ?? "Shape"}
        options={SHAPES}
        renderOption={(s) => ({ shape: s.value, withTail: true, label: s.label, value: s.value })}
        isActive={(s) => s.value === resolved}
        onPick={onSetShape}
      />
      <TailToggle hasTail={hasTail} onToggle={onSetTail} />
    </div>
  );
}
