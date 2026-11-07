/**
 * The change-here marks on the network map.
 *
 * The map drew every line's station dots, and where three lines share a
 * station it drew three dots on top of each other in three colours — which
 * reads as a smudge, not as "you can change here". A printed metro map marks
 * those stations with a ring, and so does this one: one white ring per shared
 * station, drawn over the lines, with a key in the header saying what it is.
 *
 * Which stations are shared comes from the lines themselves (`Interchanges.ts`),
 * never from the map's `isInterchange` flag, which answers another question.
 */

import type {InterchangeMark} from '../data/Interchanges';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Draw one ring per mark. Returns how many were drawn. */
export function drawInterchangeMarks(
	svg: SVGSVGElement,
	marks: InterchangeMark[],
	toSvg: (lat: number, lng: number) => [number, number],
): number {
	const group = document.createElementNS(SVG_NS, 'g');

	group.setAttribute('class', 'interchange-marks');

	for (const mark of marks) {
		const [x, y] = toSvg(mark.lat, mark.lng);

		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

		// Outer: a white disc with a dark rim, big enough to sit over the
		// stacked line-coloured dots underneath it.
		const outer = document.createElementNS(SVG_NS, 'circle');

		outer.setAttribute('cx', x.toFixed(1));
		outer.setAttribute('cy', y.toFixed(1));
		outer.setAttribute('r', '8');
		outer.setAttribute('fill', '#fff');
		outer.setAttribute('stroke', '#111');
		outer.setAttribute('stroke-width', '2.5');

		// Inner ring: what makes it a change-here mark rather than a big dot.
		const inner = document.createElementNS(SVG_NS, 'circle');

		inner.setAttribute('cx', x.toFixed(1));
		inner.setAttribute('cy', y.toFixed(1));
		inner.setAttribute('r', '3.6');
		inner.setAttribute('fill', 'none');
		inner.setAttribute('stroke', '#111');
		inner.setAttribute('stroke-width', '2');

		const title = document.createElementNS(SVG_NS, 'title');

		title.textContent = `Change here — ${mark.lineCount} lines`;
		outer.appendChild(title);

		group.appendChild(outer);
		group.appendChild(inner);
	}

	svg.appendChild(group);

	return group.childElementCount / 2;
}

/** The key for the header: the ring, and what it means. */
export function interchangeLegend(count: number): HTMLElement {
	const key = document.createElement('div');

	key.id = 'metro-map-interchange-key';
	key.style.cssText = `
		display: flex; align-items: center; gap: 6px; flex-shrink: 0;
		color: #ccd; font-size: 12px; font-weight: 600;
	`;
	key.innerHTML = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">'
		+ '<circle cx="10" cy="10" r="8" fill="#fff" stroke="#111" stroke-width="2.5"/>'
		+ '<circle cx="10" cy="10" r="3.6" fill="none" stroke="#111" stroke-width="2"/></svg>';

	const text = document.createElement('span');

	text.textContent = count === 1 ? 'Change here · 1 station' : `Change here · ${count} stations`;
	key.appendChild(text);

	return key;
}
