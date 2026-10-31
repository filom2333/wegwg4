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
// the same means in linear light (what the shader samples), for blending a scan toward its mean
const vec3 LAYER_MEAN_LIN[8] = vec3[](vec3(0.2937, 0.2185, 0.1268), vec3(0.3132, 0.1832, 0.0845), vec3(0.2324, 0.1455, 0.0838), vec3(0.6082, 0.5883, 0.5421), vec3(0.3199, 0.2359, 0.1063), vec3(0.3791, 0.3786, 0.3887), vec3(0.1524, 0.1087, 0.0640), vec3(0.2913, 0.1615, 0.0759));
const float LAYER_RECOLOUR[8] = float[](0.55, 0.85, 0.7, 0.0, 0.0, 0.0, 0.0, 0.7);
// how much of each scan's light and dark (and relief) is kept: the salt crust's cracks are a
// photograph of mud, far bolder than a salt pan's
const float LAYER_CONTRAST[8] = float[](1.0, 1.0, 1.0, 0.4, 1.0, 0.45, 1.0, 1.0);

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

// The same with the mip level taken from the given gradients (for samples whose coordinates
// jump: the jump would otherwise pick the smallest mip along it, a line of blur).
GroundSample ground_layer_grad(int i, vec2 uv, vec2 dx, vec2 dy) {
	vec3 p = vec3(uv, float(i));
	GroundSample s;
	s.albedo = textureGrad(ground_albedo, p, dx, dy).rgb;
	vec3 n = textureGrad(ground_normal, p, dx, dy).xyz * 2.0 - 1.0;
	s.normal = vec3(n.xy, max(n.z, 0.05));
	vec3 d = textureGrad(ground_data, p, dx, dy).rgb;
	s.height = d.r;
	s.rough = d.g;
	s.ao = d.b;
	return s;
}

GroundSample ground_mix(GroundSample a, GroundSample b, float t) {
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

// Which of eight offsets of a scan a place takes (see ground_layer_var). It looks at the
// neighbouring pixels, so it is worked out where every pixel runs, outside any branch. `m`: the
// place in metres (wrapped at 2048), `freq` the noise's lattice cells per metre (2048 * freq a
// whole number, so it runs on across the wrap).
struct GroundPatch {
	float index;
	float f; // 0..1 across the band between this offset and the next
	bool edge; // a 2x2 block of pixels across a patch edge
	bool only_a; // the whole block shows this offset alone
	bool only_b; // or the next alone
};

GroundPatch ground_patch(vec2 m, float freq) {
	GroundPatch p;
	float l = g_noise(m * freq, 2048.0 * freq) * 8.0;
	p.index = floor(l);
	p.f = l - p.index;
	// across a patch edge the offset jumps between neighbouring pixels, and a mip level taken
	// from that jump would blur a line along it: those blocks take it from the true gradients
	p.edge = fwidthCoarse(p.index) > 0.0;
	// the bounds ground_layer_var's blend leaves one sample alone, kept by the whole block (a
	// sample only some of a block takes has no gradients for the rest)
	float fw = 2.0 * fwidthCoarse(p.f);
	p.only_a = p.f + fw < 0.14;
	p.only_b = p.f - fw > 0.86;
	return p;
}

GroundSample ground_layer_at(int i, vec2 uv, vec2 dx, vec2 dy, bool grad) {
	return grad ? ground_layer_grad(i, uv, dx, dy) : ground_layer(i, uv);
}

// A layer without its repeat (after Inigo Quilez's texture variation): a slow noise picks one of
// eight offsets of the scan per patch, and where two patches meet, both are sampled and the one
// standing higher in its own relief shows, so the seam follows the stones and the cracks instead
// of a line. `dx`, `dy`: the screen gradients of `uv`.
GroundSample ground_layer_var(int i, vec2 uv, vec2 dx, vec2 dy, GroundPatch p) {
	vec2 oa = sin(vec2(3.0, 7.0) * p.index);
	vec2 ob = sin(vec2(3.0, 7.0) * (p.index + 1.0));
	if (p.only_a) return ground_layer_at(i, uv + oa, dx, dy, p.edge);
	if (p.only_b) return ground_layer_at(i, uv + ob, dx, dy, p.edge);
	GroundSample a = ground_layer_at(i, uv + oa, dx, dy, p.edge);
	GroundSample b = ground_layer_at(i, uv + ob, dx, dy, p.edge);
	// (the relief has its say only inside the band: at either end it is one offset alone, so
	// the next band starts where this one ends)
	float e = p.f + (b.height - a.height) * 0.35 * sin(3.14159 * p.f);
	return ground_mix(a, b, smoothstep(0.3, 0.7, e));
}

// The layer at two scales, the coarse one turned, mixed by `t` (0 and 1 whole 2x2 blocks only):
// the near pattern up close, the coarse one further off, neither repeating. `near`, `coarse`:
// ground_patch at 1/8 and 1/32 of a metre.
GroundSample ground_layer2(int i, vec2 uv, vec2 dx, vec2 dy, float t, GroundPatch near, GroundPatch coarse) {
	if (t <= 0.0) return ground_layer_var(i, uv, dx, dy, near);
	mat2 r = mat2(vec2(0.8, 0.6), vec2(-0.6, 0.8)) * 0.2;
	GroundSample c = ground_layer_var(i, r * uv + vec2(0.37, 0.71), r * dx, r * dy, coarse);
	if (t >= 1.0) return c;
	return ground_mix(ground_layer_var(i, uv, dx, dy, near), c, t);
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
