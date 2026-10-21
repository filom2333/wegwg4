// Scene graph of the Beetle built from the imported asset: every removable piece is a part with
// its own pivot (hinged panels swing about their real hinges), plus the animated controls
// (steering wheel, pedals, gear lever, handbrake, wipers), the gauges and the few components the
// source model lacks (battery, fuel tank, fan belt, radio display).
//
// Model: "Beetle/Fusca (Version 1)" by soujagah, CC-BY-4.0; converted by tools/beetle/import.py.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { roundedBox, tubeAlong } from '../../gfx/geom.js';
import { makeCanvas, canvasTexture } from '../../gfx/textures.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadBeetleTextures, createWreckMaterials } from './beetleMaterials.js';
import { META, SPEC, STEER_SCALE, SPEEDO_MAX, HARDPOINTS, POINTS } from './spec.js';
import { drawSpeedoFace } from '../gauges.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const BASE = (import.meta.env && import.meta.env.BASE_URL ? import.meta.env.BASE_URL : './') + 'models/beetle/';

let assetPromise = null;
// Geometry per part ({ part: [{ geometry, mat }] }) and the texture set; loaded once.
export function loadBeetleAsset(renderer) {
  if (!assetPromise)
    assetPromise = Promise.all([new GLTFLoader().loadAsync(BASE + 'beetle.glb'), loadBeetleTextures(renderer)]).then(([gltf, textures]) => {
      const parts = {};
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const part = o.parent && o.parent.name;
        o.geometry.computeBoundingSphere();
        o.geometry.computeBoundingBox();
        (parts[part] = parts[part] || []).push({ geometry: o.geometry, mat: o.material.name });
      });
      return { parts, textures };
    });
  return assetPromise;
}

function hingeDefs() {
  const H = META.hinges;
  return {
    door_FL: { origin: V(...H.door_FL), axis: V(-0.05, 1, 0).normalize(), max: -1.2 },
    door_FR: { origin: V(...H.door_FR), axis: V(0.05, 1, 0).normalize(), max: 1.2 },
    // front lid hinges at its rear edge under the windscreen, engine lid at its top edge
    trunk: { origin: V(...H.trunk), axis: V(1, 0, 0), max: -1.0 },
    hood: { origin: V(...H.hood), axis: V(1, 0, 0), max: 1.12 },
  };
}

// Parts that come straight from the asset (x_* pieces are animated sub-groups of the body).
const ASSET_PARTS = ['chassis', 'body', 'door_FL', 'door_FR', 'trunk', 'hood', 'fender_FL', 'fender_FR', 'fender_RL', 'fender_RR', 'bumper_F', 'bumper_R', 'headlight_L', 'headlight_R', 'taillight_L', 'taillight_R', 'seat_FL', 'seat_FR', 'seat_R', 'engine', 'airfilter', 'exhaust', 'spare'];

// A group that turns about `pivot` (car space) while its children stay authored in car space.
function pivotGroup(pivot, name) {
  const g = new THREE.Group();
  g.name = name;
  g.position.copy(pivot);
  const holder = new THREE.Group();
  holder.position.copy(pivot).multiplyScalar(-1);
  g.add(holder);
  return { g, holder };
}

// Frame with +Z = n (facing the driver), +Y as close to world up as possible.
function faceQuat(n) {
  const z = n.clone().normalize();
  const y = V(0, 1, 0).addScaledVector(z, -z.y).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export class BeetleModel {
  constructor(asset, mats) {
    this.asset = asset;
    this.mats = mats;
    this.root = new THREE.Group();
    this.root.name = 'car';
    this.parts = {};
    this.hinges = hingeDefs();
    for (const id of ASSET_PARTS) this.addAssetPart(id);
    this.addControls();
    this.addSteeringWheel();
    this.addWheels();
    this.addGauges();
    this.addStereo();
    this.addDomeLamp();
    this.addBattery();
    this.addFuelTank();
    this.addFanBelt();
  }

  meshesFor(id, { shadow = true } = {}) {
    const out = [];
    for (const { geometry, mat } of this.asset.parts[id] || []) {
      let m = this.mats.byName[mat] || this.mats.trim;
      if (mat === 'paint' && id.startsWith('taillight')) m = this.mats.tailLens;
      if (mat === 'lens' && !id.startsWith('headlight')) m = this.mats.glass;
      const mesh = new THREE.Mesh(geometry, m);
      mesh.name = id + ':' + mat;
      const clear = mat === 'glass' || mat === 'lens';
      mesh.castShadow = shadow && !clear;
      mesh.receiveShadow = !clear;
      if (clear) mesh.renderOrder = 2;
      out.push(mesh);
    }
    return out;
  }

  addAssetPart(id) {
    const pivot = new THREE.Group();
    pivot.name = id;
    const inner = new THREE.Group();
    pivot.add(inner);
    const h = this.hinges[id] || null;
    if (h) {
      pivot.position.copy(h.origin);
      inner.position.copy(h.origin).multiplyScalar(-1);
    }
    for (const m of this.meshesFor(id)) inner.add(m);
    this.root.add(pivot);
    this.parts[id] = { id, pivot, inner, hinge: h, openT: 0, installed: true };
    return this.parts[id];
  }

  // Adds a standalone part group (procedural components).
  addPart(id, object, { parent = null } = {}) {
    const pivot = new THREE.Group();
    pivot.name = id;
    const inner = new THREE.Group();
    pivot.add(inner);
    inner.add(object);
    (parent ? this.parts[parent].inner : this.root).add(pivot);
    this.parts[id] = { id, pivot, inner, hinge: null, openT: 0, installed: true, object };
    return this.parts[id];
  }

  bboxOf(id) {
    const b = META.controls[id] || META.parts[id];
    return new THREE.Box3(V(...b.min), V(...b.max));
  }

  // Pedals (floor hinged), gear lever, handbrake and wipers turn about their own pivots.
  addControls() {
    const body = this.parts.body.inner;
    const pedals = new THREE.Group();
    pedals.name = 'pedals';
    const pd = {};
    for (const [key, id] of [
      ['gas', 'x_pedalGas'],
      ['brake', 'x_pedalBrake'],
      ['clutch', 'x_pedalClutch'],
    ]) {
      const b = this.bboxOf(id);
      const c = b.getCenter(V(0, 0, 0));
      const { g, holder } = pivotGroup(V(c.x, b.min.y + 0.008, b.max.z - 0.006), id);
      for (const m of this.meshesFor(id, { shadow: false })) holder.add(m);
      pedals.add(g);
      pd[key] = g;
    }
    pedals.userData.pedals = pd;
    body.add(pedals);
    this.pedals = pedals;
    {
      const b = this.bboxOf('x_gearLever');
      const c = b.getCenter(V(0, 0, 0));
      const { g, holder } = pivotGroup(V(c.x, b.min.y + 0.02, c.z), 'gearLever');
      for (const m of this.meshesFor('x_gearLever', { shadow: false })) holder.add(m);
      body.add(g);
      this.gearLever = g;
      g.userData.top = V(c.x, b.max.y, c.z);
    }
    {
      const b = this.bboxOf('x_handbrake');
      const { g, holder } = pivotGroup(V(0, b.min.y + 0.03, b.min.z + 0.03), 'handbrake');
      for (const m of this.meshesFor('x_handbrake', { shadow: false })) holder.add(m);
      body.add(g);
      this.handbrake = g;
    }
    // wipers sweep about the screen normal through their spindles
    const wipers = new THREE.Group();
    wipers.name = 'wipers';
    const n = V(0, Math.cos(0.775), Math.sin(0.775));
    wipers.userData.wipers = [];
    for (const [id, side] of [
      ['x_wiperL', 'L'],
      ['x_wiperR', 'R'],
    ]) {
      const wg = new THREE.Group();
      wg.name = id;
      for (const m of this.meshesFor(id, { shadow: false })) wg.add(m);
      wg.userData.pivot = V(...META.wipers[side]);
      wg.userData.axis = n.clone();
      wipers.add(wg);
      wipers.userData.wipers.push(wg);
    }
    body.add(wipers);
    this.wipers = wipers;
    // the speedometer housing stays with the dashboard
    for (const m of this.meshesFor('x_speedo', { shadow: false })) body.add(m);
  }

  // Steering wheel part: a frame at the hub (+Z toward the driver, +X to the driver's right);
  // its first child spins about the column. The source rim is scaled up to period size.
  addSteeringWheel() {
    const sw = META.steeringWheel;
    const c = V(...sw.center);
    const frame = new THREE.Group();
    frame.name = 'steeringFrame';
    frame.position.copy(c);
    frame.quaternion.copy(faceQuat(V(...sw.axis)));
    frame.updateMatrix();
    const spinner = new THREE.Group();
    spinner.name = 'steeringSpin';
    spinner.scale.setScalar(STEER_SCALE);
    frame.add(spinner);
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(frame.matrix).invert();
    spinner.add(holder);
    for (const m of this.meshesFor('steeringWheel')) holder.add(m);
    this.addPart('steeringWheel', frame);
    this.steeringWheel = frame;
    // column end: the ignition lock sits on its right
    const col = new THREE.Group();
    col.name = 'steeringColumn';
    col.userData.ignitionPos = V(0.255, 0.915, 0.5);
    this.parts.body.inner.add(col);
    this.steeringColumn = col;
  }

  addWheels() {
    this.wheels = {};
    const tyre = (this.asset.parts.tyre || [])[0];
    for (const h of HARDPOINTS) {
      const side = h.x > 0 ? 1 : -1;
      const pivot = new THREE.Group();
      pivot.name = h.id;
      pivot.position.set(h.x, SPEC.wheelY, h.z);
      const knuckle = new THREE.Group();
      pivot.add(knuckle);
      const spin = new THREE.Group();
      knuckle.add(spin);
      const mesh = new THREE.Mesh(tyre.geometry, this.mats.tyre);
      mesh.name = 'tyre';
      // the source tyre faces +X (the car's left); mirror it for the right side
      mesh.scale.x = side > 0 ? 1 : -1;
      mesh.castShadow = mesh.receiveShadow = true;
      spin.add(mesh);
      this.root.add(pivot);
      this.parts[h.id] = { id: h.id, pivot, inner: knuckle, hinge: null, openT: 0, installed: true };
      this.wheels[h.id] = { pivot, knuckle, spin, side, group: spin };
    }
    this.addWheelWells();
  }

  // Dark wheel-house liners in the arches: without them you could see into the front boot (and
  // the battery) through the arch, especially with a corner jacked up.
  addWheelWells() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x141312, roughness: 1, side: THREE.DoubleSide });
    const R = SPEC.wheelR + 0.1,
      W = 0.26;
    for (const h of HARDPOINTS) {
      const side = h.x > 0 ? 1 : -1;
      const g = new THREE.Group();
      g.position.set(h.x - side * 0.02, SPEC.wheelY + 0.07, h.z);
      // the arched roof of the well over the tyre
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(R, R, W, 20, 1, true, -0.15, Math.PI + 0.3).rotateX(Math.PI / 2).rotateY(Math.PI / 2), mat);
      // and its inner wall, closing the well toward the middle of the car
      const wall = new THREE.Mesh(new THREE.CircleGeometry(R, 20, -0.15, Math.PI + 0.3).rotateY(Math.PI / 2), mat);
      wall.position.x = -side * (W / 2);
      g.add(roof, wall);
      g.traverse((o) => {
        if (o.isMesh) o.receiveShadow = true;
      });
      this.parts.body.inner.add(g);
    }
  }

  // Speedometer face (0-140 km/h with the fuel gauge in its top arc), needles and two warning
  // lamps (generator red, oil green), laid over the asset's dial.
  addGauges() {
    const s = META.speedo;
    const M = this.mats;
    const g = new THREE.Group();
    g.name = 'cluster';
    g.position.copy(V(...s.center)).addScaledVector(V(...s.normal), 0.004);
    g.quaternion.copy(faceQuat(V(...s.normal)));
    const R = s.radius * 0.93;
    const c = makeCanvas(512, 512);
    drawSpeedoFace(c.getContext('2d'), 512, SPEEDO_MAX);
    const tex = canvasTexture(c, { wrap: false });
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    M.gauge.map = tex;
    M.gauge.emissiveMap = tex;
    const face = new THREE.Mesh(new THREE.CircleGeometry(R, 48), M.gauge);
    g.add(face);
    const needles = {};
    const needle = (name, len, w, z) => {
      const pivot = new THREE.Group();
      pivot.position.z = z;
      const geo = new THREE.PlaneGeometry(w, len).translate(0, len / 2 - len * 0.12, 0);
      pivot.add(new THREE.Mesh(geo, M.needle));
      g.add(pivot);
      needles[name] = pivot;
      return pivot;
    };
    needle('speed', R * 0.86, R * 0.045, 0.0015);
    const fuel = needle('fuel', R * 0.26, R * 0.035, 0.001);
    fuel.position.y = R * 0.5;
    const cap = new THREE.Mesh(new THREE.CircleGeometry(R * 0.07, 16), M.black);
    cap.position.z = 0.0022;
    g.add(cap);
    const lamps = {};
    for (const [name, x, col] of [
      ['gen', -0.36, 0xff2a10],
      ['oil', 0.36, 0x2aff4a],
    ]) {
      const mat = M.lamp.clone();
      mat.emissive.setHex(col);
      mat.color.setHex(col).multiplyScalar(0.12);
      const l = new THREE.Mesh(new THREE.CircleGeometry(R * 0.075, 16), mat);
      l.position.set(x * R, -R * 0.42, 0.0012);
      g.add(l);
      lamps[name] = mat;
    }
    g.userData.needles = needles;
    g.userData.lamps = lamps;
    this.parts.body.inner.add(g);
    this.cluster = g;
  }

  // Dot-matrix display and CD slot set into the radio faceplate.
  addStereo() {
    const r = META.dash.radio;
    const c = V(...r.center);
    const g = new THREE.Group();
    g.name = 'stereo';
    g.position.copy(c).add(V(0, 0.002, -0.0045));
    g.quaternion.copy(faceQuat(V(0, 0, -1)));
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.074, 0.017), this.mats.display);
    disp.position.set(0, 0.004, 0);
    g.add(disp);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.0028, 0.002), this.mats.black);
    slot.position.set(0, -0.013, 0.0005);
    g.add(slot);
    this.parts.body.inner.add(g);
    this.stereo = g;
  }

  addDomeLamp() {
    const g = new THREE.Mesh(roundedBox(0.12, 0.016, 0.05, 0.006, 2), this.mats.domeLens);
    g.position.copy(POINTS.dome);
    this.parts.body.inner.add(g);
  }

  // 6 V-era tray converted to 12 V: battery stands in the front trunk beside the spare wheel.
  addBattery() {
    const M = this.mats;
    const g = new THREE.Group();
    const x = 0.405,
      y = 0.585,
      z = 1.33;
    const lab = makeCanvas(256, 128);
    {
      const ctx = lab.getContext('2d');
      ctx.fillStyle = '#121212';
      ctx.fillRect(0, 0, 256, 128);
      ctx.fillStyle = '#c8402a';
      ctx.fillRect(0, 0, 256, 24);
      ctx.fillStyle = '#e8e2d4';
      ctx.font = 'bold 34px Arial';
      ctx.fillText('VOLTEX', 14, 70);
      ctx.font = '20px Arial';
      ctx.fillText('12V  45Ah', 14, 104);
    }
    const labMat = new THREE.MeshStandardMaterial({ map: canvasTexture(lab, { wrap: false }), roughness: 0.55 });
    labMat.map.colorSpace = THREE.SRGBColorSpace;
    const bodyG = roundedBox(0.15, 0.17, 0.24, 0.007, 2);
    const uv = bodyG.attributes.uv,
      ps = bodyG.attributes.position;
    for (let i = 0; i < ps.count; i++) uv.setXY(i, -ps.getZ(i) / 0.24 + 0.5, ps.getY(i) / 0.17 + 0.5);
    bodyG.translate(x, y, z);
    const add = (geo, mat, cast = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    add(bodyG, labMat);
    add(roundedBox(0.152, 0.018, 0.242, 0.006, 2).translate(x, y + 0.09, z), M.plastic);
    const red = new THREE.MeshStandardMaterial({ color: 0xb3261b, roughness: 0.5 });
    for (const [dz, mat] of [
      [0.075, red],
      [-0.075, M.plastic],
    ]) {
      add(new THREE.CylinderGeometry(0.01, 0.012, 0.022, 12).translate(x - 0.03, y + 0.108, z + dz), M.steel, false);
      add(roundedBox(0.03, 0.018, 0.032, 0.005, 2).translate(x - 0.03, y + 0.118, z + dz), mat, false);
    }
    add(tubeAlong([V(x - 0.03, y + 0.125, z + 0.075), V(x - 0.08, y + 0.15, z + 0.0), V(x - 0.14, y + 0.08, z - 0.2), V(x - 0.15, 0.52, z - 0.4)], 0.007, 8), red, false);
    add(tubeAlong([V(x - 0.03, y + 0.125, z - 0.075), V(x - 0.02, y + 0.1, z - 0.16), V(x + 0.02, 0.52, z - 0.2)], 0.007, 8), M.plastic, false);
    this.addPart('battery', g);
  }

  // Flat tank across the back of the front trunk, filler neck on the right.
  addFuelTank() {
    const M = this.mats;
    const g = new THREE.Group();
    const tankMat = new THREE.MeshStandardMaterial({ color: 0x2d2f2c, metalness: 0.55, roughness: 0.55 });
    const t = roundedBox(0.78, 0.24, 0.32, 0.05, 3);
    // taper the front face down toward the spare wheel
    const p = t.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const zz = p.getZ(i),
        yy = p.getY(i);
      if (zz > 0.05 && yy > 0) p.setY(i, yy - (zz - 0.05) * 0.45);
      const xx = p.getX(i);
      if (yy < -0.05) p.setX(i, xx * 0.86);
    }
    t.computeVertexNormals();
    t.translate(0, 0.625, 0.85);
    const m = new THREE.Mesh(t, tankMat);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    // seam flange
    const fl = new THREE.Mesh(roundedBox(0.8, 0.012, 0.335, 0.005, 1).translate(0, 0.63, 0.85), tankMat);
    g.add(fl);
    // filler neck and cap
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.1, 18).translate(-0.22, 0.78, 0.86), M.steel);
    g.add(neck);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.022, 20).translate(-0.22, 0.836, 0.86), M.chrome);
    cap.castShadow = true;
    g.add(cap);
    // sender unit and fuel line
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 16).translate(0.16, 0.74, 0.84), M.steel));
    g.add(new THREE.Mesh(tubeAlong([V(0.05, 0.52, 0.72), V(0.03, 0.46, 0.68), V(0, 0.4, 0.62)], 0.005, 6), M.black));
    this.addPart('fueltank', g);
  }

  // V-belt from the crank pulley up to the generator, which also drives the cooling fan.
  addFanBelt() {
    const a = { c: V(0.02, 0.5, -1.668), r: 0.062 };
    const b = { c: V(-0.07, 0.7, -1.658), r: 0.05 };
    const pts = [];
    const d = b.c.clone().sub(a.c);
    const L = d.length();
    const ang = Math.atan2(d.y, d.x);
    const beta = Math.acos((a.r - b.r) / L);
    const arc = (cc, r, a0, a1, n) => {
      for (let i = 0; i <= n; i++) {
        const t = a0 + ((a1 - a0) * i) / n;
        pts.push(V(cc.x + Math.cos(t) * r, cc.y + Math.sin(t) * r, 0));
      }
    };
    arc(a.c, a.r, ang + beta, ang + Math.PI * 2 - beta, 18);
    arc(b.c, b.r, ang - beta, ang + beta, 10);
    pts.push(pts[0].clone());
    // straight runs are implied between the arcs; tubeAlong smooths the joins
    const geo = tubeAlong(pts, 0.0055, 6, { closedEnds: false });
    geo.scale(1, 1, 0.6);
    geo.translate(0, 0, (a.c.z + b.c.z) / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.8 }));
    m.castShadow = true;
    this.addPart('fanbelt', m);
  }

  setOpen(partId, t) {
    const p = this.parts[partId];
    if (!p || !p.hinge) return;
    p.openT = t;
    p.pivot.quaternion.setFromAxisAngle(p.hinge.axis, p.hinge.max * t);
  }

  setInstalled(partId, on) {
    const p = this.parts[partId];
    if (!p) return;
    p.installed = on;
    p.pivot.visible = on;
  }

  // Gear lever position: H pattern (1-2 left plane, 3-4 right, reverse far left and back).
  setGearLever(gear, dt = 1) {
    const g = this.gearLever;
    if (!g) return;
    const T = { 0: [-0.3, -0.24], 1: [0, 0], 2: [-0.15, 0.27], 3: [-0.15, -0.27], 4: [0.13, 0.27], 5: [0.13, -0.27] }[gear] || [0, 0];
    const k = Math.min(1, dt * 14);
    g.rotation.z += (T[0] - g.rotation.z) * k;
    g.rotation.x += (T[1] - g.rotation.x) * k;
  }

  setHandbrake(on, dt = 1) {
    if (!this.handbrake) return;
    const target = on ? -0.32 : 0;
    this.handbrake.rotation.x += (target - this.handbrake.rotation.x) * Math.min(1, dt * 10);
  }
}

// Builds the complete visual model (all parts installed) with rest-pose bounding boxes.
export function buildBeetleModel(asset, mats) {
  const m = new BeetleModel(asset, mats);
  m.type = { SPEC };
  m.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const inv = new THREE.Matrix4().copy(m.root.matrixWorld).invert();
  for (const p of Object.values(m.parts)) {
    box.makeEmpty();
    p.pivot.updateMatrixWorld(true);
    p.inner.traverse((o) => {
      if (o.isMesh && o.geometry) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        box.union(o.geometry.boundingBox.clone().applyMatrix4(inv.clone().multiply(o.matrixWorld)));
      }
    });
    p.bbox = box.clone();
  }
  return m;
}

// Roadside wreck: shell, fenders, one door, seats and the platform, merged into one mesh per
// material; no glass, flat tyres. userData.paint is the material to recolour per wreck.
export function buildBeetleWreck(asset) {
  const M = createWreckMaterials(asset.textures);
  const keep = ['chassis', 'body', 'door_FR', 'fender_FL', 'fender_FR', 'fender_RL', 'fender_RR', 'bumper_R', 'trunk', 'seat_FL', 'seat_R', 'x_speedo', 'x_gearLever', 'x_pedalGas', 'x_pedalBrake', 'x_pedalClutch', 'engine'];
  const byMat = {};
  for (const id of keep)
    for (const { geometry, mat } of asset.parts[id] || []) {
      if (mat === 'glass' || mat === 'lens') continue;
      (byMat[mat] = byMat[mat] || []).push(geometry);
    }
  const g = new THREE.Group();
  for (const [mat, list] of Object.entries(byMat)) {
    const geo = mergeGeometries(list, false);
    if (!geo) continue;
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, M[mat] || M.trim);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.shared = true;
    g.add(m);
  }
  const tyre = (asset.parts.tyre || [])[0];
  if (tyre)
    for (const h of HARDPOINTS) {
      const t = new THREE.Mesh(tyre.geometry, M.tyre);
      t.scale.set(h.x > 0 ? 1 : -1, 0.86, 1);
      t.position.set(h.x, SPEC.wheelY * 0.82, h.z);
      t.rotation.x = Math.random() * 6;
      t.castShadow = true;
      t.userData.shared = true;
      g.add(t);
    }
  // not in userData: Object3D.clone() deep-copies userData through JSON, which would serialise
  // the material's textures for every wreck placed
  Object.defineProperty(g, 'wreckPaint', { value: M.paint, enumerable: false });
  return g;
}
