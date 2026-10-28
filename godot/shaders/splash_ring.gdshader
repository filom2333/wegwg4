// A raindrop's ring (gfx/Splashes.cs): on water spreading out with a second one inside it, on the
// ground the faintest wet ring. One flat quad per landing, added on: a splash only ever catches
// light.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled;

// Splashes.cs's clock, and how much light there is to see them by
uniform float now = 0.0;
uniform float light_level = 1.0;

varying float v_age;
varying float v_water;
varying float v_fade;

void vertex() {
	// INSTANCE_CUSTOM: when it landed, a random number, 1 on water
	v_water = INSTANCE_CUSTOM.b;
	v_age = (now - INSTANCE_CUSTOM.r) / mix(0.22, 0.75, v_water);
	if (v_age < 0.0 || v_age > 1.0) VERTEX = vec3(0.0);
	float d = length((MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).xyz);
	v_fade = 1.0 - smoothstep(7.0, 10.0, d);
}

void fragment() {
	float r = length(UV * 2.0 - 1.0);
	// fast at first, then slowing
	float R = mix(0.12, 1.0, sqrt(v_age));
	float w = mix(0.05, 0.12, v_age);
	float ring = smoothstep(w, 0.0, abs(r - R)) + smoothstep(w, 0.0, abs(r - R * 0.55)) * 0.5 * v_water;
	float k = ring * pow(1.0 - v_age, 1.5) * mix(0.18, 0.35, v_water);
	ALBEDO = vec3(0.75, 0.78, 0.82) * light_level * k * v_fade;
}
