// Smoke and dust puffs for GPU particles: a soft, lumpy cloud turned to the camera (spun by the
// particle's angle), lit by the scene like anything else so smoke at dusk is dusk-coloured, a
// little light through it, and faded where it meets the ground or a wall instead of a hard cut.
// The particle colour (COLOR) tints it and its alpha fades it in and out.
shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_disabled, diffuse_lambert, specular_disabled;

uniform vec3 tint : source_color = vec3(0.32, 0.31, 0.3);
// how much light comes through (backlit smoke glows)
uniform float translucency : hint_range(0.0, 1.0) = 0.35;
// metres over which it fades into what it touches
uniform float soft_distance = 1.5;
// how lumpy the edge is
uniform float lumps : hint_range(0.0, 1.0) = 0.55;
uniform sampler2D depth_tex : hint_depth_texture, filter_nearest;

varying float v_seed;

void vertex() {
	mat4 w = mat4(normalize(INV_VIEW_MATRIX[0]), normalize(INV_VIEW_MATRIX[1]), normalize(INV_VIEW_MATRIX[2]), MODEL_MATRIX[3]);
	float a = INSTANCE_CUSTOM.x;
	w = w * mat4(vec4(cos(a), -sin(a), 0.0, 0.0), vec4(sin(a), cos(a), 0.0, 0.0), vec4(0.0, 0.0, 1.0, 0.0), vec4(0.0, 0.0, 0.0, 1.0));
	MODELVIEW_MATRIX = VIEW_MATRIX * w * mat4(vec4(length(MODEL_MATRIX[0].xyz), 0.0, 0.0, 0.0), vec4(0.0, length(MODEL_MATRIX[1].xyz), 0.0, 0.0), vec4(0.0, 0.0, length(MODEL_MATRIX[2].xyz), 0.0), vec4(0.0, 0.0, 0.0, 1.0));
	MODELVIEW_NORMAL_MATRIX = mat3(MODELVIEW_MATRIX);
	v_seed = float(INSTANCE_ID) * 7.31;
}

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}
float fbm(vec2 p) {
	return noise(p) * 0.5 + noise(p * 2.1 + 3.7) * 0.3 + noise(p * 4.3 + 9.1) * 0.2;
}

void fragment() {
	vec2 q = UV * 2.0 - 1.0;
	float n = fbm(UV * 3.2 + v_seed);
	// a round cloud with a lumpy edge and thinner, uneven inside
	float body = smoothstep(1.0, 0.25, length(q) + (n - 0.5) * lumps);
	float a = body * (0.65 + 0.35 * fbm(UV * 6.0 - v_seed));
	float depth = textureLod(depth_tex, SCREEN_UV, 0.0).r;
	vec4 behind = INV_PROJECTION_MATRIX * vec4(SCREEN_UV * 2.0 - 1.0, depth, 1.0);
	behind.xyz /= behind.w;
	a *= clamp((VERTEX.z - behind.z) / soft_distance, 0.0, 1.0);
	ALBEDO = tint * COLOR.rgb * (0.85 + 0.3 * n);
	ALPHA = a * COLOR.a;
	BACKLIGHT = ALBEDO * translucency;
}
