// Painted (or bare galvanised) steel: a scanned sheet of weathered green paint with rust spots and
// drips, projected three ways in the object's own space and repainted in the colour asked for. The
// scan's light and dark stay with the new colour; its rust stays rust.
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

uniform vec3 paint_color : source_color = vec3(0.4, 0.44, 0.46);
uniform float metal : hint_range(0.0, 1.0) = 0.3;
uniform float rough : hint_range(0.0, 1.0) = 0.55;
// how much of the scan's mottling shows (0 a clean coat), and how far the rust has spread
uniform float wear : hint_range(0.0, 1.0) = 0.8;
uniform float rust : hint_range(0.0, 1.0) = 0.5;
// metres per repeat of the scan (it is a metre square)
uniform float period = 1.0;
uniform sampler2D scan_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D scan_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D scan_arm : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;

// the scan's mean luminance (linear)
const float SCAN_LUM = 0.066;

varying vec3 v_op;
varying vec3 v_on;

vec3 tnorm(vec2 xy) {
	xy = xy * 2.0 - 1.0;
	return vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0)));
}

float ph(vec3 p) {
	return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}
float pnoise(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(ph(i), ph(i + vec3(1, 0, 0)), f.x), mix(ph(i + vec3(0, 1, 0)), ph(i + vec3(1, 1, 0)), f.x), f.y),
			mix(mix(ph(i + vec3(0, 0, 1)), ph(i + vec3(1, 0, 1)), f.x), mix(ph(i + vec3(0, 1, 1)), ph(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

void vertex() {
	v_op = VERTEX;
	v_on = NORMAL;
}

void fragment() {
	vec3 n = normalize(v_on);
	vec3 w = pow(abs(n), vec3(4.0));
	w /= w.x + w.y + w.z;
	vec3 p = v_op / period;
	// the three projections (shifted apart so the faces of a beam do not match up)
	vec2 uvx = p.zy, uvy = p.xz + 0.37, uvz = p.xy + 0.71;
	vec3 scan = texture(scan_albedo, uvx).rgb * w.x + texture(scan_albedo, uvy).rgb * w.y + texture(scan_albedo, uvz).rgb * w.z;
	vec3 arm = texture(scan_arm, uvx).rgb * w.x + texture(scan_arm, uvy).rgb * w.y + texture(scan_arm, uvz).rgb * w.z;

	// rust is where the scan turns from green to orange; it spreads in broad patches as `rust` rises
	float rg = scan.r / max(scan.g, 1e-4);
	float spread = pnoise(v_op * 0.45) * 0.6 + pnoise(v_op * 1.7) * 0.4;
	float r = smoothstep(0.74, 0.95, rg) * (0.4 + rust);
	r = clamp(max(r, smoothstep(0.78, 0.98, spread + rust * 0.25) * rust), 0.0, 1.0);
	float k = mix(1.0, dot(scan, vec3(0.2126, 0.7152, 0.0722)) / SCAN_LUM, wear);
	vec3 rustCol = mix(vec3(0.16, 0.06, 0.025), vec3(0.3, 0.12, 0.045), pnoise(v_op * 6.0));
	ALBEDO = mix(paint_color * k, rustCol * mix(1.0, k, 0.5), r);
	METALLIC = metal * (1.0 - r);
	ROUGHNESS = clamp(mix(rough + (arm.g - 0.5) * 0.6, 0.85, r), 0.05, 1.0);
	AO = mix(1.0, arm.r, 0.6);

	// normal: each projection's tangent normal laid onto the face it faces (whiteout blend)
	// (normal maps are imported two-channel: z rebuilt from x and y)
	vec3 tx = tnorm(texture(scan_normal, uvx).xy);
	vec3 ty = tnorm(texture(scan_normal, uvy).xy);
	vec3 tz = tnorm(texture(scan_normal, uvz).xy);
	tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
	ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
	tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
	vec3 on = normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
	NORMAL = normalize((VIEW_MATRIX * (MODEL_MATRIX * vec4(on, 0.0))).xyz);
}
