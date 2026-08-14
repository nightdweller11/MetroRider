#include <versionPrecision>

in vec3 position;
in vec3 normal;
in vec3 color;
in vec2 uv;
in float detail;
// 1 when this vertex's part actually uses the mesh's base-colour map.
in float texFlag;
out vec4 vClipPos;
out vec4 vClipPosPrev;

out vec3 vColor;
out vec2 vUv;
out float vDetail;
out float vTexFlag;
out vec3 vNormal;
out vec3 vPosition;

uniform MainBlock {
	mat4 projectionMatrix;
	mat4 modelMatrix;
	mat4 viewMatrix;
	mat4 modelViewMatrixPrev;
	float objectMotion;
	// EVERY field below is declared in BOTH stages even though only the
	// fragment shader reads them. GLSL requires a uniform block to be declared
	// identically everywhere it appears, and omitting one fails the link with
	// "Field numbers of uniform block 'MainBlock' differ between VERTEX and
	// FRAGMENT shaders" — which leaves the material with NO MainBlock at all,
	// so the train renders as untextured flat geometry and the console fills
	// with "program not valid".
	//
	// This has now caught two separate additions (hasTexture, then tintColor).
	// If you add a field to train.frag's MainBlock, add it here in the same
	// position, or nothing about the train draws correctly.
	float hasTexture;
	// Distance fade for fine geometric detail — see TRACK_BLEND_COLOR.
	vec4 trackBlendColor;
	float detailFadeStart;
	float detailFadeEnd;
	// Livery paint: .rgb is the colour, .a how much of it to apply.
	vec4 tintColor;
};

void main() {
	vColor = color;
	vUv = uv;
	vDetail = detail;
	vTexFlag = texFlag;

	vec3 modelNormal = normalize((viewMatrix * modelMatrix * vec4(normal, 0)).xyz);
	vNormal = modelNormal;

	vec4 cameraSpacePosition = viewMatrix * modelMatrix * vec4(position, 1);
	vec4 cameraSpacePositionPrev = modelViewMatrixPrev * vec4(position, 1);

	vPosition = vec3(cameraSpacePosition);

	vClipPos = projectionMatrix * cameraSpacePosition;
	vClipPosPrev = projectionMatrix * cameraSpacePositionPrev;

	gl_Position = vClipPos;
}
