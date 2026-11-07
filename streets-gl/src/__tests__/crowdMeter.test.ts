import {crowdMeter, CROWD_BARS, CROWD_FULL_AT} from '~/app/game/passengers/CrowdMeter';

/** The platform meter on the destination board. */
describe('crowdMeter', () => {
	test('an empty platform lights nothing and says so', () => {
		expect(crowdMeter(0)).toEqual({bars: 0, level: 'empty', label: 'NOBODY WAITING'});
	});

	test('one person lights a bar — never an empty meter over people', () => {
		expect(crowdMeter(1).bars).toBe(1);
		expect(crowdMeter(1).level).toBe('few');
	});

	test('fills linearly to a carriage-load', () => {
		expect(crowdMeter(CROWD_FULL_AT / 2).bars).toBe(Math.ceil(CROWD_BARS / 2));
		expect(crowdMeter(CROWD_FULL_AT).bars).toBe(CROWD_BARS);
		expect(crowdMeter(CROWD_FULL_AT).level).toBe('packed');
	});

	test('more than a carriage-load is still a full meter, with the real number', () => {
		const view = crowdMeter(240);

		expect(view.bars).toBe(CROWD_BARS);
		expect(view.label).toBe('240 WAITING');
	});

	test('busy in the middle', () => {
		expect(crowdMeter(30).level).toBe('busy');
	});

	test('nonsense counts read as nobody', () => {
		expect(crowdMeter(Number.NaN).bars).toBe(0);
		expect(crowdMeter(-4).bars).toBe(0);
	});

	test('drains as people board', () => {
		const bars = [60, 45, 30, 12, 0].map(n => crowdMeter(n).bars);

		for (let i = 1; i < bars.length; i++) expect(bars[i]).toBeLessThanOrEqual(bars[i - 1]);
		expect(bars[bars.length - 1]).toBe(0);
	});
});
