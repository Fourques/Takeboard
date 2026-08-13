#!/usr/bin/env bash
set -euo pipefail

repo_dir=/home/duanqw/Opc/TakeBoard
unit_dir=/home/duanqw/.config/systemd/user

cd "$repo_dir"
git fetch origin main
git merge --ff-only origin/main

corepack pnpm install --frozen-lockfile
corepack pnpm verify

mkdir -p "$unit_dir" /home/duanqw/TakeBoardData
cp deploy/systemd/takeboard.service "$unit_dir/takeboard.service"
cp deploy/systemd/takeboard-comfy.service "$unit_dir/takeboard-comfy.service"

systemctl --user daemon-reload
systemctl --user enable --now takeboard-comfy.service
systemctl --user enable --now takeboard.service

systemctl --user --no-pager --full status takeboard.service
systemctl --user --no-pager --full status takeboard-comfy.service
