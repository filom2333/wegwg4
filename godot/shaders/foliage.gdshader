// Leaves, fronds and grass: two-sided, lit through from behind, swaying in the wind (more the
// higher up the plant, each plant in its own phase), cut out where the texture is transparent.
shader_type spatial;
render_mode cull_disabled, diffuse_burley, specular_schlick_ggx;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2D orm_tex : hint_default_white, filter_linear_mipmap_anisotropic, repeat_disable;
uniform bool use_normal = true;
// alpha below this is cut away (0: solid)
uniform float alpha_cut : hint_range(0.0, 1.0) = 0.0;
uniform vec3 tint : source_color = vec3(1.0);
// how far the top of a plant of 1 m moves in a gust, and how much light comes through
uniform float sway = 0.06;
uniform float translucency : hint_range(0.0, 1.0) = 0.45;
global uniform float wind;

void vertex() {
	vec3 o = MODEL_MATRIX[3].xyz;
	float h = max(VERTEX.y, 0.0);
	float phase = dot(o.xz, vec2(0.31, 0.17));
	float gust = sin(TIME * 1.3 + phase) * 0.6 + sin(TIME * 2.9 + phase * 1.7) * 0.25 + 0.4;
	float k = sway * (0.3 + wind) * h * h;
	// (in the model's own frame: the plant leans the way the wind blows across it)
	VERTEX.x += k * gust;
	VERTEX.z += k * gust * 0.4 + k * 0.15 * sin(TIME * 3.7 + phase * 2.3);
}

void fragment() {
	vec4 a = texture(albedo_tex, UV);
	if (alpha_cut > 0.0 && a.a < alpha_cut) discard;
	vec3 orm = texture(orm_tex, UV).rgb;
	ALBEDO = a.rgb * tint;
	ROUGHNESS = orm.g;
	AO = orm.r;
	AO_LIGHT_AFFECT = 0.3;
	if (use_normal) NORMAL_MAP = texture(normal_tex, UV).xyz;
	BACKLIGHT = a.rgb * tint * translucency;
}
