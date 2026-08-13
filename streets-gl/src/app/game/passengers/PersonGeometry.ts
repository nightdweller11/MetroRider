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

/**
 * A well-mixed index into one palette. Salt separates the axes so clothing,
 * hair and skin vary independently of one another.
 */
function paletteIndex(tint: number, salt: number, length: number): number {
	let h = (tint + 1) * (salt | 1);

	h ^= h >>> 13;
	h = Math.imul(h, 0x5bd1);
	h ^= h >>> 11;

	return Math.abs(h) % length;
}

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

	// Each palette axis is picked from an INDEPENDENT hash of the tint.
	//
	// They used to be slices of the tint itself — `t % 8` for the coat, `t % 5`
	// for the hair, `(t >> 1) % 5` for skin — which ties them to each other and,
	// worse, to whatever step the caller happens to walk the tint in. The crowd
	// built its figures with `tint = t * 5 + 1`, and every one of those is 1 mod
	// 5, so all six people came out with exactly the same hair and only two
	// skin tones between them. That is the "no variability" the platform showed.
	// Hashing each axis separately means no caller's stride can collapse an
	// axis again.
	const coat = COAT_COLORS[paletteIndex(t, 0x9e37, COAT_COLORS.length)];
	const legs = LEG_COLORS[paletteIndex(t, 0x85eb, LEG_COLORS.length)];
	const skin = SKIN_COLORS[paletteIndex(t, 0xc2b2, SKIN_COLORS.length)];

	// Human proportions matter more than polygon count at this distance: a
	// head is about 1/7.5 of a person, shoulders about 1.6 head-widths, and the
	// legs are half the total height. The first version had a huge square head
	// on a wide slab and read as a Lego brick.
	const hair = HAIR_COLORS[paletteIndex(t, 0x27d4, HAIR_COLORS.length)];
	const shoe: [number, number, number] = [0.10, 0.09, 0.09];

	// legs: thighs + calves, tapering, with a real gap between them
	pushBox(positions, normals, colors, indices, -0.085, 0.62, 0, 0.135, 0.42, 0.165, legs);
	pushBox(positions, normals, colors, indices, 0.085, 0.62, 0, 0.135, 0.42, 0.165, legs);
	pushBox(positions, normals, colors, indices, -0.085, 0.23, 0, 0.115, 0.40, 0.14, legs);
	pushBox(positions, normals, colors, indices, 0.085, 0.23, 0, 0.115, 0.40, 0.14, legs);
	pushBox(positions, normals, colors, indices, -0.085, 0.035, 0.025, 0.13, 0.07, 0.235, shoe);
	pushBox(positions, normals, colors, indices, 0.085, 0.035, 0.025, 0.13, 0.07, 0.235, shoe);

	// hips → chest → shoulders: three stacked blocks so the torso has a waist
	pushBox(positions, normals, colors, indices, 0, 0.90, 0, 0.30, 0.16, 0.185, coat);
	pushBox(positions, normals, colors, indices, 0, 1.09, 0, 0.325, 0.26, 0.195, coat);
	pushBox(positions, normals, colors, indices, 0, 1.26, 0, 0.375, 0.12, 0.205, coat);

	// arms hang beside the body with a narrower forearm
	pushBox(positions, normals, colors, indices, -0.235, 1.14, 0, 0.095, 0.28, 0.135, coat);
	pushBox(positions, normals, colors, indices, 0.235, 1.14, 0, 0.095, 0.28, 0.135, coat);
	pushBox(positions, normals, colors, indices, -0.235, 0.90, 0, 0.08, 0.24, 0.115, coat);
	pushBox(positions, normals, colors, indices, 0.235, 0.90, 0, 0.08, 0.24, 0.115, coat);
	pushBox(positions, normals, colors, indices, -0.235, 0.74, 0, 0.085, 0.11, 0.115, skin);
	pushBox(positions, normals, colors, indices, 0.235, 0.74, 0, 0.085, 0.11, 0.115, skin);

	// neck, head (~23 cm — a head, not a crate), hair cap and a hint of a face
	pushBox(positions, normals, colors, indices, 0, 1.36, 0, 0.10, 0.075, 0.10, skin);
	pushBox(positions, normals, colors, indices, 0, 1.51, 0, 0.175, 0.22, 0.175, skin);
	pushBox(positions, normals, colors, indices, 0, 1.625, 0, 0.185, 0.055, 0.185, hair);
	pushBox(positions, normals, colors, indices, 0, 1.565, -0.088, 0.155, 0.075, 0.02, hair);

	return {
		position: new Float32Array(positions),
		normal: new Float32Array(normals),
		color: new Float32Array(colors),
		indices: new Uint32Array(indices),
	};
}

/** Height of the procedural figure, meters (used for normalising GLB figures). */
export const PERSON_HEIGHT = 1.75;
