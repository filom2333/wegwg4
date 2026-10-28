// Leaves, needles and the like: twig cards cut out of their texture, or plain leaves coloured
// by their vertices (yucca daggers, grass-like blades, flowers). Two-sided, lit through from
// behind, fluttering in the wind, snow settling on what faces up.
//
// The cards' normals point out of the crown they belong to; they keep that direction seen from
// either side (a crown is a rounded mass, lit on its sunny side whichever way a card turns).
shader_type spatial;
render_mode cull_disabled, diffuse_burley, specular_schlick_ggx;

#include "res://shaders/plant_common.gdshaderinc"

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_disable;
uniform bool use_tex = true;
uniform float alpha_cut : hint_range(0.0, 1.0) = 0.42;
uniform vec3 tint : source_color = vec3(1.0);
uniform float roughness = 0.7;
uniform float translucency : hint_range(0.0, 1.0) = 0.5;
uniform float flutter = 0.02;

varying vec4 v_col;
varying vec3 v_wp;

void vertex() {
	VERTEX = plant_sway(VERTEX, MODEL_MATRIX, UV2, TIME, flutter);
	v_col = COLOR;
	v_wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec3 a = tint * v_col.rgb;
	if (use_tex) {
		vec4 t = texture(albedo_tex, UV);
		// (the small mip levels average the cut-out edges away: thicken the alpha further off so
		// a far crown keeps its fullness)
		float far = smoothstep(8.0, 140.0, length(VERTEX));
		ALPHA = clamp(t.a * (1.0 + far * 1.6), 0.0, 1.0);
		ALPHA_SCISSOR_THRESHOLD = alpha_cut;
		ALPHA_ANTIALIASING_EDGE = 0.25;
		a *= t.rgb;
		NORMAL_MAP = texture(normal_tex, UV).xyz;
		NORMAL_MAP_DEPTH = 0.6;
	}
	// (undo the flip a back face gets: see above)
	if (!FRONT_FACING) NORMAL = -NORMAL;
	vec3 nw = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
	float s = plant_snow(v_col.a, nw, v_wp);
	ALBEDO = mix(a, snow_color, s);
	ROUGHNESS = roughness;
	SPECULAR = 0.35;
	BACKLIGHT = a * translucency * (1.0 - s);
}
