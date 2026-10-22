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
  inventory: 'Tab',
  nextTrack: 'KeyN',
  stow: 'KeyQ',
  sleep: 'KeyB',
  view: 'KeyV',
  winch: 'KeyY',
  atlas: 'KeyM',
  photo: 'KeyP',
};

export const DEFAULTS = {
  quality: 'high', // low | medium | high | ultra
  resolutionScale: 1,
  dynamicResolution: true,
  hfov: 90, // horizontal field of view in degrees (the camera's vertical one follows the aspect)
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
  sound3d: 'headphones', // 'headphones': 3D (HRTF) panning; 'speakers': plain left-right
  language: 'en',
  units: 'metric',
  transmission: 'auto',
  headBob: true,
  subtitles: true,
  bindings: { ...DEFAULT_BINDINGS },
};

// A first guess at the quality preset from the graphics chip: software rendering gets low,
// integrated and mobile chips medium, the rest high. Only used until the player picks one.
function detectQuality() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)).toLowerCase();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|software|basic render/.test(name)) return 'low';
    const mobile = /android|iphone|ipad/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && !/windows/i.test(navigator.userAgent));
    if (/intel.*\barc\b/.test(name)) return 'high';
    if (mobile || /mali|adreno|powervr|intel|uhd|iris|vega \d|radeon\(tm\) graphics|apple gpu/.test(name)) return 'medium';
    return 'high';
  } catch (e) {
    return 'high';
  }
}

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
      } else this.data.quality = detectQuality();
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
