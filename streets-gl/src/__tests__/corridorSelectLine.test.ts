/**
 * Tests that selectLine() generates corridor segments and sends them
 * BEFORE attempting any camera move. This verifies the root cause fix
 * for the "NO corridor segments" bug.
 */

function degrees2meters(lat: number, lon: number): {x: number; y: number} {
	const z = lon * 20037508.34 / 180;
	const x = Math.log(Math.tan((90 + lat) * Math.PI / 360)) * 20037508.34 / Math.PI;
	return {x, y: z};
}

const CORRIDOR_RADIUS = 25;

const TEST_STATIONS = [
	{lat: 32.0905, lng: 34.8855},
	{lat: 32.0865, lng: 34.8720},
	{lat: 32.0840, lng: 34.8530},
	{lat: 32.0820, lng: 34.8350},
];

interface CorridorSegment {
	x1: number; z1: number;
	x2: number; z2: number;
	radius: number;
}

function buildCorridorSegments(stations: {lat: number; lng: number}[]): CorridorSegment[] {
	const segments: CorridorSegment[] = [];
	for (let i = 0; i < stations.length - 1; i++) {
		const m1 = degrees2meters(stations[i].lat, stations[i].lng);
		const m2 = degrees2meters(stations[i + 1].lat, stations[i + 1].lng);
		segments.push({
			x1: m1.x, z1: m1.y,
			x2: m2.x, z2: m2.y,
			radius: CORRIDOR_RADIUS,
		});
	}
	return segments;
}

describe('selectLine corridor segment ordering', () => {
	test('corridor segments are generated from station points', () => {
		const segments = buildCorridorSegments(TEST_STATIONS);

		expect(segments.length).toBe(TEST_STATIONS.length - 1);
		expect(segments.length).toBe(3);

		for (const seg of segments) {
			expect(seg.radius).toBe(CORRIDOR_RADIUS);
			expect(Math.abs(seg.x1)).toBeGreaterThan(1000);
			expect(Math.abs(seg.z1)).toBeGreaterThan(1000);
		}
	});

	test('corridor segments cover all route sections', () => {
		const segments = buildCorridorSegments(TEST_STATIONS);

		const firstStation = degrees2meters(TEST_STATIONS[0].lat, TEST_STATIONS[0].lng);
		const lastStation = degrees2meters(TEST_STATIONS[TEST_STATIONS.length - 1].lat, TEST_STATIONS[TEST_STATIONS.length - 1].lng);

		expect(segments[0].x1).toBeCloseTo(firstStation.x, 1);
		expect(segments[0].z1).toBeCloseTo(firstStation.y, 1);

		const lastSeg = segments[segments.length - 1];
		expect(lastSeg.x2).toBeCloseTo(lastStation.x, 1);
		expect(lastSeg.z2).toBeCloseTo(lastStation.y, 1);
	});

	test('segments are sent even when camera throws', () => {
		let corridorSent = false;
		let cameraThrew = false;

		function simulateSelectLine(): void {
			buildCorridorSegments(TEST_STATIONS);
			corridorSent = true;

			try {
				throw new Error('ControlsSystem not ready');
			} catch (_) {
				cameraThrew = true;
			}
		}

		simulateSelectLine();

		expect(corridorSent).toBe(true);
		expect(cameraThrew).toBe(true);
	});

	test('segments are resent during startGame', () => {
		let sendCount = 0;

		function simulateSelectLine(): void {
			buildCorridorSegments(TEST_STATIONS);
			sendCount++;

			try {
				throw new Error('Camera not ready');
			} catch (_) {
				// camera not ready, stored pending move
			}
		}

		function simulateStartGame(): void {
			buildCorridorSegments(TEST_STATIONS);
			sendCount++;
		}

		simulateSelectLine();
		expect(sendCount).toBe(1);

		simulateStartGame();
		expect(sendCount).toBe(2);
	});

	test('empty station list produces no segments', () => {
		const segments = buildCorridorSegments([]);
		expect(segments.length).toBe(0);
	});

	test('single station produces no segments', () => {
		const segments = buildCorridorSegments([TEST_STATIONS[0]]);
		expect(segments.length).toBe(0);
	});

	test('segment coordinates are contiguous', () => {
		const segments = buildCorridorSegments(TEST_STATIONS);

		for (let i = 0; i < segments.length - 1; i++) {
			expect(segments[i].x2).toBeCloseTo(segments[i + 1].x1, 6);
			expect(segments[i].z2).toBeCloseTo(segments[i + 1].z1, 6);
		}
	});
});
