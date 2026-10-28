// Rivers and lakes: the bed seen through the water, darkening and turning teal with depth, ripples
// drifting with the flow (or the wind on lakes), the sky mirrored at grazing angles and the sun's
// glint. Reflection and glint are worked out here from the sky colours and the sun (global
// uniforms set by SunSync.cs), so the water looks the same whatever the renderer's own sky
// reflections do.
//
// Vertex data (WaterStreamer.cs): UV metres along/across the flow (rivers) or from the centre
// (lakes); UV2.x 0 in open water .. 1 at the shore.
shader_type spatial;
render_mode blend_mix, depth_draw_always, cull_back, specular_disabled, diffuse_lambert;

// (linear light; sun_color already times the light's energy)
global uniform vec3 sun_direction;
global uniform vec3 sun_color;
global uniform vec3 sky_top;
global uniform vec3 sky_horizon;
global uniform float sky_curve;

uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform sampler2D depth_tex : hint_depth_texture, filter_nearest;
// rivers flow along UV.x; lakes have no current, only the wind
uniform bool flowing = true;
uniform float wind : hint_range(0.0, 1.0) = 0.3;
// light lost per metre of water (red goes first), and the colour the water itself scatters
uniform vec3 absorb = vec3(0.85, 0.34, 0.27);
uniform vec3 scatter : source_color = vec3(0.035, 0.1, 0.095);

varying vec3 v_wp;
varying float v_edge;

float wh(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float wn(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(wh(i), wh(i + vec2(1, 0)), f.x), mix(wh(i + vec2(0, 1)), wh(i + vec2(1, 1)), f.x), f.y);
}
vec2 wgrad(vec2 p) {
	float e = 0.05;
	return vec2(wn(p + vec2(e, 0.0)) - wn(p - vec2(e, 0.0)), wn(p + vec2(0.0, e)) - wn(p - vec2(0.0, e))) / (2.0 * e);
}

vec3 sky_at(vec3 dir) {
	// the procedural sky's gradient (environment/day.tres), in linear light: by elevation angle
	float c = clamp(1.0 - acos(clamp(dir.y, -1.0, 1.0)) / (PI * 0.5), 0.0, 1.0);
	float k = clamp(1.0 - pow(1.0 - c, 1.0 / sky_curve), 0.0, 1.0);
	return mix(sky_horizon, sky_top, k);
}

void vertex() {
	v_wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_edge = UV2.x;
}

void fragment() {
	// ripples: two noise layers drifting with the flow or the wind, and a fine wind chop
	vec2 p = UV;
	float sp = 0.6 + wind;
	vec2 drift = flowing ? vec2(TIME * sp, 0.0) : vec2(TIME * 0.15, TIME * 0.1) * (0.4 + wind);
	vec2 g1 = wgrad(vec2(p.x * 0.35, p.y * 0.5) - drift * 0.6);
	vec2 g2 = wgrad(vec2(p.x * 1.1, p.y * 1.4) - drift * 1.3 + vec2(3.1, 0.0));
	vec2 g3 = wgrad(p * 2.2 + vec2(TIME * 0.7, -TIME * 0.5));
	// (the finer ripples fade out with distance before they shrink below a pixel and only flicker)
	float dist = length(VERTEX);
	float fine = 1.0 - smoothstep(25.0, 90.0, dist);
	float mid = 1.0 - smoothstep(70.0, 260.0, dist) * 0.7;
	vec2 slope = g1 * 0.05 + g2 * 0.03 * mid + g3 * 0.012 * (0.5 + wind) * fine;
	// (UV runs along/across the flow; near enough to world x/z for the light)
	vec3 nw = normalize(vec3(-slope.x, 1.0, -slope.y));
	vec3 nv = normalize((VIEW_MATRIX * vec4(nw, 0.0)).xyz);

	// how much water the eye looks through to the bed
	float depth = texture(depth_tex, SCREEN_UV).r;
#if CURRENT_RENDERER == RENDERER_COMPATIBILITY
	vec3 ndc = vec3(SCREEN_UV, depth) * 2.0 - 1.0;
#else
	vec3 ndc = vec3(SCREEN_UV * 2.0 - 1.0, depth);
#endif
	vec4 bed = INV_PROJECTION_MATRIX * vec4(ndc, 1.0);
	bed.xyz /= bed.w;
	float thick = max(length(bed.xyz) - length(VERTEX), 0.0);
	// the bed, bent by the ripples (less where the water is thin)
	vec2 ruv = SCREEN_UV + nv.xz * 0.025 * clamp(thick * 0.5, 0.0, 1.0);
	vec3 behind = textureLod(screen_tex, ruv, 0.0).rgb;
	vec3 T = exp(-absorb * thick);
	vec3 body = behind * T + scatter * (dot(sun_color, vec3(0.3333)) * 0.35 + 0.25) * (1.0 - T);

	// the sky mirrored by the surface, strongest at grazing angles, and the sun's glint
	vec3 V = normalize(-VERTEX);
	vec3 vw = normalize((INV_VIEW_MATRIX * vec4(V, 0.0)).xyz);
	vec3 R = reflect(-vw, nw);
	float cosT = clamp(dot(nw, vw), 0.0, 1.0);
	float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
	vec3 refl = sky_at(R) * 1.1;
	vec3 L = -normalize(sun_direction);
	float glint = pow(max(dot(R, L), 0.0), 900.0) * 60.0 + pow(max(dot(R, L), 0.0), 90.0) * 0.6;
	vec3 col = mix(body, refl, F) + sun_color * glint * step(0.0, L.y);

	ALBEDO = vec3(0.0);
	ROUGHNESS = 1.0;
	SPECULAR = 0.0;
	EMISSION = col;
	// the edges fade into the shore (the bed shows through there anyway)
	ALPHA = 1.0 - smoothstep(0.86, 1.0, v_edge);
}
