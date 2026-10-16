// Trimmed-surface mesher: cuts the skin grid into panels using scalar region fields,
// with exact iso-line boundaries, material sub-regions, and thickened rims.

import { bodyField, bodyGradient } from './shape.js';

const SLOT_PAINT = 0;

// ---------------------------------------------------------------------------
// Full (mirrored) node set built from the half grid.

export class SkinNodes {
  constructor(grid) {
    this.grid = grid;
    const rows = grid.rows;
    // Count nodes: half 0 all, half 1 only non-shared.
    let n0 = 0;
    const rowStart0 = [];
    for (const r of rows) {
      rowStart0.push(n0);
      n0 += r.n;
    }
    let n1 = 0;
    const rowStart1 = [];
    for (const r of rows) {
      rowStart1.push(n0 + n1);
      n1 += Math.max(0, r.n - 2);
    }
    const total = n0 + n1;
    this.count = total;
    this.P = new Float64Array(total * 3);
    this.N = new Float32Array(total * 3);
    const idOf = (h, ri, c) => {
      const r = rows[ri];
      if (h === 0 || r.n === 1 || c === 0 || c === r.n - 1) return rowStart0[ri] + c;
      return rowStart1[ri] + (c - 1);
    };
    this.idOf = idOf;
    for (let ri = 0; ri < rows.length; ri++) {
      const r = rows[ri];
      for (let c = 0; c < r.n; c++) {
        for (const h of [0, 1]) {
          const id = idOf(h, ri, c);
          const sx = h === 0 ? 1 : -1;
          this.P[id * 3] = r.pos[c * 3] * sx;
          this.P[id * 3 + 1] = r.pos[c * 3 + 1];
          this.P[id * 3 + 2] = r.pos[c * 3 + 2];
          this.N[id * 3] = r.nrm[c * 3] * sx;
          this.N[id * 3 + 1] = r.nrm[c * 3 + 1];
          this.N[id * 3 + 2] = r.nrm[c * 3 + 2];
        }
      }
    }
    // Base triangulation: zipper between consecutive rows, both halves.
    const tris = [];
    for (const h of [0, 1]) {
      for (let ri = 0; ri < rows.length - 1; ri++) {
        const A = rows[ri],
          B = rows[ri + 1];
        let i = 0,
          j = 0;
        const d2 = (P, a, Q, b) => {
          const dx = P.pos[a * 3] - Q.pos[b * 3],
            dy = P.pos[a * 3 + 1] - Q.pos[b * 3 + 1],
            dz = P.pos[a * 3 + 2] - Q.pos[b * 3 + 2];
          return dx * dx + dy * dy + dz * dz;
        };
        while (i < A.n - 1 || j < B.n - 1) {
          let advA;
          if (i >= A.n - 1) advA = false;
          else if (j >= B.n - 1) advA = true;
          else advA = d2(A, i + 1, B, j) < d2(A, i, B, j + 1);
          if (advA) {
            tris.push(idOf(h, ri, i), idOf(h, ri + 1, j), idOf(h, ri, i + 1));
            i++;
          } else {
            tris.push(idOf(h, ri, i), idOf(h, ri + 1, j), idOf(h, ri + 1, j + 1));
            j++;
          }
        }
      }
    }
    this.tris = new Uint32Array(tris);
  }

  // Evaluates a region field on every node, normalised to surface distance near its zero set.
  evalField(fn, band = 0.08) {
    const out = new Float32Array(this.count);
    const P = this.P,
      N = this.N;
    const e = 6e-4;
    for (let i = 0; i < this.count; i++) {
      const x = P[i * 3],
        y = P[i * 3 + 1],
        z = P[i * 3 + 2];
      let v = fn(x, y, z);
      if (v > -band && v < band) {
        const gx = (fn(x + e, y, z) - fn(x - e, y, z)) / (2 * e);
        const gy = (fn(x, y + e, z) - fn(x, y - e, z)) / (2 * e);
        const gz = (fn(x, y, z + e) - fn(x, y, z - e)) / (2 * e);
        const nx = N[i * 3],
          ny = N[i * 3 + 1],
          nz = N[i * 3 + 2];
        const dn = gx * nx + gy * ny + gz * nz;
        const tx = gx - dn * nx,
          ty = gy - dn * ny,
          tz = gz - dn * nz;
        const gl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        v = v / Math.max(gl, 0.25);
      }
      out[i] = v;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Polygon clipping within cells.

function vtxNode(nodes, id, fields) {
  const vals = new Float64Array(fields.length);
  for (let f = 0; f < fields.length; f++) vals[f] = fields[f][id];
  return {
    key: 'n' + id,
    node: id,
    edge: null,
    p: [nodes.P[id * 3], nodes.P[id * 3 + 1], nodes.P[id * 3 + 2]],
    vals,
  };
}

function edgeKey(a, b) {
  return a < b ? a + '_' + b : b + '_' + a;
}

// Grid edge shared by two polygon vertices, if any.
function commonEdge(A, B) {
  if (A.node !== null && B.node !== null) return edgeKey(A.node, B.node);
  if (A.node !== null && B.edge) return B.edgeNodes[0] === A.node || B.edgeNodes[1] === A.node ? B.edge : null;
  if (B.node !== null && A.edge) return A.edgeNodes[0] === B.node || A.edgeNodes[1] === B.node ? A.edge : null;
  if (A.edge && B.edge && A.edge === B.edge) return A.edge;
  return null;
}

function intersect(A, B, f, iso, cellId) {
  const va = A.vals[f] - iso,
    vb = B.vals[f] - iso;
  const t = va / (va - vb);
  const vals = new Float64Array(A.vals.length);
  for (let k = 0; k < vals.length; k++) vals[k] = A.vals[k] + (B.vals[k] - A.vals[k]) * t;
  vals[f] = iso;
  const p = [A.p[0] + (B.p[0] - A.p[0]) * t, A.p[1] + (B.p[1] - A.p[1]) * t, A.p[2] + (B.p[2] - A.p[2]) * t];
  const ce = commonEdge(A, B);
  let key,
    edge = null,
    edgeNodes = null;
  if (ce) {
    key = 'e' + ce + '|' + f + '|' + iso;
    edge = ce;
    edgeNodes = A.node !== null && B.node !== null ? [A.node, B.node] : A.edge === ce ? A.edgeNodes : B.edgeNodes;
  } else {
    const ka = A.key < B.key ? A.key + '#' + B.key : B.key + '#' + A.key;
    key = 'c' + cellId + '|' + ka + '|' + f + '|' + iso;
  }
  return { key, node: null, edge, edgeNodes, p, vals, chord: !ce };
}

function clipKeep(poly, f, iso, cellId, keepAbove = true) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const A = poly[i],
      B = poly[(i + 1) % n];
    const ia = keepAbove ? A.vals[f] >= iso : A.vals[f] < iso;
    const ib = keepAbove ? B.vals[f] >= iso : B.vals[f] < iso;
    if (ia && ib) out.push(B);
    else if (ia && !ib) out.push(intersect(A, B, f, iso, cellId));
    else if (!ia && ib) {
      out.push(intersect(A, B, f, iso, cellId));
      out.push(B);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Panel surface extraction.

/**
 * Extracts the outer surface of a panel as the intersection of constraint half-spaces.
 * @param nodes        SkinNodes
 * @param constraints  [{ field: Float32Array, iso: number, sign: 1|-1 }] keep where sign*field >= iso
 * @param subs         [{ field: Float32Array, mat: number }] material sub-regions (iso 0), later override
 */
export function extractSurface(nodes, constraints, subs = [], { maxStep = 0.014 } = {}) {
  const fields = [...constraints.map((c) => c.field), ...subs.map((s) => s.field)];
  // analytic functions + the iso value each cut vertex sits on (for exact boundary projection)
  const fns = [...constraints.map((c) => c.fn || null), ...subs.map((s) => s.fn || null)];
  const targets = [...constraints.map((c) => (c.sign > 0 ? c.iso : -c.iso)), ...subs.map(() => 0)];
  const nc = constraints.length;
  const verts = new Map();
  const vlist = [];
  const tris = [];
  const mats = [];
  const getIndex = (v) => {
    let idx = verts.get(v.key);
    if (idx === undefined) {
      idx = vlist.length;
      verts.set(v.key, idx);
      vlist.push(v);
    }
    return idx;
  };
  const base = nodes.tris;
  const need = new Uint8Array(nc);
  for (let t = 0; t < base.length; t += 3) {
    const a = base[t],
      b = base[t + 1],
      c = base[t + 2];
    if (a === b || b === c || a === c) continue;
    let reject = false;
    let any = false;
    for (let k = 0; k < nc; k++) {
      const C = constraints[k];
      const f = C.field,
        s = C.sign,
        iso = C.iso;
      const ia = s * f[a] >= iso,
        ib = s * f[b] >= iso,
        ic = s * f[c] >= iso;
      if (!ia && !ib && !ic) {
        reject = true;
        break;
      }
      need[k] = ia && ib && ic ? 0 : 1;
      if (need[k]) any = true;
    }
    if (reject) continue;
    const cellId = t;
    // Orientation of this base triangle relative to the surface normal.
    const P = nodes.P,
      NN = nodes.N;
    const ux = P[b * 3] - P[a * 3],
      uy = P[b * 3 + 1] - P[a * 3 + 1],
      uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3],
      vy = P[c * 3 + 1] - P[a * 3 + 1],
      vz = P[c * 3 + 2] - P[a * 3 + 2];
    const gx = uy * vz - uz * vy,
      gy = uz * vx - ux * vz,
      gz = ux * vy - uy * vx;
    const sx = NN[a * 3] + NN[b * 3] + NN[c * 3],
      sy = NN[a * 3 + 1] + NN[b * 3 + 1] + NN[c * 3 + 1],
      sz = NN[a * 3 + 2] + NN[b * 3 + 2] + NN[c * 3 + 2];
    const flip = gx * sx + gy * sy + gz * sz < 0;
    let poly = [a, b, c].map((id) => vtxNode(nodes, id, fields));
    if (any) {
      for (let k = 0; k < nc && poly.length >= 3; k++) {
        if (!need[k]) continue;
        const C = constraints[k];
        poly = C.sign > 0 ? clipKeep(poly, k, C.iso, cellId, true) : clipKeep(poly, k, -C.iso, cellId, false);
      }
    }
    if (poly.length < 3) continue;
    let pieces = [{ poly, mat: 0 }];
    for (let s = 0; s < subs.length; s++) {
      const fi = nc + s;
      const next = [];
      for (const pc of pieces) {
        let allIn = true,
          allOut = true;
        for (const v of pc.poly) {
          if (v.vals[fi] >= 0) allOut = false;
          else allIn = false;
        }
        if (allIn) next.push({ poly: pc.poly, mat: subs[s].mat });
        else if (allOut) next.push(pc);
        else {
          const inside = clipKeep(pc.poly, fi, 0, cellId, true);
          const outside = clipKeep(pc.poly, fi, 0, cellId, false);
          if (inside.length >= 3) next.push({ poly: inside, mat: subs[s].mat });
          if (outside.length >= 3) next.push({ poly: outside, mat: pc.mat });
        }
      }
      pieces = next;
    }
    for (const pc of pieces) {
      const idx = pc.poly.map(getIndex);
      for (let k = 1; k < idx.length - 1; k++) {
        const i0 = idx[0],
          i1 = idx[k],
          i2 = idx[k + 1];
        if (i0 === i1 || i1 === i2 || i0 === i2) continue;
        if (flip) tris.push(i0, i2, i1);
        else tris.push(i0, i1, i2);
        mats.push(pc.mat);
      }
    }
  }
  const distOf = (v) => {
    let d = 1e3;
    for (let k = 0; k < nc; k++) {
      const C = constraints[k];
      const e = C.sign * v.vals[k] - C.iso;
      if (e < d) d = e;
    }
    return d;
  };

  // Positions: cut vertices were placed by linear interpolation along grid edges, which makes
  // seams wobble wherever the region field bends inside a cell. Slide them along the skin onto the
  // exact iso-line of every field they lie on, then re-project onto the skin.
  const nv = vlist.length;
  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  const dist = new Float32Array(nv);
  const g = [0, 0, 0];
  const toSkin = (p) => {
    for (let k = 0; k < 2; k++) {
      const f = bodyField(p[0], p[1], p[2]);
      const gl = bodyGradient(p[0], p[1], p[2], g);
      const st = f / Math.max(gl, 0.3);
      p[0] -= g[0] * st;
      p[1] -= g[1] * st;
      p[2] -= g[2] * st;
    }
  };
  const he = 6e-4;
  const onIso = [];
  const projectIso = (p, fn, target) => {
    for (let it = 0; it < 4; it++) {
      const x = p[0],
        y = p[1],
        z = p[2];
      const v = fn(x, y, z);
      const gx = (fn(x + he, y, z) - fn(x - he, y, z)) / (2 * he);
      const gy = (fn(x, y + he, z) - fn(x, y - he, z)) / (2 * he);
      const gz = (fn(x, y, z + he) - fn(x, y, z - he)) / (2 * he);
      bodyGradient(x, y, z, g); // g: unit skin normal
      const nx = g[0],
        ny = g[1],
        nz = g[2];
      const dn = gx * nx + gy * ny + gz * nz;
      const tx = gx - dn * nx,
        ty = gy - dn * ny,
        tz = gz - dn * nz;
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tl < 1e-4) return;
      // the sampled fields are normalised by the tangential gradient near their zero set
      const s = Math.abs(v) < 0.08 ? Math.max(tl, 0.25) : 1;
      const h = v / s - target;
      if (Math.abs(h) < 2e-5) return;
      let k = (-h * s) / (tl * tl);
      const len = Math.abs(k) * tl;
      if (len > maxStep) k *= maxStep / len;
      p[0] += tx * k;
      p[1] += ty * k;
      p[2] += tz * k;
      toSkin(p);
    }
  };
  for (let i = 0; i < nv; i++) {
    const v = vlist[i];
    let p = v.p;
    if (v.node === null) {
      p = [p[0], p[1], p[2]];
      toSkin(p);
      onIso.length = 0;
      for (let k = 0; k < fields.length; k++) if (fns[k] && Math.abs(v.vals[k] - targets[k]) < 1e-9) onIso.push(k);
      if (onIso.length) {
        const p0 = [p[0], p[1], p[2]];
        for (let round = 0; round < (onIso.length > 1 ? 3 : 1); round++) for (const k of onIso) projectIso(p, fns[k], targets[k]);
        // never wander more than a cell from where the grid put the vertex
        const dx = p[0] - p0[0],
          dy = p[1] - p0[1],
          dz = p[2] - p0[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > maxStep * 1.5 || !Number.isFinite(d)) {
          p[0] = p0[0];
          p[1] = p0[1];
          p[2] = p0[2];
        }
      }
    }
    pos[i * 3] = p[0];
    pos[i * 3 + 1] = p[1];
    pos[i * 3 + 2] = p[2];
    if (v.node !== null) {
      nrm[i * 3] = nodes.N[v.node * 3];
      nrm[i * 3 + 1] = nodes.N[v.node * 3 + 1];
      nrm[i * 3 + 2] = nodes.N[v.node * 3 + 2];
    } else {
      bodyGradient(p[0], p[1], p[2], g);
      if (Math.abs(p[0]) < 1e-7) g[0] = 0;
      nrm[i * 3] = g[0];
      nrm[i * 3 + 1] = g[1];
      nrm[i * 3 + 2] = g[2];
    }
    dist[i] = distOf(v);
  }

  return { pos, nrm, dist, tris: new Uint32Array(tris), mats: new Uint8Array(mats) };
}

// ---------------------------------------------------------------------------
// Boundary loops of a triangle mesh (edges used once), oriented with the triangle winding.

export function boundaryEdges(surf) {
  const { tris } = surf;
  const map = new Map();
  for (let t = 0; t < tris.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = tris[t + k],
        b = tris[t + ((k + 1) % 3)];
      const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      const e = map.get(key);
      if (e) e.count++;
      else map.set(key, { a, b, count: 1 });
    }
  }
  const edges = [];
  for (const e of map.values()) if (e.count === 1) edges.push([e.a, e.b]);
  return edges;
}

// ---------------------------------------------------------------------------
// Thickening: inner surface + rounded rim along every boundary.

/**
 * @param surf  output of extractSurface
 * @param opts  { depth: number|fn(x,y,z), edgeR: number (rim round radius), innerMode: 'level'|'offset',
 *                skipInner?: bool, rimSegs?: number, innerMat?, rimMat?, outerMats?: map sub-mat -> material index }
 * Returns BufferGeometry-ready arrays with groups: material index per triangle.
 */
export function thicken(surf, opts) {
  const { pos, nrm, tris, mats } = surf;
  const nv = pos.length / 3;
  const depthFn = typeof opts.depth === 'function' ? opts.depth : () => opts.depth;
  const edgeR = opts.edgeR ?? 0.004;
  const innerSegs = opts.rimSegs ?? 3;

  // Inner positions.
  const ipos = new Float32Array(nv * 3);
  const inrm = new Float32Array(nv * 3);
  const g = [0, 0, 0];
  // Sheet-metal edges: every cut edge is a short folded flange; the full section depth (door
  // cavity, sill, pillar box) is only reached a little way in from the edge. Without this, deep
  // panels showed tall slanted walls and torn-looking strips through every seam.
  const flange = opts.flange;
  for (let i = 0; i < nv; i++) {
    const x = pos[i * 3],
      y = pos[i * 3 + 1],
      z = pos[i * 3 + 2];
    let D = depthFn(x, y, z);
    if (flange) D = Math.min(D, flange + Math.max(0, surf.dist[i]) * 0.9);
    const nx0 = nrm[i * 3],
      ny0 = nrm[i * 3 + 1],
      nz0 = nrm[i * 3 + 2];
    let p = [x - nx0 * D, y - ny0 * D, z - nz0 * D];
    if (opts.innerMode !== 'offset') {
      const q = [p[0], p[1], p[2]];
      for (let k = 0; k < 3; k++) {
        const f = bodyField(p[0], p[1], p[2]) + D;
        const gl = bodyGradient(p[0], p[1], p[2], g);
        const st = f / Math.max(gl, 0.3);
        p[0] -= g[0] * st;
        p[1] -= g[1] * st;
        p[2] -= g[2] * st;
      }
      // in concave corners the inner level set folds over; keep the plain offset there
      const drift = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      if (!(drift < 0.35 * D + 0.002)) {
        p = q;
        g[0] = nx0;
        g[1] = ny0;
        g[2] = nz0;
      } else bodyGradient(p[0], p[1], p[2], g);
    } else {
      g[0] = nrm[i * 3];
      g[1] = nrm[i * 3 + 1];
      g[2] = nrm[i * 3 + 2];
    }
    ipos[i * 3] = p[0];
    ipos[i * 3 + 1] = p[1];
    ipos[i * 3 + 2] = p[2];
    inrm[i * 3] = -g[0];
    inrm[i * 3 + 1] = -g[1];
    inrm[i * 3 + 2] = -g[2];
  }

  const P = [],
    Nn = [],
    E = [],
    I = [],
    M = [];
  const pushV = (x, y, z, nx, ny, nz, e) => {
    const k = P.length / 3;
    P.push(x, y, z);
    Nn.push(nx, ny, nz);
    E.push(e);
    return k;
  };
  const outerMat = opts.outerMats || ((m) => m);
  const innerMat = opts.innerMat ?? 1;
  const rimMat = opts.rimMat ?? 0;

  // Outer surface.
  for (let i = 0; i < nv; i++) pushV(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2], surf.dist[i]);
  for (let t = 0; t < tris.length; t += 3) {
    I.push(tris[t], tris[t + 1], tris[t + 2]);
    M.push(outerMat(mats[t / 3]));
  }
  if (opts.skipInner) return finish();

  // Inner surface (reversed winding).
  const ib = P.length / 3;
  for (let i = 0; i < nv; i++) pushV(ipos[i * 3], ipos[i * 3 + 1], ipos[i * 3 + 2], inrm[i * 3], inrm[i * 3 + 1], inrm[i * 3 + 2], surf.dist[i]);
  for (let t = 0; t < tris.length; t += 3) {
    I.push(ib + tris[t], ib + tris[t + 2], ib + tris[t + 1]);
    M.push(typeof innerMat === 'function' ? innerMat(pos, tris, t) : innerMat);
  }

  // Rims.
  const edges = boundaryEdges(surf);
  // Per boundary-vertex outward direction.
  const outDir = new Map();
  for (const [a, b] of edges) {
    const nx = (nrm[a * 3] + nrm[b * 3]) * 0.5,
      ny = (nrm[a * 3 + 1] + nrm[b * 3 + 1]) * 0.5,
      nz = (nrm[a * 3 + 2] + nrm[b * 3 + 2]) * 0.5;
    const ex = pos[b * 3] - pos[a * 3],
      ey = pos[b * 3 + 1] - pos[a * 3 + 1],
      ez = pos[b * 3 + 2] - pos[a * 3 + 2];
    // outward = (b - a) x n  (length-weighted: short sliver edges carry little weight)
    const ox = ey * nz - ez * ny,
      oy = ez * nx - ex * nz,
      oz = ex * ny - ey * nx;
    for (const v of [a, b]) {
      const o = outDir.get(v) || [0, 0, 0];
      o[0] += ox;
      o[1] += oy;
      o[2] += oz;
      outDir.set(v, o);
    }
  }
  for (const o of outDir.values()) {
    const l = Math.hypot(o[0], o[1], o[2]) || 1;
    o[0] /= l;
    o[1] /= l;
    o[2] /= l;
  }
  // Rim ring vertices per boundary vertex.
  const rings = new Map();
  for (const [v, o] of outDir) {
    const n = [nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]];
    // make o tangent
    const dn = o[0] * n[0] + o[1] * n[1] + o[2] * n[2];
    const ot = [o[0] - dn * n[0], o[1] - dn * n[1], o[2] - dn * n[2]];
    const ol = Math.hypot(ot[0], ot[1], ot[2]) || 1;
    ot[0] /= ol;
    ot[1] /= ol;
    ot[2] /= ol;
    const po = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
    const pi = [ipos[v * 3], ipos[v * 3 + 1], ipos[v * 3 + 2]];
    const D = Math.max(1e-4, Math.hypot(po[0] - pi[0], po[1] - pi[1], po[2] - pi[2]));
    const r = Math.min(edgeR, D * 0.5);
    const ring = [];
    // outer arc: center co = po - n r
    const segs = innerSegs;
    for (let k = 0; k <= segs; k++) {
      const a = ((k / segs) * Math.PI) / 2;
      const cs = Math.cos(a),
        sn = Math.sin(a);
      const nx = n[0] * cs + ot[0] * sn,
        ny = n[1] * cs + ot[1] * sn,
        nz = n[2] * cs + ot[2] * sn;
      ring.push([po[0] - n[0] * r + nx * r, po[1] - n[1] * r + ny * r, po[2] - n[2] * r + nz * r, nx, ny, nz]);
    }
    // inner arc: center ci = pi + n r (n approximates inner normal reversed)
    const ni = [-inrm[v * 3], -inrm[v * 3 + 1], -inrm[v * 3 + 2]];
    for (let k = 0; k <= segs; k++) {
      const a = Math.PI / 2 + ((k / segs) * Math.PI) / 2;
      const cs = Math.cos(a),
        sn = Math.sin(a);
      const nx = ni[0] * cs + ot[0] * sn,
        ny = ni[1] * cs + ot[1] * sn,
        nz = ni[2] * cs + ot[2] * sn;
      ring.push([pi[0] + ni[0] * r + nx * r, pi[1] + ni[1] * r + ny * r, pi[2] + ni[2] * r + nz * r, nx, ny, nz]);
    }
    const idx = ring.map((q) => pushV(q[0], q[1], q[2], q[3], q[4], q[5], 0));
    rings.set(v, idx);
  }
  for (const [a, b] of edges) {
    const ra = rings.get(a),
      rb = rings.get(b);
    const rm = typeof rimMat === 'function' ? rimMat((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2) : rimMat;
    for (let k = 0; k < ra.length - 1; k++) {
      // quad ra[k], rb[k], rb[k+1], ra[k+1]; outward facing
      I.push(ra[k], ra[k + 1], rb[k]);
      I.push(rb[k], ra[k + 1], rb[k + 1]);
      // the outer half of the rim shows paint; the inner half (facing the opening) takes rimMat
      M.push(k < (ra.length - 1) / 2 ? SLOT_PAINT : rm, k < (ra.length - 1) / 2 ? SLOT_PAINT : rm);
    }
  }
  return finish();

  function finish() {
    return {
      position: new Float32Array(P),
      normal: new Float32Array(Nn),
      edge: new Float32Array(E),
      index: I,
      mats: M,
    };
  }
}
