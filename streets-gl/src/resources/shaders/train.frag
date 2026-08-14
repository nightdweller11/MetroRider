#include <versionPrecision>
#include <gBufferOut>

in vec3 vColor;
in vec2 vUv;
in float vDetail;
in float vTexFlag;
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
	// Livery paint: .rgb is the colour, .a how much of it to apply.
	vec4 tintColor;
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

	// The map is sampled only by the parts that actually use it. A merged mesh
	// keeps ONE image, but a model can have many materials with only some of
	// them textured — the town bus has 20 materials across 34 primitives. With
	// a per-MESH flag alone, the untextured parts sampled that image at their
	// filled-in uv of (0, 0) and whatever sits in that corner painted the whole
	// vehicle black, burying the material colours already in vColor.
	if (hasTexture > 0.5 && vTexFlag > 0.5) {
		base = texture(tDiffuse, vUv).rgb * vColor;
	}

	// Livery paint.
	//
	// NOT a plain multiply by the tint. Multiplying takes the model's own
	// colour with it, so a red livery on a dark grey carriage gives dark red
	// mush and on a white one gives pure red — the same paint reading as two
	// different colours depending on what it went over.
	//
	// Instead the pixel's BRIGHTNESS is kept and the colour replaced: a lit
	// body panel becomes the full livery colour, a shaded one becomes a darker
	// version of the same colour, and a window or a wheel — dark to begin with
	// — stays dark. That is how paint behaves, and it means the shading, the
	// panel lines and the glass all survive being repainted.
	if (tintColor.a > 0.001) {
		float lum = dot(base, vec3(0.2126, 0.7152, 0.0722));

		base = mix(base, tintColor.rgb * lum, tintColor.a);
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
