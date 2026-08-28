#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=${TAKEBOARD_REPO_DIR:-$(CDPATH= cd -- "$script_dir/.." && pwd)}
unit_dir=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
bin_dir=${XDG_BIN_HOME:-$HOME/.local/bin}
data_root=${TAKEBOARD_DATA_ROOT:-$HOME/TakeBoardData}
comfy_dir=${COMFY_DIR:-$HOME/ComfyUI}
python_bin=${COMFY_PYTHON:-$comfy_dir/venv/bin/python}

if [[ ! -x $python_bin ]]; then
  for candidate in "$comfy_dir/env/bin/python" "$comfy_dir/.venv/bin/python"; do
    if [[ -x $candidate ]]; then
      python_bin=$candidate
      break
    fi
  done
fi
if [[ ! -x $python_bin ]]; then
  echo "ComfyUI Python not found. Set COMFY_DIR or COMFY_PYTHON." >&2
  exit 1
fi

cd "$repo_dir"
git fetch origin main
git merge --ff-only origin/main

mkdir -p "$bin_dir"
corepack enable --install-directory "$bin_dir"
export PATH="$bin_dir:$PATH"
pnpm install --frozen-lockfile
pnpm verify

mkdir -p "$unit_dir" "$data_root"
sed \
  -e "s|%h/ComfyUI/venv/bin/python|$python_bin|g" \
  -e "s|%h/ComfyUI|$comfy_dir|g" \
  deploy/systemd/takeboard-comfy.service > "$unit_dir/takeboard-comfy.service"
chmod 600 "$unit_dir/takeboard-comfy.service"
export TAKEBOARD_REPO_DIR=$repo_dir COMFY_DIR=$comfy_dir
bash scripts/install-comfy-bridge.sh
python3 scripts/install-qwen-image-workflows.py

systemctl --user daemon-reload
if curl --fail --silent --max-time 5 http://127.0.0.1:8188/system_stats >/dev/null; then
  echo "Reusing the healthy ComfyUI service already listening on 127.0.0.1:8188"
else
  systemctl --user enable --now takeboard-comfy.service
fi
curl --fail --silent http://127.0.0.1:8188/system_stats >/dev/null

export COMFY_URL=http://127.0.0.1:8188
export COMFY_EDITOR_URL=http://127.0.0.1:48188
export COMFY_INPUT_ROOT=$comfy_dir/input
export COMFY_OUTPUT_ROOT=$comfy_dir/output
export TAKEBOARD_DATA_ROOT=$data_root
bash scripts/install-service.sh --skip-build
