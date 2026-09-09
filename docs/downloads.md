# 下载与安装

[返回首页](../README.md) · [English](downloads.en.md)

## 先选版本，再选系统

发布状态核对日期：2026-09-09。下面区分可长期下载的公开版本与短期测试构建，不把开发分支功能当作旧包已具备的功能。

| 通道 | 实际提供什么 | 适合谁 |
| --- | --- | --- |
| [公开 Release：v0.2.0-beta.1](https://github.com/Fourques/Takeboard/releases/tag/v0.2.0-beta.1) | 六种系统 / CPU 的便携预览包，内置运行时；不是原生安装器 | 想尝试已发布版本的用户 |
| [Desktop check](https://github.com/Fourques/Takeboard/actions/workflows/desktop-check.yml) | 较新提交的 Mac ARM64 DMG、Windows x64 NSIS 测试安装包；产物保留 14 天 | 愿意测试新功能并反馈问题的用户 |
| [源码 main](source-guide.md) | 当前开发代码，需要开发环境 | 需要最新修复或参与开发的用户 |

公开便携包早于近期可选登录、桌面连接菜单等更新；其中的登录和远程体验可能与当前 README 不同。
最新功能与尚未发布的变化见 [Unreleased](../CHANGELOG.md#unreleased)。没有适合你的近期安装包时，
可以等待下一次发布或从源码运行，不必为了试用项目去学习编译桌面安装器。

## 下载便携版

在公开 Release 的 **Assets** 中选择以下文件。不要选择 GitHub 自动生成的 **Source code (zip / tar.gz)**：
那是给开发者的源码，不包含可直接使用的运行时。

| 设备 | 文件名 |
| --- | --- |
| Mac，Apple 芯片（M 系列） | `takeboard-v0.2.0-beta.1-macos-arm64.tar.gz` |
| Mac，Intel 处理器 | `takeboard-v0.2.0-beta.1-macos-x64.tar.gz` |
| Windows，Intel / AMD 64 位 | `takeboard-v0.2.0-beta.1-windows-x64.tar.gz` |
| Windows，ARM64 处理器 | `takeboard-v0.2.0-beta.1-windows-arm64.tar.gz` |
| Linux，Intel / AMD 64 位 | `takeboard-v0.2.0-beta.1-linux-x64.tar.gz` |
| Linux，ARM64 | `takeboard-v0.2.0-beta.1-linux-arm64.tar.gz` |

Mac 在“关于本机”查看芯片；Windows 在“设置 → 系统 → 系统信息”查看系统类型。
构建覆盖这些平台不等于所有 GPU 与工作流已经验证，实际记录见[兼容矩阵](compatibility-matrix.md)。

下载后完整解压，保留包内文件结构，再打开：

| 系统 | 启动入口 |
| --- | --- |
| macOS | `START-TAKEBOARD.command` |
| Windows | `START-TAKEBOARD.cmd` |
| Linux | `./start-takeboard.sh` |

便携版会启动本机服务并打开浏览器。保留启动窗口，结束使用时按窗口提示停止服务。
无需单独安装 Node.js、pnpm 或 Rust；不包含 ComfyUI、模型和自定义节点。

## 测试最新桌面版

1. 打开上面的 Desktop check，选择 **main 分支、全部检查成功**的运行记录，核对提交与日期。
2. 登录 GitHub，在该记录底部 **Artifacts** 下载 `takeboard-preview-macos-arm64` 或 `takeboard-preview-windows-x64`。
3. 解压下载的 Artifact，再打开里面的 DMG 或 NSIS `.exe` 安装器。校验文件不是安装器。
4. 没有对应产物或已过期时，不要使用失败运行的包；选择公开预览或等待新的成功构建。

Linux 的窗口验收截图不是 Linux 安装包。维护者另有手动运行的
[Preview bundles](https://github.com/Fourques/Takeboard/actions/workflows/portable-bundles.yml)六平台构建入口，
但配置了构建任务不等于每个平台随时都有可下载产物。

桌面版会自动启动本机服务；较新版本提供“连接 → 连接设备…”菜单。
SSH 仍需要服务器可达、系统 OpenSSH、配置好的密钥和可信主机指纹；同邮箱登录不等于自动连接任意设备。
详见[远程访问](remote-access.md)。

## 安全、数据与升级

- 这些是预览，不是已经通过 Apple notarization 或 Windows 商业代码签名的正式安装包。操作系统可能警告或阻止打开。
  不要全局关闭 Gatekeeper、防病毒或其他系统保护；无法确认来源时先停止安装。
- Release 下载区只保留程序包，无需另外下载校验文件；构建流程仍保留完整性校验与来源证明。
  需要技术验证的用户可查看[发行指南](desktop-production-signing.md)，日常使用无需执行校验命令。
- 项目默认在 `~/TakeBoardData`（Windows 为用户目录下的 `TakeBoardData`），不在安装目录。
  升级前导出重要项目，并在服务停止后备份完整数据目录；不要让两份实例同时写同一目录。
- 不要直接用旧版本打开已被新版本迁移的数据。回退应使用升级前的独立备份，见[数据说明](data-layout.md)。
- 当前开发版在本机默认免注册；账号项目仍要求相应身份。公网部署需要强制登录与 HTTPS，
  不能直接把本机免登录服务暴露到公网。

打不开或无法生成时，请在[问题反馈](https://github.com/Fourques/Takeboard/issues/new/choose)中提供系统、CPU、
版本或提交、文件名、连接方式及报错。不要公开密码、密钥或私人素材。

## 后续发布约定

普通用户的长期下载入口是 GitHub Releases；Actions 仅供测试，不替代版本发行。
后续发布应明确标记预览 / 正式、源代码提交、平台、签名状态、升级说明和已知限制。
校验文件与测试演示保留在构建产物中，不作为面向用户的 Release 附件；GitHub 自动提供的源码入口保留。
不覆盖旧 Tag 或用同名安装包悄悄替换新代码；正式签名与验收流程见[发行指南](desktop-production-signing.md)。
