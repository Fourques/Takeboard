# TakeBoard 扩展开发与信任模型

状态：`declarative-v1` 已实现  
更新时间：2026-08-31

## 产品判断

TakeBoard 需要扩展库，但不应该一开始就做“安装后可在服务器运行任意代码”的传统插件市场。

原因不是保守，而是项目同时掌握原始媒体、项目数据库、ComfyUI 和远程算力。一个普通插件如果默认拥有 Node.js、Python 或 Shell 权限，等价于拥有用户工作站权限；版本更新也会成为新的供应链入口。当前最有价值、风险最低的扩展需求是：

- 团队自定义交付检查；
- 把常用资产、审片、规范或 Workflow 工具放进统一入口；
- 让实验性能力可以安装、停用和移除，而不污染核心导航；
- 为未来社区开发建立稳定 ID、版本、权限、内容指纹和兼容协议。

因此第一版叫“扩展库”，运行时为 `declarative-v1`：TakeBoard 解释结构化数据，不执行扩展作者代码。

## 用户流程

1. 在项目顶部打开“扩展”；
2. 查看内置和本地扩展、启用状态、贡献点与所需权限；
3. 导入 JSON 时先做大小、格式、权限、URL 和重复 ID 校验；
4. 页面展示清单内容 SHA-256、权限和风险说明；
5. 管理员确认安装，本地扩展仍默认停用；
6. 管理员显式启用后，工作区功能、质检规则或工具入口才出现；
7. 停用立即停止贡献，移除需要二次确认。

扩展是实例级配置，不写入 `.takeboard` 项目包。这样导入外部项目不会顺带安装能力，项目也不会把团队内部链接带到另一台机器。

## Manifest v1

```json
{
  "format": "takeboard.extension",
  "manifestVersion": 1,
  "id": "studio.example.creator-tools",
  "name": "创作者工具箱",
  "version": "1.0.0",
  "description": "团队质检与常用工具入口。",
  "author": "Example Studio",
  "homepage": "https://example.com/takeboard-extension",
  "permissions": ["project.read", "network.open"],
  "contributions": {
    "features": ["storyboard.rough_cut"],
    "links": [
      {
        "id": "style-guide",
        "title": "视觉规范",
        "description": "在新窗口打开团队视觉规范。",
        "url": "https://example.com/style-guide",
        "category": "utility"
      }
    ],
    "qcRules": [
      {
        "id": "shots-have-candidates",
        "title": "镜头需要候选",
        "description": "交付前检查仍未生成候选的镜头。",
        "check": "shots_without_candidates",
        "severity": "warning"
      }
    ]
  }
}
```

约束：

- `id` 使用小写反向域名形式，安装和升级都以它为稳定身份；
- `version` 使用 SemVer；
- `homepage` 和链接只允许 HTTP(S)，不允许 `javascript:`、文件路径或嵌入凭据；
- 同一清单内 contribution ID 不能重复；
- 清单上限 256 KB；
- 声明链接必须申请 `network.open`，声明质检和工作区功能必须申请 `project.read`，批量审批还必须申请 `project.write`；
- 安装确认令牌绑定规范化清单内容，预览后内容变化必须重新确认。

## 当前贡献点

### `contributions.features`

功能贡献只能从 TakeBoard 已实现、已测试的有限列表中选择，不会加载扩展代码：

| feature | 含义 | 权限 |
| --- | --- | --- |
| `storyboard.rough_cut` | 在分镜墙增加只读粗剪和节奏时间线 | `project.read` |
| `production.cost_insights` | 增加项目、镜头与成片分钟成本工作台 | `project.read` |
| `production.batch_approval` | 增加跨镜头预览与原子批准 | `project.read` + `project.write` |

TakeBoard 自带的“粗剪预览”“成本洞察”“批量审片”和“成片完整性质检”也使用同一注册表，而不是硬编码为永远出现的页面。四项均默认关闭，管理员按实例用途启用；成本和批量审批在关闭时不仅隐藏 UI，对应服务接口也会返回 `EXTENSION_DISABLED`。Run 来源、单镜头采用和其他核心项目数据不受启停影响。

### `contributions.qcRules`

质检只读取服务端已经结构化的项目状态，不读取媒体像素或提示词。可用检查：

| check | 含义 |
| --- | --- |
| `unapproved_shots` | 已有候选但尚未采用的镜头 |
| `shots_without_candidates` | 尚无候选结果的镜头 |
| `failed_runs` | 失败或失联的运行 |
| `missing_asset_metadata` | 尚未完成尺寸、帧率或时长检测的视频 |
| `unknown_costs` | 没有可靠估算或实际账单的运行 |

规则只能从预定义检查中选择，不能携带表达式或脚本。这保证相同规则在不同系统上得到一致结果，也避免把“配置”变成隐蔽代码执行器。

### `contributions.links`

链接可归类为 `workflow`、`asset`、`review` 或 `utility`。TakeBoard 只把它渲染为带 `noopener` / `noreferrer` 的新窗口链接，不嵌入第三方页面，也不会替用户发起 API 请求。外部站点仍有自己的隐私和账号边界，管理员启用前应检查域名。

## 权限与角色

- Viewer 和 Editor 可以查看其项目内已启用的只读功能、质检结果与入口；写操作仍受项目角色和 `project.write` 双重约束；
- 只有实例管理员可以安装、启用、停用或移除扩展；
- 内置扩展由 TakeBoard 发布，可以停用，但不能被本地清单覆盖或移除；
- 所有内置可选扩展默认停用，避免专业制片功能挤占个人创作者的核心流程；
- 本地扩展安装后默认停用；
- 扩展注册表权限为 `0600`，不存放 Token，也不接受带凭据的 URL。

`project.read` 不是任意项目文件读取权。当前运行时只把预定义检查的计数和受影响对象 ID 交给结果模型，扩展本身没有代码可以接触数据库。

## 为什么现在不开放任意代码

一个可信的代码插件系统至少还需要同时完成：

1. 可验证的发布者身份与签名制品；
2. 固定版本、内容哈希、兼容范围和撤销列表；
3. 浏览器与服务端扩展分离，默认没有文件、网络、进程或密钥权限；
4. 隔离进程、CPU / 内存 / 时间限制和崩溃熔断；
5. 每次权限扩大重新确认；
6. 安装、更新、调用和外部访问审计；
7. 禁止静默自动更新，并支持回滚；
8. 恶意扩展报告、下架和安全响应流程。

在这些 Gate 之前，用 iframe、`eval`、动态 `import()`、npm 包或 Python 入口“快速实现插件”都不接受。

## 后续演进

建议按三层推进，而不是一步做成无限权限市场：

| 层 | 能力 | 信任边界 | 状态 |
| --- | --- | --- | --- |
| L1 声明式扩展 | 受控工作区功能、质检、链接，后续可加表单模板和导出预设 | 无第三方代码 | 已完成 |
| L2 Web 沙箱扩展 | 隔离 UI、消息协议、按次授权的项目投影 | 无服务端 / 文件系统直接访问 | 需独立设计与安全 Gate |
| L3 执行 Adapter | Provider、导出器、资产处理和自动化 | 签名包、隔离进程、最小权限与审计 | 只面向可信管理员，尚未实现 |

近期最适合继续增加到 L1 的贡献点是：Workflow / Recipe 目录元数据、命名模板、交付清单、导出预设和只读数据面板。这些能力足以让社区扩展产品，又不会让用户为一个小功能交出整台机器。

如果未来建设在线目录，目录只分发签名清单和制品元数据；实际安装仍由自托管实例验证哈希、展示权限并要求管理员确认。热度、推荐或作者声誉不能替代权限检查。
