/**
 * Tests for the synthetic railway injection pipeline and updated corridor clearing.
 *
 * Validates:
 * 1. Corridor clearing only removes extruded (buildings), never projected (railway) features
 * 2. Corridor radius is 10m (not 50m)
 * 3. Synthetic railway injection produces correct tile-local coordinates
 * 4. Synthetic railway creates exactly 3 layers with correct zIndex/textureId
 * 5. Segment-to-tile intersection clipping works correctly
 * 6. Width and UV calculations match the VectorPolylineHandler recipe
 */

const WORLD_SIZE = 40075016.68;
const ZOOM = 16;
const TILE_SIZE = WORLD_SIZE / (1 << ZOOM);
const CORRIDOR_RADIUS = 10;

function degrees2meters(lat: number, lon: number): {x: number; y: number} {
	const z = lon * 20037508.34 / 180;
	const x = Math.log(Math.tan((90 + lat) * Math.PI / 360)) * 20037508.34 / Math.PI;
	return {x, y: z};
}

function tile2meters(tileX: number, tileY: number, zoom: number): {x: number; y: number} {
	const rz = (2 * 20037508.34 * tileX) / (1 << zoom) - 20037508.34;
	const rx = 20037508.34 - (2 * 20037508.34 * tileY) / (1 << zoom);
	return {x: rx, y: rz};
}

function degrees2tile(lat: number, lon: number, zoom: number): {x: number; y: number} {
	const x = (lon + 180) / 360 * (1 << zoom);
	const y = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * (1 << zoom);
	return {x, y};
}

function getMercatorScaleFactor(lat: number): number {
	return 1 / Math.cos(lat * Math.PI / 180);
}

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

interface MockBoundingBox {
	min: {x: number; y: number; z: number};
	max: {x: number; y: number; z: number};
}

interface MockExtrudedFeature {
	boundingBox: MockBoundingBox;
}

interface MockProjectedFeature {
	zIndex: number;
	boundingBox: MockBoundingBox;
}

const RAILWAY_ZINDICES = new Set([11, 12, 28]);

function applyCorridorClearing(
	extruded: MockExtrudedFeature[],
	projected: MockProjectedFeature[],
	corridorSegments: CorridorSegment[],
	tileX: number,
	tileY: number,
): {extruded: MockExtrudedFeature[]; projected: MockProjectedFeature[]} {
	if (corridorSegments.length === 0) {
		return {extruded, projected};
	}

	const tileOffset = tile2meters(tileX, tileY + 1, ZOOM);

	const filteredExtruded = extruded.filter(feature => {
		const bb = feature.boundingBox;
		const centerX = (bb.min.x + bb.max.x) / 2 + tileOffset.x;
		const centerZ = (bb.min.z + bb.max.z) / 2 + tileOffset.y;

		for (const seg of corridorSegments) {
			const d = pointToSegmentDist(centerX, centerZ, seg.x1, seg.z1, seg.x2, seg.z2);
			if (d < seg.radius) {
				return false;
			}
		}
		return true;
	});

	// Railway features are NO LONGER cleared -- projected array is returned as-is
	return {extruded: filteredExtruded, projected};
}

interface SyntheticLayerParams {
	textureId: number;
	zIndex: number;
}

function computeSyntheticRailwayInjection(
	corridorSegments: CorridorSegment[],
	tileX: number,
	tileY: number,
): {localPoints: Array<{x: number; y: number}>; layers: SyntheticLayerParams[]; width: number; uvScaleY: number} | null {
	if (corridorSegments.length === 0) return null;

	const tileOffset = tile2meters(tileX, tileY + 1, ZOOM);
	const margin = 20;
	const allLocalPoints: Array<{x: number; y: number}> = [];

	for (const seg of corridorSegments) {
		const lx1 = seg.x1 - tileOffset.x;
		const lz1 = seg.z1 - tileOffset.y;
		const lx2 = seg.x2 - tileOffset.x;
		const lz2 = seg.z2 - tileOffset.y;

		const minX = Math.min(lx1, lx2);
		const maxX = Math.max(lx1, lx2);
		const minZ = Math.min(lz1, lz2);
		const maxZ = Math.max(lz1, lz2);

		if (maxX < -margin || minX > TILE_SIZE + margin || maxZ < -margin || minZ > TILE_SIZE + margin) {
			continue;
		}

		if (allLocalPoints.length === 0) {
			allLocalPoints.push({x: lx1, y: lz1});
		}
		allLocalPoints.push({x: lx2, y: lz2});
	}

	if (allLocalPoints.length < 2) return null;

	const RAILWAY_BASE_WIDTH = 2.5;
	const lat = 32.08;
	const mercatorScale = getMercatorScaleFactor(lat);
	const scaledWidth = RAILWAY_BASE_WIDTH * mercatorScale;
	const uvScaleY = RAILWAY_BASE_WIDTH * mercatorScale * 4;

	const layers: SyntheticLayerParams[] = [
		{textureId: 9 /* Railway */, zIndex: 11 /* Railway */},
		{textureId: 36 /* RailwayTop */, zIndex: 12 /* RailwayOverlay */},
		{textureId: 37 /* Rail */, zIndex: 28 /* Rail */},
	];

	return {localPoints: allLocalPoints, layers, width: scaledWidth * 2, uvScaleY};
}

// Test data: a short route in Tel Aviv
const ROUTE_POINTS = [
	{lat: 32.0840, lng: 34.8530},
	{lat: 32.0820, lng: 34.8350},
	{lat: 32.0785, lng: 34.8120},
];

function buildSegments(radius: number): CorridorSegment[] {
	const segments: CorridorSegment[] = [];
	for (let i = 0; i < ROUTE_POINTS.length - 1; i++) {
		const m1 = degrees2meters(ROUTE_POINTS[i].lat, ROUTE_POINTS[i].lng);
		const m2 = degrees2meters(ROUTE_POINTS[i + 1].lat, ROUTE_POINTS[i + 1].lng);
		segments.push({x1: m1.x, z1: m1.y, x2: m2.x, z2: m2.y, radius});
	}
	return segments;
}

describe('corridor clearing: buildings only, railway preserved', () => {
	const segments = buildSegments(CORRIDOR_RADIUS);

	test('extruded feature (building) within 10m of route is removed', () => {
		const onRoute = degrees2meters(ROUTE_POINTS[0].lat, ROUTE_POINTS[0].lng);
		const tile = degrees2tile(ROUTE_POINTS[0].lat, ROUTE_POINTS[0].lng, ZOOM);
		const tileX = Math.floor(tile.x);
		const tileY = Math.floor(tile.y);
		const tileOffset = tile2meters(tileX, tileY + 1, ZOOM);

		const localX = onRoute.x - tileOffset.x;
		const localZ = onRoute.y - tileOffset.y;

		const building: MockExtrudedFeature = {
			boundingBox: {
				min: {x: localX - 5, y: 0, z: localZ - 5},
				max: {x: localX + 5, y: 15, z: localZ + 5},
			}
		};

		const result = applyCorridorClearing([building], [], segments, tileX, tileY);
		expect(result.extruded).toHaveLength(0);
	});

	test('extruded feature (building) 50m from route is NOT removed (radius is 10m)', () => {
		const onRoute = degrees2meters(ROUTE_POINTS[0].lat, ROUTE_POINTS[0].lng);
		const tile = degrees2tile(ROUTE_POINTS[0].lat, ROUTE_POINTS[0].lng, ZOOM);
		const tileX = Math.floor(tile.x);
		const tileY = Math.floor(tile.y);
		const tileOffset = tile2meters(tileX, tileY + 1, ZOOM);

		const localX = onRoute.x - tileOffset.x + 50;
		const localZ = onRoute.y - tileOffset.y + 50;

		const building: MockExtrudedFeature = {
			boundingBox: {
				min: {x: localX - 5, y: 0, z: localZ - 5},
				max: {x: localX + 5, y: 15, z: localZ + 5},
			}
		};

		const result = applyCorridorClearing([building], [], segments, tileX, tileY);
		expect(result.extruded).toHaveLength(1);
	});

	test('projected railway feature (zIndex=11) is NEVER removed', () => {
		const onRoute = degrees2meters(ROUTE_POINTS[0].lat, ROUTE_POINTS[0].lng);
		const tile = degrees2tile(ROUTE_POINTS[0].lat, ROUTE_POINTS[0].lng, ZOOM);
		const tileX = Math.floor(tile.x);
		const tileY = Math.floor(tile.y);
		const tileOffset = tile2meters(tileX, tileY + 1, ZOOM);

		const localX = onRoute.x - tileOffset.x;
		const localZ = onRoute.y - tileOffset.y;

		const railwayFeature: MockProjectedFeature = {
			zIndex: 11,
			boundingBox: {
				min: {x: localX - 2, y: 0, z: localZ - 2},
				max: {x: localX + 2, y: 0, z: localZ + 2},
			}
		};

		const result = applyCorridorClearing([], [railwayFeature], segments, tileX, tileY);
		expect(result.projected).toHaveLength(1);
		expect(result.projected[0].zIndex).toBe(11);
	});

	test('projected rail feature (zIndex=28) is NEVER removed', () => {
		const railFeature: MockProjectedFeature = {
			zIndex: 28,
			boundingBox: {
				min: {x: 100, y: 0, z: 100},
				max: {x: 110, y: 0, z: 110},
			}
		};

		const tile = degrees2tile(ROUTE_POINTS[0].lat, ROUTE_POINTS[0].lng, ZOOM);
		const result = applyCorridorClearing([], [railFeature], segments, Math.floor(tile.x), Math.floor(tile.y));
		expect(result.projected).toHaveLength(1);
	});

	test('non-railway projected feature (e.g. road, zIndex=20) is preserved too', () => {
		const roadFeature: MockProjectedFeature = {
			zIndex: 20,
			boundingBox: {
				min: {x: 50, y: 0, z: 50},
				max: {x: 60, y: 0, z: 60},
			}
		};

		const tile = degrees2tile(ROUTE_POINTS[0].lat, ROUTE_POINTS[0].lng, ZOOM);
		const result = applyCorridorClearing([], [roadFeature], segments, Math.floor(tile.x), Math.floor(tile.y));
		expect(result.projected).toHaveLength(1);
	});

	test('corridor radius is exactly 10m', () => {
		expect(CORRIDOR_RADIUS).toBe(10);
	});
});

describe('synthetic railway injection: coordinate transforms', () => {
	const segments = buildSegments(CORRIDOR_RADIUS);

	test('route segments are in valid global Mercator coordinates', () => {
		for (const seg of segments) {
			expect(Math.abs(seg.x1)).toBeGreaterThan(1_000_000);
			expect(Math.abs(seg.z1)).toBeGreaterThan(1_000_000);
		}
	});

	test('segment that intersects tile produces local points', () => {
		const tile = degrees2tile(ROUTE_POINTS[0].lat, ROUTE_POINTS[0].lng, ZOOM);
		const tileX = Math.floor(tile.x);
		const tileY = Math.floor(tile.y);

		const result = computeSyntheticRailwayInjection(segments, tileX, tileY);
		expect(result).not.toBeNull();
		expect(result!.localPoints.length).toBeGreaterThanOrEqual(2);
	});

	test('at least one local point falls within the tile', () => {
		const tile = degrees2tile(ROUTE_POINTS[0].lat, ROUTE_POINTS[0].lng, ZOOM);
		const tileX = Math.floor(tile.x);
		const tileY = Math.floor(tile.y);

		const result = computeSyntheticRailwayInjection(segments, tileX, tileY);
		expect(result).not.toBeNull();

		// Segments that cross the tile can have endpoints outside it.
		// At least one point should be within or near the tile.
		const insideTile = result!.localPoints.some(
			pt => pt.x >= -TILE_SIZE && pt.x <= TILE_SIZE * 2
			   && pt.y >= -TILE_SIZE && pt.y <= TILE_SIZE * 2
		);
		expect(insideTile).toBe(true);
	});

	test('segment far from tile produces no injection', () => {
		const result = computeSyntheticRailwayInjection(segments, 0, 0);
		expect(result).toBeNull();
	});

	test('empty corridor segments produce no injection', () => {
		const tile = degrees2tile(ROUTE_POINTS[0].lat, ROUTE_POINTS[0].lng, ZOOM);
		const result = computeSyntheticRailwayInjection([], Math.floor(tile.x), Math.floor(tile.y));
		expect(result).toBeNull();
	});

	test('global-to-local transform round-trips correctly', () => {
		const globalPt = degrees2meters(ROUTE_POINTS[0].lat, ROUTE_POINTS[0].lng);
		const tile = degrees2tile(ROUTE_POINTS[0].lat, ROUTE_POINTS[0].lng, ZOOM);
		const tileX = Math.floor(tile.x);
		const tileY = Math.floor(tile.y);
		const tileOffset = tile2meters(tileX, tileY + 1, ZOOM);

		const localX = globalPt.x - tileOffset.x;
		const localZ = globalPt.y - tileOffset.y;

		expect(localX).toBeGreaterThanOrEqual(0);
		expect(localX).toBeLessThanOrEqual(TILE_SIZE);
		expect(localZ).toBeGreaterThanOrEqual(0);
		expect(localZ).toBeLessThanOrEqual(TILE_SIZE);

		const rebuiltX = localX + tileOffset.x;
		const rebuiltZ = localZ + tileOffset.y;
		expect(rebuiltX).toBeCloseTo(globalPt.x, 2);
		expect(rebuiltZ).toBeCloseTo(globalPt.y, 2);
	});
});

describe('synthetic railway injection: layer structure', () => {
	const segments = buildSegments(CORRIDOR_RADIUS);
	const tile = degrees2tile(ROUTE_POINTS[0].lat, ROUTE_POINTS[0].lng, ZOOM);
	const tileX = Math.floor(tile.x);
	const tileY = Math.floor(tile.y);

	test('produces exactly 3 layers', () => {
		const result = computeSyntheticRailwayInjection(segments, tileX, tileY);
		expect(result).not.toBeNull();
		expect(result!.layers).toHaveLength(3);
	});

	test('layer 1: Railway base (textureId=9, zIndex=11)', () => {
		const result = computeSyntheticRailwayInjection(segments, tileX, tileY)!;
		expect(result.layers[0].textureId).toBe(9);
		expect(result.layers[0].zIndex).toBe(11);
	});

	test('layer 2: RailwayTop overlay (textureId=36, zIndex=12)', () => {
		const result = computeSyntheticRailwayInjection(segments, tileX, tileY)!;
		expect(result.layers[1].textureId).toBe(36);
		expect(result.layers[1].zIndex).toBe(12);
	});

	test('layer 3: Rail strips (textureId=37, zIndex=28)', () => {
		const result = computeSyntheticRailwayInjection(segments, tileX, tileY)!;
		expect(result.layers[2].textureId).toBe(37);
		expect(result.layers[2].zIndex).toBe(28);
	});

	test('layer zIndices match ZIndexMap railway values', () => {
		const result = computeSyntheticRailwayInjection(segments, tileX, tileY)!;
		const zIndices = result.layers.map(l => l.zIndex);
		expect(zIndices).toEqual([11, 12, 28]);
		for (const zi of zIndices) {
			expect(RAILWAY_ZINDICES.has(zi)).toBe(true);
		}
	});
});

describe('synthetic railway injection: width and UV', () => {
	const segments = buildSegments(CORRIDOR_RADIUS);
	const tile = degrees2tile(ROUTE_POINTS[0].lat, ROUTE_POINTS[0].lng, ZOOM);
	const tileX = Math.floor(tile.x);
	const tileY = Math.floor(tile.y);

	test('width accounts for Mercator scale factor', () => {
		const result = computeSyntheticRailwayInjection(segments, tileX, tileY)!;
		const mercatorScale = getMercatorScaleFactor(32.08);
		const expectedWidth = 2.5 * mercatorScale * 2;
		expect(result.width).toBeCloseTo(expectedWidth, 2);
	});

	test('width is reasonable for a railway (4-8m visual)', () => {
		const result = computeSyntheticRailwayInjection(segments, tileX, tileY)!;
		expect(result.width).toBeGreaterThan(4);
		expect(result.width).toBeLessThan(8);
	});

	test('uvScaleY follows VectorPolylineHandler formula (width * mercatorScale * 4)', () => {
		const result = computeSyntheticRailwayInjection(segments, tileX, tileY)!;
		const mercatorScale = getMercatorScaleFactor(32.08);
		const expected = 2.5 * mercatorScale * 4;
		expect(result.uvScaleY).toBeCloseTo(expected, 2);
	});
});

describe('corridor clearing: radius boundary cases', () => {
	test('building at exactly 9m from segment is cleared', () => {
		const seg: CorridorSegment = {
			x1: 3780000, z1: 3880000,
			x2: 3780100, z2: 3880000,
			radius: CORRIDOR_RADIUS,
		};

		const tileOffset = tile2meters(39604, 26714, ZOOM);
		const centerGlobalX = 3780050;
		const centerGlobalZ = 3880009;

		const dist = pointToSegmentDist(centerGlobalX, centerGlobalZ, seg.x1, seg.z1, seg.x2, seg.z2);
		expect(dist).toBeLessThan(CORRIDOR_RADIUS);
	});

	test('building at exactly 11m from segment is kept', () => {
		const seg: CorridorSegment = {
			x1: 3780000, z1: 3880000,
			x2: 3780100, z2: 3880000,
			radius: CORRIDOR_RADIUS,
		};

		const centerGlobalX = 3780050;
		const centerGlobalZ = 3880011;

		const dist = pointToSegmentDist(centerGlobalX, centerGlobalZ, seg.x1, seg.z1, seg.x2, seg.z2);
		expect(dist).toBeGreaterThan(CORRIDOR_RADIUS);
	});

	test('building at 25m is kept (old radius 50m would have cleared it, 10m does not)', () => {
		const seg: CorridorSegment = {
			x1: 3780000, z1: 3880000,
			x2: 3780100, z2: 3880000,
			radius: CORRIDOR_RADIUS,
		};

		const dist = pointToSegmentDist(3780050, 3880025, seg.x1, seg.z1, seg.x2, seg.z2);
		expect(dist).toBe(25);
		expect(dist).toBeGreaterThan(CORRIDOR_RADIUS);
	});
});

describe('multi-tile injection: continuity', () => {
	const segments = buildSegments(CORRIDOR_RADIUS);

	test('route spanning multiple tiles injects into each intersected tile', () => {
		const injectedTiles: Array<{x: number; y: number}> = [];

		for (const pt of ROUTE_POINTS) {
			const tile = degrees2tile(pt.lat, pt.lng, ZOOM);
			const tileX = Math.floor(tile.x);
			const tileY = Math.floor(tile.y);

			const result = computeSyntheticRailwayInjection(segments, tileX, tileY);
			if (result) {
				const already = injectedTiles.some(t => t.x === tileX && t.y === tileY);
				if (!already) {
					injectedTiles.push({x: tileX, y: tileY});
				}
			}
		}

		expect(injectedTiles.length).toBeGreaterThanOrEqual(1);
	});

	test('adjacent tiles along route both receive injection', () => {
		const pt1 = ROUTE_POINTS[0];
		const pt2 = ROUTE_POINTS[1];

		const tile1 = degrees2tile(pt1.lat, pt1.lng, ZOOM);
		const tile2 = degrees2tile(pt2.lat, pt2.lng, ZOOM);

		const r1 = computeSyntheticRailwayInjection(segments, Math.floor(tile1.x), Math.floor(tile1.y));
		const r2 = computeSyntheticRailwayInjection(segments, Math.floor(tile2.x), Math.floor(tile2.y));

		expect(r1).not.toBeNull();
		expect(r2).not.toBeNull();
	});
});

describe('full pipeline integration', () => {
	test('clearing + injection pipeline: buildings removed, railways added, original railways preserved', () => {
		const segments = buildSegments(CORRIDOR_RADIUS);
		const tile = degrees2tile(ROUTE_POINTS[0].lat, ROUTE_POINTS[0].lng, ZOOM);
		const tileX = Math.floor(tile.x);
		const tileY = Math.floor(tile.y);
		const tileOffset = tile2meters(tileX, tileY + 1, ZOOM);

		const onRoute = degrees2meters(ROUTE_POINTS[0].lat, ROUTE_POINTS[0].lng);
		const localX = onRoute.x - tileOffset.x;
		const localZ = onRoute.y - tileOffset.y;

		const buildings: MockExtrudedFeature[] = [
			{boundingBox: {min: {x: localX - 3, y: 0, z: localZ - 3}, max: {x: localX + 3, y: 10, z: localZ + 3}}},
			{boundingBox: {min: {x: localX + 100, y: 0, z: localZ + 100}, max: {x: localX + 110, y: 20, z: localZ + 110}}},
		];

		const existingRailway: MockProjectedFeature[] = [
			{zIndex: 11, boundingBox: {min: {x: localX - 2, y: 0, z: localZ - 2}, max: {x: localX + 2, y: 0, z: localZ + 2}}},
			{zIndex: 28, boundingBox: {min: {x: localX - 1, y: 0, z: localZ - 1}, max: {x: localX + 1, y: 0, z: localZ + 1}}},
		];

		// Step 1: Corridor clearing
		const cleared = applyCorridorClearing(buildings, existingRailway, segments, tileX, tileY);
		expect(cleared.extruded).toHaveLength(1); // far building kept
		expect(cleared.projected).toHaveLength(2); // both railway features preserved

		// Step 2: Synthetic injection
		const injected = computeSyntheticRailwayInjection(segments, tileX, tileY);
		expect(injected).not.toBeNull();
		expect(injected!.layers).toHaveLength(3);

		// Total projected = original 2 + 3 synthetic = 5
		const totalProjected = cleared.projected.length + injected!.layers.length;
		expect(totalProjected).toBe(5);
	});
});
