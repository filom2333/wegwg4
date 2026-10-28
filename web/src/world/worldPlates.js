// Plates bolted to the world rather than to a car: boards over a house window, a steel sheet on a
// wall, a panel propped up on the ground as a ramp or a windbreak. Each one keeps its place in
// absolute coordinates, has a fixed collider, and is kept in the save.

import * as THREE from 'three';
import { RAPIER, GROUPS } from '../physics/physics.js';
import { PLATES, plateModel, plateMaterial } from '../vehicle/plates.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class WorldPlates {
  constructor(game) {
    this.g = game;
    this.list = [];
  }

  // m: the plate's world matrix (scene space, i.e. origin-relative).
  add(id, state, m) {
    const g = this.g;
    const d = PLATES[id];
    const mesh = plateModel(id, state.variant || 0, { bolts: true, color: state.color ?? null });
    m.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.userData.plate = true;
    g.worldGroup.add(mesh);
    const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(mesh.position.x, mesh.position.y, mesh.position.z).setRotation({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w }));
    const col = g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(d.w / 2, Math.max(0.01, d.t / 2), d.l / 2).setFriction(0.7).setCollisionGroups(GROUPS.world), body);
    const plate = { id, state, mesh, body, collider: col, world: true, mass: d.mass };
    g.physics.setOwner(col, { kind: 'structure', surface: d.mat === 'steel' ? 'metal' : 'wood', plate });
    this.list.push(plate);
    return plate;
  }

  remove(plate) {
    plate.mesh.parent && plate.mesh.parent.remove(plate.mesh);
    if (plate.body) this.g.physics.removeBody(plate.body);
    this.list = this.list.filter((p) => p !== plate);
  }

  // Which world plate the ray meets first (its own box), and how far.
  underRay(origin, dir, maxDist) {
    let best = null;
    const inv = new THREE.Matrix4();
    const r = new THREE.Ray();
    const hit = V(0, 0, 0);
    for (const p of this.list) {
      if (p.mesh.position.distanceToSquared(origin) > 64) continue;
      const d = PLATES[p.id];
      p.mesh.updateMatrixWorld();
      inv.copy(p.mesh.matrixWorld).invert();
      r.origin.copy(origin).applyMatrix4(inv);
      r.direction.copy(dir).transformDirection(inv);
      const box = new THREE.Box3(V(-d.w / 2, -d.t / 2 - 0.006, -d.l / 2), V(d.w / 2, d.t / 2 + 0.006, d.l / 2));
      if (!r.intersectBox(box, hit)) continue;
      const dist = hit.applyMatrix4(p.mesh.matrixWorld).distanceTo(origin);
      if (dist < maxDist && (!best || dist < best.dist)) best = { plate: p, dist };
    }
    return best;
  }

  paint(plate, hex) {
    plate.state.color = hex;
    plate.mesh.children[0].material = plateMaterial(PLATES[plate.id].mat, hex);
  }

  // Far ones are not drawn (their colliders stay).
  update() {
    const c = this.g.renderer.camera.position;
    for (const p of this.list) p.mesh.visible = p.mesh.position.distanceToSquared(c) < 500 * 500;
  }

  rebase(dx, dz) {
    for (const p of this.list) {
      p.mesh.position.x -= dx;
      p.mesh.position.z -= dz;
      const t = p.body.translation();
      p.body.setTranslation({ x: t.x - dx, y: t.y, z: t.z - dz }, false);
    }
  }

  serialize(o) {
    return this.list.map((p) => ({ id: p.id, state: p.state, pos: [p.mesh.position.x + o.x, p.mesh.position.y, p.mesh.position.z + o.z], quat: p.mesh.quaternion.toArray() }));
  }

  restore(list, o) {
    for (const s of list || []) {
      if (!PLATES[s.id]) continue;
      const m = new THREE.Matrix4().compose(V(s.pos[0] - o.x, s.pos[1], s.pos[2] - o.z), new THREE.Quaternion().fromArray(s.quat), V(1, 1, 1));
      this.add(s.id, s.state || {}, m);
    }
  }
}
