// Assembles the sedan's scene graph from generated body panels and detail components.
// Every movable or removable piece is a "part" node with its own pivot.

import * as THREE from 'three';
import { bodyField, SPEC } from './body/shape.js';
import { buildWheel } from './parts/wheel.js';
import * as EXT from './parts/exterior.js';
import * as INT from './parts/interior.js';
import * as BAY from './parts/engineBay.js';
import * as CH from './parts/chassis.js';

// Find the outer skin half-width at (y, z) by bisection.
export function skinX(y, z) {
  let lo = 0,
    hi = 1.2;
  if (bodyField(0, y, z) > 0) return 0;
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2;
    if (bodyField(m, y, z) < 0) lo = m;
    else hi = m;
  }
  return lo;
}

export function skinY(x, z) {
  let lo = 0,
    hi = 2;
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2;
    if (bodyField(x, m, z) < 0) lo = m;
    else hi = m;
  }
  return lo;
}

function hingeDefs() {
  const defs = {};
  for (const [s, n] of [
    [1, 'L'],
    [-1, 'R'],
  ]) {
    const zf = 0.842 - 0.03;
    const xf = skinX(0.62, 0.842) - 0.012;
    defs['door_F' + n] = {
      origin: new THREE.Vector3(xf * s, 0.62, zf),
      axis: new THREE.Vector3(-0.06 * s, 1, 0).normalize(),
      max: (-70 * Math.PI) / 180 * s,
    };
    const zr = -0.13 - 0.03;
    const xr = skinX(0.62, -0.13) - 0.012;
    defs['door_R' + n] = {
      origin: new THREE.Vector3(xr * s, 0.62, zr),
      axis: new THREE.Vector3(-0.06 * s, 1, 0).normalize(),
      max: (-68 * Math.PI) / 180 * s,
    };
  }
  defs.hood = { origin: new THREE.Vector3(0, 0.905, 1.06), axis: new THREE.Vector3(1, 0, 0), max: (-52 * Math.PI) / 180 };
  defs.trunk = { origin: new THREE.Vector3(0, 1.0, -1.585), axis: new THREE.Vector3(1, 0, 0), max: (68 * Math.PI) / 180 };
  defs.fuelflap = {
    origin: new THREE.Vector3(-skinX(0.86, -1.555) + 0.004, 0.86, -1.556),
    axis: new THREE.Vector3(0, 1, 0),
    max: (80 * Math.PI) / 180,
  };
  return defs;
}

// Which skin panels travel with each part (child panels follow their parent's pivot).
const PART_PANELS = {
  door_FL: ['door_FL', 'glass_FL'],
  door_FR: ['door_FR', 'glass_FR'],
  door_RL: ['door_RL', 'glass_RL', 'glass_QL'],
  door_RR: ['door_RR', 'glass_RR', 'glass_QR'],
  hood: ['hood'],
  trunk: ['trunk'],
  fuelflap: ['fuelflap'],
  fender_L: ['fender_L'],
  fender_R: ['fender_R'],
  bumper_F: ['bumper_F'],
  bumper_R: ['bumper_R'],
  headlight_L: ['headlight_L'],
  headlight_R: ['headlight_R'],
  taillight_L: ['taillight_L'],
  taillight_R: ['taillight_R'],
  body: ['body', 'windshield', 'rearglass'],
};

export class CarModel {
  constructor(bodyResult, mats) {
    this.root = new THREE.Group();
    this.root.name = 'car';
    this.parts = {};
    this.mats = mats;
    const hinges = hingeDefs();
    for (const [partId, panelIds] of Object.entries(PART_PANELS)) {
      const pivot = new THREE.Group();
      pivot.name = partId;
      const inner = new THREE.Group();
      pivot.add(inner);
      const h = hinges[partId];
      if (h) {
        pivot.position.copy(h.origin);
        inner.position.copy(h.origin).multiplyScalar(-1);
      }
      for (const pid of panelIds) {
        const p = bodyResult.panels[pid];
        if (!p) continue;
        const mesh = new THREE.Mesh(p.geometry, mats.slots);
        mesh.name = pid;
        mesh.castShadow = p.kind !== 'glass';
        mesh.receiveShadow = true;
        if (p.kind === 'glass') mesh.renderOrder = 2;
        inner.add(mesh);
      }
      this.root.add(pivot);
      this.parts[partId] = { id: partId, pivot, inner, hinge: h || null, openT: 0, installed: true };
    }
  }

  addWheels() {
    const spots = {
      wheel_FL: [SPEC.trackHalf, SPEC.axleF, 1],
      wheel_FR: [-SPEC.trackHalf, SPEC.axleF, -1],
      wheel_RL: [SPEC.trackHalf, SPEC.axleR, 1],
      wheel_RR: [-SPEC.trackHalf, SPEC.axleR, -1],
    };
    this.wheels = {};
    for (const [id, [x, z, side]] of Object.entries(spots)) {
      const pivot = new THREE.Group();
      pivot.name = id;
      pivot.position.set(x, SPEC.wheelY, z);
      const knuckle = new THREE.Group();
      pivot.add(knuckle);
      const w = buildWheel({ side });
      knuckle.add(w.group);
      this.root.add(pivot);
      this.parts[id] = { id, pivot, inner: knuckle, hinge: null, openT: 0, installed: true };
      this.wheels[id] = { pivot, knuckle, ...w, side };
    }
  }

  addExteriorDetails() {
    const m = this.mats;
    m.linerMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9, side: THREE.DoubleSide });
    const attach = (partId, obj) => {
      const p = this.parts[partId];
      if (p && obj) p.inner.add(obj);
      return obj;
    };
    attach('headlight_L', EXT.buildHeadlampInternals(m, 1));
    attach('headlight_R', EXT.buildHeadlampInternals(m, -1));
    attach('taillight_L', EXT.buildTaillampInternals(m, 1));
    attach('taillight_R', EXT.buildTaillampInternals(m, -1));
    attach('bumper_F', EXT.buildFrontBumperDetails(m));
    attach('bumper_R', EXT.buildRearReflectors(m));
    attach('trunk', EXT.buildTrunkDetails(m));
    attach('door_FL', EXT.buildMirror(m, 1));
    attach('door_FR', EXT.buildMirror(m, -1));
    attach('door_FL', EXT.buildDoorHandle(m, 1, 0.17, 0.0, 0.876));
    attach('door_FR', EXT.buildDoorHandle(m, -1, 0.17, 0.0, 0.876));
    attach('door_RL', EXT.buildDoorHandle(m, 1, -0.69, -0.86, 0.884));
    attach('door_RR', EXT.buildDoorHandle(m, -1, -0.69, -0.86, 0.884));
    this.wipers = attach('body', EXT.buildWipers(m));
    attach('body', EXT.buildArchLiners(m));
    attach('body', EXT.buildAntenna(m));
    attach('body', EXT.buildFuelCap(m));
  }

  // Adds a standalone part group (not built from skin panels).
  addPart(id, object, { parent = null } = {}) {
    const pivot = new THREE.Group();
    pivot.name = id;
    const inner = new THREE.Group();
    pivot.add(inner);
    inner.add(object);
    (parent ? this.parts[parent].inner : this.root).add(pivot);
    this.parts[id] = { id, pivot, inner, hinge: null, openT: 0, installed: true, object };
    return this.parts[id];
  }

  addInterior() {
    const M = INT.createInteriorMaterials();
    this.interiorMats = M;
    const body = this.parts.body.inner;
    body.add(INT.buildDashboard(M));
    this.cluster = INT.buildCluster(M);
    body.add(this.cluster);
    this.stack = INT.buildCenterStack(M);
    body.add(this.stack);
    const steer = INT.buildSteering(M);
    body.add(steer.column);
    this.steeringColumn = steer.column;
    this.addPart('steeringWheel', steer.wheel);
    this.steeringWheel = steer.wheel;
    this.pedals = INT.buildPedals(M);
    body.add(this.pedals);
    this.roofInterior = INT.buildRoofInterior(M);
    body.add(this.roofInterior);
    body.add(INT.buildParcelShelf(M));
    body.add(INT.buildFloorMats(M));
    body.add(INT.buildBPillars(M));
    this.addPart('seat_FL', INT.buildFrontSeat(M, 1));
    this.addPart('seat_FR', INT.buildFrontSeat(M, -1));
    this.addPart('seat_R', INT.buildRearBench(M));
    for (const d of ['door_FL', 'door_FR', 'door_RL', 'door_RR']) this.parts[d].inner.add(INT.buildDoorTrim(M, d));
  }

  addEngineBay() {
    const M = BAY.createBayMaterials(this.mats);
    this.bayMats = M;
    this.parts.body.inner.add(BAY.buildStructure(M));
    this.parts.body.inner.add(BAY.buildReservoirs(M));
    this.addPart('engine', BAY.buildEngine(M));
    this.addPart('battery', BAY.buildBattery(M));
    this.addPart('radiator', BAY.buildRadiator(M));
    this.addPart('airfilter', BAY.buildAirFilter(M));
  }

  addChassis() {
    const M = CH.createChassisMaterials();
    this.chassisMats = M;
    this.addPart('chassis', CH.buildChassisFrame(M));
    const ex = CH.buildExhaustLine(M);
    ex.add(EXT.buildExhaustTip(this.mats));
    this.addPart('exhaust', ex);
    this.addPart('fueltank', CH.buildFuelTank(M));
  }

  setOpen(partId, t) {
    const p = this.parts[partId];
    if (!p || !p.hinge) return;
    p.openT = t;
    p.pivot.quaternion.setFromAxisAngle(p.hinge.axis, p.hinge.max * t);
  }

  setInstalled(partId, on) {
    const p = this.parts[partId];
    if (!p) return;
    p.installed = on;
    p.pivot.visible = on;
  }
}

// Builds the complete visual model (all parts installed).
export function buildFullCarModel(bodyResult, mats) {
  const m = new CarModel(bodyResult, mats);
  m.addWheels();
  m.addExteriorDetails();
  m.addInterior();
  m.addEngineBay();
  m.addChassis();
  m.root.updateMatrixWorld(true);
  // bounding boxes (car space) of every part at rest, used for mass properties and item colliders
  const box = new THREE.Box3();
  for (const p of Object.values(m.parts)) {
    box.makeEmpty();
    p.pivot.updateMatrixWorld(true);
    p.inner.traverse((o) => {
      if (o.isMesh && o.geometry) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
        box.union(b);
      }
    });
    p.bbox = box.clone();
  }
  return m;
}
