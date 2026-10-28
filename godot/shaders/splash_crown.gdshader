// The crown a raindrop throws up (gfx/Splashes.cs): a few droplets flying out and falling back
// within a fifth of a second, over a flash where it hit, on an upright quad turned to the camera.
// Added on, like the rain.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled;

uniform float now = 0.0;
uniform float light_level = 1.0;

// the quad's height against its width
const float TALL = 0.6;

varying float v_age;
varying float v_seed;
varying float v_fade;

void vertex() {
	v_age = (now - INSTANCE_CUSTOM.r) / 0.18;
	v_seed = INSTANCE_CUSTOM.g;
	// turned to the camera round the vertical (the quad: x -0.5..0.5 across, y 0..1 up)
	vec3 cam = (inverse(MODEL_MATRIX) * vec4(CAMERA_POSITION_WORLD, 1.0)).xyz;
	vec3 to = vec3(cam.x, 0.0, cam.z);
	to = length(to) > 1e-4 ? normalize(to) : vec3(0.0, 0.0, 1.0);
	vec3 right = vec3(to.z, 0.0, -to.x);
	VERTEX = right * VERTEX.x + vec3(0.0, VERTEX.y * TALL, 0.0);
	if (v_age < 0.0 || v_age > 1.0) VERTEX = vec3(0.0);
	float d = length((MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).xyz);
	v_fade = 1.0 - smoothstep(6.0, 9.5, d);
}

float hash(float n) {
	return fract(sin(n) * 43758.5453);
}

void fragment() {
	float t = v_age;
	// (in the quad's own units: 1 across)
	vec2 p = vec2(UV.x - 0.5, UV.y * TALL);
	float k = 0.0;
	for (int i = 0; i < 6; i++) {
		float s = v_seed * 17.0 + float(i) * 3.1;
		// out to either side and up, falling back by the end
		float th = mix(-1.25, 1.25, (float(i) + hash(s)) / 6.0);
		float h = mix(0.25, 0.55, hash(s + 1.7));
		vec2 c = vec2(sin(th) * 0.45 * t, cos(th) * h * 4.0 * t * (1.0 - t));
		k += smoothstep(0.05, 0.01, length(p - c));
	}
	// the flash where it hit
	k += smoothstep(0.16, 0.0, length(p * vec2(1.0, 1.6))) * (1.0 - smoothstep(0.0, 0.4, t)) * 0.8;
	ALBEDO = vec3(0.8, 0.83, 0.88) * light_level * k * (1.0 - t * t) * 0.8 * v_fade;
}
