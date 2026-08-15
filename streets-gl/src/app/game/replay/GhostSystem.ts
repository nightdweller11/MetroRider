import System from '~/app/System';
import TrainSystem from '../TrainSystem';
import ProfileClient from '../profiles/ProfileClient';
import {
	deltaAtCommonDistance, emptyTrace, finishTrace, isFaster, isUsableTrace, packTrace,
	parseTrace, pruneTraces, recordProgress, traceKey, type GhostTrace,
} from './GhostTrace';

/**
 * The run you are racing.
 *
 * Keeps one trace per line-and-direction and, while a run is going, a second
 * one being written. Everything about what the numbers MEAN is in
 * `GhostTrace`; this is the part that has a clock, a train and a place to save
 * things — deliberately the smaller half.
 *
 * Local storage is the authority, exactly as the journey record is: a guest is
 * still a player, and their best run is theirs whether or not they ever make
 * an account.
 */

const STORAGE_KEY = 'metrorider.ghosts.v1';

/** The longest single frame that counts, seconds. */
const MAX_STEP_S = 1;

/**
 * The speed at which the run is under way, m/s.
 *
 * The clock does not start until the train moves. Time spent at the platform
 * BEFORE setting off is not part of the race — the player is reading the
 * timetable, choosing a train, or looking at the map — and counting it made
 * the console announce "24s down" to somebody who had not yet released the
 * brake, which is a lie about a race that had not started. Dwell at every
 * LATER station still counts: standing too long at a stop genuinely is a
 * slower run.
 */
const DEPARTED_MS = 0.5;

export default class GhostSystem extends System {
	private best: Record<string, GhostTrace> = {};
	private current: GhostTrace | null = null;
	private elapsedS = 0;
	private travelledM = 0;
	private racing: GhostTrace | null = null;
	private deltaS: number | null = null;
	private departed = false;

	public postInit(): void {
		this.best = this.load();
	}

	/**
	 * Seconds up on the best run, negative for down, null when there is
	 * nothing to compare against.
	 */
	public delta(): number | null {
		return this.departed ? this.deltaS : null;
	}

	/**
	 * Start recording, and load the record for this exact journey.
	 *
	 * Called by the scorer, which is the one place that already knows when a
	 * run begins — a second detector here could disagree with it about what a
	 * run is, and then the card and the chip would be describing different
	 * things.
	 */
	public beginRun(mapId: string, lineId: string, startStationIndex: number, direction: number): void {
		const key = traceKey(mapId, lineId, startStationIndex, direction);

		this.current = emptyTrace(key);
		this.racing = this.best[key] ?? null;
		this.elapsedS = 0;
		this.travelledM = 0;
		this.deltaS = null;
		this.departed = false;
	}

	/**
	 * Close the run off and keep it if it was quicker.
	 *
	 * Returns how it went against the record it was racing — which is the
	 * record as it stood BEFORE this run, so the card can say "faster than
	 * your best" about the thing the player was actually chasing.
	 */
	public finishRun(): {delta: number | null; improved: boolean; hadGhost: boolean} {
		const run = this.current;

		if (!run) return {delta: null, improved: false, hadGhost: false};

		const done = finishTrace(run, this.travelledM, this.elapsedS, Date.now());
		const previous = this.racing;
		const hadGhost = this.departed && isUsableTrace(previous);
		const delta = hadGhost ? deltaAtCommonDistance(done, previous, this.travelledM, this.elapsedS) : null;
		const improved = isFaster(done, previous);

		if (improved) {
			this.best = pruneTraces({...this.best, [done.key]: done});
			this.save();
		}

		this.current = null;
		this.deltaS = null;

		return {delta, improved, hadGhost};
	}

	public update(deltaTime: number): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);

		if (!trainSystem?.gameActive || !this.current) return;

		const speed = Math.abs(trainSystem.physicsState.trainSpeed);

		// The race starts when the train does.
		if (!this.departed) {
			if (speed < DEPARTED_MS) return;

			this.departed = true;
		}

		// Capped for the reason the journey record caps: a backgrounded tab
		// hands back one enormous frame, and an uncapped one would put minutes
		// on the clock the player never sat through.
		const step = Math.min(Math.max(deltaTime, 0), MAX_STEP_S);

		// Once under way, time runs whether or not the train does. Sitting too
		// long at a platform IS a slower run, and a clock that only ticked
		// while moving would score dawdling as free.
		this.elapsedS += step;
		this.travelledM += speed * step;

		this.current = recordProgress(this.current, this.travelledM, this.elapsedS);

		if (isUsableTrace(this.racing) && this.current) {
			// Held at the record's own finish line once you run past it, rather
			// than blanking: driving beyond where the ghost ever reached is
			// winning the race, and the chip should say by how much, not
			// disappear in the last few metres of every run.
			this.deltaS = deltaAtCommonDistance(this.current, this.racing, this.travelledM, this.elapsedS);
		}
	}

	private load(): Record<string, GhostTrace> {
		try {
			const raw = window.localStorage.getItem(STORAGE_KEY);

			if (!raw) return {};

			const parsed = JSON.parse(raw) as Record<string, unknown>;
			const out: Record<string, GhostTrace> = {};

			// One bad entry loses one line's record, not every line's.
			for (const [key, value] of Object.entries(parsed ?? {})) {
				const trace = parseTrace(value);

				if (trace) out[key] = trace;
			}

			return out;
		} catch {
			return {};
		}
	}

	private save(): void {
		const packed: Record<string, GhostTrace> = {};

		for (const [key, trace] of Object.entries(this.best)) packed[key] = packTrace(trace);

		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(packed));
		} catch {
			// A full or blocked store is not worth interrupting a game for.
		}

		void ProfileClient.get().setData?.(STORAGE_KEY, packed);
	}
}
