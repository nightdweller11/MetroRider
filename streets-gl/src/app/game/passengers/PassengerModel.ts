/**
 * Passenger demand + boarding model.
 *
 * Pure logic, no engine dependencies, so it can be unit-tested directly and
 * driven from a System (`PassengerSystem`) that owns the wiring.
 *
 * The one invariant everything else rests on: **passengers are conserved**.
 * `waiting(all stations) + aboard + delivered` only changes when demand
 * spawns new passengers — never through boarding, alighting or a direction
 * change. `totalSpawned` is tracked so a test can assert exactly that.
 */

export interface PassengerStationDemand {
	/** Station id (stable across a map load). */
	id: string;
	/** Normalized demand weight, 0..1. 0.5 when the map gives us nothing. */
	density: number;
}

export interface PassengerModelOptions {
	/** Passengers per minute at density 1.0 before the demand multiplier. */
	ratePerMinute?: number;
	/** Gameplay multiplier (Calm 0.5 / Normal 1 / Rush 2). */
	demandScale?: number;
	/** Hard cap on people waiting at one platform. */
	maxWaiting?: number;
	/** Seats+standing per car. */
	capacityPerCar?: number;
	/** People per second that can step off one train, per car. */
	alightPerSecPerCar?: number;
	/** People per second that can step on one train, per car. */
	boardPerSecPerCar?: number;
	/** Deterministic RNG in [0,1); defaults to Math.random. */
	random?: () => number;
}

const DEFAULTS = {
	ratePerMinute: 8,
	demandScale: 1,
	maxWaiting: 240,
	capacityPerCar: 60,
	alightPerSecPerCar: 3,
	boardPerSecPerCar: 2.5,
};

export interface DoorTickResult {
	/** Whole passengers who stepped off this tick. */
	alighted: number;
	/** Whole passengers who stepped on this tick. */
	boarded: number;
	/** True while anybody is still moving through the doors. */
	busy: boolean;
}

export class PassengerModel {
	private readonly opts: Required<Omit<PassengerModelOptions, 'random'>> & {random: () => number};

	private stations: PassengerStationDemand[] = [];
	/** waiting[i] — fractional accumulation is kept so slow demand still works. */
	private waiting: number[] = [];
	/** aboard[i] — riders on the train destined for station i. */
	private aboardByDest: number[] = [];
	/** Fractional carry for door flow so low frame times don't lose people. */
	private alightCarry = 0;
	private boardCarry = 0;

	public delivered = 0;
	public totalSpawned = 0;
	/** People we rolled past without opening the doors, for the run card. */
	public leftBehind = 0;

	public constructor(options: PassengerModelOptions = {}) {
		this.opts = {
			...DEFAULTS,
			random: Math.random,
			...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)),
		} as Required<Omit<PassengerModelOptions, 'random'>> & {random: () => number};
	}

	public setStations(stations: PassengerStationDemand[]): void {
		this.stations = stations.map(s => ({
			id: s.id,
			density: Math.max(0, Math.min(1, Number.isFinite(s.density) ? s.density : 0.5)),
		}));
		this.waiting = new Array(this.stations.length).fill(0);
		this.aboardByDest = new Array(this.stations.length).fill(0);
		this.delivered = 0;
		this.totalSpawned = 0;
		this.leftBehind = 0;
		this.alightCarry = 0;
		this.boardCarry = 0;
	}

	public setDemandScale(scale: number): void {
		this.opts.demandScale = Math.max(0, scale);
	}

	public get stationCount(): number {
		return this.stations.length;
	}

	public getWaiting(index: number): number {
		return Math.floor(this.waiting[index] ?? 0);
	}

	public getWaitingExact(index: number): number {
		return this.waiting[index] ?? 0;
	}

	public getAboard(): number {
		let sum = 0;
		for (const n of this.aboardByDest) sum += n;
		return sum;
	}

	public getAboardFor(index: number): number {
		return this.aboardByDest[index] ?? 0;
	}

	/** waiting + aboard + delivered — must equal totalSpawned at all times. */
	public getTotalTracked(): number {
		let sum = this.delivered;
		for (const n of this.waiting) sum += n;
		for (const n of this.aboardByDest) sum += n;
		return sum;
	}

	/** Grow the queues. `dt` in seconds. */
	public accumulate(dt: number): void {
		if (dt <= 0) return;
		const perSec = (this.opts.ratePerMinute / 60) * this.opts.demandScale;
		for (let i = 0; i < this.stations.length; i++) {
			const add = this.stations[i].density * perSec * dt;
			if (add <= 0) continue;
			const next = Math.min(this.opts.maxWaiting, this.waiting[i] + add);
			this.totalSpawned += next - this.waiting[i];
			this.waiting[i] = next;
		}
	}

	/**
	 * One tick of door flow at `stationIndex`. Alighting has priority over
	 * boarding (you cannot board through a door people are still leaving by).
	 */
	public tickDoors(stationIndex: number, dt: number, cars: number): DoorTickResult {
		const result: DoorTickResult = {alighted: 0, boarded: 0, busy: false};
		if (stationIndex < 0 || stationIndex >= this.stations.length || dt <= 0) return result;

		const carCount = Math.max(1, cars);

		// --- alight ---
		const arriving = this.aboardByDest[stationIndex];
		if (arriving > 0) {
			this.alightCarry += this.opts.alightPerSecPerCar * carCount * dt;
			const step = Math.min(arriving, Math.floor(this.alightCarry));
			if (step > 0) {
				this.alightCarry -= step;
				this.aboardByDest[stationIndex] -= step;
				this.delivered += step;
				result.alighted = step;
			}
			result.busy = this.aboardByDest[stationIndex] > 0;
		} else {
			this.alightCarry = 0;
		}

		// --- board ---
		if (!result.busy) {
			const capacity = this.opts.capacityPerCar * carCount - this.getAboard();
			const waitingWhole = Math.floor(this.waiting[stationIndex]);
			const room = Math.max(0, Math.min(capacity, waitingWhole));
			if (room > 0) {
				this.boardCarry += this.opts.boardPerSecPerCar * carCount * dt;
				const step = Math.min(room, Math.floor(this.boardCarry));
				if (step > 0) {
					this.boardCarry -= step;
					this.waiting[stationIndex] -= step;
					for (let n = 0; n < step; n++) {
						const dest = this.sampleDestination(stationIndex);
						this.aboardByDest[dest] += 1;
					}
					result.boarded = step;
				}
				result.busy = true;
			} else {
				this.boardCarry = 0;
			}
		}

		return result;
	}

	/** Called when the train leaves a platform without having opened its doors. */
	public noteSkipped(stationIndex: number): void {
		const missed = Math.floor(this.waiting[stationIndex] ?? 0);
		if (missed > 0) this.leftBehind += missed;
	}

	/**
	 * Destination for someone boarding at `from`: any OTHER station, weighted
	 * by density. Direction/loop shaping is applied by the caller through
	 * `setDirection`, which restricts the candidate set to stations ahead.
	 */
	private direction = 1;
	private isLoop = false;

	public setDirection(direction: number, isLoop: boolean): void {
		this.direction = direction >= 0 ? 1 : -1;
		this.isLoop = isLoop;
	}

	public sampleDestination(from: number): number {
		const n = this.stations.length;
		if (n < 2) return from;

		const candidates: number[] = [];
		for (let step = 1; step < n; step++) {
			const raw = from + step * this.direction;
			if (this.isLoop) {
				candidates.push(((raw % n) + n) % n);
			} else if (raw >= 0 && raw < n) {
				candidates.push(raw);
			}
		}
		// End of a non-loop line: everyone rides back the other way.
		if (candidates.length === 0) {
			for (let i = 0; i < n; i++) if (i !== from) candidates.push(i);
		}

		let total = 0;
		for (const i of candidates) total += this.stations[i].density + 0.05;
		let roll = this.opts.random() * total;
		for (const i of candidates) {
			roll -= this.stations[i].density + 0.05;
			if (roll <= 0) return i;
		}
		return candidates[candidates.length - 1];
	}

	/** Seed the platforms so a fresh line isn't empty. `minutes` of demand. */
	public preload(minutes: number): void {
		this.accumulate(minutes * 60);
	}
}
