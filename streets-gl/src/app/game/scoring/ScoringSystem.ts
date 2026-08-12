import System from '~/app/System';
import TrainSystem from '../TrainSystem';
import PassengerSystem from '../passengers/PassengerSystem';
import ProfileClient from '../profiles/ProfileClient';
import {StopScorer, StopResult, APPROACH_M} from './StopScorer';
import {RunScorer, RunResult, badgesForRun, Badge} from './RunScorer';

/**
 * Turns driving into a score.
 *
 * Owns one `StopScorer` (the current approach) and one `RunScorer` (the whole
 * run). Everything user-visible is delegated: this system only decides WHEN a
 * stop starts, ends and when a run is finished.
 */
export default class ScoringSystem extends System {
	private readonly stop = new StopScorer();
	private readonly run = new RunScorer();

	private lastLineKey = '';
	private lastDist = 0;
	private lastFrameTime = 0;

	/** Set by GameUISystem so cards can be shown without this system knowing the DOM. */
	public onStopScored: ((result: StopResult, stationName: string) => void) | null = null;
	public onRunFinished: ((result: RunResult, badges: Badge[], isPersonalBest: boolean, best: number | null) => void) | null = null;

	public postInit(): void {
		// Nothing: scoring starts when a line is selected and the game is running.
	}

	public update(deltaTime: number): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);
		if (!trainSystem?.gameActive) return;

		const ls = trainSystem.getCurrentLine();
		const state = trainSystem.stationState;
		if (!ls || !state) return;

		const lineKey = `${trainSystem.mapName}::${ls.parsed.id}`;
		if (lineKey !== this.lastLineKey) {
			this.lastLineKey = lineKey;
			this.startRun(trainSystem, ls);
		}

		const dist = trainSystem.physicsState.trainDist;
		const speed = trainSystem.physicsState.trainSpeed;
		const direction = trainSystem.physicsState.direction;

		// Start scoring an approach once the next station is close enough that
		// braking has begun to matter.
		const targetIdx = state.nextStationIdx >= 0 ? state.nextStationIdx : state.nearestStationIdx;
		if (
			!this.stop.isTracking()
			&& targetIdx >= 0
			&& state.nextStationDist < APPROACH_M
			&& speed > 1
		) {
			const marker = ls.realStationDists[targetIdx];
			if (marker !== undefined) {
				this.stop.beginApproach(targetIdx, marker, speed);
			}
		}

		if (this.stop.isTracking()) {
			const result = this.stop.update({
				trainDist: dist,
				speed,
				doorsOpen: trainSystem.physicsState.doorsOpen,
				dt: Math.min(deltaTime, 0.25),
			}, direction);

			if (result) {
				this.recordStop(result, ls);
			}
		}

		this.lastDist = dist;
	}

	private startRun(
		trainSystem: TrainSystem,
		ls: {parsed: {id: string; name: string; stations: unknown[]; isLoop: boolean}},
	): void {
		this.stop.reset();
		this.run.abandon();
		this.run.start({
			mapId: trainSystem.mapName || 'unknown-map',
			lineId: ls.parsed.id,
			lineName: ls.parsed.name,
			stationCount: ls.parsed.stations.length,
			isLoop: ls.parsed.isLoop,
		}, performance.now());
	}

	private recordStop(
		result: StopResult,
		ls: {parsed: {stations: {name: string}[]}},
	): void {
		this.run.addStop(result);

		const stationName = ls.parsed.stations[result.stationIndex]?.name ?? '';
		this.onStopScored?.(result, stationName);

		if (result.verdict !== 'passed' && this.run.isComplete(result.stationIndex)) {
			void this.finishRun(true);
		}
	}

	/** Finish the current run, post the score, and hand the card to the UI. */
	public async finishRun(completedLine: boolean): Promise<void> {
		const passengers = this.systemManager.getSystem(PassengerSystem)?.getSnapshot();
		const result = this.run.finalize(
			performance.now(),
			{delivered: passengers?.delivered ?? 0, leftBehind: passengers?.leftBehind ?? 0},
			completedLine,
		);
		if (!result) return;

		const badges = badgesForRun(result, new Date().getHours());

		// A guest's run is queued locally and uploaded if they ever sign in —
		// finishing a good run and losing it would be the worst first impression.
		const client = ProfileClient.get();
		const posted = await client.submitScore({
			mapId: result.mapId,
			lineId: result.lineId,
			kind: 'run-score',
			value: result.totalPoints,
			detail: {
				lineName: result.lineName,
				stops: result.stops.length,
				perfect: result.perfectStops,
				delivered: result.passengersDelivered,
				completedLine: result.completedLine,
			},
		});

		this.onRunFinished?.(result, badges, posted?.isPersonalBest ?? false, posted?.best ?? null);

		// A finished run rolls straight into the next one, so a loop line keeps
		// scoring lap after lap without the player restarting anything.
		const trainSystem = this.systemManager.getSystem(TrainSystem);
		const ls = trainSystem?.getCurrentLine();
		if (trainSystem && ls) this.startRun(trainSystem, ls as never);
	}

	public getRunTotal(): number {
		return this.run.getTotalPoints();
	}

	public getStopCount(): number {
		return this.run.getStops().length;
	}
}
