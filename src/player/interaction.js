// Interaction: what the player is looking at, highlighting, picking up / carrying / rotating /
// throwing items, using items on targets (eat, drink, pour, repair, shoot), car doors and seats,
// removing and installing car parts with a mount-point preview.

import * as THREE from 'three';
import { GROUPS } from '../physics/physics.js';
import { input } from '../core/input.js';
import { settings } from '../core/settings.js';
import { ITEMS } from '../items/itemDefs.js';
import { carType } from '../vehicle/types.js';
import { paintOf } from '../vehicle/paints.js';
import { fitMatrix } from '../vehicle/swap.js';
import { PLATES, plateSpot, plateWorldMatrix, plateModel, attachPlate, detachPlate, plateUnderRay, paintPlate } from '../vehicle/plates.js';
import { ACCESSORIES, MOUNT_LABEL, buildAccessory, fitAccessory, removeAccessory, canRemoveAccessory, cargoZone } from '../vehicle/accessories.js';
import { Hands, PALM_CONTACT } from './hands.js';
import { holdPose, handsOnItem, handFromAnchor, frameQ, anchorQ, anchorQFor, defaultArms } from './grips.js';
import { HOTBAR, fitsInBag } from '../items/inventory.js';
import { ALBUMS } from '../audio/music/albums.js';
import { clamp, lerp } from '../core/noise.js';


// Part table entry of a part item (it remembers which kind of car it came off).
function partDefOf(it) {
  return carType(it.state && it.state.carType).PARTS[it.part] || { label: it.part, mass: 10 };
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const REACH = 2.6;
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
        const cand = this.carTarget(origin, dir, Math.min(reach, hitDist + 0.35));
        if (cand && (!best || cand.dist < best.dist - 0.02)) best = cand;
      }
    }
    // poi doors, pumps
    if (hit && hit.owner && hit.distance <= reach) {
      if (hit.owner.kind === 'door' && (!best || hit.distance < best.dist)) best = { kind: 'poiDoor', door: hit.owner.door, dist: hit.distance };
    }
    if (g.pois && (!best || best.kind !== 'item')) {
      const tip = origin.clone().addScaledVector(dir, Math.min(reach, hitDist));
      const pump = g.pois.nearestPump(tip, 0.9);
      if (pump && pump.world.distanceTo(origin) < reach + 0.6) best = { kind: 'pump', pump, dist: pump.world.distanceTo(origin) };
    }
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
    const part = car.model.parts[id];
    const m = new THREE.Matrix4().copy(car.root.matrixWorld);
    if (part.hinge) {
      const o = part.hinge.origin;
      m.multiply(new THREE.Matrix4().makeTranslation(o.x, o.y, o.z))
        .multiply(new THREE.Matrix4().makeRotationFromQuaternion(part.pivot.quaternion))
        .multiply(new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z));
    }
    return m;
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
    // hotspots
    const cinv = new THREE.Matrix4().copy(car.root.matrixWorld).invert();
    const lo = origin.clone().applyMatrix4(cinv);
    const ld = dir.clone().transformDirection(cinv);
    let hs = null;
    for (const h of car.type.HOTSPOTS) {
      if (!car.isInstalled(h.part)) continue;
      if (h.lid && !car.lidOpen(h.lid)) continue;
      if (h.inside && !this.game.player.seat) continue;
      const toC = h.pos.clone().sub(lo);
      const t = toC.dot(ld);
      if (t < 0 || t > maxDist + 0.2) continue;
      const dd = toC.addScaledVector(ld, -t).length();
      if (dd < h.r && (!hs || t < hs.dist)) hs = { kind: 'hotspot', hotspot: h, dist: t };
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
    let best = pick ? (pick.plate ? { kind: 'plate', plate: pick.plate, dist: pick.d } : pick.acc ? { kind: 'accessory', mount: pick.id, dist: pick.d } : { kind: 'part', part: pick.id, dist: pick.d }) : null;
    if (seat && (!best || seat.dist < best.dist + 0.4)) best = seat;
    if (hs && (!best || hs.dist < best.dist + 0.25)) best = hs;
    return best;
  }

  // ------------------------------------------------------------------ main update
  update(dt) {
    const g = this.game;
    const ui = g.hud;
    const blocked = g.ui && g.ui.blocksMove;
    const p = g.player;
    if (p.dead) return;
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.target = this.findTarget();
    const t = this.target;
    const prompts = [];
    let info = null;
    const kn = (a) => (settings.data.bindings[a] || '').replace(/^Key|^Digit/, '');
    // ---- held item logic
    if (this.held) {
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
          prompts.push(['E', `Bolt to the ${(this.game.car.PARTS[spot.part] || { label: spot.part }).label.toLowerCase()}`], ['Wheel', 'Turn it']);
          if (!blocked && input.wasPressed('interact')) this.boltHeldPlate(it, spot);
        } else {
          this.hideGhost();
          prompts.push(['', 'Aim at any part of a car to bolt it on']);
        }
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
        this.hideGhost();
        info = this.heldInfo(it);
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
        prompts.push(...r.prompts);
        if (!blocked) this.handleTargetInput(t, dt);
      } else this.removing = null;
      if (p.seat && g.car && !blocked && input.wasPressed('nextTrack') && g.car.stereo.disc >= 0) {
        if (g.car.stereo.mode === 'cd') g.car.nextTrack();
        else g.car.stereo.mode = 'cd';
        g.car.radioOn = true;
        g.audio && g.audio.play('click');
      }
      if (!t && p.seat && g.car && Math.abs(g.car.speedKmh) < 3) {
        prompts.push([kn('interact'), 'Get out']);
        if (g.car && !g.car.dyn.engine.running) prompts.push([kn('sleep'), 'Sleep']);
      }
      if (!blocked) {
        this.hotbarKeys();
        // Q on something lying about: straight into the backpack
        if (input.wasPressed('stow') && t && t.kind === 'item' && !t.item.part) this.lootToBag(t.item);
      }
    }
    if (ui) {
      ui.setPrompts(prompts);
      ui.setTargetInfo(info);
      ui.setCrosshair(this.held && this.held.def && this.held.def.weapon ? 'gun' : t ? 'active' : p.seat === 'driver' ? 'none' : 'dot');
    }
    // outline highlight
    this.updateOutline(t);
    // stow watch: items resting inside the car become attached to it
    this.updateStowing(dt);
  }

  heldInfo(it) {
    const def = it.def;
    const s = it.state;
    let sub = '';
    let bar = null;
    if (def.liquid) {
      sub = `${(s.liquid || 0).toFixed(1)} / ${def.liquid.cap} l ${s.liquidType === 'fuel' ? 'fuel' : s.liquidType}`;
      bar = (s.liquid || 0) / def.liquid.cap;
    } else if (def.consume) {
      const parts = [];
      if (def.consume.food > 0) parts.push(`food +${def.consume.food}`);
      if (def.consume.water > 0) parts.push(`water +${def.consume.water}`);
      if (def.consume.health > 0) parts.push(`health +${def.consume.health}`);
      sub = parts.join(' · ');
    } else if (def.weapon) sub = `${s.loaded || 0} / ${def.weapon.mag}  ·  pouch ${this.ammo[def.weapon.ammo] || 0}`;
    else if (def.charges !== undefined) sub = `${s.charges} use${s.charges === 1 ? '' : 's'} left`;
    else if (def.ammo) sub = `${def.ammo.count} rounds`;
    return { title: it.name, sub, bar, desc: def.desc };
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
    if (def.wrap) out.push(['LMB', 'Wrap up']);
    if (def.ammo) out.push(['LMB', 'Put in pouch']);
    if (def.readable) out.push(['LMB', 'Read']);
    if (def.disc) out.push(['LMB', t && t.kind === 'hotspot' && t.hotspot.id === 'radio' ? (car.stereo.disc >= 0 ? 'Swap discs' : 'Put in the stereo') : 'Look at the stereo to play']);
    if (def.clean) out.push(['LMB', t && (t.kind === 'part' || t.kind === 'hotspot') ? 'Wash the car (hold)' : 'Look at the car to wash it']);
    if (def.paint) {
      const car = this.game.car;
      if (t && t.kind === 'part' && car && car.paintable(t.part)) out.push(['LMB', `Paint the ${car.PARTS[t.part].label.toLowerCase()} (hold)`]);
      else if (t && t.kind === 'plate') out.push(['LMB', `Paint the ${PLATES[t.plate.id].name.toLowerCase()} (hold)`]);
      else out.push(['', 'Aim at a body panel to paint it']);
    }
    if (def.light) out.push(['LMB', it.state.on ? 'Switch off' : 'Switch on']);
    if (def.liquid) {
      const tgt = this.pourTarget(it, t);
      if (tgt) out.push(['LMB', tgt.label + ' (hold)']);
      else if (def.drinkable || it.state.liquidType === 'water') out.push(['LMB', 'Drink (hold)']);
    }
    if (def.charges !== undefined && t && t.kind === 'hotspot') {
      // repair kits on the engine / wheels
    }
    if ((it.id === 'repairKit' || it.id === 'extinguisher') && t && (t.kind === 'part' || t.kind === 'hotspot') && car) out.push(['LMB', it.id === 'repairKit' ? 'Repair engine' : 'Extinguish']);
    if (it.id === 'tyreKit' && t && t.kind === 'part' && t.part.startsWith('wheel')) out.push(['LMB', 'Repair tyre']);
    return out;
  }

  pourTarget(it, t) {
    const type = it.state.liquidType;
    if (!t) return null;
    const car = this.game.car;
    if (t.kind === 'hotspot') {
      const h = t.hotspot.id;
      if (type === 'fuel' && h === 'fuel' && car.isInstalled('fueltank')) return { kind: 'car', sys: 'fuel', label: 'Pour fuel' };
      if (type === 'oil' && h === 'oil') return { kind: 'car', sys: 'oil', label: 'Pour oil' };
      if (type === 'water' && h === 'coolant' && car.isInstalled('radiator')) return { kind: 'car', sys: 'coolant', label: 'Top up the radiator' };
    }
    if (t.kind === 'pump' && type === 'fuel') return { kind: 'pump', label: 'Fill from pump' };
    if (t.kind === 'item' && t.item.def && t.item.def.liquid && t.item.state.liquidType === type) return { kind: 'item', item: t.item, label: 'Pour into ' + t.item.def.name.toLowerCase() };
    return null;
  }

  describeTarget(t) {
    const car = this.game.car;
    const prompts = [];
    let info = null;
    switch (t.kind) {
      case 'item': {
        const it = t.item;
        if (it.part) {
          info = { title: it.name, sub: `${carType(it.state.carType).short} part · ${partDefOf(it).mass} kg` };
        } else info = this.heldInfo(it);
        prompts.push(['E', 'Pick up']);
        if (it.def && fitsInBag(it.id, it.state)) prompts.push([(settings.data.bindings.stow || 'KeyQ').replace(/^Key/, ''), 'To backpack']);
        if (it.def && it.def.consume) prompts.push(['F', 'Use now']);
        if (it.def && it.def.readable) prompts.push(['F', 'Read']);
        break;
      }
      case 'part': {
        const id = t.part;
        const st = car.parts[id];
        const def = car.PARTS[id];
        const cond = st ? Math.round(st.condition * 100) : 100;
        info = { title: def.label, sub: `Condition ${cond}%`, bar: st ? st.condition : 1 };
        const mp = car.model.parts[id];
        if (mp.hinge) prompts.push(['E', mp.openT > 0.5 ? 'Close' : 'Open']);
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
          info.sub = `${car.fuel.toFixed(1)} / ${car.fuelCap} l`;
          info.bar = car.fuel / car.fuelCap;
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
          info.sub = car.dyn.engine.running ? 'Engine running' : car.ignition ? 'Ignition on' : 'Off';
          prompts.push(['E', car.ignition ? 'Ignition off' : 'Ignition on'], ['I', 'Hold to start']);
        } else if (h.id === 'lights') {
          info.sub = ['Off', 'Low beam', 'High beam'][car.lightsOn];
          prompts.push(['E', 'Switch']);
        } else if (h.id === 'wipers') {
          info.sub = car.wipers ? 'On' : 'Off';
          prompts.push(['E', 'Switch']);
        } else if (h.id === 'radio') {
          const st = car.stereo;
          info.title = 'Stereo';
          info.sub = !car.radioOn ? 'Off' : st.mode === 'cd' && st.disc >= 0 ? `CD · ${ALBUMS[st.disc].artist} — ${ALBUMS[st.disc].tracks[st.track]}` : 'FM 98.1' + (st.disc >= 0 ? ' · disc in' : '');
          prompts.push(['E', car.radioOn ? 'Turn off' : 'Turn on']);
          if (st.disc >= 0) prompts.push(['LMB', st.mode === 'cd' ? 'Next track' : 'Play the CD'], ['R', 'Eject disc']);
          else if (car.radioOn) prompts.push(['', 'Hold a CD and click to put it in']);
        }
        break;
      }
      case 'plate': {
        const pl = t.plate;
        const d = PLATES[pl.id];
        info = { title: d.name, sub: `${d.mass} kg · bolted to the ${(car.PARTS[pl.part] || { label: pl.part }).label.toLowerCase()}` };
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
        prompts.push(['E', t.door.open > 0.5 ? 'Close' : 'Open']);
        break;
      case 'pump': {
        const st = t.pump.inst.state;
        info = { title: 'Fuel pump', sub: st.fuel > 0.5 ? `${Math.round(st.fuel)} l left in the tank` : 'Dry', bar: Math.min(1, (st.fuel || 0) / 300) };
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
    if (t.kind === 'hotspot' && t.hotspot.id === 'radio') {
      const st = car.stereo;
      if (input.mousePressed(0) && st.disc >= 0) {
        if (st.mode === 'cd') car.nextTrack();
        else {
          st.mode = 'cd';
          car.radioOn = true;
        }
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
    if (!input.wasPressed('interact') && !input.mousePressed(0)) return;
    const viaMouse = !input.wasPressed('interact');
    switch (t.kind) {
      case 'item':
        this.pick(t.item);
        break;
      case 'part': {
        if (viaMouse) return;
        const mp = car.model.parts[t.part];
        if (mp.hinge) car.toggleOpen(t.part);
        break;
      }
      case 'hotspot': {
        if (viaMouse) return;
        const h = t.hotspot.id;
        if (h === 'ignition') car.setIgnition(!car.ignition);
        if (h === 'lights') car.lightsOn = (car.lightsOn + 1) % 3;
        if (h === 'wipers') car.wipers = !car.wipers;
        if (h === 'radio') {
          car.radioOn = !car.radioOn;
          g.audio && g.audio.setRadio(car.radioOn);
        }
        g.audio && g.audio.play('click');
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
        if (viaMouse) return;
        g.pois.toggleDoor(t.door);
        break;
      case 'pump': {
        if (viaMouse) return;
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
    // heavy parts (engine, body shell) are dragged along the ground rather than carried
    this.dragging = !!(it.part && partDefOf(it).mass > 60);
    if (this.dragging) {
      g.hud && g.hud.toast(`${it.name} · ${partDefOf(it).mass} kg · too heavy to lift, dragging`);
      this.dragYaw0 = g.player.yaw;
      this.dragQ0 = it.mesh.quaternion.clone();
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
    this.holdDist = it.part || Math.max(it.size.x, it.size.y, it.size.z) > 0.55 ? 0.62 + Math.min(1, Math.max(it.size.x, it.size.y, it.size.z)) * 0.1 : 0.75;
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

  // 1-6: take that hotbar slot in hand; the same key again puts it back.
  hotbarKeys() {
    const inv = this.game.inventory;
    for (let i = 0; i < HOTBAR; i++) {
      if (!input.pressed.has('Digit' + (i + 1))) continue;
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
    this.game.hud && this.game.hud.toast('Swapped discs');
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
    if (input.mouse.wheel && def && def.plate && this.plateAim) this.plateSpin = (this.plateSpin || 0) + Math.sign(input.mouse.wheel) * (Math.PI / 12);
    else if (input.mouse.wheel && !weapon) {
      const isBig = it.part || Math.max(it.size.x, it.size.y, it.size.z) > 0.55;
      if (!isBig && !this.floating) {
        // the wheel takes a small thing out of the hand: it floats in front to be turned and moved
        this.floating = true;
        this.holdDist = 0.5;
        this.holdRot.copy(this.cam.quaternion.clone().invert().multiply(it.mesh.quaternion));
      }
      this.holdDist = clamp(this.holdDist - input.mouse.wheel * 0.08, isBig ? 0.5 : 0.38, it.part ? 3 : 1.6);
      // pulled all the way back in: into the hand again
      if (!isBig && this.holdDist < 0.42) this.floating = false;
    }
    this.aim = lerp(this.aim, weapon && input.mouseDown(2) ? 1 : 0, Math.min(1, dt * 10));
    if (this.dragging) return this.updateDrag(it, dt);
    // camera-space target
    let local, localQ;
    const big = it.part || (Math.max(it.size.x, it.size.y, it.size.z) > 0.55 && !weapon);
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
      local = V(0, -0.2 - Math.min(0.2, it.size.y * 0.22), -this.holdDist);
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
    // keep big items out of walls: pull toward the eye if the path is blocked
    if (big) {
      const dir = wp.clone().sub(cam.position);
      const len = dir.length();
      dir.normalize();
      const hit = this.game.physics.raycast(cam.position, dir, len + 0.3, GROUPS.ground, this.game.player.body);
      const rad = Math.max(it.size.x, it.size.z) * 0.45;
      if (hit && hit.distance < len + rad) wp.copy(cam.position).addScaledVector(dir, Math.max(0.35, hit.distance - rad));
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
    if (def) {
      if (def.weapon) this.updateWeapon(it, dt);
      else if (def.liquid) {
        const tgt = this.pourTarget(it, this.target);
        if (input.mouseDown(0)) this.pour(it, tgt, dt);
        else this.pouring = 0;
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
      } else if (def.paint) this.updateSpray(it, dt);
      else if (input.mousePressed(0)) this.useHeld();
    }
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
      if (plate) paintPlate(plate, P.hex);
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
    else if (def.clean) kind = 'wipe';
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

  // Dragging a heavy part: it slides on the ground in front of the player, turning with them;
  // RMB + mouse turns it about the vertical axis.
  updateDrag(it, dt) {
    const g = this.game;
    const p = g.player;
    if (this.rotating) this.dragYaw0 -= input.mouse.dx * 0.006;
    const yaw = p.yaw;
    const reach = 0.6 + Math.max(it.size.x, it.size.z) * 0.5;
    const tx = p.position.x + Math.sin(yaw) * reach,
      tz = p.position.z + Math.cos(yaw) * reach;
    const gy = g.groundHeightAt(tx, tz, p.position.y + 1.5);
    const target = V(tx, gy + it.size.y * 0.5 + 0.03, tz);
    const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw - this.dragYaw0).multiply(this.dragQ0);
    const k = Math.min(1, dt * 3.5);
    it.mesh.position.lerp(target, k);
    it.mesh.quaternion.slerp(q, k);
    // scraping sound while moving
    this.dragSnd = (this.dragSnd || 0) + it.mesh.position.distanceTo(this.lastDragPos || it.mesh.position);
    this.lastDragPos = (this.lastDragPos || V()).copy(it.mesh.position);
    if (this.dragSnd > 0.9) {
      this.dragSnd = 0;
      g.audio && g.audio.play('step', { surface: 'gravel', at: it.mesh.position, volume: 0.8 });
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
      this.consumeHeld();
      const cooked = g.items.spawn('cookedMeat', pos);
      this.pick(cooked);
      g.hud && g.hud.toast('Cooked over the fire');
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
      g.hud && g.hud.toast('You wrap up in the blanket');
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
        g.audio && g.audio.play('breath' in (g.audio.buffers || {}) ? 'breath' : 'click');
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
    if (def.light) {
      it.state.on = !it.state.on && (it.state.liquid || 0) > 0.01;
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
    if (def.melee) this.melee(it);
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
        car.fuel += amount;
      } else if (tgt.sys === 'oil') {
        amount = Math.min(amount, car.oilCap + 0.3 - car.oil);
        car.oil += amount;
      } else if (tgt.sys === 'coolant') {
        amount = Math.min(amount, car.coolantCap - car.coolant);
        car.coolant += amount;
      }
      if (tgt.sys === 'fuel') car.updateMass();
    } else if (tgt.kind === 'pump') {
      const st = this.target.pump.inst.state;
      amount = Math.min(rate * 2 * dt, it.def.liquid.cap - s.liquid, st.fuel);
      st.fuel -= amount;
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
      const mesh = this.game.items.buildPartMesh(it.part, it.state.carType);
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
    car.owned = true;
    if (it.state.color !== undefined) car.paintPart(slot, it.state.color);
    // a foreign panel keeps the paint of the car it came from (its own material otherwise)
    else if (car.parts[slot].from) car.paintPart(slot, carType(car.parts[slot].from).defaultColor);
    car.parts[slot].condition = cond;
    if (slot === 'battery' && it.state.charge !== undefined) car.battery = it.state.charge;
    if (slot === 'fueltank' && it.state.fuel !== undefined) car.fuel = it.state.fuel;
    if (slot === 'fanbelt') car.fanbeltCondition = cond;
    if (slot === 'engine' && it.state.oil !== undefined) car.oil = it.state.oil;
    const w = car.dyn.wheels.find((x) => x.id === slot);
    if (w) w.flat = cond < 0.02;
    g.stats.partsInstalled++;
    g.audio && g.audio.play('install', { at: car.worldPointOf(car.model.parts[slot].bbox.getCenter(V(0, 0, 0))) });
    g.hud && g.hud.toast(`${car.PARTS[slot].label} installed`);
    g.onPartInstalled && g.onPartInstalled(slot);
  }

  remove(id) {
    const g = this.game;
    const car = g.car;
    const mp = car.model.parts[id];
    const c = mp.bbox.getCenter(V(0, 0, 0));
    const m = this.partMatrix(car, id).multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z));
    const pos = V(0, 0, 0),
      q = new THREE.Quaternion(),
      s = V(0, 0, 0);
    m.decompose(pos, q, s);
    if (mp.hinge) car.model.setOpen(id, 0);
    const state = { condition: car.parts[id].condition, carType: car.parts[id].from || car.type.id };
    if (car.partColors && car.partColors[id] !== undefined) state.color = car.partColors[id];
    else if (car.paintable(id)) state.color = car.mats.color.getHex();
    if (id === 'battery') {
      state.charge = car.battery;
    }
    if (id === 'fueltank') {
      state.fuel = car.fuel;
      car.fuel = 0;
    }
    if (id === 'fanbelt') state.condition = car.fanbeltCondition;
    if (id === 'engine') {
      state.oil = car.oil;
    }
    car.setInstalled(id, false);
    car.owned = true;
    const it = g.items.spawnPart(id, pos, q, state);
    g.audio && g.audio.play('remove', { at: pos });
    if (car.PARTS[id].mass <= 60) this.pick(it);
    else g.hud && g.hud.toast(`${car.PARTS[id].label} removed — too heavy to carry`);
  }

  // ------------------------------------------------------------------ plates
  plateFit(it) {
    const car = this.game.car;
    this.plateAim = null;
    if (!car || this.game.player.seat) return null;
    const dir = V(0, 0, -1).applyQuaternion(this.cam.quaternion);
    const right = V(1, 0, 0).applyQuaternion(this.cam.quaternion);
    const d = PLATES[it.def.plate];
    const spot = plateSpot(car, this.cam.position, dir, 2.6, this.plateSpin || 0, right, d);
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
    const car = g.car;
    const mp = car.model.parts[spot.part];
    const local = new THREE.Matrix4().copy(mp.pivot.matrixWorld).invert().multiply(plateWorldMatrix(it.def.plate, spot));
    this.hideGhost();
    this.held = null;
    g.player.carryMass = 0;
    g.items.destroy(it);
    attachPlate(car, { id: it.def.plate, state: { ...it.state }, part: spot.part, local });
    car.owned = true;
    g.audio && g.audio.play('install', { at: spot.point });
    g.hud && g.hud.toast(`${PLATES[it.def.plate].name} bolted on · ${PLATES[it.def.plate].mass} kg`);
  }

  unboltPlate(plate) {
    const g = this.game;
    const car = g.car;
    const pos = V(0, 0, 0),
      q = new THREE.Quaternion(),
      s = V(0, 0, 0);
    plate.mesh.matrixWorld.decompose(pos, q, s);
    detachPlate(car, plate);
    const it = g.items.spawn(plate.id, pos, q, { ...plate.state });
    g.audio && g.audio.play('remove', { at: pos });
    this.pick(it);
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
    g.hud && g.hud.toast(`${def.label} fitted · ${def.mass} kg on the ${MOUNT_LABEL[def.mount]}`);
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
    g.hud && g.hud.toast(`${def.label} taken off`);
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
  driverReach(target) {
    this.reach = { target, t: 0 };
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
      const radW = V(Math.cos(a), Math.sin(a), 0).transformDirection(pivotW);
      const nW = V(0, 0, 1).transformDirection(pivotW);
      // fist round the rim: thumb side toward 12 o'clock, back of the hand outward and a little
      // toward the driver, so the wrist points back at the elbow
      const thumb = side === 'left' ? tanW.clone().negate() : tanW.clone();
      const back = radW.clone().multiplyScalar(0.9).addScaledVector(nW, 0.4);
      const anchor = { p: toCam(rimW), q: inv.clone().multiply(frameQ(thumb, back)) };
      const placed = handFromAnchor(side, 'grip', anchor);
      let pose = 'grip';
      let posC = placed.p,
        qC = placed.q;
      // reaching for a control (right hand for key/shifter, left for the stalk)
      const r = this.reach;
      if (r && ((side === 'right' && r.target !== 'stalk') || (side === 'left' && r.target === 'stalk'))) {
        const k = Math.sin(Math.min(1, r.t) * Math.PI);
        const tp = this.controlPoint(car, r.target).applyMatrix4(car.root.matrixWorld);
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
    if (this.reach && !only) {
      this.reach.t += dt * 2.2;
      if (this.reach.t >= 1) this.reach = null;
    }
    return true;
  }

  // ------------------------------------------------------------------ view model
  updateView(dt) {
    const cam = this.cam;
    this.viewRoot.position.copy(cam.position);
    this.viewRoot.quaternion.copy(cam.quaternion);
    const it = this.held;
    const h = this.hands;
    const big = it && (it.part || (Math.max(it.size.x, it.size.y, it.size.z) > 0.55 && !(it.def && it.def.weapon)));
    const seated = !!this.game.player.seat;
    const driving = seated && this.game.player.seat === 'driver';
    h.right.visible = true;
    h.left.visible = false;
    const inv = cam.quaternion.clone().invert();
    if (it && !big && this.floating && !this.dragging) {
      // reaching for the floating thing while it is within arm's length
      const c = it.mesh.position.clone().sub(cam.position).applyQuaternion(inv);
      const near = c.length() < 0.62;
      h.right.visible = near;
      if (near) {
        const anchor = { p: c.clone().add(V(0.05, -0.04, 0.03)), q: anchorQ(V(-0.2, 1, 0.1), V(0.45, -0.3, 0.85)) };
        const placed = handFromAnchor('right', 'pinch', anchor);
        placed.p.add(PALM_CONTACT.clone().sub(PINCH_TIP).applyQuaternion(placed.q));
        h.setPose('right', 'pinch');
        h.place('right', placed.p, placed.q);
        const arms = defaultArms();
        h.solveArm('right', arms.right.shoulder, arms.right.pole);
      }
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
      h.right.visible = false;
      h.left.visible = false;
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
      for (const side of ['right', 'left']) {
        const sg = side === 'left' ? -1 : 1;
        const edge = sg > 0 ? hi.x : lo.x;
        const x = clamp(edge - sg * 0.03, c.x - 0.32, c.x + 0.32);
        // round the sides a little below the middle (a wheel at three and nine o'clock)
        const y = c.y - Math.min(0.12, (hi.y - lo.y) * 0.12);
        // palm toward the item when the hand is at its edge; from below when the item is too wide
        const wide = Math.abs(edge - x) > 0.08 ? 1 : 0;
        const thumb = wide ? V(sg, 0.1, 0.25) : V(0.15 * sg, 1, 0.2);
        const wrist = wide ? V(0.25 * sg, -0.5, 0.85) : V(0.45 * sg, -0.35, 0.8);
        const anchor = { p: V(x, wide ? lo.y + 0.01 : y, clamp(c.z + 0.05, -0.6, -0.3)), q: anchorQFor(side, thumb, wrist) };
        const placed = handFromAnchor(side, 'carry', anchor);
        h.setPose(side, 'carry');
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
      const anchor = { p: pos, q: anchorQ(V(-0.35, 0.3 + k * 0.4, -0.9), V(0.4, -0.35, 0.85)) };
      const placed = handFromAnchor('right', 'relax', anchor);
      h.setPose('right', k > 0.5 ? 'pinch' : 'relax');
      h.place('right', placed.p, placed.q);
      const arms = defaultArms();
      h.solveArm('right', arms.right.shoulder, arms.right.pole);
      h.right.visible = k > 0.15;
    }
  }
}
