import {tileTouchesWindow, tilePlacement, TILE_SIZE_M} from '../app/game/ui/MiniMapGround';

/**
 * The ground under the minimap.
 *
 * The corner map drew rail lines on black for its whole life, which is a route
 * diagram and not a map. The real version composites the city's own ground
 * tiles under them. What is worth testing without a browser is the geometry:
 * which tiles the window touches, and where each one lands — the baking itself
 * is a canvas and is checked by looking at it.
 */

const centre = {x: 0, z: 0};

describe('tileTouchesWindow', () => {
	test('the tile the train is standing on is in', () => {
		expect(tileTouchesWindow(-100, -100, centre, 1000)).toBe(true);
	});

	test('a tile the far side of the city is out', () => {
		// The whole point of the check: a loaded city costs nothing to ignore.
		expect(tileTouchesWindow(TILE_SIZE_M * 50, 0, centre, 1000)).toBe(false);
		expect(tileTouchesWindow(0, TILE_SIZE_M * 50, centre, 1000)).toBe(false);
	});

	test('a tile that only overlaps a corner is still in', () => {
		// Its far corner just reaches the window's near corner.
		expect(tileTouchesWindow(1000 - 1, 1000 - 1, centre, 1000)).toBe(true);
	});

	test('a tile ending exactly on the window edge is out', () => {
		expect(tileTouchesWindow(-TILE_SIZE_M - 1001, 0, centre, 1000)).toBe(false);
	});

	test('a wider window takes in more', () => {
		const far = TILE_SIZE_M * 3;

		expect(tileTouchesWindow(far, 0, centre, 1000)).toBe(false);
		expect(tileTouchesWindow(far, 0, centre, 5000)).toBe(true);
	});
});

describe('tilePlacement', () => {
	test('a tile starting at the window corner lands at the canvas corner', () => {
		const {dx, dy} = tilePlacement(-1000, -1000, centre, 2000, 200);

		expect(dx).toBeCloseTo(0, 6);
		expect(dy).toBeCloseTo(0, 6);
	});

	test('scales a tile to its true size on screen', () => {
		// 2 km across a 200 px panel: a ~611 m tile is a bit under a third of it.
		const {side} = tilePlacement(0, 0, centre, 2000, 200);

		expect(side).toBeCloseTo((TILE_SIZE_M / 2000) * 200, 6);
	});

	test('the world moves under the train, not the other way round', () => {
		const still = tilePlacement(0, 0, {x: 0, z: 0}, 2000, 200);
		const moved = tilePlacement(0, 0, {x: 500, z: 0}, 2000, 200);

		// Train moved east, so the tile slides west on the panel.
		expect(moved.dx).toBeLessThan(still.dx);
		expect(still.dx - moved.dx).toBeCloseTo((500 / 2000) * 200, 6);
	});

	test('north is up: a tile north of the train sits above the middle', () => {
		const {dy} = tilePlacement(0, -TILE_SIZE_M, centre, 2000, 200);

		expect(dy).toBeLessThan(100);
	});
});
