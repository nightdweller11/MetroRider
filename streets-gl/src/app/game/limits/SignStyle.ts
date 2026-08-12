/**
 * What a speed sign LOOKS like, by country and by mode of transport.
 *
 * A red-ringed white disc is a ROAD sign. Mainline railways mostly do not use
 * it, and the ones that do use it differently — so a game that shows the same
 * disc on a German main line, a French TGV route and a Melbourne tram is
 * showing the wrong sign three times.
 *
 * What the real systems do (the cases modelled here):
 *
 * - **Germany (Lf 7)** — white square, black numeral, value in TENS of km/h,
 *   so 120 km/h is signed "12". The advance warning (Lf 6) is a yellow
 *   triangle carrying the same number.
 * - **France (TIV)** — permanent speed boards are white discs with a black
 *   numeral, also in tens of km/h; the advance indication is a yellow triangle.
 * - **Britain** — white rectangular plate, black numerals, value in MPH, and
 *   speed is quoted in mph throughout.
 * - **Netherlands / Belgium / much of central Europe** — white square, black
 *   numeral, tens of km/h.
 * - **Israel, Spain, Italy and most other km/h railways** — white board with
 *   the full number in km/h.
 * - **North America** — white rectangular speed board, black numerals, mph.
 * - **Trams** run in the street and are signed like the street: a road-style
 *   disc with a red ring in most of Europe, full km/h.
 * - **Metros** are signed for staff, not the public: a plain white board with
 *   the full number, no road iconography.
 *
 * The point is not to be exhaustive — it is that the sign in front of the
 * player belongs to the railway they are driving on.
 */

export type SignShape = 'square' | 'disc' | 'plate' | 'triangle';
export type SpeedUnit = 'kmh' | 'mph';
export type TransportMode = 'rail' | 'metro' | 'tram' | 'light-rail';

export interface SignStyle {
	shape: SignShape;
	/** Face colour. */
	background: string;
	/** Border/ring colour (equal to the face when the sign has no ring). */
	border: string;
	borderWidth: number;
	text: string;
	/** True when the number shown is the speed divided by ten (German Lf 7, French TIV). */
	tensOfKmh: boolean;
	unit: SpeedUnit;
	/** What this sign is called where it is used — shown in a tooltip. */
	name: string;
	/** Advance-warning sign for an upcoming lower limit, when the system has one. */
	advance?: {shape: SignShape; background: string; border: string; text: string; name: string};
}

const BLACK = '#111111';
const WHITE = '#ffffff';
const RAIL_RED = '#c62828';
const WARNING_YELLOW = '#f5c518';

/** Countries whose railways sign in tens of km/h on a square board. */
const TENS_SQUARE = new Set(['DE', 'AT', 'NL', 'BE', 'DK', 'CZ', 'PL', 'HU', 'SK']);

export function railSignStyle(countryCode: string): SignStyle {
	const cc = countryCode.toUpperCase();

	if (cc === 'GB' || cc === 'IE') {
		return {
			shape: 'plate', background: WHITE, border: BLACK, borderWidth: 3, text: BLACK,
			tensOfKmh: false, unit: 'mph', name: 'Permanent speed restriction (mph)',
		};
	}

	if (cc === 'US' || cc === 'CA') {
		return {
			shape: 'plate', background: WHITE, border: BLACK, borderWidth: 3, text: BLACK,
			tensOfKmh: false, unit: 'mph', name: 'Speed board (mph)',
		};
	}

	if (cc === 'FR') {
		return {
			shape: 'disc', background: WHITE, border: BLACK, borderWidth: 3, text: BLACK,
			tensOfKmh: true, unit: 'kmh', name: 'TIV fixe (tens of km/h)',
			advance: {shape: 'triangle', background: WARNING_YELLOW, border: BLACK, text: BLACK, name: 'TIV à distance'},
		};
	}

	if (TENS_SQUARE.has(cc)) {
		return {
			shape: 'square', background: WHITE, border: BLACK, borderWidth: 3, text: BLACK,
			tensOfKmh: true, unit: 'kmh',
			name: cc === 'DE' ? 'Lf 7 (tens of km/h)' : 'Speed board (tens of km/h)',
			advance: {shape: 'triangle', background: WARNING_YELLOW, border: BLACK, text: BLACK, name: cc === 'DE' ? 'Lf 6' : 'Advance warning'},
		};
	}

	// Israel, Spain, Italy, and most other km/h railways: the full number.
	return {
		shape: 'square', background: WHITE, border: BLACK, borderWidth: 3, text: BLACK,
		tensOfKmh: false, unit: 'kmh', name: 'Speed board (km/h)',
	};
}

export function signStyleFor(mode: TransportMode, countryCode: string): SignStyle {
	const cc = countryCode.toUpperCase();
	const imperial = cc === 'GB' || cc === 'US' || cc === 'CA' || cc === 'IE';

	if (mode === 'tram') {
		// Trams share the street, so they are signed like the street.
		return {
			shape: 'disc', background: WHITE, border: RAIL_RED, borderWidth: 5, text: BLACK,
			tensOfKmh: false, unit: imperial ? 'mph' : 'kmh', name: 'Road speed limit (tram)',
		};
	}

	if (mode === 'metro' || mode === 'light-rail') {
		// Signed for staff: a plain board, no road iconography.
		return {
			shape: 'plate', background: WHITE, border: BLACK, borderWidth: 3, text: BLACK,
			tensOfKmh: false, unit: imperial ? 'mph' : 'kmh', name: 'Line speed board',
		};
	}

	return railSignStyle(cc);
}

/** The number printed on the face, given a limit in m/s. */
export function signNumber(limitMs: number, style: SignStyle): number {
	const inUnit = style.unit === 'mph' ? limitMs * 2.23694 : limitMs * 3.6;
	if (style.tensOfKmh) {
		// Tens boards round to the ten they represent: 118 km/h is signed "12".
		return Math.max(1, Math.round(inUnit / 10));
	}
	return Math.max(5, Math.round(inUnit / 5) * 5);
}

/** The speed a sign means, in m/s — the inverse of `signNumber`. */
export function signNumberToMs(value: number, style: SignStyle): number {
	const inUnit = style.tensOfKmh ? value * 10 : value;
	return style.unit === 'mph' ? inUnit / 2.23694 : inUnit / 3.6;
}

export function unitLabel(style: SignStyle): string {
	return style.unit === 'mph' ? 'mph' : 'km/h';
}

/**
 * Which country a map is in, from its centre.
 *
 * Deliberately a small bounding-box table rather than a geocoder: it needs no
 * network, no key and no data file, and it only has to be right about which
 * railway's signage to draw. Boxes are checked smallest-first so a country
 * inside another country's box still wins.
 */
interface CountryBox {
	code: string;
	minLat: number; maxLat: number; minLng: number; maxLng: number;
}

const COUNTRY_BOXES: CountryBox[] = [
	{code: 'IL', minLat: 29.4, maxLat: 33.4, minLng: 34.2, maxLng: 35.9},
	{code: 'CH', minLat: 45.8, maxLat: 47.8, minLng: 5.9, maxLng: 10.5},
	{code: 'NL', minLat: 50.7, maxLat: 53.6, minLng: 3.3, maxLng: 7.2},
	{code: 'BE', minLat: 49.5, maxLat: 51.5, minLng: 2.5, maxLng: 6.4},
	{code: 'AT', minLat: 46.4, maxLat: 49.0, minLng: 9.5, maxLng: 17.2},
	{code: 'CZ', minLat: 48.5, maxLat: 51.1, minLng: 12.1, maxLng: 18.9},
	{code: 'DK', minLat: 54.5, maxLat: 57.8, minLng: 8.0, maxLng: 15.2},
	{code: 'GB', minLat: 49.8, maxLat: 60.9, minLng: -8.7, maxLng: 1.8},
	{code: 'IE', minLat: 51.4, maxLat: 55.4, minLng: -10.6, maxLng: -5.9},
	{code: 'PT', minLat: 36.9, maxLat: 42.2, minLng: -9.6, maxLng: -6.2},
	{code: 'IT', minLat: 35.4, maxLat: 47.1, minLng: 6.6, maxLng: 18.6},
	{code: 'ES', minLat: 35.9, maxLat: 43.9, minLng: -9.4, maxLng: 3.4},
	{code: 'DE', minLat: 47.2, maxLat: 55.1, minLng: 5.8, maxLng: 15.1},
	{code: 'PL', minLat: 49.0, maxLat: 54.9, minLng: 14.1, maxLng: 24.2},
	{code: 'FR', minLat: 41.3, maxLat: 51.1, minLng: -5.2, maxLng: 9.6},
	{code: 'JP', minLat: 24.0, maxLat: 45.6, minLng: 122.9, maxLng: 146.0},
	{code: 'AU', minLat: -43.7, maxLat: -10.0, minLng: 112.9, maxLng: 153.7},
	{code: 'CA', minLat: 41.6, maxLat: 70.0, minLng: -141.0, maxLng: -52.6},
	{code: 'US', minLat: 24.5, maxLat: 49.4, minLng: -125.0, maxLng: -66.9},
];

function boxArea(b: CountryBox): number {
	return (b.maxLat - b.minLat) * (b.maxLng - b.minLng);
}

export function countryForLocation(lat: number, lng: number): string {
	const hits = COUNTRY_BOXES.filter(
		b => lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng,
	);
	if (hits.length === 0) return 'XX';
	hits.sort((a, b) => boxArea(a) - boxArea(b));
	return hits[0].code;
}
