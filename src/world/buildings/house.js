// House generator: floor plan (rooms, doors, windows), walls with openings, floors, ceilings,
// roof variants, porch, room-specific furniture and loot spots, abandonment details.

import * as THREE from 'three';
import { Builder } from './builder.js';
import { archMaterials } from './materials.js';
import * as FUR from './furniture.js';
import { place } from './furniture.js';

const WALL_H = 3.0;
const EXT_T = 0.24;
const INT_T = 0.12;

// ---------------------------------------------------------------- floor plan
function planHouse(rnd) {
  // roomy: real family houses, not doll's houses
  const W = Math.round((10.5 + rnd() * 5) * 2) / 2;
  const D = Math.round((8.5 + rnd() * 3.5) * 2) / 2;
  const x0 = -W / 2,
    x1 = W / 2,
    z0 = -D / 2,
    z1 = D / 2;
  const frontD = Math.round(D * (0.5 + rnd() * 0.12) * 2) / 2;
  const zMid = z1 - frontD;
  const rooms = [];
  // front zone: living (with entrance) + kitchen
  const livingW = Math.round(W * (0.55 + rnd() * 0.1) * 2) / 2;
  const leftLiving = rnd() < 0.5;
  if (leftLiving) {
    rooms.push({ type: 'living', x0, z0: zMid, x1: x0 + livingW, z1 });
    rooms.push({ type: 'kitchen', x0: x0 + livingW, z0: zMid, x1, z1 });
  } else {
    rooms.push({ type: 'kitchen', x0, z0: zMid, x1: x1 - livingW, z1 });
    rooms.push({ type: 'living', x0: x1 - livingW, z0: zMid, x1, z1 });
  }
  // back zone: bedrooms + bath
  const bathW = 2.2 + rnd() * 0.4;
  const restW = W - bathW;
  const twoBeds = restW > 7;
  const bathLeft = rnd() < 0.5;
  let bx = x0;
  const back = [];
  if (bathLeft) {
    back.push({ type: 'bath', w: bathW });
  }
  if (twoBeds) {
    const b1 = Math.round((restW / 2) * 2) / 2;
    back.push({ type: 'bedroom', w: b1 }, { type: 'bedroom', w: restW - b1 });
  } else back.push({ type: 'bedroom', w: restW });
  if (!bathLeft) back.push({ type: 'bath', w: bathW });
  for (const r of back) {
    rooms.push({ type: r.type, x0: bx, z0, x1: bx + r.w, z1: zMid });
    bx += r.w;
  }
  rooms[rooms.length - 1].x1 = x1;
  return { W, D, x0, x1, z0, z1, zMid, rooms };
}

// connections: each back room gets a door into the front room above it (prefer living)
function connections(plan) {
  const links = [];
  const front = plan.rooms.filter((r) => r.z1 === plan.z1);
  const backs = plan.rooms.filter((r) => r.z1 === plan.zMid);
  for (const b of backs) {
    let best = null,
      bestOverlap = 0;
    for (const f of front) {
      const ov = Math.min(b.x1, f.x1) - Math.max(b.x0, f.x0);
      const pref = f.type === 'living' ? 1.2 : 1;
      if (ov * pref > bestOverlap && ov > 1.1) {
        bestOverlap = ov * pref;
        best = f;
      }
    }
    if (best) {
      const lo = Math.max(b.x0, best.x0) + 0.6,
        hi = Math.min(b.x1, best.x1) - 0.6;
      links.push({ axis: 'x', z: plan.zMid, at: (lo + hi) / 2 + (b.type === 'bath' ? 0 : 0), a: b, b: best });
    }
  }
  // front rooms connect to each other
  const [fa, fb] = front;
  links.push({ axis: 'z', x: fa.x1, at: (plan.zMid + plan.z1) / 2 - 0.4, a: fa, b: fb, open: true });
  return links;
}

const STYLES = {
  siding: (M, rnd) => ({ ext: [M.siding, M.sidingYellow, M.sidingGreen][Math.floor(rnd() * 3)], roof: M.shingles, trim: M.trimWhite, roofType: 'gable' }),
  stucco: (M, rnd) => ({ ext: [M.stucco, M.stuccoPink, M.stuccoBlue][Math.floor(rnd() * 3)], roof: M.rooftiles, trim: M.woodDark, roofType: rnd() < 0.5 ? 'gable' : 'flat' }),
  adobe: (M) => ({ ext: M.adobe, roof: M.adobe, trim: M.woodDark, roofType: 'flat' }),
  brick: (M) => ({ ext: M.brick, roof: M.shingles, trim: M.trimWhite, roofType: 'gable' }),
};

export function buildHouse(rnd, { style = null, abandoned = 0.7, garage = false } = {}) {
  const M = archMaterials();
  const plan = planHouse(rnd);
  const styleName = style || ['siding', 'stucco', 'adobe', 'brick'][Math.floor(rnd() * 4)];
  const S = STYLES[styleName](M, rnd);
  const b = new Builder('house');
  const floorY = 0.3;
  const { x0, x1, z0, z1, rooms } = plan;
  // foundation / plinth
  b.box(0, floorY / 2 - 0.05, 0, plan.W + 0.3, floorY + 0.1, plan.D + 0.3, M.concrete, { surface: 'concrete' });
  // floors per room
  const roomFloor = { living: M.floorboards, kitchen: M.linoleum, bath: M.tiles, bedroom: M.floorboards };
  const roomWall = {
    living: [M.wallpaper, M.plaster, M.plasterGreen][Math.floor(rnd() * 3)],
    kitchen: [M.plaster, M.plasterBlue][Math.floor(rnd() * 2)],
    bath: M.tiles,
    bedroom: [M.wallpaper, M.plasterBlue, M.plaster][Math.floor(rnd() * 3)],
  };
  for (const r of rooms) {
    r.wallMat = roomWall[r.type] === M.wallpaper && r.type === 'bedroom' ? M.plasterGreen : roomWall[r.type];
    b.box((r.x0 + r.x1) / 2, floorY + 0.01, (r.z0 + r.z1) / 2, r.x1 - r.x0, 0.02, r.z1 - r.z0, roomFloor[r.type], { collide: false });
    // ceiling
    b.box((r.x0 + r.x1) / 2, floorY + WALL_H + 0.03, (r.z0 + r.z1) / 2, r.x1 - r.x0, 0.06, r.z1 - r.z0, M.ceiling, { collide: false });
  }
  b.collider(0, floorY - 0.1, 0, plan.W, 0.2, plan.D, 0, 'wood');
  // ceiling collider (keeps physics items in)
  b.collider(0, floorY + WALL_H + 0.06, 0, plan.W, 0.1, plan.D, 0, 'wood');

  const roomAt = (x, z) => rooms.find((r) => x > r.x0 - 0.01 && x < r.x1 + 0.01 && z > r.z0 - 0.01 && z < r.z1 + 0.01);
  // ---------------------------------------------------------- exterior walls with openings
  const living = rooms.find((r) => r.type === 'living');
  const doorAt = (living.x0 + living.x1) / 2 + (rnd() - 0.5) * 0.8;
  const ext = [
    { a: [x0, z1], b: [x1, z1], side: 'front' }, // front: +z facing
    { a: [x1, z0], b: [x0, z0], side: 'back' },
    { a: [x0, z0], b: [x0, z1], side: 'left' },
    { a: [x1, z1], b: [x1, z0], side: 'right' },
  ];
  const windows = [];
  const allOpenings = []; // {x, z, w, type} in house coordinates
  for (const w of ext) {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const ux = (w.b[0] - w.a[0]) / L,
      uz = (w.b[1] - w.a[1]) / L;
    const openings = [];
    // rooms along this wall
    const along = [];
    for (const r of rooms) {
      let s0, s1;
      if (w.side === 'front' && Math.abs(r.z1 - z1) < 0.01) [s0, s1] = [r.x0 - x0, r.x1 - x0];
      else if (w.side === 'back' && Math.abs(r.z0 - z0) < 0.01) [s0, s1] = [x1 - r.x1, x1 - r.x0];
      else if (w.side === 'left' && Math.abs(r.x0 - x0) < 0.01) [s0, s1] = [r.z0 - z0, r.z1 - z0];
      else if (w.side === 'right' && Math.abs(r.x1 - x1) < 0.01) [s0, s1] = [z1 - r.z1, z1 - r.z0];
      else continue;
      along.push({ r, s0, s1 });
    }
    for (const { r, s0, s1 } of along) {
      const len = s1 - s0;
      if (w.side === 'front' && r === living) {
        const at = doorAt - x0;
        openings.push({ at, w: 1.0, bottom: 0, top: 2.1, type: 'door', room: r, ext: true });
        // window beside the door
        const other = at - s0 > s1 - at ? (s0 + at - 0.6) / 2 : (at + 0.6 + s1) / 2;
        if (Math.abs(other - at) > 1.4) openings.push({ at: other, w: 1.4, bottom: 0.85, top: 2.15, type: 'window', room: r });
        continue;
      }
      if (r.type === 'bath') {
        if (len > 1.4 && rnd() < 0.8) openings.push({ at: (s0 + s1) / 2, w: 0.7, bottom: 1.55, top: 2.15, type: 'window', room: r });
        continue;
      }
      if (r.type === 'kitchen' && w.side === 'back' && rnd() < 0.5 && len > 2.2) {
        openings.push({ at: s0 + 0.9, w: 0.9, bottom: 0, top: 2.1, type: 'door', room: r, ext: true });
        continue;
      }
      if (len > 2.2) {
        const n = len > 4.5 ? 2 : 1;
        for (let k = 0; k < n; k++) openings.push({ at: s0 + (len * (k + 0.5)) / n, w: 1.2, bottom: 0.9, top: 2.15, type: 'window', room: r });
      }
    }
    const info = b.wall(w.a, w.b, floorY, WALL_H, EXT_T, { outMat: S.ext, inMat: M.plaster, openings, outSide: 1, surface: 'wood' });
    for (const o of openings) allOpenings.push({ x: w.a[0] + ux * o.at, z: w.a[1] + uz * o.at, w: o.w, type: o.type, low: o.bottom });
    // per-room inner finish: overlay thin interior panels per room segment
    for (const o of openings) {
      if (o.type === 'window') {
        const broken = abandoned * (0.3 + rnd() * 0.5);
        b.window(info, w.a, floorY, o, EXT_T, { frameMat: S.trim, glassMat: rnd() < 0.5 ? M.glassDirty : M.glass, broken, sillMat: S.trim, rnd });
        windows.push({ w, o, info });
      } else {
        const missing = rnd() < abandoned * 0.25;
        b.doorway(info, w.a, floorY, o, EXT_T, { frameMat: S.trim, leafMat: rnd() < 0.5 ? M.woodDark : M.trimWhite, leaf: !missing, open: rnd() < abandoned * 0.4 ? 0.7 : 0, hingeSide: 1 });
        // steps
        const cx = w.a[0] + ux * o.at,
          cz = w.a[1] + uz * o.at;
        const nx = -uz,
          nz = ux; // outward (left normal) for these walls
        b.box(cx + nx * 0.45, floorY / 2 - 0.02, cz + nz * 0.45, Math.abs(uz) > 0.5 ? 0.6 : 1.4, floorY, Math.abs(ux) > 0.5 ? 0.6 : 1.4, M.concrete, { surface: 'concrete' });
      }
    }
    // inner finish panels per room (thin, on the inner face) using the room's wall material
    for (const { r, s0, s1 } of along) {
      if (r.wallMat === M.plaster) continue;
      const ops = openings.filter((o) => o.at > s0 && o.at < s1).map((o) => ({ ...o, at: o.at - s0 }));
      const a2 = [w.a[0] + ux * s0, w.a[1] + uz * s0],
        b2 = [w.a[0] + ux * s1, w.a[1] + uz * s1];
      // offset inward by half thickness
      const nx = uz,
        nz = -ux; // inward (right normal) for these walls
      const off = EXT_T / 2 + 0.006;
      b.wall([a2[0] + nx * off, a2[1] + nz * off], [b2[0] + nx * off, b2[1] + nz * off], floorY + 0.02, WALL_H - 0.02, 0.012, { outMat: r.wallMat, inMat: r.wallMat, openings: ops, outSide: null, collide: false });
    }
  }

  // ---------------------------------------------------------- interior walls
  const links = connections(plan);
  // wall between front and back zones (z = zMid), split per x-range with door openings
  const intWalls = [];
  intWalls.push({ a: [x0 + EXT_T / 2, plan.zMid], b: [x1 - EXT_T / 2, plan.zMid] });
  // vertical walls between rooms in each zone
  const front = rooms.filter((r) => r.z1 === z1),
    backR = rooms.filter((r) => r.z1 === plan.zMid);
  for (const zone of [front, backR]) {
    for (let i = 0; i < zone.length - 1; i++) {
      const xw = zone[i].x1;
      intWalls.push({ a: [xw, zone[i].z0 + (zone[i].z0 === z0 ? EXT_T / 2 : INT_T / 2)], b: [xw, zone[i].z1 - (zone[i].z1 === z1 ? EXT_T / 2 : INT_T / 2)] });
    }
  }
  for (const wdef of intWalls) {
    const horiz = Math.abs(wdef.a[1] - wdef.b[1]) < 0.01;
    const openings = [];
    for (const l of links) {
      if (horiz && l.axis === 'x' && Math.abs(l.z - wdef.a[1]) < 0.01) openings.push({ at: l.at - wdef.a[0], w: 0.9, bottom: 0, top: 2.05, type: 'door', link: l });
      if (!horiz && l.axis === 'z' && Math.abs(l.x - wdef.a[0]) < 0.01) {
        const s = l.at - wdef.a[1];
        if (s > 0.5 && s < Math.abs(wdef.b[1] - wdef.a[1]) - 0.5) openings.push({ at: s, w: l.open ? 1.4 : 0.9, bottom: 0, top: l.open ? 2.3 : 2.05, type: l.open ? 'arch' : 'door', link: l });
      }
    }
    const info = b.wall(wdef.a, wdef.b, floorY, WALL_H, INT_T, { outMat: M.plaster, inMat: M.plaster, openings, outSide: null });
    {
      const L0 = Math.hypot(wdef.b[0] - wdef.a[0], wdef.b[1] - wdef.a[1]);
      const ux0 = (wdef.b[0] - wdef.a[0]) / L0,
        uz0 = (wdef.b[1] - wdef.a[1]) / L0;
      for (const o of openings) allOpenings.push({ x: wdef.a[0] + ux0 * o.at, z: wdef.a[1] + uz0 * o.at, w: o.w, type: 'door', low: 0 });
    }
    // finishes on both sides according to adjacent rooms
    const L = Math.hypot(wdef.b[0] - wdef.a[0], wdef.b[1] - wdef.a[1]);
    const ux = (wdef.b[0] - wdef.a[0]) / L,
      uz = (wdef.b[1] - wdef.a[1]) / L;
    const nx = -uz,
      nz = ux;
    for (const sgn of [1, -1]) {
      // sample rooms along the wall on this side
      const segs = [];
      const step = 0.25;
      let cur = null;
      for (let s = 0; s <= L; s += step) {
        const px = wdef.a[0] + ux * s + nx * sgn * 0.3,
          pz = wdef.a[1] + uz * s + nz * sgn * 0.3;
        const r = roomAt(px, pz);
        if (!cur || cur.r !== r) {
          cur = { r, s0: s, s1: s };
          segs.push(cur);
        } else cur.s1 = s;
      }
      for (const sg of segs) {
        if (!sg.r || sg.r.wallMat === M.plaster) continue;
        const s0 = Math.max(0, sg.s0 - step / 2),
          s1 = Math.min(L, sg.s1 + step / 2);
        const ops = openings.filter((o) => o.at > s0 && o.at < s1).map((o) => ({ ...o, at: o.at - s0 }));
        const off = INT_T / 2 + 0.006;
        const a2 = [wdef.a[0] + ux * s0 + nx * sgn * off, wdef.a[1] + uz * s0 + nz * sgn * off];
        const b2 = [wdef.a[0] + ux * s1 + nx * sgn * off, wdef.a[1] + uz * s1 + nz * sgn * off];
        b.wall(a2, b2, floorY + 0.02, WALL_H - 0.02, 0.012, { outMat: sg.r.wallMat, inMat: sg.r.wallMat, openings: ops, outSide: null, collide: false });
      }
    }
    for (const o of openings) {
      if (o.type === 'door') b.doorway(info, wdef.a, floorY, o, INT_T, { frameMat: S.trim, leafMat: M.trimWhite, leaf: rnd() > abandoned * 0.3, open: rnd() < 0.5 ? 1 : 0.15 + rnd() * 0.5, hingeSide: rnd() < 0.5 ? 1 : -1 });
      else b.doorway(info, wdef.a, floorY, o, INT_T, { frameMat: S.trim, leaf: false });
    }
  }

  // ---------------------------------------------------------- roof
  const roofY = floorY + WALL_H + 0.06;
  if (S.roofType === 'gable') {
    const alongX = plan.W >= plan.D;
    b.gableRoof(x0 - EXT_T / 2, z0 - EXT_T / 2, x1 + EXT_T / 2, z1 + EXT_T / 2, roofY, (24 + rnd() * 10) * (Math.PI / 180), {
      mat: S.roof,
      under: S.trim,
      fascia: S.trim,
      overhang: 0.45,
      ridgeAlong: alongX ? 'x' : 'z',
      gableMat: S.ext,
    });
    // top plate band hiding the wall/roof junction
    b.box(0, roofY - 0.02, z1 + 0.01, plan.W + EXT_T + 0.02, 0.14, EXT_T + 0.03, S.trim, { collide: false });
    b.box(0, roofY - 0.02, z0 - 0.01, plan.W + EXT_T + 0.02, 0.14, EXT_T + 0.03, S.trim, { collide: false });
  } else {
    b.flatRoof(x0 - EXT_T / 2, z0 - EXT_T / 2, x1 + EXT_T / 2, z1 + EXT_T / 2, roofY, { mat: M.concrete, parapetMat: S.ext, parapet: 0.45 });
    // vigas (protruding roof beams) for adobe
    if (styleName === 'adobe')
      for (let x = x0 + 0.6; x < x1 - 0.3; x += 0.9) {
        const g = new THREE.CylinderGeometry(0.08, 0.09, 0.5, 8);
        g.rotateX(Math.PI / 2);
        g.translate(x, roofY - 0.15, z1 + EXT_T / 2 + 0.2);
        b.add(g, M.woodDark);
      }
  }
  // ---------------------------------------------------------- porch
  if (rnd() < 0.65 && S.roofType === 'gable') {
    const pd = 1.8;
    const pw = Math.min(plan.W, 5 + rnd() * 3);
    const pcx = Math.max(x0 + pw / 2, Math.min(x1 - pw / 2, doorAt));
    b.box(pcx, floorY - 0.06, z1 + EXT_T / 2 + pd / 2, pw, 0.12, pd, M.woodDark, { surface: 'wood' });
    // deck boards visual seams
    for (let x = pcx - pw / 2 + 0.15; x < pcx + pw / 2; x += 0.15) b.box(x, floorY + 0.001, z1 + EXT_T / 2 + pd / 2, 0.006, 0.004, pd, M.trimDark, { collide: false });
    const posts = Math.max(2, Math.round(pw / 2.2) + 1);
    for (let i = 0; i < posts; i++) {
      const x = pcx - pw / 2 + 0.1 + ((pw - 0.2) * i) / (posts - 1);
      b.box(x, floorY + 1.25, z1 + EXT_T / 2 + pd - 0.1, 0.12, 2.5, 0.12, S.trim, { surface: 'wood' });
    }
    // lean-to roof
    const slope = 0.16;
    const len = pd + 0.35;
    const g = new THREE.BoxGeometry(pw + 0.3, 0.06, len / Math.cos(slope));
    const p = g.attributes.position,
      uv = g.attributes.uv,
      n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, p.getX(i), p.getZ(i));
    g.rotateX(slope);
    g.translate(pcx, floorY + 2.62 - Math.sin(slope) * (len / 2), z1 + EXT_T / 2 + len / 2 - 0.1);
    b.add(g, M.corrugated);
    b.box(pcx, floorY + 2.42, z1 + EXT_T / 2 + pd - 0.1, pw, 0.16, 0.12, S.trim, { collide: false });
    // railing
    if (rnd() < 0.6)
      for (const s of [-1, 1]) {
        const xx = pcx + s * (pw / 2 - 0.06);
        b.box(xx, floorY + 0.9, z1 + EXT_T / 2 + pd / 2, 0.06, 0.06, pd - 0.2, S.trim, { collide: false });
        for (let k = 0; k < 6; k++) b.box(xx, floorY + 0.45, z1 + EXT_T / 2 + 0.25 + k * 0.27, 0.04, 0.9, 0.04, S.trim, { collide: false });
      }
  }
  // ---------------------------------------------------------- furniture
  for (const r of rooms) furnishRoom(b, r, rnd, floorY, allOpenings);
  // debris: sand drifts inside near doors, scattered boards
  if (abandoned > 0.3) {
    for (let i = 0; i < 2; i++) {
      const r = rooms[Math.floor(rnd() * rooms.length)];
      const x = r.x0 + 0.5 + rnd() * (r.x1 - r.x0 - 1),
        z = r.z0 + 0.5 + rnd() * (r.z1 - r.z0 - 1);
      const g = new THREE.BoxGeometry(0.1 + rnd() * 0.1, 0.02, 0.8 + rnd() * 0.8);
      g.rotateY(rnd() * Math.PI);
      g.translate(x, floorY + 0.03, z);
      b.add(g, M.wood);
    }
  }
  const footprint = { w: plan.W + 1, d: plan.D + 3.2 };
  return { builder: b, plan, footprint, floorY };
}

// ---------------------------------------------------------------- furnishing
// Places furniture against room walls, keeping doors, door swings and windows (for tall pieces) clear.
class RoomPlacer {
  constructor(b, r, y, openings, rnd) {
    this.b = b;
    this.r = r;
    this.y = y;
    this.rnd = rnd;
    this.pad = 0.14;
    this.placed = []; // AABBs [x0,z0,x1,z1]
    const { x0, x1, z0, z1 } = r;
    this.walls = {
      back: { axis: 'x', c: z0, from: x0, to: x1, rot: 0, inward: 1 },
      front: { axis: 'x', c: z1, from: x0, to: x1, rot: Math.PI, inward: -1 },
      left: { axis: 'z', c: x0, from: z0, to: z1, rot: Math.PI / 2, inward: 1 },
      right: { axis: 'z', c: x1, from: z0, to: z1, rot: -Math.PI / 2, inward: -1 },
    };
    // openings on each wall line
    for (const w of Object.values(this.walls)) {
      w.blocks = [];
      for (const o of openings) {
        const onLine = w.axis === 'x' ? Math.abs(o.z - w.c) < 0.3 && o.x > w.from - 0.3 && o.x < w.to + 0.3 : Math.abs(o.x - w.c) < 0.3 && o.z > w.from - 0.3 && o.z < w.to + 0.3;
        if (!onLine) continue;
        const s = w.axis === 'x' ? o.x : o.z;
        w.blocks.push({ s0: s - o.w / 2 - 0.08, s1: s + o.w / 2 + 0.08, type: o.type, low: o.low });
        if (o.type !== 'window') {
          // door swing / passage zone inside the room
          const depth = 1.05;
          if (w.axis === 'x') this.placed.push([s - o.w / 2 - 0.15, Math.min(w.c, w.c + w.inward * depth), s + o.w / 2 + 0.15, Math.max(w.c, w.c + w.inward * depth)]);
          else this.placed.push([Math.min(w.c, w.c + w.inward * depth), s - o.w / 2 - 0.15, Math.max(w.c, w.c + w.inward * depth), s + o.w / 2 + 0.15]);
        }
      }
    }
  }

  overlaps(box) {
    const { x0, x1, z0, z1 } = this.r;
    if (box[0] < x0 + 0.1 || box[2] > x1 - 0.1 || box[1] < z0 + 0.1 || box[3] > z1 - 0.1) return true;
    return this.placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1]);
  }

  // Place against a wall; sides = preferred wall names; returns true on success.
  wall(item, sides, { tall = item.size[1] > 1.0, centre = false, gap = 0.0 } = {}) {
    const [w, , d] = item.size;
    for (const side of sides) {
      const wl = this.walls[side];
      const len = wl.to - wl.from;
      const cands = [];
      for (let s = wl.from + this.pad + w / 2; s <= wl.to - this.pad - w / 2 + 1e-6; s += 0.1) cands.push(s);
      if (!cands.length) continue;
      const mid = (wl.from + wl.to) / 2;
      const pref = centre ? mid : wl.from + len * (0.2 + this.rnd() * 0.6);
      cands.sort((a, b2) => Math.abs(a - pref) - Math.abs(b2 - pref));
      for (const s of cands) {
        // windows/doors on this wall
        const hit = wl.blocks.some((k) => s + w / 2 > k.s0 && s - w / 2 < k.s1 && (k.type !== 'window' || tall || item.size[1] > k.low - 0.05));
        if (hit) continue;
        const off = this.pad + d / 2 + gap;
        let x, z, box;
        if (wl.axis === 'x') {
          x = s;
          z = wl.c + wl.inward * off;
          box = [x - w / 2, z - d / 2, x + w / 2, z + d / 2];
        } else {
          z = s;
          x = wl.c + wl.inward * off;
          box = [x - d / 2, z - w / 2, x + d / 2, z + w / 2];
        }
        if (this.overlaps(box)) continue;
        place(this.b, item, x, this.y, z, wl.rot);
        this.placed.push(box);
        this.last = { x, z, rot: wl.rot, side, s };
        return true;
      }
    }
    return false;
  }

  // Place freestanding at (x,z) with rotation (0 or PI keeps w along x)
  free(item, x, z, rot = 0) {
    const [w, , d] = item.size;
    const q = Math.abs(Math.sin(rot)) > 0.5;
    const box = q ? [x - d / 2, z - w / 2, x + d / 2, z + w / 2] : [x - w / 2, z - d / 2, x + w / 2, z + d / 2];
    if (this.overlaps(box)) return false;
    place(this.b, item, x, this.y, z, rot);
    this.placed.push(box);
    return true;
  }
}

function furnishRoom(b, r, rnd, y, openings) {
  const W = r.x1 - r.x0,
    D = r.z1 - r.z0;
  const cx = (r.x0 + r.x1) / 2,
    cz = (r.z0 + r.z1) / 2;
  const P = new RoomPlacer(b, r, y, openings, rnd);
  // ceiling lamp
  place(b, FUR.ceilingLamp(), cx, y + WALL_H, cz, 0);
  b.lights.push({ pos: [cx, y + WALL_H - 0.25, cz], color: 0xffe0b0, intensity: 0, distance: 7, fixture: true });
  const all = ['back', 'left', 'right', 'front'];
  const shuffle = (a) => a.map((v) => [rnd(), v]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  switch (r.type) {
    case 'living': {
      // half the houses have a real leather or velvet sofa, some a proper armchair, a plant
      const real = W > 3.4 && rnd() < 0.5;
      const so = real ? FUR.propItem('leatherSofa', [2.35, 0.9, 1.05]) : FUR.sofa(rnd, { seats: W > 4 ? 3 : 2 });
      if (P.wall(so, shuffle(all), { centre: true })) {
        // coffee table and rug in front of the sofa
        const l = P.last;
        const fx = Math.sin(l.rot),
          fz = Math.cos(l.rot);
        // a cup left on it
        const ct = FUR.coffeeTable(rnd);
        if (rnd() < 0.55) ct.props.push({ id: 'teacup', pos: [0.18 - rnd() * 0.36, 0.45, 0.04], rot: rnd() * 6 });
        P.free(ct, l.x + fx * 1.0, l.z + fz * 1.0, l.rot);
        place(b, FUR.rug(rnd, 2.0, 1.4), l.x + fx * 1.05, y, l.z + fz * 1.05, l.rot);
      }
      P.wall(FUR.tvStand(rnd), shuffle(all), { centre: true });
      P.wall(FUR.armchair(rnd), shuffle(all));
      if (rnd() < 0.45) P.wall(FUR.propItem('pottedPlant', [0.7, 0.8, 0.7]), shuffle(all), { tall: false });
      // grandad's bellows camera on its tripod in a corner
      if (rnd() < 0.2) P.wall(FUR.propItem('antiqueCamera', [0.6, 1.5, 0.6]), shuffle(all));
      P.wall(FUR.bookshelf(rnd), shuffle(all));
      if (rnd() < 0.5) P.wall(FUR.dresser(rnd), shuffle(all));
      break;
    }
    case 'kitchen': {
      const len = Math.min(Math.max(W, D) - 0.6, 3.0);
      const sides = W >= D ? ['back', 'front', 'left', 'right'] : ['left', 'right', 'back', 'front'];
      let ok = false;
      for (let L = len; L >= 1.2 && !ok; L -= 0.6) ok = P.wall(FUR.kitchenRun(rnd, L), sides);
      for (let L = len; L >= 1.2 && !ok; L -= 0.6) ok = P.wall(FUR.kitchenRun(rnd, L, { uppers: false }), sides);
      P.wall(FUR.fridge(rnd), shuffle(all));
      let tz = null;
      if (D > 3 && W > 2.8) {
        // cups where people sat down for the last time
        const cups = (t) => {
          for (const x of [-0.35, 0.3]) if (rnd() < 0.45) t.props.push({ id: 'teacup', pos: [x, 0.77, (rnd() - 0.5) * 0.4], rot: rnd() * 6 });
          return t;
        };
        if (P.free(cups(FUR.diningTable(rnd, { chairs: W > 3.6 ? 4 : 2 })), cx, cz, 0)) tz = cz;
        else if (P.free(cups(FUR.diningTable(rnd, { chairs: 2 })), cx, cz + 0.4, 0)) tz = cz + 0.4;
      }
      void tz;
      break;
    }
    case 'bedroom': {
      const dbl = W > 3 && D > 3;
      const bd = FUR.bed(rnd, { double: dbl });
      if (P.wall(bd, shuffle(['back', 'left', 'right']), { centre: true, tall: false })) {
        const l = P.last;
        // nightstands either side of the bed head
        const rx = Math.cos(l.rot),
          rz = -Math.sin(l.rot);
        const off = bd.size[0] / 2 + 0.3;
        const bx = l.x - Math.sin(l.rot) * (bd.size[2] / 2 - 0.22),
          bz = l.z - Math.cos(l.rot) * (bd.size[2] / 2 - 0.22);
        P.free(FUR.nightstand(rnd), bx + rx * off, bz + rz * off, l.rot);
        if (dbl) P.free(FUR.nightstand(rnd), bx - rx * off, bz - rz * off, l.rot);
      }
      P.wall(FUR.wardrobe(rnd), shuffle(all));
      if (W * D > 10) P.wall(FUR.dresser(rnd), shuffle(all));
      if (rnd() < 0.3) P.wall(FUR.desk(rnd), shuffle(all));
      break;
    }
    case 'bath': {
      P.wall(FUR.bathtub(rnd), shuffle(['back', 'left', 'right']), { tall: false }) || P.wall(FUR.bathtub(rnd), all, { tall: false });
      P.wall(FUR.toilet(rnd), shuffle(all), { tall: false });
      P.wall(FUR.washbasin(rnd), shuffle(all), { tall: false });
      break;
    }
  }
}

export { WALL_H, EXT_T, INT_T };
