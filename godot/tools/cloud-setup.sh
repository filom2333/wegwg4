#!/bin/bash
# Setup script for the Claude Code cloud environment: Godot 4.7.2 (.NET), the .NET 9 SDK and a
# software Vulkan driver, so a session can build the project and render pictures without a GPU.
# Paste into the environment's settings (Setup script). Safe to run twice.
set -e
GODOT=4.7.2
if [ ! -x /opt/godot/godot ]; then
  mkdir -p /opt/godot /tmp/gd-dl
  curl -sSL -o /tmp/gd-dl/godot.zip "https://downloads.godotengine.org/?version=$GODOT&flavor=stable&slug=mono_linux_x86_64.zip"
  curl -sSL -o /tmp/gd-dl/SHA512-SUMS.txt "https://github.com/godotengine/godot/releases/download/$GODOT-stable/SHA512-SUMS.txt"
  want=$(grep "mono_linux_x86_64.zip" /tmp/gd-dl/SHA512-SUMS.txt | cut -d' ' -f1)
  echo "$want  /tmp/gd-dl/godot.zip" | sha512sum -c -
  python3 -I -c "import zipfile; zipfile.ZipFile('/tmp/gd-dl/godot.zip').extractall('/tmp/gd-dl')"
  mv /tmp/gd-dl/Godot_v$GODOT-stable_mono_linux_x86_64/* /opt/godot/
  ln -sf /opt/godot/Godot_v$GODOT-stable_mono_linux.x86_64 /opt/godot/godot
  chmod +x /opt/godot/godot
  ln -sf /opt/godot/godot /usr/local/bin/godot
fi
if [ ! -x /opt/dotnet/dotnet ]; then
  curl -sSL -o /tmp/dotnet-install.sh https://builds.dotnet.microsoft.com/dotnet/scripts/v1/dotnet-install.sh
  bash /tmp/dotnet-install.sh --channel 9.0 --install-dir /opt/dotnet
  ln -sf /opt/dotnet/dotnet /usr/local/bin/dotnet
fi
if [ ! -f /usr/share/vulkan/icd.d/lvp_icd.json ]; then
  apt-get update -qq && apt-get install -y -qq --no-install-recommends mesa-vulkan-drivers
fi
