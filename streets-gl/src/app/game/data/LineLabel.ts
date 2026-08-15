/**
 * What a line is called, short enough for a badge.
 *
 * Real timetables name a service by the pair of codes at its ends — "A1 - A2
 * Sharon Local - Ayalon Local" is the A1 to A2. Taking only the first code
 * makes four different services on the built-in map all read "A1", and two
 * more read "C6": the picker showed a column of identical badges against
 * different routes, which is worse than showing nothing, because it looks like
 * information.
 *
 * Pure and separate so the picker, the minimap caption and anything else that
 * needs to name a line all say the same thing.
 */

/** One code: a letter or two, then a number or two. */
const CODE = '[A-Z]{1,2}\\d{1,2}';
/** A pair of them, in either the "A1 - A2" or "A1-A2" style. */
const PAIR = new RegExp(`^(${CODE})\\s*[-–—]\\s*(${CODE})\\b`);
const SINGLE = new RegExp(`^(${CODE})\\b`);

/**
 * The code a line is known by, or null when its name does not carry one.
 *
 * Returns the PAIR when there is one, because that is the line's identity.
 */
export function lineCode(name: string | undefined): string | null {
	if (!name) return null;

	const pair = name.match(PAIR);

	if (pair) return `${pair[1]}-${pair[2]}`;

	const single = name.match(SINGLE);

	return single ? single[1] : null;
}

/**
 * A badge for the picker: the code, or a plain number so every row still has
 * something to be identified by.
 */
export function lineBadge(name: string | undefined, index: number): string {
	return lineCode(name) ?? String(index + 1);
}

/**
 * The name without its leading code, for when the code is shown beside it.
 *
 * "A1 - A2 Sharon Local - Ayalon Local" reads as "Sharon Local - Ayalon
 * Local"; a name with no code is returned whole.
 */
export function lineNameWithoutCode(name: string | undefined): string {
	if (!name) return '';

	const stripped = name
		.replace(PAIR, '')
		.replace(SINGLE, '')
		.replace(/^\s*[-–—:]\s*/, '')
		.trim();

	return stripped || name;
}

/** A caption-sized label: the code if there is one, else a trimmed name. */
export function lineShortLabel(name: string | undefined): string {
	const code = lineCode(name);

	if (code) return code;
	if (!name) return '';

	return name.length > 14 ? `${name.slice(0, 13).trimEnd()}…` : name;
}
