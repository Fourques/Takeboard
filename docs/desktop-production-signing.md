# 桌面正式签名与发行

更新时间：2026-09-09

TakeBoard 将预览与正式签名产物明确区分：

- `Native installer previews` 只能手动运行，为六个平台生成原生安装包、运行最终包内运行时检查和
  GitHub Artifact Attestation；不再构建或发布便携包。工作流本身不会自动发布 Release，维护者核对
  CI、各平台安装验证与校验和后，可手动发布明确标记未签名边界的预览版（Prerelease）；
- `Desktop check` 在相关提交后检查 Linux 原生窗口生命周期，同时构建 Mac ARM64 / Windows x64 预览包，
  验证打包运行时的启动、免登录创建项目、重启后会话与数据保留、退出清理。Windows 从实际 NSIS 安装后的
  目录运行；Mac 挂载最终 DMG 后从其中的 `.app` 运行。预览产物保存 14 天，不自动发布 Release，也不代表
  Mac/Windows 原生 UI、Gatekeeper 或 SmartScreen 已验收；
- `Signed production release` 只接受仓库中已经存在的版本 Tag，使用受保护的
  `production-release` Environment，并且只会发布通过系统签名验证的安装器。

GitHub 构建来源证明不能替代操作系统代码签名。不要把 Preview 的 DMG、NSIS 或 Deb 改名为正式版。

## 下载区保持简单

公开 Release 只上传原生安装包（DMG、NSIS EXE、DEB），不再提供便携包，
不上传单独的 `.sha256`、`SHA256SUMS.txt` 或演示素材。
校验文件仍随 CI Artifact 保存；正式发布前再次验证每个安装包的校验和，再按程序格式白名单上传。
缺少校验文件或摘要不一致会阻断发布；已存在的同名包不会被自动覆盖。
GitHub 自动展示的源码归档与文件摘要不属于我们上传的附件，无需用户下载或操作。

技术用户仍可通过 `gh attestation verify <下载文件路径> --repo Fourques/Takeboard` 检查支持来源证明的包。
校验和检查完整性，来源证明绑定构建来源，两者都不等于操作系统签名或完整安全审计。

macOS 打包保留 Hardened Runtime，并为内置 Node 声明 JIT 与原生扩展库加载权限（`entitlements.plist`）。
不启用调试注入、DYLD 环境注入或全局关闭内存页保护。Tauri 会重新签署 sidecar，不能假定复制进来的
Node 仍保留原签名权限；参考 [Tauri 签名实现](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/macos/sign.rs)
和 [Node 权限配置](https://github.com/nodejs/node/blob/main/tools/osx-entitlements.plist)。最终 DMG 内的运行时仍须通过真实启动测试。

## 一、配置 GitHub 发布环境

在仓库 `Settings → Environments` 创建 `production-release`：

1. 将部署分支限制为受保护的 `main`；该工作流必须从 `main` 手动发起，并会在签名之前验证输入的版本
   Tag 已存在、与 `package.json` 版本完全一致，再检出该 Tag 对应的不可变提交；
2. 建议开启 Required reviewers，防止普通提交使用签名身份；
3. 不允许来自 Fork 的工作流访问该环境；
4. 在完成下面两种签名配置前，不运行正式工作流。

签名材料只放进 GitHub Environment secrets 或供应商密钥服务，不要粘贴到 Issue、聊天、仓库文件或
Actions 日志。

## 二、Apple Developer ID 与 notarization

需要付费 Apple Developer Program 账号。免费账号不能完成面向公众的 notarization。

1. 确认应用标识继续使用 `app.takeboard.desktop`；如需更换，必须在第一次正式发布前完成；
2. 由 Apple 团队 Account Holder 创建 `Developer ID Application` 证书；
3. 在钥匙串中导出包含私钥的 `.p12`，设置独立强密码；
4. 把 `.p12` 转成单行 Base64：

   ```bash
   openssl base64 -A -in TakeBoard-Developer-ID.p12 -out TakeBoard-Developer-ID.base64.txt
   ```

5. 在 App Store Connect `Users and Access → Integrations` 创建权限最小化的 API Key，并立即保存只可下载
   一次的 `.p8`；
6. 在 `production-release` 环境配置：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Secret | `APPLE_CERTIFICATE` | `.p12` 的单行 Base64 |
| Secret | `APPLE_CERTIFICATE_PASSWORD` | `.p12` 导出密码 |
| Variable | `APPLE_SIGNING_IDENTITY` | 完整的 `Developer ID Application: … (TEAMID)` |
| Secret | `APPLE_API_ISSUER` | App Store Connect Issuer ID |
| Secret | `APPLE_API_KEY` | API Key ID |
| Secret | `APPLE_API_PRIVATE_KEY` | `.p8` 的完整文本 |

正式流水线会临时创建钥匙串，完成签名、上传 notarization、等待结果、装订 ticket，并用 `stapler` 和
`spctl` 验证 DMG；无论成功失败都会清理临时证书。

## 三、Windows Authenticode

默认方案是 Azure Artifact Signing（原 Trusted Signing）：私钥由微软托管，GitHub 通过 OIDC 获取短期
身份，不保存长期 Azure client secret。先确认你的个人或公司注册地区满足 Public Trust 身份验证要求；
如果不满足，选择支持硬件或云密钥的商业 OV/EV 代码签名供应商，之后为工作流增加对应的 Tauri
`signCommand`，不要购买普通 TLS 证书。

Artifact Signing 配置步骤：

1. 在 Azure 创建 Artifact Signing Account 和 Public Trust Certificate Profile，完成身份验证；
2. 创建 Entra App Registration 和 Service Principal；
3. 为它分配 `Artifact Signing Certificate Profile Signer`，权限范围只限该 Profile；
4. 创建 GitHub OIDC federated credential，subject 精确限制到
   `Fourques/Takeboard` 的 `production-release` Environment；
5. 在环境配置：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Variable | `AZURE_CLIENT_ID` | Entra Application client ID |
| Secret | `AZURE_TENANT_ID` | Azure tenant ID |
| Secret | `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| Variable | `AZURE_SIGNING_ENDPOINT` | 对应区域的 `https://….codesigning.azure.net/` |
| Variable | `AZURE_SIGNING_ACCOUNT` | Artifact Signing Account 名称 |
| Variable | `AZURE_CERTIFICATE_PROFILE` | Certificate Profile 名称 |

流水线先构建但不打包，签署并验证主程序和内置 Node runtime，再把这些已签文件装入 NSIS，最后签署并
再次验证安装器。
微软官方 GitHub Action 当前不支持 Windows ARM Runner，因此正式通道暂时只发布 Windows x64；ARM64
仍留在 Preview，不能标记成已签名。也可以后续进入 Microsoft Store，由 Store 完成受信任签名。

## 四、执行一次候选发布

1. 在干净 `main` 上完成 `pnpm gate:release` 和真实 GPU Gate；
2. 更新版本号和发布说明，创建并推送不可变版本 Tag；
3. 从 `main` 分支在 Actions 手动运行 `Signed production release`，先保持 `publish=false`；
4. 下载三个安装器，在无开发环境的 Intel Mac、Apple Silicon Mac、Windows x64 上分别验证安装、首次
   启动、升级、卸载和数据保留；
5. 检查 macOS `spctl` 与 Windows “数字签名”发布者名称；
6. 使用同一个 Tag 再运行工作流并设 `publish=true`。

目前 Linux Tauri 只在 Preview 提供，原因和退出条件见 [Security policy](../SECURITY.md)。Web 版不受
Linux GTK 链影响。

## 五、凭据轮换与事故处理

- Apple `.p12` 或 `.p8` 泄露：立即在 Apple 后台撤销，替换 GitHub Secret，重新发行；
- Azure OIDC 异常：删除 federated credential 或角色授权即可立即阻断签名；
- 发布者名称、Bundle ID、证书身份发生变化：先做升级兼容测试，不直接覆盖稳定 Release；
- 任何签名验证步骤失败：保留日志但不得上传产物，也不要用关闭验证作为修复。

官方依据：

- <https://developer.apple.com/support/developer-id/>
- <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>
- <https://v2.tauri.app/distribute/sign/macos/>
- <https://v2.tauri.app/distribute/sign/windows/>
- <https://github.com/Azure/artifact-signing-action>
- <https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-azure>
