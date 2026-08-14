/**
 * Consist slot spec: the "#flip" suffix that rotates a car 180°, and the
 * "#tint=rrggbb" suffix that paints it.
 *
 * These strings are already saved in players' browsers and in the server's
 * config, so the back-compat cases below are not hypothetical: a bare model id
 * and a "#flip" string MUST keep parsing exactly as they always did.
 */
import {
	parseSlot, formatSlot, toggleSlotFlip, withSlotModel, withSlotTint,
	isSlotFlipped, slotModelId, slotTint, tintToRgb,
} from '~/app/game/assets/SlotSpec';

describe('SlotSpec', () => {
	test('plain slot parses as unflipped, unpainted', () => {
		expect(parseSlot('train-electric-bullet-a')).toEqual({
			modelId: 'train-electric-bullet-a', flipped: false, tint: null,
		});
	});

	test('#flip suffix parses as flipped', () => {
		expect(parseSlot('train-electric-bullet-a#flip')).toEqual({
			modelId: 'train-electric-bullet-a', flipped: true, tint: null,
		});
	});

	test('format round-trips', () => {
		expect(formatSlot(parseSlot('x#flip'))).toBe('x#flip');
		expect(formatSlot(parseSlot('x'))).toBe('x');
	});

	test('toggle flips and unflips', () => {
		expect(toggleSlotFlip('loco')).toBe('loco#flip');
		expect(toggleSlotFlip('loco#flip')).toBe('loco');
	});

	test('withSlotModel keeps flip state', () => {
		expect(withSlotModel('old#flip', 'new')).toBe('new#flip');
		expect(withSlotModel('old', 'new')).toBe('new');
	});

	test('empty/invalid slot degrades to procedural', () => {
		expect(parseSlot('')).toEqual({modelId: 'procedural-default', flipped: false, tint: null});
		expect(parseSlot(undefined as unknown as string).modelId).toBe('procedural-default');
	});

	test('helpers', () => {
		expect(slotModelId('a#flip')).toBe('a');
		expect(isSlotFlipped('a#flip')).toBe(true);
		expect(isSlotFlipped('a')).toBe(false);
	});
});

describe('SlotSpec — livery tint', () => {
	test('parses a tint on its own and alongside a flip', () => {
		expect(parseSlot('loco#tint=ff5522')).toEqual({modelId: 'loco', flipped: false, tint: 'ff5522'});
		expect(parseSlot('loco#flip#tint=ff5522')).toEqual({modelId: 'loco', flipped: true, tint: 'ff5522'});
	});

	test('accepts the tokens in either order but writes them canonically', () => {
		// A hand-edited config should still load.
		expect(parseSlot('loco#tint=ff5522#flip')).toEqual({modelId: 'loco', flipped: true, tint: 'ff5522'});
		expect(formatSlot(parseSlot('loco#tint=ff5522#flip'))).toBe('loco#flip#tint=ff5522');
	});

	test('normalises case and a leading hash', () => {
		expect(slotTint('loco#tint=FF5522')).toBe('ff5522');
		expect(formatSlot({modelId: 'loco', flipped: false, tint: '#AABBCC'})).toBe('loco#tint=aabbcc');
	});

	test('drops a value that is not a colour rather than painting nonsense', () => {
		expect(slotTint('loco#tint=zzz')).toBeNull();
		expect(slotTint('loco#tint=ff55')).toBeNull();
		expect(slotTint('loco#tint=')).toBeNull();
		expect(formatSlot({modelId: 'loco', flipped: false, tint: 'nope'})).toBe('loco');
	});

	test('ignores a token it does not know, rather than failing to load a car', () => {
		// A slot string written by a newer build has to load in an older one.
		expect(parseSlot('loco#flip#sparkle=9')).toEqual({modelId: 'loco', flipped: true, tint: null});
	});

	test('round-trips through every editing helper', () => {
		expect(withSlotTint('loco', 'ff5522')).toBe('loco#tint=ff5522');
		expect(withSlotTint('loco#flip#tint=ff5522', null)).toBe('loco#flip');
		expect(withSlotTint('loco#tint=ff5522', '00aa00')).toBe('loco#tint=00aa00');
		// Changing the model keeps the paint and the flip.
		expect(withSlotModel('old#flip#tint=ff5522', 'new')).toBe('new#flip#tint=ff5522');
		// Flipping keeps the paint.
		expect(toggleSlotFlip('loco#tint=ff5522')).toBe('loco#flip#tint=ff5522');
	});

	test('converts to shader rgb, and to null when there is no paint', () => {
		expect(tintToRgb(null)).toBeNull();
		expect(tintToRgb('bad')).toBeNull();

		const white = tintToRgb('ffffff');
		const black = tintToRgb('000000');
		const red = tintToRgb('ff0000');

		expect(white).toEqual([1, 1, 1]);
		expect(black).toEqual([0, 0, 0]);
		expect(red?.[0]).toBe(1);
		expect(red?.[1]).toBe(0);
		expect(red?.[2]).toBe(0);
	});
});
