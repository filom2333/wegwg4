// Interaction: what the player is looking at, highlighting, picking up / carrying / rotating /
// throwing items, using items on targets (eat, drink, pour, repair, shoot), car doors and seats,
// removing and installing car parts with a mount-point preview.

import * as THREE from 'three';
import { GROUPS } from '../physics/physics.js';
import { input } from '../core/input.js';
import { settings } from '../core/settings.js';
import { LIQUID_NAMES, ITEMS } from '../items/itemDefs.js';
import { SHADE_TINTS } from '../items/itemModels.js';
import { carType } from '../vehicle/types.js';
import { paintOf } from '../vehicle/paints.js';
import { fitMatrix } from '../vehicle/swap.js';
import { PLATES, plateSpot, plateWorldMatrix, plateModel, attachPlate, detachPlate, plateUnderRay, paintPlate, worldSpot, tiltSpot } from '../vehicle/plates.js';
import { ACCESSORIES, MOUNT_LABEL, buildAccessory, fitAccessory, removeAccessory, canRemoveAccessory, cargoZone } from '../vehicle/accessories.js';
import { Hands, PALM_CONTACT } from './hands.js';
import { holdPose, handsOnItem, handFromAnchor, frameQ, anchorQ, anchorQFor, defaultArms, naturalQ, elbowDir } from './grips.js';
import { HOTBAR, fitsInBag } from '../items/inventory.js';
import { STATIONS } from '../audio/stations.js';
import { ALBUMS, trackOn } from '../audio/music/albums.js';
import { clamp, lerp, smoothstep } from '../core/noise.js';
import { anchorLabel, CABLE_MAX } from '../vehicle/winch.js';
import { JACK_LOW, JACK_MAX } from '../vehicle/jack.js';
import { setTune } from '../vehicle/tuning.js';


// Part table entry of a part item (it remembers which kind of car it came off).
function partDefOf(it) {
  return carType(it.state && it.state.carType).PARTS[it.part] || { label: it.part, mass: 10 };
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// Fuel left at a pump (the station's tank) or in a drum (its own).
const pumpFuel = (p) => (p.drum ? p.inst.state.drums[p.drum] || 0 : p.inst.state.fuel || 0);
const takeFuel = (p, l) => {
  if (p.drum) p.inst.state.drums[p.drum] = Math.max(0, pumpFuel(p) - l);
  else p.inst.state.fuel -= l;
};
// Containers with a cap (cans, bottles, jugs, the drum): it has to come off by hand before
// anything pours in or out, and you see how much is inside only with it off (or through clear
// plastic). Lamps keep their fuel behind a filler of their own.
// only a jerry can has a screw cap to undo (bottles, jugs and tins just pour)
const capped = (def) => !!(def && def.capped);
const capKey = () => (settings.data.bindings.reload || 'KeyR').replace(/^Key/, '');

const REACH = 2.6;

// Big things are carried out in front with both hands; long tools (guns, a fishing rod) are held
// by their grip like anything small.
// Keeps a hand within the arm's reach of its shoulder (camera space), sliding it back along the
// line to where it was wanted; true when it had to (the hand reaches rather than holds).
const ARM_REACH = 0.7;
// how far in front of the eye a small thing can be held out with the hand still on it
const FLOAT_REACH = 0.72;
function reachClamp(placed, shoulder) {
  const d = placed.p.distanceTo(shoulder);
  if (d <= ARM_REACH) return false;
  placed.p.sub(placed.p.clone().sub(shoulder).multiplyScalar((d - ARM_REACH) / d));
  return true;
}

function carriedBig(it) {
  if (it.part) return true;
  if (it.def && (it.def.weapon || it.def.fishing)) return false;
  return Math.max(it.size.x, it.size.y, it.size.z) > 0.55;
}
// Too heavy to lift (an engine, a body shell, a full drum): dragged by hand instead (LMB held).
function heavyItem(it) {
  return (it.part ? partDefOf(it).mass : it.mass || 0) > 60;
}
// temporaries for the grab solver
const _gq = new THREE.Quaternion();
const _gm = new THREE.Matrix4();
const _gy = new THREE.Vector3(0, 1, 0);
const _g1 = new THREE.Vector3(1, 1, 1);
// where thumb and index meet in the pinch pose (hand space)
const PINCH_TIP = V(0, -0.028, -0.135);
const tmpM = new THREE.Matrix4();
const tmpRay = new THREE.Ray();
const tmpV = new THREE.Vector3();

export class Interaction {
  constructor(game) {
    this.game = game;
    this.cam = game.eyeCam;
    this.held = null;
    this.dragging = false;
    this.holdRot = new THREE.Quaternion();
    this.holdDist = 1.0;
    // key 1: fists up (empty hands ready to fight); a punch runs t 0..1, alternating hands
    this.fists = false;
    this.punch = { t: 1, side: 'left', done: true };
    this.rotating = false;
    this.target = null;
    this.hands = new Hands(this.cam);
    this.viewRoot = new THREE.Group();
    this.viewRoot.add(this.hands.root);
    game.scene.add(this.viewRoot);
    this.ghost = null;
    this.ghostFor = null;
    this.removing = null; // { part, t }
    this.pouring = 0;
    this.ammo = { 38: 0, 12: 0 };
    this.useAnim = 0;
    this.swing = 0;
    this.recoil = 0;
    this.fireCooldown = 0;
    this.reloading = 0;
    this.dropHold = 0;
    this.aim = 0;
    this.sway = V(0, 0, 0);
    this.lastYaw = 0;
    this.lastPitch = 0;
    this.stowWatch = new Map();
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x8fd18a, transparent: true, opacity: 0.28, depthWrite: false });
    this.ghostBad = new THREE.MeshBasicMaterial({ color: 0xd9776a, transparent: true, opacity: 0.25, depthWrite: false });
  }

  get holding() {
    return this.held;
  }

  // Where the winch hook is held: low and to the right in front of the eye.
  hookHand(out = V(0, 0, 0)) {
    const q = this.cam.quaternion;
    return out.copy(this.cam.position).add(V(0.17, -0.27, -0.55).applyQuaternion(q));
  }

  // Where the held jack would go: the corner of the current car you are looking at.
  jackSpot() {
    const g = this.game;
    const car = g.car;
    const hit = this.lookHit;
    if (!car || !hit || hit.distance > REACH + 0.4 || g.player.seat) return null;
    if (car.root.position.distanceTo(this.cam.position) > 5) return null;
    return g.jacks.spotFor(car, V(hit.point.x, hit.point.y, hit.point.z));
  }

  // ------------------------------------------------------------------ targeting
  findTarget() {
    const g = this.game;
    const p = g.player;
    const origin = this.cam.position.clone();
    const dir = V(0, 0, -1).applyQuaternion(this.cam.quaternion);
    const reach = REACH + (p.seat ? 0.6 : 0);
    // the camera sits inside the player capsule: always exclude it; the held item is filtered out
    const heldBody = this.held && this.held.body;
    const hit = g.physics.raycast(origin, dir, reach + 3, GROUPS.look, p.body, (c) => {
      const o = g.physics.ownerOf(c);
      if (heldBody && c.parent() === heldBody) return false;
      return !(o && o.item && o.item === this.held);
    });
    const hitDist = hit ? hit.distance : Infinity;
    let best = null;
    // world items
    if (hit && hit.owner && hit.owner.kind === 'item' && hit.distance <= reach) {
      best = { kind: 'item', item: hit.owner.item, dist: hit.distance, point: hit.point };
    }
    // car parts / hotspots
    const car = g.car;
    if (car) {
      const carDist = car.root.position.distanceTo(origin);
      if (carDist < 8) {
        // (from a seat the car's own coarse colliders are all around: they do not hide its controls)
        const cand = this.carTarget(origin, dir, p.seat ? reach : Math.min(reach, hitDist + 0.35));
        if (cand && (!best || cand.dist < best.dist - 0.02)) best = cand;
      }
    }
    // plates bolted to the world, or to some other car standing here
    if (!p.seat) {
      const lim = Math.min(reach, hitDist + 0.05);
      const wp = g.worldPlates && g.worldPlates.underRay(origin, dir, lim);
      if (wp && (!best || wp.dist < best.dist)) best = { kind: 'plate', plate: wp.plate, dist: wp.dist };
      for (const c of (g.fleet && g.fleet.cars) || []) {
        if (c === car || !c.plates || !c.plates.length || c.root.position.distanceTo(origin) > 7) continue;
        const cp = plateUnderRay(c, origin, dir, Math.min(reach, hitDist + 0.35));
        if (cp && (!best || cp.dist < best.dist)) best = { kind: 'plate', plate: cp.plate, dist: cp.dist };
      }
    }
    // poi doors, pumps
    if (hit && hit.owner && hit.distance <= reach) {
      if (hit.owner.kind === 'door' && (!best || hit.distance < best.dist)) best = { kind: 'poiDoor', door: hit.owner.door, dist: hit.distance, point: hit.point };
    }
    if (g.pois && (!best || best.kind !== 'item')) {
      const tip = origin.clone().addScaledVector(dir, Math.min(reach, hitDist));
      const pump = g.pois.nearestPump(tip, 0.9);
      if (pump && pump.world.distanceTo(origin) < reach + 0.6) best = { kind: 'pump', pump, dist: pump.world.distanceTo(origin) };
    }
    // a jack standing under a car
    if (hit && hit.owner && hit.owner.kind === 'jack' && hit.distance <= reach + 0.3 && (!best || hit.distance < best.dist + 0.1)) best = { kind: 'jack', jack: hit.owner.jack, dist: hit.distance };
    // a pitched tent; a bed in a house
    if (hit && hit.owner && hit.owner.kind === 'tent' && hit.distance <= reach + 0.4 && (!best || hit.distance < best.dist)) best = { kind: 'tent', tent: hit.owner.tent, dist: hit.distance };
    if (g.pois && !p.seat && (!best || best.kind === 'poiDoor')) {
      const tip = origin.clone().addScaledVector(dir, Math.min(reach, hitDist));
      const bed = g.pois.nearestBed(tip, 1.1);
      if (bed && (!best || bed.world.distanceTo(origin) < best.dist)) best = { kind: 'bed', bed, dist: bed.world.distanceTo(origin) };
    }
    // trailers
    if (hit && hit.owner && hit.owner.kind === 'trailer' && hit.distance <= reach + 0.3 && (!best || hit.distance < best.dist)) best = { kind: 'trailer', trailer: hit.owner.trailer, dist: hit.distance };
    // npcs (for melee / corpses)
    if (hit && hit.owner && hit.owner.kind === 'npc' && hit.distance <= reach && (!best || hit.distance < best.dist)) best = { kind: 'npc', npc: hit.owner.npc, dist: hit.distance, zone: hit.owner.zone };
    // lootable bodies are small and low: accept a near miss
    if (!best && g.npcs) {
      const c = g.npcs.corpseNear(origin, dir, Math.min(reach + 0.4, hitDist + 0.6));
      if (c) best = { kind: 'npc', npc: c.npc, dist: c.dist, zone: 'torso' };
    }
    this.lookHit = hit;
    return best;
  }

  // Current world matrix of a part's rest content.
  partMatrix(car, id) {
    return car.partWorldMatrix(id);
  }

  // The car's hotspots that can be worked from where the player is, each with where it is in the
  // world now: inside ones from a seat that reaches them, outside ones on foot. Door handles ride
  // on their doors.
  hotspotsOf(car) {
    const p = this.game.player;
    const seat = p.seat && p.car === car ? p.seat : null;
    const out = [];
    for (const h of car.type.HOTSPOTS) {
      if (!car.isInstalled(h.part)) continue;
      if (h.lid && !car.lidOpen(h.lid)) continue;
      if (!!h.inside !== !!seat) continue;
      if (seat && h.seats && !h.seats.includes(seat)) continue;
      out.push({ h, world: this.hotspotWorld(car, h) });
    }
    return out;
  }

  hotspotWorld(car, h, out = V(0, 0, 0)) {
    const door = h.door && car.model.parts[h.door];
    return out.copy(h.pos).applyMatrix4(door ? door.inner.matrixWorld : car.root.matrixWorld);
  }

  carTarget(origin, dir, maxDist) {
    const car = this.game.car;
    const list = [];
    const inv = new THREE.Matrix4();
    const seated = !!this.game.player.seat;
    for (const [id, part] of Object.entries(car.model.parts)) {
      if (seated) break;
      if (!car.isInstalled(id) || id === 'body' || id === 'chassis') continue;
      if (!part.bbox || part.bbox.isEmpty()) continue;
      // under a closed bonnet or boot lid: out of reach (and out of sight)
      if (car.lidBlocking(id)) continue;
      inv.copy(this.partMatrix(car, id)).invert();
      tmpRay.origin.copy(origin).applyMatrix4(inv);
      tmpRay.direction.copy(dir).transformDirection(inv);
      const box = part.bbox;
      const hitP = tmpRay.intersectBox(box, tmpV);
      if (!hitP) continue;
      const d = hitP.clone().applyMatrix4(this.partMatrix(car, id)).distanceTo(origin);
      if (d > maxDist) continue;
      const sz = box.getSize(V(0, 0, 0));
      list.push({ id, d, vol: sz.x * sz.y * sz.z });
    }
    // hotspots: on foot the one under the aim; from a seat the control nearest the middle of
    // the view within a generous cone (they sit close together on a dash)
    const cinv = new THREE.Matrix4().copy(car.root.matrixWorld).invert();
    const lo = origin.clone().applyMatrix4(cinv);
    const ld = dir.clone().transformDirection(cinv);
    let hs = null;
    for (const { h, world } of this.hotspotsOf(car)) {
      const to = world.sub(origin);
      const t = to.length();
      if (t > maxDist + 0.2 || to.dot(dir) <= 0) continue;
      const allow = h.inside ? Math.max(Math.atan2(h.r * 1.5, t), 0.075) : Math.atan2(h.r, t);
      const score = to.angleTo(dir) / allow;
      if (score < 1 && (!hs || score < hs.score)) hs = { kind: 'hotspot', hotspot: h, dist: t, score };
    }
    // seats via door opening: choose the seat closest to the ray if a door is open/missing
    let seat = null;
    if (!this.game.player.seat) {
      for (const [name, s] of Object.entries(car.type.SEATS)) {
        const door = s.door;
        const doorOpen = !car.isInstalled(door) || car.model.parts[door].openT > 0.6;
        if (!doorOpen || !car.isInstalled(s.part)) continue;
        const toC = s.pos.clone().add(V(0, -0.25, 0)).sub(lo);
        const t = toC.dot(ld);
        if (t < 0 || t > maxDist + 0.6) continue;
        const dd = toC.addScaledVector(ld, -t).length();
        if (dd < 0.32 && (!seat || dd < seat.dd)) seat = { kind: 'seat', seat: name, dist: t, dd };
      }
    }
    // plates bolted on: in front of whatever they cover
    const pl = !seated && plateUnderRay(car, origin, dir, maxDist);
    if (pl) list.push({ id: 'plate', plate: pl.plate, d: pl.dist - 0.03, vol: 0 });
    // things bolted on (or hung on the mirror): the same
    {
      for (const it of car.attached || []) {
        if (!it.mounted) continue;
        inv.copy(it.mesh.matrixWorld).invert();
        tmpRay.origin.copy(origin).applyMatrix4(inv);
        tmpRay.direction.copy(dir).transformDirection(inv);
        const h = it.size.clone().multiplyScalar(0.5).addScalar(0.01);
        const hitP = tmpRay.intersectBox(new THREE.Box3(h.clone().negate(), h), tmpV);
        if (!hitP) continue;
        const d = hitP.clone().applyMatrix4(it.mesh.matrixWorld).distanceTo(origin);
        if (d < maxDist) list.push({ id: 'item', item: it, d: d - 0.03, vol: 0 });
      }
    }
    // bolt-on accessories
    if (!seated)
      for (const [mount, a] of Object.entries(car.accessories || {})) {
        tmpRay.origin.copy(origin).applyMatrix4(cinv);
        tmpRay.direction.copy(dir).transformDirection(cinv);
        const hitP = tmpRay.intersectBox(a.box, tmpV);
        if (!hitP) continue;
        const d = hitP.clone().applyMatrix4(car.root.matrixWorld).distanceTo(origin);
        if (d > maxDist) continue;
        const sz = a.box.getSize(V(0, 0, 0));
        list.push({ id: mount, acc: true, d, vol: sz.x * sz.y * sz.z });
      }
    list.sort((a, b) => a.d - b.d);
    let pick = null;
    if (list.length) {
      pick = list[0];
      for (const c of list) if (c.d - list[0].d < 0.15 && c.vol < pick.vol) pick = c;
    }
    let best = pick ? (pick.item ? { kind: 'item', item: pick.item, dist: pick.d } : pick.plate ? { kind: 'plate', plate: pick.plate, dist: pick.d } : pick.acc ? { kind: 'accessory', mount: pick.id, dist: pick.d } : { kind: 'part', part: pick.id, dist: pick.d, point: origin.clone().addScaledVector(dir, pick.d) }) : null;
    if (seat && (!best || seat.dist < best.dist + 0.4)) best = seat;
    if (hs && (!best || hs.dist < best.dist + 0.25)) best = hs;
    return best;
  }

  // E on a car control (with the hand that is free).
  useHotspot(hs) {
    const g = this.game;
    const car = g.car;
    const h = hs.id;
    this.driverReach(hs);
    if (h === 'ignition') return this.turnKey(car);
    if (h === 'fuel') return car.useFiller();
    // (a winder is turned by hand: LMB held, see updateGrab)
    if (h.startsWith('crank')) return;
    // an electric window switch: the glass runs while it is held
    if (h === 'windowFL' || h === 'windowFR') {
      const door = h === 'windowFL' ? 'door_FL' : 'door_FR';
      this.switchWindow = { door, dir: (car.windowT[door] || 0) > 0.5 ? -1 : 1 };
      g.audio && g.audio.play('click', { volume: 0.3, rate: 0.9 });
      return;
    }
    if (h === 'handbrake') {
      car.parkBrake = !car.parkBrake;
      g.audio && g.audio.play(car.parkBrake ? 'parkBrake' : 'clunk', { volume: car.parkBrake ? 0.8 : 0.45, rate: car.parkBrake ? 1 : 1.1, pitchVar: 0.05 });
      return;
    }
    if (h === 'doorFL' || h === 'doorFR') {
      car.handlePull[hs.door] = 0.4;
      car.toggleOpen(hs.door);
      return;
    }
    if (h === 'indicator') car.indicator = car.indicator < 0 ? 0 : -1;
    if (h === 'lights') car.lightsOn = (car.lightsOn + 1) % 3;
    if (h === 'wipers') car.wipers = (car.wipers + 1) % 4;
    if (h === 'hazard') car.hazards = !car.hazards;
    if (h === 'heater') car.heater = !car.heater;
    if (h === 'dome') car.cabinLight = !car.cabinLight;
    if (h === 'radio') {
      car.radioOn = !car.radioOn;
      g.audio && g.audio.setRadio(car.radioOn);
    }
    g.audio && g.audio.play('click', { volume: 0.4, rate: h === 'indicator' ? 0.85 : 1 });
  }

  // E on the ignition key turns it to ON; held, on to START and the starter cranks; let go, it
  // springs back to ON. With the engine running it switches off; a quick tap with the key on
  // (engine not running) switches it off too.
  turnKey(car) {
    const running = car.dyn.engine.running;
    this.keyTurn = { car, held: 0, wasOn: car.ignition && !running, off: running };
    if (running) car.setIgnition(false);
    else if (!car.ignition) car.setIgnition(true);
    this.game.audio && this.game.audio.play('click', { volume: 0.32, rate: 0.75 });
  }

  updateKey(dt) {
    const k = this.keyTurn;
    if (!k) return;
    const car = k.car;
    const p = this.game.player;
    if (input.isDown('interact') && p.seat === 'driver' && p.car === car) {
      k.held += dt;
      if (car.dyn.engine.running) car.cranking = 0;
      else if (!k.off && car.ignition && k.held > 0.18) car.crank(dt);
      return;
    }
    if (k.wasOn && k.held < 0.18 && !car.dyn.engine.running) car.setIgnition(false);
    car.cranking = 0;
    this.keyTurn = null;
  }

  // The interaction dots on the HUD: the car's controls within reach, shown while the aim is
  // inside a wide circle round them, the targeted one as a ring with its name (`label`).
  updateDots(t, label) {
    const g = this.game;
    const ui = g.hud;
    if (!ui || !ui.setDots) return;
    const car = g.car;
    const p = g.player;
    const out = [];
    const cam = this.cam;
    if (car && !p.dead && !p.lying && !p.thirdPerson && (p.seat ? p.car === car : car.root.position.distanceTo(cam.position) < 6)) {
      const W = window.innerWidth,
        H = window.innerHeight;
      const R = Math.min(W, H) * 0.3;
      const fwd = V(0, 0, -1).applyQuaternion(cam.quaternion);
      for (const { h, world } of this.hotspotsOf(car)) {
        const to = world.clone().sub(cam.position);
        const d = to.length();
        if (d > (p.seat ? REACH : 3.2) || to.dot(fwd) <= 0.1 * d) continue;
        // on foot: not through the car or a wall
        if (!p.seat) {
          const hit = g.physics.raycast(cam.position, to.clone().divideScalar(d), d, GROUPS.look, p.body);
          if (hit && hit.distance < d - 0.3) continue;
        }
        const v = world.clone().project(cam);
        const x = (v.x * 0.5 + 0.5) * W,
          y = (0.5 - v.y * 0.5) * H;
        const r = Math.hypot(x - W / 2, y - H / 2);
        const on = !!(t && t.kind === 'hotspot' && t.hotspot === h);
        if (r > R && !on) continue;
        out.push({ x, y, a: on ? 1 : 1 - smoothstep(R * 0.5, R, r), on, label: on && label ? label.title : '', sub: on && label ? label.sub : '' });
      }
    }
    ui.setDots(out);
  }

  // ------------------------------------------------------------------ main update
  update(dt) {
    const g = this.game;
    const ui = g.hud;
    const blocked = g.ui && g.ui.blocksMove;
    const p = g.player;
    if (p.dead) {
      g.hud && g.hud.setDots && g.hud.setDots([]);
      return;
    }
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.updateKey(dt);
    // doors and lids let go of still swinging; a hand on one, moved by the hand
    this.updateSwinging(dt);
    if (this.grab && this.updateGrab(dt, blocked)) return;
    // a heavy thing dragged only while LMB is held
    if (this.held && this.dragging && !input.mouseDown(0)) this.drop(0);
    // an electric window switch held down
    if (this.switchWindow) {
      if (!input.isDown('interact') || !g.car || !p.seat) this.switchWindow = null;
      else if (g.car.isInstalled('battery') && g.car.battery > 0.03) g.car.windWindow(this.switchWindow.door, (this.switchWindow.dir * dt) / 3);
    }
    // pulling a trailer by its drawbar for as long as E is held
    if (this.pullingTrailer) {
      const tr = this.pullingTrailer;
      if (!input.isDown('interact') || this.held || p.seat || tr.hitch) this.pullingTrailer = null;
      else {
        const fwd = V(0, 0, -1).applyQuaternion(this.cam.quaternion).setY(0).normalize();
        tr.pull(p.position.clone().addScaledVector(fwd, 1.1).add(V(0, 0.45, 0)), dt);
        const c = tr.hitchableCar();
        g.hud && c && !this._hitchHint && (this._hitchHint = true) && g.hud.toast('Over the tow ball: let go and press E to hitch');
      }
    } else this._hitchHint = false;
    if (this.fishing && !(this.held && this.held.def && this.held.def.fishing)) this.endFishing();
    // lying in a tent or on a bed: get up, or sleep
    if (p.lying) {
      this.target = null;
      const kn = (a) => (settings.data.bindings[a] || '').replace(/^Key|^Digit/, '');
      const prompts = [[kn('interact'), p.lying.kind === 'tent' ? 'Crawl out' : 'Get up']];
      if (!(g.sleepHours > 0)) prompts.push([kn('sleep'), 'Sleep']);
      if (!blocked && input.wasPressed('interact')) p.getUp();
      if (ui) {
        ui.setPrompts(prompts);
        ui.setTargetInfo({ title: p.lying.kind === 'tent' ? 'In the tent' : 'In bed', sub: `${Math.round(p.energy)}% rested` });
        ui.setCrosshair('none');
      }
      this.updateOutline(null);
      this.updateDots(null);
      return;
    }
    // from behind the body (third person) nothing is aimed at: the aim is the eye's, and its dots,
    // rings and cards would point at things the view does not look at
    const third = p.thirdPerson && (p.tpBlend || 0) > 0.5;
    this.target = third ? null : this.findTarget();
    const t = this.target;
    const prompts = [];
    let info = null;
    const kn = (a) => (settings.data.bindings[a] || '').replace(/^Key|^Digit/, '');
    // ---- carrying the winch hook out to an anchor
    const W = g.winches;
    if (W && W.cable && !W.cable.anchor && !this.held) {
      const hit = this.lookHit;
      const owner = hit && hit.owner;
      const own = owner && owner.kind === 'car' && owner.car === W.cable.car;
      const label = hit && hit.distance <= REACH + 0.6 && !own ? anchorLabel(owner) : null;
      const drum = W.drumOf(W.cable.car);
      info = { title: 'Winch hook', sub: `${drum ? Math.round(drum.distanceTo(this.hookHand())) : 0} of ${CABLE_MAX} m of cable out` };
      if (label) prompts.push(['E', `Hook it round ${label}`]);
      else prompts.push(['', 'Walk it to a tree, a rock, a building or another car']);
      prompts.push(['R', 'Let it wind back']);
      if (!blocked) {
        if (label && input.wasPressed('interact')) W.attach(hit);
        else if (input.wasPressed('reload')) W.release();
      }
    } else if (this.held) {
      const it = this.held;
      this.updateHeld(dt);
      const def = it.def;
      if (it.part) {
        const fit = this.partFit(it);
        info = { title: it.name, sub: `${partDefOf(it).mass} kg` };
        if (fit) {
          this.showGhost(it, fit.ok);
          if (fit.ok) prompts.push(['E', 'Install ' + this.game.car.PARTS[fit.slot].label.toLowerCase()]);
          else prompts.push(['', fit.reason]);
          if (fit.ok && !blocked && input.wasPressed('interact')) this.install(it, fit.slot);
        } else this.hideGhost();
      } else if (def && def.plate) {
        info = this.heldInfo(it);
        const spot = this.plateFit(it);
        if (spot) {
          this.showPlateGhost(it, spot);
          const where = spot.host === 'car' ? `to the ${(spot.car.PARTS[spot.part] || { label: spot.part }).label.toLowerCase()}` : spot.normal.y > 0.8 ? 'down here' : 'to this';
          const tilt = Math.round(((this.plateTilt || 0) * 180) / Math.PI);
          prompts.push(['E', `${spot.normal.y > 0.8 && spot.host === 'world' && tilt >= 60 ? 'Stand it up' : 'Bolt it'} ${where}`], ['Wheel', 'Turn'], ['Shift+Wheel', tilt ? `Tilt · ${tilt}°` : 'Tilt']);
          if (!blocked && input.wasPressed('interact')) this.boltHeldPlate(it, spot);
        } else {
          this.hideGhost();
          prompts.push(['', 'Aim at a car, a wall, a fence or the ground to bolt it']);
        }
      } else if (def && def.jack) {
        info = this.heldInfo(it);
        const spot = this.jackSpot();
        if (spot && !spot.blocked) {
          prompts.push(['E', 'Set it under the car']);
          if (!blocked && input.wasPressed('interact')) {
            g.jacks.place(spot);
            this.consumeHeld();
          }
        } else prompts.push(['', spot ? spot.blocked : 'Aim under the sill beside a wheel']);
      } else if (def && def.accessory) {
        const fit = this.accessoryFit(it);
        info = this.heldInfo(it);
        if (fit) {
          this.showAccessoryGhost(it, fit.ok);
          if (fit.ok) prompts.push(['E', `Fit to the ${MOUNT_LABEL[fit.mount]}`]);
          else prompts.push(['', fit.reason]);
          if (fit.ok && !blocked && input.wasPressed('interact')) this.fitHeldAccessory(it);
        } else {
          this.hideGhost();
          prompts.push(['', `Take it to a car to fit it to the ${MOUNT_LABEL[ACCESSORIES[def.accessory].mount]}`]);
        }
      } else {
        info = this.heldInfo(it);
        // a decoration aimed at a car's inside mirror: hang it there
        const hang = def && def.hang ? this.hangFit(it) : null;
        if (hang) {
          prompts.push([kn('sleep'), 'Hang it on the mirror']);
          if (!blocked && input.wasPressed('sleep')) this.hangHeld(it, hang);
        }
        // aimed at a car: bolt it on where the ghost shows
        const spot = hang ? null : this.boltFit(it);
        if (spot) {
          this.showBoltGhost(it, spot);
          prompts.push([kn('sleep'), `Bolt it to the ${this.boltPlace(spot.car, spot.part, spot.normal)}`], ['Shift+Wheel', 'Turn']);
          if (!blocked && input.wasPressed('sleep')) this.boltHeld(it, spot);
        } else this.hideGhost();
        // from a seat the other hand works the car's controls
        if (p.seat && t && t.kind === 'hotspot' && t.hotspot.inside) {
          const r = this.describeTarget(t);
          this.dotLabel = r.info;
          for (const pr of r.prompts) if (pr[0] === 'E') prompts.push(pr);
          if (!blocked && input.wasPressed('interact')) this.useHotspot(t.hotspot);
        }
        // with a can in the hand, the other hand opens the fuel filler
        if (!p.seat && t && t.kind === 'hotspot' && t.hotspot.id === 'fuel') {
          const r = this.describeTarget(t);
          for (const pr of r.prompts) if (pr[0] === 'E') prompts.push(pr);
          if (!blocked && input.wasPressed('interact')) this.useHotspot(t.hotspot);
        }
        for (const pr of this.useOptions(it, t)) prompts.push(pr);
      }
      prompts.push(['G', 'Drop', 'hold to throw']);
      if (!def || !def.weapon) prompts.push(['RMB', 'Rotate'], ['Wheel', this.floating ? 'Closer / further, back into the hand' : 'Hold out / closer']);
      if (def && !it.part) prompts.push([kn('stow'), fitsInBag(it.id, it.state) ? 'Put in backpack' : 'Too bulky for the backpack']);
      if (!blocked) {
        if (input.isDown('drop')) this.dropHold += dt;
        if (input.wasReleased('drop')) {
          this.drop(this.dropHold > 0.35 ? 9 + Math.min(1, this.dropHold) * 3 : 0);
          this.dropHold = 0;
        }
        if (input.wasPressed('stow')) this.stowHeld(this.game.inventory);
        this.hotbarKeys();
      }
    } else {
      this.hideGhost();
      if (this.carTipped()) {
        info = { title: 'Overturned', sub: 'On its side or roof', progress: this.righting > 0 ? Math.min(1, this.righting / 0.4) : undefined };
        prompts.push([kn('interact'), 'Push it back onto its wheels (hold)']);
        if (!blocked) this.updateRighting(dt);
      } else if (t) {
        this.righting = 0;
        const r = this.describeTarget(t);
        info = r.info;
        // a car control: its name goes on the ring round it, the card keeps just the keys
        if (t.kind === 'hotspot') {
          this.dotLabel = info.title ? info : null;
          if (t.hotspot.inside) info = null;
          else this.dotLabel = null;
        }
        prompts.push(...r.prompts);
        if (!blocked) this.handleTargetInput(t, dt);
      } else this.removing = null;
      // R held with nothing in the hands and nothing aimed at: take off what you wear
      const worn = !t && this.wornNext();
      if (worn) {
        prompts.push(['R', `Take off (hold): ${worn.name}`]);
        this.takeOffT = !blocked && input.isDown('reload') ? (this.takeOffT || 0) + dt : 0;
        if (this.takeOffT > 0.35) {
          this.takeOffT = 0;
          this.takeOff(worn);
        }
      }
      if (this.fists && !p.seat) {
        if (!t) prompts.push(['LMB', 'Punch'], ['1', 'Lower your fists']);
        else if (!prompts.some((x) => x[0] === 'LMB')) prompts.push(['LMB', 'Punch']);
        if (!blocked && input.mousePressed(0) && this.punch.t >= 0.75) this.startPunch();
      }
      if (p.seat) this.fists = false;
      this.updatePunch(dt);
      if (p.seat && g.car && !blocked && input.wasPressed('nextTrack')) {
        // N: next track on a disc, else the next station
        if (g.car.stereo.mode === 'cd' && g.car.stereo.disc >= 0) g.car.nextTrack();
        else g.car.nextStation();
        g.car.radioOn = true;
        g.audio && g.audio.play('click');
      }
      const W2 = g.winches;
      if (p.seat === 'driver' && W2 && W2.cable && W2.cable.anchor && W2.cable.car === g.car) prompts.push([kn('winch'), 'Wind in the winch (hold)']);
      if (!t && p.seat && g.car && Math.abs(g.car.speedKmh) < 3) {
        prompts.push([kn('interact'), 'Get out']);
        if (g.car && !g.car.dyn.engine.running) prompts.push([kn('sleep'), 'Sleep']);
      }
      if (!blocked) {
        this.hotbarKeys();
        // Q on something lying about: straight into the backpack
        if (input.wasPressed('stow') && t && t.kind === 'item' && !t.item.part && !t.item.mounted) this.lootToBag(t.item);
      }
    }
    if (ui) {
      // (third person: a clean view, the cards and key lists are for the first-person one)
      ui.setPrompts(third ? [] : prompts);
      ui.setTargetInfo(third ? null : info);
      ui.setCardPlace && ui.setCardPlace(!!this.held, !!p.seat);
      ui.setCrosshair(third ? 'none' : this.held && this.held.def && this.held.def.weapon ? 'gun' : t ? 'active' : p.seat === 'driver' ? 'none' : 'dot');
    }
    // outline highlight; dots on the car's controls
    this.updateOutline(t);
    this.updateDots(t, t && t.kind === 'hotspot' ? this.dotLabel : null);
    this.dotLabel = null;
    // stow watch: items resting inside the car become attached to it
    this.updateStowing(dt);
  }

  // ------------------------------------------------------------------ taking hold of things
  // As in The Long Drive: LMB held on a door, a lid, the fuel flap or a winder takes hold of it
  // where the aim is; the point held is pulled toward where the hand now is (as far along the view
  // as when it was taken), so turning the view or walking swings it. Go too far and the hand slips
  // off; let go and it swings on a little. Heavy things are dragged by the point held the same way.
  grabbable(t) {
    const g = this.game;
    const car = g.car;
    if (!t || this.held) return null;
    if (t.kind === 'part' && car) {
      const mp = car.model.parts[t.part];
      if (mp && mp.hinge && car.isInstalled(t.part)) return { kind: 'car', car, id: t.part };
    }
    if (t.kind === 'hotspot' && car) {
      const h = t.hotspot;
      if ((h.id === 'doorFL' || h.id === 'doorFR') && h.door && car.isInstalled(h.door)) return { kind: 'car', car, id: h.door, handle: true };
      if (h.id.startsWith('crank') && g.player.seat && car.isInstalled(h.door)) return { kind: 'crank', car, door: h.door };
      if (h.id === 'fuel' && car.model.filler && car.isInstalled('fueltank')) return { kind: 'flap', car };
    }
    if (t.kind === 'poiDoor') return { kind: 'poiDoor', door: t.door };
    if (t.kind === 'item' && !t.item.mounted && heavyItem(t.item)) return { kind: 'heavy', item: t.item };
    return null;
  }

  startGrab(gd, t) {
    const g = this.game;
    const at = t.point ? V(t.point.x, t.point.y, t.point.z) : t.kind === 'hotspot' ? g.car.worldPointOf(t.hotspot.pos) : null;
    if (gd.kind === 'heavy') return this.pickDrag(gd.item, at);
    const G = { ...gd, t, time: 0, v: 0, click: 0, local: null };
    // whatever was still swinging stops in the hand
    this.swinging = (this.swinging || []).filter((s) => !this.sameGrab(s.G, G));
    if (gd.kind === 'car') {
      const mp = gd.car.model.parts[gd.id];
      mp.inner.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(mp.inner.matrixWorld).invert();
      // the point taken hold of, in the part's closed pose (car space)
      G.local = at ? at.clone().applyMatrix4(inv) : mp.bbox.getCenter(V(0, 0, 0));
      if (gd.id.startsWith('door')) gd.car.handlePull[gd.id] = 0.3;
    } else if (gd.kind === 'poiDoor') {
      const d = gd.door;
      d.pivot.updateMatrixWorld(true);
      G.local = at ? at.clone().applyMatrix4(new THREE.Matrix4().copy(d.pivot.matrixWorld).invert()) : V(d.w - 0.08, 1.0, 0);
    } else if (gd.kind === 'flap') {
      const F = gd.car.model.filler;
      F.hinge.updateMatrixWorld(true);
      G.local = at ? at.clone().applyMatrix4(new THREE.Matrix4().copy(F.hinge.matrixWorld).invert()) : V(0, 0, 0.01);
      gd.car.fillerHeld = gd.car.fillerT;
    } else if (gd.kind === 'crank') g.player.lookFrozen = true;
    G.point = at;
    if (at && G.local) {
      const h = this.lookHit;
      let n = h && h.normal && Math.hypot(h.point.x - at.x, h.point.y - at.y, h.point.z - at.z) < 0.06 ? V(h.normal.x, h.normal.y, h.normal.z) : this.cam.position.clone().sub(at);
      if (n.dot(this.cam.position.clone().sub(at)) < 0) n.negate();
      n.normalize();
      // (a second point a little off it, carried round with the first)
      const probe = at.clone().addScaledVector(n, 0.05);
      const m = G.kind === 'car' ? G.car.model.parts[G.id].inner.matrixWorld : G.kind === 'flap' ? G.car.model.filler.hinge.matrixWorld : G.door.pivot.matrixWorld;
      // (a car part's own frame is the car's, closed: its inner group)
      G.localN = probe.applyMatrix4(new THREE.Matrix4().copy(m).invert());
    }
    // the hand holds it this far out along the view
    G.dist = clamp(at ? at.distanceTo(this.cam.position) : 0.8, 0.3, REACH + 0.2);
    this.grab = G;
  }

  sameGrab(a, b) {
    return a.kind === b.kind && (a.kind === 'poiDoor' ? a.door === b.door : a.car === b.car && a.id === b.id);
  }

  // Where the point taken hold of (or another point of the thing, `local`) is with the thing
  // open by `u` (0 shut, 1 all the way).
  grabWorld(G, u, local = G.local) {
    if (G.kind === 'car') {
      const h = G.car.model.parts[G.id].hinge;
      _gq.setFromAxisAngle(h.axis, h.max * u);
      return local.clone().sub(h.origin).applyQuaternion(_gq).add(h.origin).applyMatrix4(G.car.root.matrixWorld);
    }
    if (G.kind === 'flap') {
      const F = G.car.model.filler;
      const e = u * u * (3 - 2 * u);
      _gm.compose(F.hinge.position, _gq.setFromAxisAngle(_gy, F.side * 1.95 * e), _g1);
      return local.clone().applyMatrix4(_gm).applyMatrix4(F.hinge.parent.matrixWorld);
    }
    const d = G.door;
    _gm.compose(d.pivot.position, _gq.setFromAxisAngle(_gy, d.baseRot + u * 1.55), _g1);
    return local.clone().applyMatrix4(_gm).applyMatrix4(d.pivot.parent.matrixWorld);
  }

  // The surface's outward direction at the point held, as the thing is now.
  grabNormal(G) {
    if (!G.localN) return null;
    const u = this.grabOpen(G);
    return this.grabWorld(G, u, G.localN).sub(this.grabWorld(G, u)).normalize();
  }

  grabOpen(G) {
    return G.kind === 'car' ? G.car.model.parts[G.id].openT : G.kind === 'flap' ? G.car.fillerT : G.door.open;
  }

  // The opening that brings the held point nearest `target` (a coarse sweep, then halving).
  nearestOpen(G, target) {
    let best = 0,
      bd = Infinity;
    for (let i = 0; i <= 24; i++) {
      const d = this.grabWorld(G, i / 24).distanceToSquared(target);
      if (d < bd) (bd = d), (best = i / 24);
    }
    let step = 1 / 24;
    for (let k = 0; k < 5; k++) {
      step /= 2;
      for (const u of [best - step, best + step]) {
        if (u < 0 || u > 1) continue;
        const d = this.grabWorld(G, u).distanceToSquared(target);
        if (d < bd) (bd = d), (best = u);
      }
    }
    return best;
  }

  // Moves it to `u`, with the latch: the click as it comes off the catch, the slam onto it.
  setGrabOpen(G, u) {
    const g = this.game;
    const before = this.grabOpen(G);
    if (u < 0.006 && before >= 0.006) u = 0;
    if (G.kind === 'car') {
      const car = G.car;
      const mp = car.model.parts[G.id];
      car.model.setOpen(G.id, u);
      mp.targetOpen = u;
      if ((before <= 0.08) !== (u <= 0.08)) car.rebuildColliders();
      const snd = G.id.startsWith('door') ? (u > before ? 'doorOpen' : 'doorClose') : G.id === 'hood' ? 'hood' : 'trunk';
      const at = car.worldPointOf(mp.hinge.origin);
      if (before === 0 && u > 0) g.audio && g.audio.play(snd, { at, volume: 0.6 });
      else if (u === 0 && before > 0) g.audio && g.audio.play(snd, { at, volume: Math.min(1, 0.3 + Math.abs(G.v || 0) * 0.5) });
    } else if (G.kind === 'flap') {
      const car = G.car;
      car.fillerHeld = car.fillerT = u;
      car.fillerOpen = u > 0.02;
      // (the flap shuts over the neck only with the cap on it)
      if (u === 0 && car.fillerCapOff) car.fillerCapOff = false;
      const at = car.model.filler.group.getWorldPosition(V(0, 0, 0));
      if ((before === 0) !== (u === 0)) g.audio && g.audio.play('click', { volume: 0.45, rate: u ? 0.7 : 1.1, at });
    } else {
      const d = G.door;
      d.open = d.target = u;
      d.inst.state.doors[d.key] = u;
      g.pois.applyDoor(d);
      const at = d.pivot.getWorldPosition(V(0, 0, 0));
      if (before === 0 && u > 0) g.audio && g.audio.play('doorCreak', { at, volume: 0.5 });
      else if (u === 0 && before > 0) g.audio && g.audio.play('doorShut', { at });
    }
  }

  // Each frame of a hold. Returns false once let go.
  updateGrab(dt, blocked) {
    const g = this.game;
    const G = this.grab;
    const gone = (G.kind === 'car' || G.kind === 'crank') && (!G.car.isInstalled(G.kind === 'car' ? G.id : G.door) || G.car !== g.car);
    if (!input.mouseDown(0) || blocked || gone || g.player.dead || (G.kind === 'crank' && !g.player.seat)) {
      this.letGo(G, gone);
      return false;
    }
    G.time += dt;
    if (G.kind === 'crank') {
      // a winder: moving the mouse down winds the glass down, up winds it up; the ratchet clicks
      const moved = G.car.windWindow(G.door, input.mouse.dy * 0.0022);
      G.click += Math.abs(moved);
      if (G.click > 0.035) {
        G.click = 0;
        g.audio && g.audio.play('click', { volume: 0.12, rate: 1.7 + Math.random() * 0.2 });
      }
      if (moved) this.useAnim = Math.max(this.useAnim, 0.3);
      g.hud && g.hud.setPrompts([['Mouse', 'Wind the window'], ['LMB', 'Let go']]);
      return true;
    }
    // the hand: as far along the view as when it took hold
    const cam = this.cam;
    const target = V(0, 0, -1).applyQuaternion(cam.quaternion).multiplyScalar(G.dist).add(cam.position);
    const want = this.nearestOpen(G, target);
    const u = this.grabOpen(G);
    // pulled along on a stiff spring: it lags a touch behind the hand and keeps the swing it has
    G.v += ((want - u) * 70 - G.v * 13) * dt;
    G.v = clamp(G.v, -5, 5);
    let nu = u + G.v * dt;
    if (nu <= 0 || nu >= 1) {
      nu = clamp(nu, 0, 1);
      G.v = 0;
    }
    this.setGrabOpen(G, nu);
    // walked off or pulled past where it can go: the hand slips off
    const at = this.grabWorld(G, this.grabOpen(G));
    G.point = at;
    if (at.distanceTo(target) > 0.85 || at.distanceTo(cam.position) > REACH + 0.7) {
      this.letGo(G);
      return false;
    }
    g.hud && g.hud.setPrompts([['Mouse', 'Pull or push'], ['LMB', 'Let go']]);
    return true;
  }

  // Let go: a door keeps the swing it had, slowing on its hinges.
  letGo(G, gone = false) {
    this.grab = null;
    this.game.player.lookFrozen = false;
    if (G.kind === 'flap') {
      const car = G.car;
      car.fillerHeld = null;
      // the flap's spring takes it the rest of the way, open or shut
      car.fillerOpen = car.fillerT > 0.35;
      if (!car.fillerOpen) car.fillerCapOff = false;
      return;
    }
    if (!gone && G.kind !== 'crank' && Math.abs(G.v) > 0.05) (this.swinging = this.swinging || []).push({ G, v: G.v });
  }

  updateSwinging(dt) {
    if (!this.swinging || !this.swinging.length) return;
    this.swinging = this.swinging.filter((s) => {
      const G = s.G;
      if (G.kind === 'car' && (!G.car.isInstalled(G.id) || !G.car.root.parent)) return false;
      s.v *= Math.exp(-dt * 2.2);
      const u = this.grabOpen(G) + s.v * dt;
      G.v = s.v;
      this.setGrabOpen(G, clamp(u, 0, 1));
      return u > 0 && u < 1 && Math.abs(s.v) > 0.03;
    });
  }

  // A heavy thing taken hold of where the aim is: dragged by that point while LMB is held.
  pickDrag(it, at) {
    this.pick(it);
    if (!this.dragging) return;
    const p = at || it.mesh.getWorldPosition(V(0, 0, 0));
    it.mesh.updateMatrixWorld(true);
    this.dragLocal = it.mesh.worldToLocal(p.clone());
    this.dragDist = clamp(p.distanceTo(this.cam.position), 0.9, REACH);
    const h = this.lookHit;
    const n = h && h.normal ? V(h.normal.x, h.normal.y, h.normal.z) : this.cam.position.clone().sub(p).normalize();
    this.dragN = n.applyQuaternion(it.mesh.quaternion.clone().invert());
  }

  // Aimed at the cap of a jerry can (within a hand's breadth of it on the can's surface).
  onCap(t) {
    const it = t && t.kind === 'item' && t.item;
    if (!it || !capped(it.def) || !t.point || it.mounted) return false;
    const cap = it.mesh.getObjectByName('cap');
    if (!cap) return false;
    const c = new THREE.Box3().setFromObject(cap).getCenter(V(0, 0, 0));
    return c.distanceTo(V(t.point.x, t.point.y, t.point.z)) < 0.1;
  }

  toggleCap(it) {
    it.state.capOff = !it.state.capOff;
    this.game.audio && this.game.audio.play('click', { volume: 0.4, rate: it.state.capOff ? 1.25 : 0.95, at: it.mesh.getWorldPosition(V(0, 0, 0)) });
    this.game.items.refreshVisual(it);
  }

  heldInfo(it) {
    const def = it.def;
    const s = it.state;
    let sub = '';
    let bar = null;
    if (def.liquid) {
      if (!capped(def) || s.capOff || def.clear) {
        sub = `${(s.liquid || 0).toFixed(1)} / ${def.liquid.cap} l ${LIQUID_NAMES[s.liquidType || def.liquid.type] || s.liquidType}`;
        bar = (s.liquid || 0) / def.liquid.cap;
        if (capped(def) && s.capOff) sub += ' · cap off';
      } else sub = 'Cap on';
    } else if (def.consume) {
      const parts = [];
      if (def.consume.food > 0) parts.push(`food +${def.consume.food}`);
      if (def.consume.water > 0) parts.push(`water +${def.consume.water}`);
      if (def.consume.health > 0) parts.push(`health +${def.consume.health}`);
      sub = parts.join(' · ');
    } else if (def.weapon) sub = `${s.loaded || 0} / ${def.weapon.mag}  ·  pouch ${this.ammo[def.weapon.ammo] || 0}`;
    else if (def.charges !== undefined) sub = `${s.charges} use${s.charges === 1 ? '' : 's'} left`;
    else if (def.ammo) sub = `${def.ammo.count} rounds`;
    else if (def.battery) {
      sub = `Batteries ${Math.round((s.charge ?? 1) * 100)}%`;
      bar = s.charge ?? 1;
    } else if (def.instrument) sub = this.instrumentReading(it);
    return { title: it.name, sub, bar, desc: def.desc };
  }

  // What a compass, a clock or a spirit level says just now.
  instrumentReading(it) {
    const kind = it.def.instrument;
    if (kind === 'clock') {
      const h = ((((this.game.env ? this.game.env.time : 12) + (it.state.offset || 0)) % 12) + 12) % 12;
      const m = Math.floor((h % 1) * 60);
      return `It reads ${Math.floor(h) || 12}:${String(m).padStart(2, '0')}`;
    }
    const q = it.mesh.getWorldQuaternion(new THREE.Quaternion());
    if (kind === 'compass') {
      // held: the way you face; on the car: the way the car points; set down: nothing to go by
      const f = it === this.held ? V(0, 0, -1).applyQuaternion(this.cam.quaternion) : it.mounted ? V(0, 0, 1).applyQuaternion(it.mounted.car.root.quaternion) : null;
      if (!f || f.x * f.x + f.z * f.z < 0.01) return 'The needle swings to north';
      const deg = (THREE.MathUtils.radToDeg(Math.atan2(-f.x, f.z)) + 360) % 360;
      return `Heading ${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]} · ${Math.round(deg)}°`;
    }
    if (kind === 'level') {
      const x = V(1, 0, 0).applyQuaternion(q);
      const off = Math.abs(THREE.MathUtils.radToDeg(Math.asin(clamp(x.y, -1, 1))));
      // stood on end, it reads plumb on the end vial instead
      const tilt = off > 45 ? 90 - off : off;
      return tilt < 0.4 ? 'Dead level' : `Off level by ${tilt.toFixed(1)}°`;
    }
    return '';
  }

  useOptions(it, t) {
    const def = it.def;
    const out = [];
    const car = this.game.car;
    if (def.weapon) {
      out.push(['LMB', 'Fire'], ['R', 'Reload']);
      return out;
    }
    if (def.melee) out.push(['LMB', 'Swing']);
    if (def.raw && this.game.campfires && this.game.campfires.near(this.game.player.position, 2.6)) out.push(['LMB', 'Cook']);
    else if (def.consume) out.push(['LMB', def.consume.smoke ? 'Smoke' : def.consume.food > 0 ? 'Eat' : def.consume.health > 0 ? 'Use' : 'Drink']);
    if (def.campfire) out.push(['LMB', 'Light a fire']);
    if (def.fishing) out.push(['LMB', this.fishing ? 'Strike / reel in' : 'Cast']);
    if (def.wrap) out.push(['LMB', 'Wrap up']);
    if (def.ammo) out.push(['LMB', 'Put in pouch']);
    if (def.readable) out.push(['LMB', 'Read']);
    if (def.disc) out.push(['LMB', t && t.kind === 'hotspot' && t.hotspot.id === 'radio' ? (car.stereo.disc >= 0 ? 'Swap discs' : 'Put in the stereo') : 'Look at the stereo to play']);
    if (def.clean) out.push(['LMB', t && (t.kind === 'part' || t.kind === 'hotspot') ? 'Wash the car (hold)' : 'Look at the car to wash it']);
    if (def.derust) {
      const r = this.rustTarget();
      if (!r) out.push(['', 'Aim at a panel or the body']);
      else if (r.rust <= 0.005) out.push(['', `No rust left on the ${r.label}`]);
      else out.push(['LMB', `Scrub the rust off the ${r.label} (hold)`]);
    }
    if (def.paint) {
      const car = this.game.car;
      if (t && t.kind === 'part' && car && car.paintable(t.part)) out.push(['LMB', `Paint the ${car.PARTS[t.part].label.toLowerCase()} (hold)`]);
      else if (t && t.kind === 'plate') out.push(['LMB', `Paint the ${PLATES[t.plate.id].name.toLowerCase()} (hold)`]);
      else out.push(['', 'Aim at a body panel to paint it']);
    }
    if (def.light) out.push(def.battery && (it.state.charge ?? 1) <= 0.005 ? ['', 'The batteries are flat'] : ['LMB', it.state.on ? 'Switch off' : 'Switch on']);
    if (def.binoculars) out.push(this.binoZoom > 0.5 ? ['Wheel', `Zoom ×${this.binoMag || 4}`] : ['LMB', 'Look through them (hold)']);
    if (def.instrument === 'clock') out.push(['LMB', 'Turn the knob to set it (hold)']);
    if (def.wear) out.push(['LMB', def.wear === 'eyes' ? 'Put them on' : 'Put it on']);
    if (def.liquid) {
      if (capped(def)) out.push([capKey(), it.state.capOff ? 'Screw the cap on' : 'Unscrew the cap']);
      if (!capped(def) || it.state.capOff) {
        const tgt = this.pourTarget(it, t);
        if (tgt) out.push(['LMB', tgt.label + ' (hold)']);
        else if (t && t.kind === 'item' && capped(t.item.def) && !t.item.state.capOff) out.push(['', 'Its cap is on']);
        else if (def.drinkable || it.state.liquidType === 'water') out.push(['LMB', 'Drink (hold)']);
      }
    }
    if (def.charges !== undefined && t && t.kind === 'hotspot') {
      // repair kits on the engine / wheels
    }
    if ((it.id === 'repairKit' || it.id === 'extinguisher') && t && (t.kind === 'part' || t.kind === 'hotspot') && car) out.push(['LMB', it.id === 'repairKit' ? 'Repair engine' : 'Extinguish']);
    if (it.id === 'tyreKit' && t && t.kind === 'part' && t.part.startsWith('wheel')) out.push(['LMB', 'Repair tyre']);
    if (def.tune) {
      const why = this.tuneBlock(it, t);
      out.push(why ? ['', why] : ['LMB', 'Bolt on the twin carbs']);
    }
    if (def.tent) {
      const site = this.tentSite();
      out.push(site.blocked ? ['', site.blocked] : ['LMB', 'Pitch the tent here']);
    }
    if (it.id === 'wrench' && this.carbsTarget(t)) out.push(['LMB', 'Unbolt the twin carbs']);
    return out;
  }

  // Where the held tent would go: a couple of metres ahead, door toward the player.
  tentSite() {
    const g = this.game;
    const p = g.player;
    if (p.seat || p.indoors) return { blocked: 'Pitch it outside' };
    return g.tents.site(p.position, p.yaw);
  }

  // Engine bay targets: the engine and what sits on it, with the lid open.
  engineBay(t) {
    const car = this.game.car;
    if (!car || !t) return false;
    if (t.kind === 'part') return ['engine', 'airfilter', 'fanbelt', 'alternator', 'waterpump', 'starter', 'sparkplugs', 'oilfilter'].includes(t.part);
    return t.kind === 'hotspot' && t.hotspot.id === 'oil';
  }

  // Why a tuning kit cannot go on (null when it can).
  tuneBlock(it, t) {
    const car = this.game.car;
    if (!this.engineBay(t)) return 'Look at the engine to fit it';
    if (!car.isInstalled('engine')) return 'There is no engine';
    if (!car.lidOpen('hood')) return `Open the ${car.type.lids.hood} first`;
    if (car.parts.engine.tune === it.def.tune.tune) return 'This engine already has them';
    return null;
  }

  carbsTarget(t) {
    const car = this.game.car;
    return this.engineBay(t) && car.isInstalled('engine') && car.parts.engine.tune === 'twin' && car.lidOpen('hood');
  }

  pourTarget(it, t) {
    const type = it.state.liquidType;
    // siphon: a can (empty or holding fuel) against another car draws fuel out of its tank
    const h = this.lookHit;
    const other = h && h.owner && h.owner.kind === 'car' && h.owner.car !== this.game.car ? h.owner.car : null;
    if (other && it.def.liquid.cap >= 5 && ((it.state.liquid || 0) < 0.01 || type === other.tankMain()) && h.distance < REACH + 0.4) {
      if (other.fuel > 0.05 && other.isInstalled('fueltank')) return { kind: 'siphon', car: other, label: `Siphon fuel · ${other.fuel.toFixed(1)} L in the tank` };
      return null;
    }
    if (!t) return null;
    const car = this.game.car;
    if (t.kind === 'hotspot') {
      const h = t.hotspot.id;
      // (anything runny goes down a filler; only the right fuel does the engine any good)
      if ((type === 'fuel' || type === 'diesel' || type === 'water') && h === 'fuel' && car.isInstalled('fueltank') && car.fillerCapOff) return { kind: 'car', sys: 'fuel', label: type === 'fuel' ? 'Pour petrol' : type === 'diesel' ? 'Pour diesel' : 'Pour water into the tank' };
      if (type === 'oil' && h === 'oil') return { kind: 'car', sys: 'oil', label: 'Pour oil' };
      if (type === 'water' && h === 'coolant' && car.isInstalled('radiator')) return { kind: 'car', sys: 'coolant', label: 'Top up the radiator' };
    }
    const pk = t.kind === 'pump' && (t.pump.pump.kind || 'fuel');
    if (pk && (type === pk || (it.state.liquid || 0) < 0.01) && it.def.liquid.type === 'fuel') return pumpFuel(t.pump.pump) > 0.05 ? { kind: 'pump', label: t.pump.pump.drum ? 'Fill from the drum' : pk === 'diesel' ? 'Fill from the diesel pump' : 'Fill from the petrol pump' } : null;
    if (t.kind === 'item' && t.item.def && t.item.def.liquid && t.item.state.liquidType === type && (!capped(t.item.def) || t.item.state.capOff)) return { kind: 'item', item: t.item, label: 'Pour into ' + t.item.def.name.toLowerCase() };
    return null;
  }

  describeTarget(t) {
    const car = this.game.car;
    const prompts = [];
    let info = null;
    switch (t.kind) {
      case 'item': {
        const it = t.item;
        if (this.onCap(t)) {
          info = this.heldInfo(it);
          prompts.push(['E', it.state.capOff ? 'Screw the cap on' : 'Unscrew the cap']);
          break;
        }
        if (it.mounted) {
          const host = it.mounted.car;
          let sub = it.mounted.hang ? 'Hanging from the mirror' : `Bolted to the ${this.boltPlace(host, it.mounted.part, V(0, 1, 0).applyQuaternion(it.mesh.getWorldQuaternion(new THREE.Quaternion())))}`;
          if (it.def && it.def.instrument) sub = this.instrumentReading(it);
          info = { title: it.name, sub, progress: this.removing && this.removing.item === it ? this.removing.t : undefined };
          prompts.push(['R', it.mounted.hang ? 'Take it down (hold)' : 'Unbolt (hold)']);
          break;
        }
        if (it.part) {
          info = { title: it.name, sub: `${carType(it.state.carType).short} part · ${partDefOf(it).mass} kg` };
        } else info = this.heldInfo(it);
        if (heavyItem(it)) prompts.push(['LMB', 'Drag it (hold)']);
        else prompts.push(['E', 'Pick up']);
        if (it.def && fitsInBag(it.id, it.state)) prompts.push([(settings.data.bindings.stow || 'KeyQ').replace(/^Key/, ''), 'To backpack']);
        if (it.def && it.def.consume) prompts.push(['F', 'Use now']);
        if (it.def && it.def.readable) prompts.push(['F', 'Read']);
        break;
      }
      case 'tent': {
        info = { title: 'Tent', sub: 'Out of the wind and the rain. Sleep the night through', progress: this.removing && this.removing.tent === t.tent ? this.removing.t / 1.6 : undefined };
        prompts.push(['E', 'Crawl in'], ['R', 'Pack it up (hold)']);
        break;
      }
      case 'bed': {
        info = { title: 'Bed', sub: 'Sleeps best of all, and warm' };
        prompts.push(['E', 'Lie down']);
        break;
      }
      case 'jack': {
        const j = t.jack;
        const up = j.h - JACK_LOW;
        info = { title: 'Scissor jack', sub: up > 0.01 ? `Raised ${Math.round(up * 100)} cm` : 'Down', bar: up / (JACK_MAX - JACK_LOW) };
        if (j.h < JACK_MAX - 0.005) prompts.push(['LMB', 'Crank up (hold)']);
        if (up > 0.005) prompts.push(['RMB', 'Lower (hold)']);
        if (up < 0.01) prompts.push(['E', 'Pick it up']);
        break;
      }
      case 'trailer': {
        const tr = t.trailer;
        const near = !tr.hitch && tr.hitchableCar();
        info = { title: 'Utility trailer', sub: tr.hitch ? 'Hitched' : near ? 'The coupler is over the tow ball' : 'Unhitched · 260 kg' };
        if (tr.hitch) prompts.push(['E', 'Unhitch']);
        else if (near) prompts.push(['E', 'Hitch to the car']);
        else prompts.push(['E', 'Pull by the drawbar (hold)']);
        break;
      }
      case 'part': {
        const id = t.part;
        const st = car.parts[id];
        const def = car.PARTS[id];
        const cond = st ? Math.round(st.condition * 100) : 100;
        info = { title: car.partLabel(id), sub: `Condition ${cond}%`, bar: st ? st.condition : 1 };
        void def;
        const mp = car.model.parts[id];
        if (mp.hinge) prompts.push(['LMB', mp.openT > 0.5 ? 'Close (hold and drag)' : 'Open (hold and drag)']);
        const rem = car.canRemove(id);
        if (rem.ok) prompts.push(['R', 'Remove (hold)']);
        else if (!mp.hinge) prompts.push(['', rem.reason]);
        if (this.removing && this.removing.part === id) info.progress = this.removing.t / this.removeTime(id);
        if (this.spraying && this.spraying.part === id && this.spraying.need) info.progress = this.spraying.t / this.spraying.need;
        if (car.partColors && car.partColors[id]) info.sub += ' · repainted';
        if (id === 'engine') info.sub = `Condition ${Math.round(car.engineCondition * 100)}% · ${Math.round(car.engineTemp)}°C`;
        if (id === 'battery') info.sub = `Charge ${Math.round(car.battery * 100)}%`;
        if (id === 'fanbelt') info.sub = `Condition ${Math.round(car.fanbeltCondition * 100)}%${car.fanbeltCondition < 0.25 ? ' · cracked, replace soon' : ''}`;
        if (id === 'fueltank') info.sub = `${car.fuel.toFixed(1)} / ${car.fuelCap} l`;
        if (id === 'radiator') info.sub = `Condition ${cond}% · coolant ${car.coolant.toFixed(1)} / ${car.coolantCap} l`;
        const worn = { sparkplugs: [0.3, 'fouled, misfiring'], oilfilter: [0.25, 'clogged'], waterpump: [0.3, 'weeping coolant'], starter: [0.3, 'cranks slowly'], alternator: [0.25, 'charges weakly'] }[id];
        if (worn) info.sub = `Condition ${cond}%${cond / 100 < worn[0] ? ' · ' + worn[1] : ''}${id === 'alternator' && car.dyn.engine.running ? (car.charging ? ' · charging' : ' · not charging') : ''}`;
        if (id.startsWith('wheel')) {
          const w = car.dyn.wheels.find((x) => x.id === id);
          info.sub = `Tyre ${cond}%${w && w.flat ? ' · flat' : ''}`;
        }
        break;
      }
      case 'hotspot': {
        const h = t.hotspot;
        info = { title: h.label };
        if (h.id === 'fuel') {
          // the level shows once the cap is off and you can look in
          // (the flap by hand, LMB held; with a can in the hand the other hand works it with E)
          const byHand = car.model.filler && !this.held;
          if (!car.fillerOpen) {
            info.sub = 'Flap shut';
            prompts.push(byHand ? ['LMB', 'Open the flap (hold and drag)'] : ['E', 'Open the flap']);
          } else if (!car.fillerCapOff) {
            info.sub = 'Cap on';
            prompts.push(['E', 'Unscrew the cap']);
            if (byHand) prompts.push(['LMB', 'Shut the flap (hold and drag)']);
          } else {
            info.sub = `${car.fuel.toFixed(1)} / ${car.fuelCap} l`;
            info.bar = car.fuel / car.fuelCap;
            prompts.push(['E', byHand ? 'Screw the cap on' : 'Cap on, flap shut']);
            // what it takes, and what it smells of in there
            prompts.push(['', car.fuelType === 'diesel' ? 'Takes diesel' : 'Takes petrol']);
            if (car.fuelPurity() < 0.97) prompts.push(['', car.tankMain() === car.fuelType ? 'Something else is mixed in' : 'The wrong fuel is in it']);
          }
        } else if (h.id === 'oil') {
          info.sub = `${car.oil.toFixed(2)} / ${car.oilCap} l`;
          info.bar = car.oil / car.oilCap;
        } else if (h.id === 'coolant') {
          info.sub = `${car.coolant.toFixed(1)} / ${car.coolantCap} l · ${Math.round(car.engineTemp)}°C`;
          info.bar = car.coolant / car.coolantCap;
        } else if (h.id === 'battery') {
          info.sub = `Charge ${Math.round(car.battery * 100)}%`;
          info.bar = car.battery;
        } else if (h.id === 'ignition') {
          const running = car.dyn.engine.running;
          info.sub = running ? 'Engine running' : car.cranking > 0 ? 'Cranking' : car.ignition ? 'On' : 'Off';
          if (running) prompts.push(['E', 'Switch off']);
          else if (car.ignition) prompts.push(['E', 'Hold to start'], ['', 'tap to switch off']);
          else prompts.push(['E', 'Turn the key', 'hold to start']);
        } else if (h.id === 'indicator') {
          info.sub = car.indicator < 0 ? 'Left' : car.indicator > 0 ? 'Right' : '';
          prompts.push(['E', car.indicator < 0 ? 'Cancel' : 'Signal left'], ['LMB', car.indicator > 0 ? 'Cancel' : 'Signal right']);
        } else if (h.id === 'handbrake') {
          info.sub = car.parkBrake ? 'Set' : 'Off';
          prompts.push(['E', car.parkBrake ? 'Release' : 'Set it']);
        } else if (h.id === 'doorFL' || h.id === 'doorFR') {
          const open = car.model.parts[h.door].openT > 0.5;
          prompts.push(['LMB', open ? 'Close the door (hold and drag)' : 'Open the door (hold and drag)']);
        } else if (h.id.startsWith('crank')) {
          const t = car.windowT[h.door] || 0;
          info.sub = t < 0.03 ? 'Shut' : t > 0.97 ? 'All the way down' : `Open ${Math.round(t * 100)}%`;
          prompts.push(['LMB', 'Wind it (hold, move the mouse)']);
        } else if (h.id === 'windowFL' || h.id === 'windowFR') {
          const door = h.id === 'windowFL' ? 'door_FL' : 'door_FR';
          info.sub = h.id === 'windowFL' ? 'Driver' : 'Passenger';
          prompts.push(['E', (car.windowT[door] || 0) > 0.5 ? 'Wind it up (hold)' : 'Wind it down (hold)']);
        } else if (h.id === 'lights') {
          info.sub = ['Off', 'Low beam', 'High beam'][car.lightsOn];
          prompts.push(['E', ['Low beam', 'High beam', 'Off'][car.lightsOn]]);
        } else if (h.id === 'wipers') {
          info.sub = ['', 'Intermittent', 'Steady', 'Fast'][car.wipers];
          prompts.push(['E', ['Intermittent', 'Steady', 'Fast', 'Off'][car.wipers]]);
        } else if (h.id === 'hazard') {
          info.sub = car.hazards ? 'Blinking' : '';
          prompts.push(['E', car.hazards ? 'Off' : 'On']);
        } else if (h.id === 'heater') {
          info.sub = !car.heater ? '' : car.dyn.engine.running && car.engineTemp > 55 ? 'Blowing warm' : 'Cold until the engine warms up';
          prompts.push(['E', car.heater ? 'Off' : 'On']);
        } else if (h.id === 'dome') {
          info.sub = car.cabinLight ? 'On' : '';
          prompts.push(['E', car.cabinLight ? 'Off' : 'On']);
        } else if (h.id === 'radio') {
          const st = car.stereo;
          info.title = 'Stereo';
          const stn = STATIONS[st.station ?? 1];
          info.sub = !car.radioOn ? '' : st.mode === 'cd' && st.disc >= 0 ? `CD · ${ALBUMS[st.disc].artist} — ${ALBUMS[st.disc].tracks[trackOn(st.disc, st.track)]}` : `${stn.freq} ${stn.name}` + (st.disc >= 0 ? ' · disc in' : '');
          prompts.push(['E', car.radioOn ? 'Turn off' : 'Turn on']);
          if (car.radioOn) prompts.push(['LMB', st.mode === 'cd' && st.disc >= 0 ? 'Next track' : 'Next station']);
          if (st.disc >= 0) prompts.push(['F', st.mode === 'cd' ? 'Radio' : 'Play the CD'], ['R', 'Eject disc']);
        }
        break;
      }
      case 'plate': {
        const pl = t.plate;
        const d = PLATES[pl.id];
        const host = pl.car || car;
        info = { title: d.name, sub: pl.world ? `${d.mass} kg · bolted in place` : `${d.mass} kg · bolted to the ${(host.PARTS[pl.part] || { label: pl.part }).label.toLowerCase()}${host !== car ? ' of another car' : ''}` };
        prompts.push(['R', 'Unbolt (hold)']);
        if (this.removing && this.removing.plate === pl) info.progress = this.removing.t / 1.2;
        if (this.spraying && this.spraying.key === pl && this.spraying.need) info.progress = this.spraying.t / this.spraying.need;
        if (pl.state.color !== undefined) info.sub += ' · painted';
        break;
      }
      case 'accessory': {
        const a = car.accessories[t.mount];
        const def = ACCESSORIES[a.id];
        info = { title: def.label, sub: `${def.mass} kg on the ${MOUNT_LABEL[t.mount]}` };
        if (def.storage && car.storage.roofbox) {
          info.sub += ` · ${Math.round(car.storage.roofbox.weight())} / ${def.storage.capacity} kg inside`;
          prompts.push(['E', 'Open']);
        }
        if (def.cargo) {
          const n = car.attached.filter((x) => x.stowed && x.stowed.zone === t.mount).length;
          if (n) info.sub += ` · ${n} strapped on`;
          else prompts.push(['', 'Drop things on it to strap them down']);
        }
        if (def.winch) {
          const W = this.game.winches;
          const c = W.cable && W.cable.car === car ? W.cable : null;
          if (!c) prompts.push(['E', 'Pull out the winch cable']);
          else {
            info.sub = c.anchor ? `Cable hooked · ${Math.round(c.length)} m out${c.tension > 1000 ? ` · ${Math.round(c.tension / 1000)} kN` : ''}` : 'Cable out';
            if (c.anchor) prompts.push(['LMB', 'Wind in (hold)'], ['E', 'Unhook and wind the cable back']);
          }
        }
        const rem = canRemoveAccessory(car, t.mount);
        if (rem.ok) prompts.push(['R', 'Take off (hold)']);
        else prompts.push(['', rem.reason]);
        if (this.removing && this.removing.acc === t.mount) info.progress = this.removing.t / 1.6;
        break;
      }
      case 'seat':
        info = { title: { driver: 'Driver seat', passenger: 'Passenger seat', rearL: 'Rear seat', rearR: 'Rear seat' }[t.seat] };
        prompts.push(['E', 'Sit']);
        break;
      case 'poiDoor':
        info = { title: 'Door' };
        prompts.push(['LMB', t.door.open > 0.5 ? 'Close (hold and drag)' : 'Open (hold and drag)']);
        break;
      case 'pump': {
        const st = t.pump.inst.state;
        if (t.pump.pump.drum) {
          const f = pumpFuel(t.pump.pump);
          info = { title: 'Oil drum', sub: f > 0.5 ? (t.pump.pump.kind === 'diesel' ? `About ${Math.round(f)} l of old diesel sloshing inside` : `About ${Math.round(f)} l of old petrol sloshing inside`) : 'Empty, rust flakes inside', bar: Math.min(1, f / 200) };
          const held = this.held && this.held.def && this.held.def.liquid;
          if (f > 0.5 && !held) prompts.push(['', 'Bring a jerry can to fill']);
          break;
        }
        info = { title: t.pump.pump.kind === 'diesel' ? 'Diesel pump' : 'Petrol pump', sub: st.fuel > 0.5 ? `${Math.round(st.fuel)} l left in the tank` : 'Dry', bar: Math.min(1, (st.fuel || 0) / 300) };
        const carNear = car && car.worldPointOf(car.type.HOTSPOTS[0].pos).distanceTo(t.pump.world) < 5.5;
        if (st.fuel > 0.5 && carNear) prompts.push(['E', this.game.refuel && this.game.refuel.active ? 'Stop refuelling' : 'Refuel the car']);
        else if (st.fuel > 0.5) prompts.push(['', 'Bring the car closer or use a jerry can']);
        break;
      }
      case 'npc':
        info = { title: t.npc.displayName || 'Stranger', sub: t.npc.dead ? 'Dead' : '' };
        if (t.npc.dead && t.npc.lootable) prompts.push(['E', 'Search']);
        break;
    }
    return { info, prompts };
  }

  removeTime(id) {
    const m = this.game.car.PARTS[id].mass;
    return 0.6 + Math.min(3, m / 25);
  }

  handleTargetInput(t, dt) {
    const g = this.game;
    const car = g.car;
    // something bolted to the car: R held undoes the bolts and it comes off into the hands
    if (t.kind === 'item' && t.item.mounted) {
      if (!input.isDown('reload')) return;
      if (!this.removing || this.removing.item !== t.item) this.removing = { item: t.item, t: 0 };
      this.removing.t += dt;
      if (Math.floor((this.removing.t - dt) / 0.3) !== Math.floor(this.removing.t / 0.3)) g.audio && g.audio.play('ratchet');
      if (this.removing.t >= 1) {
        this.removing = null;
        g.audio && g.audio.play('remove', { at: t.item.mesh.getWorldPosition(V(0, 0, 0)) });
        this.pick(t.item);
      }
      return;
    }
    if (t.kind === 'part' && input.isDown('reload')) {
      const id = t.part;
      if (car.canRemove(id).ok) {
        if (!this.removing || this.removing.part !== id) this.removing = { part: id, t: 0 };
        this.removing.t += dt;
        if (Math.floor((this.removing.t - dt) / 0.45) !== Math.floor(this.removing.t / 0.45)) g.audio && g.audio.play('ratchet');
        if (this.removing.t >= this.removeTime(id)) {
          this.remove(id);
          this.removing = null;
        }
      }
      return;
    }
    if (t.kind === 'tent' && input.isDown('reload')) {
      if (!this.removing || this.removing.tent !== t.tent) this.removing = { tent: t.tent, t: 0 };
      this.removing.t += dt;
      if (Math.floor((this.removing.t - dt) / 0.4) !== Math.floor(this.removing.t / 0.4)) g.audio && g.audio.play('pocket', { at: t.tent.pos });
      if (this.removing.t >= 1.6) {
        const pos = t.tent.pos.clone().add(V(0, 0.3, 0));
        g.tents.strike(t.tent);
        this.removing = null;
        const it = g.items.spawn('tent', pos, new THREE.Quaternion(), { variant: t.tent.variant });
        it.poiKey = null;
        if (!this.held) this.pick(it);
      }
      return;
    }
    if (t.kind === 'tent' && input.wasPressed('interact') && !this.held) return g.player.lieDown(g.tents.berth(t.tent));
    if (t.kind === 'bed' && input.wasPressed('interact') && !this.held) {
      const pl = g.player;
      return pl.lieDown({ kind: 'bed', eye: t.bed.world.clone().add(V(0, 0.06, 0)), yaw: pl.yaw, exit: pl.position });
    }
    if (t.kind === 'plate' && input.isDown('reload')) {
      if (!this.removing || this.removing.plate !== t.plate) this.removing = { plate: t.plate, t: 0 };
      this.removing.t += dt;
      if (Math.floor((this.removing.t - dt) / 0.3) !== Math.floor(this.removing.t / 0.3)) g.audio && g.audio.play('ratchet');
      if (this.removing.t >= 1.2) {
        this.unboltPlate(t.plate);
        this.removing = null;
      }
      return;
    }
    if (t.kind === 'accessory' && input.isDown('reload')) {
      if (canRemoveAccessory(car, t.mount).ok) {
        if (!this.removing || this.removing.acc !== t.mount) this.removing = { acc: t.mount, t: 0 };
        this.removing.t += dt;
        if (Math.floor((this.removing.t - dt) / 0.45) !== Math.floor(this.removing.t / 0.45)) g.audio && g.audio.play('ratchet');
        if (this.removing.t >= 1.6) {
          this.takeOffAccessory(t.mount);
          this.removing = null;
        }
      }
      return;
    }
    if (!input.isDown('reload')) this.removing = null;
    if (t.kind === 'jack') {
      const j = t.jack;
      if (input.mouseDown(0)) g.jacks.crank(j, 1, dt);
      else if (input.mouseDown(2)) g.jacks.crank(j, -1, dt);
      else if (input.wasPressed('interact') && j.h - JACK_LOW < 0.01) {
        const pos = j.base.clone().add(V(0, 0.1, 0));
        g.jacks.remove(j);
        const it = g.items.spawn('jack', pos);
        it.poiKey = null;
        this.pick(it);
      }
      return;
    }
    if (t.kind === 'accessory' && car.accessories[t.mount] && ACCESSORIES[car.accessories[t.mount].id].winch && !input.isDown('reload')) {
      const W = g.winches;
      const c = W.cable && W.cable.car === car ? W.cable : null;
      if (input.wasPressed('interact')) {
        if (!c && !this.held) W.takeHook(car);
        else if (c) W.release();
        return;
      }
      if (c && c.anchor && input.mouseDown(0)) this.reelFromDrum = true;
    }
    if (t.kind === 'trailer') {
      const tr = t.trailer;
      if (input.wasPressed('interact')) {
        if (tr.hitch) tr.unhitch();
        else {
          const c = tr.hitchableCar();
          if (c) tr.hitchTo(c);
          else this.pullingTrailer = tr;
        }
      }
      return;
    }
    // LMB on the stalk: the other way (up, right)
    if (t.kind === 'hotspot' && t.hotspot.id === 'indicator' && input.mousePressed(0)) {
      car.indicator = car.indicator > 0 ? 0 : 1;
      this.driverReach(t.hotspot);
      g.audio && g.audio.play('click', { volume: 0.35, rate: 0.85 });
      return;
    }
    if (t.kind === 'hotspot' && t.hotspot.id === 'radio') {
      const st = car.stereo;
      if (input.mousePressed(0) && car.radioOn) {
        if (st.mode === 'cd' && st.disc >= 0) car.nextTrack();
        else car.nextStation();
        g.audio && g.audio.play('click');
        return;
      }
      if (input.pressed.has('KeyF') && st.disc >= 0) {
        if (st.mode === 'cd') st.mode = 'radio';
        else st.mode = 'cd';
        car.radioOn = true;
        g.audio && g.audio.play('click');
        return;
      }
      if (input.wasPressed('reload') && st.disc >= 0) {
        this.ejectDisc();
        return;
      }
    }
    if (input.pressed.has('KeyF') && t.kind === 'item' && t.item.def && t.item.def.readable) {
      const n = this.game.story && this.game.story.noteById(t.item.state.note);
      if (n) {
        this.game.story.collect(n.id);
        this.game.ui && this.game.ui.showNote(n);
      }
      return;
    }
    if (input.pressed.has('KeyF') && t.kind === 'item' && t.item.def && t.item.def.consume) {
      this.pick(t.item);
      this.useHeld();
      return;
    }
    if (!input.wasPressed('interact') && !(input.mousePressed(0) && !this.fists)) return;
    const viaMouse = !input.wasPressed('interact');
    // doors, lids, the fuel flap, winders and heavy things are taken hold of with LMB held and
    // moved by hand (updateGrab); E does not swing them. On the filler E works the cap.
    const gd = this.grabbable(t);
    if (gd) {
      if (viaMouse) return this.startGrab(gd, t);
      if (gd.kind === 'flap' && car.fillerOpen) car.useCap();
      else if (gd.kind === 'heavy') g.hud && g.hud.toast('Too heavy to lift: hold LMB on it and drag it');
      return;
    }
    switch (t.kind) {
      case 'item':
        if (!viaMouse && this.onCap(t)) this.toggleCap(t.item);
        else if (!t.item.mounted) this.pick(t.item);
        break;
      case 'part':
        break;
      case 'hotspot': {
        if (viaMouse) return;
        this.useHotspot(t.hotspot);
        break;
      }
      case 'accessory': {
        if (viaMouse) return;
        if (car.storage.roofbox && t.mount === 'roof') g.ui && g.ui.inventory.show('roofbox');
        break;
      }
      case 'seat': {
        if (viaMouse) return;
        g.player.enterSeat(car, t.seat);
        g.audio && g.audio.play('seat');
        const door = car.type.SEATS[t.seat].door;
        if (car.isInstalled(door) && car.model.parts[door].openT > 0.5) setTimeout(() => car.toggleOpen(door), 350);
        break;
      }
      case 'poiDoor':
        break;
      case 'pump': {
        if (viaMouse || t.pump.pump.drum) return;
        if (g.refuel && g.refuel.active) g.refuel.active = false;
        else if (car.worldPointOf(car.type.HOTSPOTS[0].pos).distanceTo(t.pump.world) < 5.5 && t.pump.inst.state.fuel > 0.5) g.refuel = { active: true, pump: t.pump };
        break;
      }
      case 'npc':
        if (!viaMouse && t.npc.dead && t.npc.lootable) g.npcs && g.npcs.lootCorpse(t.npc);
        break;
    }
  }

  // ------------------------------------------------------------------ pick / drop
  pick(it) {
    const g = this.game;
    this.fists = false;
    // heavy parts (engine, body shell) are dragged along the ground rather than carried
    this.dragging = heavyItem(it);
    if (this.dragging) {
      // (taken by the middle unless pickDrag says where)
      this.dragN = null;
      this.dragLocal = V(0, 0, 0);
      this.dragDist = 1.4;
    }
    g.items.take(it);
    this.held = it;
    this.floating = false;
    // keep the current orientation relative to the camera so the item doesn't snap
    const camQ = this.cam.quaternion.clone();
    this.holdRot.copy(camQ.clone().invert().multiply(it.mesh.quaternion));
    if (it.def) this.holdRot.identity();
    this.userRotated = false;
    this.hangAng = 0;
    this.hangVel = 0;
    // big things are carried close, within arm's reach, whatever their length
    this.holdDist = carriedBig(it) ? 0.6 + Math.min(1, Math.max(it.size.x, it.size.y, it.size.z)) * 0.06 : 0.75;
    this.holdLerp = 0;
    g.player.carryMass = it.mass;
    g.audio && g.audio.play('pickup', { mass: it.mass });
    this.removing = null;
  }

  drop(throwSpeed = 0) {
    const it = this.held;
    if (!it) return;
    const g = this.game;
    const pos = it.mesh.position.clone();
    const q = it.mesh.quaternion.clone();
    // never release inside geometry: back off toward the eye until free
    const eye = this.cam.position.clone();
    const dir = pos.clone().sub(eye);
    const len = dir.length();
    dir.normalize();
    const hit = g.physics.raycast(eye, dir, len + 0.05, GROUPS.ground, g.player.body);
    if (hit) pos.copy(eye).addScaledVector(dir, Math.max(0.2, hit.distance - Math.max(it.size.x, it.size.z) * 0.5));
    const vel = V(0, 0, -1).applyQuaternion(this.cam.quaternion).multiplyScalar(throwSpeed / Math.max(1, Math.sqrt(it.mass)));
    if (g.player.seat) vel.add(g.car.dyn.lastLinvel);
    else vel.add(g.player.velocity);
    g.items.release(it, pos, q, vel);
    this.held = null;
    this.dragging = false;
    g.player.carryMass = 0;
    this.stowWatch.set(it, 0);
    if (throwSpeed > 0) g.audio && g.audio.play('throw');
  }

  // ------------------------------------------------------------------ inventory
  // Puts the item in the hands into a container (the backpack by default), into slot `prefer`
  // when given and free, else where it came from, else the best free slot.
  stowHeld(container = this.game.inventory, prefer = -1) {
    const g = this.game;
    const it = this.held;
    const inv = g.inventory;
    if (!it || it.part) return false;
    const e = { id: it.id, state: it.state };
    if (!container.accepts(e)) {
      g.hud && g.hud.toast(`${it.name} is too bulky for the ${container.title.toLowerCase()}`);
      return false;
    }
    let slot;
    if (prefer >= 0 && !container.slots[prefer]) slot = container.add(e, prefer);
    else if (container === inv && inv.heldFrom >= 0 && !inv.slots[inv.heldFrom]) slot = inv.add(e, inv.heldFrom);
    else slot = container === inv ? inv.addSmart(e) : container.add(e);
    if (slot < 0) {
      g.hud && g.hud.toast(`No room in the ${container.title.toLowerCase()}`);
      return false;
    }
    it.mesh.parent && it.mesh.parent.remove(it.mesh);
    g.items.items.delete(it);
    this.held = null;
    this.dragging = false;
    inv.heldFrom = -1;
    g.player.carryMass = 0;
    g.audio && g.audio.play('pocket');
    return true;
  }

  // Takes slot i of a container into the hands (whatever was in them goes into that slot).
  equipFrom(container, i) {
    const g = this.game;
    this.fists = false;
    const inv = g.inventory;
    const e = container.slots[i];
    if (!e) return false;
    const entry = container.take(i);
    // what was in the hands goes back where it came from, else where this came from, else the pack
    const back = this.held && inv.heldFrom >= 0 && !inv.slots[inv.heldFrom];
    if (this.held && !(back && this.stowHeld(inv, inv.heldFrom)) && !this.stowHeld(container, i) && !(container !== inv && this.stowHeld(inv))) {
      container.add(entry, i);
      return false;
    }
    const it = g.items.spawn(entry.id, this.cam.position.clone().add(V(0, -0.35, 0)), new THREE.Quaternion(), entry.state);
    this.pick(it);
    inv.heldFrom = container === inv ? i : -1;
    return true;
  }

  // 1: fists. 2-7: take that hotbar slot in hand; the same key again puts it back.
  hotbarKeys() {
    const inv = this.game.inventory;
    // 1: fists, always there (whatever is in the hand goes back to its slot first)
    if (input.pressed.has('Digit1')) {
      if (this.held && !this.held.part) this.stowHeld(inv);
      if (!this.held) this.fists = !this.fists || this.punch.t < 1;
      this.game.hud && this.game.hud.pulseHotbar();
    }
    // 2..7: the hotbar slots
    for (let i = 0; i < HOTBAR; i++) {
      if (!input.pressed.has('Digit' + (i + 2))) continue;
      this.fists = false;
      if (this.held && inv.heldFrom === i) this.stowHeld(inv, i);
      else if (inv.slots[i]) this.equipFrom(inv, i);
      else if (this.held && !this.held.part) this.stowHeld(inv, i);
      this.game.hud && this.game.hud.pulseHotbar();
    }
  }

  // Swaps the disc in the hand with the one in the stereo.
  ejectDiscSwap(it) {
    const car = this.game.car;
    const old = car.ejectDisc();
    car.insertDisc(it.state.variant || 0);
    it.state.variant = old;
    this.game.items.refreshVisual(it);
    // the mesh shows the old album now
    const mesh = this.game.items.buildMesh('cd', it.state);
    it.mesh.clear();
    for (const ch of [...mesh.children]) it.mesh.add(ch);
  }

  // Takes the disc out of the car stereo: into the hands if they are free, else the backpack.
  ejectDisc() {
    const g = this.game;
    const a = g.car.ejectDisc();
    if (a < 0) return;
    g.audio && g.audio.play('click');
    const e = { id: 'cd', state: { variant: a } };
    if (!this.held) {
      const it = g.items.spawn('cd', this.cam.position.clone().add(V(0, -0.3, 0)), new THREE.Quaternion(), e.state);
      this.pick(it);
    } else if (g.inventory.addSmart(e) < 0) this.dropEntry(e);
    else g.hud && g.hud.toast('CD → backpack');
  }

  // Picks a world item straight into the backpack.
  lootToBag(it) {
    const g = this.game;
    const inv = g.inventory;
    const e = { id: it.id, state: it.state };
    if (!fitsInBag(it.id, it.state)) return g.hud && g.hud.toast(`${it.name} is too bulky for the backpack`);
    if (inv.addSmart(e) < 0) return g.hud && g.hud.toast('No room in the backpack');
    g.items.take(it);
    g.items.destroy(it);
    g.audio && g.audio.play('pickup', { mass: it.mass });
    g.hud && g.hud.toast(`${it.name} → backpack`);
    g.hud && g.hud.pulseHotbar();
  }

  // Puts an inventory entry down on the ground in front of the player.
  dropEntry(e) {
    const g = this.game;
    const eye = this.cam.position;
    const fwd = V(0, 0, -1).applyQuaternion(this.cam.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const at = eye.clone().addScaledVector(fwd, 0.55);
    const hit = g.physics.raycast(eye, at.clone().sub(eye).normalize(), 0.6, GROUPS.ground, g.player.body);
    if (hit) at.copy(eye).addScaledVector(at.clone().sub(eye).normalize(), Math.max(0.15, hit.distance - 0.15));
    at.y -= 0.4;
    const it = g.items.spawn(e.id, at, new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.random() * 6.28), e.state);
    this.stowWatch.set(it, 0);
    return it;
  }

  // ------------------------------------------------------------------ held item placement
  updateHeld(dt) {
    const it = this.held;
    const cam = this.cam;
    const def = it.def;
    // rotation with RMB (not for weapons: RMB aims)
    const weapon = def && def.weapon;
    this.rotating = !weapon && input.mouseDown(2);
    if (this.rotating) {
      const qx = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), input.mouse.dx * 0.008);
      const qy = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), input.mouse.dy * 0.008);
      this.holdRot.premultiply(qx).premultiply(qy);
    }
    if (input.mouse.wheel && this.boltAim && input.isDown('sprint')) this.boltSpin = (this.boltSpin || 0) + Math.sign(input.mouse.wheel) * (Math.PI / 8);
    else if (input.mouse.wheel && def && def.plate && this.plateAim) {
      // the wheel turns the sheet on the surface; with Shift it tilts it up off it (0..90 deg)
      if (input.isDown('sprint')) this.plateTilt = clamp((this.plateTilt || 0) + Math.sign(input.mouse.wheel) * (Math.PI / 24), 0, Math.PI / 2);
      else this.plateSpin = (this.plateSpin || 0) + Math.sign(input.mouse.wheel) * (Math.PI / 12);
    }
    else if (input.mouse.wheel && !weapon && !(def && def.binoculars && input.mouseDown(0))) {
      const isBig = carriedBig(it);
      if (!isBig && !this.floating) {
        // the wheel takes a small thing out of the hand: it floats in front to be turned and moved
        this.floating = true;
        this.holdDist = 0.5;
        this.holdRot.copy(this.cam.quaternion.clone().invert().multiply(it.mesh.quaternion));
      }
      // a small thing goes no further than the hand reaches, so the hand stays on it
      this.holdDist = clamp(this.holdDist - input.mouse.wheel * 0.08, isBig ? 0.42 : 0.38, it.part ? 3 : isBig ? 1.6 : FLOAT_REACH);
      // pulled all the way back in: into the hand again
      if (!isBig && this.holdDist < 0.42) this.floating = false;
    }
    this.aim = lerp(this.aim, weapon && input.mouseDown(2) ? 1 : 0, Math.min(1, dt * 10));
    if (this.dragging) return this.updateDrag(it, dt);
    // camera-space target
    let local, localQ;
    const big = carriedBig(it);
    // look sway: the item lags a little behind fast turns
    const lookDx = input.mouse.dx,
      lookDy = input.mouse.dy;
    this.sway.lerp(V(clamp(-lookDx * 0.0006, -0.03, 0.03), clamp(lookDy * 0.0006, -0.03, 0.03), 0), Math.min(1, dt * 8));
    this.holdLerp = Math.min(1, (this.holdLerp || 0) + dt * 4);
    this.heldPose = null;
    if (!big && this.floating) {
      // out of the hand: in front of the eye at holdDist, turned with RMB
      local = V(0, -0.06, -this.holdDist).add(this.sway);
      localQ = this.holdRot.clone();
    } else if (!big) {
      if (this.rotating) this.userRotated = true;
      const st = this.holdState(it, dt);
      const pose = holdPose(it.mesh, st);
      if (this.userRotated) {
        // turned in the hand to look at it: the item spins about its grip
        local = V(0.03, -0.08, -0.42);
        localQ = this.holdRot.clone();
      } else {
        local = pose.item.p;
        localQ = pose.item.q;
      }
      this.heldPose = pose;
    } else {
      // big items are carried in front at holdDist, a little below eye level
      // (high enough that the hands on its sides are in view)
      local = V(0, -0.21 - Math.min(0.1, it.size.y * 0.12), -this.holdDist);
      localQ = this.holdRot.clone();
      if (this.useAnim > 0) {
        const k = Math.sin(Math.min(1, this.useAnim) * Math.PI);
        local = local.clone().lerp(V(0, -0.12, -0.22), k);
      }
      local.add(this.sway);
    }
    // world transform
    const wp = local.clone().applyQuaternion(cam.quaternion).add(cam.position);
    const wq = cam.quaternion.clone().multiply(localQ);
    // third person: small items sit in the body's right hand
    const pl = this.game.player;
    const av = this.game.npcs && this.game.npcs.avatar;
    if (pl.tpBlend > 0.5 && av && !(it.part || this.dragging) && !big) {
      const hw = av.handWorld(V());
      const hq = new THREE.Quaternion();
      av.bones.handR.getWorldQuaternion(hq);
      wp.copy(hw).add(V(0, -0.06, 0).applyQuaternion(hq));
      wq.copy(av.root.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0)));
      if (def && def.weapon) wq.copy(cam.quaternion).multiply(localQ);
    }
    // third person, something big: carried against the body's chest, turned as it would be in
    // front of the eye (the arms reach for its sides)
    let from = cam.position;
    if (pl.tpBlend > 0.5 && av && av.ok && big && !this.dragging) {
      const bodyQ = av.root.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI));
      const depth = Math.min(0.32, Math.max(it.size.x, it.size.z) * 0.5);
      from = av.root.getWorldPosition(V()).add(V(0, 1.3, 0));
      wp.copy(from).add(V(0, -0.18 - Math.min(0.12, it.size.y * 0.1), -(0.22 + depth)).applyQuaternion(bodyQ));
      wq.copy(bodyQ).multiply(localQ);
    }
    // keep big items out of walls: pull toward the eye if the path is blocked
    if (big) {
      const dir = wp.clone().sub(from);
      const len = dir.length();
      dir.normalize();
      const hit = this.game.physics.raycast(from, dir, len + 0.3, GROUPS.ground, this.game.player.body);
      const rad = Math.max(it.size.x, it.size.z) * 0.45;
      if (hit && hit.distance < len + rad) wp.copy(from).addScaledVector(dir, Math.max(0.35, hit.distance - rad));
      // smooth follow (mass makes heavy items lag)
      const follow = Math.min(1, dt * (14 / Math.sqrt(Math.max(1, it.mass / 8))));
      it.mesh.position.lerp(wp, this.holdLerp < 1 ? follow * 0.6 : follow);
      it.mesh.quaternion.slerp(wq, follow);
    } else {
      // small items sit in the hand (the raise animation brings them in)
      it.mesh.position.copy(wp);
      it.mesh.quaternion.copy(wq);
    }
    // ---- using the held item
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 6);
    if (this.useAnim > 0) this.useAnim -= dt * 1.6;
    const blocked = this.game.ui && this.game.ui.blocksMove;
    if (blocked) return;
    if (!def || !def.binoculars) this.binoZoom = 0;
    if (def) {
      if (def.weapon) this.updateWeapon(it, dt);
      else if (def.binoculars) {
        // up to the eyes while LMB is held; the wheel turns the zoom
        const on = input.mouseDown(0) && !this.floating;
        this.binoZoom = clamp((this.binoZoom || 0) + (on ? dt * 5 : -dt * 6), 0, 1);
        if (on && input.mouse.wheel) this.binoMag = clamp((this.binoMag || 4) - Math.sign(input.mouse.wheel), 2, 10);
      } else if (def.instrument === 'clock' && input.mouseDown(0)) {
        // the knob on top turns the hands round
        it.state.offset = ((it.state.offset || 0) + dt * 1.2) % 12;
        const knob = it.mesh.getObjectByName('knob');
        if (knob) knob.rotation.y += dt * 9;
        this.useAnim = Math.max(this.useAnim, 0.3);
      } else if (def.liquid) {
        // the cap: off and on by hand
        if (capped(def) && input.wasPressed('reload')) {
          this.toggleCap(it);
          this.useAnim = Math.max(this.useAnim, 0.5);
        }
        const open = !capped(def) || it.state.capOff;
        const tgt = open ? this.pourTarget(it, this.target) : null;
        if (open && input.mouseDown(0)) this.pour(it, tgt, dt);
        else this.pouring = 0;
        // the liquid runs in a stream to where it goes
        if (this.pouring && this.pourKind === 'pour' && tgt && this.game.effects) this.pourStream(it, tgt);
      } else if (def.clean) {
        const car = this.game.car;
        const t = this.target;
        const onCar = t && (t.kind === 'part' || t.kind === 'hotspot' || t.kind === 'seat');
        if (input.mouseDown(0) && onCar && car) {
          car.dirt = Math.max(0, car.dirt - dt * 0.06);
          this.useAnim = Math.max(this.useAnim, 0.6 + 0.3 * Math.sin(this.game.time * 14));
          this.cleanSnd = (this.cleanSnd || 0) - dt;
          if (this.cleanSnd <= 0) {
            this.cleanSnd = 0.35;
            this.game.audio && this.game.audio.play('pour', { volume: 0.3 });
          }
        }
      } else if (def.derust) {
        // a wire brush: slow, loud, and the rust comes off a little at a time, off the part it is on
        const r = this.rustTarget();
        if (input.mouseDown(0) && r && r.rust > 0) {
          if (r.item) {
            r.item.state.rust = Math.max(0, r.rust - dt * 0.012);
            r.item.rustU.value = r.item.state.rust;
          } else this.game.car.derust(r.part, dt * 0.012);
          this.useAnim = Math.max(this.useAnim, 0.6 + 0.35 * Math.sin(this.game.time * 22));
          this.cleanSnd = (this.cleanSnd || 0) - dt;
          if (this.cleanSnd <= 0) {
            this.cleanSnd = 0.22;
            // (a dry scratch each stroke)
            this.game.audio && this.game.audio.play('step', { surface: 'gravel', volume: 0.22 });
          }
        }
      } else if (def.paint) this.updateSpray(it, dt);
      else if (def.fishing) this.updateFishing(it, dt);
      else if (input.mousePressed(0)) this.useHeld();
    }
  }

  // What a wire brush is on: a panel of the car (its own rust), the body (without its panels) or a
  // panel lying loose. { part | item, rust, label } or null.
  rustTarget() {
    const t = this.target;
    const car = this.game.car;
    if (!t) return null;
    if (t.kind === 'item' && t.item.part && t.item.rustU) {
      const P = carType(t.item.state.carType).PARTS || {};
      return { item: t.item, rust: t.item.state.rust || 0, label: ((P[t.item.part] && P[t.item.part].label) || 'panel').toLowerCase() };
    }
    if (!car || (t.dist || 0) > 2.6) return null;
    const part = t.kind === 'part' ? t.part : t.kind === 'hotspot' ? t.hotspot.part : null;
    if (!part || !car.model.parts[part]) return null;
    const own = part in car.rustU;
    return { part, rust: car.rustOf(part), label: own ? car.PARTS[part].label.toLowerCase() : 'body' };
  }

  // Holding LMB on a panel with a spray can: a mist of colour, then the panel takes the paint.
  updateSpray(it, dt) {
    const g = this.game;
    const car = g.car;
    const t = this.target;
    const plate = t && t.kind === 'plate' && (t.dist || 0) < 2.6 ? t.plate : null;
    const ok = plate || (t && t.kind === 'part' && car && car.paintable(t.part) && (t.dist || 0) < 2.6);
    if (!input.mouseDown(0) || !ok) {
      this.spraying = null;
      return;
    }
    const key = plate || t.part;
    if (!this.spraying || this.spraying.key !== key) this.spraying = { part: plate ? null : t.part, key, t: 0 };
    const S = this.spraying;
    const b = plate ? null : car.model.parts[t.part].bbox;
    const sz = plate ? V(PLATES[plate.id].w, 0.01, PLATES[plate.id].l) : b.getSize(V(0, 0, 0));
    // big panels take longer: about a second per square metre of face
    const need = 0.7 + Math.min(3, sz.x * sz.z + sz.y * Math.max(sz.x, sz.z)) * 0.8;
    S.t += dt;
    S.need = need;
    this.useAnim = Math.max(this.useAnim, 0.7);
    const P = paintOf(it.state.variant);
    const nozzle = (it.mesh.userData.muzzle || V(0, 0.1, 0)).clone().applyMatrix4(it.mesh.matrixWorld);
    const aim = plate ? plate.mesh.getWorldPosition(V(0, 0, 0)) : car.worldPointOf(b.getCenter(V(0, 0, 0)));
    g.effects && g.effects.sprayMist && g.effects.sprayMist(nozzle, aim, P.hex, dt);
    if (S.t >= need) {
      if (plate) plate.world ? g.worldPlates.paint(plate, P.hex) : paintPlate(plate, P.hex);
      else car.paintPart(t.part, P.hex);
      car.owned = true;
      it.state.charges = (it.state.charges ?? it.def.charges ?? 1) - 1;
      g.hud && g.hud.toast(`${plate ? PLATES[plate.id].name : car.PARTS[t.part].label} painted ${P.name.toLowerCase()}${it.state.charges > 0 ? ` · can ${Math.round((it.state.charges / it.def.charges) * 100)}% full` : ' · the can is empty'}`);
      this.spraying = null;
      if (it.state.charges <= 0) this.consumeHeld();
    }
  }

  // Animation inputs for the held item's pose (see grips.js holdPose).
  holdState(it, dt) {
    const def = it.def || {};
    const cam = this.cam;
    let kind = '';
    if (def.weapon) kind = '';
    else if (def.melee) kind = 'swing';
    else if (def.clean || def.derust) kind = 'wipe';
    else if (def.paint) kind = 'spray';
    else if (def.liquid) kind = this.pourKind || 'drink';
    else if (def.consume) kind = def.consume.food > 0 ? 'eat' : def.consume.water > 0 && !def.consume.smoke ? 'drink' : 'use';
    else kind = 'use';
    const target = this.pouring ? 1 : this.useAnim > 0 ? Math.sin(Math.min(1, this.useAnim) * Math.PI) : 0;
    this.useBlend = lerp(this.useBlend || 0, target, Math.min(1, dt * (target > (this.useBlend || 0) ? 9 : 6)));
    // walking bob
    const p = this.game.player;
    const bob = p.seat ? V(0, 0, 0) : V(Math.cos(p.bob) * 0.008, -Math.abs(Math.sin(p.bob)) * 0.01, 0).multiplyScalar(p.bobAmp || 0);
    // world up in camera space (things carried by a handle hang plumb)
    const up = V(0, 1, 0).applyQuaternion(cam.quaternion.clone().invert());
    // handle swing: a damped pendulum kicked by turning and walking
    const kick = -input.mouse.dx * 0.0025 + Math.sin(p.bob * 2) * 0.02 * (p.bobAmp || 0);
    this.hangVel = (this.hangVel || 0) + (-30 * (this.hangAng || 0) - 4 * this.hangVel) * dt + kick;
    this.hangAng = clamp((this.hangAng || 0) + this.hangVel * dt, -0.5, 0.5);
    const w = def.weapon;
    const raise = this.holdLerp ?? 1;
    return {
      aim: this.aim,
      recoil: this.recoil,
      reload: w && this.reloading > 0 ? 1 - this.reloading / w.reload : 0,
      use: this.useBlend,
      useKind: kind,
      raise: raise * raise * (3 - 2 * raise),
      sway: this.sway.clone(),
      bob,
      up,
      swing: this.hangAng,
      time: this.game.time,
    };
  }

  // Dragging a heavy thing by the point taken hold of: that point is pulled toward the hand (as far
  // along the view as when it was taken), slower the heavier it is; the thing slides on the ground
  // and swings round to trail behind the point. Too far from it and the hand slips off.
  updateDrag(it, dt) {
    const g = this.game;
    const p = g.player;
    const cam = this.cam;
    const m = it.mesh;
    m.updateMatrixWorld(true);
    const at = m.localToWorld(this.dragLocal.clone());
    const target = V(0, 0, -1).applyQuaternion(cam.quaternion).multiplyScalar(this.dragDist).add(cam.position);
    // RMB + mouse turns it about the vertical
    if (this.rotating) {
      const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), input.mouse.dx * 0.006);
      m.position.sub(at).applyQuaternion(q).add(at);
      m.quaternion.premultiply(q);
    }
    const pull = V(target.x - at.x, 0, target.z - at.z);
    const len = pull.length();
    const maxV = clamp(140 / Math.max(1, it.mass), 0.45, 2.4);
    const step = Math.min(len * Math.min(1, dt * 6), maxV * dt);
    // it swings round the way it is pulled, about its middle, to trail behind the hand
    const c = m.position;
    const arm = V(at.x - c.x, 0, at.z - c.z);
    if (len > 0.04 && arm.lengthSq() > 0.02) {
      const a = Math.atan2(arm.x, arm.z),
        b = Math.atan2(target.x - c.x, target.z - c.z);
      let d = b - a;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const turn = clamp(d, -1, 1) * Math.min(1, dt * 2.2) * Math.min(1, len * 2);
      m.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), turn));
    }
    if (len > 1e-4) c.addScaledVector(pull, step / len);
    // sliding on the ground under it
    const gy = g.groundHeightAt(c.x, c.z, p.position.y + 1.5);
    c.y += (gy + it.size.y * 0.5 + 0.03 - c.y) * Math.min(1, dt * 8);
    this.dragAt = m.localToWorld(this.dragLocal.clone());
    // torn out of the hand when it cannot follow (walked off, caught on something)
    if (this.dragAt.distanceTo(cam.position) > REACH + 1.0) {
      this.drop(0);
      return;
    }
    // scraping sound while moving
    this.dragSnd = (this.dragSnd || 0) + step;
    if (this.dragSnd > 0.9) {
      this.dragSnd = 0;
      g.audio && g.audio.play('step', { surface: 'gravel', at: c, volume: 0.8 });
    }
  }

  // ------------------------------------------------------------------ using items
  useHeld() {
    const it = this.held;
    if (!it || !it.def) return;
    // using a floating thing takes it back into the hand first
    if (this.floating) {
      this.floating = false;
      this.holdDist = 0.75;
      return;
    }
    const def = it.def;
    const g = this.game;
    const p = g.player;
    // raw meat held over a burning fire is cooked instead of eaten
    if (def.raw && g.campfires && g.campfires.near(p.position, 2.6)) {
      const pos = it.mesh.position.clone();
      // the same fish (or cut), grilled
      const variant = it.state.variant;
      this.consumeHeld();
      const cooked = g.items.spawn(def.cooksTo || 'cookedMeat', pos, undefined, variant !== undefined && def.cooksTo === 'cookedFish' ? { variant } : null);
      this.pick(cooked);
      g.audio && g.audio.play('ignite', { volume: 0.4 });
      return;
    }
    if (def.campfire) {
      // on open, fairly flat ground in front, not indoors or in the car
      const cam = this.cam;
      const fwd = V(0, 0, -1).applyQuaternion(cam.quaternion).setY(0).normalize();
      const at = p.position.clone().addScaledVector(fwd, 1.6);
      at.y = g.groundHeightAt(at.x, at.z, p.position.y + 2);
      if (p.seat || p.indoors || Math.abs(at.y - p.position.y) > 0.8) {
        g.hud && g.hud.toast('Find open, level ground for a fire');
        return;
      }
      if (g.env.w.rain > 0.6) {
        g.hud && g.hud.toast('Too wet to light a fire');
        return;
      }
      g.campfires.kindle(at);
      this.consumeHeld();
      g.hud && g.hud.toast('The kindling catches. Stand close to warm up; hold raw meat over it and use it to cook');
      return;
    }
    if (def.wrap) {
      if ((p.wrapCooldown || 0) > 0) {
        g.hud && g.hud.toast('Already wrapped up');
        return;
      }
      p.consume({ warmth: def.wrap });
      p.wrapCooldown = 1;
      g.audio && g.audio.play('pocket');
      return;
    }
    if (def.consume) {
      p.consume(def.consume);
      // raw meat: a fair chance of a bad stomach
      if (def.raw && Math.random() < 0.4) {
        p.consume({ water: -16, food: -12, energy: -10 });
        g.hud && g.hud.toast('That meat was off. You feel sick');
        g.audio && g.audio.play('hurt');
      }
      if (def.consume.smoke) {
        // a cigarette: a few puffs of smoke drifting up past the view
        const cam = this.cam;
        const at = cam.position.clone().add(V(0, -0.05, -0.25).applyQuaternion(cam.quaternion));
        for (let k = 0; k < 6; k++) setTimeout(() => g.effects && g.effects.smoke && g.effects.smoke.emit({ pos: at.clone(), vel: V((Math.random() - 0.5) * 0.1, 0.25, (Math.random() - 0.5) * 0.1), size: 0.06, grow: 0.5, life: 2.2, color: [0.75, 0.75, 0.75], alpha: 0.25, drag: 1 }), k * 120);
        g.audio && g.audio.play('breath');
        it.state.charges = (it.state.charges ?? def.charges ?? 1) - 1;
        if (it.state.charges <= 0) this.consumeHeld();
        else this.useAnim = 1;
        return;
      }
      if (def.consume.food > 0) g.stats.meals++;
      else g.stats.drinks++;
      g.audio && g.audio.play(def.consume.food > 0 ? 'eat' : def.consume.health > 0 ? 'bandage' : 'drink');
      // a flask has several cups in it
      if (def.charges !== undefined) {
        it.state.charges = (it.state.charges ?? def.charges) - 1;
        if (it.state.charges > 0) {
          this.useAnim = 1;
          return;
        }
      }
      this.consumeHeld();
      return;
    }
    if (def.ammo) {
      this.ammo[def.ammo.type] = (this.ammo[def.ammo.type] || 0) + def.ammo.count;
      g.hud && g.hud.toast(`+${def.ammo.count} ${def.ammo.type === '38' ? '.38' : '12 ga'} in pouch`);
      g.audio && g.audio.play('pocket');
      this.consumeHeld();
      return;
    }
    if (def.disc) {
      const t = this.target;
      const car = g.car;
      if (t && t.kind === 'hotspot' && t.hotspot.id === 'radio') {
        if (car.stereo.disc >= 0) this.ejectDiscSwap(it);
        else {
          car.insertDisc(it.state.variant || 0);
          this.consumeHeld();
          this.useAnim = 0;
        }
        g.audio && g.audio.play('click');
      } else g.hud && g.hud.toast('Look at the car stereo to put the disc in');
      return;
    }
    if (def.readable) {
      const n = g.story && g.story.noteById(it.state.note);
      if (n) {
        g.story.collect(n.id);
        g.ui && g.ui.showNote(n);
      }
      g.audio && g.audio.play('pocket');
      return;
    }
    if (def.wear) return this.wear(it);
    if (def.light) {
      it.state.on = !it.state.on && (def.battery ? (it.state.charge ?? 1) > 0.005 : (it.state.liquid || 0) > 0.01);
      if (def.battery && !it.state.on && (it.state.charge ?? 1) <= 0.005) g.hud && g.hud.toast('The batteries are flat');
      g.items.refreshVisual(it);
      g.audio && g.audio.play('click');
      return;
    }
    const t = this.target;
    const car = g.car;
    if (it.id === 'repairKit' && t && (t.kind === 'part' || t.kind === 'hotspot')) {
      if (!car.lidOpen('hood')) return g.hud && g.hud.toast(`Open the ${car.type.lids.hood} first`);
      car.engineCondition = Math.min(1, car.engineCondition + 0.35);
      car.fire = 0;
      it.state.charges--;
      g.audio && g.audio.play('ratchet');
      g.hud && g.hud.toast('Engine repaired');
      if (it.state.charges <= 0) this.consumeHeld();
      return;
    }
    if (it.id === 'tyreKit' && t && t.kind === 'part' && t.part.startsWith('wheel')) {
      const w = car.dyn.wheels.find((x) => x.id === t.part);
      w.flat = false;
      car.parts[t.part].condition = Math.min(1, car.parts[t.part].condition + 0.5);
      it.state.charges--;
      g.audio && g.audio.play('ratchet');
      g.hud && g.hud.toast('Tyre patched');
      if (it.state.charges <= 0) this.consumeHeld();
      return;
    }
    if (it.id === 'extinguisher' && car && car.fire > 0 && car.root.position.distanceTo(this.cam.position) < 5) {
      car.fire = 0;
      car.engineTemp = Math.min(car.engineTemp, 90);
      g.effects && g.effects.extinguish(car);
      it.state.charges = 0;
      g.audio && g.audio.play('extinguish');
      return;
    }
    if (def.tent) {
      const site = this.tentSite();
      if (site.blocked) return g.hud && g.hud.toast(site.blocked);
      g.tents.pitch(site.pos, site.yaw, it.state.variant || 0, site.tilt);
      this.consumeHeld();
      g.hud && g.hud.toast('Tent pitched. Crawl in (E) to get out of the weather and sleep');
      return;
    }
    if (def.tune) {
      const why = this.tuneBlock(it, t);
      if (why) return g.hud && g.hud.toast(why);
      setTune(car, def.tune.part, def.tune.tune);
      this.consumeHeld();
      g.audio && g.audio.play('install', { at: car.worldPointOf(car.type.POINTS.engine) });
      g.hud && g.hud.toast('Twin carburettors fitted: more pull up top, and thirstier');
      return;
    }
    if (it.id === 'wrench' && this.carbsTarget(t)) {
      setTune(car, 'engine', null);
      const at = car.worldPointOf(car.type.POINTS.engine).add(V(0, 0.35, 0));
      g.items.spawn('carbKit', at, new THREE.Quaternion());
      g.audio && g.audio.play('ratchet', { at });
      g.hud && g.hud.toast('Twin carbs unbolted: the engine runs on its own carburettor again');
      return;
    }
    if (def.melee) this.melee(it);
  }

  // ------------------------------------------------------------------ things worn
  // The one taken off first: the sunglasses, then the hat.
  wornNext() {
    const w = this.game.player.worn;
    return w ? w.eyes || w.head || null : null;
  }

  // Put the held thing on; whatever was worn there before comes into the hand instead.
  wear(it, { quiet = false } = {}) {
    const g = this.game;
    const p = g.player;
    const slot = it.def.wear;
    p.worn = p.worn || {};
    const old = p.worn[slot];
    if (this.held === it) {
      this.held = null;
      this.dragging = false;
      p.carryMass = 0;
    }
    g.items.wear(it, slot);
    p.worn[slot] = it;
    if (old) this.takeOff(old);
    this.refreshWorn();
    if (!quiet) g.audio && g.audio.play('pocket');
  }

  takeOff(it) {
    const g = this.game;
    const w = g.player.worn || {};
    for (const k in w) if (w[k] === it) w[k] = null;
    g.items.unwear(it);
    it.mesh.position.copy(this.cam.position).add(V(0, -0.3, 0));
    if (!this.held) this.pick(it);
    else g.items.release(it, it.mesh.position.clone(), it.mesh.quaternion.clone());
    this.refreshWorn();
  }

  // Sunglasses on: the view through their lenses.
  refreshWorn() {
    const e = (this.game.player.worn || {}).eyes;
    this.game.hud && this.game.hud.setTint && this.game.hud.setTint(e ? SHADE_TINTS[(e.state.variant || 0) % SHADE_TINTS.length] : null);
  }

  consumeHeld() {
    const it = this.held;
    this.held = null;
    this.dragging = false;
    this.game.player.carryMass = 0;
    this.game.items.destroy(it);
    this.useAnim = 1;
  }

  pour(it, tgt, dt) {
    const g = this.game;
    const s = it.state;
    if ((s.liquid || 0) <= 0.001) {
      this.pouring = 0;
      return;
    }
    const rate = it.def.liquid.cap >= 5 ? 0.45 : 0.25; // l/s
    let amount = Math.min(s.liquid, rate * dt);
    const car = g.car;
    this.pourKind = tgt ? 'pour' : 'drink';
    if (!tgt) {
      // drink
      if (s.liquidType !== 'water') return;
      g.player.consume({ water: amount * 40 });
      s.liquid -= amount;
      if (!this.pouring) g.audio && g.audio.play('drink');
      this.pouring = 1;
      this.useAnim = Math.max(this.useAnim, 0.5);
      if (s.liquid <= 0.001) g.stats.drinks++;
      g.items.refreshVisual(it);
      return;
    }
    if (tgt.kind === 'car') {
      if (tgt.sys === 'fuel') {
        amount = Math.min(amount, car.fuelCap - car.fuel);
        car.addFuel(s.liquidType, amount);
      } else if (tgt.sys === 'oil') {
        amount = Math.min(amount, car.oilCap + 0.3 - car.oil);
        car.oil += amount;
      } else if (tgt.sys === 'coolant') {
        amount = Math.min(amount, car.coolantCap - car.coolant);
        car.coolant += amount;
      }
      if (tgt.sys === 'fuel') car.updateMass();
    } else if (tgt.kind === 'siphon') {
      amount = Math.min(rate * dt, it.def.liquid.cap - (s.liquid || 0), tgt.car.fuel);
      tgt.car.fuel -= amount;
      if ((s.liquid || 0) < 0.01) s.liquidType = tgt.car.tankMain();
      s.liquid = (s.liquid || 0) + amount;
      amount = 0;
    } else if (tgt.kind === 'pump') {
      const pump = this.target.pump.pump;
      // a drum is tipped and drained slower than a pump delivers
      amount = Math.min(rate * (pump.drum ? 1 : 2) * dt, it.def.liquid.cap - s.liquid, pumpFuel(pump));
      takeFuel(pump, amount);
      if (s.liquid < 0.01) s.liquidType = pump.kind || 'fuel';
      s.liquid += amount;
      amount = 0;
    } else if (tgt.kind === 'item') {
      const o = tgt.item;
      amount = Math.min(amount, o.def.liquid.cap - (o.state.liquid || 0));
      o.state.liquid = (o.state.liquid || 0) + amount;
      g.items.refreshVisual(o);
    }
    s.liquid -= amount;
    if (!this.pouring) g.audio && g.audio.play('pour', { loop: true });
    this.pouring = 1;
    g.items.refreshVisual(it);
  }

  // A stream from the held container's mouth to the filler (or the other container), drawn as a
  // run of short-lived droplets along a falling arc.
  pourStream(it, tgt) {
    const g = this.game;
    const fx = g.effects;
    const from = new THREE.Vector3();
    it.mesh.getWorldPosition(from);
    const size = it.mesh.userData.size || V(0.2, 0.3, 0.2);
    from.y += size.y * 0.45;
    let to = null;
    const t = this.target;
    if (t && t.kind === 'hotspot' && g.car) to = g.car.worldPointOf(t.hotspot.pos);
    else if (t && t.kind === 'item') {
      to = new THREE.Vector3();
      t.item.mesh.getWorldPosition(to);
      to.y += (t.item.mesh.userData.size ? t.item.mesh.userData.size.y * 0.4 : 0.1);
    }
    if (!to) return;
    // start a little toward the target from the mouth
    from.addScaledVector(to.clone().sub(from).setY(0).normalize(), 0.08);
    const type = it.state.liquidType;
    const col = type === 'fuel' ? [0.85, 0.68, 0.32] : type === 'diesel' ? [0.78, 0.66, 0.3] : type === 'oil' ? [0.22, 0.14, 0.05] : type === 'coolant' ? [0.35, 0.85, 0.45] : [0.75, 0.85, 0.95];
    const sag = Math.max(0.05, from.distanceTo(to) * 0.25);
    for (let i = 0; i < 14; i++) {
      const k = (i + Math.random()) / 14;
      const p = from.clone().lerp(to, k);
      p.y -= Math.sin(k * Math.PI) * sag * 0.5 + k * k * 0.02;
      fx.blood.emit({ pos: p, size: 0.022, grow: 0.01, life: 0.05, color: col, alpha: type === 'fuel' || type === 'diesel' || type === 'water' ? 0.55 : 0.9, drag: 0 });
    }
  }

  // Fishing: LMB casts toward open water in view; the float bobs, dips when a fish bites, and LMB
  // during the bite lands it (into the backpack, or at your feet when that is full). LMB before a
  // bite reels in. Walking off or putting the rod away ends it.
  updateFishing(it, dt) {
    const g = this.game;
    const p = g.player;
    const f = this.fishing;
    if (f && (p.position.distanceTo(f.from) > 3 || p.seat)) return this.endFishing();
    if (!f) {
      if (!input.mousePressed(0)) return;
      const at = this.waterInView();
      if (!at) {
        g.hud && g.hud.toast('Cast toward open water: a river or a lake');
        return;
      }
      if (at.frozen) {
        g.hud && g.hud.toast('The water is frozen');
        return;
      }
      const bob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd8321e, roughness: 0.4 }));
      bob.position.copy(at.pos);
      g.worldGroup.add(bob);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V()]), new THREE.LineBasicMaterial({ color: 0xdcdcd0, transparent: true, opacity: 0.6 }));
      line.frustumCulled = false;
      g.worldGroup.add(line);
      this.fishing = { at: at.pos.clone(), from: p.position.clone(), t: 0, bite: 4 + Math.random() * 12, bob, line };
      this.useAnim = 1;
      g.audio && g.audio.play('swing', { volume: 0.5 });
      g.hud && g.hud.toast('Line out. Wait for the float to dip, then press LMB');
      return;
    }
    f.t += dt;
    const biting = f.t > f.bite && f.t < f.bite + 1.6;
    f.bob.position.y = f.at.y + 0.02 + Math.sin(f.t * 2.2) * 0.008 - (biting ? 0.05 + Math.abs(Math.sin(f.t * 18)) * 0.03 : 0);
    if (biting && !f.splashed) {
      f.splashed = true;
      g.audio && g.audio.play('pour', { at: f.at, volume: 0.25 });
    }
    // the line from the rod tip to the float
    const tip = V(0, 0.75, 0).applyQuaternion(it.mesh.quaternion).add(it.mesh.position);
    const pos = f.line.geometry.attributes.position;
    pos.setXYZ(0, tip.x, tip.y, tip.z);
    pos.setXYZ(1, f.bob.position.x, f.bob.position.y, f.bob.position.z);
    pos.needsUpdate = true;
    if (f.t > f.bite + 1.6) {
      // missed it: wait for the next one
      f.t = 0;
      f.bite = 3 + Math.random() * 10;
      f.splashed = false;
    }
    if (!input.mousePressed(0)) return;
    if (biting) {
      const fish = g.items.spawn('fish', p.position.clone().add(V(0, 0.4, 0)));
      if (g.inventory.addSmart({ id: 'fish', state: fish.state }) >= 0) g.items.destroy(fish);
      g.stats && (g.stats.fish = (g.stats.fish || 0) + 1);
      g.hud && g.hud.toast('Caught a fish');
      g.audio && g.audio.play('pour', { volume: 0.5 });
    } else g.hud && g.hud.toast('Reeled in');
    this.endFishing();
  }

  endFishing() {
    const f = this.fishing;
    if (!f) return;
    this.game.worldGroup.remove(f.bob, f.line);
    f.bob.geometry.dispose();
    f.line.geometry.dispose();
    this.fishing = null;
  }

  // Where the view meets open water within casting range (scene coordinates), or null.
  waterInView() {
    const g = this.game;
    const o = g.origin;
    const cam = this.cam;
    const dir = V(0, 0, -1).applyQuaternion(cam.quaternion);
    for (let d = 3; d < 22; d += 0.5) {
      const x = cam.position.x + dir.x * d,
        z = cam.position.z + dir.z * d;
      const w = g.gen.waterAt(x + o.x, z + o.z);
      if (!w) continue;
      if (cam.position.y + dir.y * d > w.level + 2.5) continue;
      return { pos: V(x, w.level, z), frozen: w.frozen };
    }
    return null;
  }

  // A punch: the hand goes out fast, lands at the far end (anything in reach takes it), comes back.
  startPunch() {
    const p = this.game.player;
    const tired = p.stamina < 10;
    this.punch = { t: 0, side: this.punch.side === 'right' ? 'left' : 'right', done: false, power: tired ? 0.5 : 1, speed: tired ? 2.0 : 2.8 };
    p.stamina = Math.max(0, p.stamina - 6);
  }

  updatePunch(dt) {
    const P = this.punch;
    if (P.t >= 1) return;
    P.t = Math.min(1, P.t + dt * (P.speed || 2.8));
    if (P.done || P.t < 0.32) return;
    P.done = true;
    const g = this.game;
    const hit = this.lookHit;
    const dir = V(0, 0, -1).applyQuaternion(this.cam.quaternion);
    if (hit && hit.distance < 1.5) {
      if (hit.owner && hit.owner.kind === 'npc') {
        hit.owner.npc.damage(12 * P.power, hit.owner.zone, hit.point, dir);
        g.audio && g.audio.play('hitFlesh', { at: hit.point });
      } else {
        // knuckles on something hard
        g.audio && g.audio.play('hitFlesh', { at: hit.point, volume: 0.45, rate: 1.3 });
        if (hit.owner && (hit.owner.kind === 'structure' || hit.owner.kind === 'car')) g.player.damage(1, 'knuckles', true);
      }
    } else g.audio && g.audio.play('swing', { volume: 0.35, rate: 1.4 });
  }

  melee(it) {
    const g = this.game;
    this.useAnim = 0.8;
    const hit = this.lookHit;
    if (hit && hit.distance < it.def.melee.range && hit.owner && hit.owner.kind === 'npc') {
      hit.owner.npc.damage(it.def.melee.damage, hit.owner.zone, hit.point, V(0, 0, -1).applyQuaternion(this.cam.quaternion));
      g.audio && g.audio.play('hitFlesh', { at: hit.point });
    } else if (hit && hit.distance < it.def.melee.range) g.audio && g.audio.play('hitMetal', { at: hit.point });
    else g.audio && g.audio.play('swing');
  }

  updateWeapon(it, dt) {
    const g = this.game;
    const w = it.def.weapon;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = w.mag - (it.state.loaded || 0);
        const take = Math.min(need, this.ammo[w.ammo] || 0);
        it.state.loaded = (it.state.loaded || 0) + take;
        this.ammo[w.ammo] -= take;
      }
      return;
    }
    if (input.wasPressed('reload') && (it.state.loaded || 0) < w.mag) {
      if ((this.ammo[w.ammo] || 0) <= 0) return g.hud && g.hud.toast('No ammunition');
      this.reloading = w.reload;
      g.audio && g.audio.play(w.ammo === '12' ? 'reloadShotgun' : 'reloadRevolver');
      return;
    }
    if (input.mousePressed(0) && this.fireCooldown <= 0) {
      if ((it.state.loaded || 0) <= 0) {
        g.audio && g.audio.play('dryfire');
        this.fireCooldown = 0.25;
        return;
      }
      it.state.loaded--;
      this.fireCooldown = w.rate;
      this.recoil = 1;
      g.stats.shotsFired++;
      const cam = this.cam;
      const pellets = w.pellets || 1;
      const muzzle = (it.mesh.userData.muzzle || V(0, 0, 0.2)).clone().applyMatrix4(it.mesh.matrixWorld);
      // weapon models point along +Z; held rotation maps that to the camera's -Z
      g.effects && g.effects.muzzleFlash(muzzle, V(0, 0, -1).applyQuaternion(cam.quaternion));
      g.audio && g.audio.play(w.ammo === '12' ? 'shotgun' : 'revolver', { at: muzzle });
      g.effects && g.effects.shellCasing && w.ammo === '12' && false;
      for (let k = 0; k < pellets; k++) {
        const spread = w.spread * (1 - this.aim * 0.6);
        const dir = V((Math.random() - 0.5) * 2 * spread, (Math.random() - 0.5) * 2 * spread, -1).normalize().applyQuaternion(cam.quaternion);
        const hit = g.physics.raycast(cam.position, dir, w.range, GROUPS.shoot, g.player.body);
        const end = hit ? V(hit.point.x, hit.point.y, hit.point.z) : cam.position.clone().addScaledVector(dir, w.range);
        if (k === 0 || Math.random() < 0.3) g.effects && g.effects.tracer(muzzle, end);
        if (!hit) continue;
        if (hit.owner && hit.owner.kind === 'npc') {
          const dmg = w.damage * (1 - (hit.distance / w.range) * 0.4);
          hit.owner.npc.damage(dmg, hit.owner.zone, end, dir);
          if (hit.owner.zone === 'head') g.hud && g.hud.hitmarker(true);
          else g.hud && g.hud.hitmarker(false);
        } else {
          g.effects && g.effects.impact(end, V(hit.normal.x, hit.normal.y, hit.normal.z), hit.owner && hit.owner.surface);
          if (hit.owner && hit.owner.kind === 'item' && hit.owner.item.body) {
            const b = hit.owner.item.body;
            b.applyImpulseAtPoint({ x: dir.x * 4, y: dir.y * 4, z: dir.z * 4 }, hit.point, true);
          }
        }
      }
      // alert nearby creatures
      g.npcs && g.npcs.noise(cam.position, 90);
    }
    if (w.ammo === '38' && this.held) {
      const cyl = it.mesh.getObjectByName('cylinder');
      if (cyl) cyl.rotation.z = lerp(cyl.rotation.z, ((6 - (it.state.loaded || 0)) * Math.PI) / 3, Math.min(1, dt * 20));
    }
  }

  // ------------------------------------------------------------------ car parts
  partFit(it) {
    const car = this.game.car;
    if (!car) return null;
    // a part fits the slot of the same name on any car (or any slot of its family)
    const F = car.type.PART_FAMILY;
    const fam = F[it.part];
    const slots = (fam ? Object.keys(F).filter((k) => F[k] === fam && !car.isInstalled(k)) : [it.part]).filter((k) => car.model.parts[k] && car.PARTS[k]);
    const origin = this.cam.position;
    const dir = V(0, 0, -1).applyQuaternion(this.cam.quaternion);
    let best = null;
    for (const slot of slots) {
      if (car.isInstalled(slot)) continue;
      const mp = car.model.parts[slot];
      const box = mp.bbox.clone().expandByScalar(0.18);
      const inv = this.partMatrix(car, slot).invert();
      tmpRay.origin.copy(origin).applyMatrix4(inv);
      tmpRay.direction.copy(dir).transformDirection(inv);
      const hit = tmpRay.intersectBox(box, tmpV);
      if (!hit) continue;
      const d = hit.distanceTo(tmpRay.origin);
      if (d > 4.5) continue;
      if (!best || d < best.d) best = { slot, d };
    }
    if (!best) return null;
    const ok = car.canInstall(best.slot);
    return { slot: best.slot, ok: ok.ok, reason: ok.reason };
  }

  showGhost(it, ok) {
    const car = this.game.car;
    const fit = this.partFit(it);
    if (!fit) return this.hideGhost();
    if (!this.ghost || this.ghostFor !== fit.slot) {
      this.hideGhost();
      const mesh = this.game.items.buildPartMesh(it.part, it.state.carType, it.state.tune);
      mesh.traverse((o) => {
        if (o.isMesh) {
          o.material = this.ghostMat;
          o.castShadow = false;
          o.renderOrder = 5;
        }
      });
      this.ghost = mesh;
      this.ghostFor = fit.slot;
      this.game.worldGroup.add(mesh);
    }
    const sp = car.model.parts[fit.slot];
    const box = sp.nativeBox || sp.bbox;
    const c = box.getCenter(V(0, 0, 0));
    // wheels share geometry; slot centre differs
    const m = this.partMatrix(car, fit.slot).multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z));
    const from = carType(it.state.carType).id;
    if (from !== car.type.id && !car.model.wheels?.[fit.slot]) m.multiply(fitMatrix(fit.slot, this.ghost.userData.size, box.getSize(V(0, 0, 0))));
    if (car.type.PART_FAMILY[it.part] && it.part !== fit.slot) {
      const src = car.model.parts[it.part].bbox.getCenter(V(0, 0, 0));
      // mirrored side: rotate 180° about Y for opposite-side wheels
      if (Math.sign(src.x) !== Math.sign(c.x)) m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    }
    m.decompose(this.ghost.position, this.ghost.quaternion, this.ghost.scale);
    const mat = ok ? this.ghostMat : this.ghostBad;
    this.ghost.traverse((o) => o.isMesh && (o.material = mat));
  }

  hideGhost() {
    if (this.ghost) {
      this.ghost.parent && this.ghost.parent.remove(this.ghost);
      if (this.ghost.userData.ownGeometry) this.ghost.traverse((o) => o.isMesh && o.geometry.dispose());
      this.ghost = null;
      this.ghostFor = null;
    }
  }

  install(it, slot) {
    const g = this.game;
    const car = g.car;
    this.hideGhost();
    // a wheel from another slot keeps its tyre condition
    const cond = it.state.condition ?? 1;
    this.held = null;
    this.dragging = false;
    g.player.carryMass = 0;
    g.items.destroy(it);
    car.setInstalled(slot, true, carType(it.state.carType).id);
    if (it.state.tune) setTune(car, slot, it.state.tune);
    car.owned = true;
    if (it.state.color !== undefined) car.paintPart(slot, it.state.color);
    // a foreign panel keeps the paint of the car it came from (its own material otherwise)
    else if (car.parts[slot].from) car.paintPart(slot, carType(car.parts[slot].from).defaultColor);
    car.parts[slot].condition = cond;
    if (slot in car.rustU) {
      if (it.state.rust !== undefined) car.partRust[slot] = it.state.rust;
      else delete car.partRust[slot];
      car.applyWeather();
    }
    if (slot === 'battery' && it.state.charge !== undefined) car.battery = it.state.charge;
    if (slot === 'fueltank' && it.state.fuel !== undefined) {
      car.fuel = it.state.fuel;
      car.tankMix = it.state.mix ? { ...it.state.mix } : { [car.fuelType]: 1 };
    }
    if (slot === 'fanbelt') car.fanbeltCondition = cond;
    if (slot === 'engine' && it.state.oil !== undefined) car.oil = it.state.oil;
    const w = car.dyn.wheels.find((x) => x.id === slot);
    if (w) w.flat = cond < 0.02;
    g.stats.partsInstalled++;
    g.audio && g.audio.play('install', { at: car.worldPointOf(car.model.parts[slot].bbox.getCenter(V(0, 0, 0))) });
    g.onPartInstalled && g.onPartInstalled(slot);
  }

  remove(id) {
    const g = this.game;
    const car = g.car;
    const it = car.detachPart(id);
    g.audio && g.audio.play('remove', { at: it.mesh.position });
    if (car.PARTS[id].mass <= 60) this.pick(it);
    else g.hud && g.hud.toast(`${car.PARTS[id].label} removed — too heavy to carry`);
  }

  // ------------------------------------------------------------------ plates
  // Where the held plate would go: on any car within reach, or on anything solid in the world
  // (walls, fences, rocks, the ground), whichever the crosshair meets first; tilted if asked.
  plateFit(it) {
    const g = this.game;
    this.plateAim = null;
    if (g.player.seat) return null;
    const origin = this.cam.position;
    const dir = V(0, 0, -1).applyQuaternion(this.cam.quaternion);
    const right = V(1, 0, 0).applyQuaternion(this.cam.quaternion);
    const d = PLATES[it.def.plate];
    const spin = this.plateSpin || 0;
    let spot = null;
    const cars = [g.car, ...((g.fleet && g.fleet.cars) || [])].filter((c, i, a) => c && a.indexOf(c) === i && c.root.position.distanceTo(origin) < 7);
    for (const c of cars) {
      const s = plateSpot(c, origin, dir, 2.6, spin, right, d);
      if (s && (!spot || s.dist < spot.dist)) spot = s;
    }
    const heldBody = this.held && this.held.body;
    const hit = g.physics.raycast(origin, dir, 2.6, GROUPS.ground, g.player.body, (c) => {
      const o = g.physics.ownerOf(c);
      if (heldBody && c.parent() === heldBody) return false;
      return !(o && (o.item || o.kind === 'car' || o.kind === 'npc' || o.kind === 'trailer'));
    });
    if (hit && (!spot || hit.distance < spot.dist - 0.02)) spot = worldSpot(hit, dir, spin, right);
    if (spot && this.plateTilt) spot = tiltSpot(it.def.plate, spot, this.plateTilt, dir);
    this.plateAim = spot;
    return spot;
  }

  showPlateGhost(it, spot) {
    const key = 'plate:' + it.def.plate;
    if (!this.ghost || this.ghostFor !== key) {
      this.hideGhost();
      const g = plateModel(it.def.plate, it.state.variant || 0);
      g.traverse((o) => {
        if (!o.isMesh) return;
        o.material = this.ghostMat;
        o.castShadow = false;
        o.renderOrder = 5;
      });
      this.ghost = g;
      this.ghostFor = key;
      this.game.worldGroup.add(g);
    }
    plateWorldMatrix(it.def.plate, spot).decompose(this.ghost.position, this.ghost.quaternion, this.ghost.scale);
  }

  boltHeldPlate(it, spot) {
    const g = this.game;
    const m = plateWorldMatrix(it.def.plate, spot);
    this.hideGhost();
    this.held = null;
    g.player.carryMass = 0;
    g.items.destroy(it);
    if (spot.host === 'world') g.worldPlates.add(it.def.plate, { ...it.state }, m);
    else {
      const car = spot.car;
      const mp = car.model.parts[spot.part];
      const local = new THREE.Matrix4().copy(mp.pivot.matrixWorld).invert().multiply(m);
      attachPlate(car, { id: it.def.plate, state: { ...it.state }, part: spot.part, local });
      car.owned = true;
    }
    this.plateTilt = 0;
    g.audio && g.audio.play('install', { at: spot.point });
  }

  unboltPlate(plate) {
    const g = this.game;
    const pos = V(0, 0, 0),
      q = new THREE.Quaternion(),
      s = V(0, 0, 0);
    plate.mesh.updateMatrixWorld();
    plate.mesh.matrixWorld.decompose(pos, q, s);
    if (plate.world) g.worldPlates.remove(plate);
    else detachPlate(plate.car || g.car, plate);
    const it = g.items.spawn(plate.id, pos, q, { ...plate.state });
    g.audio && g.audio.play('remove', { at: pos });
    this.pick(it);
  }

  // ------------------------------------------------------------------ bolting things on
  // What can be bolted to a car: things, not supplies. Food, drink and whatever holds a liquid ride
  // inside instead (they stay where they are put); weapons, ammunition, papers and the things with
  // fittings of their own (plates, racks, the jack, the carb kit) are left out, and so are parts
  // too heavy to hold up.
  boltable(it) {
    if (it.part) return partDefOf(it).mass <= 40;
    const d = it.def;
    return !!d && !d.hang && !d.consume && !d.liquid && !d.weapon && !d.ammo && !d.plate && !d.accessory && !d.jack && !d.tune && !d.readable && !d.disc;
  }

  // Where the held thing would go: against the surface of a car under the crosshair, standing
  // off it on its own underside, turned by Shift+Wheel.
  boltFit(it) {
    const g = this.game;
    this.boltAim = null;
    const dash = !!(it.def && it.def.dash);
    if ((g.player.seat && !dash) || !this.boltable(it)) return null;
    const origin = this.cam.position;
    const dir = V(0, 0, -1).applyQuaternion(this.cam.quaternion);
    const right = V(1, 0, 0).applyQuaternion(this.cam.quaternion);
    let spot = null;
    const cars = [g.car, ...((g.fleet && g.fleet.cars) || [])].filter((c, i, a) => c && a.indexOf(c) === i && c.root.position.distanceTo(origin) < 7);
    for (const c of cars) {
      const s = plateSpot(c, origin, dir, 2.4, this.boltSpin || 0, right, { w: it.size.x, l: it.size.z });
      // (inside the cabin things are put down, not bolted; a toy for the dash stands on top of things)
      if (!s) continue;
      const inside = /^seat/.test(s.part) || cargoZone(c, s.point.clone().applyMatrix4(new THREE.Matrix4().copy(c.root.matrixWorld).invert())) === 'cabin';
      if (inside && (!dash || s.normal.y < 0.5)) continue;
      if (!spot || s.dist < spot.dist) spot = s;
    }
    this.boltAim = spot;
    return spot;
  }

  // On a roof, a bonnet or a boot lid it sits on its underside; on a door or a wing it stands
  // upright with its back to the panel (Shift+Wheel turns it about the panel's normal).
  // What to call where it goes: the roof for the top of the shell, the part's own name otherwise.
  boltPlace(car, part, n) {
    if (part === 'body' && n.y > 0.6) return 'roof';
    return (car.PARTS[part] || { label: part }).label.toLowerCase();
  }

  // The inside mirror of a car in reach that the aim passes close to (seated or through a door).
  hangFit(it) {
    const g = this.game;
    const origin = this.cam.position;
    const dir = V(0, 0, -1).applyQuaternion(this.cam.quaternion);
    let best = null;
    for (const c of [g.car, ...((g.fleet && g.fleet.cars) || [])]) {
      if (!c || c.root.position.distanceTo(origin) > 6 || !c.isInstalled('body')) continue;
      const lp = c.hangPoint();
      if (!lp) continue;
      const w = c.worldPointOf(lp);
      const to = w.clone().sub(origin);
      const t = to.dot(dir);
      if (t < 0.1 || t > 2.4) continue;
      const off = to.addScaledVector(dir, -t).length();
      if (off < 0.18 && (!best || off < best.off)) best = { car: c, local: lp, off };
    }
    return best;
  }

  hangHeld(it, h) {
    const g = this.game;
    const mp = h.car.model.parts.body;
    mp.pivot.updateMatrixWorld(true);
    const at = h.local.clone();
    const local = new THREE.Matrix4().copy(mp.pivot.matrixWorld).invert().multiply(new THREE.Matrix4().makeTranslation(...h.car.worldPointOf(at).toArray()));
    this.hideGhost();
    this.held = null;
    this.floating = false;
    g.player.carryMass = 0;
    it.held = false;
    // (the body's pivot is the car's frame: the point holds as it is)
    g.items.mount(it, h.car, 'body', local, { hang: at });
    g.audio && g.audio.play('pocket', { at: h.car.worldPointOf(at), volume: 0.4 });
  }

  boltMatrix(it, spot) {
    const n = spot.normal;
    if (Math.abs(n.y) > 0.6) {
      const p = spot.point.clone().addScaledVector(n, it.size.y / 2 + 0.003);
      return new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromRotationMatrix(spot.basis), V(1, 1, 1));
    }
    const y = V(0, 1, 0).addScaledVector(n, -n.y).normalize().applyAxisAngle(n, this.boltSpin || 0);
    const x = y.clone().cross(n);
    const p = spot.point.clone().addScaledVector(n, it.size.z / 2 + 0.003);
    return new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n)), V(1, 1, 1));
  }

  showBoltGhost(it, spot) {
    const key = 'bolt:' + it.uid;
    if (!this.ghost || this.ghostFor !== key) {
      this.hideGhost();
      const gh = it.mesh.clone();
      gh.traverse((o) => {
        if (o.isLight) o.visible = false;
        if (!o.isMesh) return;
        o.material = this.ghostMat;
        o.castShadow = false;
        o.renderOrder = 5;
      });
      this.ghost = gh;
      this.ghostFor = key;
      this.game.worldGroup.add(gh);
    }
    this.boltMatrix(it, spot).decompose(this.ghost.position, this.ghost.quaternion, this.ghost.scale);
  }

  boltHeld(it, spot) {
    const g = this.game;
    const m = this.boltMatrix(it, spot);
    const mp = spot.car.model.parts[spot.part];
    mp.pivot.updateMatrixWorld(true);
    const local = new THREE.Matrix4().copy(mp.pivot.matrixWorld).invert().multiply(m);
    this.hideGhost();
    this.held = null;
    this.floating = false;
    g.player.carryMass = 0;
    it.held = false;
    g.items.mount(it, spot.car, spot.part, local);
    this.boltSpin = 0;
    g.audio && g.audio.play('install', { at: spot.point });
    g.audio && g.audio.play('ratchet', { at: spot.point });
  }

  // ------------------------------------------------------------------ righting a car
  // The current car lying on its side or roof, right in front of you.
  carTipped() {
    const car = this.game.car;
    if (!car || this.game.player.seat) return false;
    const q = car.root.quaternion;
    if (1 - 2 * (q.x * q.x + q.z * q.z) > 0.5 || car.dyn.speed > 2) return false;
    const S = car.type.SPEC;
    const box = new THREE.Box3(V(-S.halfWidth, 0, S.rearTip), V(S.halfWidth, S.roofY, S.frontTip));
    const inv = new THREE.Matrix4().copy(car.root.matrixWorld).invert();
    const dir = V(0, 0, -1).applyQuaternion(this.cam.quaternion);
    tmpRay.origin.copy(this.cam.position).applyMatrix4(inv);
    tmpRay.direction.copy(dir).transformDirection(inv);
    const hit = tmpRay.intersectBox(box, tmpV);
    return !!hit && hit.distanceTo(tmpRay.origin) < 3.2;
  }

  // Shoulder against the roof: the car rolls back over toward its wheels while E is held.
  updateRighting(dt) {
    const g = this.game;
    const car = g.car;
    if (!input.isDown('interact')) {
      this.righting = 0;
      return;
    }
    const before = this.righting || 0;
    this.righting = before + dt;
    if (Math.floor(before / 0.7) !== Math.floor(this.righting / 0.7)) g.audio && g.audio.play('land', { at: car.root.position, volume: 0.35 });
    if (this.righting < 0.4) return;
    const b = car.dyn.body;
    const up = V(0, 1, 0).applyQuaternion(car.root.quaternion);
    const axis = up.clone().cross(V(0, 1, 0));
    // flat on its roof: roll it over the long axis, away from where you stand
    if (axis.lengthSq() < 0.01) {
      const toCar = car.root.position.clone().sub(g.player.position).setY(0);
      axis.copy(V(0, 1, 0).cross(toCar)).negate();
    }
    axis.normalize().multiplyScalar(1.5);
    const lv = b.linvel();
    b.setAngvel({ x: axis.x, y: axis.y, z: axis.z }, true);
    if (up.y < 0.4) b.setLinvel({ x: lv.x * 0.9, y: Math.max(lv.y, 0.7), z: lv.z * 0.9 }, true);
  }

  // ------------------------------------------------------------------ accessories
  // Holding a rack, box or bar near a car with that mount free.
  accessoryFit(it) {
    const car = this.game.car;
    if (!car || !car.type.MOUNTS) return null;
    const def = ACCESSORIES[it.def.accessory];
    const f = car.type.MOUNTS[def.mount];
    if (!f) return null;
    const c = def.mount === 'roof' ? V(0, f.top, f.z) : def.mount === 'front' ? V(0, (f.y0 + f.y1) / 2, f.z) : V(0, f.y, f.z - f.d / 2);
    if (car.worldPointOf(c).distanceTo(this.cam.position) > 2.8) return null;
    const where = MOUNT_LABEL[def.mount];
    if (car.accessories && car.accessories[def.mount]) return { ok: false, mount: def.mount, reason: `There is already something on the ${where}` };
    if (def.mount === 'roof' && !car.isInstalled('body')) return { ok: false, mount: def.mount, reason: 'Needs the body shell to bolt on to' };
    if (this.game.player.seat) return { ok: false, mount: def.mount, reason: 'Get out of the car first' };
    return { ok: true, mount: def.mount };
  }

  showAccessoryGhost(it, ok) {
    const car = this.game.car;
    const key = `acc:${it.def.accessory}:${car.id}`;
    if (!this.ghost || this.ghostFor !== key) {
      this.hideGhost();
      const g = buildAccessory(it.def.accessory, car);
      g.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false;
        o.renderOrder = 5;
      });
      g.userData.ownGeometry = true;
      this.ghost = g;
      this.ghostFor = key;
      car.root.add(g);
    }
    const mat = ok ? this.ghostMat : this.ghostBad;
    this.ghost.traverse((o) => o.isMesh && (o.material = mat));
  }

  fitHeldAccessory(it) {
    const g = this.game;
    const car = g.car;
    const def = ACCESSORIES[it.def.accessory];
    this.hideGhost();
    this.held = null;
    g.player.carryMass = 0;
    g.items.destroy(it);
    const a = fitAccessory(car, it.def.accessory);
    car.owned = true;
    g.audio && g.audio.play('install', { at: car.worldPointOf(a.center) });
    
  }

  takeOffAccessory(mount) {
    const g = this.game;
    const car = g.car;
    const a = car.accessories[mount];
    const def = ACCESSORIES[a.id];
    // whatever was strapped to it comes loose
    for (const it of [...car.attached]) if (it.stowed && it.stowed.zone === mount) g.items.unstow(it, true);
    const pos = car.worldPointOf(a.center);
    removeAccessory(car, mount);
    car.owned = true;
    const it = g.items.spawn(a.id, pos, car.root.quaternion.clone(), {});
    g.audio && g.audio.play('remove', { at: pos });
    this.pick(it);
  }

  // ------------------------------------------------------------------ stowing in the car
  updateStowing(dt) {
    const car = this.game.car;
    if (!car) return;
    const inv = new THREE.Matrix4().copy(car.root.matrixWorld).invert();
    for (const [it, t] of this.stowWatch) {
      if (it.held || it.stowed || !it.body || !this.game.items.items.has(it)) {
        this.stowWatch.delete(it);
        continue;
      }
      const lp = it.mesh.position.clone().applyMatrix4(inv);
      const inside = !!cargoZone(car, lp, it.size);
      const v = it.body.linvel();
      const cv = car.dyn.body.linvel();
      const rel = Math.hypot(v.x - cv.x, v.y - cv.y, v.z - cv.z);
      if (!inside) {
        if (t > 3) this.stowWatch.delete(it);
        else this.stowWatch.set(it, t + dt);
        continue;
      }
      if (rel < 0.15) {
        const nt = t + dt;
        this.stowWatch.set(it, nt);
        if (nt > 0.6) {
          this.game.items.stow(it, car);
          this.stowWatch.delete(it);
        }
      }
    }
  }

  // ------------------------------------------------------------------ outline
  updateOutline(t) {
    const out = this.game.renderer.outline;
    if (!out) return;
    const sel = [];
    if (t) {
      if (t.kind === 'item') sel.push(t.item.mesh);
      else if (t.kind === 'part') sel.push(this.game.car.model.parts[t.part].pivot);
      else if (t.kind === 'poiDoor') sel.push(t.door.pivot);
      else if (t.kind === 'npc' && t.npc.dead) sel.push(t.npc.root);
    }
    if (this.ghost) sel.push(this.ghost);
    out.selectedObjects = sel;
    out.enabled = sel.length > 0;
    out.visibleEdgeColor.set(this.ghost ? (this.ghost.children[0] && this.ghost.children[0].material === this.ghostBad ? 0xe07a6a : 0x9bd88f) : 0xf2e6cf);
  }

  // ------------------------------------------------------------------ driver's hands
  // A short reach from the wheel to a control (ignition key, light stalk, gear lever).
  // `what`: a hotspot (the hand it names, or the free one when the other holds something), or a
  // CONTROLS point by name ('shifter', 'stalk', 'key').
  driverReach(what) {
    const p = this.game.player;
    if (!what || p.seat !== 'driver') return;
    if (typeof what === 'string') this.reach = { side: what === 'stalk' ? 'left' : 'right', name: what, t: 0 };
    else if (what.hand) this.reach = { side: this.held ? 'left' : what.hand, hotspot: what, t: 0 };
  }

  // Car-space point of a driver control.
  controlPoint(car, target) {
    if (target === 'shifter' && car.model.gearLever) {
      // the knob moves with the lever
      const lv = car.model.gearLever;
      lv.updateMatrix();
      return lv.userData.top.clone().sub(lv.position).applyQuaternion(lv.quaternion).add(lv.position).add(V(0, 0.01, 0));
    }
    const p = car.type.CONTROLS[target];
    return p ? p.clone() : V(0, 0, 0);
  }

  // Shoulders and elbow pole directions of the seated driver, in camera space (fixed to the
  // seat, so looking around does not drag the arms along).
  driverArms(car) {
    const cam = this.cam;
    const inv = cam.quaternion.clone().invert();
    const out = {};
    for (const side of ['right', 'left']) {
      // car space: +X is the car's left
      const sg = side === 'left' ? 1 : -1;
      const D = car.type.DRIVER;
      const S = car.root.localToWorld(D.shoulder.clone().add(V(D.shoulderHalf * sg, 0, 0))).sub(cam.position).applyQuaternion(inv);
      const pole = V(0.35 * sg, -1, 0.1).transformDirection(car.root.matrixWorld).applyQuaternion(inv);
      out[side] = { shoulder: S, pole };
    }
    return out;
  }

  // Hands on the steering wheel (they turn with it), reaching for controls when used.
  // `only`: place just that hand (the other one is holding something).
  updateDriverHands(dt, only = null) {
    const g = this.game;
    const car = g.car;
    const h = this.hands;
    const cam = this.cam;
    const sw = car.model.steeringWheel;
    const wheelObj = sw && sw.children[0];
    if (!wheelObj || !car.isInstalled('steeringWheel')) return false;
    wheelObj.updateMatrixWorld(true);
    const camQ = cam.quaternion;
    const inv = camQ.clone().invert();
    const toCam = (wp) => wp.clone().sub(cam.position).applyQuaternion(inv);
    const R = car.type.DRIVER.rimRadius;
    // hands ride with the rim up to about 50 degrees each way, then slide along it (the arms
    // would cross over the wheel beyond that)
    const turn = clamp(wheelObj.rotation.z, -0.85, 0.85);
    sw.updateMatrixWorld(true);
    const pivotW = sw.matrixWorld;
    const arms = this.driverArms(car);
    for (const side of only ? [only] : ['left', 'right']) {
      const hand = h[side];
      hand.visible = true;
      // grip points at ten-to-two in the rotating wheel frame (X right, Y up, Z toward the driver)
      const a = (side === 'left' ? Math.PI - 0.5 : 0.5) + turn;
      const rimW = V(Math.cos(a) * R, Math.sin(a) * R, 0).applyMatrix4(pivotW);
      const tanW = V(-Math.sin(a), Math.cos(a), 0).transformDirection(pivotW);
      // fist round the rim, thumb side toward 12 o'clock; turned about the rim (which keeps it
      // inside the fist) so the wrist runs on toward the elbow as straight as it can
      const thumb = side === 'left' ? tanW.clone().negate() : tanW.clone();
      const pC = toCam(rimW);
      const anchor = { p: pC, q: anchorQFor(side, thumb.applyQuaternion(inv), elbowDir(pC, arms[side].shoulder, arms[side].pole)) };
      const placed = handFromAnchor(side, 'grip', anchor);
      let pose = 'grip';
      let posC = placed.p,
        qC = placed.q;
      // reaching for a control (right hand for key/shifter, left for the stalk)
      const r = this.reach;
      if (r && r.side === side) {
        const k = Math.sin(Math.min(1, r.t) * Math.PI);
        const tp = r.hotspot ? this.hotspotWorld(car, r.hotspot) : this.controlPoint(car, r.name).applyMatrix4(car.root.matrixWorld);
        // fingertips land on the control: fingers pointing on from the shoulder, thumb up
        const shoulderW = arms[side].shoulder.clone().applyQuaternion(camQ).add(cam.position);
        const dir = tp.clone().sub(shoulderW).normalize();
        const upW = V(0, 1, 0).applyQuaternion(car.root.quaternion);
        const qReach = inv.clone().multiply(anchorQFor(side, upW.addScaledVector(dir, -upW.dot(dir)), dir.clone().negate()));
        const placedR = handFromAnchor(side, 'pinch', { p: toCam(tp), q: qReach });
        // move from the palm contact point to the pinching fingertips
        placedR.p.add(PALM_CONTACT.clone().sub(PINCH_TIP).applyQuaternion(placedR.q));
        posC = posC.clone().lerp(placedR.p, k);
        qC = qC.clone().slerp(placedR.q, k);
        if (k > 0.4) pose = 'pinch';
      }
      h.setPose(side, pose);
      h.place(side, posC, qC);
      h.solveArm(side, arms[side].shoulder, arms[side].pole);
    }
    if (this.reach && (!only || only === this.reach.side)) {
      this.reach.t += dt * 2.2;
      // the hand stays on the key while it is held turned
      if (this.reach.hotspot && this.reach.hotspot.id === 'ignition' && this.keyTurn && this.reach.t > 0.5) this.reach.t = 0.5;
      if (this.reach.t >= 1) this.reach = null;
    }
    return true;
  }

  // The right hand closed on a point in the world, thumb up, the forearm back toward the shoulder;
  // out of the arm's reach it stretches toward it, open.
  handOnPoint(world, inv, normal = null) {
    const h = this.hands;
    const cam = this.cam;
    const arms = defaultArms();
    // camera space; the surface's outward direction (toward the eye when not known)
    const p = world.clone().sub(cam.position).applyQuaternion(inv);
    const n = normal ? normal.clone().applyQuaternion(inv) : p.clone().negate().normalize();
    if (n.dot(p) > 0) n.negate();
    // the palm laid flat on it, a skin's breadth off, the back of the hand out, thumb up along it
    const up = V(0, 1, 0).addScaledVector(n, -n.y);
    if (up.lengthSq() < 1e-4) up.set(-1, 0, 0);
    const anchor = { p: p.clone().addScaledVector(n, 0.012), q: frameQ(up.normalize(), n) };
    const placed = handFromAnchor('right', 'palm', anchor);
    const far = reachClamp(placed, arms.right.shoulder);
    h.right.visible = true;
    h.setPose('right', 'palm');
    h.place('right', placed.p, placed.q);
    h.solveArm('right', arms.right.shoulder, arms.right.pole);
    // out of the arm's reach the hand would hang in the air in front of it: only the arm shows,
    // reaching
    h.rig.right.holder.visible = !far;
  }

  // ------------------------------------------------------------------ view model
  updateView(dt) {
    const cam = this.cam;
    this.viewRoot.position.copy(cam.position);
    this.viewRoot.quaternion.copy(cam.quaternion);
    const it = this.held;
    // looking through binoculars: they are at the eyes, hands and all out of sight
    const looking = it && it.def && it.def.binoculars && this.binoZoom > 0.35;
    if (looking && !this.binoHid) {
      this.binoHid = it;
      this.viewRoot.visible = it.mesh.visible = false;
    } else if (!looking && this.binoHid) {
      this.viewRoot.visible = this.binoHid.mesh.visible = true;
      this.binoHid = null;
    }
    const h = this.hands;
    const big = it && carriedBig(it);
    const seated = !!this.game.player.seat;
    const driving = seated && this.game.player.seat === 'driver';
    h.right.visible = true;
    h.left.visible = false;
    h.rig.right.holder.visible = true;
    const inv = cam.quaternion.clone().invert();
    if (it && !big && this.floating && !this.dragging) {
      // the hand follows the floating thing: pinching it within arm's length, reaching out to it
      // with an open hand when it is held further off
      const c = it.mesh.position.clone().sub(cam.position).applyQuaternion(inv);
      // the pinch closes on its right-hand side, whatever its size
      const r = clamp(Math.max(it.size.x, it.size.z) / 2, 0.01, 0.06);
      const anchor = { p: c.clone().add(V(r * 0.55, -0.03, 0.03)), q: anchorQ(V(-0.2, 1, 0.1), V(0.45, -0.3, 0.85)) };
      const placed = handFromAnchor('right', 'pinch', anchor);
      placed.p.add(PALM_CONTACT.clone().sub(PINCH_TIP).applyQuaternion(placed.q));
      const arms = defaultArms();
      const far = reachClamp(placed, arms.right.shoulder);
      h.setPose('right', far ? 'palm' : 'pinch');
      h.place('right', placed.p, placed.q);
      h.solveArm('right', arms.right.shoulder, arms.right.pole);
      if (driving) this.updateDriverHands(dt, 'left');
    } else if (it && !big && !this.dragging) {
      // both hands are derived from where the item actually is, so they never drift off it
      const local = { p: it.mesh.position.clone().sub(cam.position).applyQuaternion(inv), q: inv.clone().multiply(it.mesh.quaternion) };
      const pose = this.heldPose;
      const hp = handsOnItem(it.mesh, local, (pose && pose.item.hang) || 0, this.aim);
      const arms = (pose && pose.arms) || defaultArms();
      h.setPose('right', hp.right.pose);
      h.place('right', hp.right.p, hp.right.q);
      h.solveArm('right', arms.right.shoulder, arms.right.pole);
      if (hp.left) {
        h.left.visible = true;
        h.setPose('left', hp.left.pose);
        h.place('left', hp.left.p, hp.left.q);
        h.solveArm('left', arms.left.shoulder, arms.left.pole);
      } else if (driving) this.updateDriverHands(dt, 'left');
    } else if (it && this.dragging) {
      // the hand on the point it is dragged by
      this.handOnPoint(this.dragAt || it.mesh.position, inv, this.dragN ? this.dragN.clone().applyQuaternion(it.mesh.quaternion) : null);
    } else if (it && big) {
      // carried in both hands: each hand takes the lower part of a side of the item as the camera
      // sees it, no further out than the arms reach; palms in, fingers forward
      const c = it.mesh.position.clone().sub(cam.position).applyQuaternion(inv);
      const q = inv.clone().multiply(it.mesh.quaternion);
      const sz = it.size;
      const lo = V(Infinity, Infinity, Infinity),
        hi = V(-Infinity, -Infinity, -Infinity);
      for (let k = 0; k < 8; k++) {
        const v = V(k & 1 ? sz.x / 2 : -sz.x / 2, k & 2 ? sz.y / 2 : -sz.y / 2, k & 4 ? sz.z / 2 : -sz.z / 2).applyQuaternion(q).add(c);
        lo.min(v);
        hi.max(v);
      }
      const arms = defaultArms();
      h.left.visible = true;
      // a plank or a sheet: flat hands underneath (curled fingers would come up through it)
      const thin = Math.min(sz.x, sz.y, sz.z) < 0.06;
      for (const side of ['right', 'left']) {
        const sg = side === 'left' ? -1 : 1;
        const edge = sg > 0 ? hi.x : lo.x;
        const x = clamp(edge - sg * 0.03, c.x - 0.32, c.x + 0.32);
        // round the sides a little below the middle (a wheel at three and nine o'clock)
        const y = c.y - Math.min(0.06, (hi.y - lo.y) * 0.06);
        // palm toward the item when the hand is at its edge; from below when the item is too wide
        const wide = thin || Math.abs(edge - x) > 0.08 ? 1 : 0;
        const thumb = wide ? V(sg, 0.1, 0.25) : V(0.15 * sg, 1, 0.2);
        const wrist = wide ? V(0.25 * sg, -0.5, 0.85) : V(0.45 * sg, -0.35, 0.8);
        // the hands stay on the item as it is pulled in or pushed out; beyond the arms' reach they
        // stretch toward it, open, steadying rather than gripping
        const anchor = { p: V(x, thin ? lo.y - 0.002 : wide ? lo.y + 0.01 : y, Math.min(-0.24, c.z + 0.05)), q: anchorQFor(side, thumb, wrist) };
        const placed = handFromAnchor(side, 'carry', anchor);
        const far = reachClamp(placed, arms[side].shoulder);
        h.setPose(side, far || thin ? 'palm' : 'carry');
        h.place(side, placed.p, placed.q);
        h.solveArm(side, arms[side].shoulder, arms[side].pole);
      }
    } else if (this.grab && this.grab.point) {
      // the hand on the point taken hold of, going where the door, lid or winder goes
      const G = this.grab;
      this.handOnPoint(G.kind === 'crank' ? this.game.car.worldPointOf(G.t.hotspot.pos) : G.point, inv, G.kind === 'crank' ? null : this.grabNormal(G));
      if (driving) this.updateDriverHands(dt, 'left');
    } else if (this.fists && !seated) {
      // fists up in a loose guard; the punching hand goes out toward the middle and comes back
      const p = this.game.player;
      const arms = defaultArms();
      const P = this.punch;
      const out = P.t < 0.32 ? 1 - Math.pow(1 - P.t / 0.32, 2) : P.t < 0.42 ? 1 : 1 - smoothstep(0.42, 1, P.t);
      const bob = Math.sin(p.bob * 2) * p.bobAmp * 0.01;
      h.left.visible = true;
      for (const [side, sg] of [
        ['right', 1],
        ['left', -1],
      ]) {
        const k = P.side === side && P.t < 1 ? out : 0;
        // (a closed hand: the grip pose with nothing in it reads as a fist)
        const guard = V(0.13 * sg, -0.135 + bob, side === 'left' ? -0.4 : -0.37);
        const pos = guard.lerp(V(0.03 * sg, -0.08, -0.6), k);
        // knuckles forward, thumb up and a little in, the wrist straight with the forearm
        const anchor = { p: pos, q: naturalQ(side, pos, V(-0.35 * sg, 1, 0), arms[side].shoulder, arms[side].pole) };
        const placed = handFromAnchor(side, 'grip', anchor);
        h.setPose(side, 'grip');
        h.place(side, placed.p, placed.q);
        h.solveArm(side, arms[side].shoulder, arms[side].pole);
      }
    } else if (driving && this.updateDriverHands(dt)) {
      // hands on the wheel
    } else {
      // idle: relaxed right hand low at the edge of the view; reaching when targeting
      const p = this.game.player;
      const reach = this.target && !seated ? 1 : 0;
      this.reachT = lerp(this.reachT || 0, reach, Math.min(1, dt * 6));
      const k = this.reachT;
      const pos = V(0.22, -0.3, -0.36).lerp(V(0.13, -0.2, -0.46), k * 0.7);
      pos.y += Math.sin(p.bob * 2) * p.bobAmp * 0.012;
      // the hand carries on from the forearm, thumb up and in (palm toward the middle, turning
      // down a little as it reaches)
      const arms = defaultArms();
      const anchor = { p: pos, q: naturalQ('right', pos, V(-0.5 - k * 0.3, 1 - k * 0.3, 0), arms.right.shoulder, arms.right.pole) };
      const placed = handFromAnchor('right', 'relax', anchor);
      h.setPose('right', k > 0.5 ? 'pinch' : 'relax');
      h.place('right', placed.p, placed.q);
      h.solveArm('right', arms.right.shoulder, arms.right.pole);
      h.right.visible = k > 0.15;
    }
  }
}
