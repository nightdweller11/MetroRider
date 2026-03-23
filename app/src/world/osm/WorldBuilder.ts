import * as THREE from 'three';
import { fetchOSMData, type OSMData } from './OSMFetcher';
import { LocalProjection } from './LocalProjection';
import { generateBuildings, type BuildingClearingStats } from './BuildingGenerator';
import { generateRoads } from './RoadGenerator';
import { generateVegetation } from './VegetationGenerator';
import { generateGroundPlane } from './GroundPlane';
import { generateStreetLabels } from './StreetLabelGenerator';

type CorridorSegment = { x1: number; z1: number; x2: number; z2: number };

export class WorldBuilder {
  readonly projection: LocalProjection;
  private scene: THREE.Scene;
  private worldGroup: THREE.Group;
  private loaded = false;
  private loading = false;
  private lastClearingStats: BuildingClearingStats | null = null;

  constructor(scene: THREE.Scene, centerLat: number, centerLng: number) {
    this.scene = scene;
    this.projection = new LocalProjection(centerLat, centerLng);
    this.worldGroup = new THREE.Group();
    this.worldGroup.name = 'osm-world';
    this.scene.add(this.worldGroup);
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  isLoading(): boolean {
    return this.loading;
  }

  getClearingStats(): BuildingClearingStats | null {
    return this.lastClearingStats;
  }

  async loadArea(
    stations: { lat: number; lng: number }[],
    marginMeters = 500,
    onProgress?: (msg: string) => void,
    corridorSegments: CorridorSegment[] = [],
  ): Promise<OSMData> {
    if (this.loading) {
      console.log('[WorldBuilder] Already loading, skipping duplicate request');
      return {} as OSMData;
    }

    this.loading = true;

    try {
      const bbox = LocalProjection.bboxFromStations(stations, marginMeters);
      this.projection.setCenter(bbox.centerLat, bbox.centerLng);

      onProgress?.('Fetching OSM data...');
      console.log(`[WorldBuilder] Loading OSM data for area: ${bbox.south.toFixed(5)},${bbox.west.toFixed(5)} to ${bbox.north.toFixed(5)},${bbox.east.toFixed(5)}`);

      const data = await fetchOSMData(bbox.south, bbox.west, bbox.north, bbox.east);

      console.log(`[WorldBuilder] OSM data loaded: ${data.buildings.length} buildings, ${data.highways.length} roads, ${data.trees.length} trees, ${data.parks.length} parks, ${data.railways.length} railways`);

      this.clearWorld();

      const extentLat = (bbox.north - bbox.south) * 111319;
      const extentLng = (bbox.east - bbox.west) * 111319 * Math.cos(bbox.centerLat * Math.PI / 180);
      const extentMeters = Math.max(extentLat, extentLng) / 2 + 200;

      onProgress?.('Generating ground...');
      const groundGroup = generateGroundPlane(data, this.projection, extentMeters);
      this.worldGroup.add(groundGroup);

      onProgress?.('Generating roads...');
      const roadsGroup = generateRoads(data, this.projection);
      this.worldGroup.add(roadsGroup);

      onProgress?.('Generating buildings...');
      const buildResult = generateBuildings(data, this.projection, corridorSegments);
      this.lastClearingStats = buildResult.stats;
      this.worldGroup.add(buildResult.group);

      onProgress?.('Generating vegetation...');
      const vegGroup = generateVegetation(data, this.projection);
      this.worldGroup.add(vegGroup);

      onProgress?.('Adding street labels...');
      const labelGroup = generateStreetLabels(data, this.projection);
      this.worldGroup.add(labelGroup);

      this.loaded = true;
      this.loading = false;
      onProgress?.('World ready!');
      console.log('[WorldBuilder] World generation complete');
      return data;
    } catch (err) {
      this.loading = false;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[WorldBuilder] Failed to load world: ${msg}`);
      throw err;
    }
  }

  /**
   * Replace the existing buildings group with a new one that respects
   * the given corridor segments. Called after final track routing is known.
   */
  rebuildBuildings(
    data: OSMData,
    corridorSegments: CorridorSegment[],
  ): void {
    const oldBuildings = this.worldGroup.children.find(c => c.name === 'buildings');
    if (oldBuildings) {
      console.log(`[WorldBuilder] Removing old buildings group (${oldBuildings.children.length} children)`);
      this.worldGroup.remove(oldBuildings);
      this.disposeObject(oldBuildings);
    } else {
      console.log('[WorldBuilder] No existing buildings group found to replace');
    }

    console.log(`[WorldBuilder] Rebuilding buildings: ${corridorSegments.length} track corridor segs, ${data.buildings.length} buildings in data`);
    const buildResult = generateBuildings(data, this.projection, corridorSegments);
    this.lastClearingStats = { ...buildResult.stats, phase3Executed: true };
    console.log(`[WorldBuilder] New buildings group created with ${buildResult.group.children.length} mesh children`);
    this.worldGroup.add(buildResult.group);
  }

  private clearWorld(): void {
    while (this.worldGroup.children.length > 0) {
      const child = this.worldGroup.children[0];
      this.worldGroup.remove(child);
      this.disposeObject(child);
    }
    this.loaded = false;
  }

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
      if (child instanceof THREE.InstancedMesh) {
        child.geometry?.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
  }

  dispose(): void {
    this.clearWorld();
    this.scene.remove(this.worldGroup);
  }
}
