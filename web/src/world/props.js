// Real models: photographed / hand-made glTF props (see public/models/props and the credits),
// each loaded once on first use, checked, normalised to its real-world size and cloned into the
// places that use it. A model whose geometry is broken is never shown; one whose textures failed
// to load is shown in a plain fallback colour rather than with missing maps.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { hash01 } from '../core/noise.js';

const BASE = (import.meta.env.BASE_URL || '/') + 'models/props/';

// size: the model is scaled so that this extent (metres) matches: h = height, w = the larger of
// width and depth, l = length (z). collide: 'box' (from the model's bounds), 'cyl', or none.
// node: show only this node of the file. fallback: colour if the textures do not load.
// fuel: a drum that may still hold some petrol (a jerry can fills from it like from a pump).
export const PROPS = {
  oilDrum: { file: 'oil_drum.glb', size: { h: 0.88 }, collide: 'cyl', fallback: 0x9a2a20, surface: 'metal', fuel: true },
  trafficCone: { file: 'traffic_cone.glb', node: 'Cone_Normal', size: { h: 0.7 }, collide: 'cyl', fallback: 0xe0602a },
  lampPost: { file: 'lamp_post.glb', size: { h: 2.7 }, collide: 'post', fallback: 0x8a7a66, light: [0.45, 2.15, 0] },
  barnLamp: { file: 'barn_lamp.glb', size: { h: 0.32 }, fallback: 0xb87a50, surface: 'metal' },
  drinksFridge: { file: 'drinks_fridge.glb', size: { h: 2.0 }, collide: 'box', fallback: 0x202224, surface: 'metal' },
  leatherSofa: { file: 'leather_sofa.glb', size: { w: 2.3 }, collide: 'box', fallback: 0x5a3a24 },
  pottedPlant: { file: 'potted_plant.glb', size: { h: 0.75 }, collide: 'box', fallback: 0x4a7a3a },
  skull: { file: 'skull.glb', size: { l: 0.22 }, fallback: 0xd8cdb4, tint: 0xd6c8a8 },
  flightHelmet: { file: 'flight_helmet.glb', size: { h: 0.5 }, collide: 'box', fallback: 0x6a4a30 },
  // the player's body (Ready Player Me avatar) and, for its motion, the Soldier's Mixamo clips
  // without his mesh: retargeted onto the avatar in glbAvatar.js
  survivor: { file: 'survivor_rpm.glb', size: { h: 1.8 }, skinned: true },
  survivorAnim: { file: 'survivor_anim.glb', anim: true },
  // mossy boulders (ez-tree, MIT): normalised to a metre across, scaled where they are used
  rockMoss1: { file: 'rock_moss1.glb', size: { w: 1 }, collide: 'box', fallback: 0x6d6a5c, surface: 'rock', brighten: 1.65 },
  rockMoss2: { file: 'rock_moss2.glb', size: { w: 1 }, collide: 'box', fallback: 0x6d6a5c, surface: 'rock', brighten: 1.65 },
  rockMoss3: { file: 'rock_moss3.glb', size: { w: 1 }, collide: 'box', fallback: 0x6d6a5c, surface: 'rock', brighten: 1.65 },
  tyre: { file: 'tyre.glb', size: { w: 0.66 }, collide: 'cyl', fallback: 0x1b1b1b, surface: 'rubber' },
  carp: { file: 'carp.glb', size: { w: 0.42 }, fallback: 0x8a8460 },
  bass: { file: 'barramundi.glb', size: { w: 0.46 }, fallback: 0x7a7a62 },
  // house things: a bellows camera on its tripod, a cup and saucer
  antiqueCamera: { file: 'antique_camera.glb', size: { h: 1.5 }, collide: 'box', fallback: 0x5a4430, surface: 'wood' },
  teacup: { file: 'teacup.glb', size: { w: 0.15 }, fallback: 0xe8e4dc },
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
    // motion only: the skeleton and its clips, nothing to show
    if (spec.anim) {
      if (!gltf.animations || !gltf.animations.length) throw new Error('no animations');
      this.report[id] = 'ok';
      return { root: src, size: new THREE.Vector3(), clips: gltf.animations };
    }
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
        // dark photographed albedo lifted to sit with the drawn scenery
        if (spec.brighten && m.color && !m.userData.brightened) {
          m.color.multiplyScalar(spec.brighten);
          m.userData.brightened = true;
        }
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

  // One geometry with the model's transforms baked in (for instancing), and its material.
  geometryOf(id) {
    const p = this.protos.get(id);
    if (!p) return null;
    const geos = [];
    p.root.updateMatrixWorld(true);
    p.root.traverse((o) => {
      if (!o.isMesh) return;
      let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      // a mirrored node turns the triangles inside out once its transform is baked in
      if (o.matrixWorld.determinant() < 0) {
        if (!g.index) g = mergeGeometries([g]) || g;
        if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
        const ix = g.index.array.slice();
        for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
        g.setIndex(new THREE.BufferAttribute(ix, 1));
      }
      geos.push(g);
    });
    return geos.length === 1 ? geos[0] : mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)));
  }

  materialOf(id) {
    const p = this.protos.get(id);
    let m = null;
    p && p.root.traverse((o) => o.isMesh && !m && (m = Array.isArray(o.material) ? o.material[0] : o.material));
    return m;
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
    if (y < 0.2 || p.ground) {
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
    // a drum left standing may still have old petrol in it: it fills a can like a pump does
    if (spec.fuel && p.fuel !== false) {
      const key = `${p.pos[0].toFixed(1)},${p.pos[2].toFixed(1)}`;
      const st = inst.state;
      st.drums = st.drums || {};
      if (st.drums[key] === undefined) {
        const h = hash01(inst.k, Math.round(p.pos[0] * 10), Math.round(p.pos[2] * 10), 77);
        st.drums[key] = h < 0.55 ? 0 : Math.round(4 + ((h - 0.55) / 0.45) * 36);
      }
      // some drums held diesel
      const kind = hash01(inst.k, Math.round(p.pos[0] * 10), Math.round(p.pos[2] * 10), 78) < 0.35 ? 'diesel' : 'fuel';
      inst.pumps.push({ local: new THREE.Vector3(p.pos[0], p.pos[1] + size.y + 0.04, p.pos[2]), inst, drum: key, kind });
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
