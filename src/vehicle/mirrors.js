// Mirrors that show what is behind: a car's two door mirrors and the one inside, each a quad over
// the source model's mirror glass (type.MIRRORS: which part it rides on, centre, outward normal,
// size). Each shows a picture taken from the eye's reflection in its glass: a small camera behind
// the glass whose view is cut to exactly the glass (an off-axis frustum, its near plane on the
// glass, so nothing behind the mirror gets in). One mirror is redrawn per frame, small and before
// the post effects (the picture is in the scene's own light, so the frame's tone mapping applies
// to it once); only for the car you sit in, and only when Settings allow. A mirror can be turned
// a little (yaw, pitch) to aim it.

import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TURN = 0.26; // how far a mirror turns each way (rad)

export class Mirrors {
  constructor(game) {
    this.game = game;
    this.turn = 0;
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.05, 1200);
    this.cam.layers.enableAll();
  }

  // The mirror quads of a car, built the first time it is driven.
  of(car) {
    if (car._mirrors) return car._mirrors;
    const list = [];
    for (const m of car.type.MIRRORS || []) {
      const part = car.model.parts[m.part];
      if (!part) continue;
      const [w, h] = m.size;
      const r = Math.min(w, h) * (m.round ?? 0.3);
      const s = new THREE.Shape();
      s.moveTo(-w / 2 + r, -h / 2);
      s.lineTo(w / 2 - r, -h / 2);
      s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
      s.lineTo(w / 2, h / 2 - r);
      s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
      s.lineTo(-w / 2 + r, h / 2);
      s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
      s.lineTo(-w / 2, -h / 2 + r);
      s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
      const geo = new THREE.ShapeGeometry(s, 6);
      // the picture is seen through the glass from behind, so it is mirrored left to right
      const p = geo.attributes.position,
        uv = geo.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, (w / 2 - p.getX(i)) / w, (p.getY(i) + h / 2) / h);
      const rt = new THREE.WebGLRenderTarget(m.res ? m.res[0] : 256, m.res ? m.res[1] : 128, { type: THREE.HalfFloatType });
      const mat = new THREE.MeshBasicMaterial({ map: rt.texture, color: 0xd8dde0 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'mirror:' + m.id;
      // the glass's frame: normal out of the mirror, up as near the car's up as it can be. Set
      // like a driver sets them: from the driver's eye the mirror shows `look` (the road behind;
      // the door mirrors a little outward), so the normal halves the angle between the way in
      // and the way out; the source's own glass normal otherwise.
      let n = V(...m.normal).normalize();
      if (m.look) {
        const inc = V(...m.center).sub(car.type.SEATS.driver.pos).normalize();
        n = V(...m.look).normalize().sub(inc).normalize();
      }
      const y = V(0, 1, 0).addScaledVector(n, -n.y).normalize();
      const x = y.clone().cross(n);
      const base = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n));
      const holder = new THREE.Group();
      holder.position.copy(V(...m.center)).addScaledVector(n, 0.008);
      holder.quaternion.copy(base);
      holder.add(mesh);
      part.inner.add(holder);
      mesh.visible = false;
      list.push({ id: m.id, def: m, mesh, holder, rt, w, h, yaw: 0, pitch: 0 });
    }
    car._mirrors = list;
    return list;
  }

  // Turn a mirror (radians, clamped).
  aim(car, id, dyaw, dpitch) {
    const m = this.of(car).find((x) => x.id === id);
    if (!m) return;
    m.yaw = THREE.MathUtils.clamp(m.yaw + dyaw, -TURN, TURN);
    m.pitch = THREE.MathUtils.clamp(m.pitch + dpitch, -TURN, TURN);
    m.mesh.rotation.set(m.pitch, m.yaw, 0);
  }

  // Before the frame: show the car's mirrors and redraw one of them.
  update() {
    const g = this.game;
    const car = g.car;
    const R = g.renderer;
    const on = !!(R.q.mirrors && car && g.player && g.player.seat && g.player.car === car && !g.debugView);
    // mirrors of a car you are not in go back to plain glass
    if (this.shown && this.shown !== (on ? car : null)) for (const m of this.shown._mirrors || []) m.mesh.visible = false;
    this.shown = on ? car : null;
    if (!on) return;
    const list = this.of(car);
    if (!list.length) return;
    for (const m of list) m.mesh.visible = true;
    const m = list[this.turn++ % list.length];
    this.draw(m);
  }

  draw(m) {
    const g = this.game;
    const R = g.renderer;
    const r = R.renderer;
    const eye = R.camera.position;
    m.mesh.updateMatrixWorld(true);
    const mw = m.mesh.matrixWorld;
    const C = V(0, 0, 0).applyMatrix4(mw);
    const X = V(1, 0, 0).transformDirection(mw);
    const Y = V(0, 1, 0).transformDirection(mw);
    const N = V(0, 0, 1).transformDirection(mw);
    const dist = eye.clone().sub(C).dot(N);
    if (dist < 0.02) return;
    // the eye's reflection, looking out through the glass (camera X runs against the glass's X)
    const E2 = eye.clone().addScaledVector(N, -2 * dist);
    const cam = this.cam;
    const cx = X.clone().negate();
    cam.position.copy(E2);
    cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(cx, Y, N.clone().negate()));
    cam.updateMatrixWorld(true);
    // the glass's corners on the near plane: an off-axis window in a symmetric frustum
    const rel = C.clone().sub(E2);
    const ox = rel.dot(cx),
      oy = rel.dot(Y);
    const near = dist * 0.98;
    // door mirrors are convex: they take in a wider view than their size (`wide`)
    const k = (near / dist) * (m.def.wide ?? 1);
    const left = (ox - m.w / 2) * k,
      right = (ox + m.w / 2) * k,
      bottom = (oy - m.h / 2) * k,
      top = (oy + m.h / 2) * k;
    const A = Math.max(Math.abs(left), Math.abs(right)),
      B = Math.max(Math.abs(top), Math.abs(bottom));
    cam.near = near;
    cam.far = 1200;
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(B / near));
    cam.aspect = A / B;
    const S = 10000;
    cam.setViewOffset(2 * A * S, 2 * B * S, (left + A) * S, (B - top) * S, (right - left) * S, (top - bottom) * S);
    // everything as it is in the frame, except the mirrors themselves and the first-person arms
    const view = g.interaction && g.interaction.viewRoot;
    const viewOn = view && view.visible;
    if (view) view.visible = false;
    for (const x of this.shown._mirrors) x.mesh.visible = false;
    const prevTarget = r.getRenderTarget();
    const autoShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(m.rt);
    r.clear();
    r.render(R.scene || g.scene, cam);
    r.setRenderTarget(prevTarget);
    r.shadowMap.autoUpdate = autoShadow;
    for (const x of this.shown._mirrors) x.mesh.visible = true;
    if (view) view.visible = viewOn;
  }
}
