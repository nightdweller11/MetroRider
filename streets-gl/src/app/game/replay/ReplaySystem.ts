import System from '~/app/System';
import TrainSystem from '../TrainSystem';
import TrainRenderingSystem from '../rendering/TrainRenderingSystem';
import GameCameraSystem, {GameCameraMode} from '../GameCameraSystem';
import {
	advanceReplay, beginReplay, canReplay, replayCamera, replaySampleAt, type ReplayState,
} from './StopReplay';
import type {RunSample} from './RunRecorder';

/**
 * Watching the last approach again.
 *
 * Runs the player's OWN train back down the line while the camera watches from
 * beside the track. Nothing is duplicated and nothing is simulated twice: the
 * physics keeps standing at the platform, and only the drawn position and the
 * camera's focus are moved. That is what makes it impossible for the replay
 * and the game to get out of step — there is only one train.
 *
 * Everything it puts out of place is put back when it ends, including when it
 * is cut short by the player driving away.
 */
export default class ReplaySystem extends System {
	private state: ReplayState | null = null;
	/** The last approach worth watching, kept until another one replaces it. */
	private lastApproach: RunSample[] = [];
	private restoreMode: GameCameraMode | null = null;

	public postInit(): void {
		// Nothing to do until a stop has been made.
	}

	/** Offered by the scorer after every stop. */
	public keepApproach(samples: RunSample[]): void {
		this.lastApproach = Array.isArray(samples) ? samples : [];
	}

	/** Whether there is an approach worth offering to watch. */
	public hasReplay(): boolean {
		return canReplay(this.lastApproach);
	}

	public isPlaying(): boolean {
		return this.state !== null;
	}

	public start(): boolean {
		const state = beginReplay(this.lastApproach);

		if (!state) return false;

		const cam = this.systemManager.getSystem(GameCameraSystem);

		this.state = state;
		this.restoreMode = cam?.mode ?? null;
		// Trackside is the view that already means "stand beside the line and
		// watch"; the replay only has to say WHERE to stand and what to follow.
		cam?.setMode(GameCameraMode.Trackside);

		return true;
	}

	public stop(): void {
		if (!this.state) return;

		const rendering = this.systemManager.getSystem(TrainRenderingSystem);
		const cam = this.systemManager.getSystem(GameCameraSystem);

		// Put everything back, in the order that leaves no frame showing the
		// train in the wrong place: drop the drawing override first, then the
		// camera's focus, then the view the player was in.
		if (rendering) rendering.replayDist = null;
		if (cam) cam.replayFocus = null;
		if (cam && this.restoreMode !== null) cam.setMode(this.restoreMode);

		this.state = null;
		this.restoreMode = null;
	}

	public update(deltaTime: number): void {
		if (!this.state) return;

		const trainSystem = this.systemManager.getSystem(TrainSystem);

		// Driving away ends it. A replay that kept playing while the player
		// pulled out would be showing them a train that is somewhere else.
		if (!trainSystem?.gameActive || Math.abs(trainSystem.physicsState.trainSpeed) > 1) {
			this.stop();

			return;
		}

		if (!advanceReplay(this.state, deltaTime)) {
			this.stop();

			return;
		}

		const sample = replaySampleAt(this.state);
		const shot = replayCamera(this.state);
		const rendering = this.systemManager.getSystem(TrainRenderingSystem);
		const cam = this.systemManager.getSystem(GameCameraSystem);

		if (!sample || !shot) return;

		if (rendering) rendering.replayDist = sample.dist;

		// The train's real pose at that distance — terrain height and heading
		// included. Reconstructing those from the sample would mean a camera
		// looking at ground level on a line that climbs.
		const pose = trainSystem.getCarPosition(0, sample.dist);

		if (cam && pose) {
			cam.replayFocus = {x: pose.x, y: pose.y, height: pose.height, heading: pose.heading};
			cam.plantTracksideAt(shot.position.x, pose.height + shot.position.y, shot.position.z);
		}
	}
}
