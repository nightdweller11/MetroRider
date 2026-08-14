import type {SignBuffers} from '../limits/SignGeometry';

/**
 * The mark a train is supposed to stop at.
 *
 * The stop scorer grades precision against a point on the track — 2 m is a
 * perfect stop, 12 m is still good — and until now that point was invisible.
 * A child was being marked on how close they stopped to somewhere nobody had
 * shown them. Real platforms carry exactly this: a board, a post, a painted
 * mark telling the driver where the front of the train belongs.
 *
 * Built the same way as the speed boards and the signals — vertex-coloured
 * quads in the train material, no texture — so it costs one more mesh and
 * nothing else.
 *
 * Origin is at the foot of the post, face pointing along +z.
 */

type RGB = [number, number, number];

/** Tall enough to see over a platform crowd from a cab. */
const POST_HEIGHT = 3.8;
const POST_WIDTH = 0.18;
const BOARD_W = 1.7;
const BOARD_H = 1.25;

/*
 * CONTRAST, not brightness.
 *
 * The first version was a near-white board at 1.9 — technically "lit", and
 * completely invisible: the world it stands in is a sun-blasted white-and-sand
 * landscape, so a white board on a grey post disappears into it. Proven by
 * swapping in the block-signal geometry at the very same placement, which was
 * picked out instantly at 120 m. The signals read because they are saturated
 * red and green; the speed boards read because they carry a dark border and
 * dark numerals.
 *
 * So: a DARK plate carrying a saturated orange panel pushed past 1.0 for the
 * bloom pass. That reads against bright sand and against night, which a board
 * tuned for either one alone does not.
 */
const POST: RGB = [0.09, 0.10, 0.12];
const BOARD: RGB = [0.05, 0.06, 0.08];
const MARK: RGB = [2.7, 1.05, 0.10];
const STRIPE: RGB = [1.9, 1.9, 1.95];

/** A ground bar across the sleepers, so the mark reads from the cab too. */
const BAR_HALF_WIDTH = 2.6;
const BAR_LENGTH = 0.7;
const BAR_HEIGHT = 0.06;

interface Builder {
	position: number[];
	normal: number[];
	color: number[];
	indices: number[];
}

/** One vertical quad facing +z. */
function quad(b: Builder, x: number, y: number, w: number, h: number, z: number, color: RGB): void {
	const base = b.position.length / 3;

	b.position.push(x, y, z, x + w, y, z, x + w, y + h, z, x, y + h, z);

	for (let i = 0; i < 4; i++) {
		b.normal.push(0, 0, 1);
		b.color.push(color[0], color[1], color[2]);
	}

	b.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** One flat quad lying on the ground, facing up. */
function flat(b: Builder, x: number, z: number, w: number, d: number, y: number, color: RGB): void {
	const base = b.position.length / 3;

	b.position.push(x, y, z, x + w, y, z, x + w, y, z + d, x, y, z + d);

	for (let i = 0; i < 4; i++) {
		b.normal.push(0, 1, 0);
		b.color.push(color[0], color[1], color[2]);
	}

	b.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

export function buildStopMarkGeometry(): SignBuffers {
	const b: Builder = {position: [], normal: [], color: [], indices: []};

	// Post.
	quad(b, -POST_WIDTH / 2, 0, POST_WIDTH, POST_HEIGHT, -0.03, POST);

	// A dark plate with a bright bar across it — the eye finds the bar, and the
	// dark plate around it is what makes the bar findable in the first place.
	const boardY = POST_HEIGHT - BOARD_H;

	quad(b, -BOARD_W / 2, boardY, BOARD_W, BOARD_H, 0, BOARD);
	quad(b, -BOARD_W / 2 + 0.12, boardY + BOARD_H * 0.30, BOARD_W - 0.24, BOARD_H * 0.40, 0.01, MARK);
	// A thin white line through the middle of the bar: the thing you actually
	// line the front of the train up against.
	quad(b, -BOARD_W / 2 + 0.12, boardY + BOARD_H * 0.47, BOARD_W - 0.24, BOARD_H * 0.06, 0.02, STRIPE);

	// The mark on the ground, across the track, at the exact stop point. This
	// is the one you actually judge the last few metres against — the board is
	// visible from far off, the bar tells you when you are there.
	flat(b, -BAR_HALF_WIDTH, -BAR_LENGTH / 2, BAR_HALF_WIDTH * 2, BAR_LENGTH, BAR_HEIGHT, MARK);

	return {
		position: new Float32Array(b.position),
		normal: new Float32Array(b.normal),
		color: new Float32Array(b.color),
		indices: new Uint32Array(b.indices),
	};
}
