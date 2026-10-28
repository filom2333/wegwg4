#!/bin/bash
# Renders the game without a GPU (software Vulkan, Forward+) and saves a picture:
#   tools/shot.sh out.png [--at=x,z] [--yaw=deg] [--pitch=deg] [--fly=metres]
# RES=1600x900 for a bigger picture. Slow (a minute or two), but the same renderer the game uses on
# a real card.
cd "$(dirname "$0")/.."
export DOTNET_ROOT=/opt/dotnet VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json
out=$(realpath -m "$1"); shift
dotnet build -nologo -v q 2>&1 | grep -E " error " && exit 1
timeout 600 xvfb-run -a -s "-screen 0 1600x900x24" godot --path . --rendering-driver vulkan --audio-driver Dummy --resolution ${RES:-960x540} -- --shot="$out" "$@" 2>&1 | grep -E "^(ERROR|SCRIPT ERROR)" -A2
test -f "$out" && echo "saved $out"
