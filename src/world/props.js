// Real models: photographed / hand-made glTF props (see public/models/props and the credits),
// each loaded once on first use, checked, normalised to its real-world size and cloned into the
// places that use it. A model whose geometry is broken is never shown; one whose textures failed
// to load is shown in a plain fallback colour rather than with missing maps.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RAPIER, GROUPS } from '../physics/physics.js';

const BASE = (import.meta.env.BASE_URL || '/') + 'models/props/';

// size: the model is scaled so that this extent (metres) matches: h = height, w = the larger of
// width and depth, l = length (z). collide: 'box' (from the model's bounds), 'cyl', or none.
// node: show only this node of the file. fallback: colour if the textures do not load.
export const PROPS = {
  oilDrum: { file: 'oil_drum.glb', size: { h: 0.88 }, collide: 'cyl', fallback: 0x9a2a20, surface: 'metal' },
  trafficCone: { file: 'traffic_cone.glb', node: 'Cone_Normal', size: { h: 0.7 }, collide: 'cyl', fallback: 0xe0602a },
  lampPost: { file: 'lamp_post.glb', size: { h: 2.7 }, collide: 'post', fallback: 0x8a7a66, light: [0.45, 2.15, 0] },
  barnLamp: { file: 'barn_lamp.glb', size: { h: 0.32 }, fallback: 0xb87a50, surface: 'metal' },
  drinksFridge: { file: 'drinks_fridge.glb', size: { h: 2.0 }, collide: 'box', fallback: 0x202224, surface: 'metal' },
  leatherSofa: { file: 'leather_sofa.glb', size: { w: 2.3 }, collide: 'box', fallback: 0x5a3a24 },
  pottedPlant: { file: 'potted_plant.glb', size: { h: 0.75 }, collide: 'box', fallback: 0x4a7a3a },
  skull: { file: 'skull.glb', size: { l: 0.22 }, fallback: 0xd8cdb4, tint: 0xd6c8a8 },
  flightHelmet: { file: 'flight_helmet.glb', size: { h: 0.5 }, collide: 'box', fallback: 0x6a4a30 },
  survivor: { file: 'survivor.glb', size: { h: 1.78 }, animated: true, skinned: true },
};

const MAP_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'sheenColorMap', 'clearcoatMap'];

export class PropLibrary {
  constructor() {
    this.protos = new Map(); // id -> { root, size, clips } or null when the model is unusable
    this.loading = new Map(); // id -> Promise
    this.report = {}; // id -> 'ok' | 'fallback: ...' | 'failed: ...'
    this.loader = new GLTFLoader();
  }

  ready(id) {
    return this.protos.has(id) && this.protos.get(id) !== null;
  }

  load(id) {
    if (this.loading.has(id)) return this.loading.get(id);
    const spec = PROPS[id];
    const p = (spec ? this.loader.loadAsync(BASE + spec.file) : Promise.reject(new Error('unknown prop ' + id)))
      .then((gltf) => {
        const proto = this.prepare(id, spec, gltf);
        this.protos.set(id, proto);
        return proto;
      })
      .catch((e) => {
        console.warn('prop', id, 'failed to load:', e.message || e);
        this.report[id] = 'failed: ' + (e.message || e);
        this.protos.set(id, null);
        return null;
      });
    this.loading.set(id, p);
    return p;
  }

  // Check the model, cut it down to the wanted node, scale and seat it on y = 0 centred in xz.
  prepare(id, spec, gltf) {
    let src = gltf.scene;
    if (spec.node) {
      const n = src.getObjectByName(spec.node);
      if (!n) throw new Error('no node ' + spec.node);
      n.parent.updateMatrixWorld(true);
      const w = n.matrixWorld.clone();
      n.removeFromParent();
      n.matrix.copy(w);
      n.matrix.decompose(n.position, n.quaternion, n.scale);
      src = new THREE.Group().add(n);
    }
    // geometry: something there, nothing degenerate
    let meshes = 0;
    let bad = 0;
    src.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      const g = o.geometry;
      if (!g.attributes.position || !g.attributes.position.count) bad++;
      else {
        g.computeBoundingSphere();
        if (!Number.isFinite(g.boundingSphere.radius)) bad++;
      }
    });
    if (!meshes || bad) throw new Error(`geometry: ${meshes} meshes, ${bad} broken`);
    // textures: every map the material refers to must have arrived with an image
    let missing = 0;
    src.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k of MAP_KEYS) {
          const t = m[k];
          if (t && !(t.image && (t.image.width || t.image.data))) {
            m[k] = null;
            missing++;
          }
        }
        if (spec.tint) m.color && m.color.setHex(spec.tint);
        o.castShadow = o.receiveShadow = true;
      }
    });
    if (missing && spec.fallback !== undefined)
      src.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (!m.map && m.color) m.color.setHex(spec.fallback);
      });
    this.report[id] = missing ? `fallback: ${missing} texture(s) missing` : 'ok';
    // scale to the real-world size and seat on the ground
    const holder = new THREE.Group();
    holder.add(src);
    holder.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(src, true);
    const s = box.getSize(new THREE.Vector3());
    const want = spec.size || {};
    const k = want.h ? want.h / s.y : want.w ? want.w / Math.max(s.x, s.z) : want.l ? want.l / s.z : 1;
    src.scale.multiplyScalar(k);
    holder.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(src, true);
    const c = box.getCenter(new THREE.Vector3());
    src.position.x -= c.x;
    src.position.z -= c.z;
    src.position.y -= box.min.y;
    holder.updateMatrixWorld(true);
    const size = box.getSize(new THREE.Vector3());
    holder.userData.propId = id;
    return { root: holder, size, clips: gltf.animations || [] };
  }

  // A copy to place (skinned and animated models get their own skeleton).
  instance(id) {
    const p = this.protos.get(id);
    if (!p) return null;
    const spec = PROPS[id];
    const o = spec.skinned || spec.animated ? SkeletonUtils.clone(p.root) : p.root.clone();
    o.userData.propId = id;
    return o;
  }

  sizeOf(id) {
    const p = this.protos.get(id);
    return p ? p.size : null;
  }
}

// Places a prop in a loaded POI once its model is ready: inst.root space position, a rotation
// about y, an optional static collider on the POI's body.
export function placeProp(game, inst, prop) {
  let p = prop;
  const lib = game.props;
  const go = () => {
    if (!game.pois.loaded.has(inst.k) || game.pois.loaded.get(inst.k) !== inst) return;
    const o = lib.instance(p.id);
    if (!o) return;
    // things standing on the ground sit on the real ground, not on the pad's nominal level
    let y = p.pos[1];
    if (y < 0.2) {
      const w = new THREE.Vector3(p.pos[0], 0, p.pos[2]).applyMatrix4(inst.root.matrixWorld);
      const o2 = game.origin;
      y += game.gen.height(w.x + o2.x, w.z + o2.z) - inst.root.position.y;
      p = { ...p, pos: [p.pos[0], y, p.pos[2]] };
    }
    o.position.set(p.pos[0], p.pos[1], p.pos[2]);
    o.rotation.y = p.rot || 0;
    if (p.scale) o.scale.setScalar(p.scale);
    inst.root.add(o);
    const spec = PROPS[p.id];
    const size = lib.sizeOf(p.id).clone().multiplyScalar(p.scale || 1);
    if (spec.collide && p.collide !== false) {
      const ph = game.physics;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot || 0);
      let desc;
      if (spec.collide === 'cyl') desc = RAPIER.ColliderDesc.cylinder(size.y / 2, Math.max(size.x, size.z) / 2);
      else if (spec.collide === 'post') desc = RAPIER.ColliderDesc.cuboid(0.12, size.y / 2, 0.12);
      else desc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
      desc.setTranslation(p.pos[0], p.pos[1] + size.y / 2, p.pos[2]).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(GROUPS.world).setFriction(0.8);
      const col = ph.world.createCollider(desc, inst.body);
      ph.setOwner(col, { kind: 'structure', surface: spec.surface || 'wood', poi: inst });
    }
    // lamp posts light up with the place's other lights
    if (spec.light && inst.lights.length < 4) {
      const l = new THREE.Vector3(...spec.light).applyAxisAngle(new THREE.Vector3(0, 1, 0), p.rot || 0);
      inst.lights.push({ local: new THREE.Vector3(p.pos[0] + l.x, p.pos[1] + l.y, p.pos[2] + l.z), def: { color: 0xffc98a, intensity: 0, distance: 10, powered: true } });
    }
  };
  if (lib.ready(p.id)) go();
  else lib.load(p.id).then((proto) => proto && go());
}
