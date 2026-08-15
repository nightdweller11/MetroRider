/**
 * The route ribbon — the strip of stops across the top of the screen.
 *
 * It drew a fixed twelve dots whatever the line, and put the "you are here"
 * marker at a FRACTION along it rather than on a stop. So on a 21-station line
 * it showed 21 stations as 12 dots and the marker sat between them: a child
 * counting the dots to see how many stops were left got the wrong number, and
 * the marker never lined up with anything.
 *
 * Pure: works out what the strip should look like. The drawing is elsewhere.
 */

/**
 * The most dots worth drawing.
 *
 * At the ribbon's width a dot plus its gap is about 11 px, so two dozen is
 * what fits before they merge into a line. Beyond that the strip stops being
 * a count and becomes a proportion, and it says so rather than pretending.
 */
export const MAX_DOTS = 24;

export interface RibbonLeg {
	/** Speed permitted on the leg leading INTO this stop, km/h. */
	limitKmh: number;
}

export interface RibbonView {
	/** How many dots to draw. */
	dots: number;
	/** Which dot is the stop being worked towards, or −1 for none. */
	here: number;
	/**
	 * True when there are more stations than dots, so the strip is a
	 * proportion rather than a count and must not be read as one.
	 */
	compressed: boolean;
	/** Per-leg pace, one shorter than `dots`: how each leg compares to the fastest. */
	legPace: ('slow' | 'medium' | 'fast')[];
}

/**
 * How a leg's limit compares with the fastest on the line.
 *
 * Relative, not absolute: 60 km/h is crawling on a main line and flat out on a
 * tram route, and the strip is there to show where THIS line slows down.
 */
export function paceFor(limitKmh: number, fastestKmh: number): 'slow' | 'medium' | 'fast' {
	if (!(fastestKmh > 0)) return 'medium';

	const ratio = limitKmh / fastestKmh;

	if (ratio < 0.55) return 'slow';
	if (ratio < 0.85) return 'medium';

	return 'fast';
}

/**
 * Work out the strip.
 *
 * `stopIndex` is the station being worked towards; −1 when there is none.
 */
export function buildRibbon(
	stationCount: number,
	stopIndex: number,
	legs: RibbonLeg[],
): RibbonView {
	const stations = Math.max(2, stationCount);
	const compressed = stations > MAX_DOTS;
	const dots = compressed ? MAX_DOTS : stations;

	// On a compressed strip the marker keeps its PROPORTION along the line,
	// which is the only honest thing left once the dots stop being stations.
	let here = -1;

	if (stopIndex >= 0) {
		here = compressed
			? Math.round((stopIndex / Math.max(1, stations - 1)) * (dots - 1))
			: Math.min(stopIndex, dots - 1);
	}

	const fastest = legs.reduce((max, leg) => Math.max(max, leg.limitKmh), 0);
	const legPace: ('slow' | 'medium' | 'fast')[] = [];

	for (let i = 0; i < dots - 1; i++) {
		// Compressed: each drawn leg stands for several real ones, so take the
		// slowest of them — a slow stretch hidden inside an averaged leg is the
		// one thing the strip exists to show.
		const from = compressed ? Math.floor((i / (dots - 1)) * (legs.length - 1)) : i;
		const to = compressed ? Math.floor(((i + 1) / (dots - 1)) * (legs.length - 1)) : i;
		let slowest = Infinity;

		for (let k = from; k <= Math.max(from, to); k++) {
			const leg = legs[k];

			if (leg) slowest = Math.min(slowest, leg.limitKmh);
		}

		legPace.push(paceFor(Number.isFinite(slowest) ? slowest : fastest, fastest));
	}

	return {dots, here, compressed, legPace};
}
