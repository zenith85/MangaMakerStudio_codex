const STYLE_SUFFIX = {
  manga_bw: "Render as a black-and-white manga panel with screentone shading and clean line art.",
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

export function buildPrompt({ sceneDescription, characters, place, objects, stylePreset }) {
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
  if (place) {
    const details = describeFields(place.fields);
    parts.push(
      `Setting: ${place.name}${details ? ` (${details})` : ""}, matching its attached reference image.`
    );
  }
  if (objects.length) {
    parts.push(
      "Objects present, matching their attached reference images exactly: " +
        objects.map((o) => o.name).join(", ") +
        "."
    );
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
