// Surfaces for the signs, drawn once into canvases and handed to the stylesheet as CSS variables:
// the fine diamond grain of retroreflective sheeting with its scratches and road dust, rust
// weeping from the bolts and grime settled along the bottom edge, and galvanised steel for the
// posts. Seeded, so every visit looks the same.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

// Tiling sheeting: diamond-grade prisms, speckle, hairline scratches, dust.
function sheeting() {
  const [c, x] = canvas(256, 256);
  const r = rng(7);
  // prisms: rows of tiny diamonds, every other one catching the light
  for (let y = 0; y < 256; y += 4)
    for (let i = 0; i < 256; i += 4) {
      const lit = ((i + y) / 4) % 2 === 0;
      x.fillStyle = lit ? `rgba(255,255,255,${0.02 + r() * 0.03})` : `rgba(0,0,0,${0.02 + r() * 0.02})`;
      x.beginPath();
      x.moveTo(i + 2, y);
      x.lineTo(i + 4, y + 2);
      x.lineTo(i + 2, y + 4);
      x.lineTo(i, y + 2);
      x.fill();
    }
  // speckle
  for (let k = 0; k < 2600; k++) {
    x.fillStyle = r() < 0.5 ? `rgba(255,255,255,${r() * 0.07})` : `rgba(20,14,6,${r() * 0.09})`;
    x.fillRect(r() * 256, r() * 256, 1, 1);
  }
  // hairline scratches (wrapped round the tile)
  x.lineCap = 'round';
  for (let k = 0; k < 22; k++) {
    const x0 = r() * 256,
      y0 = r() * 256,
      a = (r() - 0.5) * 0.9 + (r() < 0.5 ? 0 : Math.PI / 2),
      l = 8 + r() * 70;
    x.strokeStyle = `rgba(255,255,255,${0.05 + r() * 0.1})`;
    x.lineWidth = 0.6 + r() * 0.6;
    for (const ox of [-256, 0, 256])
      for (const oy of [-256, 0, 256]) {
        x.beginPath();
        x.moveTo(x0 + ox, y0 + oy);
        x.lineTo(x0 + ox + Math.cos(a) * l, y0 + oy + Math.sin(a) * l);
        x.stroke();
      }
  }
  // road dust in soft patches
  for (let k = 0; k < 14; k++) {
    const px = r() * 256,
      py = r() * 256,
      rad = 10 + r() * 40;
    for (const ox of [-256, 0, 256])
      for (const oy of [-256, 0, 256]) {
        const g = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, rad);
        g.addColorStop(0, `rgba(120,95,60,${0.05 + r() * 0.05})`);
        g.addColorStop(1, 'rgba(120,95,60,0)');
        x.fillStyle = g;
        x.fillRect(px + ox - rad, py + oy - rad, rad * 2, rad * 2);
      }
  }
  return c.toDataURL();
}

// One sign's weathering (stretched over the whole face): rust weeping down from the bolts at
// the top corners and along the top edge, dust and road spray settled along the bottom.
function grime() {
  const W = 512,
    H = 512;
  const [c, x] = canvas(W, H);
  const r = rng(31);
  const streak = (sx, sy, len, w, a) => {
    const g = x.createLinearGradient(0, sy, 0, sy + len);
    g.addColorStop(0, `rgba(122,62,22,${a})`);
    g.addColorStop(0.6, `rgba(110,60,25,${a * 0.45})`);
    g.addColorStop(1, 'rgba(110,60,25,0)');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(sx - w / 2, sy);
    x.bezierCurveTo(sx - w * 0.3, sy + len * 0.4, sx + (r() - 0.5) * 6, sy + len * 0.7, sx + (r() - 0.5) * 4, sy + len);
    x.bezierCurveTo(sx + w * 0.2, sy + len * 0.6, sx + w * 0.4, sy + len * 0.3, sx + w / 2, sy);
    x.fill();
  };
  // from the bolts
  for (const bx of [16, W - 16]) for (let k = 0; k < 3; k++) streak(bx + (r() - 0.5) * 8, 14, 60 + r() * 120, 4 + r() * 6, 0.22 + r() * 0.12);
  // here and there along the top edge
  for (let k = 0; k < 9; k++) streak(30 + r() * (W - 60), 4, 20 + r() * 90, 2 + r() * 5, 0.06 + r() * 0.08);
  // the bottom: dust and spray, thicker at the edge
  const g = x.createLinearGradient(0, H * 0.62, 0, H);
  g.addColorStop(0, 'rgba(95,78,52,0)');
  g.addColorStop(0.7, 'rgba(95,78,52,0.12)');
  g.addColorStop(1, 'rgba(70,55,35,0.3)');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  for (let k = 0; k < 900; k++) {
    const y = H - Math.pow(r(), 2.2) * H * 0.38;
    x.fillStyle = `rgba(70,55,35,${r() * 0.12})`;
    x.beginPath();
    x.arc(r() * W, y, 0.5 + r() * 1.8, 0, Math.PI * 2);
    x.fill();
  }
  return c.toDataURL();
}

// Galvanised steel: fine vertical streaks and the spangle of the zinc.
function metal() {
  const [c, x] = canvas(32, 256);
  const r = rng(53);
  for (let i = 0; i < 32; i++) {
    x.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.12})`;
    x.fillRect(i, 0, 1, 256);
  }
  for (let k = 0; k < 60; k++) {
    x.fillStyle = `rgba(255,255,255,${r() * 0.1})`;
    x.fillRect(r() * 32, r() * 256, 2 + r() * 5, 2 + r() * 6);
  }
  for (let k = 0; k < 18; k++) {
    x.fillStyle = `rgba(120,70,30,${r() * 0.12})`;
    x.fillRect(r() * 32, r() * 256, 1 + r() * 3, 4 + r() * 20);
  }
  return c.toDataURL();
}

let done = false;
export function applySignTextures() {
  if (done || typeof document === 'undefined') return;
  done = true;
  try {
    const s = document.documentElement.style;
    s.setProperty('--tex-sheet', `url(${sheeting()})`);
    s.setProperty('--tex-grime', `url(${grime()})`);
    s.setProperty('--tex-metal', `url(${metal()})`);
  } catch (e) {
    /* plain signs then */
  }
}
