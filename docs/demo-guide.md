# TakeBoard 完整 Demo

更新时间：2026-08-13

## 启动

需要 Node.js 24 LTS 和 `package.json` 中声明的 pnpm 版本。

```bash
pnpm install
pnpm dev
```

打开 <http://127.0.0.1:48110>。Web 和 API 都只监听本机回环地址；Demo 数据保存在本地
`.takeboard-data/demo.takeboard/`，不会调用 GPU 或付费 API。

## 推荐演示路径

1. 从左侧选择 `S001`，观察剧本、角色、场景素材到镜头的引用连线；
2. 点击右侧“生成 4 个”，Fake ComfyUI 会创建 4 条独立 Run、Asset 和 Take；
3. 选择 Take 01，选择“角色漂移”并淘汰；
4. 选择 Take 02，点击“批准此 Take”；
5. 观察左侧完成度变为 `1/3`，镜头与 Take Stack 显示已批准；
6. 刷新页面，淘汰、批准、来源边和候选仍然存在；
7. 拖动画布节点并刷新，布局会从 SQLite 恢复；
8. 点击两次“重置 Demo”可回到初始状态。

## Demo 已真实实现的能力

- 内容级无限画布：Script、Character、Location、Shot、Take Stack；
- 来源引用与生成来源两类连线；
- 3 个镜头的项目导航和完成度；
- 4 次独立假生成及 seed、Recipe、Worker、Run 来源记录；
- 候选比较、结构化淘汰原因、批准与旧批准撤销历史；
- SQLite revision/event log、开放 JSON 快照、刷新和重启恢复；
- 本地模式、无积分、无外部模型费用。

## 有意未伪装成完成的能力

Demo 的候选画面是视觉占位，不是真实模型输出；`TB-008`—`TB-010` 才会接本地 ComfyUI 的
健康检查、Workflow Recipe、队列、WebSocket 和输出回收。当前 Demo 的目的，是先验证 TakeBoard
区别于 ComfyUI 的项目管理和选片闭环。

## 验证

```bash
pnpm verify
pnpm test:e2e
```

E2E 会自动启动本地服务，并在 Chromium 中执行“重置 → 生成 → 淘汰 → 批准 → 刷新恢复”。
