/**
 * Tests for the heading formula: heading = PI/2 - toRad(bearing)
 *
 * The bearing is in degrees where 0=north, 90=east, 180=south, 270=west.
 * The heading is used with Mat4.yRotate where yRotate(theta) maps +Z to (sin(theta), 0, cos(theta)).
 * In world coords: +X = north, +Z = east. Train mesh forward = +Z.
 *
 * For yRotate(heading):
 *   heading = PI/2 => +Z -> (1, 0, 0) = north
 *   heading = 0   => +Z -> (0, 0, 1) = east
 *   heading =-PI/2=> +Z -> (-1, 0, 0) = south
 */

function toRad(deg: number): number {
	return deg * Math.PI / 180;
}

function computeHeading(bearingDeg: number): number {
	return Math.PI / 2 - toRad(bearingDeg);
}

function yRotateDirection(theta: number): {x: number; z: number} {
	return {x: Math.sin(theta), z: Math.cos(theta)};
}

describe('heading formula', () => {
	test('bearing 0 (north) -> mesh faces +X (north)', () => {
		const heading = computeHeading(0);
		const dir = yRotateDirection(heading);
		expect(dir.x).toBeCloseTo(1, 5);
		expect(dir.z).toBeCloseTo(0, 5);
	});

	test('bearing 90 (east) -> mesh faces +Z (east)', () => {
		const heading = computeHeading(90);
		const dir = yRotateDirection(heading);
		expect(dir.x).toBeCloseTo(0, 5);
		expect(dir.z).toBeCloseTo(1, 5);
	});

	test('bearing 180 (south) -> mesh faces -X (south)', () => {
		const heading = computeHeading(180);
		const dir = yRotateDirection(heading);
		expect(dir.x).toBeCloseTo(-1, 5);
		expect(dir.z).toBeCloseTo(0, 5);
	});

	test('bearing 270 (west) -> mesh faces -Z (west)', () => {
		const heading = computeHeading(270);
		const dir = yRotateDirection(heading);
		expect(dir.x).toBeCloseTo(0, 5);
		expect(dir.z).toBeCloseTo(-1, 5);
	});

	test('bearing 45 (northeast) -> mesh faces correct diagonal', () => {
		const heading = computeHeading(45);
		const dir = yRotateDirection(heading);
		const expected = Math.sqrt(2) / 2;
		expect(dir.x).toBeCloseTo(expected, 5);
		expect(dir.z).toBeCloseTo(expected, 5);
	});

	test('bearing 360 === bearing 0', () => {
		const h0 = computeHeading(0);
		const h360 = computeHeading(360);
		const d0 = yRotateDirection(h0);
		const d360 = yRotateDirection(h360);
		expect(d0.x).toBeCloseTo(d360.x, 5);
		expect(d0.z).toBeCloseTo(d360.z, 5);
	});
});
