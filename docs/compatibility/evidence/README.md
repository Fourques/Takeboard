# GPU 证据目录

这里保存能够公开审计的真实 GPU Gate 报告，不保存模型、素材、输出视频、账号或提示词。

生成候选证据：

```bash
TAKEBOARD_GATE_EMAIL='gate@example.com' \
TAKEBOARD_GATE_PASSWORD='仅用于本机本次登录的密码' \
pnpm gate:gpu
```

脚本将 v2 JSON 写入被 Git 忽略的 `test-results/release-gates/`。提交前应观看输出视频，再检查 JSON：必须是 `passed: true`，不得加入账号、Cookie、Token、提示词、项目/运行标识或绝对路径。将确认过的报告复制到本目录，然后执行：

```bash
pnpm compatibility:matrix
pnpm compatibility:matrix -- --check
```

矩阵生成器会再次验证干净工作树与 40 位 Commit、源 Workflow 和实际执行 Prompt
哈希、输出视频哈希与媒体元数据、重复 ID、相对路径及敏感字段。带未提交代码运行得到的
报告只能用于本地排查，不能进入公开矩阵。`visualQuality: not_reviewed` 只代表端到端技术链路
通过；不得改成 `passed`，除非有人完整观看了对应输出并承担审片结论。
