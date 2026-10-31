// Loose rock (boulders, slabs, pebbles), stumps and logs: a scanned surface baked onto the game
// mesh (tools/blender/scans.py). Each instance's colour (MultiMesh) carries the biome's rock tint
// in rgb and how snowed-over it is in alpha: the scan's own colour is pulled part way toward the
// tint so loose stone reads as the same stone as the cliffs around it, and snow settles on
// whatever faces up.
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2D orm_tex : hint_default_white, filter_linear_mipmap_anisotropic, repeat_disable;
// how far toward the tint (0 the scan as it is)
uniform float tint_amount : hint_range(0.0, 1.0) = 0.45;
// snow that is always there (snowrock), on top of the instance's
uniform float snow_base : hint_range(0.0, 1.0) = 0.0;
uniform vec3 snow_color : source_color = vec3(0.86, 0.89, 0.94);
// (some scans come without a roughness map and bake out glassy: stone and wood are never that)
uniform float rough_min : hint_range(0.0, 1.0) = 0.62;

varying vec4 v_inst;
varying vec3 v_wn;
varying vec3 v_op;

float rh(vec3 p) {
	return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}
float rnoise(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(rh(i), rh(i + vec3(1, 0, 0)), f.x), mix(rh(i + vec3(0, 1, 0)), rh(i + vec3(1, 1, 0)), f.x), f.y),
			mix(mix(rh(i + vec3(0, 0, 1)), rh(i + vec3(1, 0, 1)), f.x), mix(rh(i + vec3(0, 1, 1)), rh(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

void vertex() {
	// (the meshes have no vertex colours: COLOR is the instance's)
	v_inst = COLOR;
	v_wn = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	v_op = VERTEX;
}

void fragment() {
	vec3 scan = texture(albedo_tex, UV).rgb;
	vec3 orm = texture(orm_tex, UV).rgb;
	// keep the scan's light and dark, move its colour toward the tint (at its own brightness)
	float lum = dot(scan, vec3(0.2126, 0.7152, 0.0722));
	vec3 tint = v_inst.rgb;
	float tl = max(dot(tint, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
	vec3 col = mix(scan, tint / tl * lum, tint_amount) * mix(1.0, tl / 0.55, tint_amount * 0.5);

	// snow on what faces up, broken up at its edge
	vec3 nw = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
	float snow = clamp(max(v_inst.a, snow_base), 0.0, 1.0);
	float up = mix(v_wn.y, nw.y, 0.5);
	// (the more snow, the steeper the faces it holds on to; a ragged edge, never the sides)
	float edge = rnoise(v_op * 3.0) * 0.35 + rnoise(v_op * 11.0) * 0.15;
	float cover = mix(0.95, 0.32, snow);
	float s = smoothstep(cover, cover + 0.22, up + (edge - 0.25) * 0.6) * min(snow * 1.5, 1.0);
	ALBEDO = mix(col, snow_color, s);
	ROUGHNESS = mix(max(orm.g, rough_min), 0.8, s);
	AO = orm.r;
	AO_LIGHT_AFFECT = 0.3;
	NORMAL_MAP = mix(texture(normal_tex, UV).xyz, vec3(0.5, 0.5, 1.0), s * 0.7);
}
