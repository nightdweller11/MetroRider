import System from '../System';
import SceneSystem from '../systems/SceneSystem';
import ControlsSystem from '../systems/ControlsSystem';
import TrainSystem from './TrainSystem';
import Vec3 from '~/lib/math/Vec3';
import PerspectiveCamera from '~/lib/core/PerspectiveCamera';

export enum GameCameraMode {
	Chase = 'chase',
	Cab = 'cab',
	Orbit = 'orbit',
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
		const modes = [GameCameraMode.Chase, GameCameraMode.Cab, GameCameraMode.Orbit];
		const idx = modes.indexOf(this.mode);
		this.mode = modes[(idx + 1) % modes.length];
		console.log(`[GameCamera] Mode: ${this.mode}`);
	}

	public getModeLabel(): string {
		switch (this.mode) {
			case GameCameraMode.Chase: return 'Chase';
			case GameCameraMode.Cab: return 'Cab';
			case GameCameraMode.Orbit: return 'Orbit';
			case GameCameraMode.Free: return 'Free';
		}
	}

	public update(deltaTime: number): void {
		if (!this.active) return;

		const trainSystem = this.systemManager.getSystem(TrainSystem);
		if (!trainSystem || !trainSystem.trainPosition || !trainSystem.gameActive) return;

		if (!this.camera) {
			const sceneSystem = this.systemManager.getSystem(SceneSystem);
			if (!sceneSystem) return;
			this.camera = sceneSystem.objects.camera;
		}

		this.camera.matrixOverwrite = false;

		const pos = trainSystem.trainPosition;
		const dt = Math.min(deltaTime, 0.1);

		const alpha = 1.0 - Math.exp(-SMOOTH_FACTOR * dt);
		this.smoothX += (pos.x - this.smoothX) * alpha;
		this.smoothY += (pos.height - this.smoothY) * alpha;
		this.smoothZ += (pos.y - this.smoothZ) * alpha;

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
		}
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
		if (!trainSystem?.trainPosition) return;

		const pos = trainSystem.trainPosition;
		this.smoothX = pos.x;
		this.smoothY = pos.height;
		this.smoothZ = pos.y;
		this.smoothHeading = pos.heading;
	}
}
