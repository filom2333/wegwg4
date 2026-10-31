// A lightning channel (gfx/Lightning.cs builds the tubes): added onto whatever is behind, far
// brighter than white so the glow spreads it, through the haze and never thinner than about a
// pixel (wider, it is dimmed to match). The halo is a wider tube fading toward its outline.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_back, shadows_disabled, fog_disabled;

uniform vec3 color = vec3(5.0, 5.4, 6.5);
uniform float strength = 1.0;
// 0 the core, 1 the halo (soft edges)
uniform float halo = 0.0;

varying float v_thin;

void vertex() {
	// UV2.x: the tube's radius; each ring point is that far out from the channel along its normal
	float r = UV2.x;
	vec3 c = VERTEX - NORMAL * r;
	float d = length((MODELVIEW_MATRIX * vec4(c, 1.0)).xyz);
	float rr = max(r, d * 0.0012);
	VERTEX = c + NORMAL * rr;
	v_thin = r / rr;
}

void fragment() {
	float edge = abs(dot(NORMAL, VIEW));
	ALBEDO = color * strength * mix(1.0, edge * edge * edge, halo) * v_thin;
}
