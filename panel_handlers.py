"""Handlers for the generate_panel / edit_panel tool calls (see
manga_tool_schemas.md for the schemas Claude is given). These functions are
what a tool_use loop invokes once Claude decides to call one of those tools —
they turn the structured tool input into an image_backend call and a stored
asset.
"""

import asset_store
import image_backend

# format -> closing prompt line that sets the render style. Same asset
# library and same generate/edit tools serve all three — only this mapping
# and the page-layout model (grid vs. vertical scroll vs. document) differ.
STYLE_PRESETS = {
    "manga_bw": "Render as a single black-and-white manga panel with screentone shading and clean line art, aspect ratio {aspect_ratio}.",
    "manhwa_color": "Render as a single full-color manhwa/webtoon panel with soft cel shading, aspect ratio {aspect_ratio}.",
    "novel_illustration": "Render as a single full-bleed illustration in a painterly light-novel style, aspect ratio {aspect_ratio}.",
}


def _describe_sketch_placement(entities: list[dict], label: str) -> str:
    lines = []
    for i, entity in enumerate(entities, start=1):
        region = entity.get("sketch_region")
        if not region:
            continue
        if region["shape"] == "bbox":
            x, y, w, h = region["bbox"]
            lines.append(
                f"{label} {i} occupies the sketch region roughly "
                f"[{x:.2f}, {y:.2f}] to [{x + w:.2f}, {y + h:.2f}] (normalized coordinates)."
            )
        elif region["shape"] == "point":
            x, y = region["point"]
            lines.append(f"{label} {i} is centered near [{x:.2f}, {y:.2f}] in the sketch.")
        elif region["shape"] == "mask":
            lines.append(f"{label} {i}'s position is marked by the attached mask overlay.")
    return " ".join(lines)


def generate_panel_handler(tool_input: dict) -> dict:
    characters = tool_input["characters"]
    objects = tool_input.get("objects", [])
    reference_images: list[bytes] = []

    composition_sketch_id = tool_input.get("composition_sketch_id")
    if composition_sketch_id:
        reference_images.append(asset_store.load_bytes(composition_sketch_id))

    for char in characters:
        reference_images.extend(asset_store.load_bytes(rid) for rid in char["reference_image_ids"])
        region = char.get("sketch_region", {})
        if region.get("shape") == "mask" and region.get("mask_asset_id"):
            reference_images.append(asset_store.load_bytes(region["mask_asset_id"]))

    for obj in objects:
        reference_images.extend(asset_store.load_bytes(rid) for rid in obj["reference_image_ids"])
        region = obj.get("sketch_region", {})
        if region.get("shape") == "mask" and region.get("mask_asset_id"):
            reference_images.append(asset_store.load_bytes(region["mask_asset_id"]))

    place = tool_input.get("place")
    if place:
        reference_images.extend(asset_store.load_bytes(rid) for rid in place["reference_image_ids"])

    style = tool_input.get("style", {})
    reference_images.extend(asset_store.load_bytes(rid) for rid in style.get("reference_image_ids", []))

    prompt_parts = [tool_input["scene_description"]]

    cast_lines = []
    for i, char in enumerate(characters, start=1):
        pose = char.get("pose_or_expression")
        cast_lines.append(f"Character {i}" + (f": {pose}" if pose else ""))
    if cast_lines:
        prompt_parts.append("Cast in this panel — " + "; ".join(cast_lines) + ".")

    object_lines = []
    for i, obj in enumerate(objects, start=1):
        notes = obj.get("notes")
        object_lines.append(f"Object {i}" + (f": {notes}" if notes else ""))
    if object_lines:
        prompt_parts.append("Objects in this panel, matching their reference exactly — " + "; ".join(object_lines) + ".")

    if composition_sketch_id:
        placement = " ".join(
            filter(None, [_describe_sketch_placement(characters, "Character"), _describe_sketch_placement(objects, "Object")])
        )
        prompt_parts.append(
            "Follow the attached composition sketch for camera angle, pose, and layout."
            + (" " + placement if placement else "")
        )

    style_preset = tool_input.get("style_preset", "manga_bw")
    prompt_parts.append(STYLE_PRESETS[style_preset].format(aspect_ratio=tool_input["aspect_ratio"]))
    prompt = " ".join(prompt_parts)

    image_bytes = image_backend.generate_image(prompt, reference_images)
    image_asset_id = asset_store.save_bytes(image_bytes)

    return {
        "panel_id": tool_input["panel_id"],
        "image_asset_id": image_asset_id,
    }


def edit_panel_handler(tool_input: dict) -> dict:
    source_image = asset_store.load_bytes(tool_input["source_image_asset_id"])

    reference_images: list[bytes] = []
    mask_region = tool_input.get("mask_region")
    if mask_region and mask_region.get("shape") == "mask" and mask_region.get("mask_asset_id"):
        reference_images.append(asset_store.load_bytes(mask_region["mask_asset_id"]))

    affected_character_id = tool_input.get("affected_character_id")
    # In production, resolve affected_character_id -> its stored reference
    # image ids via the character library lookup; omitted here since that
    # lookup lives in the app's data layer, not this handler.

    instruction_parts = [tool_input["edit_instruction"]]

    if mask_region:
        if mask_region["shape"] == "mask":
            instruction_parts.append("Apply the edit only within the region marked by the attached mask image.")
        elif mask_region["shape"] == "bbox":
            x, y, w, h = mask_region["bbox"]
            instruction_parts.append(
                f"Apply the edit only within the region [{x:.2f}, {y:.2f}] to [{x + w:.2f}, {y + h:.2f}] "
                "(normalized coordinates)."
            )

    if tool_input["edit_type"] == "modify_feature" and affected_character_id:
        instruction_parts.append(
            "Keep the character's identity consistent with the attached reference images — "
            "only change what the instruction specifies."
        )

    instruction_parts.append("Preserve everything else in the image exactly as it is.")
    instruction = " ".join(instruction_parts)

    image_bytes = image_backend.edit_image(source_image, instruction, reference_images)
    image_asset_id = asset_store.save_bytes(image_bytes)

    return {
        "panel_id": tool_input["panel_id"],
        "image_asset_id": image_asset_id,
    }
