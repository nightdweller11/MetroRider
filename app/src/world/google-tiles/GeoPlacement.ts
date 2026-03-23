import * as THREE from 'three';
import type { Ellipsoid } from '3d-tiles-renderer';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// Frame constants from 3d-tiles-renderer Ellipsoid.js
// CAMERA_FRAME: Y-up, -Z forward (Three.js camera convention)
// OBJECT_FRAME: Y-up, +Z forward (Three.js object convention)
const CAMERA_FRAME = 1;
const OBJECT_FRAME = 2;

const _matrix = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _down = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _normalMatrix = new THREE.Matrix3();

/**
 * Central utility for placing objects and cameras on the globe.
 * Uses the 3d-tiles-renderer Ellipsoid API for correct coordinate transforms.
 * All results are in world-space (after applying tilesGroup.matrixWorld).
 */
export class GeoPlacement {
  private ellipsoid: Ellipsoid;
  private tilesGroup: THREE.Object3D;
  private terrainCache = new Map<string, { height: number; time: number }>();
  private defaultTerrainOffset = 50;

  constructor(ellipsoid: Ellipsoid, tilesGroup: THREE.Object3D) {
    this.ellipsoid = ellipsoid;
    this.tilesGroup = tilesGroup;
  }

  /**
   * Get a world-space position for a lat/lng/height.
   * Height is above the WGS84 ellipsoid.
   */
  getPosition(lat: number, lng: number, height: number, target: THREE.Vector3): THREE.Vector3 {
    this.ellipsoid.getCartographicToPosition(lat * DEG2RAD, lng * DEG2RAD, height, target);
    target.applyMatrix4(this.tilesGroup.matrixWorld);
    return target;
  }

  /**
   * Place an Object3D at lat/lng/height with Y-up and Z-forward orientation.
   * azimuthDeg: compass bearing in degrees (0=North, 90=East).
   */
  placeObject(
    obj: THREE.Object3D,
    lat: number, lng: number, height: number,
    azimuthDeg = 0,
  ): void {
    this.ellipsoid.getObjectFrame(
      lat * DEG2RAD, lng * DEG2RAD, height,
      azimuthDeg * DEG2RAD, 0, 0,
      _matrix, OBJECT_FRAME,
    );
    _matrix.premultiply(this.tilesGroup.matrixWorld);

    obj.position.setFromMatrixPosition(_matrix);
    obj.quaternion.setFromRotationMatrix(_matrix);
  }

  /**
   * Place a camera at lat/lng/height looking along a compass bearing.
   * Uses CAMERA_FRAME: Y-up, -Z forward (Three.js camera convention).
   * elevationDeg: pitch angle (negative = look down).
   */
  placeCamera(
    camera: THREE.PerspectiveCamera,
    lat: number, lng: number, height: number,
    azimuthDeg = 0, elevationDeg = 0,
  ): void {
    this.ellipsoid.getObjectFrame(
      lat * DEG2RAD, lng * DEG2RAD, height,
      azimuthDeg * DEG2RAD, elevationDeg * DEG2RAD, 0,
      _matrix, CAMERA_FRAME,
    );
    _matrix.premultiply(this.tilesGroup.matrixWorld);

    camera.position.setFromMatrixPosition(_matrix);
    camera.quaternion.setFromRotationMatrix(_matrix);
  }

  /**
   * Get the world-space "up" vector at a lat/lng (unit vector away from surface).
   */
  getUpVector(lat: number, lng: number, target: THREE.Vector3): THREE.Vector3 {
    this.ellipsoid.getCartographicToNormal(lat * DEG2RAD, lng * DEG2RAD, target);
    _normalMatrix.setFromMatrix4(this.tilesGroup.matrixWorld);
    target.applyMatrix3(_normalMatrix).normalize();
    return target;
  }

  /**
   * Raycast downward from a high point to find the actual terrain height at a lat/lng.
   * Returns the ellipsoidal height of the terrain surface, or null if no hit.
   * Results are cached for 5 seconds.
   */
  getTerrainHeight(lat: number, lng: number): number | null {
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    const cached = this.terrainCache.get(key);
    if (cached && (performance.now() - cached.time) < 5000) {
      return cached.height;
    }

    const highAlt = 2000;
    this.ellipsoid.getCartographicToPosition(lat * DEG2RAD, lng * DEG2RAD, highAlt, _pos);
    _pos.applyMatrix4(this.tilesGroup.matrixWorld);

    this.ellipsoid.getCartographicToNormal(lat * DEG2RAD, lng * DEG2RAD, _down);
    const normalMatrix = new THREE.Matrix3().setFromMatrix4(this.tilesGroup.matrixWorld);
    _down.applyMatrix3(normalMatrix).normalize().negate();

    _raycaster.set(_pos, _down);
    _raycaster.far = highAlt + 500;

    const intersects = _raycaster.intersectObject(this.tilesGroup, true);
    if (intersects.length > 0) {
      const hitPoint = intersects[0].point.clone();
      const inv = this.tilesGroup.matrixWorld.clone().invert();
      hitPoint.applyMatrix4(inv);
      const elevation = this.ellipsoid.getPositionElevation(hitPoint);

      this.terrainCache.set(key, { height: elevation, time: performance.now() });
      return elevation;
    }

    return null;
  }

  /**
   * Get the height to use for placing an object on the ground.
   * Uses terrain raycast if available, falls back to a default offset above the ellipsoid.
   */
  getGroundHeight(lat: number, lng: number, aboveGround = 0): number {
    const terrainH = this.getTerrainHeight(lat, lng);
    if (terrainH !== null) {
      return terrainH + aboveGround;
    }
    return this.defaultTerrainOffset + aboveGround;
  }

  /**
   * Convert a world-space position back to lat/lng/height.
   */
  worldToCartographic(worldPos: THREE.Vector3): { lat: number; lng: number; height: number } {
    const localPos = worldPos.clone();
    const inv = this.tilesGroup.matrixWorld.clone().invert();
    localPos.applyMatrix4(inv);

    const result = { lat: 0, lon: 0, height: 0 };
    this.ellipsoid.getPositionToCartographic(localPos, result);
    return {
      lat: result.lat * RAD2DEG,
      lng: result.lon * RAD2DEG,
      height: result.height,
    };
  }

  setDefaultTerrainOffset(offset: number): void {
    this.defaultTerrainOffset = offset;
  }

  clearTerrainCache(): void {
    this.terrainCache.clear();
  }
}
