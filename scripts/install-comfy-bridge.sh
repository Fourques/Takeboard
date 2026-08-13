#!/usr/bin/env bash
set -euo pipefail

repo_dir=${TAKEBOARD_REPO_DIR:-/home/duanqw/Opc/TakeBoard}
comfy_dir=${COMFY_DIR:-/home/duanqw/Opc/Stortvideo/apps/ComfyUI-H3}
python_bin="$comfy_dir/env/bin/python"
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
