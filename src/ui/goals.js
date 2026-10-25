// What to do next: the objective in the top left corner of the HUD, read from the game's state
// twice a second. First the car: the next part that can go on and where the nearest one lies,
// then fuel, then starting it, then the road north to Haven. A pressing need (a wound, thirst,
// hunger, sleep, cold) goes first while it lasts. The thing the objective is about, when it lies
// within sight, gets a marker on screen (hud.setGoalMark).

import * as THREE from 'three';
import { HAVEN_KM } from '../story/story.js';
import { ITEMS } from '../items/itemDefs.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// panels and trim: the car runs and drives without them, so they wait until it does
export const COSMETIC = /door|fender|bumper|hood|trunk|seat_R|seat_FR|spare|enginecover|mirror/;

export class Goals {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.goal = null;
    this.mark = null;
  }

  update(dt) {
    const g = this.game;
    if (!g.hud || !g.player || !g.car) return;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.5;
      this.goal = this.pick();
      g.hud.setGoal(this.goal);
    }
    // the marker follows the camera every frame
    const m = this.goal && this.goal.at;
    g.hud.setGoalMark(m ? this.project(m) : null);
    if (this.goal && this.goal.at) g.hud.setGoalDir(this.dirTo(this.goal.at));
  }

  // ---------------------------------------------------------------- choosing
  pick() {
    const g = this.game;
    const p = g.player;
    const car = g.car;
    if (p.dead) return null;
    // what the body needs first
    if (p.bleeding > 0.4) return this.toward({ key: 'bleed', kind: 'warn', title: 'You are bleeding', lines: ['A bandage or a first aid kit stops it'] }, this.nearestItem((d) => d.consume && d.consume.bleeding > 0));
    if (p.water < 18) return this.toward({ key: 'water', kind: 'warn', title: 'Drink something', lines: [this.haveItem((d) => d.drinkable || (d.consume && d.consume.water > 10)) ? 'You have something to drink: take it out (Tab)' : 'Bottles turn up in houses, coolers and diners'] }, this.nearestItem((d) => d.drinkable || (d.consume && d.consume.water > 10)));
    if (p.food < 15) return this.toward({ key: 'food', kind: 'warn', title: 'Eat something', lines: [this.haveItem((d) => d.consume && d.consume.food > 10) ? 'You have food: take it out (Tab)' : 'Cans and snacks turn up in kitchens and shops'] }, this.nearestItem((d) => d.consume && d.consume.food > 10));
    if (p.energy < 12) return { key: 'sleep', kind: 'warn', title: 'Get some sleep', lines: ['In the car with the engine off (B), in a tent or a bed'] };
    if (p.warmth < 22) return { key: 'cold', kind: 'warn', title: 'Get warm', lines: ['A fire, the car with its heater on, a blanket'] };
    return this.carGoal(car, p);
  }

  carGoal(car, p) {
    const g = this.game;
    const name = car.type.short || car.type.name;
    const ids = car.type.ASSEMBLY_ORDER.filter((id) => car.parts[id]);
    const missing = ids.filter((id) => !car.isInstalled(id));
    const essential = missing.filter((id) => !COSMETIC.test(id));
    const held = g.interaction && g.interaction.held;
    if (essential.length) {
      const done = ids.length - missing.length;
      const lines = [];
      // carrying one of the missing parts: say where it goes
      if (held && held.part && missing.includes(held.part)) {
        const why = car.canInstall(held.part);
        lines.push(why.ok ? `Hold it to the car where it goes and press E` : why.reason);
        return { key: 'fit:' + held.part, title: `Fit the ${this.label(car, held.part)}`, progress: done / ids.length, lines, sub: `${done} of ${ids.length} parts on` };
      }
      // the next one that can go on now (or once its lid is open)
      const next = essential.find((id) => {
        const c = car.canInstall(id);
        return c.ok || /^(Open|Take off)/.test(c.reason || '');
      }) || essential[0];
      const it = this.nearestPart(car, next);
      const inBag = this.bagHas('part:' + next);
      let line;
      if (inBag) line = 'It is in your backpack (Tab)';
      else if (it) line = null;
      else line = 'Not about here: look further down the road';
      const lid = car.lidBlocking(next);
      return {
        key: 'part:' + next,
        title: `Rebuild the ${name}`,
        progress: done / ids.length,
        sub: `${done} of ${ids.length} parts on`,
        next: `Next: ${this.label(car, next)}`,
        lines: [line, lid].filter(Boolean),
        at: it ? it.mesh.position : null,
      };
    }
    // the essentials are on: fuel, oil, water, then the key
    if (car.fuel < 2) {
      const can = this.nearestItem((d, it) => d.liquid && d.liquid.type === 'fuel' && (it.state.liquid || 0) > 0.5 && it.state.liquidType === car.fuelType);
      return this.toward({ key: 'fuel', title: 'Put fuel in it', lines: [can ? (car.fillerCapOff ? 'Unscrew the can (R), hold it to the filler, LMB to pour' : 'Open the filler (E on the flap, again for the cap), unscrew the can (R), then pour, LMB') : 'Find a jerry can, or a pump at a gas station'] }, can);
    }
    if (car.oil < 1) {
      const oil = this.nearestItem((d) => d.liquid && d.liquid.type === 'oil');
      return this.toward({ key: 'oil', title: 'Top up the oil', lines: ['Open the bonnet and pour it in the filler'] }, oil);
    }
    if (car.coolantCap && car.coolant < car.coolantCap * 0.3) return { key: 'coolant', title: 'Top up the radiator', lines: ['Water will do: the cap is under the bonnet'] };
    const running = car.dyn.engine.running;
    const seated = p.seat === 'driver' && p.car === car;
    if (!running) {
      const panels = missing.length ? `${missing.length} panel${missing.length > 1 ? 's' : ''} still off: they can wait` : null;
      if (!seated) return { key: 'getin', title: `Start the ${name}`, lines: ['Open the driver’s door and get in (E)', panels].filter(Boolean) };
      return { key: 'key', title: `Start the ${name}`, lines: ['Look at the key and hold E', car.parkBrake ? 'Then release the parking brake' : null].filter(Boolean) };
    }
    // on the road
    const km = Math.max(0, (g.focusPoint().z + g.origin.z) / 1000);
    const left = Math.max(0, HAVEN_KM - km);
    const lines = [];
    if (car.fuel / car.fuelCap < 0.2) lines.push('Fuel is low: stop at the next gas station');
    else if (car.engineTemp > 108) lines.push('Running hot: ease off and check the coolant');
    else if (g.env && (g.env.sunDir.y < -0.03) && !car.lightsOn) lines.push('Getting dark: headlights (L)');
    return { key: 'road', title: 'Drive north to Haven', sub: `${left.toFixed(0)} km to go`, progress: Math.min(1, km / HAVEN_KM), lines };
  }

  // ---------------------------------------------------------------- finding things
  // A goal pointing at an item lying about: the marker on it and its name by the arrow.
  toward(goal, it) {
    if (!it) return goal;
    return { ...goal, at: it.mesh.position, next: (it.def && it.def.name) || null };
  }

  label(car, id) {
    // (without the size some labels carry: "fuel tank 62 l")
    return ((car.PARTS[id] && car.PARTS[id].label.toLowerCase()) || id).replace(/\s+[\d.,]+\s*(l|hp|ah|kg)$/, '');
  }

  bagHas(id) {
    const inv = this.game.inventory;
    return !!(inv && inv.slots.some((e) => e && e.id === id));
  }

  haveItem(test) {
    const inv = this.game.inventory;
    return !!(inv && inv.slots.some((e) => e && ITEMS[e.id] && test(ITEMS[e.id], e)));
  }

  nearestPart(car, id) {
    let best = null,
      bd = 70;
    const here = this.game.player.position;
    for (const it of this.game.items.items) {
      if (it.part !== id || it.held || (it.state.carType && it.state.carType !== car.type.id)) continue;
      const d = it.mesh.position.distanceTo(here);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  nearestItem(test) {
    let best = null,
      bd = 45;
    const here = this.game.player.position;
    for (const it of this.game.items.items) {
      if (it.held || it.worn || !it.def || !test(it.def, it)) continue;
      const d = it.mesh.position.distanceTo(here);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- screen
  // Where a world point is on screen (pixels), or null behind the camera.
  project(at) {
    const cam = this.game.renderer.camera;
    const to = at.clone().sub(cam.position);
    const d = to.length();
    if (d < 0.6 || d > 60) return null;
    const fwd = V(0, 0, -1).applyQuaternion(cam.quaternion);
    if (to.dot(fwd) <= 0) return null;
    const v = at.clone().project(cam);
    if (Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (0.5 - v.y * 0.5) * window.innerHeight, d };
  }

  // Bearing of a world point from where the camera looks (radians, + to the right) and distance.
  dirTo(at) {
    const cam = this.game.renderer.camera;
    const to = at.clone().sub(cam.position);
    const fwd = V(0, 0, -1).applyQuaternion(cam.quaternion);
    const a = Math.atan2(to.x, to.z) - Math.atan2(fwd.x, fwd.z);
    return { a: -Math.atan2(Math.sin(a), Math.cos(a)), d: Math.hypot(to.x, to.z) };
  }
}
