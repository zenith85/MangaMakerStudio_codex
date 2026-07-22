import { useEffect, useState } from "react";

// A track's rendered size below this (px) stops a drag from squeezing it further —
// expressed in pixels, not fr, so it means the same thing regardless of a layout's
// arbitrary total fr sum (e.g. "1fr 1fr" sums to 2, "2fr 1fr" sums to 3).
const MIN_TRACK_PX = 40;

// Parses a `grid-template-areas` string like `"p1 p2" "p1 p3" "p1 p4"` into a 2D array of
// cell labels, grid[row][col] — the same structural information CSS itself parses, used
// here to reason about which panels are adjacent without re-deriving it from pixels
// (measurement can tell you where a rendered edge falls, not whether it's a real seam
// between two different panels or just a straight line through the middle of one that
// spans across it).
export function parseGridAreas(areasStr) {
  return [...areasStr.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim().split(/\s+/));
}

function parseFr(str) {
  return str
    .trim()
    .split(/\s+/)
    .map((s) => parseFloat(s));
}

function frString(values) {
  return values.map((v) => `${v}fr`).join(" ");
}

// Contiguous runs (as [start, end) index pairs) where `getA(i)` and `getB(i)` differ, for
// i in 0..count-1 — the shared logic behind both seam finders below (row-seams are just
// column-seams with the grid transposed).
function differingRuns(getA, getB, count) {
  const runs = [];
  let start = null;
  for (let i = 0; i <= count; i++) {
    const differs = i < count && getA(i) !== getB(i);
    if (differs && start === null) start = i;
    if (!differs && start !== null) {
      runs.push([start, i]);
      start = null;
    }
  }
  return runs;
}

// Finds each internal column boundary (0..C-2) where two different panels actually meet,
// and the row-range each meeting spans — a boundary crossed by a single panel spanning
// both columns (e.g. a tall left panel next to a stack of smaller ones) has no seam
// there, so no handle should appear over it.
export function findColumnSeams(grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  const seams = [];
  for (let c = 0; c < cols - 1; c++) {
    const runs = differingRuns((r) => grid[r][c], (r) => grid[r][c + 1], rows);
    if (runs.length) seams.push({ index: c, runs });
  }
  return seams;
}

export function findRowSeams(grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  const seams = [];
  for (let r = 0; r < rows - 1; r++) {
    const runs = differingRuns((c) => grid[r][c], (c) => grid[r + 1][c], cols);
    if (runs.length) seams.push({ index: r, runs });
  }
  return seams;
}

function startDrag(e, onMove, onEnd) {
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

// Renders one draggable strip per internal seam between panels in a (non-freeform) grid
// layout — dragging one changes only the two tracks it sits between, converting the
// pointer's pixel movement into a change in those tracks' fr share so every other
// row/column keeps its size exactly as before. `onLiveChange` fires continuously during
// the drag (for a live preview, same pattern as bubble dragging); `onCommit` fires once on
// release, to persist.
export default function GridResizeHandles({ containerRef, columns, rows, areas, onLiveChange, onCommit }) {
  const [box, setBox] = useState(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setBox({
        width: el.clientWidth,
        height: el.clientHeight,
        padLeft: parseFloat(cs.paddingLeft) || 0,
        padTop: parseFloat(cs.paddingTop) || 0,
        padRight: parseFloat(cs.paddingRight) || 0,
        padBottom: parseFloat(cs.paddingBottom) || 0,
        gapX: parseFloat(cs.columnGap) || 0,
        gapY: parseFloat(cs.rowGap) || 0,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  if (!box) return null;

  const grid = parseGridAreas(areas);
  const colFr = parseFr(columns);
  const rowFr = parseFr(rows);
  const totalColFr = colFr.reduce((a, b) => a + b, 0);
  const totalRowFr = rowFr.reduce((a, b) => a + b, 0);
  const contentW = box.width - box.padLeft - box.padRight - (colFr.length - 1) * box.gapX;
  const contentH = box.height - box.padTop - box.padBottom - (rowFr.length - 1) * box.gapY;

  // Cumulative pixel start/end of each track, measured from the container's padding-box
  // origin — the same origin percent-based left/top on an absolutely positioned child
  // resolves against, so these convert straight to percentages with no extra offset math.
  const colStartPx = [];
  colFr.forEach((_, i) => {
    colStartPx.push(i === 0 ? box.padLeft : colStartPx[i - 1] + (colFr[i - 1] / totalColFr) * contentW + box.gapX);
  });
  const colEndPx = colStartPx.map((start, i) => start + (colFr[i] / totalColFr) * contentW);
  const rowStartPx = [];
  rowFr.forEach((_, i) => {
    rowStartPx.push(i === 0 ? box.padTop : rowStartPx[i - 1] + (rowFr[i - 1] / totalRowFr) * contentH + box.gapY);
  });
  const rowEndPx = rowStartPx.map((start, i) => start + (rowFr[i] / totalRowFr) * contentH);

  const pctX = (px) => (px / box.width) * 100;
  const pctY = (px) => (px / box.height) * 100;

  const dragColumn = (index) => (e) => {
    const startFr = parseFr(columns);
    const total = startFr.reduce((a, b) => a + b, 0);
    const pxPerFr = contentW / total;
    const minFr = MIN_TRACK_PX / pxPerFr;
    const startClientX = e.clientX;
    let lastFr = startFr;
    startDrag(
      e,
      (ev) => {
        const dxFr = ((ev.clientX - startClientX) / contentW) * total;
        const clamped = Math.max(-(startFr[index] - minFr), Math.min(startFr[index + 1] - minFr, dxFr));
        lastFr = [...startFr];
        lastFr[index] = startFr[index] + clamped;
        lastFr[index + 1] = startFr[index + 1] - clamped;
        onLiveChange({ gridColumns: frString(lastFr) });
      },
      () => onCommit({ gridColumns: frString(lastFr) })
    );
  };

  const dragRow = (index) => (e) => {
    const startFr = parseFr(rows);
    const total = startFr.reduce((a, b) => a + b, 0);
    const pxPerFr = contentH / total;
    const minFr = MIN_TRACK_PX / pxPerFr;
    const startClientY = e.clientY;
    let lastFr = startFr;
    startDrag(
      e,
      (ev) => {
        const dyFr = ((ev.clientY - startClientY) / contentH) * total;
        const clamped = Math.max(-(startFr[index] - minFr), Math.min(startFr[index + 1] - minFr, dyFr));
        lastFr = [...startFr];
        lastFr[index] = startFr[index] + clamped;
        lastFr[index + 1] = startFr[index + 1] - clamped;
        onLiveChange({ gridRows: frString(lastFr) });
      },
      () => onCommit({ gridRows: frString(lastFr) })
    );
  };

  const colSeams = findColumnSeams(grid);
  const rowSeams = findRowSeams(grid);

  return (
    <>
      {colSeams.flatMap(({ index, runs }) =>
        runs.map(([rStart, rEnd], ri) => {
          const x = (colEndPx[index] + colStartPx[index + 1]) / 2;
          const yTop = rowStartPx[rStart];
          const yBottom = rowEndPx[rEnd - 1];
          return (
            <div
              key={`col-${index}-${ri}`}
              className="grid-resize-handle grid-resize-handle-col"
              style={{ left: `${pctX(x)}%`, top: `${pctY(yTop)}%`, height: `${pctY(yBottom - yTop)}%` }}
              onPointerDown={dragColumn(index)}
            />
          );
        })
      )}
      {rowSeams.flatMap(({ index, runs }) =>
        runs.map(([cStart, cEnd], ri) => {
          const y = (rowEndPx[index] + rowStartPx[index + 1]) / 2;
          const xLeft = colStartPx[cStart];
          const xRight = colEndPx[cEnd - 1];
          return (
            <div
              key={`row-${index}-${ri}`}
              className="grid-resize-handle grid-resize-handle-row"
              style={{ top: `${pctY(y)}%`, left: `${pctX(xLeft)}%`, width: `${pctX(xRight - xLeft)}%` }}
              onPointerDown={dragRow(index)}
            />
          );
        })
      )}
    </>
  );
}
