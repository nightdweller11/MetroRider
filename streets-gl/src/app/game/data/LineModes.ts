import type {TransportMode} from '../limits/SignStyle';

/**
 * What kind of service a line runs.
 *
 * MetroDreamin stores a mode on every line and we have been throwing it away,
 * guessing instead from station spacing. The guess is decent for railways and
 * wrong for everything else: a bus route through a town centre has metro-like
 * spacing, so it was signed and driven as a metro at 90 km/h.
 *
 * The keys are MetroDreamin's own, read off real maps rather than assumed —
 * `BUS`, `TRAM`, `LIGHT`, `RAPID`, `REGIONAL`, `HSR`, `FERRY`, `GONDOLA`,
 * `AIR`, with the field ABSENT on older lines. Sampled across three published
 * maps: London Underground was 30 absent / 18 REGIONAL / 4 RAPID / 4 LIGHT,
 * and one large map used all nine.
 */

export type LineMode =
	| 'bus' | 'tram' | 'light' | 'rapid' | 'regional' | 'hsr'
	| 'ferry' | 'gondola' | 'air';

export interface LineModeInfo {
	/** What it is called, in a sentence. */
	label: string;
	/** Single glyph for the picker badge. */
	icon: string;
	/** Nothing on this kind of line goes faster than this, km/h. */
	topKmh: number;
	/** The slowest limit the profile should ever post on it, km/h. */
	floorKmh: number;
	/** How long it waits at a stop, seconds. */
	dwellSec: number;
	/**
	 * How hard it pulls away and how hard it stops, relative to a metro.
	 *
	 * A tram is light and gets going briskly from a stop; a high-speed train is
	 * heavy, winds up slowly, and needs a long way to pull up — but keeps going
	 * far past where the tram gave up. These are FEEL, not physics: the base
	 * rate is already generous so a child is not waiting a minute to reach line
	 * speed, and these only spread the modes apart around it.
	 */
	accelScale: number;
	brakeScale: number;
	/** Which signage this service is given. */
	sign: TransportMode;
	/** Runs on rails through streets and countryside — as opposed to water or air. */
	onTrack: boolean;
	/**
	 * The vehicles this kind of line runs, when the player has not chosen their
	 * own. Model ids from the asset catalog; empty means "no opinion, keep
	 * whatever is configured".
	 *
	 * Only used for a player who has never picked a train. A chosen consist is
	 * a choice and is never overridden.
	 */
	consist: string[];
}

/*
 * Top speeds are what the service actually runs at, not what the vehicle could
 * do on a test track: a city bus is limited by the street, a tram by sharing
 * it, a metro by the distance between stops. These are the numbers that decide
 * whether driving a bus route FEELS like a bus route.
 */
/*
 * Default consists, from the shipped asset catalog.
 *
 * The `-a` / `-b` / `-c` models are front / middle / rear cars of the same
 * family, so a set reads as one train rather than three unrelated vehicles.
 * A bus is ONE vehicle — a three-car bus would be a road train.
 *
 * Ferry and air have no boat or aircraft model in the catalog, so they state
 * no opinion rather than putting a train on the water: an honest default is
 * better than a confident wrong one.
 */
const METRO_SET = ['train-electric-subway-a', 'train-electric-subway-b', 'train-electric-subway-c'];
const CITY_SET = ['train-electric-city-a', 'train-electric-city-b', 'train-electric-city-c'];
const BULLET_SET = ['train-electric-bullet-a', 'train-electric-bullet-b', 'train-electric-bullet-c'];
const TRAM_SET = ['train-tram-modern', 'train-tram-modern'];

const MODES: Record<LineMode, LineModeInfo> = {
	/*
	 * ONE vehicle — a three-car bus would be a road train.
	 *
	 * This model spent a release with no default because it rendered as a black
	 * slab in game while looking correct in its own preview. It carries 20
	 * materials and 2 images across 34 primitives, and a merged mesh keeps only
	 * ONE base-colour map — a near-black 1024x128 strip, as it turned out, with
	 * a transparent pixel at (0, 0). Every untextured part was sampling that
	 * corner. The per-vertex `texFlag` was written to stop exactly that and was
	 * never passed through to the mesh, so it could not: measured on the live
	 * model, 0 of 72,469 vertices carried it. Wiring it through is what made
	 * the bus red and white.
	 */
	bus:      {label: 'Bus',              icon: '🚌', topKmh: 50,  floorKmh: 20, dwellSec: 20, sign: 'tram',       onTrack: true,  accelScale: 1.20, brakeScale: 1.20, consist: ['generic-town-bus']},
	tram:     {label: 'Tram',             icon: '🚋', topKmh: 60,  floorKmh: 20, dwellSec: 20, sign: 'tram',       onTrack: true,  accelScale: 1.15, brakeScale: 1.15, consist: TRAM_SET},
	light:    {label: 'Light rail',       icon: '🚈', topKmh: 80,  floorKmh: 25, dwellSec: 25, sign: 'light-rail', onTrack: true,  accelScale: 1.05, brakeScale: 1.05, consist: ['train-tram-round', 'train-tram-round', 'train-tram-round']},
	rapid:    {label: 'Metro',            icon: '🚇', topKmh: 90,  floorKmh: 30, dwellSec: 25, sign: 'metro',      onTrack: true,  accelScale: 1.00, brakeScale: 1.00, consist: METRO_SET},
	regional: {label: 'Regional train',   icon: '🚆', topKmh: 200, floorKmh: 40, dwellSec: 40, sign: 'rail',       onTrack: true,  accelScale: 0.80, brakeScale: 0.80, consist: CITY_SET},
	hsr:      {label: 'High-speed train', icon: '🚄', topKmh: 300, floorKmh: 60, dwellSec: 60, sign: 'rail',       onTrack: true,  accelScale: 0.60, brakeScale: 0.65, consist: BULLET_SET},
	ferry:    {label: 'Ferry',            icon: '⛴️', topKmh: 35,  floorKmh: 15, dwellSec: 90, sign: 'tram',       onTrack: false, accelScale: 0.45, brakeScale: 0.45, consist: []},
	gondola:  {label: 'Cable car',        icon: '🚠', topKmh: 25,  floorKmh: 15, dwellSec: 20, sign: 'tram',       onTrack: false, accelScale: 0.70, brakeScale: 0.90, consist: ['funicular']},
	air:      {label: 'Air route',        icon: '✈️', topKmh: 300, floorKmh: 60, dwellSec: 60, sign: 'rail',       onTrack: false, accelScale: 0.60, brakeScale: 0.65, consist: []},
};

/**
 * MetroDreamin's default when a line has no mode set.
 *
 * Their editor draws such lines as rapid transit, and on the maps sampled the
 * absent-mode lines are the metro lines themselves — the London Underground
 * lines are all in that bucket.
 */
const DEFAULT_MODE: LineMode = 'rapid';

const FROM_MD: Record<string, LineMode> = {
	BUS: 'bus',
	TRAM: 'tram',
	LIGHT: 'light',
	RAPID: 'rapid',
	REGIONAL: 'regional',
	HSR: 'hsr',
	FERRY: 'ferry',
	GONDOLA: 'gondola',
	AIR: 'air',
};

/** Read MetroDreamin's mode string. Anything unrecognised drives as a metro. */
export function parseLineMode(raw: string | undefined | null): LineMode {
	if (!raw) return DEFAULT_MODE;

	return FROM_MD[String(raw).trim().toUpperCase()] ?? DEFAULT_MODE;
}

export function lineModeInfo(mode: LineMode | undefined): LineModeInfo {
	return MODES[mode ?? DEFAULT_MODE] ?? MODES[DEFAULT_MODE];
}

/**
 * Fall back to reading the line, for maps that carry no mode at all.
 *
 * This is the guess that used to be the ONLY answer (it lived in
 * `SpeedLimitSystem.inferMode`). It stays as the fallback because a hand-drawn
 * map with no modes set still has to be signed as something, and station
 * spacing genuinely separates a tram from a main line.
 */
export function inferLineMode(
	lineName: string, totalLength: number, stationCount: number,
): LineMode {
	const name = lineName.toLowerCase();

	if (name.includes('ferry')) return 'ferry';
	if (name.includes('bus')) return 'bus';
	if (name.includes('tram') || name.includes('streetcar')) return 'tram';
	if (name.includes('light rail') || name.includes('lrt')) return 'light';
	if (name.includes('metro') || name.includes('subway') || name.includes('underground')) return 'rapid';

	const spacing = stationCount > 1 ? totalLength / (stationCount - 1) : totalLength;

	if (spacing < 600) return 'tram';
	if (spacing < 1800) return 'rapid';

	return 'regional';
}
