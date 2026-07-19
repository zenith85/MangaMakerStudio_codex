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
  parts.push(STYLE_SUFFIX[stylePreset] || STYLE_SUFFIX.manga_bw);
  return parts.join(" ");
}

// Builds the prompt for editing an already-generated panel image, rather than composing
// a new scene from scratch — the panel's CURRENT image is passed in as the sole reference
// (see generateImageViaCodex's referenceImages param), so this only needs to describe the
// change, not re-describe the whole scene.
export function buildEditPrompt({ instructions, stylePreset }) {
  const parts = [
    "Edit the attached reference image — do not generate an unrelated new scene from scratch.",
    `Requested change: ${instructions?.trim() || "Improve the image."}`,
    "Keep everything else in the image the same (composition, characters, setting, style) except for what the requested change describes.",
    STYLE_SUFFIX[stylePreset] || STYLE_SUFFIX.manga_bw,
  ];
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
