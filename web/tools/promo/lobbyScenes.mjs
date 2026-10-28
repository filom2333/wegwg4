// More pictures for the title screen (public/menu/), for tools/promo/shoot.mjs: the far north at
// night, a dawn in the mountains, a winter forest at sunset and a forest road in fog.
// Usage: BASE=... W=1920 H=1080 SS=1 node tools/promo/shoot.mjs tools/promo/lobbyScenes.mjs <out dir>
export const scenes = [
  {
    // a pass in the snowy north at night: the car stopped on the shoulder, lights on, the boot
    // open; one of them stands in the beam looking up at the stars over the ridge
    name: 'nightpass',
    z: 95000,
    time: 22.2,
    setup: async (S, g, THREE) => {
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const r = S.road(95040, -3.4);
      const car = g.car;
      await S.placeCar(car, r.p, r.yaw + 0.12);
      car.lightsOn = 1;
      car.ignition = true;
      car.cabinLight = true;
      S.open(car, 'trunk');
      S.open(car, 'door_FL', 0.7);
      const front = S.on(car, 0.6, 0, 6.5);
      S.friend('ranger').stand(front, r.yaw + 0.3, { t: 0.4 }).lookAt(S.on(car, 8, 30, 80)).hold('lantern', 'R');
      S.friend('flannel').stand(S.on(car, -1.2, 0, -3.0), r.yaw + Math.PI - 0.6, { t: 1.1 }).lookAt(S.on(car, 0, 1.2, 0));
      const from = S.on(car, -5.5, 1.35, -7.5);
      S.look(from, S.on(car, 1.5, 4.5, 30), 55);
      g.player.setPosition(S.on(car, -12, 0, -20));
    },
  },
  {
    // dawn from a pull-out in the mountains: two on the bonnet with a flask, against the sun
    // coming up over the peaks
    name: 'overlook',
    z: 104000,
    time: 6.35,
    weather: 'clear',
    setup: async (S, g, THREE) => {
      const r = S.road(104020, -4.6);
      const car = g.car;
      const yaw = r.yaw - 1.2;
      await S.placeCar(car, r.p, yaw);
      await S.settle(0.5);
      const hood = S.on(car, 0.3, 0, 1.82);
      S.friend('drifter').sit(hood, yaw, { h: S.topOf(car.root, hood) - hood.y + 0.03, feet: 0.72, spread: 0.24, hands: 'back', lean: -0.05 });
      const hood2 = S.on(car, -0.35, 0, 1.86);
      S.friend('mustard').sit(hood2, yaw + 0.15, { h: S.topOf(car.root, hood2) - hood2.y + 0.03, feet: 0.72, spread: 0.2, hands: 'knees', lean: 0.12 }).hold('thermos', 'R');
      g.env.mistBase = null;
      // from ahead and to the side, low: the two on the bonnet, the forest and the peaks behind them
      const from = S.on(car, -4.4, 1.05, 5.2);
      S.look(from, S.on(car, 0.4, 1.25, 0.6), 50);
      g.player.setPosition(S.on(car, -10, 0, -12));
    },
  },
  {
    // a winter forest at sunset: the car on the snowy road between the spruces, tail lights red,
    // the low sun ahead through the trunks
    name: 'winterdusk',
    z: 132000,
    time: 18.15,
    setup: async (S, g, THREE) => {
      const r = S.road(132050, 1.8);
      const car = g.car;
      // drive towards the sun, whichever way along the road that is
      const sun = g.env.sunDirection(18.15, new THREE.Vector3());
      const toSun = r.fwd.x * sun.x + r.fwd.z * sun.z > 0;
      await S.placeCar(car, r.p, r.yaw + (toSun ? 0 : Math.PI));
      car.lightsOn = 1;
      car.ignition = true;
      S.friend('denim').stand(S.on(car, 1.4, 0, -0.6), r.yaw + Math.PI * 0.5, { t: 0.2 }).lookAt(S.on(car, 0, 2, 20));
      const from = S.on(car, -1.6, 1.15, -9.5);
      S.look(from, S.on(car, 0.2, 2.2, 12), 50);
      g.player.setPosition(S.on(car, -12, 0, -25));
    },
  },
  {
    // a forest road in fog in the early morning: headlights in the mist, someone walking ahead
    // with a lantern
    name: 'fogroad',
    z: 60000,
    time: 7.1,
    weather: 'fog',
    setup: async (S, g, THREE) => {
      const r = S.road(60060, 1.8);
      const car = g.car;
      await S.placeCar(car, r.p, r.yaw + Math.PI);
      car.lightsOn = 1;
      car.ignition = true;
      const ahead = S.on(car, 0.3, 0, 9);
      S.friend('flannel').stand(ahead, r.yaw, { walk: 0.5, t: 0.3 }).hold('lantern', 'R');
      const from = S.on(car, 1.6, 1.25, 16);
      S.look(from, S.on(car, -0.2, 1.0, 0), 52);
      g.player.setPosition(S.on(car, 10, 0, 30));
    },
  },
];
