import System from '../../System';
import UISystem from '../../systems/UISystem';
import TrainSystem from '../TrainSystem';
import SpeedLimitSystem from '../limits/SpeedLimitSystem';
import {
	buildTimetable, latenessSeconds, serviceDepartures, stopFor, type ServiceStop,
} from './ServiceTimetable';
import {lineModeInfo} from '../data/LineModes';

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
	private builtForMap: number = -1;
	/**
	 * The departure the player chose, if they chose one.
	 *
	 * Null means "the service leaving now", which is what happens if nobody ever
	 * opens the picker. Choosing one anchors the whole schedule to that time, so
	 * picking a departure that has already gone means starting late on purpose —
	 * which is a thing a driver does, and is the more interesting run.
	 */
	private chosenDeparture: number | null = null;

	public postInit(): void {
		// The line and its stations are not loaded yet.
	}

	public timetable(): ServiceStop[] {
		return this.stops;
	}

	/** The services running on this line around now, for the picker. */
	public offeredServices(count: number = 6): number[] {
		const limits = this.systemManager.getSystem(SpeedLimitSystem);

		return serviceDepartures(this.worldNow(), lineModeInfo(limits?.lineMode).headwayMin, count);
	}

	/** The departure the player is driving, or null for "leaving now". */
	public chosenService(): number | null {
		return this.chosenDeparture;
	}

	/**
	 * Drive the service leaving at this time.
	 *
	 * Forces a rebuild by clearing the line the timetable was built for, rather
	 * than rebuilding here: the update path already knows how to construct one
	 * correctly, including which way round the train is pointing.
	 */
	public chooseService(departAt: number | null): void {
		this.chosenDeparture = departAt;
		this.builtForLine = -1;
	}

	public departedAt(): number {
		return this.builtAt;
	}

	public actualFor(stationIndex: number): number | undefined {
		return this.actuals.get(stationIndex);
	}

	/**
	 * How late the train actually was into a station, in seconds.
	 *
	 * `null` when the stop was never timed — either it has no scheduled time or
	 * the train has not arrived yet. The scorer treats that as an unknown and
	 * drops it, rather than marking a driver down for the game's missing data.
	 */
	public latenessAtStation(stationIndex: number): number | null {
		const actual = this.actuals.get(stationIndex);

		if (actual === undefined) return null;

		return latenessSeconds(stopFor(this.stops, stationIndex), actual);
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

		if (
			this.builtForLine !== trainSystem.currentLineIdx ||
			this.builtForDirection !== direction ||
			this.builtForMap !== trainSystem.mapGeneration
		) {
			// A chosen service anchors the schedule; otherwise it leaves now.
			this.builtAt = this.chosenDeparture ?? this.worldNow();
			// The line's own speed profile, so the schedule is keepable at the
			// speeds the line actually permits rather than a flat guess.
			const limits = this.systemManager.getSystem(SpeedLimitSystem);
			const segments = limits?.getSegments() ?? [];
			// A bus stop is not a ferry berth. The schedule stands or falls on
			// this: a 90-second ferry dwell scheduled at a train's 45 makes
			// every crossing look late through no fault of the driver.
			const dwellS = lineModeInfo(limits?.lineMode).dwellSec;

			this.stops = buildTimetable(
				ls.realStationDists, this.builtAt, direction, trainSystem.physicsState.trainDist, segments, dwellS,
			);
			this.builtForLine = trainSystem.currentLineIdx;
			this.builtForDirection = direction;
			this.builtForMap = trainSystem.mapGeneration;
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
