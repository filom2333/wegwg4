// Verifies Rapier heightfield conventions (row/column order, extents) by ray casting.
import { Physics, RAPIER, GROUPS } from '../../src/physics/physics.js';
const p = await Physics.create();
const n = 4; // subdivisions
const H = new Float32Array((n + 1) * (n + 1));
// height = column index (x?) * 1 + row index * 10
for (let c = 0; c <= n; c++) for (let r = 0; r <= n; r++) H[c * (n + 1) + r] = r * 1 + c * 10; // column-major: index = c*(nrows+1)+r
const b = p.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
p.world.createCollider(RAPIER.ColliderDesc.heightfield(n, n, H, { x: 8, y: 1, z: 8 }).setCollisionGroups(GROUPS.world), b);
p.world.step();
for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [0, 0], [3.9, 3.9]]) {
  const hit = p.raycast({ x, y: 100, z }, { x: 0, y: -1, z: 0 }, 200, GROUPS.ground);
  console.log('x', x, 'z', z, '-> y', hit ? (100 - hit.distance).toFixed(2) : 'miss');
}
