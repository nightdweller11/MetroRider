import System from '~/app/System';
import TrainSystem from '../TrainSystem';
import PassengerSystem from '../passengers/PassengerSystem';
import ProfileClient from '../profiles/ProfileClient';
import SpeedLimitSystem from '../limits/SpeedLimitSystem';
import ServiceSystem from '../service/ServiceSystem';
import SignalRenderingSystem from '../limits/SignalRenderingSystem';
import JourneySystem from '../JourneySystem';
import {StopScorer, StopResult, APPROACH_M} from './StopScorer';
import {RunScorer, RunResult, badgesForRun, Badge} from './RunScorer';
import SettingsSystem from '~/app/systems/SettingsSystem';

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
	/**
	 * How late each scored stop was, captured AS IT HAPPENS.
	 *
	 * It has to be read at the stop rather than at the end of the run: the
	 * timetable is rebuilt from scratch whenever the train reverses or the line
	 * changes, so by the time a run finishes the schedule those earlier stops
	 * were judged against no longer exists.
	 */
	private stopLateness: (number | null)[] = [];
	/** Passengers delivered as of the previous stop, to take a difference from. */
	private deliveredAtLastStop = 0;

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
		this.stopLateness = [];
		this.deliveredAtLastStop = 0;
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

		// A stop rolled through was never an arrival, so it has no time to keep
		// and must not count against the timekeeping — it is already scored as
		// zero for the stop itself.
		this.stopLateness.push(
			result.verdict === 'passed'
				? null
				: this.systemManager.getSystem(ServiceSystem)?.latenessAtStation(result.stationIndex) ?? null,
		);

		// The lifetime record counts the same stop, once, from the same place —
		// rather than a second detector that could disagree with this one about
		// what a stop is.
		if (result.verdict !== 'passed') {
			// The DELTA since the last stop, not the running total: passing the
			// cumulative figure would add the whole run's deliveries again at
			// every station and the lifetime count would climb quadratically.
			const delivered = this.systemManager.getSystem(PassengerSystem)?.getSnapshot()?.delivered ?? 0;
			const sinceLastStop = Math.max(0, delivered - this.deliveredAtLastStop);

			this.deliveredAtLastStop = delivered;
			this.systemManager.getSystem(JourneySystem)?.recordStop(result.stationIndex, sinceLastStop);
		}

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
			this.stopLateness,
		);
		if (!result) return;

		// Ignoring a limit costs points — that IS the enforcement, since nothing
		// brakes the train for the driver. A little over is 2 points a second;
		// more than 25% over is 5, because that is the difference between
		// running late and taking a curve too fast. Capped, so a messy run is
		// still a run.
		const limits = this.systemManager.getSystem(SpeedLimitSystem);
		// In Simple the train already eases back under the limit, so charging
		// for the seconds it took to do that would be scoring the assist.
		const simple = this.systemManager.getSystem(SettingsSystem)
			?.settings.get('driveMode')?.statusValue === 'simple';
		const overSeconds = simple ? 0 : Math.round(limits?.overspeedSeconds ?? 0);
		const seriousSeconds = simple ? 0 : Math.round(limits?.seriousOverspeedSeconds ?? 0);
		const raw = (overSeconds - seriousSeconds) * 2 + seriousSeconds * 5;
		const penalty = Math.min(Math.round(result.totalPoints * 0.4), raw);
		if (penalty > 0) {
			result.totalPoints = Math.max(0, result.totalPoints - penalty);
			const how = seriousSeconds > 0 ? `${overSeconds}s over the limit (${seriousSeconds}s well over)` : `${overSeconds}s over the limit`;
			result.summary += ` · ${how} (−${penalty})`;
		}
		if (limits) {
			limits.overspeedSeconds = 0;
			limits.seriousOverspeedSeconds = 0;
		}

		// A signal passed at danger is the one thing on a railway that is never
		// a matter of opinion, so it is charged the same in both driving modes
		// — unlike overspeed, which the assist is entitled to forgive because
		// the assist caused it.
		const signals = this.systemManager.getSystem(SignalRenderingSystem);
		const spads = signals?.spads ?? 0;

		if (signals) signals.spads = 0;

		if (spads > 0) {
			const cost = Math.min(Math.round(result.totalPoints * 0.35), spads * 60);

			result.totalPoints = Math.max(0, result.totalPoints - cost);
			result.summary += ` · ${spads === 1 ? 'a red signal passed' : `${spads} red signals passed`} (−${cost})`;
		}

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

		// Keeping time is its own record, on its own board. It is deliberately a
		// separate kind rather than folded into the run score: a driver chasing
		// stopping accuracy and one chasing the timetable are doing different
		// things, and both are worth being best at.
		if (result.punctualityPercent !== null) {
			await client.submitScore({
				mapId: result.mapId,
				lineId: result.lineId,
				kind: 'punctuality',
				value: result.punctualityPercent,
				detail: {lineName: result.lineName, stops: result.stops.length},
			});
		}

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
