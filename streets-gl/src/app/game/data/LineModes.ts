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
	/** Which signage this service is given. */
	sign: TransportMode;
	/** Runs on rails through streets and countryside — as opposed to water or air. */
	onTrack: boolean;
}

/*
 * Top speeds are what the service actually runs at, not what the vehicle could
 * do on a test track: a city bus is limited by the street, a tram by sharing
 * it, a metro by the distance between stops. These are the numbers that decide
 * whether driving a bus route FEELS like a bus route.
 */
const MODES: Record<LineMode, LineModeInfo> = {
	bus:      {label: 'Bus',              icon: '🚌', topKmh: 50,  floorKmh: 20, dwellSec: 20, sign: 'tram',       onTrack: true},
	tram:     {label: 'Tram',             icon: '🚋', topKmh: 60,  floorKmh: 20, dwellSec: 20, sign: 'tram',       onTrack: true},
	light:    {label: 'Light rail',       icon: '🚈', topKmh: 80,  floorKmh: 25, dwellSec: 25, sign: 'light-rail', onTrack: true},
	rapid:    {label: 'Metro',            icon: '🚇', topKmh: 90,  floorKmh: 30, dwellSec: 25, sign: 'metro',      onTrack: true},
	regional: {label: 'Regional train',   icon: '🚆', topKmh: 160, floorKmh: 40, dwellSec: 40, sign: 'rail',       onTrack: true},
	hsr:      {label: 'High-speed train', icon: '🚄', topKmh: 300, floorKmh: 60, dwellSec: 60, sign: 'rail',       onTrack: true},
	ferry:    {label: 'Ferry',            icon: '⛴️', topKmh: 35,  floorKmh: 15, dwellSec: 90, sign: 'tram',       onTrack: false},
	gondola:  {label: 'Cable car',        icon: '🚠', topKmh: 25,  floorKmh: 15, dwellSec: 20, sign: 'tram',       onTrack: false},
	air:      {label: 'Air route',        icon: '✈️', topKmh: 300, floorKmh: 60, dwellSec: 60, sign: 'rail',       onTrack: false},
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
