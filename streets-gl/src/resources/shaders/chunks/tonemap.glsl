// Filmic tone mapping.
//
// The scene is rendered in HDR and the final pass converted it straight to
// sRGB with pow(colour, 1/2.2) — no tone map at all. Anything brighter than
// 1.0 therefore clamped to pure white in the framebuffer, so a midday sun on
// pale ground flattened whole hillsides and roofs into a single flat sheet
// with no detail in it. That is what "blown out" was: not exposure, but the
// absence of a curve.
//
// Krzysztof Narkowicz's ACES fit. It is one multiply-add over a multiply-add,
// which is nothing per pixel, and it rolls highlights off towards white
// instead of cutting them at it — so a bright sky keeps its gradient and a lit
// wall keeps its texture.
vec3 tonemapACES(vec3 x) {
	const float a = 2.51;
	const float b = 0.03;
	const float c = 2.43;
	const float d = 0.59;
	const float e = 0.14;

	return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
