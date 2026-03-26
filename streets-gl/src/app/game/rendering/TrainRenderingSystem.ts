import System from '~/app/System';
import SceneSystem from '~/app/systems/SceneSystem';
import TerrainSystem from '~/app/systems/TerrainSystem';
import TrainSystem from '~/app/game/TrainSystem';
import TrainMeshObject from './TrainMeshObject';
import {buildTrainCarGeometry, buildTrackGeometry, buildStationGeometry, GeometryBuffers} from './TrainGeometry';
import MathUtils from '~/lib/math/MathUtils';
import {bearing} from '~/app/game/data/CoordinateSystem';
import AssetConfigSystem from '~/app/game/assets/AssetConfigSystem';

const TRACK_HEIGHT_OFFSET = 0.05;
const TARGET_CAR_WIDTH = 3.0;
const DEFAULT_CAR_COUNT = 3;
const CAR_GAP = 0.5;

export default class TrainRenderingSystem extends System {
	public trainMesh: TrainMeshObject | null = null;
	public trackMesh: TrainMeshObject | null = null;
	public stationMeshes: TrainMeshObject[] = [];

	private lastLineIdx: number = -1;
	private terrainCheckTimer: number = 0;
	private lastTerrainSample: number = 0;
	private terrainSettled: boolean = false;
	private lastTrainModelId: string = '';
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
		if (config.trainModel !== this.lastTrainModelId) {
			console.log(`[TrainRenderingSystem] Config changed: model ${this.lastTrainModelId} -> ${config.trainModel}`);
			const trainSystem = this.systemManager.getSystem(TrainSystem);
			const ls = trainSystem?.getCurrentLine();
			if (ls) {
				this.rebuildTrainMesh(ls.parsed.color);
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
		const config = assetConfig?.getConfig();
		const catalog = assetConfig?.getCatalog();
		const modelId = config?.trainModel || 'procedural-default';
		const carCount = (config as any)?.carCount ?? DEFAULT_CAR_COUNT;

		this.lastTrainModelId = modelId;

		if (modelId !== 'procedural-default') {
			if (!catalog) {
				console.log(`[TrainRenderingSystem] Catalog not loaded yet, will retry for model: ${modelId}`);
				this.pendingModelRebuild = true;
				this.applyTrainBuffers(buildTrainCarGeometry(color));
				return;
			}

			const entry = catalog.models.trains.find(e => e.id === modelId);
			if (entry?.path) {
				if (this.glbCache.has(modelId)) {
					const cached = this.glbCache.get(modelId);
					if (cached) {
						const assembled = this.assembleMultiCar(cached, carCount);
						this.applyTrainBuffers(assembled);
						console.log(`[TrainRenderingSystem] Applied cached model: ${modelId} (${carCount} cars)`);
						return;
					}
				}

				const url = assetConfig ? assetConfig.getAssetUrl(entry.path) : `/data/assets/${entry.path}`;
				console.log(`[TrainRenderingSystem] Loading GLB model: ${modelId} from ${url}`);
				this.loadGLBModel(url, modelId, color, carCount);
				return;
			} else {
				console.warn(`[TrainRenderingSystem] No path for model: ${modelId}`);
			}
		}

		this.applyTrainBuffers(buildTrainCarGeometry(color));
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
				console.log(`[TrainRenderingSystem] Loaded GLB: ${modelId} (${singleCar.position.length / 3} verts/car, ${carCount} cars)`);
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

	private async parseGLBWithTextures(buffer: ArrayBuffer, baseUrl: string): Promise<GeometryBuffers | null> {
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

				if (!colorsApplied && pbr?.baseColorTexture !== undefined && texturePixels) {
					const texIdx = pbr.baseColorTexture.index;
					const texture = jsonChunk.textures?.[texIdx];
					const imgIdx = texture?.source;
					const pixels = texturePixels.get(imgIdx);

					if (pixels) {
						const uvAccessorIdx = prim.attributes?.TEXCOORD_0;
						if (uvAccessorIdx !== undefined) {
							const uvData = this.extractAccessorData(jsonChunk, binChunk, uvAccessorIdx);
							if (uvData) {
								this.sampleTextureColors(uvData, pixels, vertCount, allColors);
								colorsApplied = true;
							}
						}
					}
				}

				if (!colorsApplied && pbr?.baseColorFactor) {
					const [r, g, b] = pbr.baseColorFactor;
					for (let v = 0; v < vertCount; v++) {
						allColors.push(r, g, b);
					}
					colorsApplied = true;
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

		this.scaleAndCenterModel(allPositions);

		return {
			position: new Float32Array(allPositions),
			normal: new Float32Array(allNormals),
			color: new Float32Array(allColors),
			indices: new Uint32Array(allIndices),
		};
	}

	private scaleAndCenterModel(positions: number[]): void {
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

		const modelWidth = maxX - minX;
		const scale = modelWidth > 0.01 ? TARGET_CAR_WIDTH / modelWidth : 1;

		const centerX = (minX + maxX) / 2;
		const centerZ = (minZ + maxZ) / 2;

		const scaledW = modelWidth * scale;
		const scaledH = (maxY - minY) * scale;
		const scaledL = (maxZ - minZ) * scale;
		console.log(`[TrainRenderingSystem] Model: raw ${modelWidth.toFixed(2)}x${(maxY-minY).toFixed(2)}x${(maxZ-minZ).toFixed(2)}, scaled ${scaledW.toFixed(1)}x${scaledH.toFixed(1)}x${scaledL.toFixed(1)} (scale=${scale.toFixed(2)})`);

		for (let i = 0; i < vertCount; i++) {
			positions[i * 3] = (positions[i * 3] - centerX) * scale;
			positions[i * 3 + 1] = (positions[i * 3 + 1] - minY) * scale;
			positions[i * 3 + 2] = (positions[i * 3 + 2] - centerZ) * scale;
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
						pixels = await this.fetchTexturePixels(img.uri);
					} else {
						pixels = await this.fetchTexturePixels(baseUrl + img.uri);
					}
				}

				if (pixels) {
					result.set(i, pixels);
					console.log(`[TrainRenderingSystem] Loaded texture ${i}: ${pixels.width}x${pixels.height}`);
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

		if (byteStride && byteStride !== naturalStride) {
			const result = new Float32Array(totalElements);
			const dv = new DataView(bin);
			for (let i = 0; i < count; i++) {
				const elemOffset = baseOffset + i * byteStride;
				for (let c = 0; c < components; c++) {
					const off = elemOffset + c * compSize;
					switch (componentType) {
						case 5126: result[i * components + c] = dv.getFloat32(off, true); break;
						case 5123: result[i * components + c] = dv.getUint16(off, true); break;
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
			case 5123: return new Uint16Array(bin, baseOffset, totalElements);
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

		const stations = ls.parsed.stations;
		for (let si = 0; si < stations.length; si++) {
			const station = stations[si];
			const pos = MathUtils.degrees2meters(station.lat, station.lng);
			const h = this.getTerrainHeight(pos.x, pos.y);

			let stationHeading = 0;
			const nextSt = stations[Math.min(si + 1, stations.length - 1)];
			const prevSt = stations[Math.max(0, si - 1)];
			if (nextSt !== station) {
				stationHeading = Math.PI / 2 - MathUtils.toRad(bearing(station.lat, station.lng, nextSt.lat, nextSt.lng));
			} else if (prevSt !== station) {
				stationHeading = Math.PI / 2 - MathUtils.toRad(bearing(prevSt.lat, prevSt.lng, station.lat, station.lng));
			}

			const stationBuf = buildStationGeometry(
				pos.x, h + TRACK_HEIGHT_OFFSET, pos.y,
				stationHeading,
				ls.parsed.color,
			);

			const meshObj = new TrainMeshObject(stationBuf);
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
		const currentModelId = config.trainModel || 'procedural-default';
		if (currentModelId !== this.lastTrainModelId) {
			console.log(`[TrainRenderingSystem] Poll detected model change: ${this.lastTrainModelId} -> ${currentModelId}`);
			const ls = trainSystem.getCurrentLine();
			if (ls) {
				this.rebuildTrainMesh(ls.parsed.color);
			}
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
			console.log(`[TrainRenderingSystem] Terrain changed (${this.lastTerrainSample.toFixed(1)} -> ${h.toFixed(1)}), rebuilding`);
			this.lastTerrainSample = h;
			this.rebuildAll();
		} else if (h !== 0) {
			this.terrainSettled = true;
		}
	}
}
