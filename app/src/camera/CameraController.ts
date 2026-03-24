import * as THREE from 'three';
import type { LocalProjection } from '@/world/osm/LocalProjection';

export type CameraMode = 'cab' | 'chase' | 'orbit' | 'overview';

const CAMERA_MODE_LABELS: Record<CameraMode, string> = {
  cab: 'CAB VIEW',
  chase: 'CHASE CAM',
  orbit: 'ORBIT',
  overview: 'OVERVIEW',
};

const MODE_ORDER: CameraMode[] = ['chase', 'cab', 'orbit', 'overview'];

const CAB_ABOVE_GROUND = 5.5;
const CAB_FORWARD = 15;

const CHASE_DEFAULT_DISTANCE = 60;
const CHASE_DEFAULT_HEIGHT = 25;
const CHASE_DEFAULT_YAW_OFFSET = 0;
const CHASE_MIN_DISTANCE = 15;
const CHASE_MAX_DISTANCE = 300;
const CHASE_MIN_HEIGHT = 5;
const CHASE_MAX_HEIGHT = 200;

const OVERVIEW_HEIGHT = 500;
const OVERVIEW_DISTANCE = 300;

const _camPos = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();

export class CameraController {
  private mode: CameraMode = 'chase';
  private camera: THREE.PerspectiveCamera;
  private projection: LocalProjection;

  private smoothLat = 0;
  private smoothLng = 0;
  private smoothBearing = 0;

  private orbitAngle = 0;
  private orbitRadius = 80;
  private orbitAboveGround = 40;

  private chaseDistance = CHASE_DEFAULT_DISTANCE;
  private chaseHeight = CHASE_DEFAULT_HEIGHT;
  private chaseYawOffset = CHASE_DEFAULT_YAW_OFFSET;

  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private domElement: HTMLElement | null = null;

  private onWheel: ((e: WheelEvent) => void) | null = null;
  private onMouseDown: ((e: MouseEvent) => void) | null = null;
  private onMouseMove: ((e: MouseEvent) => void) | null = null;
  private onMouseUp: ((e: MouseEvent) => void) | null = null;
  private onContextMenu: ((e: Event) => void) | null = null;

  constructor(camera: THREE.PerspectiveCamera, projection: LocalProjection) {
    this.camera = camera;
    this.projection = projection;
  }

  setProjection(projection: LocalProjection): void {
    this.projection = projection;
  }

  attachDOM(domElement: HTMLElement): void {
    this.domElement = domElement;

    this.onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const zoomFactor = 1 + e.deltaY * 0.001;

      if (this.mode === 'overview') {
        this.overviewHeight = THREE.MathUtils.clamp(this.overviewHeight * zoomFactor, 100, 2000);
      } else if (this.mode === 'chase') {
        this.chaseDistance = THREE.MathUtils.clamp(
          this.chaseDistance * zoomFactor,
          CHASE_MIN_DISTANCE,
          CHASE_MAX_DISTANCE,
        );
        this.chaseHeight = THREE.MathUtils.clamp(
          this.chaseHeight * zoomFactor,
          CHASE_MIN_HEIGHT,
          CHASE_MAX_HEIGHT,
        );
      } else if (this.mode === 'orbit') {
        this.orbitRadius = THREE.MathUtils.clamp(this.orbitRadius * zoomFactor, 20, 500);
        this.orbitAboveGround = THREE.MathUtils.clamp(this.orbitAboveGround * zoomFactor, 10, 300);
      }
    };

    this.onMouseDown = (e: MouseEvent) => {
      if (e.button === 0 || e.button === 2) {
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }
    };

    this.onMouseMove = (e: MouseEvent) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      if (this.mode === 'chase') {
        this.chaseYawOffset -= dx * 0.3;
        this.chaseHeight = THREE.MathUtils.clamp(
          this.chaseHeight + dy * 0.5,
          CHASE_MIN_HEIGHT,
          CHASE_MAX_HEIGHT,
        );
      } else if (this.mode === 'orbit') {
        this.orbitAngle -= dx * 0.005;
        this.orbitAboveGround = THREE.MathUtils.clamp(
          this.orbitAboveGround + dy * 0.5,
          10,
          300,
        );
      }
    };

    this.onMouseUp = () => {
      this.isDragging = false;
    };

    this.onContextMenu = (e: Event) => {
      if (this.mode !== 'overview') e.preventDefault();
    };

    domElement.addEventListener('wheel', this.onWheel, { passive: false });
    domElement.addEventListener('mousedown', this.onMouseDown);
    domElement.addEventListener('mousemove', this.onMouseMove);
    domElement.addEventListener('mouseup', this.onMouseUp);
    domElement.addEventListener('contextmenu', this.onContextMenu);
  }

  getMode(): CameraMode {
    return this.mode;
  }

  getModeLabel(): string {
    return CAMERA_MODE_LABELS[this.mode];
  }

  cycleMode(): CameraMode {
    const idx = MODE_ORDER.indexOf(this.mode);
    this.mode = MODE_ORDER[(idx + 1) % MODE_ORDER.length];

    if (this.mode === 'chase') {
      this.chaseDistance = CHASE_DEFAULT_DISTANCE;
      this.chaseHeight = CHASE_DEFAULT_HEIGHT;
      this.chaseYawOffset = CHASE_DEFAULT_YAW_OFFSET;
    }

    return this.mode;
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
  }

  isManagingCamera(): boolean {
    return true;
  }

  update(
    trainLat: number,
    trainLng: number,
    trainBearing: number,
    _direction: number,
    dt: number,
  ): void {
    const lerpFactor = Math.min(1, dt * 4);
    this.smoothLat += (trainLat - this.smoothLat) * lerpFactor;
    this.smoothLng += (trainLng - this.smoothLng) * lerpFactor;

    let bearingDiff = trainBearing - this.smoothBearing;
    if (bearingDiff > 180) bearingDiff -= 360;
    if (bearingDiff < -180) bearingDiff += 360;
    this.smoothBearing += bearingDiff * lerpFactor;
    this.smoothBearing = ((this.smoothBearing % 360) + 360) % 360;

    if (!this.isDragging && Math.abs(this.chaseYawOffset) > 0.1) {
      this.chaseYawOffset *= (1 - dt * 1.5);
    }

    if (this.mode === 'cab') {
      this.updateCabCamera();
    } else if (this.mode === 'chase') {
      this.updateChaseCamera();
    } else if (this.mode === 'orbit') {
      if (!this.isDragging) {
        this.orbitAngle += dt * 0.3;
      }
      this.updateOrbitCamera();
    } else if (this.mode === 'overview') {
      this.updateOverviewCamera();
    }
  }

  private updateCabCamera(): void {
    const bearingRad = this.smoothBearing * Math.PI / 180;
    const fwdLat = this.smoothLat + Math.cos(bearingRad) * CAB_FORWARD / 111319;
    const fwdLng = this.smoothLng + Math.sin(bearingRad) * CAB_FORWARD / (111319 * Math.cos(this.smoothLat * Math.PI / 180));

    this.projection.getPosition(fwdLat, fwdLng, CAB_ABOVE_GROUND, _camPos);

    const lookDist = 200;
    const lookLat = fwdLat + Math.cos(bearingRad) * lookDist / 111319;
    const lookLng = fwdLng + Math.sin(bearingRad) * lookDist / (111319 * Math.cos(fwdLat * Math.PI / 180));
    this.projection.getPosition(lookLat, lookLng, CAB_ABOVE_GROUND - 3, _lookTarget);

    this.camera.position.copy(_camPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(_lookTarget);
  }

  private updateChaseCamera(): void {
    const effectiveBearing = this.smoothBearing + this.chaseYawOffset;
    const bearingRad = effectiveBearing * Math.PI / 180;
    const behindLat = this.smoothLat - Math.cos(bearingRad) * this.chaseDistance / 111319;
    const behindLng = this.smoothLng - Math.sin(bearingRad) * this.chaseDistance / (111319 * Math.cos(this.smoothLat * Math.PI / 180));

    this.projection.getPosition(behindLat, behindLng, this.chaseHeight, _camPos);
    this.projection.getPosition(this.smoothLat, this.smoothLng, 3, _lookTarget);

    this.camera.position.copy(_camPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(_lookTarget);
  }

  private updateOrbitCamera(): void {
    const orbitLat = this.smoothLat + Math.cos(this.orbitAngle) * this.orbitRadius / 111319;
    const orbitLng = this.smoothLng + Math.sin(this.orbitAngle) * this.orbitRadius / (111319 * Math.cos(this.smoothLat * Math.PI / 180));

    this.projection.getPosition(orbitLat, orbitLng, this.orbitAboveGround, _camPos);
    this.projection.getPosition(this.smoothLat, this.smoothLng, 3, _lookTarget);

    this.camera.position.copy(_camPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(_lookTarget);
  }

  private overviewHeight = OVERVIEW_HEIGHT;

  private updateOverviewCamera(): void {
    const bearingRad = this.smoothBearing * Math.PI / 180;
    const offsetDist = OVERVIEW_DISTANCE;
    const behindLat = this.smoothLat - Math.cos(bearingRad) * offsetDist / 111319;
    const behindLng = this.smoothLng - Math.sin(bearingRad) * offsetDist / (111319 * Math.cos(this.smoothLat * Math.PI / 180));

    this.projection.getPosition(behindLat, behindLng, this.overviewHeight, _camPos);
    this.projection.getPosition(this.smoothLat, this.smoothLng, 0, _lookTarget);

    this.camera.position.copy(_camPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(_lookTarget);
  }

  /**
   * Set the camera for overview mode: top-down view over the route center.
   */
  setOverviewPosition(centerLat: number, centerLng: number): void {
    this.projection.getPosition(centerLat, centerLng, OVERVIEW_HEIGHT, _camPos);
    const lookLat = centerLat + 0.001;
    this.projection.getPosition(lookLat, centerLng, 0, _lookTarget);

    this.camera.position.copy(_camPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(_lookTarget);
  }

  resetSmoothing(lat: number, lng: number, brg: number): void {
    this.smoothLat = lat;
    this.smoothLng = lng;
    this.smoothBearing = brg;
  }

  dispose(): void {
    if (this.domElement) {
      if (this.onWheel) this.domElement.removeEventListener('wheel', this.onWheel);
      if (this.onMouseDown) this.domElement.removeEventListener('mousedown', this.onMouseDown);
      if (this.onMouseMove) this.domElement.removeEventListener('mousemove', this.onMouseMove);
      if (this.onMouseUp) this.domElement.removeEventListener('mouseup', this.onMouseUp);
      if (this.onContextMenu) this.domElement.removeEventListener('contextmenu', this.onContextMenu);
    }
  }
}
