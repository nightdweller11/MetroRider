/**
 * How hard a curve is being taken.
 *
 * Flange squeal is not "a curve is here" — it is how close the train is to
 * what the curve will allow. Rounding a tight bend at walking pace is silent;
 * taking it near its limit is what makes the noise. So the signal is the ratio
 * of speed to the curve's own comfortable speed, which the line's speed
 * profile has already worked out for every metre of track.
 *
 * Pure, so the shape of the response can be reasoned about without an audio
 * context or a train.
 */

/** Below this share of the curve's limit, nothing is heard. */
export const QUIET_BELOW = 0.55;
/** At and above this share, it is as loud as it gets. */
export const FULL_AT = 1.05;
/**
 * A straight has no curve limit worth speaking of, so the profile posts the
 * line maximum there. Anything at or above this fraction of the line's own
 * ceiling is treated as straight track and stays silent, or a fast line would
 * sing all the way along.
 */
export const STRAIGHT_FRACTION = 0.92;
/** Under this speed there is no squeal at any radius, m/s. */
export const MIN_SPEED_MS = 5;

/**
 * How loud the squeal should be, 0 to 1.
 *
 * `curveLimit` is the speed this stretch permits and `lineMax` the fastest the
 * line allows anywhere — both in metres per second.
 */
export function squealIntensity(speed: number, curveLimit: number, lineMax: number): number {
	// An infinite curve speed is dead-straight track, which is silent — not a
	// missing value. Anything else non-finite is a bug upstream and is silent
	// for the same reason.
	if (!Number.isFinite(speed)) return 0;
	if (curveLimit === Infinity) return 0;
	if (!Number.isFinite(curveLimit)) return 0;
	if (speed < MIN_SPEED_MS || curveLimit <= 0) return 0;

	// Straight track: the profile posts the line maximum, which is not a curve.
	if (lineMax > 0 && curveLimit >= lineMax * STRAIGHT_FRACTION) return 0;

	const ratio = speed / curveLimit;

	if (ratio <= QUIET_BELOW) return 0;
	if (ratio >= FULL_AT) return 1;

	return (ratio - QUIET_BELOW) / (FULL_AT - QUIET_BELOW);
}
