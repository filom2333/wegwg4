// Cars converted by tools/cars (the '88 sedan): loading, materials and the scene graph with
// the same interface as the Beetle's model, so the car, the player's hands and the inspector
// treat every car type alike. A type supplies the measured META and its own procedural extras.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { roundedBox } from '../../gfx/geom.js';
import { makeCanvas, canvasTexture } from '../../gfx/textures.js';
import { applyWeathering, weatheringUniforms } from '../weathering.js';
import { drawSpeedoFace } from '../gauges.js';

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
    if (WEATHER[role] || (role === 'trim' && key === 'under')) applyWeathering(m, weather, { rustColor: role !== 'paint', strength: WEATHER[role] ?? WEATHER.under });
    m.name = key;
    byName[key] = m;
  }
  const paintKey = type.META.keys.find((k) => roles[k] === 'paint') || type.META.keys.find((k) => roles[k] === 'body');
  // the lamp lenses each car needs even if the source shares a material with something else
  const headLens = byName[type.META.keys.find((k) => roles[k] === 'lens')] || new THREE.MeshStandardMaterial({ color: 0xf4f6f8, transparent: true, opacity: 0.45, emissive: 0xfff1d6, emissiveIntensity: 0 });
  const tailLens = byName[type.META.keys.find((k) => roles[k] === 'tail')] || new THREE.MeshStandardMaterial({ color: 0x5a0a06, emissive: 0xff1a08, emissiveIntensity: 0 });
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
    this.addSteeringWheel();
    this.addWheels();
    this.addGauges();
    this.addStereo();
    this.addDomeLamp();
    if (type.extras) type.extras(this, mats);
  }

  meshesFor(id, { shadow = true } = {}) {
    const out = [];
    for (const { geometry, mat } of this.asset.parts[id] || []) {
      const m = this.mats.byName[mat] || this.mats.plastic;
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
  addGauges() {
    const G = this.type.GAUGES;
    if (!G) return;
    const M = this.mats;
    const g = new THREE.Group();
    g.name = 'cluster';
    const s = G.speedo;
    g.position.copy(V(...s.center)).addScaledVector(V(...s.normal), 0.003);
    g.quaternion.copy(faceQuat(V(...s.normal)));
    const R = s.radius;
    if (s.face) {
      const c = makeCanvas(512, 512);
      drawSpeedoFace(c.getContext('2d'), 512, this.type.SPEEDO_MAX, s.odo ?? '0 4 1 2 7 3', { major: this.type.SPEEDO_MAX > 160 ? 20 : 20, minor: this.type.SPEEDO_MAX > 160 ? 10 : 5 });
      const tex = canvasTexture(c, { wrap: false });
      tex.colorSpace = THREE.SRGBColorSpace;
      M.gauge.map = tex;
      M.gauge.emissiveMap = tex;
      g.add(new THREE.Mesh(new THREE.CircleGeometry(R, 48), M.gauge));
    }
    const needles = {};
    const needle = (name, len, w, z, at = null) => {
      const pivot = new THREE.Group();
      pivot.position.z = z;
      if (at) pivot.position.set(at[0], at[1], z);
      const geo = new THREE.PlaneGeometry(w, len).translate(0, len / 2 - len * 0.12, 0);
      pivot.add(new THREE.Mesh(geo, M.needle));
      g.add(pivot);
      needles[name] = pivot;
      return pivot;
    };
    needle('speed', R * 0.86, R * 0.05, 0.0015);
    if (G.fuel) {
      // fuel gauge: its own dial somewhere else on the panel, in the cluster's plane
      const f = G.fuel;
      needle('fuel', f.radius * 0.8, f.radius * 0.08, 0.0012, f.offset);
    }
    const cap = new THREE.Mesh(new THREE.CircleGeometry(R * 0.07, 16), M.black);
    cap.position.z = 0.0022;
    g.add(cap);
    if (G.tacho) {
      // rev counter beside it, in the same plane
      const t = G.tacho;
      const tg = new THREE.Group();
      tg.position.set(t.offset[0], t.offset[1], 0);
      const c = makeCanvas(512, 512);
      const red = this.type.DYNAMICS.redline / 1000;
      drawSpeedoFace(c.getContext('2d'), 512, 8, null, { minor: 0.5, major: 1, unit: 'x1000 rpm', fuel: false, red });
      const tex = canvasTexture(c, { wrap: false });
      tex.colorSpace = THREE.SRGBColorSpace;
      const fm = M.gauge.clone();
      fm.map = tex;
      fm.emissiveMap = tex;
      this.tachoFace = fm;
      tg.add(new THREE.Mesh(new THREE.CircleGeometry(t.radius, 48), fm));
      const pv = new THREE.Group();
      pv.position.z = 0.0015;
      pv.add(new THREE.Mesh(new THREE.PlaneGeometry(t.radius * 0.05, t.radius * 0.86).translate(0, t.radius * 0.86 * 0.38, 0), M.needle));
      tg.add(pv);
      g.add(tg);
      needles.rpm = pv;
    }
    const lamps = {};
    for (const [name, col, at] of [
      ['gen', 0xff2a10, G.lamps ? G.lamps.gen : [-0.36 * R, -0.5 * R]],
      ['oil', 0xff3a10, G.lamps ? G.lamps.oil : [0.36 * R, -0.5 * R]],
    ]) {
      const mat = M.lamp.clone();
      mat.emissive.setHex(col);
      mat.color.setHex(col).multiplyScalar(0.05);
      mat.transparent = true;
      mat.opacity = 0.9;
      const l = new THREE.Mesh(new THREE.CircleGeometry(R * 0.06, 16), mat);
      l.position.set(at[0], at[1], 0.0012);
      g.add(l);
      lamps[name] = mat;
    }
    g.userData.needles = needles;
    g.userData.lamps = lamps;
    this.parts.body.inner.add(g);
    this.cluster = g;
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

export function buildImportedModel(type, asset, mats) {
  const m = new ImportedCarModel(type, asset, mats);
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
