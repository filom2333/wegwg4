# Dust Road — Godot version

The game being rewritten for Godot 4.7 in C#. The browser version (`../src`) stays as the
reference until every part is moved over.

## Open it on your computer

1. Godot Engine **.NET** 4.7.2: https://godotengine.org/download (the ".NET" build, not the plain one).
2. .NET SDK 9: https://dotnet.microsoft.com/download/dotnet/9.0
3. In Godot: Import → pick `godot/project.godot` → Run (F5).

## In a cloud session

`tools/cloud-setup.sh` installs Godot, .NET, Blender and a software Vulkan driver (put it in the
environment's setup script so every session has them). `tools/shot.sh out.png` builds the
project and saves a rendered picture.
