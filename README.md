# TakeBoard

<p align="right"><a href="README.en.md">English</a> · 简体中文</p>

<p align="center">
  <strong>从一张参考图，到一组镜头。</strong><br />
  面向 ComfyUI 创作者的开源、本地优先 AI 影像工作台。
</p>

<p align="center">
  <a href="docs/downloads.md"><strong>下载使用</strong></a> ·
  <a href="docs/creator-workstation.md">创作指南</a> ·
  <a href="docs/remote-access.md">连接远程设备</a> ·
  <a href="CONTRIBUTING.md">参与开发</a>
</p>

<p align="center">
  <a href="https://github.com/Fourques/Takeboard/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Fourques/Takeboard/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-315EFB.svg" /></a>
  <a href="https://github.com/Fourques/Takeboard/releases"><img alt="Public preview release" src="https://img.shields.io/github/v/release/Fourques/Takeboard?include_prereleases&label=public%20preview&color=D99A46" /></a>
</p>

![TakeBoard 项目主页](docs/assets/takeboard-home.webp)

把参考素材、生成镜头与工作流放在同一张画布上，连接输入，调整参数，比较结果，留下满意的版本。
TakeBoard 不替代 ComfyUI 的节点编辑器，而是让创作过程更连贯，让每个结果都有来源可查。

## 下载与开始

**使用 TakeBoard 不需要阅读源码，也不需要先学习开发工具。**

从[下载指南](docs/downloads.md)选择系统与版本。便携包和桌面预览均内置 Node.js，
无需另外安装 Node.js、pnpm 或 Rust；**ComfyUI、模型和自定义节点不包含在安装包内**。
未连接 ComfyUI 时，可以先整理项目、素材和画布，生成则需要可用的本机或远程 ComfyUI。

> [!IMPORTANT]
> 截至 2026-09-09，公开 Release 是 `v0.2.0-beta.1` 便携预览包；
> 最新桌面预览在 Actions 中，尚未发布为同等版本的正式安装包。
> 本页能力介绍面向当前 `main`，不代表旧 Release 已包含全部功能。
> 预览包尚无 Apple 公证 / Windows 商业代码签名，下载指南列出具体边界。

1. **打开工作台**：按下载指南解压或安装，使用启动入口打开页面。
2. **创建项目**：命名后进入空白画布，导入自己的图片、视频或其他素材。
3. **连接生成环境**：检查 ComfyUI 状态，选择可用工作流，连接素材并生成。

当前开发版在本机默认无需注册，登录是附加功能；设备项目和账号项目有独立权限边界。
旧版本的登录要求以其发布说明为准。项目默认保存在 `~/TakeBoardData`，升级前请先备份。

## 在一张画布里完成创作

- **素材与镜头**：完整显示原始图片和视频，用首帧、尾帧与参考输入连接镜头。
- **工作流与生成**：使用内置 Recipe，或为可信自定义工作流配置显式参数绑定；查看实际节点进度、停止任务与回收结果。
- **比较与保留**：管理候选版本、选片和分镜顺序，保存生成参数与来源。
- **项目与数据**：独立项目目录、可恢复删除、完整项目包导入导出，以及可选备份。
- **远程使用**：支持标准 SSH、HTTPS 与可选自托管 Portal；不要求使用 Tailscale。
- **按需扩展**：粗剪预览、成本洞察、批量审片和成片质检默认关闭，按需要启用。

自定义工作流不是“导入即运行”：需要检查依赖、绑定输入参数并明确信任。
实际生成能力取决于连接的 ComfyUI、模型、节点和硬件，详见[创作指南](docs/creator-workstation.md)与[兼容记录](docs/compatibility-matrix.md)。

## 选择你的使用方式

| 你想做什么 | 从这里开始 |
| --- | --- |
| 在自己的电脑使用 | [下载与安装](docs/downloads.md) |
| 在 Mac / Windows 上连接 GPU 服务器 | [远程访问](docs/remote-access.md) |
| 管理登录、共享与项目权限 | [账号与权限](docs/access-control.md) |
| 部署长期运行的服务 | [自托管部署](docs/self-hosting.md) |
| 通过账号门户访问已配对设备 | [Portal 自托管](docs/portal-self-hosting.md) |
| 配置工作流或开发扩展 | [创作工作站](docs/creator-workstation.md) · [扩展协议](docs/extensions.md) |
| 从源码运行或参与开发 | [源码运行与配置](docs/source-guide.md) · [贡献指南](CONTRIBUTING.md) |

默认服务只监听本机回环地址。公网入口必须配置强制登录、HTTPS 与访问限制，
不要直接公开 ComfyUI 端口。Portal 是可自托管的服务，不是已经运营的官方云；
项目与素材保存在你选择的本机或远程基础设施上，远程生成会按授权传输输入。

## 文档与反馈

[全部文档](docs/README.md) · [版本记录](CHANGELOG.md) · [路线图](docs/roadmap.md) · [安全策略](SECURITY.md)

遇到问题，先查看“任务中心 → 运行诊断”，再通过
[问题反馈](https://github.com/Fourques/Takeboard/issues/new/choose)提交复现步骤。
不要上传私人素材、密码或 API Key；安全漏洞请按安全策略私下报告。

## 开源与许可

TakeBoard 保留公开源码，下载使用与源码开发是两个独立入口。
核心创作功能不以注册官方云账号为前提；当前没有必须订阅的官方托管服务。

代码采用 [Apache License 2.0](LICENSE)。模型、自定义节点和第三方依赖遵循各自许可，
不因 TakeBoard 开源而自动获得额外授权。
