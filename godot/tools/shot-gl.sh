#!/bin/bash
# As shot.sh, but with Godot's OpenGL (Compatibility) renderer, the one weak or old graphics cards
# fall back to: for checking that the game still looks right there. (Its light and tone differ
# from Forward+: judge brightness and colour with shot.sh.)
cd "$(dirname "$0")/.."
export DOTNET_ROOT=/opt/dotnet
out=$(realpath -m "$1"); shift
dotnet build -nologo -v q 2>&1 | grep -E " error " && exit 1
timeout 600 xvfb-run -a -s "-screen 0 1600x900x24" godot --path . --rendering-method gl_compatibility --audio-driver Dummy --resolution ${RES:-960x540} -- --shot="$out" "$@" 2>&1 | grep -E "^(ERROR|SCRIPT ERROR)|shot saved" -A2
test -f "$out" && echo "saved $out"
