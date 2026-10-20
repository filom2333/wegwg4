// Rain on car glass: beads that form and dry on a cell pattern across every pane, pulled into
// streaks by the airflow when driving, and mostly cleared from the windscreen while the wipers run.
// One shared state (updated each frame by the effects) drives the glass of every car.

export const GLASS_RAIN = {
  rain: { value: 0 }, // 0..1 how wet the glass is
  time: { value: 0 },
  speed: { value: 0 }, // m/s of the current car, for streaking
  wipe: { value: 0 }, // 0..1 wipers running
};

export function addGlassRain(mat) {
  if (!mat || mat.userData.glassRain) return;
  mat.userData.glassRain = true;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uGRain = GLASS_RAIN.rain;
    shader.uniforms.uGTime = GLASS_RAIN.time;
    shader.uniforms.uGSpeed = GLASS_RAIN.speed;
    shader.uniforms.uGWipe = GLASS_RAIN.wipe;
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
uniform float uGWipe;
varying vec3 vGP;
varying vec3 vGN;
float gDrop;
float gDropL;
vec2 gDropN;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
gDrop = 0.0;
gDropL = 1.0;
gDropN = vec2(0.0);
if (uGRain > 0.01) {
  // pane coordinates: the windscreen and back light face along z, side windows along x
  vec3 an = abs(normalize(vGN));
  bool front = an.z > an.x;
  vec2 q = front ? vGP.xy : vGP.zy;
  // airflow drags the beads up and back the faster the car goes
  float stretch = 1.0 + clamp(uGSpeed / 12.0, 0.0, 3.0);
  q.y /= stretch;
  for (int k = 0; k < 2; k++) {
    float cell = k == 0 ? 0.03 : 0.017;
    vec2 p = q / cell + float(k) * 17.3;
    vec2 ci = floor(p), f = fract(p);
    float h = gHash(ci);
    // each bead forms and dries on its own clock
    float life = fract(uGTime * (0.05 + 0.08 * gHash(ci + 3.1)) + h);
    float cover = uGRain * (front && vGP.y > 0.0 ? 1.0 - 0.75 * uGWipe : 1.0);
    if (gHash(ci + 7.7) < cover * (k == 0 ? 0.55 : 0.75)) {
      vec2 c = vec2(gHash(ci + 1.3), gHash(ci + 5.9)) * 0.6 + 0.2;
      float r = (0.16 + 0.2 * gHash(ci + 9.2)) * smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.85, 1.0, life));
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
  // a bead is a little lens: clear in the middle where it shows the bright sky, a thin dark rim
  float rim = smoothstep(0.55, 0.92, gDropL);
  diffuseColor.a = mix(diffuseColor.a, max(diffuseColor.a, 0.22 + 0.3 * rim), gDrop);
  diffuseColor.rgb *= mix(1.0, mix(1.25 + 0.25 * clamp(-gDropN.y, 0.0, 1.0), 0.55, rim), gDrop);
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
