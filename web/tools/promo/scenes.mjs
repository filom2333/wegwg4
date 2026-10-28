// Promo / menu scenes for tools/promo/shoot.mjs. setup(S, g, THREE) runs in the page: S is the
// Stage (stage.js), g the game. Local coordinates; S.road(z, lane) gives a spot on the road
// (lane: metres to the right, driving north), S.on(car, x, y, z) a point on a car (x to the
// car's left, z ahead, y up from the ground it stands on).
export const scenes = [
  {
    // a stop on the shoulder at golden hour: one on the bonnet, one at the open door, one waving
    name: 'roadside',
    z: 6500,
    time: 18.2,
    setup: async (S, g, THREE) => {
      const r = S.road(6540, -5.2);
      const car = g.car;
      const yaw = r.yaw + 0.25;
      await S.placeCar(car, r.p, yaw);
      S.open(car, 'door_FL');
      S.open(car, 'door_FR');
      await S.settle(0.5);
      const hood = S.on(car, 0.25, 0, 1.45);
      S.friend('drifter').sit(hood, yaw, { h: S.topOf(car.root, hood) - hood.y + 0.03, feet: 0.8, spread: 0.24, hands: 'back', lean: -0.05 });
      const door = S.on(car, 1.5, 0, 0.3);
      S.friend('flannel').stand(door, yaw + Math.PI * 0.55, { t: 0.8 }).lookAt(S.on(car, -2.5, 1.5, 5));
      const from = S.on(car, -4.9, 1.5, 6.6);
      const wp = S.on(car, -2.3, 0, 3.3);
      // facing the camera, a little turned
      const toCam = Math.atan2(from.x - wp.x, from.z - wp.z) - 0.35;
      S.friend('ranger').stand(wp, toCam, { t: 1.4 }).wave('R').lookAt(from);
      S.look(from, S.on(car, 0.15, 1.05, 0.7), 44);
      g.player.setPosition(S.on(car, -9, 0, 12));
    },
  },
  {
    // night: a fire off the road, three around it on logs, the car behind with its lights on
    name: 'campfire',
    z: 1200,
    time: 21.7,
    setup: async (S, g, THREE) => {
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const r = S.road(1230, 14);
      const fire = r.p.clone().addScaledVector(r.right, 6);
      fire.y = S.ground(fire.x, fire.z);
      g.campfires.kindle(fire);
      const car = g.car;
      const cp = fire.clone().addScaledVector(r.fwd, 7).addScaledVector(r.right, 1.5);
      await S.placeCar(car, cp, r.yaw + Math.PI + 0.7);
      car.lightsOn = 1;
      S.open(car, 'trunk');
      const seatAt = async (a, look, opts = {}) => {
        const p = fire.clone().add(V(Math.sin(a) * 2.3, 0, Math.cos(a) * 2.3));
        p.y = S.ground(p.x, p.z);
        const yaw = Math.atan2(fire.x - p.x, fire.z - p.z);
        // two old tyres to sit on
        const tp = p.clone().addScaledVector(V(Math.sin(yaw), 0, Math.cos(yaw)), -0.08);
        S.prop('tyre', tp, { yaw: Math.random() * 3 });
        S.prop('tyre', tp.clone().add(V(0.02, 0.17, -0.01)), { yaw: Math.random() * 3 });
        return S.friend(look).sit(p, yaw, { h: 0.36, feet: 0.55, spread: 0.2, lean: 0.28, ...opts });
      };
      const a = await seatAt(r.yaw + 1.05, 'drifter');
      const b = await seatAt(r.yaw + 2.6, 'flannel', { hands: 'back', lean: -0.08 });
      await seatAt(r.yaw - 0.75, 'denim');
      a.hold('thermos', 'R', { offset: V(0, 0.05, 0) });
      b.lookAt(a.B.head.getWorldPosition(V(0, 0, 0)));
      // an oil drum and a lantern by the car
      const dp = fire.clone().addScaledVector(r.fwd, 4.2).addScaledVector(r.right, -2.2);
      dp.y = S.ground(dp.x, dp.z);
      S.prop('oilDrum', dp);
      const from = fire.clone().addScaledVector(r.right, 4.4).addScaledVector(r.fwd, -2.6);
      from.y = S.ground(from.x, from.z) + 0.85;
      S.look(from, fire.clone().add(V(0, 0.75, 0)).addScaledVector(r.fwd, 1.0), 48);
      g.player.setPosition(from.clone().addScaledVector(r.right, 3));
    },
  },
  {
    // broken down in the dunes: one in the engine bay, one with the jerry can, one sat by the wheel
    name: 'breakdown',
    z: 4300,
    time: 16.2,
    setup: async (S, g, THREE) => {
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const r = S.road(4310, -5.5);
      const car = g.car;
      const yaw = r.yaw - 0.2;
      await S.placeCar(car, r.p, yaw);
      S.open(car, 'hood');
      S.open(car, 'door_FL', 0.7);
      await S.settle(0.5);
      car.lightsOn = 0;
      const mp = S.on(car, 1.3, 0, 1.6),
        eng = S.on(car, 0.1, 0.6, 1.6);
      const mech = S.friend('denim').stand(mp, Math.atan2(eng.x - mp.x, eng.z - mp.z), { t: 0.3 });
      mech.push(S.on(car, 0.62, 0.8, 1.9), S.on(car, 0.66, 0.8, 1.3), 0.6).lookAt(eng);
      const jc = S.friend('mustard').stand(S.on(car, -1.75, 0, 2.2), yaw - 1.9, { t: 1.1 });
      jc.hand('R', jc.palm('R').add(V(0, 0, 0)), V(0, -1, 0));
      jc.hold('jerryCan', 'R', { offset: V(0, -0.22, 0), yaw: yaw - 1.9 });
      jc.lookAt(S.on(car, 0, 1.2, 2.0));
      const wheel = S.on(car, 1.25, 0, -1.4);
      S.friend('drifter').sit(wheel.clone().add(V(0, 0, 0)), yaw + Math.PI / 2, { h: 0.22, feet: 0.75, spread: 0.25, hands: 'knees', lean: 0.1 }).lookAt(S.on(car, 2, 1.4, 4));
      const from = S.on(car, -5.2, 1.35, 7.2);
      S.look(from, S.on(car, 0.2, 0.85, 0.9), 40);
      g.player.setPosition(S.on(car, -8, 0, 12));
    },
  },
  {
    // the funny one: rolled it in the sand. One sits on the upturned floor, one holds their head
    name: 'flipped',
    z: 4300,
    time: 17.6,
    setup: async (S, g, THREE) => {
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const r = S.road(4380, 22);
      const car = g.car;
      const yaw = r.yaw + 1.1;
      await S.placeCar(car, r.p, yaw, { roll: Math.PI, settle: 3 });
      const top = S.on(car, 0, 0, 0);
      const topY = S.topOf(car.root, top);
      S.friend('flannel').sit(top, yaw + Math.PI / 2, { h: topY - S.ground(top.x, top.z) + 0.02, groundY: S.ground(top.x, top.z) + 0.6, feet: 0.45, spread: 0.22, hands: 'knees', lean: 0.15 });
      const p2 = S.on(car, 2.3, 0, 1.4);
      p2.y = S.ground(p2.x, p2.z);
      const head = S.friend('drifter').stand(p2, yaw + 2.4, { t: 2.0 });
      const hd = head.B.head.getWorldPosition(V(0, 0, 0));
      const f2 = head.frame();
      head.hand('L', hd.clone().addScaledVector(f2.right, -0.11).add(V(0, 0.08, 0)), f2.right.clone().negate().add(V(0, 0.4, 0)));
      head.hand('R', hd.clone().addScaledVector(f2.right, 0.11).add(V(0, 0.08, 0)), f2.right.clone().add(V(0, 0.4, 0)));
      const p3 = S.on(car, -2.6, 0, -1.2);
      p3.y = S.ground(p3.x, p3.z);
      const from = S.on(car, -4.5, 0, 6.8);
      from.y = S.ground(from.x, from.z) + 1.3;
      S.friend('ranger').stand(p3, yaw - 1.2, { t: 0.6 }).wave('R', S.on(car, 0, 0.6, 0)).lookAt(from);
      S.look(from, S.on(car, 0, 0.6, -0.2), 42);
      g.player.setPosition(from.clone().add(V(0, 0, 0)));
    },
  },
  {
    // out of fuel at sunset: two push, one steers through the open door
    name: 'pushing',
    z: 7200,
    time: 18.45,
    setup: async (S, g, THREE) => {
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const r = S.road(7220, 1.8);
      const car = g.car;
      await S.placeCar(car, r.p, r.yaw);
      S.open(car, 'door_FL', 0.55);
      await S.settle(0.4);
      const back = (x) => S.on(car, x, 0, -2.95);
      const p1 = S.friend('flannel').stand(back(0.45), r.yaw, { walk: 0.8, t: 0.2 });
      p1.push(S.on(car, 0.75, 0.92, -2.28), S.on(car, 0.25, 0.92, -2.3), 0.75);
      const p2 = S.friend('ranger').stand(back(-0.5), r.yaw, { walk: 0.8, t: 0.7 });
      p2.push(S.on(car, -0.2, 0.92, -2.3), S.on(car, -0.7, 0.92, -2.28), 0.72);
      S.friend('drifter').seat(car, 'driver', { yaw: 0.9 });
      const from = S.on(car, -6.2, 1.0, -5.6);
      S.look(from, S.on(car, 0.3, 0.95, -1.2), 44);
      g.player.setPosition(S.on(car, -6, 0, -12));
    },
  },
  {
    // from the air: the car stopped on the road through the forest at sunset, the woods to the hills
    name: 'vista',
    z: 16500,
    time: 18.3,
    setup: async (S, g, THREE) => {
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const r = S.road(16470, 1.8);
      const car = g.car;
      await S.placeCar(car, r.p, r.yaw);
      S.open(car, 'door_FL');
      S.open(car, 'trunk');
      await S.settle(0.4);
      S.friend('drifter').stand(S.on(car, 1.7, 0, 0.6), r.yaw + 1.4, { t: 0.5 }).wave('R');
      S.friend('mustard').stand(S.on(car, -0.3, 0, -3.0), r.yaw + 3.0, { t: 1.6 });
      S.friend('flannel').sit(S.on(car, -1.6, 0, 1.2), r.yaw - 1.2, { h: 0.0, groundY: S.on(car, 0, 0, 0).y, feet: 0.6, spread: 0.2, hands: 'back', lean: -0.1 });
      const from = S.on(car, 6, 14, -30);
      S.look(from, S.on(car, -2, 4, 120), 50);
      g.player.setPosition(S.on(car, 9, 0, -34));
    },
  },
  {
    // the far north: both cars on a snowy road, a stop among the spruce and birch
    name: 'snow',
    z: 63500,
    time: 12.5,
    setup: async (S, g, THREE) => {
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const r = S.road(63520, 1.9);
      const car = g.car;
      await S.placeCar(car, r.p, r.yaw);
      const r2 = S.road(63509, 1.9);
      const sedan = await S.newCar('sedan88', r2.p, r2.yaw);
      S.open(car, 'door_FR');
      S.open(sedan, 'door_FL');
      await S.settle(0.5);
      const from = S.on(car, -4.0, 1.5, 7.5);
      S.friend('ranger').stand(S.on(car, -1.9, 0, 1.6), r.yaw + 2.7, { t: 1.2 }).wave('R').lookAt(from);
      S.friend('flannel').stand(S.on(sedan, 1.55, 0, 0.4), r.yaw + 1.2, { t: 0.4 }).lookAt(S.on(car, -1.9, 1.6, 1.6));
      const hood = S.on(sedan, 0, 0, 1.55);
      S.friend('denim').sit(hood, r.yaw + Math.PI / 2, { h: S.topOf(sedan.root, hood) - hood.y + 0.03, feet: 0.55, spread: 0.2, hands: 'knees', lean: 0.12 }).lookAt(from);
      S.look(from, S.on(car, 0.3, 1.1, -3.5), 44);
      g.player.setPosition(S.on(car, -5, 0, 12));
    },
  },
  {
    // a morning at the river with rods
    name: 'fishing',
    z: 16500,
    time: 8.2,
    setup: async (S, g, THREE) => {
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const gen = g.gen;
      // where the river crosses the road, then a spot on its bank off to the side
      let zc = 16500;
      for (let z = 16450; z < 17200; z += 2) {
        const rv = gen.riverAt(gen.roadX(z), z);
        if (rv && rv.d < rv.r.w) {
          zc = z;
          break;
        }
      }
      const rv = gen.riverAt(gen.roadX(zc), zc);
      const side = 1;
      let bank = null;
      for (let dx = 30; dx < 120; dx += 2) {
        const x = gen.roadX(zc) + dx * side;
        const q = gen.riverAt(x, zc);
        if (!q) continue;
        // walk south from the water to the bank
        for (let dz = 0; dz < 40; dz += 0.5) {
          const zz = q.zc - dz - q.r.w;
          if (!gen.waterAt(x, zz)) {
            bank = S.L(x, gen.height(x, zz - 2), zz - 2);
            break;
          }
        }
        if (bank) break;
      }
      void rv;
      if (!bank) throw new Error('no bank');
      const water = bank.clone().add(V(0, 0, 8));
      const yaw = 0;
      const a = S.friend('drifter').sit(bank, yaw, { h: 0.3, feet: 0.6, spread: 0.2, hands: 'knees', lean: 0.2 });
      const b = S.friend('flannel').sit(bank.clone().add(V(2.2, 0, -0.4)), yaw - 0.2, { h: 0.3, feet: 0.6, spread: 0.2, hands: 'knees', lean: 0.25 });
      for (const f of [a, b]) {
        const pr = f.palm('R');
        const y = f.av.yaw;
        const dir = V(Math.sin(y) * 0.82, 0.57, Math.cos(y) * 0.82);
        S.item('fishingRod', pr.clone().addScaledVector(dir, 0.7), { yaw: y, pitch: 0.96 });
        f.hand('R', pr, V(0, -1, 0));
      }
      S.prop('tyre', bank.clone().add(V(-1.6, 0, -1.4)));
      const car = g.car;
      await S.placeCar(car, bank.clone().add(V(-4.5, 0, -6)), 0.6);
      S.open(car, 'trunk');
      const from = bank.clone().add(V(-2.4, 1.55, -4.6));
      S.look(from, bank.clone().add(V(1.6, 0.2, 7)), 50);
      g.player.setPosition(bank.clone().add(V(8, 0, -8)));
      void water;
    },
  },
];
