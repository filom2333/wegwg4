// Ground texture arrays shared by the terrain and the road (assets/textures/ground, packed by
// tools/build/pack_ground.py from CC0 Poly Haven scans). Layers:
//   0 sand  1 dirt  2 rock  3 salt  4 grass  5 snow  6 forest floor  7 gravel  8 asphalt  9 road gravel
// data: R height (for height blending), G roughness, B ambient occlusion.

uniform sampler2DArray ground_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray ground_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray ground_data : filter_linear_mipmap_anisotropic, repeat_enable;

// Metres per repeat of each ground layer up close. Every period divides 2048 m (the wrap of the
// world texture coordinates), so the pattern runs on across the wrap without a seam.
const float LAYER_PERIOD[8] = float[](3.2, 4.0, 6.4, 10.24, 3.2, 4.0, 4.0, 3.2);
// colour corrections of the scans to the game's palette
const vec3 LAYER_GAIN[8] = vec3[](vec3(1.0), vec3(1.0), vec3(1.0), vec3(1.0), vec3(0.92, 1.02, 0.86), vec3(1.32, 1.33, 1.36), vec3(1.0), vec3(1.0));
// each scan's mean colour (pack_ground.py prints them), and how far the terrain recolours it to
// the biome's ground colour: the scan gives the pattern and its light and dark, the biome the
// colour (as the browser version's palette), so a dirt plain in the scrub and one in the badlands
// differ the way the land does
const vec3 LAYER_MEAN[8] = vec3[](vec3(0.577, 0.503, 0.39), vec3(0.583, 0.453, 0.307), vec3(0.513, 0.412, 0.316), vec3(0.8, 0.788, 0.76), vec3(0.592, 0.515, 0.35), vec3(0.648, 0.647, 0.656), vec3(0.417, 0.353, 0.266), vec3(0.571, 0.434, 0.299));
const float LAYER_RECOLOUR[8] = float[](0.55, 0.85, 0.7, 0.0, 0.0, 0.0, 0.0, 0.7);
// how much of each scan's light and dark (and relief) is kept: the salt crust's cracks are a
// photograph of mud, far bolder than a salt pan's
const float LAYER_CONTRAST[8] = float[](1.0, 1.0, 1.0, 0.4, 1.0, 1.0, 1.0, 1.0);

struct GroundSample {
	vec3 albedo;
	vec3 normal; // tangent space, +z up
	float rough;
	float ao;
	float height;
};

GroundSample ground_layer(int i, vec2 uv) {
	vec3 p = vec3(uv, float(i));
	GroundSample s;
	s.albedo = texture(ground_albedo, p).rgb;
	vec3 n = texture(ground_normal, p).xyz * 2.0 - 1.0;
	s.normal = vec3(n.xy, max(n.z, 0.05));
	vec3 d = texture(ground_data, p).rgb;
	s.height = d.r;
	s.rough = d.g;
	s.ao = d.b;
	return s;
}

// The same layer at two scales, the coarse one turned and offset, mixed by `t`: the near pattern
// up close, the coarse one further off, and neither repeats where they cross.
GroundSample ground_layer2(int i, vec2 uv, float t) {
	GroundSample a = ground_layer(i, uv);
	vec2 uv2 = mat2(vec2(0.8, 0.6), vec2(-0.6, 0.8)) * uv * 0.2 + vec2(0.37, 0.71);
	GroundSample b = ground_layer(i, uv2);
	GroundSample s;
	s.albedo = mix(a.albedo, b.albedo, t);
	s.normal = normalize(mix(a.normal, b.normal, t));
	s.rough = mix(a.rough, b.rough, t);
	s.ao = mix(a.ao, b.ao, t);
	s.height = mix(a.height, b.height, t);
	return s;
}

float g_hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Value noise that repeats every `period` lattice cells (the world coordinates wrap at 2048 m, so
// noise at frequency f takes period 2048 * f to run on across the wrap).
float g_noise(vec2 p, float period) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	vec2 i1 = mod(i + 1.0, period);
	i = mod(i, period);
	return mix(mix(g_hash(i), g_hash(vec2(i1.x, i.y)), f.x), mix(g_hash(vec2(i.x, i1.y)), g_hash(i1), f.x), f.y);
}

// Four octaves of it; `uv` in metres (wrapped at 2048), `freq` lattice cells per metre.
float g_fbm(vec2 uv, float freq) {
	float s = 0.0, a = 0.5;
	for (int i = 0; i < 4; i++) {
		s += a * g_noise(uv * freq, 2048.0 * freq);
		freq *= 2.0;
		a *= 0.5;
	}
	return s;
}
