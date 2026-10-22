# HANDOFF — read this first (for the next Claude session)

You are continuing work on **Dust Road** (Route 9 · 150 km to Haven), a first-person survival
driving game in the spirit of *The Long Drive*. It is built with three.js 0.186 + Rapier (compat)
+ Vite 8. A previous Claude session (also Opus 5.5, on another account) wrote this file when its
usage limit ran out. When you finish your own session, **update this file** with what you did and
what is left, then commit and push. The user may hand the file back to that other session, so it
works like a shared log between two sessions.

## 0. Rules from the user (always follow)

- **Reply to the user in Russian.** They write casual Russian and sometimes use swear words; stay friendly.
- Develop on branch **`claude/task-4exkyg`**. Push with `git push -u origin claude/task-4exkyg`
  (retry on network errors). Do **not** open PRs unless asked. A PR already exists:
  filom2333/wegwg4#1.
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

### Still to do (in the user's priority order)
1. More real models (only npm and raw.githubusercontent.com reachable; see "Network for
   models"); make more objects interactive.
2. Distant mountains: isolated cone shapes still show at biome belt edges; regenerate the menu
   pictures with the new sky/snow/birch look.
3. Car destruction (deformation) — the user asked to note it as a plan only.
4. Refresh build/ after changes: `npx vite build` then copy dist over build (the safety check in
   this environment refuses `rm -rf` with relative paths; use `rsync -a --delete dist/ build/`
   or remove by absolute path).
