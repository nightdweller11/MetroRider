import * as THREE from 'three';

const DEG2RAD = Math.PI / 180;

/**
 * Converts lat/lng to local X/Z meters using equirectangular projection.
 * Replaces GeoPlacement for city-scale rendering (< 50 km radius).
 *
 * Coordinate convention:
 *   X → East   (positive = eastward)
 *   Y → Up     (positive = up)
 *   Z → South  (negative = northward, matching Three.js forward = -Z for map orientation)
 */
export class LocalProjection {
  private centerLat: number;
  private centerLng: number;
  private metersPerDegLng: number;
  private metersPerDegLat = 111319;

  constructor(centerLat: number, centerLng: number) {
    this.centerLat = centerLat;
    this.centerLng = centerLng;
    this.metersPerDegLng = 111319 * Math.cos(centerLat * DEG2RAD);
  }

  setCenter(lat: number, lng: number): void {
    this.centerLat = lat;
    this.centerLng = lng;
    this.metersPerDegLng = 111319 * Math.cos(lat * DEG2RAD);
  }

  getCenterLat(): number {
    return this.centerLat;
  }

  getCenterLng(): number {
    return this.centerLng;
  }

  projectToLocal(lat: number, lng: number): { x: number; z: number } {
    return {
      x: (lng - this.centerLng) * this.metersPerDegLng,
      z: -(lat - this.centerLat) * this.metersPerDegLat,
    };
  }

  localToLatLng(x: number, z: number): { lat: number; lng: number } {
    return {
      lat: this.centerLat + (-z / this.metersPerDegLat),
      lng: this.centerLng + (x / this.metersPerDegLng),
    };
  }

  /**
   * Get 3D position from lat/lng/height. Drop-in replacement for GeoPlacement.getPosition.
   */
  getPosition(lat: number, lng: number, height: number, target: THREE.Vector3): THREE.Vector3 {
    const local = this.projectToLocal(lat, lng);
    target.set(local.x, height, local.z);
    return target;
  }

  /**
   * Place an Object3D at lat/lng/height with bearing orientation.
   * azimuthDeg: compass bearing (0=North, 90=East).
   */
  placeObject(
    obj: THREE.Object3D,
    lat: number, lng: number, height: number,
    azimuthDeg = 0,
  ): void {
    const local = this.projectToLocal(lat, lng);
    obj.position.set(local.x, height, local.z);
    obj.rotation.set(0, 0, 0);
    obj.rotation.y = -azimuthDeg * DEG2RAD;
  }

  /**
   * Get ground height. In local projection, terrain is always at Y=0.
   */
  getGroundHeight(_lat: number, _lng: number, aboveGround = 0): number {
    return aboveGround;
  }

  /**
   * Up vector is always (0, 1, 0) in local projection.
   */
  getUpVector(_lat: number, _lng: number, target: THREE.Vector3): THREE.Vector3 {
    target.set(0, 1, 0);
    return target;
  }

  /**
   * Compute the bounding box (in lat/lng) around the center, expanded by radiusMeters.
   */
  getBbox(radiusMeters: number): { south: number; west: number; north: number; east: number } {
    const dLat = radiusMeters / this.metersPerDegLat;
    const dLng = radiusMeters / this.metersPerDegLng;
    return {
      south: this.centerLat - dLat,
      west: this.centerLng - dLng,
      north: this.centerLat + dLat,
      east: this.centerLng + dLng,
    };
  }

  /**
   * Compute the bounding box that covers all stations plus a margin.
   */
  static bboxFromStations(
    stations: { lat: number; lng: number }[],
    marginMeters = 500,
  ): { south: number; west: number; north: number; east: number; centerLat: number; centerLng: number } {
    if (stations.length === 0) {
      throw new Error('Cannot compute bbox from empty station list');
    }

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    for (const s of stations) {
      if (s.lat < minLat) minLat = s.lat;
      if (s.lat > maxLat) maxLat = s.lat;
      if (s.lng < minLng) minLng = s.lng;
      if (s.lng > maxLng) maxLng = s.lng;
    }

    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const marginLat = marginMeters / 111319;
    const marginLng = marginMeters / (111319 * Math.cos(centerLat * DEG2RAD));

    return {
      south: minLat - marginLat,
      west: minLng - marginLng,
      north: maxLat + marginLat,
      east: maxLng + marginLng,
      centerLat,
      centerLng,
    };
  }
}
