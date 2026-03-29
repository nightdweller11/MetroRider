#include <versionPrecision>

in vec3 position;
in vec2 uv;
in vec3 normal;
in vec3 color;
in uint textureId;
in uint localId;
in uint display;

out vec3 vColor;
out vec2 vUv;
out vec3 vNormal;
out vec3 vPosition;
out vec4 vClipPos;
out vec4 vClipPosPrev;
flat out int vTextureId;
flat out uint vObjectId;

#ifdef MULTI_DRAW_ENABLED
struct TileData {
    mat4 modelViewMatrix;
    mat4 modelViewMatrixPrev;
    uint tileId;
};

uniform PerMeshArray {
    TileData tiles[MAX_BATCH_SIZE];
};
#else
uniform PerMesh {
    mat4 modelViewMatrix;
    mat4 modelViewMatrixPrev;
    uint tileId;
};
#endif

uniform PerMaterial {
    mat4 projectionMatrix;
    float windowLightThreshold;
};

void main() {
    if(display > 0u) {
        gl_Position = vec4(2, 0, 0, 1);
        return;
    }

#ifdef MULTI_DRAW_ENABLED
    mat4 mvMatrix = tiles[gl_DrawID].modelViewMatrix;
    mat4 mvMatrixPrev = tiles[gl_DrawID].modelViewMatrixPrev;
    uint tid = tiles[gl_DrawID].tileId;
#else
    mat4 mvMatrix = modelViewMatrix;
    mat4 mvMatrixPrev = modelViewMatrixPrev;
    uint tid = tileId;
#endif

    vColor = color;
    vNormal = vec3(mvMatrix * vec4(normal, 0));
    vUv = uv;
    vTextureId = int(textureId);
    vObjectId = (tid << 16u) + localId + 1u;

    vec3 transformedPosition = position;
    vec4 cameraSpacePosition = mvMatrix * vec4(transformedPosition, 1.);
    vec4 cameraSpacePositionPrev = mvMatrixPrev * vec4(transformedPosition, 1.0);

    vPosition = vec3(cameraSpacePosition);

    vClipPos = projectionMatrix * cameraSpacePosition;
    vClipPosPrev = projectionMatrix * cameraSpacePositionPrev;

    gl_Position = projectionMatrix * cameraSpacePosition;
}