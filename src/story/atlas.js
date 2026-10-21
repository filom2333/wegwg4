// The road atlas: a printed strip map of Route 9 the player keeps in the glovebox, drawn on a
// canvas. The highway, the distance signs, the rivers and lakes it crosses and the bigger places
// along it are printed; small places only go on once you have been there. Your own route is
// pencilled in as you drive, and you can pin notes anywhere ("fuel here", "wolves"). Photos from
// the photo mode are taped in where they were taken.

import { HAVEN_KM } from './story.js';
import { POI_SPACING, RIVER_SPACING, LAKE_CELL, TRACK } from '../world/worldGen.js';

// Printed in the atlas: places a 1980s road atlas would list. The rest are only marked once visited.
const PRINTED = new Set(['homestead', 'gasStation', 'motel', 'diner', 'church', 'outpost', 'lodge', 'ranch', 'farm', 'sawmill', 'radioTower', 'waterTower']);
const LABEL = {
  homestead: 'Homestead',
  gasStation: 'Gas',
  motel: 'Motel',
  diner: 'Diner',
  houses: 'Houses',
  house: 'House',
  ranch: 'Ranch',
  waterTower: 'Water tower',
  radioTower: 'Radio mast',
  junkyard: 'Junkyard',
  trailers: 'Trailer park',
  outpost: 'Outpost',
  ruins: 'Ruins',
  camp: 'Camp',
  wreck: 'Wreck',
  farm: 'Farm',
  cabin: 'Cabin',
  church: 'Church',
  sawmill: 'Sawmill',
  lodge: 'Lodge',
  lookout: 'Lookout',
};
const BIOME_TINT = {
  scrub: '#c9a774',
  dunes: '#dcb36a',
  badlands: '#b9774e',
  saltflat: '#e9e6dc',
  highland: '#b89a6a',
  prairie: '#b7b878',
  forest: '#7f9a6a',
  taiga: '#6b8466',
  tundra: '#c9d3d6',
};
const PAPER = '#ebe3cd';
const INK = '#2d2a24';

export class Atlas {
  constructor(game) {
    this.game = game;
    this.notes = []; // { x, z, text, day } world coordinates
    this.trail = []; // [x, z] pairs every ~80 m travelled
    this.photos = []; // { x, z, day, time, thumb (data url) }
  }

  update() {
    const g = this.game;
    const f = g.focusPoint();
    const x = f.x + g.origin.x,
      z = f.z + g.origin.z;
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(x - last[0], z - last[1]) > 80) {
      this.trail.push([Math.round(x), Math.round(z)]);
      if (this.trail.length > 6000) this.trail.splice(0, this.trail.length - 6000);
    }
  }

  addNote(x, z, text) {
    const n = { x: Math.round(x), z: Math.round(z), text: String(text).slice(0, 140), day: this.game.env.day };
    this.notes.push(n);
    return n;
  }

  removeNote(n) {
    this.notes = this.notes.filter((m) => m !== n);
  }

  serialize() {
    // photo thumbnails live in their own storage key (they are big)
    return { notes: this.notes, trail: this.trail };
  }

  restore(d) {
    if (!d) return;
    this.notes = d.notes || [];
    this.trail = d.trail || [];
  }

  // Where the player is, in world coordinates.
  here() {
    const g = this.game;
    const f = g.focusPoint();
    return { x: f.x + g.origin.x, z: f.z + g.origin.z };
  }
}

// ------------------------------------------------------------------ drawing
// view: { cx, cz (world centre), s (pixels per metre) }; returns hit regions for pins and photos.
export function drawAtlas(cv, game, view, opts = {}) {
  const ctx = cv.getContext('2d');
  const W = cv.width,
    H = cv.height;
  const dpr = opts.dpr || 1;
  const gen = game.gen;
  const atlas = game.atlas;
  // looking down with north (+z) up the page, +x lies to the left
  const sx = (x) => W / 2 - (x - view.cx) * view.s;
  const sy = (z) => H / 2 - (z - view.cz) * view.s;
  const zTop = view.cz + H / 2 / view.s,
    zBot = view.cz - H / 2 / view.s;
  const xL = view.cx - W / 2 / view.s,
    xR = view.cx + W / 2 / view.s; // (world x range on the page, whichever side each is on)
  const px = (n) => n * dpr;
  const hits = [];

  // paper
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  // land tint by biome in bands along the road
  const step = Math.max(150, 6 / view.s);
  for (let z = Math.floor(zBot / step) * step; z < zTop + step; z += step) {
    const b = gen.dominantBiome(gen.roadX(z), z);
    ctx.fillStyle = BIOME_TINT[b] || '#c9a774';
    ctx.globalAlpha = 0.28;
    ctx.fillRect(0, sy(z + step), W, sy(z) - sy(z + step) + 1);
  }
  ctx.globalAlpha = 1;
  // relief: hill shading from the north-west, from a coarse grid of the real ground heights
  // (cached: it only changes when the view does)
  const key = `${Math.round(view.cx)}|${Math.round(view.cz)}|${view.s.toFixed(5)}|${W}|${H}`;
  const cell = px(8);
  if (!drawAtlas.relief || drawAtlas.relief.key !== key) {
    const cols = Math.ceil(W / cell) + 3,
      rows = Math.ceil(H / cell) + 3;
    const m = cell / view.s; // metres per cell
    // zoomed out, the dunes and gullies would only alias: the big landforms carry the relief
    const bw = {};
    const hAt = m > 110 ? (x, z) => gen.macroHeight(x, z) + gen.mountain(x, z, gen.biomeWeights(x, z, bw)) : (x, z) => gen.height(x, z);
    const hs = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) hs[j * cols + i] = hAt(view.cx - ((i - 1) * cell - W / 2) / view.s, view.cz - ((j - 1) * cell - H / 2) / view.s);
    const rc = (drawAtlas.relief && drawAtlas.relief.canvas) || document.createElement('canvas');
    rc.width = cols;
    rc.height = rows;
    const r = rc.getContext('2d');
    const im = r.createImageData(cols, rows);
    for (let j = 1; j < rows - 1; j++)
      for (let i = 1; i < cols - 1; i++) {
        // +i runs east (-x), +j south (-z); light from the north-west lights slopes rising to the south-east
        const ddx = (hs[j * cols + i + 1] - hs[j * cols + i - 1]) / (2 * m),
          ddz = (hs[(j + 1) * cols + i] - hs[(j - 1) * cols + i]) / (2 * m);
        const a = Math.max(-0.6, Math.min(0.6, (ddx + ddz) * 1.6)) * (m > 110 ? 0.55 : 1);
        const k = (j * cols + i) * 4;
        if (a > 0) (im.data[k] = 255), (im.data[k + 1] = 250), (im.data[k + 2] = 236), (im.data[k + 3] = a * 150);
        else (im.data[k] = 74), (im.data[k + 1] = 50), (im.data[k + 2] = 30), (im.data[k + 3] = -a * 170);
      }
    r.putImageData(im, 0, 0);
    drawAtlas.relief = { key, canvas: rc };
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(drawAtlas.relief.canvas, -cell, -cell, drawAtlas.relief.canvas.width * cell, drawAtlas.relief.canvas.height * cell);
  // a fine paper grain
  if (!drawAtlas.grain) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const im = x.createImageData(128, 128);
    for (let i = 0; i < im.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 60;
      im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
      im.data[i + 3] = 22;
    }
    x.putImageData(im, 0, 0);
    drawAtlas.grain = c;
  }
  ctx.fillStyle = ctx.createPattern(drawAtlas.grain, 'repeat');
  ctx.fillRect(0, 0, W, H);
  // kilometre grid
  const km = view.s * 1000 < px(18) ? 5000 : 1000;
  ctx.strokeStyle = 'rgba(60,80,110,0.16)';
  ctx.lineWidth = px(1);
  ctx.beginPath();
  for (let x = Math.ceil(xL / km) * km; x < xR; x += km) ctx.moveTo(sx(x), 0), ctx.lineTo(sx(x), H);
  for (let z = Math.ceil(zBot / km) * km; z < zTop; z += km) ctx.moveTo(0, sy(z)), ctx.lineTo(W, sy(z));
  ctx.stroke();

  // lakes
  for (let k = Math.floor(zBot / LAKE_CELL) - 1; k <= Math.ceil(zTop / LAKE_CELL) + 1; k++) {
    const l = gen.lake(k);
    if (!l) continue;
    // the shoreline worldGen uses: a rotated ellipse with a wobble
    const c = Math.cos(l.rot),
      sn = Math.sin(l.rot);
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const wob = 1 + 0.16 * Math.sin(a * 3 + l.phase) + 0.08 * Math.sin(a * 7 + l.phase * 2);
      const u = Math.cos(a) * wob * l.rx,
        v = Math.sin(a) * wob * l.rz;
      const x = l.x + u * c + v * sn,
        z = l.z - u * sn + v * c;
      if (i === 0) ctx.moveTo(sx(x), sy(z));
      else ctx.lineTo(sx(x), sy(z));
    }
    ctx.fillStyle = l.frozen ? '#d9e6ec' : '#8fb7c9';
    ctx.fill();
    ctx.strokeStyle = '#4d7f99';
    ctx.lineWidth = px(1);
    ctx.stroke();
  }
  // rivers: their course across the map, dashed where they run dry
  for (let k = Math.floor(zBot / RIVER_SPACING) - 1; k <= Math.ceil(zTop / RIVER_SPACING) + 1; k++) {
    const r = gen.river(k);
    if (!r) continue;
    ctx.beginPath();
    const x0 = Math.max(xL, gen.roadX(r.zr) - 6000),
      x1 = Math.min(xR, gen.roadX(r.zr) + 6000);
    for (let x = x0, i = 0; x <= x1; x += 6 / view.s, i++) {
      const z = gen.riverZ(r, x);
      if (i === 0) ctx.moveTo(sx(x), sy(z));
      else ctx.lineTo(sx(x), sy(z));
    }
    ctx.strokeStyle = r.dry ? '#a58a62' : r.frozen ? '#9fbfd0' : '#4d86a8';
    ctx.lineWidth = px(Math.max(1.4, Math.min(5, r.w * view.s)));
    ctx.setLineDash(r.dry ? [px(5), px(4)] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // dirt side tracks: brown dashes; where the highway is closed, a black bar across it
  ctx.lineWidth = px(2);
  ctx.strokeStyle = '#8a6a44';
  ctx.setLineDash([px(4), px(3)]);
  const tracks = [];
  for (let t = Math.floor(zBot / TRACK.every) - 1; t <= Math.ceil(zTop / TRACK.every) + 1; t++) {
    const tr = gen.track(t);
    if (!tr) continue;
    tracks.push(tr);
    ctx.beginPath();
    for (let z = tr.z0, i = 0; z <= tr.z1; z += Math.max(4, 5 / view.s), i++) {
      if (i === 0) ctx.moveTo(sx(gen.trackX(tr, z)), sy(z));
      else ctx.lineTo(sx(gen.trackX(tr, z)), sy(z));
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Route 9: a white-cased red line
  const road = () => {
    ctx.beginPath();
    for (let z = zBot - 50, i = 0; z <= zTop + 50; z += 5 / view.s, i++) {
      if (i === 0) ctx.moveTo(sx(gen.roadX(z)), sy(z));
      else ctx.lineTo(sx(gen.roadX(z)), sy(z));
    }
  };
  road();
  ctx.strokeStyle = '#fbf7ec';
  ctx.lineWidth = px(6);
  ctx.stroke();
  road();
  ctx.strokeStyle = '#b8352a';
  ctx.lineWidth = px(3);
  ctx.stroke();

  for (const tr of tracks) {
    if (!tr.block) continue;
    const x = sx(gen.roadX(tr.block.z)),
      y = sy(tr.block.z);
    ctx.fillStyle = '#1d1a16';
    ctx.fillRect(x - px(6), y - px(1.5), px(12), px(3));
  }

  // distance signs every 5 km, and route shields
  ctx.font = `${px(10)}px Barlow, Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  for (let z = Math.ceil(zBot / 5000) * 5000; z < zTop; z += 5000) {
    if (z <= 0) continue;
    const x = sx(gen.roadX(z));
    ctx.fillStyle = INK;
    ctx.fillRect(x + px(5), sy(z) - px(0.5), px(6), px(1));
    ctx.fillText(`${HAVEN_KM - z / 1000}`, x + px(13), sy(z));
    if ((z / 5000) % 2 === 0) shield(ctx, x - px(16), sy(z + 1200), px);
  }
  // Haven
  const hz = HAVEN_KM * 1000;
  if (hz > zBot && hz < zTop + 2000) {
    const x = sx(gen.roadX(hz)),
      y = sy(hz);
    star(ctx, x, y, px(9), '#b8352a');
    ctx.font = `bold ${px(13)}px Barlow, Arial, sans-serif`;
    ctx.fillStyle = INK;
    ctx.fillText('HAVEN', x + px(13), y);
  }

  // places
  const visited = new Set();
  for (const [k, st] of game.pois.state) if (st.visited) visited.add(+k);
  ctx.font = `${px(10)}px Barlow, Arial, sans-serif`;
  for (let k = Math.floor(zBot / POI_SPACING) - 1; k <= Math.ceil(zTop / POI_SPACING) + 1; k++) {
    const p = gen.poiSlot(k);
    if (!p) continue;
    const seen = visited.has(k);
    if (!seen && !PRINTED.has(p.type)) continue;
    const x = sx(p.x),
      y = sy(p.z);
    ctx.globalAlpha = seen ? 1 : 0.55;
    placeMark(ctx, p.type, x, y, px);
    if (view.s * POI_SPACING > px(26)) {
      // label on the far side from the road
      const away = x > sx(gen.roadX(p.z)) ? 1 : -1;
      ctx.fillStyle = INK;
      ctx.textAlign = away > 0 ? 'left' : 'right';
      ctx.fillText(LABEL[p.type] + (seen ? ' ✓' : ''), x + away * px(9), y);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
  }

  // your route, pencilled in
  const tr = atlas.trail;
  if (tr.length > 1) {
    ctx.beginPath();
    for (let i = 0; i < tr.length; i++) {
      const [x, z] = tr[i];
      if (i === 0) ctx.moveTo(sx(x), sy(z));
      else ctx.lineTo(sx(x), sy(z));
    }
    ctx.strokeStyle = 'rgba(40,36,30,0.55)';
    ctx.lineWidth = px(1.2);
    ctx.setLineDash([px(3), px(3)]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // tents
  const o = game.origin;
  for (const t of game.tents ? game.tents.list : []) {
    const x = sx(t.pos.x + o.x),
      y = sy(t.pos.z + o.z);
    ctx.fillStyle = '#7a4a1e';
    ctx.beginPath();
    ctx.moveTo(x, y - px(6));
    ctx.lineTo(x + px(6), y + px(4));
    ctx.lineTo(x - px(6), y + px(4));
    ctx.closePath();
    ctx.fill();
  }
  // photos taped in
  for (const ph of atlas.photos) {
    const x = sx(ph.x),
      y = sy(ph.z);
    ctx.fillStyle = '#fbf8f0';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = px(1);
    ctx.fillRect(x - px(6), y - px(5), px(12), px(10));
    ctx.strokeRect(x - px(6), y - px(5), px(12), px(10));
    ctx.fillStyle = '#5d6c78';
    ctx.fillRect(x - px(4), y - px(3), px(8), px(5));
    hits.push({ kind: 'photo', photo: ph, x, y, r: px(9) });
  }
  // notes: pushpins
  atlas.notes.forEach((n, i) => {
    const x = sx(n.x),
      y = sy(n.z);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(x + px(1.5), y + px(1.5), px(6), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c63d2f';
    ctx.beginPath();
    ctx.arc(x, y, px(6), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${px(8)}px Barlow, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), x, y + px(0.5));
    ctx.textAlign = 'left';
    hits.push({ kind: 'note', note: n, x, y, r: px(9) });
  });
  // the car and you
  const car = game.car;
  if (car) {
    const c = car.root.position;
    const x = sx(c.x + o.x),
      y = sy(c.z + o.z);
    ctx.fillStyle = '#1f4f6e';
    ctx.fillRect(x - px(4), y - px(4), px(8), px(8));
    ctx.strokeStyle = '#fbf7ec';
    ctx.lineWidth = px(1.5);
    ctx.strokeRect(x - px(4), y - px(4), px(8), px(8));
  }
  {
    const p = game.player.position;
    // heading: yaw 0 faces +z (north); a car's forward is its local +z
    const e = car && car.root.matrixWorld.elements;
    const yaw = game.player.seat && car ? Math.atan2(e[8], e[10]) : game.player.yaw;
    const x = sx(p.x + o.x),
      y = sy(p.z + o.z);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI - yaw);
    ctx.beginPath();
    ctx.moveTo(0, px(9));
    ctx.lineTo(px(6), -px(6));
    ctx.lineTo(0, -px(3));
    ctx.lineTo(-px(6), -px(6));
    ctx.closePath();
    ctx.fillStyle = '#d63a22';
    ctx.fill();
    ctx.strokeStyle = '#fbf7ec';
    ctx.lineWidth = px(1.5);
    ctx.stroke();
    ctx.restore();
  }

  // margin furniture: north arrow and scale bar
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = px(1.5);
  const nx = W - px(34),
    ny = px(40);
  ctx.beginPath();
  ctx.moveTo(nx, ny - px(16));
  ctx.lineTo(nx + px(7), ny + px(8));
  ctx.lineTo(nx, ny + px(3));
  ctx.lineTo(nx - px(7), ny + px(8));
  ctx.closePath();
  ctx.fill();
  ctx.font = `bold ${px(12)}px Barlow, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('N', nx, ny - px(25));
  ctx.textAlign = 'left';
  const bar = [500, 1000, 2000, 5000, 10000, 20000].find((m) => m * view.s > px(70)) || 20000;
  const bx = px(18),
    by = H - px(20);
  ctx.fillRect(bx, by, bar * view.s, px(3));
  ctx.font = `${px(10)}px Barlow, Arial, sans-serif`;
  ctx.fillText(bar >= 1000 ? `${bar / 1000} km` : `${bar} m`, bx + bar * view.s + px(6), by + px(2));
  return { hits, toWorld: (cx, cy) => ({ x: view.cx - (cx - W / 2) / view.s, z: view.cz - (cy - H / 2) / view.s }) };
}

function shield(ctx, x, y, px) {
  ctx.fillStyle = '#fbf7ec';
  ctx.strokeStyle = '#2d2a24';
  ctx.lineWidth = px(1);
  ctx.beginPath();
  ctx.moveTo(x - px(7), y - px(7));
  ctx.lineTo(x + px(7), y - px(7));
  ctx.lineTo(x + px(7), y + px(1));
  ctx.quadraticCurveTo(x + px(6), y + px(6), x, y + px(8));
  ctx.quadraticCurveTo(x - px(6), y + px(6), x - px(7), y + px(1));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2d2a24';
  ctx.font = `bold ${px(9)}px Barlow, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('9', x, y);
  ctx.textAlign = 'left';
}

function star(ctx, x, y, r, col) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
}

// Atlas symbols: fuel a red disc, food and beds blue squares, buildings black squares, a cross for
// a church, a tower for masts, a cross-hatch for a wreck or junkyard, a triangle for camps.
function placeMark(ctx, type, x, y, px) {
  const r = px(4);
  ctx.lineWidth = px(1.2);
  ctx.strokeStyle = '#2d2a24';
  ctx.fillStyle = '#2d2a24';
  switch (type) {
    case 'gasStation':
      ctx.fillStyle = '#c63d2f';
      ctx.beginPath();
      ctx.arc(x, y, r * 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${px(7)}px Barlow, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('G', x, y + px(0.5));
      ctx.textAlign = 'left';
      ctx.font = `${px(10)}px Barlow, Arial, sans-serif`;
      return;
    case 'diner':
    case 'motel':
    case 'lodge':
      ctx.fillStyle = '#2f5a78';
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      return;
    case 'church':
      ctx.fillRect(x - px(1), y - r * 1.4, px(2), r * 2.8);
      ctx.fillRect(x - r, y - r * 0.6, r * 2, px(2));
      return;
    case 'radioTower':
    case 'waterTower':
    case 'lookout':
      ctx.beginPath();
      ctx.moveTo(x, y - r * 1.5);
      ctx.lineTo(x + r, y + r);
      ctx.lineTo(x - r, y + r);
      ctx.closePath();
      ctx.stroke();
      return;
    case 'wreck':
    case 'junkyard':
      ctx.beginPath();
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.stroke();
      return;
    case 'camp':
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.lineTo(x - r, y + r);
      ctx.closePath();
      ctx.fill();
      return;
    default:
      ctx.fillRect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
  }
}
