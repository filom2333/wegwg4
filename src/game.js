// Game: owns the renderer, physics, world streaming, environment, car, player and the
// systems that tie them together. The UI layer drives it (menu -> new game / load).

import * as THREE from 'three';
import { Renderer } from './gfx/renderer.js';
import { Environment } from './gfx/environment.js';
import { buildGroundTextures } from './gfx/groundTextures.js';
import { createTerrainMaterial, createRoadMaterial } from './gfx/terrainMaterial.js';
import { Physics, GROUPS } from './physics/physics.js';
import { WorldGen } from './world/worldGen.js';
import { Terrain } from './world/terrain.js';
import { Scatter } from './world/scatter.js';
import { loadTreeTextures } from './world/trees.js';
import { POIManager } from './world/poi.js';
import { loadBeetleAsset, buildBeetleModel, buildBeetleWreck } from './vehicle/beetle/beetleModel.js';
import { createBeetleMaterials } from './vehicle/beetle/beetleMaterials.js';
import { Car } from './vehicle/car.js';
import { Player } from './player/player.js';
import { input } from './core/input.js';
import { ItemSystem } from './items/items.js';
import { Inventory, Container } from './items/inventory.js';
import { ITEMS, initialState } from './items/itemDefs.js';
import { Interaction } from './player/interaction.js';
import { HUD } from './ui/hud.js';
import { AudioSystem } from './audio/audio.js';
import { Effects } from './gfx/effects.js';
import { NPCManager } from './npc/npcs.js';
import { Story } from './story/story.js';
import { RoadSigns } from './story/roadSigns.js';
import { Water } from './world/water.js';
import { Bridges } from './world/bridges.js';
import { PARTS } from './vehicle/carParts.js';
import { settings } from './core/settings.js';
import { clamp } from './core/noise.js';
import { applyWorldState, applySave } from './core/save.js';

export const DIFFICULTY = {
  easy: { label: 'Easy', hunger: 0.6, thirst: 0.6, fatigue: 0.6, consumption: 0.7, wear: 0.5, damage: 0.6, playerDamage: 0.6, enemies: 0.5, loot: 1.4 },
  normal: { label: 'Normal', hunger: 1, thirst: 1, fatigue: 1, consumption: 1, wear: 1, damage: 1, playerDamage: 1, enemies: 1, loot: 1 },
  hard: { label: 'Hard', hunger: 1.35, thirst: 1.4, fatigue: 1.2, consumption: 1.25, wear: 1.6, damage: 1.4, playerDamage: 1.35, enemies: 1.5, loot: 0.7 },
};

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas, settings.data.quality);
    this.scene = new THREE.Scene();
    this.worldGroup = new THREE.Group();
    this.worldGroup.name = 'world';
    this.scene.add(this.worldGroup);
    this.renderer.setupComposer(this.scene);
    // first-person eye (aim, reach, viewmodel); the rendered camera follows it or orbits in 3rd person
    this.eyeCam = new THREE.PerspectiveCamera(75, 1, 0.05, 6000);
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
    window.addEventListener('resize', () => this.renderer.resize());
    input.attach(canvas);
    this.__input = input;
  }

  // ------------------------------------------------------------------ setup
  async init({ seed = 1234, difficulty = 'normal', start = 'assembled', time = 8.5, weather = 'clear', startZ = 0, load = null, attract = false, onProgress = () => {} } = {}) {
    if (load) {
      seed = load.seed;
      difficulty = load.difficulty;
      start = load.startMode;
      time = load.env.time;
      weather = load.env.weather;
    }
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
    this.scatter = new Scatter(this, this.groundTex, await treeTex);
    this.pois = new POIManager(this);
    this.story = new Story(this);
    if (load && load.story) this.story.restore(load.story);
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
    onProgress('Building the car', 0.35);
    await tick();
    const carAsset = await loadBeetleAsset(this.renderer.renderer);
    this.carMats = createBeetleMaterials(carAsset.textures, { color: 0xa8502c });
    this.carModel = buildBeetleModel(carAsset, this.carMats);
    this.pois.setWreckPrototype(buildBeetleWreck(carAsset));
    // spawn
    const spawn = this.spawnPoint();
    if (this.startZ || load) {
      this.origin.x = Math.round(spawn.x / 1024) * 1024;
      this.origin.z = Math.round(spawn.z / 1024) * 1024;
    }
    this.terrain.update(spawn.x, spawn.z);
    this.terrain.ensureCollidersAround(spawn.x, spawn.z, 30);
    this.scatter.update(spawn.x, spawn.z);
    onProgress('Streaming terrain', 0.55);
    await this.waitForTerrain(spawn.x, spawn.z);
    // places right around the spawn must exist before the car and player are dropped in
    if (load) for (let i = 0; i < 4; i++) this.pois.update(spawn.x, spawn.z);
    const carPos = new THREE.Vector3(spawn.carX, (spawn.carY ?? this.gen.height(spawn.carX, spawn.carZ)) + 0.05, spawn.carZ);
    this.car = new Car(this, this.carModel, {
      position: new THREE.Vector3(carPos.x - this.origin.x, carPos.y, carPos.z - this.origin.z),
      quaternion: spawn.carQuat ? new THREE.Quaternion(...spawn.carQuat) : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawn.carYaw),
    });
    this.car.dyn.automatic = settings.data.transmission !== 'manual';
    this.car.storage = {
      trunk: new Container('trunk', 'Front trunk', 14, { capacity: 120, bulky: true }),
      glovebox: new Container('glovebox', 'Glovebox', 6, { capacity: 5 }),
    };
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
    for (let i = 0; i < 150; i++) this.physics.update(1 / 60);
    this.car.syncVisual();
    this.items.update();
    this.hud.show(!attract);
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

  spawnPoint() {
    if (this.load) {
      const d = this.load;
      return { x: d.player.pos[0], y: d.player.pos[1], z: d.player.pos[2], yaw: d.player.yaw, carX: d.car.pos[0], carY: d.car.pos[1] - 0.05, carZ: d.car.pos[2], carQuat: d.car.quat, carYaw: 0 };
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
    this.terrain.rebase(dx, dz);
    this.scatter.rebase(dx, dz);
    this.pois.rebase(dx, dz);
    this.items.rebase(dx, dz);
    this.effects && this.effects.rebase(dx, dz);
    this.npcs && this.npcs.rebase(dx, dz);
    this.roadSigns && this.roadSigns.rebase(dx, dz);
    this.car.syncVisual();
    for (const s of this.systems) s.rebase && s.rebase(dx, dz);
    const f2 = this.focusPoint();
    this.scatter.update(f2.x + this.origin.x, f2.z + this.origin.z);
    this.car && this.car.prevPos.set(this.car.prevPos.x - dx, this.car.prevPos.y, this.car.prevPos.z - dz);
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
    if (!this.paused) this.step(dt);
    this.render(dt);
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
      this.player.energy = Math.min(100, this.player.energy + h * 12);
    }
    this.gameHoursDelta = hours;
    const prevDay = this.env.day;
    this.env.update(dt, hours);
    if (this.env.day !== prevDay) this.stats.daysSurvived = this.env.day;
    if (!this.attract) this.player.update(dt);
    // leave the car
    if (this.player.seat && input.wasPressed('interact') && !(this.ui && this.ui.blocksMove)) {
      const t = this.interaction.target;
      if (!t || t.kind !== 'hotspot') {
        const seat = this.player.seat;
        if (this.player.exitSeat()) this.audio && this.audio.play('seat');
        void seat;
      }
    }
    // car controls
    let controls = null;
    if (this.attract) controls = this.attractControls(dt);
    else if (this.player.seat === 'driver' && this.car.isInstalled('seat_FL')) controls = this.driveControls(dt);
    this.car.update(dt, controls);
    for (const s of this.systems) s.update && s.update(dt);
    this.physics.update(dt);
    this.car.syncVisual();
    this.items.update(dt);
    if (this.attract) {
      this.updateAttractCamera(dt);
    } else {
      this.npcs.update(dt);
      this.player.updateCamera(dt);
      this.interaction.update(dt);
      this.interaction.updateView(dt);
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
    if (!this.attract) {
      this.story.update(dt);
      this.roadSigns = this.roadSigns || new RoadSigns(this);
      this.roadSigns.update();
    }
  }

  // "Build it first": a rolling chassis in the garage, everything else laid out in the yard.
  setupUnassembled() {
    const car = this.car;
    const keep = new Set(['chassis', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']);
    const order = ['seat_FL', 'seat_FR', 'seat_R', 'steeringWheel', 'headlight_L', 'headlight_R', 'taillight_L', 'taillight_R', 'bumper_F', 'bumper_R', 'fender_FL', 'fender_FR', 'fender_RL', 'fender_RR', 'door_FL', 'door_FR', 'hood', 'trunk', 'spare', 'airfilter', 'fanbelt', 'battery', 'exhaust', 'fueltank', 'engine', 'body'];
    for (const id of order) if (car.parts[id] && car.isInstalled(id) && !keep.has(id)) car.setInstalled(id, false);
    car.fuel = 6;
    car.battery = 0.7;
    const inst = this.pois.loaded.get(0);
    if (!inst) return;
    inst.root.updateMatrixWorld(true);
    const m = inst.root.matrixWorld;
    const at = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(m);
    const rq = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), inst.poi.rot + a);
    // heavy pieces first, near the garage mouth; small parts in two rows across the yard
    const spots = [
      ['body', 8.6, 0.9, 8.4, Math.PI / 2],
      ['engine', 4.6, 0.6, 4.4, 0],
      ['fueltank', 12.6, 0.4, 6.6, 0.3],
      ['exhaust', 12.4, 0.3, 8.6, Math.PI / 2],
    ];
    const small = order.filter((id) => !spots.some((s) => s[0] === id) && car.parts[id] && !keep.has(id));
    small.forEach((id, i) => {
      const row = Math.floor(i / 8),
        col = i % 8;
      spots.push([id, 5.2 + col * 1.0, 0.45, 4.2 + row * 1.5 + (col % 2) * 0.25, (col * 0.7) % 1]);
    });
    // lay thin panels on their faces the way someone would put them down
    const lay = {
      door_FL: [0, 0, Math.PI / 2],
      door_FR: [0, 0, -Math.PI / 2],
      fender_FL: [0, 0, Math.PI / 2],
      fender_FR: [0, 0, -Math.PI / 2],
      fender_RL: [0, 0, Math.PI / 2],
      fender_RR: [0, 0, -Math.PI / 2],
      bumper_F: [-Math.PI / 2, 0, 0],
      bumper_R: [Math.PI / 2, 0, 0],
      spare: [0, 0, Math.PI / 2],
      steeringWheel: [-0.45, 0, 0],
    };
    for (const [id, x, y, z, a] of spots) {
      const q = rq(a);
      if (lay[id]) q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...lay[id])));
      const it = this.items.spawnPart(id, at(x, y + 0.25, z), q, { condition: 0.75 + Math.random() * 0.25 });
      it.poiKey = null;
    }
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
      gz = -1.5; // garage centre in POI space
    const list = [
      ['jerryCan', gx - 2.4, 0.4, gz + 2.0, { liquid: 12, liquidType: 'fuel' }],
      ['oilBottle', gx - 1.6, 1.1, gz - 3.2, null],
      ['waterBottle', gx - 2.0, 1.1, gz - 3.2, null],
      ['cannedBeans', gx - 2.4, 1.1, gz - 3.2, null],
      ['wrench', gx - 1.0, 1.1, gz - 3.25, null],
      ['repairKit', gx + 2.6, 0.35, gz + 2.6, null],
    ];
    for (const [id, x, y, z, st] of list) {
      const it = this.items.spawn(id, at(x, y + 0.1, z), q.clone(), st ? { ...st } : null);
      it.poiKey = null;
    }
  }

  // Sleeping in the car: time runs fast until morning (or a few hours by day); damage wakes you.
  updateSleep(dt) {
    const p = this.player;
    const blocked = this.ui && this.ui.blocksMove && !(this.ui.current === 'sleep');
    if (!this.sleepHours && p.seat && !blocked && input.wasPressed('sleep')) {
      if (this.car.dyn.engine.running) this.hud.toast('Turn the engine off first');
      else if (p.energy > 85) this.hud.toast('You are not tired');
      else {
        const t = this.env.time;
        this.sleepHours = t >= 19 || t < 5 ? (t >= 19 ? 24 - t + 6.5 : 6.5 - t) : 3;
        this.sleepHealth = p.health;
        this.ui && this.ui.showSleep(true);
      }
    }
    if (this.sleepHours > 0 && (p.health < this.sleepHealth - 0.5 || !p.seat)) {
      this.sleepHours = 0;
      this.hud.toast(p.seat ? 'Something woke you' : 'You wake up');
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
    const filler = car.worldPointOf(new THREE.Vector3(-0.87, 0.86, -1.63));
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
    if (id.startsWith('part:')) return PARTS[id.slice(5)].label;
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
      // Ignition key: press turns it on (hold to crank), press while running stops the engine,
      // a quick tap with the ignition on and the engine off switches it off.
      const ia = this.interaction;
      if (input.wasPressed('ignition')) ia.driverReach('key');
      if (input.wasPressed('lights') || input.wasPressed('wipers')) ia.driverReach('stalk');
      if ((input.wasPressed('gearUp') || input.wasPressed('gearDown')) && !car.dyn.automatic) ia.driverReach('shifter');
      if (input.wasPressed('ignition')) {
        this._keyWasOn = car.ignition;
        this._keyHeld = 0;
        if (car.dyn.engine.running) {
          car.setIgnition(false);
          this._keyWasOn = null;
        } else if (!car.ignition) car.setIgnition(true);
      }
      if (input.isDown('ignition')) {
        this._keyHeld = (this._keyHeld || 0) + dt;
        if (car.ignition && !car.dyn.engine.running && this._keyWasOn !== null) car.crank(dt);
      }
      if (input.wasReleased('ignition')) {
        if (this._keyWasOn && this._keyHeld < 0.2 && !car.dyn.engine.running) car.setIgnition(false);
        car.cranking = 0;
      }
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
    cam.fov = this.debugFov || verticalFov(settings.data.hfov, cam.aspect);
    cam.far = 6000;
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
    if (this.player) this.renderer.grade.uniforms.uDamage.value = clamp(this.player.damageFlash + (this.player.health < 30 ? (30 - this.player.health) / 60 : 0), 0, 1);
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
