#include <versionPrecision>

in vec3 position;

uniform PerMesh {
	mat4 modelViewMatrix;
};

uniform PerMaterial {
	mat4 projectionMatrix;
};

void main() {
	vec4 cameraSpacePosition = modelViewMatrix * vec4(position, 1.0);
	gl_Position = projectionMatrix * cameraSpacePosition;
}
