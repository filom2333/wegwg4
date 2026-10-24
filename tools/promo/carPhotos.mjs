// The car photographs on the trip sheet (public/menu/car_<id>.webp): each car alone on the road at
// golden hour, from a little ahead and to the side, low.
// Usage: BASE=... W=640 H=400 SS=2 node tools/promo/shoot.mjs tools/promo/carPhotos.mjs <out dir> [names]
export const scenes = [
  {
    name: 'car_kiri86',
    car: 'kiri86',
    z: 4000,
    time: 18.2,
    setup: async (S, g, THREE) => {
      const r = S.road(4040, 1.8);
      const car = g.car;
      await S.placeCar(car, r.p, r.yaw + 0.05);
      car.lightsOn = 1;
      car.ignition = true;
      const from = S.on(car, -2.6, 1.05, 4.6);
      S.look(from, S.on(car, 0.1, 0.72, 0.2), 38);
      g.player.setPosition(S.on(car, -10, 0, -12));
    },
  },
];
