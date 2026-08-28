#!/usr/bin/env python3
"""Download and verify the official ComfyUI Qwen-Image-2512 FP8 bundle."""

from __future__ import annotations

import hashlib
import os
from argparse import ArgumentParser
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from huggingface_hub import hf_hub_download

COMFY_DIR = Path(os.environ.get("COMFY_DIR", Path.home() / "ComfyUI"))
MODEL_ROOT = COMFY_DIR / "models"
DOWNLOAD_ROOT = COMFY_DIR / "download_cache" / "qwen-image-2512"

FILES = (
    {
        "repo": "Comfy-Org/Qwen-Image_ComfyUI",
        "filename": "split_files/diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors",
        "destination": "diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors",
        "sha256": "5dc80554d5d83390046a2f4a94ece06afb7700bf7b0aaf8bde9769793875876b",
    },
    {
        "repo": "Comfy-Org/Qwen-Image_ComfyUI",
        "filename": "split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors",
        "destination": "text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors",
        "sha256": "cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4",
    },
    {
        "repo": "Comfy-Org/Qwen-Image_ComfyUI",
        "filename": "split_files/vae/qwen_image_vae.safetensors",
        "destination": "vae/qwen_image_vae.safetensors",
        "sha256": "a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f",
    },
    {
        "repo": "lightx2v/Qwen-Image-2512-Lightning",
        "filename": "Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors",
        "destination": "loras/Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors",
        "sha256": "ad12117461cb41e2ea637fec8df6392ce8e8550c47fbe2b829ed3deb98262066",
    },
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(16 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(item: dict[str, str]) -> tuple[dict[str, str], Path]:
    destination = MODEL_ROOT / item["destination"]
    if destination.is_file() and sha256(destination) == item["sha256"]:
        return item, destination
    local_dir = DOWNLOAD_ROOT / item["repo"].replace("/", "--")
    path = Path(
        hf_hub_download(
            repo_id=item["repo"],
            filename=item["filename"],
            local_dir=local_dir,
        )
    )
    actual = sha256(path)
    if actual != item["sha256"]:
        raise RuntimeError(f"SHA-256 mismatch for {item['filename']}: {actual}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    os.replace(path, destination)
    return item, destination


def main() -> None:
    parser = ArgumentParser(description=__doc__)
    parser.add_argument(
        "--only",
        action="append",
        default=[],
        metavar="FILENAME",
        help="download only the named destination file; repeat for multiple files",
    )
    arguments = parser.parse_args()
    selected = [
        item
        for item in FILES
        if not arguments.only or Path(item["destination"]).name in arguments.only
    ]
    if not selected:
        parser.error("--only did not match a bundle destination filename")
    DOWNLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=min(4, len(selected))) as executor:
        futures = [executor.submit(download, item) for item in selected]
        for future in as_completed(futures):
            item, destination = future.result()
            print(f"verified {item['sha256']}  {destination}", flush=True)


if __name__ == "__main__":
    main()
