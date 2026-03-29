#include <versionPrecision>

in vec3 position;
in vec2 uv;
in vec3 normal;
in uint textureId;

out vec2 vUv;
flat out int vTextureId;

#ifdef MULTI_DRAW_ENABLED
struct TileProjectedDepthData {
	mat4 modelViewMatrix;
	mat4 modelViewMatrixPrev;
	float terrainRingSize;
	vec4 terrainRingOffset;
	int terrainLevelId;
	float segmentCount;
};

uniform PerMeshArray {
	TileProjectedDepthData tiles[MAX_BATCH_SIZE];
};
#else
uniform PerMesh {
	mat4 modelViewMatrix;
	mat4 modelViewMatrixPrev;
	float terrainRingSize;
	vec4 terrainRingOffset;
	int terrainLevelId;
	float segmentCount;
};
#endif

uniform PerMaterial {
	mat4 projectionMatrix;
	float time;
};

uniform sampler2DArray tRingHeight;

float sampleHeight(vec2 uv, int level, float sc) {
	uv.y = 1. - uv.y;

	return texelFetch(
		tRingHeight,
		ivec3(
			uv * sc + 0.5 / sc,
			level
		),
		0
	).r;
}

void main() {
#ifdef MULTI_DRAW_ENABLED
	mat4 mvMatrix = tiles[gl_DrawID].modelViewMatrix;
	mat4 mvMatrixPrev = tiles[gl_DrawID].modelViewMatrixPrev;
	float tRingSize = tiles[gl_DrawID].terrainRingSize;
	vec4 tRingOffset = tiles[gl_DrawID].terrainRingOffset;
	int tLevelId = tiles[gl_DrawID].terrainLevelId;
	float tSegCount = tiles[gl_DrawID].segmentCount;
#else
	mat4 mvMatrix = modelViewMatrix;
	mat4 mvMatrixPrev = modelViewMatrixPrev;
	float tRingSize = terrainRingSize;
	vec4 tRingOffset = terrainRingOffset;
	int tLevelId = terrainLevelId;
	float tSegCount = segmentCount;
#endif

	vUv = uv;
	vTextureId = int(textureId);

	int level = tLevelId;
	vec2 positionUV = (tRingOffset.xy + tRingSize / 2. + position.xz) / tRingSize;

	if (positionUV.x < 0. || positionUV.y < 0. || positionUV.x > 1. || positionUV.y > 1.) {
		float nextSize = tRingSize * 2.;
		positionUV = (tRingOffset.zw + nextSize / 2. + position.xz) / nextSize;
		level++;
	}

	#if USE_HEIGHT == 1
		float segSize = 1. / tSegCount;
		vec2 segment = floor(positionUV * tSegCount);
		vec2 segmentUV = positionUV * tSegCount - segment;
		vec2 originUV = segment * segSize;
		vec2 segmentLocal = segmentUV;
		float type = mod(segment.x + segment.y, 2.);

		vec2 a, b, c;

		if (type == 0.) {
			if (segmentUV.x > segmentUV.y) {
				a = originUV + segSize * vec2(1, 0);
				b = originUV;
				c = originUV + segSize * vec2(1, 1);
				segmentLocal.x = 1. - segmentLocal.x;
			} else {
				a = originUV + segSize * vec2(0, 1);
				b = originUV + segSize * vec2(1, 1);
				c = originUV;
				segmentLocal.y = 1. - segmentLocal.y;
			}
		} else {
			if (segmentUV.x + segmentUV.y < 1.) {
				a = originUV;
				b = originUV + segSize * vec2(1, 0);
				c = originUV + segSize * vec2(0, 1);
			} else {
				a = originUV + segSize * vec2(1, 1);
				b = originUV + segSize * vec2(0, 1);
				c = originUV + segSize * vec2(1, 0);
				segmentLocal = 1. - segmentLocal;
			}
		}

		float ah = sampleHeight(a, level, tSegCount);
		float bh = sampleHeight(b, level, tSegCount);
		float ch = sampleHeight(c, level, tSegCount);
		float height = ah + (bh - ah) * segmentLocal.x + (ch - ah) * segmentLocal.y;
	#else
		float height = 0.;
	#endif

	vec3 transformedPosition = position + vec3(0, height, 0);
	vec4 cameraSpacePosition = mvMatrix * vec4(transformedPosition, 1);
	vec4 cameraSpacePositionPrev = mvMatrixPrev * vec4(transformedPosition, 1);

	gl_Position = projectionMatrix * cameraSpacePosition;
}
