// Vehicle inspection & validation stand.
// Orbit around the car, open/close every hinged part, hide parts, and switch to analysis
// render modes (clay, wireframe, normals, back-face hole finder, section cut, open-edge and
// intersection reports) to critically check the generated geometry.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildCarBody } from '../vehicle/body/carBody.js';
import { createCarMaterials } from '../vehicle/carMaterials.js';
import { CarModel } from '../vehicle/carModel.js';
import { Sky, EnvironmentBaker } from '../gfx/sky.js';

const canvas = document.getElementById('view');
const statusEl = document.getElementById('status');
const panelEl = document.getElementById('panel');
const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = params.get('shadows') !== '0';
renderer.shadowMap.type = params.get('vsm') === '0' ? THREE.PCFShadowMap : THREE.VSMShadowMap;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.02, 500);
camera.position.set(5.2, 2.0, 5.6);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.7, 0);
controls.enableDamping = true;

const sky = new Sky();
scene.add(sky.mesh);
sky.uniforms.uSunDir.value.set(0.55, 0.62, 0.42).normalize();
sky.uniforms.uCloud.value = 0.15;
const baker = new EnvironmentBaker(renderer);
scene.environment = baker.bake(sky.uniforms, new THREE.Color(0x6d675f));

const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.copy(sky.uniforms.uSunDir.value).multiplyScalar(20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -4;
sun.shadow.camera.right = 4;
sun.shadow.camera.top = 4;
sun.shadow.camera.bottom = -4;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 50;
sun.shadow.bias = -0.0004;
sun.shadow.radius = 3;
sun.shadow.blurSamples = 12;
sun.shadow.normalBias = 0.045;
scene.add(sun);
const hemi = new THREE.HemisphereLight(0xbcd2ee, 0x5a4c3c, 0.35);
scene.add(hemi);

// Stand floor: concrete with measuring grid (1 m major, 10 cm minor).
const floorMat = new THREE.ShaderMaterial({
  uniforms: {},
  vertexShader: `varying vec3 vP; void main(){ vP = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(vP,1.0);} `,
  fragmentShader: `varying vec3 vP;
  float line(float c, float w){ float d = abs(fract(c - 0.5) - 0.5) / fwidth(c); return 1.0 - clamp(d - w, 0.0, 1.0); }
  void main(){
    vec3 base = vec3(0.32, 0.31, 0.3);
    float minor = max(line(vP.x*10.0, 0.0), line(vP.z*10.0, 0.0)) * 0.10;
    float major = max(line(vP.x, 0.5), line(vP.z, 0.5)) * 0.35;
    float r = length(vP.xz);
    vec3 c = base * (1.0 - minor - major) * mix(1.0, 0.55, smoothstep(6.0, 16.0, r));
    gl_FragColor = vec4(pow(c, vec3(1.0)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`,
});
const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), floorMat);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const shadowCatcher = new THREE.Mesh(new THREE.CircleGeometry(12, 64), new THREE.ShadowMaterial({ opacity: 0.45 }));
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.position.y = 0.001;
shadowCatcher.receiveShadow = true;
scene.add(shadowCatcher);

// Inspection lights: a lamp in the cabin and two soft work lights at floor level for the underside.
const cabinLamp = new THREE.PointLight(0xfff0dc, 1.6, 2.6, 1.6);
cabinLamp.position.set(0, 1.25, -0.2);
cabinLamp.visible = false;
scene.add(cabinLamp);
const workLights = new THREE.Group();
for (const [x, z] of [
  [2.5, 1.5],
  [-2.5, -1.5],
]) {
  const l = new THREE.PointLight(0xffffff, 6, 8, 1.5);
  l.position.set(x, 0.25, z);
  workLights.add(l);
}
workLights.visible = false;
scene.add(workLights);

let car = null;
let body = null;
let mats = null;
const state = {
  mode: 'shaded',
  section: { axis: 'none', pos: 0 },
  open: {},
  hidden: {},
  overlays: [],
};

const VIEWS = {
  front34: { pos: [4.2, 1.6, 5.4], target: [0, 0.65, 0.2] },
  rear34: { pos: [-4.4, 1.8, -5.4], target: [0, 0.7, -0.2] },
  left: { pos: [7.5, 0.9, 0], target: [0, 0.7, 0] },
  right: { pos: [-7.5, 0.9, 0], target: [0, 0.7, 0] },
  front: { pos: [0, 0.9, 7.5], target: [0, 0.7, 0] },
  rear: { pos: [0, 1.0, -7.5], target: [0, 0.7, 0] },
  top: { pos: [0.001, 8.5, 0], target: [0, 0.5, 0] },
  bottom: { pos: [0.001, -6.0, 0.01], target: [0, 0.5, 0] },
  driver: { pos: [0.37, 1.15, -0.32], target: [0.37, 1.0, 1.5] },
  rearseat: { pos: [0.0, 1.12, -1.0], target: [0, 0.95, 1.0] },
  enginebay: { pos: [0.0, 2.3, 3.2], target: [0, 0.6, 1.5] },
  trunkview: { pos: [0.0, 2.0, -3.7], target: [0, 0.6, -1.8] },
  doorjamb: { pos: [2.4, 1.1, 0.6], target: [0.7, 0.75, 0.2] },
  wheel: { pos: [2.1, 0.55, 2.4], target: [0.75, 0.35, 1.3] },
};

function setView(name) {
  const v = VIEWS[name];
  if (!v) return;
  camera.position.set(...v.pos);
  controls.target.set(...v.target);
  camera.fov = name === 'driver' || name === 'rearseat' ? 70 : 38;
  camera.updateProjectionMatrix();
  controls.update();
}

// ---------- render modes ----------
const clayMat = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.62, metalness: 0 });
const normalMat = new THREE.MeshNormalMaterial();
const holeMat = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalMatrix*normal; vV = -mv.xyz; gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `varying vec3 vN; varying vec3 vV; void main(){ float d = abs(dot(normalize(vN), normalize(vV))); vec3 c = gl_FrontFacing ? vec3(0.55)*(0.35+0.65*d) : vec3(1.0,0.0,0.85); gl_FragColor = vec4(c,1.0);} `,
});
const sectionPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);

function meshesOf(root) {
  const out = [];
  root.traverse((o) => o.isMesh && out.push(o));
  return out;
}

function applyMode() {
  if (!car) return;
  const clip = state.section.axis !== 'none' ? [sectionPlane] : [];
  for (const m of meshesOf(car.root)) {
    let mat;
    switch (state.mode) {
      case 'clay':
      case 'wire':
        mat = clayMat;
        break;
      case 'normals':
        mat = normalMat;
        break;
      case 'holes':
        mat = holeMat;
        break;
      default:
        mat = null;
    }
    if (mat) m.material = new Array(16).fill(mat);
    else m.material = mats.slots;
  }
  const allMats = new Set([clayMat, normalMat, holeMat, ...mats.slots.filter(Boolean)]);
  for (const mm of allMats) {
    mm.clippingPlanes = clip;
    if (clip.length && mm !== holeMat) mm.side = THREE.DoubleSide;
    else if (mm !== holeMat && mm !== mats.slots[9]) mm.side = THREE.FrontSide;
    mm.needsUpdate = true;
  }
  holeMat.clipping = clip.length > 0;
  // wireframe overlay
  clearOverlay('wire');
  if (state.mode === 'wire') {
    for (const m of meshesOf(car.root)) {
      const w = new THREE.LineSegments(
        new THREE.WireframeGeometry(m.geometry),
        new THREE.LineBasicMaterial({ color: 0x1d1d1d, transparent: true, opacity: 0.35 })
      );
      w.userData.overlay = 'wire';
      m.add(w);
      state.overlays.push(w);
    }
  }
}

function clearOverlay(tag) {
  state.overlays = state.overlays.filter((o) => {
    if (o.userData.overlay === tag) {
      o.parent && o.parent.remove(o);
      o.geometry.dispose();
      return false;
    }
    return true;
  });
}

function setSection(axis, pos) {
  state.section.axis = axis;
  state.section.pos = pos;
  if (axis === 'x') sectionPlane.set(new THREE.Vector3(-1, 0, 0), pos);
  if (axis === 'y') sectionPlane.set(new THREE.Vector3(0, -1, 0), pos);
  if (axis === 'z') sectionPlane.set(new THREE.Vector3(0, 0, -1), pos);
  if (window.subject) {
    const clip = axis !== 'none' ? [sectionPlane] : [];
    window.subject.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.clippingPlanes = clip;
        m.clipShadows = true;
        m.needsUpdate = true;
      }
    });
    markDirty();
    return;
  }
  applyMode();
}

// ---------- analysis ----------
function weldKey(x, y, z) {
  return Math.round(x * 2e4) + ',' + Math.round(y * 2e4) + ',' + Math.round(z * 2e4);
}

// Open (boundary) edges after welding coincident vertices: closed shells must report zero.
function indexOf(geo) {
  if (geo.index) return geo.index.array;
  const n = geo.attributes.position.count;
  const a = new Uint32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  return a;
}

function openEdges(geo) {
  const pos = geo.attributes.position.array;
  const idx = indexOf(geo);
  const remap = new Map();
  const id = new Uint32Array(pos.length / 3);
  for (let i = 0; i < id.length; i++) {
    const k = weldKey(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    let v = remap.get(k);
    if (v === undefined) {
      v = i;
      remap.set(k, v);
    }
    id[i] = v;
  }
  const edges = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = id[idx[t + k]],
        b = id[idx[t + ((k + 1) % 3)]];
      if (a === b) continue;
      const key = a < b ? a + '_' + b : b + '_' + a;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  const out = [];
  for (const [key, c] of edges) {
    if (c === 1) {
      const [a, b] = key.split('_').map(Number);
      out.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
    }
  }
  return out;
}

function runOpenEdges() {
  clearOverlay('open');
  const lines = [];
  let report = '';
  for (const m of meshesOf(car.root)) {
    if (m.name.startsWith('glass') || m.name === 'windshield' || m.name === 'rearglass') continue;
    const e = openEdges(m.geometry);
    const n = e.length / 6;
    report += `${m.name.padEnd(13)} ${n === 0 ? 'closed' : n + ' open'}\n`;
    if (n) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(e, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xff2a2a, depthTest: false }));
      l.renderOrder = 10;
      l.userData.overlay = 'open';
      m.add(l);
      state.overlays.push(l);
    }
    lines.push(n);
  }
  setReport(report);
  return report;
}

// Triangle-triangle intersection test between different meshes (world space).
function triTriIntersect(a, b) {
  // Möller's interval overlap test (compact implementation).
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const n2 = cross(sub(b[1], b[0]), sub(b[2], b[0]));
  const d2 = -dot(n2, b[0]);
  const da = a.map((p) => dot(n2, p) + d2);
  if ((da[0] > 1e-9 && da[1] > 1e-9 && da[2] > 1e-9) || (da[0] < -1e-9 && da[1] < -1e-9 && da[2] < -1e-9)) return false;
  const n1 = cross(sub(a[1], a[0]), sub(a[2], a[0]));
  const d1 = -dot(n1, a[0]);
  const db = b.map((p) => dot(n1, p) + d1);
  if ((db[0] > 1e-9 && db[1] > 1e-9 && db[2] > 1e-9) || (db[0] < -1e-9 && db[1] < -1e-9 && db[2] < -1e-9)) return false;
  const D = cross(n1, n2);
  const interval = (tri, d) => {
    const p = tri.map((v) => dot(D, v));
    // find the vertex on the opposite side
    let i0, i1, i2;
    if (d[0] * d[1] > 0) [i0, i1, i2] = [2, 0, 1];
    else if (d[0] * d[2] > 0) [i0, i1, i2] = [1, 0, 2];
    else if (d[1] * d[2] > 0 || d[0] !== 0) [i0, i1, i2] = [0, 1, 2];
    else if (d[1] !== 0) [i0, i1, i2] = [1, 0, 2];
    else [i0, i1, i2] = [2, 0, 1];
    const t1 = p[i1] + ((p[i0] - p[i1]) * d[i1]) / (d[i1] - d[i0]);
    const t2 = p[i2] + ((p[i0] - p[i2]) * d[i2]) / (d[i2] - d[i0]);
    return t1 < t2 ? [t1, t2] : [t2, t1];
  };
  if (Math.abs(dot(D, D)) < 1e-14) return false; // coplanar: ignore
  const ia = interval(a, da);
  const ib = interval(b, db);
  return !(ia[1] < ib[0] || ib[1] < ia[0]);
}

function runIntersections(filter) {
  clearOverlay('isect');
  const cell = 0.04;
  const buckets = new Map();
  const tris = [];
  const meshes = meshesOf(car.root).filter((m) => m.visible && m.parent.visible && (!filter || filter(m)));
  car.root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  meshes.forEach((m, mi) => {
    const pos = m.geometry.attributes.position;
    const idx = indexOf(m.geometry);
    const world = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      world.push([v.x, v.y, v.z]);
    }
    for (let t = 0; t < idx.length; t += 3) {
      const tri = [world[idx[t]], world[idx[t + 1]], world[idx[t + 2]]];
      const id = tris.length;
      tris.push({ tri, mesh: mi });
      const mn = [0, 1, 2].map((k) => Math.min(tri[0][k], tri[1][k], tri[2][k]));
      const mx = [0, 1, 2].map((k) => Math.max(tri[0][k], tri[1][k], tri[2][k]));
      for (let x = Math.floor(mn[0] / cell); x <= Math.floor(mx[0] / cell); x++)
        for (let y = Math.floor(mn[1] / cell); y <= Math.floor(mx[1] / cell); y++)
          for (let z = Math.floor(mn[2] / cell); z <= Math.floor(mx[2] / cell); z++) {
            const k = x + ',' + y + ',' + z;
            let b = buckets.get(k);
            if (!b) buckets.set(k, (b = []));
            b.push(id);
          }
    }
  });
  const hits = new Map();
  const tested = new Set();
  const hitTris = [];
  for (const b of buckets.values()) {
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) {
        const A = tris[b[i]],
          B = tris[b[j]];
        if (A.mesh === B.mesh) continue;
        const key = b[i] < b[j] ? b[i] * 1e7 + b[j] : b[j] * 1e7 + b[i];
        if (tested.has(key)) continue;
        tested.add(key);
        if (triTriIntersect(A.tri, B.tri)) {
          const pair = [meshes[A.mesh].name, meshes[B.mesh].name].sort().join(' × ');
          hits.set(pair, (hits.get(pair) || 0) + 1);
          hitTris.push(...A.tri.flat(), ...B.tri.flat());
        }
      }
    }
  }
  let report = 'Intersections (triangle pairs):\n';
  if (hits.size === 0) report += 'none\n';
  for (const [k, c] of [...hits].sort((a, b) => b[1] - a[1])) report += `${k}: ${c}\n`;
  if (hitTris.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(hitTris, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xff1010, side: THREE.DoubleSide, depthTest: false }));
    m.renderOrder = 11;
    m.userData.overlay = 'isect';
    scene.add(m);
    state.overlays.push(m);
  }
  setReport(report);
  return { report, pairs: Object.fromEntries(hits) };
}

// Skin grid integrity: folded / grazing base triangles reveal non star-shaped regions of the field.
function runSkinCheck() {
  clearOverlay('skin');
  const nodes = body.nodes;
  const T = nodes.tris,
    P = nodes.P,
    N = nodes.N;
  const em = new Map();
  for (let t = 0; t < T.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = T[t + k],
        b = T[t + ((k + 1) % 3)];
      if (a === b) continue;
      const key = a < b ? a + '_' + b : b + '_' + a;
      em.set(key, (em.get(key) || 0) + 1);
    }
  let open = 0;
  for (const c of em.values()) if (c === 1) open++;
  const bad = [];
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t],
      b = T[t + 1],
      c = T[t + 2];
    const ux = P[b * 3] - P[a * 3],
      uy = P[b * 3 + 1] - P[a * 3 + 1],
      uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3],
      vy = P[c * 3 + 1] - P[a * 3 + 1],
      vz = P[c * 3 + 2] - P[a * 3 + 2];
    const gx = uy * vz - uz * vy,
      gy = uz * vx - ux * vz,
      gz = ux * vy - uy * vx;
    const l = Math.hypot(gx, gy, gz);
    if (l < 1e-10) continue;
    const d =
      (gx * (N[a * 3] + N[b * 3] + N[c * 3]) + gy * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + gz * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2])) /
      l /
      3;
    if (Math.abs(d) < 0.3) bad.push(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]);
  }
  if (bad.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bad, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xff00ff, size: 8, sizeAttenuation: false, depthTest: false }));
    pts.renderOrder = 12;
    pts.userData.overlay = 'skin';
    scene.add(pts);
    state.overlays.push(pts);
  }
  const report = `Skin grid: ${nodes.count} nodes, ${T.length / 3} tris\nopen edges: ${open}\nfolded/grazing tris: ${bad.length / 3}`;
  setReport(report);
  markDirty();
  return report;
}

const STAGES = {
  frame: ['chassis', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'],
  shell: ['body'],
  panels: ['door_FL', 'door_FR', 'door_RL', 'door_RR', 'hood', 'trunk', 'fender_L', 'fender_R', 'bumper_F', 'bumper_R', 'headlight_L', 'headlight_R', 'taillight_L', 'taillight_R', 'fuelflap'],
  mech: ['engine', 'battery', 'radiator', 'airfilter', 'exhaust', 'fueltank'],
  interior: ['seat_FL', 'seat_FR', 'seat_R', 'steeringWheel'],
};
function setStage(stage) {
  const order = ['frame', 'shell', 'panels', 'mech', 'interior'];
  const upto = stage === 'full' ? order.length - 1 : order.indexOf(stage);
  const on = new Set();
  order.forEach((k, i) => i <= upto && STAGES[k].forEach((p) => on.add(p)));
  for (const id of Object.keys(car.parts)) car.setInstalled(id, on.has(id));
  markDirty();
}

let reportEl = null;
function setReport(text) {
  if (reportEl) reportEl.textContent = text;
}

// ---------- UI ----------
function buildUI() {
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    Object.assign(e, attrs);
    kids.forEach((k) => e.append(k));
    return e;
  };
  panelEl.innerHTML = '';
  panelEl.append(h('h1', { textContent: 'Inspection stand' }));

  panelEl.append(h('h2', { textContent: 'Camera' }));
  const vr = h('div', { className: 'row' });
  for (const name of Object.keys(VIEWS)) vr.append(h('button', { textContent: name, onclick: () => setView(name) }));
  panelEl.append(vr);

  panelEl.append(h('h2', { textContent: 'Open / close' }));
  const orow = h('div', { className: 'row' });
  for (const id of Object.keys(car.parts).filter((k) => car.parts[k].hinge)) {
    const b = h('button', { textContent: id });
    b.onclick = () => {
      const t = car.parts[id].openT > 0.5 ? 0 : 1;
      car.setOpen(id, t);
      b.classList.toggle('on', t > 0.5);
    };
    orow.append(b);
  }
  orow.append(
    h('button', {
      textContent: 'all',
      onclick: () => {
        const any = Object.values(car.parts).some((p) => p.hinge && p.openT > 0.5);
        for (const p of Object.values(car.parts)) if (p.hinge) car.setOpen(p.id, any ? 0 : 1);
        buildUI();
      },
    })
  );
  panelEl.append(orow);

  panelEl.append(h('h2', { textContent: 'Lighting' }));
  const lr = h('div', { className: 'row' });
  const cab = h('button', { textContent: 'cabin lamp', className: cabinLamp.visible ? 'on' : '' });
  cab.onclick = () => {
    cabinLamp.visible = !cabinLamp.visible;
    cab.classList.toggle('on', cabinLamp.visible);
    markDirty();
  };
  const work = h('button', { textContent: 'work lights', className: workLights.visible ? 'on' : '' });
  work.onclick = () => {
    workLights.visible = !workLights.visible;
    work.classList.toggle('on', workLights.visible);
    markDirty();
  };
  lr.append(cab, work);
  panelEl.append(lr);

  panelEl.append(h('h2', { textContent: 'Render mode' }));
  const sel = h('select');
  for (const m of ['shaded', 'clay', 'wire', 'normals', 'holes']) sel.append(h('option', { value: m, textContent: m, selected: state.mode === m }));
  sel.onchange = () => {
    state.mode = sel.value;
    applyMode();
  };
  panelEl.append(sel);

  panelEl.append(h('h2', { textContent: 'Section cut' }));
  const ax = h('select');
  for (const a of ['none', 'x', 'y', 'z']) ax.append(h('option', { value: a, textContent: a === 'none' ? 'off' : a.toUpperCase() + ' plane' }));
  const sl = h('input', { type: 'range', min: -2.4, max: 2.4, step: 0.005, value: 0 });
  const upd = () => setSection(ax.value, parseFloat(sl.value));
  ax.onchange = upd;
  sl.oninput = upd;
  panelEl.append(ax, sl);

  panelEl.append(h('h2', { textContent: 'Analysis' }));
  const ar = h('div', { className: 'row' });
  ar.append(h('button', { textContent: 'open edges', onclick: runOpenEdges }));
  ar.append(h('button', { textContent: 'intersections', onclick: () => runIntersections() }));
  ar.append(h('button', { textContent: 'skin grid', onclick: runSkinCheck }));
  ar.append(
    h('button', {
      textContent: 'clear',
      onclick: () => {
        clearOverlay('open');
        clearOverlay('isect');
        setReport('');
      },
    })
  );
  panelEl.append(ar);
  reportEl = h('div', { className: 'report' });
  panelEl.append(reportEl);

  panelEl.append(h('h2', { textContent: 'Assembly stage' }));
  const st = h('select');
  for (const [k, label] of [
    ['full', 'complete vehicle'],
    ['frame', '1 · rolling chassis'],
    ['shell', '2 · + body shell'],
    ['panels', '3 · + exterior panels'],
    ['mech', '4 · + mechanicals'],
    ['interior', '5 · + interior'],
  ])
    st.append(h('option', { value: k, textContent: label }));
  st.onchange = () => {
    setStage(st.value);
    buildUI();
  };
  panelEl.append(st);

  panelEl.append(h('h2', { textContent: 'Parts' }));
  const pl = h('div', { className: 'parts' });
  for (const id of Object.keys(car.parts)) {
    const cb = h('input', { type: 'checkbox', checked: car.parts[id].installed });
    cb.onchange = () => car.setInstalled(id, cb.checked);
    pl.append(h('label', {}, cb, id));
  }
  panelEl.append(pl);
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

let dirty = 2;
controls.addEventListener('change', () => (dirty = 2));
function markDirty() {
  dirty = 2;
}
function loop() {
  controls.update();
  if (dirty > 0) {
    renderer.render(scene, camera);
    dirty--;
  }
  requestAnimationFrame(loop);
}
window.addEventListener('pointerdown', markDirty);
window.addEventListener('pointerup', markDirty);
window.addEventListener('change', markDirty, true);
window.addEventListener('click', () => setTimeout(markDirty, 0), true);

// Non-car subjects (buildings, props, creatures) for the same stand.
async function initSubject(subject) {
  const seed = +(params.get('seed') || 1);
  const { mulberry32 } = await import('../core/noise.js');
  const rnd = mulberry32(seed);
  let group;
  if (subject === 'house' || subject === 'poi') {
    const { buildPoiPreview } = await import('../world/poiPreview.js');
    group = await buildPoiPreview(params.get('type') || 'house', seed);
  }
  if (subject === 'hand') {
    const { buildHand } = await import('../player/hands.js');
    group = new THREE.Group();
    ['relax', 'grip', 'pistol', 'carry', 'pinch'].forEach((p, i) => {
      const h = buildHand(p);
      h.position.set((i - 2) * 0.16, 0.25, 0);
      group.add(h);
    });
  }
  if (subject === 'items') {
    const { MODEL_BUILDERS } = await import('../items/itemModels.js');
    group = new THREE.Group();
    const names = Object.keys(MODEL_BUILDERS);
    names.forEach((n, i) => {
      const m = MODEL_BUILDERS[n]();
      const b = new THREE.Box3().setFromObject(m);
      m.position.set((i % 7) * 0.45 - 1.35, -b.min.y + 0.0, Math.floor(i / 7) * 0.5 - 0.5);
      group.add(m);
    });
  }
  void rnd;
  scene.add(group);
  window.subject = group;
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  sun.shadow.camera.left = -size.length() / 1.6;
  sun.shadow.camera.right = size.length() / 1.6;
  sun.shadow.camera.top = size.length() / 1.6;
  sun.shadow.camera.bottom = -size.length() / 1.6;
  sun.shadow.camera.updateProjectionMatrix();
  camera.position.set(size.x * 0.9, size.y * 1.4 + 4, size.z * 1.3 + 6);
  controls.target.set(0, 1.2, 0);
  controls.update();
  if (params.get('ui') === '0') {
    panelEl.style.display = 'none';
    statusEl.style.display = 'none';
  }
  statusEl.textContent = subject + ' seed ' + seed;
  loop();
  window.__ready = true;
}

async function init() {
  await new Promise((r) => setTimeout(r, 30));
  const subject = params.get('subject');
  if (subject && subject !== 'car') return initSubject(subject);
  const res = parseFloat(params.get('res') || '0.028');
  body = buildCarBody({ res });
  mats = createCarMaterials({ color: params.get('color') ? parseInt(params.get('color'), 16) : 0xb4532a });
  car = new CarModel(body, mats);
  car.addWheels();
  car.addExteriorDetails();
  car.addInterior();
  car.addEngineBay();
  car.addChassis();
  scene.add(car.root);
  let tris = 0;
  for (const m of meshesOf(car.root)) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  statusEl.textContent = `built in ${body.buildMs.toFixed(0)} ms · ${(tris / 1000).toFixed(0)}k triangles`;
  buildUI();
  setView(params.get('view') || 'front34');
  if (params.get('ui') === '0') {
    panelEl.style.display = 'none';
    statusEl.style.display = 'none';
  }
  if (params.get('mode')) {
    state.mode = params.get('mode');
    applyMode();
  }
  loop();
  window.__ready = true;
}

window.inspector = {
  renderNow: () => {
    controls.update();
    renderer.render(scene, camera);
    return true;
  },
  setView,
  setOpen: (id, t) => car.setOpen(id, t),
  openAll: (t = 1) => Object.values(car.parts).forEach((p) => p.hinge && car.setOpen(p.id, t)),
  setMode: (m) => {
    state.mode = m;
    applyMode();
  },
  setSection,
  hide: (id, hidden = true) => car.setInstalled(id, !hidden),
  stage: (s) => setStage(s),
  lights: (cabin, work) => {
    cabinLamp.visible = !!cabin;
    workLights.visible = !!work;
  },
  openEdges: runOpenEdges,
  skinCheck: runSkinCheck,
  intersections: runIntersections,
  camera: (pos, target, fov) => {
    camera.position.set(...pos);
    controls.target.set(...target);
    if (fov) camera.fov = fov;
    camera.updateProjectionMatrix();
    controls.update();
  },
  get car() {
    return car;
  },
  scene,
  THREE,
};

init();
