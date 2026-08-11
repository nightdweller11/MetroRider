/**
 * A train consist slot is stored as a plain string so it stays compatible with
 * every existing storage location (server config.json, localStorage overrides,
 * the settings page and the game's AssetConfigSystem).
 *
 * Format:  "<modelId>"            – car facing forward (default)
 *          "<modelId>#flip"       – car rotated 180° around its vertical axis
 */

export const FLIP_SUFFIX = '#flip';

export interface SlotSpec {
	modelId: string;
	flipped: boolean;
}

export function parseSlot(slot: string): SlotSpec {
	if (typeof slot !== 'string' || slot.length === 0) {
		return {modelId: 'procedural-default', flipped: false};
	}
	if (slot.endsWith(FLIP_SUFFIX)) {
		return {modelId: slot.slice(0, -FLIP_SUFFIX.length), flipped: true};
	}
	return {modelId: slot, flipped: false};
}

export function formatSlot(spec: SlotSpec): string {
	return spec.flipped ? `${spec.modelId}${FLIP_SUFFIX}` : spec.modelId;
}

export function slotModelId(slot: string): string {
	return parseSlot(slot).modelId;
}

export function isSlotFlipped(slot: string): boolean {
	return parseSlot(slot).flipped;
}

export function toggleSlotFlip(slot: string): string {
	const spec = parseSlot(slot);
	return formatSlot({modelId: spec.modelId, flipped: !spec.flipped});
}

/** Replace the model but keep the slot's flip state. */
export function withSlotModel(slot: string, modelId: string): string {
	return formatSlot({modelId, flipped: isSlotFlipped(slot)});
}
