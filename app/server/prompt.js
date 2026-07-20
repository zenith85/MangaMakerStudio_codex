const STYLE_SUFFIX = {
  manga_bw: "Render as a black-and-white manga panel with screentone shading and clean line art.",
  manga_simple:
    "Render as a simple black-and-white manga panel: bold clean line art, minimal flat shading with only a " +
    "couple of solid gray tones (no screentone dot patterns, no dense cross-hatching or heavy rendering), " +
    "plain uncluttered backgrounds — an everyday simple-manga look, not a highly detailed or textured one.",
  manhwa_color: "Render as a full-color manhwa/webtoon panel with soft cel shading.",
  novel_illustration: "Render as a full-bleed painterly light-novel illustration.",
};

function describeFields(fields) {
  if (!fields || Object.keys(fields).length === 0) return "";
  return Object.entries(fields)
    .filter(([, value]) => String(value ?? "").trim() !== "")
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
}

// Shared between buildPrompt (a new scene) and buildEditPrompt (editing an existing
// one) — both need to describe whichever characters/places/objects/references/continuity
// panels got #/!/@-mentioned, just with different framing around it.
function describeReferencedEntities({ characters = [], places = [], objects = [], references = [], continuityPanels = [] }) {
  const parts = [];
  if (characters.length) {
    parts.push(
      "Cast: " +
        characters
          .map((c) => {
            const details = describeFields(c.fields);
            return details ? `${c.name} (${details})` : c.name;
          })
          .join(", ") +
        ". Match each character's appearance exactly to their attached reference images."
    );
  }
  if (places.length) {
    parts.push(
      "Setting: " +
        places
          .map((p) => {
            const details = describeFields(p.fields);
            return details ? `${p.name} (${details})` : p.name;
          })
          .join(", ") +
        ", matching the attached reference image(s)."
    );
  }
  if (objects.length) {
    parts.push(
      "Objects present, matching their attached reference images exactly: " +
        objects.map((o) => o.name).join(", ") +
        "."
    );
  }
  if (references.length) {
    parts.push(
      "Additional reference images attached, matching them exactly wherever they apply: " +
        references.map((r) => r.name).join(", ") +
        "."
    );
  }
  if (continuityPanels.length) {
    parts.push(
      "Continuity — this scene follows directly from " +
        continuityPanels
          .map((p) => {
            const where = p.pageTitle ? ` on "${p.pageTitle}"` : "";
            return `Panel ${p.order + 1}${where}${p.plainText ? ` ("${p.plainText}")` : ""}`;
          })
          .join(", ") +
        ". Match the room, decor, lighting, and any props exactly as shown in the attached reference image(s) for those panels, unless this panel's own description says something changed."
    );
  }
  return parts;
}

export function buildPrompt({
  sceneDescription,
  characters,
  places,
  objects,
  references = [],
  continuityPanels = [],
  stylePreset,
}) {
  const parts = [sceneDescription?.trim() || "A manga panel."];
  parts.push(...describeReferencedEntities({ characters, places, objects, references, continuityPanels }));
  parts.push(STYLE_SUFFIX[stylePreset] || STYLE_SUFFIX.manga_bw);
  return parts.join(" ");
}

// Builds the prompt for editing an already-generated panel image, rather than composing
// a new scene from scratch — the panel's CURRENT image is always passed as the FIRST
// reference image (see generateImageViaCodex's referenceImages param), with any
// #/!/@-mentioned characters/places/objects/references/panels following after it, so the
// prompt has to spell out which reference image is actually the edit target.
export function buildEditPrompt({ instructions, characters = [], places = [], objects = [], references = [], continuityPanels = [], stylePreset }) {
  const entityParts = describeReferencedEntities({ characters, places, objects, references, continuityPanels });
  const parts = [
    "Edit the FIRST attached reference image — that is the panel being edited; do not generate an unrelated new scene from scratch.",
    `Requested change: ${instructions?.trim() || "Improve the image."}`,
    "Keep everything else in that first image the same (composition, characters, setting, style) except for what the requested change describes.",
  ];
  if (entityParts.length) {
    parts.push("Any OTHER attached reference images (after the first) are only for matching these, not additional edit targets:");
    parts.push(...entityParts);
  }
  parts.push(STYLE_SUFFIX[stylePreset] || STYLE_SUFFIX.manga_bw);
  return parts.join(" ");
}

const KIND_NOUN = { characters: "character", places: "place", objects: "object" };

// Builds the prompt for generating a single reference asset (a character's
// reference sheet, a place's establishing image, an object's reference image)
// rather than a full composed manga panel.
export function buildEntityPrompt({ kind, name, fields, style }) {
  const noun = KIND_NOUN[kind] || "subject";
  const details = describeFields(fields);
  const parts = [`A single reference image of a ${noun} named ${name}.`];
  if (details) parts.push(details + ".");
  if (kind === "characters") {
    parts.push("Full body, front-facing, neutral pose, plain white background, character reference sheet style.");
  } else if (kind === "objects") {
    parts.push("Centered, plain white background, product/reference style.");
  }
  parts.push(STYLE_SUFFIX[style] || STYLE_SUFFIX.manga_bw);
  return parts.join(" ");
}
