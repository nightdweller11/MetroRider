import * as THREE from 'three';
import type { LocalProjection } from '@/world/osm/LocalProjection';

interface TrackBounds {
  minLat: number; maxLat: number;
  minLng: number; maxLng: number;
  minX: number; maxX: number;
  minZ: number; maxZ: number;
  pointCount: number;
}

interface DebugState {
  cameraPos: THREE.Vector3;
  cameraLat: number;
  cameraLng: number;
  trainLat: number;
  trainLng: number;
  trainBearing: number;
  trainPos: THREE.Vector3;
  fps: number;
  cameraMode: string;
  trainSpeed: number;
  trainDist: number;
  worldLoaded: boolean;
  meshCount: number;
  lineName: string;
  stationCount: number;
  trackBounds: TrackBounds | null;
}

interface ClearingStats {
  trackClearedCount: number;
  builtCount: number;
  trackCorridorSegments: number;
  phase3Executed: boolean;
  corridorRadius: number;
  nearMissCount: number;
}

export class DebugOverlay {
  private panel: HTMLElement;
  private coordBar: HTMLElement;
  private visible = false;
  private state: DebugState;
  private clearingStats: ClearingStats;
  private frameCount = 0;
  private fpsAccum = 0;
  private lastFpsUpdate = 0;
  private logThrottle = 0;
  private onKeyDown: (e: KeyboardEvent) => void;
  private projection: LocalProjection | null = null;

  constructor() {
    this.state = {
      cameraPos: new THREE.Vector3(),
      cameraLat: 0, cameraLng: 0,
      trainLat: 0, trainLng: 0, trainBearing: 0,
      trainPos: new THREE.Vector3(),
      fps: 0,
      cameraMode: 'unknown',
      trainSpeed: 0, trainDist: 0,
      worldLoaded: false,
      meshCount: 0,
      lineName: '',
      stationCount: 0,
      trackBounds: null,
    };

    this.clearingStats = {
      trackClearedCount: 0,
      builtCount: 0,
      trackCorridorSegments: 0,
      phase3Executed: false,
      corridorRadius: 0,
      nearMissCount: 0,
    };

    this.coordBar = document.createElement('div');
    this.coordBar.id = 'debug-coord-bar';
    this.coordBar.style.cssText = `
      position: fixed; bottom: 4px; left: 4px; z-index: 9998;
      background: rgba(0,0,0,0.7); color: #0f0; font-family: 'Courier New', monospace;
      font-size: 11px; padding: 3px 8px; border-radius: 4px;
      pointer-events: none; white-space: pre;
    `;
    document.body.appendChild(this.coordBar);

    this.panel = document.createElement('div');
    this.panel.id = 'debug-overlay';
    this.panel.style.cssText = `
      position: fixed; top: 8px; left: 8px; z-index: 9999;
      background: rgba(0,0,0,0.85); color: #0f0; font-family: 'Courier New', monospace;
      font-size: 11px; padding: 10px 14px; border-radius: 6px;
      border: 1px solid rgba(0,255,0,0.3); pointer-events: none;
      display: none; white-space: pre; line-height: 1.5;
      max-height: 90vh; overflow-y: auto;
    `;
    document.body.appendChild(this.panel);

    this.onKeyDown = (e: KeyboardEvent) => {
      if (e.key === '`' || e.key === '~') {
        this.toggle();
      }
    };
    document.addEventListener('keydown', this.onKeyDown);
  }

  setProjection(projection: LocalProjection): void {
    this.projection = projection;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.panel.style.display = this.visible ? 'block' : 'none';
    console.log(`[Debug] overlay ${this.visible ? 'ON' : 'OFF'}`);
  }

  updateCamera(camera: THREE.PerspectiveCamera): void {
    this.state.cameraPos.copy(camera.position);

    if (this.projection) {
      const latLng = this.projection.localToLatLng(camera.position.x, camera.position.z);
      this.state.cameraLat = latLng.lat;
      this.state.cameraLng = latLng.lng;
    }
  }

  updateTrain(lat: number, lng: number, bearing: number, worldPos: THREE.Vector3, speed: number, dist: number): void {
    this.state.trainLat = lat;
    this.state.trainLng = lng;
    this.state.trainBearing = bearing;
    this.state.trainPos.copy(worldPos);
    this.state.trainSpeed = speed;
    this.state.trainDist = dist;
  }

  updateWorld(loaded: boolean, scene?: THREE.Scene): void {
    this.state.worldLoaded = loaded;
    if (scene) {
      let count = 0;
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) count++;
      });
      this.state.meshCount = count;
    }
  }

  updateLineInfo(
    lineName: string,
    stationCount: number,
    trackPoints: [number, number][],
    projection: LocalProjection,
  ): void {
    this.state.lineName = lineName;
    this.state.stationCount = stationCount;

    if (trackPoints.length > 0) {
      let minLat = Infinity, maxLat = -Infinity;
      let minLng = Infinity, maxLng = -Infinity;
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;

      for (const [lng, lat] of trackPoints) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        const local = projection.projectToLocal(lat, lng);
        if (local.x < minX) minX = local.x;
        if (local.x > maxX) maxX = local.x;
        if (local.z < minZ) minZ = local.z;
        if (local.z > maxZ) maxZ = local.z;
      }

      this.state.trackBounds = {
        minLat, maxLat, minLng, maxLng,
        minX, maxX, minZ, maxZ,
        pointCount: trackPoints.length,
      };
    }
  }

  updateClearingStats(stats: {
    trackClearedCount: number;
    builtCount: number;
    trackCorridorSegments: number;
    phase3Executed: boolean;
    corridorRadius: number;
    nearMissCount: number;
  }): void {
    this.clearingStats = { ...stats };
  }

  updateMeta(cameraMode: string): void {
    this.state.cameraMode = cameraMode;
  }

  updateFrame(dt: number): void {
    this.frameCount++;
    this.fpsAccum += dt;

    const now = performance.now();
    if (now - this.lastFpsUpdate > 500) {
      this.state.fps = this.fpsAccum > 0 ? Math.round(this.frameCount / this.fpsAccum) : 0;
      this.frameCount = 0;
      this.fpsAccum = 0;
      this.lastFpsUpdate = now;
    }

    this.logThrottle += dt;
    if (this.logThrottle >= 2.0) {
      this.logThrottle = 0;
      this.logState();
    }

    this.renderCoordBar();
    if (this.visible) {
      this.render();
    }
  }

  private logState(): void {
    const s = this.state;
    console.log(
      `[Debug] cam=(${s.cameraLat.toFixed(5)}, ${s.cameraLng.toFixed(5)}, pos=${s.cameraPos.x.toFixed(0)},${s.cameraPos.y.toFixed(0)},${s.cameraPos.z.toFixed(0)}) ` +
      `train=(${s.trainLat.toFixed(5)}, ${s.trainLng.toFixed(5)}, brg=${s.trainBearing.toFixed(1)}) ` +
      `speed=${(s.trainSpeed * 3.6).toFixed(0)}km/h ` +
      `mode=${s.cameraMode} fps=${s.fps}`,
    );
  }

  private renderCoordBar(): void {
    const s = this.state;
    this.coordBar.textContent =
      `Train: ${s.trainLat.toFixed(6)}, ${s.trainLng.toFixed(6)} | ` +
      `Local: (${s.trainPos.x.toFixed(0)}, ${s.trainPos.z.toFixed(0)}) | ` +
      `Brg: ${s.trainBearing.toFixed(0)}° | ` +
      `${(s.trainSpeed * 3.6).toFixed(0)} km/h | ` +
      `FPS: ${s.fps} | [~] debug`;
  }

  private render(): void {
    const s = this.state;
    const c = this.clearingStats;
    const tb = s.trackBounds;

    let trackBoundsStr = '  (no data)\n';
    if (tb) {
      trackBoundsStr =
        `  pts:     ${tb.pointCount}\n` +
        `  lat:     ${tb.minLat.toFixed(5)} → ${tb.maxLat.toFixed(5)}\n` +
        `  lng:     ${tb.minLng.toFixed(5)} → ${tb.maxLng.toFixed(5)}\n` +
        `  localX:  ${tb.minX.toFixed(0)} → ${tb.maxX.toFixed(0)}\n` +
        `  localZ:  ${tb.minZ.toFixed(0)} → ${tb.maxZ.toFixed(0)}\n`;
    }

    this.panel.textContent =
      `--- MetroRider Debug ---\n` +
      `FPS: ${s.fps}\n` +
      `\n` +
      `CAMERA\n` +
      `  lat/lng: ${s.cameraLat.toFixed(6)}, ${s.cameraLng.toFixed(6)}\n` +
      `  local:   (${s.cameraPos.x.toFixed(1)}, ${s.cameraPos.y.toFixed(1)}, ${s.cameraPos.z.toFixed(1)})\n` +
      `  mode:    ${s.cameraMode}\n` +
      `\n` +
      `TRAIN\n` +
      `  lat/lng: ${s.trainLat.toFixed(6)}, ${s.trainLng.toFixed(6)}\n` +
      `  bearing: ${s.trainBearing.toFixed(1)}\u00b0\n` +
      `  local:   (${s.trainPos.x.toFixed(1)}, ${s.trainPos.y.toFixed(1)}, ${s.trainPos.z.toFixed(1)})\n` +
      `  speed:   ${(s.trainSpeed * 3.6).toFixed(0)} km/h\n` +
      `  dist:    ${s.trainDist.toFixed(1)}m along track\n` +
      `\n` +
      `LINE: ${s.lineName || '(none)'}\n` +
      `  stations: ${s.stationCount}\n` +
      `\n` +
      `TRACK BOUNDS\n` +
      trackBoundsStr +
      `\n` +
      `WORLD\n` +
      `  loaded:  ${s.worldLoaded ? 'YES' : 'NO'}\n` +
      `  meshes:  ${s.meshCount}\n` +
      `\n` +
      `CORRIDOR CLEARING\n` +
      `  radius:        ${c.corridorRadius}m\n` +
      `  track segs:    ${c.trackCorridorSegments}\n` +
      `  track-cleared: ${c.trackClearedCount}\n` +
      `  near-miss:     ${c.nearMissCount}\n` +
      `  buildings kept: ${c.builtCount}\n` +
      `  Phase 3 ran:   ${c.phase3Executed ? 'YES' : 'NO'}\n` +
      `\n` +
      `[~] overlay  [V] corridor viz`;
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    this.panel.remove();
    this.coordBar.remove();
  }
}
