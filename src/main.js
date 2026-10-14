import './ui/style.css';
import { Game } from './game.js';
import { input } from './core/input.js';
import * as THREE from 'three';
window.__THREE = THREE;

const params = new URLSearchParams(location.search);
const canvas = document.createElement('canvas');
canvas.id = 'game';
document.body.appendChild(canvas);

async function boot() {
  const game = new Game(canvas);
  window.game = game;
  await game.init({
    seed: +(params.get('seed') || 1234),
    time: +(params.get('time') || 9),
    weather: params.get('weather') || 'clear',
    startZ: +(params.get('z') || 0),
    onProgress: (t, p) => console.log('load', t, p),
  });
  if (!params.get('manual')) game.start();
  else game.clock.start();
  canvas.addEventListener('click', () => input.lock());
  window.__ready = true;
}
boot();
