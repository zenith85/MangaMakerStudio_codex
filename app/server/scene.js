// Parses a Tiptap rich-text document (the panel's scene description, written with
// inline #mentions of characters/places/objects) into plain text for the AI prompt
// plus the set of entities referenced, so a panel's cast/setting comes entirely from
// what's mentioned in the text rather than a separate selection UI.

function walk(node, textParts, idsByKind) {
  if (!node) return;

  if (node.type === "text") {
    textParts.push(node.text ?? "");
    return;
  }

  if (node.type === "mention") {
    const id = node.attrs?.id ?? "";
    const [kind, entityId] = id.split(":");
    if (kind && entityId) {
      idsByKind[kind] ??= new Set();
      idsByKind[kind].add(entityId);
    }
    textParts.push(node.attrs?.label ?? "");
    return;
  }

  for (const child of node.content ?? []) {
    walk(child, textParts, idsByKind);
  }

  // Blank line between block-level nodes (paragraphs, etc.) so multi-paragraph
  // scene descriptions don't get smushed into one run-on sentence.
  if (node.content?.length && node.type !== "doc") textParts.push(" ");
}

export function parseSceneDoc(doc) {
  const textParts = [];
  const idsByKind = {};
  walk(doc, textParts, idsByKind);

  return {
    plainText: textParts.join("").replace(/\s+/g, " ").trim(),
    characterIds: [...(idsByKind.characters ?? [])],
    placeIds: [...(idsByKind.places ?? [])],
    objectIds: [...(idsByKind.objects ?? [])],
  };
}

// An empty Tiptap doc, used as the default for new panels.
export const EMPTY_SCENE_DOC = { type: "doc", content: [{ type: "paragraph" }] };
