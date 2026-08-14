/**
 * A working timetable for the line being driven.
 *
 * Pure functions over station distances so the schedule can be reasoned about
 * and tested without an engine, a clock or a train.
 *
 * The times are built from the line's REAL station spacing rather than a flat
 * few minutes per stop, because the lines this game loads are nothing like
 * uniform — one of them has a 1.3 km hop and a 15 km run on the same route. A
 * schedule that ignored that would call the same driving early at one stop and
 * hopelessly late at the next.
 */

/** Assumed running speed between stops, km/h. Below the limit, as real timetables are. */
const CRUISE_KMH = 70;
/** Seconds lost to slowing, standing and getting away again, per stop. */
const DWELL_S = 45;
/** Slack per stop so a competent run is on time rather than permanently late. */
const RECOVERY_S = 20;

export interface ServiceStop {
	stationIndex: number;
	/** Epoch milliseconds this stop is due. */
	dueAt: number;
}

/**
 * Due times for every stop, starting from `departAt` at the first one.
 *
 * `stationDists` are metres along the track, in order.
 */
export function buildTimetable(stationDists: number[], departAt: number): ServiceStop[] {
	const stops: ServiceStop[] = [];
	let when = departAt;

	for (let i = 0; i < stationDists.length; i++) {
		if (i > 0) {
			const leg = Math.max(0, stationDists[i] - stationDists[i - 1]);
			const runS = leg / (CRUISE_KMH / 3.6);

			when += (runS + DWELL_S + RECOVERY_S) * 1000;
		}

		stops.push({stationIndex: i, dueAt: when});
	}

	return stops;
}

/**
 * How late, in seconds. Negative is early.
 *
 * Returns null when there is nothing to compare against, rather than a
 * plausible-looking zero — "no schedule" and "exactly on time" are different
 * answers and the interface says so.
 */
export function latenessSeconds(stop: ServiceStop | undefined, atEpochMs: number): number | null {
	if (!stop) return null;

	return Math.round((atEpochMs - stop.dueAt) / 1000);
}

/** How a driver would say it. */
export function describeLateness(seconds: number | null): string {
	if (seconds === null) return '';

	if (seconds <= -60) return `${Math.round(-seconds / 60)} min early`;
	if (seconds < 45) return 'on time';

	return `${Math.round(seconds / 60)} min late`;
}

/** Clock face for a due time, in the player's own local convention. */
export function clockFace(epochMs: number): string {
	const when = new Date(epochMs);
	const hh = String(when.getHours()).padStart(2, '0');
	const mm = String(when.getMinutes()).padStart(2, '0');

	return `${hh}:${mm}`;
}
