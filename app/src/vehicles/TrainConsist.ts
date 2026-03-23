import * as THREE from 'three';
import { buildTrainCar } from './TrainModel';
import { bearing } from '@/core/CoordinateSystem';
import type { LocalProjection } from '@/world/osm/LocalProjection';
import type { TrackData } from '@/world/TrackBuilder';
import { getPositionAtDistance } from '@/world/TrackBuilder';

const NUM_CARS = 3;
const CAR_SPACING_METERS = 24;
const TRAIN_ABOVE_GROUND = 0.5;

export class TrainConsist {
  readonly group: THREE.Group;
  private carGroups: THREE.Group[] = [];
  private color: string;
  private projection: LocalProjection;
  private leadCarWorldPos = new THREE.Vector3();

  constructor(color: string, direction: number, projection: LocalProjection) {
    this.color = color;
    this.projection = projection;
    this.group = new THREE.Group();
    this.group.name = 'train-consist';
    this.rebuild(color, direction);
  }

  setProjection(projection: LocalProjection): void {
    this.projection = projection;
  }

  rebuild(color: string, direction: number): void {
    this.color = color;

    for (const car of this.carGroups) {
      this.disposeObject(car);
    }
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
    this.carGroups = [];

    for (let i = 0; i < NUM_CARS; i++) {
      const isHead = direction === 1 ? i === 0 : i === NUM_CARS - 1;
      const isTail = direction === 1 ? i === NUM_CARS - 1 : i === 0;
      const car = buildTrainCar(color, isHead, isTail);
      this.group.add(car);
      this.carGroups.push(car);
    }
  }

  updatePosition(
    track: TrackData,
    leadDistance: number,
    direction: number,
  ): { lng: number; lat: number; bearing: number } {
    const leadPos = getPositionAtDistance(track.spline.points, track.cumDist, leadDistance);
    const lookAheadDist = leadDistance + 30 * direction;
    const lookAhead = getPositionAtDistance(track.spline.points, track.cumDist, lookAheadDist);
    const leadBearing = bearing(leadPos.lat, leadPos.lng, lookAhead.lat, lookAhead.lng);

    for (let i = 0; i < this.carGroups.length; i++) {
      const carOffset = i * CAR_SPACING_METERS * direction;
      const carDist = leadDistance - carOffset;
      const carPos = getPositionAtDistance(track.spline.points, track.cumDist, carDist);
      const carAheadDist = carDist + 15 * direction;
      const carAhead = getPositionAtDistance(track.spline.points, track.cumDist, carAheadDist);
      const carBearing = bearing(carPos.lat, carPos.lng, carAhead.lat, carAhead.lng);

      this.projection.placeObject(this.carGroups[i], carPos.lat, carPos.lng, TRAIN_ABOVE_GROUND, carBearing);

      if (i === 0) {
        this.leadCarWorldPos.copy(this.carGroups[i].position);
      }
    }

    return { lng: leadPos.lng, lat: leadPos.lat, bearing: leadBearing };
  }

  getLeadCarWorldPos(): THREE.Vector3 {
    return this.leadCarWorldPos;
  }

  getColor(): string {
    return this.color;
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
    });
  }
}
