import System from '~/app/System';
import SceneSystem from '~/app/systems/SceneSystem';
import TerrainSystem from '~/app/systems/TerrainSystem';
import TrainSystem from '~/app/game/TrainSystem';
import TrainMeshObject from './TrainMeshObject';
import {buildTrainCarGeometry, buildTrackGeometry, buildStationGeometry, GeometryBuffers, AnimationData, NodeTRS} from './TrainGeometry';
import MathUtils from '~/lib/math/MathUtils';
import {bearing} from '~/app/game/data/CoordinateSystem';
import {getPositionAtDistance} from '~/app/game/data/TrackBuilder';
import AssetConfigSystem from '~/app/game/assets/AssetConfigSystem';
import {debugLog} from '~/app/game/debug';
import {
	parseAnimations,
	findDoorAnimationIndex,
	sampleChannelAtTime,
	composeTRS,
	multiplyMat4,
	getAnimatedNodeIndices,
	detectAnimTimeRange,
	ModelTransformParams,
	AnimatedNodeInfo,
	GLTFAnimationClip,
} from './GLTFAnimation';

const TRACK_HEIGHT_OFFSET = 0.05;
const STATION_PLATFORM_OFFSET = 7;
const TARGET_CAR_WIDTH = 3.0;
const CAR_GAP = 0.15;
const TARGET_STATION_LENGTH = 40;
const MAX_STATION_SCALE = 100;
const MIN_STATION_SCALE = 0.01;

interface CarAnimState {
	playing: boolean;
	forward: boolean;
	currentTime: number;
	animData: AnimationData;
	originalPositions: Float32Array;
	originalNormals: Float32Array;
}

export default class TrainRenderingSystem extends System {
	public carMeshes: TrainMeshObject[] = [];
	public trackMesh: TrainMeshObject | null = null;
	public stationMeshes: TrainMeshObject[] = [];

	private carOffsets: number[] = [];
	private lastLineIdx: number = -1;
	private terrainCheckTimer: number = 0;
	private lastTerrainSample: number = 0;
	private terrainSettled: boolean = false;
	private lastSlotsHash: string = '';
	private lastStationModelId: string = '';
	private glbCache: Map<string, GeometryBuffers> = new Map();
	private catalogReady: boolean = false;
	private pendingModelRebuild: boolean = false;

	private carAnimStates: CarAnimState[] = [];
	private lastDoorsOpen: boolean = false;

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

		const slotsHash = JSON.stringify(config.trainSlots);
		if (slotsHash !== this.lastSlotsHash) {
			debugLog(`[TrainRenderingSystem] Config changed: slots updated`);
			if (ls) {
				this.rebuildTrainFromSlots(config.trainSlots, ls.parsed.color);
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

		const assetConfig = this.systemManager.getSystem(AssetConfigSystem);
		const slots = assetConfig?.getConfig().trainSlots || ['procedural-default', 'procedural-default', 'procedural-default'];
		this.rebuildTrainFromSlots(slots, ls.parsed.color);
		this.rebuildTrack(trainSystem);
		this.rebuildStations(trainSystem);
	}

	private getTerrainHeight(x: number, z: number): number {
		const terrainSystem = this.systemManager.getSystem(TerrainSystem);
		if (!terrainSystem?.terrainHeightProvider) return 0;
		const h = terrainSystem.terrainHeightProvider.getHeightGlobalInterpolated(x, z, true);
		return h ?? 0;
	}

	private removeCarMeshes(): void {
		const sceneSystem = this.systemManager.getSystem(SceneSystem);
		for (const mesh of this.carMeshes) {
			if (sceneSystem) sceneSystem.objects.wrapper.remove(mesh);
		}
		this.carMeshes = [];
		this.carOffsets = [];
		this.carAnimStates = [];
		this.lastDoorsOpen = false;
	}

	private getCarLength(buf: GeometryBuffers): number {
		let minZ = Infinity, maxZ = -Infinity;
		const vc = buf.position.length / 3;
		for (let i = 0; i < vc; i++) {
			const z = buf.position[i * 3 + 2];
			if (z < minZ) minZ = z;
			if (z > maxZ) maxZ = z;
		}
		return maxZ - minZ;
	}

	private rebuildTrainFromSlots(slots: string[], fallbackColor: string): void {
		this.lastSlotsHash = JSON.stringify(slots);
		this.removeCarMeshes();

		const assetConfig = this.systemManager.getSystem(AssetConfigSystem);
		const catalog = assetConfig?.getCatalog();

		const allProcedural = slots.every(s => s === 'procedural-default');
		if (!allProcedural && !catalog) {
			debugLog('[TrainRenderingSystem] Catalog not loaded yet, will retry');
			this.pendingModelRebuild = true;
			this.applyProceduralFallback(slots.length, fallbackColor);
			return;
		}

		const uniqueIds = [...new Set(slots.filter(s => s !== 'procedural-default'))];
		const toLoad: {id: string; url: string}[] = [];
		for (const id of uniqueIds) {
			if (this.glbCache.has(id)) continue;
			const entry = catalog?.models.trains.find((e: any) => e.id === id);
			if (entry?.path && assetConfig) {
				toLoad.push({id, url: assetConfig.getAssetUrl(entry.path)});
			} else {
				console.warn(`[TrainRenderingSystem] No path for model: ${id}`);
			}
		}

		if (toLoad.length > 0) {
			this.loadAndBuildSlots(toLoad, slots, fallbackColor);
		} else {
			this.buildCarMeshes(slots, fallbackColor);
		}
	}

	private async loadAndBuildSlots(
		toLoad: {id: string; url: string}[],
		slots: string[],
		fallbackColor: string,
	): Promise<void> {
		try {
			await Promise.all(toLoad.map(async ({id, url}) => {
				const resp = await fetch(url);
				if (!resp.ok) throw new Error(`HTTP ${resp.status} loading ${url}`);
				const ab = await resp.arrayBuffer();
				const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
				const parsed = await this.parseGLBWithTextures(ab, baseUrl);
				if (parsed) {
					this.glbCache.set(id, parsed);
					debugLog(`[TrainRenderingSystem] Cached model: ${id} (${parsed.position.length / 3} verts)`);
				} else {
					console.error(`[TrainRenderingSystem] Failed to parse GLB: ${id}`);
				}
			}));
		} catch (err) {
			console.error('[TrainRenderingSystem] Error loading slot models:', err);
		}
		this.buildCarMeshes(slots, fallbackColor);
	}

	private buildCarMeshes(slots: string[], fallbackColor: string): void {
		const sceneSystem = this.systemManager.getSystem(SceneSystem);
		if (!sceneSystem) return;

		this.removeCarMeshes();

		const proceduralBuf = buildTrainCarGeometry(fallbackColor);
		const proceduralSingleCar = this.extractSingleProceduralCar(proceduralBuf);

		const carLengths: number[] = [];
		for (let i = 0; i < slots.length; i++) {
			const modelId = slots[i];
			let buf: GeometryBuffers;
			if (modelId === 'procedural-default') {
				buf = proceduralSingleCar;
			} else {
				buf = this.glbCache.get(modelId) || proceduralSingleCar;
			}
			const hasAnim = !!buf.animationData;
			const mesh = new TrainMeshObject({
				position: new Float32Array(buf.position),
				normal: new Float32Array(buf.normal),
				color: new Float32Array(buf.color),
				indices: new Uint32Array(buf.indices),
			}, hasAnim);
			sceneSystem.objects.wrapper.add(mesh);
			this.carMeshes.push(mesh);
			carLengths.push(this.getCarLength(buf));

			if (buf.animationData) {
				this.carAnimStates.push({
					playing: false,
					forward: true,
					currentTime: buf.animationData.doorAnimStartTime,
					animData: buf.animationData,
					originalPositions: new Float32Array(buf.position),
					originalNormals: new Float32Array(buf.normal),
				});
			} else {
				this.carAnimStates.push(null as any);
			}
		}

		this.carOffsets = [];
		let cumOffset = 0;
		for (let i = 0; i < carLengths.length; i++) {
			if (i === 0) {
				this.carOffsets.push(0);
				cumOffset = carLengths[0] / 2;
			} else {
				cumOffset += CAR_GAP + carLengths[i] / 2;
				this.carOffsets.push(cumOffset);
				cumOffset += carLengths[i] / 2;
			}
		}

		debugLog(`[TrainRenderingSystem] Built ${slots.length} car meshes, offsets=[${this.carOffsets.map(o => o.toFixed(1)).join(', ')}]`);
	}

	private extractSingleProceduralCar(fullBuf: GeometryBuffers): GeometryBuffers {
		const vertCount = fullBuf.position.length / 3;
		const CAR_LENGTH = 20;
		const BOGIE_GAP = 1.5;
		const spacing = CAR_LENGTH + BOGIE_GAP;

		const singlePositions: number[] = [];
		const singleNormals: number[] = [];
		const singleColors: number[] = [];
		const singleIndices: number[] = [];
		const vertMap = new Map<number, number>();

		for (let i = 0; i < fullBuf.indices.length; i++) {
			const origIdx = fullBuf.indices[i];
			const z = fullBuf.position[origIdx * 3 + 2];
			if (z >= -spacing / 2 && z <= spacing / 2) {
				if (!vertMap.has(origIdx)) {
					const newIdx = singlePositions.length / 3;
					vertMap.set(origIdx, newIdx);
					singlePositions.push(
						fullBuf.position[origIdx * 3],
						fullBuf.position[origIdx * 3 + 1],
						fullBuf.position[origIdx * 3 + 2],
					);
					singleNormals.push(
						fullBuf.normal[origIdx * 3],
						fullBuf.normal[origIdx * 3 + 1],
						fullBuf.normal[origIdx * 3 + 2],
					);
					singleColors.push(
						fullBuf.color[origIdx * 3],
						fullBuf.color[origIdx * 3 + 1],
						fullBuf.color[origIdx * 3 + 2],
					);
				}
			}
		}

		for (let i = 0; i < fullBuf.indices.length; i += 3) {
			const a = fullBuf.indices[i], b = fullBuf.indices[i + 1], c = fullBuf.indices[i + 2];
			if (vertMap.has(a) && vertMap.has(b) && vertMap.has(c)) {
				singleIndices.push(
					vertMap.get(a) as number,
					vertMap.get(b) as number,
					vertMap.get(c) as number,
				);
			}
		}

		return {
			position: new Float32Array(singlePositions),
			normal: new Float32Array(singleNormals),
			color: new Float32Array(singleColors),
			indices: new Uint32Array(singleIndices),
		};
	}

	private applyProceduralFallback(slotCount: number, color: string): void {
		const sceneSystem = this.systemManager.getSystem(SceneSystem);
		if (!sceneSystem) return;

		const proceduralBuf = buildTrainCarGeometry(color);
		const singleCar = this.extractSingleProceduralCar(proceduralBuf);
		const carLen = this.getCarLength(singleCar);

		for (let i = 0; i < slotCount; i++) {
			const mesh = new TrainMeshObject({
				position: new Float32Array(singleCar.position),
				normal: new Float32Array(singleCar.normal),
				color: new Float32Array(singleCar.color),
				indices: new Uint32Array(singleCar.indices),
			});
			sceneSystem.objects.wrapper.add(mesh);
			this.carMeshes.push(mesh);
		}

		this.carOffsets = [];
		let cumOffset = 0;
		for (let i = 0; i < slotCount; i++) {
			if (i === 0) {
				this.carOffsets.push(0);
				cumOffset = carLen / 2;
			} else {
				cumOffset += CAR_GAP + carLen / 2;
				this.carOffsets.push(cumOffset);
				cumOffset += carLen / 2;
			}
		}
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

		const clips = parseAnimations(
			jsonChunk, binChunk,
			(gltf: any, bin: ArrayBuffer, idx: number) => this.extractAccessorData(gltf, bin, idx),
		);

		const animatedNodeSet = getAnimatedNodeIndices(clips);
		const affectedMeshNodes = this.getAffectedMeshNodes(jsonChunk, animatedNodeSet);

		const allPositions: number[] = [];
		const allNormals: number[] = [];
		const allColors: number[] = [];
		const allIndices: number[] = [];
		const animatedNodesInfo: AnimatedNodeInfo[] = [];

		const nodeTransforms = this.computeNodeTransforms(jsonChunk);

		for (let nodeIdx = 0; nodeIdx < (jsonChunk.nodes || []).length; nodeIdx++) {
			const node = jsonChunk.nodes[nodeIdx];
			if (node.mesh === undefined) continue;

			const mesh = jsonChunk.meshes[node.mesh];
			if (!mesh) continue;

			const worldMatrix = nodeTransforms[nodeIdx];
			const isAffectedByAnim = affectedMeshNodes.has(nodeIdx);
			const nodeVertStart = allPositions.length / 3;

			const nodeLocalPos: number[] = [];
			const nodeLocalNorm: number[] = [];

			for (const prim of mesh.primitives || []) {
				const posAccessorIdx = prim.attributes?.POSITION;
				if (posAccessorIdx === undefined) continue;

				const baseVertex = allPositions.length / 3;
				const posData = this.extractAccessorData(jsonChunk, binChunk, posAccessorIdx);
				if (!posData) continue;
				const vertCount = posData.length / 3;

				for (let i = 0; i < vertCount; i++) {
					if (isAffectedByAnim) {
						nodeLocalPos.push(posData[i * 3], posData[i * 3 + 1], posData[i * 3 + 2]);
					}
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
							if (isAffectedByAnim) {
								nodeLocalNorm.push(normData[i * 3], normData[i * 3 + 1], normData[i * 3 + 2]);
							}
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
					if (isAffectedByAnim) {
						while (nodeLocalNorm.length / 3 < nodeLocalPos.length / 3) {
							nodeLocalNorm.push(0, 1, 0);
						}
					}
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

			if (isAffectedByAnim && nodeLocalPos.length > 0) {
				const nodeVertCount = nodeLocalPos.length / 3;
				animatedNodesInfo.push({
					nodeIdx,
					vertexStart: nodeVertStart,
					vertexCount: nodeVertCount,
					localPositions: new Float32Array(nodeLocalPos),
					localNormals: new Float32Array(nodeLocalNorm),
				});
				debugLog(`[TrainRenderingSystem] Animated node "${node.name}" idx=${nodeIdx} (${nodeVertCount} verts)`);
			}
		}

		if (allPositions.length === 0) {
			console.error('[TrainRenderingSystem] GLB had no geometry');
			return null;
		}

		let scaleParams: ModelTransformParams | undefined;
		if (!skipScaling) {
			scaleParams = this.scaleAndCenterModel(allPositions, allNormals);
		}

		let animationData: AnimationData | undefined;
		if (clips.length > 0 && animatedNodesInfo.length > 0 && scaleParams) {
			const nodes = jsonChunk.nodes || [];
			const parentMap = new Int32Array(nodes.length).fill(-1);
			for (let i = 0; i < nodes.length; i++) {
				for (const c of (nodes[i].children || [])) {
					if (c >= 0 && c < nodes.length) parentMap[c] = i;
				}
			}

			const localMatrices: Float64Array[] = [];
			const nodeTRS: NodeTRS[] = [];
			for (const node of nodes) {
				const t = node.translation ? [...node.translation] : [0, 0, 0];
				const r = node.rotation ? [...node.rotation] : [0, 0, 0, 1];
				const s = node.scale ? [...node.scale] : [1, 1, 1];
				nodeTRS.push({t, r, s});

				const m = new Float64Array(16);
				if (node.matrix) {
					for (let i = 0; i < 16; i++) m[i] = node.matrix[i];
				} else {
					composeTRS(t, r, s, m);
				}
				localMatrices.push(m);
			}

			const doorClipIndex = findDoorAnimationIndex(clips, nodes);
			let doorAnimStartTime = 0;
			let doorAnimEndTime = 0;
			if (doorClipIndex >= 0) {
				const doorClip = clips[doorClipIndex];
				const timeRange = detectAnimTimeRange(doorClip);
				doorAnimStartTime = timeRange.startTime;
				doorAnimEndTime = timeRange.endTime;
				if (doorAnimEndTime <= doorAnimStartTime) {
					doorAnimEndTime = doorClip.duration;
				}
			}

			animationData = {
				clips,
				doorClipIndex,
				doorAnimStartTime,
				doorAnimEndTime,
				animatedNodes: animatedNodesInfo,
				parentMap,
				localMatrices,
				scaleParams,
				nodeTRS,
			};
		}

		return {
			position: new Float32Array(allPositions),
			normal: new Float32Array(allNormals),
			color: new Float32Array(allColors),
			indices: new Uint32Array(allIndices),
			animationData,
		};
	}

	private getAffectedMeshNodes(gltf: any, animatedNodeSet: Set<number>): Set<number> {
		const nodes = gltf.nodes || [];
		const affected = new Set<number>();
		if (animatedNodeSet.size === 0) return affected;

		const isDescendantOfAnimated = (nodeIdx: number): boolean => {
			if (animatedNodeSet.has(nodeIdx)) return true;
			for (let pi = 0; pi < nodes.length; pi++) {
				const children: number[] = nodes[pi].children || [];
				if (children.includes(nodeIdx)) {
					return isDescendantOfAnimated(pi);
				}
			}
			return false;
		};

		for (let i = 0; i < nodes.length; i++) {
			if (nodes[i].mesh !== undefined && isDescendantOfAnimated(i)) {
				affected.add(i);
			}
		}
		return affected;
	}

	private scaleAndCenterModel(positions: number[], normals?: number[]): ModelTransformParams {
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

		const params: ModelTransformParams = {scale, centerX, centerZ, minY, needsRotation};

		const finalW = (needsRotation ? extentZ : extentX) * scale;
		const finalH = extentY * scale;
		const finalL = (needsRotation ? extentX : extentZ) * scale;
		debugLog(
			`[TrainRenderingSystem] Model: raw ${extentX.toFixed(2)}x${extentY.toFixed(2)}x${extentZ.toFixed(2)}, ` +
			`scaled ${finalW.toFixed(1)}x${finalH.toFixed(1)}x${finalL.toFixed(1)} ` +
			`(scale=${scale.toFixed(3)}, rotated=${needsRotation})`
		);

		this.applyScaleParams(positions, normals, params);
		return params;
	}

	private applyScaleParams(positions: number[] | Float32Array, normals: number[] | Float32Array | undefined, params: ModelTransformParams): void {
		const vertCount = positions.length / 3;
		for (let i = 0; i < vertCount; i++) {
			let lx = (positions[i * 3] - params.centerX) * params.scale;
			const ly = (positions[i * 3 + 1] - params.minY) * params.scale;
			let lz = (positions[i * 3 + 2] - params.centerZ) * params.scale;

			if (params.needsRotation) {
				const tmp = lx;
				lx = -lz;
				lz = tmp;
			}

			positions[i * 3] = lx;
			positions[i * 3 + 1] = ly;
			positions[i * 3 + 2] = lz;

			if (params.needsRotation && normals) {
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

		const loadTasks = images.map((img: any, i: number) => async () => {
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
		});

		await Promise.all(loadTasks.map((task: () => Promise<void>) => task()));

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
				if (ls) {
					const slots = assetConfig.getConfig().trainSlots || ['procedural-default'];
					this.rebuildTrainFromSlots(slots, ls.parsed.color);
				}
			}
		}

		this.configPollTimer += deltaTime;
		if (this.configPollTimer >= TrainRenderingSystem.CONFIG_POLL_INTERVAL) {
			this.configPollTimer = 0;
			this.pollConfigChanges(trainSystem);
		}

		if (!trainSystem.gameActive || !trainSystem.trainPosition || this.carMeshes.length === 0) return;

		const doorsOpen = trainSystem.physicsState.doorsOpen;
		if (doorsOpen !== this.lastDoorsOpen) {
			this.lastDoorsOpen = doorsOpen;
			this.startDoorAnimation(doorsOpen);
		}

		this.advanceAnimations(deltaTime);

		const cosLat = Math.cos(trainSystem.trainPosition.lat * Math.PI / 180);

		for (let i = 0; i < this.carMeshes.length; i++) {
			const carPos = trainSystem.getCarPosition(this.carOffsets[i] * cosLat);
			if (!carPos) continue;
			this.carMeshes[i].position.set(carPos.x, carPos.height, carPos.y);
			this.carMeshes[i].rotation.set(0, carPos.heading, 0);
			this.carMeshes[i].updateMatrix();
		}
	}

	private startDoorAnimation(open: boolean): void {
		for (let ci = 0; ci < this.carAnimStates.length; ci++) {
			const state = this.carAnimStates[ci];
			if (!state) continue;
			if (state.animData.doorClipIndex < 0) continue;

			const startTime = state.animData.doorAnimStartTime;
			const endTime = state.animData.doorAnimEndTime;
			state.playing = true;
			state.forward = open;
			if (open && state.currentTime <= startTime) {
				state.currentTime = startTime;
			} else if (!open && state.currentTime >= endTime) {
				state.currentTime = endTime;
			}
		}
	}

	private advanceAnimations(deltaTime: number): void {
		for (let ci = 0; ci < this.carAnimStates.length; ci++) {
			const state = this.carAnimStates[ci];
			if (!state || !state.playing) continue;

			const clip = state.animData.clips[state.animData.doorClipIndex];
			if (!clip) continue;

			const startTime = state.animData.doorAnimStartTime;
			const endTime = state.animData.doorAnimEndTime;

			if (state.forward) {
				state.currentTime += deltaTime;
				if (state.currentTime >= endTime) {
					state.currentTime = endTime;
					state.playing = false;
				}
			} else {
				state.currentTime -= deltaTime;
				if (state.currentTime <= startTime) {
					state.currentTime = startTime;
					state.playing = false;
				}
			}

			try {
				this.applyAnimationFrame(ci, state, clip);
			} catch (err) {
				console.error('applyAnimationFrame error:', err);
				state.playing = false;
			}
		}
	}

	private applyAnimationFrame(carIdx: number, state: CarAnimState, clip: GLTFAnimationClip): void {
		const {animData, originalPositions, originalNormals} = state;
		const {animatedNodes, parentMap, localMatrices, scaleParams, nodeTRS} = animData;
		const t = state.currentTime;

		const animLocalMatrices = localMatrices.map(m => {
			const copy = new Float64Array(16);
			for (let i = 0; i < 16; i++) copy[i] = m[i];
			return copy;
		});

		const nodeT = new Map<number, Float32Array>();
		const nodeR = new Map<number, Float32Array>();
		const nodeS = new Map<number, Float32Array>();

		for (const ch of clip.channels) {
			const val = sampleChannelAtTime(ch, t);
			switch (ch.path) {
				case 'translation': nodeT.set(ch.nodeIdx, val); break;
				case 'rotation': nodeR.set(ch.nodeIdx, val); break;
				case 'scale': nodeS.set(ch.nodeIdx, val); break;
			}
		}

		for (const nodeIdx of new Set([...nodeT.keys(), ...nodeR.keys(), ...nodeS.keys()])) {
			const origTRS = nodeTRS[nodeIdx];
			const tr = nodeT.get(nodeIdx);
			const rot = nodeR.get(nodeIdx);
			const sc = nodeS.get(nodeIdx);

			composeTRS(
				tr ? Array.from(tr) : origTRS.t,
				rot || new Float32Array(origTRS.r),
				sc ? Array.from(sc) : origTRS.s,
				animLocalMatrices[nodeIdx],
			);
		}

		const worldMatrices: Float64Array[] = animLocalMatrices.map(m => {
			const w = new Float64Array(16);
			for (let i = 0; i < 16; i++) w[i] = m[i];
			return w;
		});

		const resolved = new Uint8Array(parentMap.length);
		const resolveNode = (idx: number): void => {
			if (resolved[idx]) return;
			resolved[idx] = 1;
			const p = parentMap[idx];
			if (p >= 0) {
				resolveNode(p);
				multiplyMat4(worldMatrices[p], animLocalMatrices[idx], worldMatrices[idx]);
			}
		};
		for (let i = 0; i < parentMap.length; i++) resolveNode(i);

		const newPos = new Float32Array(originalPositions);
		const newNorm = new Float32Array(originalNormals);

		for (const aNode of animatedNodes) {
			const wm = worldMatrices[aNode.nodeIdx];
			for (let v = 0; v < aNode.vertexCount; v++) {
				const lx = aNode.localPositions[v * 3];
				const ly = aNode.localPositions[v * 3 + 1];
				const lz = aNode.localPositions[v * 3 + 2];

				let wx = wm[0] * lx + wm[4] * ly + wm[8]  * lz + wm[12];
				let wy = wm[1] * lx + wm[5] * ly + wm[9]  * lz + wm[13];
				let wz = wm[2] * lx + wm[6] * ly + wm[10] * lz + wm[14];

				let sx = (wx - scaleParams.centerX) * scaleParams.scale;
				const sy = (wy - scaleParams.minY) * scaleParams.scale;
				let sz = (wz - scaleParams.centerZ) * scaleParams.scale;

				if (scaleParams.needsRotation) {
					const tmp = sx;
					sx = -sz;
					sz = tmp;
				}

				const idx = (aNode.vertexStart + v) * 3;
				newPos[idx] = sx;
				newPos[idx + 1] = sy;
				newPos[idx + 2] = sz;

				const nlx = aNode.localNormals[v * 3];
				const nly = aNode.localNormals[v * 3 + 1];
				const nlz = aNode.localNormals[v * 3 + 2];

				let wnx = wm[0] * nlx + wm[4] * nly + wm[8]  * nlz;
				let wny = wm[1] * nlx + wm[5] * nly + wm[9]  * nlz;
				let wnz = wm[2] * nlx + wm[6] * nly + wm[10] * nlz;
				const nlen = Math.sqrt(wnx * wnx + wny * wny + wnz * wnz) || 1;
				wnx /= nlen; wny /= nlen; wnz /= nlen;

				if (scaleParams.needsRotation) {
					const tmpN = wnx;
					wnx = -wnz;
					wnz = tmpN;
				}

				newNorm[idx] = wnx;
				newNorm[idx + 1] = wny;
				newNorm[idx + 2] = wnz;
			}
		}

		this.carMeshes[carIdx].updatePositionAndNormalBuffers(newPos, newNorm);
	}

	private pollConfigChanges(trainSystem: TrainSystem): void {
		const assetConfig = this.systemManager.getSystem(AssetConfigSystem);
		if (!assetConfig) return;

		const config = assetConfig.getConfig();
		const slotsHash = JSON.stringify(config.trainSlots);
		if (slotsHash !== this.lastSlotsHash) {
			debugLog('[TrainRenderingSystem] Poll detected slots change');
			const ls = trainSystem.getCurrentLine();
			if (ls) {
				this.rebuildTrainFromSlots(config.trainSlots, ls.parsed.color);
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
