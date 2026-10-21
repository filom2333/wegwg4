// Sunlit haze: distance fog takes on the sun's colour when you look toward it, so far ridges stand
// out against a warm glow at golden hour and the haze is cool and blue away from the sun.
// The shared fog chunks are patched once; the sun's direction (view space) and colour live in one
// object every material's `fogSun` uniform points to. Two more things live in the same chunk:
// mist lying in the low places (densest at the ground, thinning with height, integrated along
// the view ray), and the wall of an approaching sandstorm swallowing the land on one side.

import * as THREE from 'three';

export const FOG_SUN = {
  dir: new THREE.Vector3(0, 0, -1),
  color: new THREE.Color(1, 0.8, 0.55),
  strength: 0,
  up: new THREE.Vector3(0, 1, 0),
  camH: 10,
  mist: 0,
  mistH: 16,
  mistColor: new THREE.Color(0.8, 0.82, 0.85),
  wallDir: new THREE.Vector3(1, 0, 0),
  wall: 0,
  wallDist: 5000,
  wallColor: new THREE.Color(0.5, 0.36, 0.24),
};

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
	struct FogSun { vec3 dir; vec3 color; float strength; vec3 up; float camH; float mist; float mistH; vec3 mistColor; vec3 wallDir; float wall; float wallDist; vec3 wallColor; };
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
	if ( fogSun.wall > 0.0 && fogL > 1e-3 ) {
		float side = smoothstep( -0.3, 0.5, dot( vFogView / fogL, fogSun.wallDir ) );
		float wf = smoothstep( fogSun.wallDist * 0.75, fogSun.wallDist, fogL ) * side * fogSun.wall;
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogSun.wallColor, wf );
	}
	if ( fogSun.mist > 0.0 ) {
		float mk = dot( vFogView, fogSun.up ) / fogSun.mistH;
		float mInt = abs( mk ) > 1e-3 ? ( 1.0 - exp( -mk ) ) / mk : 1.0;
		float mAmt = 1.0 - exp( -fogSun.mist * exp( -fogSun.camH / fogSun.mistH ) * fogL * max( mInt, 0.0 ) );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogSun.mistColor, mAmt );
	}
#endif`;

// Per frame: the sun in view space, its haze colour and how strong the glow is; optionally the
// mist ({ density per metre at its base, base height, colour }) and a sandstorm wall
// ({ dir: horizontal world direction, amount, distance, colour }).
export function updateFogSun(camera, sunDir, color, strength, mist = null, wall = null) {
  FOG_SUN.dir.copy(sunDir).transformDirection(camera.matrixWorldInverse);
  FOG_SUN.color.copy(color);
  FOG_SUN.strength = strength;
  FOG_SUN.up.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
  if (mist && mist.density > 0) {
    FOG_SUN.mist = mist.density;
    FOG_SUN.camH = Math.max(-FOG_SUN.mistH * 0.5, camera.position.y - mist.base);
    FOG_SUN.mistColor.copy(mist.color);
  } else FOG_SUN.mist = 0;
  if (wall && wall.amount > 0) {
    FOG_SUN.wall = wall.amount;
    FOG_SUN.wallDir.copy(wall.dir).transformDirection(camera.matrixWorldInverse);
    FOG_SUN.wallDist = wall.dist;
    FOG_SUN.wallColor.copy(wall.color);
  } else FOG_SUN.wall = 0;
}
