# 第一次使用 TakeBoard

从一个想法开始，在画布中生成图片或视频，再把结果接入下一步创作。这里的“镜头”是画布上的一个生成单元，既可以生成图片，也可以生成视频。

[下载与首次打开](downloads.md) · [English](#english)

## 已有能正常运行的 ComfyUI

1. **创建项目。** 打开 TakeBoard，新建项目并确认文件夹。本机使用无需注册。
2. **连接生成设备。** 在“设置 → 设备连接”连接本机或远程 ComfyUI。项目保存位置不会随生成设备切换。
3. **添加工作流。** 从“可添加”选择与设备上的模型匹配的模板，或导入已在你的 ComfyUI 中运行过的工作流。TakeBoard 会检查节点、模型和输入；自定义工作流可能需要确认参数映射。只有检查可用后才开始生成。
4. **创建镜头并准备输入。** 选择生成类型与工作流，填写提示词。文生图/文生视频不要求图片；图生图、图生视频或参考生成则连接工作流要求的素材。一次先试一种输入。
5. **生成并查看结果。** 选择画幅并检查宽高；视频再检查时长。提交后等待结果返回，在画布或右侧详情中查看。想换一个方向，可以修改提示词继续尝试。
6. **继续创作。** 保留满意的结果，或将多个结果加入画布。把图片接入兼容的图生视频工作流，也可以将结果作为下一个镜头的参考素材。需要在其他软件使用时下载原文件；提示词、种子和输入保存在生成记录中。

连接线表达素材输入关系，不会自动执行整张画布。工作流的“可用”表示检查通过，并不保证当前 GPU 一定有足够资源或生成内容一定符合提示词。

## 还没有生成环境

安装包包含 TakeBoard 的运行时，但不包含 ComfyUI、模型或自定义节点。

可以先新建项目，导入一张自己的测试图片，移动节点、查看资产库，然后关闭重开项目。这条路径只试素材组织与保存，不会生成新图片或视频。准备生成时，可使用本机 ComfyUI，或在设置中连接自己的 GPU 服务器。

## 工作流检查没有通过

| 遇到的情况 | 下一步 |
| --- | --- |
| 缺少模型或节点 | 在所选生成设备的 ComfyUI 中补齐对应依赖，再重新检查 |
| 提示需要参数映射 | 在工作流设置中确认提示词、尺寸和素材对应的节点输入，并确认信任来源 |
| 节点图无法转换 | 在 ComfyUI 中导出 API 格式后重新导入；复杂自定义节点仍可能需要适配 |
| 素材没有按预期生效 | 核对工作流支持的输入、连线槽位以及该次生成记录中的素材；提示词中的名字不能代替输入连接 |

详细步骤见[创作指南](creator-workstation.md)。如仍然不通，可以直接反馈，不需要自己修改 TakeBoard 的代码。

## 卡住后如何反馈

告诉我们应用版本、系统、做到哪一步、预期什么以及实际发生了什么。若涉及工作流，附公开来源链接会更容易复现；不需要提供邮箱或真实姓名。

[第一次使用反馈](https://github.com/Fourques/Takeboard/issues/new?template=first_try.yml) · [使用交流](https://github.com/Fourques/Takeboard/discussions)

完成了第一次生成，也欢迎通过同一入口告诉我们做了什么、下一步想尝试什么。提交反馈需要 GitHub 账号；使用 TakeBoard 本身不需要。

截图和日志请去掉凭据与私人素材；安全问题按[安全策略](../SECURITY.md)私下报告。

## English

A “shot” is a generation unit on the canvas. It can produce an image or a video.

1. [Install TakeBoard](downloads.en.md), create a project and check its save folder. Local use needs no account.
2. Connect local or remote ComfyUI in **Settings → Device connections**. This does not move the project.
3. Add a recommended template matching the models on that device, or import a workflow you have already run in ComfyUI. Resolve missing nodes/models and confirm any required parameter bindings before selecting it.
4. Create a shot, choose the generation type and workflow, and write a prompt. Connect the media the workflow requires; text-only generation does not need a reference image.
5. Choose an aspect ratio and check the dimensions; set duration for video. Submit and view the result on the canvas or in the side panel. Adjust the prompt to explore another direction.
6. Keep a result or add several to the canvas. Connect an image to a compatible image-to-video workflow, or use a result as a reference for a new shot. Download original media for other tools; each attempt keeps its prompt, seed and inputs in its generation record.

Connections identify inputs; they do not automatically execute the whole canvas. Workflow checks cannot guarantee available GPU memory or the content of a model's output.

If a workflow will not run, install its missing dependencies on the generation device and recheck. Parameter mapping tells TakeBoard which node inputs to change. If the graph cannot be converted, export API format from ComfyUI and import that; some custom nodes may still need adaptation.

Without ComfyUI, you can try project creation, image import, the canvas and asset library, then reopen the saved project. ComfyUI, models and custom nodes are separate prerequisites for generation.

[Report a blocked step](https://github.com/Fourques/Takeboard/issues/new?template=first_try.yml) with your app version, OS and what happened. Public workflow links help; omit private media and credentials.

Completed your first generation? The same form welcomes successful experiences and what you want to try next. Posting feedback requires a GitHub account; using TakeBoard does not.
