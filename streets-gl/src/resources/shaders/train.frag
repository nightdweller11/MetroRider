#include <versionPrecision>
#include <gBufferOut>

in vec3 vColor;
in vec2 vUv;
in float vDetail;
in vec3 vNormal;
in vec3 vPosition;
in vec4 vClipPos;
in vec4 vClipPosPrev;

uniform MainBlock {
	mat4 projectionMatrix;
	mat4 modelMatrix;
	mat4 viewMatrix;
	mat4 modelViewMatrixPrev;
	float objectMotion;
	// 1 when this mesh carries a base-colour map, 0 when it is vertex-coloured.
	float hasTexture;
	// Distance fade for fine geometric detail — see TRACK_BLEND_COLOR.
	vec4 trackBlendColor;
	float detailFadeStart;
	float detailFadeEnd;
};

uniform sampler2D tDiffuse;

#include <packNormal>
#include <getMotionVector>

void main() {
	vec3 normal = normalize(vNormal);
	normal *= float(gl_FrontFacing) * 2. - 1.;

	// The GLB's own base-colour map, sampled per FRAGMENT. The loader used to
	// bake it down to one colour per vertex, which at this vertex density turns
	// a livery stripe, a window or a logo into a smear.
	vec3 base = vColor;

	if (hasTexture > 0.5) {
		base = texture(tDiffuse, vUv).rgb * vColor;
	}

	// Rail LOD.
	//
	// Two thin rails converging at a grazing angle alternate rail/ballast pixel
	// by pixel — geometric aliasing that no texture filter can address, and
	// measured as by far the worst shimmer on screen. Past the point where the
	// rails cannot be resolved anyway, fade their colour into the ballast tone
	// so distant track reads as one steady band rather than a shimmering
	// ladder. vDetail is 0 for everything that is not track, so nothing else in
	// this material is affected.
	if (vDetail > 0.001) {
		float viewDistance = length(vPosition);
		float fade = smoothstep(detailFadeStart, detailFadeEnd, viewDistance);

		base = mix(base, trackBlendColor.rgb, fade * vDetail);
	}

	outColor = vec4(base, 1);
	outGlow = vec3(0);
	outNormal = packNormal(normal);
	outRoughnessMetalnessF0 = vec3(0.85, 0.0, 0.04);
	// .a carries the object's real-world motion (0 = parked, 1 = moving).
	// SSAO uses it to refresh occlusion under the moving train instead of
	// smearing stale AO (the trailing "shadow image"). Color TAA still runs
	// normally — the corrected per-object motion vectors make its
	// reprojection land exactly, so the train stays sharp both ways.
	outMotion = vec4(getMotionVector(vClipPos, vClipPosPrev), objectMotion);
	outObjectId = 0u;
}
