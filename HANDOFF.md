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

## 5. NEXT STEPS (in this order)

1. Serve the build, then render the dev query at z=1200 (scrub), 3800/4300 (dunes),
   6500 (badlands), 11500 (highland), 16500 (forest), 40000 (saltflat) and 63500 (taiga), at
   time 16.5 and 18.3. Take road-level views and one high view. Compare with the user's
   complaints.
2. Check the new rock texture (above). Make sure no tiling grid or dots are visible on far mountains.
   If needed, add a very-far texture scale or fade to the lowest mip beyond about 400 m.
3. Mountains:
   - real-looking ridges, gullies and scree (dirt/gravel at slope bases);
   - textured;
   - **not too close everywhere**: some regions are open plains to the horizon, others bring rock
     outcrops and cliffs closer;
   - higher ground can begin as a gradual change of country ("there it's a different land, the
     cliffs start higher up");
   - silhouettes are coarse on the 64 m-spaced far tiles; consider N=48 for ≥1024 m tiles if FPS
     allows.
4. Plains and dunes: verify that they feel calm and beautiful; the distance needs something to
   look at (mountains, mesas).
5. **Vegetation: more of it and more variety** (the user stressed this). Ideas:
   - raise `SPECIES.dens` (desert shrubs, grass, cacti, Joshua trees; forest density);
   - more species variants (sagebrush, yucca, ocotillo, tumbleweed, aspen groves, autumn colours);
   - far vegetation: extend the impostor radius beyond 880 m, and add a dark forest canopy tint on
     terrain in forest areas so distant hills are not bare.
   - Keep FPS.
6. Streaming and pop-in: make sure terrain, scatter and POIs near the player are always ready (no
   holes or late pop-in while driving at 100+ km/h). Check `terrain.isReadyNear` and the scatter
   ring sizes.
7. Commit the landscape once it looks good, then push.
8. Remaining items from the user's list for THIS update:
   - **Menu with beautiful pre-rendered pictures** instead of the live scene:
     - render 6+ shots at 1920×1080 with high quality and the HUD hidden (`game.hud.show(false)`);
       ideas: golden-hour road with the Beetle and a roof rack, gas station at dusk with lights,
       a mountain vista, a forest road in the morning, the snowy taiga with the sedan, a night
       road with headlights;
     - save them as WebP in `public/menu/`;
     - show them with a CSS Ken-Burns pan/zoom and a crossfade every ~9 s;
     - then stop initialising the world on the title screen (faster menu). Create audio with
       `new AudioSystem({})` for the menu music, and guard `ui.applySettings` against a missing
       `game.renderer`.
   - **Prettier menu and UI hotfixes**:
     - Credits must also credit the sedan model ("88 American Sedan – Low poly model" by Daniel
       Zhabotinsky, CC-BY-4.0) and the tree textures (`public/textures/trees/LICENSE.txt`).
     - Update the news text on the title screen.
   - **Graphics**: finish 4a (sharpness and effects). The user said sharpness and graphics are poor
     and wants more special effects. Ideas: heat haze over the asphalt at midday, dust motes in
     sunbeams, rain drops on the windscreen, tyre smoke.
   - **Hands and held items look strange**:
     - fix how hands hold items (grips in `src/player/grips.js`, holdPose);
     - big items (> 0.55 m) float in front of the camera with no hands, so add two-hand carry poses;
     - fit the hands on the wheel per car (`type.DRIVER`).
   - Sedan polish: a driving test, its sound in game, hands.
   - Clean up dead code and raise FPS.
   - Fix the garage roof underside, which shows a shingle texture.
9. Old pending items: character look and animations; sound design overhaul.

## 6. Answers already given to the user

- Music CDs exist: 6 albums. One is in the glovebox; the others are loot (tables, shops, wrecks).
  Insert one by looking at the stereo and pressing LMB; R ejects it.
- The previous session used GitHub code search across public repositories to find car models (the
  sedan came that way).

## 7. Ideas the session proposed to the user for later (only when the user asks)

- Trailer and tow hitch.
- Siphoning fuel from abandoned cars.
- Car jack and winch to pull out stuck cars.
- Sandstorms and fog events.
- Tuning parts (carburettor, exhaust, off-road tyres).
- Sleeping in the car or a tent.
- A road atlas with notes.
- Photo mode.
- Also later: more buildings (towers, 2–3 storey houses), new game features, a new third retro car.

## 8. Gotchas learned the hard way

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
