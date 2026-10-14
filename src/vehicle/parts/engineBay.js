// Body structure (firewall, aprons, strut towers, radiator support, crash beams, hinge pillars,
// trunk floor, rear panel) and the removable engine-bay components (engine + gearbox, battery,
// radiator with fan, air filter box, reservoirs). Authored in car space.

import * as THREE from 'three';
import { loftSections, superSection, roundedBox, latheY, tubeAlong, smoothClosed2 } from '../../gfx/geom.js';
import { makeCanvas, canvasTexture, cached } from '../../gfx/textures.js';
import { addSurfaceDetail } from '../../gfx/triplanar.js';
import { applyWeathering, weatheringUniforms } from '../carMaterials.js';
import { skinTopY } from '../body/probe.js';
import { SPEC } from '../body/shape.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function mesh(geo, mat, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function box(w, h, d, x, y, z, r = 0.006) {
  const g = roundedBox(w, h, d, r, 2);
  g.translate(x, y, z);
  return g;
}

export function createBayMaterials(carMats) {
  return cached('bayMats', () => {
    const grime = weatheringUniforms({ dirt: 0.8, dust: 0.6, rust: 0.15, fade: 0 });
    const m = {
      structure: carMats ? carMats.inner : new THREE.MeshStandardMaterial({ color: 0x8a4a2a, roughness: 0.6 }),
      castAlu: applyWeathering(addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x8f9194, metalness: 0.7, roughness: 0.55 }), 'cast', 0.6), grime, {
        rustColor: false,
      }),
      castIron: applyWeathering(addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x4a4847, metalness: 0.6, roughness: 0.7 }), 'cast', 0.7), grime),
      blackPlastic: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x151516, roughness: 0.68 }), 'grain', 0.3),
      rubberHose: new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.85 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x9da0a3, metalness: 0.9, roughness: 0.35 }),
      rusty: applyWeathering(new THREE.MeshStandardMaterial({ color: 0x6a4a35, metalness: 0.5, roughness: 0.8 }), weatheringUniforms({ rust: 0.7, dirt: 0.4 })),
      heatShield: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0xb0aaa0, metalness: 0.85, roughness: 0.45 }), 'cast', 0.9),
      radiatorCore: null,
      yellow: new THREE.MeshStandardMaterial({ color: 0xe8b21c, roughness: 0.5 }),
      red: new THREE.MeshStandardMaterial({ color: 0xb3261b, roughness: 0.5 }),
      blueCap: new THREE.MeshStandardMaterial({ color: 0x1f56a8, roughness: 0.5 }),
      translucent: new THREE.MeshStandardMaterial({ color: 0xd9d4c5, roughness: 0.4, transparent: true, opacity: 0.82 }),
      battery: null,
      valveCover: null,
      copper: new THREE.MeshStandardMaterial({ color: 0xb8733e, metalness: 0.9, roughness: 0.35 }),
      belt: new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.75 }),
      trunkLiner: addSurfaceDetail(new THREE.MeshStandardMaterial({ color: 0x1e1d1c, roughness: 1 }), 'carpet', 0.5, { tint: 0.2 }),
    };
    // Radiator fins texture
    {
      const c = makeCanvas(256, 256);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#6d6a65';
      for (let x = 0; x < 256; x += 4) ctx.fillRect(x, 0, 2, 256);
      ctx.fillStyle = '#3a3836';
      for (let y = 0; y < 256; y += 32) ctx.fillRect(0, y, 256, 5);
      m.radiatorCore = new THREE.MeshStandardMaterial({ map: canvasTexture(c, { repeat: [6, 3] }), metalness: 0.6, roughness: 0.6 });
    }
    // Battery label
    {
      const c = makeCanvas(256, 128);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, 256, 128);
      ctx.fillStyle = '#d93b25';
      ctx.fillRect(0, 0, 256, 26);
      ctx.fillStyle = '#eee';
      ctx.font = 'bold 34px Arial';
      ctx.fillText('VOLTEX', 14, 70);
      ctx.font = '20px Arial';
      ctx.fillText('12V  60Ah  540A', 14, 104);
      m.battery = new THREE.MeshStandardMaterial({ map: canvasTexture(c, { wrap: false }), roughness: 0.55 });
    }
    // Valve cover with ribs & lettering
    {
      const c = makeCanvas(512, 256);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#1a1a1b';
      ctx.fillRect(0, 0, 512, 256);
      ctx.fillStyle = '#242426';
      for (let x = 20; x < 512; x += 40) ctx.fillRect(x, 0, 14, 256);
      ctx.fillStyle = '#b9b5ac';
      ctx.font = 'bold 44px Arial';
      ctx.fillText('1.6  16V', 170, 145);
      m.valveCover = new THREE.MeshStandardMaterial({ map: canvasTexture(c, { wrap: false }), roughness: 0.55, metalness: 0.2 });
    }
    return m;
  });
}

// ------------------------------------------------------------------ structure
export function buildStructure(M) {
  const g = new THREE.Group();
  const S = M.structure;
  // Firewall: slab across the car, toe-board slope at the bottom.
  const xs = [];
  for (let i = 0; i <= 16; i++) xs.push(-0.76 + (1.52 * i) / 16);
  const fw = loftSections(
    xs.map((x) => {
      const prof = [
        [0.86, 0.27],
        [0.94, 0.45],
        [0.985, 0.62],
        [0.99, 0.93],
        [1.005, 0.93],
        [1.005, 0.62],
        [0.96, 0.44],
        [0.88, 0.27],
      ];
      return prof.map(([z, y]) => V(x, y, z));
    }),
    { capStart: true, capEnd: true }
  );
  g.add(mesh(fw, S));
  // Cabin-side insulation/carpet layer on the firewall and toe board
  const fwc = loftSections(
    xs.map((x) => {
      const prof = [
        [0.845, 0.28],
        [0.925, 0.45],
        [0.97, 0.62],
        [0.975, 0.9],
        [0.985, 0.9],
        [0.982, 0.62],
        [0.937, 0.45],
        [0.857, 0.28],
      ];
      return prof.map(([z, y]) => V(x * 0.99, y, z));
    }),
    { capStart: true, capEnd: true }
  );
  g.add(mesh(fwc, M.cabinCarpet || M.trunkLiner));
  // Plenum / cowl inner panel joining the firewall top to the cowl skin.
  const plen = box(1.5, 0.012, 0.13, 0, 0.928, 1.06, 0.004);
  g.add(mesh(plen, M.blackPlastic));
  // Hinge pillars (behind the front fenders) close the cabin's front corners.
  for (const s of [1, -1]) {
    const hp = box(0.06, 0.66, 0.15, 0.8 * s, 0.6, 0.915, 0.01);
    g.add(mesh(hp, S));
  }
  // Upper apron rails and apron panels with strut towers.
  for (const s of [1, -1]) {
    const rail = tubeAlong([V(0.7 * s, 0.86, 1.0), V(0.68 * s, 0.82, 1.4), V(0.64 * s, 0.76, 1.85)], 0.03, 8, {});
    rail.scale(1, 1, 1);
    g.add(mesh(rail, S));
    // apron panel between the liner wall (x=0.47) and the rail
    const ap = new THREE.BufferGeometry();
    const pts = [];
    const idx = [];
    const N = 12;
    for (let i = 0; i <= N; i++) {
      const z = 1.0 + (0.85 * i) / N;
      const yRail = 0.86 - (0.1 * (z - 1.0)) / 0.85;
      const xr = (0.7 - (0.06 * (z - 1.0)) / 0.85) * s;
      pts.push(0.47 * s, 0.7, z, xr, yRail - 0.02, z);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      if (s > 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    ap.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    ap.setIndex(idx);
    ap.computeVertexNormals();
    const apm = mesh(ap, S);
    apm.material = S.clone();
    apm.material.side = THREE.DoubleSide;
    g.add(apm);
    // Strut tower dome
    const tower = latheY(
      [
        [0.0, 0.0],
        [0.05, -0.004],
        [0.075, -0.02],
        [0.09, -0.07],
        [0.1, -0.16],
      ],
      24
    );
    tower.translate(0.53 * s, 0.86, SPEC.axleF - 0.02);
    g.add(mesh(tower, S));
    // strut top mount + nut
    const mount = latheY(
      [
        [0.0, 0.018],
        [0.03, 0.016],
        [0.035, 0.0],
      ],
      16
    );
    mount.translate(0.53 * s, 0.86, SPEC.axleF - 0.02);
    g.add(mesh(mount, M.rubberHose));
  }
  // Radiator core support frame
  g.add(mesh(box(1.12, 0.05, 0.05, 0, 0.8, 1.97), S));
  g.add(mesh(box(1.0, 0.06, 0.06, 0, 0.34, 1.99), S));
  for (const s of [1, -1]) g.add(mesh(box(0.05, 0.5, 0.05, 0.53 * s, 0.57, 1.98), S));
  // Front crash beam with crash boxes
  const beamPts = [];
  for (let i = 0; i <= 10; i++) {
    const x = -0.66 + (1.32 * i) / 10;
    beamPts.push(V(x, 0.46, 2.1 - 0.12 * x * x));
  }
  const beamSecs = beamPts.map((p) => superSection(p, V(0, 1, 0), V(0, 0, 1), 0.055, 0.035, 5, 12));
  g.add(mesh(loftSections(beamSecs, { capStart: true, capEnd: true }), M.steel));
  for (const s of [1, -1]) g.add(mesh(box(0.08, 0.08, 0.18, 0.45 * s, 0.46, 1.98), M.steel));
  // Front longitudinal rails under the engine (part of the shell)
  for (const s of [1, -1]) g.add(mesh(box(0.07, 0.1, 1.1, 0.4 * s, 0.32, 1.45, 0.012), S));
  // Rear back panel (behind the rear bumper) + crash beam
  const bp = new THREE.BufferGeometry();
  {
    const pts = [],
      idx = [];
    const N = 12;
    for (let i = 0; i <= N; i++) {
      const x = -0.78 + (1.56 * i) / N;
      const z = -2.15 + 0.12 * x * x;
      pts.push(x, 0.36, z, x, 0.79, z);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    bp.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    bp.setIndex(idx);
    bp.computeVertexNormals();
  }
  const bpm = mesh(bp, S);
  bpm.material = S.clone();
  bpm.material.side = THREE.DoubleSide;
  g.add(bpm);
  const rb = [];
  for (let i = 0; i <= 10; i++) {
    const x = -0.68 + (1.36 * i) / 10;
    rb.push(V(x, 0.5, -2.2 + 0.11 * x * x));
  }
  g.add(mesh(loftSections(rb.map((p) => superSection(p, V(0, 1, 0), V(0, 0, 1), 0.05, 0.03, 5, 12)), { capStart: true, capEnd: true }), M.steel));
  // Trunk floor board (over the spare wheel well) and side liners
  g.add(mesh(box(1.18, 0.015, 0.68, 0, 0.44, -1.86, 0.006), M.trunkLiner));
  // Rear seat partition (behind the rear bench back)
  g.add(mesh(box(1.3, 0.55, 0.012, 0, 0.72, -1.27, 0.004), M.trunkLiner));
  return g;
}

// ------------------------------------------------------------------ engine + gearbox
export function buildEngine(M) {
  const g = new THREE.Group();
  // Engine sits transverse; local origin near the crank centre.
  const cx = -0.12,
    cy = 0.47,
    cz = 1.5;
  // Block
  const block = box(0.46, 0.3, 0.3, cx, cy, cz, 0.02);
  g.add(mesh(block, M.castIron));
  // Ribs on the block
  for (let k = 0; k < 5; k++) g.add(mesh(box(0.012, 0.22, 0.31, cx - 0.2 + k * 0.1, cy - 0.02, cz, 0.004), M.castIron));
  // Oil pan
  g.add(mesh(box(0.42, 0.11, 0.26, cx, cy - 0.2, cz + 0.01, 0.02), M.castAlu));
  // Cylinder head
  g.add(mesh(box(0.47, 0.11, 0.25, cx, cy + 0.205, cz - 0.01, 0.015), M.castAlu));
  // Valve cover (textured top)
  const vc = roundedBox(0.45, 0.07, 0.22, 0.03, 3);
  vc.translate(cx, cy + 0.295, cz - 0.01);
  // planar uv on top
  const uv = vc.attributes.uv,
    ps = vc.attributes.position;
  for (let i = 0; i < ps.count; i++) uv.setXY(i, (ps.getX(i) - cx) / 0.45 + 0.5, (ps.getZ(i) - (cz - 0.01)) / 0.22 + 0.5);
  g.add(mesh(vc, M.valveCover));
  // Spark plug coils (4)
  for (let k = 0; k < 4; k++) {
    const coil = new THREE.CylinderGeometry(0.016, 0.018, 0.05, 12);
    coil.translate(cx - 0.15 + k * 0.1, cy + 0.345, cz - 0.01);
    g.add(mesh(coil, M.blackPlastic));
  }
  // Oil filler cap (interaction point)
  const cap = latheY(
    [
      [0.0, 0.022],
      [0.026, 0.02],
      [0.028, 0.0],
    ],
    20
  );
  cap.translate(cx + 0.16, cy + 0.33, cz + 0.05);
  const capM = mesh(cap, M.yellow);
  capM.name = 'oilCap';
  g.add(capM);
  g.userData.oilCapPos = V(cx + 0.16, cy + 0.36, cz + 0.05);
  // Dipstick loop
  const dip = new THREE.TorusGeometry(0.018, 0.005, 8, 16);
  dip.rotateY(Math.PI / 2);
  dip.translate(cx - 0.2, cy + 0.27, cz + 0.17);
  g.add(mesh(dip, M.yellow));
  g.add(mesh(tubeAlong([V(cx - 0.2, cy + 0.25, cz + 0.17), V(cx - 0.2, cy + 0.05, cz + 0.17)], 0.004, 6), M.steel, false));
  // Intake manifold (front side, four runners to a plenum)
  const plenum = box(0.4, 0.07, 0.08, cx, cy + 0.27, cz + 0.22, 0.03);
  g.add(mesh(plenum, M.blackPlastic));
  for (let k = 0; k < 4; k++) {
    const x = cx - 0.15 + k * 0.1;
    g.add(mesh(tubeAlong([V(x, cy + 0.22, cz + 0.12), V(x, cy + 0.26, cz + 0.18), V(x, cy + 0.27, cz + 0.22)], 0.022, 10), M.blackPlastic));
  }
  // Throttle body + intake duct to the air box (right side)
  const tb = new THREE.CylinderGeometry(0.035, 0.035, 0.06, 16);
  tb.rotateZ(Math.PI / 2);
  tb.translate(cx - 0.24, cy + 0.27, cz + 0.22);
  g.add(mesh(tb, M.castAlu));
  // Exhaust manifold + heat shield (rear side, toward the firewall)
  for (let k = 0; k < 4; k++) {
    const x = cx - 0.15 + k * 0.1;
    g.add(mesh(tubeAlong([V(x, cy + 0.17, cz - 0.14), V(x * 0.9 + cx * 0.1, cy + 0.08, cz - 0.2), V(cx, cy - 0.02, cz - 0.22)], 0.018, 8), M.rusty));
  }
  g.add(mesh(box(0.44, 0.14, 0.012, cx, cy + 0.1, cz - 0.24, 0.004), M.heatShield));
  // Front timing cover + pulleys and belt (right end of engine)
  g.add(mesh(box(0.04, 0.34, 0.28, cx - 0.255, cy + 0.06, cz, 0.012), M.blackPlastic));
  const pulley = (y, z, r) => {
    const p = new THREE.CylinderGeometry(r, r, 0.022, 24);
    p.rotateZ(Math.PI / 2);
    p.translate(cx - 0.285, y, z);
    return p;
  };
  g.add(mesh(pulley(cy - 0.06, cz + 0.02, 0.065), M.steel));
  g.add(mesh(pulley(cy + 0.1, cz + 0.17, 0.035), M.steel));
  g.add(mesh(pulley(cy + 0.16, cz - 0.04, 0.03), M.steel));
  const beltPts = [V(cx - 0.285, cy - 0.125, cz + 0.02), V(cx - 0.285, cy + 0.1, cz + 0.21), V(cx - 0.285, cy + 0.19, cz - 0.04), V(cx - 0.285, cy - 0.06, cz - 0.05), V(cx - 0.285, cy - 0.125, cz + 0.02)];
  g.add(mesh(tubeAlong(beltPts, 0.006, 6), M.belt, false));
  // Alternator
  const alt = latheY(
    [
      [0.0, -0.06],
      [0.06, -0.06],
      [0.065, 0.0],
      [0.06, 0.06],
      [0.0, 0.06],
    ],
    20
  );
  alt.rotateZ(Math.PI / 2);
  alt.translate(cx - 0.21, cy + 0.1, cz + 0.17);
  g.add(mesh(alt, M.castAlu));
  // Gearbox (left / driver side)
  const gb = latheY(
    [
      [0.0, 0.0],
      [0.15, 0.0],
      [0.17, 0.05],
      [0.14, 0.2],
      [0.11, 0.3],
      [0.0, 0.31],
    ],
    20
  );
  gb.rotateZ(-Math.PI / 2);
  gb.translate(cx + 0.23, cy - 0.02, cz - 0.01);
  g.add(mesh(gb, M.castAlu));
  // Driveshaft stubs toward the wheels
  for (const s of [1, -1]) {
    const x0 = s > 0 ? cx + 0.5 : cx - 0.2;
    g.add(mesh(tubeAlong([V(x0, cy - 0.12, cz + 0.02), V(0.62 * s, SPEC.wheelY, SPEC.axleF)], 0.016, 8), M.steel, false));
  }
  g.userData.cog = V(cx + 0.05, cy, cz);
  return g;
}

// ------------------------------------------------------------------ battery
export function buildBattery(M) {
  const g = new THREE.Group();
  const x = 0.36,
    y = 0.72,
    z = 1.72;
  // tray
  g.add(mesh(box(0.27, 0.02, 0.2, x, y - 0.1, z, 0.004), M.blackPlastic));
  const body = roundedBox(0.25, 0.18, 0.175, 0.008, 2);
  // label on the long side facing the cabin: planar uv
  const uv = body.attributes.uv,
    ps = body.attributes.position;
  for (let i = 0; i < ps.count; i++) uv.setXY(i, ps.getX(i) / 0.25 + 0.5, ps.getY(i) / 0.18 + 0.5);
  body.translate(x, y, z);
  g.add(mesh(body, M.battery));
  // lid
  g.add(mesh(box(0.252, 0.02, 0.177, x, y + 0.095, z, 0.006), M.blackPlastic));
  // terminals
  for (const [dx, mat] of [
    [-0.08, M.red],
    [0.08, M.blackPlastic],
  ]) {
    const t = new THREE.CylinderGeometry(0.011, 0.013, 0.025, 12);
    t.translate(x + dx, y + 0.115, z - 0.05);
    g.add(mesh(t, M.steel, false));
    const c = roundedBox(0.03, 0.02, 0.035, 0.006, 2);
    c.translate(x + dx, y + 0.125, z - 0.05);
    g.add(mesh(c, mat, false));
  }
  // cables
  g.add(mesh(tubeAlong([V(x - 0.08, y + 0.13, z - 0.05), V(x - 0.1, y + 0.18, z - 0.15), V(x - 0.2, y + 0.1, z - 0.25), V(-0.0, 0.62, 1.55)], 0.008, 8), M.red, false));
  g.add(mesh(tubeAlong([V(x + 0.08, y + 0.13, z - 0.05), V(x + 0.15, y + 0.1, z - 0.1), V(x + 0.18, y - 0.05, z - 0.1)], 0.008, 8), M.blackPlastic, false));
  return g;
}

// ------------------------------------------------------------------ radiator + fan
export function buildRadiator(M) {
  const g = new THREE.Group();
  const z = 1.9;
  const core = new THREE.BoxGeometry(0.64, 0.36, 0.028);
  core.translate(0, 0.56, z);
  g.add(mesh(core, M.radiatorCore));
  // tanks
  for (const s of [1, -1]) g.add(mesh(box(0.035, 0.4, 0.045, 0.335 * s, 0.56, z, 0.008), M.blackPlastic));
  // Fan shroud + fan behind
  const shroud = box(0.6, 0.34, 0.03, 0, 0.56, z - 0.04, 0.02);
  g.add(mesh(shroud, M.blackPlastic));
  const hub = new THREE.CylinderGeometry(0.045, 0.045, 0.05, 20);
  hub.rotateX(Math.PI / 2);
  hub.translate(0.02, 0.56, z - 0.07);
  g.add(mesh(hub, M.blackPlastic));
  const fan = new THREE.Group();
  for (let k = 0; k < 7; k++) {
    const blade = roundedBox(0.03, 0.13, 0.005, 0.004, 1);
    blade.translate(0, 0.08, 0);
    blade.rotateY(0.4);
    const bm = mesh(blade, M.blackPlastic, false);
    bm.rotation.z = (k / 7) * Math.PI * 2;
    fan.add(bm);
  }
  fan.position.set(0.02, 0.56, z - 0.06);
  fan.name = 'fan';
  g.add(fan);
  g.userData.fan = fan;
  // Upper and lower hoses toward the engine
  g.add(mesh(tubeAlong([V(-0.3, 0.72, z - 0.03), V(-0.3, 0.74, z - 0.15), V(-0.22, 0.7, 1.68), V(-0.15, 0.7, 1.62)], 0.019, 10), M.rubberHose));
  g.add(mesh(tubeAlong([V(0.3, 0.41, z - 0.03), V(0.26, 0.38, 1.75), V(0.05, 0.4, 1.66)], 0.019, 10), M.rubberHose));
  // Radiator cap
  const cap = latheY(
    [
      [0.0, 0.016],
      [0.022, 0.014],
      [0.024, 0.0],
    ],
    18
  );
  cap.translate(-0.33, 0.775, z);
  g.add(mesh(cap, M.steel, false));
  return g;
}

// ------------------------------------------------------------------ air box & reservoirs
export function buildAirFilter(M) {
  const g = new THREE.Group();
  const x = -0.36,
    y = 0.68,
    z = 1.72;
  const secs = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    secs.push(superSection(V(x, y - 0.06 + 0.12 * t, z), V(1, 0, 0), V(0, 0, 1), 0.13 - 0.01 * Math.abs(t - 0.5), 0.1, 6, 24));
  }
  g.add(mesh(loftSections(secs, { capStart: true, capEnd: true }), M.blackPlastic));
  // clips
  for (const dz of [-0.09, 0.09]) g.add(mesh(box(0.02, 0.03, 0.012, x + 0.13, y + 0.02, z + dz, 0.003), M.steel, false));
  // duct to the throttle body
  g.add(mesh(tubeAlong([V(x + 0.06, y + 0.04, z - 0.1), V(x + 0.05, y + 0.06, z - 0.2), V(-0.3, 0.74, 1.72), V(-0.36, 0.74, 1.72)], 0.03, 12), M.rubberHose));
  return g;
}

export function buildReservoirs(M) {
  const g = new THREE.Group();
  // Coolant expansion tank (right apron, rear)
  const ct = roundedBox(0.11, 0.13, 0.16, 0.02, 3);
  ct.translate(-0.5, 0.7, 1.22);
  g.add(mesh(ct, M.translucent));
  const ccap = latheY(
    [
      [0.0, 0.02],
      [0.024, 0.018],
      [0.026, 0.0],
    ],
    18
  );
  ccap.translate(-0.5, 0.765, 1.22);
  const ccm = mesh(ccap, M.blackPlastic, false);
  ccm.name = 'coolantCap';
  g.add(ccm);
  g.userData.coolantCapPos = V(-0.5, 0.79, 1.22);
  // Brake fluid reservoir on the firewall (driver side)
  const bf = roundedBox(0.08, 0.06, 0.06, 0.012, 2);
  bf.translate(0.36, 0.84, 1.08);
  g.add(mesh(bf, M.translucent));
  const bcap = new THREE.CylinderGeometry(0.02, 0.02, 0.018, 14);
  bcap.translate(0.36, 0.88, 1.08);
  g.add(mesh(bcap, M.blackPlastic, false));
  const mc = new THREE.CylinderGeometry(0.03, 0.03, 0.15, 16);
  mc.rotateX(Math.PI / 2);
  mc.translate(0.36, 0.78, 1.1);
  g.add(mesh(mc, M.castAlu));
  // Washer fluid (front right)
  const wr = roundedBox(0.12, 0.1, 0.1, 0.02, 3);
  wr.translate(-0.47, 0.6, 1.88);
  g.add(mesh(wr, M.translucent));
  const wcap = new THREE.CylinderGeometry(0.018, 0.018, 0.016, 14);
  wcap.translate(-0.47, 0.66, 1.88);
  g.add(mesh(wcap, M.blueCap, false));
  // Fuse box (left front, behind the battery)
  g.add(mesh(box(0.14, 0.08, 0.12, 0.42, 0.73, 1.38, 0.012), M.blackPlastic));
  // Wiring loom along the left apron
  g.add(mesh(tubeAlong([V(0.42, 0.72, 1.32), V(0.45, 0.76, 1.15), V(0.3, 0.86, 1.04), V(0.0, 0.88, 1.02)], 0.012, 8), M.rubberHose, false));
  return g;
}

export function engineTopLimit(x, z) {
  // Hood inner surface height (for clearance checks).
  return skinTopY(x, z) - 0.012;
}
