// Persistent user settings.

const KEY = 'dustroad.settings.v1';

export const DEFAULT_BINDINGS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  sprint: 'ShiftLeft',
  crouch: 'ControlLeft',
  jump: 'Space',
  interact: 'KeyE',
  drop: 'KeyG',
  reload: 'KeyR',
  flashlight: 'KeyF',
  lights: 'KeyL',
  ignition: 'KeyI',
  horn: 'KeyH',
  gearUp: 'KeyX',
  gearDown: 'KeyZ',
  handbrake: 'Space',
  wipers: 'KeyK',
  lookBack: 'KeyC',
  journal: 'KeyJ',
  sleep: 'KeyB',
  view: 'KeyV',
};

export const DEFAULTS = {
  quality: 'high', // low | medium | high | ultra
  resolutionScale: 1,
  fov: 75,
  sensitivity: 1,
  invertY: false,
  viewDistance: 1, // multiplier
  shadows: true,
  bloom: true,
  ao: true,
  motionBlur: false,
  vsync: true,
  showFps: false,
  masterVolume: 0.85,
  musicVolume: 0.6,
  sfxVolume: 0.9,
  ambientVolume: 0.8,
  language: 'en',
  units: 'metric',
  transmission: 'auto',
  headBob: true,
  subtitles: true,
  bindings: { ...DEFAULT_BINDINGS },
};

class Settings {
  constructor() {
    this.data = structuredClone(DEFAULTS);
    this.listeners = new Set();
    this.load();
  }
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.data = { ...structuredClone(DEFAULTS), ...parsed, bindings: { ...DEFAULT_BINDINGS, ...(parsed.bindings || {}) } };
      }
    } catch (e) {
      /* storage unavailable */
    }
  }
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (e) {
      /* ignore */
    }
  }
  get(k) {
    return this.data[k];
  }
  set(k, v) {
    this.data[k] = v;
    this.save();
    for (const l of this.listeners) l(k, v);
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  reset() {
    this.data = structuredClone(DEFAULTS);
    this.save();
    for (const l of this.listeners) l('*', null);
  }
}

export const settings = new Settings();
