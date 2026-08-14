import System from '../../System';
import SceneSystem from '../../systems/SceneSystem';
import TrainSystem from '../TrainSystem';
import TrainMeshObject from '../rendering/TrainMeshObject';
import {buildStopMarkGeometry} from './StopMarkGeometry';

/**
 * The stop mark, standing where the train is meant to stop.
 *
 * The stop scorer has always graded precision against a point on the track —
 * within 2 m is perfect, within 12 m is good — and that point was invisible.
 * Marking someone on how close they stopped to somewhere nobody showed them is
 * not a game, it is a guess. This puts the target on the ground.
 *
 * ONE mark exists and it moves to whichever station is next, rather than one
 * per station: only the next stop is ever being judged, and a line of boards
 * receding into the distance would say "stop here" thirty times over.
 */

/** Beyond this the mark is not placed — it would just be scenery. */
const SHOW_WITHIN_M = 1200;
/** Just clear of the running line, on the platform side. */
const SIDE_OFFSET = 3.2;

export default class StopMarkRenderingSystem extends System {
	public markMesh: TrainMeshObject | null = null;

	private shownForStation: number = -1;
	private builtForMap: number = -1;

	public postInit(): void {
		// Built lazily: there is no line to stand beside until one is loaded.
	}

	private ensureMesh(): TrainMeshObject | null {
		const sceneSystem = this.systemManager.getSystem(SceneSystem);

		if (!sceneSystem) return null;

		if (!this.markMesh) {
			this.markMesh = new TrainMeshObject(buildStopMarkGeometry());
			sceneSystem.objects.wrapper.add(this.markMesh);
		}

		return this.markMesh;
	}

	private hide(): void {
		// Parked far below the world rather than removed: this happens whenever
		// the train is between stations, and disposing/rebuilding a mesh at that
		// rate is the shape of the leak that used to grow all session.
		if (this.markMesh) {
			this.markMesh.position.set(0, -10000, 0);
			this.markMesh.updateMatrix();
		}
	}

	public update(): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);

		if (!trainSystem?.gameActive || !trainSystem.trainPosition) return;

		const ls = trainSystem.getCurrentLine();
		const state = trainSystem.stationState;

		if (!ls || !state) {
			this.hide();
			return;
		}

		// Whichever stop is being judged next — the same choice the scorer makes,
		// so the mark is always standing at the point actually being graded.
		const idx = state.arriving ? state.nearestStationIdx : state.nextStationIdx;
		const markerDist = idx >= 0 ? ls.realStationDists[idx] : undefined;

		if (markerDist === undefined) {
			this.hide();
			return;
		}

		const away = Math.abs(markerDist - trainSystem.physicsState.trainDist);

		if (away > SHOW_WITHIN_M) {
			this.hide();
			return;
		}

		const mesh = this.ensureMesh();

		if (!mesh) return;

		// Reposition only when the target changes or the map does — the mark is
		// static in the world once placed, so posing it every frame would be
		// work for nothing.
		if (this.shownForStation === idx && this.builtForMap === trainSystem.mapGeneration) return;

		const dir = trainSystem.physicsState.direction || 1;
		const pos = trainSystem.getPositionOnLine(
			trainSystem.currentLineIdx, markerDist, dir, SIDE_OFFSET * dir,
		);

		if (!pos) return;

		mesh.position.set(pos.x, pos.height, pos.y);
		// Facing back down the line, so it reads to the driver coming at it.
		mesh.rotation.set(0, pos.heading + Math.PI, 0);
		mesh.updateMatrix();

		this.shownForStation = idx;
		this.builtForMap = trainSystem.mapGeneration;
	}
}
