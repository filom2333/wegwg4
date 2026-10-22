// Game: owns the renderer, physics, world streaming, environment, car, player and the
// systems that tie them together. The UI layer drives it (menu -> new game / load).

import * as THREE from 'three';
import { Renderer } from './gfx/renderer.js';
import { LightPool } from './gfx/lightPool.js';
import { updateFogSun } from './gfx/fogSun.js';
import { Environment } from './gfx/environment.js';
import { buildGroundTextures } from './gfx/groundTextures.js';
import { createTerrainMaterial, createRoadMaterial } from './gfx/terrainMaterial.js';
import { Physics, GROUPS } from './physics/physics.js';
import { WorldGen } from './world/worldGen.js';
import { Terrain } from './world/terrain.js';
import { Scatter } from './world/scatter.js';
import { loadTreeTextures } from './world/trees.js';
import { POIManager } from './world/poi.js';
import { archMaterials } from './world/buildings/materials.js';
import { Fleet } from './vehicle/fleet.js';
import { CAR_TYPE_LIST, carType } from './vehicle/types.js';
import { Campfires } from './world/campfires.js';
import { Trailers } from './vehicle/trailer.js';
import { Jacks } from './vehicle/jack.js';
import { Tents } from './world/tents.js';
import { PropLibrary } from './world/props.js';
import { registerRealModel } from './items/itemModels.js';
import { Atlas } from './story/atlas.js';
import { PhotoMode, loadPhotos } from './ui/photoMode.js';
import { Winches } from './vehicle/winch.js';
import { Player } from './player/player.js';
import { input } from './core/input.js';
import { ItemSystem } from './items/items.js';
import { Inventory } from './items/inventory.js';
import { ITEMS, initialState } from './items/itemDefs.js';
import { Interaction } from './player/interaction.js';
import { HUD } from './ui/hud.js';
import { AudioSystem } from './audio/audio.js';
import { Effects } from './gfx/effects.js';
import { NPCManager } from './npc/npcs.js';
import { Story } from './story/story.js';
import { RoadSigns } from './story/roadSigns.js';
import { Lures } from './story/lures.js';
import { Obstacles } from './world/obstacles.js';
import { WorldPlates } from './world/worldPlates.js';
import { Water } from './world/water.js';
import { Bridges } from './world/bridges.js';
import { settings } from './core/settings.js';
import { clamp, mulberry32 } from './core/noise.js';
import { applyWorldState, applySave } from './core/save.js';

export const DIFFICULTY = {
  easy: { label: 'Easy', hunger: 0.85, thirst: 0.85, fatigue: 0.8, cold: 0.8, consumption: 0.9, wear: 0.8, damage: 0.85, playerDamage: 0.8, enemies: 0.8, loot: 1.1 },
  normal: { label: 'Normal', hunger: 1.25, thirst: 1.3, fatigue: 1.15, cold: 1.2, consumption: 1.15, wear: 1.3, damage: 1.2, playerDamage: 1.2, enemies: 1.25, loot: 0.8 },
  hard: { label: 'Hard', hunger: 1.6, thirst: 1.75, fatigue: 1.4, cold: 1.5, consumption: 1.4, wear: 1.9, damage: 1.6, playerDamage: 1.5, enemies: 1.8, loot: 0.55 },
};

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas, settings.data.quality);
    this.scene = new THREE.Scene();
    this.worldGroup = new THREE.Group();
    this.worldGroup.name = 'world';
    this.scene.add(this.worldGroup);
    // a fixed handful of real lights for all the small lamps in the world
    this.lights = new LightPool(this.scene);
    this.renderer.setupComposer(this.scene);
    // first-person eye (aim, reach, viewmodel); the rendered camera follows it or orbits in 3rd person
    this.eyeCam = new THREE.PerspectiveCamera(75, 1, 0.05, 7000);
    this.origin = { x: 0, z: 0 };
    this.clock = new THREE.Clock();
    this.running = false;
    this.paused = false;
    this.time = 0;
    this.gameHoursDelta = 0;
    this.difficulty = DIFFICULTY.normal;
    this.stats = {
      distance: 0,
      timeAlive: 0,
      fuelUsed: 0,
      itemsLooted: 0,
      kills: 0,
      headshots: 0,
      shotsFired: 0,
      meals: 0,
      drinks: 0,
      partsInstalled: 0,
      placesVisited: 0,
      maxSpeed: 0,
      crashes: 0,
      daysSurvived: 1,
    };
    this.systems = [new Water(), new Bridges()];
    this.campfires = null;
    window.addEventListener('resize', () => this.renderer.resize());
    input.attach(canvas);
    this.__input = input;
  }

  // ------------------------------------------------------------------ setup
  async init({ seed = 1234, difficulty = 'normal', start = 'assembled', time = 8.5, weather = 'clear', startZ = 0, load = null, attract = false, car: carChoice = 'w203', trailer = false, onProgress = () => {} } = {}) {
    if (load) {
      seed = load.seed;
      difficulty = load.difficulty;
      start = load.startMode;
      time = load.env.time;
      weather = load.env.weather;
      carChoice = load.startCar || 'beetle';
    }
    // the car the run starts with; the other types turn up along the road
    this.startCarType = carType(carChoice).id;
    this.settingsTransmission = settings.data.transmission;
    this.load = load;
    this.attract = attract;
    this.startZ = startZ;
    this.seed = seed;
    this.difficultyName = difficulty;
    this.difficulty = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.startMode = start;
    onProgress('Starting physics', 0.05);
    this.physics = await Physics.create();
    this.gen = new WorldGen(seed);
    onProgress('Painting the desert', 0.12);
    await tick();
    this.groundTex = buildGroundTextures(seed);
    this.terrainMat = createTerrainMaterial(this.groundTex);
    this.roadMat = createRoadMaterial(this.groundTex);
    onProgress('Raising the land', 0.25);
    this.env = new Environment(this.renderer.renderer, this.scene, {
      time,
      weather,
      seed,
      shadowSize: this.renderer.q.shadow,
      shadowExtent: this.renderer.q.shadowExtent,
    });
    this.env.onLightning = (r) => this.effects && this.effects.lightning(r);
    this.terrain = new Terrain({
      gen: this.gen,
      scene: this.worldGroup,
      physics: this.physics,
      terrainMaterial: this.terrainMat,
      roadMaterial: this.roadMat,
      origin: this.origin,
      quality: settings.data.quality,
    });
    const treeTex = loadTreeTextures(this.renderer.renderer);
    await this.terrain.workerReady;
    // real models: what the scatter and the items build from is loaded first, the common props
    // start loading now, the rest when a place first needs them
    this.props = new PropLibrary();
    await Promise.all(['rockMoss1', 'rockMoss2', 'rockMoss3', 'carp', 'bass', 'survivor', 'survivorAnim'].map((id) => this.props.load(id)));
    registerRealModel('carp', this.props.instance('carp'));
    registerRealModel('bass', this.props.instance('bass'));
    for (const id of ['oilDrum', 'trafficCone', 'lampPost', 'leatherSofa', 'pottedPlant', 'tyre']) this.props.load(id);
    this.scatter = new Scatter(this, this.groundTex, await treeTex);
    this.pois = new POIManager(this);
    this.story = new Story(this);
    if (load && load.story) this.story.restore(load.story);
    this.lures = new Lures(this);
    if (load && load.story && load.story.lures) this.lures.restore(load.story.lures);
    this.npcs = new NPCManager(this);
    if (!attract) this.npcs.startBuilding();
    this.items = new ItemSystem(this);
    if (load) applyWorldState(this, load);
    this.inventory = new Inventory();
    this.interaction = new Interaction(this);
    this.ui = this.ui || null;
    this.hud = new HUD(this);
    this.audio = this.audio || new AudioSystem(this);
    this.effects = new Effects(this);
    this.campfires = new Campfires(this);
    this.jacks = new Jacks(this);
    this.tents = new Tents(this);
    this.worldPlates = new WorldPlates(this);
    this.atlas = new Atlas(this);
    this.atlas.photos = loadPhotos();
    this.photo = new PhotoMode(this);
    this.winches = new Winches(this);
    onProgress('Building the cars', 0.35);
    await tick();
    this.fleet = new Fleet(this);
    const saved = load ? [load.startCar || 'beetle', ...((load.fleet && load.fleet.cars) || []).map((c) => c.type)] : [];
    await this.fleet.preload(this.renderer.renderer, saved);
    this.pois.setWreckPrototypes(CAR_TYPE_LIST.map((t) => t.wreck(this.fleet.assets[t.id])));
    // spawn
    const spawn = this.spawnPoint();
    if (this.startZ || load) {
      this.origin.x = Math.round(spawn.x / 1024) * 1024;
      this.origin.z = Math.round(spawn.z / 1024) * 1024;
    }
    this.terrain.update(spawn.x, spawn.z);
    this.terrain.ensureCollidersAround(spawn.x, spawn.z, 100);
    this.scatter.update(spawn.x, spawn.z);
    onProgress('Streaming terrain', 0.55);
    await this.waitForTerrain(spawn.x, spawn.z);
    // places right around the spawn must exist before the car and player are dropped in
    if (load) for (let i = 0; i < 4; i++) this.pois.update(spawn.x, spawn.z);
    if (load && load.fleet) this.fleet.restore(load.fleet);
    else {
      // the starting car (saves from before the fleet had a single "car" record)
      const carPos = new THREE.Vector3(spawn.carX, (spawn.carY ?? this.gen.height(spawn.carX, spawn.carZ)) + 0.05, spawn.carZ);
      const car = this.fleet.create(load && load.car ? load.car.model || 'beetle' : this.startCarType, new THREE.Vector3(carPos.x - this.origin.x, carPos.y, carPos.z - this.origin.z), spawn.carQuat ? new THREE.Quaternion(...spawn.carQuat) : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawn.carYaw), {
        owned: true,
        // a different colour each world
        color: (() => {
          const cs = carType(this.startCarType).colors || [];
          return cs.length ? cs[Math.floor(mulberry32((this.seed | 0) * 13 + 5)() * cs.length)] : carType(this.startCarType).defaultColor;
        })(),
        state: load ? load.car : null,
      });
      this.fleet.setCurrent(car);
    }
    // a trailer stands beside the homestead garage; restored ones come back where they were left
    this.trailers = new Trailers(this);
    if (load && load.trailers) this.trailers.restore(load.trailers);
    else if (!this.startZ && !load) {
      const inst = this.pois.loaded.get(0);
      if (inst) {
        inst.root.updateMatrixWorld(true);
        const w = new THREE.Vector3(15.0, 0, 3.0).applyMatrix4(inst.root.matrixWorld);
        w.y = this.groundHeightAt(w.x, w.z) + 0.05;
        this.trailers.spawn(w, inst.poi.rot + Math.PI);
      }
    } else if (this.startZ && trailer) {
      // dev: hitched behind the car
      const c = this.car;
      c.root.updateMatrixWorld(true);
      const w = new THREE.Vector3(0, 0.1, c.type.SPEC.rearTip - 2.4).applyMatrix4(c.root.matrixWorld);
      const t = this.trailers.spawn(w, new THREE.Euler().setFromQuaternion(c.root.quaternion, 'YXZ').y);
      t.hitchTo(c);
    }
    // cars waiting at the places already streamed in
    for (const inst of this.pois.loaded.values()) this.fleet.onPoiLoaded(inst);
    const py = spawn.y !== undefined ? spawn.y : this.gen.height(spawn.x, spawn.z) + 0.3;
    this.player = new Player(this, new THREE.Vector3(spawn.x - this.origin.x, py, spawn.z - this.origin.z));
    this.player.yaw = spawn.yaw;
    if (load) applySave(this, load);
    else if (start === 'parts' && !this.startZ) this.setupUnassembled();
    else this.spawnStarterItems();
    this.lastFocus = this.focusPoint().clone();
    // world systems (water, bridges) exist before anything settles onto them
    for (const sys of this.systems) {
      if (sys.init) await sys.init(this);
      sys.update && sys.update(0);
    }
    this.systemsReady = true;
    // let the car settle on its springs and loose things come to rest before anyone looks
    onProgress('Settling', 0.95);
    this.fleet.wake();
    for (let i = 0; i < 150; i++) this.physics.update(1 / 60);
    this.fleet.syncVisual();
    this.trailers.update();
    this.items.update();
    this.hud.show(!attract);
    this.warmShaders();
    // one frame behind the loading screen compiles the passes, shadows and sky as well
    this.render(0.016);
    if (attract) {
      // title screen: the car drives itself north at dusk with its lights on
      this.interaction.viewRoot.visible = false;
      this.player.enterSeat(this.car, 'driver');
      this.car.setIgnition(true);
      this.car.dyn.startEngine();
      this.car.lightsOn = 1;
      this.car.dyn.automatic = true;
    }
    onProgress('Ready', 1);
    this.running = true;
  }

  // Compiles, behind the loading screen, the shaders of things the road shows later (every item,
  // every building material, the roadside wrecks) for both light states, so the first time each
  // comes into view does not stall the game.
  warmShaders() {
    const zoo = new THREE.Group();
    for (const id of Object.keys(ITEMS))
      try {
        zoo.add(this.items.buildMesh(id, initialState(id, Math.random)));
      } catch (e) {
        /* an item that needs more state to build; it compiles when first seen */
      }
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (const m of Object.values(archMaterials())) if (m && m.isMaterial) zoo.add(new THREE.Mesh(box, m));
    for (const w of this.pois.wreckProtos) zoo.add(w.group.clone());
    zoo.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    this.lights.warm(this.renderer.renderer, this.renderer.camera, this.renderer.composer.readBuffer, zoo);
    box.dispose();
  }

  spawnPoint() {
    if (this.load) {
      const d = this.load;
      const c = d.car || { pos: d.player.pos, quat: [0, 0, 0, 1] };
      return { x: d.player.pos[0], y: d.player.pos[1], z: d.player.pos[2], yaw: d.player.yaw, carX: c.pos[0], carY: c.pos[1] - 0.05, carZ: c.pos[2], carQuat: c.quat, carYaw: 0 };
    }
    if (this.startZ) {
      // never start on a bridge (the land under it is the river bed): step back along the road
      let z = 6 + this.startZ;
      for (let i = 0; i < 40 && this.gen.bridgeNear(z) && Math.abs(this.gen.roadSurfaceY(this.gen.roadX(z), z) - this.gen.height(this.gen.roadX(z), z)) > 0.3; i++) z -= 15;
      const rx = this.gen.roadX(z);
      return { x: rx + 6.5, z: z - 2, yaw: -Math.PI / 2 + 0.4, carX: rx + 2.0, carZ: z + 1, carY: this.gen.roadSurfaceY(rx + 2.0, z + 1), carYaw: 0 };
    }
    // homestead: car inside the garage, player at the garage door
    const inst = this.pois.ensureLoaded(0);
    const poi = inst.poi;
    const spot = inst.carSpot || new THREE.Vector3(8.5, 0, -1);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(poi.x, poi.y, poi.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), poi.rot), new THREE.Vector3(1, 1, 1));
    const car = spot.clone().applyMatrix4(m);
    const front = new THREE.Vector3(spot.x - 1.6, 0, spot.z + 5.2).applyMatrix4(m);
    // face the car in the garage
    const yaw = Math.atan2(car.x - front.x, car.z - front.z) + 0.12;
    return { x: front.x, z: front.z, yaw, carX: car.x, carZ: car.z, carYaw: poi.rot + Math.PI, carY: poi.y + 0.12 };
  }

  async waitForTerrain(x, z) {
    for (let i = 0; i < 600; i++) {
      this.terrain.update(x, z);
      if (this.terrain.isReadyNear(x, z, 400)) break;
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  // ------------------------------------------------------------------ queries
  groundHeightAt(x, z, fromY = 500) {
    const hit = this.physics.raycast({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }, fromY + 200, GROUPS.ground);
    if (hit) return hit.point.y;
    return this.gen.height(x + this.origin.x, z + this.origin.z);
  }

  surfaceUnder(p) {
    const hit = this.physics.raycast({ x: p.x, y: p.y + 0.5, z: p.z }, { x: 0, y: -1, z: 0 }, 2, GROUPS.ground);
    if (hit && hit.owner && hit.owner.surface) return hit.owner.surface;
    if (hit && hit.owner && hit.owner.kind === 'car') return 'metal';
    return this.gen.surfaceAt(p.x + this.origin.x, p.z + this.origin.z);
  }

  worldToGlobal(v) {
    return { x: v.x + this.origin.x, y: v.y, z: v.z + this.origin.z };
  }

  // ------------------------------------------------------------------ floating origin
  maybeRebase() {
    const p = this.focusPoint();
    const lim = 2048;
    if (Math.abs(p.x) < lim && Math.abs(p.z) < lim) return;
    const dx = Math.round(p.x / 1024) * 1024,
      dz = Math.round(p.z / 1024) * 1024;
    this.origin.x += dx;
    this.origin.z += dz;
    this.physics.world.forEachRigidBody((b) => {
      const t = b.translation();
      b.setTranslation({ x: t.x - dx, y: t.y, z: t.z - dz }, true);
      if (b.isKinematic()) b.setNextKinematicTranslation({ x: t.x - dx, y: t.y, z: t.z - dz });
    });
    this.physics.snapAll();
    this.terrain.rebase(dx, dz);
    this.scatter.rebase(dx, dz);
    this.pois.rebase(dx, dz);
    this.items.rebase(dx, dz);
    this.effects && this.effects.rebase(dx, dz);
    this.campfires && this.campfires.rebase(dx, dz);
    this.jacks.rebase(dx, dz);
    this.tents.rebase(dx, dz);
    const ly = this.player && this.player.lying;
    if (ly) for (const v of [ly.eye, ly.exit]) (v.x -= dx), (v.z -= dz);
    this.winches.rebase(dx, dz);
    this.npcs && this.npcs.rebase(dx, dz);
    this.roadSigns && this.roadSigns.rebase(dx, dz);
    this.lures && this.lures.rebase(dx, dz);
    this.obstacles && this.obstacles.rebase(dx, dz);
    this.worldPlates && this.worldPlates.rebase(dx, dz);
    this.fleet.rebase(dx, dz);
    for (const s of this.systems) s.rebase && s.rebase(dx, dz);
    const f2 = this.focusPoint();
    this.scatter.update(f2.x + this.origin.x, f2.z + this.origin.z);
  }

  focusPoint() {
    if (this.player && this.player.seat && this.car) return this.car.root.position;
    return this.player ? this.player.position : new THREE.Vector3();
  }

  // ------------------------------------------------------------------ loop
  start() {
    this.clock.start();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.clock.getDelta());
      this.frame(dt);
    };
    loop();
  }

  frame(dt) {
    if (!this.running) return;
    // photo mode: the world holds still while the camera roams
    const ph = this.photo;
    if (ph && input.wasPressed('photo') && !(this.ui && this.ui.current)) {
      if (ph.active) ph.exit();
      else if (!this.paused && !this.attract) ph.enter();
    }
    if (ph && ph.active) ph.update(dt);
    if (!this.paused) this.step(dt);
    this.render(dt);
    if (ph && ph.pendingShot) ph.capture();
    this.ui && this.ui.update(dt);
    input.endFrame();
  }

  step(dt) {
    this.time += dt;
    const sleeping = this.sleepHours > 0;
    let hours = (dt / 60) * this.env.timeScale;
    if (sleeping) {
      const h = Math.min(this.sleepHours, dt * 2.5);
      hours += h;
      this.sleepHours -= h;
      // a bed rests you best, a tent well, a car seat least
      this.player.energy = Math.min(100, this.player.energy + h * 12 * ({ car: 0.85, tent: 1, bed: 1.2 }[this.sleepPlace] || 1));
    }
    this.gameHoursDelta = hours;
    const prevDay = this.env.day;
    this.env.update(dt, hours);
    if (this.env.day !== prevDay) this.stats.daysSurvived = this.env.day;
    // a sandstorm showing on the horizon: say where from, once
    const storm = this.env.storm;
    if (storm.active && !storm.announced && storm.approach > 0.08 && storm.approach < 0.9) {
      storm.announced = true;
      const deg = (((Math.round(((Math.atan2(-storm.dir.x, storm.dir.z) * 180) / Math.PI) / 45) * 45) % 360) + 360) % 360;
      const from = { 0: 'north', 45: 'northeast', 90: 'east', 135: 'southeast', 180: 'south', 225: 'southwest', 270: 'west', 315: 'northwest' }[deg];
      this.hud && this.hud.toast(`A wall of dust is rolling in from the ${from}. Get in the car or under a roof.`, 'warn');
    }
    if (!this.attract) this.player.update(dt);
    // leave the car
    if (this.player.seat && input.wasPressed('interact') && !(this.ui && this.ui.blocksMove)) {
      // (E on something in reach works that instead)
      if (!this.interaction.target && this.player.exitSeat()) this.audio && this.audio.play('seat');
    }
    // car controls (for the current car); every car near the player is simulated
    this.fleet.updateCurrent();
    let controls = null;
    if (this.attract) controls = this.attractControls(dt);
    else if (this.player.seat === 'driver' && this.car.isInstalled('seat_FL')) controls = this.driveControls(dt);
    this.fleet.update(dt, controls);
    for (const s of this.systems) s.update && s.update(dt);
    this.campfires && this.campfires.update(dt);
    this.jacks.update();
    // winding in: from the driver's seat with the winch key, or at the drum with LMB
    const cable = this.winches.cable;
    if (cable) {
      const p = this.player;
      cable.reel = !!cable.anchor && (this.interaction.reelFromDrum || (p.seat === 'driver' && p.car === cable.car && input.isDown('winch') && !(this.ui && this.ui.blocksMove)));
      this.interaction.reelFromDrum = false;
    }
    this.physics.update(dt);
    this.fleet.syncVisual();
    this.trailers && this.trailers.update();
    this.items.update(dt);
    if (this.attract) {
      this.updateAttractCamera(dt);
    } else {
      this.npcs.update(dt);
      this.player.updateCamera(dt);
      this.interaction.update(dt);
      this.interaction.updateView(dt);
      this.winches.update(dt, this.interaction.hookHand());
    }
    this.updateRefuel(dt);
    this.effects.update(dt);
    this.audio.update(dt);
    if (!this.attract) this.hud.update(dt);
    // streaming
    const f = this.focusPoint();
    const gx = f.x + this.origin.x,
      gz = f.z + this.origin.z;
    this.terrain.update(gx, gz);
    this.scatter.update(gx, gz);
    this.scatter.setTime(this.time, this.env.w.wind);
    const sun = this.env.sun;
    this.scatter.setShadowReach(this.env.shadowExtent, (sun.position.y - sun.target.position.y) / sun.position.distanceTo(sun.target.position));
    this.pois.update(gx, gz);
    this.pois.update2(dt);
    this.env.focus.copy(f);
    this.env.biome = this.gen.dominantBiome(gx, gz);
    this.maybeRebase();
    // stats
    if (this.player.seat) {
      const s = Math.abs(this.car.speedKmh);
      this.stats.maxSpeed = Math.max(this.stats.maxSpeed, s);
    }
    this.stats.timeAlive += dt;
    const fp = this.focusPoint();
    if (this.lastFocus) {
      const d = Math.hypot(fp.x - this.lastFocus.x, fp.z - this.lastFocus.z);
      if (d < 60) this.stats.distance += d;
    }
    this.lastFocus = (this.lastFocus || new THREE.Vector3()).copy(fp);
    this.visitT = (this.visitT || 0) - dt;
    if (this.visitT <= 0) {
      this.visitT = 1;
      for (const inst of this.pois.loaded.values()) {
        if (inst.state.visited) continue;
        if (Math.hypot(inst.root.position.x - fp.x, inst.root.position.z - fp.z) < 30) {
          inst.state.visited = true;
          this.stats.placesVisited++;
        }
      }
    }
    this.updateSleep(dt);
    this.atlas && !this.attract && this.atlas.update();
    if (!this.attract) {
      this.story.update(dt);
      this.roadSigns = this.roadSigns || new RoadSigns(this);
      this.roadSigns.update();
      this.lures.update(dt);
    }
    this.obstacles = this.obstacles || new Obstacles(this);
    this.obstacles.update();
    this.worldPlates.update();
  }

  // "Build it first": a body on its wheels in the garage; everything else is somewhere about the
  // place, the way it was left: small parts on shelves and tables in the house and garage, panels
  // and seats around the yard, the engine on the scrap pile, a few things at the neighbours' down
  // the road. Sometimes an old donor car stands behind the house.
  setupUnassembled() {
    const car = this.car;
    const rnd = mulberry32((this.seed | 0) * 31 + 7);
    const keep = new Set(['chassis', 'body', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']);
    const order = [...car.type.ASSEMBLY_ORDER].reverse();
    for (const id of order) if (car.parts[id] && car.isInstalled(id) && !keep.has(id)) car.setInstalled(id, false);
    car.fuel = 4;
    car.battery = 0.7;
    const inst = this.pois.loaded.get(0);
    if (!inst) return this.spawnStarterItems();
    inst.root.updateMatrixWorld(true);
    const m = inst.root.matrixWorld;
    const at = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(m);
    const rq = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), inst.poi.rot + a);
    const shuffle = (a) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const missing = order.filter((id) => car.parts[id] && !keep.has(id));
    const def = (id) => car.type.PARTS[id] || {};
    const heavy = missing.filter((id) => (def(id).mass || 0) > 60);
    const small = shuffle(missing.filter((id) => (def(id).mass || 0) <= 8 && !/door|fender|hood|trunk|bumper|seat|spare|exhaust|fueltank/.test(id)));
    const large = shuffle(missing.filter((id) => !heavy.includes(id) && !small.includes(id)));
    // indoor spots: the house's tables, shelves and counters, the garage's bench and kit corner
    const indoor = shuffle(inst.loot.filter((l) => l.kind !== 'wreck').map((l) => l.pos.clone()));
    // yard spots: tidy rows where someone stripping a car would lay things out: behind the
    // garage, down its far side, and behind the house; kept off roofs, floors and fences
    const rows = [
      { from: [5.0, -7.2], step: [1.6, 0], n: 5, a: 0 },
      { from: [14.0, 0.4], step: [0, -1.5], n: 4, a: Math.PI / 2 },
      { from: [-12.5, -9.3], step: [1.6, 0], n: 7, a: 0 },
      { from: [3.2, 6.5], step: [-1.6, 0], n: 5, a: 0 },
    ];
    const yard = [];
    for (const r of rows)
      for (let i = 0; i < r.n; i++) {
        const p = new THREE.Vector3(r.from[0] + r.step[0] * i, 0, r.from[1] + r.step[1] * i);
        const w = p.clone().applyMatrix4(m);
        const hit = this.physics.raycast({ x: w.x, y: w.y + 12, z: w.z }, { x: 0, y: -1, z: 0 }, 30, GROUPS.look);
        const owner = hit && this.physics.ownerOf(hit.collider);
        if (owner && owner.kind === 'structure') continue;
        p.a = r.a;
        yard.push(p);
      }
    const lay = {
      door_FL: [0, 0, Math.PI / 2],
      door_FR: [0, 0, -Math.PI / 2],
      door_RL: [0, 0, Math.PI / 2],
      door_RR: [0, 0, -Math.PI / 2],
      hood: [Math.PI, 0, 0],
      trunk: [Math.PI, 0, 0],
      fender_FL: [0, 0, Math.PI / 2],
      fender_FR: [0, 0, -Math.PI / 2],
      fender_RL: [0, 0, Math.PI / 2],
      fender_RR: [0, 0, -Math.PI / 2],
      bumper_F: [-Math.PI / 2, 0, 0],
      bumper_R: [Math.PI / 2, 0, 0],
      spare: [0, 0, Math.PI / 2],
      steeringWheel: [-0.45, 0, 0],
    };
    const put = (id, wpos, a) => {
      const q = rq(a);
      if (lay[id]) q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...lay[id])));
      const it = this.items.spawnPart(id, wpos, q, { condition: 0.6 + rnd() * 0.4 });
      it.poiKey = null;
    };
    // the neighbours down the road keep one or two of the small things
    const away = small.splice(0, rnd() < 0.5 ? 1 : 2);
    let k = 1;
    while (k < 8 && !this.gen.poiSlot(k)) k++;
    if (k < 8) this.items.addPending(k, away.map((id) => ({ part: id, carType: car.type.id, condition: 0.55 + rnd() * 0.4 })));
    else small.push(...away);
    for (const id of small) {
      const p = indoor.length ? indoor.shift().applyMatrix4(m) : at(0, 0, 0);
      put(id, p.add(new THREE.Vector3(0, 0.12, 0)), rnd() * Math.PI * 2);
    }
    // the big pieces in order: panels together, then seats, then the rest
    const rank = (id) => (/door|fender|hood|trunk|bumper/.test(id) ? 0 : /seat/.test(id) ? 1 : 2);
    large.sort((a, b) => rank(a) - rank(b));
    for (const id of large) {
      const p = yard.length ? yard.shift() : new THREE.Vector3((rnd() - 0.5) * 20, 0, 10 + rnd() * 6);
      const w = p.clone().applyMatrix4(m);
      w.y = this.groundHeightAt(w.x, w.z) + 0.35;
      put(id, w, (p.a ?? 0) + (rnd() - 0.5) * 0.12);
    }
    // the engine sits on the scrap pile behind the garage
    for (const [i, id] of heavy.entries()) {
      const w = at(11.5 + i * 2.2, 0, -8.5);
      w.y = this.groundHeightAt(w.x, w.z) + 0.6;
      put(id, w, 0.4);
    }
    // a donor car behind the house in some worlds: the other model, tired and missing bits
    if (rnd() < 0.45) {
      const other = CAR_TYPE_LIST.find((t) => t.id !== car.type.id);
      if (other) {
        const w = at(-7 + (rnd() - 0.5) * 3, 0, -12.5);
        w.y = this.groundHeightAt(w.x, w.z) + 0.05;
        const donor = this.fleet.create(other.id, w, rq(Math.PI / 2 + (rnd() - 0.5) * 0.5), { owned: false });
        for (const id of [...other.ASSEMBLY_ORDER].reverse()) if (donor.parts[id] && !/chassis|body/.test(id) && rnd() < 0.35 && donor.isInstalled(id)) donor.setInstalled(id, false);
        donor.fuel = 0;
        donor.battery = rnd() * 0.2;
      }
    }
    this.hud && this.hud.toast && setTimeout(() => this.hud.toast('Your car is in pieces. Look around the house, the garage and the yard. Some parts may be further down the road.'), 1500);
    this.spawnStarterItems();
  }

  // A few essentials in the homestead garage next to the car.
  spawnStarterItems() {
    // something to drink and eat in the backpack from the start
    this.inventory.addSmart({ id: 'waterBottle', state: initialState('waterBottle', () => 1) });
    this.inventory.addSmart({ id: 'chocolate', state: initialState('chocolate', Math.random) });
    // a disc left in the glovebox
    this.car.storage.glovebox.add({ id: 'cd', state: { variant: Math.floor(Math.random() * 6) } });
    if (this.startZ) return;
    const inst = this.pois.loaded.get(0);
    if (!inst) return;
    inst.root.updateMatrixWorld(true);
    const at = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(inst.root.matrixWorld);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), inst.poi.rot);
    const gx = 8.5,
      gz = -1.5; // garage centre in POI space (8 x 9 m, back wall at gz - 4.5)
    // spread about the workshop: on the bench, the tool chest, the fridge, the wall shelf, the
    // crates and the floor, rather than in a row
    const list = [
      ['jack', gx + 2.4, 0.1, gz - 0.6, null],
      ['jerryCan', gx - 3.0, 0.3, gz + 2.4, { liquid: 12, liquidType: 'fuel' }],
      ['wrench', gx - 3.0, 0.95, gz - 3.95, null],
      ['oilBottle', gx - 2.1, 0.95, gz - 3.9, null],
      ['repairKit', gx - 1.05, 1.1, gz - 4.1, null],
      ['waterBottle', gx - 3.55, 1.8, gz - 2.5, null],
      ['cannedBeans', gx - 3.7, 1.62, gz - 1.2, null],
      ['lantern', gx + 3.48, 1.08, gz + 2.38, null],
      ['sprayPaint', gx - 3.7, 1.62, gz - 0.2, null],
    ];
    for (const [id, x, y, z, st] of list) {
      const it = this.items.spawn(id, at(x, y + 0.1, z), q.clone(), st ? { ...st } : null);
      it.poiKey = null;
    }
  }

  // Sleeping in the car, a tent or a bed: time runs fast until morning (or a few hours by day);
  // damage wakes you.
  updateSleep(dt) {
    const p = this.player;
    const blocked = this.ui && this.ui.blocksMove && !(this.ui.current === 'sleep');
    const place = p.seat ? 'car' : p.lying ? p.lying.kind : null;
    if (!this.sleepHours && place && !blocked && input.wasPressed('sleep')) {
      if (place === 'car' && this.car.dyn.engine.running) this.hud.toast('Turn the engine off first');
      else if (p.energy > 85) this.hud.toast('You are not tired');
      else {
        const t = this.env.time;
        this.sleepHours = t >= 19 || t < 5 ? (t >= 19 ? 24 - t + 6.5 : 6.5 - t) : 3;
        this.sleepHealth = p.health;
        this.sleepPlace = place;
        this.sleepEnergy = p.energy;
        this.ui && this.ui.showSleep(true);
      }
    }
    if (this.sleepHours > 0 && (p.health < this.sleepHealth - 0.5 || (this.sleepPlace === 'car' ? !p.seat : !p.lying))) {
      this.sleepHours = 0;
      this.hud.toast(p.seat || p.lying ? 'Something woke you' : 'You wake up');
    } else if (this.sleepHours > 0 && this.sleepHours <= dt * 2.5 + 1e-6) {
      // a night in a proper bed leaves you better off than one curled up on a car seat
      const gain = p.energy - (this.sleepEnergy ?? p.energy);
      const how = { car: 'Stiff neck from the seat, but rested', tent: 'You wake to canvas and birdsong', bed: 'You slept like a log' }[this.sleepPlace];
      if (gain > 10 && how) this.hud.toast(how);
    }
    if (this.sleepHours <= 0 && this.ui && this.ui.current === 'sleep') this.ui.showSleep(false);
    if (this.sleepHours > 0) this.sleepHealth = Math.min(this.sleepHealth, p.health + 0.5);
  }

  onPlayerDeath(cause) {
    if (this.deathHandled) return;
    this.deathHandled = true;
    this.sleepHours = 0;
    this.player.deathCause = cause;
    setTimeout(() => {
      this.paused = true;
      this.ui && this.ui.showDeath(cause);
    }, 1600);
  }

  onCarImpact(severity) {
    if (severity > 4) this.stats.crashes++;
  }

  // Title-screen autopilot: hold the right lane at a cruising speed.
  attractControls() {
    const car = this.car;
    const p = car.root.position;
    const gz = p.z + this.origin.z;
    const ahead = Math.max(14, (Math.abs(car.speedKmh) / 3.6) * 1.3);
    const tz = gz + ahead;
    const tx = this.gen.roadX(tz) - this.origin.x + 1.9;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(car.root.quaternion);
    const want = Math.atan2(tx - p.x, tz - this.origin.z - p.z);
    let d = want - Math.atan2(fwd.x, fwd.z);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const sp = car.speedKmh;
    if (car.fuel < 5) car.fuel = 30;
    return { throttle: sp < 72 ? 0.7 : 0, brake: sp > 80 ? 0.3 : 0, reverse: 0, steer: clamp(-d * 2.2, -1, 1), handbrake: 0 };
  }

  // Cinematic shots around the driving car: low tracking, high follow, front three-quarter,
  // wheel-level pass-by. Cuts every ~11 s with a short blend.
  updateAttractCamera(dt) {
    const cam = this.renderer.camera;
    const car = this.car;
    const c = car.root.position;
    const q = car.root.quaternion;
    this.attractT = (this.attractT || 0) + dt;
    const T = 11;
    const shot = Math.floor(this.attractT / T) % 4;
    const u = (this.attractT % T) / T;
    const local = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(q).add(c);
    let pos, look;
    if (shot === 0) {
      pos = local(-3.6, 0.9, -1.5 + u * 3.5);
      look = local(0.3, 0.7, 0.8);
    } else if (shot === 1) {
      pos = local(1.5 + u * 2, 4.2 - u * 0.8, -9 - u * 1.5);
      look = local(0, 0.8, 6);
    } else if (shot === 2) {
      pos = local(3.2 - u * 1.4, 1.15, 7.5 - u * 2.5);
      look = local(0, 0.75, 0);
    } else {
      pos = local(-2.4, 0.45, 4.5 - u * 9);
      look = local(0, 0.6, 1.2 - u * 3);
    }
    const gy = this.groundHeightAt(pos.x, pos.z, pos.y + 4) + 0.35;
    pos.y = Math.max(pos.y, gy);
    // keep the car right of centre so the menu column on the left stays clear
    const viewDir = look.clone().sub(pos).normalize();
    const camRight = viewDir.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    look.addScaledVector(camRight, -(shot === 1 ? 2.2 : 1.7));
    // short dissolve-like ease at cuts
    const fresh = this.attractT % T < dt * 1.5;
    if (fresh || !this._attractPos) {
      this._attractPos = pos.clone();
      this._attractLook = look.clone();
    }
    this._attractPos.lerp(pos, Math.min(1, dt * 6));
    this._attractLook.lerp(look, Math.min(1, dt * 6));
    cam.position.copy(this._attractPos);
    cam.lookAt(this._attractLook);
    this.attractShot = shot;
  }

  // Pump -> car refuelling session started from a pump.
  updateRefuel(dt) {
    const r = this.refuel;
    if (!r || !r.active) return;
    const car = this.car;
    const st = r.pump.inst.state;
    const filler = car.worldPointOf(car.type.HOTSPOTS.find((h) => h.id === 'fuel').pos);
    if (filler.distanceTo(r.pump.world) > 6 || st.fuel <= 0.01 || car.fuel >= car.fuelCap - 0.01 || this.player.position.distanceTo(r.pump.world) > 6) {
      r.active = false;
      this.hud.toast(car.fuel >= car.fuelCap - 0.01 ? 'Tank full' : st.fuel <= 0.01 ? 'The pump is dry' : 'Refuelling stopped');
      return;
    }
    const a = Math.min(dt * 0.8, st.fuel, car.fuelCap - car.fuel);
    st.fuel -= a;
    car.fuel += a;
  }

  itemName(id) {
    if (id.startsWith('part:')) {
      const part = id.slice(5);
      const t = (this.car && this.car.PARTS[part] ? this.car.type : CAR_TYPE_LIST.find((x) => x.PARTS[part])) || CAR_TYPE_LIST[0];
      return t.PARTS[part] ? t.PARTS[part].label : part;
    }
    return ITEMS[id] ? ITEMS[id].name : id;
  }

  driveControls(dt) {
    const blocked = this.ui && this.ui.blocksMove;
    const k = (a) => (!blocked && input.isDown(a) ? 1 : 0);
    let steer = k('right') - k('left');
    this._steer = this._steer || 0;
    this._steer += (steer - this._steer) * Math.min(1, dt * 6);
    const car = this.car;
    if (!blocked) {
      // the key is turned by hand (E on it, see interaction.turnKey); lights, wipers and the
      // gear lever also have keys, the hand still goes to them
      const ia = this.interaction;
      const spot = (id) => car.type.HOTSPOTS.find((h) => h.id === id);
      if (input.wasPressed('lights')) ia.driverReach(spot('lights') || 'stalk');
      if (input.wasPressed('wipers')) ia.driverReach(spot('wipers') || 'stalk');
      if ((input.wasPressed('gearUp') || input.wasPressed('gearDown')) && !car.dyn.automatic) ia.driverReach('shifter');
      if (input.wasPressed('lights')) car.lightsOn = (car.lightsOn + 1) % 3;
      if (input.wasPressed('wipers')) car.wipers = !car.wipers;
      if (!car.dyn.automatic) {
        if (input.wasPressed('gearUp')) car.dyn.shift(1);
        if (input.wasPressed('gearDown')) car.dyn.shift(-1);
      }
      car.horn = input.isDown('horn');
    }
    const fwd = k('forward'),
      back = k('back');
    return {
      throttle: car.dyn.automatic ? fwd : fwd,
      brake: car.dyn.automatic ? 0 : back,
      reverse: car.dyn.automatic ? back : 0,
      steer: this._steer,
      handbrake: k('handbrake'),
    };
  }

  render(dt) {
    const cam = this.renderer.camera;
    cam.fov = (this.debugFov || verticalFov(settings.data.hfov, cam.aspect)) * (1 - 0.48 * ((this.player && this.player.seat && this.player.seatZoom) || 0));
    cam.far = 7000;
    cam.updateProjectionMatrix();
    this.eyeCam.fov = cam.fov;
    this.eyeCam.aspect = cam.aspect;
    this.eyeCam.updateProjectionMatrix();
    this.env.sky.mesh.position.copy(cam.position);
    for (const s of this.systems) s.preRender && s.preRender(dt);
    if (this.interaction && !this.attract) this.interaction.updateView(0);
    // headless tests: a function placing the camera after the player's view is set
    if (this.debugView) this.debugView(cam);
    const gr = this.env && this.env.grade;
    if (gr) {
      const u = this.renderer.grade.uniforms;
      u.uWarm.value = gr.warm;
      u.uNight.value = gr.night;
      u.uOvercast.value = gr.overcast;
    }
    // the sun: glare and shafts on screen, warm haze toward it
    if (this.env) {
      const E = this.env;
      cam.updateMatrixWorld();
      const up = E.sunDir.y;
      const clear = (1 - E.w.overcast * 0.9) * (1 - E.w.dust * 0.6) * (1 - E.w.rain * 0.8);
      this.renderer.setSun(E.sunDir, E.sun.color, THREE.MathUtils.smoothstep(up, -0.02, 0.06) * clear);
      const hot = E.biome === 'dunes' || E.biome === 'badlands' || E.biome === 'saltflat' ? 1 : E.biome === 'scrub' || E.biome === 'highland' ? 0.7 : 0;
      this.renderer.setHeat(hot * THREE.MathUtils.smoothstep(up, 0.45, 0.85) * clear * (1 - E.w.rain) * (settings.data.quality === 'low' ? 0 : 1));
      // mist lies in the low ground: its base follows the land under you slowly, so it stays put
      // in a valley as you drive down into it
      const gy = this.gen.height(cam.position.x + this.origin.x, cam.position.z + this.origin.z);
      if (E.mistBase === null || Math.abs(E.mistBase - gy) > 60) E.mistBase = gy - 3;
      E.mistBase += (gy - 3 - E.mistBase) * Math.min(1, dt * 0.04);
      const mistD = E.mist * 0.045;
      const S = E.storm;
      const wallAmt = S.active ? THREE.MathUtils.smoothstep(S.approach, 0.0, 0.12) * (1 - THREE.MathUtils.smoothstep(S.approach, 0.9, 1)) : 0;
      updateFogSun(
        cam,
        E.sunDir,
        E.sun.color,
        THREE.MathUtils.smoothstep(up, -0.12, 0.05) * (1 - E.w.overcast * 0.75) * (0.55 + 0.45 * (1 - THREE.MathUtils.smoothstep(up, 0.1, 0.6))),
        { density: mistD, base: E.mistBase, color: E.mistColor },
        { amount: wallAmt, dir: S.dir, dist: THREE.MathUtils.lerp(4500, 60, S.approach), color: E.wallColor }
      );
      // the sky is milky only from inside the mist
      E.sky.uniforms.uMist.value = E.mist * (1 - THREE.MathUtils.smoothstep(cam.position.y - E.mistBase, 6, 40));
    }
    if (this.player) {
      this.renderer.grade.uniforms.uDamage.value = clamp(this.player.damageFlash + (this.player.health < 30 ? (30 - this.player.health) / 60 : 0), 0, 1);
      // out in a sandstorm with nothing between you and the wind
      const exposed = !this.player.seat && !this.player.indoors ? 1 : 0;
      const gr = this.renderer.grade.uniforms.uGrit;
      gr.value += (exposed * THREE.MathUtils.smoothstep(this.env.w.dust, 0.35, 0.85) - gr.value) * Math.min(1, dt * 1.5);
    }
    this.lights.update(cam);
    this.renderer.render(dt);
  }

  // Headless testing helper: advance the simulation without rendering.
  debugSimulate(seconds, dt = 1 / 30) {
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) {
      this.step(dt);
      input.endFrame();
    }
    return true;
  }

  renderNow() {
    this.render(0.016);
    return true;
  }
}

// Vertical camera FOV for a horizontal one (degrees); narrow windows keep a sane vertical angle.
function verticalFov(hfov, aspect) {
  const h = THREE.MathUtils.degToRad(hfov || 90);
  return Math.min(78, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / Math.max(aspect, 1.2))));
}

function tick() {
  return new Promise((r) => setTimeout(r, 0));
}
