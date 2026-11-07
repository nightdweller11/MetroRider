import System from '~/app/System';
import TrainSystem from '../TrainSystem';
import AssetConfigSystem, {DEMAND_SCALES} from '../assets/AssetConfigSystem';
import {PassengerModel} from './PassengerModel';
import {changePoints, type InterchangeIndex} from '../data/Interchanges';

/**
 * Runs the passenger demand model against the live train.
 *
 * Owns nothing visual: the HUD reads `getSnapshot()`, and
 * `PassengerRenderingSystem` reads `waitingAt()` to decide how many figures
 * stand on each platform.
 */
export default class PassengerSystem extends System {
	private readonly model = new PassengerModel();
	private boundLineKey = '';
	private lastDoorsOpen = false;
	/** Station whose doors we are currently working, -1 when closed. */
	/** Station whose doors are open, or -1. Read by the crowd renderer so
	 *  boarding can be shown as people walking rather than a falling number. */
	public get activeStation(): number {
		return this.activeStationIdx;
	}

	private activeStationIdx = -1;
	/** Station we were last stopped at, to detect a roll-past without doors. */
	private lastNearIdx = -1;
	private lastNearOpened = false;

	/**
	 * Passengers set down at a change station — one of the ringed stops on the
	 * strip, where another line joins, leaves or crosses (`changePoints`). The
	 * model does not route anyone across lines, so this counts who got off
	 * where a change is on offer, not who changed. Since the line was picked,
	 * like `delivered`.
	 */
	private deliveredAtInterchanges = 0;
	/** Per station of the bound line: is it a change station? */
	private interchangeAt: boolean[] = [];

	public boardedThisStop = 0;
	public alightedThisStop = 0;
	/** Flashes a "+N boarded" style event for the HUD. */
	public lastDoorEventAt = 0;

	public postInit(): void {
		const assetConfig = this.systemManager.getSystem(AssetConfigSystem);
		assetConfig?.onChange(config => {
			this.model.setDemandScale(DEMAND_SCALES[config.demandLevel] ?? 1);
		});
	}

	public update(deltaTime: number): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);
		if (!trainSystem) return;

		const ls = trainSystem.getCurrentLine();
		if (!ls) return;

		// (Re)bind when the map or line changes — passenger state is per line.
		const lineKey = `${trainSystem.mapName}::${ls.parsed.id}::${ls.parsed.stations.length}`;
		if (lineKey !== this.boundLineKey) {
			this.boundLineKey = lineKey;
			this.bindLine(ls, trainSystem.interchangeIndex);
		}

		if (!trainSystem.gameActive) return;

		const dt = Math.min(deltaTime, 0.5);
		this.model.setDirection(trainSystem.physicsState.direction, ls.track.isLoop);
		this.model.accumulate(dt);

		this.updateDoors(trainSystem, dt);
	}

	private bindLine(
		ls: {parsed: {id: string; isLoop: boolean; stations: {id: string; name: string; density?: number}[]}},
		interchanges: InterchangeIndex,
	): void {
		const assetConfig = this.systemManager.getSystem(AssetConfigSystem);
		this.model.setDemandScale(DEMAND_SCALES[assetConfig?.getConfig().demandLevel ?? 'normal'] ?? 1);
		this.model.setStations(ls.parsed.stations.map(s => ({
			id: s.id,
			density: s.density ?? 0.5,
		})));
		// Nobody wants to pull into a ghost station on the first run: seed the
		// platforms with a few minutes of demand so the line feels in service.
		this.model.preload(4);
		this.interchangeAt = changePoints(interchanges, ls.parsed.stations, ls.parsed.id, ls.parsed.isLoop);
		this.deliveredAtInterchanges = 0;
		this.activeStationIdx = -1;
		this.lastNearIdx = -1;
		this.lastNearOpened = false;
		this.lastDoorsOpen = false;
	}

	private updateDoors(trainSystem: TrainSystem, dt: number): void {
		const state = trainSystem.stationState;
		const doorsOpen = trainSystem.physicsState.doorsOpen;
		const nearIdx = state?.arriving ? state.nearestStationIdx : -1;

		// Rolling past a platform we never opened for: those people are left
		// behind, and the run card says so.
		if (nearIdx !== this.lastNearIdx) {
			if (this.lastNearIdx >= 0 && !this.lastNearOpened) {
				this.model.noteSkipped(this.lastNearIdx);
			}
			this.lastNearIdx = nearIdx;
			this.lastNearOpened = false;
		}

		if (doorsOpen && !this.lastDoorsOpen) {
			this.activeStationIdx = nearIdx;
			this.boardedThisStop = 0;
			this.alightedThisStop = 0;
			if (nearIdx >= 0) this.lastNearOpened = true;
		}
		this.lastDoorsOpen = doorsOpen;

		if (!doorsOpen) {
			this.activeStationIdx = -1;
			return;
		}

		if (this.activeStationIdx < 0) {
			// Doors opened between stations (allowed at low speed) — nobody there.
			return;
		}

		const cars = this.getCarCount();
		const result = this.model.tickDoors(this.activeStationIdx, dt, cars);
		if (result.boarded > 0 || result.alighted > 0) {
			this.boardedThisStop += result.boarded;
			this.alightedThisStop += result.alighted;
			if (this.interchangeAt[this.activeStationIdx]) this.deliveredAtInterchanges += result.alighted;
			this.lastDoorEventAt = performance.now();
		}
	}

	private getCarCount(): number {
		const assetConfig = this.systemManager.getSystem(AssetConfigSystem);
		const slots = assetConfig?.getConfig().trainSlots;
		return Math.max(1, slots?.length ?? 3);
	}

	// ---- read surface (HUD, crowds, scoring) ----

	public waitingAt(stationIndex: number): number {
		return this.model.getWaiting(stationIndex);
	}

	public getSnapshot(): {
		aboard: number;
		delivered: number;
		leftBehind: number;
		/** Of `delivered`, those set down at a change station. */
		atInterchanges: number;
		waitingHere: number;
		boardingActive: boolean;
	} {
		return {
			aboard: Math.round(this.model.getAboard()),
			delivered: Math.round(this.model.delivered),
			leftBehind: this.model.leftBehind,
			atInterchanges: this.deliveredAtInterchanges,
			waitingHere: this.activeStationIdx >= 0 ? this.model.getWaiting(this.activeStationIdx) : 0,
			boardingActive: this.activeStationIdx >= 0,
		};
	}

	/** Total waiting across the line — used by the line panel summary. */
	public getTotalWaiting(): number {
		let total = 0;
		for (let i = 0; i < this.model.stationCount; i++) total += this.model.getWaiting(i);
		return total;
	}

	public getModel(): PassengerModel {
		return this.model;
	}
}
