// Terrain: the ground layers height-blended by the weights the world generator gives each vertex
// (sand, dirt, rock, salt, grass, snow, forest floor, gravel), the biome's tint over them, rock and
// snow worked onto steep faces, and far off a quiet average under the haze.
//
// Vertex data (TerrainMesher.cs): CUSTOM0 sand/dirt/rock/salt, CUSTOM1 grass/snow/forest/gravel,
// COLOR biome tint + shrub cover, UV world x/z wrapped at 2048 m, UV2.x tree cover.
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

#include "res://shaders/ground.gdshaderinc"

// the far forest: how dark a canopy reads from afar, and from where it takes over from the trees
uniform vec3 canopy_color : source_color = vec3(0.07, 0.1, 0.055);
uniform vec3 canopy_snow : source_color = vec3(0.42, 0.46, 0.45);
uniform float tree_far = 750.0;
uniform float wetness : hint_range(0.0, 1.0) = 0.0;

// the biome colour each recoloured layer takes, relative to the biome's ground colour (sand a
// little lighter than the soil, rock and gravel a little darker)
const float TINT_LEVEL[8] = float[](1.12, 1.0, 0.9, 1.0, 1.0, 1.0, 1.0, 0.94);

varying vec4 v_w0;
varying vec4 v_w1;
varying vec3 v_tint;
varying float v_veg;
varying float v_tree;
varying vec2 v_uv;
varying vec3 v_wn;
varying float v_wy;
varying float v_dist;

void vertex() {
	v_w0 = CUSTOM0;
	v_w1 = CUSTOM1;
	v_tint = COLOR.rgb;
	v_veg = COLOR.a;
	v_tree = UV2.x;
	v_uv = UV;
	v_wn = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	v_wy = (MODEL_MATRIX * vec4(VERTEX, 1.0)).y;
	v_dist = length((MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).xyz);
}

void fragment() {
	float w[8] = float[](v_w0.x, v_w0.y, v_w0.z, v_w0.w, v_w1.x, v_w1.y, v_w1.z, v_w1.w);
	vec3 N = normalize(v_wn);
	float slope = 1.0 - N.y;
	// up close the near scale, further off the coarse one
	float farT = smoothstep(14.0, 90.0, v_dist);
	// rock on steep faces is projected onto the face (stretched streaks otherwise)
	vec2 uvSide = (abs(N.x) > abs(N.z) ? vec2(v_uv.y, v_wy) : vec2(v_uv.x, v_wy));
	float sideT = smoothstep(0.35, 0.6, slope);

	// height blending: each layer's own relief decides where it shows through its neighbours (sand
	// settles between the stones, snow fills the hollows first). Layers well below the strongest
	// are not sampled at all.
	float best = 0.0;
	float a[8];
	for (int i = 0; i < 8; i++) {
		a[i] = w[i] > 0.004 ? w[i] * 1.6 : -10.0;
		best = max(best, a[i]);
	}
	GroundSample smp[8];
	float b[8];
	float top = -10.0;
	for (int i = 0; i < 8; i++) {
		b[i] = -10.0;
		if (a[i] < best - 0.95) continue;
		vec2 uv = (i == 2 ? mix(v_uv, uvSide, sideT) : v_uv) / LAYER_PERIOD[i];
		smp[i] = ground_layer2(i, uv, farT);
		b[i] = a[i] + smp[i].height * 0.9;
		top = max(top, b[i]);
	}
	float cut = top - 0.32;
	vec3 alb = vec3(0.0);
	vec3 nt = vec3(0.0);
	float rough = 0.0, ao = 0.0, tot = 0.0;
	for (int i = 0; i < 8; i++) {
		float k = b[i] - cut;
		if (k <= 0.0) continue;
		vec3 c = smp[i].albedo * LAYER_GAIN[i];
		c *= mix(LAYER_MEAN[i], v_tint * TINT_LEVEL[i], LAYER_RECOLOUR[i]) / LAYER_MEAN[i];
		alb += c * k;
		nt += smp[i].normal * k;
		rough += smp[i].rough * k;
		ao += smp[i].ao * k;
		tot += k;
	}
	alb /= tot;
	nt = normalize(nt);
	rough /= tot;
	ao /= tot;

	float wSnow = w[5];
	// broad mottling so a plain is never one flat colour
	float mott = g_fbm(v_uv, 1.0 / 64.0);
	alb *= 0.9 + 0.2 * mott;

	// far shrubs: past the ring of real bushes, dark crowns speckle the open ground
	float shrubFar = smoothstep(180.0, 320.0, v_dist) * v_veg;
	float speck = smoothstep(0.62, 0.8, g_noise(v_uv * 0.6, 2048.0 * 0.6));
	alb = mix(alb, alb * vec3(0.55, 0.58, 0.48), speck * shrubFar * 0.6);

	// the far forest: a canopy painted onto the ground where the tree cards no longer reach
	float woodIn = smoothstep(tree_far - 180.0, tree_far + 30.0, v_dist) * v_tree;
	vec3 canopy = mix(canopy_color, canopy_snow, wSnow);
	canopy *= 0.75 + 0.5 * g_noise(v_uv * 0.15, 2048.0 * 0.15);
	alb = mix(alb, canopy, clamp(woodIn, 0.0, 1.0));
	rough = mix(rough, 0.95, woodIn);

	// wet ground darkens and shines
	alb *= mix(1.0, 0.62, wetness * (1.0 - wSnow));
	rough = mix(rough, 0.35, wetness * (1.0 - wSnow) * (1.0 - woodIn));

	ALBEDO = alb;
	ROUGHNESS = rough;
	AO = mix(1.0, ao, 0.8);
	AO_LIGHT_AFFECT = 0.25;
	// tangent space to world: the top projection's axes (x east, z south) on the mesh normal
	vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
	vec3 B = normalize(cross(T, N));
	// detail relief fades with distance (it only shimmers far off)
	float relief = 1.0 - smoothstep(60.0, 260.0, v_dist) * 0.75;
	vec3 nw = normalize(T * nt.x * relief + B * -nt.y * relief + N * nt.z);
	NORMAL = normalize((VIEW_MATRIX * vec4(nw, 0.0)).xyz);
}
