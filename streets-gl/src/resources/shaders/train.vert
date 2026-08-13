#include <versionPrecision>

in vec3 position;
in vec3 normal;
in vec3 color;
in vec2 uv;
out vec4 vClipPos;
out vec4 vClipPosPrev;

out vec3 vColor;
out vec2 vUv;
out vec3 vNormal;
out vec3 vPosition;

uniform MainBlock {
	mat4 projectionMatrix;
	mat4 modelMatrix;
	mat4 viewMatrix;
	mat4 modelViewMatrixPrev;
	float objectMotion;
	// Declared in BOTH stages even though only the fragment shader reads it:
	// GLSL requires a uniform block to be declared identically everywhere it
	// appears, and omitting it here failed the link with "Field numbers of
	// uniform block 'MainBlock' differ between VERTEX and FRAGMENT shaders",
	// which left the material with no MainBlock at all.
	float hasTexture;
};

void main() {
	vColor = color;
	vUv = uv;

	vec3 modelNormal = normalize((viewMatrix * modelMatrix * vec4(normal, 0)).xyz);
	vNormal = modelNormal;

	vec4 cameraSpacePosition = viewMatrix * modelMatrix * vec4(position, 1);
	vec4 cameraSpacePositionPrev = modelViewMatrixPrev * vec4(position, 1);

	vPosition = vec3(cameraSpacePosition);

	vClipPos = projectionMatrix * cameraSpacePosition;
	vClipPosPrev = projectionMatrix * cameraSpacePositionPrev;

	gl_Position = vClipPos;
}
