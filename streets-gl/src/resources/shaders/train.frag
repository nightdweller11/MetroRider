#include <versionPrecision>
#include <gBufferOut>

in vec3 vColor;
in vec2 vUv;
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
