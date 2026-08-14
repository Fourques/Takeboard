# TakeBoard 自托管指南

更新时间：2026-08-14

## 推荐结构

TakeBoard Web/API 与 ComfyUI 可以运行在同一台 GPU 主机，也可以分开部署。生产环境建议让两个服务只监听回环地址或可信内网，并通过 SSH 隧道、反向代理或零信任网络访问；当前版本不应未经鉴权直接暴露到公网。

关键环境变量：

```bash
TAKEBOARD_PORT=48120
TAKEBOARD_DATA_ROOT=/srv/takeboard-data
TAKEBOARD_WEB_ROOT=/opt/takeboard/apps/web/dist
COMFY_URL=http://127.0.0.1:8188
COMFY_EDITOR_URL=http://127.0.0.1:48188
```

项目数据目录应放在容量充足、可备份的磁盘，并仅授予 TakeBoard 服务账户读写权限。

## 安全访问示例

如果服务运行在远程主机，可以在自己的电脑建立隧道：

```bash
ssh -N \
  -L 48120:127.0.0.1:48120 \
  -L 48188:127.0.0.1:8188 \
  your-gpu-host
```

随后打开：

- TakeBoard：<http://127.0.0.1:48120>
- ComfyUI 编辑器：<http://127.0.0.1:48188>

## 构建与启动

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
TAKEBOARD_WEB_ROOT="$PWD/apps/web/dist" pnpm --filter @takeboard/server start
```

建议使用 systemd、Docker Compose 或其他进程管理器保存环境变量并设置自动重启。部署更新前先确认推理队列状态，避免中断正在执行的任务。

## 第一次真实使用

1. 在主页新建项目，填写片名、画幅、第一场和镜头意图。
2. 在资产库上传非敏感测试图片；素材会进入项目目录并成为画布节点。
3. 从素材节点拖线到镜头的“首帧”“尾帧”或“参考”端口。
4. 在检查器选择执行节点已经安装的 Recipe，调整提示词、尺寸、时长、帧率和 seed。
5. 提交后观察阶段进度；完成结果会登记为 Asset 与候选 Take。
6. 关闭并重新打开项目，确认节点位置、来源连线、运行参数和候选均能恢复。

不同模型对显存、磁盘和 Custom Node 的要求差异很大。TakeBoard 不承诺某个硬件型号一定能运行所有 Recipe；应以模型作者和 Workflow 的要求为准。
