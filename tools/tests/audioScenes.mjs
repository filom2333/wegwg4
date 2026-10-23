// Scenes for tools/audiotest.mjs: the sounds of the game in the places and moments that matter.
// Each runs in the page; g is the game, h the helpers (at, stand, key, drive).
export const query = 'seed=1234&time=10&z=3000&manual=1';

export const scenes = [
  {
    // a calm desert noon: wind, cicadas, birds now and then
    name: 'desert_day',
    seconds: 10,
    setup: (g, h) => {
      g.env.setTime(13);
      g.env.setWeather('clear', true);
      h.stand(h.at(g.gen.roadX(3000) + 40, 3000), 0);
    },
  },
  {
    name: 'desert_night',
    seconds: 10,
    setup: (g, h) => {
      g.env.setTime(23);
      g.env.setWeather('clear', true);
      h.stand(h.at(g.gen.roadX(3000) + 40, 3000), 0);
    },
  },
  {
    name: 'wind_storm',
    seconds: 8,
    setup: (g, h) => {
      g.env.setTime(15);
      g.env.setWeather('storm', true);
      h.stand(h.at(g.gen.roadX(3000) + 40, 3000), 0);
    },
  },
  {
    // footsteps: walking forward on the road shoulder
    name: 'walk',
    seconds: 6,
    setup: (g, h) => {
      g.env.setTime(13);
      g.env.setWeather('clear', true);
      h.stand(h.at(g.gen.roadX(3000) + 8, 3000), Math.PI);
      h.key('KeyW', true);
    },
    frame: (g, t, h) => {
      if (t > 5.8) h.key('KeyW', false);
    },
  },
  {
    // gunshots: one beside you, one 60 m off, one 400 m off (left, right, behind)
    name: 'shots',
    seconds: 9,
    setup: (g, h) => {
      g.env.setTime(13);
      g.env.setWeather('clear', true);
      const x = g.gen.roadX(3000) + 40;
      h.stand(h.at(x, 3000), 0);
      const p = g.player.position;
      const shot = (dx, dz, at) => setTimeout(() => g.audio.play('revolver', { at: new h.V(p.x + dx, p.y + 1.5, p.z + dz) }), at);
      shot(-2, 0, 300);
      shot(60, 0, 3000);
      shot(0, 400, 5500);
    },
  },
  {
    // the car: idle outside it, then from the seat
    name: 'car_idle_out',
    seconds: 6,
    setup: (g, h) => {
      g.env.setTime(13);
      g.env.setWeather('clear', true);
      h.drive(true);
      g.player.exitSeat();
    },
  },
  {
    name: 'car_rev_in',
    seconds: 12,
    setup: (g, h) => {
      g.env.setTime(13);
      g.env.setWeather('clear', true);
      h.drive(true);
    },
    frame: (g, t, h) => {
      // pull away, change up, lift
      h.key('KeyW', t > 1 && t < 9);
    },
  },
  {
    name: 'rain_in_car',
    seconds: 8,
    setup: (g, h) => {
      g.env.setTime(15);
      g.env.setWeather('rain', true);
      h.drive(false);
    },
  },
];
