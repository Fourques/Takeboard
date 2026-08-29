# TakeBoard 从这里开始

更新时间：2026-08-30
当前阶段：0.1.0 Public Preview

TakeBoard 是面向 ComfyUI 创作者的开源、本地优先 AI 影像工作台。它已经从早期 M0 验证进入公开预览：核心项目闭环、跨平台启动、账号权限、Workflow Binding、生成恢复、数据迁移和运行诊断均已落地；正式版仍需要陌生用户任务测试、真实 GPU 兼容矩阵和签名桌面安装。

## 我只是想开始使用

| 系统 | 操作 |
| --- | --- |
| macOS | 右键打开 `START-TAKEBOARD.command` |
| Windows | 双击 `START-TAKEBOARD.cmd` |
| Linux | 首次运行 `npm run easy:setup`，以后运行 `npm run easy` |

启动失败时运行 `npm run easy:doctor`。远程使用运行
`npm run easy:remote -- your-server`；它使用标准 SSH、自动探测端口，并在退出时释放隧道。

完整说明见 [README](README.md)、[创作工作站指南](docs/creator-workstation.md)、[远程访问](docs/remote-access.md)和[自托管部署](docs/self-hosting.md)。

## 推荐的第一个真实任务

```text
创建空白项目
  → 导入一张原始图片或参考视频
  → 创建镜头并建立首帧/尾帧/参考连线
  → 选择内置 Recipe，或诊断并显式绑定自己的 Workflow
  → 生成 1–4 个独立候选
  → 比较、淘汰并批准一个 Take
  → 在分镜墙与只读粗剪中检查顺序
  → 下载完整项目包和脱敏运行诊断
  → 关闭、重开并确认来源和批准状态仍在
```

没有 ComfyUI 时，项目、画布、资产和分镜仍可使用；真实生成会明确显示执行端离线，不会伪造成功。

## 我想贡献代码或 Workflow

1. 阅读 [贡献指南](CONTRIBUTING.md)和[安全策略](SECURITY.md)；
2. 使用 GitHub Issue chooser 选择 Bug、Workflow 兼容性或功能建议；
3. 运行 `pnpm verify`，用户流程变更还需运行 `pnpm test:e2e`；
4. 大型产品、数据或安全变更先形成 Issue，并同步 `docs/decisions.md`。

自定义 ComfyUI Workflow 不会因为导入成功或文件名相似而直接执行。需要明确的参数/媒体 Binding、内容哈希、依赖预检和用户信任；TakeBoard 也不会自动安装模型或 Custom Node。

## 当前发布边界

- 适合：个人本机、SSH 远程、可信小团队自托管；
- 有条件适合：经严格 HTTPS/Host/Origin 配置的团队入口；
- 不适合：直接暴露端口、公网多租户 SaaS、企业身份、零技术支持消费级分发；
- 不宣称：任意 Workflow 自动执行、所有 GPU/节点组合兼容、完整专业剪辑软件。

完整证据和下一道 Gate 见[成熟度评估](docs/maturity-audit-2026-08-30.md)，历史实施计划见[路线图](docs/roadmap.md)，本轮推广节奏见[首轮推广执行包](docs/launch-kit.md)。
