# 下载与安装

[返回首页](../README.md) · [English](downloads.en.md)

## 下载 TakeBoard

当前全平台版本为 **v0.2.0-beta.18 预览版**。选择自己的电脑，只需下载一个安装包。
安装包包含应用运行时，不需要安装 Node.js、pnpm 或 Rust。ComfyUI、模型和第三方节点需另行准备。

| 你的电脑 | 下载 |
| --- | --- |
| Mac · Apple 芯片 / Apple silicon | [DMG](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.18/TakeBoard_0.2.0-beta.18_aarch64.dmg) |
| Mac · Intel | [DMG](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.18/TakeBoard_0.2.0-beta.18_x64.dmg) |
| Windows · Intel / AMD | [EXE](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.18/TakeBoard_0.2.0-beta.18_x64-setup.exe) |
| Windows · ARM64 | [EXE](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.18/TakeBoard_0.2.0-beta.18_arm64-setup.exe) |
| Debian / Ubuntu · Intel / AMD | [DEB](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.18/TakeBoard_0.2.0-beta.18_amd64.deb) |
| Debian / Ubuntu · ARM64 | [DEB](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.18/TakeBoard_0.2.0-beta.18_arm64.deb) |

Mac 在“关于本机”查看芯片；Windows 在“设置 → 系统 → 系统信息”查看系统类型。
DEB 面向 Debian/Ubuntu，并非所有 Linux 发行版通用；其他环境可参考[源码运行](source-guide.md)。
也可查看[完整发布页](https://github.com/Fourques/Takeboard/releases/tag/v0.2.0-beta.18)。
底部 **Source code** 是开发者源码，不是安装包。

## 安装与首次打开

- **Mac**：打开 DMG，将 TakeBoard 拖到“应用程序”，再从应用程序打开。
- **Windows**：双击安装 EXE，按向导完成安装，再从开始菜单打开。
- **Debian / Ubuntu**：用系统软件安装器打开 DEB，安装后从应用菜单启动。
  若系统没有图形安装器，可在下载目录运行 `sudo apt install ./TakeBoard_0.2.0-beta.18_amd64.deb`；
  ARM64 设备使用对应文件名。

应用会自动启动本机服务。本机默认无需注册，账号登录是附加功能；账号项目仍受权限保护。
生成需要另行配置 **ComfyUI、模型和自定义节点**，安装包不包含这些内容。
没有 ComfyUI 时仍可使用项目、素材与画布。

当前 Mac 包未完成 Apple 公证，Windows 包未进行商业代码签名，首次打开可能出现系统提示。Mac 用户确认文件来自本仓库 Release 后，可按 [Apple 的单应用打开说明](https://support.apple.com/102445)，在“系统设置 → 隐私与安全性”查找该应用的“仍要打开”。如果提示文件损坏或检测到恶意软件，不要把它当作普通签名提示；记录完整提示并反馈。无需全局关闭系统保护。

**应用能运行，不等于本机能运行所有模型。** 模型所需 GPU 与显存取决于工作流；也可以从这台电脑连接远程 GPU。

## 安装后做什么

已有 ComfyUI：[跟随首次使用指南完成一次生成](first-session.md#已有能正常运行的-comfyui)。还没有生成环境：先新建项目、导入图片，试用画布与资产库。

## 连接服务器

只需要远程生成、项目保存在本机时，在“设置 → 设备连接”添加远程 ComfyUI。TakeBoard 管理连接并将生成结果取回当前项目。配置细节见[生成设备与项目位置](generation-and-storage.md)。

需要打开和管理服务器上的项目时，再使用远程 TakeBoard：

在“设置 → 远程项目”中连接 SSH、HTTPS 或自托管 Portal；桌面菜单“连接 → 远程项目设置…”也会进入同一设置。
SSH 需要服务器可达、系统 OpenSSH、配置好的密钥和可信主机指纹，不要求使用 Tailscale。
账号门户需要自行部署和配对，不是默认可用的官方云。[查看远程连接指南](remote-access.md)

## 升级与遇到问题

- 在“更新 → 检查更新”查看后续版本；不自动安装。没有此菜单的旧版请手动下载，远端应用需单独升级。
- 项目默认保存在 `~/TakeBoardData`（Windows 为用户目录下的 `TakeBoardData`），不在应用安装目录内。
- 从旧版升级前先导出重要项目、停止旧服务并备份完整数据目录；不要让两份实例同时写同一目录。
- 回退请使用升级前的独立备份，不要让旧版打开已迁移的数据。

打不开或无法生成时，请通过[问题反馈](https://github.com/Fourques/Takeboard/issues/new/choose)提供系统、
芯片、应用版本、连接方式和报错，不要上传密码、密钥或私人素材。
开发者入口：[贡献指南](../CONTRIBUTING.md) · [全部文档](README.md)。
