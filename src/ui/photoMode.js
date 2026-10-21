// Photo mode: the world holds still, the camera floats free (within reach of where you stand),
// and the shot can be framed with zoom, a tilt, a film look, a vignette, letterbox bars and the
// time of day. Taking one saves a PNG and tapes a print into the road atlas where it was taken.

import * as THREE from 'three';
import { input } from '../core/input.js';
import { settings } from '../core/settings.js';

const FILMS = ['Natural', 'Black and white', 'Sepia', 'Faded print', 'Cold morning', 'Vivid'];
const VIGNETTES = [0.3, 0.75, 0];
const REACH = 40; // m from where photo mode started
const PHOTO_KEY = 'dustroad.photos.v1';
const MAX_PHOTOS = 30;

export function loadPhotos() {
  try {
    return JSON.parse(localStorage.getItem(PHOTO_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function savePhotos(list) {
  try {
    localStorage.setItem(PHOTO_KEY, JSON.stringify(list.slice(-MAX_PHOTOS)));
  } catch (e) {
    /* storage full: the photo still downloaded */
  }
}

export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.film = 0;
    this.vig = 0;
    this.bars = false;
    this.help = true;
  }

  toggle() {
    if (this.active) this.exit();
    else this.enter();
  }

  enter() {
    const g = this.game;
    if (this.active || g.player.dead || (g.ui && g.ui.current)) return;
    const cam = g.renderer.camera;
    this.active = true;
    this.wasPaused = g.paused;
    g.paused = true;
    this.pos = cam.position.clone();
    this.anchor = cam.position.clone();
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;
    this.roll = 0;
    this.fov = cam.fov;
    this.time0 = g.env.time;
    this.prevView = g.debugView;
    g.debugView = (c) => this.apply(c);
    g.hud && g.hud.show(false);
    this.overlay();
    this.setLook();
    g.audio && g.audio.play('click', { volume: 0.6, rate: 0.8 });
  }

  exit() {
    const g = this.game;
    if (!this.active) return;
    this.active = false;
    g.debugView = this.prevView || null;
    g.debugFov = null;
    g.paused = this.wasPaused && g.ui && g.ui.current ? true : false;
    // the clock goes back to when the camera came out
    if (g.env.time !== this.time0) {
      g.env.time = this.time0;
      g.env.update(0, 0);
    }
    const u = g.renderer.grade && g.renderer.grade.uniforms;
    if (u) {
      u.uFilm.value = 0;
      u.uBars.value = 0;
      u.uVignette.value = VIGNETTES[0];
    }
    g.hud && g.hud.show(true);
    if (this.hud) this.hud.remove();
    this.hud = null;
  }

  overlay() {
    const root = document.querySelector('.ui') || document.body;
    this.hud = document.createElement('div');
    this.hud.className = 'ui-photo-root';
    this.hud.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    this.flash = document.createElement('div');
    this.flash.className = 'ui-photo-flash';
    this.line = document.createElement('div');
    this.line.className = 'ui-photo-hud';
    this.hud.append(this.flash, this.line);
    root.appendChild(this.hud);
    this.refresh();
  }

  refresh() {
    if (!this.line) return;
    const key = (a, d) => (settings.data.bindings[a] || d).replace(/^Key|^Digit/, '');
    const h = this.game.env.time;
    const clock = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    this.line.style.opacity = this.help ? 1 : 0;
    this.line.innerHTML =
      `<b>Photo mode</b> · LMB take it · WASD, Space, Ctrl move · wheel zoom · Q/E tilt · ` +
      `F <b>${FILMS[this.film]}</b> · V vignette · B bars · T/G time <b>${clock}</b> · H hide this · ${key('photo', 'KeyP')} back`;
  }

  setLook() {
    const u = this.game.renderer.grade && this.game.renderer.grade.uniforms;
    if (!u) return;
    u.uFilm.value = this.film;
    u.uVignette.value = VIGNETTES[this.vig];
    u.uBars.value = this.bars ? 0.11 : 0;
  }

  // Per frame while active (the game itself is paused).
  update(dt) {
    if (!this.active) return;
    const g = this.game;
    if (g.ui && g.ui.current) return this.exit();
    const sens = 0.0022 * settings.data.sensitivity * (this.fov / 70);
    const inv = settings.data.invertY ? -1 : 1;
    this.yaw -= input.mouse.dx * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch - input.mouse.dy * sens * inv, -1.5, 1.5);
    const down = (c) => input.down.has(c);
    const pressed = (c) => input.pressed.has(c);
    // fly
    const fast = down('ShiftLeft') ? 4 : 1;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const v = new THREE.Vector3();
    if (input.isDown('forward')) v.add(fwd);
    if (input.isDown('back')) v.sub(fwd);
    if (input.isDown('right')) v.add(right);
    if (input.isDown('left')) v.sub(right);
    if (down('Space')) v.y += 1;
    if (down('ControlLeft') || down('KeyC')) v.y -= 1;
    if (v.lengthSq() > 0) this.pos.addScaledVector(v.normalize(), 3.2 * fast * dt);
    // on a leash, and above the ground
    const off = this.pos.clone().sub(this.anchor);
    if (off.length() > REACH) this.pos.copy(this.anchor).addScaledVector(off.normalize(), REACH);
    const gy = g.groundHeightAt(this.pos.x, this.pos.z, this.pos.y + 1);
    this.pos.y = Math.max(this.pos.y, gy + 0.12);
    // zoom, tilt
    if (input.mouse.wheel) this.fov = THREE.MathUtils.clamp(this.fov * Math.pow(1.08, input.mouse.wheel), 12, 100);
    if (down('KeyQ')) this.roll += dt * 0.6;
    if (down('KeyE')) this.roll -= dt * 0.6;
    if (pressed('KeyR')) this.roll = 0;
    // the look
    let changed = false;
    if (pressed('KeyF')) (this.film = (this.film + 1) % FILMS.length), (changed = true);
    if (pressed('KeyV')) (this.vig = (this.vig + 1) % VIGNETTES.length), (changed = true);
    if (pressed('KeyB')) (this.bars = !this.bars), (changed = true);
    if (pressed('KeyH')) (this.help = !this.help), (changed = true);
    // time of day: the light moves, the world stays still
    const dtH = (down('KeyG') ? 1 : 0) - (down('KeyT') ? 1 : 0);
    if (dtH) {
      g.env.time = (g.env.time + dtH * dt * 1.5 + 24) % 24;
      g.env.update(0, 0);
      changed = true;
    }
    if (changed) {
      this.setLook();
      this.refresh();
    }
    if (input.mousePressed(0) || pressed('Enter')) this.pendingShot = true;
  }

  apply(cam) {
    cam.position.copy(this.pos);
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ'));
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.game.debugFov = this.fov;
    const vr = this.game.interaction && this.game.interaction.viewRoot;
    if (vr) vr.visible = false;
  }

  // Right after a render: grab the frame (the drawing buffer is still intact in this task).
  capture() {
    this.pendingShot = false;
    const g = this.game;
    const src = g.renderer.renderer.domElement;
    const day = g.env.day,
      h = g.env.time;
    const name = `dust-road-day${day}-${String(Math.floor(h)).padStart(2, '0')}${String(Math.floor((h % 1) * 60)).padStart(2, '0')}.png`;
    try {
      src.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 4000);
      }, 'image/png');
      // a print for the atlas
      const t = document.createElement('canvas');
      t.width = 384;
      t.height = Math.round((384 * src.height) / src.width);
      t.getContext('2d').drawImage(src, 0, 0, t.width, t.height);
      const thumb = t.toDataURL('image/jpeg', 0.82);
      const f = g.focusPoint();
      const ph = { x: Math.round(f.x + g.origin.x), z: Math.round(f.z + g.origin.z), day, time: h, seed: g.seed, thumb };
      if (g.atlas) {
        g.atlas.photos.push(ph);
        savePhotos(g.atlas.photos);
      }
    } catch (e) {
      console.warn('photo failed', e);
    }
    if (this.flash) {
      this.flash.classList.remove('go');
      void this.flash.offsetWidth;
      this.flash.classList.add('go');
    }
    g.audio && g.audio.play('click', { volume: 1, rate: 0.55 });
    g.audio && g.audio.play('pocket', { volume: 0.4, rate: 1.6 });
  }
}
