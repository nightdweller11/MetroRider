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

/** Fallback running speed where the line has no speed profile yet, km/h. */
const CRUISE_KMH = 70;
/**
 * What fraction of the permitted speed a leg actually averages, once getting
 * away from a stand and braking into the next one are counted. A schedule
 * written at the bare limit is one no driver can keep.
 */
const REALISM = 0.82;

/** A stretch of line with a speed limit, in metres and metres per second. */
export interface SpeedLimitSegment {
	startDist: number;
	endDist: number;
	/** Metres per second. */
	limit: number;
}

/**
 * How long a leg takes at the speeds the line actually permits.
 *
 * This matters more than it sounds. The first version scheduled every leg at a
 * flat 70 km/h, which is fine on fast track and impossible where the limit is
 * 40 — and Simple driving holds the limit exactly, so a child driving properly
 * would have been permanently and increasingly late through no fault of their
 * own. Integrating the real profile makes the same schedule keepable in both
 * driving modes.
 */
export function legRunSeconds(
	segments: SpeedLimitSegment[],
	fromDist: number,
	toDist: number,
): number {
	const a = Math.min(fromDist, toDist);
	const b = Math.max(fromDist, toDist);
	const span = b - a;

	if (span <= 0) return 0;

	if (segments.length === 0) return span / ((CRUISE_KMH / 3.6) * REALISM);

	let covered = 0;
	let seconds = 0;

	for (const segment of segments) {
		const start = Math.max(a, segment.startDist);
		const end = Math.min(b, segment.endDist);

		if (end <= start || segment.limit <= 0) continue;

		seconds += (end - start) / (segment.limit * REALISM);
		covered += end - start;
	}

	// Anything the profile does not cover runs at the fallback rather than
	// silently taking zero time.
	if (covered < span) {
		seconds += (span - covered) / ((CRUISE_KMH / 3.6) * REALISM);
	}

	return seconds;
}
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
export function buildTimetable(
	stationDists: number[],
	departAt: number,
	direction: number = 1,
	fromDist: number = -Infinity,
	segments: SpeedLimitSegment[] = [],
): ServiceStop[] {
	// Travel order from WHERE THE TRAIN IS, not index order from the end of the
	// line. Two things go wrong otherwise. Driving the line the other way
	// visits the stations in reverse, so an index-ordered schedule gives the
	// stops ahead times already gone by. And scheduling from the far end means
	// a service that starts at a station the driver is nowhere near: measured
	// after turning around at the first stop, the next stop read 96 minutes
	// early because its due time came from the far end of a reversed list.
	const ahead = stationDists
		.map((d, i) => ({d, i}))
		.filter(s => (direction < 0 ? s.d < fromDist : s.d > fromDist));

	ahead.sort((a, b) => (direction < 0 ? b.d - a.d : a.d - b.d));

	const stops: ServiceStop[] = [];
	let when = departAt;
	let previous = Number.isFinite(fromDist) ? fromDist : ahead[0]?.d ?? 0;

	for (const stop of ahead) {
		const runS = legRunSeconds(segments, previous, stop.d);

		when += (runS + DWELL_S + RECOVERY_S) * 1000;
		previous = stop.d;

		stops.push({stationIndex: stop.i, dueAt: when});
	}

	return stops;
}

/** The scheduled stop for a station, wherever it sits in the running order. */
export function stopFor(stops: ServiceStop[], stationIndex: number): ServiceStop | undefined {
	return stops.find(s => s.stationIndex === stationIndex);
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
