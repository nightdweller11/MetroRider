import Tile3DFromVectorProvider from "~/lib/tile-processing/tile3d/providers/Tile3DFromVectorProvider";
import {Tile3DFeaturesToBuffersConverter} from "~/lib/tile-processing/tile3d/buffers/Tile3DFeaturesToBuffersConverter";
import {WorkerMessage} from "~/app/world/worker/WorkerMessage";
import Tile3DBuffers from "~/lib/tile-processing/tile3d/buffers/Tile3DBuffers";
import {getTile3DBuffersTransferables} from "~/lib/tile-processing/tile3d/utils";
import MathUtils from "~/lib/math/MathUtils";
import {SkeletonBuilder} from 'straight-skeleton';
import Tile3DFeatureCollection from "~/lib/tile-processing/tile3d/features/Tile3DFeatureCollection";
import Tile3DProjectedGeometryBuilder from "~/lib/tile-processing/tile3d/builders/Tile3DProjectedGeometryBuilder";
import {Tile3DRingType} from "~/lib/tile-processing/tile3d/builders/Tile3DRing";
import Vec2 from "~/lib/math/Vec2";
import {ZIndexMap} from "~/lib/tile-processing/tile3d/features/Tile3DProjectedGeometry";
import {ProjectedTextures} from "~/lib/tile-processing/tile3d/textures";

const ctx: Worker = self as any;

class SegmentGrid {
	private readonly cellSize: number;
	private readonly cells: Map<string, number[]> = new Map();
	public readonly segments: WorkerMessage.CorridorSegment[];

	public constructor(segments: WorkerMessage.CorridorSegment[], cellSize: number = 500) {
		this.segments = segments;
		this.cellSize = cellSize;
		this.build();
	}

	private keyFor(cx: number, cz: number): string {
		return `${cx},${cz}`;
	}

	private build(): void {
		this.cells.clear();
		for (let i = 0; i < this.segments.length; i++) {
			const s = this.segments[i];
			const minCX = Math.floor(Math.min(s.x1, s.x2) / this.cellSize);
			const maxCX = Math.floor(Math.max(s.x1, s.x2) / this.cellSize);
			const minCZ = Math.floor(Math.min(s.z1, s.z2) / this.cellSize);
			const maxCZ = Math.floor(Math.max(s.z1, s.z2) / this.cellSize);
			for (let cx = minCX; cx <= maxCX; cx++) {
				for (let cz = minCZ; cz <= maxCZ; cz++) {
					const key = this.keyFor(cx, cz);
					let arr = this.cells.get(key);
					if (!arr) {
						arr = [];
						this.cells.set(key, arr);
					}
					arr.push(i);
				}
			}
		}
	}

	public queryRect(minX: number, minZ: number, maxX: number, maxZ: number): Set<number> {
		const result = new Set<number>();
		const cxMin = Math.floor(minX / this.cellSize);
		const cxMax = Math.floor(maxX / this.cellSize);
		const czMin = Math.floor(minZ / this.cellSize);
		const czMax = Math.floor(maxZ / this.cellSize);
		for (let cx = cxMin; cx <= cxMax; cx++) {
			for (let cz = czMin; cz <= czMax; cz++) {
				const arr = this.cells.get(this.keyFor(cx, cz));
				if (arr) {
					for (const idx of arr) result.add(idx);
				}
			}
		}
		return result;
	}

	public queryPoint(x: number, z: number, radius: number): number[] {
		const result: number[] = [];
		const cxMin = Math.floor((x - radius) / this.cellSize);
		const cxMax = Math.floor((x + radius) / this.cellSize);
		const czMin = Math.floor((z - radius) / this.cellSize);
		const czMax = Math.floor((z + radius) / this.cellSize);
		const seen = new Set<number>();
		for (let cx = cxMin; cx <= cxMax; cx++) {
			for (let cz = czMin; cz <= czMax; cz++) {
				const arr = this.cells.get(this.keyFor(cx, cz));
				if (arr) {
					for (const idx of arr) {
						if (!seen.has(idx)) {
							seen.add(idx);
							result.push(idx);
						}
					}
				}
			}
		}
		return result;
	}
}

class WorkerInstance {
	private static TileZoom: number = 16;
	private requestTerrainHeight: boolean = true;
	private straightSkeletonReady: boolean = false;
	private corridorSegments: WorkerMessage.CorridorSegment[] = [];
	private segmentGrid: SegmentGrid | null = null;
	private debug: boolean = false;

	public constructor(private readonly ctx: Worker) {
		this.addEventListeners();
	}

	private addEventListeners(): void {
		ctx.addEventListener('message', async event => {
			if (!this.straightSkeletonReady) {
				await SkeletonBuilder.init();
				this.straightSkeletonReady = true;
			}

			const data = event.data as WorkerMessage.ToWorker;
			const x = data.tile[0];
			const y = data.tile[1];

	if (data.type === WorkerMessage.ToWorkerType.SetCorridorSegments) {
		this.corridorSegments = data.corridorSegments ?? [];
		this.segmentGrid = this.corridorSegments.length > 0
			? new SegmentGrid(this.corridorSegments)
			: null;
		if (data.debug !== undefined) this.debug = data.debug;
		if (this.debug) {
			console.log(`[Worker] Received ${this.corridorSegments.length} corridor segments, grid built`);
		}
		return;
	}

			if (data.type === WorkerMessage.ToWorkerType.Start) {
				this.requestTerrainHeight = data.isTerrainHeightEnabled;
				if (data.debug !== undefined) this.debug = data.debug;

				this.fetchTile(
					x,
					y,
					data.overpassEndpoints,
					data.tileServerEndpoint,
					data.vectorTilesEndpointTemplate,
					data.useOverpassForBuildings,
				);
			}
		});
	}

	private fetchTile(
		x: number,
		y: number,
		overpassEndpoints: string[],
		tileServerEndpoint: string,
		vectorTilesEndpointTemplate: string,
		useOverpassForBuildings: boolean,
	): void {
		const provider = new Tile3DFromVectorProvider({
			overpassEndpoints,
			tileServerEndpoint,
			vectorTilesEndpointTemplate,
			useOverpassForBuildings,
			heightPromise: (positions: Float64Array): Promise<Float64Array> => this.getTerrainHeight(x, y, positions)
		});
		const collectionPromise = provider.getCollection({x, y, zoom: WorkerInstance.TileZoom});

		collectionPromise.then(collection => {
			this.applyCorridorClearing(collection, x, y);
			this.injectSyntheticRailway(collection, x, y);

			const buffers = Tile3DFeaturesToBuffersConverter.convert(collection);

			this.sendBuffers(x, y, buffers);
		}).catch(error => {
			console.error(error);

			this.sendError(x, y, error);
		})
	}

	private static readonly WORLD_SIZE = 40075016.68;
	private static readonly RAILWAY_BASE_WIDTH = 2.5;

	private injectSyntheticRailway(collection: Tile3DFeatureCollection, tileX: number, tileY: number): void {
		if (!this.segmentGrid || this.corridorSegments.length === 0) return;

		const zoom = WorkerInstance.TileZoom;
		const tileSize = WorkerInstance.WORLD_SIZE / (1 << zoom);
		const tileOffset = MathUtils.tile2meters(tileX, tileY + 1, zoom);
		const mercatorScale = MathUtils.getMercatorScaleFactorForTile(tileX, tileY, zoom);
		const margin = 20;

		const tileMinX = tileOffset.x - margin;
		const tileMaxX = tileOffset.x + tileSize + margin;
		const tileMinZ = tileOffset.y - margin;
		const tileMaxZ = tileOffset.y + tileSize + margin;
		const nearbyIdxs = this.segmentGrid.queryRect(tileMinX, tileMinZ, tileMaxX, tileMaxZ);

		const allLocalPoints: Vec2[] = [];

		for (const idx of nearbyIdxs) {
			const seg = this.corridorSegments[idx];
			const lx1 = seg.x1 - tileOffset.x;
			const lz1 = seg.z1 - tileOffset.y;
			const lx2 = seg.x2 - tileOffset.x;
			const lz2 = seg.z2 - tileOffset.y;

			if (allLocalPoints.length === 0) {
				allLocalPoints.push(new Vec2(lx1, lz1));
			}
			allLocalPoints.push(new Vec2(lx2, lz2));
		}

		if (allLocalPoints.length < 2) return;

		const width = WorkerInstance.RAILWAY_BASE_WIDTH;
		const scaledWidth = width * mercatorScale;
		const uvScaleY = width * mercatorScale * 4;

		const layerParams = [
			{textureId: ProjectedTextures.Railway, zIndex: ZIndexMap.Railway},
			{textureId: ProjectedTextures.RailwayTop, zIndex: ZIndexMap.RailwayOverlay},
			{textureId: ProjectedTextures.Rail, zIndex: ZIndexMap.Rail},
		];

		for (const layer of layerParams) {
			const builder = new Tile3DProjectedGeometryBuilder();
			builder.setZIndex(layer.zIndex);
			builder.addRing(Tile3DRingType.Outer, allLocalPoints);
			builder.addPath({
				width: scaledWidth * 2,
				uvFollowRoad: true,
				uvMinX: 0,
				uvMaxX: 1,
				uvScaleY: uvScaleY,
				textureId: layer.textureId,
			});
			collection.projected.push(builder.getGeometry());
		}

		if (this.debug) {
			console.log(`[Worker] Tile ${tileX},${tileY}: injected synthetic railway (${allLocalPoints.length} points)`);
		}
	}

	private static readonly RAILWAY_ZINDICES = new Set([11, 12, 28]);

	private applyCorridorClearing(collection: Tile3DFeatureCollection, tileX: number, tileY: number): void {
		if (!this.segmentGrid || this.corridorSegments.length === 0) {
			return;
		}

		const tileOffset = MathUtils.tile2meters(tileX, tileY + 1, WorkerInstance.TileZoom);
		const origExtruded = collection.extruded.length;
		const grid = this.segmentGrid;
		const segments = this.corridorSegments;
		const maxRadius = 15;

		collection.extruded = collection.extruded.filter(feature => {
			const bb = feature.boundingBox;
			const centerX = (bb.min.x + bb.max.x) / 2 + tileOffset.x;
			const centerZ = (bb.min.z + bb.max.z) / 2 + tileOffset.y;

			const nearby = grid.queryPoint(centerX, centerZ, maxRadius);
			for (const idx of nearby) {
				const seg = segments[idx];
				const d = WorkerInstance.pointToSegmentDist(
					centerX, centerZ,
					seg.x1, seg.z1,
					seg.x2, seg.z2
				);
				if (d < seg.radius) {
					return false;
				}
			}
			return true;
		});

		if (this.debug) {
			const removedExtruded = origExtruded - collection.extruded.length;
			console.log(
				`[Worker] Tile ${tileX},${tileY}: corridor clearing removed ` +
				`${removedExtruded}/${origExtruded} extruded ` +
				`(${this.corridorSegments.length} segments)`
			);
		}
	}

	private static pointToSegmentDist(
		px: number, pz: number,
		ax: number, az: number,
		bx: number, bz: number,
	): number {
		const dx = bx - ax, dz = bz - az;
		const lenSq = dx * dx + dz * dz;
		if (lenSq < 1e-10) {
			return Math.sqrt((px - ax) ** 2 + (pz - az) ** 2);
		}
		const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
		const projX = ax + t * dx, projZ = az + t * dz;
		return Math.sqrt((px - projX) ** 2 + (pz - projZ) ** 2);
	}

	private sendMessage(msg: WorkerMessage.FromWorker, transferables: Transferable[] = []): void {
		this.ctx.postMessage(msg, transferables);
	}

	private sendBuffers(x: number, y: number, buffers: Tile3DBuffers): void {
		this.sendMessage(
			{
				type: WorkerMessage.FromWorkerType.Success,
				tile: [x, y],
				payload: buffers
			},
			getTile3DBuffersTransferables(buffers)
		)
	}

	private sendError(x: number, y: number, error: string): void {
		this.sendMessage({
			type: WorkerMessage.FromWorkerType.Error,
			tile: [x, y],
			payload: error
		});
	}

	private sendHeightRequest(x: number, y: number, positions: Float64Array): void {
		this.sendMessage({
			type: WorkerMessage.FromWorkerType.RequestHeight,
			tile: [x, y],
			payload: positions
		}, [positions.buffer]);
	}

	private async getTerrainHeight(x: number, y: number, positions: Float64Array): Promise<Float64Array> {
		return new Promise((resolve) => {
			if (!this.requestTerrainHeight) {
				const heightArray = new Float64Array(positions.length / 2);

				for (let i = 0; i < heightArray.length; i++) {
					heightArray[i] = 0;
				}

				resolve(heightArray);
				return;
			}

			const handler = async (event: MessageEvent): Promise<void> => {
				const data = event.data as WorkerMessage.ToWorker;

				if (x !== data.tile[0] || y !== data.tile[1] || data.type !== WorkerMessage.ToWorkerType.Height) {
					return;
				}

				ctx.removeEventListener('message', handler);

				resolve(data.height);
			};

			ctx.addEventListener('message', handler);

			WorkerInstance.applyTileOffsetToHeightPositions(positions, x, y);
			this.sendHeightRequest(x, y, positions);
		});
	}

	private static applyTileOffsetToHeightPositions(heightPositions: Float64Array, x: number, y: number): void {
		const offset = MathUtils.tile2meters(x, y + 1, this.TileZoom);

		for (let i = 0; i < heightPositions.length; i += 2) {
			heightPositions[i] += offset.x;
			heightPositions[i + 1] += offset.y;
		}
	}
}

new WorkerInstance(self as unknown as Worker);
