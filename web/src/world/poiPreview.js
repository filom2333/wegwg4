// Builds a single POI's architecture for the inspection stand (no physics).
import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';
import { buildHouse } from './buildings/house.js';

export async function buildPoiPreview(type, seed) {
  const rnd = mulberry32(seed);
  const root = new THREE.Group();
  if (type === 'house') {
    const h = buildHouse(rnd, {});
    root.add(h.builder.build());
    // show door leaves closed for preview
    for (const d of h.builder.doors) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h, d.t), d.mat);
      leaf.geometry.translate((d.w / 2) * d.hingeSide, d.h / 2, 0);
      const piv = new THREE.Group();
      piv.position.copy(d.hinge);
      piv.rotation.y = d.rot + (d.hingeSide > 0 ? 0 : Math.PI) + d.open * 1.4;
      piv.add(leaf);
      root.add(piv);
    }
  }
  return root;
}
