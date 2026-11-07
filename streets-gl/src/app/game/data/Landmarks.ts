/**
 * Which places go on the network map.
 *
 * Two kinds, both real:
 *
 * - **Found** — places you have come across (the journey record's
 *   `placeMarks`), drawn lit. Only the ones on THIS map: the record spans
 *   every city you have driven.
 * - **Still to find** — named places in the streets loaded so far that the
 *   discovery check would find from this map's lines (within
 *   `DISCOVER_RADIUS_M` of the track, and important enough by the same
 *   `worthFinding` rule), drawn dim, unnamed until you find them.
 *
 * "Loaded so far" is the honest limit: the game only knows the labels of the
 * streets it has streamed in, which is the country around where you have been.
 * It does not invent places along the rest of the line.
 *
 * Pure. Positions are world metres (the units the tiles' labels and the
 * discovery check use); the caller turns the lines' lat/lng into the same.
 */

import {DISCOVER_RADIUS_M, tidyName, worthFinding, type NamedPlace} from './Discovery';

export interface WorldPoint {
	x: number;
	z: number;
}

export interface MapLandmark {
	name: string;
	x: number;
	z: number;
	/** Found places carry their name on the map; the rest are just a pin. */
	labelled: boolean;
}

/**
 * The most still-to-find pins on the map at once.
 *
 * A map that already carries lines, station dots and change rings has room
 * for a few more marks and not a field of them. Twelve says "there is more out
 * there" without hiding the network. Measured: after six stations of
 * Jerusalem Light Rail, 75 places qualified (of 257 worth-finding labels
 * loaded); all of them drawn would bury the station names they sit beside.
 */
export const MAX_TO_FIND = 12;
/**
 * The most found places named on the map. Every found place on the map gets
 * its pin; only the most recent eight get their name written beside it, so a
 * player with sixty finds still sees a map rather than a page of words.
 */
export const MAX_FOUND_LABELS = 8;
/** The most still-to-find candidates handed to the drawing, before spacing. */
export const MAX_CANDIDATES = 200;
/** The most found pins drawn at all (the most recent). */
export const MAX_FOUND = 80;
/** Segments longer than this are not searched along (see `Corridor`). */
const MAX_SEGMENT_M = 100_000;
/** How far outside the network's own extent a find still counts as on it. */
const NETWORK_MARGIN = 2000;

/** Squared distance from a point to a segment. */
function distanceToSegment2(px: number, pz: number, a: WorldPoint, b: WorldPoint): number {
	const dx = b.x - a.x, dz = b.z - a.z;
	const len2 = dx * dx + dz * dz;
	const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / len2));
	const cx = a.x + t * dx - px, cz = a.z + t * dz - pz;

	return cx * cx + cz * cz;
}

/**
 * "Is this point within `radius` of any line?" — fast enough for thousands
 * of labels against thousands of segments, by bucketing segments into a grid.
 */
export class Corridor {
	private readonly cells = new Map<string, Set<number>>();
	private readonly segments: [WorldPoint, WorldPoint][] = [];
	private readonly cell: number;

	public constructor(lines: readonly (readonly WorldPoint[])[], private readonly radius: number) {
		// Cells twice the radius wide; each segment is sampled every half
		// radius and registered in the 3×3 cells around each sample. Any point
		// within `radius` of the segment is within 1.25 × radius of a sample,
		// so it lands in one of those cells.
		this.cell = radius * 2;

		const step = radius / 2;

		for (const line of lines) {
			for (let i = 0; i + 1 < line.length; i++) {
				const a = line[i], b = line[i + 1];
				const length = Math.hypot(b.x - a.x, b.z - a.z);

				// A flight map's legs cross oceans. Nothing is found from the
				// middle of a 2000 km leg, and sampling it would cost seconds.
				if (!Number.isFinite(length) || length > MAX_SEGMENT_M) continue;

				const index = this.segments.push([a, b]) - 1;
				const samples = Math.max(1, Math.ceil(length / step));

				for (let k = 0; k <= samples; k++) {
					const t = k / samples;
					const cx = Math.floor((a.x + (b.x - a.x) * t) / this.cell);
					const cz = Math.floor((a.z + (b.z - a.z) * t) / this.cell);

					for (let dx = -1; dx <= 1; dx++) {
						for (let dz = -1; dz <= 1; dz++) {
							const key = `${cx + dx},${cz + dz}`;
							const set = this.cells.get(key);

							if (set) set.add(index);
							else this.cells.set(key, new Set([index]));
						}
					}
				}
			}
		}
	}

	public near(x: number, z: number): boolean {
		const set = this.cells.get(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`);

		if (!set) return false;

		const r2 = this.radius * this.radius;

		for (const index of set) {
			const [a, b] = this.segments[index];

			if (distanceToSegment2(x, z, a, b) <= r2) return true;
		}

		return false;
	}
}

/** The network's extent, grown by `margin`. */
function extent(lines: readonly (readonly WorldPoint[])[], margin: number): {
	minX: number; maxX: number; minZ: number; maxZ: number;
} {
	let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

	for (const line of lines) {
		for (const p of line) {
			minX = Math.min(minX, p.x);
			maxX = Math.max(maxX, p.x);
			minZ = Math.min(minZ, p.z);
			maxZ = Math.max(maxZ, p.z);
		}
	}

	return {minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin};
}

export function selectLandmarks(input: {
	/** The map's lines, in world metres. */
	lines: readonly (readonly WorldPoint[])[];
	/** Every named place in the loaded tiles. */
	places: readonly NamedPlace[];
	/** The journey record's finds with positions, oldest first. */
	marks: readonly {n: string; x: number; z: number}[];
	/** Every place name found (some old finds have no position). */
	found: ReadonlySet<string>;
	radius?: number;
}): {found: MapLandmark[]; toFind: MapLandmark[]} {
	const radius = input.radius ?? DISCOVER_RADIUS_M;

	if (input.lines.every(l => l.length === 0)) return {found: [], toFind: []};

	const box = extent(input.lines, NETWORK_MARGIN);
	const inBox = (x: number, z: number): boolean => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;

	// Found: on this map, one pin per name, the most recent kept.
	const seen = new Set<string>();
	const found: MapLandmark[] = [];

	for (let i = input.marks.length - 1; i >= 0 && found.length < MAX_FOUND; i--) {
		const m = input.marks[i];

		if (!Number.isFinite(m.x) || !Number.isFinite(m.z) || !inBox(m.x, m.z) || seen.has(m.n)) continue;

		seen.add(m.n);
		found.push({name: m.n, x: m.x, z: m.z, labelled: found.length < MAX_FOUND_LABELS});
	}

	found.reverse();

	// Still to find: what the discovery check would announce from the line.
	const corridor = new Corridor(input.lines, radius);
	const best = new Map<string, NamedPlace>();

	for (const place of input.places) {
		if (!worthFinding(place) || !inBox(place.x, place.z)) continue;

		const name = tidyName(place.name);

		if (input.found.has(name)) continue;

		const prior = best.get(name);

		if (prior && prior.priority >= place.priority) continue;
		if (!corridor.near(place.x, place.z)) continue;

		best.set(name, {...place, name});
	}

	// Not capped at MAX_TO_FIND here: which twelve can be drawn depends on
	// how they spread out once projected (`pickVisible`). Capping first would
	// spend the twelve on one cluster and then thin it to a single pin.
	const toFind = [...best.values()]
		.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))
		.slice(0, MAX_CANDIDATES)
		.map(p => ({name: p.name, x: p.x, z: p.z, labelled: false}));

	return {found, toFind};
}

/**
 * Thin out marks that would land on top of each other on the drawn map.
 *
 * Positions are in the picture's own units, so this runs after projection:
 * two places 200 m apart are one blob on a whole-country map and two clear
 * pins on a city one. Earlier items win — the caller passes them most
 * important first. Returns, for each item, whether to draw it.
 */
export function spacedOut(points: readonly {x: number; y: number}[], minGap: number): boolean[] {
	const kept: {x: number; y: number}[] = [];

	return points.map(p => {
		if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
		if (kept.some(k => Math.hypot(k.x - p.x, k.y - p.y) < minGap)) return false;

		kept.push(p);

		return true;
	});
}

/**
 * Which still-to-find pins to draw: in order (most important first), each one
 * that keeps `minGap` from every found pin and every pin already chosen, up to
 * `max`. Spacing comes before the cap, so a cluster costs one pin, not twelve.
 */
export function pickVisible(
	found: readonly {x: number; y: number}[],
	toFind: readonly {x: number; y: number}[],
	minGap: number,
	max: number = MAX_TO_FIND,
): boolean[] {
	let kept = 0;
	const shown = spacedOut([...found, ...toFind], minGap).slice(found.length);

	return shown.map(ok => {
		if (!ok || kept >= max) return false;

		kept++;

		return true;
	});
}
