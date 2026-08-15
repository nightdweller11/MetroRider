import System from '../System';
import SceneSystem from '../systems/SceneSystem';
import ControlsSystem from '../systems/ControlsSystem';
import TrainSystem from './TrainSystem';
import Vec3 from '~/lib/math/Vec3';
import PerspectiveCamera from '~/lib/core/PerspectiveCamera';
import TerrainSystem from '../systems/TerrainSystem';
import {
	createWalkState, stepWalk, look, EYE_HEIGHT,
	type WalkState, type WalkInput,
} from './WalkController';

/**
 * How far to the side of the train you land when you step out, metres.
 *
 * Clear of the rail corridor, which is cleared out of the terrain to a 10 m
 * radius (`TrainSystem.CORRIDOR_RADIUS`). Stepping out at 7 m put the walker
 * inside that hole, looking at the dark inside of the cutting rather than at
 * the city — the ground simply is not there.
 */
const WALK_STEP_OUT_M = 15;
/**
 * Near clip while on foot, metres.
 *
 * The scene's near plane is 10 m, which is sensible for a camera sixty metres
 * behind a train and absurd for a person: standing at eye height it clipped
 * away everything within ten metres, so the bottom third of the screen — the
 * ground you are standing on — simply was not drawn.
 */
const WALK_NEAR = 0.4;
/**
 * Far clip while on foot, metres.
 *
 * Pulled in with the near plane to keep the depth buffer's precision ratio in
 * the same place it was; twenty kilometres is well past anything a walker can
 * make out anyway.
 */
const WALK_FAR = 20000;

export enum GameCameraMode {
	Chase = 'chase',
	Cab = 'cab',
	Orbit = 'orbit',
	/** A seat by the window, inside the train. */
	Ride = 'ride',
	/** Standing beside the line, watching your own train go past. */
	Trackside = 'trackside',
	/** On the ground, on foot — the train is something to walk back to. */
	Walk = 'walk',
	/** Free look with the interface out of the way, for a clean picture. */
	Photo = 'photo',
	Free = 'free',
}

const CHASE_DISTANCE = 60;
const CHASE_HEIGHT = 25;
const CAB_FORWARD = 12;
const CAB_HEIGHT = 4.5;
const ORBIT_DISTANCE = 80;
const ORBIT_HEIGHT = 40;
const ORBIT_SPEED = 0.15;
const SMOOTH_FACTOR = 4.0;

/**
 * Two cars back, at the window, at sitting eye height — and just OUTSIDE the
 * body rather than inside it. There is no carriage interior to sit in, so a
 * seat position renders as a camera floating over open ground with no train in
 * frame. At the window line, angled forward, the train's own flank leads the
 * shot and the city sweeps past it: the view reads as riding.
 */
const RIDE_BACK = 30;
/**
 * Negative puts the window on the side that sends the train down the LEFT of
 * the frame. On the right it ran straight into the driving console; the left
 * only meets the much smaller map corner.
 */
const RIDE_SIDE = -3.4;
const RIDE_HEIGHT = 3.4;
/**
 * How far the gaze turns OUT from straight ahead, in radians. Cars are placed
 * behind the reference point, so from a seat 30 m back the leading cars sit
 * about 10 degrees off forward — and the camera is a 40 degree lens, so an
 * angle chosen by eye missed them entirely. A small outward turn keeps the
 * train down one side of the frame with the city filling the rest.
 */
const RIDE_LOOK_OUT = -0.26;

/**
 * Trackside stands still and lets the train come past — that is the whole
 * point of the view, so the camera is planted in the world rather than
 * carried by the train. It re-plants ahead once the train has gone by and
 * become too small to enjoy.
 */
const TRACKSIDE_OFFSET = 18;
const TRACKSIDE_AHEAD = 130;
const TRACKSIDE_HEIGHT = 2.4;
const TRACKSIDE_REPLANT_DISTANCE = 260;

const MIN_DISTANCE = 15;
const MAX_DISTANCE = 300;
const MIN_PITCH = 0.05;
const MAX_PITCH = 1.4;

export default class GameCameraSystem extends System {
	public mode: GameCameraMode = GameCameraMode.Chase;

	private camera: PerspectiveCamera | null = null;
	private smoothX: number = 0;
	private smoothY: number = 0;
	private smoothZ: number = 0;
	private smoothHeading: number = 0;
	private orbitAngle: number = 0;
	private active: boolean = false;

	private userYawOffset: number = 0;
	private userPitchOffset: number = 0.4;
	private userDistance: number = CHASE_DISTANCE;
	private isDragging: boolean = false;
	private lastMouseX: number = 0;
	private lastMouseY: number = 0;
	private inputListenersAdded: boolean = false;
	private pendingSnap: boolean = false;

	/** Where the walker is, once they have stepped off the train. */
	private walk: WalkState | null = null;
	private walkInput: WalkInput = {forward: 0, strafe: 0, running: false};
	private savedNear: number | null = null;
	private savedFar: number | null = null;

	/** Where Trackside is standing, in world space, until it re-plants. */
	private tracksideX: number = 0;
	private tracksideY: number = 0;
	private tracksideZ: number = 0;

	public isActive(): boolean {
		return this.active;
	}

	public postInit(): void {
		window.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey) {
				if (this.active) {
					this.cycleMode();
				}
			}
		});

		this.addInputListeners();
	}

	private addInputListeners(): void {
		if (this.inputListenersAdded) return;
		this.inputListenersAdded = true;

		const canvas = document.querySelector('canvas');
		const target = canvas || document.body;

		target.addEventListener('mousedown', (e: MouseEvent) => {
			if (!this.active) return;
			if (e.button === 0 || e.button === 2) {
				this.isDragging = true;
				this.lastMouseX = e.clientX;
				this.lastMouseY = e.clientY;
			}
		});

		window.addEventListener('mousemove', (e: MouseEvent) => {
			if (!this.active || !this.isDragging) return;
			const dx = e.clientX - this.lastMouseX;
			const dy = e.clientY - this.lastMouseY;
			this.lastMouseX = e.clientX;
			this.lastMouseY = e.clientY;

			this.userYawOffset -= dx * 0.005;
			this.userPitchOffset = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.userPitchOffset + dy * 0.005));
		});

		window.addEventListener('mouseup', () => {
			this.isDragging = false;
		});

		target.addEventListener('wheel', (e: WheelEvent) => {
			if (!this.active) return;
			e.preventDefault();
			const zoomFactor = 1 + e.deltaY * 0.001;
			this.userDistance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, this.userDistance * zoomFactor));
		}, {passive: false});

		target.addEventListener('contextmenu', (e: Event) => {
			if (this.active) e.preventDefault();
		});

		let touchStartDist = 0;
		let touchStartX = 0;
		let touchStartY = 0;
		let isTouchDragging = false;

		target.addEventListener('touchstart', (e: TouchEvent) => {
			if (!this.active) return;
			if (e.touches.length === 1) {
				isTouchDragging = true;
				touchStartX = e.touches[0].clientX;
				touchStartY = e.touches[0].clientY;
			} else if (e.touches.length === 2) {
				isTouchDragging = false;
				const dx = e.touches[1].clientX - e.touches[0].clientX;
				const dy = e.touches[1].clientY - e.touches[0].clientY;
				touchStartDist = Math.sqrt(dx * dx + dy * dy);
			}
		}, {passive: true});

		target.addEventListener('touchmove', (e: TouchEvent) => {
			if (!this.active) return;
			if (e.touches.length === 1 && isTouchDragging) {
				const dx = e.touches[0].clientX - touchStartX;
				const dy = e.touches[0].clientY - touchStartY;
				touchStartX = e.touches[0].clientX;
				touchStartY = e.touches[0].clientY;
				this.userYawOffset -= dx * 0.008;
				this.userPitchOffset = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.userPitchOffset + dy * 0.008));
			} else if (e.touches.length === 2) {
				const dx = e.touches[1].clientX - e.touches[0].clientX;
				const dy = e.touches[1].clientY - e.touches[0].clientY;
				const dist = Math.sqrt(dx * dx + dy * dy);
				if (touchStartDist > 0) {
					const ratio = touchStartDist / dist;
					this.userDistance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, this.userDistance * ratio));
				}
				touchStartDist = dist;
			}
		}, {passive: true});

		target.addEventListener('touchend', () => {
			isTouchDragging = false;
		});
	}

	public activate(): void {
		this.active = true;
		const controls = this.systemManager.getSystem(ControlsSystem);
		if (controls) {
			controls.gameMode = true;
		}
	}

	public deactivate(): void {
		this.active = false;
		const controls = this.systemManager.getSystem(ControlsSystem);
		if (controls) {
			controls.gameMode = false;
		}
	}

	public cycleMode(): void {
		const modes = this.selectableModes();
		const idx = modes.indexOf(this.mode);

		this.setMode(modes[(idx + 1) % modes.length]);
	}

	/** The views the C key and the camera sheet walk through, in order. */
	public selectableModes(): GameCameraMode[] {
		return [
			GameCameraMode.Chase,
			GameCameraMode.Cab,
			GameCameraMode.Orbit,
			GameCameraMode.Ride,
			GameCameraMode.Trackside,
			GameCameraMode.Walk,
			GameCameraMode.Photo,
		];
	}

	public setMode(mode: GameCameraMode): void {
		this.mode = mode;

		// Trackside plants where the train is NOW, not where it was when you
		// last used the view — otherwise switching to it drops you at a spot
		// the train left several stations ago.
		if (mode === GameCameraMode.Trackside) this.plantTrackside();

		// Stepping out puts you beside the train, facing it — not at whatever
		// spot you wandered to last time, which after a few stations is open
		// country with no train in sight.
		if (mode === GameCameraMode.Walk) this.stepOut();
		else this.restoreClipPlanes();
	}

	public getModeLabel(): string {
		switch (this.mode) {
			case GameCameraMode.Chase: return 'Chase';
			case GameCameraMode.Cab: return 'Cab';
			case GameCameraMode.Orbit: return 'Orbit';
			case GameCameraMode.Ride: return 'Ride';
			case GameCameraMode.Trackside: return 'Trackside';
			case GameCameraMode.Walk: return 'Walk';
			case GameCameraMode.Photo: return 'Photo';
			case GameCameraMode.Free: return 'Free';
		}
	}

	/** Photo hides the interface, so the rest of the UI needs to know. */
	public isPhotoMode(): boolean {
		return this.mode === GameCameraMode.Photo;
	}

	public isWalkMode(): boolean {
		return this.mode === GameCameraMode.Walk;
	}

	public walkPosition(): WalkState | null {
		return this.walk;
	}

	/** Where the train is standing, for the leash and the way back. */
	public trainGroundPosition(): {x: number; z: number} | null {
		const pos = this.systemManager.getSystem(TrainSystem)?.trainPosition;

		return pos ? {x: pos.x, z: pos.y} : null;
	}

	/** Put the walker on the ground beside the train, looking at it. */
	private stepOut(): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);
		const pos = trainSystem?.trainPosition;

		if (!pos) return;

		// Off to the side of the train rather than on the track, and turned to
		// face it, so the first thing you see having stepped out is your train.
		const side = pos.heading + Math.PI / 2;
		const x = pos.x + Math.sin(side) * WALK_STEP_OUT_M;
		const z = pos.y - Math.cos(side) * WALK_STEP_OUT_M;

		this.walk = createWalkState(x, z, side + Math.PI, this.groundAt(x, z));
	}

	/** Give the scene back the clip planes it had before anyone stepped out. */
	private restoreClipPlanes(): void {
		if (this.savedNear === null || !this.camera) return;

		this.camera.near = this.savedNear;
		this.camera.far = this.savedFar ?? this.camera.far;
		this.camera.updateProjectionMatrix();
		this.savedNear = null;
		this.savedFar = null;
	}

	/** Ground height under a point, falling back to the train's own height. */
	private groundAt(x: number, z: number): number {
		const terrain = this.systemManager.getSystem(TerrainSystem)?.terrainHeightProvider;
		const height = terrain?.getHeightGlobalInterpolated(x, z, true);

		if (Number.isFinite(height)) return height as number;

		return this.systemManager.getSystem(TrainSystem)?.trainPosition?.height ?? 0;
	}

	/** Move the walker for this frame and place the camera at eye height. */
	private updateWalk(dt: number): void {
		if (!this.walk) {
			this.stepOut();
			if (!this.walk) return;
		}

		if (this.camera.near !== WALK_NEAR) {
			this.savedNear = this.camera.near;
			this.savedFar = this.camera.far;
			this.camera.near = WALK_NEAR;
			this.camera.far = WALK_FAR;
			this.camera.updateProjectionMatrix();
		}

		stepWalk(this.walk, this.walkInput, dt, (x, z) => this.groundAt(x, z));

		const eye = this.walk.groundY + EYE_HEIGHT;
		const cosPitch = Math.cos(this.walk.pitch);

		this.camera.position.set(this.walk.x, eye, this.walk.z);
		// position + lookAt and nothing else, exactly as the other planted views
		// do it. Calling updateMatrix() after lookAt recomputes the matrix from
		// position and rotation and throws the orientation lookAt just set away:
		// the camera kept pointing wherever it already pointed, so turning did
		// nothing at all.
		this.camera.lookAt(new Vec3(
			this.walk.x + Math.sin(this.walk.heading) * cosPitch,
			eye + Math.sin(this.walk.pitch),
			this.walk.z - Math.cos(this.walk.heading) * cosPitch,
		), false);
	}

	/** What the on-screen thumbstick and keys are asking for. */
	public setWalkInput(forward: number, strafe: number, running: boolean = false): void {
		this.walkInput = {forward, strafe, running};
	}

	/** Turn the head, in radians. */
	public lookWalk(deltaYaw: number, deltaPitch: number): void {
		if (this.walk) look(this.walk, deltaYaw, deltaPitch);
	}

	public update(deltaTime: number): void {
		if (!this.active) return;

		const trainSystem = this.systemManager.getSystem(TrainSystem);
		if (!trainSystem || !trainSystem.trainPosition || !trainSystem.gameActive) return;

		// snapToTrain() called before the first physics frame (trainPosition not
		// yet computed) defers to here, so the camera never lerps in from (0,0,0).
		if (this.pendingSnap) {
			this.pendingSnap = false;
			this.snapToTrain();
		}

		if (!this.camera) {
			const sceneSystem = this.systemManager.getSystem(SceneSystem);
			if (!sceneSystem) return;
			this.camera = sceneSystem.objects.camera;
		}

		this.camera.matrixOverwrite = false;

		const pos = trainSystem.trainPosition;
		const dt = Math.min(deltaTime, 0.1);

		// Track the train's position EXACTLY — never lag-filter it. A first-order
		// exponential follower has a frame-time-dependent equilibrium: with mixed
		// 8/16/25/33 ms frames its lag distance shifts every frame, which made the
		// camera oscillate 2-5 cm against the train (1-5 px of lateral shake on
		// screen — the "shimmer" no anti-aliasing could hide; measured with the
		// scripts/perf wobble tracer). Smoothing stays where it belongs: heading
		// (rotation feel) and height (terrain-sampling seams).
		this.smoothX = pos.x;
		this.smoothZ = pos.y;

		const alpha = 1.0 - Math.exp(-SMOOTH_FACTOR * dt);
		const heightAlpha = 1.0 - Math.exp(-12 * dt);
		this.smoothY += (pos.height - this.smoothY) * heightAlpha;

		let headingDiff = pos.heading - this.smoothHeading;
		while (headingDiff > Math.PI) headingDiff -= 2 * Math.PI;
		while (headingDiff < -Math.PI) headingDiff += 2 * Math.PI;
		this.smoothHeading += headingDiff * alpha;

		switch (this.mode) {
			case GameCameraMode.Chase:
				this.updateChase();
				break;
			case GameCameraMode.Cab:
				this.updateCab();
				break;
			case GameCameraMode.Orbit:
				this.updateOrbit(deltaTime);
				break;
			case GameCameraMode.Ride:
				this.updateRide();
				break;
			case GameCameraMode.Trackside:
				this.updateTrackside();
				break;
			case GameCameraMode.Walk:
				this.updateWalk(dt);
				break;
			case GameCameraMode.Photo:
				this.updatePhoto();
				break;
		}
	}

	/**
	 * A passenger seat. The window is at your shoulder, so the view is mostly
	 * sideways with a little forward lean — looking straight ahead from inside
	 * a train shows you the back of the next seat, not the city.
	 */
	private updateRide(): void {
		const heading = this.smoothHeading;
		const side = heading + Math.PI / 2;

		const x = this.smoothX - Math.sin(heading) * RIDE_BACK + Math.sin(side) * RIDE_SIDE;
		const z = this.smoothZ - Math.cos(heading) * RIDE_BACK + Math.cos(side) * RIDE_SIDE;
		const y = this.smoothY + RIDE_HEIGHT;

		this.camera.position.set(x, y, z);

		// Drag steers where the passenger is looking; by default out of the
		// window with a forward bias, the way you actually watch a city go by.
		const look = heading + RIDE_LOOK_OUT + this.userYawOffset;
		const lookDist = 120;

		this.camera.lookAt(
			new Vec3(
				x + Math.sin(look) * lookDist,
				y - (this.userPitchOffset - 0.4) * lookDist * 0.5,
				z + Math.cos(look) * lookDist,
			),
			false,
		);
	}

	private plantTrackside(): void {
		const train = this.systemManager.getSystem(TrainSystem);
		const pos = train?.trainPosition;

		if (!pos) return;

		// Stand ahead of the train and off to one side, so it arrives, passes,
		// and recedes rather than appearing already on top of you.
		const ahead = pos.heading;
		const side = ahead + Math.PI / 2;

		this.tracksideX = pos.x + Math.sin(ahead) * TRACKSIDE_AHEAD + Math.sin(side) * TRACKSIDE_OFFSET;
		this.tracksideZ = pos.y + Math.cos(ahead) * TRACKSIDE_AHEAD + Math.cos(side) * TRACKSIDE_OFFSET;
		this.tracksideY = pos.height + TRACKSIDE_HEIGHT;
	}

	private updateTrackside(): void {
		const dx = this.smoothX - this.tracksideX;
		const dz = this.smoothZ - this.tracksideZ;

		// Once it is a speck, go and stand further up the line.
		if (Math.hypot(dx, dz) > TRACKSIDE_REPLANT_DISTANCE) {
			this.plantTrackside();
		}

		this.camera.position.set(this.tracksideX, this.tracksideY, this.tracksideZ);
		this.camera.lookAt(new Vec3(this.smoothX, this.smoothY + 2, this.smoothZ), false);
	}

	/**
	 * Photo is Orbit that holds still: no drift, so the shot you framed is the
	 * shot you get. The interface hiding is the UI's business, not the camera's.
	 */
	private updatePhoto(): void {
		const angle = this.orbitAngle + this.userYawOffset;
		const dist = this.userDistance;
		const pitch = this.userPitchOffset;

		const horizontalDist = dist * Math.cos(pitch);
		const verticalDist = dist * Math.sin(pitch);

		this.camera.position.set(
			this.smoothX + Math.cos(angle) * horizontalDist,
			this.smoothY + verticalDist,
			this.smoothZ + Math.sin(angle) * horizontalDist,
		);
		this.camera.lookAt(new Vec3(this.smoothX, this.smoothY + 2, this.smoothZ), false);
	}

	private updateChase(): void {
		const heading = this.smoothHeading + this.userYawOffset;
		const dist = this.userDistance;
		const pitch = this.userPitchOffset;

		const horizontalDist = dist * Math.cos(pitch);
		const verticalDist = dist * Math.sin(pitch);

		const behindX = this.smoothX - Math.sin(heading) * horizontalDist;
		const behindZ = this.smoothZ - Math.cos(heading) * horizontalDist;

		this.camera.position.set(behindX, this.smoothY + verticalDist, behindZ);
		this.camera.lookAt(new Vec3(this.smoothX, this.smoothY + 2, this.smoothZ), false);
	}

	private updateCab(): void {
		const heading = this.smoothHeading;
		const fwdX = this.smoothX + Math.sin(heading) * CAB_FORWARD;
		const fwdZ = this.smoothZ + Math.cos(heading) * CAB_FORWARD;

		this.camera.position.set(fwdX, this.smoothY + CAB_HEIGHT, fwdZ);

		const lookDist = 200;
		const lookX = fwdX + Math.sin(heading) * lookDist;
		const lookZ = fwdZ + Math.cos(heading) * lookDist;
		this.camera.lookAt(new Vec3(lookX, this.smoothY + CAB_HEIGHT - 3, lookZ), false);
	}

	private updateOrbit(dt: number): void {
		const angle = this.orbitAngle + this.userYawOffset;
		if (!this.isDragging) {
			this.orbitAngle += ORBIT_SPEED * dt;
		}

		const dist = this.userDistance;
		const pitch = this.userPitchOffset;

		const horizontalDist = dist * Math.cos(pitch);
		const verticalDist = dist * Math.sin(pitch);

		const ox = this.smoothX + Math.cos(angle) * horizontalDist;
		const oz = this.smoothZ + Math.sin(angle) * horizontalDist;

		this.camera.position.set(ox, this.smoothY + verticalDist, oz);
		this.camera.lookAt(new Vec3(this.smoothX, this.smoothY + 2, this.smoothZ), false);
	}

	public snapToTrain(): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);
		if (!trainSystem?.trainPosition) {
			// Train position isn't computed until the first active physics frame —
			// remember to snap as soon as it exists.
			this.pendingSnap = true;
			return;
		}

		const pos = trainSystem.trainPosition;
		this.smoothX = pos.x;
		this.smoothY = pos.height;
		this.smoothZ = pos.y;
		this.smoothHeading = pos.heading;
	}
}
