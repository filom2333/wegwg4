# Dust Road — Godot version

The game being rewritten for Godot 4.7 in C#. The browser version (`../web`) stays as the
reference until every part is moved over.

## Open it on your computer

1. Godot Engine **.NET** 4.7.2: https://godotengine.org/download (the ".NET" build, not the plain one).
2. .NET SDK 9: https://dotnet.microsoft.com/download/dotnet/9.0
3. In Godot: Import → pick `godot/project.godot`. The first time, press **Build** (top right) so
   the C# scripts compile; the main scene `scenes/Main.tscn` then shows the world around the
   editor's camera.
4. Run (F5).

## What is in so far

- The world: the same land, road, biomes, mountains, rivers' valleys and places' yards as the
  browser version (same seed, same map), streamed around the camera with levels of detail.
- Ground and road on scanned textures; sky, sun with shadows, haze.
- A free camera until the player and the car are in: click to take the mouse, **WASD** to move,
  **Shift** faster, **G** to switch between walking on the ground and flying (**Q/E** down and up),
  **Esc** to let the mouse go.

## Layout

| Folder | |
| --- | --- |
| `scenes/` | `Main.tscn`: environment, sun, `World/Terrain`, `World/Road`, `Player` |
| `scripts/core` | seeded noise and random numbers (bit for bit as the browser's) |
| `scripts/world` | `WorldGen` (the world description), terrain and road meshers and streamers, floating origin |
| `scripts/player` | the camera / player |
| `shaders/` | terrain, road and the shared ground layers |
| `materials/`, `environment/` | the terrain and road materials, the daytime sky |
| `assets/textures/ground` | the ground texture arrays (CC0 scans, see CREDITS.md) |
| `tests/WorldGenCheck` | checks the C# world against the browser's, point by point |
| `tools/` | `cloud-setup.sh` (installs Godot etc. in a cloud session), `shot.sh` (renders a picture without a GPU), `build/pack_ground.py` |

## In a cloud session

`tools/cloud-setup.sh` installs Godot, .NET, Blender and a software Vulkan driver (put it in the
environment's setup script so every session has them). `tools/shot.sh out.png --at=x,z --yaw=deg`
builds the project and saves a rendered picture from that world point.
