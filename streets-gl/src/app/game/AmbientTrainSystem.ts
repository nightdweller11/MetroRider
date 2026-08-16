import System from '../System';
import SettingsSystem from '../systems/SettingsSystem';
import TrainSystem from './TrainSystem';
import TrainRenderingSystem from './rendering/TrainRenderingSystem';
import {ambientModelFor} from './data/AmbientFleet';
import {inferLineMode} from './data/LineModes';
import type TrainMeshObject from './rendering/TrainMeshObject';
import SpeedLimitSystem from './limits/SpeedLimitSystem';
import {
	createLeadingTrain, stepLeadingTrain, gapAhead,
	type LeadingTrainState,
} from './ai/LeadingTrainDriver';

/**
 * Other trains on the network.
 *
 * A railway with exactly one train on it reads as a model, not a railway. The
 * point of this system is the moment a service comes the other way and goes
 * past the window — so the traffic runs TOWARDS the player and is recycled
 * ahead of them once it is behind, rather than being simulated across a whole
 * timetable nobody can see.
 *
 * Two decisions worth stating:
 *
 * - **It runs on the track beside you, not on yours.** The game draws one
 *   spline per line, so a train coming the other way along that spline would
 *   pass THROUGH you. Every ambient service is offset sideways onto the
 *   adjacent alignment, which is also where the real parallel tracks are drawn
 *   in the world.
 * - **It is deliberately cheap.** Procedural bodies, no models, no textures,
 *   no skinning, no shadow work beyond what the pass already does, and a small
 *   fixed fleet. The frame is fill-rate bound; passing traffic must not be the
 *   thing that costs a tier of quality.
 */

/** Services running at once. Small on purpose — see the note on cost above. */
const FLEET_SIZE = 2;
const CARS_PER_TRAIN = 3;
const CAR_GAP = 0.6;
/** Onto the adjacent alignment, metres. */
const TRACK_OFFSET = 4.6;
/** Roughly 80 km/h — fast enough to feel like a passing service. */
const CRUISE_SPEED = 22;
/** Recycle once this far behind, and reappear this far ahead. */
const BEHIND_LIMIT = 900;
const SPAWN_AHEAD = 2200;
const SPAWN_STAGGER = 1400;

interface AmbientService {
	dist: number;
	cars: TrainMeshObject[];
}

/**
 * How far ahead the service in front starts, metres.
 *
 * Close enough to catch within a stop or two — the point of it is to be caught
 * up with — and far enough that it is not sitting on top of you at the moment
 * you press Play.
 */
const LEADING_START_AHEAD = 1400;
/** Cars in the service ahead. */
const LEADING_CARS = 3;

export default class AmbientTrainSystem extends System {
	private services: AmbientService[] = [];
	/**
	 * The service in FRONT of you, on your own track, going your way.
	 *
	 * Kept here rather than in a system of its own because the ambient meshes
	 * are cleared all together — two owners of that list would wipe each
	 * other's trains out on every line change.
	 */
	private leading: {state: LeadingTrainState; cars: TrainMeshObject[]} | null = null;
	private builtForLine: number = -1;
	private builtForMap: number = -1;
	private carLength: number = 20;

	public postInit(): void {
		// Nothing to build yet: the line and its track are not loaded, and the
		// fleet is spawned relative to the player's position on it.
	}

	private enabled(): boolean {
		return this.systemManager.getSystem(SettingsSystem)
			?.settings.get('ambientTrains')?.statusValue !== 'off';
	}

	private clear(): void {
		this.systemManager.getSystem(TrainRenderingSystem)?.clearAmbientCars();
		this.services = [];
		this.leading = null;
		this.builtForLine = -1;
	}

	/**
	 * Where the service ahead is along the line, or null when there is none.
	 *
	 * The signals and the SPAD check both ask this: it is the only train that
	 * can actually be in the player's way.
	 */
	public leadingDistance(): number | null {
		return this.leading?.state.dist ?? null;
	}

	/** How far ahead it is, metres — negative once you are past it. */
	public leadingGap(playerDist: number, direction: number): number | null {
		if (!this.leading) return null;

		return gapAhead(playerDist, this.leading.state.dist, direction);
	}

	/**
	 * Fetch exactly the stock THIS fleet will wear, and rebuild once it is here.
	 *
	 * The picks are stable per line, so a line needs three models — not its
	 * whole pool. Loading the pool fetched eleven files on a cold start,
	 * because the default map builds a fleet before the real map replaces it.
	 *
	 * The fleet is built synchronously from whatever is cached, so the first
	 * fleet after a line change wears the procedural body for a moment; when
	 * the models land the build stamp is cleared and the next update puts the
	 * real trains out. Rebuilding ONLY when something actually loaded matters:
	 * invalidating unconditionally makes every build schedule another one.
	 */
	private loadFleetModels(rendering: TrainRenderingSystem, ids: string[]): void {
		const missing = ids.filter(id => id && !rendering.hasModel(id));

		if (missing.length === 0) return;

		void rendering.ensureModels(missing).then(loaded => {
			if (loaded) this.builtForLine = -1;
		});
	}

	private build(trainSystem: TrainSystem, playerDist: number): void {
		const rendering = this.systemManager.getSystem(TrainRenderingSystem);

		if (!rendering) return;

		this.clear();
		this.carLength = rendering.ambientCarLength() || 20;

		const line = trainSystem.lines[trainSystem.currentLineIdx];
		const colour = line?.parsed.color ?? '#9aa7b4';
		// Stock that suits this railway, and a stable pick per service so the
		// fleet does not reshuffle every time it is respawned.
		// Inferred the same way the rest of the game infers it — from the name,
		// the length and the stop count — when the map does not say.
		const mode = line?.parsed.mode ?? inferLineMode(
			line?.parsed.name ?? '',
			line?.track.totalLength ?? 0,
			line?.parsed.stations.length ?? 0,
		);
		const lineKey = `${trainSystem.mapName}::${line?.parsed.id ?? ''}`;

		// One per service, plus the one you chase.
		const fleetModels = Array.from({length: FLEET_SIZE + 1}, (_, i) => ambientModelFor(mode, lineKey, i));

		this.loadFleetModels(rendering, fleetModels);

		for (let i = 0; i < FLEET_SIZE; i++) {
			this.services.push({
				dist: playerDist + SPAWN_AHEAD + i * SPAWN_STAGGER,
				cars: rendering.buildAmbientCars(CARS_PER_TRAIN, colour, fleetModels[i]),
			});
		}

		// The one that matters: ahead, on the player's own alignment, working
		// the same stops in the same direction.
		const ls = trainSystem.lines[trainSystem.currentLineIdx];

		if (ls) {
			const dir = trainSystem.physicsState.direction || 1;
			const start = playerDist + LEADING_START_AHEAD * dir;
			const stops = ls.realStationDists ?? [];
			// The stop it is working towards: the first one beyond where it is.
			let target = 0;

			for (let i = 0; i < stops.length; i++) {
				if ((stops[i] - start) * dir > 0) { target = i; break; }
			}

			this.leading = {
				state: createLeadingTrain(start, target),
				// Index past the fleet so the train you chase is not a twin of
				// one you have already passed.
				cars: rendering.buildAmbientCars(LEADING_CARS, colour, fleetModels[FLEET_SIZE]),
			};
		}

		this.builtForLine = trainSystem.currentLineIdx;
		this.builtForMap = trainSystem.mapGeneration;
	}

	public update(deltaTime: number): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);

		if (!trainSystem?.gameActive || !trainSystem.trainPosition) return;

		if (!this.enabled()) {
			if (this.services.length > 0) this.clear();

			return;
		}

		const playerDist = trainSystem.physicsState.trainDist;
		const playerDir = trainSystem.physicsState.direction || 1;

		if (
			this.builtForLine !== trainSystem.currentLineIdx ||
			this.builtForMap !== trainSystem.mapGeneration ||
			this.services.length === 0
		) {
			this.build(trainSystem, playerDist);
			return;
		}

		const dt = Math.min(deltaTime, 0.1);

		for (const service of this.services) {
			// Against the player, so it arrives rather than being chased.
			service.dist -= CRUISE_SPEED * dt * playerDir;

			// How far ahead of the player it still is, along the direction of travel.
			const ahead = (service.dist - playerDist) * playerDir;

			if (ahead < -BEHIND_LIMIT) {
				service.dist = playerDist + (SPAWN_AHEAD + Math.random() * SPAWN_STAGGER) * playerDir;
			}

			this.poseService(trainSystem, service, playerDir);
		}

		this.updateLeading(trainSystem, playerDist, playerDir, dt);
	}

	/** Drive the service in front and put its cars where it is. */
	private updateLeading(
		trainSystem: TrainSystem,
		playerDist: number,
		playerDir: number,
		dt: number,
	): void {
		if (!this.leading) return;

		const ls = trainSystem.lines[trainSystem.currentLineIdx];

		if (!ls) return;

		const limits = this.systemManager.getSystem(SpeedLimitSystem);
		// It keeps to the line's own limit, which is the same rule the player
		// is being scored against — so catching it up means driving well, not
		// waiting for it to make a mistake.
		const limit = Math.max(8, limits?.limit || limits?.lineCeiling || 25);

		stepLeadingTrain(
			this.leading.state, ls.realStationDists ?? [], limit, playerDir, dt, ls.track.totalLength,
		);

		// Once the player has gone past it, put it back in front: it exists to
		// be in the way, and a service behind you is just a mesh being drawn.
		if (gapAhead(playerDist, this.leading.state.dist, playerDir) < -260) {
			this.leading.state.dist = playerDist + LEADING_START_AHEAD * playerDir;
			this.leading.state.speed = 0;
		}

		const spacing = this.carLength + CAR_GAP;

		for (let i = 0; i < this.leading.cars.length; i++) {
			const pos = trainSystem.getPositionOnLine(
				trainSystem.currentLineIdx,
				this.leading.state.dist - i * spacing * playerDir,
				playerDir,
				// Zero: it is on YOUR track. That is the whole point of it.
				0,
			);

			if (!pos) continue;

			this.leading.cars[i].position.set(pos.x, pos.height, pos.y);
			this.leading.cars[i].rotation.set(0, pos.heading, 0);
			this.leading.cars[i].updateMatrix();
		}
	}

	private poseService(trainSystem: TrainSystem, service: AmbientService, playerDir: number): void {
		// It faces the way it is going, which is opposite to the player.
		const facing = -playerDir;
		const spacing = this.carLength + CAR_GAP;

		for (let i = 0; i < service.cars.length; i++) {
			const pos = trainSystem.getPositionOnLine(
				trainSystem.currentLineIdx,
				service.dist - i * spacing * facing,
				facing,
				// Which side depends on the direction of travel, so an oncoming
				// service is always on the left-hand alignment rather than
				// swapping sides when the player reverses.
				TRACK_OFFSET * playerDir,
			);

			if (!pos) continue;

			service.cars[i].position.set(pos.x, pos.height, pos.y);
			service.cars[i].rotation.set(0, pos.heading, 0);
			service.cars[i].updateMatrix();
		}
	}
}
