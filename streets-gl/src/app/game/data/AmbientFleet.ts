/**
 * What the OTHER trains look like.
 *
 * Passing traffic has always been the procedural box — one grey-blue shape,
 * repeated, for every service on every line in every city. The reason given in
 * the code was that a train seen for two seconds is not worth a set of GLB
 * loads. That was true when the fleet was first written and is not true now:
 * the whole catalogue is thirty-five models, the loader and cache already
 * exist for the player's own consist, and the entire ambient fleet is NINE
 * cars — fewer than the player is often driving themselves.
 *
 * So other services get real trains, and they vary. Two things make that worth
 * having rather than merely different:
 *
 *  - the stock SUITS the line. A bus route runs the bus, a tram route runs
 *    trams, a metro runs metro cars and a high-speed line runs bullet trains.
 *    Variety that ignores the kind of railway is just noise.
 *  - a given service keeps its train. The pick is derived from the line and
 *    the service's place in the fleet, so it is stable across rebuilds rather
 *    than reshuffling every time the fleet is respawned.
 *
 * Pure: a mode and a seed in, a model id out.
 */

import type {LineMode} from './LineModes';

/**
 * One kind of train: a front, a middle and a rear.
 *
 * The catalogue's `-a` / `-b` / `-c` families are exactly that — measured:
 * subway `-a` and `-c` are both 5.78 m and mirror each other (cabs), `-b` is
 * 7.09 m (a carriage). Treating a family as three interchangeable models and
 * repeating ONE of them made every ambient train three front cabs nose to
 * tail, which is what it looked like.
 *
 * Single vehicles — a bus, a tram, a metro car — name themselves in all three
 * places, because that is what a single vehicle is.
 */
export interface AmbientStock {
	front: string;
	middle: string;
	rear: string;
}

function unit(id: string): AmbientStock {
	return {front: id, middle: id, rear: id};
}

function family(base: string): AmbientStock {
	return {front: `${base}-a`, middle: `${base}-b`, rear: `${base}-c`};
}

/**
 * The stock each kind of line runs.
 *
 * Ferry and air are deliberately empty: the ferry has its own hull built in
 * code, and nothing in the catalogue is an aeroplane. Empty means "use the
 * procedural body", which is the honest answer rather than putting a tram on
 * the water.
 */
export const AMBIENT_POOLS: Record<LineMode, AmbientStock[]> = {
	bus: [unit('generic-town-bus')],
	tram: [unit('train-tram-modern'), unit('train-tram-classic'), unit('train-tram-round')],
	light: [unit('train-tram-modern'), family('train-electric-city')],
	rapid: [
		family('train-electric-subway'),
		unit('moscow-metro-81-717'),
		unit('metro-car-ezh3'),
	],
	regional: [
		family('train-electric-double'),
		family('train-electric-square'),
		family('train-diesel'),
	],
	hsr: [family('train-electric-bullet')],
	ferry: [],
	gondola: [unit('funicular')],
	air: [],
};

/** Nothing in the catalogue fits — the caller falls back to the built-in body. */
export const PROCEDURAL = '';

/**
 * A small stable hash, so the same line and service always pick the same train.
 *
 * Not `Math.random`: a fleet that reshuffles every time it respawns — which is
 * every time you change direction — reads as the world glitching rather than
 * as variety.
 */
export function seedFrom(text: string, index: number): number {
	let h = 2166136261 ^ index;

	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}

	return Math.abs(h);
}

/** The kind of train a service should run, or null when none fits. */
export function ambientStockFor(
	mode: LineMode | undefined, lineKey: string, index: number,
): AmbientStock | null {
	const pool = AMBIENT_POOLS[mode ?? 'rapid'] ?? [];

	if (pool.length === 0) return null;

	return pool[seedFrom(lineKey ?? '', index) % pool.length];
}

/**
 * The models for one train, front to back.
 *
 * A two-car train is a front and a rear with no middle; a one-car train is
 * just the front, which for a single vehicle is the vehicle.
 */
export function ambientConsistFor(
	mode: LineMode | undefined, lineKey: string, index: number, cars: number,
): string[] {
	const stock = ambientStockFor(mode, lineKey, index);
	const count = Math.max(1, Math.floor(cars));

	if (!stock) return new Array(count).fill(PROCEDURAL);
	if (count === 1) return [stock.front];

	return [
		stock.front,
		...new Array(count - 2).fill(stock.middle),
		stock.rear,
	];
}

/**
 * Every model a line's traffic could want, so they can be loaded together.
 *
 * The whole pool rather than only the ones this fleet picked: the fleet is
 * respawned as the player drives up and down, and loading the two it happens
 * to want now would fetch again the moment the third comes up.
 */
export function ambientModelsFor(mode: LineMode | undefined): string[] {
	const pool = AMBIENT_POOLS[mode ?? 'rapid'] ?? [];

	return [...new Set(pool.flatMap(s => [s.front, s.middle, s.rear]))];
}
