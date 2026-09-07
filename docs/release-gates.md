# 发布门槛

TakeBoard 的发布判断不使用“页面能打开”代替可靠性证据。候选版本至少通过以下三层门槛。

## 自动门槛

```bash
pnpm gate:release
```

该命令包含 lint、类型检查、生产构建、包体预算、全部单元/集成测试和 Playwright 浏览器旅程。其中：

- `release-gates.test.ts` 提交 40 个独立 Run，关闭并重建服务，再逐个从 ComfyUI History 对账；必须 40/40 完成，40 个 Take 和 40 个视频 Asset 必须与原 Run 一一对应。
- `large-canvas.spec.ts` 创建并实际渲染 500 个画布节点；打开时间必须低于 8 秒，60 帧采样 p95 必须低于 100ms，交互仍然有效。
- `project-sync.spec.ts` 使用两个浏览器上下文制造真实旧 revision 写入；服务端必须阻止覆盖，第二页面恢复最新状态，随后继续自动同步。

阈值故意保留 CI 波动空间；它们是阻止明显回退的底线，不是对所有电脑的帧率承诺。

## 真实 GPU 门槛

先启动 TakeBoard 与 ComfyUI，再使用专门的本地 Gate 账号运行：

```bash
TAKEBOARD_GATE_EMAIL='gate@example.com' \
TAKEBOARD_GATE_PASSWORD='本次使用的密码' \
pnpm gate:gpu
```

可用 `TAKEBOARD_GATE_URL`、`TAKEBOARD_GATE_WORKFLOW`、`TAKEBOARD_GATE_TIMEOUT_MINUTES` 覆盖入口、工作流和超时。脚本不会把密码写入报告。它会真实执行：

1. 验证 TakeBoard、ComfyUI、Workflow、模型与原生/可信 Binding；
2. 创建隔离 Gate 项目和镜头；
3. 提交 MiniMax H3 T2V，读取真实进度直至终态；
4. 验证 Run、Take、视频 Asset，并对项目媒体执行 Range 读取；
5. 输出 v2 JSON 证据到 `test-results/release-gates/`，不含凭据、提示词、项目名、运行 ID 或绝对路径；
6. 默认把 Gate 项目移入回收区；设置 `TAKEBOARD_GATE_KEEP=1` 可保留项目供人工观看。

`TAKEBOARD_GATE_AUTH=off` 仅供像 CI/临时数据目录这样的隔离回环实例使用，不应在正式实例绕过账号系统。

Gate 通过只代表自动技术完整性：真实提交、终态、Take/Asset 对账与视频 Range 读取。它不会把“媒体能打开”写成“画质优秀”。人工完整观看输出后，才可对证据补充视觉结论。准备公开兼容性记录时，将确认过的 v2 报告放入 `docs/compatibility/evidence/`，然后运行：

```bash
pnpm compatibility:matrix
pnpm compatibility:matrix -- --check
```

生成器只接受绑定干净工作树 40 位 Commit 的报告，并校验源 Workflow、实际执行 Prompt 与输出
视频的 SHA-256、媒体尺寸/时长/帧率、重复 Evidence ID、相对路径和敏感字段。旧格式、失败报告，
以及含密码、Cookie、Token、提示词、项目/运行标识或绝对路径的文件都会被拒绝。当前公开记录
见[真实生成兼容性矩阵](./compatibility-matrix.md)。

## 2026-08-30 基线

本次升级已在隔离数据目录真实通过：

| 门槛 | 结果 |
| --- | --- |
| 40 Run 重启恢复 | 40/40 completed，40/40 Take 与视频 Asset 正确关联 |
| 500 节点画布 | Chrome 实际渲染 500 节点并保持点击响应，满足 8s / 100ms p95 阈值 |
| 真实 GPU | ComfyUI 0.31.0，RTX 4090，MiniMax H3 T2V native，101 秒完成并回收 `video/mp4` |
| Workflow 内容哈希 | `4935b6999ca3088e511e5796137f2b8088e8e1c4d7b842c82f76d4d2df1d4cd7` |

当前真实 GPU 结果已形成 v2 脱敏证据：绑定干净 Commit `c9aaf5b`、实际执行 Prompt 哈希和输出视频哈希，计入机器可读矩阵的 `verifiedRunCount`。自动完整性已通过，但没有完整人工审片，因此 `visualQuality` 保持 `not_reviewed`。同日较早的 100 秒结果仍只作为 pre-v2 历史记录。任何单次报告都不等于不同驱动、模型或 Custom Node 组合已认证；更换运行环境或 Workflow 内容哈希后应重跑。

## 便携包门槛

`.github/workflows/portable-bundles.yml` 在 Linux x64/arm64、macOS Intel/Apple Silicon、Windows x64/arm64 原生 Runner 上分别构建依赖和内置 Node.js 运行时。构建器会核对 Runner 实际平台/架构与矩阵目标，避免用模拟或错误架构产物冒充原生包。每个包都记录精确 Commit 与工作树状态；CI 拒绝从脏工作树发布。归档后会重新解压，执行 `doctor`、加载 `better-sqlite3` 与 `sharp`，再用包内运行时真正启动一次服务并读取健康接口和网页入口；Unix 包还检查启动权限。构建或自检任一步失败，本次产物都不会进入上传。全部通过后才保留 SHA-256 和 GitHub Artifact Attestation。

预览包只允许手动构建，不再由 Tag 自动发布。正式 Tag 发布使用独立的 `Signed production release`：必须等待 macOS 双架构完成 Developer ID 签名、notarization 和 stapling，以及 Windows x64 主程序与 NSIS 完成 Authenticode 签名并通过系统验证。Windows ARM64 和 Linux Tauri 当前仍只属于预览通道；详细配置与净机验收见[桌面正式签名与发行](desktop-production-signing.md)。

## Linux 原生安装包门槛

`Desktop check` 不再只检查 `cargo check`：现在还构建优化模式 `.deb`、实际安装，并用非 root 用户在 Xvfb / D-Bus 会话中运行原生窗口。

在 Ubuntu 的一次性测试机器或容器中，先安装 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)，另加 `xvfb xauth dbus-x11 openbox xdotool x11-utils imagemagick fonts-noto-cjk`，再执行：

```bash
pnpm desktop:prepare
pnpm desktop:check
pnpm --filter @takeboard/desktop exec tauri build --bundles deb --ci -- --locked
sudo apt-get install -y ./apps/desktop/src-tauri/target/release/bundle/deb/*.deb
TAKEBOARD_DESKTOP_SMOKE=1 xvfb-run -a -s '-screen 0 1600x1000x24' \
  dbus-run-session -- node scripts/verify-linux-desktop.mjs
```

最后一步必须使用一次性测试用户；脚本发现已有 `TakeBoardData` 时直接拒绝，绝不清空真实用户目录。它验证：

- 安装后的原生窗口使用包内 Node.js 和运行资源启动服务，首次入口确实启用账号系统。
- 通过窗口管理器正常关闭窗口后，自有服务停止，端口与数据目录租约释放。
- 已有同版本服务被复用，关闭桌面窗口不会转移所有权或停止原服务；原启动器仍能正常关闭它。
- 强制结束本次启动的桌面进程后，启动器通过控制管道关闭自有服务。
- 强制结束本次启动的启动器后，服务端通过 IPC 断开通知自行关闭，不成为无主进程。

窗口和完整桌面截图保存在 `test-results/linux-desktop/`；额外的亮色内容下限只用于拒绝完全空白的深色登录卡片，不是文字识别或视觉质量评分。CI 保存截图供人工复核，截图生成本身不代表自动视觉验收通过。生成的 Tauri `gen/` schema 和安装包属于构建产物，不进入源码提交。

2026-09-07 本地原生验收使用 Ubuntu 22.04 x64 隔离容器、D-Bus 1.12.20、GTK 3.24.33、WebKitGTK 2.50.4、内置 Node.js 22.23.1；未修改宿主机系统库。该门槛只证明 Linux `.deb` 的构建、安装和上述生命周期行为，不代表 AppImage、macOS/Windows 安装器、桌面签名、实际 GPU 生成或全部图形驱动组合已验证。
