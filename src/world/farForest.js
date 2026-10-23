// The forest beyond the scatter's ring: tree cards placed per 256 m cell by a worker
// (farForestGen.js), drawn from where the scatter's own cards fade out (the two cross-dissolve)
// out to a few kilometres, where they fade into the canopy the terrain shader paints. Each card
// stands for the few trees around it, so a grove on a far ridge keeps its ragged skyline instead
// of the woods stopping at a line. No shadows, no colliders: four triangles a tree.

import * as THREE from 'three';
import { createImpostorMaterial } from '../gfx/impostor.js';
import { FCELL, FSTRIDE } from './farForestGen.js';
import { TREES } from './treeCover.js';
import { settings } from '../core/settings.js';

// how far the far forest reaches (m) by quality; none on low
const REACH = { low: 0, medium: 1400, high: 1900, ultra: 2400 };
const CAP = 9000;

export class FarForest {
  constructor(game, scatter) {
    this.game = game;
    this.far = REACH[settings.data.quality] ?? 1900;
    this.near = scatter.treeFar || 750;
    this.cells = new Map();
    this.lastCell = null;
    this.dirty = false;
    this.lastRebuild = 0;
    if (!this.far || !scatter.impostorGeos || this.far <= this.near + 200) {
      this.far = 0;
      return;
    }
    this.group = new THREE.Group();
    this.group.name = 'farForest';
    game.worldGroup.add(this.group);
    this.mat = createImpostorMaterial(scatter.impostorTex, scatter.impostorNormals, { near: this.near, far: this.far, fade: 450 });
    // one instanced card set per species variant, in TREES order
    this.meshes = TREES.map((t) =>
      (scatter.impostorGeos[t.id] || []).map((geo) => {
        const im = new THREE.InstancedMesh(geo, this.mat, CAP);
        im.count = 0;
        im.visible = false;
        im.frustumCulled = false;
        im.castShadow = false;
        im.receiveShadow = false;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(im);
        return im;
      })
    );
    try {
      this.worker = new Worker(new URL('./farForestWorker.js', import.meta.url), { type: 'module' });
      this.worker.postMessage({ type: 'init', seed: game.gen.seed });
      this.worker.onmessage = (e) => {
        const m = e.data;
        const c = this.cells.get(m.ci + ',' + m.cj);
        if (!c || c.data) return;
        c.data = m.data;
        this.dirty = true;
      };
    } catch (err) {
      this.far = 0;
    }
  }

  // px, pz: global coordinates of the player
  update(px, pz) {
    if (!this.far) return;
    const ci = Math.floor(px / FCELL),
      cj = Math.floor(pz / FCELL);
    const key = ci + ',' + cj;
    const now = performance.now();
    if (key !== this.lastCell) {
      this.lastCell = key;
      const R = Math.ceil(this.far / FCELL) + 1;
      const want = new Set();
      const ask = [];
      for (let j = -R; j <= R; j++)
        for (let i = -R; i <= R; i++) {
          const cx = (ci + i + 0.5) * FCELL,
            cz = (cj + j + 0.5) * FCELL;
          const d = Math.hypot(cx - px, cz - pz);
          // the ring the far cards show in (cells overlap it by half a diagonal)
          if (d > this.far + FCELL * 0.75 || d < this.near - 180 - FCELL * 0.75) continue;
          const k = ci + i + ',' + (cj + j);
          want.add(k);
          if (this.cells.has(k)) continue;
          this.cells.set(k, { ci: ci + i, cj: cj + j, data: null });
          ask.push([ci + i, cj + j, d]);
        }
      if (ask.length) {
        ask.sort((a, b) => a[2] - b[2]);
        this.worker.postMessage({ type: 'cells', cells: ask.map((a) => [a[0], a[1]]) });
      }
      for (const k of [...this.cells.keys()]) if (!want.has(k)) this.cells.delete(k);
      this.rebuild(px, pz);
      this.lastRebuild = now;
      this.dirty = false;
    } else if (this.dirty && now - this.lastRebuild > 400) {
      this.rebuild(px, pz);
      this.lastRebuild = now;
      this.dirty = false;
    }
  }

  rebuild(px, pz) {
    const o = this.game.origin;
    const lo = this.near - 180,
      hi = this.far;
    for (const list of this.meshes) for (const im of list) im.userData.n = 0;
    for (const c of this.cells.values()) {
      const d = c.data;
      if (!d || !d.length) continue;
      const x0 = c.ci * FCELL,
        z0 = c.cj * FCELL;
      for (let k = 0; k < d.length; k += FSTRIDE) {
        const gx = x0 + d[k + 2],
          gz = z0 + d[k + 4];
        const r = Math.hypot(gx - px, gz - pz);
        if (r < lo || r > hi) continue;
        const im = this.meshes[d[k]] && this.meshes[d[k]][d[k + 1]];
        if (!im) continue;
        const n = im.userData.n;
        if (n >= CAP) continue;
        im.userData.n = n + 1;
        const s = d[k + 5];
        // a turn from the position (stable, and the same tint each time the cell comes back)
        const rot = ((gx * 0.137 + gz * 0.291) % 6.283) + 0.001;
        const cs = Math.cos(rot) * s,
          sn = Math.sin(rot) * s;
        const a = im.instanceMatrix.array,
          off = n * 16;
        a[off] = cs;
        a[off + 1] = 0;
        a[off + 2] = -sn;
        a[off + 3] = 0;
        a[off + 4] = 0;
        a[off + 5] = s;
        a[off + 6] = 0;
        a[off + 7] = 0;
        a[off + 8] = sn;
        a[off + 9] = 0;
        a[off + 10] = cs;
        a[off + 11] = 0;
        a[off + 12] = gx - o.x;
        a[off + 13] = d[k + 3] - 0.3;
        a[off + 14] = gz - o.z;
        a[off + 15] = 1;
      }
    }
    for (const list of this.meshes)
      for (const im of list) {
        const n = im.userData.n;
        im.count = n;
        im.visible = n > 0;
        if (!n) continue;
        im.instanceMatrix.clearUpdateRanges();
        im.instanceMatrix.addUpdateRange(0, n * 16);
        im.instanceMatrix.needsUpdate = true;
      }
  }

  rebase() {
    this.lastCell = null;
  }
}
