import type {SignBuffers} from './SignGeometry';

/**
 * A colour-light block signal, built as geometry.
 *
 * Same rules as the lineside speed boards: the train material carries vertex
 * colours and no textures, so the lamps are quads whose COLOUR carries the
 * aspect. A lit lamp is a saturated colour, a dark one is the near-black of
 * unlit glass — which is what a signal head actually looks like from a cab,
 * where only one lamp is ever alight.
 *
 * Origin is at the foot of the post and the head faces along +z, matching
 * `buildSignGeometry` so the same placement code can pose either.
 */

type RGB = [number, number, number];

export type SignalAspect = 'clear' | 'danger';

/*
 * Deliberately oversized, for the same reason the speed boards are: a signal
 * is read from a moving cab hundreds of metres away, and at true scale a
 * 0.3 m lamp is sub-pixel by 200 m — measured, the first version was invisible
 * at the 400 m where it matters most. A real signal reads at that distance
 * because the lamp is a bright point source at night; in daylight, at this
 * render scale, size is the only thing that carries.
 */
const POST_HEIGHT = 4.6;
const HEAD_WIDTH = 1.6;
const LAMP_SIZE = 0.95;

const POST: RGB = [0.40, 0.40, 0.43];
const HEAD: RGB = [0.10, 0.11, 0.13];
/** Lit lamps are pushed well past 1.0 so the bloom pass picks them up. */
const RED_LIT: RGB = [2.6, 0.10, 0.10];
const GREEN_LIT: RGB = [0.10, 2.4, 0.55];
const UNLIT: RGB = [0.045, 0.05, 0.055];

interface Builder {
	position: number[];
	normal: number[];
	color: number[];
	indices: number[];
}

/** One vertical quad facing +z, at (x, y) with size (w, h). */
function quad(b: Builder, x: number, y: number, w: number, h: number, z: number, color: RGB): void {
	const base = b.position.length / 3;

	b.position.push(
		x, y, z,
		x + w, y, z,
		x + w, y + h, z,
		x, y + h, z,
	);

	for (let i = 0; i < 4; i++) {
		b.normal.push(0, 0, 1);
		b.color.push(color[0], color[1], color[2]);
	}

	b.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

export function buildSignalGeometry(aspect: SignalAspect): SignBuffers {
	const b: Builder = {position: [], normal: [], color: [], indices: []};

	// Post.
	quad(b, -0.09, 0, 0.18, POST_HEIGHT, -0.03, POST);

	// Head backing, tall enough for two lamps.
	const headBottom = POST_HEIGHT - 0.06;
	const headHeight = LAMP_SIZE * 2 + 0.55;

	quad(b, -HEAD_WIDTH / 2, headBottom, HEAD_WIDTH, headHeight, 0, HEAD);

	// Red above green, as on the real thing.
	const lampX = -LAMP_SIZE / 2;
	const redY = headBottom + headHeight - LAMP_SIZE - 0.16;
	const greenY = headBottom + 0.16;

	quad(b, lampX, redY, LAMP_SIZE, LAMP_SIZE, 0.01, aspect === 'danger' ? RED_LIT : UNLIT);
	quad(b, lampX, greenY, LAMP_SIZE, LAMP_SIZE, 0.01, aspect === 'clear' ? GREEN_LIT : UNLIT);

	return {
		position: new Float32Array(b.position),
		normal: new Float32Array(b.normal),
		color: new Float32Array(b.color),
		indices: new Uint32Array(b.indices),
	};
}

/**
 * Just the colours, in the same vertex order as `buildSignalGeometry`.
 *
 * Changing an aspect rewrites four vertices' worth of colour rather than
 * rebuilding the mesh: a signal changes several times a minute, and dropping
 * and recreating GPU buffers that often is the shape of the leak that used to
 * grow all session.
 */
export function signalAspectColors(aspect: SignalAspect): Float32Array {
	const colors: number[] = [];
	const push = (c: RGB): void => {
		for (let i = 0; i < 4; i++) colors.push(c[0], c[1], c[2]);
	};

	push(POST);
	push(HEAD);
	push(aspect === 'danger' ? RED_LIT : UNLIT);
	push(aspect === 'clear' ? GREEN_LIT : UNLIT);

	return new Float32Array(colors);
}
