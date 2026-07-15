"""Thin wrapper around Gemini 3 Pro Image ("Nano Banana Pro") for panel
generation and editing. Nothing manga-specific lives here — panel_handlers.py
owns prompt construction; this module only knows how to call the model.
"""

from io import BytesIO

import PIL.Image
from google import genai

MODEL_ID = "gemini-3-pro-image-preview"

_client = genai.Client()  # reads GEMINI_API_KEY / GOOGLE_API_KEY from env


def generate_image(prompt: str, reference_images: list[bytes]) -> bytes:
    """Multi-reference generation: prompt + up to ~14 reference images.

    Order matters loosely — put the composition/pose sketch first if present,
    since the model leans on earlier images for structure and later ones for
    identity/style detail. Returns PNG bytes of the first image part.
    """
    contents = [PIL.Image.open(BytesIO(img)) for img in reference_images]
    contents.append(prompt)

    response = _client.models.generate_content(model=MODEL_ID, contents=contents)
    return _extract_image_bytes(response)


def edit_image(source_image: bytes, instruction: str, reference_images: list[bytes] | None = None) -> bytes:
    """Instruction-based edit of an existing image, optionally re-grounded
    with character reference images so an identity-sensitive edit (face,
    hair) doesn't drift off-model.
    """
    contents = [PIL.Image.open(BytesIO(source_image))]
    for img in reference_images or []:
        contents.append(PIL.Image.open(BytesIO(img)))
    contents.append(instruction)

    response = _client.models.generate_content(model=MODEL_ID, contents=contents)
    return _extract_image_bytes(response)


def _extract_image_bytes(response) -> bytes:
    for part in response.candidates[0].content.parts:
        if part.inline_data is not None:
            return part.inline_data.data
    raise RuntimeError("Gemini response contained no image part")
