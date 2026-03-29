import AbstractMaterial from "~/lib/renderer/abstract-renderer/AbstractMaterial";
import {
	UniformFloat1,
	UniformFloat3,
	UniformFloat4,
	UniformInt1,
	UniformMatrix4,
	UniformTexture2DArray
} from "~/lib/renderer/abstract-renderer/Uniform";
import Tile from "../../objects/Tile";
import Mat4 from "~/lib/math/Mat4";
import Pass from "./Pass";
import RenderPassResource from "../render-graph/resources/RenderPassResource";
import {InternalResourceType} from '~/lib/render-graph/Pass';
import PassManager from '../PassManager';
import ExtrudedMeshMaterialContainer from "../materials/ExtrudedMeshMaterialContainer";
import SkyboxMaterialContainer from "../materials/SkyboxMaterialContainer";
import ProjectedMeshMaterialContainer from "../materials/ProjectedMeshMaterialContainer";
import FullScreenTriangle from "../../objects/FullScreenTriangle";
import TerrainMaterialContainer from "../materials/TerrainMaterialContainer";
import TreeMaterialContainer from "../materials/TreeMaterialContainer";
import Vec2 from "~/lib/math/Vec2";
import VehicleSystem from "../../systems/VehicleSystem";
import AircraftMaterialContainer from "../materials/AircraftMaterialContainer";
import AbstractTexture2D from "~/lib/renderer/abstract-renderer/AbstractTexture2D";
import MathUtils from "~/lib/math/MathUtils";
import Config from "../../Config";
import TerrainSystem from "../../systems/TerrainSystem";
import AbstractTexture2DArray from "~/lib/renderer/abstract-renderer/AbstractTexture2DArray";
import Camera from "~/lib/core/Camera";
import GenericInstanceMaterialContainer from "~/app/render/materials/GenericInstanceMaterialContainer";
import {
	InstanceStructure,
	Tile3DInstanceLODConfig,
	Tile3DInstanceType
} from "~/lib/tile-processing/tile3d/features/Tile3DInstance";
import AdvancedInstanceMaterialContainer from "~/app/render/materials/AdvancedInstanceMaterialContainer";
import {InstanceTextureIdList} from "~/app/render/textures/createInstanceTexture";
import MapTimeSystem from "~/app/systems/MapTimeSystem";
import {AircraftPartTextures} from "~/app/render/textures/createAircraftTexture";
import PerspectiveCamera from "~/lib/core/PerspectiveCamera";
import TrainMaterialContainer from "~/app/render/materials/TrainMaterialContainer";
import TrainRenderingSystem from "~/app/game/rendering/TrainRenderingSystem";

export default class GBufferPass extends Pass<{
	GBufferRenderPass: {
		type: InternalResourceType.Output;
		resource: RenderPassResource;
	};
	TerrainNormal: {
		type: InternalResourceType.Input;
		resource: RenderPassResource;
	};
	TerrainWater: {
		type: InternalResourceType.Input;
		resource: RenderPassResource;
	};
	TerrainWaterTileMask: {
		type: InternalResourceType.Input;
		resource: RenderPassResource;
	};
	TerrainRingHeight: {
		type: InternalResourceType.Input;
		resource: RenderPassResource;
	};
	TerrainUsage: {
		type: InternalResourceType.Input;
		resource: RenderPassResource;
	};
	TerrainUsageTileMask: {
		type: InternalResourceType.Input;
		resource: RenderPassResource;
	};
}> {
	private extrudedMeshMaterial: AbstractMaterial;
	private projectedMeshMaterial: AbstractMaterial;
	private huggingMeshMaterial: AbstractMaterial;
	private skyboxMaterial: AbstractMaterial;
	private terrainMaterial: AbstractMaterial;
	private treeMaterial: AbstractMaterial;
	private genericInstanceMaterial: AbstractMaterial;
	private advancedInstanceMaterial: AbstractMaterial;
	private aircraftMaterial: AbstractMaterial;
	private trainMaterial: AbstractMaterial;
	private cameraMatrixWorldInversePrev: Mat4 = null;
	public objectIdBuffer: Uint32Array = new Uint32Array(1);
	public objectIdX = 0;
	public objectIdY = 0;
	private fullScreenTriangle: FullScreenTriangle;

	private readonly _tmpMat4A: Float32Array = new Float32Array(16);
	private readonly _tmpMat4B: Float32Array = new Float32Array(16);
	private readonly _tmpMat4C: Float32Array = new Float32Array(16);
	private readonly _tmpMat4D: Float32Array = new Float32Array(16);
	private readonly _tmpVec4A: Float32Array = new Float32Array(4);
	private readonly _tmpVec4B: Float32Array = new Float32Array(4);
	private readonly _tmpVec2A: Float32Array = new Float32Array(2);
	private readonly _tmpVec2B: Float32Array = new Float32Array(2);
	private readonly _tmpFloat1: Float32Array = new Float32Array(1);
	private readonly _tmpNormalTransform0: Float32Array = new Float32Array(4);
	private readonly _tmpNormalTransform1: Float32Array = new Float32Array(4);
	private readonly _tmpDetailOffset: Float32Array = new Float32Array(2);

	public constructor(manager: PassManager) {
		super('GBufferPass', manager, {
			GBufferRenderPass: {
				type: InternalResourceType.Output,
				resource: manager.getSharedResource('GBufferRenderPass')
			},
			TerrainNormal: {
				type: InternalResourceType.Input,
				resource: manager.getSharedResource('TerrainNormal')
			},
			TerrainWater: {
				type: InternalResourceType.Input,
				resource: manager.getSharedResource('TerrainWater')
			},
			TerrainWaterTileMask: {
				type: InternalResourceType.Input,
				resource: manager.getSharedResource('TerrainWaterTileMask')
			},
			TerrainRingHeight: {
				type: InternalResourceType.Input,
				resource: manager.getSharedResource('TerrainRingHeight')
			},
			TerrainUsage: {
				type: InternalResourceType.Input,
				resource: manager.getSharedResource('TerrainUsage')
			},
			TerrainUsageTileMask: {
				type: InternalResourceType.Input,
				resource: manager.getSharedResource('TerrainUsageTileMask')
			}
		});

		this.fullScreenTriangle = new FullScreenTriangle(this.renderer);

		this.createMaterials();
	}

	private createMaterials(): void {
		this.skyboxMaterial = new SkyboxMaterialContainer(this.renderer).material;
		this.terrainMaterial = new TerrainMaterialContainer(this.renderer).material;

		this.genericInstanceMaterial = new GenericInstanceMaterialContainer(this.renderer).material;
		this.genericInstanceMaterial.getUniform<UniformTexture2DArray>('tMap').value =
			<AbstractTexture2DArray>this.manager.texturePool.get('instance');

		this.advancedInstanceMaterial = new AdvancedInstanceMaterialContainer(this.renderer).material;
		this.advancedInstanceMaterial.getUniform<UniformTexture2DArray>('tMap').value =
			<AbstractTexture2DArray>this.manager.texturePool.get('instance');

		this.treeMaterial = new TreeMaterialContainer(this.renderer).material;
		this.treeMaterial.getUniform<UniformTexture2DArray>('tMap').value =
			<AbstractTexture2DArray>this.manager.texturePool.get('tree');

		this.projectedMeshMaterial = new ProjectedMeshMaterialContainer(this.renderer, false).material;
		this.projectedMeshMaterial.getUniform<UniformTexture2DArray>('tMap').value =
			<AbstractTexture2DArray>this.manager.texturePool.get('projectedMesh');

		this.huggingMeshMaterial = new ProjectedMeshMaterialContainer(this.renderer, true).material;
		this.huggingMeshMaterial.getUniform<UniformTexture2DArray>('tMap').value =
			<AbstractTexture2DArray>this.manager.texturePool.get('projectedMesh');

		this.extrudedMeshMaterial = new ExtrudedMeshMaterialContainer(this.renderer).material;
		this.extrudedMeshMaterial.getUniform<UniformTexture2DArray>('tMap').value =
			<AbstractTexture2DArray>this.manager.texturePool.get('extrudedMesh');

		this.aircraftMaterial = new AircraftMaterialContainer(this.renderer).material;
		this.aircraftMaterial.getUniform<UniformTexture2DArray>('tMap').value =
			<AbstractTexture2DArray>this.manager.texturePool.get('aircraft');

		this.trainMaterial = new TrainMaterialContainer(this.renderer).material;
	}

	private updateMaterialsDefines(): void {
		const useHeight = this.manager.settings.get('terrainHeight').statusValue === 'on' ? '1' : '0';
		const materials = [
			this.huggingMeshMaterial,
			this.projectedMeshMaterial,
			this.terrainMaterial
		];

		for (const material of materials) {
			if (material.defines.USE_HEIGHT !== useHeight) {
				material.defines.USE_HEIGHT = useHeight;
				material.recompile();
			}
		}
	}

	private getTileNormalTexturesTransforms(tile: Tile): [Float32Array, Float32Array] {
		const terrainSystem = this.manager.systemManager.getSystem(TerrainSystem);

		terrainSystem.areaLoaders.height0.transformToArray(
			tile.position.x,
			tile.position.z,
			Config.TileSize,
			this._tmpNormalTransform0
		);
		terrainSystem.areaLoaders.height1.transformToArray(
			tile.position.x,
			tile.position.z,
			Config.TileSize,
			this._tmpNormalTransform1
		);

		return [this._tmpNormalTransform0, this._tmpNormalTransform1];
	}

	private getCameraPositionRelativeToTile(camera: Camera, tile: Tile): [number, number] {
		return [
			camera.position.x - tile.position.x + Config.TileSize / 2,
			camera.position.z - tile.position.z + Config.TileSize / 2
		];
	}

	private renderSkybox(): void {
		const camera = this.manager.sceneSystem.objects.camera;
		const skybox = this.manager.sceneSystem.objects.skybox;

		this._tmpMat4A.set(this.manager.mapTimeSystem.skyDirectionMatrix.values);
		this._tmpMat4B.set(camera.projectionMatrix.values);
		this._tmpMat4C.set(Mat4.multiply(camera.matrixWorldInverse, skybox.matrixWorld).values);
		this._tmpMat4D.set(camera.matrixWorld.values);

		this.skyboxMaterial.getUniform('projectionMatrix', 'Uniforms').value = this._tmpMat4B;
		this.skyboxMaterial.getUniform('modelViewMatrix', 'Uniforms').value = this._tmpMat4C;
		this.skyboxMaterial.getUniform('viewMatrix', 'Uniforms').value = this._tmpMat4D;
		this.skyboxMaterial.getUniform('skyRotationMatrix', 'Uniforms').value = this._tmpMat4A;
		this.skyboxMaterial.updateUniformBlock('Uniforms');

		this.renderer.useMaterial(this.skyboxMaterial);

		skybox.draw();
	}

	private renderExtrudedMeshes(): void {
		const windowLightThreshold = this.manager.systemManager.getSystem(MapTimeSystem).windowLightThreshold;
		const camera = this.manager.sceneSystem.objects.camera;
		const tiles = this.manager.sceneSystem.objects.tiles;

		this.renderer.useMaterial(this.extrudedMeshMaterial);

		this._tmpMat4A.set(camera.jitteredProjectionMatrix.values);
		this.extrudedMeshMaterial.getUniform('projectionMatrix', 'PerMaterial').value = this._tmpMat4A;
		this.extrudedMeshMaterial.getUniform<UniformFloat1>('windowLightThreshold', 'PerMaterial').value[0] = windowLightThreshold;
		this.extrudedMeshMaterial.updateUniformBlock('PerMaterial');

		for (const tile of tiles) {
			if (!tile.extrudedMesh || !tile.extrudedMesh.inCameraFrustum(camera)) {
				continue;
			}

			this._tmpMat4B.set(Mat4.multiply(camera.matrixWorldInverse, tile.matrixWorld).values);
			this._tmpMat4C.set(Mat4.multiply(this.cameraMatrixWorldInversePrev, tile.matrixWorld).values);

			this.extrudedMeshMaterial.getUniform('modelViewMatrix', 'PerMesh').value = this._tmpMat4B;
			this.extrudedMeshMaterial.getUniform('modelViewMatrixPrev', 'PerMesh').value = this._tmpMat4C;
			this.extrudedMeshMaterial.getUniform<UniformFloat1>('tileId', 'PerMesh').value[0] = tile.localId;
			this.extrudedMeshMaterial.updateUniformBlock('PerMesh');

			tile.extrudedMesh.draw();
		}
	}

	private renderTerrain(): void {
		const camera = this.manager.sceneSystem.objects.camera;
		const terrain = this.manager.sceneSystem.objects.terrain;
		const terrainNormal = <AbstractTexture2DArray>this.getPhysicalResource('TerrainNormal').colorAttachments[0].texture;
		const terrainWater = <AbstractTexture2DArray>this.getPhysicalResource('TerrainWater').colorAttachments[0].texture;
		const terrainWaterTileMask = <AbstractTexture2D>this.getPhysicalResource('TerrainWaterTileMask').colorAttachments[0].texture;
		const terrainUsage = <AbstractTexture2DArray>this.getPhysicalResource('TerrainUsage').colorAttachments[0].texture;
		const terrainUsageTileMask = <AbstractTexture2D>this.getPhysicalResource('TerrainUsageTileMask').colorAttachments[0].texture;
		const terrainRingHeight = <AbstractTexture2DArray>this.getPhysicalResource('TerrainRingHeight').colorAttachments[0].texture;
		const biomePos = MathUtils.meters2tile(camera.position.x, camera.position.z, 0);

		this.terrainMaterial.getUniform('tRingHeight').value = terrainRingHeight;
		this.terrainMaterial.getUniform('tNormal').value = terrainNormal;
		this.terrainMaterial.getUniform('tWater').value = terrainWater;
		this.terrainMaterial.getUniform('tWaterMask').value = terrainWaterTileMask;
		this.terrainMaterial.getUniform('tUsage').value = terrainUsage;
		this.terrainMaterial.getUniform('tUsageMask').value = terrainUsageTileMask;
		this.renderer.useMaterial(this.terrainMaterial);

		this._tmpMat4A.set(camera.jitteredProjectionMatrix.values);
		this.terrainMaterial.getUniform<UniformMatrix4>('projectionMatrix', 'PerMaterial').value = this._tmpMat4A;
		this._tmpVec2A[0] = biomePos.x;
		this._tmpVec2A[1] = biomePos.y;
		this.terrainMaterial.getUniform('biomeCoordinates', 'PerMaterial').value = this._tmpVec2A;
		this.terrainMaterial.getUniform<UniformFloat1>('time', 'PerMaterial').value[0] = performance.now() * 0.001;
		// @ts-ignore
		this.terrainMaterial.getUniform<UniformFloat1>('usageRange', 'PerMaterial').value[0] = window.from ?? 0;
		// @ts-ignore
		this.terrainMaterial.getUniform<UniformFloat1>('usageRange', 'PerMaterial').value[1] = window.to ?? 0;
		this.terrainMaterial.updateUniformBlock('PerMaterial');

		for (let i = 0; i < terrain.children.length; i++) {
			const ring = terrain.children[i];
			const offsetSize = Config.TileSize * Config.TerrainDetailUVScale;
			const detailOffsetX = ring.position.x % offsetSize - ring.size / 2;
			const detailOffsetY = ring.position.z % offsetSize - ring.size / 2;

			this._tmpMat4B.set(Mat4.multiply(camera.matrixWorldInverse, ring.matrixWorld).values);
			this._tmpMat4C.set(Mat4.multiply(this.cameraMatrixWorldInversePrev, ring.matrixWorld).values);

			this.terrainMaterial.getUniform<UniformMatrix4>('modelViewMatrix', 'PerMesh').value = this._tmpMat4B;
			this.terrainMaterial.getUniform<UniformMatrix4>('modelViewMatrixPrev', 'PerMesh').value = this._tmpMat4C;
			this.terrainMaterial.getUniform<UniformFloat3>('transformNormal0', 'PerMesh').value = ring.heightTextureTransform0;
			this.terrainMaterial.getUniform<UniformFloat3>('transformNormal1', 'PerMesh').value = ring.heightTextureTransform1;
			this.terrainMaterial.getUniform<UniformFloat4>('transformWater0', 'PerMesh').value = ring.waterTextureTransform0;
			this.terrainMaterial.getUniform<UniformFloat4>('transformWater1', 'PerMesh').value = ring.waterTextureTransform1;
			this.terrainMaterial.getUniform<UniformFloat3>('transformMask', 'PerMesh').value = ring.maskTextureTransform;
			this.terrainMaterial.getUniform<UniformFloat1>('size', 'PerMesh').value[0] = ring.size;
			this.terrainMaterial.getUniform<UniformFloat1>('segmentCount', 'PerMesh').value[0] = ring.segmentCount * 2;
			this._tmpVec2A[0] = detailOffsetX;
			this._tmpVec2A[1] = detailOffsetY;
			this.terrainMaterial.getUniform('detailTextureOffset', 'PerMesh').value = this._tmpVec2A;
			this._tmpVec2B[0] = camera.position.x - ring.position.x;
			this._tmpVec2B[1] = camera.position.z - ring.position.z;
			this.terrainMaterial.getUniform('cameraPosition', 'PerMesh').value = this._tmpVec2B;
			this.terrainMaterial.getUniform<UniformInt1>('levelId', 'PerMesh').value[0] = i;
			this.terrainMaterial.updateUniformBlock('PerMesh');

			ring.draw();
		}
	}

	private getTileDetailTextureOffset(tile: Tile): Float32Array {
		const offsetSize = Config.TileSize * Config.TerrainDetailUVScale;
		this._tmpDetailOffset[0] = tile.position.x % offsetSize;
		this._tmpDetailOffset[1] = tile.position.z % offsetSize;

		return this._tmpDetailOffset;
	}

	private renderProjectedMeshes(): void {
		const camera = this.manager.sceneSystem.objects.camera;
		const tiles = this.manager.sceneSystem.objects.tiles;
		const terrain = this.manager.sceneSystem.objects.terrain;

		const terrainNormal = <AbstractTexture2DArray>this.getPhysicalResource('TerrainNormal').colorAttachments[0].texture;
		const terrainRingHeight = <AbstractTexture2DArray>this.getPhysicalResource('TerrainRingHeight').colorAttachments[0].texture;

		this.projectedMeshMaterial.getUniform('tRingHeight').value = terrainRingHeight;
		this.projectedMeshMaterial.getUniform('tNormal').value = terrainNormal;

		this.renderer.useMaterial(this.projectedMeshMaterial);

		this._tmpMat4A.set(camera.jitteredProjectionMatrix.values);
		this.projectedMeshMaterial.getUniform<UniformMatrix4>('projectionMatrix', 'PerMaterial').value = this._tmpMat4A;
		this.projectedMeshMaterial.updateUniformBlock('PerMaterial');

		for (const tile of tiles) {
			if (!tile.projectedMesh || !tile.projectedMesh.inCameraFrustum(camera)) {
				continue;
			}

			const tileParams = terrain.getTileParams(tile);

			if (!tileParams) {
				continue;
			}

			const {ring0, levelId, ring0Offset, ring1Offset} = tileParams;
			const normalTextureTransforms = this.getTileNormalTexturesTransforms(tile);
			const detailTextureOffset = this.getTileDetailTextureOffset(tile);

			this._tmpMat4B.set(Mat4.multiply(camera.matrixWorldInverse, tile.matrixWorld).values);
			this._tmpMat4C.set(Mat4.multiply(this.cameraMatrixWorldInversePrev, tile.matrixWorld).values);
			const relativeCameraPosition = this.getCameraPositionRelativeToTile(camera, tile);

			this.projectedMeshMaterial.getUniform('modelViewMatrix', 'PerMesh').value = this._tmpMat4B;
			this.projectedMeshMaterial.getUniform('modelViewMatrixPrev', 'PerMesh').value = this._tmpMat4C;
			this.projectedMeshMaterial.getUniform('transformNormal0', 'PerMesh').value = normalTextureTransforms[0];
			this.projectedMeshMaterial.getUniform('transformNormal1', 'PerMesh').value = normalTextureTransforms[1];
			this.projectedMeshMaterial.getUniform<UniformFloat1>('terrainRingSize', 'PerMesh').value[0] = ring0.size;
			this._tmpVec4A[0] = ring0Offset.x;
			this._tmpVec4A[1] = ring0Offset.y;
			this._tmpVec4A[2] = ring1Offset.x;
			this._tmpVec4A[3] = ring1Offset.y;
			this.projectedMeshMaterial.getUniform('terrainRingOffset', 'PerMesh').value = this._tmpVec4A;
			this.projectedMeshMaterial.getUniform<UniformFloat1>('terrainLevelId', 'PerMesh').value[0] = levelId;
			this.projectedMeshMaterial.getUniform<UniformFloat1>('segmentCount', 'PerMesh').value[0] = ring0.segmentCount * 2;
			this._tmpVec2A[0] = relativeCameraPosition[0];
			this._tmpVec2A[1] = relativeCameraPosition[1];
			this.projectedMeshMaterial.getUniform('cameraPosition', 'PerMesh').value = this._tmpVec2A;
			this.projectedMeshMaterial.getUniform('detailTextureOffset', 'PerMesh').value = detailTextureOffset;
			this.projectedMeshMaterial.getUniform<UniformFloat1>('time', 'PerMaterial').value[0] = performance.now() * 0.001;

			this.projectedMeshMaterial.updateUniformBlock('PerMesh');

			tile.projectedMesh.draw();
		}
	}

	private renderHuggingMeshes(): void {
		const camera = this.manager.sceneSystem.objects.camera;
		const tiles = this.manager.sceneSystem.objects.tiles;
		const terrain = this.manager.sceneSystem.objects.terrain;

		const terrainNormal = <AbstractTexture2DArray>this.getPhysicalResource('TerrainNormal').colorAttachments[0].texture;
		const terrainRingHeight = <AbstractTexture2DArray>this.getPhysicalResource('TerrainRingHeight').colorAttachments[0].texture;

		this.huggingMeshMaterial.getUniform('tRingHeight').value = terrainRingHeight;
		this.huggingMeshMaterial.getUniform('tNormal').value = terrainNormal;

		this.renderer.useMaterial(this.huggingMeshMaterial);

		this._tmpMat4A.set(camera.jitteredProjectionMatrix.values);
		this.huggingMeshMaterial.getUniform<UniformMatrix4>('projectionMatrix', 'PerMaterial').value = this._tmpMat4A;
		this.huggingMeshMaterial.updateUniformBlock('PerMaterial');

		for (const tile of tiles) {
			if (!tile.huggingMesh || !tile.huggingMesh.inCameraFrustum(camera)) {
				continue;
			}

			const tileParams = terrain.getTileParams(tile);

			if (!tileParams) {
				continue;
			}

			const {ring0, levelId, ring0Offset, ring1Offset} = tileParams;
			const normalTextureTransforms = this.getTileNormalTexturesTransforms(tile);
			const relativeCameraPosition = this.getCameraPositionRelativeToTile(camera, tile);

			this._tmpMat4B.set(Mat4.multiply(camera.matrixWorldInverse, tile.matrixWorld).values);
			this._tmpMat4C.set(Mat4.multiply(this.cameraMatrixWorldInversePrev, tile.matrixWorld).values);

			this.huggingMeshMaterial.getUniform('modelViewMatrix', 'PerMesh').value = this._tmpMat4B;
			this.huggingMeshMaterial.getUniform('modelViewMatrixPrev', 'PerMesh').value = this._tmpMat4C;
			this.huggingMeshMaterial.getUniform('transformNormal0', 'PerMesh').value = normalTextureTransforms[0];
			this.huggingMeshMaterial.getUniform('transformNormal1', 'PerMesh').value = normalTextureTransforms[1];
			this.huggingMeshMaterial.getUniform<UniformFloat1>('terrainRingSize', 'PerMesh').value[0] = ring0.size;
			this._tmpVec4A[0] = ring0Offset.x;
			this._tmpVec4A[1] = ring0Offset.y;
			this._tmpVec4A[2] = ring1Offset.x;
			this._tmpVec4A[3] = ring1Offset.y;
			this.huggingMeshMaterial.getUniform('terrainRingOffset', 'PerMesh').value = this._tmpVec4A;
			this.huggingMeshMaterial.getUniform<UniformFloat1>('terrainLevelId', 'PerMesh').value[0] = levelId;
			this.huggingMeshMaterial.getUniform<UniformFloat1>('segmentCount', 'PerMesh').value[0] = ring0.segmentCount * 2;
			this._tmpVec2A[0] = relativeCameraPosition[0];
			this._tmpVec2A[1] = relativeCameraPosition[1];
			this.huggingMeshMaterial.getUniform('cameraPosition', 'PerMesh').value = this._tmpVec2A;
			this.huggingMeshMaterial.getUniform<UniformFloat1>('time', 'PerMaterial').value[0] = performance.now() * 0.001;
			this.huggingMeshMaterial.updateUniformBlock('PerMesh');

			tile.huggingMesh.draw();
		}
	}

	private renderInstances(instancesOrigin: Vec2): void {
		const camera = this.manager.sceneSystem.objects.camera;
		const tiles = this.manager.sceneSystem.objects.tiles;

		this.manager.sceneSystem.updateInstancedObjectsBuffers(tiles, camera, instancesOrigin, this.manager.sceneSystem.frameId);

		for (const [name, instancedObject] of this.manager.sceneSystem.objects.instancedObjects.entries()) {
			if (instancedObject.instanceCount === 0) {
				continue;
			}

			const materials: Record<InstanceStructure, AbstractMaterial> = {
				[InstanceStructure.Tree]: this.treeMaterial,
				[InstanceStructure.Generic]: this.genericInstanceMaterial,
				[InstanceStructure.Advanced]: this.advancedInstanceMaterial
			};

			const config = Tile3DInstanceLODConfig[name as Tile3DInstanceType];
			const material = materials[config.structure];
			const mvMatrixPrev = Mat4.multiply(this.cameraMatrixWorldInversePrev, instancedObject.matrixWorld);

			this.renderer.useMaterial(material);

			this._tmpMat4A.set(camera.jitteredProjectionMatrix.values);
			this._tmpMat4B.set(instancedObject.matrixWorld.values);
			this._tmpMat4C.set(camera.matrixWorldInverse.values);
			this._tmpMat4D.set(mvMatrixPrev.values);
			material.getUniform('projectionMatrix', 'MainBlock').value = this._tmpMat4A;
			material.getUniform('modelMatrix', 'MainBlock').value = this._tmpMat4B;
			material.getUniform('viewMatrix', 'MainBlock').value = this._tmpMat4C;
			material.getUniform('modelViewMatrixPrev', 'MainBlock').value = this._tmpMat4D;
			material.updateUniformBlock('MainBlock');

			const textureIdUniform = material.getUniform('textureId', 'PerInstanceType');

			if (textureIdUniform) {
				this._tmpFloat1[0] = InstanceTextureIdList[name as Tile3DInstanceType];
				textureIdUniform.value = this._tmpFloat1;
				material.updateUniformBlock('PerInstanceType');
			}

			instancedObject.mesh.draw();
		}
	}

	private renderAircraft(instancesOrigin: Vec2): void {
		const camera = this.manager.sceneSystem.objects.camera;
		const aircraftObjects = this.manager.sceneSystem.objects.instancedAircraftParts;
		const vehicleSystem = this.manager.systemManager.getSystem(VehicleSystem);

		vehicleSystem.updateBuffers(instancesOrigin);

		const buffers = vehicleSystem.aircraftPartsBuffers;

		for (const [partType, buffer] of buffers.entries()) {
			const object = aircraftObjects.get(partType);

			if (!object) {
				continue;
			}

			const instanceCount = buffer.length / 6;

			object.position.set(instancesOrigin.x, 0, instancesOrigin.y);
			object.updateMatrix();
			object.updateMatrixWorld();
			object.setInstancesInterleavedBuffer(buffer, instanceCount);

			if (instanceCount === 0) {
				continue;
			}

			const texture = AircraftPartTextures[partType];
			const mvMatrixPrev = Mat4.multiply(this.cameraMatrixWorldInversePrev, object.matrixWorld);

			this.renderer.useMaterial(this.aircraftMaterial);

			this._tmpMat4A.set(camera.jitteredProjectionMatrix.values);
			this._tmpMat4B.set(object.matrixWorld.values);
			this._tmpMat4C.set(camera.matrixWorldInverse.values);
			this._tmpMat4D.set(mvMatrixPrev.values);
			this._tmpFloat1[0] = texture;
			this.aircraftMaterial.getUniform('projectionMatrix', 'MainBlock').value = this._tmpMat4A;
			this.aircraftMaterial.getUniform('modelMatrix', 'MainBlock').value = this._tmpMat4B;
			this.aircraftMaterial.getUniform('viewMatrix', 'MainBlock').value = this._tmpMat4C;
			this.aircraftMaterial.getUniform('modelViewMatrixPrev', 'MainBlock').value = this._tmpMat4D;
			this.aircraftMaterial.getUniform('textureId', 'MainBlock').value = this._tmpFloat1;
			this.aircraftMaterial.updateUniformBlock('MainBlock');

			object.mesh.draw();
		}
	}

	private renderTrains(): void {
		const trainRenderingSystem = this.manager.systemManager.getSystem(TrainRenderingSystem);
		if (!trainRenderingSystem) return;

		const camera = this.manager.sceneSystem.objects.camera;
		const allMeshes = [
			...trainRenderingSystem.carMeshes,
			trainRenderingSystem.trackMesh,
			...trainRenderingSystem.stationMeshes,
		].filter(Boolean);

		for (const m of allMeshes) {
			if (!m.isMeshReady()) {
				m.updateMesh(this.renderer);
			}
		}

		const meshes = allMeshes.filter(m => m.mesh);

		if (meshes.length === 0) return;

		this.renderer.useMaterial(this.trainMaterial);

		for (const meshObj of meshes) {
			this._tmpMat4A.set(camera.jitteredProjectionMatrix.values);
			this._tmpMat4B.set(meshObj.matrixWorld.values);
			this._tmpMat4C.set(camera.matrixWorldInverse.values);
			this._tmpMat4D.set(Mat4.multiply(this.cameraMatrixWorldInversePrev, meshObj.matrixWorld).values);

			this.trainMaterial.getUniform('projectionMatrix', 'MainBlock').value = this._tmpMat4A;
			this.trainMaterial.getUniform('modelMatrix', 'MainBlock').value = this._tmpMat4B;
			this.trainMaterial.getUniform('viewMatrix', 'MainBlock').value = this._tmpMat4C;
			this.trainMaterial.getUniform('modelViewMatrixPrev', 'MainBlock').value = this._tmpMat4D;
			this.trainMaterial.updateUniformBlock('MainBlock');

			meshObj.draw();
		}
	}

	private writeToObjectIdBuffer(): void {
		const mainRenderPass = this.getPhysicalResource('GBufferRenderPass');
		mainRenderPass.readColorAttachmentPixel(4, this.objectIdBuffer, this.objectIdX, this.objectIdY);
	}

	private getInstancesOrigin(camera: Camera): Vec2 {
		return new Vec2(
			Math.floor(camera.position.x / 10000) * 10000,
			Math.floor(camera.position.z / 10000) * 10000
		);
	}

	public render(): void {
		const camera = this.manager.sceneSystem.objects.camera;

		const instancesOrigin = this.getInstancesOrigin(camera);

		if (!this.cameraMatrixWorldInversePrev) {
			this.cameraMatrixWorldInversePrev = camera.matrixWorldInverse;
		} else {
			const pivotDelta = this.manager.sceneSystem.pivotDelta;

			this.cameraMatrixWorldInversePrev = Mat4.translate(
				this.cameraMatrixWorldInversePrev,
				pivotDelta.x,
				0,
				pivotDelta.y
			);
		}

		this.updateMaterialsDefines();

		const mainRenderPass = this.getPhysicalResource('GBufferRenderPass');
		this.renderer.beginRenderPass(mainRenderPass);

		this.renderSkybox();
		this.renderExtrudedMeshes();
		this.renderAircraft(instancesOrigin);
		this.renderTerrain();
		this.renderProjectedMeshes();
		this.renderHuggingMeshes();
		this.renderInstances(instancesOrigin);
		this.renderTrains();
		this.writeToObjectIdBuffer();

		this.saveCameraMatrixWorldInverse();
	}

	private saveCameraMatrixWorldInverse(): void {
		this.cameraMatrixWorldInversePrev = this.manager.sceneSystem.objects.camera.matrixWorldInverse;
	}

	public setSize(width: number, height: number): void {

	}
}