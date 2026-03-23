import * as THREE from 'three';
import { WorldBuilder } from '@/world/osm/WorldBuilder';
import { LocalProjection } from '@/world/osm/LocalProjection';
import { TrainConsist } from '@/vehicles/TrainConsist';
import { CameraController } from '@/camera/CameraController';
import { StationManager } from '@/gameplay/StationManager';
import { PassengerSystem } from '@/gameplay/PassengerSystem';
import { HUD } from '@/ui/HUD';
import { InputHandler } from '@/ui/InputHandler';
import { DebugOverlay } from '@/debug/DebugOverlay';
import { parseMetroMap, type ParsedLine } from '@/data/RouteParser';
import type { MetroMapData } from '@/data/RouteParser';
import { buildTrackData, buildTrackDataFromPolyline, buildTrackMesh, buildStationMarker, buildTrainTracks, type TrackData } from '@/world/TrackBuilder';
import { bearing } from '@/core/CoordinateSystem';
import { routeLineOnRailways, buildCorridorSegments, CORRIDOR_RADIUS } from '@/world/osm/TrackRouter';
import type { OSMData } from '@/world/osm/OSMFetcher';

const MAX_SPEED = 55;  // m/s (~200 km/h)
const ACCEL = 5.0;
const BRAKE_FORCE = 6.0;
const FRICTION = 0.0;

interface LineState {
  parsed: ParsedLine;
  track: TrackData;
  trackMesh: THREE.Line;
  trackRails: THREE.Group | null;
  stationMarkers: THREE.Object3D[];
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private worldBuilder: WorldBuilder;
  private projection: LocalProjection;
  private cameraController: CameraController;
  private stationManager: StationManager;
  private passengerSystem: PassengerSystem;
  private hud: HUD;
  private input: InputHandler;
  private train: TrainConsist;
  private debug: DebugOverlay;

  private sun: THREE.DirectionalLight;

  private lines: LineState[] = [];
  private currentLineIdx = 0;
  private trainDist = 0;
  private trainSpeed = 0;
  private direction = 1;
  private doorsOpen = false;
  private lastTimestamp = 0;
  private running = false;
  private lastTrainPos = { lng: 0, lat: 0, bearing: 0 };
  private corridorDebugMesh: THREE.Mesh | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87CEEB);
    this.scene.fog = new THREE.Fog(0x87CEEB, 800, 3000);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.5,
      5000,
    );
    this.camera.position.set(0, 200, 300);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0x87CEEB, 0x8a9a6a, 0.4);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight(0xfff5e0, 1.8);
    this.sun.position.set(200, 400, 200);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.width = 2048;
    this.sun.shadow.mapSize.height = 2048;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 2000;
    this.sun.shadow.camera.left = -500;
    this.sun.shadow.camera.right = 500;
    this.sun.shadow.camera.top = 500;
    this.sun.shadow.camera.bottom = -500;
    this.sun.shadow.bias = -0.001;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Default projection centered at 0,0; will be updated when map loads
    this.projection = new LocalProjection(0, 0);

    this.worldBuilder = new WorldBuilder(this.scene, 0, 0);
    this.cameraController = new CameraController(this.camera, this.projection);
    this.cameraController.attachDOM(canvas);
    this.stationManager = new StationManager();
    this.passengerSystem = new PassengerSystem(this.scene, this.projection);
    this.hud = new HUD();
    this.input = new InputHandler();
    this.train = new TrainConsist('#e61e25', 1, this.projection);
    this.debug = new DebugOverlay();

    this.scene.add(this.train.group);

    this.stationManager.setArrivalCallback((station, index, total) => {
      this.hud.showToast(station.name, `Station ${index + 1} of ${total}`);
      const { boarded, alighted } = this.passengerSystem.handleStationStop(station);
      this.hud.setPassengerCount(this.passengerSystem.getOnboardCount());
      console.log(`[Game] Station ${station.name}: ${alighted} alighted, ${boarded} boarded`);
    });

    this.hud.setCallbacks({
      onLineSelect: (idx) => this.selectLine(idx),
      onCameraToggle: () => {
        this.cameraController.cycleMode();
        this.hud.setCameraLabel(this.cameraController.getModeLabel());
      },
      onDoorsToggle: () => this.toggleDoors(),
    });

    window.addEventListener('resize', () => this.onResize());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'v' || e.key === 'V') {
        if (this.corridorDebugMesh) {
          this.corridorDebugMesh.visible = !this.corridorDebugMesh.visible;
          console.log(`[Game] Corridor debug mesh: ${this.corridorDebugMesh.visible ? 'ON' : 'OFF'}`);
        }
      }
    });

    this.hud.setCameraLabel(this.cameraController.getModeLabel());

    console.log('[Game] initialized (OSM world)');
  }

  async loadMap(mapData: MetroMapData): Promise<void> {
    const parsed = parseMetroMap(mapData);
    console.log(`[Game] loading map with ${parsed.length} lines`);

    // Gather all points for overall bbox, real stations for OSM area
    const allPoints: { lat: number; lng: number }[] = [];
    for (const line of parsed) {
      for (const pt of line.allPoints) {
        allPoints.push({ lat: pt.lat, lng: pt.lng });
      }
    }

    // Build world using the full bbox center
    this.worldBuilder.dispose();
    const fullBbox = LocalProjection.bboxFromStations(allPoints, 200);

    // Check if the map is too large for a single OSM load
    const latExtentKm = (fullBbox.north - fullBbox.south) * 111.319;
    const lngExtentKm = (fullBbox.east - fullBbox.west) * 111.319 * Math.cos(fullBbox.centerLat * Math.PI / 180);
    const isLargeMap = latExtentKm > 20 || lngExtentKm > 20;

    if (isLargeMap) {
      console.log(`[Game] Large map detected: ${latExtentKm.toFixed(1)}km x ${lngExtentKm.toFixed(1)}km. Will load OSM for first line only.`);
    }

    // For large maps, center on the first line; otherwise center on overall bbox
    let osmStations: { lat: number; lng: number }[];
    let osmMargin: number;
    let centerLat: number;
    let centerLng: number;

    if (isLargeMap) {
      const firstLine = parsed[0];
      osmStations = firstLine.allPoints.map(s => ({ lat: s.lat, lng: s.lng }));
      osmMargin = 300;
      const firstBbox = LocalProjection.bboxFromStations(osmStations, osmMargin);
      centerLat = firstBbox.centerLat;
      centerLng = firstBbox.centerLng;
    } else {
      osmStations = allPoints;
      osmMargin = 500;
      centerLat = fullBbox.centerLat;
      centerLng = fullBbox.centerLng;
    }

    this.worldBuilder = new WorldBuilder(this.scene, centerLat, centerLng);
    this.projection = this.worldBuilder.projection;

    // Update all subsystems with new projection
    this.cameraController.setProjection(this.projection);
    this.train.setProjection(this.projection);
    this.passengerSystem.setProjection(this.projection);
    this.debug.setProjection(this.projection);

    this.hud.showToast('Loading world...', 'Fetching OpenStreetMap data');

    // Phase 1: Build track data - use waypoints as polyline when available
    const preRouteTrackData: { line: ParsedLine; track: TrackData }[] = [];
    for (const line of parsed) {
      let track: TrackData;
      const hasWaypoints = line.allPoints.length > line.stations.length;

      if (hasWaypoints) {
        const polyline: [number, number][] = line.allPoints.map(p => [p.lng, p.lat]);
        track = buildTrackDataFromPolyline(polyline, line.stations);
        console.log(`[Game] Line "${line.name}": waypoint path (${polyline.length} pts, ${line.stations.length} real stations)`);
      } else {
        track = buildTrackData(line.stations);
      }
      preRouteTrackData.push({ line, track });
    }

    // Build corridor segments from pre-routed tracks for building filtering
    const allCorridorSegments: { x1: number; z1: number; x2: number; z2: number }[] = [];
    for (const { track } of preRouteTrackData) {
      const localPoints = track.spline.points.map(([lng, lat]) =>
        this.projection.projectToLocal(lat, lng),
      );
      allCorridorSegments.push(...buildCorridorSegments(localPoints));
    }

    console.log(`[Game] Corridor segments: ${allCorridorSegments.length} (radius=${CORRIDOR_RADIUS}m)`);

    let osmData: OSMData | null = null;
    try {
      osmData = await this.worldBuilder.loadArea(osmStations, osmMargin, (msg) => {
        console.log(`[Game] World: ${msg}`);
      }, allCorridorSegments);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Game] Failed to load OSM world: ${msg}`);
      this.hud.showPersistentError(`Failed to load OSM world: ${msg}`);
    }

    // Clear old track geometry
    for (const ls of this.lines) {
      this.scene.remove(ls.trackMesh);
      ls.trackMesh.geometry.dispose();
      (ls.trackMesh.material as THREE.Material).dispose();
      if (ls.trackRails) this.scene.remove(ls.trackRails);
      for (const m of ls.stationMarkers) {
        this.scene.remove(m);
        m.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) child.material.forEach(mat => mat.dispose());
              else (child.material as THREE.Material).dispose();
            }
          }
        });
      }
    }
    this.lines = [];

    // Phase 2: Build final tracks - use waypoints or OSM routing
    for (const line of parsed) {
      let track: TrackData;
      const hasWaypoints = line.allPoints.length > line.stations.length;

      if (hasWaypoints) {
        const polyline: [number, number][] = line.allPoints.map(p => [p.lng, p.lat]);
        track = buildTrackDataFromPolyline(polyline, line.stations);
        console.log(`[Game] Line "${line.name}": using waypoint path (${polyline.length} pts, ${line.stations.length} real stations)`);
      } else if (osmData && osmData.railways && osmData.railways.length > 0) {
        const routeResult = routeLineOnRailways(
          line.stations.map(s => ({ lat: s.lat, lng: s.lng })),
          osmData,
        );
        if (routeResult.usedOSM) {
          track = buildTrackDataFromPolyline(routeResult.polyline, line.stations);
          console.log(`[Game] Line "${line.name}": using OSM-routed track (${routeResult.polyline.length} points)`);
        } else {
          track = buildTrackData(line.stations);
          console.log(`[Game] Line "${line.name}": using Catmull-Rom fallback`);
        }
      } else {
        track = buildTrackData(line.stations);
        console.log(`[Game] Line "${line.name}": no railway data, using Catmull-Rom`);
      }

      const trackMesh = buildTrackMesh(track, line.color, this.projection);
      this.scene.add(trackMesh);

      // Station markers - ONLY for real stations (not waypoints)
      const stationMarkers: THREE.Object3D[] = [];
      for (let si = 0; si < line.stations.length; si++) {
        const st = line.stations[si];
        let trackBearing = 0;
        const stIdx = track.spline.stationIndices[si] ?? 0;
        const pts = track.spline.points;
        if (stIdx < pts.length - 1) {
          trackBearing = bearing(pts[stIdx][1], pts[stIdx][0], pts[stIdx + 1][1], pts[stIdx + 1][0]);
        } else if (stIdx > 0) {
          trackBearing = bearing(pts[stIdx - 1][1], pts[stIdx - 1][0], pts[stIdx][1], pts[stIdx][0]);
        }
        const marker = buildStationMarker(st, line.color, this.projection, trackBearing);
        this.scene.add(marker);
        stationMarkers.push(marker);
      }

      // 3D rails are built on-demand in selectLine() to avoid overwhelming GPU
      this.lines.push({ parsed: line, track, trackMesh, trackRails: null, stationMarkers });
    }

    // Phase 3: Rebuild buildings using FINAL routed track corridor segments
    if (osmData) {
      try {
        const finalCorridorSegments: { x1: number; z1: number; x2: number; z2: number }[] = [];
        for (const ls of this.lines) {
          const localPoints = ls.track.spline.points.map(([lng, lat]) =>
            this.projection.projectToLocal(lat, lng),
          );
          finalCorridorSegments.push(...buildCorridorSegments(localPoints));

          const first = ls.track.spline.points[0];
          const last = ls.track.spline.points[ls.track.spline.points.length - 1];
          const firstLocal = localPoints[0];
          const lastLocal = localPoints[localPoints.length - 1];
          console.log(`[Game] Line "${ls.parsed.name}" track: ${ls.track.spline.points.length} pts, first=(${first[1].toFixed(5)},${first[0].toFixed(5)}) local=(${firstLocal.x.toFixed(1)},${firstLocal.z.toFixed(1)}), last=(${last[1].toFixed(5)},${last[0].toFixed(5)}) local=(${lastLocal.x.toFixed(1)},${lastLocal.z.toFixed(1)})`);
        }
        console.log(`[Game] Phase 3: rebuilding buildings with ${finalCorridorSegments.length} final corridor segments (radius=${CORRIDOR_RADIUS}m)`);
        this.worldBuilder.rebuildBuildings(osmData, finalCorridorSegments);
        console.log('[Game] Phase 3: buildings rebuilt successfully');

        this.buildCorridorDebugMesh(finalCorridorSegments);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Game] Phase 3 FAILED: ${msg}`, err);
      }
    } else {
      console.error('[Game] Phase 3 SKIPPED: osmData is null');
    }

    this.hud.buildLineSelector(parsed);
    this.selectLine(0);
    this.hud.show();
  }

  selectLine(idx: number): void {
    if (idx < 0 || idx >= this.lines.length) {
      console.error(`[Game] Invalid line index: ${idx}`);
      return;
    }

    // Dispose previous line's 3D rails
    const prevLs = this.lines[this.currentLineIdx];
    if (prevLs?.trackRails) {
      this.scene.remove(prevLs.trackRails);
      prevLs.trackRails.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh) {
          child.geometry?.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else (child.material as THREE.Material).dispose();
          }
        }
      });
      prevLs.trackRails = null;
    }

    this.currentLineIdx = idx;
    const ls = this.lines[idx];
    const stations = ls.parsed.stations;

    if (stations.length < 2) {
      console.error(`[Game] Line ${idx} has fewer than 2 stations`);
      return;
    }

    // Build 3D rails for the selected line on demand
    if (!ls.trackRails) {
      ls.trackRails = buildTrainTracks(ls.track, this.projection);
      this.scene.add(ls.trackRails);
      console.log(`[Game] Built 3D rails for line "${ls.parsed.name}" (${ls.track.spline.points.length} segments)`);
    }

    this.trainDist = ls.track.stationDists[0] + 60;
    this.trainSpeed = 0;
    this.direction = 1;
    this.doorsOpen = false;
    this.stationManager.reset();

    this.train.rebuild(ls.parsed.color, this.direction);
    this.passengerSystem.populateStations(stations, ls.parsed.color);
    this.hud.setPassengerCount(this.passengerSystem.getOnboardCount());

    const terminalName = stations[stations.length - 1].name;
    this.hud.setActiveLine(idx, ls.parsed, terminalName);

    const firstSt = stations[0];
    const secondSt = stations[1];
    const brg = bearing(firstSt.lat, firstSt.lng, secondSt.lat, secondSt.lng);
    this.cameraController.resetSmoothing(firstSt.lat, firstSt.lng, brg);

    // Move sun shadow camera to follow the route center
    const midStation = stations[Math.floor(stations.length / 2)];
    const midLocal = this.projection.projectToLocal(midStation.lat, midStation.lng);
    this.sun.position.set(midLocal.x + 200, 400, midLocal.z + 200);
    this.sun.target.position.set(midLocal.x, 0, midLocal.z);
    this.sun.target.updateMatrixWorld();

    this.debug.updateLineInfo(
      ls.parsed.name,
      stations.length,
      ls.track.spline.points,
      this.projection,
    );

    this.hud.showToast(
      ls.parsed.name,
      `${stations[0].name} \u2192 ${stations[stations.length - 1].name}`,
    );

    console.log(`[Game] selected line ${idx}: ${ls.parsed.name}`);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimestamp = performance.now();
    console.log('[Game] render loop started');
    requestAnimationFrame((t) => this.loop(t));
  }

  stop(): void {
    this.running = false;
  }

  private loop(timestamp: number): void {
    if (!this.running) return;

    const dt = Math.min((timestamp - this.lastTimestamp) / 1000, 0.05);
    this.lastTimestamp = timestamp;

    try {
      this.processInput(dt);
      this.updatePhysics(dt);
      this.updateTrain();
      this.updateStations(dt);
      this.updateCamera(dt);
      this.updateDebug(dt);
      this.render();
      this.input.endFrame();
    } catch (err) {
      console.error('[Game] loop error:', err);
    }

    requestAnimationFrame((t) => this.loop(t));
  }

  private processInput(dt: number): void {
    if (this.input.wasJustPressed('camera')) {
      this.cameraController.cycleMode();
      this.hud.setCameraLabel(this.cameraController.getModeLabel());
    }

    if (this.input.wasJustPressed('doors')) {
      this.toggleDoors();
    }

    if (this.input.wasJustPressed('reverse')) {
      this.direction *= -1;
      const ls = this.lines[this.currentLineIdx];
      if (ls) {
        const stations = ls.parsed.stations;
        const terminalName = this.direction === 1
          ? stations[stations.length - 1].name
          : stations[0].name;
        this.hud.setDirection(terminalName);
        this.train.rebuild(ls.parsed.color, this.direction);
      }
    }

    const lineActions = [
      'line1', 'line2', 'line3', 'line4', 'line5',
      'line6', 'line7', 'line8', 'line9',
    ] as const;
    for (let i = 0; i < lineActions.length; i++) {
      if (this.input.wasJustPressed(lineActions[i]) && i < this.lines.length) {
        this.selectLine(i);
      }
    }

    this.hud.updateControls(
      this.input.isHeld('accelerate'),
      this.input.isHeld('brake') || this.input.isHeld('emergency'),
      this.doorsOpen,
    );
  }

  private updatePhysics(dt: number): void {
    const ls = this.lines[this.currentLineIdx];
    if (!ls) return;

    const throttle = this.input.isHeld('accelerate') && !this.doorsOpen;
    const braking = this.input.isHeld('brake');
    const emergency = this.input.isHeld('emergency');

    if (throttle) {
      this.trainSpeed += ACCEL * dt;
    } else if (emergency) {
      this.trainSpeed -= BRAKE_FORCE * 2 * dt;
    } else if (braking) {
      this.trainSpeed -= BRAKE_FORCE * dt;
    } else {
      this.trainSpeed -= FRICTION * dt;
    }

    this.trainSpeed = Math.max(0, Math.min(MAX_SPEED, this.trainSpeed));

    if (this.doorsOpen && this.trainSpeed > 0.1) {
      this.trainSpeed = 0;
    }

    this.trainDist += this.trainSpeed * dt * this.direction;
    this.trainDist = Math.max(0, Math.min(ls.track.totalLength, this.trainDist));

    if (this.trainDist <= 5 || this.trainDist >= ls.track.totalLength - 5) {
      this.trainSpeed = 0;
    }
  }

  private updateTrain(): void {
    const ls = this.lines[this.currentLineIdx];
    if (!ls) return;

    this.lastTrainPos = this.train.updatePosition(ls.track, this.trainDist, this.direction);
    this.hud.updateSpeed(this.trainSpeed, ls.parsed.color);
  }

  private updateStations(dt: number): void {
    const ls = this.lines[this.currentLineIdx];
    if (!ls) return;

    const state = this.stationManager.update(
      ls.track,
      ls.parsed.stations,
      this.trainDist,
      this.trainSpeed,
      this.direction,
    );

    this.hud.updateStation(state.stationName, state.nextStationDist, state.arriving);
  }

  private updateCamera(dt: number): void {
    if (!this.lines[this.currentLineIdx]) return;

    this.cameraController.update(
      this.lastTrainPos.lat,
      this.lastTrainPos.lng,
      this.lastTrainPos.bearing,
      this.direction,
      dt,
    );
  }

  private updateDebug(dt: number): void {
    this.debug.updateCamera(this.camera);
    this.debug.updateTrain(
      this.lastTrainPos.lat, this.lastTrainPos.lng, this.lastTrainPos.bearing,
      this.train.getLeadCarWorldPos(),
      this.trainSpeed, this.trainDist,
    );
    this.debug.updateWorld(this.worldBuilder.isLoaded(), this.scene);
    this.debug.updateMeta(this.cameraController.getModeLabel());

    const clearStats = this.worldBuilder.getClearingStats();
    if (clearStats) {
      this.debug.updateClearingStats(clearStats);
    }

    this.debug.updateFrame(dt);
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private toggleDoors(): void {
    if (this.trainSpeed < 0.5) {
      this.doorsOpen = !this.doorsOpen;
    }
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private buildCorridorDebugMesh(
    segments: { x1: number; z1: number; x2: number; z2: number }[],
  ): void {
    if (this.corridorDebugMesh) {
      this.scene.remove(this.corridorDebugMesh);
      this.corridorDebugMesh.geometry.dispose();
      (this.corridorDebugMesh.material as THREE.Material).dispose();
    }

    const vertices: number[] = [];
    const radius = CORRIDOR_RADIUS;

    for (const seg of segments) {
      const dx = seg.x2 - seg.x1;
      const dz = seg.z2 - seg.z1;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.001) continue;

      const nx = -dz / len * radius;
      const nz = dx / len * radius;
      const y = 1.0;

      vertices.push(
        seg.x1 + nx, y, seg.z1 + nz,
        seg.x1 - nx, y, seg.z1 - nz,
        seg.x2 + nx, y, seg.z2 + nz,
        seg.x2 + nx, y, seg.z2 + nz,
        seg.x1 - nx, y, seg.z1 - nz,
        seg.x2 - nx, y, seg.z2 - nz,
      );
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

    const mat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.corridorDebugMesh = new THREE.Mesh(geom, mat);
    this.corridorDebugMesh.name = 'corridor-debug';
    this.corridorDebugMesh.renderOrder = 50;
    this.corridorDebugMesh.visible = false;
    this.scene.add(this.corridorDebugMesh);
    console.log(`[Game] Corridor debug mesh created (${segments.length} segments, ${radius}m radius). Press 'V' to toggle.`);
  }

  dispose(): void {
    this.stop();
    if (this.corridorDebugMesh) {
      this.scene.remove(this.corridorDebugMesh);
      this.corridorDebugMesh.geometry.dispose();
      (this.corridorDebugMesh.material as THREE.Material).dispose();
    }
    this.worldBuilder.dispose();
    this.input.dispose();
    this.passengerSystem.dispose();
    this.debug.dispose();
    this.cameraController.dispose();
    this.renderer.dispose();
  }
}
