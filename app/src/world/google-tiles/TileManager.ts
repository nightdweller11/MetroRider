import * as THREE from 'three';
import { TilesRenderer, GlobeControls } from '3d-tiles-renderer';
import type { Ellipsoid } from '3d-tiles-renderer';
import {
  GoogleCloudAuthPlugin,
  TileCompressionPlugin,
  UpdateOnChangePlugin,
  UnloadTilesPlugin,
  GLTFExtensionsPlugin,
  TilesFadePlugin,
} from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const DEG2RAD = Math.PI / 180;

export type TileLoadErrorCallback = (error: string) => void;

export class TileManager {
  readonly tilesRenderer: TilesRenderer;
  readonly controls: GlobeControls;
  private camera: THREE.PerspectiveCamera;
  private disposed = false;
  private tileLoadFailed = false;

  constructor(
    apiKey: string,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    domElement: HTMLElement,
    onError?: TileLoadErrorCallback,
  ) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('A valid Google Maps API key is required');
    }

    this.camera = camera;

    this.tilesRenderer = new TilesRenderer();
    this.tilesRenderer.registerPlugin(
      new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }),
    );
    this.tilesRenderer.registerPlugin(new TileCompressionPlugin());
    this.tilesRenderer.registerPlugin(new UpdateOnChangePlugin());
    this.tilesRenderer.registerPlugin(new UnloadTilesPlugin());
    this.tilesRenderer.registerPlugin(new TilesFadePlugin());
    this.tilesRenderer.registerPlugin(new GLTFExtensionsPlugin({
      dracoLoader: new DRACOLoader().setDecoderPath(
        'https://unpkg.com/three@0.183.2/examples/jsm/libs/draco/gltf/',
      ),
    }));

    this.tilesRenderer.errorTarget = 2;
    this.tilesRenderer.setCamera(camera);
    this.tilesRenderer.setResolutionFromRenderer(camera, renderer);

    this.tilesRenderer.addEventListener('load-error', (event: { error: Error; url: string | URL }) => {
      const msg = event.error?.message ?? String(event.error);
      console.error(`[TileManager] load-error: ${msg} (url: ${event.url})`);

      if (!this.tileLoadFailed) {
        if (msg.includes('403')) {
          this.tileLoadFailed = true;
          const hint = 'Google Maps API returned 403 Forbidden. ' +
            'Make sure the "Map Tiles API" is enabled in your Google Cloud Console ' +
            'and your API key has no restrictive referrer/IP rules.';
          console.error(hint);
          onError?.(hint);
        } else if (msg.includes('400') && msg.includes('root.json')) {
          this.tileLoadFailed = true;
          const hint = 'Google Maps API returned 400 Bad Request. ' +
            'Your API key may be invalid or the Map Tiles API may not be fully activated yet. ' +
            'Try refreshing the page in a minute.';
          console.error(hint);
          onError?.(hint);
        }
      }
    });

    this.tilesRenderer.addEventListener('load-tileset', () => {
      console.log('[TileManager] Tileset loaded');
    });

    // Rotate from Cesium Z-up ECEF to Three.js Y-up convention
    this.tilesRenderer.group.rotation.x = -Math.PI / 2;
    scene.add(this.tilesRenderer.group);

    this.controls = new GlobeControls(scene, camera, domElement, undefined as any);
    this.controls.setEllipsoid(this.tilesRenderer.ellipsoid, this.tilesRenderer.group);
    this.controls.enableDamping = true;
    // Prevent adjustCamera from moving the camera height - CameraController handles that
    this.controls.adjustHeight = false;
  }

  get ellipsoid(): Ellipsoid {
    return this.tilesRenderer.ellipsoid;
  }

  get group(): THREE.Object3D {
    return this.tilesRenderer.group;
  }

  /**
   * Position the camera above a lat/lng using the library's Ellipsoid API.
   * Then sync GlobeControls so mouse interaction works.
   */
  setView(lat: number, lng: number, altitude = 500): void {
    const latRad = lat * DEG2RAD;
    const lngRad = lng * DEG2RAD;

    const camPos = new THREE.Vector3();
    const target = new THREE.Vector3();
    const up = new THREE.Vector3();

    this.tilesRenderer.ellipsoid.getCartographicToPosition(latRad, lngRad, altitude, camPos);
    this.tilesRenderer.ellipsoid.getCartographicToPosition(latRad, lngRad, 0, target);
    this.tilesRenderer.ellipsoid.getCartographicToNormal(latRad, lngRad, up);

    // Apply tilesGroup world transform (may be identity, but be safe)
    camPos.applyMatrix4(this.tilesRenderer.group.matrixWorld);
    target.applyMatrix4(this.tilesRenderer.group.matrixWorld);

    const normalMat = new THREE.Matrix3().setFromMatrix4(this.tilesRenderer.group.matrixWorld);
    up.applyMatrix3(normalMat).normalize();

    this.camera.position.copy(camPos);
    this.camera.up.copy(up);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();

    this.controls.resetState();
  }

  hasTileLoadFailed(): boolean {
    return this.tileLoadFailed;
  }

  updateTiles(): void {
    if (this.disposed) return;
    this.tilesRenderer.update();
  }

  /**
   * Call after externally modifying the camera (e.g. CameraController)
   * so GlobeControls' internal state stays in sync for when it's re-enabled.
   */
  syncControlsToCamera(): void {
    this.controls.resetState();
  }

  getAttribution(): string {
    return 'Map data &copy; Google';
  }

  dispose(): void {
    this.disposed = true;
    this.tilesRenderer.dispose();
    this.controls.dispose();
  }
}
