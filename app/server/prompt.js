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

// Shared between buildPrompt/buildEditPrompt (a panel's scene description) and
// buildEntityPrompt (a character/place/object's own description) — all three need to
// describe whichever characters/places/objects/references/panels got #/!/@-mentioned,
// just with different framing around it.
export function describeReferencedEntities({ characters = [], places = [], objects = [], references = [], continuityPanels = [] }) {
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

// hasLastPageThumbnail/hasPoseSketch: the caller (see index.js's /generate route)
// always appends these, when present, in this fixed order — last-page thumbnail first,
// then the pose sketch — after every entity/continuity image already pushed by
// describeReferencedEntities. Described here by exact position (LAST vs.
// SECOND-TO-LAST) rather than generically, since there are only ever these two optional
// trailing images to account for.
export function buildPrompt({
  sceneDescription,
  characters,
  places,
  objects,
  references = [],
  continuityPanels = [],
  stylePreset,
  hasLastPageThumbnail = false,
  hasPoseSketch = false,
}) {
  const parts = [sceneDescription?.trim() || "A manga panel."];
  parts.push(...describeReferencedEntities({ characters, places, objects, references, continuityPanels }));
  const lastPageOrdinal = hasPoseSketch ? "SECOND-TO-LAST" : "LAST";
  if (hasLastPageThumbnail) {
    parts.push(
      `The ${lastPageOrdinal} attached reference image is a small composite of every panel on the PREVIOUS page, for overall scene/environment continuity — matching things like the setting, lighting, and where characters/objects are positioned when the new scene follows on from it. It is just visual context, not a layout to copy: do not reproduce its grid of panels, borders, or composition in your output.`
    );
  }
  if (hasPoseSketch) {
    parts.push(
      "The LAST attached reference image is a simple hand-drawn stick-figure sketch showing the desired body pose/motion for the main character in this scene — match that pose and body positioning as closely as possible. Do NOT draw, keep, or reference the stick figure itself; render a normal fully-drawn character in that pose."
    );
  }
  parts.push(STYLE_SUFFIX[stylePreset] || STYLE_SUFFIX.manga_bw);
  return parts.join(" ");
}

// Builds the prompt for editing an already-generated panel image, rather than composing
// a new scene from scratch — the panel's CURRENT (clean) image is always passed as the
// FIRST reference image (see generateImageViaCodex's referenceImages param). When the
// user has drawn a marker rectangle, a copy of that same image with the rectangle baked
// on goes SECOND, purely to point at the edit region — any #/!/@-mentioned
// characters/places/objects/references/panels follow after that, so the prompt has to
// spell out which reference image(s) are the edit target vs. just a locator vs. just for
// matching appearance.
// hasPoseSketch: like buildPrompt above, the caller (index.js's /edit route) always
// appends the pose sketch, when present, as the very LAST reference image — after the
// marker copy (if any) and every entity reference image — so "the LAST attached
// reference image" stays unambiguous regardless of how many other references are
// attached.
export function buildEditPrompt({
  instructions,
  characters = [],
  places = [],
  objects = [],
  references = [],
  continuityPanels = [],
  stylePreset,
  hasMarker = false,
  hasPoseSketch = false,
}) {
  const entityParts = describeReferencedEntities({ characters, places, objects, references, continuityPanels });
  const parts = [
    "Edit the FIRST attached reference image — that is the panel being edited; do not generate an unrelated new scene from scratch.",
  ];
  if (hasMarker) {
    parts.push(
      "The SECOND attached reference image is the exact same panel with a red rectangle drawn on it, marking where the requested change should happen — it is only a locator, not part of the artwork. Do not draw, keep, or reference any red rectangle/box/outline in your output; the edited image must look like a normal panel with no markup on it."
    );
  }
  parts.push(`Requested change: ${instructions?.trim() || "Improve the image."}`);
  parts.push(
    "Keep everything else in that first image the same (composition, characters, setting, style) except for what the requested change describes."
  );
  if (entityParts.length) {
    const afterNth = hasMarker ? "first two" : "first";
    parts.push(`Any OTHER attached reference images (after the ${afterNth}) are only for matching these, not additional edit targets:`);
    parts.push(...entityParts);
  }
  if (hasPoseSketch) {
    parts.push(
      "The LAST attached reference image is a simple hand-drawn stick-figure sketch showing the desired body pose/motion for the main character — match that pose and body positioning as closely as possible while applying the requested change. Do NOT draw, keep, or reference the stick figure itself; render a normal fully-drawn character in that pose."
    );
  }
  parts.push(STYLE_SUFFIX[stylePreset] || STYLE_SUFFIX.manga_bw);
  return parts.join(" ");
}

const KIND_NOUN = { characters: "character", places: "place", objects: "object" };

// Builds the prompt for generating a single reference asset (a character's
// reference sheet, a place's establishing image, an object's reference image)
// rather than a full composed manga panel.
export function buildEntityPrompt({
  kind, name, fields, style, description,
  characters, places, objects, references = [], continuityPanels = [],
}) {
  const noun = KIND_NOUN[kind] || "subject";
  const details = describeFields(fields);
  const parts = [`A single reference image of a ${noun} named ${name}.`];
  if (description?.trim()) parts.push(description.trim() + ".");
  if (details) parts.push(details + ".");
  parts.push(...describeReferencedEntities({ characters, places, objects, references, continuityPanels }));
  if (kind === "characters") {
    parts.push("Full body, front-facing, neutral pose, plain white background, character reference sheet style.");
  } else if (kind === "objects") {
    parts.push("Centered, plain white background, product/reference style.");
  }
  parts.push(STYLE_SUFFIX[style] || STYLE_SUFFIX.manga_bw);
  return parts.join(" ");
}
