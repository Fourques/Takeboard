#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
node scripts/takeboard-easy.mjs start
printf '\n可以关闭这个窗口。按回车键退出。'
read -r
