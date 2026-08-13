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

systemctl --user daemon-reload
systemctl --user enable --now takeboard-comfy.service
systemctl --user enable takeboard.service
systemctl --user restart takeboard.service

systemctl --user --no-pager --full status takeboard.service
systemctl --user --no-pager --full status takeboard-comfy.service
