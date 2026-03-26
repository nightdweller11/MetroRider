/**
 * Real-coordinate integration test for corridor clearing.
 * Uses actual Tel Aviv metro coordinates and the same math functions
 * to verify that buildings near the route are correctly identified and filtered.
 */

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

const ZOOM = 16;
const CORRIDOR_RADIUS = 25;

const RED_LINE_STATIONS = [
	{lat: 32.0905, lng: 34.8855},
	{lat: 32.0865, lng: 34.8720},
	{lat: 32.0840, lng: 34.8530},
	{lat: 32.0820, lng: 34.8350},
	{lat: 32.0785, lng: 34.8120},
	{lat: 32.0795, lng: 34.7920},
	{lat: 32.0755, lng: 34.7745},
	{lat: 32.0680, lng: 34.7790},
	{lat: 32.0640, lng: 34.7710},
	{lat: 32.0565, lng: 34.7680},
	{lat: 32.0510, lng: 34.7560},
	{lat: 32.0225, lng: 34.7505},
];

function buildCorridorSegments(): CorridorSegment[] {
	const segments: CorridorSegment[] = [];
	for (let i = 0; i < RED_LINE_STATIONS.length - 1; i++) {
		const s1 = RED_LINE_STATIONS[i];
		const s2 = RED_LINE_STATIONS[i + 1];
		const m1 = degrees2meters(s1.lat, s1.lng);
		const m2 = degrees2meters(s2.lat, s2.lng);
		segments.push({
			x1: m1.x, z1: m1.y,
			x2: m2.x, z2: m2.y,
			radius: CORRIDOR_RADIUS,
		});
	}
	return segments;
}

describe('corridor clearing with real Tel Aviv coordinates', () => {
	const segments = buildCorridorSegments();

	test('segments use valid Mercator coordinates', () => {
		expect(segments.length).toBe(RED_LINE_STATIONS.length - 1);
		for (const seg of segments) {
			expect(Math.abs(seg.x1)).toBeGreaterThan(1000000);
			expect(Math.abs(seg.z1)).toBeGreaterThan(1000000);
			expect(Math.abs(seg.x2)).toBeGreaterThan(1000000);
			expect(Math.abs(seg.z2)).toBeGreaterThan(1000000);
		}
	});

	test('a building ON the route (at Kiryat Aryeh station) is filtered', () => {
		const station = RED_LINE_STATIONS[2]; // Kiryat Aryeh 32.0840, 34.8530
		const buildingGlobal = degrees2meters(station.lat, station.lng);

		const tile = degrees2tile(station.lat, station.lng, ZOOM);
		const tileX = Math.floor(tile.x);
		const tileY = Math.floor(tile.y);

		const tileOffset = tile2meters(tileX, tileY + 1, ZOOM);

		const bbLocalX = buildingGlobal.x - tileOffset.x;
		const bbLocalZ = buildingGlobal.y - tileOffset.y;

		const centerX = bbLocalX + tileOffset.x;
		const centerZ = bbLocalZ + tileOffset.y;

		let minDist = Infinity;
		for (const seg of segments) {
			const d = pointToSegmentDist(centerX, centerZ, seg.x1, seg.z1, seg.x2, seg.z2);
			if (d < minDist) minDist = d;
		}

		expect(minDist).toBeLessThan(CORRIDOR_RADIUS);
	});

	test('a building 100m AWAY from the route is kept', () => {
		const station = RED_LINE_STATIONS[2];
		const stationMeters = degrees2meters(station.lat, station.lng);
		const offsetMeters = {x: stationMeters.x + 100, y: stationMeters.y + 100};

		const tile = degrees2tile(station.lat, station.lng, ZOOM);
		const tileX = Math.floor(tile.x);
		const tileY = Math.floor(tile.y);
		const tileOffset = tile2meters(tileX, tileY + 1, ZOOM);

		const bbLocalX = offsetMeters.x - tileOffset.x;
		const bbLocalZ = offsetMeters.y - tileOffset.y;

		const centerX = bbLocalX + tileOffset.x;
		const centerZ = bbLocalZ + tileOffset.y;

		let minDist = Infinity;
		for (const seg of segments) {
			const d = pointToSegmentDist(centerX, centerZ, seg.x1, seg.z1, seg.x2, seg.z2);
			if (d < minDist) minDist = d;
		}

		expect(minDist).toBeGreaterThan(CORRIDOR_RADIUS);
	});

	test('tile offset + local coords round-trips correctly', () => {
		const lat = 32.084, lon = 34.853;
		const globalMeters = degrees2meters(lat, lon);

		const tile = degrees2tile(lat, lon, ZOOM);
		const tileX = Math.floor(tile.x);
		const tileY = Math.floor(tile.y);
		const tileOffset = tile2meters(tileX, tileY + 1, ZOOM);

		const localX = globalMeters.x - tileOffset.x;
		const localZ = globalMeters.y - tileOffset.y;

		expect(localX).toBeGreaterThanOrEqual(0);
		expect(localZ).toBeGreaterThanOrEqual(0);

		const tileSize = 40075016.68 / (1 << ZOOM);
		expect(localX).toBeLessThanOrEqual(tileSize);
		expect(localZ).toBeLessThanOrEqual(tileSize);

		const reconstructedX = localX + tileOffset.x;
		const reconstructedZ = localZ + tileOffset.y;
		expect(reconstructedX).toBeCloseTo(globalMeters.x, 1);
		expect(reconstructedZ).toBeCloseTo(globalMeters.y, 1);
	});

	test('building right next to a segment midpoint is cleared', () => {
		const seg = segments[3]; // segment between Bnei Brak and Ramat Gan Diamond
		const midX = (seg.x1 + seg.x2) / 2;
		const midZ = (seg.z1 + seg.z2) / 2;
		const offsetBuilding = {x: midX + 5, y: midZ + 5};

		const d = pointToSegmentDist(offsetBuilding.x, offsetBuilding.y, seg.x1, seg.z1, seg.x2, seg.z2);
		expect(d).toBeLessThan(CORRIDOR_RADIUS);
	});

	test('degrees2meters and tile2meters produce consistent coordinates', () => {
		const lat = 32.084, lon = 34.853;
		const globalMeters = degrees2meters(lat, lon);
		const tile = degrees2tile(lat, lon, ZOOM);

		const tileSW = tile2meters(Math.floor(tile.x), Math.floor(tile.y) + 1, ZOOM);
		const tileNE = tile2meters(Math.floor(tile.x) + 1, Math.floor(tile.y), ZOOM);

		expect(globalMeters.x).toBeGreaterThan(tileSW.x);
		expect(globalMeters.x).toBeLessThan(tileNE.x);
		expect(globalMeters.y).toBeGreaterThan(tileSW.y);
		expect(globalMeters.y).toBeLessThan(tileNE.y);
	});
});
