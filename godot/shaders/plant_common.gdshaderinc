// Shared by the plant shaders: the wind and the snow.
//
// Meshes from tools/blender/plants.py carry in UV2 how freely each part sways (x: 0 at the
// trunk, 1 at a twig tip) and a random phase (y); the instance colour's alpha (MultiMesh) is how
// snowed-on the plant is.

global uniform float wind;
// a steady breeze from the west, gusting
const vec3 WIND_DIR = vec3(0.86, 0.0, 0.5);

// how tall the plant is (the trunk bends with the square of height over this), how far its top
// moves in a gust (metres), how much its branches and leaves swing on their own
uniform float bend_height = 1.0;
uniform float sway = 0.05;
uniform float branch_sway = 0.05;
uniform vec3 snow_color : source_color = vec3(0.86, 0.89, 0.94);

// The wind's push in world space at a vertex of a plant standing at `o`.
vec3 plant_wind(vec3 v, vec3 o, vec2 w, float time, float flutter) {
	float gust = 0.55 + 0.45 * sin(time * 0.7 + dot(o.xz, vec2(0.013, 0.021))) * sin(time * 0.31 + o.x * 0.007);
	float strength = (0.25 + wind) * gust;
	float h = max(v.y, 0.0) / bend_height;
	float sway_t = sin(time * 1.1 + w.y * 6.283 + dot(o.xz, vec2(0.11, 0.07)));
	vec3 push = WIND_DIR * (h * h * sway * (0.7 + 0.3 * sway_t));
	// branches swing round the steady lean, leaves flutter faster
	float br = w.x * branch_sway;
	push += vec3(sin(time * 2.1 + w.y * 6.283), 0.3 * sin(time * 2.7 + w.y * 4.0), cos(time * 1.7 + w.y * 6.283)) * br;
	push += vec3(sin(time * 7.3 + v.x * 9.0 + w.y * 12.0), sin(time * 8.1 + v.z * 9.0), cos(time * 6.7 + v.y * 9.0)) * flutter * w.x;
	return push * strength;
}

// Moves a model-space vertex by the wind (the instance may be turned and scaled).
vec3 plant_sway(vec3 v, mat4 model, vec2 w, float time, float flutter) {
	vec3 o = model[3].xyz;
	vec3 push = plant_wind(v, o, w, time, flutter);
	float s2 = dot(model[0].xyz, model[0].xyz);
	return v + transpose(mat3(model)) * push / s2;
}

// How much snow sits on a surface facing `n` (world space), 0..1.
float plant_snow(float amount, vec3 n, vec3 p) {
	float up = n.y;
	float ragged = fract(sin(dot(floor(p * 7.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 0.25;
	return smoothstep(0.75 - amount * 0.55, 0.95 - amount * 0.45, up + ragged) * min(amount * 1.4, 1.0);
}
