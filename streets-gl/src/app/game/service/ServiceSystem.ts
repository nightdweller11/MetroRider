import System from '../../System';
import UISystem from '../../systems/UISystem';
import TrainSystem from '../TrainSystem';
import {buildTimetable, latenessSeconds, stopFor, type ServiceStop} from './ServiceTimetable';

/**
 * The service you are running.
 *
 * Gives the driving a shape beyond "go forwards": every stop is due at a time,
 * and you are early, on time or late against it. The schedule runs on the
 * WORLD clock — the same one the time-of-day control moves — so choosing to
 * drive at night gives you a night service rather than a second, invisible
 * clock of its own.
 *
 * The timetable is rebuilt whenever the line changes, because a schedule for a
 * route you are no longer on is worse than no schedule at all.
 */
export default class ServiceSystem extends System {
	private stops: ServiceStop[] = [];
	private builtForLine: number = -1;
	private builtAt: number = 0;
	/** Actual arrival time per station index, once it happens. */
	private actuals: Map<number, number> = new Map();
	private lastRecordedIdx: number = -1;
	private builtForDirection: number = 0;

	public postInit(): void {
		// The line and its stations are not loaded yet.
	}

	public timetable(): ServiceStop[] {
		return this.stops;
	}

	public departedAt(): number {
		return this.builtAt;
	}

	public actualFor(stationIndex: number): number | undefined {
		return this.actuals.get(stationIndex);
	}

	/** Lateness at the stop coming up, in seconds, against the world clock now. */
	public currentLateness(): number | null {
		const trainSystem = this.systemManager.getSystem(TrainSystem);
		const ss = trainSystem?.stationState;

		if (!ss || this.stops.length === 0) return null;

		const idx = ss.arriving ? ss.nearestStationIdx : ss.nextStationIdx;
		const stop = stopFor(this.stops, idx);

		if (!stop) return null;

		return latenessSeconds(stop, this.worldNow());
	}

	public dueAtNext(): number | null {
		const trainSystem = this.systemManager.getSystem(TrainSystem);
		const ss = trainSystem?.stationState;

		if (!ss || this.stops.length === 0) return null;

		const idx = ss.arriving ? ss.nearestStationIdx : ss.nextStationIdx;

		return stopFor(this.stops, idx)?.dueAt ?? null;
	}

	private worldNow(): number {
		return this.systemManager.getSystem(UISystem)?.mapTime ?? Date.now();
	}

	public update(): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);

		if (!trainSystem?.gameActive) return;

		const ls = trainSystem.getCurrentLine();

		if (!ls) return;

		// Turning the train around starts a new service: the stops ahead are
		// different ones, in the other order. Keeping the old schedule would
		// give them times already gone by.
		const direction = trainSystem.physicsState.direction || 1;

		if (this.builtForLine !== trainSystem.currentLineIdx || this.builtForDirection !== direction) {
			this.builtAt = this.worldNow();
			this.stops = buildTimetable(
				ls.realStationDists, this.builtAt, direction, trainSystem.physicsState.trainDist,
			);
			this.builtForLine = trainSystem.currentLineIdx;
			this.builtForDirection = direction;
			this.actuals.clear();
			this.lastRecordedIdx = -1;
		}

		// Standing at a station is the moment the arrival is real. The station
		// state's `arriving` already means stopped in the zone, so it is the
		// right signal — and recording once per station stops a long dwell
		// from rewriting the arrival time every frame.
		const ss = trainSystem.stationState;

		if (ss?.arriving) {
			if (this.lastRecordedIdx !== ss.nearestStationIdx) {
				this.lastRecordedIdx = ss.nearestStationIdx;

				if (!this.actuals.has(ss.nearestStationIdx)) {
					this.actuals.set(ss.nearestStationIdx, this.worldNow());
				}
			}
		} else {
			this.lastRecordedIdx = -1;
		}
	}
}
