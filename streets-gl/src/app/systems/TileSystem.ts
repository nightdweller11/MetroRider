import {noteTileCreated, noteTileRemoved} from '~/app/debug/RenderTelemetry';
import Tile from "../objects/Tile";
import Frustum from "~/lib/core/Frustum";
import Vec2 from "~/lib/math/Vec2";
import Vec3 from "~/lib/math/Vec3";
import ConvexHullGrahamScan from "~/lib/math/ConvexHullGrahamScan";
import MathUtils from "~/lib/math/MathUtils";
import Config from "../Config";
import TileObjectsSystem from "./TileObjectsSystem";
import System from "../System";
import SceneSystem from './SceneSystem';
import Camera from "~/lib/core/Camera";
import TerrainSystem from "~/app/systems/TerrainSystem";
import {HeightLoaderTile} from "~/app/terrain/TerrainHeightLoader";
import ControlsSystem, {NavigationMode} from "~/app/systems/ControlsSystem";
import Tile3DBuffers from "~/lib/tile-processing/tile3d/buffers/Tile3DBuffers";
import SettingsSystem from "~/app/systems/SettingsSystem";
import RenderSystem from "~/app/systems/RenderSystem";

interface QueueItem {
	position: Vec2;
	onBeforeLoad: () => Promise<void>;
	onLoad: (tileData: Tile3DBuffers) => Promise<void>;
}

export default class TileSystem extends System {
	public readonly tiles: Map<string, Tile> = new Map();
	private readonly queue: QueueItem[] = [];
	private cameraFrustum: Frustum;
	private objectsManager: TileObjectsSystem;
	public enableTerrainHeight: boolean = true;

	public postInit(): void {
		this.objectsManager = this.systemManager.getSystem(TileObjectsSystem);
		this.listenToSettings();
		this.listenToKeyPresses();
	}

	private listenToKeyPresses(): void {
		window.addEventListener('keydown', (e) => {
			if (e.code === 'KeyP' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				this.purgeTiles();
			}
		});
	}

	private listenToSettings(): void {
		const settings = this.systemManager.getSystem(SettingsSystem).settings;

		settings.onChange('terrainHeight', ({statusValue}) => {
			const isEnabled = statusValue === 'on';

			if (isEnabled !== this.enableTerrainHeight) {
				this.purgeTiles();
				this.enableTerrainHeight = isEnabled;
			}
		}, true);

		settings.onChange('performanceMode', ({statusValue}) => {
			// Tile/memory limits tighten on the low tier, or in auto mode on a
			// device that detected as low-memory (phones/tablets).
			const low = statusValue === 'low' || (statusValue === 'auto' && Config.LowMemoryMode);
			Config.applyPerformanceMode(low);
			this.cameraFrustum = null;
		}, true);

		settings.onChange('terrainDetail', ({statusValue}) => {
			if (statusValue === 'low') {
				Config.TerrainRingCount = 3;
				Config.TerrainRingSegmentCount = 32;
			} else if (statusValue === 'medium') {
				Config.TerrainRingCount = 4;
				Config.TerrainRingSegmentCount = 48;
			} else {
				Config.TerrainRingCount = 6;
				Config.TerrainRingSegmentCount = 64;
			}
		}, true);
	}

	/**
	 * Tiles that failed to load, and when.
	 *
	 * The vector tile server answers 404 for tiles it has no data for — ocean,
	 * gaps in coverage, zoom levels that were never generated. The old code
	 * removed the tile on failure, and `updateTiles()` (which rebuilds the queue
	 * from the frustum every frame) immediately asked for it again. That is an
	 * infinite request loop: measured at 151 tiles created and 151 destroyed in
	 * five seconds on a wide view, with the buildings visibly disappearing and
	 * coming back as their holder tiles were torn down and rebuilt around them.
	 *
	 * A failure is remembered so the same missing tile is not requested forever.
	 */
	private failedTiles: Map<string, {at: number; attempts: number}> = new Map();

	private isOnFailureCooldown(x: number, y: number): boolean {
		const failure = this.failedTiles.get(`${x},${y}`);
		if (!failure) return false;

		// One retry soon (a transient network blip deserves it), then a long
		// cooldown — a 404 means the data does not exist and never will.
		const cooldown = failure.attempts >= 2
			? Config.TileFailureCooldownLong
			: Config.TileFailureCooldownShort;
		return performance.now() - failure.at < cooldown * 1000;
	}

	private noteTileFailure(x: number, y: number): void {
		const key = `${x},${y}`;
		const previous = this.failedTiles.get(key);
		this.failedTiles.set(key, {
			at: performance.now(),
			attempts: (previous?.attempts ?? 0) + 1,
		});
	}

	public addTile(x: number, y: number): void {
		let tile: Tile;

		this.queue.push({
			position: new Vec2(x, y),
			onBeforeLoad: async () => {
				noteTileCreated();
				tile = new Tile(x, y);
				this.tiles.set(`${x},${y}`, tile);

				if (this.enableTerrainHeight) {
					await this.claimHeightDataForTile(x, y, tile);
				}
			},
			onLoad: async (tileData) => {
				if (tile.disposed) {
					return;
				}

				if (!tileData) {
					this.noteTileFailure(x, y);
					this.removeTile(x, y, 'load-failed');
					return;
				}

				const instancedObjects = this.systemManager.getSystem(SceneSystem).objects.instancedObjects;
				const megaBuffers = this.systemManager.getSystem(RenderSystem).tileMegaBuffers;
				tile.load(tileData, megaBuffers);
				tile.updateInstancesBoundingBoxes(instancedObjects);
			}
		});
	}

	public getTile(x: number, y: number): Tile {
		return this.tiles.get(`${x},${y}`);
	}

	public removeTile(x: number, y: number, reason = 'unspecified'): void {
		noteTileRemoved(reason);
		const tile = this.getTile(x, y);

		this.objectsManager.removeTile(tile);

		const heightProvider = this.systemManager.getSystem(TerrainSystem).terrainHeightProvider;

		for (const pos of tile.usedHeightTiles) {
			const tile = heightProvider.heightLoader.getTile(pos.x, pos.y, 12);

			if (tile) {
				tile.tracker.release(tile);
			}
		}

		const megaBuffers = this.systemManager.getSystem(RenderSystem).tileMegaBuffers;
		tile.dispose(megaBuffers);
		this.tiles.delete(`${x},${y}`);
	}

	public getTileByLocalId(localId: number): Tile {
		for (const tile of this.tiles.values()) {
			if (tile.localId === localId) {
				return tile;
			}
		}

		return null;
	}

	private async claimHeightDataForTile(x: number, y: number, tile: Tile): Promise<HeightLoaderTile[]> {
		const dataZoom = 16;
		const heightZoom = 12;
		const factor = 2 ** (dataZoom - heightZoom);

		const tile2terrain = (x: number, y: number): Vec2 => {
			return new Vec2(
				Math.floor(x / factor),
				Math.floor(y / factor)
			);
		}

		const positions: Vec2[] = [];

		// Load nearby tiles just in case we need to handle huge features (buildings, etc.)
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				const tileX = x + dx;
				const tileY = y + dy;

				const terrainTile = tile2terrain(tileX, tileY);

				if (!positions.some(pos => pos.equals(terrainTile))) {
					positions.push(terrainTile);
				}
			}
		}

		const heightProvider = this.systemManager.getSystem(TerrainSystem).terrainHeightProvider;
		const heightPromises: Promise<HeightLoaderTile>[] = [];

		for (const position of positions) {
			heightPromises.push(
				heightProvider.heightLoader.getOrLoadTile(position.x, position.y, heightZoom, tile)
			);
			tile.usedHeightTiles.push(position);
		}

		return Promise.all(heightPromises);
	}

	// Frustum→tile-set recomputation allocates convex-hull scratch every call;
	// 4 Hz is indistinguishable from per-frame (tiles take seconds to load)
	// and removes a steady per-frame garbage source. ?noTileThrottle=1 restores
	// per-frame updates for A/B profiling.
	private static readonly TILE_UPDATE_INTERVAL = 0.25;
	private static readonly NO_TILE_THROTTLE =
		typeof window !== 'undefined' && window.location.search.includes('noTileThrottle=1');
	private tileUpdateTimer: number = Infinity; // run immediately on first frame

	public update(deltaTime: number): void {
		const slippyMode = this.systemManager.getSystem(ControlsSystem).mode === NavigationMode.Slippy;

		this.tileUpdateTimer += deltaTime;
		const shouldUpdate = TileSystem.NO_TILE_THROTTLE ||
			this.tileUpdateTimer >= TileSystem.TILE_UPDATE_INTERVAL;

		if (!slippyMode && shouldUpdate) {
			this.tileUpdateTimer = 0;
			this.updateTiles();
			this.removeCulledTiles();
		}
	}

	private updateTiles(): void {
		const camera = this.systemManager.getSystem(SceneSystem).objects.camera;

		if (
			!this.cameraFrustum ||
			this.cameraFrustum.fov !== camera.fov ||
			this.cameraFrustum.aspect !== camera.aspect
		) {
			this.cameraFrustum = new Frustum(camera.fov, camera.aspect, 1, Config.TileFrustumFar);
			this.cameraFrustum.updateViewSpaceVertices();
		}

		const worldSpaceFrustum = this.cameraFrustum.toSpace(camera.matrix);
		const visibleTiles = this.getTilesInFrustum(worldSpaceFrustum, camera.position);
		// Two different questions, and conflating them was the bug.
		//
		// "What is on screen?" is the whole frustum. "What may I ask the network
		// for?" is capped, because a long frustum wants more tiles than the cache
		// can ever hold. Marking visibility from the CAPPED list told the system
		// that a tile ranked 151st was not being looked at — so it aged past the
		// eviction grace period and was deleted WHILE ON SCREEN, then refetched
		// when the camera turned back. That is the reported "all the buildings
		// vanish and come back with the wrong textures": the holder tile for
		// those buildings changed, so they were redrawn from a different
		// textureId buffer.
		const now = performance.now();

		for (const tile of this.tiles.values()) {
			tile.inFrustum = false;
		}

		for (const tilePosition of visibleTiles) {
			const tile = this.getTile(tilePosition.x, tilePosition.y);

			if (tile) {
				tile.inFrustum = true;
				tile.lastInFrustumAt = now;
			}
		}

		// The load request set is a DISC around the camera, not the frustum.
		//
		// Capping "nearest 150 in frustum" makes the set change every time the
		// camera turns, so a full cache perpetually swaps one 150-tile set for
		// another: measured at 117 loaded and 129 evicted during a single slow
		// turn, with the buildings visibly leaving and returning. A disc does
		// not rotate. Turning now changes only the ORDER things load in, never
		// which tiles are wanted, so a stationary orbit costs nothing.
		const frustumTiles = this.getTilesAroundCamera(camera, visibleTiles);

		this.queue.length = 0;

		for (const tilePosition of frustumTiles) {
			if (!this.getTile(tilePosition.x, tilePosition.y)) {
				// Do not ask again for a tile the server has already refused.
				if (!this.isOnFailureCooldown(tilePosition.x, tilePosition.y)) {
					this.addTile(tilePosition.x, tilePosition.y);
				}
			}
		}

		this.updateTilesDistancesToCamera(camera);
	}

	public getNextTileToLoad(): QueueItem {
		// Hard cap on concurrently loaded tiles. Without this gate a high or
		// wide camera view could keep hundreds of tiles loaded at once (each
		// holding CPU geometry + GPU buffers), which is how long sessions used
		// to grow to tens of GB. Eviction (removeCulledTiles) frees room based
		// on demand; loading resumes as soon as there is capacity.
		if (this.tiles.size >= Config.MaxConcurrentTiles) {
			return undefined;
		}
		return this.queue.shift();
	}

	/**
	 * Tiles worth holding, ordered by how soon they are needed.
	 *
	 * Membership is rotation-invariant (a disc of radius
	 * `Config.TileWorkingSetDistance` around the camera) so that turning the
	 * camera never changes WHICH tiles are wanted. Ordering puts what is
	 * currently on screen first, so a turn still loads the new view promptly.
	 */
	private getTilesAroundCamera(camera: Camera, visibleTiles: Vec2[]): Vec2[] {
		const centre = MathUtils.meters2tile(camera.position.x, camera.position.z);
		const metresPerTile = Math.abs(MathUtils.tile2meters(1, 0).x - MathUtils.tile2meters(0, 0).x) || 611;
		const radiusTiles = Math.max(1, Math.ceil(Config.TileWorkingSetDistance / metresPerTile));
		const inView = new Set<string>();

		for (const tile of visibleTiles) {
			inView.add(`${tile.x},${tile.y}`);
		}

		const cx = Math.floor(centre.x);
		const cy = Math.floor(centre.y);
		const candidates: {position: Vec2; key: number}[] = [];

		for (let dx = -radiusTiles; dx <= radiusTiles; dx++) {
			for (let dy = -radiusTiles; dy <= radiusTiles; dy++) {
				const x = cx + dx;
				const y = cy + dy;
				const world = MathUtils.tile2meters(x + 0.5, y + 0.5);
				const distance = Math.hypot(world.x - camera.position.x, world.y - camera.position.z);

				if (distance > Config.TileWorkingSetDistance) continue;

				// On-screen tiles sort ahead of everything behind the camera.
				const visible = inView.has(`${x},${y}`) ? 0 : 1;
				candidates.push({position: new Vec2(x, y), key: visible * 1e7 + distance});
			}
		}

		candidates.sort((a, b): number => a.key - b.key);

		return candidates.slice(0, Config.MaxConcurrentTiles).map(c => c.position);
	}

	private updateTilesDistancesToCamera(camera: Camera): void {
		for (const tile of this.tiles.values()) {
			tile.updateDistanceToCamera(camera);
		}
	}

	private getTilesInFrustum(frustum: Frustum, cameraPosition: Vec3): Vec2[] {
		const projectedVertices: Vec2[] = [];

		for (let i = 0; i < 4; i++) {
			projectedVertices.push(
				new Vec2(frustum.vertices.near[i].x, frustum.vertices.near[i].z),
				new Vec2(frustum.vertices.far[i].x, frustum.vertices.far[i].z)
			);
		}

		const convexHull = new ConvexHullGrahamScan();

		for (let i = 0; i < projectedVertices.length; i++) {
			convexHull.addPoint(projectedVertices[i].x, projectedVertices[i].y);
		}

		const hullPoints = convexHull.getHull();

		const points: Vec2[] = [];

		for (let i = 0; i < hullPoints.length; i++) {
			points.push(new Vec2(hullPoints[i].x, hullPoints[i].y));
		}

		return this.getTilesInConvexHull(points, cameraPosition);
	}

	private getTilesInConvexHull(points: Vec2[], cameraPosition: Vec3): Vec2[] {
		if (points.length === 0) {
			return [];
		}

		const tilePoints: Vec2[] = [];

		for (let i = 0; i < points.length; i++) {
			const pos = MathUtils.meters2tile(points[i].x, points[i].y);
			tilePoints.push(pos);
		}

		const tilesOnEdges: Vec2[] = [];

		for (let i = 0; i < points.length; i++) {
			const next = (i + 1) % points.length;
			const data = MathUtils.getTilesIntersectingLine(tilePoints[i], tilePoints[next]);

			for (let j = 0; j < data.length; j++) {
				tilesOnEdges.push(data[j]);
			}
		}

		for (let i = 0; i < tilesOnEdges.length; i++) {
			tilesOnEdges[i].x = Math.floor(tilesOnEdges[i].x);
			tilesOnEdges[i].y = Math.floor(tilesOnEdges[i].y);
		}

		const tilesMap: Map<string, Vec2> = new Map();

		for (const tile of tilesOnEdges) {
			tilesMap.set(`${tile.x},${tile.y}`, tile);
		}

		const filteredTiles: Vec2[] = Array.from(tilesMap.values());

		let tileYs: number[] = [];

		for (let i = 0; i < filteredTiles.length; i++) {
			tileYs.push(filteredTiles[i].y);
		}

		tileYs = tileYs.filter((v: number, i: number) => tileYs.indexOf(v) === i);
		tileYs = tileYs.sort((a: number, b: number) => a - b);

		const tiles: Vec2[] = [];

		for (let i = 0; i < tileYs.length; i++) {
			const currentTileY = tileYs[i];
			let row = [];

			for (const tile of filteredTiles) {
				if (tile.y === currentTileY) {
					row.push(tile.x);
				}
			}

			row = row.sort((a: number, b: number) => a - b);

			let cell = row[0];
			let index = 0;

			while (cell <= row[row.length - 1]) {
				tiles.push(new Vec2(cell, currentTileY));

				if (row[index + 1] > cell + 1) {
					row.splice(index + 1, 0, cell + 1);
				}

				index++;
				cell = row[index];
			}
		}

		return this.sortTilesByDistanceToCamera(tiles, cameraPosition);
	}

	private sortTilesByDistanceToCamera(tiles: Vec2[], cameraPosition: Vec3): Vec2[] {
		const tilesList: {distance: number; tile: Vec2}[] = [];

		for (let i = 0; i < tiles.length; i++) {
			const worldPosition = MathUtils.tile2meters(tiles[i].x + 0.5, tiles[i].y + 0.5);

			tilesList.push({
				distance: Math.sqrt((worldPosition.x - cameraPosition.x) ** 2 + (worldPosition.y - cameraPosition.z) ** 2),
				tile: tiles[i]
			});
		}

		tilesList.sort((a, b): number => {
			return a.distance - b.distance;
		});

		return tilesList.map(entry => entry.tile);
	}

	private removeCulledTiles(): void {
		const outOfFrustum: {tile: Tile; distance: number}[] = [];
		// Near tiles are held even when the camera is not looking at them.
		// Frustum membership changes the instant the camera turns; what is
		// actually near does not. Evicting on frustum alone made a stationary
		// camera orbit thrash the tile cache — reload, re-hide and re-show every
		// building whose holder tile changed, which is what the pop-in and the
		// switching textures were.
		const retention = Config.TileRetentionDistance;
		// A tile seen moments ago is about to be seen again — turning the camera
		// is not a reason to throw it away and fetch it back.
		const graceMs = Config.TileEvictionGraceSeconds * 1000;
		const now = performance.now();

		for (const tile of this.tiles.values()) {
			if (tile.inFrustum) continue;
			if (tile.distanceToCamera <= retention) continue;
			// Never evict something the loader still wants. The working set is
			// wider than the retention radius, so without this a tile in the
			// outer ring is asked for and thrown away on the same frame — it
			// reloads, is evicted, reloads again, and the buildings it holds
			// blink each time.
			if (tile.distanceToCamera <= Config.TileWorkingSetDistance) continue;
			if (now - tile.lastInFrustumAt < graceMs) continue;
			outOfFrustum.push({tile, distance: tile.distanceToCamera});
		}

		// Farthest first.
		outOfFrustum.sort((a, b): number => {
			return b.distance - a.distance;
		});

		if (Config.AggressiveEviction) {
			for (const {tile} of outOfFrustum) {
				this.removeTile(tile.x, tile.y, 'aggressive-eviction');
			}
			return;
		}

		// Evict enough out-of-frustum tiles to stay within the cap AND to make
		// room for tiles waiting in the load queue (otherwise a full cache of
		// out-of-frustum tiles would block new nearby tiles forever).
		const demand = Math.min(this.queue.length, 16);
		let toFree = Math.max(0, this.tiles.size + demand - Config.MaxConcurrentTiles);

		for (let i = 0; i < outOfFrustum.length && toFree > 0; i++, toFree--) {
			this.removeTile(outOfFrustum[i].tile.x, outOfFrustum[i].tile.y, 'evicted-out-of-frustum');
		}

		// A VISIBLE tile is never evicted to make room for another visible tile.
		//
		// The old safety net evicted "the farthest visible tiles" whenever the
		// cache was full and everything was in frustum — which on a wide view is
		// always. That is precisely the reported symptom: the whole set of
		// buildings you are looking at disappears and comes back seconds later.
		// The cap still holds; what changes is that reaching it stops LOADING
		// more distant geography instead of deleting what is already on screen.
		// Measured on a wide orbit: 151 tiles created and 151 destroyed in five
		// seconds, all of them in view.
		//
		// The escape hatch below only fires when the cache is far beyond the cap
		// (a genuine runaway), so memory is still bounded.
		const runawayLimit = Math.round(Config.MaxConcurrentTiles * 1.5);
		if (this.tiles.size > runawayLimit) {
			const all = [...this.tiles.values()].sort(
				(a, b) => b.distanceToCamera - a.distanceToCamera
			);
			let excess = this.tiles.size - runawayLimit;
			for (const tile of all) {
				if (excess <= 0) break;
				this.removeTile(tile.x, tile.y, 'runaway-cap');
				excess--;
			}
		}
	}

	public purgeTiles(): void {
		for (const tile of this.tiles.values()) {
			this.removeTile(tile.x, tile.y, 'purge');
		}
	}
}
