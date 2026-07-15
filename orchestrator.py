"""Claude tool-use loop that turns a user's panel request into calls to
generate_panel_handler / edit_panel_handler. This is the "Claude cooks"
step from the product flow: Claude never touches pixels — it decides which
tool to call and with what arguments, panel_handlers.py + image_backend.py
do the actual generation.
"""

import json

import anthropic

import panel_handlers

MODEL = "claude-opus-4-8"

TOOLS = [
    {
        "name": "generate_panel",
        "description": (
            "Generate a manga panel image from character references, a place/background "
            "reference, an optional hand-drawn composition sketch with region-to-character "
            "links, and a scene description. Call this once per panel when the user has "
            "finished assembling that panel's inputs and wants art generated. Do not call "
            "this for edits to an already-generated panel — use edit_panel instead."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "panel_id": {"type": "string", "description": "ID of the panel slot on the page layout this generation fills."},
                "characters": {
                    "type": "array",
                    "description": "Characters appearing in this panel, in the order they matter to the scene.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "character_id": {"type": "string", "description": "ID of a character from the user's character library."},
                            "reference_image_ids": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "IDs of stored reference images/embeddings for this character.",
                            },
                            "sketch_region": {
                                "type": "object",
                                "description": "Where this character is placed if the user supplied a hand-drawn sketch.",
                                "properties": {
                                    "shape": {"type": "string", "enum": ["mask", "bbox", "point"]},
                                    "mask_asset_id": {"type": "string"},
                                    "bbox": {"type": "array", "items": {"type": "number"}},
                                    "point": {"type": "array", "items": {"type": "number"}},
                                },
                                "required": ["shape"],
                            },
                            "pose_or_expression": {"type": "string"},
                        },
                        "required": ["character_id", "reference_image_ids"],
                    },
                },
                "objects": {
                    "type": "array",
                    "description": "Specific consistency-tracked objects appearing in this panel (a named sword, vehicle, artifact, etc.).",
                    "items": {
                        "type": "object",
                        "properties": {
                            "object_id": {"type": "string"},
                            "reference_image_ids": {"type": "array", "items": {"type": "string"}},
                            "sketch_region": {
                                "type": "object",
                                "properties": {
                                    "shape": {"type": "string", "enum": ["mask", "bbox", "point"]},
                                    "mask_asset_id": {"type": "string"},
                                    "bbox": {"type": "array", "items": {"type": "number"}},
                                    "point": {"type": "array", "items": {"type": "number"}},
                                },
                                "required": ["shape"],
                            },
                            "notes": {"type": "string"},
                        },
                        "required": ["object_id", "reference_image_ids"],
                    },
                },
                "place": {
                    "type": "object",
                    "properties": {
                        "place_id": {"type": "string"},
                        "reference_image_ids": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["place_id", "reference_image_ids"],
                },
                "style_preset": {
                    "type": "string",
                    "enum": ["manga_bw", "manhwa_color", "novel_illustration"],
                    "description": "Which format this panel/illustration belongs to — set from the project's format.",
                },
                "style": {
                    "type": "object",
                    "properties": {
                        "style_id": {"type": "string"},
                        "reference_image_ids": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["style_id"],
                },
                "composition_sketch_id": {"type": "string"},
                "scene_description": {"type": "string"},
                "aspect_ratio": {"type": "string"},
            },
            "required": ["panel_id", "characters", "scene_description", "aspect_ratio"],
        },
    },
    {
        "name": "edit_panel",
        "description": (
            "Apply a targeted edit to an already-generated panel image: remove an object, "
            "change a character's face/pose/expression, alter the background, or otherwise "
            "modify part of the existing image while preserving everything else. Call this "
            "for edit requests on an existing panel. Do not call this to generate a brand-new "
            "panel — use generate_panel for that."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "panel_id": {"type": "string"},
                "source_image_asset_id": {"type": "string"},
                "edit_instruction": {"type": "string"},
                "edit_type": {"type": "string", "enum": ["remove_object", "modify_feature", "modify_background", "other"]},
                "affected_character_id": {"type": "string"},
                "mask_region": {
                    "type": "object",
                    "properties": {
                        "shape": {"type": "string", "enum": ["mask", "bbox"]},
                        "mask_asset_id": {"type": "string"},
                        "bbox": {"type": "array", "items": {"type": "number"}},
                    },
                    "required": ["shape"],
                },
            },
            "required": ["panel_id", "source_image_asset_id", "edit_instruction", "edit_type"],
        },
    },
]

_TOOL_DISPATCH = {
    "generate_panel": panel_handlers.generate_panel_handler,
    "edit_panel": panel_handlers.edit_panel_handler,
}

_client = anthropic.Anthropic()


def run_turn(messages: list[dict]) -> list[dict]:
    """Runs the tool-use loop for one user turn. Mutates and returns the
    full message history, including all tool_use / tool_result round trips.
    """
    while True:
        response = _client.messages.create(
            model=MODEL,
            max_tokens=4096,
            thinking={"type": "adaptive"},
            output_config={"effort": "high"},
            tools=TOOLS,
            messages=messages,
        )
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason != "tool_use":
            return messages

        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            handler = _TOOL_DISPATCH[block.name]
            try:
                result = handler(block.input)
                tool_results.append(
                    {"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result)}
                )
            except Exception as e:
                tool_results.append(
                    {"type": "tool_result", "tool_use_id": block.id, "content": str(e), "is_error": True}
                )

        messages.append({"role": "user", "content": tool_results})
