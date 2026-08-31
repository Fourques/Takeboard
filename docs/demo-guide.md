# TakeBoard 产品演示

更新时间：2026-08-30

## 一键录制

```bash
pnpm exec playwright install --with-deps chromium
pnpm demo:capture
```

命令会先建立生产构建，再启动一个使用临时数据目录和独立回环端口的实例，初始化临时管理员，并用 1440×900 Chromium 完成以下路径：

1. 打开“雾港来信”示例项目并重置到确定状态；
2. 检查一个来源素材节点，再回到镜头；
3. 生成四个 Demo 候选并选择其中一个；
4. 批准候选，确认镜头完成度和来源状态变化；
5. 在录制实例显式启用粗剪扩展，再打开分镜墙和只读粗剪；
6. 关闭浏览器、服务并删除临时项目数据。

产物位于被 Git 忽略的 `test-results/demo/`：

- `takeboard-product-walkthrough.webm`：可直接发布的无声产品路径；
- `takeboard-demo-cover.png`：采用候选后的画布封面；
- `takeboard-demo-manifest.json`：源码 commit、工作树状态、画面尺寸、动作序列、文件 SHA-256 与生成性质声明。

发布 Workflow 会在 Linux 的干净 Commit 上重新录制，为三个文件生成 GitHub 构建来源证明，并在版本 Tag 发布时作为 Release Asset 上传。CI 会拒绝来源不明确或工作树有修改的录制；录制失败不会留下后台服务或临时数据目录。

## 诚实边界

Demo Worker 不调用 GPU 或付费 API。候选卡是稳定的产品交互样片，用来展示项目、画布、生成状态、选片，以及显式启用后的粗剪闭环；界面与清单均将其标记为 `deterministic_demo` / `realGpu: false`。它不证明 MiniMax H3、其他模型或某个自定义 Workflow 的画质，也不代表新实例默认开启粗剪。

真实生成证据必须通过：

```bash
pnpm gate:gpu
```

并进入[真实生成兼容性矩阵](./compatibility-matrix.md)。自动技术完整性也不能冒充人工审片；只有完整观看对应输出后，证据才可标记为视觉通过。

## 手工演示建议

自动视频只有约 15 秒，适合 README、Issue 或 Release 预览。对外讲解建议录制 60–90 秒真人旁白版本：

- 先说清 TakeBoard 是 ComfyUI 之上的项目与选片层，不替代节点编辑器；
- 展示原始素材、镜头输入、真实/不确定进度和批准结果；
- 展示 Workflow Binding 与内容哈希的信任边界；
- 明确无 ComfyUI 时仍可管理项目，但不能提交真实生成；
- 结尾邀请用户携带自己的 Workflow 报告兼容性，而不是声称任意 JSON 都能运行。

## 验证

```bash
pnpm verify
pnpm test:e2e
pnpm demo:capture
```

浏览器测试会独立覆盖 Demo 的重置、候选生成、淘汰、批准、刷新恢复，以及管理员外部备份卡片的操作状态。
