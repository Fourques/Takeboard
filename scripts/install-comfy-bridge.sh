#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=${TAKEBOARD_REPO_DIR:-$(CDPATH= cd -- "$script_dir/.." && pwd)}
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
source_file="$repo_dir/deploy/comfyui-takeboard-bridge/js/takeboard-workflow-bridge.js"

frontend_root=$(
  "$python_bin" -c 'from pathlib import Path; import comfyui_frontend_package; print(Path(comfyui_frontend_package.__file__).parent)'
)
extension_dir="$frontend_root/static/extensions/core"
destination="$extension_dir/takeboard-workflow-bridge.js"

test -f "$source_file"
test -d "$extension_dir"
install -m 0644 "$source_file" "$destination"
echo "Installed TakeBoard ComfyUI bridge: $destination"
