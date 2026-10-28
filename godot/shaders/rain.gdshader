// Rain: streaks along the way each drop falls (down and with the wind), faint, catching the
// light (added: a drop is never darker than what is behind it), fading out near the camera and
// toward the edge of the box. See precip.gdshaderinc.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled;

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
		vec3 vel = vec3(drift.x, -fall * (0.85 + 0.3 * seed.x), drift.z);
		vec3 p = precip_pos(seed, vel, TIME, CAMERA_POSITION_WORLD);
		vec3 dir = normalize(vel);
		vec3 to_cam = normalize(CAMERA_POSITION_WORLD - p);
		vec3 side = normalize(cross(dir, to_cam));
		// a streak as long as a drop travels in about a 50th of a second
		float len = length(vel) * 0.045 * (0.8 + 0.4 * seed.y);
		// never thinner than about a pixel (thinner, it only flickers in and out of the
		// antialiasing samples), the fainter the wider
		float d = length(CAMERA_POSITION_WORLD - p);
		float width = max(0.012, d * 0.003);
		vec3 w = p + side * (UV.x - 0.5) * width + dir * (UV.y - 0.5) * len;
		VERTEX = (inverse(MODEL_MATRIX) * vec4(w, 1.0)).xyz;
		v_fade = smoothstep(0.6, 2.0, d) * (1.0 - smoothstep(box.x * 0.35, box.x * 0.5, d)) * 0.012 / width;
	}
}

void fragment() {
	float across = 1.0 - abs(v_uv.x - 0.5) * 2.0;
	float along = sin(v_uv.y * 3.14159);
	ALBEDO = vec3(0.72, 0.76, 0.82) * light_level * 0.35 * across * along * v_fade;
}
