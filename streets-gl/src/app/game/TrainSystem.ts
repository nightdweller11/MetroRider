import System from '../System';
import MathUtils from '~/lib/math/MathUtils';
import Vec2 from '~/lib/math/Vec2';
import SceneSystem from '../systems/SceneSystem';
import ControlsSystem from '../systems/ControlsSystem';
import TerrainSystem from '../systems/TerrainSystem';
import MapWorkerSystem from '../systems/MapWorkerSystem';
import TileSystem from '../systems/TileSystem';
import type {ParsedLine, MetroMapData} from './data/RouteParser';
import {parseMetroMap} from './data/RouteParser';
import type {TrackData, PositionOnTrack} from './data/TrackBuilder';
import {buildTrackData, getPositionAtDistance} from './data/TrackBuilder';
import {bearing} from './data/CoordinateSystem';
import {StationManager, StationState} from './data/StationManager';
import {
	TrainPhysicsState,
	TrainInput,
	createTrainPhysicsState,
	updateTrainPhysics,
	getMaxSpeed,
} from './physics/TrainPhysics';
import {InputHandler} from './physics/InputHandler';
import {TEL_AVIV_METRO} from './data/SampleRoutes';
import {WorkerMessage} from '~/app/world/worker/WorkerMessage';
import AudioSystem from './audio/AudioSystem';

export interface TrainWorldPosition {
	x: number;
	y: number;
	height: number;
	heading: number;
	lat: number;
	lon: number;
}

export interface LineState {
	parsed: ParsedLine;
	track: TrackData;
}

export default class TrainSystem extends System {
	public lines: LineState[] = [];
	public currentLineIdx: number = 0;
	public physicsState: TrainPhysicsState = createTrainPhysicsState();
	public trainPosition: TrainWorldPosition | null = null;
	public stationState: StationState | null = null;
	public gameActive: boolean = false;

	private stationManager: StationManager = new StationManager();
	private input: InputHandler = new InputHandler();
	private pendingCameraMove: {lat: number; lng: number} | null = null;
	private onStationArrival: ((stationName: string, index: number, total: number) => void) | null = null;
	private onDirectionChangeCallback: (() => void) | null = null;

	public postInit(): void {
		this.loadDefaultMap();
	}

	private loadDefaultMap(): void {
		try {
			this.loadMap(TEL_AVIV_METRO);
		} catch (err) {
			console.error('[TrainSystem] Failed to load default map:', err);
		}
	}

	public loadMap(data: MetroMapData): void {
		const parsed = parseMetroMap(data);

		this.lines = parsed.map(line => ({
			parsed: line,
			track: buildTrackData(line.allPoints),
		}));

		if (this.lines.length > 0) {
			this.selectLine(0);
		}

		console.log(`[TrainSystem] Loaded map with ${this.lines.length} lines`);
	}

	public selectLine(idx: number): void {
		if (idx < 0 || idx >= this.lines.length) {
			console.error(`[TrainSystem] Invalid line index: ${idx}`);
			return;
		}

		this.currentLineIdx = idx;
		const ls = this.lines[idx];

		this.physicsState = createTrainPhysicsState(
			ls.track.stationDists[0] + 60
		);
		this.stationManager.reset();

		this.updateCorridorSegments();

		const firstStation = ls.parsed.allPoints[0];
		try {
			this.moveCameraToLatLon(firstStation.lat, firstStation.lng);
		} catch (err) {
			console.warn('[TrainSystem] Camera not ready during init, will position on first update:', err);
			this.pendingCameraMove = {lat: firstStation.lat, lng: firstStation.lng};
		}

		console.log(`[TrainSystem] Selected line "${ls.parsed.name}" (${ls.track.totalLength.toFixed(0)}m)`);
	}

	private sendCorridorToWorkers(segments: WorkerMessage.CorridorSegment[]): void {
		const mapWorkerSystem = this.systemManager.getSystem(MapWorkerSystem);
		if (!mapWorkerSystem) return;

		mapWorkerSystem.setCorridorSegments(segments);
		if (segments.length > 0) {
			const s = segments[0];
			console.log(`[TrainSystem] Sent ${segments.length} corridor segments to workers. First: (${s.x1.toFixed(1)},${s.z1.toFixed(1)})->(${s.x2.toFixed(1)},${s.z2.toFixed(1)}) r=${s.radius}`);
		} else {
			console.warn('[TrainSystem] Sent 0 corridor segments (no lines loaded?)');
		}
	}

	private updateCorridorSegments(): void {
		const segments: WorkerMessage.CorridorSegment[] = [];
		const CORRIDOR_RADIUS = 10;

		for (const ls of this.lines) {
			const points = ls.track.spline.points;
			for (let i = 0; i < points.length - 1; i++) {
				const [lng1, lat1] = points[i];
				const [lng2, lat2] = points[i + 1];
				const m1 = MathUtils.degrees2meters(lat1, lng1);
				const m2 = MathUtils.degrees2meters(lat2, lng2);
				segments.push({
					x1: m1.x, z1: m1.y,
					x2: m2.x, z2: m2.y,
					radius: CORRIDOR_RADIUS,
				});
			}
		}

		this.sendCorridorToWorkers(segments);

		const tileSystem = this.systemManager.getSystem(TileSystem);
		if (tileSystem) {
			tileSystem.purgeTiles();
			console.log('[TrainSystem] Purged tiles to apply corridor clearing');
		}

		setTimeout((): void => {
			this.sendCorridorToWorkers(segments);
			console.log('[TrainSystem] Re-sent corridor segments (delayed safety)');
		}, 500);
	}

	public startGame(): void {
		this.gameActive = true;
		this.input.enable();

		this.updateCorridorSegments();

		if (this.pendingCameraMove) {
			try {
				this.moveCameraToLatLon(this.pendingCameraMove.lat, this.pendingCameraMove.lng);
			} catch (err) {
				console.warn('[TrainSystem] Camera still not ready at startGame:', err);
			}
			this.pendingCameraMove = null;
		}

		console.log('[TrainSystem] Game started');
	}

	public stopGame(): void {
		this.gameActive = false;
		this.input.disable();
		console.log('[TrainSystem] Game stopped');
	}

	public goToStation(lineIdx: number, stationIdx: number, dir: number): void {
		if (lineIdx !== this.currentLineIdx) {
			this.selectLine(lineIdx);
		}

		const ls = this.lines[this.currentLineIdx];
		if (!ls) return;

		const stations = ls.parsed.stations;
		if (stationIdx < 0 || stationIdx >= stations.length) return;

		this.physicsState.trainDist = ls.track.stationDists[stationIdx] + 10;
		this.physicsState.trainSpeed = 0;
		this.physicsState.direction = dir;
		this.physicsState.doorsOpen = false;
		this.stationManager.reset();

		const station = stations[stationIdx];
		this.moveCameraToLatLon(station.lat, station.lng);
	}

	public reverseDirection(): void {
		this.physicsState.direction *= -1;
		this.onDirectionChangeCallback?.();
	}

	public setDirection(dir: number): void {
		this.physicsState.direction = dir;
		this.onDirectionChangeCallback?.();
	}

	public toggleDoors(): void {
		if (this.physicsState.trainSpeed < 0.5) {
			this.physicsState.doorsOpen = !this.physicsState.doorsOpen;
		}
	}

	public getInput(): InputHandler {
		return this.input;
	}

	public setHUDThrottle(value: boolean): void {
		this.input.setHeld('throttle', value);
	}

	public setHUDBrake(value: boolean): void {
		this.input.setHeld('brake', value);
	}

	public setStationArrivalCallback(
		cb: (stationName: string, index: number, total: number) => void
	): void {
		this.onStationArrival = cb;
	}

	public setDirectionChangeCallback(cb: () => void): void {
		this.onDirectionChangeCallback = cb;
	}

	public getCurrentLine(): LineState | null {
		return this.lines[this.currentLineIdx] ?? null;
	}

	public getTerminalName(): string {
		const ls = this.getCurrentLine();
		if (!ls) return '';

		const stations = ls.parsed.stations;
		return this.physicsState.direction === 1
			? stations[stations.length - 1].name
			: stations[0].name;
	}

	public getSpeedKmH(): number {
		return this.physicsState.trainSpeed * 3.6;
	}

	public getMaxSpeedKmH(): number {
		return getMaxSpeed() * 3.6;
	}

	private moveCameraToLatLon(lat: number, lon: number): void {
		const controls = this.systemManager.getSystem(ControlsSystem);
		if (controls) {
			controls.setState(lat, lon, 45, 0, 500);
		}
	}

	public update(deltaTime: number): void {
		if (!this.gameActive) return;

		if (this.pendingCameraMove) {
			try {
				this.moveCameraToLatLon(this.pendingCameraMove.lat, this.pendingCameraMove.lng);
				this.pendingCameraMove = null;
			} catch (_) {
				// still not ready
			}
		}

		const ls = this.getCurrentLine();
		if (!ls) return;

		const trainInput: TrainInput = {
			throttle: this.input.isHeld('throttle'),
			braking: this.input.isHeld('brake'),
			emergency: this.input.isHeld('emergency'),
		};

		if (this.input.wasPressed('doors')) {
			this.toggleDoors();
		}
		if (this.input.wasPressed('reverse')) {
			this.reverseDirection();
		}

		updateTrainPhysics(this.physicsState, trainInput, ls.track, deltaTime);

		this.updateTrainPosition(ls);
		this.updateStationState(ls);

		this.input.consumePressed();
	}

	private updateTrainPosition(ls: LineState): void {
		const pos: PositionOnTrack = getPositionAtDistance(
			ls.track.spline.points,
			ls.track.cumDist,
			this.physicsState.trainDist,
		);

		const nextPos = getPositionAtDistance(
			ls.track.spline.points,
			ls.track.cumDist,
			this.physicsState.trainDist + 5 * this.physicsState.direction,
		);

		const trainBearing = bearing(pos.lat, pos.lng, nextPos.lat, nextPos.lng);

		const meterPos: Vec2 = MathUtils.degrees2meters(pos.lat, pos.lng);

		const terrainSystem = this.systemManager.getSystem(TerrainSystem);
		let height = 0;
		if (terrainSystem && terrainSystem.terrainHeightProvider) {
			const terrainHeight = terrainSystem.terrainHeightProvider.getHeightGlobalInterpolated(
				meterPos.x, meterPos.y, true
			);
			if (terrainHeight !== null) {
				height = terrainHeight;
			}
		}

		this.trainPosition = {
			x: meterPos.x,
			y: meterPos.y,
			height: height + 0.4,
			heading: Math.PI / 2 - MathUtils.toRad(trainBearing),
			lat: pos.lat,
			lon: pos.lng,
		};
	}

	private lastStationChimeIdx: number = -1;

	private updateStationState(ls: LineState): void {
		this.stationState = this.stationManager.update(
			ls.track,
			ls.parsed.stations,
			this.physicsState.trainDist,
			this.physicsState.trainSpeed,
			this.physicsState.direction,
		);

		if (this.stationState.arriving) {
			if (this.lastStationChimeIdx !== this.stationState.nearestStationIdx) {
				this.lastStationChimeIdx = this.stationState.nearestStationIdx;
				const audioSystem = this.systemManager.getSystem(AudioSystem);
				if (audioSystem) {
					audioSystem.playStationChime();
				}
			}

			if (this.onStationArrival) {
				this.onStationArrival(
					this.stationState.stationName,
					this.stationState.nearestStationIdx,
					ls.parsed.stations.length,
				);
			}
		} else {
			this.lastStationChimeIdx = -1;
		}
	}
}
