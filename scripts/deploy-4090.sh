#!/usr/bin/env bash
set -euo pipefail

repo_dir=/home/duanqw/Opc/TakeBoard
unit_dir=/home/duanqw/.config/systemd/user
bin_dir=/home/duanqw/.local/bin

cd "$repo_dir"
git fetch origin main
git merge --ff-only origin/main

mkdir -p "$bin_dir"
corepack enable --install-directory "$bin_dir"
export PATH="$bin_dir:$PATH"
pnpm install --frozen-lockfile
pnpm verify

mkdir -p "$unit_dir" /home/duanqw/TakeBoardData
cp deploy/systemd/takeboard.service "$unit_dir/takeboard.service"
cp deploy/systemd/takeboard-comfy.service "$unit_dir/takeboard-comfy.service"
bash scripts/install-comfy-bridge.sh
python3 scripts/install-qwen-image-workflows.py

systemctl --user daemon-reload
if curl --fail --silent --max-time 5 http://127.0.0.1:8188/system_stats >/dev/null; then
  echo "Reusing the healthy ComfyUI service already listening on 127.0.0.1:8188"
else
  systemctl --user enable --now takeboard-comfy.service
fi
systemctl --user enable takeboard.service
systemctl --user restart takeboard.service

systemctl --user --no-pager --full status takeboard.service
curl --fail --silent http://127.0.0.1:8188/system_stats >/dev/null
curl --fail --silent http://127.0.0.1:48120/api/health
