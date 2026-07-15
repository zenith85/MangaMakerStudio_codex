"""Minimal local asset store: content-addressed images on disk.

Swap this for S3/GCS-backed storage later — the interface (load/save by
asset_id) is what panel_handlers.py depends on, not the backing filesystem.
"""

import hashlib
import os

ASSETS_DIR = os.path.join(os.path.dirname(__file__), "assets")


def _path_for(asset_id: str) -> str:
    return os.path.join(ASSETS_DIR, f"{asset_id}.png")


def save_bytes(data: bytes) -> str:
    os.makedirs(ASSETS_DIR, exist_ok=True)
    asset_id = hashlib.sha256(data).hexdigest()[:24]
    path = _path_for(asset_id)
    if not os.path.exists(path):
        with open(path, "wb") as f:
            f.write(data)
    return asset_id


def load_bytes(asset_id: str) -> bytes:
    with open(_path_for(asset_id), "rb") as f:
        return f.read()
