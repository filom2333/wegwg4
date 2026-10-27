// The title backdrop: pictures from the road shown in depth. Each comes with its depth map
// (disparity, from tools/promo/shoot.mjs): the mouse and a slow camera move shift the eye a
// little, near things more than far ones, so the scene stands in three dimensions instead of
// lying flat; the pictures cross-fade; dust drifts through the light at its own depth, in front of
// what is behind it and hidden by what is in front. Plain WebGL2 on its own canvas, gone when a
// game starts.

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uImg0, uDep0, uImg1, uDep1;
uniform float uMix, uTime, uAspect, uImgAspect;
uniform vec2 uOff0, uOff1;
uniform float uZoom0, uZoom1, uFocus0, uFocus1;
// the picture's uv for a screen uv (cover fit, zoom about the middle)
vec2 fit(vec2 uv, float zoom) {
  vec2 p = uv - 0.5;
  if (uAspect > uImgAspect) p.y *= uImgAspect / uAspect; else p.x *= uAspect / uImgAspect;
  return p / zoom + 0.5;
}
float disp(sampler2D d, vec2 p) { float v = texture(d, p).r; return v * v; }
// a picture seen from an eye moved by off: near pixels slide further than far ones. The line of
// pixels that could land here is walked from the nearest depth to the farthest, and the first
// surface it meets is what shows (so a near edge covers what is behind it, never doubled), then
// the crossing is narrowed down.
vec3 view(sampler2D img, sampler2D dep, vec2 uv, vec2 off, float zoom, float focus, out float dsp) {
  vec2 p = fit(uv, zoom);
  float lo = 1.0, hi = 0.0;
  for (int i = 0; i <= 20; i++) {
    float s = 1.0 - float(i) / 20.0;
    if (disp(dep, p - off * (s - focus)) >= s) { hi = s; break; }
    lo = s;
  }
  for (int k = 0; k < 5; k++) {
    float m = 0.5 * (lo + hi);
    if (disp(dep, p - off * (m - focus)) >= m) hi = m; else lo = m;
  }
  vec2 q = clamp(p - off * (hi - focus), vec2(0.001), vec2(0.999));
  dsp = disp(dep, q);
  return texture(img, q).rgb;
}
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// dust motes: three layers at their own depths, drifting, lit by the picture behind them
vec3 motes(vec2 uv, vec2 off, float focus, float sceneD, vec3 behind) {
  vec3 acc = vec3(0.0);
  for (int l = 0; l < 3; l++) {
    float fl = float(l);
    float d = 0.55 - fl * 0.17;                 // disparity of the layer (near .. far)
    float sz = 70.0 + fl * 55.0;                // cells across the screen
    vec2 p = uv * vec2(uAspect, 1.0) * sz / uAspect;
    p += off * (d - focus) * sz * vec2(uAspect, 1.0) / uAspect;
    p += vec2(uTime * (0.25 + fl * 0.1), sin(uTime * 0.13 + fl) * 0.6 - uTime * 0.08);
    vec2 c = floor(p), f = fract(p);
    float h = hash(c + fl * 17.0);
    if (h < 0.955) continue;
    vec2 at = vec2(hash(c + 3.1), hash(c + 7.7)) * 0.6 + 0.2 + 0.12 * vec2(sin(uTime * 0.7 + h * 40.0), cos(uTime * 0.5 + h * 30.0));
    float r = length(f - at);
    float a = smoothstep(0.14, 0.0, r) * (0.5 + 0.5 * sin(uTime * 1.3 + h * 60.0));
    // dust hangs in the low air, not against the sky
    a *= smoothstep(0.8, 0.35, uv.y) * smoothstep(0.004, 0.03, sceneD);
    // hidden behind whatever is nearer
    a *= smoothstep(-0.02, 0.02, d - sceneD);
    float lum = dot(behind, vec3(0.3, 0.55, 0.15));
    acc += vec3(1.0, 0.93, 0.8) * a * (0.03 + lum * 0.4);
  }
  return acc;
}
void main() {
  float d0, d1;
  vec3 a = view(uImg0, uDep0, vUv, uOff0, uZoom0, uFocus0, d0);
  vec3 b = view(uImg1, uDep1, vUv, uOff1, uZoom1, uFocus1, d1);
  float m = smoothstep(0.0, 1.0, uMix);
  vec3 c = mix(a, b, m);
  c += mix(motes(vUv, uOff0, uFocus0, d0, a), motes(vUv, uOff1, uFocus1, d1, b), m);
  // a soft vignette
  vec2 v = vUv - 0.5;
  c *= 1.0 - dot(v, v) * 0.55;
  outColor = vec4(c, 1.0);
}`;

const SLIDE = 13; // seconds a picture stays
const FADE = 2.6; // seconds of cross-fade

export class MenuBackdrop {
  // shots: [{ src, depth }]
  constructor(parent, shots) {
    this.shots = shots;
    const cv = (this.canvas = document.createElement('canvas'));
    cv.className = 'ui-depth';
    parent.appendChild(cv);
    const gl = (this.gl = cv.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false }));
    if (!gl) throw new Error('no webgl2');
    this.prog = program(gl, VS, FS);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const n of ['uImg0', 'uDep0', 'uImg1', 'uDep1', 'uMix', 'uTime', 'uAspect', 'uImgAspect', 'uOff0', 'uOff1', 'uZoom0', 'uZoom1', 'uFocus0', 'uFocus1']) this.u[n] = gl.getUniformLocation(this.prog, n);
    this.slides = shots.map(() => null);
    this.mouse = { x: 0, y: 0, sx: 0, sy: 0 };
    this.onMove = (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', this.onMove);
    this.cur = Math.floor(Math.random() * shots.length);
    this.next = this.cur;
    this.t = 0;
    this.ready = this.load(this.cur).then(() => {
      this.start = performance.now();
      this.slideAt = 0;
      cv.classList.add('on');
    });
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  // A picture and its depth as textures; the focus is the depth of what is in the middle third.
  // (Decoded off the main thread, and taken in while a picture is standing, not at a change: the
  // decode and upload done at once held the menu still for a moment just as the pictures changed,
  // and it looked as if the next one tried to come and the old one stayed.)
  load(i) {
    if (!this.loading) this.loading = new Map();
    if (this.slides[i]) return Promise.resolve(this.slides[i]);
    if (this.loading.has(i)) return this.loading.get(i);
    const s = this.shots[i];
    const pr = Promise.all([bitmap(s.src), bitmap(s.depth)]).then(([img, dep]) => {
      const gl = this.gl;
      const slide = { img: texture(gl, img), dep: texture(gl, dep), aspect: img.width / img.height, focus: s.focus ?? focusOf(dep), path: drift() };
      img.close && img.close();
      dep.close && dep.close();
      this.slides[i] = slide;
      return slide;
    });
    this.loading.set(i, pr);
    return pr;
  }

  tick(now) {
    this.raf = requestAnimationFrame(this.tick);
    const gl = this.gl,
      cv = this.canvas;
    const w = Math.round(window.innerWidth * Math.min(window.devicePixelRatio || 1, 1.5)),
      h = Math.round(window.innerHeight * Math.min(window.devicePixelRatio || 1, 1.5));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const a = this.slides[this.cur];
    if (!a || this.start === undefined) return;
    const t = (now - this.start) / 1000;
    // next picture when this one has had its time (and the next has loaded)
    const age = t - this.slideAt;
    const nextI = (this.cur + 1) % this.shots.length;
    const b = this.slides[nextI];
    let mix = 0;
    if (age > SLIDE && b) mix = Math.min(1, (age - SLIDE) / FADE);
    if (mix >= 1) {
      this.cur = nextI;
      this.slideAt = t - FADE;
      mix = 0;
    }
    // the one after next comes in a few seconds into this one, well clear of the fade
    if (age > 3 && age < SLIDE - 2) this.load((this.cur + 1) % this.shots.length);
    const M = this.mouse;
    M.sx += (M.x - M.sx) * 0.04;
    M.sy += (M.y - M.sy) * 0.04;
    const cam = (s, age) => {
      // the slow move of each picture (a dolly across, a push in) plus the mouse
      const k = Math.min(1, age / (SLIDE + FADE * 2));
      const e = k * k * (3 - 2 * k);
      const p = s.path;
      return {
        off: [p.x0 + (p.x1 - p.x0) * e - M.sx * 0.014, p.y0 + (p.y1 - p.y0) * e + M.sy * 0.008],
        zoom: p.z0 + (p.z1 - p.z0) * e,
      };
    };
    const A = cam(a, age);
    const B = b ? cam(b, Math.max(0, age - SLIDE)) : A;
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    const bind = (unit, tex, name) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.u[name], unit);
    };
    bind(0, a.img, 'uImg0');
    bind(1, a.dep, 'uDep0');
    bind(2, (b || a).img, 'uImg1');
    bind(3, (b || a).dep, 'uDep1');
    gl.uniform1f(this.u.uMix, mix);
    gl.uniform1f(this.u.uTime, t);
    gl.uniform1f(this.u.uAspect, w / h);
    gl.uniform1f(this.u.uImgAspect, a.aspect);
    gl.uniform2f(this.u.uOff0, A.off[0], A.off[1]);
    gl.uniform2f(this.u.uOff1, B.off[0], B.off[1]);
    gl.uniform1f(this.u.uZoom0, A.zoom);
    gl.uniform1f(this.u.uZoom1, B.zoom);
    gl.uniform1f(this.u.uFocus0, a.focus);
    gl.uniform1f(this.u.uFocus1, (b || a).focus);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointermove', this.onMove);
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext && ext.loseContext();
    this.canvas.remove();
  }
}

function drift() {
  const r = () => Math.random() * 2 - 1;
  const side = Math.random() < 0.5 ? -1 : 1;
  return { x0: 0.02 * side + r() * 0.004, x1: -0.02 * side + r() * 0.004, y0: r() * 0.006, y1: r() * 0.006, z0: 1.07, z1: 1.07 + 0.035 + Math.random() * 0.03 };
}

// A picture decoded off the main thread, upside down as GL wants it (an <img> where
// createImageBitmap is missing: flipped on upload instead).
async function bitmap(src) {
  const res = await fetch(src);
  const blob = await res.blob();
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'flipY' });
    } catch (e) {
      // (older browsers without the options)
    }
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  img.flipOnUpload = true;
  return img;
}

function texture(gl, img) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !!img.flipOnUpload);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// The disparity the eye turns around: what fills the middle of the picture (for a picture without
// one worked out beforehand; a canvas kept off the graphics card, so reading it back waits on
// nothing).
function focusOf(img) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 36;
  const x = c.getContext('2d', { willReadFrequently: true });
  // (a bitmap comes upside down: the middle third is the middle third either way)
  x.drawImage(img, 0, 0, 64, 36);
  const d = x.getImageData(16, 10, 32, 20).data;
  const v = [];
  for (let i = 0; i < d.length; i += 4) v.push((d[i] / 255) ** 2);
  v.sort((a, b) => a - b);
  return v[Math.floor(v.length * 0.6)];
}

function program(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
