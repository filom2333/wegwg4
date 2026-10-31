// Plant wood and skin: bark on trunks and branches, a cactus's pleated skin. A tiling texture
// (round and along the stem) tinted by the vertex colour, swaying with the plant, snow on top.
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

#include "res://shaders/plant_common.gdshaderinc"

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D orm_tex : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform bool use_normal = true;
uniform vec3 tint : source_color = vec3(1.0);
uniform float roughness = 0.85;
uniform float specular = 0.3;

varying vec4 v_col;
varying vec3 v_wp;

void vertex() {
	VERTEX = plant_sway(VERTEX, MODEL_MATRIX, UV2, TIME, 0.0);
	v_col = COLOR;
	v_wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec3 a = texture(albedo_tex, UV).rgb * tint * v_col.rgb;
	vec3 orm = texture(orm_tex, UV).rgb;
	vec3 nw = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
	float s = plant_snow(v_col.a, nw, v_wp);
	ALBEDO = mix(a, snow_color, s);
	ROUGHNESS = mix(clamp(roughness + (orm.g - 0.75) * 0.5, 0.3, 1.0), 0.8, s);
	SPECULAR = specular;
	AO = orm.r;
	AO_LIGHT_AFFECT = 0.25;
	if (use_normal) NORMAL_MAP = mix(texture(normal_tex, UV).xyz, vec3(0.5, 0.5, 1.0), s);
}
