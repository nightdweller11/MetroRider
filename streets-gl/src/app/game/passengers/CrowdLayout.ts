/**
 * Deterministic platform crowd layout.
 *
 * Slots are generated ONCE per station from a hash of its id, so:
 *  - the same platform looks the same every time you come back to it,
 *  - when one more person arrives, everybody already standing there stays
 *    exactly where they were (slot k is stable; only `visible` grows),
 *  - two stations never share a pattern.
 *
 * Coordinates are LOCAL to the platform: +x runs along the platform (the
 * track direction), +z runs across it (away from the track). The renderer
 * rotates them into world space with the station heading.
 */

export interface CrowdSlot {
	/** Along-platform offset, meters (centered on the station). */
	x: number;
	/** Across-platform offset, meters (positive = away from the track edge). */
	z: number;
	/** Facing, radians, relative to the platform. */
	yaw: number;
	/** Which figure variant this slot uses. */
	variant: number;
	/** Per-person scale (height variation), ~0.9..1.08. */
	scale: number;
	/** Clothing colour index for the procedural figure. */
	tint: number;
}

export interface CrowdLayoutOptions {
	/** Platform length in meters (people spread along it). */
	length?: number;
	/** Platform width in meters. */
	width?: number;
	/** Number of figure variants available. */
	variants?: number;
	/** How many slots to generate. */
	count?: number;
}

const DEFAULTS = {
	length: 60,
	width: 6,
	variants: 1,
	count: 60,
};

/** FNV-1a — small, fast, and stable across runs/platforms. */
export function hashString(str: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Build the slot list for a station. Deterministic for a given
 * (stationId, options) pair.
 */
export function buildCrowdSlots(stationId: string, options: CrowdLayoutOptions = {}): CrowdSlot[] {
	const o = {...DEFAULTS, ...options};
	const rnd = mulberry32(hashString(stationId));
	const slots: CrowdSlot[] = [];

	// People cluster near the middle of the platform (where the doors usually
	// are) rather than spreading evenly to the far ends — average of two rolls
	// gives a soft centre bias without anybody standing off the platform.
	for (let i = 0; i < o.count; i++) {
		const centreBias = (rnd() + rnd()) / 2;
		const x = (centreBias - 0.5) * o.length;
		// z is measured from the platform CENTRE (the station mesh is placed
		// there), so the usable band is ±width/2 minus a clear strip on the
		// track side — nobody stands on the yellow line, and nobody stands off
		// the back edge either. Slight bias toward the track: people wait where
		// the doors will be.
		const half = o.width / 2;
		const near = -half + 0.7;
		const far = half - 0.3;
		const zBias = Math.min(rnd(), rnd()); // toward the track edge
		const z = near + zBias * Math.max(0.2, far - near);
		slots.push({
			x,
			z,
			yaw: (rnd() - 0.5) * Math.PI * 0.8,
			variant: o.variants > 0 ? Math.floor(rnd() * o.variants) % o.variants : 0,
			scale: 0.92 + rnd() * 0.16,
			tint: Math.floor(rnd() * 8),
		});
	}

	return slots;
}

/** How many figures to draw for a given waiting count and cap. */
export function visibleCount(waiting: number, cap: number): number {
	if (cap <= 0) return 0;
	return Math.max(0, Math.min(Math.floor(waiting), Math.floor(cap)));
}
