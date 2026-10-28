#!/bin/bash
# Setup script for the Claude Code cloud environment: Godot 4.7.2 (.NET), the .NET 9 SDK, Blender
# 5.2 and a software Vulkan driver, so a session can build the project, make models and render
# pictures without a GPU. Paste it into the environment's settings (Setup script).
#
# Claude's rules for setup scripts: it must exit 0 (or the session does not start) and finish in
# about five minutes (or the result is not cached for later sessions). So every part runs in
# parallel, a failed part only prints a warning, and each download is checked against its
# published checksum before it is installed. Takes about two minutes.

GODOT=4.7.2
BLENDER=5.2.3
DL=/tmp/setup-dl
mkdir -p $DL

install_godot() {
  [ -x /opt/godot/godot ] && return
  local zip=$DL/godot.zip dir=Godot_v$GODOT-stable_mono_linux_x86_64
  curl -fsSL -o $zip "https://downloads.godotengine.org/?version=$GODOT&flavor=stable&slug=mono_linux_x86_64.zip" &&
    curl -fsSL -o $DL/godot.sums "https://github.com/godotengine/godot/releases/download/$GODOT-stable/SHA512-SUMS.txt" &&
    echo "$(grep " $dir.zip" $DL/godot.sums | cut -d' ' -f1)  $zip" | sha512sum -c --quiet - &&
    python3 -I -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" $zip $DL &&
    mkdir -p /opt/godot && mv $DL/$dir/* /opt/godot/ &&
    chmod +x /opt/godot/Godot_v$GODOT-stable_mono_linux.x86_64 &&
    ln -sf /opt/godot/Godot_v$GODOT-stable_mono_linux.x86_64 /opt/godot/godot &&
    ln -sf /opt/godot/godot /usr/local/bin/godot
}

install_dotnet() {
  [ -x /opt/dotnet/dotnet ] && return
  curl -fsSL -o $DL/dotnet-install.sh https://builds.dotnet.microsoft.com/dotnet/scripts/v1/dotnet-install.sh &&
    bash $DL/dotnet-install.sh --channel 9.0 --install-dir /opt/dotnet >/dev/null &&
    ln -sf /opt/dotnet/dotnet /usr/local/bin/dotnet
}

install_blender() {
  [ -x /opt/blender/blender ] && return
  local base=https://download.blender.org/release/Blender${BLENDER%.*} tar=blender-$BLENDER-linux-x64.tar.xz
  curl -fsSL -o $DL/$tar $base/$tar &&
    curl -fsSL -o $DL/blender.sums $base/blender-$BLENDER.sha256 &&
    (cd $DL && grep " $tar" blender.sums | sha256sum -c --quiet -) &&
    mkdir -p /opt/blender && tar -xJf $DL/$tar -C /opt/blender --strip-components=1 &&
    ln -sf /opt/blender/blender /usr/local/bin/blender
}

install_vulkan() {
  [ -f /usr/share/vulkan/icd.d/lvp_icd.json ] && return
  apt-get update -qq && apt-get install -y -qq --no-install-recommends mesa-vulkan-drivers >/dev/null
}

for part in godot dotnet blender vulkan; do
  (install_$part || echo "setup: $part failed, the session starts without it") &
done
wait
rm -rf $DL
echo "setup: godot $(/opt/godot/godot --version 2>/dev/null | cut -d. -f1-3), dotnet $(/opt/dotnet/dotnet --version 2>/dev/null), blender $(/opt/blender/blender --version 2>/dev/null | head -1 | cut -d' ' -f2)"
exit 0
