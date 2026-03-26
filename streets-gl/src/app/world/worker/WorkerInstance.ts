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

class WorkerInstance {
	private static TileZoom: number = 16;
	private requestTerrainHeight: boolean = true;
	private straightSkeletonReady: boolean = false;
	private corridorSegments: WorkerMessage.CorridorSegment[] = [];
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
			if (data.debug !== undefined) this.debug = data.debug;
			if (this.debug) {
				console.log(`[Worker] Received ${this.corridorSegments.length} corridor segments`);
				if (this.corridorSegments.length > 0) {
					const s = this.corridorSegments[0];
					console.log(`[Worker] First segment: (${s.x1.toFixed(1)}, ${s.z1.toFixed(1)}) -> (${s.x2.toFixed(1)}, ${s.z2.toFixed(1)}) radius=${s.radius}`);
				}
			}
			return;
		}

			if (data.type === WorkerMessage.ToWorkerType.Start) {
				this.requestTerrainHeight = data.isTerrainHeightEnabled;
				if (data.debug !== undefined) this.debug = data.debug;

				if (data.corridorSegments && data.corridorSegments.length > 0) {
					this.corridorSegments = data.corridorSegments;
				}

				this.fetchTile(
					x,
					y,
					data.overpassEndpoint,
					data.tileServerEndpoint,
					data.vectorTilesEndpointTemplate,
				);
			}
		});
	}

	private fetchTile(
		x: number,
		y: number,
		overpassEndpoint: string,
		tileServerEndpoint: string,
		vectorTilesEndpointTemplate: string,
	): void {
		const provider = new Tile3DFromVectorProvider({
			overpassEndpoint,
			tileServerEndpoint,
			vectorTilesEndpointTemplate,
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
		if (this.corridorSegments.length === 0) return;

		const zoom = WorkerInstance.TileZoom;
		const tileSize = WorkerInstance.WORLD_SIZE / (1 << zoom);
		const tileOffset = MathUtils.tile2meters(tileX, tileY + 1, zoom);
		const mercatorScale = MathUtils.getMercatorScaleFactorForTile(tileX, tileY, zoom);
		const margin = 20;

		const allLocalPoints: Vec2[] = [];

		for (const seg of this.corridorSegments) {
			const lx1 = seg.x1 - tileOffset.x;
			const lz1 = seg.z1 - tileOffset.y;
			const lx2 = seg.x2 - tileOffset.x;
			const lz2 = seg.z2 - tileOffset.y;

			const minX = Math.min(lx1, lx2);
			const maxX = Math.max(lx1, lx2);
			const minZ = Math.min(lz1, lz2);
			const maxZ = Math.max(lz1, lz2);

			if (maxX < -margin || minX > tileSize + margin || maxZ < -margin || minZ > tileSize + margin) {
				continue;
			}

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
		if (this.corridorSegments.length === 0) {
			if (this.debug) {
				console.warn(`[Worker] Tile ${tileX},${tileY}: NO corridor segments — clearing skipped`);
			}
			return;
		}

		const tileOffset = MathUtils.tile2meters(tileX, tileY + 1, WorkerInstance.TileZoom);
		const origExtruded = collection.extruded.length;

		collection.extruded = collection.extruded.filter(feature => {
			const bb = feature.boundingBox;
			const centerX = (bb.min.x + bb.max.x) / 2 + tileOffset.x;
			const centerZ = (bb.min.z + bb.max.z) / 2 + tileOffset.y;

			for (const seg of this.corridorSegments) {
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
