// Tall buildings: two- and three-storey houses with real stairs, a fire lookout tower you can climb,
// a white chapel with a bell tower and spire, a grain silo, a log cabin, a sawmill with its
// wigwam burner and a timber lodge. Pure geometry for the POI worker like the rest of buildings/.
// Front is +z; the origin is the middle of the ground floor at ground level.

import * as THREE from 'three';
import { Builder } from './builder.js';
import { archMaterials } from './materials.js';
import * as FUR from './furniture.js';

const FH = 3.0; // storey height, floor to floor
const WALL = 2.8;
const T = 0.24; // exterior wall thickness

// ------------------------------------------------------------------ pieces
// A beam between two points (any direction), no collider.
function beam(b, a, c, w, h, mat) {
  const d = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const L = d.length();
  const g = new THREE.BoxGeometry(w, h, L);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize());
  g.applyQuaternion(q);
  g.translate((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
  b.add(g, mat);
}

// A straight flight of solid steps from (x, z) going `run` metres along (dx, dz) and up `rise`,
// `w` wide; a ramp collider underfoot (the character steps up it smoothly).
function flight(b, x, z, y0, dx, dz, run, rise, w, mat, { rail = 0, railMat = null } = {}) {
  const n = Math.max(2, Math.round(rise / 0.19));
  const tread = run / n,
    h = rise / n;
  const yaw = Math.atan2(dx, dz);
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * tread;
    b.box(x + dx * s, y0 + ((i + 1) * h) / 2, z + dz * s, Math.abs(dx) > 0.5 ? tread : w, (i + 1) * h, Math.abs(dz) > 0.5 ? tread : w, mat, { collide: false });
  }
  const slope = Math.atan2(rise, run);
  const hyp = Math.hypot(rise, run);
  b.collider(x + (dx * run) / 2, y0 + rise / 2 - 0.06, z + (dz * run) / 2, w, 0.1, hyp + 0.1, yaw, 'wood', -slope);
  // a handrail on one or both sides (rail = +1 left of the climb, -1 right, 2 both)
  if (rail && railMat) {
    const lx = -dz,
      lz = dx;
    for (const side of rail === 2 ? [1, -1] : [rail]) {
      const ox = lx * side * (w / 2 - 0.03),
        oz = lz * side * (w / 2 - 0.03);
      beam(b, [x + ox, y0 + 0.95, z + oz], [x + ox + dx * run, y0 + rise + 0.95, z + oz + dz * run], 0.05, 0.05, railMat);
      for (const s of [0.1, run / 2, run - 0.1]) b.box(x + ox + dx * s, y0 + (s / run) * rise + 0.48, z + oz + dz * s, 0.05, 0.95, 0.05, railMat, { collide: false });
      b.collider(x + ox + (dx * run) / 2, y0 + rise / 2 + 0.5, z + oz + (dz * run) / 2, 0.06, 1.0, hyp, yaw, 'wood', -slope);
    }
  }
}

// A railing along a straight line at height y (posts, top and mid rails, a collider).
function railing(b, a, c, y, mat, h = 1.0) {
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
  if (L < 0.05) return;
  const ux = (c[0] - a[0]) / L,
    uz = (c[1] - a[1]) / L;
  const rot = Math.atan2(-uz, ux);
  const n = Math.max(1, Math.round(L / 1.2));
  for (let i = 0; i <= n; i++) b.box(a[0] + (ux * L * i) / n, y + h / 2, a[1] + (uz * L * i) / n, 0.07, h, 0.07, mat, { collide: false });
  b.box((a[0] + c[0]) / 2, y + h, (a[1] + c[1]) / 2, L, 0.06, 0.07, mat, { collide: false, rotY: rot });
  b.box((a[0] + c[0]) / 2, y + h * 0.5, (a[1] + c[1]) / 2, L, 0.04, 0.04, mat, { collide: false, rotY: rot });
  b.collider((a[0] + c[0]) / 2, y + h / 2, (a[1] + c[1]) / 2, L, h, 0.08, rot, 'wood');
}

// Four-sided pyramid roof (hip) over a square, apex at y + rise.
function pyramidRoof(b, cx, cz, half, y, rise, mat, under) {
  const g = new THREE.ConeGeometry(half * Math.SQRT2, rise, 4, 1, true);
  g.rotateY(Math.PI / 4);
  // metre uvs on the slopes
  const p = g.attributes.position,
    uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) + p.getZ(i), p.getY(i) * 1.4);
  g.translate(cx, y + rise / 2, cz);
  b.add(g, mat);
  if (under) {
    const u = new THREE.PlaneGeometry(half * 2, half * 2).rotateX(Math.PI / 2).translate(cx, y + 0.01, cz);
    b.add(u, under);
  }
  b.collider(cx, y + rise * 0.35, cz, half * 1.6, rise * 0.7, half * 1.6, 0, 'roof');
}

// Corrugated cylinder with metre uvs (silos, the burner), open ends.
function drum(b, cx, cz, y, r, h, mat, seg = 28) {
  const g = new THREE.CylinderGeometry(r, r, h, seg, 1, true);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * r, uv.getY(i) * h);
  g.translate(cx, y + h / 2, cz);
  b.add(g, mat);
  // an octagon of boxes to bump into
  for (const a of [0, Math.PI / 4]) b.collider(cx, y + h / 2, cz, r * 1.7, h, r * 1.7, a, 'metal');
}

// ------------------------------------------------------------------ houses with storeys
// W x D, n floors (2 or 3), stairs against the back wall. style: { ext, inner, trim, roof,
// roofType: 'gable' | 'flat', floor }. Returns the builder plus useful spots.
export function buildStoreyed(rnd, { W = 9, D = 8, floors = 2, style, name = 'storeyed', porch = false, chimney = true, abandoned = 0.6 } = {}) {
  const M = archMaterials();
  const S = style;
  const b = new Builder(name);
  const y0 = 0.3;
  const x0 = -W / 2,
    x1 = W / 2,
    z0 = -D / 2,
    z1 = D / 2;
  const ti = T / 2;
  b.box(0, y0 / 2 - 0.05, 0, W + 0.3, y0 + 0.1, D + 0.3, M.concrete, { surface: 'concrete' });
  // stairwell strips along the back wall: flight f climbs from floor f to f+1
  const run = 4.2,
    sw = 1.0;
  const sx0 = x0 + ti + 0.2,
    sx1 = sx0 + run;
  const strip = (f) => {
    const za = z0 + ti + 0.05 + (f % 2) * (sw + 0.1);
    return [za, za + sw];
  };
  for (let f = 0; f < floors; f++) {
    const y = y0 + f * FH;
    // the floor: whole, except the hole over the flight coming up from below
    const fz = f > 0 ? strip(f - 1) : null;
    const slab = (ax, az, bx, bz) => {
      if (bx - ax < 0.05 || bz - az < 0.05) return;
      b.box((ax + bx) / 2, y - 0.1, (az + bz) / 2, bx - ax, 0.2, bz - az, M.concrete, { collide: true, surface: 'wood' });
      b.box((ax + bx) / 2, y + 0.006, (az + bz) / 2, bx - ax, 0.012, bz - az, S.floor || M.floorboards, { collide: false });
      if (f > 0) b.box((ax + bx) / 2, y - 0.21, (az + bz) / 2, bx - ax, 0.02, bz - az, M.ceiling, { collide: false });
    };
    if (!fz) slab(x0 + ti, z0 + ti, x1 - ti, z1 - ti);
    else {
      slab(x0 + ti, fz[1], x1 - ti, z1 - ti);
      slab(x0 + ti, z0 + ti, x1 - ti, fz[0]);
      slab(sx1, fz[0], x1 - ti, fz[1]);
      // a rail along the open edge of the stairwell
      railing(b, [sx0, fz[1] + 0.03], [sx1 - 0.6, fz[1] + 0.03], y, S.trim, 0.95);
    }
    // the walls of this storey, windows spaced along them, the front door below
    const sides = [
      { a: [x0, z1], c: [x1, z1], side: 'front' },
      { a: [x1, z0], c: [x0, z0], side: 'back' },
      { a: [x0, z0], c: [x0, z1], side: 'left' },
      { a: [x1, z1], c: [x1, z0], side: 'right' },
    ];
    for (const s of sides) {
      const L = Math.hypot(s.c[0] - s.a[0], s.c[1] - s.a[1]);
      const ops = [];
      const n = Math.max(1, Math.floor(L / 2.6));
      for (let k = 0; k < n; k++) {
        const at = (L * (k + 0.5)) / n;
        if (f === 0 && s.side === 'front' && Math.abs(at - L / 2) < 1.4) continue;
        // the back wall behind the stairs stays blank
        if (s.side === 'back' && at > W - (sx1 - x0) - 0.3) continue;
        ops.push({ at, w: 1.15, bottom: 0.9, top: 2.2, type: 'window' });
      }
      if (f === 0 && s.side === 'front') ops.push({ at: L / 2, w: 1.0, bottom: 0, top: 2.1, type: 'door' });
      ops.sort((p, q) => p.at - q.at);
      const info = b.wall(s.a, s.c, y, WALL + (f === floors - 1 ? 0 : 0.2), T, { outMat: S.ext, inMat: S.inner || M.plaster, openings: ops, outSide: 1 });
      for (const o of ops) {
        if (o.type === 'window') b.window(info, s.a, y, o, T, { frameMat: S.trim, glassMat: rnd() < 0.5 ? M.glassDirty : M.glass, broken: abandoned * (0.2 + rnd() * 0.5), sillMat: S.trim, rnd });
        else b.doorway(info, s.a, y, o, T, { frameMat: S.trim, leafMat: M.woodDark, open: rnd() < abandoned * 0.4 ? 0.6 : 0 });
      }
    }
    // a band between storeys
    if (f > 0) b.box(0, y - 0.12, 0, W + 0.06, 0.16, D + 0.06, S.trim, { collide: false });
    // the flight up from this floor
    if (f < floors - 1) {
      const [za, zb] = strip(f);
      const up = f % 2 === 0;
      flight(b, up ? sx0 : sx1, (za + zb) / 2, y, up ? 1 : -1, 0, run, FH, sw, M.woodDark, { rail: up ? -1 : 1, railMat: S.trim });
    }
    // light and furniture
    b.lights.push({ pos: [0.6, y + WALL - 0.3, 0.6], color: 0xffe0b0, intensity: 0, distance: 8, fixture: true });
    FUR.place(b, FUR.ceilingLamp(), 0.6, y + WALL, 0.6, 0);
    furnishStorey(b, rnd, f, floors, { x0: x0 + ti, x1: x1 - ti, z0: strip(Math.min(1, floors - 1))[1] + 0.15, z1: z1 - ti }, y);
  }
  const top = y0 + floors * FH - 0.2;
  // the ceiling of the top floor and a roof
  b.box(0, top - 0.02, 0, W - T, 0.04, D - T, M.ceiling, { collide: false });
  b.collider(0, top + 0.05, 0, W, 0.1, D, 0, 'wood');
  if (S.roofType === 'flat') b.flatRoof(x0 - 0.05, z0 - 0.05, x1 + 0.05, z1 + 0.05, top, { mat: M.concrete, parapetMat: S.ext, parapet: 0.6 });
  else b.gableRoof(x0, z0, x1, z1, top, 0.55, { mat: S.roof, under: M.planks, fascia: S.trim, overhang: 0.45, ridgeAlong: 'x', gableMat: S.ext });
  if (chimney) {
    const cx = x1 - 1.0;
    const h = top + (S.roofType === 'flat' ? 1.6 : (D / 2) * Math.tan(0.55) + 0.8);
    b.box(cx, h / 2, 0.3, 0.7, h, 0.7, M.brick, { surface: 'concrete' });
    b.box(cx, h + 0.05, 0.3, 0.82, 0.1, 0.82, M.concrete, { collide: false });
  }
  // steps up to the door, maybe a porch with a roof on posts
  b.box(0, y0 / 2 - 0.02, z1 + 0.45, 1.6, y0, 0.7, M.concrete, { surface: 'concrete' });
  if (porch) {
    const pd = 2.2;
    b.box(0, y0 - 0.06, z1 + pd / 2, W, 0.12, pd, M.planks, { surface: 'wood' });
    for (const px of [x0 + 0.2, -W / 6, W / 6, x1 - 0.2]) b.box(px, y0 + 1.35, z1 + pd - 0.15, 0.16, 2.7, 0.16, S.trim, { surface: 'wood' });
    b.box(0, y0 + 2.75, z1 + pd / 2, W + 0.3, 0.12, pd + 0.2, S.roof, { surface: 'wood' });
    railing(b, [x0 + 0.2, z1 + pd - 0.15], [-0.9, z1 + pd - 0.15], y0, S.trim, 0.85);
    railing(b, [0.9, z1 + pd - 0.15], [x1 - 0.2, z1 + pd - 0.15], y0, S.trim, 0.85);
  }
  return { builder: b, footprint: { w: W + 1, d: D + (porch ? 3.2 : 1) }, plan: { W, D } };
}

// Furniture for one storey: living and kitchen below, bedrooms above. Room spans the area in
// front of the stairwell.
function furnishStorey(b, rnd, f, floors, r, y) {
  const P = (it, x, z, rot) => FUR.place(b, it, x, y, z, rot);
  const W = r.x1 - r.x0;
  if (f === 0) {
    P(FUR.kitchenRun(rnd, Math.min(2.4, (r.z1 - r.z0) - 0.8)), r.x1 - 0.32, (r.z0 + r.z1) / 2, -Math.PI / 2);
    P(FUR.diningTable(rnd, { chairs: 4 }), r.x1 - 2.0, (r.z0 + r.z1) / 2, 0);
    P(FUR.sofa(rnd, { seats: 3 }), r.x0 + 0.5, (r.z0 + r.z1) / 2, Math.PI / 2);
    P(FUR.coffeeTable(rnd), r.x0 + 1.5, (r.z0 + r.z1) / 2, Math.PI / 2);
    if (W > 6) P(FUR.bookshelf(rnd), r.x0 + 2.4, r.z1 - 0.25, Math.PI);
  } else {
    P(FUR.bed(rnd, { double: rnd() < 0.6 }), r.x0 + 1.15, r.z1 - 1.1, Math.PI / 2);
    P(FUR.wardrobe(rnd), r.x1 - 0.35, r.z1 - 0.8, -Math.PI / 2);
    if (W > 6) P(FUR.bed(rnd, { double: false }), r.x1 - 1.6, r.z0 + 1.0, 0);
    if (f === floors - 1 && rnd() < 0.6) P(FUR.desk(rnd), (r.x0 + r.x1) / 2, r.z1 - 0.35, Math.PI);
    else P(FUR.dresser(rnd), (r.x0 + r.x1) / 2, r.z1 - 0.3, Math.PI);
  }
}

// ------------------------------------------------------------------ fire lookout
// Timber legs and bracing, six flights of stairs with landings switching back up the inside, and
// a glassed-in cab with a catwalk ten metres up: the best view for miles.
export function buildLookout(rnd) {
  const M = archMaterials();
  const b = new Builder('lookout');
  const H = 9.0,
    S = 2.3; // half the tower's width
  const wood = M.woodDark,
    rail = M.wood;
  // legs, girts every three metres, cross bracing on every face
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * S, H / 2, sz * S, 0.26, H, 0.26, wood);
  for (let y = 3; y < H; y += 3) {
    for (const s of [-1, 1]) {
      b.box(0, y, s * S, S * 2, 0.16, 0.12, wood, { collide: false });
      b.box(s * S, y, 0, 0.12, 0.16, S * 2, wood, { collide: false });
    }
  }
  for (let y = 0; y < H; y += 3)
    for (const s of [-1, 1]) {
      beam(b, [-S, y + 0.15, s * S], [S, y + 2.85, s * S], 0.1, 0.06, wood);
      beam(b, [S, y + 0.15, s * S], [-S, y + 2.85, s * S], 0.1, 0.06, wood);
      beam(b, [s * S, y + 0.15, -S], [s * S, y + 2.85, S], 0.06, 0.1, wood);
      beam(b, [s * S, y + 0.15, S], [s * S, y + 2.85, -S], 0.06, 0.1, wood);
    }
  // footings
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * S, 0.15, sz * S, 0.6, 0.4, 0.6, M.concrete, { surface: 'concrete' });
  // stairs: flights of 1.5 m along x in two strips, landings at the ends
  const zA = [-1.95, -0.95],
    zB = [-0.85, 0.15];
  const fl = 1.5,
    run = 2.3,
    xa = -run / 2,
    xb = run / 2;
  for (let k = 0; k < 6; k++) {
    const y = k * fl;
    const even = k % 2 === 0;
    const zs = even ? zA : zB;
    flight(b, even ? xa : xb, (zs[0] + zs[1]) / 2, y, even ? 1 : -1, 0, run, fl, 1.0, M.planks, { rail: even ? -1 : 1, railMat: rail });
    if (k < 5) {
      // landing at the top end, across both strips
      const lx = even ? xb + 0.45 : xa - 0.45;
      b.box(lx, y + fl - 0.05, (zA[0] + zB[1]) / 2, 0.9, 0.1, zB[1] - zA[0], M.planks, { surface: 'wood' });
      railing(b, [lx + (even ? 0.45 : -0.45), zA[0]], [lx + (even ? 0.45 : -0.45), zB[1]], y + fl, rail, 0.95);
    }
  }
  // the deck: a catwalk all round, the cab in the middle, a trapdoor over the last flight
  const D = 3.1; // half the deck
  const deck = (ax, az, bx, bz) => b.box((ax + bx) / 2, H - 0.06, (az + bz) / 2, bx - ax, 0.12, bz - az, M.planks, { surface: 'wood' });
  deck(-D, zB[1], D, D);
  deck(-D, -D, D, zB[0]);
  deck(-D, zB[0], xa, zB[1]);
  deck(xb, zB[0], D, zB[1]);
  b.box(0, H - 0.15, 0, D * 2, 0.08, D * 2, wood, { collide: false });
  railing(b, [-D, D], [D, D], H, rail);
  railing(b, [D, D], [D, -D], H, rail);
  railing(b, [D, -D], [-D, -D], H, rail);
  railing(b, [-D, -D], [-D, D], H, rail);
  // hatch rail round the opening (open toward the landing side)
  railing(b, [xa + 0.3, zB[1] + 0.02], [xb, zB[1] + 0.02], H, rail, 0.9);
  // cab: low walls, a band of windows all round, a door to the catwalk
  const C = 2.0;
  const sides = [
    { a: [-C, C], c: [C, C], side: 'front' },
    { a: [C, -C], c: [-C, -C], side: 'back' },
    { a: [-C, -C], c: [-C, C], side: 'left' },
    { a: [C, C], c: [C, -C], side: 'right' },
  ];
  for (const s of sides) {
    const ops = [];
    for (let k = 0; k < 3; k++) ops.push({ at: 0.68 + k * 1.32, w: 1.18, bottom: 0.95, top: 2.15, type: 'window' });
    if (s.side === 'front') ops.splice(1, 1, { at: 2.0, w: 0.9, bottom: 0, top: 2.1, type: 'door' });
    const info = b.wall(s.a, s.c, H, 2.4, 0.14, { outMat: M.sidingGreen, inMat: M.planks, openings: ops, outSide: 1 });
    for (const o of ops) {
      if (o.type === 'window') b.window(info, s.a, H, o, 0.14, { frameMat: M.trimWhite, glassMat: M.glass, broken: rnd() * 0.25, rnd, mullions: 0 });
      else b.doorway(info, s.a, H, o, 0.14, { frameMat: M.trimWhite, leafMat: M.sidingGreen, open: 0.5 });
    }
  }
  pyramidRoof(b, 0, 0, C + 0.55, H + 2.4, 1.3, M.shingles, M.planks);
  b.collider(0, H + 2.45, 0, C * 2, 0.1, C * 2, 0, 'wood');
  // inside: the fire finder on its stand, a cot, a stool, a little stove
  b.box(0.6, H + 0.5, 0.7, 0.12, 1.0, 0.12, wood, { collide: false });
  const disc = new THREE.CylinderGeometry(0.42, 0.42, 0.05, 24).translate(0.6, H + 1.03, 0.7);
  b.add(disc, M.metal);
  const ring = new THREE.TorusGeometry(0.4, 0.02, 6, 28).rotateX(Math.PI / 2).translate(0.6, H + 1.07, 0.7);
  b.add(ring, M.metalRed);
  b.collider(0.6, H + 0.5, 0.7, 0.85, 1.05, 0.85, 0, 'wood');
  FUR.place(b, FUR.bed(rnd, { double: false }), -1.45, H, 0.6, Math.PI / 2);
  FUR.place(b, FUR.stool(rnd), 1.3, H, 1.3, 0.3);
  FUR.place(b, FUR.stoveUnit(rnd), 1.55, H, -1.6, 0);
  b.loot.push({ pos: [1.4, H + 0.95, -1.6], kind: 'table' });
  b.loot.push({ pos: [0.6, H + 1.08, 0.7], kind: 'small' });
  b.lights.push({ pos: [0, H + 2.1, 0], color: 0xffe2b0, intensity: 0, distance: 8, fixture: true });
  return { builder: b, footprint: { w: 7, d: 7 } };
}

// ------------------------------------------------------------------ chapel
export function buildChurch(rnd) {
  const M = archMaterials();
  const b = new Builder('church');
  const ext = M.trimWhite,
    trim = M.woodDark;
  const y = 0.35;
  const hw = 3.6,
    z0 = -6.5,
    z1 = 5.5,
    wh = 4.2;
  b.box(0, y / 2 - 0.05, (z0 + z1) / 2 + 1.5, hw * 2 + 0.4, y + 0.1, z1 - z0 + 3.4, M.concrete, { surface: 'concrete' });
  b.box(0, y + 0.006, (z0 + z1) / 2, hw * 2 - T, 0.012, z1 - z0 - T, M.floorboards, { collide: false });
  // nave walls: tall windows down both sides
  const side = (a, c) => {
    const L = Math.abs(c[1] - a[1]);
    const ops = [];
    for (let k = 0; k < 4; k++) ops.push({ at: 1.6 + k * ((L - 3.2) / 3), w: 0.9, bottom: 1.1, top: 3.5, type: 'window' });
    const info = b.wall(a, c, y, wh, T, { outMat: ext, inMat: M.plaster, openings: ops, outSide: 1 });
    for (const o of ops) b.window(info, a, y, o, T, { frameMat: trim, glassMat: M.glassDirty, broken: rnd() * 0.4, rnd, mullions: 1 });
  };
  side([-hw, z0], [-hw, z1]);
  side([hw, z1], [hw, z0]);
  // back wall with a round window high up; front wall open into the tower
  const back = b.wall([hw, z0], [-hw, z0], y, wh, T, { outMat: ext, inMat: M.plaster, openings: [{ at: hw, w: 1.0, bottom: 2.6, top: 3.6, type: 'window' }], outSide: 1 });
  b.window(back, [hw, z0], y, { at: hw, w: 1.0, bottom: 2.6, top: 3.6 }, T, { frameMat: trim, glassMat: M.glassDirty, rnd, mullions: 1 });
  const fops = [{ at: hw, w: 1.6, bottom: 0, top: 2.6, type: 'gap' }];
  const front = b.wall([-hw, z1], [hw, z1], y, wh, T, { outMat: ext, inMat: M.plaster, openings: fops, outSide: 1 });
  b.doorway(front, [-hw, z1], y, fops[0], T, { frameMat: trim, leaf: false });
  b.gableRoof(-hw - T / 2, z0 - T / 2, hw + T / 2, z1 + T / 2, y + wh, 0.78, { mat: M.shingles, under: M.planks, fascia: trim, overhang: 0.45, ridgeAlong: 'z', gableMat: ext });
  // the bell tower in front: a square shaft, an open belfry, a spire with a cross
  const tw = 1.6,
    tz = z1 + tw; // centre of the tower
  const th = 9.0;
  const tsides = [
    { a: [-tw, tz + tw], c: [tw, tz + tw], f: true },
    { a: [tw, tz + tw], c: [tw, tz - tw] },
    { a: [-tw, tz - tw], c: [-tw, tz + tw] },
    { a: [tw, tz - tw], c: [-tw, tz - tw], back: true },
  ];
  for (const s of tsides) {
    const ops = [{ at: tw, w: 1.3, bottom: 6.6, top: 8.4, type: 'gap' }];
    if (s.f) ops.unshift({ at: tw, w: 1.5, bottom: 0, top: 2.6, type: 'door' });
    if (s.back) ops.unshift({ at: tw, w: 1.6, bottom: 0, top: 2.6, type: 'gap' });
    const info = b.wall(s.a, s.c, y, th, T, { outMat: ext, inMat: M.planks, openings: ops, outSide: 1 });
    for (const o of ops) {
      if (o.type === 'door') b.doorway(info, s.a, y, o, T, { frameMat: trim, leafMat: M.woodDark, open: rnd() < 0.5 ? 0.8 : 0, hingeSide: 1 });
      else if (o.bottom > 1) {
        // louvres in the belfry openings
        for (let k = 0; k < 4; k++) {
          const ly = y + o.bottom + 0.3 + k * 0.4;
          const mx = (s.a[0] + s.c[0]) / 2,
            mz = (s.a[1] + s.c[1]) / 2;
          const along = Math.abs(s.c[0] - s.a[0]) > 0.5;
          b.box(mx, ly, mz, along ? 1.25 : 0.04, 0.05, along ? 0.04 : 1.25, trim, { collide: false });
        }
      }
    }
  }
  b.box(0, y + 6.55, tz, tw * 2 - T, 0.1, tw * 2 - T, M.planks, { surface: 'wood' });
  // the bell on its yoke
  const bell = new THREE.LatheGeometry(
    [
      [0.02, -0.48],
      [0.36, -0.46],
      [0.33, -0.36],
      [0.24, -0.12],
      [0.2, 0.08],
      [0.12, 0.16],
      [0.0, 0.17],
    ].map(([r, h]) => new THREE.Vector2(r, h)),
    20
  );
  bell.translate(0, y + 7.9, tz);
  b.add(bell, M.metal);
  b.box(0, y + 8.12, tz, 1.2, 0.12, 0.12, trim, { collide: false });
  b.box(0, y + th + 0.05, tz, tw * 2 + 0.3, 0.12, tw * 2 + 0.3, trim, { collide: false });
  pyramidRoof(b, 0, tz, tw + 0.1, y + th + 0.1, 5.2, M.shingles, null);
  b.box(0, y + th + 5.6, tz, 0.08, 1.0, 0.08, M.metal, { collide: false });
  b.box(0, y + th + 5.8, tz, 0.5, 0.08, 0.08, M.metal, { collide: false });
  // steps
  b.box(0, y / 2 - 0.02, tz + tw + 0.5, 2.2, y, 0.8, M.concrete, { surface: 'concrete' });
  // pews, an altar, a lectern
  for (let r = 0; r < 6; r++) {
    const pz = z1 - 1.8 - r * 1.25;
    for (const s of [-1, 1]) {
      const px = s * 1.7;
      b.box(px, y + 0.45, pz, 2.4, 0.06, 0.42, M.woodDark, { collide: true });
      b.box(px, y + 0.75, pz - 0.2, 2.4, 0.55, 0.05, M.woodDark, { collide: false });
      for (const e of [-1, 1]) b.box(px + e * 1.18, y + 0.45, pz - 0.02, 0.06, 0.9, 0.46, M.woodDark, { collide: false });
    }
  }
  b.box(0, y + 0.18, z0 + 1.3, 4.4, 0.36, 2.2, M.floorboards, { surface: 'wood' });
  b.box(0, y + 0.36 + 0.48, z0 + 0.9, 1.8, 0.96, 0.7, M.woodDark);
  b.box(0, y + 0.36 + 0.97, z0 + 0.9, 1.95, 0.04, 0.8, M.fabricRed, { collide: false });
  b.box(-1.6, y + 0.36 + 0.6, z0 + 2.1, 0.5, 1.2, 0.4, M.woodDark);
  b.loot.push({ pos: [0, y + 0.36 + 1.0, z0 + 0.9], kind: 'table' });
  b.loot.push({ pos: [-1.6, y + 1.6, z0 + 2.1], kind: 'small' });
  b.loot.push({ pos: [2.5, y + 0.5, z1 - 2.0], kind: 'any' });
  b.lights.push({ pos: [0, y + 3.8, -0.5], color: 0xffd9a0, intensity: 0, distance: 12, fixture: true });
  return { builder: b, footprint: { w: hw * 2 + 1, d: z1 - z0 + 5 } };
}

// ------------------------------------------------------------------ grain silo
export function buildSilo(rnd) {
  const M = archMaterials();
  const b = new Builder('silo');
  const r = 2.2,
    h = 11;
  b.box(0, 0.1, 0, r * 2 + 0.6, 0.3, r * 2 + 0.6, M.concrete, { surface: 'concrete' });
  drum(b, 0, 0, 0.25, r, h, rnd() < 0.5 ? M.corrugated : M.corrugatedRust);
  const dome = new THREE.SphereGeometry(r, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.45, 1).translate(0, 0.25 + h, 0);
  b.add(dome, M.metalPainted);
  b.box(0, 0.25 + h + r * 0.45 + 0.15, 0, 0.5, 0.3, 0.5, M.metalPainted, { collide: false });
  // ladder up the side with a cage
  for (const s of [-1, 1]) b.box(s * 0.22, 0.25 + h / 2, r + 0.18, 0.05, h, 0.05, M.metal, { collide: false });
  for (let y = 0.6; y < h; y += 0.32) b.box(0, 0.25 + y, r + 0.18, 0.44, 0.03, 0.03, M.metal, { collide: false });
  // chute and hatch at the bottom
  b.box(0, 1.0, r + 0.05, 1.0, 1.4, 0.16, M.metalRed, { collide: false });
  return { builder: b, footprint: { w: r * 2 + 1, d: r * 2 + 1 } };
}

// ------------------------------------------------------------------ cabin
export function buildCabin(rnd) {
  const M = archMaterials();
  const b = new Builder('cabin');
  const y = 0.45;
  const W = 5.2,
    D = 6.0;
  const x0 = -W / 2,
    x1 = W / 2,
    z0 = -D / 2,
    z1 = D / 2;
  // on short posts
  for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) b.box(sx * (W / 2 - 0.2), y / 2, sz * (D / 2 - 0.2), 0.3, y, 0.3, M.concrete, { surface: 'concrete' });
  b.box(0, y - 0.08, 0, W, 0.16, D, M.woodDark, { surface: 'wood' });
  b.box(0, y + 0.006, 0, W - T, 0.012, D - T, M.floorboards, { collide: false });
  const sides = {
    front: [[x0, z1], [x1, z1], [{ at: 1.4, w: 0.95, bottom: 0, top: 2.05, type: 'door' }, { at: 3.7, w: 1.0, bottom: 0.9, top: 1.9, type: 'window' }]],
    back: [[x1, z0], [x0, z0], [{ at: W / 2, w: 0.9, bottom: 1.0, top: 1.8, type: 'window' }]],
    left: [[x0, z0], [x0, z1], [{ at: 3.6, w: 1.0, bottom: 0.9, top: 1.9, type: 'window' }]],
    right: [[x1, z1], [x1, z0], []],
  };
  for (const [a, c, ops] of Object.values(sides)) {
    const info = b.wall(a, c, y, 2.5, T, { outMat: M.woodDark, inMat: M.planks, openings: ops, outSide: 1 });
    for (const o of ops) {
      if (o.type === 'window') b.window(info, a, y, o, T, { frameMat: M.wood, glassMat: M.glassDirty, broken: rnd() * 0.5, rnd, mullions: 1 });
      else b.doorway(info, a, y, o, T, { frameMat: M.wood, leafMat: M.planks, open: rnd() < 0.4 ? 0.7 : 0 });
    }
  }
  // log corners
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.14, 0.14, 2.6, 10).translate(sx * (W / 2 + 0.02), y + 1.3, sz * (D / 2 + 0.02));
    b.add(g, M.wood);
  }
  b.box(0, y + 2.53, 0, W - T, 0.04, D - T, M.planks, { collide: false });
  b.collider(0, y + 2.56, 0, W, 0.1, D, 0, 'wood');
  b.gableRoof(x0 - 0.1, z0 - 0.1, x1 + 0.1, z1 + 0.1, y + 2.5, 0.62, { mat: M.shingles, under: M.planks, fascia: M.wood, overhang: 0.6, ridgeAlong: 'z', gableMat: M.woodDark });
  // stone chimney on the right
  const ch = y + 2.5 + (W / 2) * Math.tan(0.62) + 0.9;
  b.box(x1 + 0.35, ch / 2, -0.6, 0.8, ch, 1.0, M.concrete, { surface: 'concrete' });
  b.box(x1 + 0.35, ch + 0.05, -0.6, 0.9, 0.1, 1.1, M.concrete, { collide: false });
  // porch with a lean-to roof
  b.box(0, y - 0.08, z1 + 1.0, W, 0.14, 2.0, M.planks, { surface: 'wood' });
  for (const px of [x0 + 0.15, x1 - 0.15]) b.box(px, y + 1.1, z1 + 1.85, 0.14, 2.2, 0.14, M.wood);
  const lean = new THREE.BoxGeometry(W + 0.4, 0.08, 2.4).rotateX(0.18).translate(0, y + 2.32, z1 + 1.1);
  b.add(lean, M.shingles);
  b.collider(0, y + 2.32, z1 + 1.1, W + 0.4, 0.1, 2.4, 0, 'wood', 0.18);
  // a woodpile under the eave and a chopping block
  for (let r = 0; r < 3; r++)
    for (let k = 0; k < 6 - r; k++) {
      const g = new THREE.CylinderGeometry(0.11, 0.11, 0.9, 8).rotateX(Math.PI / 2).translate(x0 - 0.45, 0.12 + r * 0.2, -1.6 + k * 0.23 + r * 0.11);
      b.add(g, M.wood);
    }
  b.collider(x0 - 0.45, 0.35, -1.0, 0.9, 0.7, 1.5, 0, 'wood');
  b.box(x0 - 0.6, 0.25, 1.4, 0.45, 0.5, 0.45, M.woodDark);
  // inside
  FUR.place(b, FUR.bed(rnd, { double: false }), x0 + 0.65, y, z0 + 1.2, Math.PI / 2);
  FUR.place(b, FUR.diningTable(rnd, { chairs: 2 }), 0.6, y, 0.8, 0);
  FUR.place(b, FUR.stoveUnit(rnd), x1 - 0.42, y, -0.6, -Math.PI / 2);
  FUR.place(b, FUR.bookshelf(rnd), x1 - 0.3, y, 1.6, -Math.PI / 2);
  b.lights.push({ pos: [0, y + 2.2, 0], color: 0xffd9a0, intensity: 0, distance: 7, fixture: true });
  return { builder: b, footprint: { w: W + 2, d: D + 3 } };
}

// ------------------------------------------------------------------ sawmill
export function buildSawmill(rnd) {
  const M = archMaterials();
  const b = new Builder('sawmill');
  const L = 15,
    Wd = 8,
    H = 4.6;
  b.box(0, 0.08, 0, L + 0.6, 0.2, Wd + 0.6, M.concrete, { surface: 'concrete' });
  for (let i = 0; i <= 5; i++) for (const s of [-1, 1]) b.box(-L / 2 + (i * L) / 5, H / 2, s * (Wd / 2), 0.25, H, 0.25, M.woodDark);
  for (const s of [-1, 1]) b.box(0, H, s * (Wd / 2), L + 0.3, 0.3, 0.2, M.woodDark, { collide: false });
  b.gableRoof(-L / 2, -Wd / 2, L / 2, Wd / 2, H + 0.1, 0.3, { mat: M.corrugatedRust, under: M.planks, fascia: M.woodDark, overhang: 0.7, ridgeAlong: 'x' });
  // the saw: carriage rails, a log on the carriage, the big blade in its housing
  for (const s of [-1, 1]) b.box(0, 0.25, s * 0.7, L - 2, 0.1, 0.12, M.metal, { surface: 'metal' });
  b.box(-2.5, 0.6, 0, 3.0, 0.5, 1.6, M.metalPainted, { surface: 'metal' });
  const log = new THREE.CylinderGeometry(0.45, 0.5, 5.0, 14).rotateZ(Math.PI / 2).translate(-2.5, 1.3, 0);
  b.add(log, M.wood);
  b.collider(-2.5, 1.3, 0, 5, 0.9, 0.9, 0, 'wood');
  const blade = new THREE.CylinderGeometry(0.9, 0.9, 0.03, 36).rotateX(Math.PI / 2).translate(1.6, 1.4, -0.95);
  b.add(blade, M.metal);
  b.box(1.6, 0.9, -1.3, 1.4, 1.8, 0.6, M.metalGreen, { surface: 'metal' });
  // stacks of boards and logs
  for (let k = 0; k < 3; k++) for (let r = 0; r < 6; r++) b.box(-L / 2 + 1.5 + k * 1.3, 0.25 + r * 0.12, Wd / 2 - 1.3, 1.1, 0.1, 2.0, M.wood, { collide: false });
  b.collider(-L / 2 + 2.8, 0.6, Wd / 2 - 1.3, 3.8, 0.9, 2.0, 0, 'wood');
  for (let r = 0; r < 3; r++)
    for (let k = 0; k < 7 - r * 2; k++) {
      const g = new THREE.CylinderGeometry(0.32, 0.36, 6.0, 12).rotateZ(Math.PI / 2).translate(L / 2 + 3.5, 0.36 + r * 0.6, -3 + k * 0.7 + r * 0.7);
      b.add(g, M.wood);
    }
  b.collider(L / 2 + 3.5, 0.9, -0.9, 6, 1.8, 5, 0, 'wood');
  // the office shack at one end
  const ox = -L / 2 - 2.2;
  const ops = { front: [{ at: 1.3, w: 0.9, bottom: 0, top: 2.05, type: 'door' }], right: [{ at: 1.5, w: 1.0, bottom: 0.9, top: 1.9, type: 'window' }] };
  for (const [side, [a, c]] of Object.entries({ front: [[ox - 1.6, 1.8], [ox + 1.6, 1.8]], back: [[ox + 1.6, -1.8], [ox - 1.6, -1.8]], left: [[ox - 1.6, -1.8], [ox - 1.6, 1.8]], right: [[ox + 1.6, 1.8], [ox + 1.6, -1.8]] })) {
    const o = ops[side] || [];
    const info = b.wall(a, c, 0.2, 2.5, 0.16, { outMat: M.planks, inMat: M.planks, openings: o, outSide: 1 });
    for (const op of o) {
      if (op.type === 'window') b.window(info, a, 0.2, op, 0.16, { frameMat: M.woodDark, glassMat: M.glassDirty, broken: 0.5, rnd });
      else b.doorway(info, a, 0.2, op, 0.16, { frameMat: M.woodDark, leafMat: M.planks, open: 0.3 });
    }
  }
  b.box(ox, 0.21, 0, 3.0, 0.02, 3.4, M.floorboards, { collide: false });
  b.box(ox, 2.75, 0, 3.6, 0.1, 4.0, M.corrugated, {});
  FUR.place(b, FUR.desk(rnd), ox - 0.6, 0.2, -1.4, 0);
  FUR.place(b, FUR.filingCabinet(rnd), ox + 1.2, 0.2, -1.45, 0);
  FUR.place(b, FUR.workbench(rnd), -L / 2 + 1.2, 0.2, -Wd / 2 + 0.5, 0);
  // the wigwam burner: a tall steel cone with a mesh cap, rusting
  const bx = L / 2 + 4.5,
    bz = Wd / 2 + 5;
  const cone = new THREE.CylinderGeometry(1.0, 4.0, 11, 28, 1, true);
  const uv = cone.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 16, uv.getY(i) * 11);
  cone.translate(bx, 5.6, bz);
  b.add(cone, M.corrugatedRust);
  const cap = new THREE.CylinderGeometry(1.05, 1.05, 1.0, 20, 1, true).translate(bx, 11.6, bz);
  b.add(cap, M.metal);
  for (const a of [0, Math.PI / 4]) b.collider(bx, 3, bz, 5.6, 6, 5.6, a, 'metal');
  b.box(bx, 1.2, bz + 3.6, 1.4, 1.6, 0.6, M.metal, { collide: false });
  b.loot.push({ pos: [ox - 0.6, 0.95, -1.4], kind: 'desk' });
  b.loot.push({ pos: [-L / 2 + 1.2, 1.15, -Wd / 2 + 0.5], kind: 'tools' });
  b.loot.push({ pos: [3.5, 0.3, 2.6], kind: 'storage' });
  b.lights.push({ pos: [0, H - 0.4, 0], color: 0xffe2b0, intensity: 0, distance: 12, fixture: true });
  return { builder: b, footprint: { w: L + 12, d: Wd + 10 } };
}

// ------------------------------------------------------------------ styles for the storeyed houses
export function storeyStyle(M, kind, rnd) {
  switch (kind) {
    case 'lodge':
      return { ext: M.woodDark, inner: M.planks, trim: M.wood, roof: M.shingles, roofType: 'gable', floor: M.floorboards };
    case 'farm':
      return { ext: [M.siding, M.sidingYellow, M.trimWhite][Math.floor(rnd() * 3)], inner: M.wallpaper, trim: M.trimWhite, roof: M.shingles, roofType: 'gable', floor: M.floorboards };
    case 'town':
      return { ext: M.brick, inner: M.plaster, trim: M.trimWhite, roof: M.concrete, roofType: 'flat', floor: M.floorboards };
    default:
      return { ext: [M.siding, M.sidingGreen, M.stucco][Math.floor(rnd() * 3)], inner: M.plaster, trim: M.trimWhite, roof: M.shingles, roofType: 'gable', floor: M.floorboards };
  }
}
