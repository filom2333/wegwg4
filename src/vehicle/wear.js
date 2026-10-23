// Wear you can see: as a part's condition drops its metal dulls and browns with rust and grime
// and rubber and plastic go grey and dry. Each mesh of the part gets its own copy of its material
// (the first time it shows wear) and is tinted from the colour it started with.

import * as THREE from 'three';

// the parts that show it (the body shell and panels have their own dirt and dents)
const SHOWS = ['engine', 'alternator', 'starter', 'waterpump', 'battery', 'radiator', 'oilfilter', 'sparkplugs', 'airfilter', 'fanbelt', 'fueltank', 'exhaust'];
const RUST = new THREE.Color(0x5a3a22);
const GREY = new THREE.Color(0x6a6660);

export function showWear(car) {
  for (const id of SHOWS) {
    const part = car.model.parts[id];
    if (!part || !car.parts[id]) continue;
    // in steps of a tenth, so materials change rarely
    const cond = Math.round(car.partCond(id) * 10) / 10;
    if (part.wearShown === cond) continue;
    part.wearShown = cond;
    const k = Math.max(0, 0.8 - cond) / 0.8; // 0 while above 80 %, 1 when worn out
    part.inner.traverse((o) => {
      if (!o.isMesh || !o.material || Array.isArray(o.material) || o.material.transparent) return;
      if (!o.userData.wear) {
        if (k === 0) return;
        o.material = o.material.clone();
        o.userData.wear = { color: o.material.color.clone(), rough: o.material.roughness, metal: o.material.metalness };
      }
      const w = o.userData.wear;
      const metal = w.metal > 0.4;
      // rust or dried grey, and grime over everything
      o.material.color.copy(w.color).lerp(metal ? RUST : GREY, k * (metal ? 0.8 : 0.5)).multiplyScalar(1 - 0.3 * k);
      o.material.roughness = Math.min(1, w.rough + k * 0.45);
      o.material.metalness = w.metal * (1 - k * 0.5);
    });
  }
}
