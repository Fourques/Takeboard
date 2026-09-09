#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
printf '请输入 SSH 主机名、IP 或 SSH 别名（直接回车连接上次服务器）：'
read -r takeboard_remote_host
node scripts/takeboard-easy.mjs remote "$takeboard_remote_host"
printf '\n按回车键关闭窗口。'
read -r
