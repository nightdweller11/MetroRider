/**
 * Passengers, as points.
 *
 * Until now the run card SAID how many people you delivered and the score
 * ignored it: the number sat in a sentence and counted for nothing. This is
 * the rule that makes it count, kept apart from the scorer so the mark scheme
 * can be read, tested and quoted on the card in one place.
 *
 * **The rule: 1 point for every passenger you set down, up to 20 for each stop
 * you make.** A stop is worth up to 175 for the stopping and 15 for keeping
 * time, so at most 20 of a stop's 210 — about a tenth of a run — comes from
 * passengers. Enough to see on the card and to care about; not so much that
 * the game turns into a head-count. Stopping well is still worth most.
 *
 * The cap is per stop MADE, not per passenger: deliveries pile up towards the
 * end of a line (everyone gets off at the terminus), and the demand setting
 * (Calm / Normal / Rush) changes how many people there are to carry. Without
 * a cap a Rush run would out-score the same drive on Normal for nothing the
 * driver did, and a score board would compare settings rather than drivers.
 * Measured on the model (ten stops, a minute between them, three cars): a run
 * delivers ~190 on Calm, ~380 on Normal and ~440 on Rush. The cap puts Normal
 * and Rush on the same 200, and Calm within a dozen of it.
 *
 * **Left behind costs nothing, deliberately.** Rolling through a station
 * already scores zero for that stop — F2's rule is "no punishment screens" —
 * and charging again for the people on its platform would fine the same act
 * twice. Those people are already a cost: every one of them is a point you
 * did not get. Express services (F4) skip stations on purpose, and a penalty
 * would punish the timetable rather than the driver. The card still says how
 * many were left, because that is worth knowing.
 *
 * Pure: counts in, points out.
 */

/** Points for each passenger set down. */
export const POINTS_PER_PASSENGER = 1;

/** The most passengers can be worth, per stop made. */
export const PASSENGER_POINTS_PER_STOP = 20;

/** Points the passengers on a run are worth. */
export function passengerPoints(delivered: number, stopsMade: number): number {
	if (!(delivered > 0) || !(stopsMade > 0)) return 0;

	const earned = Math.floor(delivered) * POINTS_PER_PASSENGER;

	return Math.min(earned, Math.floor(stopsMade) * PASSENGER_POINTS_PER_STOP);
}

/** The mark scheme, the way the card says it. */
export function describePassengerScheme(delivered: number, stopsMade: number): string {
	const base = `1 point a passenger, up to ${PASSENGER_POINTS_PER_STOP} a stop`;
	const capped = Math.floor(Math.max(0, delivered)) * POINTS_PER_PASSENGER
		> Math.max(0, Math.floor(stopsMade)) * PASSENGER_POINTS_PER_STOP;

	return capped ? `${base} — you hit the top` : base;
}

/** What the passenger model has counted, since it was last reset. */
export interface PassengerCounts {
	delivered: number;
	leftBehind: number;
	/** Of the delivered, how many were set down at a change station. */
	atInterchanges: number;
}

const ZERO: PassengerCounts = {delivered: 0, leftBehind: 0, atInterchanges: 0};

/**
 * The passengers that belong to THIS run.
 *
 * The passenger model counts from the moment a line is picked, and a run is
 * shorter than that: a loop line rolls one run into the next, and jumping to
 * another stop or turning round starts a new run on the same line. Reading the
 * model's totals straight onto the card gave the second run the first one's
 * passengers as well.
 *
 * So a run takes a baseline when it starts and reports the difference. If the
 * model is reset underneath it (a new line, a new map) its counters go DOWN,
 * which nothing else can make them do — that is taken as the reset it is, and
 * the run counts from zero.
 */
export class PassengerTally {
	private base: PassengerCounts = {...ZERO};

	public start(now: PassengerCounts): void {
		this.base = {...now};
	}

	public read(now: PassengerCounts): PassengerCounts {
		if (
			now.delivered < this.base.delivered
			|| now.leftBehind < this.base.leftBehind
			|| now.atInterchanges < this.base.atInterchanges
		) {
			this.base = {...ZERO};
		}

		return {
			delivered: Math.max(0, now.delivered - this.base.delivered),
			leftBehind: Math.max(0, now.leftBehind - this.base.leftBehind),
			atInterchanges: Math.max(0, now.atInterchanges - this.base.atInterchanges),
		};
	}
}

/**
 * When a finished run may be closed.
 *
 * A run is complete the moment the last stop is SCORED — and that is when the
 * train comes to a stand, before the doors have opened. Closing it there sent
 * the card up before a single passenger got off at the terminus, which is
 * where most of a line's passengers are going: the biggest delivery of the
 * run landed in the NEXT run instead. So the run waits for the platform work.
 */
export interface FinishWait {
	/** Doors open right now. */
	doorsOpen: boolean;
	/** Whether the doors have opened at all since the last stop was scored. */
	doorsWereOpened: boolean;
	/** Riders still aboard whose stop this is. */
	stillToAlight: number;
	/** Train speed, m/s. */
	speed: number;
	/** Seconds since the last stop was scored. */
	waitedS: number;
}

/** Longest a finished run waits for its passengers, seconds. */
export const FINISH_WAIT_MAX_S = 45;

export function readyToFinish(w: FinishWait): boolean {
	if (w.waitedS >= FINISH_WAIT_MAX_S) return true;

	if (w.doorsWereOpened) {
		// Everyone for this stop is off, or the driver shut the doors on them.
		return w.stillToAlight <= 0 || !w.doorsOpen;
	}

	// Never opened up and has driven away: there is nothing more to wait for.
	return w.speed > 1;
}

/**
 * "👥 +12" on the points chip while passengers are getting off.
 *
 * The run total climbs from two places now — the stops and the people — and a
 * number that jumps by a few points with nothing to say why reads as noise.
 * For a moment after people are set down the chip says where the points came
 * from, then goes back to the total.
 */
export class PassengerPointsFlash {
	private last = 0;
	private shownFrom = 0;
	private until = 0;

	public constructor(private readonly holdMs = 1800) {}

	/** Text to show instead of the total, or null for the total. */
	public update(points: number, nowMs: number): string | null {
		if (points < this.last) {
			// A new run: start counting from its own zero, show nothing.
			this.last = points;
			this.shownFrom = points;
			this.until = 0;

			return null;
		}

		if (points > this.last) {
			if (nowMs >= this.until) this.shownFrom = this.last;
			this.last = points;
			this.until = nowMs + this.holdMs;
		}

		return nowMs < this.until ? `👥 +${this.last - this.shownFrom}` : null;
	}
}
