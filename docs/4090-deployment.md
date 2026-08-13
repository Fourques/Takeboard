# TakeBoard 4090 部署与使用

更新时间：2026-08-13

## 当前实例

- 内网主机：`duanqw-kami-tail`
- TakeBoard：`127.0.0.1:48120`
- ComfyUI：`127.0.0.1:8188`
- 代码：`/home/duanqw/Opc/TakeBoard`
- 项目数据：`/home/duanqw/TakeBoardData`
- ComfyUI：`/home/duanqw/Opc/Stortvideo/apps/ComfyUI-H3`
- Git 裸仓库：`/home/duanqw/Opc/repos/takeboard.git`

两个 HTTP 服务仅监听 4090 的回环地址，避免把未鉴权的项目和推理接口直接暴露到局域网或公网。

## 安全访问

在自己的电脑运行：

```bash
ssh -N \
  -L 48120:127.0.0.1:48120 \
  -L 48188:127.0.0.1:8188 \
  duanqw-kami-tail
```

随后打开：

- TakeBoard：<http://127.0.0.1:48120>
- ComfyUI（需要调试 Recipe 时）：<http://127.0.0.1:48188>

## 第一次真实使用

1. 在项目主页选择“新建项目”。
2. 填写项目名称、画幅、第一场和第一个镜头意图。
3. 在镜头列表下方选择“添加首帧素材”，上传 PNG、JPEG 或 WebP。
4. 选择镜头，在右侧点击“生成”。
5. TakeBoard 将图片上传到 ComfyUI，提交 Wan 2.2 I2V Turbo Recipe，并每 3 秒同步运行状态。
6. 生成完成后，视频会复制到项目的 `renders/`，登记为 Asset 和候选 Take，并出现在候选区。

当前 Recipe 固定使用服务器已有的 Wan 2.2 I2V high/low noise FP8 模型、UMT5、Wan VAE 和 LightX2V 四步 LoRA。默认输出为 5 秒、16 fps，并按项目画幅选择接近 480p 的尺寸。

## 部署更新

本机仓库已配置 `deploy-4090` remote。提交后执行：

```bash
git push deploy-4090 main
ssh duanqw-kami-tail \
  'cd /home/duanqw/Opc/TakeBoard && git pull --ff-only && bash scripts/deploy-4090.sh'
```

部署脚本会在远端完成冷安装、代码质量校验、构建、单元测试、systemd user unit 更新和服务重启。

## 运维检查

```bash
ssh duanqw-kami-tail 'systemctl --user status takeboard takeboard-comfy'
ssh duanqw-kami-tail 'journalctl --user -u takeboard -n 100 --no-pager'
ssh duanqw-kami-tail 'journalctl --user -u takeboard-comfy -n 100 --no-pager'
ssh duanqw-kami-tail 'nvidia-smi'
```

## 已验证基线

2026-08-13 使用已有电影关键帧完成一次真实 Wan 2.2 I2V 生成：

- Comfy prompt：32 个展开节点；产品 Recipe 精简为等价的 17 节点执行图
- 画幅：480 × 848
- 时长：5 秒，16 fps
- 采样：high/low noise 两阶段，LightX2V 4 steps
- 执行耗时：49.79 秒
- 输出：MP4，2,218,104 bytes
- 显存峰值观测：约 15.4GB

该结果证明现有 24GB RTX 4090、模型、VAE、文本编码器、LoRA、ComfyUI API 和视频保存链路均可工作。
