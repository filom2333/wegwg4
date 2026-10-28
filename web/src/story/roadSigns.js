// Distance signs along Route 9 every 5 km ("HAVEN 145 km"), streamed around the player, with a
// static collider on the post so cars hit them instead of driving through.

import * as THREE from 'three';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { signMaterial, archMaterials } from '../world/buildings/materials.js';
import { HAVEN_KM } from './story.js';

const EVERY = 5000;

export class RoadSigns {
  constructor(game) {
    this.g = game;
    this.group = new THREE.Group();
    this.group.name = 'roadSigns';
    game.worldGroup.add(this.group);
    this.signs = new Map();
  }

  update() {
    const g = this.g;
    const f = g.focusPoint();
    const gz = f.z + g.origin.z;
    const k0 = Math.round(gz / EVERY);
    const want = new Set();
    for (let k = k0 - 1; k <= k0 + 1; k++) {
      if (k < 1) continue;
      const z = k * EVERY - 40;
      if (Math.abs(z - gz) > 1600) continue;
      want.add(k);
      if (!this.signs.has(k)) this.signs.set(k, this.build(k, z));
    }
    for (const [k, s] of this.signs) {
      if (want.has(k)) continue;
      this.group.remove(s.root);
      g.physics.removeBody(s.body);
      this.signs.delete(k);
    }
  }

  build(k, z) {
    const g = this.g;
    const gen = g.gen;
    const left = HAVEN_KM - (k * EVERY) / 1000;
    const x = gen.roadX(z) + 6.2;
    const y = gen.height(x, z);
    const root = new THREE.Group();
    root.position.set(x - g.origin.x, y, z - g.origin.z);
    const [dx] = gen.roadDir(z);
    root.rotation.y = Math.PI + Math.atan2(dx, 1);
    const M = archMaterials();
    const text = left > 0 ? [{ text: 'HAVEN', size: 70 }, { text: `${left} km`, size: 92 }] : [{ text: 'HAVEN', size: 90 }, { text: 'GATE AHEAD', size: 50 }];
    const mat = signMaterial(text, { w: 512, h: 300, bg: '#1d5a3a', fg: '#f2f0e6', border: '#f2f0e6', worn: 0.35 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.95, 0.04), [M.metal, M.metal, M.metal, M.metal, mat, M.metal]);
    board.position.set(0, 2.25, 0);
    board.castShadow = true;
    root.add(board);
    for (const px of [-0.55, 0.55]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.7, 10), M.metal);
      post.position.set(px, 1.35, -0.04);
      post.castShadow = true;
      root.add(post);
    }
    this.group.add(root);
    root.updateMatrixWorld(true);
    const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(root.position.x, root.position.y, root.position.z));
    const q = root.quaternion;
    for (const px of [-0.55, 0.55]) {
      const c = new THREE.Vector3(px, 1.35, -0.04).applyQuaternion(q);
      const col = g.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(1.35, 0.05).setTranslation(c.x, c.y, c.z).setCollisionGroups(GROUPS.world), body);
      g.physics.setOwner(col, { kind: 'prop', surface: 'metal' });
    }
    return { root, body };
  }

  rebase(dx, dz) {
    for (const s of this.signs.values()) {
      s.root.position.x -= dx;
      s.root.position.z -= dz;
    }
  }
}
