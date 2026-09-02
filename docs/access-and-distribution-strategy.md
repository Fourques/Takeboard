# 账号门户与大众化分发策略

更新时间：2026-09-02

## 结论

TakeBoard 应同时保留三种入口，但三者解决的问题不同：

1. **本机应用入口**：给第一次使用、只想双击打开的人；
2. **SSH / 自有 HTTPS 入口**：给当前个人创作者和可信团队；
3. **TakeBoard 账号门户**：给需要从任意电脑找到并打开自己工作站的人。

账号门户不能只是把现有端口暴露到公网。正确模型是工作站上的连接器主动向中继建立出站连接，门户负责账号、设备目录和授权，项目权限仍由工作站内的 TakeBoard 服务端最终判断。

## 当前已经具备的基础

- 真实的服务端账号、密码哈希、会话、CSRF、登录限速和恢复码；
- Admin / Member 与项目 Owner / Editor / Viewer 两层授权；
- 稳定实例标识、回环监听、Host / Origin 白名单和安全 Cookie；
- SSH 自动探测、端口避让、健康检查和退出后清理；
- Linux x64/arm64、macOS Intel/Apple Silicon、Windows x64/arm64 便携包；
- 构建校验、原生依赖启动冒烟、SHA-256 与 GitHub Artifact Attestation；
- Web App Manifest，可从支持的浏览器添加为独立应用窗口。

本次新增的“账号 → 访问与安装”会读取真实服务端状态，明确区分：

- 本机或 SSH 是否可安全使用；
- 团队 HTTPS 入口是否完整配置；
- 哪一项安全条件缺失；
- 账号门户尚未上线，不用假状态误导用户。

## 账号门户的推荐架构

```text
浏览器 / 桌面壳
      │  Portal login + instance selection
      ▼
TakeBoard Control Plane
  ├─ 用户与组织
  ├─ 设备目录 / 在线状态
  ├─ 短期访问授权
  └─ Relay 路由（不保存项目目录）
      ▲
      │ outbound authenticated tunnel
TakeBoard Connector（GPU 主机）
      │ loopback only
      ▼
TakeBoard Server ── ComfyUI
  ├─ 本地账号映射
  ├─ 项目最终授权
  ├─ 审计记录
  └─ 素材 / Run / Take
```

### 身份边界

云账号和当前实例账号不是天然相同的账号。首次配对必须同时满足：

1. 用户已登录门户；
2. 用户在本地实例重新验证管理员身份；
3. 实例生成设备密钥，门户只保存公钥和设备元数据；
4. 本地保存 `portal subject → local user id` 的显式映射；
5. 每次远程请求同时验证门户短期授权与本地项目角色。

不能按邮箱自动合并身份，也不能信任反向代理随意注入的用户 Header。后续建议以 OIDC Authorization Code + PKCE 建立用户关系，以 WebAuthn / Passkey 作为高价值远程入口的首选认证，再保留本地密码和恢复码作为离线回退。

### 连接边界

- Connector 仅发起出站连接，不要求家庭路由器端口转发；
- 每个实例使用独立设备密钥，支持撤销、轮换和最后在线时间；
- Relay 必须支持 HTTP 流式上传、Range 视频播放和 WebSocket，不缓存媒体响应；
- ComfyUI 永远不直接接入门户，只能由 TakeBoard 服务端代为调用；
- 浏览器断线不能取消服务器 Run；用户重新登录后从持久化状态恢复；
- 删除项目、停用账号和撤销设备应立即阻止新请求，并明确处理已有生成任务；
- 所有远程登录、配对、撤销和高风险操作进入安全审计。

### 隐私选择

第一版托管 Relay 若终止 TLS，运营方在技术上能够看到传输内容，因此产品必须明确披露“传输、不持久化”的边界。不能宣称端到端加密，除非浏览器与 Connector 之间另有经过审计的内容加密层。对保密制作，继续推荐 SSH、Tailscale Serve 或自有 HTTPS 反向代理。

### 门户最小版本

仅实现下面这条闭环：

1. 注册 / 登录门户；
2. 在本地 TakeBoard 生成一次性配对码；
3. 门户展示实例在线、版本和名称，不索引项目标题；
4. 点击实例，打开经过短期授权的远程会话；
5. 本地权限继续限制可见项目；
6. 从门户撤销该设备后，Connector 在下一次心跳内断开；
7. 安全活动中能看到配对、远程登录和撤销。

首版不做远程文件索引、云端素材同步、云端数据库副本和自动开放 ComfyUI。这些能力会显著扩大数据责任和攻击面。

## 对 Tailscale、Cloudflare Tunnel 与 Pangolin 的取舍

| 方案 | 适合谁 | TakeBoard 的策略 |
| --- | --- | --- |
| SSH tunnel | 单人、已有服务器账号 | 继续作为默认，零额外云依赖 |
| Tailscale Serve | 已有 tailnet 的个人或团队 | 文档化为可选高级入口，不绑定为产品依赖 |
| Cloudflare Tunnel + Access | 已有域名和 Cloudflare 的团队 | 支持自托管配置，明确代理与 Cookie 检查 |
| Pangolin | 希望自托管身份代理与站点连接器的团队 | 作为可选部署参考，不内嵌第三方控制面 |
| TakeBoard Portal | 不懂网络、希望登录后看到自己的工作站 | 待单独建设控制面和 Connector |

Tailscale Serve 提供身份化的私网服务入口，Funnel 则面向更广互联网；Cloudflare Tunnel 与 Pangolin 都采用主机主动出站的连接器思路。这些方案证明了连接模型，但它们的账号不能直接替代 TakeBoard 项目权限。

参考：

- <https://tailscale.com/docs/reference/tailscale-cli/serve>
- <https://tailscale.com/docs/concepts/tailscale-identity>
- <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/>
- <https://docs.pangolin.net/>
- <https://www.w3.org/TR/webauthn-3/>

## 桌面应用与直接执行文件

### 现在

继续发布便携包，同时把 Web App Manifest 作为最低成本的独立窗口入口。便携包是真实可执行产品，只是还不是系统原生安装器：

- 不需要用户安装 Node.js 或 pnpm；
- 自动选端口、启动服务并打开浏览器；
- 仍需用户解压，并在 macOS 首次右键打开；
- 没有系统托盘、自动更新、签名与卸载程序。

### 下一步推荐：Tauri 2 桌面壳

不建议重写 React UI，也不建议立即把全部服务端迁到 Rust。Tauri 壳只负责：

- 安装 / 卸载；
- 托管内置 TakeBoard Server sidecar；
- 等待健康检查后打开 WebView；
- 菜单栏 / 系统托盘中的打开、诊断、安全停止；
- 数据目录选择和 ComfyUI 连接向导；
- 验证签名后的自动更新。

现有 React、Fastify、SQLite 和便携启动器仍是唯一业务实现。这样能避免桌面版和浏览器版形成两套产品逻辑。

Tauri 官方支持 macOS App/DMG、Windows MSI/NSIS 与 Linux AppImage/Deb/RPM 等分发格式；Updater 强制验证更新签名。正式面向大众发布前，还必须完成 Apple Developer ID 签名与 notarization、Windows Authenticode 签名，并在原生系统上执行安装、升级、回滚和卸载测试。

参考：

- <https://v2.tauri.app/distribute/>
- <https://v2.tauri.app/plugin/updater/>
- <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>
- <https://web.dev/learn/pwa/web-app-manifest>

### 为什么暂不选 Electron

Electron 与现有 TypeScript 团队技能匹配，也有成熟更新机制，但它需要额外携带 Chromium。TakeBoard 本身已经需要 Node sidecar 和较大的生成生态，第一目标应是减少安装摩擦与常驻资源，而不是获得另一套浏览器运行时。如果后续发现系统 WebView 兼容成本高于体积收益，可以在桌面 Gate 重新评估 Electron，不能把框架偏好当成既定结论。

## 实施 Gate

### Gate A：当前可完成

- [x] 访问方式与安全状态可视化；
- [x] SSH 命令可复制，端口来自真实运行配置；
- [x] HTTPS URL、Secure Cookie、Host / Origin 白名单联合检查；
- [x] 安装型 Web App 元数据；
- [x] 六平台便携构建和启动冒烟。

### Gate B：桌面安装器

- [ ] 建立最小 Tauri sidecar 原型；
- [ ] 系统托盘安全启停与单实例锁；
- [ ] 保留现有数据目录并验证升级回滚；
- [ ] macOS / Windows 签名凭据；
- [ ] DMG、MSI/NSIS、AppImage 原生安装测试；
- [ ] 签名更新源与失败恢复。

没有签名凭据时可以发布明确标注的开发预览，但不能把未签名安装器宣传为适合大众的稳定版。

### Gate C：账号门户

- [ ] 独立威胁模型与隐私说明；
- [ ] Portal OIDC + PKCE；
- [ ] 一次性设备配对和密钥轮换；
- [ ] 出站 Connector 与 Relay；
- [ ] HTTP / WebSocket / Range / 大文件背压测试；
- [ ] 本地项目权限二次裁决；
- [ ] 设备撤销、会话撤销与审计；
- [ ] Relay 数据保留和故障边界验证。

在 Gate C 完成前，界面必须始终把“账号门户”标记为未提供，不能出现无法兑现的“已连接云端”状态。
