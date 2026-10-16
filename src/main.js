import './ui/style.css';
import './ui/menu.css';
import { Game } from './game.js';
import { UI } from './ui/ui.js';
import { readSave } from './core/save.js';
import * as THREE from 'three';
window.__THREE = THREE;

// Boot modes
//   (no params)        title screen over a live scene of the parked car
//   ?play=1&...        loading screen, then the game (new game or ?load=1)
//   ?seed=..&z=..      developer / test start straight into the world (no menus)
const params = new URLSearchParams(location.search);
const canvas = document.createElement('canvas');
canvas.id = 'game';
document.body.appendChild(canvas);
const ui = new UI();
window.ui = ui;

async function boot() {
  const play = params.get('play');
  const dev = !play && (params.has('seed') || params.has('z') || params.has('time') || params.has('manual'));
  const game = new Game(canvas);
  game.ui = ui;
  ui.game = game;
  window.game = game;
  if (dev) {
    ui.mode = 'play';
    await game.init({
      seed: +(params.get('seed') || 1234),
      time: +(params.get('time') || 9),
      weather: params.get('weather') || 'clear',
      startZ: +(params.get('z') || 0),
      difficulty: params.get('difficulty') || 'normal',
      start: params.get('start') || 'assembled',
      onProgress: (t, p) => console.log('load', t, p),
    });
    if (!params.get('manual')) game.start();
    else game.clock.start();
    canvas.addEventListener('click', () => ui.resume());
    window.__ready = true;
    return;
  }
  if (play) {
    ui.showLoading();
    const load = params.get('load') ? readSave() : null;
    await game.init({
      seed: +(params.get('seed') || 1234),
      difficulty: params.get('difficulty') || 'normal',
      start: params.get('start') || 'assembled',
      time: 8.2,
      weather: 'clear',
      load,
      onProgress: (t, p) => ui.progress(t, p),
    });
    game.start();
    game.paused = true;
    ui.showClickToPlay(true);
    window.__ready = true;
    return;
  }
  // title screen: the world loads behind a dark veil, then fades in
  ui.mode = 'menu';
  ui.showSplash();
  const veil = document.createElement('div');
  veil.style.cssText = 'position:fixed;inset:0;background:#0d0c0b;z-index:5;transition:opacity 1.6s ease';
  document.body.appendChild(veil);
  await game.init({ seed: 1234, time: 18.2, weather: 'clear', startZ: 1880, attract: true });
  game.env.timeScale = 0.12; // dusk lingers on the title screen
  game.start();
  requestAnimationFrame(() => (veil.style.opacity = '0'));
  setTimeout(() => veil.remove(), 1800);
  window.__ready = true;
}

boot();
