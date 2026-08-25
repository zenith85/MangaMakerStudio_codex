import { useMemo, useRef } from "react";
import { useEditor, EditorContent, ReactRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import MentionList from "./MentionList";

function buildEntityItems(characters, places, objects) {
  return [
    ...characters.map((c) => ({ id: `characters:${c.id}`, label: c.name, kind: "characters", imageUrl: c.imageUrl })),
    ...places.map((p) => ({ id: `places:${p.id}`, label: p.name, kind: "places", imageUrl: p.imageUrl })),
    ...objects.map((o) => ({ id: `objects:${o.id}`, label: o.name, kind: "objects", imageUrl: o.imageUrl })),
  ];
}

function buildPanelItems(panels) {
  return panels.map((p) => ({
    id: `panels:${p.id}`,
    label: p.pageTitle ? `${p.pageTitle} · Panel ${p.order + 1}` : `Panel ${p.order + 1}`,
    kind: "panels",
    imageUrl: p.imageUrl || null,
  }));
}

function buildReferenceItems(references) {
  return references.map((r) => ({ id: `references:${r.id}`, label: r.name, kind: "references", imageUrl: r.imageUrl }));
}

// `itemsRef` is read fresh by items() on every keystroke, so the suggestion list stays
// current without rebuilding the Mention extension (and thus the editor) whenever the
// underlying characters/places/objects/panels change.
function mentionSuggestion(char, itemsRef) {
  return {
    char,
    items: ({ query }) => {
      // No cap here — the list already scrolls (.mention-list has max-height +
      // overflow-y: auto). A fixed cap (this used to be 8, then 50) just silently hides
      // whatever's past it when browsing with no query typed, and any project that
      // eventually grows past that number runs into the exact same bug again — e.g. a
      // project with enough pages/panels to exceed it could never mention its later
      // pages here at all, only ones early enough to land inside the cap.
      const q = query.toLowerCase();
      return itemsRef.current.filter((e) => e.label.toLowerCase().includes(q));
    },
    render: () => {
      let component;
      let unmount;

      return {
        onStart: (props) => {
          component = new ReactRenderer(MentionList, { props, editor: props.editor });
          // Tiptap mounts this straight onto <body>, outside any dialog's DOM — with no
          // z-index it's z-index:auto, which paints behind .modal-backdrop (z-index 30)
          // whenever SceneEditor is used inside a modal (e.g. EntityCreatorModal), even
          // though it's positioned on top visually. Above the always-on-top terminal (40)
          // too, since you're mid-interaction picking a mention and it must stay reachable.
          component.element.style.zIndex = "50";
          if (!props.clientRect) return;
          unmount = props.mount(component.element);
        },
        onUpdate(props) {
          component.updateProps(props);
        },
        onKeyDown(props) {
          if (props.event.key === "Escape") {
            unmount?.();
            return true;
          }
          return component.ref?.onKeyDown(props) ?? false;
        },
        onExit() {
          unmount?.();
          component.destroy();
        },
      };
    },
  };
}

// Rich-text scene description for a panel. Three mention triggers: # opens a searchable
// dropdown across this project's characters/places/objects; ! opens one across uploaded
// reference images (plain pictures, no generation/fields — just extra visual references);
// @ opens one across every panel on every page (so you can anchor continuity — "match
// Page 1's Panel 2 room" — without forcing every panel to inherit whatever came right
// before it). Picking one inserts an inline, colored mention token. The resulting Tiptap
// doc (see onChange) is the sole source of a panel's cast, setting, and continuity
// references — parseSceneDoc (server/scene.js) pulls them back out regardless of which
// trigger inserted them.
export default function SceneEditor({ content, onChange, characters, places, objects, references = [], panels = [] }) {
  const entitiesRef = useRef([]);
  entitiesRef.current = useMemo(() => buildEntityItems(characters, places, objects), [characters, places, objects]);

  const referencesRef = useRef([]);
  referencesRef.current = useMemo(() => buildReferenceItems(references), [references]);

  const panelsRef = useRef([]);
  panelsRef.current = useMemo(() => buildPanelItems(panels), [panels]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Mention.configure({
        HTMLAttributes: { class: "mention-token" },
        suggestions: [mentionSuggestion("#", entitiesRef), mentionSuggestion("!", referencesRef), mentionSuggestion("@", panelsRef)],
      }),
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
  });

  return (
    <div className="scene-editor">
      <EditorContent editor={editor} />
    </div>
  );
}
