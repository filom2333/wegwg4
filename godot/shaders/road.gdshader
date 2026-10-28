// The highway and the dirt tracks: asphalt or gravel lanes with wheel paths, patches and cracks,
// a dashed amber centre line and white edge lines worn by age, gravel shoulders running into the
// sand, packed snow up north and concrete with expansion joints on bridges. A port of the
// browser version's road material on the scanned ground layers.
//
// Vertex data (RoadMesher.cs): UV.x across 0..1 of the full width, UV.y metres along the road;
// CUSTOM0 wear, dirt, full width, markings; CUSTOM1 snow, bridge deck.
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

#include "res://shaders/ground.gdshaderinc"

uniform float wetness : hint_range(0.0, 1.0) = 0.0;

varying vec4 v_road;
varying vec2 v_env;
varying vec3 v_wn;
varying float v_dist;

const float HALF_ROAD = 3.6;

float r_hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float r_noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(r_hash(i), r_hash(i + vec2(1, 0)), f.x), mix(r_hash(i + vec2(0, 1)), r_hash(i + vec2(1, 1)), f.x), f.y);
}
float r_fbm(vec2 p) {
	float s = 0.0, a = 0.5;
	for (int i = 0; i < 4; i++) {
		s += a * r_noise(p);
		p *= 2.03;
		a *= 0.5;
	}
	return s;
}

void vertex() {
	v_road = CUSTOM0;
	v_env = CUSTOM1.xy;
	v_wn = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	v_dist = length((MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).xyz);
}

void fragment() {
	float W = v_road.z; // full width with the shoulders (m)
	float wear = v_road.x;
	float isDirt = v_road.y;
	float across = (UV.x - 0.5) * W; // metres from the centre line
	// (metres along the road from the last multiple of 12288 m: see RoadMesher.cs)
	float along = UV.y;
	float onRoad = 1.0 - smoothstep(HALF_ROAD - 0.05, HALF_ROAD + 0.15, abs(across));
	vec2 wuv = vec2(across, along);
	GroundSample asph = ground_layer(8, wuv / 3.2);
	GroundSample grav = ground_layer(9, wuv / 1.6);
	GroundSample sand = ground_layer(0, wuv / 3.2);
	// dirt road: gravel with sandy wheel tracks
	float tracks = smoothstep(0.5, 0.0, abs(abs(across) - 1.8));
	vec3 dirtRoad = mix(grav.albedo * vec3(0.66, 0.58, 0.47), sand.albedo * 0.85, 0.35 + 0.4 * tracks);
	vec3 col = mix(asph.albedo * 0.62, dirtRoad, isDirt);
	// patches and wear
	float pn = r_fbm(vec2(across * 0.25, along * 0.06));
	float patchM = smoothstep(0.62, 0.64, pn) * wear * (1.0 - isDirt);
	col = mix(col, col * 0.62, patchM);
	col = mix(col, col * 1.2 + 0.04, wear * 0.3 * (1.0 - isDirt) * smoothstep(0.3, 0.7, r_fbm(vec2(across, along) * 0.15)));
	// wheel paths: polished darker lanes
	float wp = smoothstep(0.6, 0.0, abs(abs(across) - 1.85)) * (1.0 - isDirt);
	col *= 1.0 - 0.1 * wp;
	// cracks: thin dark lines from warped noise contours
	float cn = r_fbm(vec2(across * 0.6, along * 0.25) + r_fbm(vec2(along * 0.05, across)) * 2.0);
	float crack = 1.0 - smoothstep(0.0, 0.025 + 0.02 * wear, abs(cn - 0.5));
	crack *= smoothstep(0.35, 0.8, wear + r_noise(vec2(along * 0.02, 3.0)) * 0.4) * (1.0 - isDirt);
	col = mix(col, vec3(0.04), crack * 0.75 * onRoad);
	// markings: dashed centre line (amber), solid edge lines (white), faded by wear
	float marks = v_road.w * (1.0 - isDirt);
	float fade = 1.0 - wear * 0.6 * smoothstep(0.3, 0.7, r_noise(vec2(along * 0.4, across * 2.0)));
	float dash = step(fract(along / 12.0), 0.42);
	float centre = (1.0 - smoothstep(0.05, 0.075, abs(across))) * dash;
	float edgeL = 1.0 - smoothstep(0.06, 0.085, abs(abs(across) - (HALF_ROAD - 0.25)));
	col = mix(col, vec3(0.86, 0.66, 0.2), centre * marks * fade * 0.95);
	col = mix(col, vec3(0.86, 0.86, 0.82), edgeL * marks * fade * 0.9);
	// shoulders: gravel blending into the surrounding sand
	float sh = smoothstep(HALF_ROAD, HALF_ROAD + 0.3, abs(across));
	vec3 shoulder = mix(grav.albedo * vec3(0.78, 0.71, 0.6), grav.albedo * vec3(0.5, 0.45, 0.38) + sand.albedo * 0.4, smoothstep(HALF_ROAD + 0.5, W * 0.5, abs(across)));
	col = mix(col, shoulder, sh);
	// winter: packed snow over the lanes with darker wheel tracks, snow banked on the shoulders
	float snow = v_env.x;
	float bridge = v_env.y;
	if (snow > 0.01) {
		GroundSample sn = ground_layer(5, wuv / 4.0);
		float tracksS = smoothstep(0.55, 0.15, abs(abs(across) - 1.85));
		float cover = snow * clamp(0.95 - tracksS * 0.55 + (r_fbm(vec2(across * 0.7, along * 0.12)) - 0.5) * 0.6, 0.0, 1.0);
		cover = max(cover, snow * sh);
		vec3 packedS = mix(sn.albedo * 1.3, sn.albedo * vec3(1.0, 1.03, 1.08), tracksS * 0.6);
		col = mix(col, packedS, clamp(cover, 0.0, 1.0));
	}
	// bridge deck: concrete with expansion joints
	if (bridge > 0.5) {
		float joint = 1.0 - smoothstep(0.04, 0.08, abs(fract(along / 9.0) - 0.5) * 9.0 - 4.4);
		col = mix(col, col * 0.55, joint * onRoad);
	}
	col *= mix(1.0, 0.58, wetness * (1.0 - snow * 0.5));
	ALBEDO = col;
	// fine aggregate: only a hint of relief, or grazing headlights turn it into cobbles
	vec3 na = asph.normal;
	na.xy *= 0.45;
	vec3 ng = grav.normal;
	ng.xy *= 0.7;
	vec3 nt = normalize(mix(mix(na, ng, isDirt), ng, sh));
	float rough = mix(mix(asph.rough, 0.95, isDirt), 0.95, sh);
	rough = mix(rough, 0.12, wetness * onRoad * (1.0 - isDirt) * 0.9);
	rough = mix(rough, 0.6, (centre + edgeL) * marks);
	ROUGHNESS = rough;
	AO = mix(1.0, mix(asph.ao, grav.ao, max(isDirt, sh)), 0.7);
	vec3 N = normalize(v_wn);
	vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
	vec3 B = normalize(cross(T, N));
	float relief = 1.0 - smoothstep(30.0, 120.0, v_dist) * 0.8;
	vec3 nw = normalize(T * nt.x * relief + B * -nt.y * relief + N * nt.z);
	NORMAL = normalize((VIEW_MATRIX * vec4(nw, 0.0)).xyz);
}
