/**
 * The ground under the minimap — the actual streets around the train.
 *
 * The corner map showed the rail lines and nothing else: a couple of coloured
 * strokes floating on black. That is a route diagram, not a map. What makes it
 * a map is everything the line runs THROUGH — roads, squares, parks, the
 * railway land itself.
 *
 * That geometry is already in memory. Every loaded tile carries the triangles
 * the game paints the ground with (`Tile3DBuffersProjected`), in world metres,
 * with a texture id per vertex saying what each triangle is. This bakes those
 * triangles into a small canvas ONCE per tile and the minimap composites the
 * handful of tiles it needs — which is how a minimap can afford to exist at
 * all. Re-drawing tens of thousands of triangles every time the train moved
 * would cost more than the frame it appears in.
 */

/**
 * Tile side length in Mercator metres at zoom 16 — the zoom the world data is
 * loaded at (`WorkerInstance.TileZoom`).
 */
export const TILE_SIZE_M = 40075016.68 / (1 << 16);

/** How many pixels a baked tile gets. 256 over ~611 m is ~2.4 m per pixel. */
const BAKE_PX = 256;

/**
 * What each texture slot looks like on a map.
 *
 * The indices are positions in the projected-mesh texture array
 * (`createProjectedMeshTexture`), so this table has to move with that file.
 * Anything not named here is drawn as unremarkable ground rather than skipped:
 * a map with holes in it reads as broken, and a new material should not make
 * the city disappear.
 */
const SLOT_COLOURS: Record<number, string> = {
	0: '#3b4654',   // pavement
	1: '#333c48',   // asphalt
	2: '#3f4956',   // cobblestone
	3: '#26493a',   // football pitch
	4: '#3c4152',   // basketball pitch
	5: '#3f4a44',   // tennis pitch
	6: '#27593f',   // manicured grass
	7: '#38485a',   // cycleway
	8: '#4a4038',   // railway land
	9: '#4a4a52',   // rock
	10: '#5c5442',  // sand
	14: '#59626f',  // asphalt road
	15: '#4e5764',  // asphalt road, unmarked
	16: '#5c626c',  // concrete road
	17: '#525863',  // concrete road, unmarked
	18: '#646b77',  // intersection
	19: '#4f4536',  // wood road
	20: '#4a4f5c',  // helipad
	21: '#255239',  // garden
	22: '#40382c',  // soil
	23: '#22513a',  // grass
	24: '#1c4331',  // forest floor
	29: '#4a4a2e',  // farmland
	30: '#4f4d30',
	31: '#524f31',
	32: '#4b4b52',  // gravel
	33: '#453a2c',  // dirt road
	34: '#544a37',  // sand road
	35: '#4a4038',  // railway top
	36: '#5a5048',  // rail
	37: '#2f4a3c',  // generic pitch
};

const DEFAULT_COLOUR = '#2a3038';

/** A tile's ground plan, baked once. */
export interface BakedTile {
	canvas: HTMLCanvasElement;
	/** Tile origin in world metres — the canvas covers TILE_SIZE_M from here. */
	originX: number;
	originZ: number;
}

interface ProjectedBuffers {
	positionBuffer: Float32Array;
	textureIdBuffer: Uint8Array;
}

/**
 * Paint one tile's ground triangles into a canvas.
 *
 * Positions are tile-local (the tile object carries the world offset), x and z
 * across the ground with y as height, which is thrown away — this is a plan.
 */
export function bakeTileGround(
	buffers: ProjectedBuffers,
	originX: number,
	originZ: number,
): BakedTile | null {
	const positions = buffers.positionBuffer;
	const ids = buffers.textureIdBuffer;

	if (!positions || positions.length < 9) return null;

	const canvas = document.createElement('canvas');

	canvas.width = BAKE_PX;
	canvas.height = BAKE_PX;

	const ctx = canvas.getContext('2d');

	if (!ctx) return null;

	const scale = BAKE_PX / TILE_SIZE_M;

	ctx.fillStyle = DEFAULT_COLOUR;
	ctx.fillRect(0, 0, BAKE_PX, BAKE_PX);

	// Triangles come in runs that share a material, so batching by texture id
	// turns tens of thousands of fillStyle changes into a few dozen.
	let currentId = -1;

	ctx.beginPath();

	for (let i = 0; i + 8 < positions.length; i += 9) {
		const id = ids ? ids[i / 3] : -1;

		if (id !== currentId) {
			if (currentId !== -1) ctx.fill();
			currentId = id;
			ctx.fillStyle = SLOT_COLOURS[id] ?? DEFAULT_COLOUR;
			ctx.beginPath();
		}

		// x is east, z is south in this projection; both are already metres
		// relative to the tile's own corner.
		const x1 = positions[i] * scale;
		const z1 = positions[i + 2] * scale;
		const x2 = positions[i + 3] * scale;
		const z2 = positions[i + 5] * scale;
		const x3 = positions[i + 6] * scale;
		const z3 = positions[i + 8] * scale;

		ctx.moveTo(x1, z1);
		ctx.lineTo(x2, z2);
		ctx.lineTo(x3, z3);
		ctx.closePath();
	}

	if (currentId !== -1) ctx.fill();

	return {canvas, originX, originZ};
}

/**
 * Composite the baked tiles that fall inside the window onto the minimap.
 *
 * `centre` is the train in world metres, `spanM` the width of ground shown.
 * North is up and nothing rotates, so this is a translate and a scale.
 */
export function tileTouchesWindow(
	originX: number,
	originZ: number,
	centre: {x: number; z: number},
	half: number,
): boolean {
	return !(
		originX > centre.x + half || originX + TILE_SIZE_M < centre.x - half
		|| originZ > centre.z + half || originZ + TILE_SIZE_M < centre.z - half
	);
}

/** Where a tile lands on the minimap, in pixels. */
export function tilePlacement(
	originX: number,
	originZ: number,
	centre: {x: number; z: number},
	spanM: number,
	size: number,
): {dx: number; dy: number; side: number} {
	const half = spanM / 2;
	const pxPerM = size / spanM;

	return {
		dx: (originX - (centre.x - half)) * pxPerM,
		dy: (originZ - (centre.z - half)) * pxPerM,
		side: TILE_SIZE_M * pxPerM,
	};
}

export function drawGround(
	ctx: CanvasRenderingContext2D,
	tiles: BakedTile[],
	centre: {x: number; z: number},
	spanM: number,
	size: number,
): number {
	const half = spanM / 2;
	let drawn = 0;

	ctx.clearRect(0, 0, size, size);
	// Anything with no tile loaded is unknown ground, not black nothing.
	ctx.fillStyle = '#141922';
	ctx.fillRect(0, 0, size, size);
	ctx.imageSmoothingEnabled = true;

	for (const tile of tiles) {
		// Reject a tile that cannot touch the window before doing any work.
		if (!tileTouchesWindow(tile.originX, tile.originZ, centre, half)) continue;

		const {dx, dy, side} = tilePlacement(tile.originX, tile.originZ, centre, spanM, size);

		ctx.drawImage(tile.canvas, dx, dy, side, side);
		drawn++;
	}

	return drawn;
}
