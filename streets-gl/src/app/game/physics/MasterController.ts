/**
 * The master controller — one handle running P4 · P3 · P2 · P1 · N · B1 · B2.
 *
 * This lived in `CabHud` for eleven releases, which made the DRAWING the owner
 * of where the handle was. Two consequences, both shipped:
 *
 *  - Nothing outside the HUD could move it. The keyboard therefore talked
 *    straight to the physics instead, and once a train was parked on the brake
 *    (2.41.0) a keyboard player could hold the throttle for as long as they
 *    liked and never move: power wound up to full, the parked brake stayed on,
 *    and the train sat there. Measured, 0 km/h at full demand.
 *  - Anything that changed the demand without going through the panel left the
 *    drawn handle saying one thing and the train doing another.
 *
 * So the handle is a property of the TRAIN, and the panel draws it. A control
 * law belongs with the thing it controls.
 *
 * Pure: an index, and what that index asks the train for.
 */

/** Notch labels top to bottom, power above neutral, brake below. */
export const NOTCHES = ['P4', 'P3', 'P2', 'P1', 'N', 'B1', 'B2'];

/** Where neutral sits in that list. */
export const NEUTRAL_INDEX = 4;

/** Full brake — where a train that has just been set down is held. */
export const PARKED_INDEX = NOTCHES.length - 1;

/** Where a notch sits down the lever, as a percentage of its height. */
export function notchPercent(i: number): number {
	return 17 + i * 11.5;
}

/** Clamp anything to a real notch. */
export function clampNotch(index: number): number {
	if (!Number.isFinite(index)) return NEUTRAL_INDEX;

	return Math.max(0, Math.min(NOTCHES.length - 1, Math.round(index)));
}

/**
 * What a notch asks the train for.
 *
 * Power is quartered so P1 is a gentle start rather than everything at once —
 * the whole reason a real controller has steps. The brake has two: enough to
 * hold a stop, and everything.
 */
export function notchDemand(i: number): {power: number; brake: number} {
	if (i < NEUTRAL_INDEX) return {power: (NEUTRAL_INDEX - i) / NEUTRAL_INDEX, brake: 0};
	if (i > NEUTRAL_INDEX) return {power: 0, brake: i === NEUTRAL_INDEX + 1 ? 0.55 : 1};

	return {power: 0, brake: 0};
}

/**
 * One step of the handle.
 *
 * `towards` is −1 for more power and +1 for more brake, which matches both the
 * scale as drawn (power at the top) and the arrow keys as pressed.
 */
export function steppedNotch(index: number, towards: number): number {
	return clampNotch(clampNotch(index) + (towards >= 0 ? 1 : -1));
}
