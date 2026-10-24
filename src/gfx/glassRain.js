// Rain on car glass: beads that form and dry on a cell pattern across every pane, pulled into
// streaks by the airflow when driving, heavy ones running down the glass, and wiped off the
// windscreen where a blade has just gone over (each car's own sweep, see wipeUniforms).
// One shared state (updated each frame by the effects) drives the weather on every car's glass.

export const GLASS_RAIN = {
  rain: { value: 0 }, // 0..1 how wet the glass is
  time: { value: 0 },
  speed: { value: 0 }, // m/s of the current car, for streaking
  dust: { value: 0 }, // 0..1 sand settled on the glass (a sandstorm)
  dustFront: { value: 0 }, // the same where the wipers reach
};

// How many steps across its sweep a car keeps "seconds since a blade was here" for.
export const WIPE_BINS = 24;

// The wiper sweep of a car for its glass shader: each blade's spindle, the direction its arm lies
// parked, the band of radii the blade covers and the angle it sweeps through about the screen
// normal; `since` (seconds since a blade went over each step of the sweep) is kept by the car.
// blades: [{ pivot, dir, r0, r1 }] (up to two), axis: the screen normal.
export function wipeUniforms(blades, axis, sweep) {
  const b0 = blades[0],
    b1 = blades[1] || blades[0];
  return {
    uWOn: { value: 1 },
    uWN: { value: axis.clone() },
    uWS: { value: sweep },
    uWP0: { value: b0.pivot.clone() },
    uWP1: { value: b1.pivot.clone() },
    uWD0: { value: b0.dir.clone() },
    uWD1: { value: b1.dir.clone() },
    uWR0: { value: [b0.r0, b0.r1] },
    uWR1: { value: [b1.r0, b1.r1] },
    uWLast: { value: new Float32Array(WIPE_BINS).fill(1e3) },
  };
}

// wipe: the car's wipeUniforms, or none for glass no blade reaches
export function addGlassRain(mat, wipe = null) {
  if (!mat || mat.userData.glassRain) return;
  mat.userData.glassRain = true;
  const W = wipe || { uWOn: { value: 0 }, uWN: { value: [0, 0, 1] }, uWS: { value: 1 }, uWP0: { value: [0, 0, 0] }, uWP1: { value: [0, 0, 0] }, uWD0: { value: [1, 0, 0] }, uWD1: { value: [1, 0, 0] }, uWR0: { value: [0, 0] }, uWR1: { value: [0, 0] }, uWLast: { value: new Float32Array(WIPE_BINS) } };
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uGRain = GLASS_RAIN.rain;
    shader.uniforms.uGTime = GLASS_RAIN.time;
    shader.uniforms.uGSpeed = GLASS_RAIN.speed;
    shader.uniforms.uGDust = GLASS_RAIN.dust;
    shader.uniforms.uGDustF = GLASS_RAIN.dustFront;
    Object.assign(shader.uniforms, W);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGP;\nvarying vec3 vGN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGP = position;\nvGN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uGRain;
uniform float uGTime;
uniform float uGSpeed;
uniform float uGDust;
uniform float uGDustF;
uniform float uWOn;
uniform vec3 uWN;
uniform float uWS;
uniform vec3 uWP0;
uniform vec3 uWP1;
uniform vec3 uWD0;
uniform vec3 uWD1;
uniform vec2 uWR0;
uniform vec2 uWR1;
uniform float uWLast[${WIPE_BINS}];
varying vec3 vGP;
varying vec3 vGN;
float gDrop;
float gDropL;
vec2 gDropN;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// seconds since a wiper blade last went over this point of the glass (-1: no blade reaches it)
float gSinceWipe(vec3 p, vec3 nrm) {
  if (uWOn < 0.5 || abs(dot(nrm, uWN)) < 0.5) return -1.0;
  float best = -1.0;
  for (int k = 0; k < 2; k++) {
    vec3 piv = k == 0 ? uWP0 : uWP1;
    vec3 d0 = k == 0 ? uWD0 : uWD1;
    vec2 rr = k == 0 ? uWR0 : uWR1;
    vec3 v = p - piv;
    v -= uWN * dot(v, uWN);
    float r = length(v);
    if (r < rr.x || r > rr.y) continue;
    float th = atan(dot(v, cross(d0, uWN)), dot(v, d0)) / uWS;
    if (th < -0.03 || th > 1.03) continue;
    float fi = clamp(th, 0.0, 1.0) * ${WIPE_BINS - 1}.0;
    int i0 = int(floor(fi));
    float s = mix(uWLast[i0], uWLast[min(i0 + 1, ${WIPE_BINS - 1})], fract(fi));
    best = best < 0.0 ? s : min(best, s);
  }
  return best;
}`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
gDrop = 0.0;
gDropL = 1.0;
gDropN = vec2(0.0);
float gSince = gSinceWipe(vGP, normalize(vGN));
// pane coordinates in metres: x level across the pane, y up its slope
vec3 gN = normalize(vGN);
vec3 gT = abs(gN.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), gN));
vec2 gQ = vec2(dot(vGP, gT), dot(vGP, cross(gN, gT)));
// sand settled on the glass after a sandstorm: a speckled matte film, cleared where the wipers run
{
  float dAmt = gSince >= 0.0 ? uGDustF : uGDust;
  if (dAmt > 0.01) {
    vec2 dq = gQ * 90.0;
    float sp = gHash(floor(dq)) * 0.6 + gHash(floor(dq * 0.23) + 7.0) * 0.4;
    float film = dAmt * (0.55 + 0.45 * sp);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.5, 0.36), film * 0.7);
    diffuseColor.a = max(diffuseColor.a, film * 0.62);
  }
}
if (uGRain > 0.01) {
  vec2 q = gQ;
  // airflow drags the beads up and back the faster the car goes
  float stretch = 1.0 + clamp(uGSpeed / 12.0, 0.0, 3.0);
  q.y /= stretch;
  for (int k = 0; k < 2; k++) {
    float cell = k == 0 ? 0.024 : 0.013;
    vec2 p = q / cell + float(k) * 17.3;
    vec2 ci = floor(p), f = fract(p);
    float h = gHash(ci);
    // each bead forms and dries on its own clock
    float life = fract(uGTime * (0.05 + 0.08 * gHash(ci + 3.1)) + h);
    // where a blade went over, beads gather again one by one until the next pass
    float cover = uGRain * (gSince >= 0.0 ? 1.0 - exp(-gSince * (0.1 + 0.22 * uGRain) * (0.6 + 0.8 * gHash(ci + 11.3))) : 1.0);
    if (gHash(ci + 7.7) < cover * (k == 0 ? 0.55 : 0.75)) {
      vec2 c = vec2(gHash(ci + 1.3), gHash(ci + 5.9)) * 0.6 + 0.2;
      float r = (0.13 + 0.2 * gHash(ci + 9.2)) * smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.85, 1.0, life));
      vec2 d = (f - c) / max(r, 1e-3);
      float l = length(d);
      float m = 1.0 - smoothstep(0.75, 1.0, l);
      if (m > gDrop) {
        gDrop = m;
        gDropL = l;
        gDropN = d * m;
      }
    }
  }
  // heavy beads that run down the glass in fits and starts, leaving a thin wet trail; the
  // airflow holds them once the car is going
  {
    vec2 rq = gQ;
    float cw = 0.045, P = 0.7;
    float col = floor(rq.x / cw);
    float run = uGRain * (1.0 - smoothstep(5.0, 12.0, uGSpeed));
    if (gHash(vec2(col, 3.7)) < run * 0.5) {
      float ty = rq.y / P + gHash(vec2(col, 4.4));
      float ti = floor(ty), fy = fract(ty);
      float u = uGTime * (0.04 + 0.08 * gHash(vec2(col, ti + 1.9))) / P + gHash(vec2(col, ti + 8.1));
      u += 0.02 * sin(u * 40.0);
      float headY = 1.0 - fract(u);
      float xc = 0.3 + 0.4 * gHash(vec2(col, ti + 2.6)) + 0.06 * sin(fy * 23.0 + col);
      float dx = (fract(rq.x / cw) - xc) * cw;
      float dy = (fy - headY) * P;
      float rb = 0.0045;
      float hb = 1.0 - smoothstep(0.6, 1.0, length(vec2(dx, dy * (dy < 0.0 ? 0.8 : 0.5))) / rb);
      float tl = 0.12 + 0.2 * gHash(vec2(col, ti + 5.5));
      float tw = rb * 0.45 * (1.0 - clamp(dy / tl, 0.0, 1.0));
      float tr = dy > 0.0 && dy < tl ? 0.55 * (1.0 - smoothstep(tw * 0.5, tw, abs(dx))) : 0.0;
      float m = max(hb, tr) * (gSince >= 0.0 ? smoothstep(1.5, 4.0, gSince) : 1.0);
      if (m > gDrop) {
        gDrop = m;
        gDropL = hb >= tr ? length(vec2(dx, dy)) / rb : abs(dx) / max(tw, 1e-4);
        gDropN = vec2(dx, min(dy, 0.0)) / rb * m;
      }
    }
  }
  // a bead is a little lens: clear in the middle where it shows the bright sky, a thin dark rim
  // (the world shows upside down in it: the bright sky in its lower half, the dark ground above)
  float rim = smoothstep(0.72, 0.98, gDropL);
  float low = clamp(0.5 - 0.7 * gDropN.y / max(gDrop, 1e-3), 0.0, 1.0);
  diffuseColor.a = mix(diffuseColor.a, max(diffuseColor.a, 0.34 + 0.2 * rim), gDrop);
  diffuseColor.rgb *= mix(1.0, mix(0.4 + 1.2 * low, 0.35, rim), gDrop);
}`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
if (gDrop > 0.0) normal = normalize(normal + vec3(gDropN * 0.9, 0.0));`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.02, gDrop);`
      );
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + '|glassRain';
  mat.needsUpdate = true;
}
