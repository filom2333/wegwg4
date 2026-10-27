// Item icons for the inventory and hotbar: each item model is rendered once, three-quarter view
// on a transparent background, by a small offscreen renderer, and cached as an image URL. They
// are all drawn behind the loading screen (prewarmIcons) and kept in the browser's IndexedDB,
// so the next start has them at once: drawing one mid-game (a second WebGL context, its shaders,
// a synchronous PNG encode) was a freeze each time a new thing went into the hotbar.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const SIZE = 128;
let R = null;
let scene, cam, envTex;
const cache = new Map(); // key -> URL ('' when it failed, null while it is being encoded)
const waiting = new Map(); // key -> callbacks for when it is ready
const queue = [];
let busy = false;
// bump when item models change, so the stored icons are drawn anew
const ICONS_VERSION = 'v1';

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
  // a copy to encode at leisure (the WebGL canvas is drawn over by the next icon)
  const copy = document.createElement('canvas');
  copy.width = copy.height = SIZE;
  copy.getContext('2d').drawImage(R.domElement, 0, 0);
  scene.remove(holder);
  holder.traverse((o) => {
    if (o.isMesh && !o.userData.shared) o.geometry.dispose();
  });
  return copy;
}

// The PNG is made off the main thread; the icon is ready when it is.
function encode(key, canvas, onReady) {
  cache.set(key, null);
  if (onReady) waiting.set(key, [...(waiting.get(key) || []), onReady]);
  const done = (url) => {
    cache.set(key, url);
    for (const f of waiting.get(key) || []) f(key);
    waiting.delete(key);
  };
  canvas.toBlob((blob) => {
    if (!blob) return done('');
    done(URL.createObjectURL(blob));
    store(key, blob);
  }, 'image/png');
}

// ---------------------------------------------------------------- kept between sessions
let dbP = null;
function openDB() {
  if (!dbP)
    dbP = new Promise((res) => {
      try {
        const rq = indexedDB.open('dustroad-icons', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('icons');
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => res(null);
      } catch (e) {
        res(null);
      }
    });
  return dbP;
}

async function store(key, blob) {
  const db = await openDB();
  if (!db) return;
  try {
    db.transaction('icons', 'readwrite').objectStore('icons').put(blob, ICONS_VERSION + ':' + key);
  } catch (e) {
    /* not kept then */
  }
}

async function loadStored(keys) {
  const db = await openDB();
  if (!db) return;
  await new Promise((res) => {
    try {
      const st = db.transaction('icons', 'readonly').objectStore('icons');
      let left = keys.length;
      if (!left) return res();
      for (const k of keys) {
        const rq = st.get(ICONS_VERSION + ':' + k);
        rq.onsuccess = () => {
          if (rq.result && !cache.get(k)) cache.set(k, URL.createObjectURL(rq.result));
          if (--left === 0) res();
        };
        rq.onerror = () => --left === 0 && res();
      }
    } catch (e) {
      res();
    }
  });
}

// Every icon the game can show, before it starts: the stored ones are read back, the rest drawn
// (a little at a time, so the loading screen keeps moving). list: [{ key, build, pose }].
export async function prewarmIcons(list, onProgress = null) {
  await loadStored(list.map((q) => q.key));
  const missing = list.filter((q) => !cache.has(q.key));
  let t = performance.now();
  for (let i = 0; i < missing.length; i++) {
    const q = missing[i];
    try {
      encode(q.key, render(q.build(), q.pose));
    } catch (e) {
      cache.set(q.key, '');
    }
    if (performance.now() - t > 40) {
      onProgress && onProgress(i / missing.length);
      await new Promise((r) => setTimeout(r, 0));
      t = performance.now();
    }
  }
}

// Icon URL for a key, building the model with `build()` the first time. Returns null until the
// icon is ready when `async` (rendering is spread over frames so opening the bag never stalls).
export function itemIcon(key, build, pose = '', { async = false, onReady = null } = {}) {
  if (cache.has(key)) {
    const url = cache.get(key);
    // (still being encoded: told when it is)
    if (url === null && onReady) waiting.set(key, [...(waiting.get(key) || []), onReady]);
    return url;
  }
  if (!async) {
    const url = render(build(), pose).toDataURL('image/png');
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
        encode(q.key, render(q.build(), q.pose), q.onReady);
      } catch (e) {
        console.warn('icon failed', q.key, e);
        cache.set(q.key, '');
        q.onReady && q.onReady(q.key);
      }
    }
    busy = false;
    pump();
  });
}
