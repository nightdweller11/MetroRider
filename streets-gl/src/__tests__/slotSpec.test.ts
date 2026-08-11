/**
 * Consist slot spec: the "#flip" suffix that rotates a car 180°.
 */
import {parseSlot, formatSlot, toggleSlotFlip, withSlotModel, isSlotFlipped, slotModelId} from '~/app/game/assets/SlotSpec';

describe('SlotSpec', () => {
	test('plain slot parses as unflipped', () => {
		expect(parseSlot('train-electric-bullet-a')).toEqual({modelId: 'train-electric-bullet-a', flipped: false});
	});

	test('#flip suffix parses as flipped', () => {
		expect(parseSlot('train-electric-bullet-a#flip')).toEqual({modelId: 'train-electric-bullet-a', flipped: true});
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
		expect(parseSlot('')).toEqual({modelId: 'procedural-default', flipped: false});
		expect(parseSlot(undefined as unknown as string).modelId).toBe('procedural-default');
	});

	test('helpers', () => {
		expect(slotModelId('a#flip')).toBe('a');
		expect(isSlotFlipped('a#flip')).toBe(true);
		expect(isSlotFlipped('a')).toBe(false);
	});
});
