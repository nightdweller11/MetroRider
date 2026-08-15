/**
 * Keeping to the timetable, as a score.
 *
 * Pure functions over lateness in seconds, so the rule can be reasoned about
 * and tested without a clock, a train or a schedule.
 *
 * **Early is not a fault here, and that is a deliberate departure from the
 * original sketch**, which marked ±30 s and faded both ways. The timetable is
 * built at 82% of the permitted speed with 20 seconds of recovery at every
 * stop, so a driver who simply holds the limit arrives about half a minute
 * early per leg and is a clear two minutes early by the third station.
 * Symmetric marking would have scored good driving as a failure — and it would
 * have fought the speed limits, which are the one thing in the game already
 * telling the player to slow down. Late is the fault; early is a train doing
 * its job.
 */

/** Slack before a late arrival starts costing anything, seconds. */
export const ON_TIME_S = 30;
/** Beyond this the stop scores nothing for punctuality, seconds. */
export const ZERO_AT_S = 180;
/**
 * Points a stop is worth for being on time.
 *
 * A stop itself is worth up to 175, so at eight stops this is around 7% of a
 * run — enough that a punctual driver sees it on the card, not so much that
 * the timetable quietly becomes the game. Stopping accurately is still the
 * thing worth most.
 */
export const POINTS_PER_STOP = 15;

/**
 * How well one arrival kept its time, 0 to 1.
 *
 * `null` lateness means there was no schedule for that stop — an unknown, not
 * a zero, so the caller drops it from the average rather than marking the
 * driver down for the game's own missing data.
 */
export function arrivalMark(lateSeconds: number | null): number | null {
	if (lateSeconds === null || !Number.isFinite(lateSeconds)) return null;

	if (lateSeconds <= ON_TIME_S) return 1;
	if (lateSeconds >= ZERO_AT_S) return 0;

	return 1 - (lateSeconds - ON_TIME_S) / (ZERO_AT_S - ON_TIME_S);
}

/** The run's punctuality, as a whole percentage. `null` when nothing was timed. */
export function punctualityPercent(marks: (number | null)[]): number | null {
	const scored = marks.filter((m): m is number => m !== null);

	if (scored.length === 0) return null;

	const mean = scored.reduce((sum, m) => sum + m, 0) / scored.length;

	return Math.round(mean * 100);
}

/** The bonus a run earns for keeping its times. Never negative. */
export function punctualityBonus(percent: number | null, stopsTimed: number): number {
	if (percent === null || stopsTimed <= 0) return 0;

	return Math.max(0, Math.round((percent / 100) * POINTS_PER_STOP * stopsTimed));
}

/** How many arrivals were properly late, for the sentence on the card. */
export function lateArrivals(latenessSeconds: (number | null)[]): number {
	return latenessSeconds.filter(s => s !== null && s > ON_TIME_S).length;
}

/** One line a nine-year-old can read. */
export function describePunctuality(percent: number | null, lateCount: number): string {
	if (percent === null) return '';

	if (percent >= 100) return 'every stop on time';
	if (percent >= 90) return `${percent}% on time`;

	const late = lateCount === 1 ? '1 stop late' : `${lateCount} stops late`;

	return `${percent}% on time · ${late}`;
}
