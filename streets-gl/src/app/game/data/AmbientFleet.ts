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
 * The stock each kind of line runs, in the order it is preferred.
 *
 * Ferry and air are deliberately empty: the ferry has its own hull built in
 * code, and nothing in the catalogue is an aeroplane. Empty means "use the
 * procedural body", which is the honest answer rather than putting a tram on
 * the water.
 */
export const AMBIENT_POOLS: Record<LineMode, string[]> = {
	bus: ['generic-town-bus'],
	tram: ['train-tram-modern', 'train-tram-classic', 'train-tram-round'],
	light: ['train-tram-modern', 'train-electric-city-a', 'train-electric-city-b'],
	rapid: [
		'train-electric-subway-a', 'train-electric-subway-b', 'train-electric-subway-c',
		'moscow-metro-81-717', 'metro-car-ezh3',
	],
	regional: [
		'train-electric-double-a', 'train-electric-double-b',
		'train-electric-square-a', 'train-diesel-a', 'train-diesel-b',
	],
	hsr: ['train-electric-bullet-a', 'train-electric-bullet-b', 'train-electric-bullet-c'],
	ferry: [],
	gondola: ['funicular'],
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

/** The model a service should run, or `PROCEDURAL` when none fits. */
export function ambientModelFor(mode: LineMode | undefined, lineKey: string, index: number): string {
	const pool = AMBIENT_POOLS[mode ?? 'rapid'] ?? [];

	if (pool.length === 0) return PROCEDURAL;

	return pool[seedFrom(lineKey ?? '', index) % pool.length];
}

/**
 * Every model a line's traffic could want, so they can be loaded together.
 *
 * The whole pool rather than only the ones this fleet picked: the fleet is
 * respawned as the player drives up and down, and loading the two it happens
 * to want now would fetch again the moment the third comes up.
 */
export function ambientModelsFor(mode: LineMode | undefined): string[] {
	return AMBIENT_POOLS[mode ?? 'rapid'] ?? [];
}
