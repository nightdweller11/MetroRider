#include <versionPrecision>

in vec3 position;

#ifdef MULTI_DRAW_ENABLED
struct TileDepthData {
	mat4 modelViewMatrix;
};

uniform PerMeshArray {
	TileDepthData tiles[MAX_BATCH_SIZE];
};
#else
uniform PerMesh {
	mat4 modelViewMatrix;
};
#endif

uniform PerMaterial {
	mat4 projectionMatrix;
};

void main() {
#ifdef MULTI_DRAW_ENABLED
	mat4 mvMatrix = tiles[gl_DrawID].modelViewMatrix;
#else
	mat4 mvMatrix = modelViewMatrix;
#endif

	vec3 transformedPosition = position;
	vec4 cameraSpacePosition = mvMatrix * vec4(transformedPosition, 1.0);

	gl_Position = projectionMatrix * cameraSpacePosition;
}
