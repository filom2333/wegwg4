// Item icons for the inventory and hotbar: each item model is rendered once, three-quarter view
// on a transparent background, by a small offscreen renderer, and cached as an image URL.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const SIZE = 128;
let R = null;
let scene, cam, envTex;
const cache = new Map();
const queue = [];
let busy = false;

function setup() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  R = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  R.setPixelRatio(1);
  R.setSize(SIZE, SIZE, false);
  R.outputColorSpace = THREE.SRGBColorSpace;
  R.toneMapping = THREE.ACESFilmicToneMapping;
  R.toneMappingExposure = 1.1;
  R.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(R);
  envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a332c, 0.9));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.2);
  key.position.set(1.2, 2, 1.6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbcd0ff, 1.2);
  rim.position.set(-1.5, 0.8, -1.4);
  scene.add(rim);
  cam = new THREE.PerspectiveCamera(26, 1, 0.01, 50);
}

// Renders a model to an image URL. `pose`: 'weapon' shows the side, otherwise a 3/4 view.
function render(model, pose) {
  if (!R) setup();
  const holder = new THREE.Group();
  holder.add(model);
  if (pose === 'weapon') {
    model.rotation.set(0, -Math.PI / 2, 0);
    holder.rotation.set(0.12, 0.25, 0);
  } else {
    holder.rotation.set(0.42, -0.62, 0);
  }
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const c = box.getCenter(new THREE.Vector3());
  holder.position.sub(c);
  holder.updateMatrixWorld(true);
  const sph = new THREE.Box3().setFromObject(holder).getBoundingSphere(new THREE.Sphere());
  const d = (sph.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2))) * 0.92;
  cam.position.set(0, 0, d);
  cam.near = d / 50;
  cam.far = d * 4;
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  scene.add(holder);
  R.render(scene, cam);
  const url = R.domElement.toDataURL('image/png');
  scene.remove(holder);
  holder.traverse((o) => {
    if (o.isMesh && !o.userData.shared) o.geometry.dispose();
  });
  return url;
}

// Icon URL for a key, building the model with `build()` the first time. Returns null until the
// icon is ready when `async` (rendering is spread over frames so opening the bag never stalls).
export function itemIcon(key, build, pose = '', { async = false, onReady = null } = {}) {
  if (cache.has(key)) return cache.get(key);
  if (!async) {
    const url = render(build(), pose);
    cache.set(key, url);
    return url;
  }
  if (!queue.some((q) => q.key === key)) queue.push({ key, build, pose, onReady });
  pump();
  return null;
}

function pump() {
  if (busy || !queue.length) return;
  busy = true;
  requestAnimationFrame(() => {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 12) {
      const q = queue.shift();
      if (cache.has(q.key)) continue;
      try {
        cache.set(q.key, render(q.build(), q.pose));
      } catch (e) {
        console.warn('icon failed', q.key, e);
        cache.set(q.key, '');
      }
      q.onReady && q.onReady(q.key);
    }
    busy = false;
    pump();
  });
}
