// POI layouts: which structures go where. Pure geometry generation (no physics, no scene), so
// it also runs inside the POI worker with material tokens.

import * as THREE from 'three';
import { Builder } from './buildings/builder.js';
import { archMaterials, signMaterial } from './buildings/materials.js';
import { buildHouse } from './buildings/house.js';
import * as ST from './buildings/structures.js';
import * as FUR from './buildings/furniture.js';
import * as TALL from './buildings/tall.js';

// ------------------------------------------------------------------ layouts
function props(fn) {
  const b = new Builder('props');
  fn(b);
  return { builder: b };
}

export const LAYOUTS = {
  homestead(rnd) {
    const house = buildHouse(rnd, { style: 'siding', abandoned: 0.1 });
    const garage = ST.buildGarage(rnd, { w: 8, d: 9, open: true, workshop: true });
    const out = [
      { ...house, x: -6.5, z: -2, rot: 0 },
      { ...garage, x: 8.5, z: -1.5, rot: 0, tag: 'garage' },
      {
        ...props((b) => {
          ST.mailbox(b, -3, 12, 0);
          ST.fence(b, [
            [-14, 9],
            [-4, 9],
          ]);
          ST.fence(b, [
            [-14, 9],
            [-14, -9],
          ]);
          b.prop('oilDrum', 14.2, 0, 3.8, rnd() * 6);
          FUR.place(b, FUR.crate(rnd), 14.2, 0, 4.9, 0.2);
        }),
        x: 0,
        z: 0,
        rot: 0,
      },
    ];
    return out;
  },
  house(rnd) {
    const h = buildHouse(rnd, {});
    const list = [{ ...h, x: 0, z: 0, rot: 0 }];
    if (rnd() < 0.5) list.push({ ...ST.buildGarage(rnd, { w: 5, d: 6, open: rnd() < 0.7 }), x: h.plan.W / 2 + 5, z: -1, rot: 0, tag: 'garage' });
    list.push({ ...props((b) => ST.mailbox(b, 2, h.plan.D / 2 + 6, 0)), x: 0, z: 0, rot: 0 });
    return list;
  },
  houses(rnd) {
    const n = 2 + (rnd() < 0.5 ? 1 : 0);
    const list = [];
    let x = -((n - 1) * 19) / 2;
    // now and then one of them is a two- or three-storey place with stairs inside
    const tall = rnd() < 0.55 ? Math.floor(rnd() * n) : -1;
    for (let i = 0; i < n; i++) {
      const h = i === tall ? TALL.buildStoreyed(rnd, { W: 8.6, D: 7.6, floors: rnd() < 0.35 ? 3 : 2, style: TALL.storeyStyle(archMaterials(), rnd() < 0.5 ? 'town' : 'house', rnd), chimney: rnd() < 0.6 }) : buildHouse(rnd, {});
      list.push({ ...h, x: x + (rnd() - 0.5) * 2, z: (rnd() - 0.5) * 4, rot: (rnd() - 0.5) * 0.1 });
      x += 19;
    }
    return list;
  },
  lookout(rnd) {
    const t = TALL.buildLookout(rnd);
    const list = [{ ...t, x: 0, z: 0, rot: rnd() * 6 }];
    list.push({ ...props((b) => b.prop('oilDrum', 4.2, 0, 2.5, rnd() * 6)), x: 0, z: 0, rot: 0 });
    return list;
  },
  church(rnd) {
    const list = [{ ...TALL.buildChurch(rnd), x: 0, z: -1, rot: 0 }];
    list.push({
      ...props((b) => {
        ST.fence(b, [
          [-9, 9],
          [-9, -9],
          [-16, -9],
        ]);
        b.prop('lampPost', 3.0, 0, 9.5, Math.PI);
        b.prop('pottedPlant', -1.6, 0.35, 8.7, 0);
      }),
      x: 0,
      z: 0,
      rot: 0,
    });
    return list;
  },
  cabin(rnd) {
    const c = TALL.buildCabin(rnd);
    const list = [{ ...c, x: 0, z: 0, rot: 0 }];
    list.push({ ...props((b) => b.prop('lampPost', 3.6, 0.45, 5.4, Math.PI)), x: 0, z: 0, rot: 0 });
    return list;
  },
  sawmill(rnd) {
    const list = [{ ...TALL.buildSawmill(rnd), x: 2, z: -2, rot: 0 }];
    list.push({
      ...props((b) => {
        for (let i = 0; i < 3; i++) b.prop('oilDrum', -6 + i * 0.75, 0.2, 5.6, rnd() * 6);
        b.prop('barnLamp', -3.5, 4.0, -1.85, 0, { collide: false });
      }),
      x: 2,
      z: -2,
      rot: 0,
    });
    return list;
  },
  lodge(rnd) {
    const M = archMaterials();
    const l = TALL.buildStoreyed(rnd, { W: 11, D: 8.5, floors: 2, style: TALL.storeyStyle(M, 'lodge', rnd), porch: true, name: 'lodge' });
    const list = [{ ...l, x: 0, z: -1, rot: 0 }];
    list.push({
      ...props((b) => {
        ST.signBoard(b, -3, 2.0, 6.3, 2.6, 0.6, signMaterial(['PINE LODGE'], { w: 512, h: 120, bg: '#3a2a1c', fg: '#e9dcc0' }), 0, { posts: 2 });
        b.prop('lampPost', 5.5, 0, 7.5, Math.PI);
      }),
      x: 0,
      z: 0,
      rot: 0,
    });
    return list;
  },
  farm(rnd) {
    const M = archMaterials();
    const h = TALL.buildStoreyed(rnd, { W: 9, D: 7.5, floors: 2, style: TALL.storeyStyle(M, 'farm', rnd), porch: true, name: 'farmhouse' });
    return [
      { ...h, x: -10, z: 2, rot: 0 },
      { ...ST.buildBarn(rnd), x: 10, z: -3, rot: Math.PI / 2 },
      { ...TALL.buildSilo(rnd), x: 17.5, z: 6, rot: 0 },
      { ...ST.buildWindmill(rnd), x: 0, z: -15, rot: rnd() * 6 },
      {
        ...props((b) => {
          ST.fence(b, [
            [16, 12],
            [28, 12],
            [28, -14],
            [16, -14],
          ]);
          b.prop('oilDrum', 5.5, 0, 4.5, rnd() * 6);
          b.prop('barnLamp', 10, 3.2, 3.2, Math.PI, { collide: false });
        }),
        x: 0,
        z: 0,
        rot: 0,
      },
    ];
  },
  gasStation(rnd) {
    return [{ ...ST.buildGasStation(rnd), x: 0, z: 0, rot: 0 }];
  },
  motel(rnd) {
    return [{ ...ST.buildMotel(rnd), x: 3, z: -2, rot: 0 }];
  },
  diner(rnd) {
    return [{ ...ST.buildDiner(rnd), x: 0, z: -2, rot: 0 }];
  },
  ranch(rnd) {
    const h = buildHouse(rnd, { style: rnd() < 0.5 ? 'siding' : 'brick' });
    return [
      { ...h, x: -9, z: 2, rot: 0 },
      { ...ST.buildBarn(rnd), x: 10, z: -4, rot: Math.PI / 2 },
      { ...ST.buildWindmill(rnd), x: 2, z: -14, rot: rnd() * 6 },
      {
        ...props((b) =>
          ST.fence(b, [
            [16, 10],
            [26, 10],
            [26, -16],
            [16, -16],
          ])
        ),
        x: 0,
        z: 0,
        rot: 0,
      },
    ];
  },
  waterTower(rnd) {
    return [{ ...ST.buildWaterTower(rnd), x: 0, z: 0, rot: rnd() * 6 }];
  },
  radioTower(rnd) {
    return [{ ...ST.buildRadioTower(rnd), x: 0, z: 0, rot: rnd() * 6 }];
  },
  trailers(rnd) {
    const n = 2 + Math.floor(rnd() * 2);
    const list = [];
    for (let i = 0; i < n; i++) list.push({ ...ST.buildTrailer(rnd), x: (i - (n - 1) / 2) * 9, z: (rnd() - 0.5) * 6, rot: Math.PI / 2 + (rnd() - 0.5) * 0.3 });
    list.push({ ...props((b) => ST.tent(b, rnd, 0, 12, 0.4, archMaterials().canvasOrange, 2.4, 2, 1.4)), x: 0, z: 0, rot: 0 });
    return list;
  },
  outpost(rnd) {
    return [{ ...ST.buildOutpost(rnd), x: 0, z: 0, rot: 0 }];
  },
  ruins(rnd) {
    const list = [{ ...ST.buildRuins(rnd), x: 0, z: 0, rot: rnd() * 6 }];
    if (rnd() < 0.5) list.push({ ...ST.buildRuins(rnd), x: 10, z: -6, rot: rnd() * 6 });
    return list;
  },
  camp(rnd) {
    return [{ ...ST.buildCamp(rnd), x: 0, z: 0, rot: 0 }];
  },
  junkyard(rnd) {
    const shack = ST.buildGarage(rnd, { w: 5, d: 5, open: true });
    return [
      { ...shack, x: -9, z: -8, rot: 0 },
      {
        ...props((b) => {
          const M = archMaterials();
          // corrugated perimeter with a gap for the gate
          const wall = (x0, z0, x1, z1) => {
            const L = Math.hypot(x1 - x0, z1 - z0);
            const rot = Math.atan2(-(z1 - z0), x1 - x0);
            b.box((x0 + x1) / 2, 1.1, (z0 + z1) / 2, L, 2.2, 0.06, M.corrugatedRust, { rotY: rot, surface: 'metal' });
          };
          wall(-14, 13, -3, 13);
          wall(3, 13, 14, 13);
          wall(-14, 13, -14, -13);
          wall(14, 13, 14, -13);
          wall(-14, -13, 14, -13);
          for (let i = 0; i < 6; i++) FUR.place(b, FUR.tirePile(rnd), -6 + i * 2.5, 0, -10.5 + (i % 2), 0);
          for (let i = 0; i < 4; i++) b.prop('oilDrum', 10 + (i % 2) * 0.72, 0, -9 + Math.floor(i / 2) * 0.72, rnd() * 6);
          for (let i = 0; i < 3; i++) b.prop('trafficCone', -6 + i * 1.4, 0, 11.5, rnd() * 6);
          ST.signBoard(b, 0, 3.0, 13.2, 4, 0.8, signMaterial(['SALVAGE · PARTS'], { w: 512, h: 96, bg: '#d8c9a2', fg: '#3a2a1a' }), 0, { posts: 2 });
        }),
        x: 0,
        z: 0,
        rot: 0,
      },
    ];
  },
  wreck() {
    return [];
  },
};

