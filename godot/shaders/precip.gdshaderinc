// Shared by the rain and snow: every drop or flake is one quad of a fixed mesh whose place is
// worked out here from its own random numbers (COLOR) and the time, wrapped round a box that
// follows the camera, so they stay put in the world as you move through them and nothing is
// computed on the CPU. UV2.x orders them: those above `amount` are folded away.

uniform float amount : hint_range(0.0, 1.0) = 0.0;
uniform vec3 box = vec3(36.0, 22.0, 36.0);
// metres per second: how fast they fall, and the wind that carries them
uniform float fall = 9.0;
uniform vec3 drift = vec3(1.5, 0.0, 0.5);
// how much light there is to see them by (day 1, a moonless night much less)
uniform float light_level = 1.0;

// Where drop `seed` is now, in the box round the camera.
vec3 precip_pos(vec3 seed, vec3 vel, float time, vec3 cam) {
	vec3 p = seed * box + vel * time;
	vec3 base = cam - box * vec3(0.5, 0.4, 0.5);
	return base + mod(p - base, box);
}
