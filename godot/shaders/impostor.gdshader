// A far tree or cactus: one card turned round its trunk to face the camera, showing the baked
// view (tools/blender/impostors.py: 8 views round, one variant per row) it is seen from, blended
// with the next; lit with the baked normals, snow on top where the ground is snowy.
//
// The card mesh spans x -0.5..0.5 across and y 0..1 up; `card` scales it to the views' size.
shader_type spatial;
render_mode cull_disabled, diffuse_burley, specular_schlick_ggx;

#include "res://shaders/plant_common.gdshaderinc"

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_disable;
uniform sampler2D normal_tex : hint_default_white, filter_linear_mipmap, repeat_disable;
uniform float views = 8.0;
uniform float rows = 4.0;
uniform float row = 0.0;
// the views' width and height (m), and how far below the model's origin their foot is
uniform vec2 card = vec2(10.0, 15.0);
uniform float foot = 0.0;
uniform float translucency : hint_range(0.0, 1.0) = 0.25;

varying vec2 v_uv;
varying float v_frame;
varying vec3 v_right;
varying vec3 v_to;
varying vec4 v_col;
varying vec3 v_wp;

void vertex() {
	// the camera in the model's own frame: the card turns to it round the vertical
	vec3 cam = (inverse(MODEL_MATRIX) * vec4(CAMERA_POSITION_WORLD, 1.0)).xyz;
	vec3 to = cam;
	to.y = 0.0;
	to = length(to) > 1e-4 ? normalize(to) : vec3(0.0, 0.0, 1.0);
	vec3 right = vec3(to.z, 0.0, -to.x);
	v_uv = vec2(VERTEX.x + 0.5, 1.0 - VERTEX.y);
	VERTEX = right * (VERTEX.x * card.x) + vec3(0.0, foot + VERTEX.y * card.y, 0.0);
	NORMAL = to;
	// view 0 looks from +z, the rest go round by +x
	float ang = atan(to.x, to.z);
	v_frame = mod(ang / 6.2831853 * views + views, views);
	v_right = right;
	v_to = to;
	v_col = COLOR;
	v_wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	float f0 = floor(v_frame);
	float t = v_frame - f0;
	float f1 = mod(f0 + 1.0, views);
	vec2 cell = vec2(1.0 / views, 1.0 / rows);
	vec2 uv0 = (vec2(f0, row) + v_uv) * cell;
	vec2 uv1 = (vec2(f1, row) + v_uv) * cell;
	vec4 a = mix(texture(albedo_tex, uv0), texture(albedo_tex, uv1), t);
	float far = smoothstep(150.0, 700.0, length(VERTEX));
	ALPHA = clamp(a.a * (1.0 + far * 0.8), 0.0, 1.0);
	ALPHA_SCISSOR_THRESHOLD = 0.5;
	ALPHA_ANTIALIASING_EDGE = 0.3;
	// the baked normal (x right, y up, z toward the view) back into the model's frame
	vec3 n = mix(texture(normal_tex, uv0).xyz, texture(normal_tex, uv1).xyz, t) * 2.0 - 1.0;
	vec3 nm = normalize(v_right * n.x + vec3(0.0, n.y, 0.0) + v_to * n.z);
	vec3 nw = normalize(mat3(MODEL_MATRIX) * nm);
	NORMAL = normalize((VIEW_MATRIX * vec4(nw, 0.0)).xyz);
	float s = plant_snow(v_col.a, nw, v_wp);
	ALBEDO = mix(a.rgb * v_col.rgb, snow_color, s);
	ROUGHNESS = 0.8;
	SPECULAR = 0.3;
	BACKLIGHT = a.rgb * translucency * (1.0 - s);
}
