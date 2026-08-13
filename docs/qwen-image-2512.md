# Qwen-Image-2512 本地图片生成

TakeBoard 的第一条真实图片生成链路选用 **Qwen-Image-2512 FP8**。它适合 24GB RTX 4090，
采用 Apache-2.0 许可，并有 ComfyUI 官方原生工作流。这里不把图片模型做成平台锁定项；它只是首个经过
验证的本地 Recipe，之后仍可继续接入其他开源模型或付费 API。

## 为什么选择它

- Qwen 官方将 2512 定位为图片生成质量更新，重点提升真人质感、自然细节和文字渲染；
- FP8 是 ComfyUI 对消费级 NVIDIA GPU 推荐的平衡版本，显著小于 BF16；
- 既提供 50 步质量模式，也提供 LightX2V 4 步 Lightning 快速抽卡模式；
- 官方推荐画幅包含 `1328×1328`、`1664×928` 和 `928×1664`，适合横版与竖版影视概念图；
- TakeBoard 可把输出图片继续作为人物、场景、道具或图生图/图生视频输入资产。

官方资料：

- <https://huggingface.co/Qwen/Qwen-Image-2512>
- <https://docs.comfy.org/tutorials/image/qwen/qwen-image-2512>
- <https://huggingface.co/Qwen/Qwen-Image/blob/main/LICENSE>

## 安装内容

| 文件 | 用途 | 约占空间 | 官方 SHA-256 |
| --- | --- | ---: | --- |
| `qwen_image_2512_fp8_e4m3fn.safetensors` | 扩散模型 | 20.4 GB | `5dc80554d5d83390046a2f4a94ece06afb7700bf7b0aaf8bde9769793875876b` |
| `qwen_2.5_vl_7b_fp8_scaled.safetensors` | 文本编码器 | 9.38 GB | `cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4` |
| `qwen_image_vae.safetensors` | VAE | 254 MB | `a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f` |
| `Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors` | 2512 专用 4 步快速 LoRA | 1.7 GB | `ad12117461cb41e2ea637fec8df6392ce8e8550c47fbe2b829ed3deb98262066` |

安装脚本会并发下载、断点续传、逐文件验证上述哈希，最后才原子替换到 ComfyUI 模型目录。镜像站只作为
传输入口，不改变仓库、文件或校验依据。

```bash
HF_ENDPOINT=https://hf-mirror.com \
  /home/duanqw/Opc/Stortvideo/apps/ComfyUI-H3/env/bin/python \
  scripts/download-qwen-image-2512.py

python3 scripts/install-qwen-image-workflows.py
```

## TakeBoard 中的两种 Recipe

### Qwen Image 2512 T2I

- 无需输入素材；
- 默认 `928×1664`、50 Steps、CFG 4；
- Steps 调到 4 时自动启用 Lightning LoRA 和 CFG 1；
- 输出直接成为项目图片 Asset 和候选 Take，保留 Prompt、Seed、尺寸、Steps 与 Workflow Hash。

### Qwen Image 2512 I2I

- 从项目资产库选择一张输入图片；
- 默认重绘强度 `0.65`，可在 `0.05–1.0` 调整；
- `0.35` 左右更保守，`0.65` 平衡，`1.0` 接近全面重构；
- 这是 latent image-to-image，适合氛围、光线和风格变化。需要严格身份保持或指令式编辑时，后续应单独接入
  Qwen-Image-Edit 系列，而不把普通 I2I 误称为精确编辑。

## 运行边界

- 首次加载约 30GB 模型组件，速度明显慢于后续生成；
- 4090 同时运行视频任务时可以下载模型，但不应重启 ComfyUI 或插入图片烟雾测试；
- 50 步用于最终质量，4 步用于低成本抽卡，不建议把两者结果质量混为一谈；
- TakeBoard 会把过大的任意尺寸限制到最长边 1664、约 1.8MP，并对齐 32 像素网格，避免无意中触发显存风险。
