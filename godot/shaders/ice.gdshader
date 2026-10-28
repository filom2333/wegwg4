// Frozen rivers and lakes: pale blue-white ice with frosted patches, a network of cracks, and a
// smooth sheen between. A port of the browser version's ice material.
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

uniform vec3 ice_color : source_color = vec3(0.81, 0.88, 0.92);
uniform vec3 frost_color : source_color = vec3(0.95, 0.97, 1.0);

varying vec3 v_wp;

float ih(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float inoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(ih(i), ih(i + vec2(1, 0)), f.x), mix(ih(i + vec2(0, 1)), ih(i + vec2(1, 1)), f.x), f.y);
}

void vertex() {
	// (lake/river-local metres: UV)
	v_wp = vec3(UV.x, 0.0, UV.y);
}

void fragment() {
	vec2 p = v_wp.xz * 0.35;
	float frost = smoothstep(0.35, 0.75, inoise(p * 0.6) * 0.7 + inoise(p * 2.3) * 0.3);
	// cracks: the edges of a cellular pattern
	vec2 c = v_wp.xz * 0.6;
	vec2 ci = floor(c);
	vec2 cf = fract(c);
	float d1 = 9.0, d2 = 9.0;
	for (int j = -1; j <= 1; j++)
		for (int i = -1; i <= 1; i++) {
			vec2 o = vec2(float(i), float(j));
			vec2 q = o + vec2(ih(ci + o), ih(ci + o + 17.0)) - cf;
			float d = dot(q, q);
			if (d < d1) {
				d2 = d1;
				d1 = d;
			} else if (d < d2)
				d2 = d;
		}
	float crack = 1.0 - smoothstep(0.0, 0.05, sqrt(d2) - sqrt(d1));
	vec3 col = mix(ice_color, frost_color, frost * 0.75);
	col *= 1.0 - crack * 0.35 * (1.0 - frost);
	ALBEDO = col;
	ROUGHNESS = mix(0.18, 0.7, frost);
}
