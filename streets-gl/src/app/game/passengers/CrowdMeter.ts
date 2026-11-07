/**
 * How busy the platform is, as a meter.
 *
 * The destination board said "26 WAITING" — a number, which a young driver has
 * to compare in their head with numbers from other stations to know whether it
 * is a lot. A meter answers that at a glance: five bars, more lit the more
 * people are on the platform, and it drains while they board.
 *
 * The scale is fixed, not relative to the line: a full meter means a carriage-
 * load of people (60, `capacityPerCar` in the model), the same at every station
 * on every map, so "nearly full" means the same thing everywhere. Bars are
 * linear up to that point — a meter whose bars meant different head-counts at
 * different heights would be harder to read than the number.
 *
 * Pure: a head-count in, what to draw out.
 */

/** People that light every bar — one carriage-load. */
export const CROWD_FULL_AT = 60;

/** Bars on the meter. */
export const CROWD_BARS = 5;

export type CrowdLevel = 'empty' | 'few' | 'busy' | 'packed';

export interface CrowdMeterView {
	/** Bars lit, 0..CROWD_BARS. Anyone at all lights the first. */
	bars: number;
	level: CrowdLevel;
	/** The number, said the way the board says it. */
	label: string;
}

export function crowdMeter(waiting: number): CrowdMeterView {
	const n = Number.isFinite(waiting) ? Math.max(0, Math.floor(waiting)) : 0;

	if (n === 0) return {bars: 0, level: 'empty', label: 'NOBODY WAITING'};

	// Ceil, so one person lights one bar: an empty-looking meter over a
	// platform with people on it would be a lie by rounding.
	const bars = Math.min(CROWD_BARS, Math.ceil((n / CROWD_FULL_AT) * CROWD_BARS));
	const level: CrowdLevel = bars >= CROWD_BARS ? 'packed' : bars >= 3 ? 'busy' : 'few';

	return {bars, level, label: `${n} WAITING`};
}
