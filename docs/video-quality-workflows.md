# 视频工作流质量策略

TakeBoard 将“快速预演”和“最终质量”拆成独立 Workflow。它们不是模糊的推荐值，而是不同的执行图与可复现 Recipe。

## 当前工作流

| Workflow | 用途 | 采样路径 | 默认规格 |
| --- | --- | --- | --- |
| `Kino_Wan22_I2V.json` | 单首帧最终镜头 | Wan 2.2 双模型、20 steps、CFG 3.5、无 LightX2V | 480×848 / 848×480、16 fps |
| `Kino_Wan22_FLF2V.json` | 锁定开始与结束姿态 | Wan 2.2 双模型、20 steps、无 LightX2V | 480×848 / 848×480、16 fps |
| `Kino_Wan22_I2V_Preview.json` | 快速验证构图和动作 | 4 steps、CFG 1、LightX2V | 480×848 / 848×480、16 fps |
| `Kino_Wan22_FLF2V_Preview.json` | 快速验证首尾帧关系 | 4 steps、CFG 1、LightX2V | 480×848 / 848×480、16 fps |
| `Kino_MinimaxH3_T2V.json` | 文生原生音画 | 20 steps、24 fps、视频与 32 kHz 立体声联合生成 | 768px 短边，上限 768×1344 |
| `Kino_MinimaxH3_I2V.json` | 首帧/可选尾帧原生音画 | 20 steps、24 fps、视频与 32 kHz 立体声联合生成 | 768px 短边，上限 768×1344 |
| `Kino_MinimaxH3_R2V.json` | 多模态参考生成 | Ref2VA 独立权重、20 steps、`res_multistep` + `beta`、视频原声联合参考 | 最多 9 图 / 3 视频 / 3 音频，总文件数不超过 12 |
| `Kino_LTX23_I2V_Draft.json` | 氛围、空镜和低风险动作 | 两阶段生成与 x2 latent upscale | 480×848、25 fps |

## 安装或刷新工作流

脚本从当前 ComfyUI 安装自带的官方模板派生工作流，因此节点结构会与本机版本保持一致：

```bash
python3 scripts/install-video-quality-workflows.py
```

非默认 ComfyUI 目录：

```bash
COMFY_DIR=/path/to/ComfyUI python3 scripts/install-video-quality-workflows.py
```

安装完成后刷新 TakeBoard 的工作流列表即可。运行时参数由 TakeBoard Recipe 记录，直接在 ComfyUI 打开时也能看到相同的质量分层。

## 选择原则

- 用预演工作流验证动作方向、镜头运动和首尾帧是否相容；不要把预演结果当最终镜头。
- 最终 Wan 镜头使用高质量工作流。官方资料明确指出 4-step Lightning LoRA 会损失动态和质量，原始 20-step 路径是质量不足时的首选。
- MiniMax H3 适合需要对白、环境声、音效或配乐共同生成的镜头。提示词应同时描述画面时间线与声音时间线。
- H3 Ref2VA 与 FL2VA 是不同权重和执行图。参考视频会同时输入画面与原声；参考图、视频、音频必须在提示词中按接线顺序使用 `<Picture N>`、`<Video N>`、`<Audio N>`。TakeBoard 的 `@素材名` 会在提交时无损转换为这些模型标签，编辑框仍保留用户可读名称。
- H3 固定使用 24 fps，支持 4–15 秒。改变播放器帧率只会改变时序，不会提升模型质量，因此 TakeBoard 不把帧率作为 H3 的可调质量参数。
- Ref2VA 的“身份优先”会以更高参考图尺寸贯穿每个采样步骤，适合少量关键角色图；在 24 GB 显存上，多参考素材默认使用“平衡”更可靠。
- H3 的本地开源权重直接工作在 768p 基础层；官方 2K Regenerate 是额外的再生成阶段，不应把普通插值冒充 2K 生成。
- RTX 4090 24GB 上 Wan 2.2 14B 建议保持约 0.4MP，一次仅运行一个最终质量任务；镜头锁定后再统一做后期超分。

## 提示词结构

Wan 单镜头建议按以下顺序写，避免同时要求多个互相冲突的动作：

```text
主体与保持项。一个主要动作及其起止状态。次级运动。一个有动机的运镜。光线与材质连续性。真实时间速度。
```

MiniMax H3 FL2VA 建议使用官方的三个核心字段。首帧/尾帧素材应描述两者之间的连续动作路径，而不是重复两张静态图：

```text
integrated_multimodal_description: [Shot 1] 视觉风格、初始构图、主体动作、运镜、对白与同步声音。
overall_soundscape: 环境声、动作声与非语言人声。
non_diegetic_music: 配器、速度、节奏与动态；无配乐时写 N/A。
```

Ref2VA 的完整高质量结构为 `subject_definitions`、`summary`、`retention_analysis`、`detailed_description`、`overall_soundscape`、`non_diegetic_music`。无需把文件改名成“图一”；在 TakeBoard 中输入 `@角色正面`，提交时会按实际接线顺序编译为 `<Picture 1>`。

## 依据

- [ComfyUI Wan 2.2 官方工作流](https://docs.comfy.org/tutorials/video/wan/wan2_2)
- [ComfyUI Wan 2.2 S2V 质量说明](https://docs.comfy.org/tutorials/video/wan/wan2-2-s2v)
- [MiniMax H3 官方模型说明](https://huggingface.co/MiniMaxAI/MiniMax-H3)
- [ComfyUI MiniMax H3 官方模板](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_minimax_h3_i2v.json)
- [MiniMax H3 官方基础模式提示词指南](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md)
- [MiniMax H3 官方全参考提示词指南](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md)
- [LTX 2.3 官方两阶段 HQ Pipeline](https://huggingface.co/Lightricks/LTX-2.3)
