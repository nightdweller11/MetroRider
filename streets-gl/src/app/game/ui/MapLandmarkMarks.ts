/**
 * Places on the network map: the ones you found, lit, and the ones still to
 * find near the line, dim.
 *
 * Which places, and how many, is decided in `data/Landmarks.ts`. This only
 * draws them, in the pattern of the change-here rings (`MapInterchangeMarks`):
 * a group of marks over the lines and under the train, and a key saying what
 * they are.
 *
 * A found place is a green pin with its name (for the most recent few); a place
 * still to find is a hollow dim pin with a question mark and no name — finding
 * out what it is is the point of going there.
 */

import MathUtils from '~/lib/math/MathUtils';
import {pickVisible, type MapLandmark} from '../data/Landmarks';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Closest two pins may stand, in map units (a pin is 12 wide). */
const PIN_GAP = 14;
/** A map pin, tip at the origin, 17 units tall. */
const PIN_PATH = 'M0,0 C-1.6,-4.2 -6,-6.8 -6,-11 A6,6 0 1 1 6,-11 C6,-6.8 1.6,-4.2 0,0 Z';

function pin(x: number, y: number, found: boolean, name: string): SVGGElement {
	const g = document.createElementNS(SVG_NS, 'g');

	g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`);
	g.setAttribute('class', found ? 'landmark found' : 'landmark to-find');

	const body = document.createElementNS(SVG_NS, 'path');

	body.setAttribute('d', PIN_PATH);

	if (found) {
		body.setAttribute('fill', '#4fd996');
		body.setAttribute('stroke', '#08111a');
		body.setAttribute('stroke-width', '1.8');
	} else {
		body.setAttribute('fill', 'rgba(20,28,38,0.85)');
		body.setAttribute('stroke', '#8fa3b8');
		body.setAttribute('stroke-width', '1.4');
		g.setAttribute('opacity', '0.75');
	}

	g.appendChild(body);

	if (found) {
		const dot = document.createElementNS(SVG_NS, 'circle');

		dot.setAttribute('cy', '-11');
		dot.setAttribute('r', '2.3');
		dot.setAttribute('fill', '#08111a');
		g.appendChild(dot);
	} else {
		const q = document.createElementNS(SVG_NS, 'text');

		q.setAttribute('y', '-7.6');
		q.setAttribute('text-anchor', 'middle');
		q.setAttribute('font-size', '9');
		q.setAttribute('font-weight', '700');
		q.setAttribute('fill', '#b8c8d8');
		q.textContent = '?';
		g.appendChild(q);
	}

	const title = document.createElementNS(SVG_NS, 'title');

	// textContent, never innerHTML: these names come off other people's maps.
	title.textContent = found ? `Found: ${name}` : 'Somewhere still to find — drive or walk close to it';
	g.appendChild(title);

	return g;
}

/**
 * Draw the landmarks. Positions are world metres, turned back into lat/lng
 * to go through the same projection as the lines. Returns how many of each
 * were drawn (a find outside the drawn area is skipped).
 */
export function drawLandmarks(
	svg: SVGSVGElement,
	landmarks: {found: MapLandmark[]; toFind: MapLandmark[]},
	toSvg: (lat: number, lng: number) => [number, number],
	bounds: {width: number; height: number},
): {found: number; toFind: number} {
	const group = document.createElementNS(SVG_NS, 'g');
	const counts = {found: 0, toFind: 0};

	group.setAttribute('class', 'landmarks');

	const place = (mark: MapLandmark): [number, number] | null => {
		const ll = MathUtils.meters2degrees(mark.x, mark.z);
		const [x, y] = toSvg(ll.lat, ll.lon);

		if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
		if (x < -20 || y < -20 || x > bounds.width + 20 || y > bounds.height + 20) return null;

		return [x, y];
	};

	const foundAt = landmarks.found.map(place);
	const toFindAt = landmarks.toFind.map(place);
	const valid = (p: [number, number] | null): {x: number; y: number} => (p ? {x: p[0], y: p[1]} : {x: NaN, y: NaN});
	// A dim pin that would sit on another pin is left out: finds first, then
	// the still-to-find ones most important first (the order they come in),
	// up to MAX_TO_FIND.
	const showToFind = pickVisible(foundAt.map(valid), toFindAt.map(valid), PIN_GAP);

	// Still to find first, so a found pin at the same spot sits on top.
	toFindAt.forEach((at, i) => {
		if (!at || !showToFind[i]) return;

		group.appendChild(pin(at[0], at[1], false, landmarks.toFind[i].name));
		counts.toFind++;
	});

	// A name is written only where it does not run into another name.
	const labelBoxes: {x0: number; x1: number; y0: number; y1: number}[] = [];

	landmarks.found.forEach((mark, i) => {
		const at = foundAt[i];

		if (!at) return;

		group.appendChild(pin(at[0], at[1], true, mark.name));
		counts.found++;

		if (!mark.labelled) return;

		const box = {x0: at[0] + 8, x1: at[0] + 8 + mark.name.length * 6.4, y0: at[1] - 18, y1: at[1] - 4};

		if (labelBoxes.some(b => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) return;

		labelBoxes.push(box);

		const label = document.createElementNS(SVG_NS, 'text');

		label.setAttribute('x', (at[0] + 8).toFixed(1));
		label.setAttribute('y', (at[1] - 7).toFixed(1));
		label.setAttribute('fill', '#bfe9d2');
		label.setAttribute('font-size', '11');
		label.setAttribute('font-weight', '600');
		// A dark halo so the name reads over a line.
		label.setAttribute('stroke', '#08111a');
		label.setAttribute('stroke-width', '3');
		label.setAttribute('paint-order', 'stroke');
		label.textContent = mark.name;
		group.appendChild(label);
	});

	if (group.childNodes.length > 0) svg.appendChild(group);

	return counts;
}

/** The key: what a lit pin and a dim pin mean, and how many of each. */
export function landmarkLegend(counts: {found: number; toFind: number}): HTMLElement | null {
	if (counts.found === 0 && counts.toFind === 0) return null;

	const key = document.createElement('span');

	key.id = 'metro-map-landmark-key';
	key.style.cssText = 'display: inline-flex; align-items: center; gap: 14px; flex-wrap: wrap; justify-content: center;';

	const item = (found: boolean, text: string): HTMLElement => {
		const span = document.createElement('span');

		span.style.cssText = 'display: inline-flex; align-items: center; gap: 6px;';
		span.innerHTML = '<svg viewBox="-8 -19 16 21" width="13" height="17" aria-hidden="true">'
			+ (found
				? `<path d="${PIN_PATH}" fill="#4fd996" stroke="#08111a" stroke-width="1.8"/>`
					+ '<circle cy="-11" r="2.3" fill="#08111a"/>'
				: `<path d="${PIN_PATH}" fill="rgba(20,28,38,0.85)" stroke="#8fa3b8" stroke-width="1.4"/>`
					+ '<text y="-7.6" text-anchor="middle" font-size="9" font-weight="700" fill="#b8c8d8">?</text>')
			+ '</svg>';

		const label = document.createElement('span');

		label.textContent = text;
		span.appendChild(label);

		return span;
	};

	if (counts.found > 0) {
		key.appendChild(item(true, counts.found === 1 ? '1 place found' : `${counts.found} places found`));
	}

	if (counts.toFind > 0) {
		key.appendChild(item(false, `${counts.toFind} still to find near the line`));
	}

	return key;
}

/**
 * The strip under the map that holds the keys (change-here rings, places).
 *
 * Under the map rather than in the header: on a phone the header has room for
 * the map's name, the MetroDreamin link and the close button, and measured at
 * 390 px wide a key beside them pushed the close button off the screen.
 */
export function mapKeyRow(keys: (HTMLElement | null)[]): HTMLElement | null {
	const present = keys.filter((k): k is HTMLElement => !!k);

	if (present.length === 0) return null;

	const row = document.createElement('div');

	row.id = 'metro-map-key';
	row.style.cssText = `
		display: flex; align-items: center; justify-content: center; gap: 8px 18px; flex-wrap: wrap;
		padding: 8px 14px 12px; flex-shrink: 0; color: #ccd; font-size: 12px; font-weight: 600;
	`;

	for (const key of present) row.appendChild(key);

	return row;
}
