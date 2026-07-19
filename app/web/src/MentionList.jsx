import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

const KIND_LABEL = { characters: "Character", places: "Place", objects: "Object", references: "Reference", panels: "Panel" };

// Keyboard/click list rendered inside the #/@ suggestion popup (see scene-editor's
// suggestion.render). Tiptap calls onKeyDown on this via the forwarded ref while the
// popup is open, and calls command(item) when Enter/click selects one. Hovering or
// arrow-keying onto an item shows a bigger preview beside the list — the small 32px row
// thumbnail isn't enough to tell panels apart at a glance.
const MentionList = forwardRef(({ items, command }, ref) => {
  const [selected, setSelected] = useState(0);

  useEffect(() => setSelected(0), [items]);

  const select = (index) => {
    const item = items[index];
    if (item) command({ id: item.id, label: item.label });
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowDown") {
        setSelected((selected + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((selected + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        select(selected);
        return true;
      }
      return false;
    },
  }));

  if (!items.length) {
    return <div className="mention-popup mention-list-empty">No matches</div>;
  }

  const previewItem = items[selected];

  return (
    <div className="mention-popup">
      <div className="mention-list">
        {items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            className={`mention-list-item${i === selected ? " is-selected" : ""}`}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setSelected(i)}
            onClick={() => select(i)}
          >
            {item.imageUrl ? (
              <img src={item.imageUrl} alt="" />
            ) : (
              <span className="mention-list-item-placeholder" />
            )}
            <span className="mention-list-item-label">{item.label}</span>
            <span className="mention-list-item-kind">{KIND_LABEL[item.kind]}</span>
          </button>
        ))}
      </div>
      {previewItem?.imageUrl && (
        <div className="mention-preview">
          <img src={previewItem.imageUrl} alt="" />
          <span className="mention-preview-label">{previewItem.label}</span>
        </div>
      )}
    </div>
  );
});

export default MentionList;
