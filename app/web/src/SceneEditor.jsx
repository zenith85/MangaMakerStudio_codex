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

// `entitiesRef` is read fresh by items() on every keystroke, so the suggestion list
// stays current without rebuilding the Mention extension (and thus the editor) whenever
// the project's characters/places/objects change.
function mentionSuggestion(entitiesRef) {
  return {
    char: "#",
    items: ({ query }) => {
      const q = query.toLowerCase();
      return entitiesRef.current.filter((e) => e.label.toLowerCase().includes(q)).slice(0, 8);
    },
    render: () => {
      let component;
      let unmount;

      return {
        onStart: (props) => {
          component = new ReactRenderer(MentionList, { props, editor: props.editor });
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

// Rich-text scene description for a panel: typing # opens a searchable dropdown across
// this project's characters/places/objects; picking one inserts an inline, colored
// mention token. The resulting Tiptap doc (see onChange) is the sole source of a
// panel's cast and setting — parseSceneDoc (server/scene.js) pulls both back out of it.
export default function SceneEditor({ content, onChange, characters, places, objects }) {
  const entitiesRef = useRef([]);
  entitiesRef.current = useMemo(
    () => buildEntityItems(characters, places, objects),
    [characters, places, objects]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Mention.configure({
        HTMLAttributes: { class: "mention-token" },
        suggestion: mentionSuggestion(entitiesRef),
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
