import * as THREE from 'three';
import type { StationData } from '@/data/RouteParser';
import type { LocalProjection } from '@/world/osm/LocalProjection';

const MAX_PASSENGERS_PER_TRAIN = 200;
const MIN_BOARDING = 3;
const MAX_BOARDING = 25;
const MIN_ALIGHTING_RATIO = 0.05;
const MAX_ALIGHTING_RATIO = 0.3;

export class PassengerSystem {
  private onboardCount = 0;
  private stationGroups: Map<string, THREE.Group> = new Map();
  private scene: THREE.Scene;
  private projection: LocalProjection;

  constructor(scene: THREE.Scene, projection: LocalProjection) {
    this.scene = scene;
    this.projection = projection;
  }

  setProjection(projection: LocalProjection): void {
    this.projection = projection;
  }

  getOnboardCount(): number {
    return this.onboardCount;
  }

  reset(): void {
    this.onboardCount = 0;
    for (const [, group] of this.stationGroups) {
      group.traverse((child) => {
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
      });
      this.scene.remove(group);
    }
    this.stationGroups.clear();
  }

  populateStations(stations: StationData[], _color: string): void {
    this.reset();

    for (const station of stations) {
      const group = new THREE.Group();
      group.name = `passengers-${station.id}`;

      const count = Math.floor(Math.random() * 12) + 3;
      for (let i = 0; i < count; i++) {
        const passengerMesh = this.createPassengerSprite();

        const angle = Math.random() * Math.PI * 2;
        const radius = 3 + Math.random() * 8;
        const offsetLat = station.lat + (Math.cos(angle) * radius) / 111319;
        const offsetLng = station.lng + (Math.sin(angle) * radius) / (111319 * Math.cos(station.lat * Math.PI / 180));

        this.projection.placeObject(passengerMesh, offsetLat, offsetLng, 0.9);
        group.add(passengerMesh);
      }

      this.scene.add(group);
      this.stationGroups.set(station.id, group);
    }
  }

  handleStationStop(station: StationData): { boarded: number; alighted: number } {
    const alightRatio = MIN_ALIGHTING_RATIO + Math.random() * (MAX_ALIGHTING_RATIO - MIN_ALIGHTING_RATIO);
    const alighted = Math.floor(this.onboardCount * alightRatio);
    this.onboardCount -= alighted;

    const boardingCapacity = MAX_PASSENGERS_PER_TRAIN - this.onboardCount;
    const boarding = Math.min(
      Math.floor(MIN_BOARDING + Math.random() * (MAX_BOARDING - MIN_BOARDING)),
      boardingCapacity,
    );
    this.onboardCount += boarding;

    return { boarded: boarding, alighted };
  }

  private createPassengerSprite(): THREE.Mesh {
    const bodyGeo = new THREE.CapsuleGeometry(0.3, 1.2, 4, 8);
    const hue = Math.random();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hue, 0.4, 0.5),
      roughness: 0.8,
    });
    const mesh = new THREE.Mesh(bodyGeo, bodyMat);
    mesh.castShadow = true;
    return mesh;
  }

  dispose(): void {
    this.reset();
  }
}
