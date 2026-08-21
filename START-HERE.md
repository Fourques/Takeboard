# TakeBoard 开工入口

更新时间：2026-08-13
当前阶段：M0 真实工作站纵向切片
执行假设：1 名主开发者，借助 AI 编码；每周 5 个有效开发日。

实施状态见 [执行进度](docs/progress.md)。项目主页、新建项目、角色/场景资产库、ComfyUI Workflow 自动检测与导入、本地执行节点、I2V/首尾帧 Recipe、Run/Take 回收和画布布局持久化均已可用。

当前已有可运行的纵向 Demo，启动和操作步骤见 [完整 Demo 指南](docs/demo-guide.md)。
自托管部署和真实生成步骤见 [自托管指南](docs/self-hosting.md)。
多主题创作台、Workflow/模型兼容边界和资产使用方式见 [创作工作站指南](docs/creator-workstation.md)。

## 现在只做什么

用一个真实的本地 ComfyUI Workflow 跑通唯一黄金路径：

```text
新建项目
  → 把文字和参考图放到画布
  → 创建镜头
  → 选择来源节点和 Recipe
  → 批量生成 4 个 Take
  → 对比、淘汰、批准 1 个
  → 关闭项目并重新打开
  → 来源、候选和批准状态全部恢复
```

这两周不是做“小型 TapNow”，而是验证这条路径是否可靠、是否比“ComfyUI + 文件夹”更清楚。

## 已锁定的七个决定

1. 产品主界面是 TapNow 式内容画布，不是 ComfyUI 节点图，也不是专业剪辑时间线。
2. M0 只接一个本地 ComfyUI，不接 Agent、不接多云供应商、不做自动路由。
3. 画布布局与影视项目数据分离；更换画布库不能破坏 Shot、Run、Take 和 Approval。
4. 首选 React + TypeScript + React Flow；不采用当前生产使用需要许可证的 tldraw SDK。
5. 本地服务也使用 TypeScript，保持单语言 monorepo；SQLite 保存事务状态，开放 JSON 快照保证迁移和调试。
6. Run 和 Approval 追加记录，不覆盖历史；媒体文件不塞入数据库。
7. 两周 Gate 通过后，才验证 Local Draft → Paid Final、BYOK 和预算上限。

## 开工顺序

按 [实施路线与任务清单](docs/roadmap.md) 的 `TB-001` 到 `TB-012` 执行。前五天必须得到一个可保存、可恢复的假数据画布；后五天才接真实 ComfyUI。

不要先做：

- Agent 聊天框；
- 剧本自动拆镜；
- 完整时间线；
- 团队协作；
- 自动安装 Custom Node；
- 模型市场；
- Electron/Tauri 安装包；
- 同时支持十家 API。

## 两周 Gate

只有以下条件全部满足，才进入 M1：

- 10 镜、40 次 Run 中，Run/输出/Take 关联正确率至少 95%；
- 关闭重开后节点、连线、候选、批准和文件引用不丢失；
- 用户不用打开 ComfyUI 图，也能说清每个候选使用了哪些来源；
- 至少 3/5 名目标用户愿意拿真实小项目继续试用；
- 单个开发者没有把超过一半时间耗在 Custom Node 兼容上。

若技术通过、画布价值不通过，收缩为 Recipe Runner + Candidate Manager。若技术不通过，不继续做大画布。

## 文档地图

- [MVP 产品需求](docs/mvp-prd.md)
- [技术架构与数据边界](docs/architecture.md)
- [架构与产品决策记录](docs/decisions.md)
- [实施路线与任务清单](docs/roadmap.md)
- [实现审查与升级记录](docs/review-2026-08-13.md)
- [竞品与用户验证计划](docs/research-plan.md)
- [完整项目论证](docs/product-strategy.md)
