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
import { buildCarBody } from './vehicle/body/carBody.js';
import { createCarMaterials } from './vehicle/carMaterials.js';
import { buildFullCarModel } from './vehicle/carModel.js';
import { Car } from './vehicle/car.js';
import { Player } from './player/player.js';
import { input } from './core/input.js';
import { settings } from './core/settings.js';
import { clamp } from './core/noise.js';

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
    this.systems = [];
    window.addEventListener('resize', () => this.renderer.resize());
    input.attach(canvas);
  }

  // ------------------------------------------------------------------ setup
  async init({ seed = 1234, difficulty = 'normal', start = 'assembled', time = 8.5, weather = 'clear', startZ = 0, onProgress = () => {} } = {}) {
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
    this.terrain = new Terrain({
      gen: this.gen,
      scene: this.worldGroup,
      physics: this.physics,
      terrainMaterial: this.terrainMat,
      roadMaterial: this.roadMat,
      origin: this.origin,
      quality: settings.data.quality,
    });
    await this.terrain.workerReady;
    this.scatter = new Scatter(this, this.groundTex);
    onProgress('Building the car', 0.35);
    await tick();
    this.carBody = buildCarBody({ res: settings.data.quality === 'low' ? 0.034 : 0.028 });
    this.carMats = createCarMaterials({ color: 0xa8502c });
    this.carModel = buildFullCarModel(this.carBody, this.carMats);
    // spawn
    const spawn = this.spawnPoint();
    if (this.startZ) {
      this.origin.x = Math.round(spawn.x / 1024) * 1024;
      this.origin.z = Math.round(spawn.z / 1024) * 1024;
    }
    this.terrain.update(spawn.x, spawn.z);
    this.terrain.ensureCollidersAround(spawn.x, spawn.z, 30);
    this.scatter.update(spawn.x, spawn.z);
    onProgress('Streaming terrain', 0.55);
    await this.waitForTerrain(spawn.x, spawn.z);
    const carPos = new THREE.Vector3(spawn.carX, this.gen.height(spawn.carX, spawn.carZ) + 0.05, spawn.carZ);
    this.car = new Car(this, this.carModel, {
      position: new THREE.Vector3(carPos.x - this.origin.x, carPos.y, carPos.z - this.origin.z),
      quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawn.carYaw),
    });
    this.player = new Player(this, new THREE.Vector3(spawn.x - this.origin.x, this.gen.height(spawn.x, spawn.z) + 0.05, spawn.z - this.origin.z));
    this.player.yaw = spawn.yaw;
    for (const s of this.systems) s.init && (await s.init(this));
    onProgress('Ready', 1);
    this.running = true;
  }

  spawnPoint() {
    const z = 6 + (this.startZ || 0);
    const rx = this.gen.roadX(z);
    return { x: rx + 6.5, z: z - 2, yaw: -Math.PI / 2 + 0.4, carX: rx + 2.0, carZ: z + 1, carYaw: 0 };
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
    for (const c of this.worldGroup.children) {
      if (c === this.terrain.group) continue;
      c.position.x -= dx;
      c.position.z -= dz;
      c.updateMatrixWorld(true);
    }
    this.terrain.rebase(dx, dz);
    this.scatter.rebase(dx, dz);
    for (const s of this.systems) s.rebase && s.rebase(dx, dz);
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
    this.player.update(dt);
    // car controls
    let controls = null;
    if (this.player.seat === 'driver' && this.car.isInstalled('seat_FL')) controls = this.driveControls(dt);
    this.car.update(dt, controls);
    for (const s of this.systems) s.update && s.update(dt);
    this.physics.update(dt);
    this.car.syncVisual();
    this.player.updateCamera(dt);
    // streaming
    const f = this.focusPoint();
    const gx = f.x + this.origin.x,
      gz = f.z + this.origin.z;
    this.terrain.update(gx, gz);
    this.scatter.update(gx, gz);
    this.scatter.setTime(this.time, this.env.w.wind);
    this.env.focus.copy(f);
    this.env.biome = this.gen.dominantBiome(gx, gz);
    this.maybeRebase();
    // stats
    if (this.player.seat) {
      const s = Math.abs(this.car.speedKmh);
      this.stats.maxSpeed = Math.max(this.stats.maxSpeed, s);
    }
    this.stats.timeAlive += dt;
  }

  driveControls(dt) {
    const blocked = this.ui && this.ui.blocksMove;
    const k = (a) => (!blocked && input.isDown(a) ? 1 : 0);
    let steer = k('right') - k('left');
    this._steer = this._steer || 0;
    this._steer += (steer - this._steer) * Math.min(1, dt * 6);
    const car = this.car;
    if (!blocked) {
      if (input.wasPressed('ignition')) {
        if (!car.ignition) car.setIgnition(true);
        else car.setIgnition(false);
      }
      if (input.isDown('ignition') && car.ignition && !car.dyn.engine.running) car.crank(dt);
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
    cam.fov = settings.data.fov;
    cam.far = 6000;
    cam.updateProjectionMatrix();
    this.env.sky.mesh.position.copy(cam.position);
    for (const s of this.systems) s.preRender && s.preRender(dt);
    if (this.player) this.renderer.grade.uniforms.uDamage.value = clamp(this.player.damageFlash + (this.player.health < 30 ? (30 - this.player.health) / 60 : 0), 0, 1);
    this.renderer.render(dt);
  }

  // Headless testing helper: advance the simulation without rendering.
  debugSimulate(seconds, dt = 1 / 30) {
    const n = Math.round(seconds / dt);
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

function tick() {
  return new Promise((r) => setTimeout(r, 0));
}
