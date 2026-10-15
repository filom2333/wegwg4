// Interaction: what the player is looking at, highlighting, picking up / carrying / rotating /
// throwing items, using items on targets (eat, drink, pour, repair, shoot), car doors and seats,
// removing and installing car parts with a mount-point preview.

import * as THREE from 'three';
import { GROUPS } from '../physics/physics.js';
import { input } from '../core/input.js';
import { settings } from '../core/settings.js';
import { ITEMS } from '../items/itemDefs.js';
import { PARTS, PART_FAMILY } from '../vehicle/carParts.js';
import { HOTSPOTS, SEATS } from '../vehicle/car.js';
import { Hands } from './hands.js';
import { clamp, lerp } from '../core/noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const REACH = 2.6;
const tmpM = new THREE.Matrix4();
const tmpRay = new THREE.Ray();
const tmpV = new THREE.Vector3();

// Hold presets in camera space: hand placement and item offset relative to the hand.
const HOLD = {
  hand: { hand: V(0.2, -0.2, -0.36), rotZ: -Math.PI / 2, pose: 'grip', item: V(-0.03, 0.0, -0.065), itemRot: new THREE.Euler(0, 0, 0) },
  // carried by the top handle, hanging low at the right side (handle bar inside the curled fingers)
  side: { hand: V(0.24, -0.25, -0.5), rotZ: 0, pose: 'grip', item: V(0.05, -0.295, -0.08), itemRot: new THREE.Euler(0, Math.PI / 2, 0) },
  tool: { hand: V(0.22, -0.22, -0.36), rotZ: -Math.PI / 2, pose: 'grip', item: V(-0.035, 0.0, -0.06), itemRot: new THREE.Euler(-0.75, Math.PI / 2, Math.PI / 2, 'XYZ') },
  // weapon models are authored muzzle along +Z; turned 180 degrees so the muzzle points away
  pistol: { hand: V(0.17, -0.18, -0.34), rotZ: -Math.PI / 2, pose: 'pistol', item: V(-0.028, 0.032, -0.098), itemRot: new THREE.Euler(0, Math.PI, 0) },
  rifle: { hand: V(0.16, -0.2, -0.3), rotZ: -Math.PI / 2, pose: 'pistol', item: V(-0.028, 0.032, -0.12), itemRot: new THREE.Euler(0, Math.PI, 0), left: V(-0.02, -0.21, -0.62) },
};

export class Interaction {
  constructor(game) {
    this.game = game;
    this.cam = game.renderer.camera;
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
    this.pockets = [null, null, null, null, null, null];
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
      if (!car.isInstalled(id) || id === 'body' || id === 'chassis' || id === 'fuelflap') continue;
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
    for (const h of HOTSPOTS) {
      if (!car.isInstalled(h.part)) continue;
      if (h.hood && car.isInstalled('hood') && car.model.parts.hood.openT < 0.5) continue;
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
      for (const [name, s] of Object.entries(SEATS)) {
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
    list.sort((a, b) => a.d - b.d);
    let pick = null;
    if (list.length) {
      pick = list[0];
      for (const c of list) if (c.d - list[0].d < 0.15 && c.vol < pick.vol) pick = c;
    }
    let best = pick ? { kind: 'part', part: pick.id, dist: pick.d } : null;
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
    // ---- held item logic
    if (this.held) {
      const it = this.held;
      this.updateHeld(dt);
      const def = it.def;
      if (it.part) {
        const fit = this.partFit(it);
        info = { title: it.name, sub: `${PARTS[it.part].mass} kg` };
        if (fit) {
          this.showGhost(it, fit.ok);
          if (fit.ok) prompts.push(['E', 'Install ' + PARTS[fit.slot].label.toLowerCase()]);
          else prompts.push(['', fit.reason]);
          if (fit.ok && !blocked && input.wasPressed('interact')) this.install(it, fit.slot);
        } else this.hideGhost();
      } else {
        this.hideGhost();
        info = this.heldInfo(it);
        for (const pr of this.useOptions(it, t)) prompts.push(pr);
      }
      prompts.push(['G', 'Drop', 'hold to throw']);
      if (!def || !def.weapon) prompts.push(['RMB', 'Rotate']);
      if (def && def.mass < 1.2 && !it.part) prompts.push(['Q', 'Pocket']);
      if (!blocked) {
        if (input.isDown('drop')) this.dropHold += dt;
        if (input.wasReleased('drop')) {
          this.drop(this.dropHold > 0.35 ? 9 + Math.min(1, this.dropHold) * 3 : 0);
          this.dropHold = 0;
        }
        if (input.wasPressed('KeyQ') || input.pressed.has('KeyQ')) this.pocketHeld();
      }
    } else {
      this.hideGhost();
      if (t) {
        const r = this.describeTarget(t);
        info = r.info;
        prompts.push(...r.prompts);
        if (!blocked) this.handleTargetInput(t, dt);
      } else this.removing = null;
      if (!t && p.seat && g.car && Math.abs(g.car.speedKmh) < 3) {
        const kn = (a) => (settings.data.bindings[a] || '').replace(/^Key|^Digit/, '');
        prompts.push([kn('interact'), 'Get out']);
        if (g.car && !g.car.dyn.engine.running) prompts.push([kn('sleep'), 'Sleep']);
      }
      if (!blocked) {
        for (let i = 0; i < 6; i++) if (input.pressed.has('Digit' + (i + 1))) this.unpocket(i);
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
    return { title: def.name, sub, bar, desc: def.desc };
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
    if (def.consume) out.push(['LMB', def.consume.food > 0 ? 'Eat' : def.consume.health > 0 ? 'Use' : 'Drink']);
    if (def.ammo) out.push(['LMB', 'Put in pouch']);
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
      if ((type === 'coolant' || type === 'water') && h === 'coolant') return { kind: 'car', sys: 'coolant', label: 'Top up coolant' };
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
          info = { title: it.name, sub: `Car part · ${PARTS[it.part].mass} kg` };
        } else info = this.heldInfo(it);
        prompts.push(['E', 'Pick up']);
        if (it.def && it.def.consume) prompts.push(['F', 'Use now']);
        break;
      }
      case 'part': {
        const id = t.part;
        const st = car.parts[id];
        const def = PARTS[id];
        const cond = st ? Math.round(st.condition * 100) : 100;
        info = { title: def.label, sub: `Condition ${cond}%`, bar: st ? st.condition : 1 };
        const mp = car.model.parts[id];
        if (mp.hinge) prompts.push(['E', mp.openT > 0.5 ? 'Close' : 'Open']);
        const rem = car.canRemove(id);
        if (rem.ok) prompts.push(['R', 'Remove (hold)']);
        else if (!mp.hinge) prompts.push(['', rem.reason]);
        if (this.removing && this.removing.part === id) info.progress = this.removing.t / this.removeTime(id);
        if (id === 'engine') info.sub = `Condition ${Math.round(car.engineCondition * 100)}% · ${Math.round(car.engineTemp)}°C`;
        if (id === 'battery') info.sub = `Charge ${Math.round(car.battery * 100)}%`;
        if (id === 'radiator') info.sub = `Condition ${Math.round(car.radiatorCondition * 100)}% · coolant ${car.coolant.toFixed(1)} l`;
        if (id === 'fueltank') info.sub = `${car.fuel.toFixed(1)} / ${car.fuelCap} l`;
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
          prompts.push(['E', car.model.parts.fuelflap.openT > 0.5 ? 'Close flap' : 'Open flap']);
        } else if (h.id === 'oil') {
          info.sub = `${car.oil.toFixed(2)} / ${car.oilCap} l`;
          info.bar = car.oil / car.oilCap;
        } else if (h.id === 'coolant') {
          info.sub = `${car.coolant.toFixed(1)} / ${car.coolantCap} l`;
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
        } else if (h.id === 'radio') {
          info.sub = car.radioOn ? 'On' : 'Off';
          prompts.push(['E', car.radioOn ? 'Turn off' : 'Turn on']);
        }
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
        const carNear = car && car.worldPointOf(HOTSPOTS[0].pos).distanceTo(t.pump.world) < 5.5;
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
    const m = PARTS[id].mass;
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
    if (!input.isDown('reload')) this.removing = null;
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
        if (h === 'fuel') car.toggleOpen('fuelflap');
        if (h === 'ignition') car.setIgnition(!car.ignition);
        if (h === 'lights') car.lightsOn = (car.lightsOn + 1) % 3;
        if (h === 'radio') {
          car.radioOn = !car.radioOn;
          g.audio && g.audio.setRadio(car.radioOn);
        }
        g.audio && g.audio.play('click');
        break;
      }
      case 'seat': {
        if (viaMouse) return;
        g.player.enterSeat(car, t.seat);
        g.audio && g.audio.play('seat');
        const door = SEATS[t.seat].door;
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
        else if (car.worldPointOf(HOTSPOTS[0].pos).distanceTo(t.pump.world) < 5.5 && t.pump.inst.state.fuel > 0.5) g.refuel = { active: true, pump: t.pump };
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
    this.dragging = !!(it.part && PARTS[it.part].mass > 60);
    if (this.dragging) {
      g.hud && g.hud.toast(`${it.name} · ${PARTS[it.part].mass} kg · too heavy to lift, dragging`);
      this.dragYaw0 = g.player.yaw;
      this.dragQ0 = it.mesh.quaternion.clone();
    }
    g.items.take(it);
    this.held = it;
    // keep the current orientation relative to the camera so the item doesn't snap
    const camQ = this.cam.quaternion.clone();
    this.holdRot.copy(camQ.clone().invert().multiply(it.mesh.quaternion));
    if (it.def && HOLD[it.def.hold]) this.holdRot.identity();
    this.holdDist = it.part ? 0.9 + Math.max(it.size.x, it.size.y, it.size.z) * 0.55 : 0.75;
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

  pocketHeld() {
    const it = this.held;
    if (!it || it.part || it.def.mass > 1.2) return;
    const i = this.pockets.indexOf(null);
    if (i < 0) {
      this.game.hud && this.game.hud.toast('Pockets are full');
      return;
    }
    this.pockets[i] = { id: it.id, state: it.state };
    it.mesh.parent && it.mesh.parent.remove(it.mesh);
    this.game.items.items.delete(it);
    this.held = null;
    this.dragging = false;
    this.game.player.carryMass = 0;
    this.game.audio && this.game.audio.play('pocket');
  }

  unpocket(i) {
    const s = this.pockets[i];
    if (!s || this.held) return;
    const it = this.game.items.spawn(s.id, this.cam.position.clone().add(V(0, -0.3, 0)), new THREE.Quaternion(), s.state);
    this.pockets[i] = null;
    this.pick(it);
  }

  // ------------------------------------------------------------------ held item placement
  updateHeld(dt) {
    const it = this.held;
    const cam = this.cam;
    const def = it.def;
    const hold = def ? HOLD[def.hold] : null;
    // rotation with RMB (not for weapons: RMB aims)
    const weapon = def && def.weapon;
    this.rotating = !weapon && input.mouseDown(2);
    if (this.rotating) {
      const qx = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), input.mouse.dx * 0.008);
      const qy = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), input.mouse.dy * 0.008);
      this.holdRot.premultiply(qx).premultiply(qy);
    }
    if (input.mouse.wheel && !weapon) this.holdDist = clamp(this.holdDist - input.mouse.wheel * 0.08, 0.5, it.part ? 3 : 1.6);
    this.aim = lerp(this.aim, weapon && input.mouseDown(2) ? 1 : 0, Math.min(1, dt * 10));
    if (this.dragging) return this.updateDrag(it, dt);
    // camera-space target
    let local, localQ;
    const big = it.part || (Math.max(it.size.x, it.size.y, it.size.z) > 0.55 && !(it.def && it.def.weapon));
    if (hold && !big) {
      const h = hold.hand.clone();
      if (weapon) h.lerp(V(0, -0.12, -0.32), this.aim);
      local = h.clone().add(hold.item.clone().applyAxisAngle(V(0, 0, 1), 0));
      localQ = new THREE.Quaternion().setFromEuler(hold.itemRot);
      if (!weapon && !this.rotating && this.holdRot.angleTo(new THREE.Quaternion()) > 1e-3 && this.userRotated) localQ.copy(this.holdRot);
      if (this.rotating) {
        this.userRotated = true;
        localQ.copy(this.holdRot);
        local = V(0, -0.05, -0.5);
      } else if (this.userRotated) local = V(0.05, -0.1, -0.5);
    } else {
      // big items float in front at holdDist, slightly below centre
      local = V(0, -0.18 - Math.min(0.25, it.size.y * 0.25), -this.holdDist);
      localQ = this.holdRot.clone();
    }
    // use / recoil animation
    if (this.useAnim > 0) {
      const k = Math.sin(Math.min(1, this.useAnim) * Math.PI);
      local = local.clone().lerp(V(0, -0.12, -0.22), k);
    }
    if (this.recoil > 0) {
      local = local.clone().add(V(0, 0.01 * this.recoil, 0.05 * this.recoil));
      localQ = localQ.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), 0.25 * this.recoil));
      this.recoil = Math.max(0, this.recoil - dt * 6);
    }
    // weapon sway from look motion
    const lookDx = input.mouse.dx,
      lookDy = input.mouse.dy;
    this.sway.lerp(V(-lookDx * 0.0006, lookDy * 0.0006, 0), Math.min(1, dt * 8));
    local.add(this.sway);
    // world transform
    const wp = local.clone().applyQuaternion(cam.quaternion).add(cam.position);
    const wq = cam.quaternion.clone().multiply(localQ);
    // keep big items out of walls: pull toward the eye if the path is blocked
    if (big) {
      const dir = wp.clone().sub(cam.position);
      const len = dir.length();
      dir.normalize();
      const hit = this.game.physics.raycast(cam.position, dir, len + 0.3, GROUPS.ground, this.game.player.body);
      const rad = Math.max(it.size.x, it.size.z) * 0.45;
      if (hit && hit.distance < len + rad) wp.copy(cam.position).addScaledVector(dir, Math.max(0.35, hit.distance - rad));
    }
    // smooth follow (mass makes heavy items lag)
    const follow = Math.min(1, dt * (big ? 14 / Math.sqrt(Math.max(1, it.mass / 8)) : 30));
    this.holdLerp = Math.min(1, (this.holdLerp || 0) + dt * 4);
    if (this.holdLerp < 1 || big) {
      it.mesh.position.lerp(wp, this.holdLerp < 1 ? follow * 0.6 : follow);
      it.mesh.quaternion.slerp(wq, follow);
    } else {
      it.mesh.position.copy(wp);
      it.mesh.quaternion.copy(wq);
    }
    // ---- using the held item
    if (this.useAnim > 0) this.useAnim -= dt * 1.6;
    const blocked = this.game.ui && this.game.ui.blocksMove;
    if (blocked) return;
    if (def) {
      if (def.weapon) this.updateWeapon(it, dt);
      else if (def.liquid) {
        const tgt = this.pourTarget(it, this.target);
        if (input.mouseDown(0)) this.pour(it, tgt, dt);
        else this.pouring = 0;
      } else if (input.mousePressed(0)) this.useHeld();
    }
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
    const def = it.def;
    const g = this.game;
    const p = g.player;
    if (def.consume) {
      p.consume(def.consume);
      if (def.consume.food > 0) g.stats.meals++;
      else g.stats.drinks++;
      g.audio && g.audio.play(def.consume.food > 0 ? 'eat' : def.consume.health > 0 ? 'bandage' : 'drink');
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
    if (def.light) {
      it.state.on = !it.state.on && (it.state.liquid || 0) > 0.01;
      g.items.refreshVisual(it);
      g.audio && g.audio.play('click');
      return;
    }
    const t = this.target;
    const car = g.car;
    if (it.id === 'repairKit' && t && (t.kind === 'part' || t.kind === 'hotspot')) {
      const hoodOpen = !car.isInstalled('hood') || car.model.parts.hood.openT > 0.5;
      if (!hoodOpen) return g.hud && g.hud.toast('Open the hood first');
      car.engineCondition = Math.min(1, car.engineCondition + 0.35);
      car.radiatorCondition = Math.min(1, car.radiatorCondition + 0.4);
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
        if (car.model.parts.fuelflap.openT < 0.5) return g.hud && g.hud.toast('Open the fuel flap');
        amount = Math.min(amount, car.fuelCap - car.fuel);
        car.fuel += amount;
      } else if (tgt.sys === 'oil') {
        amount = Math.min(amount, car.oilCap + 0.3 - car.oil);
        car.oil += amount;
      } else if (tgt.sys === 'coolant') {
        amount = Math.min(amount, car.coolantCap - car.coolant);
        car.coolant += amount;
        if (s.liquidType === 'water') car.radiatorCondition = Math.max(0, car.radiatorCondition - amount * 0.002);
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
    const fam = PART_FAMILY[it.part];
    const slots = fam ? Object.keys(PART_FAMILY).filter((k) => PART_FAMILY[k] === fam && !car.isInstalled(k)) : [it.part];
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
      const mesh = this.game.items.buildPartMesh(it.part);
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
    const c = car.model.parts[fit.slot].bbox.getCenter(V(0, 0, 0));
    // wheels share geometry; slot centre differs
    const m = this.partMatrix(car, fit.slot).multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z));
    if (PART_FAMILY[it.part] && it.part !== fit.slot) {
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
    car.setInstalled(slot, true);
    car.parts[slot].condition = cond;
    if (slot === 'battery' && it.state.charge !== undefined) car.battery = it.state.charge;
    if (slot === 'fueltank' && it.state.fuel !== undefined) car.fuel = it.state.fuel;
    if (slot === 'radiator' && it.state.coolant !== undefined) car.coolant = it.state.coolant;
    if (slot === 'engine' && it.state.oil !== undefined) car.oil = it.state.oil;
    const w = car.dyn.wheels.find((x) => x.id === slot);
    if (w) w.flat = cond < 0.02;
    g.stats.partsInstalled++;
    g.audio && g.audio.play('install', { at: car.worldPointOf(car.model.parts[slot].bbox.getCenter(V(0, 0, 0))) });
    g.hud && g.hud.toast(`${PARTS[slot].label} installed`);
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
    const state = { condition: car.parts[id].condition };
    if (id === 'battery') {
      state.charge = car.battery;
    }
    if (id === 'fueltank') {
      state.fuel = car.fuel;
      car.fuel = 0;
    }
    if (id === 'radiator') {
      state.coolant = car.coolant;
      car.coolant = 0;
    }
    if (id === 'engine') {
      state.oil = car.oil;
    }
    car.setInstalled(id, false);
    const it = g.items.spawnPart(id, pos, q, state);
    g.audio && g.audio.play('remove', { at: pos });
    if (PARTS[id].mass <= 60) this.pick(it);
    else g.hud && g.hud.toast(`${PARTS[id].label} removed — too heavy to carry`);
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
      const inside = Math.abs(lp.x) < 0.72 && lp.y > 0.22 && lp.y < 1.35 && lp.z > -2.15 && lp.z < 0.85;
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
    const col = car.model.steeringColumn;
    if (target === 'key') return (col && col.userData.ignitionPos ? col.userData.ignitionPos.clone() : V(0.31, 0.88, 0.35)).add(V(0, 0.0, -0.02));
    if (target === 'stalk') return V(0.37 - 0.13, 0.955, 0.37);
    if (target === 'shifter') return V(0, 0.64, 0.23);
    if (target === 'horn') return V(0.37, 0.935, 0.255).addScaledVector(V(0, 0.36, -0.933).normalize(), 0.05);
    return V(0, 0, 0);
  }

  // Hands on the steering wheel (they turn with it), reaching for controls when used.
  updateDriverHands(dt) {
    const g = this.game;
    const car = g.car;
    const h = this.hands;
    const cam = this.cam;
    const sw = car.model.steeringWheel;
    const wheelObj = sw && sw.children[0];
    if (!wheelObj || !car.isInstalled('steeringWheel')) return false;
    wheelObj.updateMatrixWorld(true);
    const inv = cam.quaternion.clone().invert();
    const toCam = (wp) => wp.clone().sub(cam.position).applyQuaternion(inv);
    const R = 0.188;
    // grip points at ten-to-two, in the rotating wheel frame (X right, Y up, Z toward the driver)
    const grips = {
      left: { a: Math.PI - 0.32 },
      right: { a: 0.32 },
    };
    // hands ride with the rim up to about 80 degrees each way, then slide along it
    const turn = clamp(wheelObj.rotation.z, -1.4, 1.4);
    sw.updateMatrixWorld(true);
    const pivotW = sw.matrixWorld;
    const camQ = cam.quaternion;
    const right = V(1, 0, 0).applyQuaternion(camQ),
      up = V(0, 1, 0).applyQuaternion(camQ),
      fwd = V(0, 0, -1).applyQuaternion(camQ);
    for (const side of ['left', 'right']) {
      const hand = h[side];
      const sgn = side === 'left' ? -1 : 1;
      const a = grips[side].a + turn;
      hand.visible = true;
      h.setPose(side, 'grip');
      const rimW = V(Math.cos(a) * R, Math.sin(a) * R, 0).applyMatrix4(pivotW);
      const tanW = V(-Math.sin(a), Math.cos(a), 0).transformDirection(pivotW);
      // the forearm runs down and back toward the elbow
      const elbow = cam.position.clone().addScaledVector(right, 0.44 * sgn).addScaledVector(up, -0.8).addScaledVector(fwd, 0.12);
      const zAxis = elbow.clone().sub(rimW);
      zAxis.addScaledVector(tanW, -zAxis.dot(tanW)).normalize();
      // thumb along the rim toward 12 o'clock; it turns with the wheel without flipping
      const thumb = side === 'left' ? tanW.clone().negate() : tanW.clone();
      // left model: thumb +X; the right hand is the mirrored model (thumb -X)
      const xAxis = side === 'left' ? thumb : thumb.clone().negate();
      const yAxis = zAxis.clone().cross(xAxis).normalize();
      const zFix = xAxis.clone().cross(yAxis).normalize();
      const qWorld = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zFix));
      const gripLocal = V(0.0, -0.028, -0.088);
      let posW = rimW.clone().sub(gripLocal.clone().applyQuaternion(qWorld));
      const qCam = camQ.clone().invert().multiply(qWorld);
      // reaching for a control (right hand for key/shifter, left for the stalk)
      const r = this.reach;
      let qOut = qCam;
      if (r && ((side === 'right' && r.target !== 'stalk') || (side === 'left' && r.target === 'stalk'))) {
        const k = Math.sin(Math.min(1, r.t) * Math.PI);
        const tp = this.controlPoint(car, r.target).applyMatrix4(car.root.matrixWorld);
        // fingertips land on the control: palm down, fingers pointing forward from the elbow
        const dir = tp.clone().sub(elbow).normalize();
        const zR = dir.clone().negate();
        const xR0 = V(0, 1, 0).applyQuaternion(car.root.quaternion).cross(zR).normalize();
        const xR = side === 'left' ? xR0 : xR0.clone().negate();
        const yR = zR.clone().cross(xR).normalize();
        const qReach = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xR, yR, xR.clone().cross(yR)));
        const tipLocal = V(0, -0.01, -0.17);
        const reachPos = tp.clone().sub(tipLocal.clone().applyQuaternion(qReach));
        posW = posW.lerp(reachPos, k);
        qOut = qCam.clone().slerp(camQ.clone().invert().multiply(qReach), k);
        h.setPose(side, k > 0.4 ? 'pinch' : 'grip');
      }
      hand.position.copy(toCam(posW));
      hand.quaternion.copy(qOut);
    }
    if (this.reach) {
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
    const hold = it && it.def ? HOLD[it.def.hold] : null;
    const big = it && (it.part || (Math.max(it.size.x, it.size.y, it.size.z) > 0.55 && !(it.def && it.def.weapon)));
    const seated = !!this.game.player.seat;
    h.right.visible = true;
    h.left.visible = false;
    if (it && hold && !big) {
      h.setPose('right', hold.pose);
      const hp = hold.hand.clone();
      if (it.def.weapon) hp.lerp(V(0, -0.12, -0.32), this.aim);
      if (this.userRotated) hp.copy(V(0.18, -0.22, -0.42));
      // keep the hand glued to the item: derive from the item's actual camera-space position
      const inv = cam.quaternion.clone().invert();
      const itemLocal = it.mesh.position.clone().sub(cam.position).applyQuaternion(inv);
      const desired = itemLocal.clone().sub(hold.item);
      h.right.position.copy(this.userRotated ? hp : desired);
      h.right.rotation.set(0, 0, hold.rotZ);
      if (hold.left) {
        h.left.visible = true;
        h.setPose('left', 'grip');
        h.left.position.copy(hold.left.clone().add(V(0, 0, 0)).lerp(V(-0.02, -0.14, -0.58), this.aim));
        h.left.rotation.set(0, 0, Math.PI / 2);
      }
    } else if (it && this.dragging) {
      h.right.visible = false;
      h.left.visible = false;
    } else if (it && big) {
      // carry from below: both hands under the lower edge, palms up, forearms toward the camera
      const inv = cam.quaternion.clone().invert();
      const c = it.mesh.position.clone().sub(cam.position).applyQuaternion(inv);
      const box = new THREE.Box3().setFromObject(it.mesh);
      const sz = box.getSize(V(0, 0, 0));
      const half = Math.min(0.32, Math.max(0.14, Math.max(sz.x, sz.z) * 0.32));
      const bottom = c.y - Math.min(0.45, sz.y * 0.5) + 0.03;
      h.setPose('right', 'carry');
      h.setPose('left', 'carry');
      h.left.visible = true;
      h.right.position.set(c.x + half, bottom, c.z + 0.08);
      h.left.position.set(c.x - half, bottom, c.z + 0.08);
      h.right.rotation.set(-0.35, 0.25, Math.PI);
      h.left.rotation.set(-0.35, -0.25, Math.PI);
    } else if (seated && this.game.player.seat === 'driver' && this.updateDriverHands(dt)) {
      // hands on the wheel
    } else {
      // idle: relaxed right hand low at the edge of the view; reaching when targeting
      h.right.quaternion.identity();
      h.setPose('right', this.target ? 'pinch' : 'relax');
      const p = this.game.player;
      const bob = p.bobAmp * 0.012;
      const reach = this.target && !seated ? 1 : 0;
      this.reachT = lerp(this.reachT || 0, reach, Math.min(1, dt * 6));
      const base = seated ? V(0.2, -0.32, -0.4) : V(0.24, -0.3, -0.36);
      h.right.position.copy(base.lerp(V(0.15, -0.22, -0.45), this.reachT * 0.6));
      h.right.position.y += Math.sin(p.bob * 2) * bob;
      h.right.rotation.set(-0.2 + this.reachT * 0.3, 0.15, -0.5);
      h.right.visible = this.reachT > 0.15;
    }
  }
}
