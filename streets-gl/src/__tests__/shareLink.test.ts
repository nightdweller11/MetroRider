/**
 * Ride links: the URL a parent sends a child so they open on the same train,
 * on the same line, in the same city.
 *
 * A link is untrusted input from outside the app, so the parsing rules matter
 * as much as the happy path.
 */
import {parseRideLink, buildRideLink} from '~/app/game/data/ShareLink';

describe('parseRideLink', () => {
	it('reads a full ride', () => {
		const ride = parseRideLink('?map=abc123&line=4&train=loco,car-b,car-c');

		expect(ride).toEqual({
			mapId: 'abc123',
			lineIndex: 4,
			consist: ['loco', 'car-b', 'car-c'],
		});
	});

	it('is nothing without a map — a line on its own means nothing', () => {
		expect(parseRideLink('?line=4&train=loco')).toBeNull();
		expect(parseRideLink('')).toBeNull();
		expect(parseRideLink('?map=')).toBeNull();
		expect(parseRideLink('?map=%20%20')).toBeNull();
	});

	it('takes a map on its own', () => {
		expect(parseRideLink('?map=abc123')).toEqual({
			mapId: 'abc123', lineIndex: null, consist: null,
		});
	});

	it('keeps the padding on a MetroDreamin id', () => {
		// Real ids are base64 and end in '='; a parser that trims or splits on
		// '=' quietly opens a different map, or none.
		const id = 'QVQ2V2ZIYVpyUFEzNE1acEVLcGhlVkdqR3BPMnwxNg==';
		const ride = parseRideLink(`?map=${encodeURIComponent(id)}`);

		expect(ride?.mapId).toBe(id);
	});

	it('carries the flip and tint tokens on a slot', () => {
		const ride = parseRideLink(`?map=m&train=${encodeURIComponent('loco#flip#tint=d62828,car-b')}`);

		expect(ride?.consist).toEqual(['loco#flip#tint=d62828', 'car-b']);
	});

	it('refuses a line index that is not one', () => {
		for (const bad of ['-1', 'x', '1.5', '', '99999']) {
			expect(parseRideLink(`?map=m&line=${bad}`)?.lineIndex).toBeNull();
		}

		expect(parseRideLink('?map=m&line=0')?.lineIndex).toBe(0);
	});

	it('caps the consist, because a link is untrusted input', () => {
		// Without a cap, a URL asking for ten thousand carriages takes the tab
		// down with it — and it would be handed to a child.
		const many = Array.from({length: 500}, (_, i) => `car${i}`).join(',');
		const ride = parseRideLink(`?map=m&train=${many}`);

		expect(ride?.consist?.length).toBe(12);
	});

	it('drops an absurdly long slot rather than passing it on', () => {
		const huge = 'x'.repeat(5000);
		const ride = parseRideLink(`?map=m&train=${huge},car-b`);

		expect(ride?.consist).toEqual(['car-b']);
	});

	it('treats an empty or all-blank train as no train', () => {
		expect(parseRideLink('?map=m&train=')?.consist).toBeNull();
		expect(parseRideLink('?map=m&train=,,,')?.consist).toBeNull();
	});
});

describe('buildRideLink', () => {
	it('round-trips through the parser', () => {
		const url = buildRideLink('https://metrorider.net/', {
			mapId: 'QVQ2V2ZIYVpyUFEzNE1acEVLcGhlVkdqR3BPMnwxNg==',
			lineIndex: 3,
			consist: ['loco#flip#tint=d62828', 'car-b'],
		});
		const back = parseRideLink(url.slice(url.indexOf('?')));

		expect(back).toEqual({
			mapId: 'QVQ2V2ZIYVpyUFEzNE1acEVLcGhlVkdqR3BPMnwxNg==',
			lineIndex: 3,
			consist: ['loco#flip#tint=d62828', 'car-b'],
		});
	});

	it('drops the sender\'s camera position and any existing query', () => {
		// The hash is where the sender happened to be looking. It is not part
		// of the ride, and carrying it over drops the recipient in mid-air.
		const url = buildRideLink('https://metrorider.net/?debug=true#32.1,34.8,45,0,500', {mapId: 'm'});

		expect(url).toBe('https://metrorider.net/?map=m');
	});

	it('leaves out what the ride does not specify', () => {
		expect(buildRideLink('https://x/', {mapId: 'm'})).toBe('https://x/?map=m');
		expect(buildRideLink('https://x/', {mapId: 'm', lineIndex: null, consist: []})).toBe('https://x/?map=m');
		expect(buildRideLink('https://x/', {mapId: 'm', lineIndex: 0})).toBe('https://x/?map=m&line=0');
	});
});
