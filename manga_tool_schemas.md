# Claude tool-use schema — generate_panel / edit_panel

Model: claude-opus-4-8 (adaptive thinking, effort: high — this is judgment-heavy
orchestration, not a cheap classification call).

## generate_panel

Called once per panel: takes the structured inputs from the UI (linked
characters, place, sketch, scene description) and produces a new panel image.
Claude's job is to translate loose scene description + references into a
precise multi-image request to the image backend — it does not call the image
model directly; this tool wraps that call.

```json
{
  "name": "generate_panel",
  "description": "Generate a manga panel image from character references, a place/background reference, an optional hand-drawn composition sketch with region-to-character links, and a scene description. Call this once per panel when the user has finished assembling that panel's inputs and wants art generated. Do not call this for edits to an already-generated panel — use edit_panel instead.",
  "input_schema": {
    "type": "object",
    "properties": {
      "panel_id": {
        "type": "string",
        "description": "ID of the panel slot on the page layout this generation fills."
      },
      "characters": {
        "type": "array",
        "description": "Characters appearing in this panel, in the order they matter to the scene.",
        "items": {
          "type": "object",
          "properties": {
            "character_id": {
              "type": "string",
              "description": "ID of a character from the user's character library."
            },
            "reference_image_ids": {
              "type": "array",
              "items": { "type": "string" },
              "description": "IDs of stored reference images/embeddings for this character (front/side/expression sheet)."
            },
            "sketch_region": {
              "type": "object",
              "description": "Where this character is placed if the user supplied a hand-drawn sketch. Omit if no sketch was used or the character has no explicit placement.",
              "properties": {
                "shape": {
                  "type": "string",
                  "enum": ["mask", "bbox", "point"],
                  "description": "How the region was captured: a painted mask, a bounding box, or a single point/pin."
                },
                "mask_asset_id": { "type": "string", "description": "ID of the mask asset, if shape is 'mask'." },
                "bbox": {
                  "type": "array",
                  "items": { "type": "number" },
                  "description": "[x, y, width, height] in normalized 0-1 coordinates, if shape is 'bbox'."
                },
                "point": {
                  "type": "array",
                  "items": { "type": "number" },
                  "description": "[x, y] in normalized 0-1 coordinates, if shape is 'point'."
                }
              },
              "required": ["shape"]
            },
            "pose_or_expression": {
              "type": "string",
              "description": "Optional short instruction specific to this character in this panel, e.g. 'clenched fist, angry', 'mid-jump'."
            }
          },
          "required": ["character_id", "reference_image_ids"]
        }
      },
      "objects": {
        "type": "array",
        "description": "Specific consistency-tracked objects appearing in this panel (a named sword, vehicle, artifact, etc.) — same reference-image/LoRA mechanism as characters, just without pose/expression.",
        "items": {
          "type": "object",
          "properties": {
            "object_id": { "type": "string", "description": "ID of an object from the user's object library." },
            "reference_image_ids": {
              "type": "array",
              "items": { "type": "string" },
              "description": "IDs of stored reference images/embeddings for this object."
            },
            "sketch_region": {
              "type": "object",
              "description": "Where this object is placed if the user supplied a hand-drawn sketch. Same shape as a character's sketch_region.",
              "properties": {
                "shape": { "type": "string", "enum": ["mask", "bbox", "point"] },
                "mask_asset_id": { "type": "string" },
                "bbox": { "type": "array", "items": { "type": "number" } },
                "point": { "type": "array", "items": { "type": "number" } }
              },
              "required": ["shape"]
            },
            "notes": {
              "type": "string",
              "description": "Optional short instruction for how the object appears in this panel, e.g. 'held in her right hand, glowing'."
            }
          },
          "required": ["object_id", "reference_image_ids"]
        }
      },
      "place": {
        "type": "object",
        "description": "Background/location reference for the panel. Omit for a blank or abstract background.",
        "properties": {
          "place_id": { "type": "string" },
          "reference_image_ids": {
            "type": "array",
            "items": { "type": "string" }
          }
        },
        "required": ["place_id", "reference_image_ids"]
      },
      "style_preset": {
        "type": "string",
        "enum": ["manga_bw", "manhwa_color", "novel_illustration"],
        "description": "Which format this panel/illustration belongs to. Controls line art vs. full color vs. painterly rendering — set once from the project's format and passed on every call."
      },
      "style": {
        "type": "object",
        "description": "Art style to apply, from the user's saved style library.",
        "properties": {
          "style_id": { "type": "string" },
          "reference_image_ids": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Optional style reference images/lineart samples."
          }
        },
        "required": ["style_id"]
      },
      "composition_sketch_id": {
        "type": "string",
        "description": "ID of the user's hand-drawn layout/pose sketch for this panel, if supplied. Used as a structural reference for camera angle and blocking."
      },
      "scene_description": {
        "type": "string",
        "description": "Natural-language description of the action, mood, camera angle, and lighting for this panel."
      },
      "aspect_ratio": {
        "type": "string",
        "description": "Panel's aspect ratio from the page layout, e.g. '4:5', '16:9'."
      }
    },
    "required": ["panel_id", "characters", "scene_description", "aspect_ratio"]
  }
}
```

**What Claude does before calling this tool:** resolves character/place/style
IDs dropped in the UI into their stored reference-image sets, reconciles the
sketch region links with the character list, and turns the user's freeform
scene text into `scene_description` — cleaning it up but not inventing new
plot content. The tool handler (your backend, not Claude) then:
1. Assembles the multi-reference request (character images + place image +
   sketch as a composition reference).
2. Calls the image backend (Nano Banana Pro / Gemini API) with that payload.
3. Returns `{panel_id, image_asset_id, seed_or_generation_id}` as the
   `tool_result` so Claude can reference this panel in later edit calls.

## edit_panel

Called after a panel exists, for natural-language edits: removing an object,
changing a face feature, adjusting an expression, etc. This is what makes the
"remove elements / update objects after generation" requirement work without a
manual masking UI — though `mask_region` is still accepted for precision when
the user does draw a mask.

```json
{
  "name": "edit_panel",
  "description": "Apply a targeted edit to an already-generated panel image: remove an object, change a character's face/pose/expression, alter the background, or otherwise modify part of the existing image while preserving everything else. Call this for edit requests on an existing panel. Do not call this to generate a brand-new panel — use generate_panel for that.",
  "input_schema": {
    "type": "object",
    "properties": {
      "panel_id": {
        "type": "string",
        "description": "ID of the panel being edited."
      },
      "source_image_asset_id": {
        "type": "string",
        "description": "Asset ID of the panel image version being edited (the most recent generation or a prior edit)."
      },
      "edit_instruction": {
        "type": "string",
        "description": "Natural-language description of the change, e.g. 'remove the coffee cup on the table', 'make her expression angrier', 'shorten his hair'."
      },
      "edit_type": {
        "type": "string",
        "enum": ["remove_object", "modify_feature", "modify_background", "other"],
        "description": "Coarse category of the edit, used to pick the right downstream editing strategy (e.g. inpaint-and-fill vs identity-preserving feature edit)."
      },
      "affected_character_id": {
        "type": "string",
        "description": "If the edit targets a specific character's face/body/pose, the character ID whose reference images should be re-applied to keep them on-model."
      },
      "mask_region": {
        "type": "object",
        "description": "Optional explicit region to constrain the edit to, if the user painted or boxed one. If omitted, the edit backend infers the region from edit_instruction.",
        "properties": {
          "shape": { "type": "string", "enum": ["mask", "bbox"] },
          "mask_asset_id": { "type": "string" },
          "bbox": {
            "type": "array",
            "items": { "type": "number" }
          }
        },
        "required": ["shape"]
      }
    },
    "required": ["panel_id", "source_image_asset_id", "edit_instruction", "edit_type"]
  }
}
```

**What the handler does:** if `mask_region` is present, it's passed straight
through as a precise edit region; if absent, the handler asks the image
backend to localize the edit from `edit_instruction` itself (Nano Banana
Pro/Gemini's native multi-turn image editing handles this without a mask in
most cases). When `affected_character_id` is set, the character's stored
reference images are re-supplied alongside the edit so the face/body stays
on-model rather than drifting. Returns a new `{panel_id, image_asset_id}` —
edits are non-destructive; keep the version history so "undo" is just
pointing back at a prior asset ID.

## Loop shape

```
tools = [generate_panel_schema, edit_panel_schema]
messages = [... user's request in plain language ...]

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    thinking={"type": "adaptive"},
    output_config={"effort": "high"},
    tools=tools,
    messages=messages,
)

# response.stop_reason == "tool_use" -> execute generate_panel/edit_panel
# handler calls your backend, returns tool_result, loop continues
# until stop_reason == "end_turn"
```

Both tools share one image backend behind the scenes — `generate_panel` is a
create, `edit_panel` is a create-with-reference-plus-instruction. Keeping them
as two tools (rather than one generic `image_op`) lets your harness gate them
differently later (e.g. confirm before an edit that touches a "final" page)
and keeps each tool's input schema honest about what fields actually matter
for that operation.
