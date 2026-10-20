// Sunlit haze: distance fog takes on the sun's colour when you look toward it, so far ridges stand
// out against a warm glow at golden hour and the haze is cool and blue away from the sun.
// The shared fog chunks are patched once; the sun's direction (view space) and colour live in one
// object every material's `fogSun` uniform points to.

import * as THREE from 'three';

export const FOG_SUN = { dir: new THREE.Vector3(0, 0, -1), color: new THREE.Color(1, 0.8, 0.55), strength: 0 };

THREE.UniformsLib.fog.fogSun = { value: FOG_SUN };
for (const k of Object.keys(THREE.ShaderLib)) {
  const u = THREE.ShaderLib[k].uniforms;
  if (u && u.fogColor) u.fogSun = { value: FOG_SUN };
}

const C = THREE.ShaderChunk;
C.fog_pars_vertex = `#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogView;
#endif`;
C.fog_vertex = `#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogView = mvPosition.xyz;
#endif`;
C.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogView;
	struct FogSun { vec3 dir; vec3 color; float strength; };
	uniform FogSun fogSun;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;
C.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	float fogL = length( vFogView );
	float fogS = fogL > 1e-3 ? max( dot( vFogView / fogL, fogSun.dir ), 0.0 ) : 0.0;
	vec3 fogC = mix( fogColor, fogSun.color, ( pow( fogS, 5.0 ) * 0.75 + pow( fogS, 40.0 ) * 0.25 ) * fogSun.strength );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogC, fogFactor );
#endif`;

// Per frame: the sun in view space, its haze colour and how strong the glow is.
export function updateFogSun(camera, sunDir, color, strength) {
  FOG_SUN.dir.copy(sunDir).transformDirection(camera.matrixWorldInverse);
  FOG_SUN.color.copy(color);
  FOG_SUN.strength = strength;
}
