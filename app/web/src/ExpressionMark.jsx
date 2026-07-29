import { normalizeSignedDegrees } from "./Bubble";

// Small horror-manga reaction marks placed directly on a panel (typically over a
// character's face) — same free drag/resize/rotate interaction as a speech bubble (see
// Bubble.jsx), just without any text or tail: each is a fixed icon drawn in a 0-100
// viewBox, stretched/rotated like any other percent-positioned overlay. Deliberately thin
// and unsettling (fractures, veins, static, claw marks) rather than the bold cartoon
// "pow"/"idea bulb" style of comedy manga SFX.
export const EXPRESSION_TYPES = [
  { value: "crack", label: "Fracture crack" },
  { value: "vein", label: "Throbbing vein" },
  { value: "dread", label: "Dread lines" },
  { value: "tear", label: "Fear tear" },
  { value: "spiral", label: "Madness spiral" },
  { value: "unease", label: "Unease lines" },
  { value: "slash", label: "Claw slash" },
  { value: "static", label: "Static glitch" },
  { value: "shatter", label: "Shatter burst" },
  { value: "speedlines", label: "Speed lines" },
];

// Line weight is user-adjustable per mark (see the "Thickness" control in App.jsx) —
// these bound the slider/number input and seed new marks at a deliberately thin default,
// since the whole point of this redesign is marks that read as delicate/unsettling
// rather than bold cartoon linework.
export const DEFAULT_THICKNESS = 2;
export const MIN_THICKNESS = 0.5;
export const MAX_THICKNESS = 6;

// Only "speed lines" uses this — how many lines radiate from its center. Kept as its own
// adjustable field (rather than a fixed count baked into the icon like every other mark
// type) since speed lines are meant to be stretched across a whole panel, where a fixed
// count would either look sparse (large panel) or cluttered (small one).
export const DEFAULT_LINE_COUNT = 24;
export const MIN_LINE_COUNT = 6;
export const MAX_LINE_COUNT = 72;

export function newExpression(type = EXPRESSION_TYPES[0].value) {
  return {
    id: crypto.randomUUID(),
    type,
    x: 34,
    y: 8,
    width: 24,
    height: 24,
    rotate: 0,
    thickness: DEFAULT_THICKNESS,
    lineCount: DEFAULT_LINE_COUNT,
  };
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// A hand-drawn-looking spiral, traced as a growing-radius polyline — the classic
// "losing your mind" mark, kept from the original set but now thin by default.
function spiralPath(turns = 2.5, startR = 4, endR = 42, cx = 50, cy = 54, steps = 48) {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * turns * 2 * Math.PI;
    const r = startR + (endR - startR) * t;
    d += `${i === 0 ? "M" : "L"}${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)} `;
  }
  return d;
}

// Tapered brush-stroke rays radiating from a center point — wide at the base (near
// center), coming to a sharp point at the tip, like a real manga speed/focus line drawn
// with an ink brush rather than a ruler. Returns filled-triangle path strings (a stroked
// <line> can't taper along its own length, only a filled shape can), one per ray.
function radiatingWedges(count, innerR, outerR, thickness, { cx = 50, cy = 50, jitter = false } = {}) {
  const halfT = thickness / 2;
  const wedges = [];
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    const r = jitter && i % 2 !== 0 ? outerR * 0.62 : outerR;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const px = -dy; // unit vector perpendicular to the ray, for the base's width
    const py = dx;
    const baseX = cx + innerR * dx;
    const baseY = cy + innerR * dy;
    const tipX = cx + r * dx;
    const tipY = cy + r * dy;
    const leftX = baseX + halfT * px;
    const leftY = baseY + halfT * py;
    const rightX = baseX - halfT * px;
    const rightY = baseY - halfT * py;
    wedges.push(
      `M${leftX.toFixed(2)},${leftY.toFixed(2)} L${tipX.toFixed(2)},${tipY.toFixed(2)} L${rightX.toFixed(2)},${rightY.toFixed(2)} Z`
    );
  }
  return wedges;
}

// Turns ANY SVG path data (cubic/quadratic curves, relative or absolute commands,
// multiple L segments — whatever it's written with) into a tapered, filled brush-stroke
// shape: samples the ACTUAL rendered geometry via the browser's own path APIs
// (getPointAtLength) rather than hand-parsing path commands, so it exactly matches
// whatever curve was authored below. Width varies linearly from widthStart (the path's
// start point) to widthEnd (its end point) — real ink brush strokes are heavier where the
// brush lands and taper as it lifts off, not a ruler-uniform line.
let scratchPathEl;
function taperedFromPathD(d, widthStart, widthEnd, steps = 24) {
  if (typeof document === "undefined") return d; // shouldn't happen — this is a browser-only SPA
  if (!scratchPathEl) scratchPathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
  scratchPathEl.setAttribute("d", d);
  const total = scratchPathEl.getTotalLength();
  if (!total) return "";

  const eps = Math.min(0.5, total / 200);
  const left = [];
  const right = [];
  for (let i = 0; i <= steps; i++) {
    const l = (i / steps) * total;
    const p = scratchPathEl.getPointAtLength(l);
    const p1 = scratchPathEl.getPointAtLength(Math.max(0, l - eps));
    const p2 = scratchPathEl.getPointAtLength(Math.min(total, l + eps));
    const tlen = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const tx = (p2.x - p1.x) / tlen;
    const ty = (p2.y - p1.y) / tlen;
    const nx = -ty;
    const ny = tx;
    const w = (widthStart + (widthEnd - widthStart) * (i / steps)) / 2;
    left.push({ x: p.x + nx * w, y: p.y + ny * w });
    right.push({ x: p.x - nx * w, y: p.y - ny * w });
  }

  return (
    `M${left[0].x.toFixed(2)},${left[0].y.toFixed(2)} ` +
    left
      .slice(1)
      .map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(" ") +
    " " +
    right
      .slice()
      .reverse()
      .map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(" ") +
    " Z"
  );
}

// The actual icon geometry for one mark type, in a shared 0-100 viewBox — kept as its
// own component (rather than inlined per-case JSX) so ExpressionPicker's preview grid
// can render the exact same icon the real mark uses, not a redrawn approximation.
// `thickness` is the mark's own adjustable stroke width; every stroke here is expressed
// as a multiple of it so raising/lowering it scales the whole icon's line weight
// uniformly, finer detail lines included.
export function ExpressionIcon({ type, thickness = DEFAULT_THICKNESS, lineCount = DEFAULT_LINE_COUNT }) {
  const t = thickness;
  switch (type) {
    // An asymmetric branching fracture, like skin or glass cracking under strain —
    // replaces the old cartoon "shock" zigzag-star outline. Each crack starts thick at the
    // shared origin (50,50) and tapers to a fine point at its tip, like it was scratched
    // in with a brush rather than a ruler.
    case "crack":
      return (
        <g fill="#000">
          <path d={taperedFromPathD("M50 50 L38 30 L42 18 L34 6", t, t * 0.15)} />
          <path d={taperedFromPathD("M50 50 L66 28 L60 14", t, t * 0.15)} />
          <path d={taperedFromPathD("M50 50 L74 46 L92 40 L86 26", t, t * 0.15)} />
          <path d={taperedFromPathD("M50 50 L70 66 L88 74", t, t * 0.15)} />
          <path d={taperedFromPathD("M50 50 L40 70 L46 88", t, t * 0.15)} />
          <path d={taperedFromPathD("M50 50 L20 58 L6 52", t, t * 0.15)} />
        </g>
      );
    // A single throbbing vein with a couple of small forks — the quiet, creepy stress
    // mark instead of the old comedic anger-puff steam cloud. The main vein tapers from
    // thick at the base to thin at the top; each fork tapers from where it meets the main
    // vein (thick) out to its own tip (thin).
    case "vein":
      return (
        <g fill="#000">
          <path d={taperedFromPathD("M50 92 C48 70 54 55 46 38 C40 24 52 14 48 4", t, t * 0.15)} />
          <path d={taperedFromPathD("M48 38 L30 30", t * 0.75, t * 0.1)} />
          <path d={taperedFromPathD("M46 60 L64 54", t * 0.75, t * 0.1)} />
          <path d={taperedFromPathD("M50 20 L66 16", t * 0.75, t * 0.1)} />
        </g>
      );
    // Trembling, uneven lines under an eye — dread/exhaustion, not the old rigid
    // straight "tension" hatch. Tapers thick at top to thin at the bottom, like the lines
    // are being drawn downward under their own weight.
    case "dread":
      return (
        <g fill="#000">
          <path d={taperedFromPathD("M20 20 q4 30 -2 60", t, t * 0.2)} />
          <path d={taperedFromPathD("M40 15 q3 35 -3 70", t, t * 0.2)} />
          <path d={taperedFromPathD("M60 15 q-3 35 3 70", t, t * 0.2)} />
          <path d={taperedFromPathD("M80 20 q-4 30 2 60", t, t * 0.2)} />
        </g>
      );
    // A single hollow, elongated tear/fear-sweat drop — thin outline only, no fill.
    case "tear":
      return (
        <path
          d="M50 8 C66 34 74 52 74 66 C74 84 60 94 50 94 C40 94 26 84 26 66 C26 52 34 34 50 8 Z"
          fill="none"
          stroke="#000"
          strokeWidth={t}
          vectorEffect="non-scaling-stroke"
        />
      );
    // Tapers from thick at the inner starting point to a fine point at the outer end —
    // like a brush winding down as it loses control.
    case "spiral":
      return <path fill="#000" d={taperedFromPathD(spiralPath(), t, t * 0.15)} />;
    // Wavering (not ruler-straight) thin vertical lines — restless nervous energy.
    // Tapers thick at top to thin at the bottom, same brush-lift feel as "dread".
    case "unease":
      return (
        <g fill="#000">
          <path d={taperedFromPathD("M15 10 q3 20 -2 30 q-4 15 3 30 q4 12 -3 22", t, t * 0.2)} />
          <path d={taperedFromPathD("M38 8 q-3 22 2 34 q4 14 -3 28 q-3 10 2 22", t, t * 0.2)} />
          <path d={taperedFromPathD("M62 8 q3 22 -2 34 q-4 14 3 28 q3 10 -2 22", t, t * 0.2)} />
          <path d={taperedFromPathD("M85 10 q-3 20 2 30 q4 15 -3 30 q-4 12 3 22", t, t * 0.2)} />
        </g>
      );
    // Three thin curved claw/scar marks — replaces the old bold filled "impact" wedges.
    // Tapers thick at top to thin at the bottom, like a claw dragged downward.
    case "slash":
      return (
        <g fill="#000">
          <path d={taperedFromPathD("M22 20 Q40 50 30 86", t, t * 0.15)} />
          <path d={taperedFromPathD("M46 14 Q64 50 54 90", t, t * 0.15)} />
          <path d={taperedFromPathD("M70 18 Q86 50 78 86", t, t * 0.15)} />
        </g>
      );
    // Staggered jagged horizontal lines — a glitch/distortion tremor rather than the old
    // cheerful motion-swoosh curves. Tapers thick on the left to thin on the right.
    case "static":
      return (
        <g fill="#000">
          <path d={taperedFromPathD("M6 24 L36 24 L40 30 L64 30 L68 20 L94 20", t, t * 0.2)} />
          <path d={taperedFromPathD("M10 50 L30 50 L34 58 L58 58 L62 46 L90 46", t, t * 0.2)} />
          <path d={taperedFromPathD("M6 76 L40 76 L44 68 L70 68 L74 80 L94 80", t, t * 0.2)} />
        </g>
      );
    // A dense radial burst of thin lines — a mind/impact "shattering", not a solid black
    // cartoon starburst. Same tapered-wedge rays as "speedlines", just shorter/denser and
    // alternating long/short (jitter) for a jagged, irregular burst instead of an even one.
    case "shatter":
      return (
        <g fill="#000">
          {radiatingWedges(16, 6, 46, t * 3, { jitter: true }).map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      );
    // Classic manga "focus lines" — straight lines radiating edge-to-edge from a center
    // point, meant to be stretched across most of a panel (drag its resize handle out)
    // rather than kept small like the other icons. Reaches almost to the viewBox's
    // corners (radius 70, vs. shatter's 46) so it still fills a stretched/rotated box.
    case "speedlines":
      return (
        <g fill="#000">
          {radiatingWedges(lineCount, 4, 70, t * 3).map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      );
    default:
      return null;
  }
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

// One facial-expression marker, absolutely positioned (in percent of the panel) over the
// panel image — the same drag/resize/rotate interaction model as Bubble, minus the
// tail/text handling a plain icon has no use for.
export default function ExpressionMark({ mark, containerRef, editable, onChange, onDelete }) {
  const containerRect = () => containerRef.current.getBoundingClientRect();

  const moveBody = (e) => {
    const rect = containerRect();
    const startX = mark.x;
    const startY = mark.y;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    let lastPatch = {};
    startPointerDrag(
      e,
      (ev) => {
        const dxPct = ((ev.clientX - startClientX) / rect.width) * 100;
        const dyPct = ((ev.clientY - startClientY) / rect.height) * 100;
        lastPatch = {
          x: clamp(startX + dxPct, 0, 100 - mark.width),
          y: clamp(startY + dyPct, 0, 100 - mark.height),
        };
        onChange(lastPatch, { commit: false });
      },
      () => onChange(lastPatch, { commit: true })
    );
  };

  const resize = (e) => {
    const rect = containerRect();
    const startW = mark.width;
    const startH = mark.height;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    let lastPatch = {};
    startPointerDrag(
      e,
      (ev) => {
        const dwPct = ((ev.clientX - startClientX) / rect.width) * 100;
        const dhPct = ((ev.clientY - startClientY) / rect.height) * 100;
        lastPatch = {
          width: clamp(startW + dwPct, 8, 100 - mark.x),
          height: clamp(startH + dhPct, 8, 100 - mark.y),
        };
        onChange(lastPatch, { commit: false });
      },
      () => onChange(lastPatch, { commit: true })
    );
  };

  const rotate = mark.rotate || 0;
  const center = { x: mark.x + mark.width / 2, y: mark.y + mark.height / 2 };

  // Same "orbiting handle IS the rotation" reasoning as Bubble.jsx's dragRotate — no
  // separate stored point to un-rotate, so this reads the pointer's angle around center
  // directly. +90 makes 0° read as "straight up", matching where the handle starts.
  const dragRotate = (e) => {
    const rect = containerRect();
    let lastPatch = {};
    startPointerDrag(
      e,
      (ev) => {
        const px = ((ev.clientX - rect.left) / rect.width) * 100;
        const py = ((ev.clientY - rect.top) / rect.height) * 100;
        const angleDeg = (Math.atan2(py - center.y, px - center.x) * 180) / Math.PI;
        lastPatch = { rotate: Math.round(normalizeSignedDegrees(angleDeg + 90)) };
        onChange(lastPatch, { commit: false });
      },
      () => onChange(lastPatch, { commit: true })
    );
  };

  const outerStyle = {
    left: `${mark.x}%`,
    top: `${mark.y}%`,
    width: `${mark.width}%`,
    height: `${mark.height}%`,
    transform: rotate ? `rotate(${rotate}deg)` : undefined,
  };

  const rotateHandleRadius = Math.max(mark.width, mark.height) / 2 + 6;
  const rotateAngleRad = ((rotate - 90) * Math.PI) / 180;
  const displayRotateHandle = {
    x: center.x + rotateHandleRadius * Math.cos(rotateAngleRad),
    y: center.y + rotateHandleRadius * Math.sin(rotateAngleRad),
  };

  return (
    <>
      <div
        className={`expression-mark${editable ? " editable" : ""}`}
        style={outerStyle}
        onPointerDown={editable ? moveBody : undefined}
      >
        <svg className="expression-mark-icon" viewBox="0 0 100 100" preserveAspectRatio="none">
          <ExpressionIcon
            type={mark.type}
            thickness={mark.thickness ?? DEFAULT_THICKNESS}
            lineCount={mark.lineCount ?? DEFAULT_LINE_COUNT}
          />
        </svg>

        {editable && (
          <>
            <button className="expression-mark-delete" onPointerDown={(e) => e.stopPropagation()} onClick={onDelete}>
              ×
            </button>
            <div className="expression-mark-resize-handle" onPointerDown={resize} />
          </>
        )}
      </div>

      {editable && (
        <div
          className="expression-mark-rotate-handle"
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
