// Buildings (world/places/Builder.cs): CC0 scans on the builder's metre UVs, painted or tinted to
// the place's colours (the paint keeps the scan's light and dark as its grain, and flakes off an
// old place in patches), weathered (dirt splashed up the foot of a wall, dust settled on what
// faces up, streaks down the walls, rust running down iron), darker and glossy in the rain out
// of doors, snow on what faces up in the north. The normal map is laid on with a frame worked
// out from the screen gradients, so the builder writes no tangents.
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D arm_tex : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
// metres one repeat of the scan covers (across, up)
uniform vec2 tex_metres = vec2(2.0);
uniform vec3 tint : source_color = vec3(1.0);
// paint over the scan: its colour, and how much of it
uniform vec4 paint : source_color = vec4(1.0, 1.0, 1.0, 0.0);
uniform float normal_strength = 1.0;
uniform float rough_scale = 1.0;
// < 0: the scan's own metalness
uniform float metal = -1.0;
// out in the weather (wet, dirty, snowy) or under a roof
uniform bool outdoor = true;
uniform float dirt = 0.5;
uniform float dust = 0.35;
uniform float rust = 0.0;
// how readily the paint flakes off as the place gets old
uniform float peel = 0.0;
// per building: 0 kept up, 1 long abandoned; snow lying on it
instance uniform float age = 0.5;
instance uniform float snow = 0.0;
global uniform float wetness;

varying vec3 v_wp;
varying vec3 v_wn;
// the place in the building's own frame (the weathering stays put when the world's origin moves)
varying vec3 v_lp;

void vertex() {
	v_wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_wn = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	// (the builder's 0 is the ground the place stands on)
	v_lp = VERTEX;
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
	return noise(p) * 0.5 + noise(p * 2.03 + 1.7) * 0.25 + noise(p * 4.1 + 5.3) * 0.15 + noise(p * 8.3 + 9.1) * 0.1;
}

void fragment() {
	vec2 uv = UV / tex_metres;
	vec3 scan = texture(albedo_tex, uv).rgb;
	vec3 arm = texture(arm_tex, uv).rgb;
	vec3 nm = texture(normal_tex, uv).xyz * 2.0 - 1.0;
	vec3 N = normalize(v_wn);
	float up = N.y;
	float old = clamp(age, 0.0, 1.0);

	// paint: its colour carrying the scan's grain (against the scan's own mean), gone in patches
	vec3 mean = textureLod(albedo_tex, vec2(0.5), 12.0).rgb;
	float grain = dot(scan, vec3(0.3, 0.59, 0.11)) / max(dot(mean, vec3(0.3, 0.59, 0.11)), 0.02);
	vec3 painted = paint.rgb * clamp(mix(1.0, grain, 0.3), 0.75, 1.2);
	float flakes = fbm(UV * 1.7 + 3.1) + (noise(UV * 9.0) - 0.5) * 0.12;
	float bare = smoothstep(0.84, 0.88, flakes + peel * old * 0.22);
	// (where the paint is gone, the wood under it has weathered grey)
	vec3 raw = scan * tint;
	vec3 weathered = mix(raw, vec3(dot(raw, vec3(0.3, 0.59, 0.11)) * 1.15 + 0.06), 0.65);
	vec3 alb = mix(paint.a > 0.0 ? mix(raw, weathered, bare) : raw, painted, paint.a * (1.0 - bare));
	float rough = clamp(arm.g * rough_scale, 0.04, 1.0);
	float metallic = metal < 0.0 ? arm.b : metal;
	rough = mix(rough, 0.55, paint.a * (1.0 - bare) * 0.6);

	float n1 = fbm(v_lp.xz * 0.9 + v_lp.y * 0.3);
	if (outdoor) {
		// splashed dirt along the foot, higher in patches
		float foot = 1.0 - smoothstep(0.0, 0.5 + 0.7 * n1, v_lp.y);
		alb = mix(alb, alb * vec3(0.62, 0.53, 0.43), foot * dirt * (1.0 - up * up) * 0.9);
		// streaks running down the walls from what is above
		float side = 1.0 - abs(up);
		vec2 sp = vec2(dot(v_lp.xz, vec2(0.7, 0.7)) * 3.0, v_lp.y * 0.35);
		float streak = smoothstep(0.55, 0.85, fbm(sp)) * side;
		alb = mix(alb, alb * vec3(0.7, 0.66, 0.6), streak * dust * (0.4 + old * 0.6));
		// rust down iron
		float r = smoothstep(0.45, 0.75, fbm(vec2(sp.x * 1.3, v_lp.y * 0.8) + 7.0) + (n1 - 0.5) * 0.4) * rust;
		alb = mix(alb, vec3(0.3, 0.14, 0.06) * (0.7 + 0.6 * n1), r);
		rough = mix(rough, 0.85, r);
		metallic = mix(metallic, 0.15, r);
	}
	// dust settled on what faces up (indoors too, in a long-empty house)
	float settled = smoothstep(0.55, 0.9, up) * dust * (outdoor ? 0.8 : old * 0.6) * (0.6 + 0.4 * n1);
	alb = mix(alb, vec3(0.6, 0.53, 0.43), settled * 0.55);
	rough = mix(rough, 0.95, settled);

	// rain: darker and glossier out of doors (the walls less than what faces up)
	float wet = outdoor ? wetness * mix(0.45, 1.0, max(up, 0.0)) : 0.0;
	alb *= mix(1.0, 0.68, wet);
	rough = mix(rough, 0.22, wet * (1.0 - metallic * 0.5));

	// snow lying on what faces up
	float s = outdoor ? smoothstep(0.5, 0.8, up + (n1 - 0.5) * 0.25) * snow : 0.0;
	alb = mix(alb, vec3(0.86, 0.88, 0.92), s);
	rough = mix(rough, 0.8, s);
	nm.xy *= 1.0 - s * 0.8;

	// the scan's relief on the frame of the screen gradients (no tangents needed)
	vec3 dp1 = dFdx(v_wp), dp2 = dFdy(v_wp);
	vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
	vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
	vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
	vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
	float inv = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-20));
	// (the image's up is toward smaller v)
	vec3 nw = normalize(T * inv * nm.x * normal_strength - B * inv * nm.y * normal_strength + N * max(nm.z, 0.05));

	ALBEDO = alb;
	ROUGHNESS = rough;
	METALLIC = metallic;
	AO = arm.r;
	AO_LIGHT_AFFECT = 0.2;
	NORMAL = normalize((VIEW_MATRIX * vec4(nw, 0.0)).xyz);
}
