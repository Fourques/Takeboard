#!/usr/bin/env python3
"""Install editable Qwen-Image-2512 workflows into the active ComfyUI profile."""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path
from typing import Any


COMFY_DIR = Path(os.environ.get("COMFY_DIR", "/home/duanqw/Opc/Stortvideo/apps/ComfyUI-H3"))
WORKFLOW_DIR = COMFY_DIR / "user" / "default" / "workflows" / "Kino"
BLUEPRINT = COMFY_DIR / "blueprints" / "Text to Image (Qwen-Image 2512).json"


def node(
    node_id: int,
    node_type: str,
    pos: tuple[int, int],
    size: tuple[int, int],
    order: int,
    inputs: list[dict[str, Any]],
    outputs: list[dict[str, Any]],
    widgets: list[Any],
    title: str,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": node_type,
        "pos": list(pos),
        "size": list(size),
        "flags": {},
        "order": order,
        "mode": 0,
        "inputs": inputs,
        "outputs": outputs,
        "properties": {
            "Node name for S&R": node_type,
            "cnr_id": "comfy-core",
            "ver": "0.3.45",
        },
        "widgets_values": widgets,
        "title": title,
    }


def linked_input(name: str, value_type: str, link: int) -> dict[str, Any]:
    return {"name": name, "type": value_type, "link": link}


def widget_input(name: str, value_type: str) -> dict[str, Any]:
    return {"name": name, "type": value_type, "widget": {"name": name}, "link": None}


def output(
    name: str, value_type: str, links: list[int] | None, slot_index: int = 0
) -> dict[str, Any]:
    return {"name": name, "type": value_type, "slot_index": slot_index, "links": links}


def image_to_image_workflow() -> dict[str, Any]:
    links: list[list[Any]] = []

    def connect(link_id: int, source: int, source_slot: int, target: int, target_slot: int, value_type: str) -> None:
        links.append([link_id, source, source_slot, target, target_slot, value_type])

    connect(1, 1, 0, 7, 0, "MODEL")
    connect(2, 2, 0, 5, 0, "CLIP")
    connect(3, 2, 0, 6, 0, "CLIP")
    connect(4, 7, 0, 10, 0, "MODEL")
    connect(5, 5, 0, 10, 1, "CONDITIONING")
    connect(6, 6, 0, 10, 2, "CONDITIONING")
    connect(7, 4, 0, 9, 0, "IMAGE")
    connect(8, 9, 0, 8, 0, "IMAGE")
    connect(9, 3, 0, 8, 1, "VAE")
    connect(13, 8, 0, 10, 3, "LATENT")
    connect(10, 10, 0, 11, 0, "LATENT")
    connect(11, 3, 0, 11, 1, "VAE")
    connect(12, 11, 0, 12, 0, "IMAGE")

    nodes = [
        node(
            1,
            "UNETLoader",
            (-880, -260),
            (330, 82),
            0,
            [widget_input("unet_name", "COMBO"), widget_input("weight_dtype", "COMBO")],
            [output("MODEL", "MODEL", [1])],
            ["qwen_image_2512_fp8_e4m3fn.safetensors", "default"],
            "① Qwen-Image-2512 FP8",
        ),
        node(
            2,
            "CLIPLoader",
            (-880, -110),
            (330, 106),
            1,
            [
                widget_input("clip_name", "COMBO"),
                widget_input("type", "COMBO"),
                widget_input("device", "COMBO"),
            ],
            [output("CLIP", "CLIP", [2, 3])],
            ["qwen_2.5_vl_7b_fp8_scaled.safetensors", "qwen_image", "default"],
            "② Qwen 2.5 VL Text Encoder",
        ),
        node(
            3,
            "VAELoader",
            (-880, 70),
            (330, 58),
            2,
            [widget_input("vae_name", "COMBO")],
            [output("VAE", "VAE", [9, 11])],
            ["qwen_image_vae.safetensors"],
            "③ Qwen Image VAE",
        ),
        node(
            4,
            "LoadImage",
            (-880, 220),
            (330, 420),
            3,
            [],
            [output("IMAGE", "IMAGE", [7]), output("MASK", "MASK", None, 1)],
            ["Kino_input.png", "image"],
            "④ 输入图片",
        ),
        node(
            9,
            "ImageScale",
            (-450, 460),
            (330, 154),
            7,
            [
                linked_input("image", "IMAGE", 7),
                widget_input("upscale_method", "COMBO"),
                widget_input("width", "INT"),
                widget_input("height", "INT"),
                widget_input("crop", "COMBO"),
            ],
            [output("IMAGE", "IMAGE", [8])],
            ["lanczos", 928, 1664, "center"],
            "⑧ 对齐输出尺寸",
        ),
        node(
            5,
            "CLIPTextEncode",
            (-450, -260),
            (420, 220),
            4,
            [linked_input("clip", "CLIP", 2), widget_input("text", "STRING")],
            [output("CONDITIONING", "CONDITIONING", [5])],
            ["保持主体身份与构图，把画面改为电影感真实摄影，光线自然，细节清晰。"],
            "⑤ 正向提示词",
        ),
        node(
            6,
            "CLIPTextEncode",
            (-450, 40),
            (420, 180),
            5,
            [linked_input("clip", "CLIP", 3), widget_input("text", "STRING")],
            [output("CONDITIONING", "CONDITIONING", [6])],
            ["低画质，畸形肢体，身份漂移，蜡像感，文字扭曲，水印"],
            "⑥ 负向提示词",
        ),
        node(
            7,
            "ModelSamplingAuraFlow",
            (-450, 300),
            (330, 82),
            6,
            [linked_input("model", "MODEL", 1), widget_input("shift", "FLOAT")],
            [output("MODEL", "MODEL", [4])],
            [3.1],
            "⑦ Qwen 采样配置",
        ),
        node(
            8,
            "VAEEncode",
            (-40, 460),
            (250, 82),
            7,
            [linked_input("pixels", "IMAGE", 8), linked_input("vae", "VAE", 9)],
            [output("LATENT", "LATENT", [13])],
            [],
            "⑨ 编码输入图",
        ),
        node(
            10,
            "KSampler",
            (80, -180),
            (340, 300),
            8,
            [
                linked_input("model", "MODEL", 4),
                linked_input("positive", "CONDITIONING", 5),
                linked_input("negative", "CONDITIONING", 6),
                linked_input("latent_image", "LATENT", 13),
                widget_input("seed", "INT"),
                widget_input("steps", "INT"),
                widget_input("cfg", "FLOAT"),
                widget_input("sampler_name", "COMBO"),
                widget_input("scheduler", "COMBO"),
                widget_input("denoise", "FLOAT"),
            ],
            [output("LATENT", "LATENT", [10])],
            [2512, "randomize", 50, 4.0, "euler", "simple", 0.65],
            "⑩ 生成（Denoise 控制重绘强度）",
        ),
        node(
            11,
            "VAEDecode",
            (520, -180),
            (250, 82),
            9,
            [linked_input("samples", "LATENT", 10), linked_input("vae", "VAE", 11)],
            [output("IMAGE", "IMAGE", [12])],
            [],
            "⑪ 解码",
        ),
        node(
            12,
            "SaveImage",
            (850, -180),
            (480, 520),
            10,
            [linked_input("images", "IMAGE", 12), widget_input("filename_prefix", "STRING")],
            [],
            ["takeboard/qwen_image_2512/i2i"],
            "⑫ 保存图片",
        ),
    ]
    return {
        "id": "takeboard-qwen-image-2512-i2i",
        "revision": 0,
        "last_node_id": 12,
        "last_link_id": 13,
        "nodes": nodes,
        "links": links,
        "groups": [],
        "config": {},
        "extra": {"ds": {"scale": 0.8, "offset": [930, 520]}},
        "version": 0.4,
    }


def main() -> None:
    if not BLUEPRINT.is_file():
        raise FileNotFoundError(f"Official Qwen blueprint not found: {BLUEPRINT}")
    WORKFLOW_DIR.mkdir(parents=True, exist_ok=True)
    with BLUEPRINT.open("r", encoding="utf-8") as file:
        text_to_image = json.load(file)
    text_to_image = copy.deepcopy(text_to_image)
    text_to_image["id"] = "takeboard-qwen-image-2512-t2i"
    destinations = {
        "Kino_QwenImage2512_T2I.json": text_to_image,
        "Kino_QwenImage2512_I2I.json": image_to_image_workflow(),
    }
    for filename, workflow in destinations.items():
        destination = WORKFLOW_DIR / filename
        temporary = destination.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, destination)
        print(f"Installed {destination}")


if __name__ == "__main__":
    main()
