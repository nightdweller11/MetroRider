/**
 * Tests for corridor clearing logic: pointToSegmentDist and building filtering.
 * These replicate the logic from WorkerInstance to test independently.
 */

function pointToSegmentDist(
	px: number, pz: number,
	ax: number, az: number,
	bx: number, bz: number,
): number {
	const dx = bx - ax, dz = bz - az;
	const lenSq = dx * dx + dz * dz;
	if (lenSq < 1e-10) {
		return Math.sqrt((px - ax) ** 2 + (pz - az) ** 2);
	}
	const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
	const projX = ax + t * dx, projZ = az + t * dz;
	return Math.sqrt((px - projX) ** 2 + (pz - projZ) ** 2);
}

interface CorridorSegment {
	x1: number; z1: number;
	x2: number; z2: number;
	radius: number;
}

interface MockFeature {
	boundingBox: {
		min: {x: number; z: number};
		max: {x: number; z: number};
	};
}

function filterFeatures(
	features: MockFeature[],
	segments: CorridorSegment[],
	tileOffsetX: number,
	tileOffsetY: number,
): MockFeature[] {
	return features.filter(feature => {
		const bb = feature.boundingBox;
		const centerX = (bb.min.x + bb.max.x) / 2 + tileOffsetX;
		const centerZ = (bb.min.z + bb.max.z) / 2 + tileOffsetY;

		for (const seg of segments) {
			if (pointToSegmentDist(centerX, centerZ, seg.x1, seg.z1, seg.x2, seg.z2) < seg.radius) {
				return false;
			}
		}
		return true;
	});
}

describe('pointToSegmentDist', () => {
	test('point on segment returns 0', () => {
		expect(pointToSegmentDist(5, 0, 0, 0, 10, 0)).toBeCloseTo(0, 5);
	});

	test('point at segment endpoint returns 0', () => {
		expect(pointToSegmentDist(0, 0, 0, 0, 10, 0)).toBeCloseTo(0, 5);
		expect(pointToSegmentDist(10, 0, 0, 0, 10, 0)).toBeCloseTo(0, 5);
	});

	test('point perpendicular to horizontal segment', () => {
		expect(pointToSegmentDist(5, 3, 0, 0, 10, 0)).toBeCloseTo(3, 5);
	});

	test('point perpendicular to vertical segment', () => {
		expect(pointToSegmentDist(4, 5, 0, 0, 0, 10)).toBeCloseTo(4, 5);
	});

	test('point beyond segment end projects to endpoint', () => {
		const dist = pointToSegmentDist(15, 0, 0, 0, 10, 0);
		expect(dist).toBeCloseTo(5, 5);
	});

	test('point beyond segment start projects to start', () => {
		const dist = pointToSegmentDist(-3, 4, 0, 0, 10, 0);
		expect(dist).toBeCloseTo(5, 5);
	});

	test('degenerate segment (zero length) returns point distance', () => {
		expect(pointToSegmentDist(3, 4, 5, 5, 5, 5)).toBeCloseTo(
			Math.sqrt((3 - 5) ** 2 + (4 - 5) ** 2), 5,
		);
	});

	test('diagonal segment', () => {
		const dist = pointToSegmentDist(0, 1, 0, 0, 1, 1);
		expect(dist).toBeCloseTo(Math.sqrt(2) / 2, 4);
	});
});

describe('corridor clearing (feature filtering)', () => {
	const makeFeature = (cx: number, cz: number, size = 10): MockFeature => ({
		boundingBox: {
			min: {x: cx - size / 2, z: cz - size / 2},
			max: {x: cx + size / 2, z: cz + size / 2},
		},
	});

	test('no segments means no features removed', () => {
		const features = [makeFeature(100, 100), makeFeature(200, 200)];
		const result = filterFeatures(features, [], 0, 0);
		expect(result).toHaveLength(2);
	});

	test('feature on corridor path is removed', () => {
		const features = [makeFeature(50, 0)];
		const segments: CorridorSegment[] = [{x1: 0, z1: 0, x2: 100, z2: 0, radius: 25}];
		const result = filterFeatures(features, segments, 0, 0);
		expect(result).toHaveLength(0);
	});

	test('feature far from corridor is kept', () => {
		const features = [makeFeature(50, 100)];
		const segments: CorridorSegment[] = [{x1: 0, z1: 0, x2: 100, z2: 0, radius: 25}];
		const result = filterFeatures(features, segments, 0, 0);
		expect(result).toHaveLength(1);
	});

	test('feature near corridor but outside radius is kept', () => {
		const features = [makeFeature(50, 30)];
		const segments: CorridorSegment[] = [{x1: 0, z1: 0, x2: 100, z2: 0, radius: 25}];
		const result = filterFeatures(features, segments, 0, 0);
		expect(result).toHaveLength(1);
	});

	test('tile offset is applied correctly', () => {
		const features = [makeFeature(0, 0)];
		const segments: CorridorSegment[] = [{x1: 1000, z1: 2000, x2: 1100, z2: 2000, radius: 25}];
		const result = filterFeatures(features, segments, 1050, 2000);
		expect(result).toHaveLength(0);
	});

	test('multiple segments clear buildings along a path', () => {
		const features = [
			makeFeature(10, 0),
			makeFeature(60, 0),
			makeFeature(110, 0),
			makeFeature(50, 50),
		];
		const segments: CorridorSegment[] = [
			{x1: 0, z1: 0, x2: 50, z2: 0, radius: 25},
			{x1: 50, z1: 0, x2: 100, z2: 0, radius: 25},
		];
		const result = filterFeatures(features, segments, 0, 0);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe(features[3]);
	});
});
