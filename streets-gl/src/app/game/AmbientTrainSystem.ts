import System from '../System';
import SettingsSystem from '../systems/SettingsSystem';
import TrainSystem from './TrainSystem';
import TrainRenderingSystem from './rendering/TrainRenderingSystem';
import type TrainMeshObject from './rendering/TrainMeshObject';

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

export default class AmbientTrainSystem extends System {
	private services: AmbientService[] = [];
	private builtForLine: number = -1;
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
		this.builtForLine = -1;
	}

	private build(trainSystem: TrainSystem, playerDist: number): void {
		const rendering = this.systemManager.getSystem(TrainRenderingSystem);

		if (!rendering) return;

		this.clear();
		this.carLength = rendering.ambientCarLength() || 20;

		const line = trainSystem.lines[trainSystem.currentLineIdx];
		const colour = line?.parsed.color ?? '#9aa7b4';

		for (let i = 0; i < FLEET_SIZE; i++) {
			this.services.push({
				dist: playerDist + SPAWN_AHEAD + i * SPAWN_STAGGER,
				cars: rendering.buildAmbientCars(CARS_PER_TRAIN, colour),
			});
		}

		this.builtForLine = trainSystem.currentLineIdx;
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

		if (this.builtForLine !== trainSystem.currentLineIdx || this.services.length === 0) {
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
