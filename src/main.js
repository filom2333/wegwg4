import './ui/style.css';
import './ui/menu.css';
import { Game } from './game.js';
import { UI } from './ui/ui.js';
import { readSave, deleteSave } from './core/save.js';
import { AudioSystem } from './audio/audio.js';
import * as THREE from 'three';
window.__THREE = THREE;

// Boot modes
//   (no params)        title screen over pre-rendered pictures (public/menu/)
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
  if (!play && !dev) {
    // title screen: pictures from the road behind the menu; no world is built until a game starts
    ui.mode = 'menu';
    ui.game = { audio: new AudioSystem({}) };
    ui.showBackdrop();
    ui.showSplash();
    window.__ready = true;
    return;
  }
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
      car: params.get('car') || 'w203',
      trailer: params.has('trailer'),
      onProgress: (t, p) => console.log('load', t, p),
    });
    if (!params.get('manual')) game.start();
    else game.clock.start();
    // headless captures (menu pictures, tests) fit kit to the car from outside
    if (params.get('manual')) window.dev = { fitAccessory: (await import('./vehicle/accessories.js')).fitAccessory, setTune: (await import('./vehicle/tuning.js')).setTune, input: (await import('./core/input.js')).input, placeProp: (await import('./world/props.js')).placeProp };
    canvas.addEventListener('click', () => ui.resume());
    window.__ready = true;
    return;
  }
  if (play) {
    ui.showLoading();
    // a new game over an old one: the old save is gone (the menu warned about it)
    if (params.get('fresh')) deleteSave();
    const load = params.get('load') ? readSave() : null;
    await game.init({
      seed: +(params.get('seed') || 1234),
      difficulty: params.get('difficulty') || 'normal',
      start: params.get('start') || 'parts',
      car: params.get('car') || 'w203',
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
}

boot();
