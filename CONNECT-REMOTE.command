#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
printf '请输入 SSH 主机名、IP 或 ~/.ssh/config 别名：'
read -r takeboard_remote_host
node scripts/takeboard-easy.mjs remote "$takeboard_remote_host"
printf '\n按回车键关闭窗口。'
read -r
