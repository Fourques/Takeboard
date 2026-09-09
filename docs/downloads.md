# 下载与安装

[返回首页](../README.md) · [English](downloads.en.md)

## 下载 TakeBoard

当前提供 **v0.2.0-beta.2 桌面预览版**。选择自己的电脑，只需下载一个安装包。
不再提供便携包，不需要解压管理运行目录，也不需要安装 Node.js、pnpm 或 Rust。

| 你的电脑 | 下载 |
| --- | --- |
| Mac · Apple 芯片 / Apple silicon | [DMG](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.2/TakeBoard-v0.2.0-beta.2-macos-arm64.dmg) |
| Mac · Intel | [DMG](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.2/TakeBoard-v0.2.0-beta.2-macos-x64.dmg) |
| Windows · Intel / AMD | [EXE](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.2/TakeBoard-v0.2.0-beta.2-windows-x64.exe) |
| Windows · ARM64 | [EXE](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.2/TakeBoard-v0.2.0-beta.2-windows-arm64.exe) |
| Debian / Ubuntu · Intel / AMD | [DEB](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.2/TakeBoard-v0.2.0-beta.2-linux-x64.deb) |
| Debian / Ubuntu · ARM64 | [DEB](https://github.com/Fourques/Takeboard/releases/download/v0.2.0-beta.2/TakeBoard-v0.2.0-beta.2-linux-arm64.deb) |

Mac 在“关于本机”查看芯片；Windows 在“设置 → 系统 → 系统信息”查看系统类型。
DEB 面向 Debian/Ubuntu，并非所有 Linux 发行版通用；其他环境可参考[源码运行](source-guide.md)。
所有附件也可在[发布页面](https://github.com/Fourques/Takeboard/releases/tag/v0.2.0-beta.2)查看。
底部 **Source code** 是开发者源码，不是安装包。

## 安装并打开

- **Mac**：打开 DMG，将 TakeBoard 拖到“应用程序”，再从应用程序打开。
- **Windows**：双击安装 EXE，按向导完成安装，再从开始菜单打开。
- **Debian / Ubuntu**：用系统软件安装器打开 DEB，安装后从应用菜单启动。
  若系统没有图形安装器，可在下载目录运行 `sudo apt install ./TakeBoard-v0.2.0-beta.2-linux-x64.deb`；
  ARM64 设备使用对应文件名。

应用会自动启动本机服务。本机默认无需注册，账号登录是附加功能；账号项目仍受权限保护。
生成需要另行配置 **ComfyUI、模型和自定义节点**，安装包不包含这些内容。
没有 ComfyUI 时仍可使用项目、素材与画布。

> [!IMPORTANT]
> 当前是预览版，尚无 Apple 公证 / Windows 商业代码签名，系统可能提示或阻止打开。
> 不要全局关闭 Gatekeeper、防病毒等系统保护；无法确认来源时先停止安装。
> 安装格式不等于系统信任认证。平台运行时检查也不代表所有 GPU 和工作流已经验证。

## 连接服务器

在桌面菜单选择“连接 → 连接设备…”，可连接 SSH、HTTPS 或自托管 Portal。
SSH 需要服务器可达、系统 OpenSSH、配置好的密钥和可信主机指纹，不要求使用 Tailscale。
账号门户需要自行部署和配对，不是默认可用的官方云。[查看远程连接指南](remote-access.md)

## 升级与遇到问题

- 项目默认保存在 `~/TakeBoardData`（Windows 为用户目录下的 `TakeBoardData`），不在应用安装目录内。
- 从旧版升级前先导出重要项目、停止旧服务并备份完整数据目录；不要让两份实例同时写同一目录。
- 旧便携包已停止分发。已有解压目录不是项目数据目录，切换前请核对自己的数据配置，不要误删项目。
- 回退请使用升级前的独立备份，不要让旧版打开已迁移的数据。
- 无需另外下载校验文件；构建校验与来源证明仍保留在[发行流程](desktop-production-signing.md)中。

打不开或无法生成时，请通过[问题反馈](https://github.com/Fourques/Takeboard/issues/new/choose)提供系统、
芯片、应用版本、连接方式和报错，不要上传密码、密钥或私人素材。
开发者入口：[贡献指南](../CONTRIBUTING.md) · [全部文档](README.md)。
