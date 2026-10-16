// Materials for the imported Beetle: PBR texture sets per source material, a repaintable body
// (paint mask from the import tool keeps the baked shading), glass, lamp lenses with emissive
// control, and the shared weathering (dust, dirt, rust, wet) used by the rest of the game.

import * as THREE from 'three';
import { applyWeathering, weatheringUniforms } from '../carMaterials.js';

const BASE = (import.meta.env && import.meta.env.BASE_URL ? import.meta.env.BASE_URL : './') + 'models/beetle/';
const NAMES = ['paint_color', 'paint_normal', 'paint_orm', 'paint_mask', 'trim_color', 'trim_normal', 'trim_orm', 'trim_mask', 'under_color', 'under_normal', 'under_orm', 'under_mask', 'mech_color', 'mech_normal', 'mech_orm', 'tyre_color', 'tyre_normal', 'tyre_orm'];

export function loadBeetleTextures(renderer) {
  const loader = new THREE.TextureLoader();
  const aniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
  return Promise.all(
    NAMES.map(
      (n) =>
        new Promise((res, rej) => {
          loader.load(
            BASE + n + '.webp',
            (t) => {
              t.flipY = false; // glTF uv convention
              t.wrapS = t.wrapT = THREE.RepeatWrapping;
              t.anisotropy = n.endsWith('color') ? aniso : Math.min(4, aniso);
              if (n.endsWith('_color')) t.colorSpace = THREE.SRGBColorSpace;
              res([n, t]);
            },
            undefined,
            rej
          );
        })
    )
  ).then((list) => Object.fromEntries(list));
}

function pbr(T, set, opts = {}) {
  return new THREE.MeshStandardMaterial({
    map: T[set + '_color'],
    normalMap: T[set + '_normal'],
    roughnessMap: T[set + '_orm'],
    metalnessMap: T[set + '_orm'],
    aoMap: T[set + '_orm'],
    aoMapIntensity: 0.85,
    roughness: 1,
    metalness: 1,
    side: THREE.DoubleSide,
    ...opts,
  });
}

// Masked paint: where the set's mask says "paint", the albedo becomes material.color times the
// texel's baked brightness; everything else (chrome strips, rubber, lenses, cloth) keeps the
// texture. The body set gets a clear coat; trim and underside sets carry body-coloured bits too.
function maskedMaterial(T, set, color, weather, { clearcoat = 0, strength = 1, rustColor = true } = {}) {
  const Ctor = clearcoat > 0 ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const m = new Ctor({
    map: T[set + '_color'],
    normalMap: T[set + '_normal'],
    roughnessMap: T[set + '_orm'],
    metalnessMap: T[set + '_orm'],
    aoMap: T[set + '_orm'],
    aoMapIntensity: 0.9,
    roughness: 1,
    metalness: 1,
    side: THREE.DoubleSide,
    emissive: 0x000000,
    ...(clearcoat > 0 ? { clearcoat, clearcoatRoughness: 0.18 } : {}),
  });
  m.color = color; // shared: repainting one set repaints them all
  const uniforms = { tPaintMask: { value: T[set + '_mask'] } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tPaintMask;\nfloat gPaint;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  vec3 pmk = texture2D( tPaintMask, vMapUv ).rgb;
  gPaint = smoothstep( 0.3, 0.7, pmk.r );
  vec3 painted = diffuse * clamp( pmk.g * 2.0, 0.0, 1.5 );
  diffuseColor.rgb = mix( sampledDiffuseColor.rgb, painted, gPaint );
#else
  gPaint = 0.0;
#endif`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
metalnessFactor *= 1.0 - gPaint * 0.85;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance *= 1.0 - gPaint;`
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
material.clearcoat *= gPaint;
#endif`
      );
  };
  m.customProgramCacheKey = () => 'beetleMask' + set;
  return applyWeathering(m, weather, { strength, rustColor });
}

function paintMaterial(T, color, weather) {
  return maskedMaterial(T, 'paint', color, weather, { clearcoat: 0.55 });
}

// Rusted, sun-bleached set for roadside wrecks; `paint.userData.make(color)` gives a recoloured
// copy (plain clone() would drop the shader hooks).
export function createWreckMaterials(T) {
  const weather = weatheringUniforms({ dirt: 0.9, dust: 0.85, rust: 0.8, fade: 0.85 });
  const make = (color) => {
    const m = paintMaterial(T, new THREE.Color(color), weather);
    m.clearcoat = 0;
    m.userData.make = make;
    return m;
  };
  return {
    paint: make(0x7a6a5a),
    trim: maskedMaterial(T, 'trim', new THREE.Color(0x7a6a5a), weather, { strength: 1.2 }),
    under: maskedMaterial(T, 'under', new THREE.Color(0x7a6a5a), weather, { strength: 1.4 }),
    mech: applyWeathering(pbr(T, 'mech'), weather, { strength: 1.2 }),
    tyre: applyWeathering(pbr(T, 'tyre', { side: THREE.FrontSide }), weather, { rustColor: false, strength: 1.5 }),
  };
}

export function createBeetleMaterials(T, opts = {}) {
  const color = new THREE.Color(opts.color ?? 0x6f8a7a);
  const weather = weatheringUniforms(opts.weather);
  const paint = paintMaterial(T, color, weather);
  const trim = maskedMaterial(T, 'trim', color, weather, { strength: 0.35, rustColor: false });
  trim.envMapIntensity = 0.8;
  const under = maskedMaterial(T, 'under', color, weather, { strength: 1.1, rustColor: false });
  const mech = applyWeathering(pbr(T, 'mech'), weather, { rustColor: false, strength: 0.6 });
  const tyre = pbr(T, 'tyre', { side: THREE.FrontSide });
  const glass = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.62, 0.7, 0.72),
    metalness: 0,
    roughness: 0.04,
    transparent: true,
    opacity: 0.22,
    envMapIntensity: 1.5,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  // headlamp glass glows when the lamps are on
  const headLens = new THREE.MeshStandardMaterial({
    color: 0xf4f6f8,
    metalness: 0,
    roughness: 0.05,
    transparent: true,
    opacity: 0.45,
    envMapIntensity: 1.6,
    emissive: 0xfff1d6,
    emissiveIntensity: 0,
    depthWrite: false,
  });
  // tail lamps: the red lenses live in the paint texture; a clone of the paint glows red
  // outside the paint mask
  const tailLens = paint.clone();
  tailLens.color = color;
  tailLens.emissive = new THREE.Color(0xff1a08);
  tailLens.emissiveMap = T.paint_color;
  tailLens.emissiveIntensity = 0;
  tailLens.onBeforeCompile = paint.onBeforeCompile;
  tailLens.customProgramCacheKey = () => paint.customProgramCacheKey() + 'tail';
  const amber = new THREE.MeshStandardMaterial({ color: 0xd98a1c, emissive: 0xffa020, emissiveIntensity: 0, roughness: 0.2 });
  // dashboard
  const gauge = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, emissive: 0xfff4dc, emissiveIntensity: 0.25 });
  const needle = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.4, emissive: 0xffe8c8, emissiveIntensity: 0 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0x220a06, emissive: 0xff2a10, emissiveIntensity: 0, roughness: 0.3 });
  const display = new THREE.MeshStandardMaterial({ color: 0x0d140f, roughness: 0.3, emissive: 0x000000, emissiveIntensity: 0 });
  const domeLens = new THREE.MeshStandardMaterial({ color: 0xece6d6, roughness: 0.4, emissive: 0xfff0d0, emissiveIntensity: 0 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.7 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8c8f92, metalness: 0.85, roughness: 0.38 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd9dcde, metalness: 1, roughness: 0.12 });
  const plastic = new THREE.MeshStandardMaterial({ color: 0x1a1b1c, roughness: 0.55 });
  const byName = { paint, trim, under, mech, tyre, glass, lens: headLens };
  return {
    byName,
    paint,
    color,
    weather,
    trim,
    under,
    mech,
    tyre,
    glass,
    headLens,
    tailLens,
    amber,
    gauge,
    needle,
    lamp,
    display,
    domeLens,
    black,
    rubber,
    steel,
    chrome,
    plastic,
  };
}
