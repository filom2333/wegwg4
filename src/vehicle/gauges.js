// Analogue gauge helpers shared by the car models: needle angles and a painted speedometer face.

// Needle angle: canvas angle a (clockwise from +x); speed sweeps 240 degrees from lower left,
// fuel sweeps the 70 degree arc at the top.
export function needleAngle(name, t) {
  t = Math.min(1, Math.max(0, t));
  if (name === 'fuel') return Math.PI * 1.5 - 0.61 + 1.22 * t;
  return Math.PI * (150 / 180) + Math.PI * (240 / 180) * t;
}

export function setNeedle(needles, name, t) {
  const n = needles && needles[name];
  if (!n) return;
  const a = needleAngle(name, t);
  n.rotation.z = -(a + Math.PI / 2);
}

// opts: minor / major tick steps, unit text, odometer digits (null: none), fuel arc, red zone from
export function drawSpeedoFace(ctx, S, max = 140, odo = '1 8 4 2 1 3', { minor = 5, major: majorStep = 20, unit = 'km/h', fuel = true, red = null } = {}) {
  const c = S / 2;
  ctx.fillStyle = '#0d0d0c';
  ctx.fillRect(0, 0, S, S);
  const grd = ctx.createRadialGradient(c, c, S * 0.1, c, c, S * 0.5);
  grd.addColorStop(0, '#1b1b19');
  grd.addColorStop(1, '#090909');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(c, c, S * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e9e4d6';
  ctx.fillStyle = '#e9e4d6';
  ctx.lineCap = 'butt';
  // speed scale
  for (let i = 0; i <= Math.round(max / minor); i++) {
    const v = i * minor;
    const a = needleAngle('speed', v / max);
    const major = Math.abs(v / majorStep - Math.round(v / majorStep)) < 1e-6;
    ctx.strokeStyle = red !== null && v >= red ? '#d8402a' : '#e9e4d6';
    const r0 = S * (major ? 0.36 : 0.395),
      r1 = S * 0.44;
    ctx.lineWidth = major ? S * 0.012 : S * 0.005;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    ctx.stroke();
    if (major) {
      ctx.font = `bold ${Math.round(S * 0.07)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const rt = S * 0.29;
      ctx.fillText(String(v), c + Math.cos(a) * rt, c + Math.sin(a) * rt);
    }
  }
  ctx.fillStyle = '#e9e4d6';
  ctx.font = `${Math.round(S * 0.04)}px Arial`;
  ctx.fillText(unit, c, c + S * 0.12);
  if (fuel) drawFuelArc(ctx, S, c);
  if (odo) {
    ctx.fillStyle = '#050505';
    ctx.fillRect(c - S * 0.12, c + S * 0.17, S * 0.24, S * 0.06);
    ctx.strokeStyle = '#5a5850';
    ctx.lineWidth = 2;
    ctx.strokeRect(c - S * 0.12, c + S * 0.17, S * 0.24, S * 0.06);
    ctx.fillStyle = '#d8d2c2';
    ctx.font = `bold ${Math.round(S * 0.042)}px monospace`;
    ctx.fillText(odo, c, c + S * 0.2);
  }
  // chrome ring shadow
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = S * 0.03;
  ctx.beginPath();
  ctx.arc(c, c, S * 0.485, 0, Math.PI * 2);
  ctx.stroke();
}

// Fuel gauge arc in the top of the dial.
function drawFuelArc(ctx, S, c) {
  const fy = c - S * 0.25;
  ctx.lineWidth = S * 0.008;
  for (let i = 0; i <= 4; i++) {
    const a = needleAngle('fuel', i / 4);
    const r0 = S * 0.09,
      r1 = S * (i % 2 === 0 ? 0.135 : 0.12);
    ctx.strokeStyle = i === 0 ? '#d8402a' : '#e9e4d6';
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, fy + Math.sin(a) * r0);
    ctx.lineTo(c + Math.cos(a) * r1, fy + Math.sin(a) * r1);
    ctx.stroke();
  }
  ctx.fillStyle = '#e9e4d6';
  ctx.font = `bold ${Math.round(S * 0.045)}px Arial`;
  ctx.fillText('R', c + Math.cos(needleAngle('fuel', 0)) * S * 0.16, fy + Math.sin(needleAngle('fuel', 0)) * S * 0.16);
  ctx.fillText('1/1', c + Math.cos(needleAngle('fuel', 1)) * S * 0.165, fy + Math.sin(needleAngle('fuel', 1)) * S * 0.165);
}
