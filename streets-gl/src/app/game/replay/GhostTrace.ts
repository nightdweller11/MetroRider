/**
 * Racing the last person who drove this line: you.
 *
 * The score card grades a run and the board ranks it, but neither answers the
 * question a child asks on the second lap — *am I doing better than last
 * time?* — while there is still time to do something about it. A number at the
 * end is a verdict; a number that moves while you drive is a race.
 *
 * A ghost is deliberately NOT a recording of a train. It is a table of "how
 * long it took me to get this far", one entry every fifty metres, which is all
 * that is needed to say whether you are ahead and is small enough to keep for
 * dozens of lines in a browser's storage. Nothing is drawn, nothing is
 * animated, nothing has to be kept in step with the physics.
 *
 * Pure — no storage, no clock, no train. The system that owns it does the
 * accumulating; this only knows what the numbers mean.
 */

/** How far apart the checkpoints sit, metres. */
export const CHECKPOINT_M = 50;

/** The longest run kept, in checkpoints. 2000 × 50 m = 100 km. */
export const MAX_CHECKPOINTS = 2000;

/**
 * Inside this the two runs are level, seconds.
 *
 * Without it the chip flickers between ahead and behind on the same stretch of
 * track, which reads as the game being unable to make its mind up rather than
 * as a close race.
 */
export const DEAD_BAND_S = 0.6;

/**
 * A run must reach at least this many checkpoints to be worth keeping.
 *
 * Selecting a line and immediately picking another one produces a "run" of a
 * few metres, and saving that as the best would mean every later run is
 * hopelessly behind a ghost that never went anywhere.
 */
export const MIN_CHECKPOINTS = 6;

export interface GhostTrace {
	/** Which line, from which station, which way — see `traceKey`. */
	key: string;
	/** Metres between checkpoints. Stored so an old trace stays readable. */
	step: number;
	/** `times[i]` = seconds elapsed when `i × step` metres had been driven. */
	times: number[];
	/** The whole run, so the tail past the last checkpoint is not lost. */
	totalSeconds: number;
	totalMetres: number;
	/** When it was set, epoch ms. Used to decide what to forget. */
	savedAt: number;
}

/**
 * What makes two runs comparable.
 *
 * The starting station and direction are in the key on purpose. A run from the
 * far end of the line covers different ground, and calling one of them "your
 * best" would have the game comparing a journey to a different journey.
 */
export function traceKey(
	mapId: string,
	lineId: string,
	startStationIndex: number,
	direction: number,
): string {
	return `${mapId}::${lineId}::${startStationIndex}::${direction >= 0 ? 'f' : 'r'}`;
}

export function emptyTrace(key: string, step: number = CHECKPOINT_M): GhostTrace {
	return {key, step, times: [0], totalSeconds: 0, totalMetres: 0, savedAt: 0};
}

/**
 * Note how far the run has got and when.
 *
 * Called every frame; fills in every checkpoint crossed since the last one,
 * interpolating across them, because at 200 km/h a single frame covers more
 * than a whole checkpoint and a table with holes in it cannot be looked up in
 * one step.
 *
 * Returns the SAME object when nothing new was crossed, so a caller can use
 * identity as a cheap "did anything change".
 */
export function recordProgress(trace: GhostTrace, metres: number, seconds: number): GhostTrace {
	if (!Number.isFinite(metres) || !Number.isFinite(seconds)) return trace;
	if (metres < 0 || seconds < 0) return trace;

	const step = trace.step > 0 ? trace.step : CHECKPOINT_M;
	const have = trace.times.length;
	const target = Math.min(Math.floor(metres / step), MAX_CHECKPOINTS);

	if (target < have) return trace;

	const lastM = (have - 1) * step;
	const lastS = trace.times[have - 1];

	// Time going backwards is a clock being reset under us, not a train
	// reversing — a reversing train still takes time to do it.
	if (seconds < lastS) return trace;

	const spanM = metres - lastM;
	const spanS = seconds - lastS;

	if (spanM <= 0) return trace;

	const times = trace.times.slice();

	for (let i = have; i <= target; i++) {
		const at = i * step;
		const t = lastS + spanS * ((at - lastM) / spanM);

		// Monotonic by construction above, but clamped anyway: the table is
		// looked up by binary reasoning that assumes it only ever rises.
		times.push(Math.max(t, times[times.length - 1]));
	}

	return {...trace, times};
}

/** Close the run off, keeping the tail past the final checkpoint. */
export function finishTrace(
	trace: GhostTrace,
	metres: number,
	seconds: number,
	now: number,
): GhostTrace {
	const safeM = Number.isFinite(metres) && metres > 0 ? metres : (trace.times.length - 1) * trace.step;
	const safeS = Number.isFinite(seconds) && seconds > 0 ? seconds : trace.times[trace.times.length - 1];

	return {...trace, totalMetres: safeM, totalSeconds: safeS, savedAt: now};
}

/** Long enough to race against. */
export function isUsableTrace(trace: GhostTrace | null | undefined): trace is GhostTrace {
	return !!trace && Array.isArray(trace.times) && trace.times.length >= MIN_CHECKPOINTS;
}

/**
 * How long the ghost took to get this far, or null where it never went.
 *
 * Null is a real answer and the caller must show nothing rather than a zero:
 * "your best took 0 seconds to reach here" is worse than saying nothing.
 */
export function ghostSecondsAt(trace: GhostTrace | null | undefined, metres: number): number | null {
	if (!isUsableTrace(trace)) return null;
	if (!Number.isFinite(metres) || metres < 0) return null;

	const step = trace.step > 0 ? trace.step : CHECKPOINT_M;
	const i = Math.floor(metres / step);
	const times = trace.times;

	if (i + 1 < times.length) {
		const frac = metres / step - i;

		return times[i] + (times[i + 1] - times[i]) * frac;
	}

	// Past the last checkpoint but inside the run: interpolate across the tail
	// the run ended on, which is up to one checkpoint long.
	const lastM = (times.length - 1) * step;

	if (metres <= trace.totalMetres && trace.totalMetres > lastM) {
		const frac = (metres - lastM) / (trace.totalMetres - lastM);

		return times[times.length - 1] + (trace.totalSeconds - times[times.length - 1]) * frac;
	}

	if (metres === lastM) return times[times.length - 1];

	return null;
}

/**
 * Seconds you are ahead of the ghost at this point. Negative is behind.
 *
 * Ahead is positive because that is the direction a player wants the number to
 * go, and a chip that counts up when you are doing well needs no explaining.
 */
export function ghostDelta(
	trace: GhostTrace | null | undefined,
	metres: number,
	seconds: number,
): number | null {
	const ghost = ghostSecondsAt(trace, metres);

	if (ghost === null || !Number.isFinite(seconds)) return null;

	return ghost - seconds;
}

function sayGap(seconds: number): string {
	const s = Math.abs(seconds);

	if (s < 60) return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;

	const mins = Math.floor(s / 60);

	return `${mins}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

/** The chip on the console: a short word and which way it is going. */
export function ghostChip(delta: number | null): {text: string; state: 'ahead' | 'behind' | 'level'} | null {
	if (delta === null || !Number.isFinite(delta)) return null;
	if (Math.abs(delta) < DEAD_BAND_S) return {text: 'level', state: 'level'};
	if (delta > 0) return {text: `${sayGap(delta)} up`, state: 'ahead'};

	return {text: `${sayGap(delta)} down`, state: 'behind'};
}

/** The same thing said in full, for the run card. */
export function describeGhostDelta(delta: number | null): string {
	if (delta === null || !Number.isFinite(delta)) return '';
	if (Math.abs(delta) < DEAD_BAND_S) return 'Level with your best run';
	if (delta > 0) return `${sayGap(delta)} faster than your best`;

	return `${sayGap(delta)} slower than your best`;
}

/**
 * Seconds up on the record at the last point BOTH runs reached.
 *
 * Measured at the shorter of the two distances, never at this run's own. Two
 * runs never end on exactly the same metre — a stop five metres short of the
 * mark is five metres shorter — so asking the record how long it took to reach
 * ground it never covered returns nothing, and the comparison vanished on
 * almost every run that went even slightly further than the record.
 *
 * `metres`/`seconds` are where THIS run has got to, which may be past its own
 * last checkpoint (mid-run) — so the trace is given that end for the lookup
 * rather than being asked about ground it has not yet filled in.
 */
export function deltaAtCommonDistance(
	mine: GhostTrace,
	best: GhostTrace | null | undefined,
	metres: number,
	seconds: number,
): number | null {
	if (!isUsableTrace(best)) return null;
	if (!Number.isFinite(metres) || !Number.isFinite(seconds) || metres < 0) return null;

	const common = Math.min(metres, best.totalMetres || metres);
	const theirs = ghostSecondsAt(best, common);

	if (theirs === null) return null;

	const ours = common >= metres
		? seconds
		: ghostSecondsAt({...mine, totalMetres: metres, totalSeconds: seconds}, common);

	if (ours === null) return null;

	return theirs - ours;
}

/**
 * Whether this run beats the one being kept.
 *
 * Compared at the distance BOTH runs reached, not by total time: a run that
 * went further will always have taken longer, and calling that slower would
 * mean the record could only ever be beaten by giving up earlier.
 */
export function isFaster(candidate: GhostTrace, best: GhostTrace | null | undefined): boolean {
	if (!isUsableTrace(candidate)) return false;
	if (!isUsableTrace(best)) return true;

	// A run that stopped a long way short is not a faster run, however quick it
	// was over the ground it did cover.
	if (candidate.totalMetres < best.totalMetres * 0.95) return false;

	const common = Math.min(candidate.totalMetres, best.totalMetres);
	const a = ghostSecondsAt(candidate, common);
	const b = ghostSecondsAt(best, common);

	if (a === null || b === null) return candidate.totalSeconds < best.totalSeconds;

	return a < b;
}

/**
 * Rounded to a tenth of a second before it is written out.
 *
 * Full float precision would triple the size of a stored trace to record
 * timing nobody can drive to.
 */
export function packTrace(trace: GhostTrace): GhostTrace {
	return {
		...trace,
		times: trace.times.map(t => Math.round(t * 10) / 10),
		totalSeconds: Math.round(trace.totalSeconds * 10) / 10,
		totalMetres: Math.round(trace.totalMetres),
	};
}

/**
 * Read a trace back, or null if it is not one.
 *
 * Storage is a place other versions of this game have written to, so anything
 * out of it is treated as untrusted until each field has been checked.
 */
export function parseTrace(raw: unknown): GhostTrace | null {
	if (!raw || typeof raw !== 'object') return null;

	const t = raw as Partial<GhostTrace>;

	if (typeof t.key !== 'string' || !Array.isArray(t.times)) return null;
	if (!t.times.every(n => typeof n === 'number' && Number.isFinite(n))) return null;

	const step = typeof t.step === 'number' && t.step > 0 ? t.step : CHECKPOINT_M;

	return {
		key: t.key,
		step,
		times: t.times.slice(0, MAX_CHECKPOINTS + 1),
		totalSeconds: typeof t.totalSeconds === 'number' && Number.isFinite(t.totalSeconds) ? t.totalSeconds : 0,
		totalMetres: typeof t.totalMetres === 'number' && Number.isFinite(t.totalMetres) ? t.totalMetres : 0,
		savedAt: typeof t.savedAt === 'number' && Number.isFinite(t.savedAt) ? t.savedAt : 0,
	};
}

/** How many lines' bests are kept before the oldest is forgotten. */
export const MAX_KEPT = 60;

/** Drop the least recently set, so storage cannot grow without end. */
export function pruneTraces(traces: Record<string, GhostTrace>): Record<string, GhostTrace> {
	const keys = Object.keys(traces);

	if (keys.length <= MAX_KEPT) return traces;

	const ordered = keys.sort((a, b) => (traces[b]?.savedAt ?? 0) - (traces[a]?.savedAt ?? 0));
	const out: Record<string, GhostTrace> = {};

	for (const key of ordered.slice(0, MAX_KEPT)) out[key] = traces[key];

	return out;
}
