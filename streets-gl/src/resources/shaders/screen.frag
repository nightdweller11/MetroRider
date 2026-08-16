#include <versionPrecision>

out vec4 FragColor;

in vec2 vUv;

uniform sampler2D tHDR;
uniform sampler2D tLabels;
uniform sampler2D tSlippyMap;

uniform Uniforms {
	vec2 resolution;
	float slippyMapFactor;
	float exposure;
};

#include <gamma>
#include <tonemap>

// from https://iquilezles.org/articles/distfunctions
float roundedBoxSDF(vec2 CenterPosition, vec2 Size, float Radius) {
	return length(max(abs(CenterPosition) - Size + Radius, 0.0)) - Radius;
}

void main() {
	vec2 uv = vUv;

	vec4 labels = vec4(0);

	#if LABELS_ENABLED == 1
		labels = texture(tLabels, uv);

		float bordersSDF = roundedBoxSDF(vUv * resolution - resolution * 0.5, resolution * 0.5, 100.);
		labels.a *= smoothstep(0., -100., bordersSDF);
	#endif

	// Tone map BEFORE the gamma conversion: the curve works on linear light,
	// and the conversion is what puts it on the screen.
	vec3 sceneColor = LINEARtoSRGB(tonemapACES(texture(tHDR, uv).rgb * exposure));
	vec3 sceneWithLabelsColor = mix(sceneColor, labels.rgb, labels.a);

	vec3 withSlippyMap = mix(sceneWithLabelsColor, texture(tSlippyMap, uv).rgb, slippyMapFactor);

	FragColor = vec4(withSlippyMap, 1);
}