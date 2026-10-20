// Day/night cycle, sun & moon, sky, fog, ambient/IBL and weather state.

import * as THREE from 'three';
import { Sky, EnvironmentBaker } from './sky.js';
import { clamp, lerp, smoothstep, mulberry32 } from '../core/noise.js';

const LAT = (34 * Math.PI) / 180;
const DEC = (12 * Math.PI) / 180;

export const WEATHERS = {
  clear: { cloud: 0.3, overcast: 0, dust: 0, rain: 0, wind: 0.25, turbidity: 2.5, fogDensity: 0.00013 },
  hazy: { cloud: 0.25, overcast: 0.1, dust: 0.12, rain: 0, wind: 0.35, turbidity: 5, fogDensity: 0.00022 },
  cloudy: { cloud: 0.6, overcast: 0.25, dust: 0, rain: 0, wind: 0.45, turbidity: 3, fogDensity: 0.00016 },
  rain: { cloud: 0.9, overcast: 0.75, dust: 0, rain: 0.65, wind: 0.6, turbidity: 3, fogDensity: 0.0006 },
  storm: { cloud: 1.0, overcast: 0.95, dust: 0, rain: 1.0, wind: 0.95, turbidity: 3, fogDensity: 0.0011, lightning: true },
  sandstorm: { cloud: 0.4, overcast: 0.3, dust: 0.85, rain: 0, wind: 1.0, turbidity: 8, fogDensity: 0.006 },
};

export class Environment {
  constructor(renderer, scene, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.time = opts.time ?? 9.5; // hours
    this.day = 1;
    this.timeScale = opts.timeScale ?? 1 / 2; // game hours per real minute => 24 min/day
    this.sky = new Sky();
    scene.add(this.sky.mesh);
    this.baker = new EnvironmentBaker(renderer);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const q = opts.shadowSize ?? 2048;
    this.sun.shadow.mapSize.set(q, q);
    this.shadowExtent = opts.shadowExtent ?? 45;
    const c = this.sun.shadow.camera;
    c.left = -this.shadowExtent;
    c.right = this.shadowExtent;
    c.top = this.shadowExtent;
    c.bottom = -this.shadowExtent;
    c.near = 1;
    c.far = 400;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 2;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.moon = new THREE.DirectionalLight(0x9fb4e6, 0.0);
    scene.add(this.moon);
    scene.add(this.moon.target);
    this.hemi = new THREE.HemisphereLight(0xbcd0ea, 0x8a6f52, 0.4);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xc8d0d8, 0.00012);
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.weatherName = opts.weather || 'clear';
    this.w = { ...WEATHERS[this.weatherName] };
    this.target = { ...this.w };
    this.weatherTimer = 0;
    this.nextWeatherIn = 0.6 + Math.random() * 1.2; // game hours
    this.lastBake = -1;
    this.bakeSig = '';
    this.flash = 0;
    this.lightningTimer = 3;
    this.onLightning = null;
    this.rand = mulberry32(opts.seed || 77);
    this.groundColor = new THREE.Color(0x9c7a55);
    this.focus = new THREE.Vector3();
    this.biome = 'scrub';
    this.update(0);
  }

  setTime(h) {
    this.time = ((h % 24) + 24) % 24;
  }

  setWeather(name, instant = false) {
    if (!WEATHERS[name]) return;
    this.weatherName = name;
    this.target = { ...WEATHERS[name] };
    if (instant) this.w = { ...this.target };
  }

  // sun direction for an hour of day
  sunDirection(time, out) {
    const h = ((time - 12) / 24) * Math.PI * 2;
    const E = -Math.cos(DEC) * Math.sin(h);
    const N = Math.sin(DEC) * Math.cos(LAT) - Math.cos(DEC) * Math.sin(LAT) * Math.cos(h);
    const U = Math.sin(LAT) * Math.sin(DEC) + Math.cos(LAT) * Math.cos(DEC) * Math.cos(h);
    return out.set(-E, U, N).normalize();
  }

  get isNight() {
    return this.sunDir.y < -0.05;
  }

  get daylight() {
    return smoothstep(-0.12, 0.12, this.sunDir.y);
  }

  chooseNextWeather() {
    const r = this.rand();
    const b = this.biome;
    let table;
    if (b === 'dunes' || b === 'badlands')
      table = [
        ['clear', 4],
        ['hazy', 2],
        ['cloudy', 1],
        ['sandstorm', 1.3],
        ['storm', 0.4],
      ];
    else if (b === 'saltflat')
      table = [
        ['clear', 4],
        ['hazy', 2],
        ['cloudy', 1],
        ['rain', 0.5],
        ['storm', 0.6],
      ];
    else
      table = [
        ['clear', 4],
        ['cloudy', 2],
        ['hazy', 1],
        ['rain', 1.1],
        ['storm', 0.6],
        ['sandstorm', 0.3],
      ];
    let tot = 0;
    for (const [, w] of table) tot += w;
    let p = r * tot;
    for (const [n, w] of table) {
      p -= w;
      if (p <= 0) return n;
    }
    return 'clear';
  }

  update(dt, gameHours = null) {
    // time
    const dh = gameHours !== null ? gameHours : (dt / 60) * this.timeScale;
    this.time += dh;
    if (this.time >= 24) {
      this.time -= 24;
      this.day++;
    }
    // weather transitions
    this.weatherTimer += dh;
    if (this.weatherTimer > this.nextWeatherIn && !this.lockWeather) {
      this.weatherTimer = 0;
      this.nextWeatherIn = 1.5 + this.rand() * 4;
      this.setWeather(this.chooseNextWeather());
    }
    const k = Math.min(1, dt * 0.08 + Math.abs(dh) * 0.6);
    for (const key of ['cloud', 'overcast', 'dust', 'rain', 'wind', 'turbidity', 'fogDensity']) this.w[key] = lerp(this.w[key], this.target[key], k);
    this.w.lightning = this.target.lightning;

    this.sunDirection(this.time, this.sunDir);
    this.moonDir.copy(this.sunDirection(this.time + 12.4, new THREE.Vector3())).multiplyScalar(-1);
    this.moonDir.set(-this.sunDir.x * 0.9 + 0.2, -this.sunDir.y, -this.sunDir.z * 0.9 + 0.1).normalize();

    const u = this.sky.uniforms;
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);
    u.uCloud.value = this.w.cloud;
    u.uOvercast.value = this.w.overcast;
    u.uDust.value = this.w.dust;
    u.uTurbidity.value = this.w.turbidity;
    u.uTime.value += dt;
    const night = 1 - smoothstep(-0.2, 0.0, this.sunDir.y);
    u.uNight.value = night;
    u.uStars.value = 1 - this.w.overcast;

    // lightning
    this.flash = Math.max(0, this.flash - dt * 6);
    if (this.w.lightning && this.w.rain > 0.6) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 4 + this.rand() * 12;
        this.flash = 1;
        this.onLightning && this.onLightning(this.rand());
      }
    }
    u.uFlash.value = this.flash * 0.6;

    // sun light
    const day = this.daylight;
    const sunY = this.sunDir.y;
    const warm = 1 - smoothstep(0.0, 0.4, sunY);
    // desert sun: warm white at noon, deep amber near the horizon, strong
    const sunColor = new THREE.Color(1.0, 0.94, 0.84).lerp(new THREE.Color(1.0, 0.52, 0.24), warm);
    const cover = 1 - this.w.overcast * 0.85 - this.w.dust * 0.5;
    this.sun.color.copy(sunColor);
    this.sun.intensity = (4.1 + 0.8 * warm) * smoothstep(-0.03, 0.1, sunY) * Math.max(0.05, cover);
    const moonUp = smoothstep(-0.05, 0.15, this.moonDir.y);
    this.moon.intensity = 0.32 * moonUp * night * (1 - this.w.overcast * 0.8);
    // the stronger of sun/moon casts shadows
    this.sun.castShadow = this.sun.intensity > 0.05;

    // ambient
    const skyCol = new THREE.Color().setRGB(0.46, 0.55, 0.68).lerp(new THREE.Color(0.55, 0.57, 0.6), this.w.overcast);
    skyCol.lerp(new THREE.Color(0.75, 0.58, 0.48), warm * day * 0.6);
    skyCol.lerp(new THREE.Color(0.7, 0.55, 0.4), this.w.dust * 0.8);
    const nightSky = new THREE.Color(0.04, 0.055, 0.095);
    this.hemi.color.copy(nightSky).lerp(skyCol, day);
    // sunlit sand bounces a lot of warm light back up
    this.hemi.groundColor.copy(this.groundColor).multiplyScalar((0.32 + 0.72 * day) * (1 + 0.25 * (1 - this.w.overcast)));
    // twilight: the whole sky still lights the land for a while after the sun has set
    const twilight = smoothstep(-0.16, 0.0, sunY) * (1 - smoothstep(0.0, 0.25, sunY));
    this.hemi.intensity = 0.3 + 0.24 * day + 0.55 * twilight + this.flash * 2.5;

    // fog color ~ horizon colour
    const horizon = new THREE.Color(0.71, 0.77, 0.85);
    horizon.lerp(new THREE.Color(0.98, 0.64, 0.38), warm * day * 0.8);
    horizon.lerp(new THREE.Color(0.6, 0.62, 0.64), this.w.overcast * 0.8);
    horizon.lerp(new THREE.Color(0.72, 0.58, 0.42), this.w.dust);
    const nightFog = new THREE.Color(0.03, 0.035, 0.05);
    this.scene.fog.color.copy(nightFog).lerp(horizon, smoothstep(-0.15, 0.15, sunY));
    this.scene.fog.density = this.w.fogDensity * (1 + night * 0.6);

    this.renderer.toneMappingExposure = lerp(1.25, 0.98, day) * (1 + 0.12 * warm * day) * (1 + this.flash * 0.3);
    // the baked sky is cool; let the sun and bounce light carry the daytime look
    this.scene.environmentIntensity = 0.3 + 0.4 * day;
    this.grade = { warm: warm * day, night: 1 - day, overcast: this.w.overcast, dust: this.w.dust };

    // shadow camera follows the focus point
    const f = this.focus;
    const light = this.sun.castShadow ? this.sunDir : this.moonDir;
    this.sun.position.set(f.x + this.sunDir.x * 150, f.y + this.sunDir.y * 150, f.z + this.sunDir.z * 150);
    this.sun.target.position.copy(f);
    // snap to texel grid to avoid shimmering
    const texel = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;
    this.sun.target.position.x = Math.round(f.x / texel) * texel;
    this.sun.target.position.z = Math.round(f.z / texel) * texel;
    this.sun.position.x = this.sun.target.position.x + this.sunDir.x * 150;
    this.sun.position.z = this.sun.target.position.z + this.sunDir.z * 150;
    this.moon.position.copy(f).addScaledVector(this.moonDir, 150);
    this.moon.target.position.copy(f);
    void light;

    // re-bake the image based lighting when sky changes enough
    const sig = [Math.round(this.time * 4), Math.round(this.w.overcast * 10), Math.round(this.w.dust * 10), Math.round(this.w.cloud * 5)].join(':');
    if (sig !== this.bakeSig) {
      this.bakeSig = sig;
      this.scene.environment = this.baker.bake(u, this.groundColor.clone().multiplyScalar(0.5 + 0.5 * day));
    }
  }
}
