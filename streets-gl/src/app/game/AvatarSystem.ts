import System from '../System';
import SceneSystem from '../systems/SceneSystem';
import GameCameraSystem from './GameCameraSystem';
import PassengerRenderingSystem from './passengers/PassengerRenderingSystem';
import TrainMeshObject from './rendering/TrainMeshObject';
import type {PersonBuffers} from './passengers/PersonGeometry';

/**
 * The person you are, once you have stepped off the train.
 *
 * Walk mode put a camera on the ground and called it a person. From behind
 * your own shoulder there was nothing there — no body, no legs, no shadow —
 * so "walking around" was really a floating eye. This draws the figure.
 *
 * It is the same cast that stands on the platforms: the character loader skins
 * a rigged model on the CPU into a cycle of poses, because this renderer bakes
 * vertices and has no GPU skinning. Reusing it means the avatar is lit,
 * shadowed and shaded exactly like everyone else in the city rather than being
 * a special case that looks like one.
 */

/** Metres walked per pose of the cycle. Roughly one pose per footfall. */
const METRES_PER_POSE = 0.42;
/** How far the model is rotated to face the way the walker is going. */
function yawFor(heading: number): number {
	// The figure models face +z. Rotating by `y` sends +z to (sin y, cos y),
	// and a heading of `h` clockwise from north points at (sin h, −cos h), so
	// the rotation that lines them up is π − h.
	return Math.PI - heading;
}

export default class AvatarSystem extends System {
	/**
	 * The figure, in the form the renderer collects.
	 *
	 * GBufferPass draws an explicit LIST of meshes; adding one to the scene
	 * wrapper is not enough to make it appear. The avatar existed, was posed
	 * and was positioned correctly for a whole build without being drawn once.
	 */
	public avatarMeshes: TrainMeshObject[] = [];

	private mesh: TrainMeshObject | null = null;
	private poses: PersonBuffers[] | null = null;
	private poseIndex = -1;
	private walkedM = 0;
	private lastX: number | null = null;
	private lastZ: number | null = null;
	private builtHeading = 0;

	public postInit(): void {
		// The character models stream in; there is nothing to build yet.
	}

	public update(): void {
		const cam = this.systemManager.getSystem(GameCameraSystem);
		const walker = cam?.isWalkMode() ? cam.walkPosition() : null;

		if (!walker) {
			this.hide();

			return;
		}

		if (!this.poses) {
			this.poses = this.systemManager.getSystem(PassengerRenderingSystem)?.walkCyclePoses() ?? null;

			// Still loading. Next frame.
			if (!this.poses) return;
		}

		// Advance the walk cycle by DISTANCE, not by time: a figure whose legs
		// move while it is standing still is worse than one that does not move
		// at all.
		if (this.lastX !== null && this.lastZ !== null) {
			this.walkedM += Math.hypot(walker.x - this.lastX, walker.z - this.lastZ);
		}

		this.lastX = walker.x;
		this.lastZ = walker.z;

		const wanted = this.poses.length > 1
			? Math.floor(this.walkedM / METRES_PER_POSE) % this.poses.length
			: 0;

		// The heading has to be rebuilt too, not only the pose: the rotation is
		// baked into the vertices, so a figure that only re-poses on a footfall
		// keeps facing wherever it was pointing when it last took a step.
		const turned = Math.abs(walker.heading - this.builtHeading) > 0.05;

		if (wanted !== this.poseIndex || turned) {
			this.poseIndex = wanted;
			this.builtHeading = walker.heading;
			this.rebuild(walker.heading);
		}

		// Every frame, whether or not the shape changed — a rebuild leaves a
		// mesh at the origin until something places it.
		this.place(walker.x, walker.groundY, walker.z);
	}

	/**
	 * Rebuild the figure at the current pose, rotated to face the way it is
	 * walking.
	 *
	 * The rotation is baked into the vertices rather than put on the mesh
	 * transform, for the same reason the crowds do it: `TrainMeshObject` carries
	 * a position and these buffers are what the renderer draws.
	 */
	private rebuild(heading: number): void {
		const sceneSystem = this.systemManager.getSystem(SceneSystem);
		const pose = this.poses?.[this.poseIndex];

		if (!sceneSystem || !pose) return;

		const count = pose.position.length / 3;
		const position = new Float32Array(pose.position.length);
		const normal = new Float32Array(pose.normal.length);
		const y = yawFor(heading);
		const cos = Math.cos(y);
		const sin = Math.sin(y);

		for (let k = 0; k < count; k++) {
			const i = k * 3;
			const px = pose.position[i];
			const pz = pose.position[i + 2];
			const nx = pose.normal[i];
			const nz = pose.normal[i + 2];

			position[i] = px * cos + pz * sin;
			position[i + 1] = pose.position[i + 1];
			position[i + 2] = -px * sin + pz * cos;

			normal[i] = nx * cos + nz * sin;
			normal[i + 1] = pose.normal[i + 1];
			normal[i + 2] = -nx * sin + nz * cos;
		}

		// Re-pose in place while the shape is the same — a rebuild per footfall
		// would otherwise churn a mesh several times a second.
		if (this.mesh && this.mesh.buffers.position.length === position.length) {
			this.mesh.updatePositionAndNormalBuffers(position, normal);

			return;
		}

		if (this.mesh) {
			sceneSystem.objects.wrapper.remove(this.mesh);
			this.mesh.dispose();
		}

		this.mesh = new TrainMeshObject({
			position, normal,
			color: pose.color,
			indices: pose.indices,
		});
		sceneSystem.objects.wrapper.add(this.mesh);
		this.avatarMeshes = [this.mesh];
	}

	private place(x: number, groundY: number, z: number): void {
		if (!this.mesh) return;

		this.mesh.position.set(x, groundY, z);
		this.mesh.updateMatrix();
	}

	private hide(): void {
		if (!this.mesh) return;

		this.systemManager.getSystem(SceneSystem)?.objects.wrapper.remove(this.mesh);
		this.mesh.dispose();
		this.mesh = null;
		this.avatarMeshes = [];
		this.poseIndex = -1;
		this.walkedM = 0;
		this.lastX = null;
		this.lastZ = null;
		this.builtHeading = 0;
	}
}
