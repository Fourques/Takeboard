# 从这里开始

TakeBoard 是基于 ComfyUI 的开源 AI 创作画布。在同一工作区选择模型、连接素材、生成图片与视频，再用结果继续创作。

## 开始使用

[下载并安装](docs/downloads.md) · [English downloads](docs/downloads.en.md) · [首次创作指南](docs/first-session.md)

当前公开版本为 beta.17。桌面安装包包含应用运行时；生成需要自己的 ComfyUI、模型与节点。本机使用无需注册，没有生成环境时也可以先探索画布与素材操作。

第一次可以从文生图开始，或导入一张参考图片：选择可用工作流 → 连接需要的输入 → 填写提示词并生成 → 查看结果 → 将满意的结果用于下一步。无需先配置账号、门户、费用或批量审片。

[工作流与模型](docs/creator-workstation.md) · [连接远程 GPU](docs/generation-and-storage.md) · [项目目录与更新](docs/settings-and-updates.md)

## 从源码运行或贡献

安装版用户无需执行开发命令。开发者参阅[贡献指南](CONTRIBUTING.md)和[源码配置](docs/source-guide.md)。

提交前运行 `pnpm verify`，用户流程变更还需运行相关浏览器回归。大型产品、数据或安全变更先形成 Issue，并同步设计决策。漏洞按[安全策略](SECURITY.md)私下报告。

[文档索引](docs/README.md) · [产品定位](docs/product-strategy.md) · [路线图](docs/roadmap.md) · [版本记录](CHANGELOG.md)

公开反馈可以直接[描述卡住的步骤](https://github.com/Fourques/Takeboard/issues/new?template=first_try.yml)，不需要先自行诊断底层节点。
