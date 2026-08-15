import System from '../System';
import MathUtils from '~/lib/math/MathUtils';
import Vec2 from '~/lib/math/Vec2';
import SceneSystem from '../systems/SceneSystem';
import ControlsSystem from '../systems/ControlsSystem';
import TerrainSystem from '../systems/TerrainSystem';
import MapWorkerSystem from '../systems/MapWorkerSystem';
import TileSystem from '../systems/TileSystem';
import SettingsSystem from '../systems/SettingsSystem';
import SpeedLimitSystem from './limits/SpeedLimitSystem';
import type {ParsedLine, MetroMapData} from './data/RouteParser';
import {parseMetroMap} from './data/RouteParser';
import type {TrackData, PositionOnTrack} from './data/TrackBuilder';
import {buildTrackData, getPositionAtDistance, wrapTrackDistance} from './data/TrackBuilder';
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
import {inferLineMode, lineModeInfo} from './data/LineModes';
import {TEL_AVIV_METRO} from './data/SampleRoutes';
import {WorkerMessage} from '~/app/world/worker/WorkerMessage';
import AudioSystem from './audio/AudioSystem';
import AnnouncementSystem from './audio/AnnouncementSystem';
import GameCameraSystem from './GameCameraSystem';
import {debugLog} from './debug';

/**
 * Distance over which the gradient is measured, metres.
 *
 * Short enough to feel the bank the train is actually on, long enough that the
 * interpolated terrain grid's noise averages out instead of being read as a
 * series of tiny cliffs.
 */
const GRADE_BASELINE_M = 60;

/** How far ahead of a station the approach is announced, metres. */
const APPROACH_ANNOUNCE_DIST = 600;

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
	realStationDists: number[];
}

export default class TrainSystem extends System {
	public lines: LineState[] = [];
	public currentLineIdx: number = 0;
	public mapName: string = '';
	public physicsState: TrainPhysicsState = createTrainPhysicsState();
	public trainPosition: TrainWorldPosition | null = null;
	public stationState: StationState | null = null;
	public gameActive: boolean = false;
	/** Where the cab's master controller handle is set. Persists until moved. */
	private controllerPower: number = 0;
	private controllerBrake: number = 0;
	/**
	 * Bumped every time a different map is loaded.
	 *
	 * Systems that cache per-line state (passing traffic, the timetable) key on
	 * the line INDEX, which is 0 on the old map and 0 on the new one — so
	 * without this, driving into another city would leave them running the
	 * previous city's schedule and services.
	 */
	public mapGeneration: number = 0;

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
		this.mapName = data.name || '';

		this.lines = parsed.map(line => {
			const track = buildTrackData(line.allPoints, line.isLoop);
			// stationPointIndices keeps stations[] and realStationDists aligned,
			// including on loops where the closing point revisits station 0.
			const realStationDists = line.stationPointIndices.map(i => track.stationDists[i]);
			return {parsed: line, track, realStationDists};
		});

		this.mapGeneration++;

		if (this.lines.length > 0) {
			this.selectLine(0);
		}

		debugLog(`[TrainSystem] Loaded map with ${this.lines.length} lines`);
	}

	public selectLine(idx: number): void {
		if (idx < 0 || idx >= this.lines.length) {
			console.error(`[TrainSystem] Invalid line index: ${idx}`);
			return;
		}

		this.currentLineIdx = idx;
		const ls = this.lines[idx];

		this.physicsState = createTrainPhysicsState(
			ls.realStationDists[0] + 60
		);
		this.stationManager.reset();

		this.updateCorridorSegments();

		const firstStation = ls.parsed.allPoints[0];
		if (!this.moveCameraToLatLon(firstStation.lat, firstStation.lng)) {
			this.pendingCameraMove = {lat: firstStation.lat, lng: firstStation.lng};
		}

		debugLog(`[TrainSystem] Selected line "${ls.parsed.name}" (${ls.track.totalLength.toFixed(0)}m)`);
	}

	private sendCorridorToWorkers(segments: WorkerMessage.CorridorSegment[]): void {
		const mapWorkerSystem = this.systemManager.getSystem(MapWorkerSystem);
		if (!mapWorkerSystem) return;

		mapWorkerSystem.setCorridorSegments(segments);
		if (segments.length > 0) {
			const s = segments[0];
			debugLog(`[TrainSystem] Sent ${segments.length} corridor segments to workers. First: (${s.x1.toFixed(1)},${s.z1.toFixed(1)})->(${s.x2.toFixed(1)},${s.z2.toFixed(1)}) r=${s.radius}`);
		} else {
			console.warn('[TrainSystem] Sent 0 corridor segments (no lines loaded?)');
		}
	}

	private static readonly COLLINEAR_THRESHOLD = Math.cos(5 * Math.PI / 180);

	private static downsampleSegments(raw: WorkerMessage.CorridorSegment[]): WorkerMessage.CorridorSegment[] {
		if (raw.length <= 1) return raw;

		const result: WorkerMessage.CorridorSegment[] = [raw[0]];
		let cur = raw[0];

		for (let i = 1; i < raw.length; i++) {
			const next = raw[i];
			const cdx = cur.x2 - cur.x1, cdz = cur.z2 - cur.z1;
			const ndx = next.x2 - next.x1, ndz = next.z2 - next.z1;
			const cLen = Math.sqrt(cdx * cdx + cdz * cdz);
			const nLen = Math.sqrt(ndx * ndx + ndz * ndz);

			if (cLen > 1e-6 && nLen > 1e-6) {
				const dot = (cdx * ndx + cdz * ndz) / (cLen * nLen);
				const gap = Math.sqrt((next.x1 - cur.x2) ** 2 + (next.z1 - cur.z2) ** 2);
				if (dot >= TrainSystem.COLLINEAR_THRESHOLD && gap < 1) {
					cur = {x1: cur.x1, z1: cur.z1, x2: next.x2, z2: next.z2, radius: cur.radius};
					result[result.length - 1] = cur;
					continue;
				}
			}

			result.push(next);
			cur = next;
		}

		return result;
	}

	private updateCorridorSegments(): void {
		const rawSegments: WorkerMessage.CorridorSegment[] = [];
		const CORRIDOR_RADIUS = 10;

		for (const ls of this.lines) {
			// A ferry does not run on rails. The corridor is what makes the tile
			// pipeline lay synthetic railway along a route, so a water route
			// simply does not contribute to it — otherwise the boat sails up a
			// track. `onTrack` has been declared on every line mode since 2.12.0
			// and read by nothing until now.
			const mode = ls.parsed.mode ?? inferLineMode(
				ls.parsed.name, ls.track.totalLength, ls.parsed.stations.length,
			);

			if (!lineModeInfo(mode).onTrack) continue;

			const points = ls.track.spline.points;
			for (let i = 0; i < points.length - 1; i++) {
				const [lng1, lat1] = points[i];
				const [lng2, lat2] = points[i + 1];
				const m1 = MathUtils.degrees2meters(lat1, lng1);
				const m2 = MathUtils.degrees2meters(lat2, lng2);
				rawSegments.push({
					x1: m1.x, z1: m1.y,
					x2: m2.x, z2: m2.y,
					radius: CORRIDOR_RADIUS,
				});
			}
		}

		const segments = TrainSystem.downsampleSegments(rawSegments);
		debugLog(`[TrainSystem] Corridor segments: ${rawSegments.length} raw -> ${segments.length} downsampled`);

		this.sendCorridorToWorkers(segments);

		const tileSystem = this.systemManager.getSystem(TileSystem);
		if (tileSystem) {
			tileSystem.purgeTiles();
			debugLog('[TrainSystem] Purged tiles to apply corridor clearing');
		}

		setTimeout((): void => {
			this.sendCorridorToWorkers(segments);
			debugLog('[TrainSystem] Re-sent corridor segments (delayed safety)');
		}, 500);
	}

	public startGame(): void {
		this.gameActive = true;
		this.input.enable();

		if (this.pendingCameraMove) {
			this.moveCameraToLatLon(this.pendingCameraMove.lat, this.pendingCameraMove.lng);
			this.pendingCameraMove = null;
		}

		// The follow camera is the default view: activate it on EVERY start path
		// (UI buttons, station picker, programmatic starts). Without this, the
		// map controls keep the camera and the mode button appears to do nothing.
		const camSystem = this.systemManager.getSystem(GameCameraSystem);
		if (camSystem) {
			camSystem.activate();
			camSystem.snapToTrain();
		}

		debugLog('[TrainSystem] Game started');
	}

	public stopGame(): void {
		this.gameActive = false;
		this.input.disable();
		debugLog('[TrainSystem] Game stopped');
	}

	public goToStation(lineIdx: number, stationIdx: number, dir: number): void {
		if (lineIdx !== this.currentLineIdx) {
			this.selectLine(lineIdx);
		}

		const ls = this.lines[this.currentLineIdx];
		if (!ls) return;

		const stations = ls.parsed.stations;
		if (stationIdx < 0 || stationIdx >= stations.length) return;

		this.physicsState.trainDist = ls.realStationDists[stationIdx] + 10;
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
			const audioSystem = this.systemManager.getSystem(AudioSystem);
			if (audioSystem) {
				if (this.physicsState.doorsOpen) {
					audioSystem.playDoorOpen();
				} else {
					audioSystem.playDoorClose();
				}
			}

			this.systemManager.getSystem(AnnouncementSystem)
				?.announceDoors(this.physicsState.doorsOpen);
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

	/**
	 * Where the master controller handle is set, 0–1 each and never both.
	 *
	 * This persists: a notched controller stays where it was put, which is the
	 * whole point of it. Nothing here springs back on its own.
	 */
	public setController(power: number, brake: number): void {
		this.controllerPower = Math.max(0, Math.min(1, power));
		this.controllerBrake = Math.max(0, Math.min(1, brake));
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
		if (ls.parsed.isLoop) {
			return this.physicsState.direction === 1 ? 'Loop ⟳' : 'Loop ⟲';
		}
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

	private moveCameraToLatLon(lat: number, lon: number): boolean {
		const controls = this.systemManager.getSystem(ControlsSystem);
		if (controls?.isReady()) {
			controls.setState(lat, lon, 45, 0, 500);
			return true;
		}
		return false;
	}

	public update(deltaTime: number): void {
		if (!this.gameActive) return;

		if (this.pendingCameraMove) {
			if (this.moveCameraToLatLon(this.pendingCameraMove.lat, this.pendingCameraMove.lng)) {
				this.pendingCameraMove = null;
			}
		}

		const ls = this.getCurrentLine();
		if (!ls) return;

		const trainInput: TrainInput = {
			// Simple driving eases back toward the line limit; Advanced leaves
			// the limit purely informational, as designed.
			assist: this.systemManager.getSystem(SettingsSystem)
				?.settings.get('driveMode')?.statusValue === 'simple',
			// `.limit` is metres per second; the physics wants km/h. Passing the
			// raw field held Simple driving to ~12 km/h against a 40 limit.
			assistLimitKmh: this.systemManager.getSystem(SpeedLimitSystem)?.limitKmh() ?? 0,
			// How this kind of service pulls away and stops. A tram is light and
			// brisk; a high-speed train is heavy and takes its time both ways.
			// Without this every mode reached its own top speed at exactly the
			// same rate, and the only difference between driving a tram and a
			// bullet train was the number the dial stopped at.
			accelScale: lineModeInfo(this.systemManager.getSystem(SpeedLimitSystem)?.lineMode).accelScale,
			brakeScale: lineModeInfo(this.systemManager.getSystem(SpeedLimitSystem)?.lineMode).brakeScale,
			// Gravity acts whether or not the driver is doing anything.
			grade: this.currentGrade(ls),
			throttle: this.input.isHeld('throttle'),
			braking: this.input.isHeld('brake'),
			emergency: this.input.isHeld('emergency'),
			powerLevel: this.controllerPower,
			brakeLevel: this.controllerBrake,
			// What this train can do, from its kind — separate from the posted
			// limit, which is a rule it is free to break and pay for.
			vehicleMaxMs: this.systemManager.getSystem(SpeedLimitSystem)?.lineCeiling || undefined,
		};

		if (this.input.wasPressed('doors')) {
			this.toggleDoors();
		}
		if (this.input.wasPressed('reverse')) {
			this.reverseDirection();
		}

		// The H key was mapped to 'horn' and nothing had ever consumed it, so
		// the keyboard horn simply did not exist. Held, not tapped: the same
		// press-and-release the cab button gives.
		const hornHeld = this.input.isHeld('horn');

		if (hornHeld !== this.hornWasHeld) {
			const audio = this.systemManager.getSystem(AudioSystem);

			if (hornHeld) audio?.hornDown();
			else audio?.hornUp();

			this.hornWasHeld = hornHeld;
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
			wrapTrackDistance(this.physicsState.trainDist, ls.track),
		);

		const nextPos = getPositionAtDistance(
			ls.track.spline.points,
			ls.track.cumDist,
			wrapTrackDistance(this.physicsState.trainDist + 5 * this.physicsState.direction, ls.track),
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

	/**
	 * The slope under the train, rise over run, positive uphill.
	 *
	 * Sampled over a BASELINE rather than between adjacent points, for the same
	 * reason the curvature profile is: the terrain grid is interpolated and
	 * carries noise, and two samples a metre apart mostly measure that noise.
	 * Over 60 m a real bank shows and the noise averages out.
	 *
	 * Returns 0 whenever the terrain is not loaded yet, which is the honest
	 * answer — an unknown hill should not push the train around.
	 */
	private currentGrade(ls: LineState): number {
		const terrain = this.systemManager.getSystem(TerrainSystem)?.terrainHeightProvider;

		if (!terrain) return 0;

		const dir = this.physicsState.direction || 1;
		const here = this.physicsState.trainDist;
		const there = wrapTrackDistance(here + GRADE_BASELINE_M * dir, ls.track);
		const sample = (dist: number): number | null => {
			const p = getPositionAtDistance(ls.track.spline.points, ls.track.cumDist, dist);
			const m = MathUtils.degrees2meters(p.lat, p.lng);

			return terrain.getHeightGlobalInterpolated(m.x, m.y, true);
		};

		const h0 = sample(here);
		const h1 = sample(there);

		if (h0 === null || h1 === null) return 0;

		// The run is the baseline, not the straight-line distance between the
		// samples: on a curve those differ, and it is the distance ALONG THE
		// RAIL that gravity is resolved over.
		return (h1 - h0) / GRADE_BASELINE_M;
	}

	public getCarPosition(offsetFromFront: number): TrainWorldPosition | null {
		const ls = this.getCurrentLine();
		if (!ls) return null;

		const carDist = wrapTrackDistance(
			this.physicsState.trainDist - offsetFromFront * this.physicsState.direction,
			ls.track,
		);
		const pos: PositionOnTrack = getPositionAtDistance(
			ls.track.spline.points, ls.track.cumDist, carDist,
		);
		const nextPos = getPositionAtDistance(
			ls.track.spline.points, ls.track.cumDist,
			wrapTrackDistance(carDist + 5 * this.physicsState.direction, ls.track),
		);

		const carBearing = bearing(pos.lat, pos.lng, nextPos.lat, nextPos.lng);
		const meterPos: Vec2 = MathUtils.degrees2meters(pos.lat, pos.lng);

		const terrainSystem = this.systemManager.getSystem(TerrainSystem);
		let height = 0;
		if (terrainSystem && terrainSystem.terrainHeightProvider) {
			const terrainHeight = terrainSystem.terrainHeightProvider.getHeightGlobalInterpolated(
				meterPos.x, meterPos.y, true,
			);
			if (terrainHeight !== null) {
				height = terrainHeight;
			}
		}

		return {
			x: meterPos.x,
			y: meterPos.y,
			height: height + 0.4,
			heading: Math.PI / 2 - MathUtils.toRad(carBearing),
			lat: pos.lat,
			lon: pos.lng,
		};
	}

	/**
	 * Where something sits on any line, not just the one being driven.
	 *
	 * The same maths as `getCarPosition`, opened up so other traffic can run on
	 * the network: pick the line, the distance along it, the direction it
	 * faces, and how far to one side. The lateral offset is what puts an
	 * oncoming train on the track BESIDE you rather than head-on down the
	 * middle of your own rails.
	 */
	public getPositionOnLine(
		lineIdx: number,
		dist: number,
		direction: number,
		lateralOffset: number = 0,
	): TrainWorldPosition | null {
		const ls = this.lines[lineIdx];

		if (!ls) return null;

		const at = wrapTrackDistance(dist, ls.track);
		const pos: PositionOnTrack = getPositionAtDistance(ls.track.spline.points, ls.track.cumDist, at);
		const nextPos = getPositionAtDistance(
			ls.track.spline.points, ls.track.cumDist, wrapTrackDistance(at + 5 * direction, ls.track),
		);

		const carBearing = bearing(pos.lat, pos.lng, nextPos.lat, nextPos.lng);
		const meterPos: Vec2 = MathUtils.degrees2meters(pos.lat, pos.lng);
		const heading = Math.PI / 2 - MathUtils.toRad(carBearing);

		// Perpendicular to travel, in world metres.
		const side = heading + Math.PI / 2;
		const x = meterPos.x + Math.sin(side) * lateralOffset;
		const y = meterPos.y + Math.cos(side) * lateralOffset;

		const terrainSystem = this.systemManager.getSystem(TerrainSystem);
		let height = 0;

		if (terrainSystem && terrainSystem.terrainHeightProvider) {
			const terrainHeight = terrainSystem.terrainHeightProvider.getHeightGlobalInterpolated(x, y, true);

			if (terrainHeight !== null) {
				height = terrainHeight;
			}
		}

		return {x, y, height: height + 0.4, heading, lat: pos.lat, lon: pos.lng};
	}

	private lastStationChimeIdx: number = -1;
	/** The station whose approach has already been announced. */
	private lastApproachIdx: number = -1;
	/** Edge-detects the horn key, so held means held rather than re-triggering. */
	private hornWasHeld: boolean = false;

	private updateStationState(ls: LineState): void {
		this.stationState = this.stationManager.update(
			ls.realStationDists,
			ls.parsed.stations,
			this.physicsState.trainDist,
			this.physicsState.trainSpeed,
			this.physicsState.direction,
			ls.track.isLoop,
			ls.track.totalLength,
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
			// The moment the arriving flag drops is departure — the one point
			// where naming the stop ahead is useful rather than noise.
			if (this.lastStationChimeIdx !== -1) {
				const nextIdx = this.stationState.nextStationIdx;
				const next = ls.parsed.stations[nextIdx];

				if (next) {
					this.systemManager.getSystem(AnnouncementSystem)
						?.announceNext(this.stationState.stationName || next.name);
				}
			}

			this.lastStationChimeIdx = -1;
			this.updateApproachAnnouncement(ls);
		}
	}

	/**
	 * "Now approaching X", while the station is still ahead of you.
	 *
	 * This cannot hang off `stationState.arriving`: that flag is
	 * `distance < STATION_STOP_DIST && speed < 2 m/s`, which is the train
	 * standing AT the platform. Announcing there is announcing a station the
	 * passenger is already looking at, and it never fires at all for a train
	 * running through.
	 */
	private updateApproachAnnouncement(ls: LineState): void {
		const ss = this.stationState;

		if (!ss) return;

		const distance = ss.nextStationDist;

		// Re-arm once well clear, so the next station gets its own call.
		if (distance > APPROACH_ANNOUNCE_DIST * 1.6) {
			this.lastApproachIdx = -1;
			return;
		}

		if (
			distance > APPROACH_ANNOUNCE_DIST ||
			this.physicsState.trainSpeed < 2 ||
			this.lastApproachIdx === ss.nextStationIdx
		) {
			return;
		}

		const idx = ss.nextStationIdx;
		const station = ls.parsed.stations[idx];

		if (!station) return;

		this.lastApproachIdx = idx;

		const last = ls.parsed.stations.length - 1;

		this.systemManager.getSystem(AnnouncementSystem)?.announceApproach(
			station.name,
			!ls.track.isLoop && (idx === 0 || idx === last),
		);
	}
}
