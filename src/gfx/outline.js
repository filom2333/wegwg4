// Selection outline that costs only the selected objects: they are drawn into a mask, each
// fragment tested against the scene depth already in the read buffer (so walls in front hide
// the outline), then a small edge filter adds the silhouette onto the image. The stock
// OutlinePass re-renders the entire scene twice per frame to do the same.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export class SelectionOutlinePass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.selectedObjects = [];
    this.visibleEdgeColor = new THREE.Color(0xf2e6cf);
    this.edgeStrength = 2.2;
    this.needsSwap = false;
    this.mask = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, type: THREE.UnsignedByteType });
    this.res = new THREE.Vector2(1, 1);
    const sceneDepth = { value: null };
    this.sceneDepth = sceneDepth;
    const res = { value: this.res };
    // mask material: white where the selected surface is the nearest thing on screen
    this.maskMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
    this.maskMat.onBeforeCompile = (sh) => {
      sh.uniforms.tSceneDepth = sceneDepth;
      sh.uniforms.uRes = res;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tSceneDepth;\nuniform vec2 uRes;')
        .replace(
          'vec4 diffuseColor = vec4( diffuse, opacity );',
          `float sd = texture2D(tSceneDepth, gl_FragCoord.xy / uRes).x;
if (gl_FragCoord.z > sd + 0.00004) discard;
vec4 diffuseColor = vec4( diffuse, opacity );`
        );
    };
    this.maskMat.customProgramCacheKey = () => 'selMask';
    this.edge = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: { tMask: { value: this.mask.texture }, uTexel: { value: new THREE.Vector2(1, 1) }, uColor: { value: new THREE.Color() }, uStrength: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `uniform sampler2D tMask; uniform vec2 uTexel; uniform vec3 uColor; uniform float uStrength; varying vec2 vUv;
          void main(){
            float c = texture2D(tMask, vUv).r;
            float m = 0.0;
            for (int i = 0; i < 8; i++) {
              float a = float(i) * 0.7853982;
              vec2 o = vec2(cos(a), sin(a));
              m = max(m, texture2D(tMask, vUv + o * uTexel * 1.5).r);
              m = max(m, texture2D(tMask, vUv + o * uTexel * 2.6).r * 0.6);
            }
            float e = clamp(m - c, 0.0, 1.0);
            if (e < 0.01) discard;
            gl_FragColor = vec4(uColor * e * uStrength, 1.0);
          }`,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      })
    );
    this._swap = new Map();
  }

  setSize(w, h) {
    this.mask.setSize(w, h);
    this.res.set(w, h);
    this.edge.material.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  render(renderer, writeBuffer, readBuffer) {
    if (!this.selectedObjects.length || !readBuffer.depthTexture) return;
    this.sceneDepth.value = readBuffer.depthTexture;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.mask);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    // draw each selected subtree with the mask material (materials swapped and restored)
    for (const obj of this.selectedObjects) {
      if (!obj || !obj.visible) continue;
      obj.traverse((o) => {
        if (o.isMesh || o.isSkinnedMesh) {
          this._swap.set(o, o.material);
          o.material = this.maskMat;
        }
      });
      const prevAutoUpdate = obj.matrixWorldAutoUpdate;
      obj.matrixWorldAutoUpdate = false;
      renderer.render(obj, this.camera);
      obj.matrixWorldAutoUpdate = prevAutoUpdate;
      for (const [o, m] of this._swap) o.material = m;
      this._swap.clear();
    }
    // edges onto the image
    const u = this.edge.material.uniforms;
    u.uColor.value.copy(this.visibleEdgeColor);
    u.uStrength.value = this.edgeStrength * 0.5;
    renderer.setRenderTarget(readBuffer);
    this.edge.render(renderer);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAuto;
  }

  dispose() {
    this.mask.dispose();
    this.maskMat.dispose();
    this.edge.dispose();
  }
}
