# Dust Road

A first-person survival driving game in the spirit of *The Long Drive*: an endless desert road
running north, a car you keep alive part by part, and not much else. Built from scratch with
three.js and Rapier. Every model (car, buildings, furniture, items, hands, characters) is
generated in code. There are no external assets.

## Run

```bash
npm install
npm run dev        # http://localhost:5173  (game)  ·  /inspect.html  (inspection stand)
npm run build      # production build in dist/
```

You need a desktop browser with WebGL2. Click the canvas to capture the mouse; Esc releases it and pauses.

## Controls (rebindable in Settings → Controls)

| Key | Action |
| --- | --- |
| W A S D | Walk / drive |
| Shift, Ctrl, Space | Sprint, crouch, jump (handbrake in the car) |
| E | Interact: pick up, open/close, get in/out, install a held part, search a body |
| R (hold) | Unbolt the car part you are looking at · reload a weapon |
| G (hold to throw) | Drop the held item |
| RMB | Rotate held item · aim a weapon |
| LMB | Use / pour / eat / drink / fire |
| Q, 1–6 | Pocket the held item, take an item out of a pocket |
| F | Flashlight · quick-use |
| I (hold) | Ignition, hold to crank |
| L, H, K | Headlights (off / low / high), horn, wipers |
| X / Z | Gear up / down (manual gearbox) |
| C | Look back |
| V | First / third person |
| B | Sleep (seated in the car, engine off) |
| J | Journal (stats and notes) |

## What is in it

- **Car**: a 1960s Volkswagen Beetle (1600 flat-four at the back, four-speed transaxle, rear
  drive, torsion bar suspension). The model is split into 31 removable parts: body shell, two
  doors, front and engine lids, four bolt-on fenders, bumpers, headlights and tail lights, seats,
  steering wheel, engine, air cleaner, fan belt, muffler, battery, fuel tank, spare wheel and the
  wheels, down to the platform chassis. Parts depend on each other (no headlight before its
  fender, no air cleaner before the engine) and open lids are needed to reach what is under them.
  Pedals, gear lever, handbrake and wipers move; the speedometer (with fuel gauge) and the
  generator and oil lamps work. Fuel, oil, battery charge, fan belt wear, oil temperature, engine
  condition and tyre wear are simulated; the engine is air cooled, so a snapped fan belt cooks it.
- **Driving**: raycast suspension with springs, dampers, anti-roll and bump stops; a combined-slip
  tyre model with surface grip (asphalt, gravel, dirt, sand, salt) and rain; ABS, traction control,
  automatic or manual gearbox. Rollovers need a real cause (kerbs, slopes, excessive speed).
- **World**: an endless road through scrubland, dunes, badlands, salt flats and high desert with
  gradual transitions; streamed terrain with LOD in a worker; instanced flora and rocks; points of
  interest every ~600 m (homestead, gas stations with working pumps, motels, diners, houses,
  ranches, junkyards, trailer parks, outposts, ruins, camps, towers, wrecks) with furnished
  interiors and loot.
- **People and animals**: vagrants (neutral or hostile), a night creature that stalks and fears
  light, coyote packs, jackrabbits. Procedural animation, per-bone hitboxes, headshots, looting.
- **Survival**: health, food, water, rest, bleeding; jerry cans and bottles with real volumes;
  food with nutrition; day/night; weather (clear, haze, cloud, rain, storm, sandstorm) that changes
  grip and visibility.
- **Effects and sound**: wheel dust, exhaust, engine smoke and fire, backfires, debris, muzzle
  flashes, tracers, casings, blood, rain splashes, lightning, dust devils, tumbleweeds, vultures,
  meteors, moths at lamps. Sound and music are recordings (`public/sounds/`, `public/music/`)
  placed in 3D with WebAudio: distance, walls and hills between, the cabin, echoes (`src/audio/space.js`).
- **Story**: twelve notes left along Route 9 tell what happened and where everyone went; Haven
  broadcasts on the car radio (98.1); distance signs every 5 km; reaching Haven (150 km) ends the
  run, or you keep driving.
- **Routine**: wash the dust off the car with a sponge, repaint it with spray cans, smoke, drink
  canned coffee to stay awake, sleep in the car.
- **Views**: first person with hands on the wheel (they turn with it and reach for the key, light
  stalk and gear lever); a third-person view with the player's body for later co-op.
- **Menus**: press-any-key splash and a title scene with the car driving at dusk under cinematic
  camera cuts and a procedural theme, new game (difficulty, ready-to-drive or build-it-first,
  seed), settings, statistics, pause, journal, death screen, save/load with autosave. The
  Multiplayer button is a placeholder only: there is no networking.

## Credits

The car is based on ["Beetle/Fusca (Version 1)"](https://sketchfab.com/3d-models/beetlefusca-version-1-cb6e82e73386448fb3b4e2dd25255a5e)
by [soujagah](https://sketchfab.com/soujagah), licensed under
[CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/). It was converted with
`tools/beetle/import.py` (scaled to real size, split into parts, glass separated, paint masks
built for repainting, textures resized and recompressed).

Trees and shrubs use photographed bark from Poly Haven and TextureCan (CC0) and twig cards from
[ez-tree](https://github.com/dgreenheck/ez-tree) by Daniel Greenheck (MIT); see
`public/textures/trees/LICENSE.txt`. Grass and fern cards are painted by `tools/flora/*.py`.
Everything else is generated in code.

## Inspection stand

`/inspect.html` shows the car on a turntable: orbit, preset views, open/close every hinged part,
assembly stages, clay / wireframe / normals / hole views, section planes, open-edge and
self-intersection checks. `?subject=npc`, `?subject=house`, `?subject=items` and `?subject=hand`
show other generated models on the same stand.

## Layout

```
src/vehicle    car body generator, parts, materials, systems (car.js)
src/physics    Rapier wrapper, vehicle dynamics
src/world      world generator, terrain streaming, scatter, POIs, buildings
src/npc        SDF character modelling, polygoniser worker, NPC AI and animation
src/items      item models, definitions, physics items and loot
src/player     controller, first-person hands, interaction
src/gfx        renderer, sky, terrain material, effects
src/audio      procedural synthesis and mixing
src/ui         HUD, menus
src/core       input, settings, noise, save games
tools/         headless screenshot and test drivers (Playwright)
```

## Known limitations

- No multiplayer (button only, by design for this version).
- Only one car model. Characters are modelled from signed-distance primitives, so they read well
  at gameplay distance but are not film-quality up close.
- NPCs walk on the ground and steer around obstacles with ray probes; there is no navigation mesh,
  so they can get stuck in tight building interiors.
- Performance has been measured only in a software renderer during development (simulation costs
  about 3 ms per frame on the CPU). Use the Low or Medium quality preset on slower GPUs.
