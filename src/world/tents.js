// Tents: a canvas ridge tent the player carries packed and pitches on open, level ground. Crawl in
// to lie down out of the wind and rain and sleep the night through; pack it up again in the
// morning. A sleeping bag is rolled out inside, the front flap is tied back, guy lines run out to
// pegs. Pitched tents are kept in the save.

import * as THREE from 'three';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { roundedBox } from '../gfx/geom.js';
import { makeCanvas, canvasTexture } from '../gfx/textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const TENT = { w: 1.56, l: 2.1, h: 1.12 };
const COLORS = [0xc0652f, 0x6e6b3e, 0x2f5a78, 0x9c3a2c];

// Canvas in panel space (u along the tent, v up to the ridge): a fine weave, weathering, two
// stitched seams, a reinforced ridge and a dirty hem. White, tinted by the material colour.
function canvasMap() {
  const c = makeCanvas(256, 256);
  const x = c.getContext('2d');
  const img = x.createImageData(256, 256);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let j = 0; j < 256; j++)
    for (let i = 0; i < 256; i++) {
      const weave = (i % 2 === j % 2 ? 0.03 : -0.03) + (rnd() - 0.5) * 0.08;
      const blotch = 0.06 * Math.sin(i * 0.05 + Math.sin(j * 0.07) * 2) * Math.sin(j * 0.045 + 1.3);
      const v = Math.max(0, Math.min(255, 228 * (1 + weave + blotch)));
      const k = (j * 256 + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
      img.data[k + 3] = 255;
    }
  x.putImageData(img, 0, 0);
  // canvas rows are v from the ridge (top) down to the hem (bottom)
  x.fillStyle = 'rgba(0,0,0,0.16)';
  x.fillRect(0, 0, 256, 7);
  x.fillStyle = 'rgba(40,30,20,0.28)';
  x.fillRect(0, 244, 256, 12);
  for (const y of [86, 168]) {
    x.fillStyle = 'rgba(0,0,0,0.13)';
    x.fillRect(0, y, 256, 4);
    x.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 256; i += 6) x.fillRect(i, y - 2, 3, 1), x.fillRect(i + 2, y + 5, 3, 1);
  }
  return canvasTexture(c, { repeat: [1, 1] });
}

let MATS = null;
function mats() {
  if (MATS) return MATS;
  const map = canvasMap();
  MATS = {
    canvas: COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, map, roughness: 0.93, side: THREE.DoubleSide })),
    floor: new THREE.MeshStandardMaterial({ color: 0x3b4031, roughness: 0.95 }),
    bag: [0x8a2f25, 0x2f4d63, 0x5a5530].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })),
    pillow: new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.9 }),
    pole: new THREE.MeshStandardMaterial({ color: 0x9a9c9e, roughness: 0.4, metalness: 0.8 }),
    rope: new THREE.MeshStandardMaterial({ color: 0xc9bc98, roughness: 0.9 }),
  };
  return MATS;
}

// A thin straight line (rope, pole) between two points.
function rod(a, b, r, mat, seg = 5) {
  const d = b.clone().sub(a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), seg).translate(0, d.length() / 2, 0), mat);
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
  return m;
}

// One sloped side of the canvas: ridge to ground, sagging between the poles and bowed in a little.
function sidePanel(s) {
  const { w, l, h } = TENT;
  const nu = 14,
    nv = 6;
  const geo = new THREE.PlaneGeometry(1, 1, nu, nv);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5,
      v = 0.5 - p.getY(i);
    const z = -l / 2 + u * l;
    const sag = 0.04 * Math.sin(Math.PI * u);
    const y0 = h - sag,
      x1 = (s * w) / 2;
    let x = x1 * v,
      y = y0 * (1 - v) - 0.015 * v;
    // the canvas bows inward between ridge and peg line, less near the poles
    const bow = 0.035 * Math.sin(Math.PI * v) * (0.5 + 0.5 * Math.sin(Math.PI * u));
    x -= s * bow * 0.8;
    y -= bow * 0.6;
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

function tri(a, b, c) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
  g.computeVertexNormals();
  return g;
}

export function tentModel(variant = 0) {
  const M = mats();
  const { w, l, h } = TENT;
  const canvas = M.canvas[variant % M.canvas.length];
  const g = new THREE.Group();
  const add = (m) => {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  for (const s of [-1, 1]) add(new THREE.Mesh(sidePanel(s), canvas));
  // closed back end; the front door has one flap down and the other tied back
  add(new THREE.Mesh(tri([-w / 2, -0.015, -l / 2], [w / 2, -0.015, -l / 2], [0, h - 0.01, -l / 2]), canvas));
  add(new THREE.Mesh(tri([-w / 2, -0.015, l / 2], [0.02, -0.015, l / 2 + 0.01], [0, h - 0.01, l / 2]), canvas));
  add(new THREE.Mesh(tri([0.02, h - 0.06, l / 2 + 0.005], [w / 2 + 0.02, -0.01, l / 2 - 0.02], [w / 2 + 0.03, 0.1, l / 2 - 0.5]), canvas));
  const roll = add(rod(V(0.08, h - 0.14, l / 2 + 0.02), V(w / 2 - 0.02, 0.1, l / 2 - 0.06), 0.03, canvas, 8));
  void roll;
  add(rod(V(w * 0.28, h * 0.48, l / 2 + 0.01), V(w * 0.28 + 0.01, h * 0.48 - 0.06, l / 2 + 0.03), 0.006, M.rope));
  // groundsheet, sleeping bag and a pillow inside
  add(new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, l - 0.08).rotateX(-Math.PI / 2).translate(0, 0.006, 0), M.floor));
  add(new THREE.Mesh(roundedBox(0.66, 0.08, 1.85, 0.035, 2).translate(-0.12, 0.045, -0.04), M.bag[variant % M.bag.length]));
  add(new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(0.22, 0.06, 0.15).translate(-0.12, 0.1, -0.8), M.pillow));
  // poles, guy lines and pegs
  for (const sz of [-1, 1]) {
    const z = (sz * l) / 2;
    add(rod(V(0, 0, z), V(0, h + 0.07, z), 0.011, M.pole, 6));
    add(rod(V(0, h + 0.05, z), V(0, 0.02, z + sz * 0.8), 0.0028, M.rope, 4));
    add(rod(V(0, 0.08, z + sz * 0.8), V(0, -0.1, z + sz * 0.84), 0.008, M.pole, 5));
    for (const s of [-1, 1]) {
      const a = V(s * w * 0.27, h * 0.5, z * 0.55);
      const b = V(s * (w / 2 + 0.5), 0.02, z * 0.6);
      add(rod(a, b, 0.0025, M.rope, 4));
      add(rod(b.clone().setY(0.07), b.clone().setY(-0.1), 0.007, M.pole, 5));
      add(rod(V((s * w) / 2, 0.05, z * 0.97), V((s * w) / 2, -0.08, z * 0.97), 0.006, M.pole, 5));
    }
  }
  return g;
}

// The packed tent as an item: a canvas bag with two straps and the pole ends sticking out.
export function tentBagModel(variant = 0) {
  const M = mats();
  const g = new THREE.Group();
  const bag = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.56, 16).rotateZ(Math.PI / 2), M.canvas[variant % M.canvas.length]);
  g.add(bag);
  for (const x of [-0.17, 0.17]) {
    const s = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.008, 6, 20).rotateY(Math.PI / 2), M.rope);
    s.position.x = x;
    g.add(s);
  }
  for (const [y, z] of [
    [0.04, 0.02],
    [-0.02, -0.04],
    [0.03, -0.03],
  ]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 6).rotateZ(Math.PI / 2), M.pole);
    p.position.set(0.32, y, z);
    g.add(p);
  }
  g.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true));
  return g;
}

export class Tents {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    this.group.name = 'tents';
    game.worldGroup.add(this.group);
  }

  // Where a tent would stand pitched `dist` ahead of a point, facing back at it, or why not.
  site(from, yaw, dist = 2.4) {
    const g = this.game;
    const { w, l } = TENT;
    const fwd = V(Math.sin(yaw), 0, Math.cos(yaw));
    const c = from.clone().addScaledVector(fwd, dist);
    const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw + Math.PI);
    let lo = Infinity,
      hi = -Infinity;
    const hs = [];
    for (const [x, z] of [
      [0, 0],
      [-w / 2, -l / 2],
      [w / 2, -l / 2],
      [-w / 2, l / 2],
      [w / 2, l / 2],
    ]) {
      const p = V(x, 0, z).applyQuaternion(q).add(c);
      const y = g.groundHeightAt(p.x, p.z, from.y + 2);
      hs.push(y);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
      // anything standing there (a wall, a car, a rock, a crate)
      const hit = g.physics.raycast({ x: p.x, y: y + 1.6, z: p.z }, { x: 0, y: -1, z: 0 }, 1.5, GROUPS.look);
      if (hit && hit.point.y > y + 0.12) {
        const o = g.physics.ownerOf(hit.collider);
        if (!o || o.kind !== 'scenery' || o.surface === 'rock' || hit.point.y > y + 0.45) return { blocked: 'Not enough clear ground here' };
      }
    }
    if (hi - lo > 0.5) return { blocked: 'Too steep for a tent' };
    if (Math.abs(lo - from.y) > 1.2) return { blocked: 'Find level ground' };
    const wa = g.gen.waterAt(c.x + g.origin.x, c.z + g.origin.z);
    if (wa && !wa.frozen && wa.level > lo) return { blocked: 'Not in the water' };
    // it follows the lie of the ground: tilt from the corner heights (local -z/+z, -x/+x)
    const [, a, b, cc, d] = hs;
    const tilt = [Math.atan2((a + b - cc - d) / 2, l), Math.atan2((b + d - a - cc) / 2, w)];
    return { pos: V(c.x, (a + b + cc + d) / 4 - 0.02, c.z), yaw: yaw + Math.PI, tilt };
  }

  pitch(pos, yaw, variant = 0, tilt = [0, 0]) {
    const ph = this.game.physics;
    const root = tentModel(variant);
    root.position.copy(pos);
    root.rotation.set(tilt[0], yaw, tilt[1], 'YXZ');
    this.group.add(root);
    const { w, l, h } = TENT;
    const q = root.quaternion;
    const body = ph.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    const pts = new Float32Array([-w / 2, 0, -l / 2, w / 2, 0, -l / 2, -w / 2, 0, l / 2, w / 2, 0, l / 2, 0, h, -l / 2, 0, h, l / 2]);
    const col = ph.world.createCollider(RAPIER.ColliderDesc.convexHull(pts).setCollisionGroups(GROUPS.world).setFriction(0.6), body);
    const t = { root, body, col, pos: pos.clone(), yaw, variant, tilt };
    ph.setOwner(col, { kind: 'tent', tent: t, surface: 'wood' });
    this.list.push(t);
    this.game.audio && this.game.audio.play('pickupHeavy', { at: pos, volume: 0.7 });
    return t;
  }

  strike(t) {
    this.game.physics.removeBody(t.body);
    this.group.remove(t.root);
    this.list = this.list.filter((x) => x !== t);
  }

  // Where someone crawling in lies (eye), facing up the tent, and where they crawl out to.
  berth(t) {
    const q = t.root.quaternion;
    const eye = V(-0.12, 0.3, -0.72).applyQuaternion(q).add(t.pos);
    const exit = V(0, 0, TENT.l / 2 + 0.75).applyQuaternion(q).add(t.pos);
    // looking down the length of the tent, out of the door
    return { kind: 'tent', tent: t, eye, exit, yaw: t.yaw, pitch: 0.22 };
  }

  serialize(o) {
    return this.list.map((t) => ({ pos: [t.pos.x + o.x, t.pos.y, t.pos.z + o.z], yaw: t.yaw, variant: t.variant, tilt: t.tilt }));
  }

  restore(list, o) {
    for (const s of list || []) this.pitch(V(s.pos[0] - o.x, s.pos[1], s.pos[2] - o.z), s.yaw, s.variant || 0, s.tilt || [0, 0]);
  }

  rebase(dx, dz) {
    for (const t of this.list) {
      t.pos.x -= dx;
      t.pos.z -= dz;
      t.root.position.copy(t.pos);
    }
  }
}
