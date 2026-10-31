// Snow: soft round flakes drifting down, swaying as they fall and carried by the wind, lit by
// what light there is. See precip.gdshaderinc.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled;

#include "res://shaders/precip.gdshaderinc"

varying float v_fade;
varying vec2 v_uv;

void vertex() {
	vec3 seed = COLOR.rgb;
	v_uv = UV;
	if (UV2.x > amount) {
		VERTEX = vec3(0.0);
		v_fade = 0.0;
	} else {
		vec3 vel = vec3(drift.x, -fall * (0.7 + 0.6 * seed.y), drift.z);
		vec3 p = precip_pos(seed, vel, TIME, CAMERA_POSITION_WORLD);
		// each flake sways in its own little circle
		float ph = seed.z * 6.283;
		p += vec3(sin(TIME * (0.8 + seed.x) + ph), 0.0, cos(TIME * (0.7 + seed.y) + ph * 1.3)) * 0.35;
		// facing the camera
		vec3 right = INV_VIEW_MATRIX[0].xyz;
		vec3 up = INV_VIEW_MATRIX[1].xyz;
		float size = 0.022 + 0.022 * seed.x;
		vec3 w = p + (right * (UV.x - 0.5) + up * (UV.y - 0.5)) * size;
		VERTEX = (inverse(MODEL_MATRIX) * vec4(w, 1.0)).xyz;
		float d = length(CAMERA_POSITION_WORLD - p);
		v_fade = smoothstep(0.3, 1.2, d) * (1.0 - smoothstep(box.x * 0.35, box.x * 0.5, d));
	}
}

void fragment() {
	float r = length(v_uv - 0.5) * 2.0;
	ALBEDO = vec3(0.95, 0.96, 1.0) * light_level;
	ALPHA = (1.0 - smoothstep(0.3, 1.0, r)) * 0.9 * v_fade;
}
