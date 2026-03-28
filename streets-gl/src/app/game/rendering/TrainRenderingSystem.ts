import System from '~/app/System';
import SceneSystem from '~/app/systems/SceneSystem';
import TerrainSystem from '~/app/systems/TerrainSystem';
import TrainSystem from '~/app/game/TrainSystem';
import TrainMeshObject from './TrainMeshObject';
import {buildTrainCarGeometry, buildTrackGeometry, buildStationGeometry, GeometryBuffers} from './TrainGeometry';
import MathUtils from '~/lib/math/MathUtils';
import {bearing} from '~/app/game/data/CoordinateSystem';
import {getPositionAtDistance} from '~/app/game/data/TrackBuilder';
import AssetConfigSystem from '~/app/game/assets/AssetConfigSystem';
import {debugLog} from '~/app/game/debug';

const TRACK_HEIGHT_OFFSET = 0.05;
const STATION_PLATFORM_OFFSET = 7;
const TARGET_CAR_WIDTH = 3.0;
const DEFAULT_CAR_COUNT = 3;
const CAR_GAP = 0.5;
const TARGET_STATION_LENGTH = 40;
const MAX_STATION_SCALE = 100;
const MIN_STATION_SCALE = 0.01;

export default class TrainRenderingSystem extends System {
	public trainMesh: TrainMeshObject | null = null;
	public trackMesh: TrainMeshObject | null = null;
	public stationMeshes: TrainMeshObject[] = [];

	private lastLineIdx: number = -1;
	private terrainCheckTimer: number = 0;
	private lastTerrainSample: number = 0;
	private terrainSettled: boolean = false;
	private lastTrainModelId: string = '';
	private lastLocoModelId: string = '';
	private lastStationModelId: string = '';
	private glbCache: Map<string, GeometryBuffers> = new Map();
	private catalogReady: boolean = false;
	private pendingModelRebuild: boolean = false;

	public postInit(): void {
		this.systemManager.onSystemReady(TrainSystem, () => {
			this.rebuildAll();
		});

		const assetConfig = this.systemManager.getSystem(AssetConfigSystem);
		if (assetConfig) {
			assetConfig.onChange(() => this.onConfigChanged());
		}
	}

	private onConfigChanged(): void {
		const assetConfig = this.systemManager.getSystem(AssetConfigSystem);
		if (!assetConfig) return;

		const config = assetConfig.getConfig();
		const trainSystem = this.systemManager.getSystem(TrainSystem);
		const ls = trainSystem?.getCurrentLine();

		const locoId = config.locomotiveModel || 'procedural-default';
		if (config.trainModel !== this.lastTrainModelId || locoId !== this.lastLocoModelId) {
			debugLog(`[TrainRenderingSystem] Config changed: train=${this.lastTrainModelId}->${config.trainModel}, loco=${this.lastLocoModelId}->${locoId}`);
			if (ls) {
				this.rebuildTrainMesh(ls.parsed.color);
			}
		}

		if (config.stationModel !== this.lastStationModelId) {
			debugLog(`[TrainRenderingSystem] Config changed: station model ${this.lastStationModelId} -> ${config.stationModel}`);
			if (trainSystem) {
				this.rebuildStations(trainSystem);
			}
		}
	}

	public rebuildAll(): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);
		if (!trainSystem) return;

		const ls = trainSystem.getCurrentLine();
		if (!ls) return;

		this.rebuildTrainMesh(ls.parsed.color);
		this.rebuildTrack(trainSystem);
		this.rebuildStations(trainSystem);
	}

	private getTerrainHeight(x: number, z: number): number {
		const terrainSystem = this.systemManager.getSystem(TerrainSystem);
		if (!terrainSystem?.terrainHeightProvider) return 0;
		const h = terrainSystem.terrainHeightProvider.getHeightGlobalInterpolated(x, z, true);
		return h ?? 0;
	}

	private rebuildTrainMesh(color: string): void {
		const assetConfig = this.systemManager.getSystem(AssetConfigSystem);
		if (!assetConfig) {
			this.applyTrainBuffers(buildTrainCarGeometry(color));
			return;
		}
		const config = assetConfig.getConfig();
		const catalog = assetConfig.getCatalog();
		const carModelId = config.trainModel || 'procedural-default';
		const locoModelId = config.locomotiveModel || 'procedural-default';
		const carCount = config.carCount ?? DEFAULT_CAR_COUNT;

		this.lastTrainModelId = carModelId;
		this.lastLocoModelId = locoModelId;

		const hasDistinctLoco = locoModelId !== 'procedural-default' && locoModelId !== carModelId;

		if (carModelId !== 'procedural-default' || hasDistinctLoco) {
			if (!catalog) {
				debugLog(`[TrainRenderingSystem] Catalog not loaded yet, will retry`);
				this.pendingModelRebuild = true;
				this.applyTrainBuffers(buildTrainCarGeometry(color));
				return;
			}

			if (hasDistinctLoco) {
				this.loadLocoAndCars(catalog, assetConfig, locoModelId, carModelId, carCount, color);
			} else if (carModelId !== 'procedural-default') {
				const entry = catalog.models.trains.find(e => e.id === carModelId);
				if (entry?.path) {
					if (this.glbCache.has(carModelId)) {
						const cached = this.glbCache.get(carModelId);
						if (cached) {
							const assembled = this.assembleMultiCar(cached, carCount);
							this.applyTrainBuffers(assembled);
							debugLog(`[TrainRenderingSystem] Applied cached car model: ${carModelId} (${carCount} cars)`);
							return;
						}
					}
					const url = assetConfig.getAssetUrl(entry.path);
					debugLog(`[TrainRenderingSystem] Loading GLB model: ${carModelId} from ${url}`);
					this.loadGLBModel(url, carModelId, color, carCount);
					return;
				} else {
					console.warn(`[TrainRenderingSystem] No path for car model: ${carModelId}`);
				}
			}

			if (hasDistinctLoco) return;
		}

		this.applyTrainBuffers(buildTrainCarGeometry(color));
	}

	private async loadLocoAndCars(
		catalog: any,
		assetConfig: AssetConfigSystem,
		locoModelId: string,
		carModelId: string,
		carCount: number,
		fallbackColor: string,
	): Promise<void> {
		try {
			const locoEntry = catalog.models.trains.find((e: any) => e.id === locoModelId);
			const carEntry = carModelId !== 'procedural-default'
				? catalog.models.trains.find((e: any) => e.id === carModelId)
				: null;

			if (!locoEntry?.path) {
				console.warn(`[TrainRenderingSystem] No path for locomotive model: ${locoModelId}`);
				this.applyTrainBuffers(buildTrainCarGeometry(fallbackColor));
				return;
			}

			let locoBuffers: GeometryBuffers | null = this.glbCache.get(locoModelId) || null;
			if (!locoBuffers) {
				const url = assetConfig.getAssetUrl(locoEntry.path);
				debugLog(`[TrainRenderingSystem] Loading locomotive GLB: ${locoModelId}`);
				const resp = await fetch(url);
				if (!resp.ok) throw new Error(`HTTP ${resp.status} loading loco ${url}`);
				const ab = await resp.arrayBuffer();
				const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
				locoBuffers = await this.parseGLBWithTextures(ab, baseUrl);
				if (locoBuffers) this.glbCache.set(locoModelId, locoBuffers);
			}

			if (!locoBuffers) {
				console.error(`[TrainRenderingSystem] Failed to parse loco GLB: ${locoModelId}`);
				this.applyTrainBuffers(buildTrainCarGeometry(fallbackColor));
				return;
			}

			let carBuffers: GeometryBuffers | null = null;
			if (carEntry?.path && carCount > 0) {
				carBuffers = this.glbCache.get(carModelId) || null;
				if (!carBuffers) {
					const url = assetConfig.getAssetUrl(carEntry.path);
					debugLog(`[TrainRenderingSystem] Loading car GLB: ${carModelId}`);
					const resp = await fetch(url);
					if (!resp.ok) throw new Error(`HTTP ${resp.status} loading car ${url}`);
					const ab = await resp.arrayBuffer();
					const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
					carBuffers = await this.parseGLBWithTextures(ab, baseUrl);
					if (carBuffers) this.glbCache.set(carModelId, carBuffers);
				}
			}

			const assembled = this.assembleLocoAndCars(locoBuffers, carBuffers, carCount);
			this.applyTrainBuffers(assembled);
			debugLog(`[TrainRenderingSystem] Assembled loco + ${carCount} cars (loco=${locoModelId}, car=${carModelId})`);
		} catch (err) {
			console.error(`[TrainRenderingSystem] Failed to load loco+car models:`, err);
			this.applyTrainBuffers(buildTrainCarGeometry(fallbackColor));
		}
	}

	private applyTrainBuffers(buffers: GeometryBuffers): void {
		if (this.trainMesh) {
			this.trainMesh.setBuffers(buffers);
		} else {
			this.trainMesh = new TrainMeshObject(buffers);
			const sceneSystem = this.systemManager.getSystem(SceneSystem);
			if (sceneSystem) {
				sceneSystem.objects.wrapper.add(this.trainMesh);
			}
		}
	}

	private async loadGLBModel(url: string, modelId: string, fallbackColor: string, carCount: number): Promise<void> {
		try {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status} loading ${url}`);
			}
			const arrayBuffer = await response.arrayBuffer();
			const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
			const singleCar = await this.parseGLBWithTextures(arrayBuffer, baseUrl);

			if (singleCar) {
				this.glbCache.set(modelId, singleCar);
				const assembled = this.assembleMultiCar(singleCar, carCount);
				this.applyTrainBuffers(assembled);
				debugLog(`[TrainRenderingSystem] Loaded GLB: ${modelId} (${singleCar.position.length / 3} verts/car, ${carCount} cars)`);
			} else {
				console.error(`[TrainRenderingSystem] Failed to parse GLB: ${modelId}`);
				this.applyTrainBuffers(buildTrainCarGeometry(fallbackColor));
			}
		} catch (err) {
			console.error(`[TrainRenderingSystem] Failed to load GLB model ${modelId}:`, err);
			this.applyTrainBuffers(buildTrainCarGeometry(fallbackColor));
		}
	}

	private assembleMultiCar(singleCar: GeometryBuffers, carCount: number): GeometryBuffers {
		const vertCount = singleCar.position.length / 3;
		const idxCount = singleCar.indices.length;

		let minZ = Infinity, maxZ = -Infinity;
		for (let i = 0; i < vertCount; i++) {
			const z = singleCar.position[i * 3 + 2];
			if (z < minZ) minZ = z;
			if (z > maxZ) maxZ = z;
		}
		const carLength = maxZ - minZ;
		const spacing = carLength + CAR_GAP;

		const totalVerts = vertCount * carCount;
		const totalIdx = idxCount * carCount;
		const positions = new Float32Array(totalVerts * 3);
		const normals = new Float32Array(totalVerts * 3);
		const colors = new Float32Array(totalVerts * 3);
		const indices = new Uint32Array(totalIdx);

		for (let c = 0; c < carCount; c++) {
			const zOffset = (c - (carCount - 1) / 2) * spacing;
			const vBase = c * vertCount;

			for (let v = 0; v < vertCount; v++) {
				positions[(vBase + v) * 3] = singleCar.position[v * 3];
				positions[(vBase + v) * 3 + 1] = singleCar.position[v * 3 + 1];
				positions[(vBase + v) * 3 + 2] = singleCar.position[v * 3 + 2] + zOffset;

				normals[(vBase + v) * 3] = singleCar.normal[v * 3];
				normals[(vBase + v) * 3 + 1] = singleCar.normal[v * 3 + 1];
				normals[(vBase + v) * 3 + 2] = singleCar.normal[v * 3 + 2];

				colors[(vBase + v) * 3] = singleCar.color[v * 3];
				colors[(vBase + v) * 3 + 1] = singleCar.color[v * 3 + 1];
				colors[(vBase + v) * 3 + 2] = singleCar.color[v * 3 + 2];
			}

			const iBase = c * idxCount;
			for (let i = 0; i < idxCount; i++) {
				indices[iBase + i] = singleCar.indices[i] + vBase;
			}
		}

		return {position: positions, normal: normals, color: colors, indices};
	}

	private assembleLocoAndCars(
		loco: GeometryBuffers,
		car: GeometryBuffers | null,
		carCount: number,
	): GeometryBuffers {
		const getZExtent = (buf: GeometryBuffers): {minZ: number; maxZ: number; length: number} => {
			let mn = Infinity, mx = -Infinity;
			const vc = buf.position.length / 3;
			for (let i = 0; i < vc; i++) {
				const z = buf.position[i * 3 + 2];
				if (z < mn) mn = z;
				if (z > mx) mx = z;
			}
			return {minZ: mn, maxZ: mx, length: mx - mn};
		};

		const locoZ = getZExtent(loco);
		const effectiveCarCount = car ? carCount : 0;
		const totalPieces = 1 + effectiveCarCount;

		let carZ = {minZ: 0, maxZ: 0, length: 0};
		if (car) {
			carZ = getZExtent(car);
		}

		const locoVerts = loco.position.length / 3;
		const locoIdxCount = loco.indices.length;
		const carVerts = car ? car.position.length / 3 : 0;
		const carIdxCount = car ? car.indices.length : 0;

		const totalVerts = locoVerts + carVerts * effectiveCarCount;
		const totalIdx = locoIdxCount + carIdxCount * effectiveCarCount;

		const positions = new Float32Array(totalVerts * 3);
		const normals = new Float32Array(totalVerts * 3);
		const colors = new Float32Array(totalVerts * 3);
		const indices = new Uint32Array(totalIdx);

		const totalTrainLength = locoZ.length + effectiveCarCount * (carZ.length + CAR_GAP) + (effectiveCarCount > 0 ? CAR_GAP : 0);
		const frontOffset = totalTrainLength / 2;
		const locoOffset = frontOffset - locoZ.length / 2;

		for (let v = 0; v < locoVerts; v++) {
			positions[v * 3] = loco.position[v * 3];
			positions[v * 3 + 1] = loco.position[v * 3 + 1];
			positions[v * 3 + 2] = loco.position[v * 3 + 2] + locoOffset;
			normals[v * 3] = loco.normal[v * 3];
			normals[v * 3 + 1] = loco.normal[v * 3 + 1];
			normals[v * 3 + 2] = loco.normal[v * 3 + 2];
			colors[v * 3] = loco.color[v * 3];
			colors[v * 3 + 1] = loco.color[v * 3 + 1];
			colors[v * 3 + 2] = loco.color[v * 3 + 2];
		}
		for (let i = 0; i < locoIdxCount; i++) {
			indices[i] = loco.indices[i];
		}

		if (car) {
			const carSpacing = carZ.length + CAR_GAP;
			let carStartZ = locoOffset - locoZ.length / 2 - CAR_GAP - carZ.length / 2;

			for (let c = 0; c < effectiveCarCount; c++) {
				const zOff = carStartZ - c * carSpacing;
				const vBase = locoVerts + c * carVerts;

				for (let v = 0; v < carVerts; v++) {
					positions[(vBase + v) * 3] = car.position[v * 3];
					positions[(vBase + v) * 3 + 1] = car.position[v * 3 + 1];
					positions[(vBase + v) * 3 + 2] = car.position[v * 3 + 2] + zOff;
					normals[(vBase + v) * 3] = car.normal[v * 3];
					normals[(vBase + v) * 3 + 1] = car.normal[v * 3 + 1];
					normals[(vBase + v) * 3 + 2] = car.normal[v * 3 + 2];
					colors[(vBase + v) * 3] = car.color[v * 3];
					colors[(vBase + v) * 3 + 1] = car.color[v * 3 + 1];
					colors[(vBase + v) * 3 + 2] = car.color[v * 3 + 2];
				}

				const iBase = locoIdxCount + c * carIdxCount;
				for (let i = 0; i < carIdxCount; i++) {
					indices[iBase + i] = car.indices[i] + vBase;
				}
			}
		}

		debugLog(
			`[TrainRenderingSystem] AssembleLocoAndCars: loco=${locoVerts} verts, ` +
			`car=${carVerts} verts x ${effectiveCarCount}, total=${totalVerts} verts, ` +
			`total length=${totalTrainLength.toFixed(1)}m`
		);

		return {position: positions, normal: normals, color: colors, indices};
	}

	private async parseGLBWithTextures(buffer: ArrayBuffer, baseUrl: string, skipScaling = false): Promise<GeometryBuffers | null> {
		const view = new DataView(buffer);
		if (view.getUint32(0, true) !== 0x46546C67) {
			console.error('[TrainRenderingSystem] Not a valid GLB file');
			return null;
		}

		let jsonChunk: any = null;
		let binChunk: ArrayBuffer | null = null;
		let offset = 12;

		while (offset < buffer.byteLength) {
			const chunkLength = view.getUint32(offset, true);
			const chunkType = view.getUint32(offset + 4, true);

			if (chunkType === 0x4E4F534A) {
				const jsonBytes = new Uint8Array(buffer, offset + 8, chunkLength);
				jsonChunk = JSON.parse(new TextDecoder().decode(jsonBytes));
			} else if (chunkType === 0x004E4942) {
				binChunk = buffer.slice(offset + 8, offset + 8 + chunkLength);
			}
			offset += 8 + chunkLength;
		}

		if (!jsonChunk || !binChunk) {
			console.error('[TrainRenderingSystem] GLB missing JSON or BIN chunk');
			return null;
		}

		const texturePixels = await this.loadGLTFTextures(jsonChunk, baseUrl, binChunk);

		const allPositions: number[] = [];
		const allNormals: number[] = [];
		const allColors: number[] = [];
		const allIndices: number[] = [];

		const nodeTransforms = this.computeNodeTransforms(jsonChunk);

		for (let nodeIdx = 0; nodeIdx < (jsonChunk.nodes || []).length; nodeIdx++) {
			const node = jsonChunk.nodes[nodeIdx];
			if (node.mesh === undefined) continue;

			const mesh = jsonChunk.meshes[node.mesh];
			if (!mesh) continue;

			const worldMatrix = nodeTransforms[nodeIdx];

			for (const prim of mesh.primitives || []) {
				const posAccessorIdx = prim.attributes?.POSITION;
				if (posAccessorIdx === undefined) continue;

				const baseVertex = allPositions.length / 3;
				const posData = this.extractAccessorData(jsonChunk, binChunk, posAccessorIdx);
				if (!posData) continue;
				const vertCount = posData.length / 3;

				for (let i = 0; i < vertCount; i++) {
					const [px, py, pz] = this.transformPoint(
						worldMatrix,
						posData[i * 3], posData[i * 3 + 1], posData[i * 3 + 2],
					);
					allPositions.push(px, py, pz);
				}

				const normalAccessorIdx = prim.attributes?.NORMAL;
				if (normalAccessorIdx !== undefined) {
					const normData = this.extractAccessorData(jsonChunk, binChunk, normalAccessorIdx);
					if (normData) {
						for (let i = 0; i < normData.length / 3; i++) {
							const [nx, ny, nz] = this.transformNormal(
								worldMatrix,
								normData[i * 3], normData[i * 3 + 1], normData[i * 3 + 2],
							);
							allNormals.push(nx, ny, nz);
						}
					}
				}
				while (allNormals.length < allPositions.length) {
					allNormals.push(0, 1, 0);
				}

				const materialIdx = prim.material;
				const material = materialIdx !== undefined ? jsonChunk.materials?.[materialIdx] : null;
				const pbr = material?.pbrMetallicRoughness;

				const hasVertexColors = prim.attributes?.COLOR_0 !== undefined;
				let colorsApplied = false;

				if (hasVertexColors) {
					const colorData = this.extractAccessorData(jsonChunk, binChunk, prim.attributes.COLOR_0);
					if (colorData) {
						const stride = colorData.length / vertCount;
						for (let v = 0; v < vertCount; v++) {
							allColors.push(colorData[v * stride], colorData[v * stride + 1], colorData[v * stride + 2]);
						}
						colorsApplied = true;
					}
				}

				if (!colorsApplied) {
					let texColors: number[] | null = null;

					if (pbr?.baseColorTexture !== undefined && texturePixels) {
						const texIdx = pbr.baseColorTexture.index;
						const texture = jsonChunk.textures?.[texIdx];
						const imgIdx = texture?.source;
						const pixels = texturePixels.get(imgIdx);

						if (pixels) {
							const uvAccessorIdx = prim.attributes?.TEXCOORD_0;
							if (uvAccessorIdx !== undefined) {
								const uvData = this.extractAccessorData(jsonChunk, binChunk, uvAccessorIdx);
								if (uvData) {
									texColors = [];
									this.sampleTextureColors(uvData, pixels, vertCount, texColors);
								}
							}
						}
					}

					const factor = pbr?.baseColorFactor;
					const fr = factor ? factor[0] : 1;
					const fg = factor ? factor[1] : 1;
					const fb = factor ? factor[2] : 1;

					if (texColors) {
						for (let v = 0; v < vertCount; v++) {
							allColors.push(texColors[v * 3] * fr, texColors[v * 3 + 1] * fg, texColors[v * 3 + 2] * fb);
						}
						colorsApplied = true;
					} else if (factor) {
						for (let v = 0; v < vertCount; v++) {
							allColors.push(fr, fg, fb);
						}
						colorsApplied = true;
					}
				}

				if (!colorsApplied) {
					for (let v = 0; v < vertCount; v++) {
						allColors.push(0.6, 0.6, 0.65);
					}
				}

				if (prim.indices !== undefined) {
					const idxData = this.extractAccessorData(jsonChunk, binChunk, prim.indices);
					if (idxData) {
						for (let i = 0; i < idxData.length; i++) {
							allIndices.push(idxData[i] + baseVertex);
						}
					}
				} else {
					for (let i = 0; i < vertCount; i++) {
						allIndices.push(baseVertex + i);
					}
				}
			}
		}

		if (allPositions.length === 0) {
			console.error('[TrainRenderingSystem] GLB had no geometry');
			return null;
		}

		if (!skipScaling) {
			this.scaleAndCenterModel(allPositions, allNormals);
		}

		return {
			position: new Float32Array(allPositions),
			normal: new Float32Array(allNormals),
			color: new Float32Array(allColors),
			indices: new Uint32Array(allIndices),
		};
	}

	private scaleAndCenterModel(positions: number[], normals?: number[]): void {
		let minX = Infinity, maxX = -Infinity;
		let minY = Infinity, maxY = -Infinity;
		let minZ = Infinity, maxZ = -Infinity;
		const vertCount = positions.length / 3;

		for (let i = 0; i < vertCount; i++) {
			const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
			if (x < minX) minX = x; if (x > maxX) maxX = x;
			if (y < minY) minY = y; if (y > maxY) maxY = y;
			if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
		}

		const extentX = maxX - minX;
		const extentY = maxY - minY;
		const extentZ = maxZ - minZ;

		const ratio = Math.max(extentX, extentZ) > 0.001
			? Math.min(extentX, extentZ) / Math.max(extentX, extentZ) : 1;
		const needsRotation = extentX > extentZ && ratio < 0.9;

		const widthExtent = needsRotation ? extentZ : extentX;
		const scale = widthExtent > 0.01 ? TARGET_CAR_WIDTH / widthExtent : 1;

		const centerX = (minX + maxX) / 2;
		const centerZ = (minZ + maxZ) / 2;

		const finalW = (needsRotation ? extentZ : extentX) * scale;
		const finalH = extentY * scale;
		const finalL = (needsRotation ? extentX : extentZ) * scale;
		debugLog(
			`[TrainRenderingSystem] Model: raw ${extentX.toFixed(2)}x${extentY.toFixed(2)}x${extentZ.toFixed(2)}, ` +
			`scaled ${finalW.toFixed(1)}x${finalH.toFixed(1)}x${finalL.toFixed(1)} ` +
			`(scale=${scale.toFixed(3)}, rotated=${needsRotation})`
		);

		for (let i = 0; i < vertCount; i++) {
			let lx = (positions[i * 3] - centerX) * scale;
			const ly = (positions[i * 3 + 1] - minY) * scale;
			let lz = (positions[i * 3 + 2] - centerZ) * scale;

			if (needsRotation) {
				const tmp = lx;
				lx = -lz;
				lz = tmp;
			}

			positions[i * 3] = lx;
			positions[i * 3 + 1] = ly;
			positions[i * 3 + 2] = lz;

			if (needsRotation && normals) {
				const nx = normals[i * 3];
				const nz = normals[i * 3 + 2];
				normals[i * 3] = -nz;
				normals[i * 3 + 2] = nx;
			}
		}
	}

	private computeNodeTransforms(gltf: any): Float64Array[] {
		const nodes = gltf.nodes || [];
		const localMatrices: Float64Array[] = [];

		for (const node of nodes) {
			const m = new Float64Array(16);
			if (node.matrix) {
				for (let i = 0; i < 16; i++) m[i] = node.matrix[i];
			} else {
				this.composeTRS(
					node.translation || [0, 0, 0],
					node.rotation || [0, 0, 0, 1],
					node.scale || [1, 1, 1],
					m,
				);
			}
			localMatrices.push(m);
		}

		const worldMatrices: Float64Array[] = localMatrices.map(m => {
			const w = new Float64Array(16);
			for (let i = 0; i < 16; i++) w[i] = m[i];
			return w;
		});

		const parentMap = new Int32Array(nodes.length).fill(-1);
		for (let i = 0; i < nodes.length; i++) {
			const children: number[] = nodes[i].children || [];
			for (const c of children) {
				if (c >= 0 && c < nodes.length) parentMap[c] = i;
			}
		}

		const resolved = new Uint8Array(nodes.length);
		const resolveNode = (idx: number): void => {
			if (resolved[idx]) return;
			resolved[idx] = 1;
			const p = parentMap[idx];
			if (p >= 0) {
				resolveNode(p);
				this.multiplyMat4(worldMatrices[p], localMatrices[idx], worldMatrices[idx]);
			}
		};
		for (let i = 0; i < nodes.length; i++) resolveNode(i);

		return worldMatrices;
	}

	private composeTRS(t: number[], r: number[], s: number[], out: Float64Array): void {
		const [qx, qy, qz, qw] = r;
		const [sx, sy, sz] = s;

		const xx = qx * qx, yy = qy * qy, zz = qz * qz;
		const xy = qx * qy, xz = qx * qz, yz = qy * qz;
		const wx = qw * qx, wy = qw * qy, wz = qw * qz;

		out[0]  = (1 - 2 * (yy + zz)) * sx;
		out[1]  = (2 * (xy + wz)) * sx;
		out[2]  = (2 * (xz - wy)) * sx;
		out[3]  = 0;
		out[4]  = (2 * (xy - wz)) * sy;
		out[5]  = (1 - 2 * (xx + zz)) * sy;
		out[6]  = (2 * (yz + wx)) * sy;
		out[7]  = 0;
		out[8]  = (2 * (xz + wy)) * sz;
		out[9]  = (2 * (yz - wx)) * sz;
		out[10] = (1 - 2 * (xx + yy)) * sz;
		out[11] = 0;
		out[12] = t[0];
		out[13] = t[1];
		out[14] = t[2];
		out[15] = 1;
	}

	private multiplyMat4(a: Float64Array, b: Float64Array, out: Float64Array): void {
		const r = new Float64Array(16);
		for (let row = 0; row < 4; row++) {
			for (let col = 0; col < 4; col++) {
				r[col * 4 + row] =
					a[0 * 4 + row] * b[col * 4 + 0] +
					a[1 * 4 + row] * b[col * 4 + 1] +
					a[2 * 4 + row] * b[col * 4 + 2] +
					a[3 * 4 + row] * b[col * 4 + 3];
			}
		}
		for (let i = 0; i < 16; i++) out[i] = r[i];
	}

	private transformPoint(m: Float64Array, x: number, y: number, z: number): [number, number, number] {
		return [
			m[0] * x + m[4] * y + m[8]  * z + m[12],
			m[1] * x + m[5] * y + m[9]  * z + m[13],
			m[2] * x + m[6] * y + m[10] * z + m[14],
		];
	}

	private transformNormal(m: Float64Array, nx: number, ny: number, nz: number): [number, number, number] {
		const ox = m[0] * nx + m[4] * ny + m[8]  * nz;
		const oy = m[1] * nx + m[5] * ny + m[9]  * nz;
		const oz = m[2] * nx + m[6] * ny + m[10] * nz;
		const len = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
		return [ox / len, oy / len, oz / len];
	}

	private async loadGLTFTextures(gltf: any, baseUrl: string, binChunk?: ArrayBuffer): Promise<Map<number, {data: Uint8ClampedArray; width: number; height: number}> | null> {
		const images = gltf.images;
		if (!images || images.length === 0) return null;

		const result = new Map<number, {data: Uint8ClampedArray; width: number; height: number}>();

		for (let i = 0; i < images.length; i++) {
			const img = images[i];

			try {
				let pixels: {data: Uint8ClampedArray; width: number; height: number} | null = null;

				if (img.bufferView !== undefined && binChunk) {
					debugLog(`[TrainRenderingSystem] Texture ${i}: loading from embedded bufferView ${img.bufferView}`);
					const bv = gltf.bufferViews[img.bufferView];
					if (bv) {
						const imgBytes = new Uint8Array(binChunk, bv.byteOffset || 0, bv.byteLength);
						const mimeType = img.mimeType || 'image/png';
						const blob = new Blob([imgBytes], {type: mimeType});
						const blobUrl = URL.createObjectURL(blob);
						pixels = await this.fetchTexturePixels(blobUrl);
						URL.revokeObjectURL(blobUrl);
					}
				} else if (img.uri) {
					if (img.uri.startsWith('data:')) {
						debugLog(`[TrainRenderingSystem] Texture ${i}: loading from data URI`);
						pixels = await this.fetchTexturePixels(img.uri);
					} else {
						const primaryUrl = baseUrl + img.uri;
						debugLog(`[TrainRenderingSystem] Texture ${i}: loading external URI "${primaryUrl}"`);
						pixels = await this.fetchTexturePixels(primaryUrl);
						if (!pixels) {
							const lowered = baseUrl + img.uri.toLowerCase();
							if (lowered !== primaryUrl) {
								debugLog(`[TrainRenderingSystem] Texture ${i}: retrying with lowercase path: ${lowered}`);
								pixels = await this.fetchTexturePixels(lowered);
							}
						}
						if (!pixels) {
							console.warn(`[TrainRenderingSystem] Texture ${i}: external URI failed for "${img.uri}" (baseUrl: ${baseUrl})`);
						}
					}
				}

				if (pixels) {
					result.set(i, pixels);
					debugLog(`[TrainRenderingSystem] Loaded texture ${i}: ${pixels.width}x${pixels.height}`);
				}
			} catch (err) {
				console.error(`[TrainRenderingSystem] Failed to load texture ${i}:`, err);
			}
		}

		return result.size > 0 ? result : null;
	}

	private async fetchTexturePixels(url: string): Promise<{data: Uint8ClampedArray; width: number; height: number} | null> {
		return new Promise((resolve) => {
			const img = new Image();
			img.crossOrigin = 'anonymous';
			img.onload = (): void => {
				const canvas = document.createElement('canvas');
				canvas.width = img.width;
				canvas.height = img.height;
				const ctx = canvas.getContext('2d');
				if (!ctx) {
					console.error('[TrainRenderingSystem] Canvas 2D context unavailable');
					resolve(null);
					return;
				}
				ctx.drawImage(img, 0, 0);
				const imageData = ctx.getImageData(0, 0, img.width, img.height);
				resolve({data: imageData.data, width: img.width, height: img.height});
			};
			img.onerror = (): void => {
				console.error(`[TrainRenderingSystem] Image load failed: ${url}`);
				resolve(null);
			};
			img.src = url;
		});
	}

	private sampleTextureColors(
		uvData: Float32Array | Uint16Array | Uint32Array,
		texture: {data: Uint8ClampedArray; width: number; height: number},
		vertCount: number,
		outColors: number[],
	): void {
		const {data, width, height} = texture;

		for (let v = 0; v < vertCount; v++) {
			const u = uvData[v * 2];
			const vCoord = uvData[v * 2 + 1];

			let px = Math.floor(u * width) % width;
			let py = Math.floor(vCoord * height) % height;
			if (px < 0) px += width;
			if (py < 0) py += height;

			const idx = (py * width + px) * 4;
			outColors.push(data[idx] / 255, data[idx + 1] / 255, data[idx + 2] / 255);
		}
	}

	private extractAccessorData(gltf: any, bin: ArrayBuffer, accessorIdx: number): Float32Array | Uint16Array | Uint32Array | null {
		const accessor = gltf.accessors?.[accessorIdx];
		if (!accessor) return null;

		const bufferView = gltf.bufferViews?.[accessor.bufferView];
		if (!bufferView) return null;

		const baseOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
		const componentType = accessor.componentType;
		const count = accessor.count;
		const typeSize: Record<string, number> = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16};
		const components = typeSize[accessor.type] || 1;
		const totalElements = count * components;

		const componentBytes: Record<number, number> = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4};
		const compSize = componentBytes[componentType] || 4;
		const naturalStride = compSize * components;
		const byteStride = bufferView.byteStride || 0;

		const useDataView = (byteStride && byteStride !== naturalStride) || (baseOffset % compSize !== 0);
		const effectiveStride = (byteStride && byteStride !== naturalStride) ? byteStride : naturalStride;

		if (useDataView) {
			const result = new Float32Array(totalElements);
			const dv = new DataView(bin);
			for (let i = 0; i < count; i++) {
				const elemOffset = baseOffset + i * effectiveStride;
				for (let c = 0; c < components; c++) {
					const off = elemOffset + c * compSize;
					switch (componentType) {
						case 5126: result[i * components + c] = dv.getFloat32(off, true); break;
						case 5123: {
							const val = dv.getUint16(off, true);
							result[i * components + c] = accessor.normalized ? val / 65535 : val;
							break;
						}
						case 5125: result[i * components + c] = dv.getUint32(off, true); break;
						case 5121: {
							const val = dv.getUint8(off);
							result[i * components + c] = accessor.normalized ? val / 255 : val;
							break;
						}
						case 5120: {
							const val = dv.getInt8(off);
							result[i * components + c] = accessor.normalized ? Math.max(val / 127, -1) : val;
							break;
						}
						case 5122: {
							const val = dv.getInt16(off, true);
							result[i * components + c] = accessor.normalized ? Math.max(val / 32767, -1) : val;
							break;
						}
						default:
							result[i * components + c] = 0;
					}
				}
			}
			return result;
		}

		switch (componentType) {
			case 5126: return new Float32Array(bin, baseOffset, totalElements);
			case 5123: {
				if (accessor.normalized) {
					const raw = new Uint16Array(bin, baseOffset, totalElements);
					const result = new Float32Array(totalElements);
					for (let i = 0; i < totalElements; i++) result[i] = raw[i] / 65535;
					return result;
				}
				return new Uint16Array(bin, baseOffset, totalElements);
			}
			case 5125: return new Uint32Array(bin, baseOffset, totalElements);
			case 5121: {
				const raw = new Uint8Array(bin, baseOffset, totalElements);
				const result = new Float32Array(totalElements);
				if (accessor.normalized) {
					for (let i = 0; i < totalElements; i++) result[i] = raw[i] / 255;
				} else {
					for (let i = 0; i < totalElements; i++) result[i] = raw[i];
				}
				return result;
			}
			case 5120: {
				const raw = new Int8Array(bin, baseOffset, totalElements);
				const result = new Float32Array(totalElements);
				if (accessor.normalized) {
					for (let i = 0; i < totalElements; i++) result[i] = Math.max(raw[i] / 127, -1);
				} else {
					for (let i = 0; i < totalElements; i++) result[i] = raw[i];
				}
				return result;
			}
			case 5122: {
				const raw = new Int16Array(bin, baseOffset, totalElements);
				const result = new Float32Array(totalElements);
				if (accessor.normalized) {
					for (let i = 0; i < totalElements; i++) result[i] = Math.max(raw[i] / 32767, -1);
				} else {
					for (let i = 0; i < totalElements; i++) result[i] = raw[i];
				}
				return result;
			}
			default:
				console.warn(`[TrainRenderingSystem] Unsupported component type: ${componentType}`);
				return null;
		}
	}

	private rebuildTrack(_trainSystem: TrainSystem): void {
		// Tracks are now rendered natively by the tile pipeline via synthetic railway
		// features injected in WorkerInstance.injectSyntheticRailway. Procedural track
		// rendering is disabled.
		if (this.trackMesh) {
			const sceneSystem = this.systemManager.getSystem(SceneSystem);
			if (sceneSystem) {
				sceneSystem.objects.wrapper.remove(this.trackMesh);
			}
			this.trackMesh = null;
		}
	}

	private rebuildStations(trainSystem: TrainSystem): void {
		const sceneSystem = this.systemManager.getSystem(SceneSystem);
		if (!sceneSystem) return;

		for (const m of this.stationMeshes) {
			sceneSystem.objects.wrapper.remove(m);
		}
		this.stationMeshes = [];

		const ls = trainSystem.getCurrentLine();
		if (!ls) return;

		const assetConfig = this.systemManager.getSystem(AssetConfigSystem);
		const config = assetConfig?.getConfig();
		const catalog = assetConfig?.getCatalog();
		const modelId = config?.stationModel || 'procedural-default';
		this.lastStationModelId = modelId;

		if (modelId !== 'procedural-default' && catalog) {
			const entry = catalog.models.stations.find(e => e.id === modelId);
			if (entry?.path) {
				const cacheKey = `station:${modelId}`;
				const cached = this.glbCache.get(cacheKey);
				if (cached) {
					this.placeStationGLBs(trainSystem, ls, cached);
					return;
				}

				const url = assetConfig ? assetConfig.getAssetUrl(entry.path) : `/data/assets/${entry.path}`;
				debugLog(`[TrainRenderingSystem] Loading station GLB: ${modelId} from ${url}`);
				this.loadStationGLBModel(url, modelId, trainSystem, ls);
				return;
			} else {
				console.warn(`[TrainRenderingSystem] No path for station model: ${modelId}, falling back to procedural`);
			}
		}

		this.placeProceduralStations(ls);
	}

	private placeProceduralStations(ls: {parsed: {stations: any[]; color: string}; track: any; realStationDists: number[]}): void {
		const sceneSystem = this.systemManager.getSystem(SceneSystem);
		if (!sceneSystem) return;

		const track = ls.track;
		const stations = ls.parsed.stations;
		const realDists = ls.realStationDists;

		for (let si = 0; si < stations.length; si++) {
			const dist = realDists[si] ?? 0;

			const splinePos = getPositionAtDistance(track.spline.points, track.cumDist, dist);
			const splineNext = getPositionAtDistance(track.spline.points, track.cumDist, dist + 5);
			const tangentBearing = bearing(splinePos.lat, splinePos.lng, splineNext.lat, splineNext.lng);
			const stationHeading = Math.PI / 2 - MathUtils.toRad(tangentBearing);

			const trackCenter = MathUtils.degrees2meters(splinePos.lat, splinePos.lng);
			const perpX = Math.cos(stationHeading);
			const perpZ = -Math.sin(stationHeading);
			const offsetX = trackCenter.x + perpX * STATION_PLATFORM_OFFSET;
			const offsetZ = trackCenter.y + perpZ * STATION_PLATFORM_OFFSET;

			const h = this.getTerrainHeight(offsetX, offsetZ);

			const stationBuf = buildStationGeometry(
				offsetX, h + TRACK_HEIGHT_OFFSET, offsetZ,
				stationHeading,
				ls.parsed.color,
			);

			const meshObj = new TrainMeshObject(stationBuf);
			sceneSystem.objects.wrapper.add(meshObj);
			this.stationMeshes.push(meshObj);
		}
	}

	private async loadStationGLBModel(
		url: string, modelId: string,
		trainSystem: TrainSystem,
		ls: {parsed: {stations: any[]; color: string}; track: any; realStationDists: number[]},
	): Promise<void> {
		try {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status} loading ${url}`);
			}
			const arrayBuffer = await response.arrayBuffer();
			const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
			const parsed = await this.parseGLBWithTextures(arrayBuffer, baseUrl, true);

			if (parsed) {
				const cacheKey = `station:${modelId}`;
				this.glbCache.set(cacheKey, parsed);
				this.placeStationGLBs(trainSystem, ls, parsed);
				debugLog(`[TrainRenderingSystem] Loaded station GLB: ${modelId} (${parsed.position.length / 3} verts)`);
			} else {
				console.error(`[TrainRenderingSystem] Failed to parse station GLB: ${modelId}, using procedural`);
				this.placeProceduralStations(ls);
			}
		} catch (err) {
			console.error(`[TrainRenderingSystem] Failed to load station GLB ${modelId}:`, err);
			this.placeProceduralStations(ls);
		}
	}

	private placeStationGLBs(
		trainSystem: TrainSystem,
		ls: {parsed: {stations: any[]; color: string}; track: any; realStationDists: number[]},
		glbBuffers: GeometryBuffers,
	): void {
		const sceneSystem = this.systemManager.getSystem(SceneSystem);
		if (!sceneSystem) return;

		const track = ls.track;
		const stations = ls.parsed.stations;
		const realDists = ls.realStationDists;

		const vertCount = glbBuffers.position.length / 3;
		let minX = Infinity, maxX = -Infinity;
		let minZ = Infinity, maxZ = -Infinity;
		let minY = Infinity, maxY = -Infinity;
		for (let i = 0; i < vertCount; i++) {
			const vx = glbBuffers.position[i * 3];
			const vy = glbBuffers.position[i * 3 + 1];
			const vz = glbBuffers.position[i * 3 + 2];
			if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
			if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
			if (vz < minZ) minZ = vz; if (vz > maxZ) maxZ = vz;
		}

		const extentX = maxX - minX;
		const extentY = maxY - minY;
		const extentZ = maxZ - minZ;
		const needsRotation = extentX > extentZ;
		const longestHorizontal = Math.max(extentX, extentZ);

		let scaleFactor = longestHorizontal > 0.001 ? TARGET_STATION_LENGTH / longestHorizontal : 1;
		scaleFactor = Math.max(MIN_STATION_SCALE, Math.min(MAX_STATION_SCALE, scaleFactor));

		const cx = (minX + maxX) / 2;
		const cz = (minZ + maxZ) / 2;

		const scaledW = (needsRotation ? extentZ : extentX) * scaleFactor;
		const scaledH = extentY * scaleFactor;
		const scaledL = (needsRotation ? extentX : extentZ) * scaleFactor;
		debugLog(
			`[TrainRenderingSystem] Station model: raw ${extentX.toFixed(2)}x${extentY.toFixed(2)}x${extentZ.toFixed(2)}, ` +
			`scaled ${scaledW.toFixed(1)}x${scaledH.toFixed(1)}x${scaledL.toFixed(1)} ` +
			`(scale=${scaleFactor.toFixed(4)}, rotated=${needsRotation})`
		);

		for (let si = 0; si < stations.length; si++) {
			const dist = realDists[si] ?? 0;

			const splinePos = getPositionAtDistance(track.spline.points, track.cumDist, dist);
			const splineNext = getPositionAtDistance(track.spline.points, track.cumDist, dist + 5);
			const tangentBearing = bearing(splinePos.lat, splinePos.lng, splineNext.lat, splineNext.lng);
			const stationHeading = Math.PI / 2 - MathUtils.toRad(tangentBearing);

			const trackCenter = MathUtils.degrees2meters(splinePos.lat, splinePos.lng);
			const perpX = Math.cos(stationHeading);
			const perpZ = -Math.sin(stationHeading);
			const worldX = trackCenter.x + perpX * STATION_PLATFORM_OFFSET;
			const worldZ = trackCenter.y + perpZ * STATION_PLATFORM_OFFSET;
			const h = this.getTerrainHeight(worldX, worldZ) + TRACK_HEIGHT_OFFSET;

			const cosH = Math.cos(stationHeading);
			const sinH = Math.sin(stationHeading);

			const positions: number[] = [];
			const normals: number[] = [];
			const colors: number[] = [];
			const indices: number[] = [];

			for (let i = 0; i < vertCount; i++) {
				let lx = (glbBuffers.position[i * 3] - cx) * scaleFactor;
				const ly = (glbBuffers.position[i * 3 + 1] - minY) * scaleFactor;
				let lz = (glbBuffers.position[i * 3 + 2] - cz) * scaleFactor;

				if (needsRotation) {
					const tmp = lx;
					lx = -lz;
					lz = tmp;
				}

				const rx = lx * cosH + lz * sinH;
				const rz = -lx * sinH + lz * cosH;

				positions.push(worldX + rx, h + ly, worldZ + rz);

				let nx = glbBuffers.normal[i * 3];
				const ny = glbBuffers.normal[i * 3 + 1];
				let nz = glbBuffers.normal[i * 3 + 2];

				if (needsRotation) {
					const tmpN = nx;
					nx = -nz;
					nz = tmpN;
				}

				normals.push(nx * cosH + nz * sinH, ny, -nx * sinH + nz * cosH);

				colors.push(
					glbBuffers.color[i * 3],
					glbBuffers.color[i * 3 + 1],
					glbBuffers.color[i * 3 + 2],
				);
			}

			for (let i = 0; i < glbBuffers.indices.length; i++) {
				indices.push(glbBuffers.indices[i]);
			}

			const meshObj = new TrainMeshObject({
				position: new Float32Array(positions),
				normal: new Float32Array(normals),
				color: new Float32Array(colors),
				indices: new Uint32Array(indices),
			});
			sceneSystem.objects.wrapper.add(meshObj);
			this.stationMeshes.push(meshObj);
		}
	}

	private configPollTimer: number = 0;
	private static readonly CONFIG_POLL_INTERVAL = 2.0;

	public update(deltaTime: number): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);
		if (!trainSystem) return;

		if (trainSystem.currentLineIdx !== this.lastLineIdx && trainSystem.lines.length > 0) {
			this.lastLineIdx = trainSystem.currentLineIdx;
			this.terrainSettled = false;
			this.terrainCheckTimer = 0;
			this.rebuildAll();
		}

		if (!this.terrainSettled) {
			this.terrainCheckTimer += deltaTime;
			if (this.terrainCheckTimer > 2.0) {
				this.terrainCheckTimer = 0;
				this.recheckTerrainAndRebuild(trainSystem);
			}
		}

		if (this.pendingModelRebuild) {
			const assetConfig = this.systemManager.getSystem(AssetConfigSystem);
			if (assetConfig?.getCatalog()) {
				this.pendingModelRebuild = false;
				console.log('[TrainRenderingSystem] Catalog now available, rebuilding model');
				const ls = trainSystem.getCurrentLine();
				if (ls) this.rebuildTrainMesh(ls.parsed.color);
			}
		}

		this.configPollTimer += deltaTime;
		if (this.configPollTimer >= TrainRenderingSystem.CONFIG_POLL_INTERVAL) {
			this.configPollTimer = 0;
			this.pollConfigChanges(trainSystem);
		}

		if (!trainSystem.gameActive || !trainSystem.trainPosition || !this.trainMesh) return;

		const tp = trainSystem.trainPosition;
		this.trainMesh.position.set(tp.x, tp.height, tp.y);
		this.trainMesh.rotation.set(0, tp.heading, 0);
		this.trainMesh.updateMatrix();
	}

	private pollConfigChanges(trainSystem: TrainSystem): void {
		const assetConfig = this.systemManager.getSystem(AssetConfigSystem);
		if (!assetConfig) return;

		const config = assetConfig.getConfig();
		const currentTrainModelId = config.trainModel || 'procedural-default';
		const currentLocoModelId = config.locomotiveModel || 'procedural-default';
		if (currentTrainModelId !== this.lastTrainModelId || currentLocoModelId !== this.lastLocoModelId) {
			debugLog(`[TrainRenderingSystem] Poll detected model change: train=${this.lastTrainModelId}->${currentTrainModelId}, loco=${this.lastLocoModelId}->${currentLocoModelId}`);
			const ls = trainSystem.getCurrentLine();
			if (ls) {
				this.rebuildTrainMesh(ls.parsed.color);
			}
		}

		const currentStationModelId = config.stationModel || 'procedural-default';
		if (currentStationModelId !== this.lastStationModelId) {
			debugLog(`[TrainRenderingSystem] Poll detected station model change: ${this.lastStationModelId} -> ${currentStationModelId}`);
			this.rebuildStations(trainSystem);
		}
	}

	private recheckTerrainAndRebuild(trainSystem: TrainSystem): void {
		const ls = trainSystem.getCurrentLine();
		if (!ls) return;

		const midIdx = Math.floor(ls.track.spline.points.length / 2);
		const [lng, lat] = ls.track.spline.points[midIdx];
		const m = MathUtils.degrees2meters(lat, lng);
		const h = this.getTerrainHeight(m.x, m.y);

		if (Math.abs(h - this.lastTerrainSample) > 0.5) {
			debugLog(`[TrainRenderingSystem] Terrain changed (${this.lastTerrainSample.toFixed(1)} -> ${h.toFixed(1)}), rebuilding`);
			this.lastTerrainSample = h;
			this.rebuildAll();
		} else if (h !== 0) {
			this.terrainSettled = true;
		}
	}
}
