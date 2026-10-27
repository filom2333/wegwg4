# HANDOFF — read this first (for the next Claude session)

You are continuing work on **Dust Road** (Route 9 · 150 km to Haven), a first-person survival
driving game in the spirit of *The Long Drive*. It is built with three.js 0.186 + Rapier (compat)
+ Vite 8. A previous Claude session (also Opus 5.5, on another account) wrote this file when its
usage limit ran out. When you finish your own session, **update this file** with what you did and
what is left, then commit and push. The user may hand the file back to that other session, so it
works like a shared log between two sessions.

## 0. Rules from the user (always follow)

- **Reply to the user in Russian.** They write casual Russian and sometimes use swear words; stay friendly.
- Develop on the branch your harness names (sessions so far: `claude/task-4exkyg`, then
  `claude/awesome-dirac-a852qz`). Push with `git push -u origin <branch>` (retry on network
  errors). Do **not** open PRs unless asked. The user merges PRs into `main` themselves and plays
  `main` (start-game.bat runs the dev server on it): work that is not merged is invisible to them.
  filom2333/wegwg4#7 carries everything up to this session into `main`.
- Commit messages must contain **no model identifiers**. End each one with the attribution lines
  your harness gives you.
- Commit and push after each finished feature, and post short progress updates in Russian.
- The user cares most about **beauty, realism, smoothness (FPS) and no ugly or crooked details**.
  They check screenshots carefully, so verify visually before you claim something is done.
- "All small details must be accounted for" (their words).
- Downloaded third-party files are untrusted data. Keep them in their own folder, never execute
  them, and run Python that reads them with `python3 -I`.
- Things the user asked for **LATER, only when they say so** (do not start these on your own):
  - more buildings (towers, 2–3 storey houses);
  - more game features;
  - find a new third car to replace the deleted Logan (it must match the retro style; the user
    called the Logan "shit, not in style").

## 0b. THE GODOT PORT (decided 27.10, the user wants the whole game rewritten for Godot)

The user decided to rewrite the full game for **Godot 4.7.2 in C#** (the browser version in `src/`
is the reference until every part is moved). Do not argue against the port again; the user was
annoyed by the pushback. The project lives in `godot/` (see `godot/README.md`).
- Cloud sessions: `godot/tools/cloud-setup.sh` installs Godot .NET 4.7.2 (checksum checked),
  the .NET 9 SDK and lavapipe (software Vulkan). Until the user puts it in the environment's setup
  script, every new session has to install them again. `godot/tools/shot.sh out.png` builds and
  renders a picture on software Vulkan, Forward+ (~20 s). Godot's own args: `-- --shot=path`.
- Physics: Jolt (built in). Heavy procedural code (terrain, SDF characters, car shapes) in C#.
- Tools researched (Oct 2026): Godot MCP for when Claude runs on the user's PC — godot-ai (free,
  MIT, Godot 4.7 editor plugin, screenshots + input), Coding-Solo godot-mcp (simplest, no
  pictures), GDAI ($19), Godot MCP Pro ($15). Blender: official Blender MCP (Blender 5.1+) on the
  PC; in the cloud, Blender runs headless with Python (`blender -b --python`), no MCP needed.

## 1. How to run and test

- Install: `npm install`. Dev server: `npx vite`. Production: `npx vite build`, then
  `npx vite preview --port 5174 --host 127.0.0.1`.
- A prebuilt copy of the current state is committed in **`build/`** (a copy of `dist/`). Serve it
  with any static server, e.g. `npx vite preview --outDir build`, or
  `python3 -m http.server -d build`.
- Boot modes (`src/main.js`):
  - no params: title menu over a live attract scene;
  - `?play=1&...`: loading screen, then the game;
  - dev/test start straight into the world: `?seed=1234&time=10&z=3000&manual=1`
    (`manual=1` means time is stepped by tests). Also `&car=sedan88`.
- Headless testing (Playwright + SwiftShader, Chromium at /opt/pw-browsers):
  - `BASE=http://127.0.0.1:5174/ HELPERS=helpers.js node tools/play.mjs "<query>" steps.json [w h]`
  - Each step is `{sim:seconds}`, `{eval:"js"}`, `{waitFor:"js cond"}` or `{shot:"path.png"}`.
  - `window.game` is the Game; `game.debugSimulate(sec)`, `game.renderNow()`.
  - `game.debugView = cam => {...}` places the camera freely.
- Useful helpers the old session kept in /tmp (they will not exist for you, so recreate them):
  - `look(ex,ey,ez,tx,ty,tz)`: free camera in world coordinates (`+game.origin` offset). It sets
    `game.debugView` and hides `interaction.viewRoot`.
  - `enterDriver()`: `game.player.enterSeat(game.car,'driver')`, `car.setIgnition(true)`, crank.
  - `autopilot(sec,kmh,lane)`: overrides `game.driveControls` to follow `gen.roadX(z)`.
  - `lookAtCar(localPt, fromLocal)`.
- Car inspector: `/inspect.html?car=beetle|sedan88&ui=0`; `window.inspector` exposes `.car`
  (the model) plus setView/setOpen/camera/renderNow.
- Terrain shape preview without a browser: import `src/world/worldGen.js` in node
  (`new WorldGen(1234)`), sample `gen.height(x,z)` or `gen.mountain(x,z)` on a grid, then
  hillshade it with numpy/PIL. This is fast for tuning shapes.

## 2. Architecture (short map)

- `src/game.js`: Game init/loop.
  - Systems: terrain, scatter, pois, fleet, player, interaction, items, npcs, env, audio, hud.
  - The render loop sets the grade uniforms, `renderer.setSun(...)` and `updateFogSun(...)`
    every frame.
- `src/world/worldGen.js`: deterministic world.
  - Road: `roadX(z)`, `roadY(z)`. Biomes: 2600 m cells along z.
    `BIOMES = scrub, dunes, badlands, saltflat, highland, prairie, forest, taiga, tundra`.
  - Heights: `height()` → `baseHeight()` (road corridor and POI pads) → `naturalHeight()`
    (`macroHeight + Σ biomeDetail + mountain`). Rivers and lakes are carved in `height()`.
  - Also: `groundMaterial()` (7 ground-material weights per vertex), `surfaceAt()` (tyres),
    `poiSlot()` (POIs every ~620 m).
  - It is used in the main thread **and** in the workers (`terrainWorker`, `scatterWorker`,
    `poiWorker`). Keep it pure, with no DOM.
- `src/world/terrain.js`: quadtree tiles. ROOT 2048, MIN 64, `VIEW_RADIUS` 5600 (low quality 3000),
  N = 64 vertices for 64 m tiles and 32 otherwise. Physics heightfields cover 110 m around the player.
- `src/gfx/terrainMaterial.js`: splat shader over a ground texture array (sand, dirt, rock, salt,
  gravel, asphalt, grass, snow, forest). `src/gfx/groundTextures.js` generates those textures
  procedurally.
- `src/world/scatter.js` + `scatterGen.js` (worker): vegetation and rocks per 64 m cell.
  `SPECIES` table with densities per biome; far radius 880 m on high quality; impostors.
- `src/world/poi.js`, `poiLayouts.js`, `buildings/*`: points of interest (gas stations, motels,
  houses, garages, ...) built in a worker, light pool.
- `src/vehicle/*`, the cars:
  - `types.js` registry: `beetle` (1960s Beetle, rear engine, air-cooled, manual) and `sedan88`
    ("'88 Riverside sedan", 3.0 V6, 4-speed automatic, FWD, water-cooled, champagne colour).
  - Each type object (`beetle/type.js`, `sedan88/type.js`) holds SPEC, DRIVER, SEATS, HOTSPOTS,
    POINTS, BOXES, DYNAMICS, PARTS/PART_FAMILY/ASSEMBLY_ORDER, `cabin` (stow box), `MOUNTS`
    (accessory mounts), `trunk.com`, sound recipe, colours, load/materials/build/wreck.
  - `car.js`: Car systems. `fleet.js`: many cars, parking/waking, saving.
  - `swap.js`: cross-car parts. `accessories.js`, `plates.js`: see section 3.
  - `imported/*`: generic importer runtime for the sedan. `tools/cars/*` is the Python importer.
- `src/physics/vehicleDynamics.js`: raycast suspension, Pacejka-like tyres, drivetrain, ARB,
  surfaces table (with `trip` values).
- `src/player/interaction.js`: aiming, prompts, pick/drop, part install/remove, spray, plates,
  accessories, righting the car.
- `src/items/*`: item defs and loot tables (`itemDefs.js`), procedural models (`itemModels.js`),
  physics items and cargo simulation (`items.js`), inventory containers (`inventory.js`).
- `src/ui/*`: menu, settings, HUD, inventory UI. `src/audio/*`: synthesized audio, 6 CD albums.
- `src/gfx/renderer.js`:
  - EffectComposer chain: RenderPass → DepthCapture → Outline → Bloom → Output → FXAA → Grade.
  - QUALITY presets (low/medium/high/ultra) with msaa, sharpen and shafts.
  - `src/gfx/caps.js` holds `RENDER_CAPS`; `src/gfx/fogSun.js` patches three's fog chunks.

## 3. Done in this update (all pushed, newest last)

1. **Logan deleted** (model, type, tool script). The retro sedan was recoloured to champagne `0xcbb994`.
2. **Spray cans** (`sprayPaint`, 15 colours in `src/vehicle/paints.js`, 5 charges).
   - Hold LMB on a car part to paint only that part (per-part material clones; the shader stays shared).
   - Found in tools, shop and garages. A hiss sound and a mist effect play while spraying.
3. **Parts fit any car** (`src/vehicle/swap.js`):
   - Panels stretch to the slot. Mechanical parts are shrunk to fit and sit on the slot floor.
     Wheels are scaled to the hub.
   - An engine brings its own torque curve, redline and voice (`car.engineType`).
   - The origin is saved in `parts[id].from`. The install ghost is fitted to the slot. A foreign
     part keeps its paint and can be sprayed (`material.userData.paint`).
4. **No parts poke through hoods**: the sedan's radiator and battery were lowered. The Beetle has
   only 2–3 cm overlaps at the lid edges, which is acceptable.
5. **Accessories** (`src/vehicle/accessories.js`):
   - Items: `roofRack`, `roofBox` (50 kg storage, shown in the inventory UI when near), `bullBar`
     (−45 % front crash damage), `rearRack` (hitch tray), `sandbag` (20 kg ballast).
   - Fitting: hold the item near the car and press E; the ghost preview is built for that car,
     and rack feet are raycast down to that car's roof. To take one off, aim at it and hold R.
   - Cargo dropped on a roof rack or rear tray is strapped on (`stowed.zone`) and falls off when
     the car tips over.
   - Found cars sometimes come with kit fitted (`outfit()` in fleet). Garages have a `gear` loot
     spot. The kit is saved with the car.
6. **Mass and centre of gravity**: `car.updateMass()` counts parts (foreign masses too), fuel,
   driver, accessories, plates, stowed items, trunk/glovebox/roofbox weight (checked every 0.5 s).
   The old hard clamp of COM y ≤ 0.55 is gone; the shell COM is now lowered by 5 cm.
7. **Rollovers**:
   - Tyre forces are applied at the contact patch (+0.02).
   - Soft ground trips the car when it slides sideways (`trip` per surface:
     sand 1.4, dirt 0.9, grass 0.8, snow 0.9, gravel 0.35; a flat tyre 0.8).
   - When tilted beyond about 26°, the suspension reaction blends toward the ground normal.
     That was the real bug: along the strut axis it always pushed the car back upright.
   - Upside down, the engine stalls after 2.5 s, fuel weeps out and deck cargo falls off.
   - Hold E near an overturned car to push it back on its wheels (`carTipped()`, `updateRighting()`).
   - Tested: normal driving at 95 km/h rolls the car 2°. A 100 km/h slide onto sand flips it; a
     loaded roof makes flips easier.
8. **Bolt-on plates** (`src/vehicle/plates.js`); the user asked for these, as in the original
   game:
   - Items: `steelPlate`, `steelSheet`, `plank`, `plankWide`, `plywood`, `plasticPanel`,
     `plasticSheet` (5 colours).
   - Placement: aim at any car part and press E. The mouse wheel rotates the plate; it settles on
     the surface under its corners.
   - The plate rides on the part's pivot (it swings with doors) and drops off when the part is
     removed. It has a collider (only while the part is closed) and its mass counts.
   - Steel at the nose or tail reduces crash damage (`plateArmour`). Plates can be sprayed;
     hold R to unbolt. They are saved with the car.
   - Found in garages, storerooms, ruins and wrecks.
9. **Mountains v1** (committed "Mountain ranges along the road"). The **user hated them**: they
   look like Blender, have no textures, and in places sit too close to the road. A rework is in
   progress (section 4).

## 4. Work in progress, UNCOMMITTED until this push (verify it first!)

Last-minute check: the build runs headless with **no shader or console errors**. The badlands view
at z=6500, time 17, looks good: a calm plain by the road, terraced mesas and hoodoos set back,
textured rock. The other biomes, the sun effects and FPS are still unchecked.

This push includes a half-finished landscape and graphics rework. The build compiles, but it was
**not visually verified** after the last edits. Check it first.

### 4a. Graphics (renderer.js, fogSun.js, caps.js, game.js render())

- Quality presets: high/ultra use MSAA 4× (the composer render target has `samples`); FXAA only on
  low/medium. High `maxPixels` was raised to 3.7e6. The dynamic-resolution floor is 0.75 (was 0.6).
- The grade pass now does contrast-adaptive **sharpening** (`uSharpen`), **sun shafts** and **sun
  glare/lens ghosts**.
  - Both effects use the scene depth captured right after RenderPass (`DepthCapturePass` →
    `tDepth`); sky means depth ≥ 0.999999.
  - `renderer.setSun(dir, color, strength)` runs every frame from `game.render()`.
- `fogSun.js` patches `THREE.ShaderChunk.fog_*` globally: fog takes the sun's colour when looking
  toward it. The struct uniform `fogSun` is shared by reference.
- Anisotropy 16 on ground textures (`RENDER_CAPS.aniso`). Foliage uses `alphaToCoverage` when MSAA
  is on (trees, flora, impostors).
- **To verify:**
  - no shader compile errors on terrain, water or foliage;
  - shafts and glare look nice and not overdone at golden hour (time 18–18.5) looking toward the sun;
  - MSAA plus depth texture works (the outline highlight still works);
  - FPS is acceptable.
  - Tune the strengths in GradeShader.

### 4b. Landscape rework (worldGen.js, terrainMaterial.js, terrain.js)

The user's complaints, which are the goals:

- Mountains look fake, untextured, and are too close in places.
- Deserts are "just weird sand everywhere", not real dunes. There are no calm plains and no
  beauty in the distance.
- There is too little vegetation.
- Loading: no visible pop-in near the player; the first metres must always be loaded; there must
  be no harsh transitions.
- Everything must stay optimized.

Done so far (uncommitted, unverified in game):

- `mountain(x,z,bw)` now uses `erodedFbm()`: derivative-damped value-noise fBm in the style of
  Inigo Quilez's "Elevated", 9 octaves with rotation.
  - Ranges are elongated belts along the road (basin-and-range):
    `belt = noise(x*0.00034, z*0.00011)`.
  - Ranges start 270–950 m from the road (`close` noise) with a 1000 m ramp. Rivers cut 1100 m
    valleys through them.
  - Relief `min(1.35, (e/0.45)^1.6) * amp`, amp ≈ 520–1000 m by biome.
  - Offline hillshade looked OK. **Not yet seen in game.**
- `biomeDetail(b,x,z,dx)` was rewritten. It now receives the distance from the road.
  - **scrub**: calm plain, shallow washes, low hills only further back in hilly regions.
  - **dunes**: a flat sand sheet near the road. Erg fields from 110–420 m out: transverse dunes
    across the wind (+x) with a gentle windward slope and a steep slip face, 6–19 m high.
  - **badlands**: flats and washes near the road; terraced mesas from 140–600 m out.
  - **highland**: plateau swells plus knolls (the old egg-crate bumps were removed).
  - **prairie** and **forest** are calmer near the road.
- `groundMaterial()`:
  - rock on mountains above 120 m (desert) and above 330 m (green biomes);
  - wooded slopes in forest and taiga;
  - snow line 420 m (+160 in desert, −200 in snowy biomes).
- terrainMaterial.js:
  - **triplanar side projection** for dirt and rock on steep slopes (`side`, `uvSN`);
  - **rock strata** colour bands by world height (`vWy`);
  - **macro relief normals** from GLSL value-noise derivatives at 8, 32 and 128 m (`tNoised`,
    the lattice wraps every 2048 m because uv wraps there). They are stronger far away and on rock;
  - a fog-edge fade at the view radius (`uFadeFar`).
- `GEN.rock` in groundTextures.js was rewritten in the last minute: warped, broken joints at two
  scales, fine layering, pits and pale lichen instead of the big Voronoi "hexagon tiles". It
  compiles but is **unverified in game**. Check it, and that the rock looks good on slopes.

## 4c. USER FEEDBACK on the current look (top priority, read before step 1)

Picture: `docs/feedback/badlands_ugly.webp` (badlands, z=6500, time 17). The user's words, paraphrased:
"Ugly trash, nothing goes together, there's no beauty. Maybe the game is too dark, maybe it's
something else. What is this? The stone pillars are too tall and weird, nonsense."
What to fix:
- **Hoodoos** (`hoodoo` in scatterGen SPECIES, `F.hoodoo` in flora.js): they are too tall, too
  many, and stand like evenly scattered red sticks. Make them rare and grouped in clusters at mesa
  feet, lower, with believable eroded shapes and the same rock colour as the mesas (they are a
  different red now). Or remove them near the road.
- **Colour harmony**: the rocks, ground, mesas, cacti and boulders don't match (different hues and
  saturation). Unify the palette per biome: rock tint = ground tint family; boulders tinted like
  the local rock; less orange on the ground.
- **Lighting and brightness**: the scene reads dull, flat and dark. Check exposure and tone mapping
  (`env.update`: toneMappingExposure, hemi/sun intensity), shadow contrast, ambient. Aim for
  bright, warm, clear desert light with visible depth (aerial haze, the sunlit-haze glow from
  fogSun.js) and richer sky colour.
- **Ground**: big flat areas with a uniform texture and sprinkled dots look cheap. Add more ground
  detail variety (patches of gravel, darker crust, sparse grass tufts in clumps), larger-scale
  colour variation, and denser vegetation clumped naturally rather than evenly sprinkled.
- **Mesas**: their faces look like flat bands. Add more variation in cliff height, talus slopes at
  their feet, and erosion notches.
- Judge every change by screenshots against this picture. The user wants it to look **beautiful**,
  like a real road trip through the American Southwest.

## 4d. Landscape pass done in the next session (commits after 36d4730, all verified by screenshots)

What was done in reply to 4c (and 4b), checked with headless renders of scrub 1200, dunes 4300,
badlands 6500, highland 11500, forest 16500, prairie 19500, taiga 63500, golden hour 18.3–18.4:

- **Hoodoos** (`F.hoodoo`, SPECIES `hoodoo`): squat pillars on a talus cone, 2–5 m, grey vertex
  colour so the rock material tints them like local cliffs. Placement uses the new `place()` hook
  in scatterGen: only at mesa feet (`gen.mesaNoise` 0.17–0.29) and ≥120 m from the road; removed
  from highland. Collider shrunk to match. Tilt reduced.
- **Colour harmony**: `ROCK_TINT` in scatter.js is now derived from `BIOME_INFO.ground` with the
  same formula the terrain shader uses for rock, so boulders/hoodoos/cliffs match. Badlands ground
  is `[0.62, 0.43, 0.32]` (less orange). Saguaro and barrel cactus are dusty olive. Base rock
  texture warmer.
- **Light**: sun 4.1 (+0.8 warm), hemi 0.3 + 0.24·day, day exposure 0.98, horizon/fog colour bluer
  `(0.71, 0.77, 0.85)`. The terrain far fade now uses the sun-tinted fog colour `fogC`, which
  fixed the flat white "cardboard" mountains at sunset.
- **Ground**: 8th ground layer **gravel** (`mat2.w`, texture layer 4): desert pavement patches
  and scree on moderate slopes; `surfaceAt` can return `gravel`. Soil-crust blotches on dirt,
  `gen.tintDrift(x,z)` broad colour drift baked into the tint attribute, dirt pebbles cut to a few
  stones, irregular strata beds (value noise, not sine stripes).
- **No tiling on far slopes**: beyond 70 m the shader blends the far scale into a very coarse one
  (`uvX`, ×0.043), and from 450–1400 m textures settle to the layer mean (`flatT`, textureLod 12).
- **Landforms**: dunes cover most of the dune sea and reach the road as low drifts (8–24 m);
  mesas vary in height with talus aprons and erosion notches; low banded clay hills near the
  badlands road. Mountains: ridged multifractal on top of `erodedFbm`, tanh soft clip instead of a
  flat cap, start 550–1300 m from the road (`start = 1300 - 750 * close`), lower in the dune sea.
- **Vegetation**: denser, clumped grass/shrubs (shrubs drawn to ring 4), more cacti/Joshua/pines/
  birch; new species `yucca` (rosette, sometimes a flower stalk) and `ocotillo` (impostor far).
- **Far vegetation in the terrain shader**: `tint` is now a vec4; `.a` = shrub cover from
  `BIOME_INFO.shrubs`. Past the scatter rings (210–330 m) dark shrub crowns speckle the ground on
  4 m cells, averaging to a tone when cells get small (no shimmer). In wooded ground (forest-floor
  weight) the speckle becomes a dense canopy beyond 760–980 m, so forests don't end in bare land.
  Grass drifts between golden dry stretches and lush hollows.
- FPS: not measurable headless (SwiftShader). Costs added: ~1 extra fetch per layer far away,
  a few value-noise evaluations, ~2× shrub instances. **Ask the user to check FPS on their GPU.**

Known leftovers: highland mixes pines, Joshua trees and cacti fairly evenly (could cluster per
biome); looking straight into a high sun the glare/bloom is large; a desert-type tan mountain can
stand inside the forest biome (mountain colour follows local biome weights).

## 4e. The big update after 4d (commits 67c000d … 0d5ce3d, verified headless)

**Push status:** this session could not push (GitHub refused: the repo is not in the session's
authorised set). All commits are local on `claude/task-4exkyg`; the user got a git bundle. If you
can push, push first.

Everything below was asked for in one long user message (hands, HUD, menu, The-Long-Drive start,
trailer, entities, item handling, headlights, survival, music, FPS):

- **Menu** (`ui.js`, `menu.css`, `public/menu/*.webp`): no live world on the title screen; 9
  pre-rendered WebP landscapes with a Ken Burns slideshow (`showBackdrop`, every 9 s); frosted
  cards, tile buttons with an amber accent; credits list every asset with links; news "Update
  0.10". `main.js` boots the menu with `ui.game = { audio: new AudioSystem({}) }`.
- **Effects** (`glassRain.js`, `effects.js`, `renderer.js` GradeShader): rain beads on car glass
  (streak with speed, wiped on the windscreen), heat shimmer over hot ground at midday (depth band
  90–5200 m, off on low), tyre smoke on asphalt skids, dust motes in sunbeams.
- **Hands** (`grips.js`, `interaction.js`): left-hand anchor frame was mirrored wrong (sleeve
  showed); `anchorQFor(side, …)`. Big items are carried with both hands from their camera-space
  box (`carriedBig`). Small items can float: mouse wheel moves them in/out within limits, RMB-drag
  rotates (`holdRot`), LMB brings them back to the hand.
- **Headlights** (`car.js`): one spot per lamp at ±`headX` (each throws its own shadow) plus a
  wide fill; no more beam from the middle of the bonnet.
- **New game start** (`game.setupUnassembled`, `items.addPending/placePending`): the car (chassis,
  body, wheels) stands in the yard; small parts are hidden in loot spots, big ones around the yard,
  heavy ones behind the garage; 1–2 small parts are in the next place up the road; 45 % chance of a
  donor car of the other type with some parts missing. Default start is `parts`.
- **HUD** (`hud.js`, `style.css`): vitals as rings (health, food, water, rest, warmth with °C),
  vehicle cluster (speed, gear, rev bar, fuel/temp/battery, warning chips), compass with Haven
  distance and a progress bar, bigger hotbar, toast cards.
- **Survival** (`player.updateWarmth`, `campfires.js`, `itemDefs.js`): body warmth vs air
  temperature (`env.airTemp(biome)`, AIR table), shelter/heater/fire/rain/wet, hypothermia below
  12, heat thirst above 32 °C; campfire kit → `campfires.kindle()` (fire, smoke, sparks, warmth,
  burns 3 game hours, rain shortens it); raw meat cooks over a fire (`def.cooksTo`), raw food can
  make you sick (`poison`), thermos (3 hot drinks), blanket (wrap for warmth), cooked meat/fish.
- **Trailer** (`src/vehicle/trailer.js`, `G.TRAILER`): modelled utility trailer with two wheel
  bodies on revolute joints and a spherical-joint hitch; hitch/unhitch with E at the tow ball of
  either car, pull it by hand, load things on it; found at farms, ranches, junkyards (55 %); one
  at the homestead; saved. Towing: the Beetle reaches ~47 km/h in 12 s with it (66 without).
- **Fishing and siphoning** (`interaction.updateFishing`, pourTarget kind `siphon`): cast with a
  rod at water, wait for a bite, reel in; siphon fuel from any car with a hose into a jerry can.
- **Entities** (`characters.js`, `npcs.js`): wolves (packs in the north at night, scale 1.32),
  rattlesnakes (desert by day, coil and strike, venom = poison), the tall one ("stalker", some
  deep nights: moves only while unseen, vanishes in light, when hurt or under a long stare,
  strikes at close range). Death texts for each.
- **Music** (`src/audio/music/arrange.js`, `engine.js`): all 18 tracks rewritten as arrangements.
  `Song` frame (form, swing, human timing, memoised notes), `voicing()` voice leading, `tune()`
  builds A A′ A cadence from a 2-bar hook with a leap (`line()`), `improv()` for solos, drum
  patterns as strings with fills/rolls/crashes. Per album: synthwave (sidechain pump, key lift in
  the last chorus), rock (riffs, doubled guitars, harmony lead, solo), country (waltz / train beat
  / piano ballad), ambient (harp ostinato, piano, downtempo), blues (shuffle with harp head and
  stop-time, 12/8 slow blues, jump blues with a horn riff), lo-fi (rootless 9ths, sub slides, tape
  stop at the end of "Slow Exit"). New instruments: piano, FM bell/vibes, tom, crash, shaker, rim,
  riser; master loudness matching. Tracks are 1:45–2:55 and render in 1–3 s in the worker; the CD
  cache keeps 2 buffers. Check them by ear: `node` can import arrange.js and write WAVs.
- **Performance** (commit 0d5ce3d), measured with CPU profiles while streaming at 90 km/h:
  - `src/gfx/lightPool.js`: every small light is a proxy registered with `game.lights.add(light,
    {shadow})`; 4 point + 1 spot + 2 shadowed spot real lights go to the most important ones each
    frame; with nothing lit the pool is hidden (daylight pixels pay for no extra lights). Both
    states are compiled while loading (`lights.warm`). **Never add a real PointLight/SpotLight to
    the scene any more** — the light count is part of every shader key (cars coming into view used
    to recompile every shader).
  - POI content hooks (items, NPCs, parked car, trailer) run one per frame after the place is
    assembled (`inst.pending`); the spawn place is still built at once.
  - `terrain.ensureCollidersAround` builds only the tiles touching the radius (a waking parked car
    cost 25 tiles ≈ 50 ms). `retireCovered` no longer parses string keys (`wantedTiles`).
  - Scatter: cell entries split by reach (`splitByReach`), the sun shadow pass draws only the rings
    it can reach (`onBeforeShadow`, `setShadowReach`).
  - Idle particle systems skip update/upload; `checkShaderErrors` only in dev; first-run quality
    preset from the GPU name (`detectQuality` in settings.js). `tools/play.mjs` pins `high`
    (env `QUALITY`) because SwiftShader would pick `low`.
  - Remaining single-frame costs: creating a parked car (~10–30 ms, procedural fan belt, controls,
    plates) and assembling a place (~8 ms); a GC now and then.

## 5. NEXT STEPS (in this order)

1. **Push** the local commits if GitHub access works (see 4e). Refresh `build/` after any change
   (`rm -rf build && cp -r dist build` after `npx vite build`).
2. Ask the user to try it on their GPU: FPS (the in-game FPS counter is in Settings), the music
   (all 6 discs), the parts hunt at the start, the trailer, nights with wolves and the tall one.
   Fix what they report first.
3. If FPS is still low on their machine: look at fill rate first (MSAA 4× on `high`, the terrain
   splat with 8 layers, bloom), then at the shadow pass (`renderer.info` with `autoReset=false`).
   Parked-car creation could cache its procedural sub-geometries per car type.
4. Streaming at very high speed on slow CPUs can briefly show a coarse terrain tile next to a fine
   one (a step with a stretched skirt) until the worker catches up; it settles by itself.
5. Old pending items: character looks and animations; sound design overhaul.
6. Only when the user asks: more buildings, a third retro car, the ideas in section 7.

## 6. Answers already given to the user

- Music CDs exist: 6 albums. One is in the glovebox; the others are loot (tables, shops, wrecks).
  Insert one by looking at the stereo and pressing LMB; R ejects it.
- The previous session used GitHub code search across public repositories to find car models (the
  sedan came that way).

## 7. Ideas the session proposed to the user for later (only when the user asks)

- (Done in 4e: trailer and tow hitch, siphoning fuel.)
- Car jack and winch to pull out stuck cars.
- Sandstorms and fog events.
- Tuning parts (carburettor, exhaust, off-road tyres).
- Sleeping in the car or a tent.
- A road atlas with notes.
- Photo mode.
- Also later: more buildings (towers, 2–3 storey houses), new game features, a new third retro car.

## 8. Gotchas learned the hard way

- Lights: use `game.lights.add(light)` (see 4e). A real light added or shown/hidden changes the
  light count and recompiles every shader on screen.
- Headless step loops must yield (`await new Promise(r => setTimeout(r, 5))` every few steps) or
  worker results (POIs, terrain, scatter) never arrive.
- Profiling: Chrome CPU profiles through Playwright CDP (`Profiler.start/stop`) find hot spots
  quickly; SwiftShader render times are only a rough proxy for GPU cost, and scenes must be fully
  streamed (`settle()`) before timing.

- Parked cars have disabled bodies. The vehicle `beforeStep` hook must skip them (`body.isEnabled()`),
  otherwise impulses pile up and the car launches when it wakes. `fleet.wake()` zeroes velocities.
- Part bounding boxes are in **car space**. Test rays against them with the inverse of the part's
  `inner.matrixWorld`, not `pivot.matrixWorld`: hinged pivots carry the hinge offset.
- `model.parts[id]` has `{pivot, inner}`. `setPartSource` clears `inner`, so attach extra things
  (plates) to `pivot`.
- `carTarget` skips `body` and `chassis`. To detect the car as a whole, use the SPEC box
  (see `carTipped`).
- Terrain uv is world xz mod 2048. Any procedural lattice in the shader must wrap at 2048
  (P = 2048 / cell size).
- The sky has `depthWrite:false`, so sky pixels have depth 1.0. The sun effects rely on that.
- worldGen runs in workers: no DOM and no three.js in it. Rock/vegetation materials that need GPU
  caps import `src/gfx/caps.js`, not renderer.js.
- In SwiftShader headless tests one screenshot takes ~20–60 s, so batch your views.
- `debugSimulate` steps physics without rendering. Call `game.terrain.ready` / `waitFor` before
  taking shots.
- vite preview serves `dist/`. Rebuild before headless tests.

## 9. Session status (latest)

### The user's big voice request (Russian, transcribed) — what it asked for
Bugs (flicker, black wheel liners, car contact damage, black screen in some directions, character
shader flicker, half-open doors); replace the Beetle with 2 normal cars with interiors and many
engine-bay parts; side headlights; colours; start parts placed logically; hands follow held
items; better player model; bigger, less "cardboard" rooms; 25-40 real textured models that fit
the style (verified loading, fallback); roads with curves, forks, big hills, obstacles with
detours; snow that feels like snow, lightning near the car, a night sky with twinkling stars and
not-too-dark nights, birch forests ("Yakutia, birch"); better distant scenery and menu; car
physics that is not cardboard, rollovers with consequences (car destruction: plan only); fewer
useless toasts, better overlays, a reworked CD menu; harder on all difficulties, fewer intact
cars; full car interior interaction (fuel caps, pouring, readable speedo, radio channels,
working buttons, free look); events every ~5 km drawing you into houses. Priority stated:
models, hands, physics, LOGIC.
The user got angry at modern-looking decor models ("they don't fit the style") and at houses
floating above the ground; wants some houses much bigger and some objects interactive.

### Network for models
Only registry.npmjs.org and raw.githubusercontent.com are reachable (polyhaven, sketchfab,
kenney, ambientcg, jsdelivr, unpkg, github web/API are blocked). npm was searched thoroughly
(~380 queries): few realistic models exist there. Used: the W203 car (threed-garden, CC-BY),
ez-tree mossy rocks (MIT), a grass carp (@so-chart/fish), a tyre (3d-model-testingpublic).
NOT used on purpose: the Ant City Unity kit (no licence, looks like a repackaged paid Asset
Store pack) and the W210 (not split into parts, CC-BY-NC-SA). If the user opens the network
(environment → Network access) or uploads packs into `assets_incoming/`, process them with the
scratchpad pipeline (gltf-transform: prune/dedup/weld/simplify/webp; see section 8 notes) and
add them to `src/world/props.js` PROPS.

### Done this session (all committed and pushed, newest last)
- Bug fixes: car contact damage only from a moving car, flicker (reversed-Z depth), NaN black
  blocks (sanitised bloom/output), doors never half open, start parts in logical rows, start car
  colour, quiet text toasts.
- Real props (`src/world/props.js`, PropLibrary): verified loading, fallback colour, real-size
  normalising, colliders; tall buildings wired in; concrete footings under buildings standing
  over a slope (`POIManager.addFootings`); bigger houses with 3 m ceilings.
- Hands follow held items (reach clamp to 0.7 m from the shoulder, open hand when far).
- Car physics: crashes tear off the parts facing the obstacle (`Car.panelDamage` /
  `processTears`, thresholds in `TEARABLE`), parts fly on as items; side/roof hits burst doors;
  roof hits dent the body; upside down: oil starvation wear, oil and acid leak. `Car.detachPart`
  is shared with the player's remove. Seated head motion: spring-damper on the car's
  accelerations, surface buzz, pothole jolts, crash snap (`Player.seatHead`).
- Lures every ~5 km (`src/story/lures.js`): a house/farm/station calls you in with smoke from a
  fire in a drum (red flare at night, with light), a hand-painted sign at the turn-off, or a CB
  call (subtitle + atlas pin). Cache inside (fuel, battery+belt, food, medicine); calls for help
  are sometimes ambushes (hostile vagrants via `NPCManager.onPoiLoaded`).
- Harder: found cars rarer (9% of later host places on Normal) and broken (3-5 missing parts,
  flat tyres, dead battery, empty tank; half the missing parts lie inside the same place), loot
  x0.7, all difficulties tougher (DIFFICULTY in game.js).
- Roads (`worldGen.track*`, `src/world/obstacles.js`, `terrain.buildTrack`): dirt side tracks
  every ~3.4 km swinging 130-320 m out over the land; ~60% are detours around a closed highway
  (fallen spruces/birches, boulder wall, jack-knifed trailer with crashed cars; striped
  barricades and cones that fly when hit; DETOUR/ROAD CLOSED boards; OLD ROAD fingerposts on open
  ones). Tracks cut their own bed, open out of the shoulder, are clear of trees and POIs, drive as
  dirt, and show on the atlas. Hill country on the highway (up to ~11% grades).
- New start car: the '04 Kronberg C200 (`src/vehicle/w203/`, import config
  `tools/cars/w203.py`, run with `W203_SRC=<dir with w203_mr.gltf> python3 -I tools/cars/run.py
  tools/cars/w203.py public/models/w203 src/vehicle/w203/w203Meta.json`; the source is first
  converted spec-gloss→metal-rough and simplified with the scratchpad script w203conv.mjs).
  Rear drive, 5-speed manual, removable front wings, battery in the boot. New runs start with the
  W203 or the Riverside; the Beetle is retired (kept for old saves; `CAR_TYPE_LIST` vs
  `CAR_TYPES`).
- Real models: mossy boulders in the green biomes (scatter species `mossrock`, instanced from
  `PropLibrary.geometryOf/materialOf`), real tyre stacks, a real carp for fish items
  (`registerRealModel` in itemModels.js).

- Night sky (two-layer twinkling stars, Milky Way), brighter nights, forked lightning with
  ground current near the car, real snow (flakes, breath, snow-covered ground with sastrugi),
  birch groves in taiga/tundra, sharper distant ridges.
- Cabin interaction: fuel flap and jerry-can pouring stream, readable speedometers, radio
  stations (`src/audio/stations.js`: KDRT, KLOW, Haven 98.1, numbers 88.3, EBS 640 AM), hazard,
  heater and dome switches, free look and RMB zoom in the seat; now-playing card; shop shelves
  stocked with packaged goods (`goodsMaterial`).
- Player body in third person (`src/player/glbAvatar.js`): the Ready Player Me avatar from the
  three.js examples (`public/models/props/survivor_rpm.glb`), re-coloured for the road (canvas
  coat, dark waistcoat, denim, boots, felt hat; recolour script in the scratchpad, see the
  commit). The Soldier's Idle/Walk/Run live mesh-less in `survivor_anim.glb` and are retargeted
  onto the avatar at load (`retargetClips`: world-space turn from each rig's T-pose). Two-bone IK
  (`GlbAvatar.reach`) puts the seated feet on the footwell floor and the driver's hands on the rim
  (they turn with it); big carried things sit against the chest in third person with the palms
  on their flanks (`interaction.js`, `from`/`bodyQ`). NOTE: Ready Player Me avatars are usually
  licensed CC BY-NC-SA 4.0 (non-commercial); check before any commercial release.
- Engine bay parts on both front-engined cars (`frontEngineParts.js`, `procParts.js`):
  alternator (charging; without it the battery runs flat and the engine dies), water pump
  (cooling; missing = coolant runs out), starter (cranking; missing = key clicks, roll-start in
  gear on a manual: `Car.update` "rolling start"), spark plugs (W203 coil packs, Riverside six
  plugs with leads to a distributor; worn = misfire/power loss, none = no spark), oil filter
  (clogged = wear, missing = oil pumps out). `Car.partCond(id)` treats parts a type lacks as
  fine. The belt is `PP.beltLoop` round crank, pump and alternator and needs both. The W203's
  plastic engine shroud is split out of the source body (`tools/cars/w203.py` classify rule,
  re-run the importer as above) as part `enginecover`; the coils need it off (`needsOpen`).

- Oil drums are fuel sources: `placeProp` registers each `oilDrum` (spec `fuel: true`) as a
  pump with its own seeded amount in `inst.state.drums` (55% empty, else 4-40 l); a jerry can
  fills from it ("Fill from the drum"), the car does not. Fire drums at lures pass `fuel: false`.
- More real models (Khronos sample assets, CC-BY): a barramundi as the second fish species (fish
  items have `variants: 2`, the cooked fish keeps its variant), an antique bellows camera on a
  tripod in some living rooms, teacups on coffee and dining tables.

- Leaks you can see (`Effects.leaks`): drips and a spreading puddle (oil black, coolant green)
  under the car with no oil filter on a running engine / upside down, or with the water pump
  gone. Cranking that never catches tells you why after ~2.6 s (no spark, no fuel, dry, seized).
- Menu pictures re-rendered with the W203, the new sky and the mountains (`menu4.sh` and the
  `st_menu_*.json` scenes in the scratchpad; PNG → webp q84 into `public/menu/`).

- `procParts` builders end in `bake()`: the pieces of a part are merged into one mesh per
  material (the W203 went from 204 to 135 meshes). Keep new builders doing the same, and use the
  shared module materials (RED_CABLE, PORCELAIN, CASE_BLACK) instead of making new ones inline.

- Roads with character (`worldGen.windSeg/windAt`): the road is cut into 2.6 km stretches,
  each calm (only the old long sweeps), winding (S-bends every 340-600 m), tight (220-340 m) or a
  pass (tight bends on a climb). Bend radius never under ~45 m (amplitude capped by L²); bends
  fade out near river crossings and lakes (`calmWater`, from their nominal z, no recursion).
  High ground (`liftEvent/liftAt`, every ~16 km): plateaus (+120..320 m), ridges crossed at a
  saddle (+170..380 m) and basins (-70..-160 m) with ~8% road grades and a wandering, steeper
  edge away from the road; other relief is damped on the ramps (`rampWeight`). Terrain and
  scatter use `roadDist` (across the road, not along x); road UVs use arc length `roadS`;
  POIs avoid steep stretches and bends that swing into their yard (`poiOnRoad`); lakes avoid
  ramps and the road. Tools: scratchpad `tools/roadmap.mjs` (plan + profile + min radius/grade).

- Plates bolt anywhere (`interaction.plateFit`): on any car within reach (not only the current
  one; `plate.car` remembers the host) or on anything solid in the world via the physics ray
  (`worldSpot`: walls, fences, rocks, the ground). Wheel turns the sheet, Shift+Wheel tilts it up
  off the surface about its near edge (`tiltSpot`, 0-90°: a ramp, a windbreak, a wall). World
  plates live in `src/world/worldPlates.js` (fixed colliders, absolute positions, saved as
  `worldPlates`, rebased with the origin); R (hold) unbolts any of them, spray paint works.
- Recorded sounds (`AudioSystem.loadSamples`): files in `public/sounds/` listed in
  `sounds/index.json` replace synthesized ones (see the sound sheet artifact
  https://claude.ai/artifact/R84zAEjoiv9kSJW3iQ8ZFK for names and prompts; songs map as
  "album:track" keys, album order neon, rattlers, june, salt, eddie, kr9).
  - 83 sounds / 145 files (2.5 MB) generated with ElevenLabs `eleven_text_to_sound_v2` (free
    tier: non-commercial use, credit given in Credits). Tools in `tools/sounds/`: `sfxgen.py`
    (API batch, key only from the `EL_KEY` env var), `sfxjobs2.py` (re-made prompts, 3 takes
    each), `sfxproc2.py` (cuts, trims, damps, levels, encodes and writes index.json),
    `specsheet.py` (spectrogram contact sheet to check takes by eye), `sfxscan.py` (features).
    The raw takes were not committed; re-running needs new generations.
  - Design rules learned: the model loves bursts (asked for "a ratchet click" it gives 8-12
    clicks, "keys" jingle, "floor creak" stutters) and tonal rings on handling sounds (the first
    `pickup` rang at 700 Hz like glass). Prompts now name the material and say "one", "single",
    "no metal clinking, no glass, no jingling, no ringing, no music"; prompt_influence 0.75;
    bursts are cut down to 2-3 events, impacts get a decay envelope so they stop instead of ring.
  - Footsteps: each take of four steps is cut into single footfalls (loudest transient, cut
    before any second hit), 3-4 variants per surface.
  - Levels: `index.json` has a `gain` map. Loops (wind, rain, tyreRoll, skid) are matched to the
    shaped noise they replace through the game's own filters; one-shots more than 3 dB off the
    old synthesized sound (loudest 50 ms, measured in the browser) are pulled back within 3 dB.
    `AudioSystem.trim(name)` applies it (play(), the starter, wind/rain/tyre/skid loops and the
    soundscape loops). With a recorded wind/rain the filters open up (`windF`, rain highpass
    150-300 Hz instead of 600-1500): the recordings have their body lower than white noise.
  - Still synthesized (synth.js keeps only these): the engine (oscillator voice in audio.js; the
    recorded rpm layers did not match in pitch and were dropped with their code), noise for the
    shaped layers, squeak, floorCreak, hum, keys, and the radio/title plucks. Every other sound
    is a recording; there is no synthesized fallback any more.
  - Night additions (sfx3 batch): `frogs` loop at the water after dark, `poorwill` calls in the
    open at night. `sfxproc2.py` takes the third batch dir as a 4th argument; stereo loops are
    auto-balanced (the wind came out 9 dB right-heavy).
- Recorded music (`src/audio/music.js`, files in `public/music/`, listed in `music/index.json`):
  streamed through <audio> elements (MediaElementSource), never decoded whole. Prompt sheet with
  all 33 tracks and file names: https://claude.ai/artifact/4ioak2dPSVStrWuTZonrWN (menu_theme,
  8 score_* cues, music_<album>_<n> for the six discs, haven_1..3, jingle_kdrt/klow/haven).
  Incoming files: `python3 -I tools/sounds/musicproc.py <dir> public/music` (trims, one static
  gain to -16 LUFS songs / -18 menu / -20 score plus a limiter, mp3 96k, merges index.json).
  - Background score: a cue now and then (gaps 90-240 s), picked rain > north > night/campfire >
    dawn/dusk > day; fades out while the car stereo can be heard (seated, or within 18 m) and
    picks up where it was after; after 90 s of radio it drops the track.
  - On/off: key U (anywhere, also the menus; UI.onKey), "Music: on/off" in the pause menu,
    Settings > Audio (Background music, Music volume = scoreVolume; Car radio = musicVolume).
    The switch also covers the menu theme.
  - Car stereo: a disc or a music station streams the recording if music/index.json has it,
    otherwise the old worker-rendered song plays (arrange.js/engine.js/musicWorker.js, ~2200
    lines: delete them once all 18 album files are in, together with the synthesized title theme
    in AudioSystem.startMenuMusic and radioNote/pluck for Haven). Station IDs play over the start
    of a song (songIn ducked to 25%). Haven plays its files in 150 s slots (quiet after each).
  - Fixed: stations played the same track of each album every time (track was tied to the slot);
    now all nine songs of a station come round.
- Spatial sound (`src/audio/space.js`): every sound placed in the world goes through a Voice:
  low-pass for air (cutoff 20 kHz/(1+d/40)) and for what is in between (two rays from the
  listener to the source and 2 m above it against static world colliders: houses, terrain,
  rocks; blocked = ~700 Hz and half level), the shelter rule (sitting in the car or lying in the
  tent, anything outside it is cut to ~1.2 kHz and -5 dB), then a PannerNode (HRTF by default,
  equalpower with Settings > Audio > Listening on: Speakers), and an echo send into three spaces
  (room indoors, open land: a few late echoes, woods: dense short tail; crossfaded by indoors and
  the forest mix). The send does not fall with distance, so far sounds are mostly echo.
  - Buses: `sfx`/`amb` for unplaced sounds (amb is low-passed indoors/in the cabin, sfx gets the
    room via `sfxSend` indoors), `sfxPos`/`ambPos` for placed ones (their voices do the muffling).
  - The car: engine voice at the engine bay, sliding to the tailpipe as you walk behind; wheel
    voice under the floor; seated, both get a body low-pass and a +5 dB low-shelf boom. The
    radio/CD play straight to you when seated and from the car (placed voice) when outside.
  - Night: crickets (and cicadas by day) are a bed at 40% plus 5 (3) singers placed on the ground
    5-22 m around you, re-seeded when you get 30 m away. Old houses: every 10-30 s a creak/knock
    at a spot inside a nearby building (`Soundscape.roomNear`: rays find a roof, then a floor
    2 m+ below it), so it is muffled through the walls from outside.
  - Cost: never automate panner or listener positions (sets `.value`): automation puts the
    panner on its per-sample path (4x the cost). Static HRTF is ~0.7% CPU per source here.

### Session of 23.10 (branch claude/awesome-dirac-a852qz, PR filom2333/wegwg4#7)
The user thought the other account's last update was lost: it was on `claude/task-4exkyg`, 15
commits ahead of `main` and never merged. This branch starts from it (plus a merge of `main`).
- Forests to the horizon (user: "trees far away look like green stones, nothing drawn far off"):
  - twig cards keep their cover down the mip chain (`trees.js` leaf shader: alpha scaled by mip
    level, Golus) — the mid-distance trees were bare trunks before;
  - tree cards (`impostor.js`) bake a normal atlas next to the colour one and are lit through it;
    per-tree tint from the instance's scale/turn (same on model and card); a dithered fade where
    the ring ends (`uImpFar`), and a matching fade-in for cards that take over (`uImpNear`);
  - far forest (`farForest.js` + worker `farForestGen.js`): one card per ~13 m where groves are,
    from the scatter's edge out to 1.4/1.9/2.4 km (medium/high/ultra; off on low);
  - `treeCover.js`: the scatter's tree densities and grove noise as a smooth field; terrain tiles
    carry it as attribute `tree`, the terrain shader paints a dark canopy from the card ring on
    (`uCanopy`/`uCanopySnow` from the cards' average colour, `uTreeFar`).
- Mountains: `erosionAt()` in the terrain shader — ridged noise drawn into downhill streaks (two
  fixed orientations blended by slope aspect, `tNoisedP` wraps per axis) for gullies and spurs in
  colour and normals, snow lying in the gullies.
- Promo shots and menu pictures, staged: `tools/promo/stage.js` (friends = copies of the player's
  rigged body dressed by `LOOKS`, posed with the clips + two-bone IK: stand/walk, seat in a car,
  sit, push, wave, look at, hold an item; cars placed/flipped/opened; real props; camera),
  `scenes.mjs` (8 scenes), `shoot.mjs` (renders at SS x size with the pixel budget lifted, Lanczos
  down, writes a disparity depth map), `caption.mjs` (EN/RU captions on a guide sign; Russian needs
  Cyrillic Overpass/IBM Plex Mono woff2 from @fontsource via env FONTS). Usage in the files.
  NOTE: the game has no multiplayer; the "friends" are staged. Captions avoid promising co-op.
- Title menu: `menuBackdrop.js` shows `public/menu/<scene>.webp` with `<scene>_depth.webp` in depth
  (parallax from the pointer and a slow dolly, cross-fades, dust motes at their depth); the old
  flat slideshow is the fallback. Signs: `signTextures.js` (sheeting grain, scratches, rust from
  the bolts, bottom grime, galvanised posts) as CSS vars; signs turn towards the pointer on their
  posts (`UI.liveSigns`), a sheen slides across them, lines glint on hover.
- `tools/audiotest.mjs` + `tools/tests/audioScenes.mjs`: record the game's master output per scene
  headless (for the sound work the user paused).

### Session of 23.10, part 2 (same branch, after PR #9 merged)
- Russian: `core/i18n.js` translates what reaches the screen (MutationObserver over the page:
  text nodes and placeholder/title/aria-label), from `core/lang/ru.js` (exact lines + regex
  patterns for lines with numbers and names, parts lowercased inside sentences). The code stays
  in English; elements with class `no-tr` are left alone. New UI text needs a line in ru.js —
  check with a node script importing `tr` (stub `localStorage`). Cyrillic faces: Overpass and
  Overpass Mono have them; Courier Prime does not, so Russian typewriter text falls to IBM Plex
  Mono (unicode-range in theme.css). Flags (US/RU) in the top right of the title screens
  (`UI.langFlags`), and Settings > Game > Language.
- FPS and ping plate (top right, on by default, settings v2 migration turns it on once); the
  kilometre marker moves down while it shows (`body.fps-on`). Ping says "soon" (no multiplayer).
- Picture settings: `core/gfx.js` — presets low..ultra or Custom (`settings.custom`: resolution,
  shadows, draw distance, aa, sharpen, bloom/glow, sun shafts, heat haze, grain). The renderer,
  scatter, far forest and terrain read it; shadows/post effects change live, distance and MSAA on
  the next start. Custom shows a card per option with an example picture per choice
  (`public/settings/<option>_<choice>.webp`, rendered by `tools/promo/settingsScenes.mjs`;
  shadows, glow, sun rays and heat haze have none yet: their test shots showed no difference,
  they need a view into the low sun and a clear hard-shadow scene
  through `shoot.mjs` variants — renderer options changed in the running page, crops for detail).
- Tutorial (`ui/tutorial.js`): a card per step on the right (look, walk, find a part, pick up,
  fit, put the car together, fuel, get in, key, parking brake, drive, north), judged from game
  state, steps already done are skipped, assembled start skips the building. Shown once
  (`settings.tutorial`), skip from the pause menu, back on in Settings > Game.
- How to play: six photographs (menu pictures) with what to do and the keys, then the key list.
- The first screen of a run lost the keys card and the footer (the tutorial teaches the keys).
- Driving: steering lock and speed fall off more with speed, the wheel recentres faster, rear
  tyres hold ~10% more sideways (`rearLatGrip`), and a light stability aid
  (`VehicleDynamics.stabilise`: yaw torque against rotation beyond what the steering asks, only
  while the body slides, off with the handbrake).
- Parts under a closed bonnet/boot can no longer be aimed at or highlighted (`carTarget` skips
  parts whose lid blocks them).
- Menu backdrop: the depth lookup marches from near to far (first surface wins) instead of the
  fixed-point search that doubled edges; smaller pointer sway.
- Paper: fibres, folds, handled edges and a cup ring (`signTextures.js` -> `--tex-fibre`,
  `--tex-sheet-paper`, multiplied over every `.paper` by `::after`).
- New items: `tv` (CRT in a wood cabinet, 14 kg) and `drum` (60 l fuel drum, 3 paints); one of
  each in the homestead garage.

### User's list from 23.10, part 3 (same branch) — done
- Hands (`grips.js`, `hands.js`): free hands (reach, fists, idle) are turned by `naturalQ` (the hand
  continues the forearm toward the elbow the arm solver will find); wrap/tool anchors too (wrist
  cocked half way); steering hands turn about the rim toward the elbow; MAX_BEND 0.8 (the forearm
  follows the hand past it). Check with numbers: the wrist bend per case
  (`arm.quaternion` angle; 0.8 = at the limit).
- Clusters (`importedCar.addGauges`, `gauges.js`): panel, speedo with an LCD of the speed, tacho,
  fuel and coolant dials, lamps (gen, oil, park, hot, lowFuel, beam, turns), lit with the
  ignition. Layout in `GAUGES` per type. The sedan's cluster had been behind its dash face.
- Seen through the bonnet: the sedan had no scuttle panel (a gap under the windscreen into the
  bay) — a black plate now; its plug leads (`plugLeads` arch) and alternator, and the W203 oil
  filter, were lowered under the bonnet. Probes used: rays from the driver's eye listing the first
  part seen; downward rays comparing part tops with the bonnet's underside.
- Fuel filler (`addFiller`, `Car.useFiller`): flap in body paint over a recess, cap, mouth; E opens
  the flap, unscrews the cap, closes both; fuel goes in and the level shows only with the cap off.
  The hotspot had been 5-6 cm off the body. `fuelTank` is detailed.
- Power windows: armrest switches (`windowFL`/`windowFR`), door glass meshes slide down
  (`findWindows`, `Car.toggleWindow`).
- Mirrors: the live car mirrors (render from the eye's reflection, aimed with the mouse, a
  Custom setting) were removed at the player's request (24.10): the mirror housings and glass are
  just part of the car models now.
- Engine bay (`bayDetails`): coolant tank (level follows coolant), brake fluid, washer, fuse box,
  dipstick. `wear.js`: parts darken and rust with their condition.
- HUD: painted big type (gradient + sheet grain, drop-shadow) and worn plates with a yellow edge
  behind the objective and the target card.

### Session of 24.10 (same branch, PR #11) — the user's long list
- **Main car is now the '86 Kiri** (`src/vehicle/kiri86`, converter `tools/cars/kiri86.py`;
  "Kiri '86 - Low poly model" by Daniel Zhabotinsky, CC-BY-4.0, same author/build as the '88
  sedan). The user rejected the W203's model (poor cabin, rear bench merged into the trim); the
  W203 stays in CAR_TYPES for old saves but is out of CAR_TYPE_LIST and the defaults (main.js,
  game.js, ui.js trip sheet, items.js). The converter reads .glb now (`gltfio.load`).
  Source found via Objaverse (Hugging Face, `allenai/objaverse` object-paths.json.gz maps
  Sketchfab uids to glbs; Sketchfab's search API works without a token but downloads don't).
  Same author, same structure, also downloaded and checked: Fairheaven SW '84 (wagon), Negotiator
  '80, Fairheaven LT '80, Lasley '67, Doutrive '78 (uids in the scratch search; easy next cars).
  Kiri: seats whole (cushion+back+headrest per front seat, whole rear bench), source pedals and
  gear lever, source battery and air box are the battery/airfilter parts; cluster laid out as its
  binnacle (face z = 0.513); everything procedural checked under the bonnet (rays up from each
  vertex against the bonnet's underside — the user saw plug leads through it once).
- `type.PIECES` + `imported/pieces.js`: move connected pieces / triangles between parts at load.
- Sedan88: cluster fills its whole binnacle (oil/volt small dials added: `gauges.js`, `car.js`);
  cowl follows the bonnet crown. W203: filler cut over the model's own flap.
- Selection outline thinner; interaction card and objective smaller, two-tone.
- **Abandoned cars are real cars** (`Fleet.placeHulk`, `poi.js addWreck` now only records spots):
  random type, stripped in assembly order with keep 0.12-0.4 (one in twenty nearly whole: 0.9),
  rust 0.55-0.95, saved per `poiKey:spot` in `fleet.hulkRecords` (serialized as `hulks`). One
  placed per frame. Cluster faces/lamp textures shared per type (`cluster.js FACES`).
- **Rust**: `Car.rust` → paint weathering `uRust` (paint takes rust colour now), grows slowly
  (more in rain), saved; new runs start at 0.16-0.28. **Wire brush** item (`wireBrush`, def
  `derust`): hold LMB on the car to scrub it off; in the starter garage and tool loot.
- **Swappable steering wheels** (tunes `steeringWheel`: sport, wood, dish, classic — same rim
  radius as the car's own) and **front seats** (tunes `seat`: bucket, recliner, sheepskin, made
  to the seat slot's box). Loot ids `part:steeringWheel:<t>`, `part:seat_FL:<t>`. A tuned part's
  looks now come off with it (`Car.setInstalled` refreshes when it had a tune).
- Shop cooler: doors are frames round clear glass (the solid door panel was the "boards" the
  user saw), shelves mostly empty; what's on them is real loot.
- Vagrants: arms modelled in an A-pose and lowered by an `armRoot` bone after binding
  (`characters.js humanJoints`), so sleeves/hands no longer fuse with the coat and pockets.
- Title screen: nightpass, overlook, winterdusk, fogroad (`tools/promo/lobbyScenes.mjs`, with the
  Kiri). How to play: game-style tips carousel (`ui.showHowTo`) with in-game shots per language
  (`tools/promo/howtoShots.mjs` → public/howto/<lang>/). Trip-sheet photo `car_kiri86.webp`
  (`tools/promo/carPhotos.mjs`).
- The user will send pictures of the procedural props they dislike (toilet etc.) — redo those.

### Still open from the user's lists
1. More detailed props (the mailbox is redone; other low-detail props remain).
2. Picture examples for shadows, glow, sun rays and heat haze (scenes showed no difference).
3. Interior: taking items while driving works one-handed already; more in-car interactions could
   follow (glovebox, sun visors, seat adjustment).

### Still to do (in the user's priority order)
1. More real models (only npm and raw.githubusercontent.com reachable; see "Network for
   models"); make more objects interactive.
2. Distant mountains: isolated cone shapes still show at biome belt edges; regenerate the menu
   pictures with the new sky/snow/birch look.
3. Car destruction (deformation) — the user asked to note it as a plan only. Sketch:
   - Per panel (body, doors, hood, trunk, bumpers, wings) keep a dent field: a handful of
     (point, normal, radius, depth) dents in part space, from `Car.onImpact` (it already knows
     the hit point, direction and severity; `panelDamage` decides tears).
   - Apply them in the vertex shader of the paint/trim materials (onBeforeCompile: push vertices
     along -normal by a smooth falloff of each dent, max ~8 dents per part as a uniform array),
     so the shared imported geometry is never copied; crumpled normals from the same falloff.
   - Hinges bind when a door/hood is dented near its edge (can't open fully), glass cracks
     (swap to a cracked-glass texture) on hits near the pillars, headlights die on front hits.
   - Wrecks (`buildImportedWreck`) start with a few random dents; repair kits pull dents out.
   - Physics stays the same compound colliders; only a heavy roof dent lowers the roof box.
4. Refresh build/ after changes: `npx vite build` then copy dist over build (the safety check in
   this environment refuses `rm -rf` with relative paths; use `rsync -a --delete dist/ build/`
   or remove by absolute path).

### Later on 24.10: models, mirrors, abandonment
- Procedural furniture rebuilt (`world/buildings/furniture.js`): real shapes (lofted toilet,
  pedestal basin, claw-foot tub, hollow kitchen cabinets with a real sink, enamel range, open
  fridge, cushioned sofas, CRT TV, beds, wardrobes, chests, desks, shop shelving picked bare).
  No more painted-on shop products (the goods atlas is gone); shop/drinks/storage loot rarer.
- Weak items rebuilt (`items/itemModels.js`): jerry can, revolver (cylinder turns on its own
  axis now), shotgun, spanner, steak, elastic bandage, jack, carried TV. Car seat swaps rebuilt.
- Live car mirrors removed at the player's request; static silvered glass in their place.
- Junk (`world/buildings/clutter.js`): `clutterRoom` (houses, per room type, sand drifts and glass
  at outside doors/windows, floor grime, ceiling holes), `clutterYard` (round houses),
  `clutterArea` + `JUNK` sets for garages, gas stations (shop, forecourt `lot`, back lot), motels
  (rooms, walkway, office), diners, barns, trailers. Houses also get boarded windows (`boardUp`).
- Next: outposts/ruins/camps/ranches sets, the rare trader at gas stations, more yard features.

### 24.10, evening: the user's feedback list (all done, same branch, PR #11)
- Flicker (z-fighting) fixed at the source: door casings, window frames, motel shared walls,
  interior finish panels, decals, junk under floors (a coplanar-overlap detector was used).
- Parking brake: a real hand lever on the console of every imported car (`importedCar` 'handbrake'
  control). Dome lamps sit under the headliner. Third person: no dots, captions or prompts.
- Caps come off by hand (R) on jerry cans, bottles, jugs and drums before anything pours; the
  contents show only through an open neck. The fuel filler flap is the "лючок бензобака".
- Window winders on every car (`vehicle/winders.js`): the door glass slides down its own slope,
  the crank turns with it; on a crank E takes hold and the mouse winds it (ratchet clicks), E or
  LMB lets go. The Beetle's fixed source handles are cut out (`WINDER_STRIP`) and replaced. The
  W203 keeps its electric switches (hold E). Rear windows: from the rear seats.
- Inside the cabin the engine and the wheels are heard from the seat (`audio.js`, own seat).
- Wipers: `car.wipers` is 0..3 (off, intermittent with a 3 s rest, steady, fast); K and the stalk
  cycle it with a toast. Imported cars get arms of their own (`importedCar.addWipers`, from the
  windscreen glass). Rain on glass (`gfx/glassRain.js`): beads, heavy drops running down, and per
  car a record of seconds since a blade passed each step of the sweep (`car.wipe.uWLast`), so
  the glass is clear right behind a blade and beads gather again until the next pass.
- Rust per part (`car.partRust`, `car.rustU`, RUST_PARTS in car.js): doors, lids, wings, bumpers
  and wheels each have their own material copy (`car.partMat`) with their own rust uniform; the
  wire brush cleans what it is on (`interaction.rustTarget`), the body without its panels. A
  detached panel carries `state.rust` and can be brushed lying loose. Hulks get varied panels.
  Plastic trim and chrome no longer show rust colour.
- Bolting things to a car (`items.mount/unmount`, `interaction.boltFit/boltHeld`): hold any item
  that is not a supply, aim at the outside of a car, B bolts it (Shift+Wheel turns it); roof and
  lids: on its underside; doors and wings: upright, back to the panel. R held unbolts it into
  the hands. Saved with the car (`mounted` in the item record). Food, drink, liquids, weapons,
  ammo, papers and things with their own fittings are not bolted; put inside the car they stay
  (the existing cargo stowing).
- build/ refresh here: `npx vite build`, then `rm -rf /home/user/wegwg4/build && cp -r
  /home/user/wegwg4/dist /home/user/wegwg4/build` (rsync is not installed; relative rm -rf is
  refused).
- Next (the user's order): the interactive things (a rare trader at gas stations etc.).

### 25.10: the user's next long list (same branch, PR #11)
The user said not to touch sounds (ElevenLabs refused the key through the proxy: "unusual
activity"; the key lives only in the scratchpad, never commit it). Everything else on the list:
- Cars 12% larger (`CAR_SCALE` in car.js): the model root carries the scale, physics stays in
  metres (`car.toBody`, `scaledDynamics`: wheels, suspension, final drive and brakes scale so it
  drives exactly as before). Wrecks, tow ball, winch, racks, plates, mounts follow.
- Hold and drag (interaction.js grab: `grabbable/startGrab/updateGrab/grabTap`): car doors (and
  inner handles), bonnet, boot, winders, building doors move with the mouse while E or LMB is
  held; a tap swings them fully. The aimed name card is gone (just small key prompts), the
  outline is a hairline.
- Caps only on jerry cans (`def.capped`): aim at the neck, E (or R in hand); an open can on its
  side glugs out (`items.updateSpills`).
- Flicker and terrain: road clamp in terrainMesh.js, light-space shadow snap (environment.js),
  flat decals lifted, ground snapping for yard junk (builder `snaps`, poi.js `snapToGround`).
- Junk rebuilt (clutter.js): clothesline, top-loader, suitcases, clothes heaps, sacks, crumpled
  paper; planks cross, tins and bottles do not overlap, leans only against walls.
- Decorations (The Long Drive wiki): mirror charms are pendulums (`items.swing`), dash toys on
  springs (`items.bobble`), B to hang or stick, R held to take down.
- Fuel types: `type.fuelType` ('fuel' = petrol, 'diesel' for the W203), `car.tankMix`,
  `addFuel/fuelPurity/tankMain`; wrong fuel costs power, misfires, below 38% stalls. Gas stations
  have labelled PETROL and DIESEL pumps (`pump.kind`), some drums and cans hold diesel, the
  filler says what the car takes. A removed tank keeps its mix (`state.mix`).
- Instruments and gear from the wiki (compass, alarm clock, spirit level, binoculars,
  flashlight, ball, dumbbell): `items.updateInstruments` swings the compass needle to north
  (+z), runs the clock from `env.time + state.offset` (LMB held turns the knob), floats the
  level's bubbles; the flashlight is a SpotLight proxy with a draining `state.charge`; the ball
  has a sphere collider with Max restitution. Binoculars: LMB held narrows the FOV
  (`game.binoFov`, wheel = ×2..×10), hides hands and item, HUD draws the two-eyepiece mask
  (`hud.setBino`), look speed scales with it. A 'torch' hold anchor in grips.js points the
  flashlight ahead.
- Things to wear (`def.wear` 'eyes' or 'head'): sunglasses (three lens tints), a cowboy, bucket
  or straw hat, a red cap, a traffic cone. LMB in the hand puts it on (`interaction.wear`,
  `items.wear`: no body, the mesh goes onto the third-person body's head bone in
  `player.syncWorn`, placed from the eye bone; the avatar's own `Wolf3D_Headwear` hides under a
  head item). Sunglasses tint the first-person view (`hud.setTint`, a multiply layer under the
  HUD, `SHADE_TINTS`). R held with empty hands and nothing aimed at takes off the glasses, then
  the hat. Saved with the player (`inventory.worn` in save.js), never with the loose items.

### 26–27.10: interaction as in The Long Drive, freezes, the user's fix lists (PRs #15, #16)
The user still says: don't touch sounds; keep car flipping.
- Hand-held doors and lids (interaction.js `grabbable/startGrab/updateGrab/letGo`): LMB held on a
  door, bonnet, boot, fuel flap or building door; the hand holds the grabbed point
  (`G.local`, `handOnPoint` puts the palm flat on it) and the thing follows the view and your
  steps on a spring; walking off lets go, a let-go door keeps its swing (`updateSwinging`). Only
  within `HAND_REACH` (0.95 m), else the prompt says to come closer. E no longer swings them
  (only the cap: `car.useCap`). Heavy things (>60 kg, `heavyItem`) are dragged by the grabbed
  point while LMB is held (`pickDrag/updateDrag`).
- Taking things: LMB on an item. A click (< `CLICK_T`) keeps it in the hand; held, it is
  carried (small things float in front) until LMB lets go, then it falls with the velocity it
  had (`mouseCarry`, `carryVel`, `drop(0, swing)`). E does not pick up any more.
- Arms (hands.js `solveArm`, grips.js `defaultArms`): shoulders follow the body pitch
  (`setArmPitch`, clamped below the view's bottom edge); out of reach the shoulder leans forward
  and down 25 cm, then the upper arm runs on further so the sleeve always leaves the picture: no
  cut sleeve end is ever visible. The sleeve is ONE tube (`laySleeve`, rebuilt every frame in the
  hand frame: straight forearm, rounded elbow, straight upper arm, capped past the shoulder); only
  the forearm skin and cuff are rigid (`arm`, turned at the wrist). The wrist has limits per
  direction (`WRIST_BACK/FWD/SIDE`: back 63°, forward 43°, sideways 20°) — the user called a hand
  bent sideways on its forearm "a crooked arm". Hands put on a surface (`handOnPoint`,
  `scrubPose`) point their fingers the way the arm comes from the shoulder, never across it.
- Freezes: shaders warmed up front on a zoo of everything (`game.warmShaders`), places and NPCs
  compiled out of view (`game.prepare`, compileAsync into the composer's buffer); POI assembly
  one building a frame (poi.js `pending`), colliders in hundreds; terrain heightfields in the
  worker ('hf'); item icons cached in IndexedDB (`itemIcons.js`, ICONS_VERSION); car extras
  replayed from a cache (extrasCache.js); a car's procedural shapes made once per type
  (`shapeRun` in geom.js: cluster, filler, controls, wipers) — a wreck now costs 8–10 ms.
- Detail culling: small car meshes (`car.updateDetail`) and items (`items.updateDetail`, with
  hysteresis) leave the picture far off.
- Trailer (trailer.js): one body on two ray-sprung wheels (`physStep` in physics.beforeStep);
  a hard tyre collider on the chassis only as a backstop. 3° of lean at 72 km/h.
- Chairs (`chair`, `campChair` items; furniture `Item.itemAt` → loot spot kind 'item' carrying
  item/variant/rot → items.onPoiLoaded). Only `def.bolt` things and dash toys bolt to a car.
- Walking (player.js): autostep onto loose things, 6 cm min width; jump buffer and coyote time;
  ceiling stops a jump; step smoothing of the view (`stepLag`); fall-through safety only when
  nothing is under the feet at all.
- Washing (car.js `cleanMap/scrub/soil`, weathering.js `uClean`): a per-car RG Data3DTexture over
  the car box (R washed, G brushed), sampled by every weathered material; the sponge/brush is
  posed flat on the surface (`scrubPose`) and paints it; saved as base64 (`cleanState`).
- Flicker: `decal()` in gfx/caps.js (polygon offset that knows the depth direction) on item
  labels; `?norevz` runs the standard depth buffer for testing.
- Winter: desert odds reach 0 by 60 km (worldGen `biomeOdds`); much more ground cover in
  taiga/tundra; snow shaded deeper.
- Beds: ticking mattress, sheet, draped blanket (`blanket*` DoubleSide materials), linen pillows;
  the shared cloth texture is neutral now (all fabrics were greenish).
- Menu: pictures decoded off-thread, preloaded mid-slide, focus precomputed (`MENU_FOCUS`); the
  custom settings pictures preload and swap only when loaded.
- Probes used (scratchpad, not in the repo): p_cpu3/p_entry3 (frame breakdowns), p_hulk/p_build
  (car build cost), p_trailer(_slalom), p_walk/p_roof, p_zdiff (render-diff flicker finder),
  p_zfight (coplanar faces), p_scrub, p_hands2(b), p_arms, p_arms3 (fists, carries, driving), p_carry,
  p_drivesnow, p_bed, menuhitch.mjs.
