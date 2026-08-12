/**
 * The built-in passenger figure.
 *
 * The live server has no persistent volume, so a fresh deploy can have zero
 * uploaded people models — crowds still have to work. This builds a compact
 * low-poly person (~14 boxes worth of triangles… actually 6 boxes, 72 tris)
 * directly into the same buffer layout every other game mesh uses, so it
 * costs nothing to ship and needs no download.
 *
 * Coordinates are local: origin between the feet, +y up, figure facing +z.
 */

export interface PersonBuffers {
	position: Float32Array;
	normal: Float32Array;
	color: Float32Array;
	indices: Uint32Array;
}

/** Clothing palette — the tint index in a CrowdSlot picks one of these. */
const COAT_COLORS: [number, number, number][] = [
	[0.22, 0.27, 0.38],   // navy
	[0.55, 0.16, 0.18],   // red
	[0.19, 0.36, 0.28],   // green
	[0.72, 0.70, 0.66],   // light grey
	[0.30, 0.30, 0.34],   // charcoal
	[0.62, 0.45, 0.22],   // tan
	[0.36, 0.24, 0.44],   // purple
	[0.14, 0.42, 0.52],   // teal
];

const LEG_COLORS: [number, number, number][] = [
	[0.16, 0.18, 0.24],
	[0.24, 0.22, 0.20],
	[0.12, 0.12, 0.14],
	[0.32, 0.31, 0.30],
];

const HAIR_COLORS: [number, number, number][] = [
	[0.12, 0.09, 0.07],
	[0.28, 0.18, 0.10],
	[0.45, 0.34, 0.18],
	[0.62, 0.58, 0.55],
	[0.08, 0.07, 0.07],
];

const SKIN_COLORS: [number, number, number][] = [
	[0.85, 0.68, 0.55],
	[0.72, 0.52, 0.38],
	[0.51, 0.35, 0.24],
	[0.34, 0.23, 0.16],
	[0.93, 0.79, 0.68],
];

function pushBox(
	positions: number[], normals: number[], colors: number[], indices: number[],
	cx: number, cy: number, cz: number,
	sx: number, sy: number, sz: number,
	color: [number, number, number],
): void {
	const hx = sx / 2, hy = sy / 2, hz = sz / 2;
	const faces: {n: [number, number, number]; c: [number, number, number][]}[] = [
		{n: [0, 0, 1], c: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]},
		{n: [0, 0, -1], c: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]},
		{n: [1, 0, 0], c: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]},
		{n: [-1, 0, 0], c: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]},
		{n: [0, 1, 0], c: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]]},
		{n: [0, -1, 0], c: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]},
	];

	for (const face of faces) {
		const base = positions.length / 3;
		for (const [ox, oy, oz] of face.c) {
			positions.push(cx + ox, cy + oy, cz + oz);
			normals.push(face.n[0], face.n[1], face.n[2]);
			colors.push(color[0], color[1], color[2]);
		}
		indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}
}

/**
 * Build one standing person, 1.75 m tall at scale 1.
 * `tint` selects the clothing combination (any integer; wraps).
 */
export function buildPersonGeometry(tint: number): PersonBuffers {
	const positions: number[] = [];
	const normals: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];

	const t = Math.abs(Math.floor(tint));
	const coat = COAT_COLORS[t % COAT_COLORS.length];
	const legs = LEG_COLORS[(t >> 3) % LEG_COLORS.length];
	const skin = SKIN_COLORS[(t >> 1) % SKIN_COLORS.length];

	// Two separated legs rather than one block: the gap is what makes a
	// standing figure read as a PERSON at platform distance — a single leg
	// block reads as a bollard, which is exactly how the first version looked.
	pushBox(positions, normals, colors, indices, -0.10, 0.39, 0, 0.15, 0.78, 0.18, legs);
	pushBox(positions, normals, colors, indices, 0.10, 0.39, 0, 0.15, 0.78, 0.18, legs);
	// shoes
	pushBox(positions, normals, colors, indices, -0.10, 0.03, 0.02, 0.16, 0.07, 0.26, [0.10, 0.09, 0.09]);
	pushBox(positions, normals, colors, indices, 0.10, 0.03, 0.02, 0.16, 0.07, 0.26, [0.10, 0.09, 0.09]);
	// torso, slightly tapered by stacking a narrower shoulder block
	pushBox(positions, normals, colors, indices, 0, 1.02, 0, 0.40, 0.50, 0.24, coat);
	pushBox(positions, normals, colors, indices, 0, 1.28, 0, 0.46, 0.10, 0.26, coat);
	// arms clear of the body so the silhouette has gaps
	pushBox(positions, normals, colors, indices, -0.29, 1.01, 0, 0.12, 0.52, 0.15, coat);
	pushBox(positions, normals, colors, indices, 0.29, 1.01, 0, 0.12, 0.52, 0.15, coat);
	// hands
	pushBox(positions, normals, colors, indices, -0.29, 0.71, 0, 0.11, 0.12, 0.14, skin);
	pushBox(positions, normals, colors, indices, 0.29, 0.71, 0, 0.11, 0.12, 0.14, skin);
	// neck + head
	pushBox(positions, normals, colors, indices, 0, 1.39, 0, 0.13, 0.10, 0.13, skin);
	pushBox(positions, normals, colors, indices, 0, 1.57, 0, 0.22, 0.26, 0.21, skin);
	// hair — a slab on top, so heads are not all identical skin blocks
	pushBox(positions, normals, colors, indices, 0, 1.71, -0.01, 0.23, 0.07, 0.22, HAIR_COLORS[t % HAIR_COLORS.length]);

	return {
		position: new Float32Array(positions),
		normal: new Float32Array(normals),
		color: new Float32Array(colors),
		indices: new Uint32Array(indices),
	};
}

/** Height of the procedural figure, meters (used for normalising GLB figures). */
export const PERSON_HEIGHT = 1.75;
