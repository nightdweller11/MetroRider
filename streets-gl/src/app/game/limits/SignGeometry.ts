import {SignShape} from './SignStyle';

/**
 * A lineside speed board, built as geometry.
 *
 * The train material carries vertex colours and no textures, so the numerals
 * are built out of quads rather than drawn into a texture — a seven-segment
 * layout, which is what a real enamel board's digits reduce to at the distance
 * a driver reads them from anyway. That keeps signs in the same draw path as
 * everything else and costs no texture upload.
 */

export interface SignBuffers {
	position: Float32Array;
	normal: Float32Array;
	color: Float32Array;
	indices: Uint32Array;
}

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
	const h = hex.replace('#', '');
	const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
	return [
		parseInt(full.slice(0, 2), 16) / 255,
		parseInt(full.slice(2, 4), 16) / 255,
		parseInt(full.slice(4, 6), 16) / 255,
	];
}

/** Segments of a seven-segment digit: [x, y, w, h] in a 1×2 cell. */
const SEG: Record<string, [number, number, number, number]> = {
	top: [0.08, 1.78, 0.84, 0.16],
	topLeft: [0.0, 1.02, 0.16, 0.78],
	topRight: [0.84, 1.02, 0.16, 0.78],
	middle: [0.08, 0.92, 0.84, 0.16],
	bottomLeft: [0.0, 0.22, 0.16, 0.78],
	bottomRight: [0.84, 0.22, 0.16, 0.78],
	bottom: [0.08, 0.06, 0.84, 0.16],
};

const DIGITS: Record<string, (keyof typeof SEG)[]> = {
	'0': ['top', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight', 'bottom'],
	'1': ['topRight', 'bottomRight'],
	'2': ['top', 'topRight', 'middle', 'bottomLeft', 'bottom'],
	'3': ['top', 'topRight', 'middle', 'bottomRight', 'bottom'],
	'4': ['topLeft', 'topRight', 'middle', 'bottomRight'],
	'5': ['top', 'topLeft', 'middle', 'bottomRight', 'bottom'],
	'6': ['top', 'topLeft', 'middle', 'bottomLeft', 'bottomRight', 'bottom'],
	'7': ['top', 'topRight', 'bottomRight'],
	'8': ['top', 'topLeft', 'topRight', 'middle', 'bottomLeft', 'bottomRight', 'bottom'],
	'9': ['top', 'topLeft', 'topRight', 'middle', 'bottomRight', 'bottom'],
};

interface Builder {
	position: number[];
	normal: number[];
	color: number[];
	indices: number[];
}

/** A quad in the sign's own plane (x right, y up, facing +z). */
function quad(b: Builder, x: number, y: number, w: number, h: number, z: number, color: RGB): void {
	const base = b.position.length / 3;
	const corners: [number, number][] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
	for (const [cx, cy] of corners) {
		b.position.push(cx, cy, z);
		b.normal.push(0, 0, 1);
		b.color.push(color[0], color[1], color[2]);
	}
	b.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
	// Back face, so the board is not invisible from behind.
	const back = b.position.length / 3;
	for (const [cx, cy] of [corners[1], corners[0], corners[3], corners[2]]) {
		b.position.push(cx, cy, z - 0.02);
		b.normal.push(0, 0, -1);
		b.color.push(color[0] * 0.55, color[1] * 0.55, color[2] * 0.55);
	}
	b.indices.push(back, back + 1, back + 2, back, back + 2, back + 3);
}

/** A disc approximated by a fan — French TIV and tram signs are round. */
function disc(b: Builder, cx: number, cy: number, radius: number, z: number, color: RGB): void {
	const segments = 20;
	const centre = b.position.length / 3;
	b.position.push(cx, cy, z);
	b.normal.push(0, 0, 1);
	b.color.push(color[0], color[1], color[2]);

	for (let i = 0; i <= segments; i++) {
		const a = (i / segments) * Math.PI * 2;
		b.position.push(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, z);
		b.normal.push(0, 0, 1);
		b.color.push(color[0], color[1], color[2]);
	}
	for (let i = 1; i <= segments; i++) {
		b.indices.push(centre, centre + i, centre + i + 1);
	}
}

/**
 * An upright triangle, point up — the advance-warning board.
 *
 * `SignShape` has declared 'triangle' since the sign system was written, but
 * nothing ever built one: the face builder tested for 'disc' and drew a quad
 * for everything else, so a warning sign silently came out square. That is
 * half of why every board on the line looked the same.
 */
function triangle(b: Builder, cx: number, cy: number, halfWidth: number, height: number, z: number, color: RGB): void {
	const base = b.position.length / 3;
	const corners: [number, number][] = [
		[cx - halfWidth, cy],
		[cx + halfWidth, cy],
		[cx, cy + height],
	];

	for (const [x, y] of corners) {
		b.position.push(x, y, z);
		b.normal.push(0, 0, 1);
		b.color.push(color[0], color[1], color[2]);
	}
	b.indices.push(base, base + 1, base + 2);

	const back = b.position.length / 3;
	for (const [x, y] of [corners[1], corners[0], corners[2]]) {
		b.position.push(x, y, z - 0.02);
		b.normal.push(0, 0, -1);
		b.color.push(color[0] * 0.55, color[1] * 0.55, color[2] * 0.55);
	}
	b.indices.push(back, back + 1, back + 2);
}

export interface SignFaceOptions {
	shape: SignShape;
	background: string;
	border: string;
	text: string;
	/** Board width in metres (height follows the shape). */
	width?: number;
	/** Height of the post under the board, metres. */
	postHeight?: number;
}

/**
 * Build one lineside board showing `value`, standing on a post.
 * Origin is at the foot of the post; the face looks along +z.
 */
export function buildSignGeometry(value: number, options: SignFaceOptions): SignBuffers {
	// Real boards are smaller, but this one has to be read from a moving cab
	// at 40+ m, which is the distance the driver actually needs it at.
	// Sized up from 1.7/2.3: at the offset these stand from the track they read
	// as postage stamps from the cab.
	const width = options.width ?? 2.1;
	const postHeight = options.postHeight ?? 2.7;
	const bg = hexToRgb(options.background);
	const border = hexToRgb(options.border);
	const ink = hexToRgb(options.text);
	const post: RGB = [0.42, 0.42, 0.44];

	const b: Builder = {position: [], normal: [], color: [], indices: []};

	// Post
	quad(b, -0.06, 0, 0.12, postHeight, -0.03, post);

	const round = options.shape === 'disc';
	const isTriangle = options.shape === 'triangle';
	const height = round ? width : width * (options.shape === 'plate' ? 0.62 : 0.9);
	const left = -width / 2;
	const bottom = postHeight;

	if (round) {
		disc(b, 0, bottom + width / 2, width / 2, 0, border);
		disc(b, 0, bottom + width / 2, width / 2 - 0.09, 0.01, bg);
	} else if (isTriangle) {
		// Equilateral-ish, point up, sitting on the post.
		const triHeight = width * 0.92;

		triangle(b, 0, bottom, width / 2, triHeight, 0, border);
		triangle(b, 0, bottom + 0.12, width / 2 - 0.14, triHeight - 0.26, 0.01, bg);
	} else {
		quad(b, left, bottom, width, height, 0, border);
		quad(b, left + 0.07, bottom + 0.07, width - 0.14, height - 0.14, 0.01, bg);
	}

	// Numerals, centred on the face. A triangle's usable area is the lower
	// half, so digits sit lower and smaller than on a square board.
	const text = String(Math.round(value));
	const digitHeight = height * (isTriangle ? 0.34 : 0.5);
	const digitWidth = digitHeight * 0.52;
	const gap = digitWidth * 0.22;
	const totalWidth = text.length * digitWidth + (text.length - 1) * gap;
	let penX = -totalWidth / 2;
	const digitBottom = isTriangle
		? bottom + width * 0.16
		: bottom + (height - digitHeight) / 2;

	for (const ch of text) {
		const segments = DIGITS[ch] ?? [];
		for (const key of segments) {
			const [sx, sy, sw, sh] = SEG[key];
			quad(
				b,
				penX + sx * digitWidth,
				digitBottom + (sy / 2) * digitHeight,
				sw * digitWidth,
				(sh / 2) * digitHeight,
				0.02,
				ink,
			);
		}
		penX += digitWidth + gap;
	}

	return {
		position: new Float32Array(b.position),
		normal: new Float32Array(b.normal),
		color: new Float32Array(b.color),
		indices: new Uint32Array(b.indices),
	};
}
