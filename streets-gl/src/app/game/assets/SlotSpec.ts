/**
 * A train consist slot is stored as a plain string so it stays compatible with
 * every existing storage location (server config.json, localStorage overrides,
 * the settings page and the game's AssetConfigSystem).
 *
 * Format:  "<modelId>"                    – car facing forward (default)
 *          "<modelId>#flip"               – car rotated 180° around its axis
 *          "<modelId>#tint=ff5522"        – car painted in a livery colour
 *          "<modelId>#flip#tint=ff5522"   – both, in that order
 *
 * The tokens are order-tolerant on the way IN and canonical on the way OUT, so
 * a hand-edited config with the tokens the other way round still loads. Every
 * older string — a bare model id, or one with `#flip` — parses exactly as it
 * always did, which matters because these strings are already saved in
 * players' browsers and in the server's config.
 */

export const FLIP_SUFFIX = '#flip';
export const TINT_PREFIX = '#tint=';

export interface SlotSpec {
	modelId: string;
	flipped: boolean;
	/** Livery colour as `rrggbb`, or null for the model's own colours. */
	tint: string | null;
}

/** Six hex digits, lower-cased. Anything else is not a colour and is dropped. */
function normaliseTint(raw: string): string | null {
	const value = raw.trim().replace(/^#/, '').toLowerCase();

	if (value.length !== 6) return null;

	for (const ch of value) {
		if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f'))) return null;
	}

	return value;
}

export function parseSlot(slot: string): SlotSpec {
	if (typeof slot !== 'string' || slot.length === 0) {
		return {modelId: 'procedural-default', flipped: false, tint: null};
	}

	const parts = slot.split('#');
	const modelId = parts[0];
	let flipped = false;
	let tint: string | null = null;

	for (let i = 1; i < parts.length; i++) {
		const token = parts[i];

		if (token === 'flip') {
			flipped = true;
		} else if (token.startsWith('tint=')) {
			tint = normaliseTint(token.slice('tint='.length));
		}
		// An unknown token is ignored rather than fatal: a slot string written
		// by a newer build must still load a car in an older one.
	}

	return {modelId: modelId || 'procedural-default', flipped, tint};
}

export function formatSlot(spec: SlotSpec): string {
	let out = spec.modelId;

	if (spec.flipped) out += FLIP_SUFFIX;

	if (spec.tint) {
		const tint = normaliseTint(spec.tint);

		if (tint) out += `${TINT_PREFIX}${tint}`;
	}

	return out;
}

export function slotModelId(slot: string): string {
	return parseSlot(slot).modelId;
}

export function isSlotFlipped(slot: string): boolean {
	return parseSlot(slot).flipped;
}

export function slotTint(slot: string): string | null {
	return parseSlot(slot).tint;
}

export function toggleSlotFlip(slot: string): string {
	const spec = parseSlot(slot);

	return formatSlot({...spec, flipped: !spec.flipped});
}

/** Replace the model but keep the slot's flip state and livery. */
export function withSlotModel(slot: string, modelId: string): string {
	return formatSlot({...parseSlot(slot), modelId});
}

/** Repaint the car. Pass null to go back to the model's own colours. */
export function withSlotTint(slot: string, tint: string | null): string {
	return formatSlot({...parseSlot(slot), tint});
}

/**
 * Livery colour as linear-ish rgb in 0..1, for the shader.
 *
 * Returns null when the slot has no tint, which is the signal to leave the
 * model exactly as its author made it.
 */
export function tintToRgb(tint: string | null): [number, number, number] | null {
	const value = tint ? normaliseTint(tint) : null;

	if (!value) return null;

	return [
		parseInt(value.slice(0, 2), 16) / 255,
		parseInt(value.slice(2, 4), 16) / 255,
		parseInt(value.slice(4, 6), 16) / 255,
	];
}
