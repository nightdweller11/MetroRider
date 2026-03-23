import * as THREE from 'three';
import type { OSMData, OSMElement, OSMNode, OSMWay } from './OSMFetcher';
import { LocalProjection } from './LocalProjection';
import { generateBuildings, type BuildingClearingStats } from './BuildingGenerator';
import { generateRoads } from './RoadGenerator';
import { generateVegetation } from './VegetationGenerator';
import { generateGroundPlane } from './GroundPlane';
import { generateStreetLabels } from './StreetLabelGenerator';
import {
  TILE_SIZE_DEG,
  LOAD_RADIUS,
  UNLOAD_RADIUS,
  UPDATE_INTERVAL_MS,
  tileCoord,
  tileBbox,
  tileKey,
} from './tileConfig';

type CorridorSegment = { x1: number; z1: number; x2: number; z2: number };

interface TileAPIResponse {
  tileX: number;
  tileY: number;
  bbox: { south: number; west: number; north: number; east: number };
  data: OSMElement[];
  cachedAt: number;
  error?: string;
}

export interface LoadedTile {
  tileX: number;
  tileY: number;
  group: THREE.Group;
  osmData: OSMData;
  loadedAt: number;
}

export interface TileManagerStats {
  loadedCount: number;
  queuedCount: number;
  lastUpdateMs: number;
  currentTile: { x: number; y: number } | null;
}

const enum Priority {
  URGENT = 0,
  NORMAL = 1,
  PREWARM = 2,
}

interface QueueEntry {
  x: number;
  y: number;
  priority: Priority;
}

const MAX_TILE_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

function parseOSMElements(elements: OSMElement[]): OSMData {
  const nodeMap = new Map<number, OSMNode>();
  const buildings: OSMWay[] = [];
  const highways: OSMWay[] = [];
  const railways: OSMWay[] = [];
  const trees: OSMNode[] = [];
  const treeRows: OSMWay[] = [];
  const parks: OSMWay[] = [];
  const water: OSMWay[] = [];
  const benches: OSMNode[] = [];
  const streetLamps: OSMNode[] = [];
  const trafficSignals: OSMNode[] = [];

  for (const el of elements) {
    if (el.type === 'node') {
      nodeMap.set(el.id, el);
      if (!el.tags) continue;
      if (el.tags['natural'] === 'tree') trees.push(el);
      if (el.tags['amenity'] === 'bench') benches.push(el);
      if (el.tags['highway'] === 'street_lamp') streetLamps.push(el);
      if (el.tags['highway'] === 'traffic_signals') trafficSignals.push(el);
    } else if (el.type === 'way') {
      if (!el.tags) continue;
      if (el.tags['building']) buildings.push(el);
      if (el.tags['highway']) highways.push(el);
      if (el.tags['railway']) railways.push(el);
      if (el.tags['natural'] === 'tree_row') treeRows.push(el);
      if (el.tags['natural'] === 'water') water.push(el);
      if (el.tags['waterway']) water.push(el);
      if (
        el.tags['leisure'] === 'park' ||
        el.tags['leisure'] === 'garden' ||
        el.tags['landuse'] === 'grass'
      ) {
        parks.push(el);
      }
    }
  }

  return { nodeMap, buildings, highways, railways, trees, treeRows, parks, water, benches, streetLamps, trafficSignals };
}

export class TileManager {
  private scene: THREE.Scene;
  readonly projection: LocalProjection;
  private worldGroup: THREE.Group;
  private loadedTiles = new Map<string, LoadedTile>();
  private inFlightKeys = new Set<string>();
  private failCounts = new Map<string, number>();
  private lastUpdateTime = 0;
  private lastTileX = NaN;
  private lastTileY = NaN;
  private corridorSegments: CorridorSegment[] = [];
  private disposed = false;
  private apiBase = '/api/tiles';

  // Priority queue: sorted by priority then distance
  private queue: QueueEntry[] = [];
  private maxConcurrent = 6;
  private activeWorkers = 0;
  private workerRunning = false;

  constructor(scene: THREE.Scene, centerLat: number, centerLng: number) {
    this.scene = scene;
    this.projection = new LocalProjection(centerLat, centerLng);
    this.worldGroup = new THREE.Group();
    this.worldGroup.name = 'osm-world';
    this.scene.add(this.worldGroup);
  }

  setCorridorSegments(segments: CorridorSegment[]): void {
    this.corridorSegments = segments;
  }

  getStats(): TileManagerStats {
    return {
      loadedCount: this.loadedTiles.size,
      queuedCount: this.queue.length + this.inFlightKeys.size,
      lastUpdateMs: this.lastUpdateTime,
      currentTile: isNaN(this.lastTileX) ? null : { x: this.lastTileX, y: this.lastTileY },
    };
  }

  getClearingStats(): BuildingClearingStats | null {
    for (const tile of this.loadedTiles.values()) {
      const buildingsGroup = tile.group.children.find(c => c.name === 'buildings');
      if (buildingsGroup) {
        return (buildingsGroup as any).__clearingStats ?? null;
      }
    }
    return null;
  }

  isLoaded(): boolean {
    return this.loadedTiles.size > 0;
  }

  isLoading(): boolean {
    return this.queue.length > 0 || this.inFlightKeys.size > 0;
  }

  /**
   * Called when switching to a new line. Drops all pending
   * lower-priority work and forces immediate loading around the
   * given location.
   */
  resetForLineSwitch(lat: number, lng: number): void {
    if (this.disposed) return;

    const { tileX, tileY } = tileCoord(lat, lng);
    console.log(`[TileManager] Line switch -> flush queue (had ${this.queue.length}), centre tile (${tileX}, ${tileY})`);

    this.queue = [];
    this.lastTileX = tileX;
    this.lastTileY = tileY;
    this.lastUpdateTime = 0;

    this.update(lat, lng);
  }

  // ── Main game-loop entry point ──────────────────────────────────────

  update(lat: number, lng: number): void {
    if (this.disposed) return;

    const now = Date.now();
    const { tileX, tileY } = tileCoord(lat, lng);

    const tileChanged = tileX !== this.lastTileX || tileY !== this.lastTileY;
    const intervalElapsed = (now - this.lastUpdateTime) >= UPDATE_INTERVAL_MS;

    if (!tileChanged && !intervalElapsed) return;

    if (tileChanged) {
      console.log(`[TileManager] Train tile (${tileX}, ${tileY})`);
    }

    this.lastTileX = tileX;
    this.lastTileY = tileY;
    this.lastUpdateTime = now;

    // Enqueue needed tiles with URGENT priority
    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      for (let dy = -LOAD_RADIUS; dy <= LOAD_RADIUS; dy++) {
        const dist = Math.abs(dx) + Math.abs(dy);
        this.enqueue(tileX + dx, tileY + dy, dist <= 2 ? Priority.URGENT : Priority.NORMAL);
      }
    }

    // Re-sort the queue every update so that tiles closest to the
    // *current* train position always win regardless of when they
    // were originally enqueued.
    this.resortQueue();

    // Unload far-away tiles
    const toUnload: string[] = [];
    for (const [key, tile] of this.loadedTiles) {
      const dx = Math.abs(tile.tileX - tileX);
      const dy = Math.abs(tile.tileY - tileY);
      if (dx > UNLOAD_RADIUS || dy > UNLOAD_RADIUS) {
        toUnload.push(key);
      }
    }
    if (toUnload.length > 0) {
      for (const key of toUnload) {
        this.unloadTile(key, this.loadedTiles.get(key)!);
      }
    }
  }

  // ── Initial load (called once at map start) ─────────────────────────

  async loadInitialTiles(lat: number, lng: number): Promise<void> {
    const { tileX, tileY } = tileCoord(lat, lng);
    this.lastTileX = tileX;
    this.lastTileY = tileY;
    this.lastUpdateTime = Date.now();

    // Enqueue center tile as URGENT, immediate neighbours as URGENT,
    // rest as NORMAL.
    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      for (let dy = -LOAD_RADIUS; dy <= LOAD_RADIUS; dy++) {
        const dist = Math.abs(dx) + Math.abs(dy);
        this.enqueue(tileX + dx, tileY + dy, dist <= 1 ? Priority.URGENT : Priority.NORMAL);
      }
    }

    this.resortQueue();
    console.log(`[TileManager] Initial queue: ${this.queue.length} tiles`);

    // Wait only for the center tile to appear before returning control
    // to the game loop (everything else loads in the background).
    const centerKey = tileKey(tileX, tileY);
    await new Promise<void>((resolve) => {
      const check = () => {
        if (this.loadedTiles.has(centerKey) || this.disposed) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  // ── Pre-warm tiles along the track path ─────────────────────────────

  prewarmTrackTiles(trackPoints: [number, number][]): void {
    const seen = new Set<string>();
    for (const [lng, lat] of trackPoints) {
      const { tileX, tileY } = tileCoord(lat, lng);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = tileKey(tileX + dx, tileY + dy);
          if (!seen.has(key)) {
            seen.add(key);
            this.enqueue(tileX + dx, tileY + dy, Priority.PREWARM);
          }
        }
      }
    }
    console.log(`[TileManager] Prewarm: ${seen.size} track tiles queued`);
  }

  // ── Queue management ────────────────────────────────────────────────

  private enqueue(x: number, y: number, priority: Priority): void {
    const key = tileKey(x, y);
    if (this.loadedTiles.has(key) || this.inFlightKeys.has(key)) return;

    // Check if already in queue – upgrade priority if needed
    const idx = this.queue.findIndex(e => e.x === x && e.y === y);
    if (idx >= 0) {
      if (priority < this.queue[idx].priority) {
        this.queue[idx].priority = priority;
      }
      return;
    }

    this.queue.push({ x, y, priority });
    this.pumpWorkers();
  }

  private resortQueue(): void {
    const cx = this.lastTileX;
    const cy = this.lastTileY;
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const da = Math.abs(a.x - cx) + Math.abs(a.y - cy);
      const db = Math.abs(b.x - cx) + Math.abs(b.y - cy);
      return da - db;
    });
  }

  private pumpWorkers(): void {
    while (this.activeWorkers < this.maxConcurrent && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      const key = tileKey(entry.x, entry.y);

      if (this.loadedTiles.has(key) || this.inFlightKeys.has(key)) continue;

      this.inFlightKeys.add(key);
      this.activeWorkers++;
      this.fetchAndRender(entry.x, entry.y, key).finally(() => {
        this.activeWorkers--;
        this.inFlightKeys.delete(key);
        this.pumpWorkers();
      });
    }
  }

  // ── Fetch a single tile and render it ───────────────────────────────

  private async fetchAndRender(x: number, y: number, key: string): Promise<void> {
    try {
      const response = await fetch(`${this.apiBase}/${x}/${y}`);
      if (!response.ok) {
        console.error(`[TileManager] ${key} HTTP ${response.status}`);
        this.scheduleRetry(x, y, key);
        return;
      }

      const result: TileAPIResponse = await response.json();
      if (this.disposed || result.error) {
        if (result.error) this.scheduleRetry(x, y, key);
        return;
      }
      if (this.loadedTiles.has(key)) return;

      const osmData = parseOSMElements(result.data);
      const group = this.buildTileGroup(x, y, osmData);

      this.loadedTiles.set(key, { tileX: x, tileY: y, group, osmData, loadedAt: Date.now() });
      this.worldGroup.add(group);
      this.failCounts.delete(key);

      console.log(`[TileManager] ${key} ready (${osmData.buildings.length}b ${osmData.highways.length}r). loaded=${this.loadedTiles.size} q=${this.queue.length}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[TileManager] ${key} error: ${msg}`);
      this.scheduleRetry(x, y, key);
    }
  }

  private scheduleRetry(x: number, y: number, key: string): void {
    const count = (this.failCounts.get(key) ?? 0) + 1;
    this.failCounts.set(key, count);
    if (count > MAX_TILE_RETRIES) {
      console.error(`[TileManager] ${key} gave up after ${MAX_TILE_RETRIES} retries`);
      return;
    }
    const delay = RETRY_DELAY_MS * count;
    console.log(`[TileManager] ${key} retry ${count}/${MAX_TILE_RETRIES} in ${delay}ms`);
    setTimeout(() => {
      if (!this.disposed && !this.loadedTiles.has(key)) {
        this.enqueue(x, y, Priority.URGENT);
      }
    }, delay);
  }

  // ── Per-tile scene graph builder ────────────────────────────────────

  private buildTileGroup(tileX: number, tileY: number, data: OSMData): THREE.Group {
    const group = new THREE.Group();
    group.name = `tile-${tileX}-${tileY}`;

    const bbox = tileBbox(tileX, tileY);
    const tileCenterLat = (bbox.south + bbox.north) / 2;
    const tileCenterLng = (bbox.west + bbox.east) / 2;
    const extentLat = (bbox.north - bbox.south) * 111319;
    const extentLng = (bbox.east - bbox.west) * 111319 * Math.cos(tileCenterLat * Math.PI / 180);
    const extentMeters = Math.max(extentLat, extentLng) / 2 + 50;
    const tileCenter = this.projection.projectToLocal(tileCenterLat, tileCenterLng);

    try { group.add(generateGroundPlane(data, this.projection, extentMeters, tileCenter)); }
    catch (err) { console.error(`[TileManager] ground ${tileX},${tileY}: ${err}`); }

    try { group.add(generateRoads(data, this.projection)); }
    catch (err) { console.error(`[TileManager] roads ${tileX},${tileY}: ${err}`); }

    try {
      const r = generateBuildings(data, this.projection, this.corridorSegments);
      (r.group as any).__clearingStats = r.stats;
      group.add(r.group);
    } catch (err) { console.error(`[TileManager] buildings ${tileX},${tileY}: ${err}`); }

    try { group.add(generateVegetation(data, this.projection)); }
    catch (err) { console.error(`[TileManager] vegetation ${tileX},${tileY}: ${err}`); }

    try { group.add(generateStreetLabels(data, this.projection)); }
    catch (err) { console.error(`[TileManager] labels ${tileX},${tileY}: ${err}`); }

    return group;
  }

  // ── Tile lifecycle helpers ──────────────────────────────────────────

  private unloadTile(key: string, tile: LoadedTile): void {
    this.worldGroup.remove(tile.group);
    this.disposeGroup(tile.group);
    this.loadedTiles.delete(key);
  }

  rebuildAllBuildings(corridorSegments: CorridorSegment[]): void {
    this.corridorSegments = corridorSegments;
    for (const tile of this.loadedTiles.values()) {
      const old = tile.group.children.find(c => c.name === 'buildings');
      if (old) { tile.group.remove(old); this.disposeGroup(old); }
      try {
        const r = generateBuildings(tile.osmData, this.projection, corridorSegments);
        (r.group as any).__clearingStats = { ...r.stats, phase3Executed: true };
        tile.group.add(r.group);
      } catch (err) {
        console.error(`[TileManager] rebuild ${tile.tileX},${tile.tileY}: ${err}`);
      }
    }
  }

  getLoadedOSMData(): OSMData[] {
    return Array.from(this.loadedTiles.values()).map(t => t.osmData);
  }

  getMeshCount(): number {
    let count = 0;
    this.worldGroup.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh) count++;
    });
    return count;
  }

  private disposeGroup(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh) {
        child.geometry?.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach((m: THREE.Material) => m.dispose());
          else (child.material as THREE.Material).dispose();
        }
      }
      if (child instanceof THREE.Sprite) {
        child.geometry?.dispose();
        if (child.material) {
          (child.material as THREE.SpriteMaterial).map?.dispose();
          child.material.dispose();
        }
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    for (const [key, tile] of this.loadedTiles) {
      this.unloadTile(key, tile);
    }
    this.scene.remove(this.worldGroup);
  }
}
