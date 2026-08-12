#include <versionPrecision>

#define USE_YCOCG
#define REPROJECTION_SHARPNESS 0.5
#define USE_CATMULL_ROM_HISTORY_SAMPLING 1
// Variance-clip box size: history is clipped to mean ± GAMMA·stddev of the
// 3×3 neighborhood (Salvi variance clipping) instead of the raw min/max box.
// A raw min/max box swings violently on thin, high-contrast features (railing
// pixels, silhouette edges over streaming ground) as the TAA jitter changes
// which side of the edge the samples land on — the history gets re-clamped to
// a different box every frame and the edge visibly sizzles. The statistical
// box stays centred on the neighborhood mean, so converged history survives
// jitter phase changes. Measured on the moving train (side view, 45 m/s):
// body-crop per-frame pixel churn dropped from ~2× the no-TAA baseline to
// baseline level.
#define VARIANCE_CLIP_GAMMA 1.0

out vec4 FragColor;

in vec2 vUv;

uniform sampler2D tAccum;
uniform sampler2D tNew;
uniform sampler2D tMotion;

const int ignoreHistory = 0;

vec3 RGB_YCoCg(vec3 c) {
	// Y = R/4 + G/2 + B/4
	// Co = R/2 - B/2
	// Cg = -R/4 + G/2 - B/4
	return vec3(
		c.x / 4. + c.y / 2. + c.z / 4.,
		c.x / 2. - c.z / 2.,
		-c.x / 4. + c.y / 2. - c.z / 4.
	);
}

vec3 YCoCg_RGB(vec3 c) {
	// R = Y + Co - Cg
	// G = Y + Cg
	// B = Y - Co - Cg
	return clamp(vec3(
		c.x + c.y - c.z,
		c.x + c.z,
		c.x - c.y - c.z
	), vec3(0.0), vec3(1.0));
}

#include <sampleCatmullRom>

// Clip a color toward the AABB center (instead of per-channel clamp) so a
// rejected history sample keeps its hue while being pulled inside the box.
vec3 clipToAABB(vec3 color, vec3 minC, vec3 maxC) {
	vec3 center = 0.5 * (minC + maxC);
	vec3 extents = max(0.5 * (maxC - minC), vec3(1e-5));
	vec3 v = color - center;
	vec3 t = abs(v) / extents;
	float maxT = max(t.x, max(t.y, t.z));
	return maxT > 1.0 ? center + v / maxT : color;
}

const vec2 offsets[] = vec2[](
	vec2(1, 0),
	vec2(-1, 0),
	vec2(0, 1),
	vec2(0, -1),
	vec2(1, 1),
	vec2(-1, -1),
	vec2(-1, 1),
	vec2(1, -1)
);

void main() {
	vec2 size = vec2(textureSize(tNew, 0));
	vec4 velocity = texture(tMotion, vUv);
    vec2 oldUV = vUv - velocity.xy;

    vec4 newSample = texture(tNew, vUv);

	#if USE_CATMULL_ROM_HISTORY_SAMPLING == 1
		vec4 accumSample = sampleCatmullRom(tAccum, oldUV, vec2(textureSize(tAccum, 0)));
	#else
		vec4 accumSample = texture(tAccum, oldUV);
	#endif

    #ifdef USE_YCOCG
        accumSample.rgb = RGB_YCoCg(accumSample.rgb);
        newSample.rgb = RGB_YCoCg(newSample.rgb);
    #endif

	if(ignoreHistory == 1) {
		FragColor = newSample;
		return;
	}

	// First + second moments of the 3×3 neighborhood → variance-clip box.
	vec3 m1 = newSample.rgb;
	vec3 m2 = newSample.rgb * newSample.rgb;
	float maxAlpha = newSample.a;
	float minAlpha = newSample.a;

	for(int i = 0; i < 8; i++) {
		vec2 neighborUv = vUv + offsets[i] / size;
		vec4 neighborTexel = texture(tNew, neighborUv);

        #ifdef USE_YCOCG
            neighborTexel.rgb = RGB_YCoCg(neighborTexel.rgb);
        #endif

		m1 += neighborTexel.rgb;
		m2 += neighborTexel.rgb * neighborTexel.rgb;
		maxAlpha = max(maxAlpha, neighborTexel.a);
		minAlpha = min(minAlpha, neighborTexel.a);
	}

	vec3 mu = m1 / 9.0;
	vec3 sigma = sqrt(max(m2 / 9.0 - mu * mu, vec3(0.0)));
	vec3 boxMin = mu - VARIANCE_CLIP_GAMMA * sigma;
	vec3 boxMax = mu + VARIANCE_CLIP_GAMMA * sigma;

	accumSample.rgb = clipToAABB(accumSample.rgb, boxMin, boxMax);
	accumSample.a = clamp(accumSample.a, minAlpha, maxAlpha);

	float mixFactor = 0.1;

	if (accumSample.a == 0. && newSample.a == 0.) {
		// Disable TAA for skybox
		mixFactor = 1.;
	}

	bool a = any(greaterThan(oldUV, vec2(1)));
	bool b = any(lessThan(oldUV, vec2(0)));

	if(a || b) {
		mixFactor = 1.;
	}

	FragColor = mix(accumSample, newSample, mixFactor);

    #ifdef USE_YCOCG
        FragColor.rgb = YCoCg_RGB(FragColor.rgb);
    #endif
}