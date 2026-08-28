#!/usr/bin/env python3
"""Install TakeBoard's curated Wan 2.2 and MiniMax H3 workflows.

The graphs are derived from the official ComfyUI workflow templates already
shipped with the active ComfyUI installation. This keeps node schemas aligned
with the installed ComfyUI version while making the quality choice explicit.
"""

from __future__ import annotations

import copy
import json
import os
import shutil
from pathlib import Path
from typing import Any


COMFY_DIR = Path(os.environ.get("COMFY_DIR", Path.home() / "ComfyUI"))
WORKFLOW_DIR = COMFY_DIR / "user" / "default" / "workflows" / "Kino"

QUALITY_PROMPT = (
    "A single cinematic shot. Preserve the supplied subject identity, anatomy, clothing, "
    "props, composition, lighting, and environment. Describe one clear primary action, "
    "natural acceleration and deceleration, restrained secondary motion, and one motivated "
    "camera move. Real-time motion, physically grounded weight, stable texture and exposure."
)
PREVIEW_PROMPT = (
    "Motion and composition preview. Preserve the supplied subject and scene. One clear action, "
    "restrained motion, stable camera, consistent identity and lighting."
)

H3_PROMPT = (
    "integrated_multimodal_description: [Shot 1] Live-action, cinematic. Describe a clear "
    "audiovisual timeline with stable subjects, motivated camera movement, visible actions, "
    "dialogue, and synchronized physical sounds.\n\n"
    "overall_soundscape: Natural location ambience and synchronized physical sounds.\n\n"
    "non_diegetic_music: N/A"
)


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def official_template(filename: str, blueprint: str | None = None) -> Path:
    candidates: list[Path] = []
    candidates.extend(
        COMFY_DIR.glob(
            f"env/lib/python*/site-packages/comfyui_workflow_templates_json/templates/{filename}"
        )
    )
    if blueprint:
        candidates.append(COMFY_DIR / "blueprints" / blueprint)
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"Official ComfyUI template not found: {filename}")


def configure_i2v(preview: bool) -> dict[str, Any]:
    source = official_template("video_wan2_2_14B_i2v.json", "Image to Video (Wan 2.2).json")
    workflow = copy.deepcopy(load_json(source))
    workflow["id"] = f"takeboard-wan22-i2v-{'preview' if preview else 'quality'}"
    subgraphs = workflow.get("definitions", {}).get("subgraphs", [])
    if len(subgraphs) != 1:
        raise ValueError("Official Wan 2.2 I2V template no longer has one subgraph")
    instance = next(
        (item for item in workflow.get("nodes", []) if item.get("type") == subgraphs[0].get("id")),
        None,
    )
    values = instance.get("widgets_values") if instance else None
    if not isinstance(values, list) or not values or not isinstance(values[-1], bool):
        raise ValueError("Wan 2.2 I2V quality switch was not found")
    values[0] = PREVIEW_PROMPT if preview else QUALITY_PROMPT
    values[1:4] = [480, 848, 5]
    values[-1] = preview
    for item in workflow.get("nodes", []):
        if item.get("type") == "SaveVideo":
            item["widgets_values"] = [
                f"takeboard/wan22/{'preview' if preview else 'quality'}/i2v",
                "auto",
                "auto",
            ]
        if item.get("title") == "VRAM Usage":
            item["widgets_values"] = [
                "## TakeBoard profile\n\n"
                + (
                    "**快速预演**：4 steps + LightX2V，适合验证动作和构图，不用于最终镜头。"
                    if preview
                    else "**高质量**：20 steps、CFG 3.5、不使用 LightX2V，优先保留动态、纹理和光影。"
                )
                + "\n\nRTX 4090 24GB 建议保持约 0.4MP（480×848 / 848×480），一次运行一个视频任务。"
            ]
    return workflow


def configure_flf2v(preview: bool) -> dict[str, Any]:
    source = official_template("video_wan2_2_14B_flf2v.json")
    workflow = copy.deepcopy(load_json(source))
    workflow["id"] = f"takeboard-wan22-flf2v-{'preview' if preview else 'quality'}"
    if preview:
        quality_types = {
            "CLIPLoader",
            "CLIPTextEncode",
            "CreateVideo",
            "KSamplerAdvanced",
            "LoadImage",
            "ModelSamplingSD3",
            "SaveVideo",
            "UNETLoader",
            "VAEDecode",
            "VAELoader",
            "WanFirstLastFrameToVideo",
        }
        for item in workflow.get("nodes", []):
            if item.get("mode", 0) == 4:
                item["mode"] = 0
            elif item.get("type") in quality_types and item.get("mode", 0) == 0:
                item["mode"] = 4
    for item in workflow.get("nodes", []):
        if item.get("mode", 0) != 0:
            continue
        if item.get("type") == "CLIPTextEncode" and "Positive" in item.get("title", ""):
            item["widgets_values"] = [PREVIEW_PROMPT if preview else QUALITY_PROMPT]
        elif item.get("type") == "WanFirstLastFrameToVideo":
            item["widgets_values"] = [480, 848, 81, 1]
        elif item.get("type") == "SaveVideo":
            item["widgets_values"] = [
                f"takeboard/wan22/{'preview' if preview else 'quality'}/flf2v",
                "auto",
                "auto",
            ]
    return workflow


def configure_h3(mode: str) -> dict[str, Any]:
    filenames = {
        "t2v": "video_minimax_h3_t2v.json",
        "i2v": "video_minimax_h3_i2v.json",
        "r2v": "video_minimax_h3_r2v.json",
    }
    workflow = copy.deepcopy(load_json(official_template(filenames[mode])))
    workflow["id"] = f"takeboard-minimax-h3-{mode}"
    for item in workflow.get("nodes", []):
        node_type = item.get("type")
        if node_type == "SaveVideo":
            item["widgets_values"] = [f"takeboard/minimax-h3/{mode}", "auto", "auto"]
        elif node_type == "BasicScheduler" and mode == "r2v":
            # Official Comfy template notes beta/normal is preferable for
            # reference-heavy prompts; retain the published 20-step baseline.
            item["widgets_values"] = ["beta", 20, 1]
        elif node_type == "MiniMaxH3ImageToVideo":
            values = item.get("widgets_values")
            if isinstance(values, list) and values:
                values[0] = H3_PROMPT
        elif node_type == "PrimitiveStringMultiline" and mode == "r2v":
            values = item.get("widgets_values")
            if isinstance(values, list) and values:
                values[0] = (
                    "subject_definitions: Define each <Subject N> from <Picture N>, <Video N>, "
                    "or <Audio N>.\n\nsummary: [reference generation] Describe the intended target."
                    "\n\nretention_analysis: State what must remain stable."
                    "\n\ndetailed_description: [Shot 1] Describe the complete visual and audio timeline."
                    "\n\noverall_soundscape: Describe synchronized ambience and physical sounds."
                    "\n\nnon_diegetic_music: N/A"
                )
    return workflow


def install(filename: str, workflow: dict[str, Any]) -> None:
    WORKFLOW_DIR.mkdir(parents=True, exist_ok=True)
    destination = WORKFLOW_DIR / filename
    backup = destination.with_suffix(".json.before-quality-upgrade.bak")
    if destination.is_file() and not backup.exists():
        shutil.copy2(destination, backup)
    temporary = destination.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, destination)
    print(f"Installed {destination}")


def main() -> None:
    install("Kino_Wan22_I2V.json", configure_i2v(preview=False))
    install("Kino_Wan22_FLF2V.json", configure_flf2v(preview=False))
    install("Kino_Wan22_I2V_Preview.json", configure_i2v(preview=True))
    install("Kino_Wan22_FLF2V_Preview.json", configure_flf2v(preview=True))
    install("Kino_MinimaxH3_T2V.json", configure_h3("t2v"))
    install("Kino_MinimaxH3_I2V.json", configure_h3("i2v"))
    install("Kino_MinimaxH3_R2V.json", configure_h3("r2v"))


if __name__ == "__main__":
    main()
