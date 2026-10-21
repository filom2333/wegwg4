// The drivable car: visual model + physics + part installation state + vehicle systems
// (fuel, oil, battery, engine temperature and condition, fan belt, tyres) + lights.

import * as THREE from 'three';
import { ALBUMS } from '../audio/music/albums.js';
import { VehicleDynamics } from '../physics/vehicleDynamics.js';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { dependentsOf, lidOf } from './partUtils.js';
import { setNeedle } from './gauges.js';
import { setPartSource, applyEngine } from './swap.js';
import { accessoryMass, ACCESSORIES } from './accessories.js';
import { plateMass, plateColliders, plateArmour, detachPlate, PLATES } from './plates.js';
import { carType } from './types.js';
import { clamp } from '../core/noise.js';
import { addGlassRain } from '../gfx/glassRain.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// type: a car type (see types.js) with its spec, part table and model; model: its scene graph.
export class Car {
  constructor(game, type, model, opts = {}) {
    this.game = game;
    this.type = type;
    this.model = model;
    this.root = model.root;
    game.worldGroup.add(this.root);
    if (model.mats) addGlassRain(model.mats.glass);
    this.parts = {};
    for (const id of Object.keys(model.parts)) {
      this.parts[id] = { installed: true, condition: 1, item: null };
    }
    // systems
    this.fuel = opts.fuel ?? 22; // litres
    this.fuelCap = type.fuelCap;
    this.oilCap = type.oilCap;
    this.oil = opts.oil ?? type.oilCap * 0.94; // litres
    // water-cooled engines: litres of coolant in the radiator circuit
    this.coolantCap = type.coolantCap || 0;
    this.coolant = opts.coolant ?? this.coolantCap * 0.9;
    this.battery = opts.battery ?? 0.85;
    this.engineTemp = 22;
    this.engineCondition = opts.engineCondition ?? 0.85;
    this.fanbeltCondition = opts.fanbeltCondition ?? 0.8;
    this.odometer = opts.odometer ?? 184213;
    this.trip = 0;
    this.lightsOn = 0; // 0 off, 1 low, 2 high
    this.ignition = false;
    this.cranking = 0;
    this.radioOn = false;
    // head unit: FM radio or the CD in the slot (album index), track and position in it
    this.stereo = { disc: -1, track: 0, pos: 0, mode: 'radio', restart: false };
    this.stereoState = { loading: false, playing: false, pos: 0 };
    this.fire = 0;
    this.smoke = 0;
    this.dirt = 0.35;
    this.horn = false;
    this.wipers = false;
    this.wiperPhase = 0;
    this.cabinLight = false;
    // physics
    const pos = opts.position || V(0, 0.5, 0);
    const q = opts.quaternion || new THREE.Quaternion();
    this.dyn = new VehicleDynamics(game.physics, {
      position: pos,
      quaternion: q,
      hardpoints: type.HARDPOINTS,
      params: type.DYNAMICS,
    });
    this.dyn.surfaceAt = (p, collider) => {
      const owner = game.physics.ownerOf(collider);
      if (owner && owner.surface) return owner.surface;
      const o = game.origin;
      return game.gen.surfaceAt(p.x + o.x, p.z + o.z);
    };
    this.dyn.onImpact = (imp) => this.onImpact(imp);
    this.dyn.onStall = () => {
      this.game.audio && this.game.audio.play('stall', { at: this.root.position });
    };
    this.ownerTag = { kind: 'car', car: this };
    this.colliderParts = [];
    this.rebuildColliders();
    this.updateMass();
    this.setupLights();
    this.prevPos = new THREE.Vector3(pos.x, pos.y, pos.z);
    this.attached = []; // items stowed in the car
    this.wheelDust = [0, 0, 0, 0];
    this.syncVisual();
  }

  // ---------------------------------------------------------------- parts
  get PARTS() {
    return this.type.PARTS;
  }

  isInstalled(id) {
    return !!(this.parts[id] && this.parts[id].installed);
  }

  canInstall(id) {
    const def = this.PARTS[id];
    if (!def || this.isInstalled(id)) return { ok: false, reason: 'Already installed' };
    for (const r of def.requires) if (!this.isInstalled(r)) return { ok: false, reason: `Needs ${this.PARTS[r].label.toLowerCase()} first` };
    const lid = this.lidBlocking(id);
    if (lid) return { ok: false, reason: lid };
    return { ok: true };
  }

  // Reason text if the lid a part is reached through is closed.
  lidBlocking(id) {
    const lid = lidOf(this.PARTS, id);
    if (!lid || !this.isInstalled(lid) || this.model.parts[lid].openT >= 0.5) return null;
    return `Open the ${this.type.lids[lid] || lid} first`;
  }

  // Is a lid open (or gone)?
  lidOpen(lid) {
    return !this.isInstalled(lid) || this.model.parts[lid].openT > 0.5;
  }

  canRemove(id) {
    const def = this.PARTS[id];
    if (!def || def.fixed) return { ok: false, reason: 'Cannot be removed' };
    if (!this.isInstalled(id)) return { ok: false, reason: 'Not installed' };
    const deps = dependentsOf(this.PARTS, id).filter((d) => this.isInstalled(d) && !this.PARTS[d].fixed);
    if (deps.length) return { ok: false, reason: `Remove ${this.PARTS[deps[0]].label.toLowerCase()} first` };
    const lid = this.lidBlocking(id);
    if (lid) return { ok: false, reason: lid };
    if (this.game.player && this.game.player.seat) return { ok: false, reason: 'Get out of the car first' };
    // a wheel standing on the ground carries the car: jack that corner up first
    const w = this.dyn.wheels.find((x) => x.id === id);
    if (w && w.contact && w.load > 900 && this.dyn.body.isEnabled()) return { ok: false, reason: 'It carries the car: jack this corner up first' };
    return { ok: true };
  }

  // from: the car type the part came off (another type's part fits the same slot)
  setInstalled(id, on, from = null) {
    // plates bolted to a part come loose with it
    if (!on && this.plates) for (const p of this.plates.filter((x) => x.part === id)) this.dropPlate(p);
    const own = this.type.id;
    const src = on ? from || own : this.parts[id].from || own;
    if (on && (src !== (this.parts[id].from || own)) && id !== 'steeringWheel') setPartSource(this, id, this.game.fleet ? this.game.fleet.modelOf(src) : null, src);
    this.parts[id].from = on && src !== own ? src : null;
    if (id === 'engine' && on) applyEngine(this, carType(src));
    this.parts[id].installed = on;
    this.model.setInstalled(id, on);
    const w = this.dyn.wheels.find((x) => x.id === id);
    if (w) w.installed = on;
    if (id === 'engine') this.dyn.engineInstalled = on;
    if (id === 'steeringWheel') this.dyn.steeringInstalled = on;
    if ((id === 'engine' || id === 'battery' || id === 'fueltank') && !on) this.setIgnition(false);
    this.rebuildColliders();
    this.updateMass();
  }

  dropPlate(p) {
    const w = new THREE.Matrix4().copy(p.mesh.matrixWorld);
    const pos = V(0, 0, 0),
      q = new THREE.Quaternion(),
      sc = V(0, 0, 0);
    w.decompose(pos, q, sc);
    detachPlate(this, p);
    if (this.game.items && PLATES[p.id]) this.game.items.spawn(p.id, pos.addScaledVector(V(0, 1, 0).applyQuaternion(q), 0.05), q, { ...p.state });
  }

  // Spray paint on one part: its painted surfaces get their own material (same shader, own
  // colour). Returns false if nothing on the part takes paint.
  paintPart(id, hex) {
    const mp = this.model.parts[id];
    const P = this.model.mats.paintables;
    if (!mp || !P || !P.size) return false;
    this.partMats = this.partMats || {};
    const own = (this.partMats[id] = this.partMats[id] || new Map());
    let any = false;
    mp.inner.traverse((o) => {
      if (!o.isMesh) return;
      const base = o.userData.baseMat || o.material;
      if (!P.has(base) && !base.userData.paint) return;
      o.userData.baseMat = base;
      let m = own.get(base);
      if (!m) {
        m = base.clone();
        m.onBeforeCompile = base.onBeforeCompile;
        m.customProgramCacheKey = base.customProgramCacheKey;
        m.color = new THREE.Color();
        own.set(base, m);
      }
      m.color.setHex(hex);
      o.material = m;
      any = true;
    });
    if (any) (this.partColors = this.partColors || {})[id] = hex;
    return any;
  }

  // Can a spray can do anything to this part?
  paintable(id) {
    const mp = this.model.parts[id];
    const P = this.model.mats.paintables;
    if (!mp || !P) return false;
    let ok = false;
    mp.inner.traverse((o) => {
      const base = o.isMesh && (o.userData.baseMat || o.material);
      if (base && (P.has(base) || base.userData.paint)) ok = true;
    });
    return ok;
  }

  // Bounding box of a part in car space (rest pose).
  partBox(id) {
    return this.model.parts[id].bbox;
  }

  updateMass() {
    let m = 0;
    const com = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (const [id, st] of Object.entries(this.parts)) {
      if (!st.installed || !this.PARTS[id]) continue;
      const mass = (st.from ? carType(st.from).PARTS[id] || this.PARTS[id] : this.PARTS[id]).mass;
      const b = this.model.parts[id].bbox;
      if (!b || b.isEmpty()) continue;
      b.getCenter(c);
      com.addScaledVector(c, mass);
      m += mass;
    }
    // the shell's mass sits lower than its bounding box (sills, floor pan, glass is light)
    com.y -= 0.05 * m;
    // fuel
    const fuelMass = this.isInstalled('fueltank') ? this.fuel * 0.74 : 0;
    com.addScaledVector(V(...this.type.fuelCom), fuelMass);
    m += fuelMass;
    // driver
    if (this.game.player && this.game.player.seat) {
      com.addScaledVector(this.type.SEATS[this.game.player.seat].pos.clone().setY(0.6), 80);
      m += 80;
    }
    // whatever is bolted on, strapped down or packed in
    m += accessoryMass(this, com);
    m += plateMass(this, com);
    for (const it of this.attached || []) {
      if (!it.stowed) continue;
      com.addScaledVector(it.stowed.rest, it.mass);
      m += it.mass;
    }
    const packed = this.packedMass();
    com.addScaledVector(V(...(this.type.trunk.com || [0, 0.6, 0])), packed.trunk);
    if (packed.roofbox) com.addScaledVector(this.accessories.roof.center, packed.roofbox);
    m += packed.trunk + packed.roofbox;
    this.packed = packed.trunk + packed.roofbox;
    com.multiplyScalar(1 / Math.max(1, m));
    this.totalMass = m;
    this.dyn.setMassProperties({ mass: Math.max(m, 120), com, size: V(...this.type.massSize) });
  }

  packedMass() {
    const S = this.storage || {};
    return { trunk: (S.trunk ? S.trunk.weight() : 0) + (S.glovebox ? S.glovebox.weight() : 0), roofbox: S.roofbox ? S.roofbox.weight() : 0 };
  }

  rebuildColliders() {
    const list = [];
    this.colliderParts = [];
    for (const [part, c, h, o = {}] of this.type.BOXES) {
      if (!this.isInstalled(part)) continue;
      if (o.closedOnly && this.model.parts[part].openT > 0.08) continue;
      list.push({ part, c, h, o });
    }
    const dyn = this.dyn;
    for (const col of dyn.colliders) this.game.physics.removeCollider(col);
    dyn.colliders = [];
    for (const b of list) {
      let desc = RAPIER.ColliderDesc.cuboid(b.h[0], b.h[1], b.h[2]).setTranslation(b.c[0], b.c[1], b.c[2]);
      if (b.o.rotX) {
        const q = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), b.o.rotX);
        desc = desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      }
      desc.setDensity(0).setFriction(0.6).setRestitution(0.05).setCollisionGroups(GROUPS.car);
      const col = this.game.physics.world.createCollider(desc, dyn.body);
      this.game.physics.setOwner(col, { kind: 'car', car: this, part: b.part, tag: b.o.tag || null });
      dyn.colliders.push(col);
    }
    if (this.plates && this.plates.length) plateColliders(this);
  }

  // ---------------------------------------------------------------- doors etc.
  toggleOpen(id) {
    const p = this.model.parts[id];
    if (!p || !p.hinge || !this.isInstalled(id)) return;
    p.targetOpen = p.openT > 0.5 ? 0 : 1;
    const snd = id.startsWith('door') ? (p.targetOpen ? 'doorOpen' : 'doorClose') : id === 'hood' ? 'hood' : 'trunk';
    this.game.audio && this.game.audio.play(snd, { at: this.worldPointOf(p.hinge.origin) });
  }

  // ------------------------------------------------------------------ stereo
  insertDisc(album) {
    if (this.stereo.disc >= 0) return false;
    Object.assign(this.stereo, { disc: album, track: 0, pos: 0, mode: 'cd' });
    this.radioOn = true;
    return true;
  }

  ejectDisc() {
    const a = this.stereo.disc;
    if (a < 0) return -1;
    Object.assign(this.stereo, { disc: -1, track: 0, pos: 0, mode: 'radio' });
    return a;
  }

  nextTrack() {
    const s = this.stereo;
    if (s.disc < 0) return;
    s.track = (s.track + 1) % 3;
    s.pos = 0;
    s.mode = 'cd';
    s.restart = true;
  }

  // Paints the head unit's dot-matrix display (only when the text changes).
  drawStereo(mat) {
    const t = this.stereoText();
    const key = t.a + '|' + t.b + '|' + (t.t || '');
    if (key === this._stereoKey) return;
    this._stereoKey = key;
    if (!this._stereoCanvas) {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 56;
      this._stereoCanvas = c;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      mat.map = tex;
      mat.emissiveMap = tex;
      mat.color.set(0xffffff);
      mat.emissive.set(0xffffff);
      mat.needsUpdate = true;
      this._stereoTex = tex;
    }
    const c = this._stereoCanvas.getContext('2d');
    c.fillStyle = '#071009';
    c.fillRect(0, 0, 256, 56);
    c.fillStyle = '#7dd3a6';
    c.font = 'bold 22px monospace';
    c.textBaseline = 'middle';
    c.fillText(t.a, 10, 29);
    c.font = 'bold 20px monospace';
    let b = t.b;
    while (c.measureText(b).width > (t.t ? 140 : 190) && b.length > 4) b = b.slice(0, -2) + '\u2026';
    c.fillText(b, 62, 29);
    if (t.t) {
      c.textAlign = 'right';
      c.fillText(t.t, 248, 29);
      c.textAlign = 'left';
    }
    // faint pixel grid
    c.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = 0; x < 256; x += 3) c.fillRect(x, 0, 1, 56);
    this._stereoTex.needsUpdate = true;
  }

  // Text on the head unit's display.
  stereoText() {
    const s = this.stereo;
    if (s.mode === 'cd' && s.disc >= 0) {
      const al = ALBUMS[s.disc % ALBUMS.length];
      if (this.stereoState.loading) return { a: 'CD', b: 'READING\u2026' };
      const p = Math.floor(this.stereoState.pos || 0);
      return { a: `CD  ${String(s.track + 1).padStart(2, '0')}`, b: al.tracks[s.track].toUpperCase(), t: `${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')}` };
    }
    return { a: 'FM', b: '98.1  HAVEN', t: s.disc >= 0 ? 'CD IN' : '' };
  }

  // The luggage space under the front lid is reachable standing at the nose with the lid up.
  canReachTrunk(eye) {
    if (!this.isInstalled('body')) return false;
    if (this.isInstalled('trunk') && this.model.parts.trunk.openT < 0.6) return false;
    return this.worldPointOf(this.type.POINTS.frontTrunk).distanceTo(eye) < 1.9;
  }

  worldPointOf(local) {
    return local.clone().applyMatrix4(this.root.matrixWorld);
  }

  localPointOf(world) {
    return world.clone().applyMatrix4(new THREE.Matrix4().copy(this.root.matrixWorld).invert());
  }

  // ---------------------------------------------------------------- lights
  setupLights() {
    const M = this.model.mats;
    // a beam from each headlamp (each with its own shadows, so posts and bodies throw two soft
    // shadows like real lamps), and a wide dim fill out in front lighting the verge
    const L = this.type.lights;
    this.headLights = [1, -1].map((sg) => {
      const head = new THREE.SpotLight(0xfff1dc, 0, 70, 0.6, 0.55, 1.3);
      head.position.set(L.headX * sg, L.head[1], L.head[2] + 0.06);
      head.target.position.set(L.headX * sg * 0.6, 0.0, 14);
      this.root.add(head, head.target);
      // the real (shadow casting) lights come from the game's light pool
      this.game.lights.add(head, { shadow: true });
      return head;
    });
    this.headLight = this.headLights[0];
    const fill = new THREE.SpotLight(0xffe9d0, 0, 26, 1.15, 0.9, 1.6);
    fill.position.set(L.head[0], L.head[1] + 0.15, L.head[2] + 0.45);
    fill.target.position.set(0, 0, 8);
    this.root.add(fill, fill.target);
    this.headFill = fill;
    const tail = new THREE.PointLight(0xff2010, 0, 6, 2);
    tail.position.copy(this.type.POINTS.tailLights).add(V(0, 0, -0.35));
    this.root.add(tail);
    this.tailLight = tail;
    const reverse = new THREE.SpotLight(0xffffff, 0, 10, 0.9, 0.8, 1.8);
    reverse.position.set(...L.reverse);
    reverse.target.position.set(0, 0, -8);
    this.root.add(reverse, reverse.target);
    this.reverseLight = reverse;
    const cabin = new THREE.PointLight(0xffeccc, 0, 2.6, 1.5);
    cabin.position.copy(this.type.POINTS.dome).add(V(0, -0.08, 0));
    this.root.add(cabin);
    this.cabinLamp = cabin;
    for (const l of [fill, tail, reverse, cabin]) this.game.lights.add(l);
    this.emissive = {
      head: M.headLens,
      tail: M.tailLens,
      gauge: M.gauge,
      needle: M.needle,
      display: M.display,
      dome: M.domeLens,
      lamps: this.model.cluster ? this.model.cluster.userData.lamps : {},
    };
  }

  updateLights(braking, reversing) {
    const powered = this.isInstalled('battery') && this.battery > 0.03;
    const on = powered && this.lightsOn > 0;
    const hiBeam = this.lightsOn === 2;
    const leftH = this.isInstalled('headlight_L'),
      rightH = this.isInstalled('headlight_R');
    const hcount = (leftH ? 1 : 0) + (rightH ? 1 : 0);
    // 6-volt-era lamps: a little dimmer and yellower at idle with a weak battery
    const dim = clamp(this.battery * 3, 0.2, 1) * (this.dyn.engine.running ? 1 : 0.8);
    // +X is the car's left: lamp 0 is the left one
    for (const [i, lamp] of this.headLights.entries()) {
      const lit = on && (i === 0 ? leftH : rightH);
      lamp.intensity = lit ? (hiBeam ? 120 : 72) * dim : 0;
      lamp.distance = hiBeam ? 110 : 65;
      lamp.angle = hiBeam ? 0.5 : 0.6;
      lamp.target.position.y = hiBeam ? 0.6 : 0.0;
    }
    this.headFill.intensity = on ? 26 * (hcount / 2) * dim : 0;
    const e = this.emissive;
    e.head.emissiveIntensity = on ? (hiBeam ? 6.5 : 4.5) * dim : 0;
    // tail lamps and brake lights share the bulb housings
    e.tail.emissiveIntensity = powered ? (braking ? 3.2 : on ? 1.1 : 0) : 0;
    this.tailLight.intensity = powered ? (braking ? 2.2 : on ? 0.7 : 0) : 0;
    this.reverseLight.intensity = powered && reversing ? 12 : 0;
    // instrument lighting and warning lamps
    const ign = powered && this.ignition;
    e.gauge.emissiveIntensity = ign ? (on ? 0.9 : 0.35) : 0.04;
    e.needle.emissiveIntensity = ign && on ? 0.9 : 0;
    const running = this.dyn.engine.running;
    const charging = running && this.isInstalled('fanbelt') && this.fanbeltCondition > 0.02;
    if (e.lamps.gen) e.lamps.gen.emissiveIntensity = ign && !charging ? 2.4 : 0;
    if (e.lamps.oil) e.lamps.oil.emissiveIntensity = ign && (!running || this.oil < 0.6) ? 2.4 : 0;
    e.display.emissiveIntensity = powered && this.radioOn ? 1.6 : 0;
    if (powered && this.radioOn) this.drawStereo(e.display);
    else if (this._stereoKey && this._stereoKey !== 'off') {
      this._stereoKey = 'off';
      const c = this._stereoCanvas.getContext('2d');
      c.fillStyle = '#071009';
      c.fillRect(0, 0, 256, 56);
      this._stereoTex.needsUpdate = true;
    }
    // dome lamp: on while a door is open or switched on
    const doorOpen = ['door_FL', 'door_FR', 'door_RL', 'door_RR'].some((d) => this.model.parts[d] && this.isInstalled(d) && this.model.parts[d].openT > 0.2);
    const cabinOn = powered && (this.cabinLight || doorOpen);
    this.cabinLamp.intensity = cabinOn ? 2.2 : 0;
    e.dome.emissiveIntensity = cabinOn ? 2 : 0;
  }

  // ---------------------------------------------------------------- driving controls
  setIgnition(on) {
    if (on) {
      if (!this.isInstalled('battery') || this.battery < 0.05) {
        this.game.hud && this.game.hud.toast('Battery is dead');
        this.game.audio && this.game.audio.play('click');
        return false;
      }
      this.ignition = true;
      return true;
    }
    this.ignition = false;
    this.dyn.stopEngine();
    this.cranking = 0;
    return true;
  }

  // Hold-to-crank start: returns current state text.
  crank(dt) {
    if (!this.ignition || this.dyn.engine.running) return;
    if (!this.isInstalled('battery') || this.battery < 0.05) return;
    this.cranking += dt;
    this.battery = Math.max(0, this.battery - dt * 0.012);
    this.dyn.engine.omega = Math.max(this.dyn.engine.omega, (260 * 2 * Math.PI) / 60);
    const canRun = this.isInstalled('engine') && this.isInstalled('fueltank') && this.fuel > 0.05 && this.oil > 0.1 && this.engineCondition > 0.03;
    const chance = this.engineCondition * (this.battery > 0.25 ? 1 : 0.4);
    if (canRun && this.cranking > 0.6 + (1 - chance) * 1.6) {
      this.dyn.startEngine();
      this.cranking = 0;
      this.game.audio && this.game.audio.play('engineStart');
    }
  }

  // ---------------------------------------------------------------- simulation
  update(dt, controls) {
    const d = this.dyn;
    // hinge animation
    let collidersDirty = false;
    if (!this.hingedIds) this.hingedIds = Object.keys(this.model.parts).filter((id) => this.model.parts[id].hinge);
    for (const id of this.hingedIds) {
      const p = this.model.parts[id];
      if (!p || !p.hinge || p.targetOpen === undefined) continue;
      const before = p.openT;
      const speed = id.startsWith('door') ? 2.6 : 1.6;
      const t = p.openT + Math.sign(p.targetOpen - p.openT) * Math.min(Math.abs(p.targetOpen - p.openT), dt * speed);
      if (t !== before) {
        // ease
        this.model.setOpen(id, t);
        if ((before <= 0.08) !== (t <= 0.08)) collidersDirty = true;
      }
    }
    if (collidersDirty) this.rebuildColliders();
    // what is packed in the boot changes the mass distribution
    this.massCheck = (this.massCheck || 0) + dt;
    if (this.massCheck > 0.5) {
      this.massCheck = 0;
      const pk = this.packedMass();
      if (Math.abs(pk.trunk + pk.roofbox - (this.packed || 0)) > 0.3) this.updateMass();
    }
    // on its side or roof the engine starves of oil and stalls, and the tank breather weeps fuel
    const upY = 1 - 2 * (this.root.quaternion.x ** 2 + this.root.quaternion.z ** 2);
    this.inverted = upY < 0.3 ? (this.inverted || 0) + dt : 0;
    if (this.inverted > 2.5 && d.engine.running) {
      d.engine.running = false;
      d.onStall && d.onStall();
    }
    if (this.inverted > 0 && this.isInstalled('fueltank')) this.fuel = Math.max(0, this.fuel - dt * 0.03);

    // controls -> dynamics
    const running = d.engine.running;
    const c = controls || { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    const hasDriver = !!controls;
    let throttle = c.throttle,
      brake = c.brake;
    // automatic: reverse when stopped and braking
    if (d.automatic && hasDriver) {
      const v = d.forwardSpeed;
      if (c.reverse) {
        // S pressed: brake while moving forward, reverse when nearly stopped
        if (d.gear >= 2 && v > 0.8) {
          brake = 1;
          throttle = 0;
        } else {
          if (d.gear !== 0 && v < 0.8) d.gear = 0;
          if (d.gear === 0) throttle = c.reverse * 0.6;
        }
      } else if (c.throttle > 0 && d.gear === 0) {
        if (v < -0.8) {
          brake = 1;
          throttle = 0;
        } else d.gear = 2;
      }
    }
    d.controls.throttle = running ? throttle : 0;
    d.controls.brake = brake;
    d.controls.steer = c.steer;
    // nobody at the wheel: the car rolls on (engine braking only) and the parking brake only
    // holds it once it has nearly stopped, so leaving a moving car never stops it dead
    const slow = Math.abs(d.forwardSpeed) < 0.8;
    d.controls.handbrake = c.handbrake || (!hasDriver && !running && slow ? 0.6 : 0);
    if (!hasDriver && slow) d.controls.brake = Math.max(d.controls.brake, 0.3);
    const fuelOk = this.isInstalled('fueltank') && this.fuel > 0;
    d.powerScale = (0.4 + 0.6 * this.engineCondition) * (this.isInstalled('airfilter') ? 1 : 1.03) * (this.engineTemp > 125 ? 0.6 : 1);
    if (running && (!fuelOk || this.oil <= 0.02 || this.engineCondition <= 0.01 || !this.ignition)) {
      d.stopEngine();
      this.game.audio && this.game.audio.play('stall');
    }
    // grip from weather
    const env = this.game.env;
    d.wet = env ? env.w.rain * 0.9 : 0;

    // ---- systems ----
    const rpm = d.engine.rpm;
    const powerKw = running ? Math.max(0, (d.engine.torqueOut * rpm * 2 * Math.PI) / 60 / 1000) : 0;
    const diff = this.game.difficulty || { consumption: 1, wear: 1 };
    if (running) {
      const lph = 0.75 + powerKw * 0.36;
      const burn = Math.min(this.fuel, (lph / 3600) * dt * diff.consumption);
      this.fuel -= burn;
      if (this.game.stats) this.game.stats.fuelUsed += burn;
      this.oil = Math.max(0, this.oil - (0.004 + powerKw * 0.00006) * (dt / 60) * diff.wear * (this.engineCondition < 0.5 ? 2 : 1));
      const belt = this.isInstalled('fanbelt') ? this.fanbeltCondition : 0;
      const oilFrac = clamp(this.oil / this.oilCap, 0, 1);
      const heat = 6 + powerKw * 0.55;
      let coolingCap;
      if ((this.engineType || this.type).cooling === 'water') {
        // the belt turns the water pump; the radiator needs coolant and air (an electric fan
        // cuts in when hot and the battery can run it)
        // a water-cooled engine swapped into a car without a radiator slot brought its own
        const coolFrac = !this.parts.radiator ? 1 : this.isInstalled('radiator') ? clamp(this.coolant / this.coolantCap, 0, 1) : 0;
        const pump = belt > 0.02 ? 1 : 0.15;
        const fanOn = this.engineTemp > 96 && this.isInstalled('battery') && this.battery > 0.05;
        coolingCap = pump * Math.pow(coolFrac, 0.6) * (0.6 + Math.min(1, d.speed / 20) * 0.45 + (fanOn ? 0.4 : 0)) * (0.7 + 0.3 * oilFrac);
        // boiling over loses coolant
        if (this.engineTemp > 112) this.coolant = Math.max(0, this.coolant - dt * 0.004 * (this.engineTemp - 112));
      } else {
        // air cooled by the belt-driven fan, the oil carries the heat
        const fan = belt > 0.02 ? clamp(0.35 + rpm / 3600, 0, 1.6) * (0.6 + 0.4 * belt) : 0;
        coolingCap = (fan * 0.85 + Math.min(1, d.speed / 25) * 0.15) * (0.55 + 0.45 * oilFrac);
      }
      const target = (this.type.cooling === 'water' ? 86 : 82) + Math.max(0, heat - coolingCap * 30) * 2.2 + (env ? env.daylight * 6 : 0);
      this.engineTemp += (target - this.engineTemp) * Math.min(1, dt * 0.05);
      // the belt wears with use and snaps when it is gone
      if (belt > 0) {
        this.fanbeltCondition = Math.max(0, this.fanbeltCondition - dt * 0.0000025 * (rpm / 3000) * diff.wear * (this.engineTemp > 115 ? 3 : 1));
        if (this.fanbeltCondition < 0.02 && belt >= 0.02) {
          this.fanbeltCondition = 0;
          this.game.hud && this.game.hud.toast('Fan belt snapped');
          this.game.audio && this.game.audio.play('hitMetal', { at: this.worldPointOf(this.type.POINTS.engine) });
        }
      }
      // wear & damage
      let wear = 0.0000012 * (1 + powerKw / 40) * diff.wear;
      if (this.engineTemp > 115) wear += 0.00025 * (this.engineTemp - 115) * diff.wear;
      if (this.oil < 0.8) wear += 0.0002 * (0.8 - this.oil) * diff.wear;
      if (!this.isInstalled('airfilter')) wear += 0.000004 * (1 + (env ? env.w.dust * 20 : 0));
      if (env && env.w.dust > 0.3 && this.isInstalled('airfilter')) wear += 0.0000015 * env.w.dust;
      this.engineCondition = Math.max(0, this.engineCondition - wear * dt);
      // the generator charges the battery while the belt turns it
      if (this.isInstalled('battery') && belt > 0.02) this.battery = Math.min(1, this.battery + dt * 0.0012 * (rpm > 1200 ? 1 : 0.3));
      // misfires / backfires at low condition
      if (this.engineCondition < 0.35 && Math.random() < dt * (0.35 - this.engineCondition) * 3) {
        this.game.effects && this.game.effects.backfire(this);
        this.game.audio && this.game.audio.play('backfire', { at: this.root.position });
      }
    } else {
      this.engineTemp += (22 + (env ? env.daylight * 14 : 0) - this.engineTemp) * Math.min(1, dt * 0.004);
    }
    // electrical drain
    if (this.isInstalled('battery')) {
      let drain = 0;
      if (this.lightsOn) drain += this.lightsOn === 2 ? 0.00006 : 0.00004;
      if (this.radioOn) drain += 0.000012;
      if (this.ignition) drain += 0.000008;
      if (!running) this.battery = Math.max(0, this.battery - drain * dt);
    }
    // smoke / fire from a failing engine
    this.smoke = running ? clamp((0.3 - this.engineCondition) * 3, 0, 1) + clamp((this.engineTemp - 112) / 20, 0, 1) : clamp((this.engineTemp - 110) / 20, 0, 1) * 0.6;
    if (this.engineCondition < 0.05 && running && Math.random() < dt * 0.05) this.fire = 1;
    if (this.fire > 0) {
      this.engineCondition = Math.max(0, this.engineCondition - dt * 0.01);
      this.fire = Math.min(1, this.fire + dt * 0.02);
    }
    // odometer
    const p = this.dyn.body.translation();
    const moved = Math.hypot(p.x - this.prevPos.x, p.z - this.prevPos.z);
    if (moved < 5) {
      this.odometer += moved / 1000;
      this.trip += moved / 1000;
    }
    this.prevPos.set(p.x, p.y, p.z);
    // tyre wear from skidding
    for (const w of d.wheels) {
      if (!w.installed) continue;
      const st = this.parts[w.id];
      st.condition = Math.max(0, st.condition - w.skid * dt * 0.0008 * diff.wear);
      w.tyreCondition = st.condition;
      if (st.condition < 0.02) w.flat = true;
    }
    // dust builds up off the asphalt; rain washes it off; drives the paint weathering shader
    const env2 = this.game.env;
    const spd = Math.abs(d.forwardSpeed);
    const surf = (d.wheels[0] && d.wheels[0].surface) || 'asphalt';
    if (spd > 2) this.dirt = Math.min(1, this.dirt + dt * spd * (surf === 'asphalt' ? 0.000004 : 0.00004));
    if (env2 && env2.w.rain > 0.3) this.dirt = Math.max(0.05, this.dirt - dt * 0.004 * env2.w.rain);
    const wu = this.model.mats && this.model.mats.weather;
    if (wu && wu.uDirt) wu.uDirt.value = this.dirt;
    // wipers
    if (this.wipers && this.isInstalled('battery') && this.battery > 0.03) this.wiperPhase += dt * 2.4;
    else if (this.wiperPhase % (Math.PI * 2) > 0.05) this.wiperPhase += dt * 2.4;
    this.updateLights(d.controls.brake > 0.1 && hasDriver, d.gear === 0 && running);
    if (this.model.setGearLever) this.model.setGearLever(d.gear, dt);
    if (this.model.setHandbrake) this.model.setHandbrake(d.controls.handbrake > 0.3 || (!hasDriver && !running), dt);
    this.syncVisual();
  }

  onImpact(imp) {
    // imp.dv in m/s within one physics step
    const severity = imp.dv;
    if (severity < 2.2) return;
    const q = this.root.quaternion.clone().invert();
    const dirLocal = imp.dir.clone().applyQuaternion(q); // direction of velocity change (away from the obstacle)
    const front = dirLocal.z < -0.5; // pushed backwards => hit the front
    const rear = dirLocal.z > 0.5;
    const dmg = (severity - 2.2) * 0.04 * (this.game.difficulty ? this.game.difficulty.damage : 1);
    // what sits behind each bumper depends on the layout (type.crash: 'tank' or 'engine')
    const hit = (what, absorb) => {
      if (what === 'tank') {
        if (this.isInstalled('fueltank') && dmg * absorb > 0.08) this.fuel = Math.max(0, this.fuel - dmg * absorb * 25);
      } else {
        this.engineCondition = Math.max(0, this.engineCondition - dmg * absorb * 0.7);
        // a front-engined car's radiator goes first
        if (this.isInstalled('radiator') && dmg * absorb > 0.05) {
          this.parts.radiator.condition = Math.max(0, this.parts.radiator.condition - dmg * absorb * 2);
          this.coolant = Math.max(0, this.coolant - dmg * absorb * 6);
        }
      }
    };
    if (front) {
      const bar = this.accessories && this.accessories.front && ACCESSORIES[this.accessories.front.id].guard;
      hit(this.type.crash.front, (this.isInstalled('bumper_F') ? 0.5 : 1) * (bar ? 1 - bar : 1) * plateArmour(this, 'front'));
      for (const h of ['headlight_L', 'headlight_R']) if (this.isInstalled(h)) this.parts[h].condition = Math.max(0, this.parts[h].condition - dmg * (bar ? 0.8 : 2));
    } else if (rear) {
      hit(this.type.crash.rear, (this.isInstalled('bumper_R') ? 0.5 : 1) * plateArmour(this, 'rear'));
      for (const h of ['taillight_L', 'taillight_R']) if (this.isInstalled(h)) this.parts[h].condition = Math.max(0, this.parts[h].condition - dmg * 2);
    }
    this.lastImpact = { severity, time: performance.now() };
    this.game.audio && this.game.audio.play(severity > 6 ? 'crashHeavy' : 'crash', { at: this.root.position, volume: clamp(severity / 10, 0.2, 1) });
    this.game.effects && this.game.effects.impactDebris(this, imp, severity);
    this.game.onCarImpact && this.game.onCarImpact(severity);
  }

  // Copy physics state to the visual model.
  // Puts the model where the body is; `smooth`: between the last two physics steps (per frame).
  syncVisual(smooth = false) {
    const b = this.dyn.body;
    if (!this.smooth) this.smooth = this.game.physics.track(b);
    if (smooth) this.game.physics.pose(this.smooth, this.root.position, this.root.quaternion);
    else {
      const t = b.translation(),
        r = b.rotation();
      this.root.position.set(t.x, t.y, t.z);
      this.root.quaternion.set(r.x, r.y, r.z, r.w);
    }
    this.root.updateMatrixWorld(true);
    const mw = this.model.wheels;
    for (const w of this.dyn.wheels) {
      const v = mw[w.id];
      if (!v) continue;
      const vis = this.dyn.wheelVisual(w);
      v.pivot.position.y = vis.y;
      v.knuckle.rotation.y = vis.steer;
      v.spin.rotation.x = v.side > 0 ? vis.spin : -vis.spin;
      if (w.flat) v.spin.scale.set(1, 0.97, 0.97);
    }
    // steering wheel rotates with the road wheels (15:1)
    if (this.model.steeringWheel) {
      const sw = this.model.steeringWheel.children[0];
      if (sw) sw.rotation.z = this.dyn.steerSmoothed * 14;
    }
    // wipers
    if (this.model.wipers && this.model.wipers.userData.wipers) {
      const a = (1 - Math.cos(this.wiperPhase)) * 0.5 * 1.45;
      for (const wg of this.model.wipers.userData.wipers) {
        const piv = wg.userData.pivot,
          ax = wg.userData.axis;
        wg.position.set(0, 0, 0);
        wg.quaternion.setFromAxisAngle(ax, -a);
        // rotate about the pivot point
        const off = piv.clone().sub(piv.clone().applyQuaternion(wg.quaternion));
        wg.position.copy(off);
      }
    }
    // gauges
    const needles = this.model.cluster && this.model.cluster.userData.needles;
    if (needles) {
      const powered = this.ignition && this.isInstalled('battery') && this.battery > 0.03;
      const spd = Math.abs(this.dyn.forwardSpeed) * 3.6;
      setNeedle(needles, 'speed', spd / this.type.SPEEDO_MAX);
      setNeedle(needles, 'fuel', powered ? this.fuel / this.fuelCap : 0);
      setNeedle(needles, 'rpm', powered ? this.dyn.engine.rpm / 8000 : 0);
    }
    // pedals (floor hinged: pressing tips the pad forward)
    if (this.model.pedals) {
      const pd = this.model.pedals.userData.pedals;
      pd.gas.rotation.x = this.dyn.controls.throttle * 0.32;
      pd.brake.rotation.x = this.dyn.controls.brake * 0.28;
      if (pd.clutch) pd.clutch.rotation.x = (1 - this.dyn.clutch) * 0.3 * (this.dyn.engine.running ? 1 : 0);
    }
  }

  get speedKmh() {
    return this.dyn.forwardSpeed * 3.6;
  }

  get position() {
    return this.root.position;
  }

  // World transform of a seat camera.
  seatWorld(seat) {
    return this.type.SEATS[seat].pos.clone().applyMatrix4(this.root.matrixWorld);
  }

  dispose() {
    this.game.physics.untrack(this.smooth);
    for (const l of [...this.headLights, this.headFill, this.tailLight, this.reverseLight, this.cabinLamp]) this.game.lights.remove(l);
    this.dyn.dispose();
    this.root.parent && this.root.parent.remove(this.root);
  }
}

