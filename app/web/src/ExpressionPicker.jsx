import { useState, useRef, useEffect } from "react";
import { EXPRESSION_TYPES, ExpressionIcon } from "./ExpressionMark";

function ExpressionPreview({ type, size, thickness }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ overflow: "visible", flexShrink: 0 }}>
      <ExpressionIcon type={type} thickness={thickness} />
    </svg>
  );
}

// A dropdown of every expression-mark type, each shown as its actual rendered icon
// rather than a text label — same trigger+popover-grid interaction as ShapePicker's
// bubble-shape dropdown, just without the tail toggle (marks have no tail).
export default function ExpressionPicker({ mark, onSetType }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = EXPRESSION_TYPES.find((t) => t.value === mark.type);

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
        <ExpressionPreview type={mark.type} size={22} thickness={mark.thickness} />
        <span>{current?.label ?? "Type"}</span>
        <span className="shape-dropdown-caret">▾</span>
      </button>
      {open && (
        <div className="shape-dropdown-popover">
          <div className="shape-dropdown-grid">
            {EXPRESSION_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                className={t.value === mark.type ? "active" : ""}
                onClick={() => {
                  onSetType(t.value);
                  setOpen(false);
                }}
              >
                <ExpressionPreview type={t.value} size={54} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
