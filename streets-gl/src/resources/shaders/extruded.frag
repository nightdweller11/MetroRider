#include <versionPrecision>
#include <gBufferOut>

#define WINDOW_GLOW_COLOR vec3(1, 0.9, 0.7)

in vec3 vColor;
in vec2 vUv;
in vec3 vNormal;
in vec3 vPosition;
flat in int vTextureId;
flat in uint vObjectId;
in vec4 vClipPos;
in vec4 vClipPosPrev;

uniform PerMesh {
    mat4 modelViewMatrix;
    mat4 modelViewMatrixPrev;
    uint tileId;
};

uniform PerMaterial {
    mat4 projectionMatrix;
    float windowLightThreshold;
};

uniform sampler2DArray tMap;
uniform sampler2D tNoise;

#include <packNormal>
#include <getMotionVector>
#include <getTBN>

vec4 getColorValueUV(int textureId, float mask, vec3 tintColor, vec2 uv) {
    vec3 color = mix(vec3(1), tintColor, mask);
    return texture(tMap, vec3(uv, textureId * 4)) * vec4(color, 1);
}

vec3 getMaskValueUV(int textureId, vec2 uv) {
    return texture(tMap, vec3(uv, textureId * 4 + 2)).xyz;
}

vec3 getGlowColorUV(int textureId, vec2 uv) {
    return texture(tMap, vec3(uv, textureId * 4 + 3)).xyz;
}

vec3 getNormalValueUV(int textureId, vec2 uv, mat3 tbn) {
    vec3 mapValue = texture(tMap, vec3(uv, textureId * 4 + 1)).xyz * 2. - 1.;
    vec3 normal = normalize(tbn * mapValue);
    normal *= float(gl_FrontFacing) * 2. - 1.;
    return normal;
}

void main() {
    mat3 tbn = getTBN(vNormal, vPosition, vec2(vUv.x, 1. - vUv.y));
    vec2 uv = vUv;

    vec3 glowCheck = texture(tMap, vec3(vUv, vTextureId * 4 + 3)).xyz;
    float windowFactor = clamp(dot(glowCheck, vec3(1.0)) * 10.0, 0.0, 1.0);

    if (windowFactor > 0.01) {
        vec3 viewDirTS = normalize(transpose(tbn) * normalize(-vPosition));
        float depth = 0.04;
        uv = vUv - viewDirTS.xy * depth / max(viewDirTS.z, 0.3) * windowFactor;
    }

    vec3 mask = getMaskValueUV(vTextureId, uv);
    float noiseTextureWidth = vec2(textureSize(tNoise, 0)).r;

    vec2 windowUV = vec2(
        floor((uv.x + (floor(uv.y) * 3.)) * 0.25),
        uv.y
    ) / noiseTextureWidth;
    float windowNoise = texture(tNoise, windowUV).r;
    float glowFactor = 1.;
    float threshold = 1. - windowLightThreshold * 0.5;

    if (windowNoise <= threshold) {
        glowFactor = 0.;
    } else {
        glowFactor = fract(windowNoise * 10.) * 0.6 + 0.4;
    }

    vec4 baseColor = getColorValueUV(vTextureId, mask.b, vColor, uv);

    if (vTextureId >= 12) {
        float noiseTexW = vec2(textureSize(tNoise, 0)).r;
        vec2 weatherUV = vPosition.xz * 0.002;
        float macroNoise = texture(tNoise, weatherUV / noiseTexW).r;

        float streakNoise = texture(tNoise, vec2(uv.x * 3.7, uv.y * 0.12) / noiseTexW).r;
        float floorFrac = fract(uv.y);
        float streakIntensity = smoothstep(0.85, 1.0, floorFrac) * streakNoise * 0.15;

        float groundGrime = smoothstep(0.8, 0.0, uv.y) * 0.08;

        float macroVariation = (macroNoise - 0.5) * 0.06;

        float weathering = clamp(streakIntensity + groundGrime + macroVariation, -0.05, 0.2);
        baseColor.rgb *= (1.0 - weathering);
        baseColor.rgb = mix(baseColor.rgb, baseColor.rgb * vec3(0.95, 0.93, 0.88), weathering * 2.0);
    }

    outColor = baseColor;
    outGlow = getGlowColorUV(vTextureId, uv) * WINDOW_GLOW_COLOR * glowFactor;
    outNormal = packNormal(getNormalValueUV(vTextureId, uv, tbn));
    outRoughnessMetalnessF0 = vec3(mask.r, mask.g, 0.03);
    outMotion = getMotionVector(vClipPos, vClipPosPrev);
    outObjectId = vObjectId;
}