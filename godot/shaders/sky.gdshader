// The sky: a single-scattering-like gradient from zenith to a horizon that warms at a low sun, a
// glow round the sun and its disc, cumulus lit through by the sun with a short self-shadow march
// (silver linings, pink undersides at sunset), cirrus streaks above, and at night stars that
// twinkle harder low down, the Milky Way with its dust lanes, and the moon. Overcast, dust and
// mist wash it out. A port of web/src/gfx/sky.js; DayCycle.cs drives the uniforms.
shader_type sky;
render_mode use_debanding;

uniform vec3 sun_dir = vec3(-0.6, 0.76, -0.26);
uniform vec3 moon_dir = vec3(0.5, -0.7, 0.3);
uniform float turbidity = 2.5;
uniform float cloud = 0.3;
uniform float dust = 0.0;
uniform float night = 0.0;
uniform float stars = 1.0;
uniform vec3 dust_color = vec3(0.78, 0.62, 0.45);
uniform float overcast = 0.0;
uniform float flash = 0.0;
uniform float mist = 0.0;
// clouds drift with this (seconds, from DayCycle so it can be wound on)
uniform float cloud_time = 0.0;
// the whole sky's brightness against the lit world
uniform float gain = 1.0;

float hash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
			mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
	float a = 0.5, s = 0.0;
	for (int i = 0; i < 5; i++) {
		s += a * noise(p);
		p *= 2.03;
		a *= 0.5;
	}
	return s;
}

vec3 sky_color(vec3 dir, vec3 sun) {
	float sunH = sun.y;
	float h = max(dir.y, 0.0);
	float mu = dot(dir, sun);
	float day = smoothstep(-0.12, 0.25, sunH);
	vec3 zenith = mix(vec3(0.012, 0.018, 0.04), vec3(0.16, 0.38, 0.82), day);
	vec3 horizon = mix(vec3(0.03, 0.04, 0.07), vec3(0.74, 0.8, 0.86), day);
	// a warm horizon toward a low sun
	float low = smoothstep(0.35, 0.0, abs(sunH)) * smoothstep(-0.2, 0.02, sunH);
	float az = pow(max(dot(normalize(vec3(dir.x, 0.0, dir.z) + 1e-5), normalize(vec3(sun.x, 0.0001, sun.z))), 0.0), 2.0);
	horizon = mix(horizon, vec3(1.0, 0.55, 0.28), low * (0.45 + 0.55 * az));
	zenith = mix(zenith, vec3(0.18, 0.24, 0.42), low * 0.5);
	float t = pow(1.0 - h, 3.2 + turbidity * 0.2);
	vec3 col = mix(zenith, horizon, t);
	// Mie glow round the sun
	float g = 0.76;
	float mie = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5);
	vec3 mieCol = mix(vec3(1.0, 0.75, 0.45), vec3(1.0, 0.95, 0.85), smoothstep(0.0, 0.4, sunH));
	col += mieCol * mie * 0.018 * (0.4 + turbidity * 0.12) * smoothstep(-0.1, 0.05, sunH);
	// below the horizon: ground haze
	if (dir.y < 0.0) col = mix(horizon * 0.85, horizon * 0.55, smoothstep(0.0, -0.3, dir.y));
	return col;
}

void sky() {
	vec3 dir = normalize(EYEDIR);
	vec3 sun = normalize(sun_dir);
	vec3 col = sky_color(dir, sun);

	// the sun's disc
	float mu = dot(dir, sun);
	float disc = smoothstep(0.99985, 0.99993, mu);
	vec3 sunCol = mix(vec3(1.0, 0.45, 0.15), vec3(1.0, 0.96, 0.88), smoothstep(0.0, 0.3, sun.y));
	col += sunCol * disc * 40.0 * smoothstep(-0.03, 0.02, sun.y) * (1.0 - overcast * 0.95);

	// night: stars, the Milky Way, the moon
	if (night > 0.001 && dir.y > -0.05 && !AT_CUBEMAP_PASS) {
		float lowAir = 1.0 - smoothstep(0.0, 0.45, dir.y);
		float ext = smoothstep(-0.02, 0.18, dir.y);
		vec3 starCol = vec3(0.0);
		for (int L = 0; L < 2; L++) {
			float dens = L == 0 ? 520.0 : 210.0;
			vec3 sd = dir * dens;
			vec3 cell = floor(sd);
			float hh = hash(cell);
			float h2 = hash(cell + 17.31);
			float h3 = hash(cell + 41.7);
			vec3 jit = vec3(hash(cell + 3.1), hash(cell + 5.7), hash(cell + 9.3)) - 0.5;
			float rr = length(fract(sd) - 0.5 - jit * 0.5);
			float th = L == 0 ? 0.982 : 0.9965;
			float star = step(th, hh) * smoothstep(L == 0 ? 0.38 : 0.5, 0.0, rr);
			float mag = L == 0 ? 0.25 + 0.55 * h2 * h2 : 1.4 + 2.6 * h2;
			float sp = 1.5 + 7.0 * h3;
			float amp = mix(0.12, 0.7, lowAir);
			float tw = 1.0 - amp * (0.5 + 0.5 * sin(TIME * sp + hh * 80.0)) * (0.5 + 0.5 * sin(TIME * sp * 1.73 + hh * 31.0));
			vec3 c = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.86, 0.66), h3);
			starCol += c * star * mag * tw;
		}
		col += starCol * ext * night * stars * 1.8 * (1.0 - cloud);
		vec3 mwAxis = normalize(vec3(0.3, 0.4, 0.86));
		float band = exp(-pow(dot(dir, mwAxis) * 3.2, 2.0));
		float milky = fbm(dir * 3.0 + vec3(3.1, 0.0, 1.7));
		float lanes = smoothstep(0.35, 0.7, fbm(dir * 9.0 + vec3(7.0, 1.0, 2.0)));
		col += vec3(0.075, 0.085, 0.12) * (0.4 + milky) * band * (1.0 - lanes * 0.6) * ext * night * stars * (1.0 - cloud);
		vec3 moon = normalize(moon_dir);
		float md = dot(dir, moon);
		float mdisc = smoothstep(0.99955, 0.99965, md);
		float crater = 0.75 + 0.25 * fbm(dir * 900.0);
		col += vec3(0.85, 0.88, 0.95) * mdisc * crater * 3.0 * (1.0 - cloud * 0.8);
		col += vec3(0.08, 0.1, 0.16) * pow(max(md, 0.0), 80.0) * night * 0.6;
	}

	// cumulus lit from the sun with a short self-shadow march; cirrus above
	if (dir.y > 0.0) {
		float dayC = smoothstep(-0.14, 0.04, sun.y);
		vec2 uv = dir.xz / (dir.y + 0.09) * 1.25;
		vec2 wnd = vec2(cloud_time * 0.006, cloud_time * 0.003);
		vec3 q = vec3(uv * 0.55 + wnd, cloud_time * 0.002);
		vec3 warp = vec3(fbm(q * 0.6 + 4.2), fbm(q * 0.6 + 9.1), 0.0);
		float n = fbm(q + warp * 0.9);
		float cover = mix(0.66, 0.24, cloud);
		float dens = smoothstep(cover, cover + 0.2, n) * smoothstep(0.0, 0.1, dir.y);
		float occ = 0.0;
		if (dens > 0.001) {
			vec2 sdir = normalize(sun.xz + 1e-4) * 0.06;
			for (int i = 1; i <= 3; i++) {
				vec3 qs = vec3((uv + sdir * float(i)) * 0.55 + wnd, cloud_time * 0.002);
				occ += smoothstep(cover, cover + 0.25, fbm(qs + warp * 0.9));
			}
		}
		float lightT = exp(-occ * 0.75);
		float silver = pow(max(mu, 0.0), 6.0) * (1.0 - dens) * 2.2;
		vec3 sunTint = mix(vec3(1.0, 0.55, 0.3), vec3(1.0, 0.97, 0.92), smoothstep(0.02, 0.35, sun.y));
		float glow = smoothstep(0.25, 0.0, sun.y) * smoothstep(-0.14, -0.02, sun.y);
		vec3 lit = sunTint * (0.55 + 0.75 * lightT) + silver * sunTint + vec3(1.0, 0.45, 0.32) * glow * (0.6 + 0.6 * (1.0 - lightT));
		vec3 ambient = mix(vec3(0.42, 0.48, 0.6), vec3(0.62, 0.5, 0.48), smoothstep(0.3, 0.0, sun.y));
		vec3 cloudCol = mix(ambient * 0.7, lit, 0.7);
		cloudCol = mix(vec3(0.03, 0.035, 0.05) + vec3(0.04, 0.045, 0.06) * lightT, cloudCol, dayC);
		cloudCol *= mix(1.0, 0.5, overcast);
		col = mix(col, cloudCol, dens * 0.95);
		vec2 cu = dir.xz / (dir.y + 0.25) * vec2(0.6, 2.4) + wnd * 2.0;
		float ci = smoothstep(0.55, 0.85, fbm(vec3(cu, 1.7))) * smoothstep(0.05, 0.3, dir.y) * (0.25 + 0.5 * cloud) * (1.0 - dens);
		col = mix(col, sunTint * mix(0.25, 1.05, dayC), ci * 0.35);
	}
	// overcast and dust
	vec3 grey = mix(vec3(0.03, 0.035, 0.045), vec3(0.55, 0.57, 0.6), smoothstep(-0.1, 0.3, sun.y));
	// (a storm's sky is darker than a dull one)
	grey *= 1.0 - 0.45 * smoothstep(0.6, 1.0, overcast);
	col = mix(col, grey * (0.85 + 0.15 * dir.y), overcast * 0.85);
	vec3 dustC = dust_color * mix(0.06, 1.0, smoothstep(-0.1, 0.3, sun.y));
	col = mix(col, dustC, dust * (0.72 + 0.28 * (1.0 - max(dir.y, 0.0))));
	// in a mist the sky goes milky toward the horizon
	vec3 mistC = mix(vec3(0.05, 0.055, 0.07), vec3(0.8, 0.82, 0.85), smoothstep(-0.1, 0.25, sun.y));
	col = mix(col, mistC, mist * 0.85 * (1.0 - smoothstep(0.0, 0.6, dir.y) * 0.65));
	col += vec3(0.6, 0.65, 0.8) * flash;
	COLOR = col * gain;
}
