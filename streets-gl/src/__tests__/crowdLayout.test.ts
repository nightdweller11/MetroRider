import {buildCrowdSlots, visibleCount, hashString} from '~/app/game/passengers/CrowdLayout';

describe('CrowdLayout — determinism', () => {
	it('produces identical slots for the same station id', () => {
		const a = buildCrowdSlots('tel-aviv-savidor', {count: 30, variants: 3});
		const b = buildCrowdSlots('tel-aviv-savidor', {count: 30, variants: 3});

		expect(a).toEqual(b);
	});

	it('produces different layouts for different stations', () => {
		const a = buildCrowdSlots('station-a', {count: 30});
		const b = buildCrowdSlots('station-b', {count: 30});

		const sameX = a.filter((s, i) => Math.abs(s.x - b[i].x) < 1e-9).length;
		expect(sameX).toBeLessThan(5);
	});

	it('keeps earlier slots fixed when the crowd grows', () => {
		const small = buildCrowdSlots('platform-1', {count: 10});
		const large = buildCrowdSlots('platform-1', {count: 40});

		expect(large.slice(0, 10)).toEqual(small);
	});
});

describe('CrowdLayout — geometry bounds', () => {
	it('keeps everyone on the platform rectangle', () => {
		const slots = buildCrowdSlots('bounds-test', {count: 500, length: 60, width: 6});

		for (const s of slots) {
			expect(Math.abs(s.x)).toBeLessThanOrEqual(30);
			// z is relative to the platform centre: on the deck, clear of the
			// track-side edge, and not hanging off the back.
			expect(s.z).toBeGreaterThanOrEqual(-2.3);
			expect(s.z).toBeLessThanOrEqual(2.7);
			expect(s.scale).toBeGreaterThan(0.9);
			expect(s.scale).toBeLessThan(1.1);
		}
	});

	it('only assigns variants that exist', () => {
		for (const variants of [1, 2, 3, 4]) {
			const slots = buildCrowdSlots('variant-test', {count: 200, variants});
			for (const s of slots) {
				expect(s.variant).toBeGreaterThanOrEqual(0);
				expect(s.variant).toBeLessThan(variants);
			}
		}
	});

	it('waits nearer the track edge than the back wall', () => {
		const slots = buildCrowdSlots('edge-test', {count: 1000, width: 6});
		const nearHalf = slots.filter(s => s.z < 0).length;

		expect(nearHalf).toBeGreaterThan(600);
	});

	it('clusters people toward the middle of the platform', () => {
		const slots = buildCrowdSlots('cluster-test', {count: 1000, length: 60});
		const middle = slots.filter(s => Math.abs(s.x) < 15).length;

		// A uniform spread would put ~500 in the middle half; the centre bias
		// should put clearly more than that there.
		expect(middle).toBeGreaterThan(600);
	});
});

describe('CrowdLayout — visible count', () => {
	it('draws one figure per waiting passenger up to the cap', () => {
		expect(visibleCount(0, 20)).toBe(0);
		expect(visibleCount(7, 20)).toBe(7);
		expect(visibleCount(7.9, 20)).toBe(7);
		expect(visibleCount(50, 20)).toBe(20);
	});

	it('draws nothing when crowds are off', () => {
		expect(visibleCount(100, 0)).toBe(0);
	});
});

describe('CrowdLayout — hash', () => {
	it('is stable and well spread', () => {
		expect(hashString('abc')).toBe(hashString('abc'));
		expect(hashString('abc')).not.toBe(hashString('abd'));

		const seen = new Set<number>();
		for (let i = 0; i < 1000; i++) seen.add(hashString(`station-${i}`));
		expect(seen.size).toBe(1000);
	});
});
