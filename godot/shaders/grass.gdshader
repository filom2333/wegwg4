// Grass and reeds: geometry blades (tools/blender/plants.py), coloured from foot to tip (UV.y)
// with a shade of their own per blade (UV.x), two-sided, swaying, a little light through them.
shader_type spatial;
render_mode cull_disabled, diffuse_burley, specular_schlick_ggx;

#include "res://shaders/plant_common.gdshaderinc"

uniform vec3 base_color : source_color = vec3(0.33, 0.27, 0.16);
uniform vec3 tip_color : source_color = vec3(0.72, 0.62, 0.4);
// some blades greener (or drier) than the rest
uniform vec3 odd_color : source_color = vec3(0.5, 0.5, 0.3);
uniform float odd_share : hint_range(0.0, 1.0) = 0.2;
uniform float translucency : hint_range(0.0, 1.0) = 0.35;

varying vec4 v_col;
varying vec2 v_uv;
varying vec3 v_wp;

void vertex() {
	VERTEX = plant_sway(VERTEX, MODEL_MATRIX, UV2, TIME, 0.01);
	v_col = COLOR;
	v_uv = UV;
	v_wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	float t = v_uv.y;
	vec3 c = mix(base_color, tip_color, smoothstep(0.0, 0.9, t));
	float odd = step(1.0 - odd_share, fract(v_uv.x * 7.31));
	c = mix(c, odd_color * mix(0.7, 1.1, t), odd * 0.8);
	c *= 0.85 + 0.3 * fract(v_uv.x * 13.7);
	c *= v_col.rgb;
	if (!FRONT_FACING) NORMAL = -NORMAL;
	vec3 nw = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
	float s = plant_snow(v_col.a * 0.6, nw, v_wp) * t;
	ALBEDO = mix(c, snow_color, s);
	ROUGHNESS = 0.8;
	SPECULAR = 0.3;
	// darker toward the foot, where the tuft shades itself
	AO = mix(0.45, 1.0, smoothstep(0.0, 0.6, t));
	AO_LIGHT_AFFECT = 0.6;
	BACKLIGHT = c * translucency;
}
