// Shared spec helpers for imported cars: wheel geometry, hardpoints, the driver's posture and
// compound colliders derived from the part boxes measured by the import tool.

import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function wheelSpec(META) {
  const W = META.wheel;
  const c = W.centers;
  const fz = (c.wheel_FL[2] + c.wheel_FR[2]) / 2;
  const rz = (c.wheel_RL[2] + c.wheel_RR[2]) / 2;
  const tf = (Math.abs(c.wheel_FL[0]) + Math.abs(c.wheel_FR[0])) / 2;
  const tr = (Math.abs(c.wheel_RL[0]) + Math.abs(c.wheel_RR[0])) / 2;
  const P = META.parts;
  return {
    wheelbase: fz - rz,
    axleF: fz,
    axleR: rz,
    wheelR: W.radius,
    wheelY: W.radius,
    trackHalf: tf,
    trackHalfR: tr,
    frontTip: P.bumper_F.max[2],
    rearTip: P.bumper_R.min[2],
    roofY: P.body.max[1],
    halfWidth: P.body.max[0],
  };
}

export function hardpoints(SPEC, drive = 'front') {
  return [
    { id: 'wheel_FL', x: SPEC.trackHalf, z: SPEC.axleF, steer: true, drive: drive !== 'rear' },
    { id: 'wheel_FR', x: -SPEC.trackHalf, z: SPEC.axleF, steer: true, drive: drive !== 'rear' },
    { id: 'wheel_RL', x: SPEC.trackHalfR, z: SPEC.axleR, drive: drive !== 'front' },
    { id: 'wheel_RR', x: -SPEC.trackHalfR, z: SPEC.axleR, drive: drive !== 'front' },
  ];
}

// The driver sits behind the wheel: eye, shoulders and the rim the hands hold.
export function driverOf(META, { eyeY, eyeZ, shoulderY, shoulderZ, steerScale = 1, shoulderHalf = 0.19 }) {
  const sw = META.steeringWheel;
  return {
    x: sw.center[0],
    seatZ: eyeZ + 0.2,
    hip: V(sw.center[0], eyeY - 0.6, eyeZ + 0.03),
    eye: V(sw.center[0], eyeY, eyeZ),
    wheelCenter: V(...sw.center),
    wheelNormal: V(...sw.axis).normalize(),
    rimRadius: (sw.radius - 0.012) * steerScale,
    shoulder: V(sw.center[0], shoulderY, shoulderZ),
    shoulderHalf,
  };
}

const mid = (a, b) => (a + b) / 2;

// Compound colliders [part, centre, half extents, opts] from the part boxes: a floor pan, sills,
// roof and glass, nose and tail blocks under the lids, the lids, doors, bumpers, seats and engine.
export function autoBoxes(META, { floorY, roofY: roofTop = null, roofT = 0.03, screenTilt = 0.95, rearTilt = -0.9, trunkFloorY, extra = [] } = {}) {
  const P = META.parts;
  const B = (id) => P[id] && { min: P[id].min, max: P[id].max };
  const out = [];
  const body = B('body');
  const hw = body.max[0] - 0.08;
  const fl = B('door_FL'),
    rl = B('door_RL') || fl;
  const cabinF = fl.max[2],
    cabinR = rl.min[2];
  const hood = B('hood'),
    trunk = B('trunk');
  // floor and sills
  out.push(['chassis', [0, floorY, mid(cabinF, cabinR)], [hw - 0.06, 0.05, (cabinF - cabinR) / 2], { tag: 'floor' }]);
  for (const s of [1, -1]) out.push(['body', [s * (hw - 0.04), floorY + 0.1, mid(cabinF, cabinR)], [0.06, 0.1, (cabinF - cabinR) / 2]]);
  // roof
  const roofY = (roofTop ?? body.max[1]) - roofT;
  out.push(['body', [0, roofY, mid(cabinF, cabinR) - 0.05], [hw - 0.1, roofT, (cabinF - cabinR) / 2 - 0.35], { tag: 'roof' }]);
  // windscreen and rear window, as tilted plates between the cowl and the roof
  const cowlY = hood.max[1];
  out.push(['body', [0, mid(cowlY, roofY), cabinF - 0.15], [hw - 0.12, 0.02, (roofY - cowlY) / 2 / Math.sin(screenTilt)], { rotX: screenTilt, tag: 'windshield' }]);
  const deckY = trunk.max[1];
  out.push(['body', [0, mid(deckY, roofY), cabinR + 0.2], [hw - 0.15, 0.02, (roofY - deckY) / 2 / Math.sin(-rearTilt)], { rotX: rearTilt, tag: 'rearglass' }]);
  // dash and firewall, rear bulkhead
  out.push(['body', [0, cowlY - 0.12, cabinF - 0.12], [hw - 0.06, 0.1, 0.1], { tag: 'dash' }]);
  out.push(['body', [0, mid(floorY, cowlY), cabinF + 0.05], [hw - 0.06, (cowlY - floorY) / 2, 0.03]]);
  // nose block (engine bay sides and front panel) and tail block (boot sides)
  const noseF = B('bumper_F').min[2] + 0.05;
  for (const s of [1, -1]) {
    out.push(['body', [s * (hw - 0.04), mid(floorY + 0.1, cowlY - 0.05), mid(cabinF, noseF)], [0.06, (cowlY - floorY - 0.15) / 2, (noseF - cabinF) / 2]]);
    out.push(['body', [s * (hw - 0.04), mid(floorY + 0.1, deckY - 0.05), mid(cabinR, trunk.min[2])], [0.06, (deckY - floorY - 0.15) / 2, (cabinR - trunk.min[2]) / 2]]);
  }
  out.push(['body', [0, mid(floorY + 0.05, cowlY - 0.1), noseF - 0.04], [hw - 0.06, (cowlY - floorY - 0.15) / 2, 0.04]]);
  out.push(['body', [0, mid(floorY + 0.05, deckY - 0.05), trunk.min[2] + 0.06], [hw - 0.06, (deckY - floorY - 0.1) / 2, 0.04]]);
  out.push(['body', [0, trunkFloorY, mid(cabinR, trunk.min[2])], [hw - 0.1, 0.03, (cabinR - trunk.min[2]) / 2 - 0.05], { tag: 'trunkFloor' }]);
  // lids
  out.push(['hood', [0, hood.max[1] - 0.03, mid(hood.min[2], hood.max[2])], [(hood.max[0] - hood.min[0]) / 2, 0.03, (hood.max[2] - hood.min[2]) / 2], { closedOnly: true }]);
  out.push(['trunk', [0, trunk.max[1] - 0.03, mid(trunk.min[2], trunk.max[2]) + 0.05], [(trunk.max[0] - trunk.min[0]) / 2, 0.03, (trunk.max[2] - trunk.min[2]) / 2 - 0.05], { closedOnly: true }]);
  // doors (lower panel and window frame)
  for (const d of ['door_FL', 'door_FR', 'door_RL', 'door_RR']) {
    const b = B(d);
    if (!b) continue;
    const s = d.endsWith('L') ? 1 : -1;
    const x = s * (Math.max(Math.abs(b.min[0]), Math.abs(b.max[0])) - 0.08);
    const beltY = cowlY + 0.02;
    out.push([d, [x, mid(b.min[1], beltY), mid(b.min[2], b.max[2])], [0.05, (beltY - b.min[1]) / 2, (b.max[2] - b.min[2]) / 2 - 0.03], { closedOnly: true }]);
    out.push([d, [x - s * 0.06, mid(beltY, b.max[1]), mid(b.min[2], b.max[2])], [0.03, (b.max[1] - beltY) / 2, (b.max[2] - b.min[2]) / 2 - 0.08], { closedOnly: true }]);
  }
  for (const id of ['bumper_F', 'bumper_R']) {
    const b = B(id);
    out.push([id, [0, mid(b.min[1], b.max[1]), mid(b.min[2], b.max[2])], [(b.max[0] - b.min[0]) / 2 - 0.04, (b.max[1] - b.min[1]) / 2, (b.max[2] - b.min[2]) / 2]]);
  }
  // seats: cushion and back
  for (const id of ['seat_FL', 'seat_FR', 'seat_R']) {
    const b = B(id);
    if (!b) continue;
    const cy = b.min[1] + (b.max[1] - b.min[1]) * 0.3;
    out.push([id, [mid(b.min[0], b.max[0]), cy, mid(b.min[2], b.max[2]) + 0.05], [(b.max[0] - b.min[0]) / 2, 0.06, (b.max[2] - b.min[2]) / 2 - 0.08], { tag: 'seat' }]);
    out.push([id, [mid(b.min[0], b.max[0]), mid(cy, b.max[1] - 0.12), b.min[2] + 0.08], [(b.max[0] - b.min[0]) / 2 - 0.02, (b.max[1] - 0.12 - cy) / 2, 0.05], { rotX: 0.2 }]);
  }
  const e = B('engine');
  if (e) out.push(['engine', [mid(e.min[0], e.max[0]), mid(e.min[1], e.max[1]), mid(e.min[2], e.max[2])], [(e.max[0] - e.min[0]) / 2 - 0.05, (e.max[1] - e.min[1]) / 2 - 0.03, (e.max[2] - e.min[2]) / 2 - 0.05], { tag: 'engine' }]);
  return out.concat(extra);
}
