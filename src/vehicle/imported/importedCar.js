// Cars converted by tools/cars (the '88 sedan): loading, materials and the scene graph with
// the same interface as the Beetle's model, so the car, the player's hands and the inspector
// treat every car type alike. A type supplies the measured META and its own procedural extras.

import { runExtras } from '../extrasCache.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { roundedBox, roundRectShape } from '../../gfx/geom.js';
import { makeCanvas, canvasTexture } from '../../gfx/textures.js';
import { applyWeathering, weatheringUniforms } from '../weathering.js';
import { buildCluster } from '../cluster.js';
import { cutOpening, buildFiller } from '../fillerCut.js';
import { movePieces } from './pieces.js';
import { findWindows, addCranks } from '../winders.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const BASE = (import.meta.env && import.meta.env.BASE_URL ? import.meta.env.BASE_URL : './') + 'models/';

// ---------------------------------------------------------------------------- loading
const cache = new Map();
export function loadImportedAsset(type, renderer) {
  if (!cache.has(type.id))
    cache.set(
      type.id,
      (async () => {
        const dir = BASE + type.id + '/';
        const [gltf, textures] = await Promise.all([new GLTFLoader().loadAsync(dir + type.id + '.glb'), loadTextures(dir, type.META.materials, renderer)]);
        const parts = {};
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          const part = o.parent && o.parent.name;
          o.geometry.computeBoundingBox();
          o.geometry.computeBoundingSphere();
          (parts[part] = parts[part] || []).push({ geometry: o.geometry, mat: o.material.name });
        });
        // what the converter left in the wrong part (type.PIECES: see pieces.js)
        if (type.PIECES) movePieces(parts, type.PIECES);
        return { parts, textures };
      })()
    );
  return cache.get(type.id);
}

async function loadTextures(dir, mats, renderer) {
  const loader = new THREE.TextureLoader();
  const aniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
  const files = new Set();
  for (const m of Object.values(mats)) for (const k of ['map', 'normalMap', 'mrMap']) if (m[k]) files.add(m[k]);
  const out = {};
  await Promise.all(
    [...files].map(async (f) => {
      const t = await loader.loadAsync(dir + f);
      t.flipY = false; // glTF uv convention
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = f.includes('_color') ? aniso : Math.min(4, aniso);
      if (f.includes('_color')) t.colorSpace = THREE.SRGBColorSpace;
      out[f] = t;
    })
  );
  return out;
}

// ---------------------------------------------------------------------------- materials
// roles (type.MATERIAL_ROLES): paint (flat repaintable coat), body (textured shell), glass,
// lens (glows with the headlamps), tail (glows red from its own texture), tyre, trim (anything
// else); weathering strength per role.
const WEATHER = { paint: 1, body: 0.7, under: 1.1, trim: 0.5, interior: 0, tyre: 0.6 };

export function createImportedMaterials(type, asset, opts = {}) {
  const T = asset.textures;
  const M = type.META.materials;
  const roles = type.MATERIAL_ROLES;
  const weather = weatheringUniforms(opts.weather);
  const color = new THREE.Color(opts.color ?? type.defaultColor);
  const textured = (key, extra = {}) => {
    const d = M[key] || {};
    const params = {
      map: T[d.map] || null,
      normalMap: T[d.normalMap] || null,
      roughnessMap: T[d.mrMap] || null,
      metalnessMap: T[d.mrMap] || null,
      metalness: d.metalness ?? 1,
      roughness: d.roughness ?? 1,
      side: THREE.DoubleSide,
      ...extra,
    };
    if (d.color && !extra.color) params.color = new THREE.Color(d.color[0], d.color[1], d.color[2]);
    return params;
  };
  const byName = {};
  for (const key of type.META.keys) {
    const role = roles[key] || 'trim';
    let m;
    if (role === 'paint') {
      m = new THREE.MeshPhysicalMaterial({ ...textured(key), metalness: 0.35, roughness: 0.34, clearcoat: 0.8, clearcoatRoughness: 0.14 });
      m.color = color; // shared: a repaint recolours every painted part
    } else if (role === 'glass') {
      const d = M[key] || {};
      m = new THREE.MeshStandardMaterial({
        map: T[d.map] || null,
        color: new THREE.Color(0.62, 0.68, 0.7),
        metalness: 0,
        roughness: 0.05,
        transparent: true,
        opacity: type.glassOpacity ?? 0.3,
        envMapIntensity: 1.5,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
    } else if (role === 'lens') {
      m = new THREE.MeshStandardMaterial({ ...textured(key), transparent: true, opacity: 0.7, roughness: 0.05, metalness: 0, emissive: 0xfff1d6, emissiveIntensity: 0, depthWrite: false });
      m.emissiveMap = m.map;
    } else if (role === 'tail') {
      m = new THREE.MeshStandardMaterial({ ...textured(key), emissive: 0xffffff, emissiveIntensity: 0 });
      m.emissiveMap = m.map;
      if (type.tailTint) m.emissive.setHex(type.tailTint);
    } else if (role === 'tyre') {
      m = new THREE.MeshStandardMaterial({ ...textured(key), side: THREE.FrontSide });
    } else m = new THREE.MeshStandardMaterial(textured(key));
    if (role === 'interior') {
      // plastic, vinyl and cloth: the sources mark some cabins as metal, which goes black inside
      // a car with little to reflect
      m.metalnessMap = null;
      m.metalness = Math.min(m.metalness, 0.05);
      // and a cabin lighter than its source (the colour multiplies the texture)
      if (type.interiorLift) m.color.multiplyScalar(type.interiorLift);
    }
    // (rust shows on steel: the paint, the body and the underside, not on plastic trim and chrome)
    if (WEATHER[role] || (role === 'trim' && key === 'under')) applyWeathering(m, weather, { rustColor: role !== 'trim' || key === 'under', strength: WEATHER[role] ?? WEATHER.under });
    m.name = key;
    byName[key] = m;
  }
  const paintKey = type.META.keys.find((k) => roles[k] === 'paint') || type.META.keys.find((k) => roles[k] === 'body');
  // the lamp lenses each car needs even if the source shares a material with something else
  const headLens = byName[type.META.keys.find((k) => roles[k] === 'lens')] || new THREE.MeshStandardMaterial({ color: 0xf4f6f8, transparent: true, opacity: 0.45, emissive: 0xfff1d6, emissiveIntensity: 0 });
  const tailLens = byName[type.META.keys.find((k) => roles[k] === 'tail')] || new THREE.MeshStandardMaterial({ color: 0x5a0a06, emissive: 0xff1a08, emissiveIntensity: 0 });
  // turn signals blink one side at a time: the amber lenses (type.SIGNAL_KEY) and the tail lamps
  // get a material for each side
  const tailKey = type.META.keys.find((k) => roles[k] === 'tail');
  const signal = { amber: byName[type.SIGNAL_KEY] ? type.SIGNAL_KEY : null, tail: tailKey || null };
  for (const side of ['L', 'R']) {
    if (signal.amber) {
      const m = byName[signal.amber].clone();
      m.emissive = new THREE.Color(0xff6200);
      m.emissiveIntensity = 0;
      signal['amber' + side] = m;
    }
    signal['tail' + side] = tailLens.clone();
  }
  const gauge = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, emissive: 0xfff4dc, emissiveIntensity: 0.25, transparent: true });
  const needle = new THREE.MeshStandardMaterial({ color: 0xff6a20, roughness: 0.4, emissive: 0xff8040, emissiveIntensity: 0 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0x220a06, emissive: 0xff2a10, emissiveIntensity: 0, roughness: 0.3 });
  const display = new THREE.MeshStandardMaterial({ color: 0x0d140f, roughness: 0.3, emissive: 0x000000, emissiveIntensity: 0 });
  const domeLens = new THREE.MeshStandardMaterial({ color: 0xece6d6, roughness: 0.4, emissive: 0xfff0d0, emissiveIntensity: 0 });
  return {
    byName,
    paintables: new Set(type.META.keys.filter((k) => roles[k] === 'paint').map((k) => byName[k])),
    paint: byName[paintKey],
    color,
    weather,
    glass: byName[type.META.keys.find((k) => roles[k] === 'glass')],
    headLens,
    tailLens,
    signal,
    tyre: byName[type.META.keys.find((k) => roles[k] === 'tyre')],
    gauge,
    needle,
    lamp,
    display,
    domeLens,
    black: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.7 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8c8f92, metalness: 0.85, roughness: 0.38 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd9dcde, metalness: 1, roughness: 0.12 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x1a1b1c, roughness: 0.55 }),
    alu: new THREE.MeshStandardMaterial({ color: 0x9a9c9e, metalness: 0.7, roughness: 0.45 }),
    engine: new THREE.MeshStandardMaterial({ color: 0x3a3b3c, metalness: 0.5, roughness: 0.55 }),
  };
}

// ---------------------------------------------------------------------------- model
// Which side of the car a part's piece is on (+X is the car's left): from the part's name, or
// where the piece itself lies; '' for one in the middle (a third brake light).
function sideOf(id, geometry) {
  const m = /_[FR]?([LR])$/.exec(id);
  if (m) return m[1];
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const x = (geometry.boundingBox.max.x + geometry.boundingBox.min.x) / 2;
  return x > 0.15 ? 'L' : x < -0.15 ? 'R' : '';
}

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
export function faceQuat(n) {
  const z = n.clone().normalize();
  const y = V(0, 1, 0).addScaledVector(z, -z.y).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export class ImportedCarModel {
  constructor(type, asset, mats) {
    this.type = type;
    this.asset = asset;
    this.mats = mats;
    this.root = new THREE.Group();
    this.root.name = 'car';
    this.parts = {};
    this.hinges = {};
    const H = type.META.hinges;
    for (const [id, h] of Object.entries(type.HINGES)) this.hinges[id] = { origin: V(...H[id]), axis: V(...h.axis).normalize(), max: h.max };
    for (const id of Object.keys(asset.parts)) if (id !== 'tyre' && id !== 'steeringWheel' && !id.startsWith('x_')) this.addAssetPart(id);
    this.addControls();
    this.addMovingControls();
    this.addSteeringWheel();
    this.addWheels();
    this.addGauges();
    this.addFiller();
    findWindows(this);
    addCranks(this, type.CRANKS, mats);
    this.addWipers();
    this.addStereo();
    this.addDomeLamp();
    runExtras(type, this, mats);
  }

  meshesFor(id, { shadow = true } = {}) {
    const out = [];
    for (const { geometry, mat } of this.asset.parts[id] || []) {
      let m = this.mats.byName[mat] || this.mats.plastic;
      const S = this.mats.signal;
      const side = S && (mat === S.amber || mat === S.tail) ? sideOf(id, geometry) : '';
      if (side) m = S[(mat === S.amber ? 'amber' : 'tail') + side];
      const mesh = new THREE.Mesh(geometry, m);
      mesh.name = id + ':' + mat;
      const clear = m.transparent;
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
    const b = this.type.META.controls[id] || this.type.META.parts[id];
    return new THREE.Box3(V(...b.min), V(...b.max));
  }

  // Pedals (floor hinged) and the gear lever from the source where it has them, simple pads
  // where it does not.
  addControls() {
    const body = this.parts.body.inner;
    const pedals = new THREE.Group();
    pedals.name = 'pedals';
    const pd = {};
    const C = this.type.META.controls || {};
    const P = this.type.PEDALS || {};
    for (const [key, id] of [
      ['gas', 'x_pedalGas'],
      ['brake', 'x_pedalBrake'],
      ['clutch', 'x_pedalClutch'],
    ]) {
      if (C[id]) {
        const b = this.bboxOf(id);
        const c = b.getCenter(V(0, 0, 0));
        const { g, holder } = pivotGroup(V(c.x, b.min.y + 0.008, b.max.z - 0.006), id);
        for (const m of this.meshesFor(id, { shadow: false })) holder.add(m);
        pedals.add(g);
        pd[key] = g;
      } else if (P[key]) {
        const p = V(...P[key]);
        const g = new THREE.Group();
        g.position.copy(p).add(V(0, -0.08, 0.04));
        const pad = new THREE.Mesh(roundedBox(key === 'gas' ? 0.05 : 0.07, 0.075, 0.012, 0.004, 1), this.mats.rubber);
        pad.position.set(0, 0.08, -0.04);
        pad.rotation.x = -0.5;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.16, 0.014), this.mats.black);
        arm.position.set(0, 0.12, 0.0);
        arm.rotation.x = -0.35;
        g.add(pad, arm);
        pedals.add(g);
        pd[key] = g;
      }
    }
    pedals.userData.pedals = pd;
    body.add(pedals);
    this.pedals = pedals;
    if (C.x_gearLever) {
      const b = this.bboxOf('x_gearLever');
      const c = b.getCenter(V(0, 0, 0));
      const { g, holder } = pivotGroup(V(c.x, b.min.y - 0.12, c.z), 'gearLever');
      for (const m of this.meshesFor('x_gearLever', { shadow: false })) holder.add(m);
      body.add(g);
      this.gearLever = g;
      g.userData.top = V(c.x, b.max.y, c.z);
    }
  }

  // The driver's controls that move (type.MOVING): the source's own pieces where it has them
  // (x_key, x_stalk, ...), simple stand-ins (MOVING[id].make) where it does not. Pivots and axes
  // are in car space; door handles ride on their doors.
  addMovingControls() {
    this.moving = {};
    for (const [id, d] of Object.entries(this.type.MOVING || {})) {
      const src = this.asset.parts['x_' + id];
      const parent = d.door ? this.parts[d.door] && this.parts[d.door].inner : this.parts.body.inner;
      if ((!src && !d.make) || !parent) continue;
      const { g, holder } = pivotGroup(d.pivot, 'ctl_' + id);
      if (src) for (const m of this.meshesFor('x_' + id, { shadow: false })) holder.add(m);
      else this.makeControl(d, holder, parent);
      parent.add(g);
      this.moving[id] = { g, d, axis: (d.axis || V(0, 0, 1)).clone().normalize(), v: 0 };
    }
  }

  // Stand-ins in car space: a key in a chrome lock ring, a column stalk, a parking brake pedal.
  makeControl(d, holder, parent) {
    const M = this.mats;
    const n = (d.axis || V(0, 0, 1)).clone().normalize();
    if (d.make === 'key') {
      // (the ring stays put, the key turns)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.015, 0.0032, 8, 24), M.chrome);
      ring.position.copy(d.pivot);
      ring.quaternion.copy(faceQuat(n.clone().negate()));
      parent.add(ring);
      const k = new THREE.Group();
      k.position.copy(d.pivot);
      k.quaternion.copy(faceQuat(n.clone().negate()));
      const head = new THREE.Mesh(roundedBox(0.009, 0.032, 0.026, 0.004, 2), M.plastic);
      head.position.set(0, 0.004, 0.024);
      const shank = new THREE.Mesh(new THREE.BoxGeometry(0.0035, 0.009, 0.014), M.steel);
      shank.position.set(0, 0, 0.007);
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.007, 0.0012, 6, 16), M.steel);
      loop.position.set(0, -0.004, 0.042);
      loop.rotation.y = Math.PI / 2;
      k.add(head, shank, loop);
      holder.add(k);
    } else if (d.make === 'stalk') {
      // a black stalk out of the column shroud, thicker at the tip
      const dir = d.dir.clone().normalize();
      const L = d.length || 0.12;
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0055, L, 10), M.plastic);
      rod.position.copy(d.pivot).addScaledVector(dir, L / 2);
      rod.quaternion.copy(q);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.008, 0.034, 12), M.plastic);
      tip.position.copy(d.pivot).addScaledVector(dir, L - 0.012);
      tip.quaternion.copy(q);
      holder.add(rod, tip);
    } else if (d.make === 'knob') {
      // a ribbed knob standing out of the dash, a white mark on its face
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), n.clone().negate());
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.0135, 0.014, 18), M.plastic);
      knob.position.copy(d.pivot).addScaledVector(n, -0.007);
      knob.quaternion.copy(q);
      M.markWhite = M.markWhite || new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.6 });
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.0025, 0.0012, 0.009), M.markWhite);
      mark.position.copy(d.pivot).addScaledVector(n, -0.0142);
      mark.quaternion.copy(faceQuat(n.clone().negate()));
      mark.translateY(0.006);
      mark.rotateX(Math.PI / 2);
      holder.add(knob, mark);
    } else if (d.make === 'button') {
      // the hazard button: red, a little proud of the panel
      M.hazardRed = M.hazardRed || new THREE.MeshStandardMaterial({ color: 0x9a1c12, roughness: 0.45 });
      const b = new THREE.Mesh(roundedBox(0.03, 0.018, 0.01, 0.003, 2), M.hazardRed);
      b.position.copy(d.pivot).addScaledVector(n, -0.004);
      b.quaternion.copy(faceQuat(n.clone().negate()));
      holder.add(b);
    } else if (d.make === 'handle') {
      // a chrome lever in a dark recess on the door panel, hinged at its front end
      const along = d.at.clone().sub(d.pivot);
      const len = along.length() * 2;
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), along.clone().normalize());
      const bar = new THREE.Mesh(roundedBox(0.011, 0.016, len, 0.004, 2), M.chrome);
      bar.position.copy(d.at);
      bar.quaternion.copy(q);
      holder.add(bar);
      const cup = new THREE.Mesh(roundedBox(0.006, 0.032, len + 0.02, 0.003, 1), M.black);
      cup.position.copy(d.at).add(V(Math.sign(d.at.x) * 0.007, 0, 0));
      cup.quaternion.copy(q);
      parent.add(cup);
    } else if (d.make === 'handbrake') {
      // a hand lever on a console between the front seats: the console stands on the tunnel, the
      // lever is hinged at its back end, the grip and its release button forward
      const along = d.at.clone().sub(d.pivot);
      const L = along.length();
      const dir = along.clone().normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir);
      const h = d.pivot.y - d.floor - 0.015;
      const box = new THREE.Mesh(roundedBox(0.1, h, L + 0.16, 0.012, 2), M.black);
      box.position.set(d.pivot.x, d.floor + h / 2, d.pivot.z + dir.z * (L / 2) - 0.02);
      parent.add(box);
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.006, L * 0.7), M.rubber);
      slot.position.set(d.pivot.x, d.floor + h + 0.002, d.pivot.z + dir.z * (L * 0.45));
      parent.add(slot);
      const lever = new THREE.Group();
      lever.position.copy(d.pivot);
      lever.quaternion.copy(q);
      const bar = new THREE.Mesh(roundedBox(0.022, 0.026, L, 0.006, 2), M.black);
      bar.position.set(0, 0.006, L / 2);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.016, 0.11, 14).rotateX(Math.PI / 2), M.rubber);
      grip.position.set(0, 0.008, L - 0.05);
      const button = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 10).rotateX(Math.PI / 2), M.chrome);
      button.position.set(0, 0.008, L + 0.008);
      const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 12).rotateZ(Math.PI / 2), M.steel);
      lever.add(bar, grip, button, knuckle);
      holder.add(lever);
    } else if (d.make === 'pedal') {
      // hung from the pivot, the pad facing the driver's foot
      const pad = new THREE.Mesh(roundedBox(0.052, 0.062, 0.012, 0.004, 1), M.rubber);
      pad.position.copy(d.at);
      pad.rotation.x = -0.45;
      const arm = d.pivot.clone().sub(d.at);
      const rod = new THREE.Mesh(new THREE.BoxGeometry(0.012, arm.length(), 0.012), M.black);
      rod.position.copy(d.at).addScaledVector(arm, 0.5);
      rod.quaternion.setFromUnitVectors(V(0, 1, 0), arm.normalize());
      holder.add(pad, rod);
    }
  }

  // Each frame: the key to OFF / ON / START, the stalk up or down with the turn signal, knobs
  // to their settings, the hazard button in while it is on, a door handle pulled, the parking
  // brake on or off. `s` holds the car's state.
  updateMoving(s, dt) {
    const k = Math.min(1, dt * 14);
    for (const [id, c] of Object.entries(this.moving)) {
      const d = c.d;
      let to = 0;
      if (id === 'key') to = d.angles[s.cranking ? 2 : s.ignition ? 1 : 0];
      else if (id === 'stalk') to = -s.indicator * d.angle;
      else if (id === 'lever') to = s.wipers ? d.angle * (0.4 + 0.2 * s.wipers) : 0;
      else if (id === 'lightKnob') to = d.angles[s.lightsOn] || 0;
      else if (id === 'heater') to = s.heater ? d.angle : 0;
      else if (id === 'hazard') to = s.hazards ? 1 : 0;
      else if (id === 'park') to = s.parkBrake ? d.angle : 0;
      else if (id.startsWith('handle')) to = (s.handlePull[d.door] > 0 ? 1 : 0) * d.angle;
      if (Math.abs(to - c.v) < 1e-4) continue;
      c.v += (to - c.v) * k;
      if (d.push) c.g.position.copy(d.pivot).addScaledVector(c.axis, d.push * c.v);
      else c.g.quaternion.setFromAxisAngle(c.axis, c.v);
    }
  }

  addSteeringWheel() {
    const sw = this.type.META.steeringWheel;
    const c = V(...sw.center);
    const frame = new THREE.Group();
    frame.name = 'steeringFrame';
    frame.position.copy(c);
    frame.quaternion.copy(faceQuat(V(...sw.axis)));
    frame.updateMatrix();
    const spinner = new THREE.Group();
    spinner.name = 'steeringSpin';
    spinner.scale.setScalar(this.type.STEER_SCALE || 1);
    frame.add(spinner);
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(frame.matrix).invert();
    spinner.add(holder);
    for (const m of this.meshesFor('steeringWheel')) holder.add(m);
    this.addPart('steeringWheel', frame);
    this.steeringWheel = frame;
    const col = new THREE.Group();
    col.name = 'steeringColumn';
    col.userData.ignitionPos = this.type.CONTROLS.key.clone();
    this.parts.body.inner.add(col);
    this.steeringColumn = col;
  }

  addWheels() {
    this.wheels = {};
    const src = this.asset.parts.tyre || [];
    for (const h of this.type.HARDPOINTS) {
      const side = h.x > 0 ? 1 : -1;
      const pivot = new THREE.Group();
      pivot.name = h.id;
      pivot.position.set(h.x, this.type.SPEC.wheelY, h.z);
      const knuckle = new THREE.Group();
      pivot.add(knuckle);
      const spin = new THREE.Group();
      knuckle.add(spin);
      const flip = new THREE.Group();
      // the source wheel faces +X (the car's left); mirror it for the right side
      flip.scale.x = side > 0 ? 1 : -1;
      spin.add(flip);
      for (const { geometry, mat } of src) {
        const mesh = new THREE.Mesh(geometry, this.mats.byName[mat] || this.mats.tyre);
        mesh.name = 'tyre';
        mesh.castShadow = mesh.receiveShadow = true;
        flip.add(mesh);
      }
      this.root.add(pivot);
      this.parts[h.id] = { id: h.id, pivot, inner: knuckle, hinge: null, openT: 0, installed: true };
      this.wheels[h.id] = { pivot, knuckle, spin, side, group: spin };
    }
  }

  // Needles laid over the dashboard texture's own dials (type.GAUGES), optionally on a painted
  // face, plus generator / oil lamps.
  // The instrument cluster (cluster.js), in the hood of the source's dash.
  addGauges() {
    if (!this.type.GAUGES) return;
    this.cluster = buildCluster(this, this.type.GAUGES, this.mats, this.type);
    this.tachoFace = null;
  }

  // Two wiper arms on the scuttle (the sources have none): spindles at the foot of the windscreen,
  // the arms parked along it toward the passenger's side, the driver's a little above the other,
  // each blade hung from its arm's tip. They sweep about the screen's normal (car.js turns them);
  // userData.blades tells the glass shader the band each blade wipes.
  addWipers() {
    const glass = this.parts.body.inner.children.find((m) => m.name === 'body:glass');
    if (!glass) return;
    const pos = glass.geometry.attributes.position,
      idx = glass.geometry.index;
    const a = V(0, 0, 0),
      b = V(0, 0, 0),
      c = V(0, 0, 0),
      fn = V(0, 0, 0);
    const N = V(0, 0, 0),
      pts = [];
    const tris = idx ? idx.count / 3 : pos.count / 3;
    const at = (i) => (idx ? idx.getX(i) : i);
    for (let i = 0; i < tris; i++) {
      a.fromBufferAttribute(pos, at(i * 3));
      b.fromBufferAttribute(pos, at(i * 3 + 1));
      c.fromBufferAttribute(pos, at(i * 3 + 2));
      if (a.z + b.z + c.z < 0.3) continue;
      fn.subVectors(b, a).cross(c.clone().sub(a));
      if (fn.y < 0) fn.negate();
      const area = fn.length();
      if (area < 1e-9 || fn.z < 0.25 * area) continue;
      N.add(fn);
      pts.push(a.clone(), b.clone(), c.clone());
    }
    if (pts.length < 9) return;
    N.normalize();
    let minY = Infinity,
      maxY = -Infinity;
    for (const p of pts) (minY = Math.min(minY, p.y)), (maxY = Math.max(maxY, p.y));
    let zf = 0,
      nf = 0,
      halfW = 0;
    for (const p of pts)
      if (p.y < minY + 0.03) {
        zf += p.z;
        nf++;
        halfW = Math.max(halfW, Math.abs(p.x));
      }
    const foot = V(0, minY, zf / nf);
    const U = V(0, 1, 0).addScaledVector(N, -N.y).normalize();
    const slope = (maxY - minY) / U.y;
    let bulge = 0;
    for (const p of pts) bulge = Math.max(bulge, p.clone().sub(foot).dot(N));
    bulge = Math.min(bulge, 0.04);
    const M = this.mats;
    M.wiperArm = M.wiperArm || new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.55, metalness: 0.45 });
    M.wiperRubber = M.wiperRubber || new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.9 });
    const s = this.type.DRIVER_SIDE ?? 1;
    const across = V(-s, 0, 0).addScaledVector(N, s * N.x).normalize();
    const group = new THREE.Group();
    group.name = 'wipers';
    const wipers = [],
      blades = [];
    // (past upright: the driver's blade ends up near the pillar on that side)
    const SWEEP = 1.9;
    for (const [x, reach, tilt, up] of [
      [s * halfW * 0.46, Math.min(slope - 0.08, halfW * 1.05), 0.07, 0.006],
      [-s * halfW * 0.05, Math.min(slope * 0.78, halfW * 0.92), 0.02, 0],
    ]) {
      const pivot = foot.clone().addScaledVector(V(1, 0, 0), x).addScaledVector(U, -0.02);
      const dir = across.clone().applyAxisAngle(N, -tilt);
      const hb = reach * 0.31,
        L = reach - hb;
      const lift = bulge + 0.005 + up;
      // a frame at the spindle: x along the parked arm, y the way it sweeps, z into the glass
      const sweepDir = dir.clone().cross(N);
      const f = new THREE.Group();
      f.position.copy(pivot);
      f.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, sweepDir, N.clone().negate()));
      const put = (geo, mat, px, py, pz) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(px, py, pz);
        m.castShadow = true;
        f.add(m);
        return m;
      };
      // the spindle coming up out of the scuttle and its nut cover
      put(new THREE.CylinderGeometry(0.016, 0.019, 0.05, 16).rotateX(Math.PI / 2), M.wiperArm, 0, 0, 0.025 - lift - 0.018);
      put(new THREE.SphereGeometry(0.017, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2), M.wiperArm, 0, 0, -lift - 0.018);
      // the arm: a channel tapering toward the tip, a cranked hook down onto the blade
      const arm = roundedBox(L, 0.022, 0.007, 0.0025, 1).translate(L / 2, 0, 0);
      const ap = arm.attributes.position;
      for (let i = 0; i < ap.count; i++) ap.setY(i, ap.getY(i) * (1 - 0.45 * (ap.getX(i) / L)));
      arm.computeVertexNormals();
      put(arm, M.wiperArm, 0, 0, -lift - 0.022);
      put(roundedBox(0.03, 0.012, 0.014, 0.003, 1), M.wiperArm, L, 0, -lift - 0.017);
      // the blade: a sprung carrier with its rubber edge on the glass
      put(roundedBox(hb * 2, 0.012, 0.009, 0.003, 1), M.wiperArm, L, 0, -lift - 0.009);
      put(new THREE.BoxGeometry(hb * 2 - 0.01, 0.004, 0.006), M.wiperRubber, L, 0, -lift - 0.002);
      for (const k of [-0.62, 0.62]) put(roundedBox(0.05, 0.013, 0.006, 0.002, 1), M.wiperArm, L + hb * k, 0, -lift - 0.015);
      const wg = new THREE.Group();
      wg.add(f);
      wg.userData.pivot = pivot;
      wg.userData.axis = N.clone();
      group.add(wg);
      wipers.push(wg);
      blades.push({ pivot, dir, r0: L - hb, r1: L + hb });
    }
    group.userData = { wipers, blades, axis: N.clone(), sweep: SWEEP };
    this.parts.body.inner.add(group);
    this.wipers = group;
  }

  // The fuel filler (fillerCut.js): an opening cut into the body's paint, a pocket behind it with
  // the neck and cap, and a flap that sits flush and swings out (FILLER: where on the body, the
  // outward normal, the flap's size and corner radius, hinge +1 toward the flap frame's +x).
  addFiller() {
    const F = this.type.FILLER;
    if (!F) return;
    const M = this.mats;
    const n = V(...F.normal).normalize();
    const q = faceQuat(n);
    const frame = { p: V(...F.pos), x: V(1, 0, 0).applyQuaternion(q), y: V(0, 1, 0).applyQuaternion(q), n };
    const [w, h] = F.size;
    const r = F.corner ?? 0.02;
    // (the cut is the same on every car of a type: made once per source mesh and shared, it was
    // the dearest step of building a car, a frame's worth of time for each abandoned car met)
    for (const m of this.parts.body.inner.children)
      if (m.isMesh && m.material === M.paint) {
        let cut = CUT_BODIES.get(m.geometry);
        if (!cut) {
          cut = cutOpening(m.geometry, frame, w, h, r);
          CUT_BODIES.set(m.geometry, cut);
        }
        m.geometry = cut;
      }
    // (the body's paint without its texture: the flap's own UVs would pick a stray patch of the
    // atlas; the colour object is the shared one, so a respray covers the flap too)
    const paint = M.paint.clone();
    paint.map = null;
    paint.color = M.paint.color;
    const side = F.hinge ?? 1;
    const f = buildFiller(w, h, r, side, paint);
    f.group.name = 'filler';
    f.group.position.copy(frame.p);
    f.group.quaternion.copy(q);
    this.parts.body.inner.add(f.group);
    this.filler = { group: f.group, hinge: f.hinge, side, cap: f.cap, mouth: f.mouth, inside: f.inside };
  }

  addStereo() {
    const S = this.type.STEREO;
    if (!S) return;
    const g = new THREE.Group();
    g.name = 'stereo';
    g.position.copy(V(...S.center));
    g.quaternion.copy(faceQuat(V(...S.normal)));
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(S.w, S.h), this.mats.display);
    disp.position.z = 0.002;
    g.add(disp);
    this.parts.body.inner.add(g);
    this.stereo = g;
  }

  addDomeLamp() {
    const g = new THREE.Mesh(roundedBox(0.12, 0.016, 0.05, 0.006, 2), this.mats.domeLens);
    g.position.copy(this.type.POINTS.dome);
    this.parts.body.inner.add(g);
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

  setGearLever(gear, dt = 1) {
    const g = this.gearLever;
    if (!g) return;
    const T = (this.type.SHIFT_PATTERN || {})[gear] || [0, 0];
    const k = Math.min(1, dt * 14);
    g.rotation.z += (T[0] - g.rotation.z) * k;
    g.rotation.x += (T[1] - g.rotation.x) * k;
  }

  setHandbrake() {}
}

// Plain glass over the source's mirror faces (type.MIRROR_GLASS): silvered, so it catches the sky
// and the light; nothing is drawn into it.
let MIRROR_MAT = null;
function addMirrorGlass(type, m) {
  for (const def of type.MIRROR_GLASS || []) {
    const part = m.parts[def.part];
    if (!part) continue;
    const [w, h] = def.size;
    const geo = new THREE.ShapeGeometry(roundRectShape(w, h, Math.min(w, h) * def.round), 6);
    const n = new THREE.Vector3(...def.normal).normalize();
    const y = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y).normalize();
    const x = y.clone().cross(n);
    MIRROR_MAT = MIRROR_MAT || new THREE.MeshStandardMaterial({ color: 0x8e979c, metalness: 1, roughness: 0.1 });
    const glass = new THREE.Mesh(geo, MIRROR_MAT);
    glass.name = 'mirrorGlass';
    glass.userData.shared = true;
    glass.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n));
    glass.position.set(...def.center).addScaledVector(n, 0.004);
    part.inner.add(glass);
  }
}

export function buildImportedModel(type, asset, mats) {
  const m = new ImportedCarModel(type, asset, mats);
  addMirrorGlass(type, m);
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

// Roadside wreck: shell, panels and seats merged per material, no glass, flat tyres.
// source body geometry -> the same with the fuel filler's opening cut into it
const CUT_BODIES = new WeakMap();

export function buildImportedWreck(type, asset) {
  const mats = createImportedMaterials(type, asset, { weather: { dirt: 0.8, dust: 0.6, rust: 0.7, fade: 0.8 } });
  const keep = type.WRECK_PARTS;
  const byMat = {};
  for (const id of keep)
    for (const { geometry, mat } of asset.parts[id] || []) {
      const m = mats.byName[mat];
      if (!m || m.transparent) continue;
      (byMat[mat] = byMat[mat] || []).push(geometry);
    }
  const g = new THREE.Group();
  for (const [mat, list] of Object.entries(byMat)) {
    const geo = mergeGeometries(list, false);
    if (!geo) continue;
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mats.byName[mat]);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.shared = true;
    g.add(m);
  }
  for (const { geometry, mat } of asset.parts.tyre || [])
    for (const h of type.HARDPOINTS) {
      const t = new THREE.Mesh(geometry, mats.byName[mat] || mats.tyre);
      t.scale.set(h.x > 0 ? 1 : -1, 0.88, 1);
      t.position.set(h.x, type.SPEC.wheelY * 0.85, h.z);
      t.castShadow = true;
      t.userData.shared = true;
      g.add(t);
    }
  // only a flat coat can be resprayed per wreck
  if (type.MATERIAL_ROLES[type.META.keys.find((k) => type.MATERIAL_ROLES[k] === 'paint')] === 'paint') {
    const paint = mats.paint;
    paint.userData.make = (hex) => {
      const p = paint.clone();
      p.color = new THREE.Color(hex);
      p.onBeforeCompile = paint.onBeforeCompile;
      p.customProgramCacheKey = paint.customProgramCacheKey;
      return p;
    };
    Object.defineProperty(g, 'wreckPaint', { value: paint, enumerable: false });
  }
  return g;
}
